// transformUpdate.js - Funções para atualizar geometria durante transformações

function atualizarVertices() {
  if (modoAtual !== 'edicao' || !window.editingMesh) return;
  if (selectedVertices.length === 0 || !editHelper || !initialEditPosition || selectedUniqueIndices.length === 0) return;
  
  const geometry = window.editingMesh.geometry;
  const positions = geometry.attributes.position.array;
  const matrixWorld = window.editingMesh.matrixWorld;
  const matrixWorldInverse = new THREE.Matrix4().copy(matrixWorld).invert();
  
  const delta = new THREE.Vector3().subVectors(editHelper.position, initialEditPosition);
  const pivot = initialEditPosition.clone();
  const effectiveMatrix = new THREE.Matrix4().compose(
    pivot,
    editHelper.quaternion,
    editHelper.scale
  ).multiply(
    new THREE.Matrix4().setPosition(pivot).invert()
  );
  
  selectedUniqueIndices.forEach(uniqueIndex => {
    if (!uniqueVertices[uniqueIndex] || !initialVertexPositions[uniqueIndex]) {
      return;
    }
    
    let worldPos = initialVertexPositions[uniqueIndex].clone().applyMatrix4(effectiveMatrix);
    worldPos.add(delta);
    const localPos = worldPos.applyMatrix4(matrixWorldInverse);
    uniqueVertices[uniqueIndex].copy(localPos);
    
    for (let originalIndex in vertexMapping) {
      if (vertexMapping[originalIndex] === uniqueIndex) {
        const i = parseInt(originalIndex) * 3;
        if (i + 2 < positions.length) {
          positions[i] = localPos.x;
          positions[i + 1] = localPos.y;
          positions[i + 2] = localPos.z;
        }
      }
    }
  });
  
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  
  if (vertexInstancedMesh) {
    const matrix = new THREE.Matrix4();
    selectedUniqueIndices.forEach(uniqueIndex => {
      if (!uniqueVertices[uniqueIndex]) return;
      
      const vertex = uniqueVertices[uniqueIndex].clone().applyMatrix4(matrixWorld);
      matrix.setPosition(vertex);
      vertexInstancedMesh.setMatrixAt(uniqueIndex, matrix);
    });
    vertexInstancedMesh.instanceMatrix.needsUpdate = true;
  }
}

function atualizarAresta() {
  if (modoAtual !== 'edicao' || !window.editingMesh || selectedEdge === null || !editHelper || !initialEditPosition || selectedUniqueIndices.length === 0) return;
  
  const geometry = window.editingMesh.geometry;
  const positions = geometry.attributes.position.array;
  const matrixWorld = window.editingMesh.matrixWorld;
  const matrixWorldInverse = new THREE.Matrix4().copy(matrixWorld).invert();
  
  const delta = new THREE.Vector3().subVectors(editHelper.position, initialEditPosition);
  const pivot = initialEditPosition.clone();
  const effectiveMatrix = new THREE.Matrix4().compose(
    pivot,
    editHelper.quaternion,
    editHelper.scale
  ).multiply(
    new THREE.Matrix4().setPosition(pivot).invert()
  );
  
  selectedUniqueIndices.forEach(uniqueIndex => {
    if (!uniqueVertices[uniqueIndex] || !initialVertexPositions[uniqueIndex]) {
      return;
    }
    
    let worldPos = initialVertexPositions[uniqueIndex].clone().applyMatrix4(effectiveMatrix);
    worldPos.add(delta);
    const localPos = worldPos.applyMatrix4(matrixWorldInverse);
    uniqueVertices[uniqueIndex].copy(localPos);
    for (let originalIndex in vertexMapping) {
      if (vertexMapping[originalIndex] === uniqueIndex) {
        const i = parseInt(originalIndex) * 3;
        if (i + 2 < positions.length) {
          positions[i] = localPos.x;
          positions[i + 1] = localPos.y;
          positions[i + 2] = localPos.z;
        }
      }
    }
  });
  
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  
  if (edgeLines) {
    const newPositions = [];
    edges.forEach(edge => {
      if (!uniqueVertices[edge[0]] || !uniqueVertices[edge[1]]) {
        return;
      }
      
      const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
      const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
      newPositions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    });
    
    if (newPositions.length > 0) {
      edgeLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      edgeLines.geometry.attributes.position.needsUpdate = true;
    }
  }
  
  if (edgeHighlight && edges[selectedEdge]) {
    const edge = edges[selectedEdge];
    if (uniqueVertices[edge[0]] && uniqueVertices[edge[1]]) {
      const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
      const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
      
      const newPositions = new Float32Array([v1.x, v1.y, v1.z, v2.x, v2.y, v2.z]);
      edgeHighlight.geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      edgeHighlight.geometry.attributes.position.needsUpdate = true;
    }
  }
}

