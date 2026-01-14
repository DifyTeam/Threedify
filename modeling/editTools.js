// ==================================================================================
// modl.js - UNDO SILENCIOSO, EXTRUDE ESTÁTICO & CORREÇÃO DE SELEÇÃO
// ==================================================================================

// --- Variáveis Globais ---
const _tempVec = new THREE.Vector3();
const _tempVec2 = new THREE.Vector3();

// --- Variáveis do Loop Cut ---
const _lcRaycaster = new THREE.Raycaster();
const _lcMouse = new THREE.Vector2();
const _lcIntersectPoint = new THREE.Vector3();

// Estado
let _lcActive = false;
let _lcPreviewMesh = null;
let _lcHoveredEdgeIdx = -1; 
let _lcRingEdges = [];
let _lcCutFactor = 0.5;

// Controle de Travamento
let _lcLockedFaceIdx = -1; 
let _lcIsDragging = false; 

// Cache de vértices para performance
let _reverseIndexCache = null;
let _cachedPositionAttribute = null;
let _cachedMeshId = null;

// ==================================================================================
// 0. SISTEMA DE UNDO/REDO (Core)
// ==================================================================================

/**
 * Captura o estado atual da geometria (Snapshot)
 */
function _captureState() {
    return {
        // Clona dados puros para não haver referência de memória
        vertices: uniqueVertices.map(v => v.clone()),
        faces: faces.map(f => [...f]),
        // Salva UUID para saber a quem pertence esse estado
        meshUuid: window.editingMesh ? window.editingMesh.uuid : null,
        selection: {
            face: window.selectedFace,
            faces: window.selectedFaces ? [...window.selectedFaces] : [],
            edge: window.selectedEdge,
            edges: window.selectedEdges ? [...window.selectedEdges] : []
        }
    };
}

/**
 * Aplica a geometria diretamente nos buffers do Three.js SEM reconstruir helpers visuais.
 * Usado exclusivamente para Undo/Redo fora do modo de edição.
 */
function _aplicarGeometriaSilenciosa(mesh, vertices, facesData) {
    if (!mesh || !mesh.geometry) return;

    // 1. Atualiza posições
    const positions = [];
    vertices.forEach(v => positions.push(v.x, v.y, v.z));
    
    // Se a geometria atual não comportar o tamanho, criamos novos atributos
    // (Simplificação: Recriamos os buffers para garantir integridade)
    const geo = mesh.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    // 2. Atualiza Índices (Tratando Triângulos e Quads)
    const indices = [];
    facesData.forEach(face => {
        if (face.length === 3) {
            indices.push(face[0], face[1], face[2]);
        } else if (face.length === 4) {
            // Triangulação básica de quad: 0-1-2 e 0-2-3
            indices.push(face[0], face[1], face[2]);
            indices.push(face[0], face[2], face[3]);
        } else {
            // Polígonos maiores (Fan triangulation)
            for (let i = 1; i < face.length - 1; i++) {
                indices.push(face[0], face[i], face[i + 1]);
            }
        }
    });
    geo.setIndex(indices);

    // 3. Recalcula normais para a luz bater certo
    geo.computeVertexNormals();
    geo.attributes.position.needsUpdate = true;
    if (geo.attributes.normal) geo.attributes.normal.needsUpdate = true;
    if (geo.index) geo.index.needsUpdate = true;
    
    // Atualiza bounding box/sphere para o Raycaster funcionar no modo objeto
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
}

/**
 * Restaura um estado de geometria salvo
 */
function _restoreState(state) {
    if (!state) return;

    // 1. Restaurar Globais (Sempre necessário para consistência futura)
    uniqueVertices.length = 0;
    uniqueVertices.push(...state.vertices.map(v => v.clone()));

    faces.length = 0;
    faces.push(...state.faces.map(f => [...f]));

    // 2. Restaurar Seleção (Apenas dados, visual vem depois)
    window.selectedFace = state.selection.face;
    window.selectedFaces = [...state.selection.faces];
    window.selectedEdge = state.selection.edge;
    window.selectedEdges = [...state.selection.edges];

    // 3. DECISÃO INTELIGENTE: Como aplicar visualmente?
    const isEditMode = (typeof modoAtual !== 'undefined' && modoAtual === 'edicao');
    
    if (isEditMode) {
        // --- MODO EDIÇÃO ---
        // Usa o fluxo normal que desenha linhas, pontos e helpers
        invalidarCacheOtimizacao();
        reconstruirArestas();
        reconstruirGeometria(); // Esta função sua cria os helpers visuais
        atualizarNormais();
        
        // Atualiza highlight da seleção
        if (typeof selecionarFace === 'function' && window.selectedFace !== null && faces[window.selectedFace]) {
            selecionarFace(window.selectedFace);
        }
    } else {
        // --- MODO OBJETO ---
        // Atualiza APENAS a malha 3D silenciosamente
        let targetMesh = window.editingMesh;
        
        // Se perdemos a referência (comum ao sair do modo edição), busca pelo UUID salvo
        if (!targetMesh && state.meshUuid) {
            targetMesh = scene.getObjectByProperty('uuid', state.meshUuid);
        }

        if (targetMesh) {
            _aplicarGeometriaSilenciosa(targetMesh, uniqueVertices, faces);
            
            // Se houver BVH, atualiza para o raycaster funcionar
            if (typeof updateBVH === 'function') updateBVH(targetMesh);
        }
    }
}

