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