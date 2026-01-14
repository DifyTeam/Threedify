// ======================================================
// COMANDO: ADICIONAR OBJETO
// ======================================================
class AddObjectCommand extends Command {
  constructor(object, scene, selectableObjects) {
    super(`Adicionar ${object.name || 'Objeto'}`);
    this.object = object;
    this.scene = scene;
    this.selectableObjects = selectableObjects;
    this.wasAdded = false;
  }
  
  execute() {
    // Adicionar à cena se ainda não foi adicionado
    if (!this.wasAdded) {
      this.scene.add(this.object);
      this.wasAdded = true;
    } else {
      // Re-adicionar se foi removido por undo
      this.scene.add(this.object);
    }
    
    // Adicionar à lista de selecionáveis se não estiver
    if (!this.selectableObjects.includes(this.object)) {
      this.selectableObjects.push(this.object);
    }
    
    // Adicionar à hierarquia se a função existir
    if (typeof addToHierarchy === "function") {
      addToHierarchy(this.object);
    }
    
    // Selecionar o objeto criado
    window.selectedObject = this.object;
    
    // Anexar TransformControls se existir
    if (window.transformControls) {
      transformControls.attach(this.object);
    }
  }
  
  undo() {
    // Desanexa TransformControls se estiver ativo
    if (window.transformControls && transformControls.object === this.object) {
      transformControls.detach();
    }
    
    // Remover da cena
    if (this.object.parent) {
      this.object.parent.remove(this.object);
    }
    
    // Remover da lista de selecionáveis
    const index = this.selectableObjects.indexOf(this.object);
    if (index !== -1) {
      this.selectableObjects.splice(index, 1);
    }
    
    // Remover da hierarquia
    if (typeof removeFromHierarchy === "function") {
      removeFromHierarchy(this.object);
    }
    
    // Limpar seleção se era este objeto
    if (window.selectedObject === this.object) {
      window.selectedObject = null;
    }
  }
}

// ======================================================
// FUNÇÕES DE CRIAÇÃO DE GEOMETRIAS (COM UNDO/REDO)
// ======================================================

