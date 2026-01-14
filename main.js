const scene = new THREE.Scene();
scene.background = new THREE.Color(0x323232);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(3, 4, 3);
camera.lookAt(0, 0, 0);

const canvas = document.getElementById("myCanvas");

const renderer = new THREE.WebGLRenderer({
	canvas: canvas,
	antialias: true,
});

renderer.setPixelRatio(window.devicePixelRatio / 1.8);
renderer.setSize(window.innerWidth, window.innerHeight);

const grid = new THREE.GridHelper(200, 200, 0x515151, 0x404040);
scene.add(grid);

scene.fog = new THREE.Fog(
	0x323232, // cor da névoa (igual fundo do editor)
	50, // distância inicial
	130 // distância final
);




// --- ATUALIZAÇÃO AQUI ---
// Criamos os controles
const controls = new THREE.OrbitControls(camera, renderer.domElement);

// 1. Expomos o controls no window para garantir acesso externo
window.controls = controls;

// 2. Função dedicada para ativar/desativar
window.setOrbitControls = function(enabled) {
	if (window.controls) {
		window.controls.enabled = enabled;
		// Se desativar, forçamos um update para parar inércia imediatamente
		if (!enabled) window.controls.update();
	}
};
// ------------------------

// defult Light 
const light = new THREE.DirectionalLight(0xffffff, 0.8);
light.position.set(5, 10, 5);
scene.add(light);

const ambient = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambient);

function animate() {
	requestAnimationFrame(animate);
	renderer.render(scene, camera);
	
	// Pequena otimização: não precisa clonar vetores a cada frame se não for necessário,
	// mas mantive sua lógica original de luz seguindo a câmera.
	light.position.copy(camera.position);
	light.target.position.copy(
		camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()))
	);
	light.target.updateMatrixWorld();
}
animate();

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});