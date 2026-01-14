// ==============================================
// COMANDO: TRANSFORMAR (MOVER/ROTACIONAR/ESCALAR)
// ==============================================
class TransformCommand extends Command {
  /**
   * @param {Array} objects - Lista de objetos modificados
   * @param {Map} startStates - Map(uuid -> {position, quaternion, scale}) estado inicial
   * @param {Map} endStates - Map(uuid -> {position, quaternion, scale}) estado final
   */
  constructor(objects, startStates, endStates) {
    super('Transformar Objetos');
    this.objects = objects; // Array de referências aos objetos
    this.startStates = startStates;
    this.endStates = endStates;
    
    // Salva qual objeto estava selecionado para restaurar o gizmo corretamente
    this.previousSelection = window.selectedObjects ? [...window.selectedObjects] : [];
  }
  
  execute() {
    this.applyState(this.endStates);
    this.restoreSelection();
  }
  
  undo() {
    this.applyState(this.startStates);
    this.restoreSelection();
  }
  
  applyState(stateMap) {
    this.objects.forEach(obj => {
      const state = stateMap.get(obj.uuid);
      if (state) {
        obj.position.copy(state.position);
        obj.quaternion.copy(state.quaternion);
        obj.scale.copy(state.scale);
      }
    });
  }
  
  restoreSelection() {
    // Restaura a seleção visual e lógica
    window.selectedObjects = [...this.previousSelection];
    
    if (window.selectedObjects.length === 1) {
      window.selectedObject = window.selectedObjects[0];
      if (window.transformControls) window.transformControls.attach(window.selectedObject);
    } else if (window.selectedObjects.length > 1) {
      // Recalcula o helper para multisseleção se necessário
      // (A lógica de recriar o helper está no seu selectObject, 
      //  aqui apenas garantimos que os objetos estão marcados)
      window.selectedObject = window.selectedObjects[window.selectedObjects.length - 1];
    }
    
    // Atualiza a visualização (Outline e Hierarquia)
    if (typeof atualizarOutline === 'function') atualizarOutline(window.selectedObjects);
    if (typeof sincronizarHierarquia === 'function') sincronizarHierarquia(window.selectedObjects);
  }
}




// events.js - COMPLETO (Seleção de Precisão: Clicou, Selecionou + Outline Suave + MULTISSELEÇÃO + UNDO/REDO)

// ==========================================
// PARTE 0: SISTEMA DE OUTLINE (POST-PROCESSING QUAD SUAVIZADO)
// ==========================================

