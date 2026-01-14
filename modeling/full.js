// core.js - Configuração básica e supressão de warnings

// Suprime avisos de depreciação do Three.js
const originalWarn = console.warn;
console.warn = function(message) {
  if (typeof message === 'string' &&
    (message.includes('has been renamed') ||
      message.includes('deprecated'))) {
    return;
  }
  originalWarn.apply(console, arguments);
};

// Variáveis globais principais
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedObject = null;
window.selectedObject = null;
const selectableObjects = [];
let pointerDownTime = 0;
let pointerDownPos = { x: 0, y: 0 };
let gizmoAtivo = true;


// TransformControls - assumindo que camera, renderer e scene já existem
const transformControls = new THREE.TransformControls(camera, renderer.domElement);
scene.add(transformControls);
transformControls.setSize(2);
window.transformControls = transformControls;

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
  if (!event.value && modoAtual === 'edicao' && selectedUniqueIndices.length > 0) {
    const matrixWorld = window.editingMesh.matrixWorld;
    selectedUniqueIndices.forEach(idx => {
      if (uniqueVertices[idx]) {
        initialVertexPositions[idx] = uniqueVertices[idx].clone().applyMatrix4(matrixWorld);
      }
    });
    if (editHelper) {
      initialEditPosition = editHelper.position.clone();
      editHelper.quaternion.set(0, 0, 0, 1);
      editHelper.scale.set(1, 1, 1);
    }
  }
}); 



// displayHelpers.js - Funções para mostrar vértices, arestas e faces

function mostrarVertices() {
  if (!window.editingMesh || uniqueVertices.length === 0) return;
  
  vertexCount = uniqueVertices.length;
  const matrixWorld = window.editingMesh.matrixWorld;
  
  const vertexGeometry = new THREE.SphereGeometry(0.03, 8, 8);
  const vertexMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.9
  });
  
  vertexInstancedMesh = new THREE.InstancedMesh(
    vertexGeometry,
    vertexMaterial,
    vertexCount
  );
  
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < vertexCount; i++) {
    if (!uniqueVertices[i]) {
      console.warn(`Vértice ${i} não existe`);
      continue;
    }
    
    const vertex = uniqueVertices[i].clone();
    vertex.applyMatrix4(matrixWorld);
    
    matrix.setPosition(vertex);
    vertexInstancedMesh.setMatrixAt(i, matrix);
  }
  
  vertexInstancedMesh.instanceMatrix.needsUpdate = true;
  scene.add(vertexInstancedMesh);
  console.log(`Exibindo ${vertexCount} vértices`);
}

