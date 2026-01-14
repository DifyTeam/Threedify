// selection.js - Funções para encontrar e selecionar vértices, arestas e faces (COM MULTISSELEÇÃO)

// === INICIALIZAÇÃO DOS ARRAYS DE MULTISSELEÇÃO ===
if (!window.selectedEdges) window.selectedEdges = [];
if (!window.edgeHighlights) window.edgeHighlights = [];
if (!window.selectedFaces) window.selectedFaces = [];
if (!window.faceHighlights) window.faceHighlights = [];

// === FUNÇÃO DE LIMPEZA DE HIGHLIGHTS ===
function limparHighlightsEdicao() {
    // Limpa highlight de aresta única
    if (typeof edgeHighlight !== 'undefined' && edgeHighlight) {
        if (scene) scene.remove(edgeHighlight);
        if (edgeHighlight.geometry) edgeHighlight.geometry.dispose();
        if (edgeHighlight.material) edgeHighlight.material.dispose();
        edgeHighlight = null;
    }
    
    // Limpa highlights de múltiplas arestas
    if (window.edgeHighlights && window.edgeHighlights.length > 0) {
        window.edgeHighlights.forEach(h => {
            if (scene) scene.remove(h);
            if (h.geometry) h.geometry.dispose();
            if (h.material) h.material.dispose();
        });
        window.edgeHighlights = [];
    }
    
    // Limpa highlight de face única
    if (typeof faceHighlight !== 'undefined' && faceHighlight) {
        if (scene) scene.remove(faceHighlight);
        if (faceHighlight.geometry) faceHighlight.geometry.dispose();
        if (faceHighlight.material) faceHighlight.material.dispose();
        faceHighlight = null;
    }
    
    // Limpa highlights de múltiplas faces
    if (window.faceHighlights && window.faceHighlights.length > 0) {
        window.faceHighlights.forEach(h => {
            if (scene) scene.remove(h);
            if (h.geometry) h.geometry.dispose();
            if (h.material) h.material.dispose();
        });
        window.faceHighlights = [];
    }
    
    // Limpa arrays de seleção
    window.selectedEdges = [];
    window.selectedFaces = [];
    
    console.log('Highlights de edição limpos');
}

// Exporta para ser usada em outros arquivos
if (typeof window !== 'undefined') {
    window.limparHighlightsEdicao = limparHighlightsEdicao;
}

// === FUNÇÃO PARA DESSELECIONAR TUDO ===
function desselecionarTudo() {
    console.log('Desselecionando tudo...');
    
    // Limpa seleção de vértices
    if (selectedVertices && selectedVertices.length > 0 && vertexInstancedMesh) {
        selectedVertices.forEach(id => {
            vertexInstancedMesh.setColorAt(id, new THREE.Color(0x000000));
        });
        vertexInstancedMesh.instanceColor.needsUpdate = true;
        selectedVertices = [];
    }
    
    // Limpa seleção de arestas
    selectedEdge = null;
    if (edgeHighlight) {
        scene.remove(edgeHighlight);
        edgeHighlight.geometry.dispose();
        edgeHighlight.material.dispose();
        edgeHighlight = null;
    }
    
    window.selectedEdges = [];
    if (window.edgeHighlights && window.edgeHighlights.length > 0) {
        window.edgeHighlights.forEach(h => {
            scene.remove(h);
            h.geometry.dispose();
            h.material.dispose();
        });
        window.edgeHighlights = [];
    }
    
    // Limpa seleção de faces
    selectedFace = null;
    if (faceHighlight) {
        scene.remove(faceHighlight);
        faceHighlight.geometry.dispose();
        faceHighlight.material.dispose();
        faceHighlight = null;
    }
    
    window.selectedFaces = [];
    if (window.faceHighlights && window.faceHighlights.length > 0) {
        window.faceHighlights.forEach(h => {
            scene.remove(h);
            h.geometry.dispose();
            h.material.dispose();
        });
        window.faceHighlights = [];
    }
    
    // Remove gizmo
    if (transformControls) {
        transformControls.detach();
    }
    gizmoAtivo = false;
    
    // Limpa variáveis auxiliares
    selectedUniqueIndices = [];
    initialVertexPositions = {};
    initialEditPosition = null;
}