class GeometryCommand extends Command {
    constructor(name, beforeState, afterState) {
        super(name);
        this.beforeState = beforeState;
        this.afterState = afterState;
    }

    execute() {
        _restoreState(this.afterState);
    }

    undo() {
        _restoreState(this.beforeState);
    }
}

// ==================================================================================
// 1. SISTEMA DE PERFORMANCE & SHADING
// ==================================================================================

function invalidarCacheOtimizacao() {
    _reverseIndexCache = null;
    _cachedPositionAttribute = null;
    _cachedMeshId = null; 
}

function construirCacheIndices() {
    if (!window.editingMesh || !vertexMapping) return;
    
    const count = uniqueVertices.length;
    const tempCache = new Array(count).fill(null).map(() => []);
    for (let originalIdxStr in vertexMapping) {
        tempCache[vertexMapping[originalIdxStr]].push(parseInt(originalIdxStr));
    }
    _reverseIndexCache = tempCache.map(arr => new Int32Array(arr));
    
    _cachedPositionAttribute = window.editingMesh.geometry.attributes.position;
    _cachedMeshId = window.editingMesh.uuid; 
}

function atualizarPosicoesRapido() {
    if (!window.editingMesh) return;

    if (!_reverseIndexCache || !_cachedPositionAttribute || _cachedMeshId !== window.editingMesh.uuid) {
        invalidarCacheOtimizacao();
        construirCacheIndices();
    }

    if (!_cachedPositionAttribute) return;

    const posArray = _cachedPositionAttribute.array;
    const len = uniqueVertices.length;
    
    for (let i = 0; i < len; i++) {
        const indices = _reverseIndexCache[i];
        if (!indices) continue;
        const v = uniqueVertices[i];
        
        for (let j = 0; j < indices.length; j++) {
            const base = indices[j] * 3;
            posArray[base] = v.x; 
            posArray[base+1] = v.y; 
            posArray[base+2] = v.z;
        }
    }
    _cachedPositionAttribute.needsUpdate = true;
}

function atualizarNormais() {
    if (!window.editingMesh) return;
    
    const geo = window.editingMesh.geometry;
    const mat = window.editingMesh.material;

    geo.computeVertexNormals();

    if (mat && mat.flatShading === false) {
        const positions = geo.attributes.position.array;
        const normals = geo.attributes.normal.array;
        const count = positions.length / 3;
        const posMap = new Map();
        const precision = 10000; 

        for (let i = 0; i < count; i++) {
            const x = Math.round(positions[i * 3] * precision);
            const y = Math.round(positions[i * 3 + 1] * precision);
            const z = Math.round(positions[i * 3 + 2] * precision);
            const key = `${x}_${y}_${z}`;
            
            if (!posMap.has(key)) posMap.set(key, []);
            posMap.get(key).push(i);
        }

        posMap.forEach((indices) => {
            if (indices.length <= 1) return;
            let avgX = 0, avgY = 0, avgZ = 0;
            for (let idx of indices) {
                avgX += normals[idx * 3];
                avgY += normals[idx * 3 + 1];
                avgZ += normals[idx * 3 + 2];
            }
            const len = Math.sqrt(avgX*avgX + avgY*avgY + avgZ*avgZ);
            if (len > 0) {
                avgX /= len; avgY /= len; avgZ /= len;
            }
            for (let idx of indices) {
                normals[idx * 3] = avgX;
                normals[idx * 3 + 1] = avgY;
                normals[idx * 3 + 2] = avgZ;
            }
        });
    }
    geo.attributes.normal.needsUpdate = true;
}

function reconstruirArestas() {
    edges.length = 0;
    const edgeSet = new Set();
    
    for (const face of faces) {
        if (!face) continue;
        for (let i = 0; i < face.length; i++) {
            const a = face[i];
            const b = face[(i + 1) % face.length];
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            
            if (!edgeSet.has(key)) {
                edgeSet.add(key);
                edges.push([a, b]);
            }
        }
    }
}

// ==================================================================================
// 2. CONTROLES DA FERRAMENTA
// ==================================================================================

function ativarLoopCut() {
    if (modoAtual !== 'edicao') { alert("Entre no modo de edição!"); return; }

    _lcActive = true;
    _lcHoveredEdgeIdx = -1;
    _lcRingEdges = [];
    _lcLockedFaceIdx = -1;
    _lcIsDragging = false;

    invalidarCacheOtimizacao();
    reconstruirArestas(); 

    if (typeof window.setOrbitControls === 'function') window.setOrbitControls(false);
    else if (window.controls) window.controls.enabled = false;
    if (window.transformControl) window.transformControl.detach();

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', _lcOnDown, { passive: false });
    canvas.addEventListener('pointermove', _lcOnMove, { passive: false });
    canvas.addEventListener('pointerup', _lcOnUp, { passive: false });
    canvas.addEventListener('touchstart', _lcOnDown, { passive: false });
    canvas.addEventListener('touchmove', _lcOnMove, { passive: false });
    canvas.addEventListener('touchend', _lcOnUp, { passive: false });

    console.log("🔪 Loop Cut 3.0: Ativo.");
}

