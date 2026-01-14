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
// 1. Instanciação e Configuração
const transformControls = new THREE.TransformControls(camera, renderer.domElement);

transformControls.space = 'world';


// CRÍTICO: Adicione sempre à raiz da cena para evitar herança de escala de grupos pais
scene.add(transformControls);

// 2. O "Hard Reset" para evitar Pulos
transformControls.addEventListener('dragging-changed', function(event) {
	const isDragging = event.value; // true = arrastando, false = soltou
	
	// A. Gerencia o conflito com a câmera
	
	// B. Lógica de Zeragem ao soltar (Mouse Up / Touch End)
	if (!isDragging) {
		const object = transformControls.object;
		
		if (object) {
			// Passo 1: Consolida a matriz do objeto para garantir que o Three.js
			// aceite a nova posição como absoluta.
			object.updateMatrixWorld(true);
			
			// Passo 2: O TRUQUE DO RESET
			// Ao desanexar e anexar imediatamente, limpamos o cache de 
			// "offset" interno do controle. O próximo clique começará do zero real.
			transformControls.detach();
			transformControls.attach(object);
			
			console.log('TransformControl resetado e sincronizado.');
		}
	}
});

// 3. Renderização (Sem lógica de posição aqui)
transformControls.addEventListener('change', function() {
	// Apenas chame seu renderizador se não tiver loop de animação (requestAnimationFrame)
	// render(); 
});

// Exemplo de uso:
// Para ativar a edição em um mesh:
// transformControls.attach(window.editingMesh);

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