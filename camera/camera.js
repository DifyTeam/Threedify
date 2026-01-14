// Camera.js
// =========================================================
// CAMERA RIG - FOV FIX & TOUCH BLOCK
// =========================================================

// --- 1. CRIAÇÃO DO OBJETO (ESTRUTURA HIERÁRQUICA) ---
function createCameraObject(color = 0x4bf3c9) {
  // GRUPO PAI (RIG): Esse grupo NUNCA muda de escala. Sempre será 1,1,1.
  // A câmera será filha deste grupo, evitando distorção de FOV.
  const rigGroup = new THREE.Group();
  
  // GRUPO VISUAL: Esse grupo contém as linhas e será escalado (0.4)
  const visualsGroup = new THREE.Group();
  rigGroup.add(visualsGroup); // O visual está dentro do Rig
  
  const lineMaterial = new THREE.LineBasicMaterial({
    color: color,
    depthTest: false,
    opacity: 0.8,
    transparent: true
  });
  
  // --- DESENHO (Adicionado ao visualsGroup) ---
  const bodyGeo = new THREE.BoxGeometry(1.5, 1.0, 2.5);
  const bodyLines = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo), lineMaterial);
  bodyLines.position.z = 1.25;
  visualsGroup.add(bodyLines);
  
  const reelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.3, 16); 
  reelGeo.rotateX(Math.PI/2); reelGeo.rotateY(Math.PI/2);
  const reelEdges = new THREE.EdgesGeometry(reelGeo);
  const reel1 = new THREE.LineSegments(reelEdges, lineMaterial); 
  reel1.position.set(0, 1.0, 0.6); visualsGroup.add(reel1);
  const reel2 = reel1.clone(); 
  reel2.position.set(0, 1.0, 1.9); visualsGroup.add(reel2);
  
  const lensGeo = new THREE.CylinderGeometry(0.5, 1.0, 1.0, 4, 1, true); 
  lensGeo.rotateY(Math.PI/4); lensGeo.rotateX(Math.PI/2);
  const lensLines = new THREE.LineSegments(new THREE.EdgesGeometry(lensGeo), lineMaterial);
  lensLines.position.z = -0.5; visualsGroup.add(lensLines);

  const points = [
      new THREE.Vector3(0,0,-1), new THREE.Vector3(-6,4,-10), new THREE.Vector3(0,0,-1), new THREE.Vector3(6,4,-10),
      new THREE.Vector3(0,0,-1), new THREE.Vector3(-6,-4,-10), new THREE.Vector3(0,0,-1), new THREE.Vector3(6,-4,-10),
      new THREE.Vector3(-6,4,-10), new THREE.Vector3(6,4,-10), new THREE.Vector3(6,4,-10), new THREE.Vector3(6,-4,-10),
      new THREE.Vector3(6,-4,-10), new THREE.Vector3(-6,-4,-10), new THREE.Vector3(-6,-4,-10), new THREE.Vector3(-6,4,-10)
  ];
  visualsGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
  
  // Guardamos referência do grupo visual para aplicar a escala depois
  rigGroup.userData.visuals = visualsGroup;
  
  return rigGroup;
}

// --- 2. SETUP INICIAL ---

const myCamVisual = createCameraObject(0x00ffcc);
myCamVisual.name = "Main Camera Rig";

// CONFIGURAÇÃO DE ESCALA SEGURA
const cam_size = 0.4;
// Aplicamos a escala APENAS no grupo visual interno.
// O myCamVisual (Pai) continua com escala 1,1,1.
myCamVisual.userData.visuals.scale.set(cam_size, cam_size, cam_size);

myCamVisual.position.set(0, 4, 8);

selectableObjects.push(myCamVisual);
scene.add(myCamVisual);

// Salva a função original de raycast para restaurar depois
const originalRaycast = myCamVisual.raycast;

// --- 3. DETECÇÃO DE PLAY ---
function checkIsPlaying() {
    if (window.AnimationTimeline && window.AnimationTimeline.isPlaying) return true;
    const btn = document.getElementById('btn-play');
    if (btn && (btn.innerText === '❚❚' || btn.innerText.includes('Stop'))) return true;
    return false;
}

// --- 4. LÓGICA CORE ---

let isCameraViewActive = false;
let isParented = false;

const savedEditorState = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  target: new THREE.Vector3()
};

