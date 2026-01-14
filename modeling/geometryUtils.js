// geometryUtils.js - Versão Estável e Corrigida

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

// Mescla vértices duplicados (Weld)
function mergeVertices(geometry, tolerance = 1e-5) {
  garantirGeometriaIndexada(geometry);
  
  const positions = geometry.attributes.position.array;
  const vertexCount = positions.length / 3;
  
  if (vertexCount === 0) {
    // Retorno seguro para evitar crash
    return { unique: [], mapping: {} };
  }
  
  const unique = [];
  const mapping = {};
  const vertexMap = new Map();
  
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    
    // Proteção contra NaN que pode quebrar subdivisão
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      mapping[i] = 0;
      continue;
    }
    
    // Hash espacial para identificar duplicatas
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
  
  return { unique, mapping };
}

// Detecta arestas únicas
function detectEdges(geometry, vertexMapping) {
  const index = geometry.index;
  const edgeSet = new Set();
  const edgeArray = [];
  
  if (!index) return [];
  
  const indices = index.array;
  const faceCount = indices.length / 3;
  
  // Se vertexMapping não for fornecido, assume identidade (para malhas já otimizadas)
  const getMap = (idx) => (vertexMapping && vertexMapping[idx] !== undefined) ? vertexMapping[idx] : idx;
  
  for (let i = 0; i < faceCount; i++) {
    const faceIndices = [
      getMap(indices[i * 3]),
      getMap(indices[i * 3 + 1]),
      getMap(indices[i * 3 + 2])
    ];
    
    // Validação de sanidade
    if (faceIndices.some(idx => idx === undefined || idx === null)) continue;
    
    for (let j = 0; j < 3; j++) {
      const a = faceIndices[j];
      const b = faceIndices[(j + 1) % 3];
      // Chave única independentemente da direção
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edgeArray.push([a, b]);
      }
    }
  }
  
  return edgeArray;
}