// Exporta função
if (typeof window !== 'undefined') {
    window.desselecionarTudo = desselecionarTudo;
}

function encontrarArestaMaisProxima(point) {
  const matrixWorld = window.editingMesh.matrixWorld;
  let minDist = Infinity;
  let closestEdge = null;
  
  // Threshold ajustado - mais permissivo
  const touchThreshold = 0.5;
  
  edges.forEach((edge, index) => {
    if (!uniqueVertices[edge[0]] || !uniqueVertices[edge[1]]) {
      return;
    }
    
    const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
    const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
    
    const line = new THREE.Line3(v1, v2);
    const closestPoint = new THREE.Vector3();
    line.closestPointToPoint(point, true, closestPoint);
    
    const dist = point.distanceTo(closestPoint);
    
    if (dist < minDist && dist < touchThreshold) {
      minDist = dist;
      closestEdge = index;
    }
  });
  
  return closestEdge;
}

function encontrarFaceMaisProxima(point) {
  const matrixWorld = window.editingMesh.matrixWorld;
  let minDist = Infinity;
  let closestFace = null;
  
  faces.forEach((face, index) => {
    const validFace = face.every(v => uniqueVertices[v] !== undefined);
    if (!validFace) return;
    
    const faceVertices = face.map(v => uniqueVertices[v].clone().applyMatrix4(matrixWorld));
    
    // Verifica se há pelo menos 3 vértices para formar um plano
    if (faceVertices.length < 3) return;
    
    // Calcula o normal da face
    const v1 = new THREE.Vector3().subVectors(faceVertices[1], faceVertices[0]);
    const v2 = new THREE.Vector3().subVectors(faceVertices[2], faceVertices[0]);
    const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();
    
    // Calcula distância do ponto ao plano da face
    const toPoint = new THREE.Vector3().subVectors(point, faceVertices[0]);
    const distToPlane = Math.abs(toPoint.dot(normal));
    
    // Projeta o ponto no plano da face
    const projectedPoint = point.clone().sub(normal.clone().multiplyScalar(toPoint.dot(normal)));
    
    // Verifica se o ponto projetado está dentro do polígono da face
    // usando o método de ray casting
    let inside = false;
    for (let i = 0, j = faceVertices.length - 1; i < faceVertices.length; j = i++) {
      // Projeta os vértices em um plano 2D local
      const vi = faceVertices[i];
      const vj = faceVertices[j];
      
      // Usa o sistema de coordenadas local baseado no normal
      const tangent = v1.clone().normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent);
      
      const pi = new THREE.Vector2(
        new THREE.Vector3().subVectors(vi, faceVertices[0]).dot(tangent),
        new THREE.Vector3().subVectors(vi, faceVertices[0]).dot(bitangent)
      );
      const pj = new THREE.Vector2(
        new THREE.Vector3().subVectors(vj, faceVertices[0]).dot(tangent),
        new THREE.Vector3().subVectors(vj, faceVertices[0]).dot(bitangent)
      );
      const pp = new THREE.Vector2(
        new THREE.Vector3().subVectors(projectedPoint, faceVertices[0]).dot(tangent),
        new THREE.Vector3().subVectors(projectedPoint, faceVertices[0]).dot(bitangent)
      );
      
      if ((pi.y > pp.y) !== (pj.y > pp.y) &&
          pp.x < (pj.x - pi.x) * (pp.y - pi.y) / (pj.y - pi.y) + pi.x) {
        inside = !inside;
      }
    }
    
    if (inside) {
      // Se está dentro, usa a distância ao plano como critério principal
      if (distToPlane < minDist) {
        minDist = distToPlane;
        closestFace = index;
      }
    } else {
      // Se está fora, calcula a distância às arestas da face
      let minEdgeDist = Infinity;
      for (let i = 0; i < faceVertices.length; i++) {
        const v1 = faceVertices[i];
        const v2 = faceVertices[(i + 1) % faceVertices.length];
        const line = new THREE.Line3(v1, v2);
        const closest = new THREE.Vector3();
        line.closestPointToPoint(point, true, closest);
        const dist = point.distanceTo(closest);
        minEdgeDist = Math.min(minEdgeDist, dist);
      }
      
      // Threshold para arestas
      if (minEdgeDist < 0.3) {
        // Combina distância à aresta com distância ao plano
        const combinedDist = minEdgeDist + distToPlane * 0.2;
        if (combinedDist < minDist) {
          minDist = combinedDist;
          closestFace = index;
        }
      }
    }
  });
  
  return closestFace;
}