function desativarLoopCut() {
    _lcActive = false;
    limparLoopCutPreview();

    const canvas = renderer.domElement;
    canvas.removeEventListener('pointerdown', _lcOnDown);
    canvas.removeEventListener('pointermove', _lcOnMove);
    canvas.removeEventListener('pointerup', _lcOnUp);
    canvas.removeEventListener('touchstart', _lcOnDown);
    canvas.removeEventListener('touchmove', _lcOnMove);
    canvas.removeEventListener('touchend', _lcOnUp);

    if (typeof window.setOrbitControls === 'function') window.setOrbitControls(true);
    else if (window.controls) window.controls.enabled = true;
}

// ==================================================================================
// 3. INTERAÇÃO 
// ==================================================================================

function _lcEncontrarFaceReal(hit) {
    const geometry = window.editingMesh.geometry;
    const position = geometry.attributes.position;
    
    const aIdx = hit.face.a;
    const bIdx = hit.face.b;
    const cIdx = hit.face.c;

    const vA = new THREE.Vector3().fromBufferAttribute(position, aIdx);
    const vB = new THREE.Vector3().fromBufferAttribute(position, bIdx);
    const vC = new THREE.Vector3().fromBufferAttribute(position, cIdx);

    const EPSILON = 0.0001;

    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        let matchCount = 0;

        for (let j = 0; j < face.length; j++) {
            const vIndex = face[j];
            const v = uniqueVertices[vIndex]; 
            
            if (v.distanceToSquared(vA) < EPSILON || 
                v.distanceToSquared(vB) < EPSILON || 
                v.distanceToSquared(vC) < EPSILON) {
                matchCount++;
            }
        }

        if (matchCount >= 3) {
            return i;
        }
    }
    
    if (faces[hit.faceIndex]) return hit.faceIndex;
    return -1;
}

function _lcOnDown(event) {
    if (!_lcActive) return;
    
    let cx = event.clientX;
    let cy = event.clientY;
    if (event.touches && event.touches.length > 0) {
        cx = event.touches[0].clientX;
        cy = event.touches[0].clientY;
    }

    _lcLockedFaceIdx = -1;
    _lcIsDragging = false;
    limparLoopCutPreview();

    const rect = renderer.domElement.getBoundingClientRect();
    _lcMouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
    _lcMouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
    
    _lcRaycaster.setFromCamera(_lcMouse, camera);
    
    let oldSide = THREE.FrontSide;
    if(window.editingMesh.material) {
        oldSide = window.editingMesh.material.side;
        window.editingMesh.material.side = THREE.DoubleSide; 
    }

    let intersects = [];
    if (typeof currentBVH !== 'undefined' && currentBVH && currentBVH.mesh === window.editingMesh) {
        currentBVH.raycast(_lcRaycaster, intersects);
    } else {
        intersects = _lcRaycaster.intersectObject(window.editingMesh);
    }
    
    if(window.editingMesh.material) {
        window.editingMesh.material.side = oldSide; 
    }

    if (intersects.length > 0) {
        const hit = intersects[0];
        const realFaceIdx = _lcEncontrarFaceReal(hit);

        if (realFaceIdx !== -1 && faces[realFaceIdx]) {
            _lcLockedFaceIdx = realFaceIdx;
            _lcSelecionarArestaPorPonto3D(hit, realFaceIdx); 
            _lcIsDragging = true;
        }
    }
}