function updateCameraLogic() {
    if (!isCameraViewActive) return;

    const orbital = window.controls || window.orbitControls;
    const isPlaying = checkIsPlaying();

    if (isPlaying) {
        // --- MODO PLAY (ANIMAÇÃO) ---
        
        if (orbital && orbital.enabled) orbital.enabled = false;

        if (!isParented) {
            // Adiciona a Câmera ao RIG (Escala 1), não ao Visual (Escala 0.4)
            myCamVisual.add(camera);
            camera.position.set(0, 0, 0);
            camera.quaternion.set(0, 0, 0, 1);
            
            // Garante que a câmera tenha escala 1
            camera.scale.set(1, 1, 1);
            
            isParented = true;
        }

    } else {
        // --- MODO PAUSE (EDITAR) ---

        if (isParented) {
            scene.attach(camera);
            isParented = false;
            
            if (orbital) {
                orbital.enabled = true;
                const forward = new THREE.Vector3(0, 0, -5).applyQuaternion(camera.quaternion).add(camera.position);
                orbital.target.copy(forward);
                orbital.update();
            }
        }

        if (orbital && !orbital.enabled) orbital.enabled = true;

        // Visual segue Câmera
        myCamVisual.position.copy(camera.position);
        myCamVisual.quaternion.copy(camera.quaternion);
        myCamVisual.updateMatrix();
        myCamVisual.updateMatrixWorld(true);
    }

    requestAnimationFrame(updateCameraLogic);
}


// --- 5. EVENTOS UI ---

const camButton = document.getElementById('cam');

if (camButton) {
  camButton.addEventListener('click', () => {
    const orbital = window.controls || window.orbitControls;

    if (!isCameraViewActive) {
      // >>> ENTRAR NA CÂMERA
      
      savedEditorState.position.copy(camera.position);
      savedEditorState.quaternion.copy(camera.quaternion);
      if (orbital) savedEditorState.target.copy(orbital.target);

      // Sincronizar Posição
      const targetPos = new THREE.Vector3();
      const targetQuat = new THREE.Quaternion();
      myCamVisual.getWorldPosition(targetPos);
      myCamVisual.getWorldQuaternion(targetQuat);
      
      camera.position.copy(targetPos);
      camera.quaternion.copy(targetQuat);

      if (orbital) {
          const forward = new THREE.Vector3(0, 0, -10).applyQuaternion(targetQuat).add(targetPos);
          orbital.target.copy(forward);
          orbital.update();
      }

      // --- BLOQUEIO DE SELEÇÃO (CORREÇÃO DO BUG DE TOQUE) ---
      // 1. Remove da lista de selecionáveis
      const index = selectableObjects.indexOf(myCamVisual);
      if (index > -1) selectableObjects.splice(index, 1);
      
      // 2. Desativa a função de Raycast do objeto
      // Isso torna o objeto "fantasma" para o toque, impossível de clicar
      myCamVisual.raycast = function() {}; 
      
      // 3. Esconde apenas as linhas (visuals), mas mantem o Rig ativo
      myCamVisual.userData.visuals.visible = false;
      
      if(window.transformControl) window.transformControl.detach();

      isCameraViewActive = true;
      isParented = false; 
      updateCameraLogic(); 
      
      console.log("Modo Câmera: ON (Interação Bloqueada)");

    } else {
      // >>> SAIR DA CÂMERA
      
      isCameraViewActive = false;

      if (isParented) { scene.attach(camera); isParented = false; }
      
      if (orbital) {
          orbital.enabled = true;
          orbital.target.copy(savedEditorState.target);
      }
      camera.position.copy(savedEditorState.position);
      camera.quaternion.copy(savedEditorState.quaternion);
      if (orbital) orbital.update();

      // --- RESTAURAÇÃO ---
      myCamVisual.userData.visuals.visible = true; // Mostra linhas
      myCamVisual.raycast = originalRaycast; // Restaura clique
      selectableObjects.push(myCamVisual); // Volta pra lista
      
      console.log("Modo Câmera: OFF");
    }
  });
}

const lockedScale = myCamVisual.scale;

Object.defineProperties(lockedScale, {
  // Se tentar ler (get), retorna o tamanho fixo.
  // Se tentar escrever (set), não faz nada (ignora o comando).
  x: { get: () => cam_size, set: () => {} },
  y: { get: () => cam_size, set: () => {} },
  z: { get: () => cam_size, set: () => {} },
  
  // Também desativamos os métodos .set() e .copy() do Vector3
  set: { value: function() { return this; } },
  copy: { value: function() { return this; } }
});