function mostrarEdges() {
  if (!window.editingMesh || edges.length === 0) return;
  
  const matrixWorld = window.editingMesh.matrixWorld;
  const positions = [];
  
  edges.forEach((edge, index) => {
    if (!uniqueVertices[edge[0]] || !uniqueVertices[edge[1]]) {
      console.warn(`Aresta ${index} possui vértices inválidos:`, edge);
      return;
    }
    
    const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
    const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
    positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  });
  
  if (positions.length === 0) {
    console.warn('Nenhuma aresta válida para exibir');
    return;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  
  const material = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
  edgeLines = new THREE.LineSegments(geometry, material);
  
  scene.add(edgeLines);
  console.log(`Exibindo ${edges.length} arestas`);
}

function mostrarFaces() {
  if (!window.editingMesh || faces.length === 0) return;
  
  const matrixWorld = window.editingMesh.matrixWorld;
  const positions = [];
  
  faces.forEach((face, index) => {
    const validFace = face.every(v => uniqueVertices[v] !== undefined);
    
    if (!validFace) {
      console.warn(`Face ${index} possui vértices inválidos:`, face);
      return;
    }
    
    for (let i = 0; i < face.length; i++) {
      const v1 = uniqueVertices[face[i]].clone().applyMatrix4(matrixWorld);
      const v2 = uniqueVertices[face[(i + 1) % face.length]].clone().applyMatrix4(matrixWorld);
      positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    }
  });
  
  if (positions.length === 0) {
    console.warn('Nenhuma face válida para exibir');
    return;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  
  const material = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
  faceLines = new THREE.LineSegments(geometry, material);
  scene.add(faceLines);
  console.log(`Exibindo ${faces.length} faces`);
}

// editMode.js - Funções para entrar/sair do modo edição e gerenciar submodos

function entrarModoEdicao() {
  if (!selectedObject) {
    console.warn('Nenhum objeto selecionado');
    return;
  }
  
  menu4_show();
  modes_edit();
  
  // Função auxiliar para encontrar a Mesh dentro do grupo/objeto selecionado
  function encontrarMesh(obj) {
    if (obj.isMesh && obj.geometry) {
      return obj;
    }
    for (let child of obj.children) {
      const mesh = encontrarMesh(child);
      if (mesh) return mesh;
    }
    return null;
  }
  
  let objetoComGeometria = encontrarMesh(selectedObject);
  
  if (!objetoComGeometria) {
    console.warn('Objeto selecionado não possui geometria (Mesh compatível)');
    return;
  }
  
  // Salva referências globais
  window.originalSelectedObject = selectedObject;
  window.editingMesh = objetoComGeometria;
  
  modoAtual = 'edicao';
  desativarGizmo();
  
  // --- CORREÇÃO DE GEOMETRIA ---
  let geometry = objetoComGeometria.geometry;
  
  // 1. Se for Geometria antiga (Three.js antigo), converte para BufferGeometry
  if (!geometry.isBufferGeometry && geometry.vertices) {
    console.log('Convertendo Geometry antiga para BufferGeometry...');
    // Nota: Em versões muito novas do Three.js, fromGeometry foi removido.
    // Se der erro aqui, significa que você só deve usar BufferGeometry desde a criação.
    try {
      const newGeo = new THREE.BufferGeometry();
      if (newGeo.fromGeometry) {
        objetoComGeometria.geometry = newGeo.fromGeometry(geometry);
      } else {
        // Fallback simples se fromGeometry não existir (versões r125+)
        // Assume que o usuário já deveria ter criado como BufferGeometry
        console.warn('Atenção: fromGeometry não existe. Certifique-se de criar o objeto como BufferGeometry.');
      }
      geometry = objetoComGeometria.geometry;
    } catch (e) {
      console.error('Erro na conversão de geometria:', e);
    }
  }
  
  // 2. Validação robusta do atributo position
  if (!geometry.attributes || !geometry.attributes.position) {
    console.error('ERRO: A geometria selecionada não possui atributo "position".', geometry);
    console.log('Tipo da geometria:', geometry.type);
    sairModoEdicao(); // Aborta para evitar crash
    return;
  }
  // -----------------------------
  
  try {
    // Chama sua função de merge (certifique-se que ela lida com índices se existirem)
    const merged = mergeVertices(geometry);
    
    // Validação do retorno do merge
    if (!merged || !merged.unique) {
      throw new Error("A função mergeVertices retornou dados inválidos.");
    }
    
    uniqueVertices = merged.unique;
    vertexMapping = merged.mapping;
    
    if (uniqueVertices.length === 0) {
      console.error('Falha ao mesclar vértices: 0 vértices encontrados');
      sairModoEdicao();
      return;
    }
    
    edges = detectEdges(geometry, vertexMapping);
    faces = detectFaces(geometry, vertexMapping);
    
    console.log('Modo edição ativado com sucesso:', {
      tipoGeometria: geometry.type,
      vertices: uniqueVertices.length,
      edges: edges.length,
      faces: faces.length
    });
    
    atualizarSubmodoEdicao();
    
  } catch (error) {
    console.error('Erro crítico ao entrar no modo edição:', error);
    sairModoEdicao();
  }
}

function sairModoEdicao() {
  modoAtual = 'normal';
  limparHelpersEdicao();
  limparLoopCutPreview();
  loopCutMode = false;
  
  menu4_none();
  modes_obj();
  menu6_none();
  menu5_none();
  
  if (window.originalSelectedObject) {
    selectedObject = window.originalSelectedObject;
    window.originalSelectedObject = null;
    window.editingMesh = null;
  }
  
  uniqueVertices = [];
  vertexMapping = {};
  edges = [];
  faces = [];
  
  ativarGizmo();
  console.log('Modo edição desativado');
}

function atualizarSubmodoEdicao() {
  limparHelpersEdicao();
  
  if (!window.editingMesh || uniqueVertices.length === 0) return;
  
  try {
    if (submodoEdicao === 'vertex') {
      mostrarVertices();
    } else if (submodoEdicao === 'edge') {
      mostrarEdges();
    } else if (submodoEdicao === 'face') {
      mostrarFaces();
    }
  } catch (error) {
    console.error('Erro ao atualizar submodo:', error);
  }
}

function limparHelpersEdicao() {
  // Helper para remover objetos de forma segura da memória e da cena
  const disposeObject = (obj) => {
    if (!obj) return;
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  };
  
  if (vertexInstancedMesh) {
    disposeObject(vertexInstancedMesh);
    vertexInstancedMesh = null;
  }
  if (edgeLines) {
    disposeObject(edgeLines);
    edgeLines = null;
  }
  if (edgeHighlight) {
    disposeObject(edgeHighlight);
    edgeHighlight = null;
  }
  if (faceLines) {
    disposeObject(faceLines);
    faceLines = null;
  }
  if (faceHighlight) {
    disposeObject(faceHighlight);
    faceHighlight = null;
  }
  if (editHelper) {
    scene.remove(editHelper);
    editHelper = null;
  }
  
  selectedVertices = [];
  selectedEdge = null;
  selectedFace = null;
  initialEditPosition = null;
  selectedUniqueIndices = [];
  initialVertexPositions = {};
  
  if (transformControls) {
    transformControls.detach();
  }
}

// editState.js - Variáveis de estado do sistema de edição

let modoAtual = 'normal';
let submodoEdicao = 'vertex';
let vertexInstancedMesh = null;
let edgeLines = null;
let edgeHighlight = null;
let faceLines = null;
let faceHighlight = null;
let selectedVertices = [];
let selectedEdge = null;
let selectedFace = null;
let vertexCount = 0;
let editHelper = null;
let uniqueVertices = [];
let vertexMapping = {};
let edges = [];
let faces = [];
let initialEditPosition = null;
let selectedUniqueIndices = [];
let initialVertexPositions = {};

// Variáveis para ferramentas
let loopCutMode = false;
let loopCutPreviewLine = null;
let loopCutCurrentLoop = null;
let extrusionAmount = 0.5;

// ==================================================================================
// editTools.js - ARQUIVO FINAL (CORREÇÃO DE SUBDIVISÃO + SOLDAGEM AUTOMÁTICA)
// ==================================================================================

// --- Variáveis Globais ---
const _tempVec = new THREE.Vector3();
const _tempVec2 = new THREE.Vector3();

// --- Variáveis do Loop Cut ---
const _lcRaycaster = new THREE.Raycaster();
const _lcMouse = new THREE.Vector2();

// Estado
let _lcActive = false;
let _lcPreviewMesh = null;
let _lcHoveredEdgeIdx = -1; 
let _lcRingEdges = [];
let _lcCutFactor = 0.5;

// Controle de Travamento
let _lcLockedFaceIdx = -1;
let _lcIsDragging = false; 

// Cache de vértices para performance
let _reverseIndexCache = null;
let _cachedPositionAttribute = null;

// ==================================================================================
// 1. SISTEMA DE PERFORMANCE & SHADING
// ==================================================================================

function invalidarCacheOtimizacao() {
    _reverseIndexCache = null;
    _cachedPositionAttribute = null;
}

function construirCacheIndices() {
    if (!window.editingMesh || !vertexMapping) return;
    const count = uniqueVertices.length;
    const tempCache = new Array(count).fill(null).map(() => []);
    for (let originalIdxStr in vertexMapping) {
        tempCache[vertexMapping[originalIdxStr]].push(parseInt(originalIdxStr));
    }
    _reverseIndexCache = tempCache.map(arr => new Int32Array(arr));
    _cachedPositionAttribute = window.editingMesh.geometry.attributes.position;
}

function atualizarPosicoesRapido() {
    if (!window.editingMesh) return;
    if (!_reverseIndexCache) construirCacheIndices();
    const posArray = _cachedPositionAttribute.array;
    const len = uniqueVertices.length;
    for (let i = 0; i < len; i++) {
        const indices = _reverseIndexCache[i];
        if (!indices) continue;
        const v = uniqueVertices[i];
        for (let j = 0; j < indices.length; j++) {
            const base = indices[j] * 3;
            posArray[base] = v.x; posArray[base+1] = v.y; posArray[base+2] = v.z;
        }
    }
    _cachedPositionAttribute.needsUpdate = true;
}

function atualizarNormais() {
    if (!window.editingMesh) return;
    
    const geo = window.editingMesh.geometry;
    const mat = window.editingMesh.material;

    geo.computeVertexNormals();

    // Se o material pede smooth shading, fazemos a fusão das normais
    if (mat && mat.flatShading === false) {
        const positions = geo.attributes.position.array;
        const normals = geo.attributes.normal.array;
        const count = positions.length / 3;
        const posMap = new Map();
        const precision = 10000; 

        for (let i = 0; i < count; i++) {
            const x = Math.round(positions[i * 3] * precision);
            const y = Math.round(positions[i * 3 + 1] * precision);
            const z = Math.round(positions[i * 3 + 2] * precision);
            const key = `${x}_${y}_${z}`;
            
            if (!posMap.has(key)) posMap.set(key, []);
            posMap.get(key).push(i);
        }

        posMap.forEach((indices) => {
            if (indices.length <= 1) return;
            let avgX = 0, avgY = 0, avgZ = 0;
            for (let idx of indices) {
                avgX += normals[idx * 3];
                avgY += normals[idx * 3 + 1];
                avgZ += normals[idx * 3 + 2];
            }
            const len = Math.sqrt(avgX*avgX + avgY*avgY + avgZ*avgZ);
            if (len > 0) {
                avgX /= len; avgY /= len; avgZ /= len;
            }
            for (let idx of indices) {
                normals[idx * 3] = avgX;
                normals[idx * 3 + 1] = avgY;
                normals[idx * 3 + 2] = avgZ;
            }
        });
    }
    geo.attributes.normal.needsUpdate = true;
}

// ==================================================================================
// 2. CONTROLES DA FERRAMENTA
// ==================================================================================

function ativarLoopCut() {
    if (modoAtual !== 'edicao') { alert("Entre no modo de edição!"); return; }

    _lcActive = true;
    _lcHoveredEdgeIdx = -1;
    _lcRingEdges = [];
    _lcLockedFaceIdx = -1;
    _lcIsDragging = false;

    if (typeof window.setOrbitControls === 'function') window.setOrbitControls(false);
    else if (window.controls) window.controls.enabled = false;
    if (window.transformControl) window.transformControl.detach();

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', _lcOnDown, { passive: false });
    canvas.addEventListener('pointermove', _lcOnMove, { passive: false });
    canvas.addEventListener('pointerup', _lcOnUp, { passive: false });
    canvas.addEventListener('touchstart', _lcOnDown, { passive: false });
    canvas.addEventListener('touchmove', _lcOnMove, { passive: false });
    canvas.addEventListener('touchend', _lcOnUp, { passive: false });

    console.log("🔪 Loop Cut Ativo.");
}

function desativarLoopCut() {
    _lcActive = false;
    limparLoopCutPreview();

    const canvas = renderer.domElement;
    canvas.removeEventListener('pointerdown', _lcOnDown);
    canvas.removeEventListener('pointermove', _lcOnMove);
    canvas.removeEventListener('pointerup', _lcOnUp);
    canvas.removeEventListener('touchstart', _lcOnDown);
    canvas.removeEventListener('touchmove', _lcOnMove);
    canvas.removeEventListener('touchend', _lcOnUp);

    if (typeof window.setOrbitControls === 'function') window.setOrbitControls(true);
    else if (window.controls) window.controls.enabled = true;
}

// ==================================================================================
// 3. INTERAÇÃO (3D PICKING + 2D SLIDE)
// ==================================================================================

function _lcOnDown(event) {
    if (!_lcActive) return;
    
    let cx = event.clientX;
    let cy = event.clientY;
    if (event.touches && event.touches.length > 0) {
        cx = event.touches[0].clientX;
        cy = event.touches[0].clientY;
    }

    _lcLockedFaceIdx = -1;
    _lcIsDragging = false;
    limparLoopCutPreview();

    const rect = renderer.domElement.getBoundingClientRect();
    _lcMouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
    _lcMouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
    
    _lcRaycaster.setFromCamera(_lcMouse, camera);
    _lcRaycaster.params.Line.threshold = 0.1;
    
    let oldSide = THREE.FrontSide;
    if(window.editingMesh.material) {
        oldSide = window.editingMesh.material.side;
        window.editingMesh.material.side = THREE.DoubleSide; 
    }

    const intersects = _lcRaycaster.intersectObject(window.editingMesh);
    
    if(window.editingMesh.material) {
        window.editingMesh.material.side = oldSide; 
    }

    if (intersects.length > 0) {
        const hit = intersects[0];
        if (faces[hit.faceIndex]) {
            _lcLockedFaceIdx = hit.faceIndex;
            _lcSelecionarArestaPorPonto3D(hit);
            _lcIsDragging = true;
        }
    }
}

function _lcOnMove(event) {
    if (!_lcActive) return;
    event.preventDefault(); event.stopPropagation();

    if (!_lcIsDragging || _lcLockedFaceIdx === -1 || _lcHoveredEdgeIdx === -1) return;

    let cx = event.clientX;
    let cy = event.clientY;
    if (event.touches && event.touches.length > 0) {
        cx = event.touches[0].clientX;
        cy = event.touches[0].clientY;
    }

    _lcAtualizarFatorSlide(cx, cy);
    _lcDesenharPreview();
}

function _lcOnUp(event) {
    if (!_lcActive) return;
    event.preventDefault(); event.stopPropagation();

    if (_lcHoveredEdgeIdx !== -1 && _lcRingEdges.length > 0) {
        _lcAplicarCorte();
    }
    
    _lcIsDragging = false;
    _lcLockedFaceIdx = -1;
    _lcHoveredEdgeIdx = -1;
    limparLoopCutPreview();
    desativarLoopCut(); 
}

// ==================================================================================
// 4. LÓGICA DO LOOP CUT
// ==================================================================================

function _lcSelecionarArestaPorPonto3D(hit) {
    const face = faces[hit.faceIndex];
    const point3D = hit.point; 
    const matrixWorld = window.editingMesh.matrixWorld;

    let closestDist = Infinity;
    let bestEdgeIdx = -1;

    for (let i = 0; i < face.length; i++) {
        const vA = face[i];
        const vB = face[(i + 1) % face.length];
        
        const eIdx = edges.findIndex(e => (e[0]===vA && e[1]===vB) || (e[0]===vB && e[1]===vA));
        if (eIdx === -1) continue;

        _tempVec.copy(uniqueVertices[vA]).applyMatrix4(matrixWorld);
        _tempVec2.copy(uniqueVertices[vB]).applyMatrix4(matrixWorld);

        const dist = _distToSegment3D(point3D, _tempVec, _tempVec2);

        if (dist < closestDist) {
            closestDist = dist;
            bestEdgeIdx = eIdx;
        }
    }

    if (bestEdgeIdx !== -1) {
        _lcHoveredEdgeIdx = bestEdgeIdx;
        _lcRingEdges = _lcCalcularAnel(bestEdgeIdx);
        
        const v1 = uniqueVertices[edges[bestEdgeIdx][0]].clone().applyMatrix4(matrixWorld);
        const v2 = uniqueVertices[edges[bestEdgeIdx][1]].clone().applyMatrix4(matrixWorld);
        const t = _projectPointOnSegment(point3D, v1, v2);
        _lcCutFactor = t;
    }
}

function _lcAtualizarFatorSlide(mouseX, mouseY) {
    if (_lcHoveredEdgeIdx === -1) return;
    const e = edges[_lcHoveredEdgeIdx];
    if (!e) return;

    const sA = _toScreen(uniqueVertices[e[0]]);
    const sB = _toScreen(uniqueVertices[e[1]]);

    const dx = sB.x - sA.x;
    const dy = sB.y - sA.y;
    const lenSq = dx*dx + dy*dy;

    if (lenSq > 0.001) {
        const mx = mouseX - sA.x;
        const my = mouseY - sA.y;
        let t = (mx*dx + my*dy) / lenSq;
        t = Math.max(0.01, Math.min(0.99, t));
        if (Math.abs(t - 0.5) < 0.05) t = 0.5;
        _lcCutFactor = t;
    }
}

function _distToSegment3D(p, v, w) {
    const l2 = v.distanceToSquared(w);
    if (l2 === 0) return p.distanceTo(v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y) + (p.z - v.z) * (w.z - v.z)) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = v.x + t * (w.x - v.x);
    const py = v.y + t * (w.y - v.y);
    const pz = v.z + t * (w.z - v.z);
    return Math.sqrt((p.x - px)**2 + (p.y - py)**2 + (p.z - pz)**2);
}

function _projectPointOnSegment(p, v, w) {
    const l2 = v.distanceToSquared(w);
    if (l2 === 0) return 0.5;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y) + (p.z - v.z) * (w.z - v.z)) / l2;
    return Math.max(0.01, Math.min(0.99, t));
}