// Detecta faces (Triângulos -> Quads)
// CORRIGIDO: Fallback de mapeamento e Ordenação de Winding Order
function detectFaces(geometry, vertexMapping) {
  const index = geometry.index;
  if (!index) return [];
  
  const indices = index.array;
  const faceCount = indices.length / 3;
  const triangles = [];
  
  // Função auxiliar para mapear índice -> vértice único
  // O fallback "?? idx" é CRÍTICO: se a malha já for otimizada, o índice É o ID único.
  const getMap = (idx) => (vertexMapping && vertexMapping[idx] !== undefined) ? vertexMapping[idx] : idx;
  
  // 1. Extração
  for (let i = 0; i < faceCount; i++) {
    const a = getMap(indices[i * 3]);
    const b = getMap(indices[i * 3 + 1]);
    const c = getMap(indices[i * 3 + 2]);
    
    if (a !== undefined && b !== undefined && c !== undefined) {
      triangles.push([a, b, c]);
    }
  }
  
  const quads = [];
  const usedTriangles = new Set();
  
  // 2. Fusão (Tri to Quad)
  for (let i = 0; i < triangles.length; i++) {
    if (usedTriangles.has(i)) continue;
    
    const tri1 = triangles[i];
    let foundQuad = false;
    
    for (let j = i + 1; j < triangles.length; j++) {
      if (usedTriangles.has(j)) continue;
      
      const tri2 = triangles[j];
      const shared = tri1.filter(v => tri2.includes(v));
      
      // Se compartilham exatamente 2 vértices (aresta comum)
      if (shared.length === 2) {
        const unique1 = tri1.find(v => !shared.includes(v));
        const unique2 = tri2.find(v => !shared.includes(v));
        
        // --- ORDENAÇÃO DE VÉRTICES (Winding Order) ---
        // Garante que o quad siga o perímetro A->B->C->D sem cruzar (gravata borboleta)
        
        // Pega a posição do vértice único no tri1
        const u1Index = tri1.indexOf(unique1);
        
        // No tri1 (CCW), o vértice DEPOIS do unique1 é o início da aresta compartilhada
        const nextInTri1 = tri1[(u1Index + 1) % 3];
        
        // O vértice ANTES do unique1 é o fim da aresta compartilhada
        const prevInTri1 = tri1[(u1Index + 2) % 3];
        
        // Quad correto: U1 -> (Conexão 1) -> U2 -> (Conexão 2)
        // Isso preserva a normal e evita buracos na subdivisão
        const orderedQuad = [unique1, nextInTri1, unique2, prevInTri1];
        
        quads.push(orderedQuad);
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
  
  console.log(`Faces detectadas: ${quads.length} (${triangles.length} tris originais)`);
  return quads;
}

// Reconstrói geometria a partir de faces
function reconstruirGeometria() {
  const finalPositions = [];
  
  // 1. Converter topologia lógica (faces) em sopa de triângulos para o BufferGeometry
  // Nota: Assume-se que 'faces' contém índices válidos de 'uniqueVertices'
  faces.forEach(face => {
    if (face.length === 3) {
      face.forEach(vIdx => {
        const v = uniqueVertices[vIdx];
        if (v) finalPositions.push(v.x, v.y, v.z);
      });
    } else if (face.length === 4) {
      // Triangulação básica de Quad (0-1-2, 0-2-3)
      [0, 1, 2, 0, 2, 3].forEach(i => {
        const vIdx = face[i];
        const v = uniqueVertices[vIdx];
        if (v) finalPositions.push(v.x, v.y, v.z);
      });
    }
  });
  
  // 2. Criar nova geometria bruta
  const newGeometry = new THREE.BufferGeometry();
  newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
  
  // 3. Otimizar: Soldar vértices (Merge)
  // Isso gera o índice limpo e remove duplicatas espaciais
  const mergedForIndex = mergeVertices(newGeometry);
  
  // 4. Construir o Index Buffer
  // O 'mapping' diz qual índice da sopa (0..N) vira qual índice único (0..U)
  const indicesArray = [];
  const posCount = finalPositions.length / 3;
  for (let i = 0; i < posCount; i++) {
    // Aqui usamos o mapping gerado AGORA
    indicesArray.push(mergedForIndex.mapping[i]);
  }
  newGeometry.setIndex(indicesArray);
  
  // 5. Atualizar atributo Position com apenas os vértices únicos
  const uniquePosArray = [];
  mergedForIndex.unique.forEach(v => {
    uniquePosArray.push(v.x, v.y, v.z);
  });
  newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(uniquePosArray, 3));
  
  // 6. Calcular normais (agora que está indexado e soldado, ficará suave)
  newGeometry.computeVertexNormals();
  
  // 7. Substituir geometria no Mesh
  if (window.editingMesh.geometry) {
    window.editingMesh.geometry.dispose();
  }
  window.editingMesh.geometry = newGeometry;
  
  // --- ATUALIZAÇÃO DE ESTADO GLOBAL (CRÍTICO) ---
  
  // Atualiza a lista mestre de vértices únicos
  uniqueVertices = mergedForIndex.unique;
  
  // CRÍTICO: Criar um mapeamento de IDENTIDADE para a nova geometria.
  // Como a geometria agora contém APENAS vértices únicos e está indexada,
  // o índice 0 é o vértice 0. Não usamos mais o 'mergedForIndex.mapping' complexo
  // para as funções de detecção subsequentes, pois os índices mudaram.
  vertexMapping = {};
  for (let i = 0; i < uniqueVertices.length; i++) {
    vertexMapping[i] = i;
  }
  
  // 8. Re-detectar topologia baseada na geometria limpa
  // Passamos o vertexMapping de identidade (ou nada, pois o detectFaces tem fallback)
  edges = detectEdges(newGeometry, vertexMapping);
  faces = detectFaces(newGeometry, vertexMapping);
  
  if (typeof atualizarSubmodoEdicao === 'function') {
    atualizarSubmodoEdicao();
  }
}