function _lcOnMove(event) {
    if (!_lcActive) return;
    if(event.cancelable) event.preventDefault();
    event.stopPropagation();

    if (!_lcIsDragging || _lcLockedFaceIdx === -1 || _lcHoveredEdgeIdx === -1) return;

    let cx = event.clientX;
    let cy = event.clientY;
    if (event.changedTouches && event.changedTouches.length > 0) {
        cx = event.changedTouches[0].clientX;
        cy = event.changedTouches[0].clientY;
    } else if (event.touches && event.touches.length > 0) {
        cx = event.touches[0].clientX;
        cy = event.touches[0].clientY;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    _lcMouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
    _lcMouse.y = -((cy - rect.top) / rect.height) * 2 + 1;

    _lcRaycaster.setFromCamera(_lcMouse, camera);

    _lcAtualizarFatorSlide();
    _lcDesenharPreview();
}

function _lcOnUp(event) {
    if (!_lcActive) return;
    if(event.cancelable) event.preventDefault();
    event.stopPropagation();

    if (_lcHoveredEdgeIdx !== -1 && _lcRingEdges.length > 0) {
        _lcAplicarCorte();
    }
    
    _lcIsDragging = false;
    _lcLockedFaceIdx = -1;
    _lcHoveredEdgeIdx = -1;
    limparLoopCutPreview();
    desativarLoopCut(); 
}

// ==================================================================================
// 4. LÓGICA DO LOOP CUT
// ==================================================================================

function _lcSelecionarArestaPorPonto3D(hit, faceIdx) {
    const face = faces[faceIdx]; 
    const point3D = hit.point; 
    const matrixWorld = window.editingMesh.matrixWorld;

    let closestDist = Infinity;
    let bestEdgeIdx = -1;

    for (let i = 0; i < face.length; i++) {
        const vA = face[i];
        const vB = face[(i + 1) % face.length];
        
        const eIdx = edges.findIndex(e => (e[0]===vA && e[1]===vB) || (e[0]===vB && e[1]===vA));
        
        if (eIdx === -1) continue;

        _tempVec.copy(uniqueVertices[vA]).applyMatrix4(matrixWorld);
        _tempVec2.copy(uniqueVertices[vB]).applyMatrix4(matrixWorld);

        const dist = _distToSegment3D(point3D, _tempVec, _tempVec2);

        if (dist < closestDist) {
            closestDist = dist;
            bestEdgeIdx = eIdx;
        }
    }

    if (bestEdgeIdx !== -1) {
        _lcHoveredEdgeIdx = bestEdgeIdx;
        _lcRingEdges = _lcCalcularAnel(bestEdgeIdx);
        
        const v1 = uniqueVertices[edges[bestEdgeIdx][0]].clone().applyMatrix4(matrixWorld);
        const v2 = uniqueVertices[edges[bestEdgeIdx][1]].clone().applyMatrix4(matrixWorld);
        const t = _projectPointOnSegment(point3D, v1, v2);
        _lcCutFactor = t;
    }
}

function _lcAtualizarFatorSlide() {
    if (_lcHoveredEdgeIdx === -1) return;
    
    const e = edges[_lcHoveredEdgeIdx];
    if (!e) return;

    const matrixWorld = window.editingMesh.matrixWorld;
    const v1 = uniqueVertices[e[0]].clone().applyMatrix4(matrixWorld);
    const v2 = uniqueVertices[e[1]].clone().applyMatrix4(matrixWorld);

    _lcRaycaster.ray.distanceSqToSegment(v1, v2, null, _lcIntersectPoint);
    
    const t = _projectPointOnSegment(_lcIntersectPoint, v1, v2);
    _lcCutFactor = Math.max(0.01, Math.min(0.99, t));
    
    if (Math.abs(_lcCutFactor - 0.5) < 0.05) _lcCutFactor = 0.5;
}

function _distToSegment3D(p, v, w) {
    const l2 = v.distanceToSquared(w);
    if (l2 === 0) return p.distanceTo(v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y) + (p.z - v.z) * (w.z - v.z)) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = v.x + t * (w.x - v.x);
    const py = v.y + t * (w.y - v.y);
    const pz = v.z + t * (w.z - v.z);
    return Math.sqrt((p.x - px)**2 + (p.y - py)**2 + (p.z - pz)**2);
}

function _projectPointOnSegment(p, v, w) {
    const l2 = v.distanceToSquared(w);
    if (l2 === 0) return 0.5;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y) + (p.z - v.z) * (w.z - v.z)) / l2;
    return Math.max(0.01, Math.min(0.99, t));
}

function _lcCalcularAnel(startEdgeIdx) {
    const ring = new Set([startEdgeIdx]);
    const queue = [startEdgeIdx];
    let safe = 0;

    while (queue.length > 0 && safe < 5000) {
        safe++;
        const currIdx = queue.pop();
        const currEdge = edges[currIdx];
        if (!currEdge) continue;

        const connectedFaces = faces.filter(f => f && f.includes(currEdge[0]) && f.includes(currEdge[1]));
        
        connectedFaces.forEach(face => {
            if (face.length !== 4) return;

            const v1 = currEdge[0];
            const v2 = currEdge[1];
            const otherVerts = face.filter(v => v !== v1 && v !== v2);
            
            if (otherVerts.length === 2) {
                const ov1 = otherVerts[0];
                const ov2 = otherVerts[1];
                const oppIdx = edges.findIndex(e => (e[0]===ov1 && e[1]===ov2) || (e[0]===ov2 && e[1]===ov1));
                
                if (oppIdx !== -1 && !ring.has(oppIdx)) {
                    ring.add(oppIdx);
                    queue.push(oppIdx);
                }
            }
        });
    }
    return Array.from(ring);
}

function _lcDesenharPreview() {
    limparLoopCutPreview();
    if (_lcRingEdges.length === 0 || _lcHoveredEdgeIdx === -1) return;

    const positions = [];
    const matWorld = window.editingMesh.matrixWorld;
    const baseEdge = edges[_lcHoveredEdgeIdx];
    if (!baseEdge) return;

    const vBase1 = uniqueVertices[baseEdge[0]].clone().applyMatrix4(matWorld);
    const vBase2 = uniqueVertices[baseEdge[1]].clone().applyMatrix4(matWorld);
    const vecBase = new THREE.Vector3().subVectors(vBase2, vBase1).normalize();

    const points = [];
    _lcRingEdges.forEach(eIdx => {
        const e = edges[eIdx];
        if (!e) return;
        const v1 = uniqueVertices[e[0]];
        const v2 = uniqueVertices[e[1]];
        const p1World = v1.clone().applyMatrix4(matWorld);
        const p2World = v2.clone().applyMatrix4(matWorld);
        const dirWorld = new THREE.Vector3().subVectors(p2World, p1World).normalize();

        const dot = vecBase.dot(dirWorld);
        const t = (dot >= 0) ? _lcCutFactor : (1.0 - _lcCutFactor);

        const p = new THREE.Vector3().lerpVectors(v1, v2, t);
        p.applyMatrix4(matWorld);
        points.push({ pos: p, edgeIdx: eIdx });
    });

    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const pA = points[i]; const pB = points[j];
            const eA = edges[pA.edgeIdx]; const eB = edges[pB.edgeIdx];
            if (!eA || !eB) continue;

            const commonFace = faces.find(f => f && f.includes(eA[0]) && f.includes(eA[1]) && f.includes(eB[0]) && f.includes(eB[1]));
            if (commonFace) {
                positions.push(pA.pos.x, pA.pos.y, pA.pos.z);
                positions.push(pB.pos.x, pB.pos.y, pB.pos.z);
            }
        }
    }

    if(positions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color: 0x00ffff, depthTest: false, linewidth: 3 });
        _lcPreviewMesh = new THREE.LineSegments(geo, mat);
        _lcPreviewMesh.renderOrder = 9999; 
        scene.add(_lcPreviewMesh);
    }
}