function _toScreen(v3) {
    const v = v3.clone().applyMatrix4(window.editingMesh.matrixWorld);
    v.project(camera);
    const canvas = renderer.domElement;
    return {
        x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
        y: (-(v.y * 0.5) + 0.5) * canvas.clientHeight
    };
}

function _lcCalcularAnel(startEdgeIdx) {
    const ring = new Set([startEdgeIdx]);
    const queue = [startEdgeIdx];
    let safe = 0;

    while (queue.length > 0 && safe < 3000) {
        safe++;
        const currIdx = queue.pop();
        const currEdge = edges[currIdx];
        if (!currEdge) continue;

        const connectedFaces = faces.filter(f => f && f.includes(currEdge[0]) && f.includes(currEdge[1]));
        
        connectedFaces.forEach(face => {
            if (face.length !== 4) return;

            const v1 = currEdge[0];
            const v2 = currEdge[1];
            const otherVerts = face.filter(v => v !== v1 && v !== v2);
            
            if (otherVerts.length === 2) {
                const ov1 = otherVerts[0];
                const ov2 = otherVerts[1];
                const oppIdx = edges.findIndex(e => (e[0]===ov1 && e[1]===ov2) || (e[0]===ov2 && e[1]===ov1));
                
                if (oppIdx !== -1 && !ring.has(oppIdx)) {
                    ring.add(oppIdx);
                    queue.push(oppIdx);
                }
            }
        });
    }
    return Array.from(ring);
}