function atualizarFace() {
  if (modoAtual !== 'edicao' || !window.editingMesh || selectedFace === null || !editHelper || !initialEditPosition || selectedUniqueIndices.length === 0) return;
  
  const geometry = window.editingMesh.geometry;
  const positions = geometry.attributes.position.array;
  const matrixWorld = window.editingMesh.matrixWorld;
  const matrixWorldInverse = new THREE.Matrix4().copy(matrixWorld).invert();
  
  const delta = new THREE.Vector3().subVectors(editHelper.position, initialEditPosition);
  const pivot = initialEditPosition.clone();
  const effectiveMatrix = new THREE.Matrix4().compose(
    pivot,
    editHelper.quaternion,
    editHelper.scale
  ).multiply(
    new THREE.Matrix4().setPosition(pivot).invert()
  );
  
  selectedUniqueIndices.forEach(uniqueIndex => {
    if (!uniqueVertices[uniqueIndex] || !initialVertexPositions[uniqueIndex]) {
      return;
    }
    
    let worldPos = initialVertexPositions[uniqueIndex].clone().applyMatrix4(effectiveMatrix);
    worldPos.add(delta);
    const localPos = worldPos.applyMatrix4(matrixWorldInverse);
    uniqueVertices[uniqueIndex].copy(localPos);
    
    for (let originalIndex in vertexMapping) {
      if (vertexMapping[originalIndex] === uniqueIndex) {
        const i = parseInt(originalIndex) * 3;
        if (i + 2 < positions.length) {
          positions[i] = localPos.x;
          positions[i + 1] = localPos.y;
          positions[i + 2] = localPos.z;
        }
      }
    }
  });
  
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  
  if (faceLines) {
    const newPositions = [];
    faces.forEach(face => {
      const validFace = face.every(v => uniqueVertices[v] !== undefined);
      if (!validFace) return;
      
      for (let i = 0; i < face.length; i++) {
        const v1 = uniqueVertices[face[i]].clone().applyMatrix4(matrixWorld);
        const v2 = uniqueVertices[face[(i + 1) % face.length]].clone().applyMatrix4(matrixWorld);
        newPositions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
      }
    });
    
    if (newPositions.length > 0) {
      faceLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      faceLines.geometry.attributes.position.needsUpdate = true;
    }
  }
  
  if (faceHighlight && faces[selectedFace]) {
    const highlightPositions = [];
    const face = faces[selectedFace];
    const validFace = face.every(v => uniqueVertices[v] !== undefined);
    
    if (validFace) {
      for (let i = 0; i < face.length; i++) {
        const v1 = uniqueVertices[face[i]].clone().applyMatrix4(matrixWorld);
        const v2 = uniqueVertices[face[(i + 1) % face.length]].clone().applyMatrix4(matrixWorld);
        highlightPositions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
      }
      
      if (highlightPositions.length > 0) {
        faceHighlight.geometry.setAttribute('position', new THREE.Float32BufferAttribute(highlightPositions, 3));
        faceHighlight.geometry.attributes.position.needsUpdate = true;
      }
    }
  }
}

// Listener do TransformControls
transformControls.addEventListener('change', () => {
  if (modoAtual === 'edicao') {
    try {
      if (submodoEdicao === 'vertex' && selectedVertices.length > 0) {
        atualizarVertices();
      } else if (submodoEdicao === 'edge' && selectedEdge !== null) {
        atualizarAresta();
      } else if (submodoEdicao === 'face' && selectedFace !== null) {
        atualizarFace();
      }
    } catch (error) {
      console.error('Erro ao atualizar geometria:', error);
    }
  }
});