function limparLoopCutPreview() {
    if (_lcPreviewMesh) {
        scene.remove(_lcPreviewMesh);
        _lcPreviewMesh.geometry.dispose();
        _lcPreviewMesh.material.dispose();
        _lcPreviewMesh = null;
    }
}

function _lcAplicarCorte() {
    if (_lcRingEdges.length === 0) return;
    
    // UNDO: Capturar estado antes
    const stateBefore = _captureState();

    const edgeToNewIdx = new Map();
    const matWorld = window.editingMesh.matrixWorld;
    const baseEdge = edges[_lcHoveredEdgeIdx];
    if (!baseEdge) return;

    const vB1 = uniqueVertices[baseEdge[0]].clone().applyMatrix4(matWorld);
    const vB2 = uniqueVertices[baseEdge[1]].clone().applyMatrix4(matWorld);
    const dirBase = new THREE.Vector3().subVectors(vB2, vB1).normalize();

    _lcRingEdges.forEach(eIdx => {
        const e = edges[eIdx];
        if (!e) return;
        const v1 = uniqueVertices[e[0]];
        const v2 = uniqueVertices[e[1]];
        const p1World = v1.clone().applyMatrix4(matWorld);
        const p2World = v2.clone().applyMatrix4(matWorld);
        const dirCurr = new THREE.Vector3().subVectors(p2World, p1World).normalize();

        const dot = dirBase.dot(dirCurr);
        const t = (dot >= 0) ? _lcCutFactor : (1.0 - _lcCutFactor);

        const newPos = new THREE.Vector3().lerpVectors(v1, v2, t);
        const newIdx = uniqueVertices.length;
        uniqueVertices.push(newPos);
        edgeToNewIdx.set(eIdx, newIdx);
    });

    const newFaces = [];
    faces.forEach(face => {
        if (!face) return; 
        const cuts = [];
        for (let i = 0; i < face.length; i++) {
            const vA = face[i];
            const vB = face[(i+1)%face.length];
            const eIdx = _lcRingEdges.find(rid => {
                const e = edges[rid];
                return e && ((e[0]===vA && e[1]===vB) || (e[0]===vB && e[1]===vA));
            });
            if (eIdx !== undefined) cuts.push({ pos: i, newIdx: edgeToNewIdx.get(eIdx) });
        }

        if (cuts.length === 2) {
            cuts.sort((a, b) => a.pos - b.pos);
            const c1 = cuts[0]; const c2 = cuts[1];
            const f1 = [c1.newIdx];
            for (let k = (c1.pos + 1) % face.length; k !== (c2.pos + 1) % face.length; k = (k+1)%face.length) f1.push(face[k]);
            f1.push(c2.newIdx);
            const f2 = [c2.newIdx];
            for (let k = (c2.pos + 1) % face.length; k !== (c1.pos + 1) % face.length; k = (k+1)%face.length) f2.push(face[k]);
            f2.push(c1.newIdx);
            newFaces.push(f1, f2);
        } else {
            newFaces.push(face);
        }
    });

    faces = newFaces;
    
    reconstruirArestas();

    invalidarCacheOtimizacao();
    reconstruirGeometria();
    atualizarNormais(); 
    if (typeof updateBVH === 'function') updateBVH(window.editingMesh);
    
    // UNDO: Capturar estado depois e registrar comando
    const stateAfter = _captureState();
    commandManager.execute(new GeometryCommand('Loop Cut', stateBefore, stateAfter));

    console.log("Corte Aplicado.");
}

// ==================================================================================
// 5. FUNÇÃO DE SOLDAGEM 
// ==================================================================================