function _lcDesenharPreview() {
    limparLoopCutPreview();
    if (_lcRingEdges.length === 0 || _lcHoveredEdgeIdx === -1) return;

    const positions = [];
    const matWorld = window.editingMesh.matrixWorld;

    const baseEdge = edges[_lcHoveredEdgeIdx];
    if (!baseEdge) return;

    const vBase1 = uniqueVertices[baseEdge[0]].clone().applyMatrix4(matWorld);
    const vBase2 = uniqueVertices[baseEdge[1]].clone().applyMatrix4(matWorld);
    const vecBase = new THREE.Vector3().subVectors(vBase2, vBase1).normalize();

    const points = [];
    _lcRingEdges.forEach(eIdx => {
        const e = edges[eIdx];
        if (!e) return;

        const v1 = uniqueVertices[e[0]];
        const v2 = uniqueVertices[e[1]];
        
        const p1World = v1.clone().applyMatrix4(matWorld);
        const p2World = v2.clone().applyMatrix4(matWorld);
        const dirWorld = new THREE.Vector3().subVectors(p2World, p1World).normalize();

        const dot = vecBase.dot(dirWorld);
        const t = (dot >= 0) ? _lcCutFactor : (1.0 - _lcCutFactor);

        const p = new THREE.Vector3().lerpVectors(v1, v2, t);
        p.applyMatrix4(matWorld);
        points.push({ pos: p, edgeIdx: eIdx });
    });

    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const pA = points[i]; const pB = points[j];
            const eA = edges[pA.edgeIdx]; const eB = edges[pB.edgeIdx];
            if (!eA || !eB) continue;

            const commonFace = faces.find(f => f && f.includes(eA[0]) && f.includes(eA[1]) && f.includes(eB[0]) && f.includes(eB[1]));
            if (commonFace) {
                positions.push(pA.pos.x, pA.pos.y, pA.pos.z);
                positions.push(pB.pos.x, pB.pos.y, pB.pos.z);
            }
        }
    }

    if(positions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false, linewidth: 3 });
        _lcPreviewMesh = new THREE.LineSegments(geo, mat);
        _lcPreviewMesh.renderOrder = 9999; 
        scene.add(_lcPreviewMesh);
    }
}

function limparLoopCutPreview() {
    if (_lcPreviewMesh) {
        scene.remove(_lcPreviewMesh);
        _lcPreviewMesh.geometry.dispose();
        _lcPreviewMesh.material.dispose();
        _lcPreviewMesh = null;
    }
}

