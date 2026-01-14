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

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedObject = null;
const selectableObjects = [];
let pointerDownTime = 0;
let pointerDownPos = { x: 0, y: 0 };
let gizmoAtivo = true;

// TransformControls
const transformControls = new THREE.TransformControls(camera, renderer.domElement);
scene.add(transformControls);
transformControls.setSize(2);

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
			editHelper.quaternion.set(0,0,0,1);
			editHelper.scale.set(1,1,1);
		}
	}
});

// ========== FUNÇÕES DE CONTROLE DO GIZMO ==========

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

// ========== SISTEMA DE EDIÇÃO DE MALHA ==========

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

// ========== NOVAS VARIÁVEIS PARA FERRAMENTAS ==========
let loopCutMode = false;
let loopCutPreviewLine = null;
let loopCutCurrentLoop = null;
let extrusionAmount = 0.5;

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

// Função para entrar no modo edição
function entrarModoEdicao() {
	if (!selectedObject) {
		console.warn('Nenhum objeto selecionado');
		return;
	}
	
	menu4_show()
	modes_edit()
	
	
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
		console.warn('Objeto selecionado não possui geometria');
		return;
	}
	
	window.originalSelectedObject = selectedObject;
	window.editingMesh = objetoComGeometria;
	
	modoAtual = 'edicao';
	desativarGizmo();
	
	const geometry = objetoComGeometria.geometry;
	if (!geometry.attributes || !geometry.attributes.position) {
		console.warn('Geometria sem atributo position');
		return;
	}
	
	try {
		const merged = mergeVertices(geometry);
		uniqueVertices = merged.unique;
		vertexMapping = merged.mapping;
		
		if (uniqueVertices.length === 0) {
			console.error('Falha ao mesclar vértices');
			sairModoEdicao();
			return;
		}
		
		edges = detectEdges(geometry, vertexMapping);
		faces = detectFaces(geometry, vertexMapping);
		
		console.log('Modo edição ativado:', {
			
			vertices: uniqueVertices.length,
			edges: edges.length,
			faces: faces.length
		});
		
		atualizarSubmodoEdicao();
	} catch (error) {
		console.error('Erro ao entrar no modo edição:', error);
		sairModoEdicao();
	}
}

// Atualiza visualização do submodo
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