function selecionarVertice(instanceId) {
  if (!uniqueVertices[instanceId]) {
    console.warn(`Vértice ${instanceId} não existe`);
    return;
  }
  
  // Verifica se multisseleção está ativa
  const multiSelCheckbox = document.getElementById('multselection');
  const isMultiSelectionEnabled = multiSelCheckbox && multiSelCheckbox.checked;
  
  if (isMultiSelectionEnabled) {
    // MODO MULTISSELEÇÃO
    // Verifica se o vértice já está selecionado
    const index = selectedVertices.indexOf(instanceId);
    
    if (index !== -1) {
      // Vértice já está selecionado, remove da seleção (toggle)
      selectedVertices.splice(index, 1);
      
      // Restaura cor original (preto)
      if (vertexInstancedMesh) {
        vertexInstancedMesh.setColorAt(instanceId, new THREE.Color(0x000000));
      }
      
      console.log(`Vértice ${instanceId} removido da seleção`);
    } else {
      // Adiciona à seleção
      selectedVertices.push(instanceId);
      
      // Define cor de seleção (vermelho)
      if (vertexInstancedMesh) {
        vertexInstancedMesh.setColorAt(instanceId, new THREE.Color(0xff0000));
      }
      
      console.log(`Vértice ${instanceId} adicionado à seleção`);
    }
    
    if (vertexInstancedMesh) {
      vertexInstancedMesh.instanceColor.needsUpdate = true;
    }
    
    // Atualiza gizmo para centralizar em todos os vértices selecionados
    if (selectedVertices.length > 0) {
      if (!editHelper) {
        editHelper = new THREE.Object3D();
        scene.add(editHelper);
      }
      
      // Calcula centro de todos os vértices selecionados
      const center = new THREE.Vector3();
      selectedVertices.forEach(id => {
        const matrix = new THREE.Matrix4();
        vertexInstancedMesh.getMatrixAt(id, matrix);
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(matrix);
        center.add(position);
      });
      center.divideScalar(selectedVertices.length);
      
      editHelper.position.copy(center);
      editHelper.quaternion.set(0, 0, 0, 1);
      editHelper.scale.set(1, 1, 1);
      
      initialEditPosition = editHelper.position.clone();
      initialVertexPositions = {};
      selectedVertices.forEach(id => {
        const matrix = new THREE.Matrix4();
        vertexInstancedMesh.getMatrixAt(id, matrix);
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(matrix);
        initialVertexPositions[id] = position.clone();
      });
      selectedUniqueIndices = [...selectedVertices];
      
      transformControls.detach();
      transformControls.attach(editHelper);
      gizmoAtivo = true;
    } else {
      // Nenhum vértice selecionado, remove gizmo
      transformControls.detach();
      gizmoAtivo = false;
    }
    
  } else {
    // MODO SELEÇÃO ÚNICA (comportamento original)
    if (selectedVertices.length > 0 && vertexInstancedMesh) {
      selectedVertices.forEach(id => {
        vertexInstancedMesh.setColorAt(id, new THREE.Color(0x000000));
      });
    }
    
    selectedVertices = [instanceId];
    if (vertexInstancedMesh) {
      vertexInstancedMesh.setColorAt(instanceId, new THREE.Color(0xff0000));
      vertexInstancedMesh.instanceColor.needsUpdate = true;
    }
    
    if (!editHelper) {
      editHelper = new THREE.Object3D();
      scene.add(editHelper);
    }
    
    const matrix = new THREE.Matrix4();
    vertexInstancedMesh.getMatrixAt(instanceId, matrix);
    const position = new THREE.Vector3();
    position.setFromMatrixPosition(matrix);
    editHelper.position.copy(position);
    
    editHelper.quaternion.set(0, 0, 0, 1);
    editHelper.scale.set(1, 1, 1);
    initialEditPosition = editHelper.position.clone();
    initialVertexPositions = {};
    initialVertexPositions[instanceId] = position.clone();
    selectedUniqueIndices = [instanceId];
    
    transformControls.detach();
    transformControls.attach(editHelper);
    gizmoAtivo = true;
    
    console.log(`Vértice ${instanceId} selecionado`);
  }
}