function soldarVertices() {
    if (!window.editingMesh) return;
    
    // UNDO: Capturar estado antes
    const stateBefore = _captureState();

    invalidarCacheOtimizacao();

    const newUniqueVertices = [];
    const posMap = new Map();
    const oldToNewIndex = new Array(uniqueVertices.length);
    const precision = 10000;

    for (let i = 0; i < uniqueVertices.length; i++) {
        const v = uniqueVertices[i];
        const key = `${Math.round(v.x * precision)}_${Math.round(v.y * precision)}_${Math.round(v.z * precision)}`;
        if (posMap.has(key)) {
            oldToNewIndex[i] = posMap.get(key);
        } else {
            const newIdx = newUniqueVertices.length;
            newUniqueVertices.push(v);
            posMap.set(key, newIdx);
            oldToNewIndex[i] = newIdx;
        }
    }

    const newFaces = [];
    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        const newFace = [];
        for (let j = 0; j < face.length; j++) {
            newFace.push(oldToNewIndex[face[j]]);
        }
        const uniqueIndices = [...new Set(newFace)];
        if (uniqueIndices.length >= 3) {
            newFaces.push(newFace);
        }
    }

    uniqueVertices.splice(0, uniqueVertices.length, ...newUniqueVertices);
    faces.splice(0, faces.length, ...newFaces);
    
    reconstruirArestas();
    reconstruirGeometria();
    if (typeof updateBVH === 'function') updateBVH(window.editingMesh);

    // UNDO: Capturar estado depois e registrar comando
    const stateAfter = _captureState();
    commandManager.execute(new GeometryCommand('Soldar Vértices', stateBefore, stateAfter));
}

// ==================================================================================
// 6. OUTRAS FERRAMENTAS (Extrusão, Smooth, Subdiv)
// ==================================================================================

function aplicarSmooth(iterations=1, factor=0.5) {
    if(modoAtual!=='edicao') return;
    
    // UNDO: Capturar estado antes
    const stateBefore = _captureState();

    invalidarCacheOtimizacao();

    const len=uniqueVertices.length;
    const adj=Array(len).fill(null).map(()=>[]);
    edges.forEach(e=>{ if(e && e[0]<len && e[1]<len){ adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); } });
    for(let k=0; k<iterations; k++){
        const oldV = uniqueVertices.map(v=>v.clone());
        for(let i=0; i<len; i++){
            const n=adj[i];
            if(n.length>0){
                let sx=0, sy=0, sz=0;
                n.forEach(idx=>{ sx+=oldV[idx].x; sy+=oldV[idx].y; sz+=oldV[idx].z; });
                const inv=1/n.length;
                uniqueVertices[i].x += (sx*inv - oldV[i].x)*factor;
                uniqueVertices[i].y += (sy*inv - oldV[i].y)*factor;
                uniqueVertices[i].z += (sz*inv - oldV[i].z)*factor;
            }
        }
    }
    atualizarPosicoesRapido();
    atualizarNormais();
    if (typeof updateBVH === 'function') updateBVH(window.editingMesh);

    // UNDO: Capturar estado depois e registrar comando
    const stateAfter = _captureState();
    commandManager.execute(new GeometryCommand('Smooth', stateBefore, stateAfter));
}