function createBox(size = 1, color = 0xB8B8B8) {
  const geometry = new THREE.BufferGeometry();
  const s = size / 2;
  
  // Vértices
  const vertices = new Float32Array([
    // Frente
    -s, -s, s, s, -s, s, s, s, s,
    -s, -s, s, s, s, s, -s, s, s,
    // Trás
    -s, -s, -s, -s, s, -s, s, s, -s,
    -s, -s, -s, s, s, -s, s, -s, -s,
    // Topo
    -s, s, -s, -s, s, s, s, s, s,
    -s, s, -s, s, s, s, s, s, -s,
    // Base
    -s, -s, -s, s, -s, -s, s, -s, s,
    -s, -s, -s, s, -s, s, -s, -s, s,
    // Direita
    s, -s, -s, s, s, -s, s, s, s,
    s, -s, -s, s, s, s, s, -s, s,
    // Esquerda
    -s, -s, -s, -s, -s, s, -s, s, s,
    -s, -s, -s, -s, s, s, -s, s, -s
  ]);
  
  // Normais
  const normals = new Float32Array([
    // Frente
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    // Trás
    0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Topo
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    // Base
    0, -1, 0, 0, -1, 0, 0, -1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Direita
    1, 0, 0, 1, 0, 0, 1, 0, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0,
    // Esquerda
    -1, 0, 0, -1, 0, 0, -1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0
  ]);
  
  // UVs (2 por vértice)
  const uvs = new Float32Array([
    // Frente (duas triângulos)
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
    
    // Trás
    1, 0, 1, 1, 0, 1,
    1, 0, 0, 1, 0, 0,
    
    // Topo
    0, 1, 0, 0, 1, 0,
    0, 1, 1, 0, 1, 1,
    
    // Base
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
    
    // Direita
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
    
    // Esquerda
    1, 0, 0, 0, 0, 1,
    1, 0, 0, 1, 1, 1
  ]);
  
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  
  const material = new THREE.MeshPhongMaterial({
    color: color,
    flatShading: true
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0.5, 0);
  mesh.name = "Box";
  
  // USAR COMANDO EM VEZ DE ADICIONAR DIRETAMENTE
  const addCommand = new AddObjectCommand(mesh, scene, selectableObjects);
  commandManager.execute(addCommand);
  
  return mesh;
}



function createEditableSphereBuffer(
  radius = 1,
  widthSegments = 16,
  heightSegments = 16,
  color = 0xB8B8B8
) {
  const geometry = new THREE.BufferGeometry();
  
  // Arrays para armazenar os dados brutos
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  
  // 1. GERAÇÃO DOS VÉRTICES (Positions, Normals, UVs)
  // Percorre as latitudes (y) e longitudes (x)
  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments; // 0 a 1
    // Calcula o ângulo Phi (latitude): 0 a PI
    const phi = v * Math.PI;
    
    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments; // 0 a 1
      // Calcula o ângulo Theta (longitude): 0 a 2*PI
      const theta = u * Math.PI * 2;
      
      // Matemática da Esfera:
      // x = -r * sin(phi) * cos(theta)
      // y = r * cos(phi)
      // z = r * sin(phi) * sin(theta)
      
      const sinPhiRadius = Math.sin(phi) * radius;
      const cosPhiRadius = Math.cos(phi) * radius;
      
      const px = -sinPhiRadius * Math.cos(theta);
      const py = cosPhiRadius;
      const pz = sinPhiRadius * Math.sin(theta);
      
      // Adiciona Posição
      positions.push(px, py, pz);
      
      // Adiciona Normal
      // Na esfera, a normal é a direção do centro até o ponto (normalizada)
      const nx = px / radius;
      const ny = py / radius;
      const nz = pz / radius;
      normals.push(nx, ny, nz); // O segredo do smooth shading está aqui + índices
      
      // Adiciona UV (para texturas)
      uvs.push(u, 1 - v);
    }
  }
  
  // 2. GERAÇÃO DOS TRIÂNGULOS (Índices)
  // Conecta os pontos gerados acima para formar as faces
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      // Pega os índices dos vértices na grade
      const a = (widthSegments + 1) * y + x + 1;
      const b = (widthSegments + 1) * y + x;
      const c = (widthSegments + 1) * (y + 1) + x;
      const d = (widthSegments + 1) * (y + 1) + x + 1;
      
      // Gera dois triângulos por quadrado (quad)
      // Triângulo 1 (a, b, d)
      indices.push(a, b, d);
      // Triângulo 2 (b, c, d)
      indices.push(b, c, d);
    }
  }
  
  // 3. ATRIBUIR DADOS À GEOMETRIA
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  
  // Opcional: Calcular Bounding Sphere para otimização de render
  geometry.computeBoundingSphere();
  
  // 4. CRIAR MATERIAL E MESH
  const material = new THREE.MeshPhongMaterial({
    color: color,
    flatShading: true,
    shininess: 20
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Sphere";
  
  // USAR COMANDO EM VEZ DE ADICIONAR DIRETAMENTE
  const addCommand = new AddObjectCommand(mesh, scene, selectableObjects);
  commandManager.execute(addCommand);
  
  return mesh;
}



function createPlane(width = 1, height = 1, widthSegments = 1, heightSegments = 1, color = 0xFFFFFF) {
  const geometry = new THREE.BufferGeometry();
  
  const vertices = [];
  const normals = [];
  const indices = [];
  
  // Gerar vértices e normais
  for (let z = 0; z <= heightSegments; z++) {
    for (let x = 0; x <= widthSegments; x++) {
      const vx = (x / widthSegments - 0.5) * width;
      const vy = 0; // chão
      const vz = (z / heightSegments - 0.5) * height;
      
      vertices.push(vx, vy, vz);
      
      // Normal para cima
      normals.push(0, 1, 0);
    }
  }
  
  // Gerar índices
  for (let z = 0; z < heightSegments; z++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = z * (widthSegments + 1) + x;
      const b = a + (widthSegments + 1);
      const c = a + 1;
      const d = b + 1;
      
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  
  const material = new THREE.MeshPhongMaterial({
    color: color,
    flatShading: true,
    side: THREE.DoubleSide
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, 0);
  mesh.name = "Plane";
  
  // USAR COMANDO EM VEZ DE ADICIONAR DIRETAMENTE
  const addCommand = new AddObjectCommand(mesh, scene, selectableObjects);
  commandManager.execute(addCommand);
  
  return mesh;
}



function monkey_blender() {
  const suzanne = loadOBJ('models/suzanne.obj');
  suzanne.name = "Obj model";
  
  // USAR COMANDO EM VEZ DE ADICIONAR DIRETAMENTE
  const addCommand = new AddObjectCommand(suzanne, scene, selectableObjects);
  commandManager.execute(addCommand);
}



// No console ou botão
//const teste0p0 = loadGLTF('caminho/para/arquivo.glb')
//selectableObjects.push(teste0p0);

/*

// Variável global para acessar o modelo depois
var M1 = null;

console.log("⬇️ Iniciando download do modelo...");

// Busca o arquivo ZIP
fetch("models/matilda.zip") // Certifique-se que o caminho está correto (sem / inicial se for relativo)
  .then(res => {
    if (!res.ok) throw new Error(`Erro HTTP! status: ${res.status}`);
    return res.arrayBuffer();
  })
  .then(buffer => {
    // Chama o nosso importador 'From Scratch'
    // O importador é async, então retornamos a promise dele
    return window.loadGLTFZip(buffer);
  })
  .then(modeloCarregado => {
    
    M1 = modeloCarregado; // AQUI O M1 PASSA A EXISTIR
    M1.name = "Matilda_Model";
    
    // --- AJUSTES OPCIONAIS ---
    // M1.position.set(0, 0, 0);
    // M1.scale.set(10, 10, 10); // Se o modelo for muito pequeno
    
    // USAR COMANDO EM VEZ DE ADICIONAR DIRETAMENTE
    const addCommand = new AddObjectCommand(M1, scene, selectableObjects);
    commandManager.execute(addCommand);
    
    console.log("✅ Modelo carregado e pronto!", M1);
  })
  .catch(erro => {
    console.error("❌ Erro fatal ao carregar Matilda:", erro);
    alert("Não foi possível carregar o modelo. Verifique o console.");
  });
  */
  

function createEditableCylinderBuffer(
  radiusTop = 1,
  radiusBottom = 1,
  height = 2,
  radialSegments = 16,
  heightSegments = 1,
  color = 0xB8B8B8
) {
  // Geometria normal do Three.js
  const cylinder = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    radialSegments,
    heightSegments
  );
  
  // Converter para BufferGeometry
  const geometry = new THREE.BufferGeometry().fromGeometry(cylinder);
  geometry.computeVertexNormals();
  
  const material = new THREE.MeshPhongMaterial({
    color: color,
    flatShading: true,
    shininess: 0
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Cylinder";
  
  // USAR COMANDO EM VEZ DE ADICIONAR DIRETAMENTE
  const addCommand = new AddObjectCommand(mesh, scene, selectableObjects);
  commandManager.execute(addCommand);
  
  return mesh;
}


function createEditablePyramidBuffer(
  size = 1,
  height = 1.5,
  color = 0xB8B8B8
) {
  // Usar ConeGeometry com 4 segmentos → base quadrada
  const pyramid = new THREE.ConeGeometry(
    size, // raio da base
    height, // altura
    4 // radialSegments = 4 → pirâmide quadrada
  );
  
  const geometry = new THREE.BufferGeometry().fromGeometry(pyramid);
  geometry.computeVertexNormals();
  
  const material = new THREE.MeshPhongMaterial({
    color: color,
    flatShading: true,
    shininess: 0
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Triangle";
  
  // USAR COMANDO EM VEZ DE ADICIONAR DIRETAMENTE
  const addCommand = new AddObjectCommand(mesh, scene, selectableObjects);
  commandManager.execute(addCommand);
  
  return mesh;
}

function cilindro() {
  createEditableCylinderBuffer();
}


function piramide() {
  createEditablePyramidBuffer();
}


function eferaadd() {
  createEditableSphereBuffer();
}


function make_box(param) {
  createBox();
}

function make_plan(param) {
  createPlane();
}


// ======================================================
// 4. INTEGRAÇÃO COM A UI (ABRIR ARQUIVO LOCAL)
// ======================================================

function _model_imp_Obj() {
  // Cria o input invisível dinamicamente
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.obj'; // Aceita apenas arquivos .obj
  input.style.display = 'none';
  
  // O que acontece quando o usuário seleciona o arquivo
  input.onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return; // Se cancelou, não faz nada
    
    console.log("Arquivo selecionado:", file.name);
    
    // Cria uma URL temporária para o arquivo local (blob:http://...)
    // Isso permite que o Worker "baixe" o arquivo da memória do navegador
    const blobUrl = URL.createObjectURL(file);
    
    // Chama nossa função poderosa de Load
    const model = loadOBJ(blobUrl);
    
    // Usa o nome real do arquivo
    model.name = file.name;
    
    // USAR COMANDO EM VEZ DE ADICIONAR DIRETAMENTE
    const addCommand = new AddObjectCommand(model, scene, selectableObjects);
    commandManager.execute(addCommand);
    
    // Limpa o input da memória
    input.remove();
  };
  
  // Adiciona ao corpo temporariamente e clica
  document.body.appendChild(input);
  input.click();
}

// Configura o evento no botão existente
const importButton = document.getElementById('imp-obj');

if (importButton) {
  // Remove listeners antigos para não duplicar (caso recarregue o script)
  const newBtn = importButton.cloneNode(true);
  importButton.parentNode.replaceChild(newBtn, importButton);
  
  // Adiciona o evento de clique
  newBtn.addEventListener('click', _model_imp_Obj);
} else {
  console.error("ERRO: Botão '#imp-obj' não encontrado.");
}