function selecionarAresta(edgeIndex) {
  const edge = edges[edgeIndex];
  
  if (!uniqueVertices[edge[0]] || !uniqueVertices[edge[1]]) {
    console.warn(`Aresta ${edgeIndex} possui vértices inválidos`);
    return;
  }
  
  // Verifica se multisseleção está ativa
  const multiSelCheckbox = document.getElementById('multselection');
  const isMultiSelectionEnabled = multiSelCheckbox && multiSelCheckbox.checked;
  
  // Inicializa arrays de seleção múltipla se não existirem
  if (!window.selectedEdges) window.selectedEdges = [];
  if (!window.edgeHighlights) window.edgeHighlights = [];
  
  const matrixWorld = window.editingMesh.matrixWorld;
  
  if (isMultiSelectionEnabled) {
    // MODO MULTISSELEÇÃO
    const index = window.selectedEdges.indexOf(edgeIndex);
    
    if (index !== -1) {
      // Aresta já está selecionada, remove da seleção (toggle)
      window.selectedEdges.splice(index, 1);
      
      // Remove highlight específico desta aresta
      if (window.edgeHighlights[index]) {
        scene.remove(window.edgeHighlights[index]);
        window.edgeHighlights[index].geometry.dispose();
        window.edgeHighlights[index].material.dispose();
        window.edgeHighlights.splice(index, 1);
      }
      
      console.log(`Aresta ${edgeIndex} removida da seleção`);
      
      // Atualiza selectedEdge para compatibilidade
      selectedEdge = window.selectedEdges.length > 0 ? window.selectedEdges[window.selectedEdges.length - 1] : null;
      
      // Se não há mais arestas selecionadas, remove o gizmo
      if (window.selectedEdges.length === 0) {
        transformControls.detach();
        gizmoAtivo = false;
        return;
      }
    } else {
      // Adiciona à seleção
      window.selectedEdges.push(edgeIndex);
      
      // Cria highlight para esta aresta
      const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
      const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
      
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        v1.x, v1.y, v1.z, v2.x, v2.y, v2.z
      ], 3));
      
      const material = new THREE.LineBasicMaterial({ color: 0xDE4E4E, linewidth: 3 });
      const highlight = new THREE.LineSegments(geometry, material);
      scene.add(highlight);
      window.edgeHighlights.push(highlight);
      
      console.log(`Aresta ${edgeIndex} adicionada à seleção`);
      
      // Atualiza selectedEdge para compatibilidade (última aresta selecionada)
      selectedEdge = edgeIndex;
    }
    
    // Atualiza gizmo para centralizar em todas as arestas selecionadas
    if (window.selectedEdges.length > 0) {
      if (!editHelper) {
        editHelper = new THREE.Object3D();
        scene.add(editHelper);
      }
      
      // Calcula centro de todas as arestas selecionadas
      const center = new THREE.Vector3();
      let vertexCount = 0;
      window.selectedEdges.forEach(eIdx => {
        const e = edges[eIdx];
        const v1 = uniqueVertices[e[0]].clone().applyMatrix4(matrixWorld);
        const v2 = uniqueVertices[e[1]].clone().applyMatrix4(matrixWorld);
        center.add(v1).add(v2);
        vertexCount += 2;
      });
      center.divideScalar(vertexCount);
      
      editHelper.position.copy(center);
      editHelper.quaternion.set(0, 0, 0, 1);
      editHelper.scale.set(1, 1, 1);
      
      initialEditPosition = editHelper.position.clone();
      initialVertexPositions = {};
      selectedUniqueIndices = [];
      
      window.selectedEdges.forEach(eIdx => {
        const e = edges[eIdx];
        e.forEach(idx => {
          if (!selectedUniqueIndices.includes(idx)) {
            selectedUniqueIndices.push(idx);
            initialVertexPositions[idx] = uniqueVertices[idx].clone().applyMatrix4(matrixWorld);
          }
        });
      });
      
      transformControls.detach();
      transformControls.attach(editHelper);
      gizmoAtivo = true;
    }
    
  } else {
    // MODO SELEÇÃO ÚNICA (comportamento original)
    // Limpa highlights anteriores
    if (edgeHighlight) {
      scene.remove(edgeHighlight);
      edgeHighlight.geometry.dispose();
      edgeHighlight.material.dispose();
    }
    
    // Limpa array de multisseleção
    window.selectedEdges = [edgeIndex];
    window.edgeHighlights.forEach(h => {
      scene.remove(h);
      h.geometry.dispose();
      h.material.dispose();
    });
    window.edgeHighlights = [];
    
    selectedEdge = edgeIndex;
    
    const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
    const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      v1.x, v1.y, v1.z, v2.x, v2.y, v2.z
    ], 3));
    
    const material = new THREE.LineBasicMaterial({ color: 0xDE4E4E, linewidth: 3 });
    edgeHighlight = new THREE.LineSegments(geometry, material);
    scene.add(edgeHighlight);
    
    if (!editHelper) {
      editHelper = new THREE.Object3D();
      scene.add(editHelper);
    }
    
    const center = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
    editHelper.position.copy(center);
    
    editHelper.quaternion.set(0, 0, 0, 1);
    editHelper.scale.set(1, 1, 1);
    initialEditPosition = editHelper.position.clone();
    initialVertexPositions = {};
    selectedUniqueIndices = edge.slice();
    edge.forEach(idx => {
      initialVertexPositions[idx] = uniqueVertices[idx].clone().applyMatrix4(matrixWorld);
    });
    
    transformControls.detach();
    transformControls.attach(editHelper);
    gizmoAtivo = true;
    
    console.log(`Aresta ${edgeIndex} selecionada`);
  }
}