// CORREÇÃO: Amount = 0 para Extrusão Estática (não move face).
// Mantém transformControl ativo na nova geometria.
function extrudirFace(amount= 0) {
    if(modoAtual!=='edicao') return;
    
    // UNDO: Capturar estado antes
    const stateBefore = _captureState();

    invalidarCacheOtimizacao();

    const facesToExtrude = [];
    if (window.selectedFaces && window.selectedFaces.length > 0) {
        facesToExtrude.push(...window.selectedFaces);
    } else if (typeof selectedFace !== 'undefined' && selectedFace !== null && faces[selectedFace]) {
        facesToExtrude.push(selectedFace);
    }
    
    if (facesToExtrude.length === 0) return;
    
    const vertexSet = new Set();
    const facesCopy = [];
    
    facesToExtrude.forEach(fIdx => {
        if (faces[fIdx]) {
            const face = [...faces[fIdx]]; 
            facesCopy.push({ index: fIdx, vertices: face });
            face.forEach(vIdx => vertexSet.add(vIdx));
        }
    });
    
    const oldToNewVertex = new Map();
    vertexSet.forEach(oldIdx => {
        const newVertex = uniqueVertices[oldIdx].clone();
        uniqueVertices.push(newVertex);
        const newIdx = uniqueVertices.length - 1;
        oldToNewVertex.set(oldIdx, newIdx);
    });
    
    facesCopy.forEach(faceData => {
        const face = faceData.vertices;
        if (face.length < 3) return;
        
        const v1 = uniqueVertices[face[0]];
        const v2 = uniqueVertices[face[1]];
        const v3 = uniqueVertices[face[2]];
        
        // CORREÇÃO: Usamos o amount=0 por padrão para não mover (Extrusão Estática)
        const normal = new THREE.Vector3()
            .subVectors(v2, v1)
            .cross(new THREE.Vector3().subVectors(v3, v1))
            .normalize();
        
        face.forEach(oldIdx => {
            const newIdx = oldToNewVertex.get(oldIdx);
            if (newIdx !== undefined) {
                if (amount !== 0) {
                    uniqueVertices[newIdx].addScaledVector(normal, amount);
                }
            }
        });
    });
    
    const edgeCount = new Map();
    facesCopy.forEach(faceData => {
        const face = faceData.vertices;
        for (let i = 0; i < face.length; i++) {
            const v1 = face[i];
            const v2 = face[(i + 1) % face.length];
            const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
            edgeCount.set(edgeKey, (edgeCount.get(edgeKey) || 0) + 1);
        }
    });
    
    const sideFaces = [];
    const boundaryEdges = new Set();
    
    facesCopy.forEach(faceData => {
        const face = faceData.vertices;
        for (let i = 0; i < face.length; i++) {
            const v1 = face[i];
            const v2 = face[(i + 1) % face.length];
            const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
            
            if (edgeCount.get(edgeKey) === 1 && !boundaryEdges.has(edgeKey)) {
                boundaryEdges.add(edgeKey);
                const newV1 = oldToNewVertex.get(v1);
                const newV2 = oldToNewVertex.get(v2);
                sideFaces.push([v1, v2, newV2, newV1]);
            }
        }
    });
    
    const newTopFaces = [];
    facesCopy.forEach(faceData => {
        const face = faceData.vertices;
        const newFace = face.map(oldIdx => oldToNewVertex.get(oldIdx));
        newTopFaces.push(newFace);
    });
    
    const indicesToRemove = facesCopy.map(f => f.index).sort((a, b) => b - a);
    indicesToRemove.forEach(idx => {
        faces.splice(idx, 1);
    });
    
    faces.push(...newTopFaces);
    faces.push(...sideFaces);
    
    reconstruirArestas();
    reconstruirGeometria();
    atualizarNormais();
    
    // CORREÇÃO: Gerenciar Seleção Pós-Extrusão
    const firstNewFaceIdx = faces.length - newTopFaces.length - sideFaces.length;
    const newFaceIndices = [];
    for (let i = 0; i < newTopFaces.length; i++) {
        newFaceIndices.push(firstNewFaceIdx + i);
    }
    
    // 1. Limpa seleção antiga e destaques
    if (typeof faceHighlight !== 'undefined' && faceHighlight) {
        scene.remove(faceHighlight);
        faceHighlight.geometry.dispose();
        faceHighlight.material.dispose();
        faceHighlight = null;
    }
    if (window.faceHighlights) {
        window.faceHighlights.forEach(h => {
            scene.remove(h);
            h.geometry.dispose();
            h.material.dispose();
        });
        window.faceHighlights = [];
    }
    window.selectedFaces = [];
    window.selectedFace = null;

    // 2. Seleciona as novas faces
    if (newFaceIndices.length > 0) {
        window.selectedFaces = [...newFaceIndices];
        // Define uma face "ativa" para o TransformControl centralizar
        window.selectedFace = newFaceIndices[newFaceIndices.length - 1]; 
        
        newFaceIndices.forEach(idx => {
            if (typeof selecionarFace === 'function') selecionarFace(idx);
        });
    }

    // 3. Força Re-attach do TransformControl
    if (window.transformControl && window.editingMesh) {
        window.transformControl.detach();
        window.transformControl.attach(window.editingMesh);
    }
    
    if (typeof updateBVH === 'function') updateBVH(window.editingMesh);

    // UNDO: Capturar estado depois e registrar comando
    const stateAfter = _captureState();
    commandManager.execute(new GeometryCommand('Extrudir Face', stateBefore, stateAfter));

    console.log(`Extrusão Estática: ${newTopFaces.length} faces mantidas no lugar.`);
}

// CORREÇÃO: Padrão amount=0 e re-seleção correta
function extrudirAresta(amount=0) {
    if(modoAtual!=='edicao') return;
    
    // UNDO: Capturar estado antes
    const stateBefore = _captureState();

    invalidarCacheOtimizacao();

    const edgesToExtrude = (window.selectedEdges && window.selectedEdges.length > 0) 
        ? window.selectedEdges 
        : (typeof selectedEdge !== 'undefined' && selectedEdge !== null ? [selectedEdge] : []);
    
    if (edgesToExtrude.length === 0) return;
    
    const newFacesIndices = [];

    edgesToExtrude.forEach(edgeIdx => {
        if (!edges[edgeIdx]) return;
        
        const e = edges[edgeIdx];
        const v1=uniqueVertices[e[0]], v2=uniqueVertices[e[1]];
        const dir = new THREE.Vector3(0,1,0); 
        
        // Se amount for 0, cria vértices no mesmo lugar (extrusão estática)
        const nv1 = v1.clone().addScaledVector(dir, amount);
        const nv2 = v2.clone().addScaledVector(dir, amount);
        
        const i1 = uniqueVertices.length, i2 = i1+1;
        uniqueVertices.push(nv1, nv2);
        
        faces.push([e[0], i1, i2, e[1]]);
        newFacesIndices.push(faces.length - 1);
    });
    
    reconstruirArestas();
    reconstruirGeometria();
    atualizarNormais();
    if (typeof updateBVH === 'function') updateBVH(window.editingMesh);

    // Atualizar Seleção para a nova geometria
    if (window.transformControl && window.editingMesh) {
        window.transformControl.detach();
        window.transformControl.attach(window.editingMesh);
    }

    // UNDO: Capturar estado depois e registrar comando
    const stateAfter = _captureState();
    commandManager.execute(new GeometryCommand('Extrudir Aresta', stateBefore, stateAfter));
}