const OutlineSystem = (function() {
    // Configurações
    const OUTLINE_COLOR = new THREE.Color(0xDE4E4E); // Amarelo
    const OUTLINE_THICKNESS = 2.0; 
    const QUAD_NAME = "System_Outline_Quad_Overlay";
    const MSAA_SAMPLES = 4;

    // Variáveis Internas
    let composerScene, composerCamera, renderTarget;
    let outlineQuad, outlineMaterial;
    let ghostScene; 
    let ghostMaterial;
    let isInitialized = false;

    // Shader de Detecção de Borda (Sobel simples)
    const vertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `;

    // Shader com Alpha Suavizado
    const fragmentShader = `
        uniform sampler2D maskTexture;
        uniform vec2 resolution;
        uniform vec3 color;
        uniform float thickness;
        varying vec2 vUv;

        void main() {
            vec2 texel = vec2(thickness) / resolution;
            
            // Amostra o centro
            float center = texture2D(maskTexture, vUv).r;
            
            // Se o pixel é objeto sólido (branco), descarta
            if (center > 0.9) discard; 

            // Verifica vizinhos
            float top = texture2D(maskTexture, vUv + vec2(0.0, texel.y)).r;
            float bottom = texture2D(maskTexture, vUv - vec2(0.0, texel.y)).r;
            float left = texture2D(maskTexture, vUv - vec2(texel.x, 0.0)).r;
            float right = texture2D(maskTexture, vUv + vec2(texel.x, 0.0)).r;

            float edgeIntensity = top + bottom + left + right;

            // Suavização (Anti-aliasing simulado no shader)
            float alpha = smoothstep(0.1, 1.5, edgeIntensity);

            if (alpha > 0.0) {
                gl_FragColor = vec4(color, alpha);
            } else {
                discard;
            }
        }
    `;

    function init() {
        if (isInitialized) return;

        const size = new THREE.Vector2();
        renderer.getSize(size);

        // WebGLMultisampleRenderTarget para bordas suaves na máscara
        if (renderer.capabilities.isWebGL2) {
            renderTarget = new THREE.WebGLMultisampleRenderTarget(size.x, size.y, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                stencilBuffer: false,
                depthBuffer: true,
                samples: MSAA_SAMPLES
            });
        } else {
            console.warn("Outline: WebGL 2 não detectado. Usando render target padrão.");
            renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat
            });
        }

        ghostScene = new THREE.Scene();
        ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });

        composerScene = new THREE.Scene();
        composerCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        outlineMaterial = new THREE.ShaderMaterial({
            uniforms: {
                maskTexture: { value: renderTarget.texture },
                resolution: { value: size },
                color: { value: OUTLINE_COLOR },
                thickness: { value: OUTLINE_THICKNESS }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.NormalBlending
        });

        const plane = new THREE.PlaneGeometry(2, 2);
        outlineQuad = new THREE.Mesh(plane, outlineMaterial);
        outlineQuad.name = QUAD_NAME;
        outlineQuad.frustumCulled = false;
        composerScene.add(outlineQuad);

        window.addEventListener('resize', () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            renderTarget.setSize(w, h);
            outlineMaterial.uniforms.resolution.value.set(w, h);
        });

        const originalRender = renderer.render.bind(renderer);
        
        renderer.render = function(scene, camera) {
            originalRender(scene, camera);

            // MODIFICADO: Suporta múltiplos objetos selecionados
            const selectedObjects = window.selectedObjects || [];
            if ((window.selectedObject || selectedObjects.length > 0) && ghostScene.children.length > 0) {
                // Atualiza posição dos fantasmas
                ghostScene.children.forEach(ghost => {
                    if (ghost.userData.originalRef) {
                        const original = ghost.userData.originalRef;
                        ghost.matrix.copy(original.matrixWorld);
                        ghost.matrix.decompose(ghost.position, ghost.quaternion, ghost.scale);
                    }
                });

                const currentAutoClear = renderer.autoClear;
                renderer.autoClear = true;
                renderer.setRenderTarget(renderTarget);
                renderer.setClearColor(0x000000, 0); 
                renderer.clear();
                
                ghostScene.overrideMaterial = ghostMaterial;
                originalRender(ghostScene, camera);
                ghostScene.overrideMaterial = null;
                
                renderer.setRenderTarget(null); 
                renderer.autoClear = false; 
                originalRender(composerScene, composerCamera);
                
                renderer.autoClear = currentAutoClear;
            }
        };

        isInitialized = true;
        console.log("Sistema de Outline Suavizado Iniciado.");
    }

    // MODIFICADO: Suporta lista de objetos
    function updateSelection(objOrArray) {
        if (!isInitialized) init();

        while(ghostScene.children.length > 0){ 
            const child = ghostScene.children[0];
            ghostScene.remove(child); 
        }

        // Suporta tanto objeto único quanto array
        const objects = Array.isArray(objOrArray) ? objOrArray : (objOrArray ? [objOrArray] : []);
        
        if (objects.length === 0) return;

        const addGhost = (target) => {
            if (target.isMesh && target.geometry) {
                const ghost = new THREE.Mesh(target.geometry, ghostMaterial);
                ghost.matrixAutoUpdate = false; 
                ghost.userData.originalRef = target;
                ghost.frustumCulled = false; 
                ghostScene.add(ghost);
            }
        };

        // Adiciona fantasmas para todos os objetos selecionados
        objects.forEach(obj => {
            if (obj.isMesh) {
                addGhost(obj);
            }
            
            // Se for um grupo, adiciona os filhos
            obj.traverse((child) => {
                if (child !== obj) {
                    addGhost(child);
                }
            });
        });
    }

    return {
        update: updateSelection
    };
})();


// ==========================================
// PARTE 1: SISTEMA BVH
// ==========================================

class BVHNode {
    constructor() {
        this.boundingBox = new THREE.Box3();
        this.left = null;
        this.right = null;
        this.triangles = []; 
    }
}

class MeshBVH {
    constructor(mesh) {
        this.mesh = mesh;
        this.geometry = mesh.geometry;
        if (!this.geometry.index) {
            console.warn("BVH: Geometria sem índice detectada.");
        }
        this.root = null;
        this.maxTrianglesPerNode = 10;
        this.maxDepth = 40;
        this.build();
    }

    build() {
        const posAttr = this.geometry.attributes.position;
        const indexAttr = this.geometry.index;
        const triangles = [];
        const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
        const count = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

        for (let i = 0; i < count; i++) {
            let a, b, c;
            if (indexAttr) {
                a = indexAttr.getX(i * 3); b = indexAttr.getX(i * 3 + 1); c = indexAttr.getX(i * 3 + 2);
            } else {
                a = i * 3; b = i * 3 + 1; c = i * 3 + 2;
            }
            vA.fromBufferAttribute(posAttr, a);
            vB.fromBufferAttribute(posAttr, b);
            vC.fromBufferAttribute(posAttr, c);
            
            const box = new THREE.Box3();
            box.expandByPoint(vA).expandByPoint(vB).expandByPoint(vC);
            
            triangles.push({
                index: i * 3,
                centroid: vA.clone().add(vB).add(vC).multiplyScalar(1/3),
                box: box,
                a: a, b: b, c: c
            });
        }
        this.root = this.splitNodes(triangles, 0);
    }

    splitNodes(triangles, depth) {
        const node = new BVHNode();
        for (let t of triangles) node.boundingBox.union(t.box);

        if (triangles.length <= this.maxTrianglesPerNode || depth >= this.maxDepth) {
            node.triangles = triangles;
            return node;
        }

        const size = new THREE.Vector3();
        node.boundingBox.getSize(size);
        const axis = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : (size.y > size.z ? 'y' : 'z');
        triangles.sort((a, b) => a.centroid[axis] - b.centroid[axis]);

        const mid = Math.floor(triangles.length / 2);
        node.left = this.splitNodes(triangles.slice(0, mid), depth + 1);
        node.right = this.splitNodes(triangles.slice(mid), depth + 1);
        return node;
    }

    raycast(raycaster, intersects) {
        if(this.mesh.matrixWorldNeedsUpdate) this.mesh.updateMatrixWorld(true);
        
        const inverseMatrix = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert();
        const localRay = raycaster.ray.clone().applyMatrix4(inverseMatrix);
        this.traverseRay(this.root, localRay, raycaster, intersects);
        intersects.sort((a, b) => a.distance - b.distance);
    }

    traverseRay(node, ray, raycaster, intersects) {
        if (!node || !ray.intersectsBox(node.boundingBox)) return;

        if (node.triangles.length > 0) {
            const posAttr = this.geometry.attributes.position;
            const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
            const intersectionPoint = new THREE.Vector3();

            for (let t of node.triangles) {
                vA.fromBufferAttribute(posAttr, t.a);
                vB.fromBufferAttribute(posAttr, t.b);
                vC.fromBufferAttribute(posAttr, t.c);
                
                const intersect = ray.intersectTriangle(vA, vB, vC, true, intersectionPoint);

                if (intersect) {
                    const worldPoint = intersectionPoint.clone().applyMatrix4(this.mesh.matrixWorld);
                    const distance = raycaster.ray.origin.distanceTo(worldPoint);
                    
                    if (distance >= raycaster.near && distance <= raycaster.far) {
                        intersects.push({
                            distance: distance, point: worldPoint, object: this.mesh,
                            face: { a: t.a, b: t.b, c: t.c, normal: new THREE.Vector3() },
                            faceIndex: t.index / 3,
                            uv: null 
                        });
                    }
                }
            }
        } else {
            this.traverseRay(node.left, ray, raycaster, intersects);
            this.traverseRay(node.right, ray, raycaster, intersects);
        }
    }
}
window.MeshBVH = MeshBVH;

function sincronizarHierarquia(objetoOuArray) {
  document.querySelectorAll('.entity-objto').forEach(el => {
    el.style.backgroundColor = "";
    const l = el.querySelector(".label-obj");
    if(l) l.style.color = "";
  });
  
  // MODIFICADO: Suporta tanto objeto único quanto array
  const objetos = Array.isArray(objetoOuArray) ? objetoOuArray : (objetoOuArray ? [objetoOuArray] : []);
  
  if (objetos.length === 0) return;
  
  objetos.forEach(objeto => {
    const container = document.querySelector(`.hierarchy-item-container[data-uuid="${objeto.uuid}"]`);
    if (container) {
      const div = container.querySelector('.entity-objto');
      if (div) {
        div.style.backgroundColor = "#616161"; 
        const label = div.querySelector(".label-obj");
        if (label) label.style.color = "#FF8900"; 
        div.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  });
}

// === BRIDGE PARA O SISTEMA DE OUTLINE ===
function atualizarOutline(objetoOuArray) {
    OutlineSystem.update(objetoOuArray);
}

// --- INICIALIZAÇÃO DE VARIÁVEIS ---
if (typeof window.pointerDownTime === 'undefined') window.pointerDownTime = 0;
if (typeof window.pointerDownPos === 'undefined') window.pointerDownPos = new THREE.Vector2();

let currentBVH = null; 
let lastEditedMeshUUID = null;

// --- FUNÇÕES AUXILIARES ---

function updateBVH(mesh) {
    if (!mesh || !mesh.geometry) {
        currentBVH = null;
        return;
    }
    currentBVH = new MeshBVH(mesh);
    lastEditedMeshUUID = mesh.uuid;
    console.log("BVH atualizada para:", mesh.name);
}

function checkIntersection(objects, recursive = false) {
    if (Array.isArray(objects)) return raycaster.intersectObjects(objects, recursive);
    
    const mesh = objects;
    if (mesh === window.editingMesh) {
        mesh.updateMatrixWorld();
        if (currentBVH && currentBVH.mesh === mesh) {
            const intersects = [];
            currentBVH.raycast(raycaster, intersects);
            return intersects;
        }
    }
    return raycaster.intersectObject(mesh, recursive);
}

// --- EVENT HANDLERS ---

function onPointerDown(e) {
  window.pointerDownTime = Date.now();
  window.pointerDownPos.x = e.clientX;
  window.pointerDownPos.y = e.clientY;
}

function onPointerMove(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  
  if (loopCutMode && modoAtual === 'edicao') {
    raycaster.setFromCamera(mouse, camera);
    const intersects = checkIntersection(window.editingMesh, true);
    if (intersects.length > 0) {
      const loop = detectarLoopAPartirDePonto(intersects[0].point);
      if (loop && loop.length > 0) {
        loopCutCurrentLoop = loop;
        mostrarLoopCutPreview(loop);
      }
    } else if (loopCutCurrentLoop) {
          if (typeof limparLoopCutPreview === 'function') limparLoopCutPreview();
          loopCutCurrentLoop = null;
    }
  }
}

function selectObject(e) {
  if (loopCutMode && loopCutCurrentLoop) {
    aplicarLoopCut();
    updateBVH(window.editingMesh);
    return;
  }
  
  const timeDiff = Date.now() - window.pointerDownTime;
  const moveDist = Math.sqrt(Math.pow(e.clientX - window.pointerDownPos.x, 2) + Math.pow(e.clientY - window.pointerDownPos.y, 2));
  if (moveDist > 5 || timeDiff > 200) return;
  
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  
  raycaster.params.Points.threshold = 0.25; 
  raycaster.params.Line.threshold = 0.15; 

  raycaster.setFromCamera(mouse, camera);
  
  if (modoAtual === 'edicao') {
    try {
      if (submodoEdicao === 'vertex' && vertexInstancedMesh) {
        raycaster.params.Points.threshold = 0.3;
        const intersects = raycaster.intersectObject(vertexInstancedMesh, false);
        if (intersects.length > 0) selecionarVertice(intersects[0].instanceId);
      } else if (submodoEdicao === 'edge') {
        const intersects = checkIntersection(window.editingMesh, true);
        if (intersects.length > 0) {
          const idx = encontrarArestaMaisProxima(intersects[0].point);
          if (idx !== null) selecionarAresta(idx);
        }
      } else if (submodoEdicao === 'face') {
        const intersects = checkIntersection(window.editingMesh, true);
        if (intersects.length > 0) {
          const idx = encontrarFaceMaisProxima(intersects[0].point);
          if (idx !== null) selecionarFace(idx);
        }
      }
    } catch (err) { console.error(err); }
    return;
  }
  
  // === MULTISSELEÇÃO NO MODO OBJECT ===
  // Verifica se o checkbox de multisseleção está ativo
  const multiSelCheckbox = document.getElementById('multselection');
  const isMultiSelectionEnabled = multiSelCheckbox && multiSelCheckbox.checked;
  
  // Inicializa array de objetos selecionados se não existir
  if (!window.selectedObjects) {
    window.selectedObjects = [];
  }
  
  // Intersecta recursivamente todos os objetos selecionáveis
  const intersects = raycaster.intersectObjects(selectableObjects, true);
  
  if (intersects.length > 0) {
    const finalSel = intersects[0].object;

    if (finalSel) {
      if (isMultiSelectionEnabled) {
        // MODO MULTISSELEÇÃO ATIVO
        // Verifica se o objeto já está selecionado
        const index = window.selectedObjects.findIndex(obj => obj.uuid === finalSel.uuid);
        
        if (index !== -1) {
          // Objeto já está selecionado, remove da seleção (toggle)
          window.selectedObjects.splice(index, 1);
          console.log(`Objeto ${finalSel.name || finalSel.uuid} removido da seleção`);
        } else {
          // Adiciona à seleção
          window.selectedObjects.push(finalSel);
          console.log(`Objeto ${finalSel.name || finalSel.uuid} adicionado à seleção`);
        }
        
        // Atualiza selectedObject para o último selecionado (para compatibilidade)
        selectedObject = window.selectedObjects.length > 0 ? window.selectedObjects[window.selectedObjects.length - 1] : null;
        if (typeof window !== 'undefined') window.selectedObject = selectedObject;
        
        // Atualiza outline e hierarquia para todos os objetos selecionados
        atualizarOutline(window.selectedObjects);
        sincronizarHierarquia(window.selectedObjects);
        
        // Cria helper no centro de todos os objetos para transformação em grupo
        if (gizmoAtivo && window.selectedObjects.length > 0) {
          transformControls.detach();
          
          if (window.selectedObjects.length === 1) {
            // Um único objeto - attach direto
            transformControls.attach(window.selectedObjects[0]);
          } else {
            // Múltiplos objetos - cria helper no centro
            if (!window.multiSelectHelper) {
              window.multiSelectHelper = new THREE.Object3D();
              window.multiSelectHelper.name = "MultiSelectHelper";
              scene.add(window.multiSelectHelper);
            }
            
            // Calcula centro de todos os objetos
            const center = new THREE.Vector3();
            window.selectedObjects.forEach(obj => {
              const objCenter = new THREE.Vector3();
              const bbox = new THREE.Box3().setFromObject(obj);
              bbox.getCenter(objCenter);
              center.add(objCenter);
            });
            center.divideScalar(window.selectedObjects.length);
            
            window.multiSelectHelper.position.copy(center);
            window.multiSelectHelper.rotation.set(0, 0, 0);
            window.multiSelectHelper.scale.set(1, 1, 1);
            
            transformControls.attach(window.multiSelectHelper);
          }
        } else if (!selectedObject) {
          transformControls.detach();
        }
      } else {
        // MODO SELEÇÃO ÚNICA (comportamento padrão)
        selectedObject = finalSel;
        window.selectedObjects = [finalSel]; // Mantém array consistente
        if (typeof window !== 'undefined') window.selectedObject = selectedObject;
        
        atualizarOutline(selectedObject);
        sincronizarHierarquia(selectedObject);
        
        // Remove helper se existir
        if (window.multiSelectHelper) {
          transformControls.detach();
          scene.remove(window.multiSelectHelper);
          window.multiSelectHelper = null;
        }
        
        if (gizmoAtivo) { 
          transformControls.detach(); 
          transformControls.attach(selectedObject); 
        }
      }
    }
  } else {
    // Clicou no vazio
    if (!isMultiSelectionEnabled) {
      // Apenas limpa se não estiver em modo multisseleção
      selectedObject = null;
      window.selectedObjects = [];
      if (typeof window !== 'undefined') window.selectedObject = null;
      atualizarOutline(null);
      sincronizarHierarquia(null);
      
      // Remove helper se existir
      if (window.multiSelectHelper) {
        scene.remove(window.multiSelectHelper);
        window.multiSelectHelper = null;
      }
      
      transformControls.detach();
    }
  }
}

// --- LISTENERS ---

renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
renderer.domElement.addEventListener('pointermove', onPointerMove, false);
renderer.domElement.addEventListener('pointerup', selectObject, false);

// === SISTEMA DE TRANSFORMAÇÃO PARA MULTISSELEÇÃO E UNDO/REDO ===
let isTransforming = false;
let transformStartPositions = new Map();
let transformStartRotations = new Map();
let transformStartScales = new Map();
let helperStartPosition = new THREE.Vector3();
let helperStartRotation = new THREE.Euler();
let helperStartScale = new THREE.Vector3();

if (transformControls) {
  // 1. MouseDown: Salva o estado INICIAL antes da transformação
  transformControls.addEventListener('mouseDown', () => {
    isTransforming = true;
    transformStartPositions.clear();
    transformStartRotations.clear();
    transformStartScales.clear();
    
    const attachedObject = transformControls.object;
    
    // Lista de objetos a serem transformados (Um ou Vários)
    let objectsToTransform = [];
    if (window.selectedObjects && window.selectedObjects.length > 0) {
        objectsToTransform = window.selectedObjects;
    } else if (selectedObject) {
        objectsToTransform = [selectedObject];
    }

    // Salva o estado inicial de TODOS os objetos envolvidos (seja multiselect ou single)
    objectsToTransform.forEach(obj => {
        transformStartPositions.set(obj.uuid, obj.position.clone());
        transformStartRotations.set(obj.uuid, obj.quaternion.clone());
        transformStartScales.set(obj.uuid, obj.scale.clone());
    });

    // Lógica específica para o Helper (Multisseleção)
    if (window.selectedObjects && window.selectedObjects.length > 1 && attachedObject === window.multiSelectHelper) {
      helperStartPosition.copy(attachedObject.position);
      helperStartRotation.copy(attachedObject.rotation);
      helperStartScale.copy(attachedObject.scale);
    }
  });
  
  // 2. Change: Aplica a transformação visual (lógica do Gizmo)
  transformControls.addEventListener('change', () => {
    if (!isTransforming) return;
    
    const attachedObject = transformControls.object;
    if (!attachedObject) return;
    
    // Se for multisseleção com helper, aplica a matemática de grupo
    if (window.selectedObjects && window.selectedObjects.length > 1 && attachedObject === window.multiSelectHelper) {
      const mode = transformControls.mode;
      
      if (mode === 'translate') {
        const delta = new THREE.Vector3().subVectors(attachedObject.position, helperStartPosition);
        window.selectedObjects.forEach(obj => {
          const startPos = transformStartPositions.get(obj.uuid);
          if (startPos) {
            obj.position.copy(startPos).add(delta);
          }
        });
      } else if (mode === 'rotate') {
        const helperQuat = attachedObject.quaternion.clone();
        const helperStartQuat = new THREE.Quaternion().setFromEuler(helperStartRotation);
        const deltaQuat = helperQuat.clone().multiply(helperStartQuat.clone().invert());
        
        window.selectedObjects.forEach(obj => {
          const startPos = transformStartPositions.get(obj.uuid);
          const startQuat = transformStartRotations.get(obj.uuid); // Aqui usamos Quaternion armazenado no map (se salvou como Euler, converta)
          
          if (startPos && startQuat) {
            // Nota: Se transformStartRotations salvou Quaternion no mouseDown, tudo certo.
            // Se salvou Euler, precisaria converter. No mouseDown acima, estamos salvando Quaternion.
            
            const relativePos = startPos.clone().sub(helperStartPosition);
            relativePos.applyQuaternion(deltaQuat);
            obj.position.copy(helperStartPosition).add(relativePos);
            
            obj.quaternion.copy(startQuat).premultiply(deltaQuat);
          }
        });
      } else if (mode === 'scale') {
        const scaleRatio = new THREE.Vector3(
          attachedObject.scale.x / helperStartScale.x,
          attachedObject.scale.y / helperStartScale.y,
          attachedObject.scale.z / helperStartScale.z
        );
        
        window.selectedObjects.forEach(obj => {
          const startPos = transformStartPositions.get(obj.uuid);
          const startScale = transformStartScales.get(obj.uuid);
          if (startPos && startScale) {
            const relativePos = startPos.clone().sub(helperStartPosition);
            relativePos.multiply(scaleRatio);
            obj.position.copy(helperStartPosition).add(relativePos);
            obj.scale.copy(startScale).multiply(scaleRatio);
          }
        });
      }
    }
  });
  
  // 3. MouseUp: Gera o COMANDO para o Undo/Redo
  transformControls.addEventListener('mouseUp', () => {
    isTransforming = false;

    // Lista de objetos que foram potencialmente modificados
    let modifiedObjects = [];
    if (window.selectedObjects && window.selectedObjects.length > 0) {
        modifiedObjects = window.selectedObjects;
    } else if (selectedObject) {
        modifiedObjects = [selectedObject];
    }

    if (modifiedObjects.length === 0) return;

    // Prepara os estados finais
    const endStates = new Map();
    let hasChanges = false;

    modifiedObjects.forEach(obj => {
        // Estado atual (Final)
        endStates.set(obj.uuid, {
            position: obj.position.clone(),
            quaternion: obj.quaternion.clone(),
            scale: obj.scale.clone()
        });

        // Verifica se houve mudança real comparando com o startState
        const startPos = transformStartPositions.get(obj.uuid);
        const startRot = transformStartRotations.get(obj.uuid);
        const startScl = transformStartScales.get(obj.uuid);

        if (startPos && startRot && startScl) {
            const EPSILON = 0.0001;
            if (startPos.distanceTo(obj.position) > EPSILON ||
                startRot.angleTo(obj.quaternion) > EPSILON ||
                startScl.distanceTo(obj.scale) > EPSILON) {
                hasChanges = true;
            }
        }
    });

    // Se houve mudança, cria o comando e executa
    if (hasChanges) {
        // Prepara o mapa de startStates no formato correto para o comando
        const startStatesMap = new Map();
        modifiedObjects.forEach(obj => {
            startStatesMap.set(obj.uuid, {
                position: transformStartPositions.get(obj.uuid),
                quaternion: transformStartRotations.get(obj.uuid),
                scale: transformStartScales.get(obj.uuid)
            });
        });

        const cmd = new TransformCommand(modifiedObjects, startStatesMap, endStates);
        commandManager.execute(cmd);
    }
  });
}

const btnMov = document.getElementById('mov');
const btnScl = document.getElementById('scl');
const btnRot = document.getElementById('rot');
const btnDesativ = document.getElementById('desativ');
const btnAtiv = document.getElementById('ativ');
const btnNormal = document.getElementById('normal');
const btnEdicao = document.getElementById('edição');
const btnAnim = document.getElementById('animation-md');
const btnVertices = document.getElementById('vertices');
const btnEdges = document.getElementById('edges');
const btnFaces = document.getElementById('faces');
const btnLoopCut = document.getElementById('loopcut');
const btnLineCut = document.getElementById('linecut');
const btnSmooth = document.getElementById('smoth');
const btnExtrudFace = document.getElementById('extrudFace');
const btnExtrudEdge = document.getElementById('extrudedge');
const btnInvertFace = document.getElementById('invertFace');
const btnSubdivision = document.getElementById('subdivision');

// Listener para o checkbox de multisseleção
const multiSelCheckbox = document.getElementById('multselection');
if (multiSelCheckbox) {
  multiSelCheckbox.addEventListener('change', (e) => {
    if (!e.target.checked) {
      // Desmarcou o checkbox - limpa multisseleção
      if (modoAtual === 'normal') {
        // Modo Object
        if (window.selectedObjects && window.selectedObjects.length > 1) {
          // Mantém apenas o primeiro objeto selecionado
          const firstObj = window.selectedObjects[0];
          window.selectedObjects = firstObj ? [firstObj] : [];
          selectedObject = firstObj || null;
          window.selectedObject = selectedObject;
          
          atualizarOutline(selectedObject);
          sincronizarHierarquia(selectedObject);
          
          // Remove helper e reattach no objeto único
          if (window.multiSelectHelper) {
            transformControls.detach();
            scene.remove(window.multiSelectHelper);
            window.multiSelectHelper = null;
          }
          
          if (gizmoAtivo && selectedObject) {
            transformControls.attach(selectedObject);
          }
        }
      } else if (modoAtual === 'edicao') {
        // Modo Modeling
        // Limpa seleções múltiplas de vértices
        if (selectedVertices && selectedVertices.length > 1) {
          const firstVertex = selectedVertices[0];
          selectedVertices.forEach((id, idx) => {
            if (idx > 0 && vertexInstancedMesh) {
              vertexInstancedMesh.setColorAt(id, new THREE.Color(0x000000));
            }
          });
          selectedVertices = firstVertex !== undefined ? [firstVertex] : [];
          if (vertexInstancedMesh) vertexInstancedMesh.instanceColor.needsUpdate = true;
        }
        
        // Limpa seleções múltiplas de arestas
        if (window.selectedEdges && window.selectedEdges.length > 1) {
          const firstEdge = window.selectedEdges[0];
          window.edgeHighlights.forEach((h, idx) => {
            if (idx > 0) {
              scene.remove(h);
              h.geometry.dispose();
              h.material.dispose();
            }
          });
          window.selectedEdges = firstEdge !== undefined ? [firstEdge] : [];
          window.edgeHighlights = window.edgeHighlights.slice(0, 1);
          selectedEdge = firstEdge !== undefined ? firstEdge : null;
        }
        
        // Limpa seleções múltiplas de faces
        if (window.selectedFaces && window.selectedFaces.length > 1) {
          const firstFace = window.selectedFaces[0];
          window.faceHighlights.forEach((h, idx) => {
            if (idx > 0) {
              scene.remove(h);
              h.geometry.dispose();
              h.material.dispose();
            }
          });
          window.selectedFaces = firstFace !== undefined ? [firstFace] : [];
          window.faceHighlights = window.faceHighlights.slice(0, 1);
          selectedFace = firstFace !== undefined ? firstFace : null;
        }
      }
    } else {
      // Marcou o checkbox - converte seleção única em array se necessário
      if (modoAtual === 'normal' && selectedObject && (!window.selectedObjects || window.selectedObjects.length === 0)) {
        window.selectedObjects = [selectedObject];
      }
    }
  });
}

if (btnMov) btnMov.addEventListener('click', () => setModoGizmo('translate'));
if (btnScl) btnScl.addEventListener('click', () => setModoGizmo('scale'));
if (btnRot) btnRot.addEventListener('click', () => setModoGizmo('rotate'));
if (btnDesativ) btnDesativ.addEventListener('click', () => desativarGizmo());
if (btnAtiv) btnAtiv.addEventListener('click', () => ativarGizmo());

if (btnNormal) btnNormal.addEventListener('click', () => {
    sairModoEdicao(); 
    modoAtual = 'normal';
    
    // Limpa highlights de edição ao sair do modo
    if (typeof window.limparHighlightsEdicao === 'function') {
        window.limparHighlightsEdicao();
    }
    
    if (selectedObject) atualizarOutline(selectedObject);
    if (typeof AnimationTimeline !== 'undefined') AnimationTimeline.hide();
});

if (btnEdicao) btnEdicao.addEventListener('click', () => {
    entrarModoEdicao(); atualizarOutline(null);
    if (window.editingMesh) updateBVH(window.editingMesh);
    if (typeof AnimationTimeline !== 'undefined') AnimationTimeline.hide();
});

if (btnAnim) btnAnim.addEventListener('click', () => {
    if (modoAtual === 'edicao') {
        sairModoEdicao();
        
        // Limpa highlights de edição ao sair do modo
        if (typeof window.limparHighlightsEdicao === 'function') {
            window.limparHighlightsEdicao();
        }
    }
    
    modoAtual = 'animacao';
    if (typeof menu5_none === 'function') menu5_none();
    if (typeof menu6_none === 'function') menu6_none();
    if (typeof AnimationTimeline !== 'undefined') AnimationTimeline.show();
    if (selectedObject) atualizarOutline(selectedObject);
});

if (btnVertices) btnVertices.addEventListener('click', () => {
    if (modoAtual === 'edicao') {
      // Limpa highlights ao trocar de submodo
      if (typeof window.limparHighlightsEdicao === 'function') {
        window.limparHighlightsEdicao();
      }
      
      submodoEdicao = 'vertex'; 
      atualizarSubmodoEdicao();
      if(typeof menu5_none === 'function') menu5_none(); 
      if(typeof menu6_none === 'function') menu6_none();
    }
});

if (btnEdges) btnEdges.addEventListener('click', () => {
    if (modoAtual === 'edicao') {
      // Limpa highlights ao trocar de submodo
      if (typeof window.limparHighlightsEdicao === 'function') {
        window.limparHighlightsEdicao();
      }
      
      submodoEdicao = 'edge'; 
      atualizarSubmodoEdicao();
      if(typeof menu5_none === 'function') menu5_none(); 
      if(typeof menu6_show === 'function') menu6_show();
    }
});

if (btnFaces) btnFaces.addEventListener('click', () => {
    if (modoAtual === 'edicao') {
      // Limpa highlights ao trocar de submodo
      if (typeof window.limparHighlightsEdicao === 'function') {
        window.limparHighlightsEdicao();
      }
      
      submodoEdicao = 'face'; 
      atualizarSubmodoEdicao();
      if(typeof menu5_show === 'function') menu5_show(); 
      if(typeof menu6_none === 'function') menu6_none();
    }
});

if (btnLoopCut) btnLoopCut.addEventListener('click', () => {
    if (loopCutMode) {
      loopCutMode = false; if (typeof limparLoopCutPreview === 'function') limparLoopCutPreview(); controls.enabled = true;
    } else { ativarLoopCut(); updateBVH(window.editingMesh); }
});

if (btnLineCut) btnLineCut.addEventListener('click', () => {
    if (loopCutMode) {
      loopCutMode = false; if (typeof limparLoopCutPreview === 'function') limparLoopCutPreview(); controls.enabled = true;
    } else { ativarLoopCut(); updateBVH(window.editingMesh); }
});

if (btnSmooth) btnSmooth.addEventListener('click', () => { aplicarSmooth(2, 0.5); updateBVH(window.editingMesh); });
if (btnExtrudFace) btnExtrudFace.addEventListener('click', () => { extrudirFace(0.01); updateBVH(window.editingMesh); });
if (btnExtrudEdge) btnExtrudEdge.addEventListener('click', () => { extrudirAresta(0.01); updateBVH(window.editingMesh); });
if (btnInvertFace) btnInvertFace.addEventListener('click', () => { inverterFace(); updateBVH(window.editingMesh); });
if (btnSubdivision) btnSubdivision.addEventListener('click', () => { aplicarSubdivision(); updateBVH(window.editingMesh); });

window.make_box = function(p) { if (typeof createBox === 'function') createBox(); }
window.make_plan = function(p) { if (typeof createPlane === 'function') createPlane(); }