function selecionarFace(faceIndex) {
  const face = faces[faceIndex];
  
  const validFace = face.every(v => uniqueVertices[v] !== undefined);
  if (!validFace) {
    console.warn(`Face ${faceIndex} possui vértices inválidos`);
    return;
  }
  
  // Verifica se multisseleção está ativa
  const multiSelCheckbox = document.getElementById('multselection');
  const isMultiSelectionEnabled = multiSelCheckbox && multiSelCheckbox.checked;
  
  // Inicializa arrays de seleção múltipla se não existirem
  if (!window.selectedFaces) window.selectedFaces = [];
  if (!window.faceHighlights) window.faceHighlights = [];
  
  const matrixWorld = window.editingMesh.matrixWorld;
  
  if (isMultiSelectionEnabled) {
    // MODO MULTISSELEÇÃO
    const index = window.selectedFaces.indexOf(faceIndex);
    
    if (index !== -1) {
      // Face já está selecionada, remove da seleção (toggle)
      window.selectedFaces.splice(index, 1);
      
      // Remove highlight específico desta face
      if (window.faceHighlights[index]) {
        scene.remove(window.faceHighlights[index]);
        window.faceHighlights[index].geometry.dispose();
        window.faceHighlights[index].material.dispose();
        window.faceHighlights.splice(index, 1);
      }
      
      console.log(`Face ${faceIndex} removida da seleção (${window.selectedFaces.length} restantes)`);
      
      // Atualiza selectedFace para compatibilidade
      selectedFace = window.selectedFaces.length > 0 ? window.selectedFaces[window.selectedFaces.length - 1] : null;
      
      // Se não há mais faces selecionadas, remove o gizmo
      if (window.selectedFaces.length === 0) {
        transformControls.detach();
        gizmoAtivo = false;
        return;
      }
    } else {
      // Adiciona à seleção
      window.selectedFaces.push(faceIndex);
      
      // Cria highlight para esta face
      const positions = [];
      const faceVertices = [];
      
      for (let i = 0; i < face.length; i++) {
        const v1 = uniqueVertices[face[i]].clone().applyMatrix4(matrixWorld);
        const v2 = uniqueVertices[face[(i + 1) % face.length]].clone().applyMatrix4(matrixWorld);
        positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
        faceVertices.push(v1);
      }
      
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      
      const material = new THREE.LineBasicMaterial({ color: 0xDE4E4E, linewidth: 8 });
      const highlight = new THREE.LineSegments(geometry, material);
      scene.add(highlight);
      window.faceHighlights.push(highlight);
      
      console.log(`Face ${faceIndex} adicionada à seleção (${window.selectedFaces.length} total)`);
      
      // Atualiza selectedFace para compatibilidade (última face selecionada)
      selectedFace = faceIndex;
    }
    
    // Atualiza gizmo para centralizar em todas as faces selecionadas
    if (window.selectedFaces.length > 0) {
      if (!editHelper) {
        editHelper = new THREE.Object3D();
        scene.add(editHelper);
      }
      
      // Calcula centro de todas as faces selecionadas
      const center = new THREE.Vector3();
      let vertexCount = 0;
      window.selectedFaces.forEach(fIdx => {
        const f = faces[fIdx];
        if (f) {
          f.forEach(vIdx => {
            const v = uniqueVertices[vIdx].clone().applyMatrix4(matrixWorld);
            center.add(v);
            vertexCount++;
          });
        }
      });
      center.divideScalar(vertexCount);
      
      editHelper.position.copy(center);
      editHelper.quaternion.set(0, 0, 0, 1);
      editHelper.scale.set(1, 1, 1);
      
      initialEditPosition = editHelper.position.clone();
      initialVertexPositions = {};
      selectedUniqueIndices = [];
      
      window.selectedFaces.forEach(fIdx => {
        const f = faces[fIdx];
        if (f) {
          f.forEach(idx => {
            if (!selectedUniqueIndices.includes(idx)) {
              selectedUniqueIndices.push(idx);
              initialVertexPositions[idx] = uniqueVertices[idx].clone().applyMatrix4(matrixWorld);
            }
          });
        }
      });
      
      transformControls.detach();
      transformControls.attach(editHelper);
      gizmoAtivo = true;
    }
    
  } else {
    // MODO SELEÇÃO ÚNICA (comportamento original)
    selectedFace = faceIndex;
    window.selectedFaces = [];
    
    // Limpa highlight anterior apenas se diferente
    if (faceHighlight && faceHighlight.userData?.faceIndex !== faceIndex) {
      scene.remove(faceHighlight);
      faceHighlight.geometry.dispose();
      faceHighlight.material.dispose();
      faceHighlight = null;
    }
    
    // Limpa array de multisseleção
    if (window.faceHighlights && window.faceHighlights.length > 0) {
      window.faceHighlights.forEach(h => {
        scene.remove(h);
        h.geometry.dispose();
        h.material.dispose();
      });
      window.faceHighlights = [];
    }
    
    // Só cria novo highlight se necessário
    if (!faceHighlight) {
      const positions = [];
      const faceVertices = [];
      
      for (let i = 0; i < face.length; i++) {
        const v1 = uniqueVertices[face[i]].clone().applyMatrix4(matrixWorld);
        const v2 = uniqueVertices[face[(i + 1) % face.length]].clone().applyMatrix4(matrixWorld);
        positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
        faceVertices.push(v1);
      }
      
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      
      const material = new THREE.LineBasicMaterial({ color: 0xDE4E4E, linewidth: 8 });
      faceHighlight = new THREE.LineSegments(geometry, material);
      faceHighlight.userData = { faceIndex: faceIndex };
      scene.add(faceHighlight);
    }
    
    if (!editHelper) {
      editHelper = new THREE.Object3D();
      scene.add(editHelper);
    }
    
    const center = new THREE.Vector3();
    face.forEach(vIdx => {
      const v = uniqueVertices[vIdx].clone().applyMatrix4(matrixWorld);
      center.add(v);
    });
    center.divideScalar(face.length);
    editHelper.position.copy(center);
    
    editHelper.quaternion.set(0, 0, 0, 1);
    editHelper.scale.set(1, 1, 1);
    initialEditPosition = editHelper.position.clone();
    initialVertexPositions = {};
    selectedUniqueIndices = face.slice();
    face.forEach(idx => {
      initialVertexPositions[idx] = uniqueVertices[idx].clone().applyMatrix4(matrixWorld);
    });
    
    transformControls.detach();
    transformControls.attach(editHelper);
    gizmoAtivo = true;
    
    console.log(`Face ${faceIndex} selecionada`);
  }
}