function _lcAplicarCorte() {
    if (_lcRingEdges.length === 0) return;
    const edgeToNewIdx = new Map();
    const matWorld = window.editingMesh.matrixWorld;

    const baseEdge = edges[_lcHoveredEdgeIdx];
    if (!baseEdge) return;

    const vB1 = uniqueVertices[baseEdge[0]].clone().applyMatrix4(matWorld);
    const vB2 = uniqueVertices[baseEdge[1]].clone().applyMatrix4(matWorld);
    const dirBase = new THREE.Vector3().subVectors(vB2, vB1).normalize();

    _lcRingEdges.forEach(eIdx => {
        const e = edges[eIdx];
        if (!e) return;

        const v1 = uniqueVertices[e[0]];
        const v2 = uniqueVertices[e[1]];
        
        const p1World = v1.clone().applyMatrix4(matWorld);
        const p2World = v2.clone().applyMatrix4(matWorld);
        const dirCurr = new THREE.Vector3().subVectors(p2World, p1World).normalize();

        const dot = dirBase.dot(dirCurr);
        const t = (dot >= 0) ? _lcCutFactor : (1.0 - _lcCutFactor);

        const newPos = new THREE.Vector3().lerpVectors(v1, v2, t);
        const newIdx = uniqueVertices.length;
        uniqueVertices.push(newPos);
        edgeToNewIdx.set(eIdx, newIdx);
    });

    const newFaces = [];
    faces.forEach(face => {
        if (!face) return; 
        const cuts = [];
        for (let i = 0; i < face.length; i++) {
            const vA = face[i];
            const vB = face[(i+1)%face.length];
            const eIdx = _lcRingEdges.find(rid => {
                const e = edges[rid];
                return e && ((e[0]===vA && e[1]===vB) || (e[0]===vB && e[1]===vA));
            });
            if (eIdx !== undefined) cuts.push({ pos: i, newIdx: edgeToNewIdx.get(eIdx) });
        }

        if (cuts.length === 2) {
            cuts.sort((a, b) => a.pos - b.pos);
            const c1 = cuts[0]; const c2 = cuts[1];
            const f1 = [c1.newIdx];
            for (let k = (c1.pos + 1) % face.length; k !== (c2.pos + 1) % face.length; k = (k+1)%face.length) f1.push(face[k]);
            f1.push(c2.newIdx);
            const f2 = [c2.newIdx];
            for (let k = (c2.pos + 1) % face.length; k !== (c1.pos + 1) % face.length; k = (k+1)%face.length) f2.push(face[k]);
            f2.push(c1.newIdx);
            newFaces.push(f1, f2);
        } else {
            newFaces.push(face);
        }
    });

    faces = newFaces;
    invalidarCacheOtimizacao();
    reconstruirGeometria();
    atualizarNormais(); 
    console.log("Corte Aplicado.");
}

// ==================================================================================
// 5. NOVA FUNÇÃO DE SOLDAGEM (CRUCIAL PARA CORRIGIR MODELOS EXPLODIDOS)
// ==================================================================================

function soldarVertices() {
    if (!window.editingMesh) return;
    
    const newUniqueVertices = [];
    const posMap = new Map(); // "x_y_z" -> newIndex
    const oldToNewIndex = new Array(uniqueVertices.length);
    const precision = 10000;

    // 1. Identificar duplicatas e criar nova lista de vértices limpa
    for (let i = 0; i < uniqueVertices.length; i++) {
        const v = uniqueVertices[i];
        const key = `${Math.round(v.x * precision)}_${Math.round(v.y * precision)}_${Math.round(v.z * precision)}`;
        
        if (posMap.has(key)) {
            oldToNewIndex[i] = posMap.get(key);
        } else {
            const newIdx = newUniqueVertices.length;
            newUniqueVertices.push(v);
            posMap.set(key, newIdx);
            oldToNewIndex[i] = newIdx;
        }
    }

    // 2. Remapear faces
    const newFaces = [];
    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        const newFace = [];
        for (let j = 0; j < face.length; j++) {
            newFace.push(oldToNewIndex[face[j]]);
        }
        // Remove faces degeneradas (onde vértices colapsaram)
        // (Opcional, mas bom para limpeza: se a face virou uma linha ou ponto)
        const uniqueIndices = [...new Set(newFace)];
        if (uniqueIndices.length >= 3) {
            newFaces.push(newFace);
        }
    }

    // 3. Atualizar Estado Global
    uniqueVertices.splice(0, uniqueVertices.length, ...newUniqueVertices);
    faces.splice(0, faces.length, ...newFaces);
    
    // 4. Recalcular Arestas (Edges) Globalmente
    // Isso é vital porque as arestas antigas apontavam para índices velhos
    edges.length = 0; // Limpa array existente
    const edgeSet = new Set();
    
    for (const face of faces) {
        for (let i = 0; i < face.length; i++) {
            const a = face[i];
            const b = face[(i + 1) % face.length];
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edges.push([a, b]);
            }
        }
    }

    console.log(`Soldagem concluída: ${uniqueVertices.length} vértices únicos.`);
    invalidarCacheOtimizacao();
    reconstruirGeometria();
}

// ==================================================================================
// 6. OUTRAS FERRAMENTAS (AGORA MAIS ROBUSTAS)
// ==================================================================================

function aplicarSmooth(iterations=1, factor=0.5) {
    if(modoAtual!=='edicao') return;
    const len=uniqueVertices.length;
    const adj=Array(len).fill(null).map(()=>[]);
    edges.forEach(e=>{ if(e && e[0]<len && e[1]<len){ adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); } });
    for(let k=0; k<iterations; k++){
        const oldV = uniqueVertices.map(v=>v.clone());
        for(let i=0; i<len; i++){
            const n=adj[i];
            if(n.length>0){
                let sx=0, sy=0, sz=0;
                n.forEach(idx=>{ sx+=oldV[idx].x; sy+=oldV[idx].y; sz+=oldV[idx].z; });
                const inv=1/n.length;
                uniqueVertices[i].x += (sx*inv - oldV[i].x)*factor;
                uniqueVertices[i].y += (sy*inv - oldV[i].y)*factor;
                uniqueVertices[i].z += (sz*inv - oldV[i].z)*factor;
            }
        }
    }
    atualizarPosicoesRapido();
    atualizarNormais();
}

function extrudirFace(amount=0.5) {
    if(modoAtual!=='edicao' || selectedFace===null || !faces[selectedFace]) return;
    const face = faces[selectedFace];
    const v1=uniqueVertices[face[0]], v2=uniqueVertices[face[1]], v3=uniqueVertices[face[2]];
    const n = new THREE.Vector3().subVectors(v2,v1).cross(new THREE.Vector3().subVectors(v3,v1)).normalize();
    const newIndices = [];
    face.forEach(idx => {
        const v = uniqueVertices[idx];
        const nv = v.clone().addScaledVector(n, amount);
        uniqueVertices.push(nv);
        newIndices.push(uniqueVertices.length-1);
    });
    const sides = [];
    for(let i=0; i<face.length; i++){
        sides.push([face[i], face[(i+1)%face.length], newIndices[(i+1)%face.length], newIndices[i]]);
    }
    faces.splice(selectedFace, 1);
    faces.push(newIndices, ...sides);
    invalidarCacheOtimizacao();
    reconstruirGeometria();
    selectedFace = faces.length - 1 - sides.length; 
    selecionarFace(selectedFace);
    atualizarNormais();
}

function extrudirAresta(amount=0.5) {
    if(modoAtual!=='edicao' || selectedEdge===null || !edges[selectedEdge]) return;
    const e = edges[selectedEdge];
    const v1=uniqueVertices[e[0]], v2=uniqueVertices[e[1]];
    const dir = new THREE.Vector3(0,1,0); 
    const nv1 = v1.clone().addScaledVector(dir, amount);
    const nv2 = v2.clone().addScaledVector(dir, amount);
    const i1 = uniqueVertices.length, i2 = i1+1;
    uniqueVertices.push(nv1, nv2);
    faces.push([e[0], i1, i2, e[1]]);
    edges.push([i1, i2]);
    invalidarCacheOtimizacao();
    reconstruirGeometria();
    atualizarNormais();
}