function aplicarSubdivision() {
    if (modoAtual !== 'edicao') return;

    // UNDO: Capturar estado antes
    const stateBefore = _captureState();

    soldarVertices(); 

    invalidarCacheOtimizacao();

    const newFaces = [];
    const edgeCache = {}; 

    function getMidPoint(iA, iB) {
        const key = iA < iB ? `${iA}_${iB}` : `${iB}_${iA}`;
        if (edgeCache[key] !== undefined) return edgeCache[key];
        const vA = uniqueVertices[iA];
        const vB = uniqueVertices[iB];
        const mid = new THREE.Vector3().addVectors(vA, vB).multiplyScalar(0.5);
        uniqueVertices.push(mid);
        const newIdx = uniqueVertices.length - 1;
        edgeCache[key] = newIdx;
        return newIdx;
    }

    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        if (face.length === 3) {
            const a = face[0]; const b = face[1]; const c = face[2];
            const ab = getMidPoint(a, b);
            const bc = getMidPoint(b, c);
            const ca = getMidPoint(c, a);
            newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        } 
        else if (face.length === 4) {
            const a = face[0]; const b = face[1]; const c = face[2]; const d = face[3];
            const ab = getMidPoint(a, b);
            const bc = getMidPoint(b, c);
            const cd = getMidPoint(c, d);
            const da = getMidPoint(d, a);
            const center = new THREE.Vector3()
                .add(uniqueVertices[a]).add(uniqueVertices[b])
                .add(uniqueVertices[c]).add(uniqueVertices[d])
                .multiplyScalar(0.25);
            uniqueVertices.push(center);
            const centerIdx = uniqueVertices.length - 1;
            newFaces.push([a, ab, centerIdx, da], [b, bc, centerIdx, ab], [c, cd, centerIdx, bc], [d, da, centerIdx, cd]);
        }
    }

    faces = newFaces;
    reconstruirArestas();
    reconstruirGeometria();
    atualizarNormais();
    if (typeof updateBVH === 'function') updateBVH(window.editingMesh);

    // UNDO: Capturar estado depois e registrar comando
    const stateAfter = _captureState();
    commandManager.execute(new GeometryCommand('Subdividir', stateBefore, stateAfter));

    console.log("Subdivisão Aplicada.");
}

function inverterFace() {
    // UNDO: Capturar estado antes
    const stateBefore = _captureState();

    const facesToInvert = (window.selectedFaces && window.selectedFaces.length > 0) 
        ? window.selectedFaces 
        : (typeof selectedFace !== 'undefined' && selectedFace !== null ? [selectedFace] : []);
    
    if (facesToInvert.length === 0) return;
    
    facesToInvert.forEach(faceIdx => {
        if (faces[faceIdx]) {
            faces[faceIdx].reverse();
        }
    });
    
    reconstruirGeometria();
    atualizarNormais();
    if (typeof updateBVH === 'function') updateBVH(window.editingMesh);

    // UNDO: Capturar estado depois e registrar comando
    const stateAfter = _captureState();
    commandManager.execute(new GeometryCommand('Inverter Face', stateBefore, stateAfter));
}

function eferaadd() {
    if (typeof createEditableSphereBuffer === 'function') createEditableSphereBuffer();
}

// ==================================================================================
// 7. GERENCIAMENTO DE SELEÇÃO (NOVO)
// ==================================================================================
/**
 * Função utilitária para "Toggle" (Alternar) seleção.
 * DEVE ser chamada pelo seu evento de 'mousedown'/'click' no arquivo principal.
 */
function alternarSelecaoFace(faceIndex) {
    if (typeof window.selectedFaces === 'undefined') window.selectedFaces = [];
    
    const idxInArray = window.selectedFaces.indexOf(faceIndex);

    if (idxInArray > -1) {
        // --- DESELECIONAR ---
        window.selectedFaces.splice(idxInArray, 1);
        
        // Remove visualmente se houver array de highlights
        if (window.faceHighlights && window.faceHighlights[idxInArray]) {
            const h = window.faceHighlights[idxInArray];
            scene.remove(h);
            h.geometry.dispose();
            h.material.dispose();
            window.faceHighlights.splice(idxInArray, 1);
        } else {
            // Fallback: se não gerenciarmos o array de highlights aqui,
            // forçamos o redesenho total da seleção.
            // (Assumindo que selecionarFace limpa e redesenha ou lida com isso)
            if (typeof limparSelecaoVisual === 'function') limparSelecaoVisual();
            window.selectedFaces.forEach(f => {
                if(typeof selecionarFace === 'function') selecionarFace(f);
            });
        }
        
        // Se a face "ativa" (última selecionada) foi a removida, atualiza para a anterior
        if (window.selectedFace === faceIndex) {
            window.selectedFace = window.selectedFaces.length > 0 ? window.selectedFaces[window.selectedFaces.length - 1] : null;
        }

    } else {
        // --- SELECIONAR ---
        window.selectedFaces.push(faceIndex);
        window.selectedFace = faceIndex;
        if (typeof selecionarFace === 'function') {
            selecionarFace(faceIndex);
        }
    }

    // Atualiza TransformControls para a nova média de seleção
    if (window.transformControl && window.editingMesh) {
        if (window.selectedFaces.length > 0) {
            window.transformControl.attach(window.editingMesh);
        } else {
            window.transformControl.detach();
        }
    }
}