// Função para sair do modo edição
function sairModoEdicao() {
	modoAtual = 'normal';
	limparHelpersEdicao();
	limparLoopCutPreview();
	loopCutMode = false;
	
	menu4_none()
	modes_obj()
	menu6_none()
	menu5_none()
	
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

// Limpa helpers
function limparHelpersEdicao() {
	if (vertexInstancedMesh) {
		scene.remove(vertexInstancedMesh);
		vertexInstancedMesh.geometry.dispose();
		vertexInstancedMesh.material.dispose();
		vertexInstancedMesh = null;
	}
	if (edgeLines) {
		scene.remove(edgeLines);
		edgeLines.geometry.dispose();
		edgeLines.material.dispose();
		edgeLines = null;
	}
	if (edgeHighlight) {
		scene.remove(edgeHighlight);
		edgeHighlight.geometry.dispose();
		edgeHighlight.material.dispose();
		edgeHighlight = null;
	}
	if (faceLines) {
		scene.remove(faceLines);
		faceLines.geometry.dispose();
		faceLines.material.dispose();
		faceLines = null;
	}
	if (faceHighlight) {
		scene.remove(faceHighlight);
		faceHighlight.geometry.dispose();
		faceHighlight.material.dispose();
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
	transformControls.detach();
}

// Mostra vértices
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

// Mostra arestas
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

// Mostra faces
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

// Encontra aresta mais próxima do clique
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

// Encontra face mais próxima do clique
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

// Seleciona vértice
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
	
	editHelper.quaternion.set(0,0,0,1);
	editHelper.scale.set(1,1,1);
	initialEditPosition = editHelper.position.clone();
	initialVertexPositions = {};
	initialVertexPositions[instanceId] = position.clone();
	selectedUniqueIndices = [instanceId];
	
	transformControls.detach();
	transformControls.attach(editHelper);
	gizmoAtivo = true;
	
	console.log(`Vértice ${instanceId} selecionado`);
}

// Seleciona aresta
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
	
	editHelper.quaternion.set(0,0,0,1);
	editHelper.scale.set(1,1,1);
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

// Seleciona face
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
	
	editHelper.quaternion.set(0,0,0,1);
	editHelper.scale.set(1,1,1);
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

// Atualiza vértices
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

// Atualiza aresta
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

// Atualiza face
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

// ========== NOVAS FUNCIONALIDADES ==========

// ========== LOOP CUT (CORRIGIDO) ==========
function ativarLoopCut() {
	if (modoAtual !== 'edicao') {
		console.warn('Entre no modo edição primeiro');
		return;
	}
	
	loopCutMode = true;
	desativarGizmo();
	controls.enabled = false;
	
	console.log('Modo Loop Cut ativado - arraste sobre o modelo para criar loop');
}

function limparLoopCutPreview() {
	if (loopCutPreviewLine) {
		scene.remove(loopCutPreviewLine);
		loopCutPreviewLine.geometry.dispose();
		loopCutPreviewLine.material.dispose();
		loopCutPreviewLine = null;
	}
	loopCutCurrentLoop = null;
}

// Detecta loop de arestas a partir de um ponto
function detectarLoopAPartirDePonto(intersectionPoint) {
	if (!window.editingMesh) return null;
	
	const matrixWorld = window.editingMesh.matrixWorld;
	
	// Encontra a aresta mais próxima do ponto de interseção
	let closestEdgeIdx = null;
	let minDist = Infinity;
	
	edges.forEach((edge, idx) => {
		if (!uniqueVertices[edge[0]] || !uniqueVertices[edge[1]]) return;
		
		const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
		const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
		
		const line = new THREE.Line3(v1, v2);
		const closestPoint = new THREE.Vector3();
		line.closestPointToPoint(intersectionPoint, true, closestPoint);
		
		const dist = intersectionPoint.distanceTo(closestPoint);
		if (dist < minDist) {
			minDist = dist;
			closestEdgeIdx = idx;
		}
	});
	
	if (closestEdgeIdx === null) return null;
	
	// Constrói o loop a partir desta aresta
	const loopEdges = [closestEdgeIdx];
	const visitedEdges = new Set([closestEdgeIdx]);
	
	// Função para encontrar arestas paralelas conectadas
	function expandLoop(currentEdgeIdx) {
		const currentEdge = edges[currentEdgeIdx];
		
		// Encontra faces que contêm esta aresta
		const connectedFaces = [];
		faces.forEach((face, faceIdx) => {
			const hasV1 = face.includes(currentEdge[0]);
			const hasV2 = face.includes(currentEdge[1]);
			if (hasV1 && hasV2) {
				connectedFaces.push(faceIdx);
			}
		});
		
		// Para cada face, encontra aresta oposta (em quads)
		connectedFaces.forEach(faceIdx => {
			const face = faces[faceIdx];
			if (face.length !== 4) return; // Apenas quads
			
			const v1Idx = face.indexOf(currentEdge[0]);
			const v2Idx = face.indexOf(currentEdge[1]);
			
			if (v1Idx === -1 || v2Idx === -1) return;
			
			// Verifica se é uma aresta válida do quad
			const isAdjacent = Math.abs(v1Idx - v2Idx) === 1 || 
			                   (v1Idx === 0 && v2Idx === 3) || 
			                   (v1Idx === 3 && v2Idx === 0);
			
			if (!isAdjacent) return;
			
			// Aresta oposta
			const oppositeV1Idx = (v1Idx + 2) % 4;
			const oppositeV2Idx = (v2Idx + 2) % 4;
			const oppositeV1 = face[oppositeV1Idx];
			const oppositeV2 = face[oppositeV2Idx];
			
			// Encontra esta aresta no array de arestas
			edges.forEach((edge, edgeIdx) => {
				if (visitedEdges.has(edgeIdx)) return;
				
				if ((edge[0] === oppositeV1 && edge[1] === oppositeV2) ||
					(edge[0] === oppositeV2 && edge[1] === oppositeV1)) {
					loopEdges.push(edgeIdx);
					visitedEdges.add(edgeIdx);
				}
			});
		});
	}
	
	// Expande o loop
	let prevLength = 0;
	let iterations = 0;
	const maxIterations = 100;
	
	while (loopEdges.length !== prevLength && iterations < maxIterations) {
		prevLength = loopEdges.length;
		const currentEdges = [...loopEdges];
		currentEdges.forEach(edgeIdx => expandLoop(edgeIdx));
		iterations++;
	}
	
	return loopEdges;
}

function mostrarLoopCutPreview(loopEdges) {
	limparLoopCutPreview();
	
	if (!loopEdges || loopEdges.length === 0) return;
	
	const matrixWorld = window.editingMesh.matrixWorld;
	const positions = [];
	
	loopEdges.forEach(edgeIdx => {
		const edge = edges[edgeIdx];
		if (!uniqueVertices[edge[0]] || !uniqueVertices[edge[1]]) return;
		
		const v1 = uniqueVertices[edge[0]].clone().applyMatrix4(matrixWorld);
		const v2 = uniqueVertices[edge[1]].clone().applyMatrix4(matrixWorld);
		positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
	});
	
	if (positions.length === 0) return;
	
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	
	const material = new THREE.LineBasicMaterial({ 
		color: 0xffffff, 
		linewidth: 4,
		transparent: true,
		opacity: 0.9
	});
	
	loopCutPreviewLine = new THREE.LineSegments(geometry, material);
	scene.add(loopCutPreviewLine);
}

function aplicarLoopCut() {
	if (!loopCutCurrentLoop || loopCutCurrentLoop.length === 0) {
		console.warn('Nenhum loop detectado');
		return;
	}
	
	const geometry = window.editingMesh.geometry;
	const matrixWorld = window.editingMesh.matrixWorld;
	const matrixWorldInverse = new THREE.Matrix4().copy(matrixWorld).invert();
	
	// Cria novos vértices no meio de cada aresta do loop
	const edgeToNewVertex = new Map();
	
	loopCutCurrentLoop.forEach(edgeIdx => {
		const edge = edges[edgeIdx];
		const v1 = uniqueVertices[edge[0]];
		const v2 = uniqueVertices[edge[1]];
		
		if (!v1 || !v2) return;
		
		// Vértice no meio
		const midPoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
		const newVertexIndex = uniqueVertices.length;
		uniqueVertices.push(midPoint);
		edgeToNewVertex.set(edgeIdx, newVertexIndex);
	});
	
	// Reconstrói faces subdividindo as que cruzam o loop
	const newFaces = [];
	
	faces.forEach((face, faceIdx) => {
		// Encontra quais arestas desta face fazem parte do loop
		const faceLoopEdges = [];
		
		for (let i = 0; i < face.length; i++) {
			const v1 = face[i];
			const v2 = face[(i + 1) % face.length];
			
			loopCutCurrentLoop.forEach(loopEdgeIdx => {
				const loopEdge = edges[loopEdgeIdx];
				if ((loopEdge[0] === v1 && loopEdge[1] === v2) ||
					(loopEdge[0] === v2 && loopEdge[1] === v1)) {
					faceLoopEdges.push({
						edgeIdx: loopEdgeIdx,
						position: i,
						newVertexIdx: edgeToNewVertex.get(loopEdgeIdx)
					});
				}
			});
		}
		
		// Se a face tem arestas do loop, subdivide
		if (faceLoopEdges.length === 0) {
			newFaces.push(face);
		} else if (faceLoopEdges.length === 1 && face.length === 4) {
			// Quad com 1 aresta do loop - divide em 2
			const loopEdge = faceLoopEdges[0];
			const newVertIdx = loopEdge.newVertexIdx;
			const pos = loopEdge.position;
			
			// Cria 2 faces
			const face1 = [
				face[pos],
				newVertIdx,
				face[(pos + 2) % 4],
				face[(pos + 3) % 4]
			];
			
			const face2 = [
				newVertIdx,
				face[(pos + 1) % 4],
				face[(pos + 2) % 4]
			];
			
			newFaces.push(face1);
			if (face2.length >= 3) newFaces.push(face2);
			
		} else if (faceLoopEdges.length === 2 && face.length === 4) {
			// Quad com 2 arestas do loop - divide em 4
			const edge1 = faceLoopEdges[0];
			const edge2 = faceLoopEdges[1];
			
			const newV1 = edge1.newVertexIdx;
			const newV2 = edge2.newVertexIdx;
			
			// Cria ponto central
			const centerVertex = new THREE.Vector3()
				.addVectors(uniqueVertices[newV1], uniqueVertices[newV2])
				.multiplyScalar(0.5);
			const centerIdx = uniqueVertices.length;
			uniqueVertices.push(centerVertex);
			
			// 4 novas faces menores
			newFaces.push([face[0], newV1, centerIdx, face[3]]);
			newFaces.push([newV1, face[1], newV2, centerIdx]);
			newFaces.push([centerIdx, newV2, face[2], face[3]]);
			
		} else {
			// Outros casos - mantém face original
			newFaces.push(face);
		}
	});
	
	faces.length = 0;
	faces.push(...newFaces);
	
	// Reconstrói geometria
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
	
	limparLoopCutPreview();
	loopCutMode = false;
	controls.enabled = true;
	atualizarSubmodoEdicao();
	
	console.log('Loop cut aplicado com sucesso');
}

// ========== SMOOTH ==========
function aplicarSmooth(iterations = 1, factor = 0.5) {
	if (modoAtual !== 'edicao' || !window.editingMesh) {
		console.warn('Modo edição não ativo');
		return;
	}
	
	const geometry = window.editingMesh.geometry;
	
	// Algoritmo de suavização Laplaciana
	for (let iter = 0; iter < iterations; iter++) {
		const newPositions = uniqueVertices.map(v => v.clone());
		
		// Para cada vértice, calcula a média dos vizinhos
		uniqueVertices.forEach((vertex, vIdx) => {
			const neighbors = [];
			
			edges.forEach(edge => {
				if (edge[0] === vIdx && uniqueVertices[edge[1]]) {
					neighbors.push(uniqueVertices[edge[1]]);
				} else if (edge[1] === vIdx && uniqueVertices[edge[0]]) {
					neighbors.push(uniqueVertices[edge[0]]);
				}
			});
			
			if (neighbors.length > 0) {
				const centroid = new THREE.Vector3();
				neighbors.forEach(n => centroid.add(n));
				centroid.divideScalar(neighbors.length);
				
				newPositions[vIdx].lerp(centroid, factor);
			}
		});
		
		newPositions.forEach((pos, idx) => {
			if (uniqueVertices[idx]) {
				uniqueVertices[idx].copy(pos);
			}
		});
	}
	
	// Atualiza geometria
	const positions = geometry.attributes.position.array;
	for (let originalIndex in vertexMapping) {
		const uniqueIndex = vertexMapping[originalIndex];
		if (uniqueVertices[uniqueIndex]) {
			const i = parseInt(originalIndex) * 3;
			if (i + 2 < positions.length) {
				positions[i] = uniqueVertices[uniqueIndex].x;
				positions[i + 1] = uniqueVertices[uniqueIndex].y;
				positions[i + 2] = uniqueVertices[uniqueIndex].z;
			}
		}
	}
	
	geometry.attributes.position.needsUpdate = true;
	geometry.computeVertexNormals();
	
	atualizarSubmodoEdicao();
	console.log(`Smooth aplicado: ${iterations} iteração(ões)`);
}

// ========== EXTRUDE FACE (CORRIGIDO) ==========
function extrudirFace(amount = 0.5) {
	if (modoAtual !== 'edicao' || submodoEdicao !== 'face' || selectedFace === null) {
		console.warn('Selecione uma face primeiro');
		return;
	}
	
	const face = faces[selectedFace];
	if (!face || face.length < 3) {
		console.warn('Face inválida');
		return;
	}
	
	const geometry = window.editingMesh.geometry;
	const matrixWorld = window.editingMesh.matrixWorld;
	const matrixWorldInverse = new THREE.Matrix4().copy(matrixWorld).invert();
	
	// Calcula normal da face
	const faceVerts = face.map(vIdx => uniqueVertices[vIdx]);
	const v1 = faceVerts[0];
	const v2 = faceVerts[1];
	const v3 = faceVerts[2];
	
	const edge1 = new THREE.Vector3().subVectors(v2, v1);
	const edge2 = new THREE.Vector3().subVectors(v3, v1);
	const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
	
	// Cria novos vértices deslocados
	const newVertexIndices = [];
	face.forEach(vIdx => {
		const originalVert = uniqueVertices[vIdx];
		const newVert = originalVert.clone().add(normal.clone().multiplyScalar(amount));
		const newIdx = uniqueVertices.length;
		uniqueVertices.push(newVert);
		newVertexIndices.push(newIdx);
	});
	
	// Nova face no topo (ordem correta para manter normal)
	const newTopFace = [...newVertexIndices];
	
	// Faces laterais
	const newSideFaces = [];
	for (let i = 0; i < face.length; i++) {
		const currentOld = face[i];
		const nextOld = face[(i + 1) % face.length];
		const currentNew = newVertexIndices[i];
		const nextNew = newVertexIndices[(i + 1) % face.length];
		
		// Quad lateral (ordem correta)
		newSideFaces.push([currentOld, nextOld, nextNew, currentNew]);
	}
	
	// Remove face antiga e adiciona novas
	faces.splice(selectedFace, 1);
	faces.push(newTopFace);
	newSideFaces.forEach(f => faces.push(f));
	
	// Reconstrói geometria
	reconstruirGeometria();
	
	// Seleciona automaticamente a face extrudida (face no topo)
	const newTopFaceIndex = faces.findIndex(f => 
		JSON.stringify(f) === JSON.stringify(newTopFace)
	);
	
	if (newTopFaceIndex !== -1) {
		selectedFace = newTopFaceIndex;
		selecionarFace(newTopFaceIndex);
	}
	
	console.log('Face extrudida com sucesso');
}

// ========== EXTRUDE EDGE (CORRIGIDO) ==========
function extrudirAresta(amount = 0.5) {
	if (modoAtual !== 'edicao' || submodoEdicao !== 'edge' || selectedEdge === null) {
		console.warn('Selecione uma aresta primeiro');
		return;
	}
	
	const edge = edges[selectedEdge];
	if (!edge || edge.length !== 2) {
		console.warn('Aresta inválida');
		return;
	}
	
	const geometry = window.editingMesh.geometry;
	const matrixWorld = window.editingMesh.matrixWorld;
	
	// Calcula direção da aresta
	const v1 = uniqueVertices[edge[0]];
	const v2 = uniqueVertices[edge[1]];
	const edgeDir = new THREE.Vector3().subVectors(v2, v1).normalize();
	
	// Encontra faces conectadas
	const connectedFaces = [];
	faces.forEach((face, faceIdx) => {
		const hasV1 = face.includes(edge[0]);
		const hasV2 = face.includes(edge[1]);
		if (hasV1 && hasV2) {
			connectedFaces.push(face);
		}
	});
	
	// Calcula normal média
	let avgNormal = new THREE.Vector3();
	connectedFaces.forEach(face => {
		const faceVerts = face.map(vIdx => uniqueVertices[vIdx]);
		const fv1 = faceVerts[0];
		const fv2 = faceVerts[1];
		const fv3 = faceVerts[2];
		
		const edge1 = new THREE.Vector3().subVectors(fv2, fv1);
		const edge2 = new THREE.Vector3().subVectors(fv3, fv1);
		const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
		avgNormal.add(normal);
	});
	
	if (connectedFaces.length > 0) {
		avgNormal.divideScalar(connectedFaces.length).normalize();
	} else {
		avgNormal.set(0, 1, 0);
		if (Math.abs(edgeDir.dot(avgNormal)) > 0.9) {
			avgNormal.set(1, 0, 0);
		}
	}
	
	// Direção de extrusão
	const extrudeDir = new THREE.Vector3().crossVectors(edgeDir, avgNormal).normalize();
	
	// Novos vértices
	const newV1 = uniqueVertices[edge[0]].clone().add(extrudeDir.clone().multiplyScalar(amount));
	const newV2 = uniqueVertices[edge[1]].clone().add(extrudeDir.clone().multiplyScalar(amount));
	
	const newV1Idx = uniqueVertices.length;
	const newV2Idx = uniqueVertices.length + 1;
	
	uniqueVertices.push(newV1);
	uniqueVertices.push(newV2);
	
	// Nova face (quad)
	const newFace = [edge[0], edge[1], newV2Idx, newV1Idx];
	faces.push(newFace);
	
	// Nova aresta
	edges.push([newV1Idx, newV2Idx]);
	
	// Reconstrói geometria
	reconstruirGeometria();
	
	// Seleciona a nova aresta automaticamente
	const newEdgeIndex = edges.length - 1;
	selectedEdge = newEdgeIndex;
	selecionarAresta(newEdgeIndex);
	
	console.log('Aresta extrudida com sucesso');
}

// ========== INVERTER FACE ==========
function inverterFace() {
	if (modoAtual !== 'edicao' || submodoEdicao !== 'face' || selectedFace === null) {
		console.warn('Selecione uma face primeiro');
		return;
	}
	
	const face = faces[selectedFace];
	if (!face || face.length < 3) {
		console.warn('Face inválida');
		return;
	}
	
	// Inverte a ordem dos vértices
	faces[selectedFace] = face.reverse();
	
	// Reconstrói geometria
	reconstruirGeometria();
	
	// Reseleciona a face
	selecionarFace(selectedFace);
	
	console.log('Face invertida com sucesso');
}

// ========== FUNÇÃO AUXILIAR PARA RECONSTRUIR GEOMETRIA ==========
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

// ========== SUBDIVISION (Linear, sem suavização) ==========
function aplicarSubdivision() {
    if (modoAtual !== 'edicao' || submodoEdicao !== 'face') {
        console.warn('Subdivisão só disponível no modo faces');
        return;
    }

    if (!window.editingMesh) return;

    // Construir estruturas de adjacência
    const vertexEdges = Array(uniqueVertices.length).fill().map(() => []);
    const vertexFaces = Array(uniqueVertices.length).fill().map(() => []);
    const edgeFaces = Array(edges.length).fill().map(() => []);

    edges.forEach((edge, eIdx) => {
        vertexEdges[edge[0]].push(eIdx);
        vertexEdges[edge[1]].push(eIdx);
    });

    faces.forEach((face, fIdx) => {
        face.forEach(vIdx => {
            vertexFaces[vIdx].push(fIdx);
        });

        for (let i = 0; i < face.length; i++) {
            const v1 = face[i];
            const v2 = face[(i + 1) % face.length];
            const eIdx = edges.findIndex(e => (e[0] === v1 && e[1] === v2) || (e[0] === v2 && e[1] === v1));
            if (eIdx !== -1) {
                edgeFaces[eIdx].push(fIdx);
            }
        }
    });

    // Calcular face points (centroides das faces)
    const facePoints = [];
    faces.forEach(face => {
        const centroid = new THREE.Vector3();
        face.forEach(vIdx => {
            centroid.add(uniqueVertices[vIdx]);
        });
        centroid.divideScalar(face.length);
        facePoints.push(centroid);
    });

    // Calcular edge points (apenas midpoint, sem faces)
    const edgePoints = [];
    edges.forEach((edge) => {
        const v1 = uniqueVertices[edge[0]];
        const v2 = uniqueVertices[edge[1]];
        const midPoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
        edgePoints.push(midPoint);
    });

    // Manter vértices originais sem mover (sem suavização)
    const newVertices = uniqueVertices.map(v => v.clone());

    // Novos uniqueVertices: verts originais + face points + edge points
    const newUniqueVertices = [...newVertices];
    const facePointStart = newUniqueVertices.length;
    facePoints.forEach(fp => newUniqueVertices.push(fp));
    const edgePointStart = newUniqueVertices.length;
    edgePoints.forEach(ep => newUniqueVertices.push(ep));

    // Criar novas faces
    const newFaces = [];
    faces.forEach((face, fIdx) => {
        const fpIdx = facePointStart + fIdx;
        const faceLength = face.length;

        for (let i = 0; i < faceLength; i++) {
            const v1 = face[i]; // v atual
            const v2 = face[(i + 1) % faceLength]; // próximo v
            const prevV = face[(i + faceLength - 1) % faceLength]; // v anterior

            const eIdx = edges.findIndex(e => (e[0] === v1 && e[1] === v2) || (e[0] === v2 && e[1] === v1));
            const prevEIdx = edges.findIndex(e => (e[0] === prevV && e[1] === v1) || (e[0] === v1 && e[1] === prevV));

            if (eIdx === -1 || prevEIdx === -1) continue;

            const epIdx = edgePointStart + eIdx;
            const prevEpIdx = edgePointStart + prevEIdx;

            // Quad: v1, epIdx, fpIdx, prevEpIdx
            // Para manter orientação consistente, verificar ordem
            const newQuad = [v1, epIdx, fpIdx, prevEpIdx];
            newFaces.push(newQuad);
        }
    });

    // Atualizar estruturas
    uniqueVertices = newUniqueVertices;
    faces = newFaces;

    // Reconstruir geometria e atualizar
    reconstruirGeometria();

    console.log('Subdivisão linear aplicada com sucesso');
}

// ========== FIM DO SISTEMA DE EDIÇÃO ==========

function onPointerDown(event) {
	pointerDownTime = Date.now();
	pointerDownPos.x = event.clientX;
	pointerDownPos.y = event.clientY;
}

function onPointerMove(event) {
	// Loop Cut mode - preview do loop enquanto arrasta
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

function selectObject(event) {
	// Se está em modo loop cut, confirma o corte
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
	
	// MODO EDIÇÃO
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
		return;
	}
	
	// MODO NORMAL
	const intersects = raycaster.intersectObjects(selectableObjects, true);
	
	if (intersects.length > 0) {
		let targetObject = intersects[0].object;
		
		while (targetObject && !selectableObjects.includes(targetObject)) {
			targetObject = targetObject.parent;
		}
		
		if (targetObject && selectableObjects.includes(targetObject)) {
			selectedObject = targetObject;
			if (gizmoAtivo) {
				transformControls.detach();
				transformControls.attach(selectedObject);
			}
		}
	} else {
		selectedObject = null;
		transformControls.detach();
	}
}

renderer.domElement.addEventListener('pointerdown', onPointerDown, false);
renderer.domElement.addEventListener('pointermove', onPointerMove, false);
renderer.domElement.addEventListener('pointerup', selectObject, false);

//const suzanne = loadOBJ('models/suzanne.obj');
//selectableObjects.push(suzanne);

// ========== BOTÕES ==========

const btnMov = document.getElementById('mov');
const btnScl = document.getElementById('scl');
const btnRot = document.getElementById('rot');
const btnDesativ = document.getElementById('desativ');
const btnAtiv = document.getElementById('ativ');

btnMov.addEventListener('click', () => setModoGizmo('translate'));
btnScl.addEventListener('click', () => setModoGizmo('scale'));
btnRot.addEventListener('click', () => setModoGizmo('rotate'));
btnDesativ.addEventListener('click', () => desativarGizmo());
btnAtiv.addEventListener('click', () => ativarGizmo());

const btnNormal = document.getElementById('normal');
const btnEdicao = document.getElementById('edição');

btnNormal.addEventListener('click', () => sairModoEdicao());
btnEdicao.addEventListener('click', () => entrarModoEdicao());

const btnVertices = document.getElementById('vertices');
const btnEdges = document.getElementById('edges');
const btnFaces = document.getElementById('faces');

btnVertices.addEventListener('click', () => {
	if (modoAtual === 'edicao') {
		submodoEdicao = 'vertex';
		atualizarSubmodoEdicao();
		menu5_none()
		menu6_none()
	}
});

btnEdges.addEventListener('click', () => {
	if (modoAtual === 'edicao') {
		submodoEdicao = 'edge';
		atualizarSubmodoEdicao();
		menu5_none()
		menu6_show()
	}
});

btnFaces.addEventListener('click', () => {
	if (modoAtual === 'edicao') {
		submodoEdicao = 'face';
		atualizarSubmodoEdicao();
		menu5_show()
		menu6_none()
	}
});

// ========== NOVOS BOTÕES ==========

const btnLoopCut = document.getElementById('loopcut');
const btnLineCut = document.getElementById('linecut');
const btnSmooth = document.getElementById('smoth');
const btnExtrudFace = document.getElementById('extrudFace');
const btnExtrudEdge = document.getElementById('extrudedge');
const btnInvertFace = document.getElementById('invertFace');
const btnSubdivision = document.getElementById('subdivision');

// Loop Cut - ativa modo e permite arrastar sobre o modelo
btnLoopCut.addEventListener('click', () => {
	if (loopCutMode) {
		// Cancela modo loop cut
		loopCutMode = false;
		limparLoopCutPreview();
		controls.enabled = true;
		console.log('Modo Loop Cut cancelado');
	} else {
		// Ativa modo loop cut
		ativarLoopCut();
	}
});

// Line Cut agora funciona como o Loop Cut (renomeado internamente)
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

btnSmooth.addEventListener('click', () => {
	aplicarSmooth(2, 0.5);
});

btnExtrudFace.addEventListener('click', () => {
	extrudirFace(0.01);
});

btnExtrudEdge.addEventListener('click', () => {
	extrudirAresta(0.01);
});

btnInvertFace.addEventListener('click', () => {
	inverterFace();
});

btnSubdivision.addEventListener('click', () => {
	aplicarSubdivision();
});



function make_box(param) {
	 createBox();
}

function make_plan(param) {
	createPlane()
}





//createEditableSphereBuffer();
//createPlane()