// CORREÇÃO FINAL PARA SUBDIVISÃO EM MODELOS IMPORTADOS
function aplicarSubdivision() {
    if(modoAtual!=='edicao') return;

    // PASSO 1: SOLDAR VÉRTICES (Conserta a "explosão" da imagem)
    // Isso garante que arestas compartilhadas sejam realmente compartilhadas
    soldarVertices();

    // PASSO 2: Calcular subdivisão limpa
    const edgeKey = (a,b) => a<b ? `${a}_${b}` : `${b}_${a}`;
    const edgeMap = new Map();
    
    // Mapeia arestas para novos índices de ponto médio
    edges.forEach((e,i) => { if(e) edgeMap.set(edgeKey(e[0],e[1]), i) });

    // Centróides das faces (novos vértices)
    const faceCentroids = faces.map(f => {
        if(!f) return new THREE.Vector3();
        const c = new THREE.Vector3();
        f.forEach(i => c.add(uniqueVertices[i]));
        return c.divideScalar(f.length);
    });
    const fOff = uniqueVertices.length;
    uniqueVertices.push(...faceCentroids);

    // Pontos médios das arestas (novos vértices)
    const edgeMids = edges.map(e => {
        if(!e) return new THREE.Vector3();
        return new THREE.Vector3().addVectors(uniqueVertices[e[0]], uniqueVertices[e[1]]).multiplyScalar(0.5);
    });
    const eOff = uniqueVertices.length;
    uniqueVertices.push(...edgeMids);

    // Reconstrução das faces (Catmull-Clark style linear)
    const newFaces = [];
    faces.forEach((f, fi) => {
        if(!f) return;
        for(let i=0; i<f.length; i++){
            const v = f[i];
            const prev = f[(i+f.length-1)%f.length];
            const next = f[(i+1)%f.length];
            
            const eIdx = edgeMap.get(edgeKey(v,next));
            const pIdx = edgeMap.get(edgeKey(prev,v));
            
            // Verifica se a topologia está consistente
            if (eIdx !== undefined && pIdx !== undefined) {
                newFaces.push([v, eOff+eIdx, fOff+fi, eOff+pIdx]);
            }
        }
    });

    faces = newFaces;
    
    // Atualiza lista de arestas globalmente após a subdivisão
    // (Pois a topologia mudou completamente)
    soldarVertices(); // Chama de novo apenas para reconstruir edges[] limpo
    
    invalidarCacheOtimizacao();
    reconstruirGeometria();
    atualizarNormais();
}

function inverterFace() {
    if (selectedFace !== null && faces[selectedFace]) {
        faces[selectedFace].reverse();
        reconstruirGeometria();
        atualizarNormais();
    }
}
function eferaadd() {
    if (typeof createEditableSphereBuffer === 'function') createEditableSphereBuffer();
}

// events.js - Event handlers para mouse e botões

// Variável para armazenar o helper visual (Outline Amarelo)
let selectionHelper = null;

function onPointerDown(event) {
    pointerDownTime = Date.now();
    pointerDownPos.x = event.clientX;
    pointerDownPos.y = event.clientY;
}

function onPointerMove(event) {
    if (loopCutMode && modoAtual === 'edicao') {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(window.editingMesh, true);
        
        if (intersects.length > 0) {
            const loopEdges = detectarLoopAPartirDePonto(intersects[0].point);
            if (loopEdges && loopEdges.length > 0) {
                loopCutCurrentLoop = loopEdges;
                mostrarLoopCutPreview(loopEdges);
            }
        }
    }
}

// Função auxiliar para gerenciar o Outline Amarelo
function atualizarOutline(objeto) {
    // Remove o outline anterior se existir
    if (selectionHelper) {
        scene.remove(selectionHelper);
        selectionHelper = null;
    }
    
    // Se houver um objeto selecionado, cria o novo outline
    if (objeto) {
        // BoxHelper cria uma caixa delimitadora visual (wireframe) ao redor do objeto
        selectionHelper = new THREE.BoxHelper(objeto, 0xffff00); // 0xffff00 é Amarelo
        scene.add(selectionHelper);
    }
}

function selectObject(event) {
    if (loopCutMode && loopCutCurrentLoop) {
        aplicarLoopCut();
        return;
    }
    
    const timeDiff = Date.now() - pointerDownTime;
    const moveDist = Math.sqrt(
        Math.pow(event.clientX - pointerDownPos.x, 2) +
        Math.pow(event.clientY - pointerDownPos.y, 2)
    );
    
    if (moveDist > 5 || timeDiff > 200) {
        return;
    }
    
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    if (modoAtual === 'edicao') {
        try {
            if (submodoEdicao === 'vertex' && vertexInstancedMesh) {
                raycaster.params.Points.threshold = 0.2;
                const intersects = raycaster.intersectObject(vertexInstancedMesh, false);
                if (intersects.length > 0) {
                    selecionarVertice(intersects[0].instanceId);
                }
            } else if (submodoEdicao === 'edge') {
                const intersects = raycaster.intersectObject(window.editingMesh, true);
                if (intersects.length > 0) {
                    const edgeIndex = encontrarArestaMaisProxima(intersects[0].point);
                    if (edgeIndex !== null) {
                        selecionarAresta(edgeIndex);
                    }
                }
            } else if (submodoEdicao === 'face') {
                const intersects = raycaster.intersectObject(window.editingMesh, true);
                if (intersects.length > 0) {
                    const faceIndex = encontrarFaceMaisProxima(intersects[0].point);
                    if (faceIndex !== null) {
                        selecionarFace(faceIndex);
                    }
                }
            }
        } catch (error) {
            console.error('Erro ao selecionar no modo edição:', error);
        }
        // No modo edição, geralmente não queremos o outline de objeto inteiro, mas se quiser, mantenha a lógica abaixo
        return;
    }
    
    // Modo normal
    const intersects = raycaster.intersectObjects(selectableObjects, true);
    
    if (intersects.length > 0) {
        let targetObject = intersects[0].object;
        
        while (targetObject && !selectableObjects.includes(targetObject)) {
            targetObject = targetObject.parent;
        }
        
        if (targetObject && selectableObjects.includes(targetObject)) {
            selectedObject = targetObject;
            
            // ATUALIZA O OUTLINE AMARELO
            atualizarOutline(selectedObject);
            
            if (gizmoAtivo) {
                transformControls.detach();
                transformControls.attach(selectedObject);
            }
        }
    } else {
        selectedObject = null;
        
        // REMOVE O OUTLINE SE CLICAR NO VAZIO
        atualizarOutline(null);
        
        transformControls.detach();
    }
}