// === SISTEMA DE TRANSFORMAÇÃO PARA MULTISSELEÇÃO NO MODO MODELING ===
if (typeof transformControls !== 'undefined' && transformControls) {
  let modelingTransformStart = false;
  let initialPositions = {};
  
  transformControls.addEventListener('mouseDown', () => {
    if (modoAtual !== 'edicao') return;
    modelingTransformStart = true;
    initialPositions = {};
    
    // Salva posições iniciais de todos os vértices selecionados
    if (selectedUniqueIndices && selectedUniqueIndices.length > 0) {
      selectedUniqueIndices.forEach(idx => {
        if (uniqueVertices[idx]) {
          initialPositions[idx] = uniqueVertices[idx].clone();
        }
      });
    }
  });
  
  transformControls.addEventListener('objectChange', () => {
    if (!modelingTransformStart || modoAtual !== 'edicao') return;
    if (!editHelper || !selectedUniqueIndices || selectedUniqueIndices.length === 0) return;
    
    const delta = editHelper.position.clone().sub(initialEditPosition);
    const matrixWorld = window.editingMesh.matrixWorld;
    const matrixWorldInv = matrixWorld.clone().invert();
    
    // Aplica o delta a todos os vértices selecionados
    selectedUniqueIndices.forEach(idx => {
      if (initialPositions[idx] && uniqueVertices[idx]) {
        const worldPos = initialPositions[idx].clone().applyMatrix4(matrixWorld);
        worldPos.add(delta);
        const localPos = worldPos.applyMatrix4(matrixWorldInv);
        uniqueVertices[idx].copy(localPos);
      }
    });
    
    // Atualiza geometria
    if (typeof atualizarPosicoesRapido === 'function') {
      atualizarPosicoesRapido();
    } else if (typeof reconstruirGeometria === 'function') {
      reconstruirGeometria();
    }
    
    // Atualiza highlights visuais
    if (submodoEdicao === 'edge' && window.edgeHighlights && window.selectedEdges) {
      window.edgeHighlights.forEach((highlight, i) => {
        const edgeIdx = window.selectedEdges[i];
        if (edgeIdx !== undefined && edges[edgeIdx]) {
          const edge = edges[edgeIdx];
          const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
          const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
          
          const positions = highlight.geometry.attributes.position;
          positions.setXYZ(0, v1.x, v1.y, v1.z);
          positions.setXYZ(1, v2.x, v2.y, v2.z);
          positions.needsUpdate = true;
        }
      });
    } else if (submodoEdicao === 'face' && window.faceHighlights && window.selectedFaces) {
      window.faceHighlights.forEach((highlight, i) => {
        const faceIdx = window.selectedFaces[i];
        if (faceIdx !== undefined && faces[faceIdx]) {
          const face = faces[faceIdx];
          const positions = highlight.geometry.attributes.position;
          let posIdx = 0;
          
          for (let j = 0; j < face.length; j++) {
            const v1 = uniqueVertices[face[j]].clone().applyMatrix4(matrixWorld);
            const v2 = uniqueVertices[face[(j + 1) % face.length]].clone().applyMatrix4(matrixWorld);
            positions.setXYZ(posIdx++, v1.x, v1.y, v1.z);
            positions.setXYZ(posIdx++, v2.x, v2.y, v2.z);
          }
          positions.needsUpdate = true;
        }
      });
    }
  });
  
  transformControls.addEventListener('mouseUp', () => {
    if (!modelingTransformStart || modoAtual !== 'edicao') return;
    modelingTransformStart = false;
    
    // Atualiza normais após transformação
    if (typeof atualizarNormais === 'function') {
      atualizarNormais();
    }
    
    // Atualiza BVH se disponível
    if (typeof updateBVH === 'function' && window.editingMesh) {
      updateBVH(window.editingMesh);
    }
  });
} 