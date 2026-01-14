// displayHelpers.js - Funções para mostrar vértices, arestas e faces

function mostrarVertices() {
  if (!window.editingMesh || uniqueVertices.length === 0) return;
  
  vertexCount = uniqueVertices.length;
  const matrixWorld = window.editingMesh.matrixWorld;
  
  const vertexGeometry = new THREE.BoxGeometry(0.05, 0.05,0.05 );
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
  
  const material = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 0.05});
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
  
  const material = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 0.05 });
  faceLines = new THREE.LineSegments(geometry, material);
  scene.add(faceLines);
  console.log(`Exibindo ${faces.length} faces`);
}