// Registra event listeners
renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
renderer.domElement.addEventListener('pointermove', onPointerMove, false);
renderer.domElement.addEventListener('pointerup', selectObject, false);

// Garante que o outline acompanhe o objeto quando movido pelo Gizmo
if (transformControls) {
    transformControls.addEventListener('change', () => {
        if (selectionHelper) selectionHelper.update();
    });
}

// ========== BOTÕES DE CONTROLE ==========

// Botões do Gizmo
const btnMov = document.getElementById('mov');
const btnScl = document.getElementById('scl');
const btnRot = document.getElementById('rot');
const btnDesativ = document.getElementById('desativ');
const btnAtiv = document.getElementById('ativ');

if (btnMov) btnMov.addEventListener('click', () => setModoGizmo('translate'));
if (btnScl) btnScl.addEventListener('click', () => setModoGizmo('scale'));
if (btnRot) btnRot.addEventListener('click', () => setModoGizmo('rotate'));
if (btnDesativ) btnDesativ.addEventListener('click', () => desativarGizmo());
if (btnAtiv) btnAtiv.addEventListener('click', () => ativarGizmo());

// Botões de Modo
const btnNormal = document.getElementById('normal');
const btnEdicao = document.getElementById('edição');

if (btnNormal) {
    btnNormal.addEventListener('click', () => {
        sairModoEdicao();
        // Reabilita o outline do objeto selecionado ao voltar para modo normal
        if (selectedObject) atualizarOutline(selectedObject);
    });
}
if (btnEdicao) {
    btnEdicao.addEventListener('click', () => {
        entrarModoEdicao();
        // Remove o outline do objeto ao entrar em modo edição para não atrapalhar
        atualizarOutline(null);
    });
}

// Botões de Submodo
const btnVertices = document.getElementById('vertices');
const btnEdges = document.getElementById('edges');
const btnFaces = document.getElementById('faces');

if (btnVertices) {
    btnVertices.addEventListener('click', () => {
        if (modoAtual === 'edicao') {
            submodoEdicao = 'vertex';
            atualizarSubmodoEdicao();
            menu5_none();
            menu6_none();
        }
    });
}

if (btnEdges) {
    btnEdges.addEventListener('click', () => {
        if (modoAtual === 'edicao') {
            submodoEdicao = 'edge';
            atualizarSubmodoEdicao();
            menu5_none();
            menu6_show();
        }
    });
}

if (btnFaces) {
    btnFaces.addEventListener('click', () => {
        if (modoAtual === 'edicao') {
            submodoEdicao = 'face';
            atualizarSubmodoEdicao();
            menu5_show();
            menu6_none();
        }
    });
}

// ========== BOTÕES DE FERRAMENTAS ==========

const btnLoopCut = document.getElementById('loopcut');
const btnLineCut = document.getElementById('linecut');
const btnSmooth = document.getElementById('smoth');
const btnExtrudFace = document.getElementById('extrudFace');
const btnExtrudEdge = document.getElementById('extrudedge');
const btnInvertFace = document.getElementById('invertFace');
const btnSubdivision = document.getElementById('subdivision');

if (btnLoopCut) {
    btnLoopCut.addEventListener('click', () => {
        if (loopCutMode) {
            loopCutMode = false;
            limparLoopCutPreview();
            controls.enabled = true;
            console.log('Modo Loop Cut cancelado');
        } else {
            ativarLoopCut();
        }
    });
}

if (btnLineCut) {
    btnLineCut.addEventListener('click', () => {
        if (loopCutMode) {
            loopCutMode = false;
            limparLoopCutPreview();
            controls.enabled = true;
            console.log('Modo Loop Cut cancelado');
        } else {
            ativarLoopCut();
        }
    });
}

if (btnSmooth) btnSmooth.addEventListener('click', () => aplicarSmooth(2, 0.5));
if (btnExtrudFace) btnExtrudFace.addEventListener('click', () => extrudirFace(0.01));
if (btnExtrudEdge) btnExtrudEdge.addEventListener('click', () => extrudirAresta(0.01));
if (btnInvertFace) btnInvertFace.addEventListener('click', () => inverterFace());
if (btnSubdivision) btnSubdivision.addEventListener('click', () => aplicarSubdivision());

// ========== FUNÇÕES DE CRIAÇÃO (integração com UI) ==========

function make_box(param) {
    createBox();
}

function make_plan(param) {
    createPlane();
}

// geometryUtils.js - Funções utilitárias para manipulação de geometria

// Converte geometria para BufferGeometry indexada
function garantirGeometriaIndexada(geometry) {
    if (geometry.index !== null) {
        return geometry;
    }
    
    const positions = geometry.attributes.position.array;
    const vertexCount = positions.length / 3;
    
    const indices = [];
    for (let i = 0; i < vertexCount; i++) {
        indices.push(i);
    }
    
    geometry.setIndex(indices);
    return geometry;
}

// Mescla vértices duplicados
function mergeVertices(geometry, tolerance = 0.0001) {
    garantirGeometriaIndexada(geometry);
    
    const positions = geometry.attributes.position.array;
    const vertexCount = positions.length / 3;
    
    if (vertexCount === 0) {
        console.warn('Geometria sem vértices');
        return { unique: [], mapping: {} };
    }
    
    const unique = [];
    const mapping = {};
    const vertexMap = new Map();
    
    for (let i = 0; i < vertexCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            console.warn(`Vértice ${i} possui valores inválidos`);
            continue;
        }
        
        const key = `${Math.round(x / tolerance)}_${Math.round(y / tolerance)}_${Math.round(z / tolerance)}`;
        
        if (vertexMap.has(key)) {
            mapping[i] = vertexMap.get(key);
        } else {
            const uniqueIndex = unique.length;
            unique.push(new THREE.Vector3(x, y, z));
            vertexMap.set(key, uniqueIndex);
            mapping[i] = uniqueIndex;
        }
    }
    
    console.log(`Vértices mesclados: ${vertexCount} -> ${unique.length}`);
    return { unique, mapping };
}

// Detecta arestas únicas
function detectEdges(geometry, vertexMapping) {
    const index = geometry.index;
    const edgeSet = new Set();
    const edgeArray = [];
    
    if (!index) {
        console.warn('Geometria não indexada para detecção de arestas');
        return [];
    }
    
    const indices = index.array;
    const faceCount = indices.length / 3;
    
    for (let i = 0; i < faceCount; i++) {
        const faceIndices = [
            vertexMapping[indices[i * 3]] ?? indices[i * 3],
            vertexMapping[indices[i * 3 + 1]] ?? indices[i * 3 + 1],
            vertexMapping[indices[i * 3 + 2]] ?? indices[i * 3 + 2]
        ];
        
        if (faceIndices.some(idx => idx === undefined || idx === null)) {
            continue;
        }
        
        for (let j = 0; j < 3; j++) {
            const a = faceIndices[j];
            const b = faceIndices[(j + 1) % 3];
            const key = a < b ? `${a}-${b}` : `${b}-${a}`;
            
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edgeArray.push([a, b]);
            }
        }
    }
    
    console.log(`Arestas detectadas: ${edgeArray.length}`);
    return edgeArray;
}

// Detecta faces
function detectFaces(geometry, vertexMapping) {
    const index = geometry.index;
    
    if (!index) {
        console.warn('Geometria não indexada para detecção de faces');
        return [];
    }
    
    const indices = index.array;
    const faceCount = indices.length / 3;
    const triangles = [];
    
    for (let i = 0; i < faceCount; i++) {
        const face = [
            vertexMapping[indices[i * 3]] ?? indices[i * 3],
            vertexMapping[indices[i * 3 + 1]] ?? indices[i * 3 + 1],
            vertexMapping[indices[i * 3 + 2]] ?? indices[i * 3 + 2]
        ];
        
        if (face.every(idx => idx !== undefined && idx !== null)) {
            triangles.push(face);
        }
    }
    
    const quads = [];
    const usedTriangles = new Set();
    
    for (let i = 0; i < triangles.length; i++) {
        if (usedTriangles.has(i)) continue;
        
        const tri1 = triangles[i];
        let foundQuad = false;
        
        for (let j = i + 1; j < triangles.length; j++) {
            if (usedTriangles.has(j)) continue;
            
            const tri2 = triangles[j];
            const shared = tri1.filter(v => tri2.includes(v));
            
            if (shared.length === 2) {
                const unique1 = tri1.find(v => !shared.includes(v));
                const unique2 = tri2.find(v => !shared.includes(v));
                
                quads.push([shared[0], unique1, shared[1], unique2]);
                usedTriangles.add(i);
                usedTriangles.add(j);
                foundQuad = true;
                break;
            }
        }
        
        if (!foundQuad) {
            quads.push(tri1);
        }
    }
    
    console.log(`Faces detectadas: ${quads.length} (${triangles.length} triângulos originais)`);
    return quads;
}

// Reconstrói geometria a partir de faces
function reconstruirGeometria() {
    const finalPositions = [];
    faces.forEach(face => {
        if (face.length === 3) {
            face.forEach(vIdx => {
                if (uniqueVertices[vIdx]) {
                    const v = uniqueVertices[vIdx];
                    finalPositions.push(v.x, v.y, v.z);
                }
            });
        } else if (face.length === 4) {
            [0, 1, 2, 0, 2, 3].forEach(i => {
                const vIdx = face[i];
                if (uniqueVertices[vIdx]) {
                    const v = uniqueVertices[vIdx];
                    finalPositions.push(v.x, v.y, v.z);
                }
            });
        }
    });
    
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
    newGeometry.computeVertexNormals();
    
    window.editingMesh.geometry.dispose();
    window.editingMesh.geometry = newGeometry;
    
    // Reinicializa
    const merged = mergeVertices(newGeometry);
    uniqueVertices = merged.unique;
    vertexMapping = merged.mapping;
    edges = detectEdges(newGeometry, vertexMapping);
    faces = detectFaces(newGeometry, vertexMapping);
    
    atualizarSubmodoEdicao();
}

// gizmo.js - Funções de controle do gizmo

function desativarGizmo() {
  gizmoAtivo = false;
  transformControls.detach();
}

function ativarGizmo() {
  gizmoAtivo = true;
  if (selectedObject) {
    transformControls.attach(selectedObject);
  }
}

function setModoGizmo(modo) {
  if (['translate', 'rotate', 'scale'].includes(modo)) {
    transformControls.setMode(modo);
  }
}

function alternarModoGizmo() {
  const modos = ['translate', 'rotate', 'scale'];
  const modoAtual = transformControls.mode;
  const indexAtual = modos.indexOf(modoAtual);
  const proximoIndex = (indexAtual + 1) % modos.length;
  transformControls.setMode(modos[proximoIndex]);
  return modos[proximoIndex];
}

function getModoGizmo() {
  return transformControls.mode;
}


// selection.js - Funções para encontrar e selecionar vértices, arestas e faces

function encontrarArestaMaisProxima(point) {
    const matrixWorld = window.editingMesh.matrixWorld;
    let minDist = Infinity;
    let closestEdge = null;
    
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
        if (dist < minDist && dist < 0.3) {
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
        
        const center = new THREE.Vector3();
        faceVertices.forEach(v => center.add(v));
        center.divideScalar(faceVertices.length);
        
        const dist = point.distanceTo(center);
        if (dist < minDist) {
            minDist = dist;
            closestFace = index;
        }
    });
    
    return closestFace;
}

function selecionarVertice(instanceId) {
    if (!uniqueVertices[instanceId]) {
        console.warn(`Vértice ${instanceId} não existe`);
        return;
    }
    
    if (selectedVertices.length > 0 && vertexInstancedMesh) {
        vertexInstancedMesh.setColorAt(selectedVertices[0], new THREE.Color(0x000000));
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

function selecionarAresta(edgeIndex) {
    const edge = edges[edgeIndex];
    
    if (!uniqueVertices[edge[0]] || !uniqueVertices[edge[1]]) {
        console.warn(`Aresta ${edgeIndex} possui vértices inválidos`);
        return;
    }
    
    if (edgeHighlight) {
        scene.remove(edgeHighlight);
        edgeHighlight.geometry.dispose();
        edgeHighlight.material.dispose();
    }
    
    selectedEdge = edgeIndex;
    const matrixWorld = window.editingMesh.matrixWorld;
    
    const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
    const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        v1.x, v1.y, v1.z, v2.x, v2.y, v2.z
    ], 3));
    
    const material = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 3 });
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

function selecionarFace(faceIndex) {
    const face = faces[faceIndex];
    
    const validFace = face.every(v => uniqueVertices[v] !== undefined);
    if (!validFace) {
        console.warn(`Face ${faceIndex} possui vértices inválidos`);
        return;
    }
    
    if (faceHighlight) {
        scene.remove(faceHighlight);
        faceHighlight.geometry.dispose();
        faceHighlight.material.dispose();
    }
    
    selectedFace = faceIndex;
    const matrixWorld = window.editingMesh.matrixWorld;
    
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
    
    const material = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 3 });
    faceHighlight = new THREE.LineSegments(geometry, material);
    scene.add(faceHighlight);
    
    if (!editHelper) {
        editHelper = new THREE.Object3D();
        scene.add(editHelper);
    }
    
    const center = new THREE.Vector3();
    faceVertices.forEach(v => center.add(v));
    center.divideScalar(faceVertices.length);
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

