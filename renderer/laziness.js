// ray.js - FINAL: ReSTIR DI + Texture Preserving Denoise (Demodulation) + Progressive Output + Feature Aware
// ATUALIZADO: Feature Buffers, Jitter AA, Firefly Clamping, Glass Fix

(function() { 

    // --- VARIÁVEIS GLOBAIS DO MÓDULO ---
    let rayCanvasEl = null; 
    let rayCtx = null;
    let rayIsRendering = false;
    let raySamples = 0;
    let rayImageData = null;

    // BUFFERS PRINCIPAIS
    let rayAccumulationBuffer = null;
    let raySumSqBuffer = null;
    let rayNormalDepthBuffer = null; // RGBA: Normal X, Normal Y, Normal Z, Depth
    let rayAlbedoBuffer = null;      // RGB: Albedo Base (Texture/Color)
    let rayAuxBuffer = null;         // NOVO: RGBA -> Roughness, Transmission, Unused, Unused
    let raySampleCountBuffer = null;
    
    // BUFFERS DE DENOISE (Ping-Pong)
    let rayDenoiseBufferA = null;
    let rayDenoiseBufferB = null;
    let rayDenoiseIteration = 0;

    let rayWorkers = [];
    let rayNumWorkers = navigator.hardwareConcurrency || 4; 
    let rayRenderButton = null;

    // TILE RENDERING VARIABLES
    const TILE_SIZE = 64; 
    let rayTileQueue = [];
    let rayActiveWorkersCount = 0;
    let rayTileConvergence = [];

    // JITTER (ANTI-ALIASING)
    let rayJitterX = 0;
    let rayJitterY = 0;

    // ARRAYS DE DADOS GEOMÉTRICOS
    let rayTriangleData = null;
    let rayNormalData = null;
    let rayUVData = null;
    let rayMaterialData = null;
    let rayEmissiveTrianglesData = null;
    let rayEmissiveCount = 0;
    let rayTextureList = [];
    let rayTotalTriangles = 0;

    // BVH STRUCTURES
    let rayBVHBounds = null;
    let rayBVHContents = null;
    let rayBVHIndices = null;

    // SKYBOX
    let raySkyboxImage = null;
    let raySkyboxData = null; 
    let raySkyboxWidth = 0;
    let raySkyboxHeight = 0;

    // CONFIGURAÇÕES
    const rayConfig = {
        maxSamples: 100,
        samplesPerFrame: 1,
        maxBounces: 6,
        pixelRatio: 1.0, 
        backgroundColor: [10/255, 10/255, 10/255, 1],
        
        // --- CONTROLES DE DENOISE E RESTIR ---
        useReSTIR: true,          
        denoise: true,            
        denoiseSteps: 3,          // Aumentado para permitir refino
        
        // CAMERA
        aperture: 0.0,
        focusDistance: 10.0,
        
        // ADAPTIVE SAMPLING
        adaptiveEnabled: false,
        varianceThreshold: 0.0005,

        // AO
        aoEnabled: false,
        aoSamples: 2,
        aoRadius: 1.0,
        aoIntensity: 0.6
    };

    let rayCamera = {
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        fov: 60,
        aspect: 1
    };

    // --- FUNÇÕES AUXILIARES ---

    function rayLoadSkybox(imagePath) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                raySkyboxImage = img;
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(img, 0, 0);
                
                const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
                raySkyboxWidth = img.width;
                raySkyboxHeight = img.height;
                raySkyboxData = new Uint8ClampedArray(imageData.data); 
                
                rayConfig.useSkybox = true;
                console.log(`Skybox loaded (Uint8 Optimized): ${img.width}x${img.height}`);
                resolve();
            };
            img.onerror = () => {
                console.error('Failed to load skybox image:', imagePath);
                rayConfig.useSkybox = false;
                reject(new Error('Failed to load skybox'));
            };
            img.src = imagePath;
        });
    }

    function rayExtractTexture(img) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        
        return { 
            width: img.width, 
            height: img.height, 
            data: new Uint8ClampedArray(imgData.data) 
        };
    }

    function rayCountTrianglesRecursive(objects) {
        let count = 0;
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            if (obj.userData && obj.userData.isLight) continue;
            if (obj.isMesh && obj.visible !== false && obj.geometry) {
                const geo = obj.geometry;
                if (geo.index) count += geo.index.count / 3;
                else if (geo.attributes.position) count += geo.attributes.position.count / 3;
            }
            if (obj.children && obj.children.length > 0) count += rayCountTrianglesRecursive(obj.children);
        }
        return count;
    }

    function rayFillBuffersRecursive(objects, cursor, emissiveCollector) {
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            if (obj.userData && obj.userData.isLight) continue;

            if (obj.isMesh && obj.geometry && obj.visible !== false) {
                obj.updateMatrixWorld(true);
                const geo = obj.geometry;
                const positions = geo.attributes.position.array;
                const normals = geo.attributes.normal ? geo.attributes.normal.array : null;
                const indices = geo.index ? geo.index.array : null;
                const uvs = geo.attributes.uv ? geo.attributes.uv.array : null;
                
                const mw = obj.matrixWorld.elements;
                let r=0.7, g=0.7, b=0.7;
                let roughness = 0.5;
                let emR=0, emG=0, emB=0;
                let metalnessValue = 0.0;
                let transmissionValue = 0.0;
                let textureId = -1.0;
                let isFlatShading = false;
                
                if (obj.material) {
                    const m = obj.material;
                    if(m.color) { r=m.color.r; g=m.color.g; b=m.color.b; }
                    if (m.map && m.map.image) {
                        const texData = rayExtractTexture(m.map.image);
                        textureId = rayTextureList.length;
                        rayTextureList.push(texData);
                    }
                    
                    if (m.rayemission !== undefined && m.rayemission > 0) {
                        const intensity = m.rayemission * 5.0; 
                        emR = r * intensity; emG = g * intensity; emB = b * intensity;
                    } else if(m.emissive) { 
                        const intensity = (m.emissiveIntensity !== undefined) ? m.emissiveIntensity : 1.0;
                        emR=m.emissive.r * intensity * 5.0; 
                        emG=m.emissive.g * intensity * 5.0; 
                        emB=m.emissive.b * intensity * 5.0; 
                    }
                    
                    if (m.rayroughness !== undefined && m.rayroughness !== null) roughness = parseFloat(m.rayroughness);
                    else if (m.roughness !== undefined && m.roughness !== null) roughness = parseFloat(m.roughness);
                    roughness = Math.max(0.0, Math.min(1.0, roughness));

                    if (m.raymetalness !== undefined) metalnessValue = m.raymetalness;
                    else if (m.metalness !== undefined) metalnessValue = m.metalness;

                    if (m.transmission !== undefined) transmissionValue = m.transmission;
                    if (m.rayreflection !== undefined) transmissionValue = m.rayreflection; 
                    if (m.opacity < 1.0) transmissionValue = 1.0 - m.opacity;

                    if (m.flatShading === true) isFlatShading = true;
                }

                const transformAndStore = (x, y, z, offset) => {
                    const tx = x * mw[0] + y * mw[4] + z * mw[8] + mw[12];
                    const ty = x * mw[1] + y * mw[5] + z * mw[9] + mw[13];
                    const tz = x * mw[2] + y * mw[6] + z * mw[10] + mw[14];
                    rayTriangleData[offset] = tx;
                    rayTriangleData[offset+1] = ty; rayTriangleData[offset+2] = tz;
                    return {x: tx, y: ty, z: tz};
                };

                const transformAndStoreNormal = (x, y, z, offset) => {
                    const nx = x * mw[0] + y * mw[4] + z * mw[8];
                    const ny = x * mw[1] + y * mw[5] + z * mw[9];
                    const nz = x * mw[2] + y * mw[6] + z * mw[10];
                    const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                    if (len > 0) {
                        rayNormalData[offset] = nx/len; 
                        rayNormalData[offset+1] = ny/len; 
                        rayNormalData[offset+2] = nz/len;
                    } else {
                        rayNormalData[offset] = 0; rayNormalData[offset+1] = 1; rayNormalData[offset+2] = 0;
                    }
                };

                const triCount = indices ? (indices.length / 3) : (positions.length / 9);
                for (let t = 0; t < triCount; t++) {
                    let i0, i1, i2;
                    if (indices) {
                        i0 = indices[t*3]; i1 = indices[t*3+1]; i2 = indices[t*3+2];
                    } else {
                        i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2;
                    }
                    if ((i0*3)+2 >= positions.length || (i1*3)+2 >= positions.length || (i2*3)+2 >= positions.length) continue;

                    const baseIdx = cursor.index * 9;
                    const uvBaseIdx = cursor.index * 6;
                    const matIdx = cursor.index * 11;
                    
                    const v0x = positions[i0*3], v0y = positions[i0*3+1], v0z = positions[i0*3+2];
                    const v1x = positions[i1*3], v1y = positions[i1*3+1], v1z = positions[i1*3+2];
                    const v2x = positions[i2*3], v2y = positions[i2*3+1], v2z = positions[i2*3+2];
                    
                    if (isNaN(v0x) || isNaN(v1x) || isNaN(v2x)) continue;
                    
                    const w0 = transformAndStore(v0x, v0y, v0z, baseIdx);
                    const w1 = transformAndStore(v1x, v1y, v1z, baseIdx+3);
                    const w2 = transformAndStore(v2x, v2y, v2z, baseIdx+6);

                    if (emR > 0 || emG > 0 || emB > 0) {
                        emissiveCollector.push({
                            v0: w0, v1: w1, v2: w2,
                            emission: {r: emR, g: emG, b: emB}
                        });
                    }

                    if (normals && !isFlatShading) {
                        transformAndStoreNormal(normals[i0*3], normals[i0*3+1], normals[i0*3+2], baseIdx);
                        transformAndStoreNormal(normals[i1*3], normals[i1*3+1], normals[i1*3+2], baseIdx+3);
                        transformAndStoreNormal(normals[i2*3], normals[i2*3+1], normals[i2*3+2], baseIdx+6);
                    } else {
                        const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
                        const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
                        let nx = e1y * e2z - e1z * e2y;
                        let ny = e1z * e2x - e1x * e2z;
                        let nz = e1x * e2y - e1y * e2x;
                        transformAndStoreNormal(nx, ny, nz, baseIdx);
                        transformAndStoreNormal(nx, ny, nz, baseIdx+3);
                        transformAndStoreNormal(nx, ny, nz, baseIdx+6);
                    }

                    if (uvs) {
                        rayUVData[uvBaseIdx] = uvs[i0*2]; rayUVData[uvBaseIdx+1] = uvs[i0*2+1];
                        rayUVData[uvBaseIdx+2] = uvs[i1*2]; rayUVData[uvBaseIdx+3] = uvs[i1*2+1];
                        rayUVData[uvBaseIdx+4] = uvs[i2*2]; rayUVData[uvBaseIdx+5] = uvs[i2*2+1];
                    } else {
                        rayUVData[uvBaseIdx] = 0; rayUVData[uvBaseIdx+1] = 0;
                        rayUVData[uvBaseIdx+2] = 0; rayUVData[uvBaseIdx+3] = 0;
                        rayUVData[uvBaseIdx+4] = 0; rayUVData[uvBaseIdx+5] = 0;
                    }

                    rayMaterialData[matIdx] = r; rayMaterialData[matIdx+1] = g; rayMaterialData[matIdx+2] = b;
                    rayMaterialData[matIdx+3] = roughness; 
                    rayMaterialData[matIdx+4] = 0; 
                    rayMaterialData[matIdx+5] = emR; rayMaterialData[matIdx+6] = emG; rayMaterialData[matIdx+7] = emB;
                    rayMaterialData[matIdx+8] = metalnessValue; 
                    rayMaterialData[matIdx+9] = transmissionValue;
                    rayMaterialData[matIdx+10] = textureId;
                    cursor.index++;
                }
            }
            if (obj.children && obj.children.length > 0) rayFillBuffersRecursive(obj.children, cursor, emissiveCollector);
        }
    }

    function rayConvertThreeObjects(selectableObjects) {
        const lights = [];
        const emissiveTriangles = []; 
        const progressDiv = document.getElementById('progresso');
        rayTextureList = [];
        
        if (progressDiv) progressDiv.innerHTML = 'extracting mesh data...';
        
        if (window.ray_lights && window.ray_lights.length > 0) {
            window.ray_lights.forEach(rayLightInstance => {
                if (rayLightInstance.object) rayLightInstance.object.updateMatrixWorld(true);
                
                let px = rayLightInstance.position.x;
                let py = rayLightInstance.position.y;
                let pz = rayLightInstance.position.z;
                let type = "point"; 
                let dirX = 0, dirY = -1, dirZ = 0;

                if (rayLightInstance.object) {
                    const mw = rayLightInstance.object.matrixWorld.elements;
                    px = mw[12]; py = mw[13]; pz = mw[14];
                    
                    if (rayLightInstance.object.userData && rayLightInstance.object.userData.type === 'directional') {
                        type = "directional";
                        const forwardX = mw[8];
                        const forwardY = mw[9];
                        const forwardZ = mw[10];
                        const len = Math.sqrt(forwardX*forwardX + forwardY*forwardY + forwardZ*forwardZ);
                        dirX = -forwardX / len;
                        dirY = -forwardY / len;
                        dirZ = -forwardZ / len;
                    }
                }

                lights.push({
                    type: type, 
                    position: { x: px, y: py, z: pz },
                    direction: { x: dirX, y: dirY, z: dirZ },
                    color: [rayLightInstance.color.r, rayLightInstance.color.g, rayLightInstance.color.b],
                    intensity: rayLightInstance.intensity,
                    radius: rayLightInstance.shadowSoftness,
                    castShadow: rayLightInstance.castShadow
                });
            });
        }

        rayTotalTriangles = rayCountTrianglesRecursive(selectableObjects);
        if (rayTotalTriangles === 0) { console.error("Nenhum triângulo encontrado!"); return null; }

        console.log(`Allocating buffers for ${rayTotalTriangles} triangles...`);
        rayTriangleData = new Float32Array(rayTotalTriangles * 9); 
        rayNormalData = new Float32Array(rayTotalTriangles * 9);
        rayUVData = new Float32Array(rayTotalTriangles * 6);
        rayMaterialData = new Float32Array(rayTotalTriangles * 11);
        
        const cursor = { index: 0 };
        rayFillBuffersRecursive(selectableObjects, cursor, emissiveTriangles);
        
        rayEmissiveCount = emissiveTriangles.length;
        rayEmissiveTrianglesData = new Float32Array(rayEmissiveCount * 12);
        for(let i=0; i<rayEmissiveCount; i++) {
            const et = emissiveTriangles[i];
            const base = i * 12;
            rayEmissiveTrianglesData[base] = et.v0.x; rayEmissiveTrianglesData[base+1] = et.v0.y; rayEmissiveTrianglesData[base+2] = et.v0.z;
            rayEmissiveTrianglesData[base+3] = et.v1.x; rayEmissiveTrianglesData[base+4] = et.v1.y; rayEmissiveTrianglesData[base+5] = et.v1.z;
            rayEmissiveTrianglesData[base+6] = et.v2.x; rayEmissiveTrianglesData[base+7] = et.v2.y; rayEmissiveTrianglesData[base+8] = et.v2.z;
            rayEmissiveTrianglesData[base+9] = et.emission.r; rayEmissiveTrianglesData[base+10] = et.emission.g; rayEmissiveTrianglesData[base+11] = et.emission.b;
        }
        
        const allIndices = new Uint32Array(cursor.index);
        for(let i=0; i<cursor.index; i++) allIndices[i] = i;

        return {
            lights: lights,
            indices: allIndices,
        };
    }

    // --- WORKER 1: BVH BUILDER ---
    function rayRunBVHWorker(sceneRaw, onComplete) {
        const progressDiv = document.getElementById('progresso');
        if (progressDiv) progressDiv.innerHTML = 'building BVH (Hybrid)...';

        const bvhWorkerCode = `
        let triangleData = null;
        let triCentroids = null;
        let triBounds = null;
        
        let bvhBounds = [];
        let bvhContents = [];
        let bvhIndices = null;

        function precomputeBoundsAndCentroids(count) {
            triCentroids = new Float32Array(count * 3);
            triBounds = new Float32Array(count * 6);

            for (let i = 0; i < count; i++) {
                const base = i * 9;
                const x0 = triangleData[base],   y0 = triangleData[base+1], z0 = triangleData[base+2];
                const x1 = triangleData[base+3], y1 = triangleData[base+4], z1 = triangleData[base+5];
                const x2 = triangleData[base+6], y2 = triangleData[base+7], z2 = triangleData[base+8];

                const minX = Math.min(x0, Math.min(x1, x2));
                const minY = Math.min(y0, Math.min(y1, y2));
                const minZ = Math.min(z0, Math.min(z1, z2));
                const maxX = Math.max(x0, Math.max(x1, x2));
                const maxY = Math.max(y0, Math.max(y1, y2));
                const maxZ = Math.max(z0, Math.max(z1, z2));

                triBounds[i*6+0] = minX; triBounds[i*6+1] = minY; triBounds[i*6+2] = minZ;
                triBounds[i*6+3] = maxX; triBounds[i*6+4] = maxY; triBounds[i*6+5] = maxZ;

                triCentroids[i*3+0] = (minX + maxX) * 0.5;
                triCentroids[i*3+1] = (minY + maxY) * 0.5;
                triCentroids[i*3+2] = (minZ + maxZ) * 0.5;
            }
        }

        function buildNode(indices, start, end) {
            const count = end - start;
            const nodeIndex = bvhBounds.length / 6;

            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity;
            let cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;

            for (let i = start; i < end; i++) {
                const idx = indices[i];
                const tbBase = idx * 6;
                if (triBounds[tbBase] < minX) minX = triBounds[tbBase];
                if (triBounds[tbBase+1] < minY) minY = triBounds[tbBase+1];
                if (triBounds[tbBase+2] < minZ) minZ = triBounds[tbBase+2];
                if (triBounds[tbBase+3] > maxX) maxX = triBounds[tbBase+3];
                if (triBounds[tbBase+4] > maxY) maxY = triBounds[tbBase+4];
                if (triBounds[tbBase+5] > maxZ) maxZ = triBounds[tbBase+5];

                const tcBase = idx * 3;
                const cx = triCentroids[tcBase], cy = triCentroids[tcBase+1], cz = triCentroids[tcBase+2];
                if (cx < cMinX) cMinX = cx; if (cx > cMaxX) cMaxX = cx;
                if (cy < cMinY) cMinY = cy; if (cy > cMaxY) cMaxY = cy;
                if (cz < cMinZ) cMinZ = cz; if (cz > cMaxZ) cMaxZ = cz;
            }

            bvhBounds.push(minX, minY, minZ, maxX, maxY, maxZ);
            
            if (count <= 4) {
                bvhContents.push(start, count | 0x80000000); 
                return nodeIndex;
            }

            let bestAxis = -1;
            let bestSplitPos = 0;

            const extentX = cMaxX - cMinX;
            const extentY = cMaxY - cMinY;
            const extentZ = cMaxZ - cMinZ;
            
            if (extentX > extentY && extentX > extentZ) bestAxis = 0;
            else if (extentY > extentZ) bestAxis = 1;
            else bestAxis = 2;
            
            if (bestAxis === 0) bestSplitPos = (cMinX + cMaxX) * 0.5;
            else if (bestAxis === 1) bestSplitPos = (cMinY + cMaxY) * 0.5;
            else bestSplitPos = (cMinZ + cMaxZ) * 0.5;

            if (bestAxis === -1) {
                bvhContents.push(start, count | 0x80000000);
                return nodeIndex;
            }

            let i = start;
            let j = end - 1;
            while (i <= j) {
                const idxI = indices[i];
                const valI = triCentroids[idxI * 3 + bestAxis];
                if (valI < bestSplitPos) { i++; continue; }

                const idxJ = indices[j];
                const valJ = triCentroids[idxJ * 3 + bestAxis];
                if (valJ >= bestSplitPos) { j--; continue; }

                indices[i] = idxJ;
                indices[j] = idxI;
                i++; j--;
            }

            const leftCount = i - start;
            if (leftCount === 0 || leftCount === count) {
                bvhContents.push(start, count | 0x80000000);
                return nodeIndex;
            }

            const contentIndex = bvhContents.length;
            bvhContents.push(0, 0); 

            const leftChild = buildNode(indices, start, i);
            const rightChild = buildNode(indices, i, end);

            bvhContents[contentIndex] = leftChild;
            bvhContents[contentIndex+1] = rightChild;

            return nodeIndex;
        }

        self.onmessage = function(e) {
            const { indices, triangleData: td } = e.data;
            triangleData = td;
            const count = indices.length;

            precomputeBoundsAndCentroids(count);
            bvhIndices = indices; 
            
            buildNode(bvhIndices, 0, count);

            triCentroids = null; 
            triBounds = null;    

            const finalBounds = new Float32Array(bvhBounds);
            const finalContents = new Uint32Array(bvhContents);

            self.postMessage({
                bvh: {
                    bounds: finalBounds,
                    contents: finalContents,
                    indices: bvhIndices
                },
                triangleData: triangleData
            }, [finalBounds.buffer, finalContents.buffer, bvhIndices.buffer, triangleData.buffer]);
        };
        `;

        const blob = new Blob([bvhWorkerCode], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        worker.onmessage = function(e) {
            const { bvh, triangleData } = e.data;
            
            rayTriangleData = triangleData;
            rayBVHBounds = bvh.bounds;
            rayBVHContents = bvh.contents;
            rayBVHIndices = bvh.indices;

            worker.terminate(); 
            if (onComplete) onComplete();
        };

        worker.postMessage({
            indices: sceneRaw.indices,
            triangleData: rayTriangleData
        }, [sceneRaw.indices.buffer, rayTriangleData.buffer]);
    }


    // --- WORKER 2: RENDER WORKER (ReSTIR DI) ---
    function rayCreateWorkers() {
        const workerCode = `
    // WORKER - Ultimate Optimization (ReSTIR DI + Uint8 Textures + Feature Buffers)

    let bvhBounds = null; let bvhContents = null; let bvhIndices = null;
    let triangleData = null; let normalData = null; let uvData = null; let materialData = null;
    let textureList = null; let sceneLights = null; let camera = null; let config = null;
    let skyboxData = null; let skyboxWidth = 0; let skyboxHeight = 0; let useSkybox = false;
    let emissiveTrianglesData = null; let emissiveCount = 0;
    let cosineTable = null;

    const stack = new Uint32Array(64);
    const RIS_CANDIDATES = 32;

    let rngState = 1234;
    function xorshift32() {
        rngState ^= rngState << 13;
        rngState ^= rngState >>> 17;
        rngState ^= rngState << 5;
        return (rngState >>> 0) / 4294967296.0;
    }

    function sobol_2d(idx, dim) {
        let f = 1; let r = 0;
        let i = idx;
        const base = dim === 0 ? 2 : 3;
        while (i > 0) {
            f = f / base;
            r = r + f * (i % base);
            i = Math.floor(i / base);
        }
        return r;
    }

    function vec3_dot(ax, ay, az, bx, by, bz) { return ax*bx + ay*by + az*bz; }
    function vec3_cross(ax, ay, az, bx, by, bz) { return { x: ay*bz - az*by, y: az*bx - ax*bz, z: ax*by - ay*bx }; }

    function initCosineTable() {
        cosineTable = new Float32Array(256 * 256 * 2);
        for(let y=0; y<256; y++) {
            for(let x=0; x<256; x++) {
                const u = (x+0.5)/256; const v = (y+0.5)/256;
                const theta = 2 * Math.PI * u;
                const r = Math.sqrt(v);
                const tx = r * Math.cos(theta);
                const ty = r * Math.sin(theta);
                cosineTable[(y*256+x)*2] = tx;
                cosineTable[(y*256+x)*2+1] = ty;
            }
        }
    }

    function sampleCosineWeighted(nx, ny, nz) {
        const idx = (Math.floor(xorshift32() * 255.99) * 256 + Math.floor(xorshift32() * 255.99)) * 2;
        const lx = cosineTable[idx]; const ly = cosineTable[idx+1];
        const lz = Math.sqrt(Math.max(0, 1 - lx*lx - ly*ly));
        
        let ax = (Math.abs(nx) > 0.9) ? 0 : 1;
        let ay = (Math.abs(nx) > 0.9) ? 1 : 0;
        let az = 0;
        let ux = ay * nz - az * ny; let uy = az * nx - ax * nz; let uz = ax * ny - ay * nx;
        let len = Math.sqrt(ux*ux + uy*uy + uz*uz); ux/=len; uy/=len; uz/=len;
        let vx = ny * uz - nz * uy; let vy = nz * ux - nx * uz; let vz = nx * uy - ny * ux;
        
        return { 
            x: lx * ux + ly * vx + lz * nx,
            y: lx * uy + ly * vy + lz * ny,
            z: lx * uz + ly * vz + lz * nz
        };
    }

    function random_in_unit_sphere() {
        const u = xorshift32(); const v = xorshift32();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const r = Math.cbrt(xorshift32());
        const sinPhi = Math.sin(phi);
        return { x: r * sinPhi * Math.cos(theta), y: r * sinPhi * Math.sin(theta), z: r * Math.cos(phi) };
    }

    function random_unit_vector() {
        const u = xorshift32();
        const v = xorshift32();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const sinPhi = Math.sin(phi);
        return { x: sinPhi * Math.cos(theta), y: sinPhi * Math.sin(theta), z: Math.cos(phi) };
    }

    function reflect(vx, vy, vz, nx, ny, nz) {
        const dt = vx*nx + vy*ny + vz*nz; return { x: vx - 2*dt*nx, y: vy - 2*dt*ny, z: vz - 2*dt*nz };
    }

    function refract(uvx, uvy, uvz, nx, ny, nz, etai_over_etat) {
        const cos_theta = Math.min(vec3_dot(-uvx, -uvy, -uvz, nx, ny, nz), 1.0);
        const r_out_perp_x = etai_over_etat * (uvx + cos_theta * nx);
        const r_out_perp_y = etai_over_etat * (uvy + cos_theta * ny);
        const r_out_perp_z = etai_over_etat * (uvz + cos_theta * nz);
        const r_out_parallel_sq = r_out_perp_x*r_out_perp_x + r_out_perp_y*r_out_perp_y + r_out_perp_z*r_out_perp_z;
        if (Math.abs(1.0 - r_out_parallel_sq) < 0.0) return {x:0,y:0,z:0}; 
        const r_out_parallel_abs = Math.sqrt(Math.abs(1.0 - r_out_parallel_sq));
        return { x: r_out_perp_x - r_out_parallel_abs * nx, y: r_out_perp_y - r_out_parallel_abs * ny, z: r_out_perp_z - r_out_parallel_abs * nz };
    }

    function schlickFull(cosine, f0) {
        const omc = 1.0 - cosine;
        const omc2 = omc*omc;
        return f0 + (1.0 - f0) * (omc2*omc2*omc);
    }

    function sampleTexture(texId, u, v) {
        const tex = textureList[texId]; if(!tex) return [1,0,1]; 
        let tx = u - Math.floor(u); let ty = v - Math.floor(v); ty = 1.0 - ty; 
        const w = tex.width; const h = tex.height;
        const x = tx*(w-1); const y = ty*(h-1);
        const x0 = Math.floor(x); const y0 = Math.floor(y); const x1 = Math.min(x0+1, w-1); const y1 = Math.min(y0+1, h-1);
        const fx = x-x0; const fy = y-y0;
        const idx00=(y0*w+x0)*4; const idx10=(y0*w+x1)*4; const idx01=(y1*w+x0)*4; const idx11=(y1*w+x1)*4;
        
        const ifx = 1-fx; const ify = 1-fy;
        const w00 = ifx*ify; const w10 = fx*ify; const w01 = ifx*fy; const w11 = fx*fy;

        const inv255 = 0.00392156862; 
        const r = (w00*tex.data[idx00] + w10*tex.data[idx10] + w01*tex.data[idx01] + w11*tex.data[idx11]) * inv255;
        const g = (w00*tex.data[idx00+1] + w10*tex.data[idx10+1] + w01*tex.data[idx01+1] + w11*tex.data[idx11+1]) * inv255;
        const b = (w00*tex.data[idx00+2] + w10*tex.data[idx10+2] + w01*tex.data[idx01+2] + w11*tex.data[idx11+2]) * inv255;
        return [r, g, b];
    }

    function sampleSkybox(dx, dy, dz) {
        if (!useSkybox || !skyboxData) return [config.backgroundColor[0], config.backgroundColor[1], config.backgroundColor[2]];
        const theta = Math.atan2(dx, dz); const phi = Math.asin(Math.max(-1, Math.min(1, dy)));
        const u = 0.5 + theta / (2 * Math.PI); const v = 0.5 - phi / Math.PI;
        const x = u*(skyboxWidth-1); const y = v*(skyboxHeight-1);
        const x0 = Math.floor(x); const y0 = Math.floor(y); const x1 = Math.min(x0+1, skyboxWidth-1); const y1 = Math.min(y0+1, skyboxHeight-1);
        const fx = x-x0; const fy = y-y0;
        const idx00=(y0*skyboxWidth+x0)*4; const idx10=(y0*skyboxWidth+x1)*4; const idx01=(y1*skyboxWidth+x0)*4; const idx11=(y1*skyboxWidth+x1)*4;
        
        const ifx = 1-fx; const ify = 1-fy;
        const w00 = ifx*ify; const w10 = fx*ify; const w01 = ifx*fy; const w11 = fx*fy;

        const inv255 = 0.00392156862;
        const r = (w00*skyboxData[idx00] + w10*skyboxData[idx10] + w01*skyboxData[idx01] + w11*skyboxData[idx11]) * inv255;
        const g = (w00*skyboxData[idx00+1] + w10*skyboxData[idx10+1] + w01*skyboxData[idx01+1] + w11*skyboxData[idx11+1]) * inv255;
        const b = (w00*skyboxData[idx00+2] + w10*skyboxData[idx10+2] + w01*skyboxData[idx01+2] + w11*skyboxData[idx11+2]) * inv255;
        return [r, g, b];
    }

    function intersectTriangle(rox, roy, roz, rdx, rdy, rdz, triIndex, tMax, hitRecord) {
        const base = triIndex * 9;
        const v0x = triangleData[base]; const v0y = triangleData[base+1]; const v0z = triangleData[base+2];
        const v1x = triangleData[base+3]; const v1y = triangleData[base+4]; const v1z = triangleData[base+5];
        const v2x = triangleData[base+6]; const v2y = triangleData[base+7]; const v2z = triangleData[base+8];
        const e1x = v1x - v0x; const e1y = v1y - v0y; const e1z = v1z - v0z;
        const e2x = v2x - v0x; const e2y = v2y - v0y; const e2z = v2z - v0z;
        const hx = rdy * e2z - rdz * e2y; const hy = rdz * e2x - rdx * e2z; const hz = rdx * e2y - rdy * e2x;
        const a = e1x * hx + e1y * hy + e1z * hz;
        if (a > -1e-7 && a < 1e-7) return false;
        const f = 1.0 / a;
        const sx = rox - v0x; const sy = roy - v0y; const sz = roz - v0z;
        const u = f * (sx * hx + sy * hy + sz * hz);
        if (u < 0.0 || u > 1.0) return false;
        const qx = sy * e1z - sz * e1y; const qy = sz * e1x - sx * e1z; const qz = sx * e1y - sy * e1x;
        const v = f * (rdx * qx + rdy * qy + rdz * qz);
        if (v < 0.0 || u + v > 1.0) return false;
        const t = f * (e2x * qx + e2y * qy + e2z * qz);
        if (t > 1e-7 && t < tMax) {
            hitRecord.distance = t;
            hitRecord.u = u;
            hitRecord.v = v;
            hitRecord.index = triIndex;
            hitRecord.hit = true;
            return true;
        }
        return false;
    }

    function intersectAABB(rox, roy, roz, rinvDx, rinvDy, rinvDz, nodeIdx, tMax) {
        const base = nodeIdx * 6;
        let t0 = (bvhBounds[base] - rox) * rinvDx; let t1 = (bvhBounds[base+3] - rox) * rinvDx;
        if (rinvDx < 0.0) { let s = t0; t0 = t1; t1 = s; }
        let tmin = t0; let tmax = t1;
        t0 = (bvhBounds[base+1] - roy) * rinvDy; t1 = (bvhBounds[base+4] - roy) * rinvDy;
        if (rinvDy < 0.0) { let s = t0; t0 = t1; t1 = s; }
        if ((t0 > tmax) || (tmin > t1)) return false;
        if (t0 > tmin) tmin = t0; if (t1 < tmax) tmax = t1;
        t0 = (bvhBounds[base+2] - roz) * rinvDz; t1 = (bvhBounds[base+5] - roz) * rinvDz;
        if (rinvDz < 0.0) { let s = t0; t0 = t1; t1 = s; }
        if ((t0 > tmax) || (tmin > t1)) return false;
        return tmin < tMax && tmax > 0.0;
    }

    function intersectScene(rox, roy, roz, rdx, rdy, rdz, tMax, outHit) {
        const rinvDx = 1.0 / rdx; const rinvDy = 1.0 / rdy; const rinvDz = 1.0 / rdz;
        outHit.hit = false; outHit.distance = tMax; outHit.index = -1;
        
        let stackPtr = 0; stack[stackPtr++] = 0;
        while (stackPtr > 0) {
            const nodeIdx = stack[--stackPtr];
            if (!intersectAABB(rox, roy, roz, rinvDx, rinvDy, rinvDz, nodeIdx, outHit.distance)) continue;
            const contentData1 = bvhContents[nodeIdx * 2]; const contentData2 = bvhContents[nodeIdx * 2 + 1];
            const isLeaf = (contentData2 & 0x80000000) !== 0;
            if (isLeaf) {
                const count = contentData2 & 0x7FFFFFFF; const offset = contentData1;
                for(let i = 0; i < count; i++) {
                    const triIdx = bvhIndices[offset + i];
                    intersectTriangle(rox, roy, roz, rdx, rdy, rdz, triIdx, outHit.distance, outHit);
                }
            } else { 
                stack[stackPtr++] = contentData2; 
                stack[stackPtr++] = contentData1; 
            }
        }
    }

    function fillHitData(hit, rox, roy, roz, rdx, rdy, rdz) {
         const idx = hit.index; 
         const nBase = idx * 9;
         const n0x = normalData[nBase], n0y = normalData[nBase+1], n0z = normalData[nBase+2];
         const n1x = normalData[nBase+3], n1y = normalData[nBase+4], n1z = normalData[nBase+5];
         const n2x = normalData[nBase+6], n2y = normalData[nBase+7], n2z = normalData[nBase+8];
         
         const w = 1.0 - hit.u - hit.v;
         let nx = w * n0x + hit.u * n1x + hit.v * n2x;
         let ny = w * n0y + hit.u * n1y + hit.v * n2y;
         let nz = w * n0z + hit.u * n1z + hit.v * n2z;
         const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
         
         const uvBase = idx * 6;
         const u0 = uvData[uvBase], v0 = uvData[uvBase+1];
         const u1 = uvData[uvBase+2], v1 = uvData[uvBase+3];
         const u2 = uvData[uvBase+4], v2 = uvData[uvBase+5];
         const finalU = w * u0 + hit.u * u1 + hit.v * u2;
         const finalV = w * v0 + hit.u * v1 + hit.v * v2;
         const mBase = idx * 11;
         
         hit.point = { x: rox + rdx * hit.distance, y: roy + rdy * hit.distance, z: roz + rdz * hit.distance };
         hit.normal = { x: nx/len, y: ny/len, z: nz/len };
         hit.uv = { u: finalU, v: finalV };
         hit.material = {
             color: [materialData[mBase], materialData[mBase+1], materialData[mBase+2]],
             roughness: materialData[mBase+3], 
             emissive: [materialData[mBase+5], materialData[mBase+6], materialData[mBase+7]],
             metalness: materialData[mBase+8], 
             transmission: materialData[mBase+9], 
             textureId: materialData[mBase+10]
         };
    }

    function computeAO(px, py, pz, nx, ny, nz) {
        if (!config.aoEnabled) return 1.0;
        let occlusion = 0.0; const samples = config.aoSamples; const radius = config.aoRadius; const intensity = config.aoIntensity;
        const tempHit = { hit: false, distance: Infinity };
        for(let i=0; i<samples; i++) {
            const u = xorshift32(); const v = xorshift32();
            const theta = 2 * Math.PI * u; const phi = Math.acos(2 * v - 1);
            const sinPhi = Math.sin(phi);
            let dx = sinPhi * Math.cos(theta); let dy = sinPhi * Math.sin(theta); let dz = Math.cos(phi);
            
            if (vec3_dot(dx, dy, dz, nx, ny, nz) < 0) { dx = -dx; dy = -dy; dz = -dz; }
            intersectScene(px + nx * 0.001, py + ny * 0.001, pz + nz * 0.001, dx, dy, dz, radius, tempHit);
            if (tempHit.hit) occlusion += 1.0;
        }
        return 1.0 - ((occlusion / samples) * intensity);
    }

    function powerHeuristic(pdf1, pdf2) {
        const f = pdf1 * pdf1;
        const g = pdf2 * pdf2;
        return f / (f + g);
    }

    function pathTraceIterative(camX, camY, camZ, rdx, rdy, rdz) {
        let throughput = [1, 1, 1]; let accumulatedLight = [0, 0, 0];
        let curX = camX, curY = camY, curZ = camZ; let curDx = rdx, curDy = rdy, curDz = rdz;
        let firstHitNormal = {x:0, y:0, z:0};
        let firstHitDepth = -1.0;
        let firstHitAlbedo = [0,0,0];
        let firstHitRoughness = 0;    // CAPTURE FEATURE
        let firstHitTransmission = 0; // CAPTURE FEATURE
        
        const mainHit = { hit: false, distance: Infinity, index: -1, u: 0, v: 0 };

        for (let depth = 0; depth < config.maxBounces; depth++) {
            intersectScene(curX, curY, curZ, curDx, curDy, curDz, Infinity, mainHit);
            
            if (depth === 0) {
                if (mainHit.hit) { 
                    fillHitData(mainHit, curX, curY, curZ, curDx, curDy, curDz);
                    firstHitNormal = mainHit.normal; firstHitDepth = mainHit.distance; 
                    firstHitRoughness = mainHit.material.roughness;
                    firstHitTransmission = mainHit.material.transmission;
                    
                    // ALBEDO EXTRACTION
                    let baseCol = [mainHit.material.color[0], mainHit.material.color[1], mainHit.material.color[2]];
                    if (mainHit.material.textureId >= 0) {
                         const texColor = sampleTexture(mainHit.material.textureId, mainHit.uv.u, mainHit.uv.v);
                         baseCol[0] *= texColor[0]; baseCol[1] *= texColor[1]; baseCol[2] *= texColor[2];
                    }
                    firstHitAlbedo = baseCol;
                } 
                else { firstHitDepth = 10000.0; firstHitAlbedo = [0,0,0]; }
            } else if (mainHit.hit) {
                fillHitData(mainHit, curX, curY, curZ, curDx, curDy, curDz);
            }

            if (!mainHit.hit) {
                const skyColor = sampleSkybox(curDx, curDy, curDz);
                let skyR = throughput[0] * skyColor[0];
                let skyG = throughput[1] * skyColor[1];
                let skyB = throughput[2] * skyColor[2];
                if (depth > 0) {
                    const maxSkyBrightness = 10.0; 
                    skyR = Math.min(skyR, maxSkyBrightness);
                    skyG = Math.min(skyG, maxSkyBrightness);
                    skyB = Math.min(skyB, maxSkyBrightness);
                }
                accumulatedLight[0] += skyR; accumulatedLight[1] += skyG; accumulatedLight[2] += skyB;
                break;
            }

            if (mainHit.material.textureId >= 0) {
                 const texColor = sampleTexture(mainHit.material.textureId, mainHit.uv.u, mainHit.uv.v);
                 mainHit.material.color[0] *= texColor[0]; mainHit.material.color[1] *= texColor[1]; mainHit.material.color[2] *= texColor[2];
            }
            
            if (depth === 0 && config.aoEnabled) {
                const aoFactor = computeAO(mainHit.point.x, mainHit.point.y, mainHit.point.z, mainHit.normal.x, mainHit.normal.y, mainHit.normal.z);
                throughput[0] *= aoFactor; throughput[1] *= aoFactor; throughput[2] *= aoFactor;
            }

            let emR = mainHit.material.emissive[0]; let emG = mainHit.material.emissive[1]; let emB = mainHit.material.emissive[2];
            accumulatedLight[0] += throughput[0] * emR; accumulatedLight[1] += throughput[1] * emG; accumulatedLight[2] += throughput[2] * emB;

            let scatterDir = {x:0, y:0, z:0};
            
            if (xorshift32() < mainHit.material.metalness) {
                 const reflected = reflect(curDx, curDy, curDz, mainHit.normal.x, mainHit.normal.y, mainHit.normal.z);
                 const fuzz = random_in_unit_sphere();
                 scatterDir.x = reflected.x + fuzz.x * mainHit.material.roughness;
                 scatterDir.y = reflected.y + fuzz.y * mainHit.material.roughness;
                 scatterDir.z = reflected.z + fuzz.z * mainHit.material.roughness;
                 if (vec3_dot(scatterDir.x, scatterDir.y, scatterDir.z, mainHit.normal.x, mainHit.normal.y, mainHit.normal.z) <= 0) break; 
                 throughput[0] *= mainHit.material.color[0]; throughput[1] *= mainHit.material.color[1]; throughput[2] *= mainHit.material.color[2];

            } else {
                 const F0 = 0.04; 
                 let cosine = -vec3_dot(curDx, curDy, curDz, mainHit.normal.x, mainHit.normal.y, mainHit.normal.z);
                 if (cosine < 0) cosine = -cosine; 
                 const fresnelReflectance = schlickFull(cosine, F0);
                 
                 if (xorshift32() < fresnelReflectance) {
                     const reflected = reflect(curDx, curDy, curDz, mainHit.normal.x, mainHit.normal.y, mainHit.normal.z);
                     const fuzz = random_in_unit_sphere();
                     scatterDir.x = reflected.x + fuzz.x * mainHit.material.roughness;
                     scatterDir.y = reflected.y + fuzz.y * mainHit.material.roughness;
                     scatterDir.z = reflected.z + fuzz.z * mainHit.material.roughness;
                     if (vec3_dot(scatterDir.x, scatterDir.y, scatterDir.z, mainHit.normal.x, mainHit.normal.y, mainHit.normal.z) <= 0) {
                          const rand = random_unit_vector();
                          scatterDir = { x: mainHit.normal.x + rand.x, y: mainHit.normal.y + rand.y, z: mainHit.normal.z + rand.z };
                     }
                 } else {
                      if (xorshift32() < mainHit.material.transmission) {
                        const refIdx = 1.5;
                        let etai_over_etat = 1.0 / refIdx;
                        let normal = mainHit.normal;
                        const dot = vec3_dot(curDx, curDy, curDz, normal.x, normal.y, normal.z);
                        if (dot > 0) { normal = {x: -normal.x, y: -normal.y, z: -normal.z}; etai_over_etat = refIdx; }
                        scatterDir = refract(curDx, curDy, curDz, normal.x, normal.y, normal.z, etai_over_etat);
                        throughput[0] *= mainHit.material.color[0]; throughput[1] *= mainHit.material.color[1]; throughput[2] *= mainHit.material.color[2];
                      } else {
                        // ReSTIR DI - Weighted Reservoir Sampling (RIS)
                        scatterDir = sampleCosineWeighted(mainHit.normal.x, mainHit.normal.y, mainHit.normal.z);
                        const bsdfPdf = vec3_dot(scatterDir.x, scatterDir.y, scatterDir.z, mainHit.normal.x, mainHit.normal.y, mainHit.normal.z) / Math.PI;

                        if (emissiveCount > 0) {
                            if (config.useReSTIR) {
                                let r_y_index = -1;  
                                let r_w_sum = 0;     
                                let r_M = 0;         
                                const numCandidates = RIS_CANDIDATES;
                                
                                for (let c = 0; c < numCandidates; c++) {
                                    const lightIdx = Math.floor(xorshift32() * emissiveCount);
                                    
                                    const base = lightIdx * 12;
                                    const v0 = {x:emissiveTrianglesData[base], y:emissiveTrianglesData[base+1], z:emissiveTrianglesData[base+2]};
                                    const v1 = {x:emissiveTrianglesData[base+3], y:emissiveTrianglesData[base+4], z:emissiveTrianglesData[base+5]};
                                    const v2 = {x:emissiveTrianglesData[base+6], y:emissiveTrianglesData[base+7], z:emissiveTrianglesData[base+8]};
                                    const emission = {r:emissiveTrianglesData[base+9], g:emissiveTrianglesData[base+10], b:emissiveTrianglesData[base+11]};
                                    
                                    const r1 = xorshift32(); const r2 = xorshift32();
                                    const sqr1 = Math.sqrt(r1); const u = 1 - sqr1; const v = r2 * sqr1; const w = 1 - u - v; 
                                    const lx = w*v0.x + u*v1.x + v*v2.x; const ly = w*v0.y + u*v1.y + v*v2.y; const lz = w*v0.z + u*v1.z + v*v2.z;

                                    let ldx = lx - mainHit.point.x; let ldy = ly - mainHit.point.y; let ldz = lz - mainHit.point.z;
                                    const distSq = ldx*ldx + ldy*ldy + ldz*ldz; 
                                    const ldxn = ldx/Math.sqrt(distSq); const ldyn = ldy/Math.sqrt(distSq); const ldzn = ldz/Math.sqrt(distSq);

                                    const cosTheta = mainHit.normal.x * ldxn + mainHit.normal.y * ldyn + mainHit.normal.z * ldzn;
                                    
                                    let pHat = 0;
                                    if (cosTheta > 0) {
                                        const e1 = {x:v1.x-v0.x, y:v1.y-v0.y, z:v1.z-v0.z};
                                        const e2 = {x:v2.x-v0.x, y:v2.y-v0.y, z:v2.z-v0.z};
                                        const ln = vec3_cross(e1.x, e1.y, e1.z, e2.x, e2.y, e2.z);
                                        const area2 = Math.sqrt(ln.x*ln.x + ln.y*ln.y + ln.z*ln.z);
                                        const lnx = ln.x/area2; const lny = ln.y/area2; const lnz = ln.z/area2;
                                        const cosLight = -(ldxn*lnx + ldyn*lny + ldzn*lnz);
                                        
                                        if (cosLight > 0) {
                                            const intensity = (emission.r + emission.g + emission.b) / 3.0;
                                            const geo = (cosTheta * cosLight) / distSq;
                                            pHat = intensity * geo;
                                        }
                                    }

                                    r_w_sum += pHat;
                                    r_M++;
                                    if (xorshift32() < (pHat / r_w_sum)) {
                                        r_y_index = lightIdx;
                                    }
                                }

                                if (r_y_index >= 0 && r_w_sum > 0) {
                                    const W = (1.0 / (r_w_sum / r_M)) * (r_w_sum / r_M); 
                                    const base = r_y_index * 12;
                                    const v0 = {x:emissiveTrianglesData[base], y:emissiveTrianglesData[base+1], z:emissiveTrianglesData[base+2]};
                                    const v1 = {x:emissiveTrianglesData[base+3], y:emissiveTrianglesData[base+4], z:emissiveTrianglesData[base+5]};
                                    const v2 = {x:emissiveTrianglesData[base+6], y:emissiveTrianglesData[base+7], z:emissiveTrianglesData[base+8]};
                                    const emission = {r:emissiveTrianglesData[base+9], g:emissiveTrianglesData[base+10], b:emissiveTrianglesData[base+11]};

                                    const r1 = xorshift32(); const r2 = xorshift32();
                                    const sqr1 = Math.sqrt(r1); const u = 1 - sqr1; const v = r2 * sqr1; const w = 1 - u - v; 
                                    const lx = w*v0.x + u*v1.x + v*v2.x; const ly = w*v0.y + u*v1.y + v*v2.y; const lz = w*v0.z + u*v1.z + v*v2.z;
                                    let ldx = lx - mainHit.point.x; let ldy = ly - mainHit.point.y; let ldz = lz - mainHit.point.z;
                                    const distSq = ldx*ldx + ldy*ldy + ldz*ldz; const dist = Math.sqrt(distSq); ldx /= dist; ldy /= dist; ldz /= dist;
                                    
                                    const shadowHit = {hit:false, distance: dist-0.01};
                                    intersectScene(mainHit.point.x + mainHit.normal.x*0.001, mainHit.point.y + mainHit.normal.y*0.001, mainHit.point.z + mainHit.normal.z*0.001, ldx, ldy, ldz, dist - 0.01, shadowHit);
                                    
                                    if (!shadowHit.hit) {
                                        const avgP = r_w_sum / r_M;
                                        let directR = throughput[0] * mainHit.material.color[0] * emission.r * avgP * emissiveCount * (1.0/Math.PI); 
                                        let directG = throughput[1] * mainHit.material.color[1] * emission.g * avgP * emissiveCount * (1.0/Math.PI);
                                        let directB = throughput[2] * mainHit.material.color[2] * emission.b * avgP * emissiveCount * (1.0/Math.PI);
                                        
                                        const maxNEE = 10.0;
                                        directR = Math.min(directR, maxNEE); directG = Math.min(directG, maxNEE); directB = Math.min(directB, maxNEE);
                                        accumulatedLight[0] += directR; accumulatedLight[1] += directG; accumulatedLight[2] += directB;
                                    }
                                }

                            } else {
                                // STANDARD NEE
                                const lightIdx = Math.floor(xorshift32() * emissiveCount);
                                const base = lightIdx * 12;
                                const v0 = {x:emissiveTrianglesData[base], y:emissiveTrianglesData[base+1], z:emissiveTrianglesData[base+2]};
                                const v1 = {x:emissiveTrianglesData[base+3], y:emissiveTrianglesData[base+4], z:emissiveTrianglesData[base+5]};
                                const v2 = {x:emissiveTrianglesData[base+6], y:emissiveTrianglesData[base+7], z:emissiveTrianglesData[base+8]};
                                const emission = {r:emissiveTrianglesData[base+9], g:emissiveTrianglesData[base+10], b:emissiveTrianglesData[base+11]};

                                const r1 = xorshift32(); const r2 = xorshift32();
                                const sqr1 = Math.sqrt(r1); const u = 1 - sqr1; const v = r2 * sqr1; const w = 1 - u - v; 
                                const lx = w*v0.x + u*v1.x + v*v2.x; const ly = w*v0.y + u*v1.y + v*v2.y; const lz = w*v0.z + u*v1.z + v*v2.z;

                                let ldx = lx - mainHit.point.x; let ldy = ly - mainHit.point.y; let ldz = lz - mainHit.point.z;
                                const distSq = ldx*ldx + ldy*ldy + ldz*ldz; const dist = Math.sqrt(distSq); ldx /= dist; ldy /= dist; ldz /= dist;

                                const cosTheta = mainHit.normal.x * ldx + mainHit.normal.y * ldy + mainHit.normal.z * ldz;
                                if (cosTheta > 0) {
                                    const e1 = {x:v1.x-v0.x, y:v1.y-v0.y, z:v1.z-v0.z};
                                    const e2 = {x:v2.x-v0.x, y:v2.y-v0.y, z:v2.z-v0.z};
                                    const ln = vec3_cross(e1.x, e1.y, e1.z, e2.x, e2.y, e2.z);
                                    const area2 = Math.sqrt(ln.x*ln.x + ln.y*ln.y + ln.z*ln.z);
                                    const area = area2 * 0.5;
                                    const lnx = ln.x/area2; const lny = ln.y/area2; const lnz = ln.z/area2;
                                    const cosLight = -(ldx*lnx + ldy*lny + ldz*lnz);
                                    if (cosLight > 0) {
                                        const shadowHit = {hit:false, distance: dist-0.01};
                                        intersectScene(mainHit.point.x + mainHit.normal.x*0.001, mainHit.point.y + mainHit.normal.y*0.001, mainHit.point.z + mainHit.normal.z*0.001, ldx, ldy, ldz, dist - 0.01, shadowHit);
                                        if (!shadowHit.hit) {
                                            const lightPdf = distSq / (area * cosLight);
                                            const weight = powerHeuristic(lightPdf, bsdfPdf); 
                                            const geometryFactor = (cosTheta * cosLight * area) / distSq;
                                            const val = geometryFactor * emissiveCount; 
                                            let directR = throughput[0] * mainHit.material.color[0] * emission.r * val * (1/Math.PI);
                                            let directG = throughput[1] * mainHit.material.color[1] * emission.g * val * (1/Math.PI);
                                            let directB = throughput[2] * mainHit.material.color[2] * emission.b * val * (1/Math.PI);
                                            const maxNEE = 10.0;
                                            directR = Math.min(directR, maxNEE); directG = Math.min(directG, maxNEE); directB = Math.min(directB, maxNEE);
                                            accumulatedLight[0] += directR; accumulatedLight[1] += directG; accumulatedLight[2] += directB;
                                        }
                                    }
                                }
                            }
                        }

                        for(let i=0; i<sceneLights.length; i++) {
                            const light = sceneLights[i];
                            let ldx, ldy, ldz, dist, distSq;
                            let att = 1.0;

                            if (light.type === "directional") {
                                let lx = -light.direction.x; let ly = -light.direction.y; let lz = -light.direction.z;
                                if (light.radius > 0.0) {
                                    const r = random_in_unit_sphere();
                                    lx += r.x * light.radius; ly += r.y * light.radius; lz += r.z * light.radius;
                                    const len = Math.sqrt(lx*lx + ly*ly + lz*lz);
                                    lx/=len; ly/=len; lz/=len;
                                }
                                ldx = lx; ldy = ly; ldz = lz;
                                dist = Infinity; distSq = 1.0; att = light.intensity; 
                            } else {
                                let lx = light.position.x; let ly = light.position.y; let lz = light.position.z;
                                if (light.radius > 0.0) {
                                     const u = xorshift32(); const v = xorshift32(); const theta = 2 * Math.PI * u; const phi = Math.acos(2 * v - 1); const r = Math.cbrt(xorshift32()); const sinPhi = Math.sin(phi);
                                     const rnd = { x: r * sinPhi * Math.cos(theta), y: r * sinPhi * Math.sin(theta), z: r * Math.cos(phi) };
                                     lx += rnd.x * light.radius; ly += rnd.y * light.radius; lz += rnd.z * light.radius;
                                }
                                ldx = lx - mainHit.point.x; ldy = ly - mainHit.point.y; ldz = lz - mainHit.point.z;
                                distSq = ldx*ldx + ldy*ldy + ldz*ldz; dist = Math.sqrt(distSq); ldx /= dist; ldy /= dist; ldz /= dist;
                                att = light.intensity / distSq;
                            }

                            const cosTheta = mainHit.normal.x * ldx + mainHit.normal.y * ldy + mainHit.normal.z * ldz;
                            if (cosTheta > 0) {
                                let inShadow = false;
                                if (light.castShadow !== false) {
                                    const shadowMax = (light.type === "directional") ? 100000.0 : (dist - 0.01);
                                    const shadowHit = {hit: false, distance: shadowMax};
                                    intersectScene(mainHit.point.x + mainHit.normal.x * 0.001, mainHit.point.y + mainHit.normal.y * 0.001, mainHit.point.z + mainHit.normal.z * 0.001, ldx, ldy, ldz, shadowMax, shadowHit);
                                    inShadow = shadowHit.hit;
                                }
                                if (!inShadow) {
                                     const pdf = 1 / Math.PI; 
                                     let directR = throughput[0] * mainHit.material.color[0] * pdf * light.color[0] * cosTheta * att;
                                     let directG = throughput[1] * mainHit.material.color[1] * pdf * light.color[1] * cosTheta * att;
                                     let directB = throughput[2] * mainHit.material.color[2] * pdf * light.color[2] * cosTheta * att;
                                     directR = Math.min(directR, 10.0); directG = Math.min(directG, 10.0); directB = Math.min(directB, 10.0);
                                     accumulatedLight[0] += directR; accumulatedLight[1] += directG; accumulatedLight[2] += directB;
                                }
                            }
                        }
                        throughput[0] *= mainHit.material.color[0]; throughput[1] *= mainHit.material.color[1]; throughput[2] *= mainHit.material.color[2];
                      }
                 }
            }
            
            if (depth > 2) {
                const p = Math.max(throughput[0], Math.max(throughput[1], throughput[2]));
                if (xorshift32() > p) break; 
                throughput[0] /= p; throughput[1] /= p; throughput[2] /= p;
            }
            
            const len = Math.sqrt(scatterDir.x*scatterDir.x + scatterDir.y*scatterDir.y + scatterDir.z*scatterDir.z);
            curDx = scatterDir.x / len; curDy = scatterDir.y / len; curDz = scatterDir.z / len;
            curX = mainHit.point.x + curDx * 0.0001; curY = mainHit.point.y + curDy * 0.0001; curZ = mainHit.point.z + curDz * 0.0001;
        }
        return { 
            r: accumulatedLight[0], g: accumulatedLight[1], b: accumulatedLight[2], 
            nx: firstHitNormal.x, ny: firstHitNormal.y, nz: firstHitNormal.z, depth: firstHitDepth,
            albedo: firstHitAlbedo,
            roughness: firstHitRoughness,
            transmission: firstHitTransmission
        };
    }

    self.onmessage = function(e) {
        const { type, data } = e.data;
        if (type === 'init') {
            bvhBounds = data.bvhBounds; bvhContents = data.bvhContents; bvhIndices = data.bvhIndices;
            sceneLights = data.lights; triangleData = data.triangleData; normalData = data.normalData;
            uvData = data.uvData; materialData = data.materialData; textureList = data.textureList; camera = data.camera; config = data.config;
            emissiveTrianglesData = data.emissiveTrianglesData; emissiveCount = emissiveTrianglesData ? emissiveTrianglesData.length / 12 : 0;
            if (data.skyboxData) { skyboxData = data.skyboxData; skyboxWidth = data.skyboxWidth; skyboxHeight = data.skyboxHeight; useSkybox = data.useSkybox; }
            
            rngState = (1234 + Math.random() * 99999) | 0;
            initCosineTable();
            
            self.postMessage({ type: 'ready' });
        } else if (type === 'renderTile') {
            const { startX, startY, tileW, tileH, width, height, sampleIndex, jitterX, jitterY } = data;
            const tileData = new Float32Array(tileW * tileH * 13); // Aumentado para 13 floats para incluir features
            const camX = camera.position.x; const camY = camera.position.y; const camZ = camera.position.z;
            const aspect = camera.aspect; const fovScale = Math.tan(camera.fov * Math.PI / 180 / 2);
            let fx = camera.target.x - camX; let fy = camera.target.y - camY; let fz = camera.target.z - camZ;
            let len = Math.sqrt(fx*fx + fy*fy + fz*fz); fx/=len; fy/=len; fz/=len;
            let rx = -fz; let ry = 0; let rz = fx; len = Math.sqrt(rx*rx + ry*ry + rz*rz); rx/=len; ry/=len; rz/=len;
            let ux = ry * fz - rz * fy; let uy = rz * fx - rx * fz; let uz = rx * fy - ry * fx; len = Math.sqrt(ux*ux + uy*uy + uz*uz); ux/=len; uy/=len; uz/=len;
            
            let idx = 0;
            const aperture = config.aperture || 0.0;
            const focusDist = config.focusDistance || 10.0;
            
            let pixelCounter = 0;
            for (let y = startY; y < startY + tileH; y++) {
                for (let x = startX; x < startX + tileW; x++) {
                    
                    const r1 = sobol_2d(sampleIndex * 10000 + pixelCounter, 0) - 0.5 + (jitterX || 0);
                    const r2 = sobol_2d(sampleIndex * 10000 + pixelCounter, 1) - 0.5 + (jitterY || 0);
                    pixelCounter++;

                    const u = (2 * (x + r1) / width - 1) * aspect * fovScale;
                    const v = (1 - 2 * (y + r2) / height) * fovScale;
                    let rdx = fx + rx * u + ux * v; let rdy = fy + ry * u + uy * v; let rdz = fz + rz * u + uz * v;
                    let rlen = Math.sqrt(rdx*rdx + rdy*rdy + rdz*rdz);
                    let dirX = rdx/rlen, dirY = rdy/rlen, dirZ = rdz/rlen;
                    let orgX = camX, orgY = camY, orgZ = camZ;
                    
                    if (aperture > 0.0) {
                        const focusPointX = camX + dirX * focusDist; const focusPointY = camY + dirY * focusDist; const focusPointZ = camZ + dirZ * focusDist;
                        const rdR = Math.sqrt(xorshift32()); const rdTheta = 2 * Math.PI * xorshift32();
                        const lensRadius = aperture / 2.0;
                        const offsetX = rx * (rdR * Math.cos(rdTheta)) * lensRadius + ux * (rdR * Math.sin(rdTheta)) * lensRadius;
                        const offsetY = ry * (rdR * Math.cos(rdTheta)) * lensRadius + uy * (rdR * Math.sin(rdTheta)) * lensRadius;
                        const offsetZ = rz * (rdR * Math.cos(rdTheta)) * lensRadius + uz * (rdR * Math.sin(rdTheta)) * lensRadius;
                        orgX += offsetX; orgY += offsetY; orgZ += offsetZ;
                        const newDirX = focusPointX - orgX; const newDirY = focusPointY - orgY; const newDirZ = focusPointZ - orgZ;
                        const newLen = Math.sqrt(newDirX*newDirX + newDirY*newDirY + newDirZ*newDirZ);
                        dirX = newDirX/newLen; dirY = newDirY/newLen; dirZ = newDirZ/newLen;
                    }
                    
                    const result = pathTraceIterative(orgX, orgY, orgZ, dirX, dirY, dirZ);
                    tileData[idx++] = result.r; tileData[idx++] = result.g; tileData[idx++] = result.b; tileData[idx++] = 1.0; 
                    tileData[idx++] = result.nx; tileData[idx++] = result.ny; tileData[idx++] = result.nz; tileData[idx++] = result.depth;
                    tileData[idx++] = result.albedo[0]; tileData[idx++] = result.albedo[1]; tileData[idx++] = result.albedo[2];
                    tileData[idx++] = result.roughness; tileData[idx++] = result.transmission; // EXTRA FEATURES
                }
            }
            self.postMessage({ type: 'result', data: { startX, startY, tileW, tileH, tileData } }, [tileData.buffer]);
        }
    };
    `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerURL = URL.createObjectURL(blob);
        for (let i = 0; i < rayNumWorkers; i++) rayWorkers.push(new Worker(workerURL));
    }

    function rayToneMapACES(color) {
        const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return [
            Math.max(0, (color[0] * (a * color[0] + b)) / (color[0] * (c * color[0] + d) + e)),
            Math.max(0, (color[1] * (a * color[1] + b)) / (color[1] * (c * color[1] + d) + e)),
            Math.max(0, (color[2] * (a * color[2] + b)) / (color[2] * (c * color[2] + d) + e))
        ];
    }

    function rayGammaCorrect(color) {
        const gamma = 2.2;
        return color.map(c => Math.pow(Math.max(0, Math.min(1, c)), 1 / gamma));
    }

    // --- PROGRESSIVE A-TROUS DENOISER PASS ---
    function rayRunDenoisePass(width, height, inputBuffer, outputBuffer, normalDepthBuffer, albedoBuffer, auxBuffer, stepSize) {
        const w = width; const h = height;
        const kernel = [1/16, 1/4, 3/8, 1/4, 1/16];
        
        // Ajuste fino dos sigmas - mais rigorosos para preservar detalhes
        const baseSigmaColor = 1.0;
        const baseSigmaNormal = 0.1; // Tighter sigma to keep edges sharp
        const baseSigmaDepth = 0.1;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;

                // Feature check
                const roughness = auxBuffer[idx];
                const transmission = auxBuffer[idx+1];

                // SKIP DENOISE FOR GLASS/TRANSMISSION
                if (transmission > 0.05) {
                    outputBuffer[idx] = inputBuffer[idx];
                    outputBuffer[idx+1] = inputBuffer[idx+1];
                    outputBuffer[idx+2] = inputBuffer[idx+2];
                    outputBuffer[idx+3] = 1.0;
                    continue;
                }

                const cVal = [inputBuffer[idx], inputBuffer[idx+1], inputBuffer[idx+2]];
                const nVal = [normalDepthBuffer[idx], normalDepthBuffer[idx+1], normalDepthBuffer[idx+2]];
                const dVal = normalDepthBuffer[idx+3];

                // Adapt sigma based on Roughness (Sharper reflections on low roughness)
                const sigmaColor = baseSigmaColor * Math.max(0.2, roughness * 2.0); 
                const sigmaNormal = baseSigmaNormal; 
                const sigmaDepth = baseSigmaDepth;

                let sumWeight = 0;
                let sumC = [0, 0, 0];

                for (let ky = -2; ky <= 2; ky++) {
                    for (let kx = -2; kx <= 2; kx++) {
                        const iy = y + ky * stepSize;
                        const ix = x + kx * stepSize;

                        if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                            const qIdx = (iy * w + ix) * 4;
                            const cQ = [inputBuffer[qIdx], inputBuffer[qIdx+1], inputBuffer[qIdx+2]];
                            const nQ = [normalDepthBuffer[qIdx], normalDepthBuffer[qIdx+1], normalDepthBuffer[qIdx+2]];
                            const dQ = normalDepthBuffer[qIdx+3];

                            const kWeight = kernel[ky+2] * kernel[kx+2];

                            const distSq = (cVal[0]-cQ[0])**2 + (cVal[1]-cQ[1])**2 + (cVal[2]-cQ[2])**2;
                            const wColor = Math.exp(-distSq / sigmaColor);
                            
                            const dot = nVal[0]*nQ[0] + nVal[1]*nQ[1] + nVal[2]*nQ[2];
                            const wNormal = Math.pow(Math.max(0, dot), 32); 
                            const wDepth = Math.exp(-Math.abs(dVal - dQ) / sigmaDepth);

                            const weight = kWeight * wColor * wNormal * wDepth;

                            sumC[0] += cQ[0] * weight;
                            sumC[1] += cQ[1] * weight;
                            sumC[2] += cQ[2] * weight;
                            sumWeight += weight;
                        }
                    }
                }

                if (sumWeight > 0) {
                    outputBuffer[idx] = sumC[0] / sumWeight;
                    outputBuffer[idx+1] = sumC[1] / sumWeight;
                    outputBuffer[idx+2] = sumC[2] / sumWeight;
                } else {
                    outputBuffer[idx] = cVal[0]; outputBuffer[idx+1] = cVal[1]; outputBuffer[idx+2] = cVal[2];
                }
                outputBuffer[idx+3] = 1.0;
            }
        }
    }

    // Função de entrada do Denoise Progressivo
    function rayStartProgressiveDenoising() {
        const width = rayCanvasEl.width;
        const height = rayCanvasEl.height;
        const size = width * height * 4;
        
        // Aloca buffers temporários se necessário
        if(!rayDenoiseBufferA || rayDenoiseBufferA.length !== size) {
            rayDenoiseBufferA = new Float32Array(size);
            rayDenoiseBufferB = new Float32Array(size);
        }

        // 1. PREPARAÇÃO: Normalize + Demodulation + FIREFLY CLAMPING
        for(let i=0; i<size; i+=4) {
            const count = raySampleCountBuffer[i] || 1;
            let r = rayAccumulationBuffer[i] / count;
            let g = rayAccumulationBuffer[i+1] / count;
            let b = rayAccumulationBuffer[i+2] / count;
            
            // Basic Firefly Clamping (Global Max Brightness Clamp)
            const maxVal = Math.max(r, Math.max(g, b));
            if (maxVal > 20.0) {
                const scale = 20.0 / maxVal;
                r *= scale; g *= scale; b *= scale;
            }

            const albR = rayAlbedoBuffer[i] + 0.001; 
            const albG = rayAlbedoBuffer[i+1] + 0.001;
            const albB = rayAlbedoBuffer[i+2] + 0.001;

            // Divide Cor por Albedo = Apenas Iluminação
            rayDenoiseBufferA[i] = r / albR;
            rayDenoiseBufferA[i+1] = g / albG;
            rayDenoiseBufferA[i+2] = b / albB;
            rayDenoiseBufferA[i+3] = 1.0;
        }

        rayDenoiseIteration = 0;
        document.getElementById('progresso').innerHTML = `Denoising Pass 1/${rayConfig.denoiseSteps}...`;
        requestAnimationFrame(rayProgressiveLoop);
    }

    function rayProgressiveLoop() {
        if (rayDenoiseIteration >= rayConfig.denoiseSteps) {
            // FIM: Modula de volta (Multiplica pela Textura)
            const width = rayCanvasEl.width;
            const height = rayCanvasEl.height;
            const size = width * height * 4;
            const source = (rayDenoiseIteration % 2 === 0) ? rayDenoiseBufferA : rayDenoiseBufferB;
            
            for(let i=0; i<size; i+=4) {
                const albR = rayAlbedoBuffer[i] + 0.001;
                const albG = rayAlbedoBuffer[i+1] + 0.001;
                const albB = rayAlbedoBuffer[i+2] + 0.001;

                source[i] *= albR;
                source[i+1] *= albG;
                source[i+2] *= albB;
            }
            
            rayUpdateCanvas(source, true);
            
            rayIsRendering = false;
            if (rayRenderButton) rayRenderButton.textContent = 'Iniciar Render';
            document.getElementById('progresso').innerHTML = 'Render Finished (Clean Texture)';
            return;
        }

        const width = rayCanvasEl.width;
        const height = rayCanvasEl.height;
        
        // Schedule Adaptativo: 1, 1, 2, 4 (Para remover noise fino primeiro)
        let step = 1;
        if (rayDenoiseIteration > 1) step = 1 << (rayDenoiseIteration - 1);
        
        const source = (rayDenoiseIteration % 2 === 0) ? rayDenoiseBufferA : rayDenoiseBufferB;
        const dest = (rayDenoiseIteration % 2 === 0) ? rayDenoiseBufferB : rayDenoiseBufferA;

        // Roda UMA iteração com Feature Aware
        rayRunDenoisePass(width, height, source, dest, rayNormalDepthBuffer, rayAlbedoBuffer, rayAuxBuffer, step);

        // Visualização Intermediária
        const displayBuffer = new Float32Array(dest);
        for(let i=0; i<displayBuffer.length; i+=4) {
             const albR = rayAlbedoBuffer[i] + 0.001;
             const albG = rayAlbedoBuffer[i+1] + 0.001;
             const albB = rayAlbedoBuffer[i+2] + 0.001;
             displayBuffer[i] *= albR;
             displayBuffer[i+1] *= albG;
             displayBuffer[i+2] *= albB;
        }
        rayUpdateCanvas(displayBuffer, true);

        rayDenoiseIteration++;
        document.getElementById('progresso').innerHTML = `Denoising Pass ${rayDenoiseIteration+1}/${rayConfig.denoiseSteps}...`;
        
        setTimeout(() => requestAnimationFrame(rayProgressiveLoop), 10);
    }


    function rayProcessNextTile(worker) {
        if (rayTileQueue.length > 0) {
            const tile = rayTileQueue.shift();
            rayActiveWorkersCount++;
            tile.sampleIndex = raySamples;
            // Passa o Jitter para o worker
            tile.jitterX = rayJitterX; 
            tile.jitterY = rayJitterY;
            worker.postMessage({ type: 'renderTile', data: tile });
        } else {
            if (rayActiveWorkersCount === 0) rayFinalizePass();
        }
    }

    function rayFinalizePass() {
        raySamples++;
        const progressDiv = document.getElementById('progresso');

        if (raySamples === rayConfig.maxSamples) {
            if (rayConfig.denoise) {
                rayStartProgressiveDenoising();
            } else {
                rayIsRendering = false;
                if (rayRenderButton) rayRenderButton.textContent = 'Iniciar Render';
                if (progressDiv) progressDiv.innerHTML = 'Complete';
            }
            return;
        }

        if (progressDiv) progressDiv.innerHTML = `rendering sample ${raySamples}/${rayConfig.maxSamples}`;

        if (raySamples < rayConfig.maxSamples && rayIsRendering) {
            rayGenerateTileQueue();
            rayWorkers.forEach(w => rayProcessNextTile(w));
        }
    }

    function rayUpdateCanvas(buffer, isAlreadyDivided) {
        const width = rayCanvasEl.width;
        for (let i = 0; i < rayImageData.data.length; i += 4) {
            let r, g, b;
            
            if (isAlreadyDivided) {
                r = buffer[i]; g = buffer[i+1]; b = buffer[i+2];
            } else {
                let count = (raySampleCountBuffer && raySampleCountBuffer[i]) ? raySampleCountBuffer[i] : 1;
                if (count < 1) count = 1;
                
                r = buffer[i] / count;
                g = buffer[i+1] / count;
                b = buffer[i+2] / count;
            }

            const avgColor = [r, g, b];
            const toneMapped = rayToneMapACES(avgColor);
            const gammaCorrected = rayGammaCorrect(toneMapped);
            rayImageData.data[i + 0] = gammaCorrected[0] * 255;
            rayImageData.data[i + 1] = gammaCorrected[1] * 255;
            rayImageData.data[i + 2] = gammaCorrected[2] * 255;
            rayImageData.data[i + 3] = 255;
        }
        rayCtx.putImageData(rayImageData, 0, 0);
    }

    function rayGenerateTileQueue() {
        rayTileQueue = [];
        const width = rayCanvasEl.width;
        const height = rayCanvasEl.height;
        const tilesX = Math.ceil(width / TILE_SIZE);
        const tilesY = Math.ceil(height / TILE_SIZE);
        
        if (raySamples === 0) rayTileConvergence = new Array(tilesX * tilesY).fill(false);

        let tileIndex = 0;
        const tempQueue = [];

        for (let y = 0; y < height; y += TILE_SIZE) {
            for (let x = 0; x < width; x += TILE_SIZE) {
                
                let shouldRender = true;
                if (rayConfig.adaptiveEnabled && raySamples > 5 && rayTileConvergence[tileIndex]) {
                      shouldRender = false;
                } else if (rayConfig.adaptiveEnabled && raySamples > 5) {
                    let totalVariance = 0;
                    let pixelCount = 0;
                    const endY = Math.min(y + TILE_SIZE, height);
                    const endX = Math.min(x + TILE_SIZE, width);
                    
                    const stride = 4; 
                    for (let vy = y; vy < endY; vy+=stride) {
                        for (let vx = x; vx < endX; vx+=stride) {
                            const idx = (vy * width + vx) * 4;
                            const N = raySampleCountBuffer[idx]; 
                            if (N < 4) continue; 

                            const sumR = rayAccumulationBuffer[idx];
                            const sumSqR = raySumSqBuffer[idx]; 
                            const varR = (sumSqR - (sumR * sumR) / N) / (N - 1);
                            totalVariance += varR;
                            pixelCount++;
                        }
                    }
                    const avgVariance = (pixelCount > 0) ? (totalVariance / pixelCount) : 1.0;
                    if (avgVariance < rayConfig.varianceThreshold) {
                        rayTileConvergence[tileIndex] = true;
                        shouldRender = false;
                    }
                }

                if (shouldRender) {
                    tempQueue.push({
                        startX: x, startY: y,
                        tileW: Math.min(TILE_SIZE, width - x),
                        tileH: Math.min(TILE_SIZE, height - y),
                        width: width, height: height,
                        centerX: x + TILE_SIZE/2, centerY: y + TILE_SIZE/2
                    });
                }
                tileIndex++;
            }
        }

        const cx = width / 2; const cy = height / 2;
        tempQueue.sort((a, b) => {
            const da = (a.centerX - cx)**2 + (a.centerY - cy)**2;
            const db = (b.centerX - cx)**2 + (b.centerY - cy)**2;
            return da - db;
        });

        rayTileQueue = tempQueue;
    }

    function rayRenderFrame() {
        if (!rayIsRendering) return;
        
        // GERA JITTER PARA ESTE FRAME
        rayJitterX = Math.random() - 0.5;
        rayJitterY = Math.random() - 0.5;

        if (rayTileQueue.length === 0 && rayActiveWorkersCount === 0) {
            rayGenerateTileQueue();
            if (rayTileQueue.length === 0) {
                rayFinalizePass(); 
            } else {
                rayWorkers.forEach(w => rayProcessNextTile(w));
            }
        }
    }

    function raySetupWorkerListeners() {
        rayWorkers.forEach((worker) => {
            worker.onmessage = (e) => {
                if (e.data.type === 'result') {
                    const { startX, startY, tileW, tileH, tileData } = e.data.data;
                    const width = rayCanvasEl.width;
                    let tileIdx = 0;
                    
                    for (let y = startY; y < startY + tileH; y++) {
                        for (let x = startX; x < startX + tileW; x++) {
                            const bufferIdx = (y * width + x) * 4;
                            const r = tileData[tileIdx++];
                            const g = tileData[tileIdx++];
                            const b = tileData[tileIdx++];
                            const a = tileData[tileIdx++]; 
                            
                            rayAccumulationBuffer[bufferIdx + 0] += r;
                            rayAccumulationBuffer[bufferIdx + 1] += g;
                            rayAccumulationBuffer[bufferIdx + 2] += b;
                            
                            raySampleCountBuffer[bufferIdx + 0] += 1.0;
                            raySampleCountBuffer[bufferIdx + 1] += 1.0; 
                            raySampleCountBuffer[bufferIdx + 2] += 1.0; 
                            raySampleCountBuffer[bufferIdx + 3] += 1.0; 
                            
                            raySumSqBuffer[bufferIdx + 0] += r*r;
                            raySumSqBuffer[bufferIdx + 1] += g*g;
                            raySumSqBuffer[bufferIdx + 2] += b*b;

                            rayNormalDepthBuffer[bufferIdx + 0] = tileData[tileIdx++]; 
                            rayNormalDepthBuffer[bufferIdx + 1] = tileData[tileIdx++]; 
                            rayNormalDepthBuffer[bufferIdx + 2] = tileData[tileIdx++]; 
                            rayNormalDepthBuffer[bufferIdx + 3] = tileData[tileIdx++]; 

                            rayAlbedoBuffer[bufferIdx + 0] = tileData[tileIdx++];
                            rayAlbedoBuffer[bufferIdx + 1] = tileData[tileIdx++];
                            rayAlbedoBuffer[bufferIdx + 2] = tileData[tileIdx++];

                            // CAPTURE NEW FEATURES FOR AUX BUFFER
                            rayAuxBuffer[bufferIdx + 0] = tileData[tileIdx++]; // Roughness
                            rayAuxBuffer[bufferIdx + 1] = tileData[tileIdx++]; // Transmission

                            let count = raySampleCountBuffer[bufferIdx + 0];
                            if (count < 1) count = 1;
                            
                            const avgR = rayAccumulationBuffer[bufferIdx + 0] / count;
                            const avgG = rayAccumulationBuffer[bufferIdx + 1] / count;
                            const avgB = rayAccumulationBuffer[bufferIdx + 2] / count;

                            const tm = rayToneMapACES([avgR, avgG, avgB]);
                            const gc = rayGammaCorrect(tm);
                            
                            const imgIdx = (y * width + x) * 4;
                            rayImageData.data[imgIdx + 0] = gc[0] * 255;
                            rayImageData.data[imgIdx + 1] = gc[1] * 255;
                            rayImageData.data[imgIdx + 2] = gc[2] * 255;
                            rayImageData.data[imgIdx + 3] = 255;
                        }
                    }
                    
                    rayCtx.putImageData(rayImageData, 0, 0, startX, startY, tileW, tileH);
                    
                    rayActiveWorkersCount--;
                    if (rayTileQueue.length > 0) rayProcessNextTile(worker);
                    else if (rayActiveWorkersCount === 0) rayFinalizePass();
                }
            };
        });
    }

    function rayUpdateCamera(threeCamera) {
        rayCamera.position = { x: threeCamera.position.x, y: threeCamera.position.y, z: threeCamera.position.z };
        const direction = new THREE.Vector3();
        threeCamera.getWorldDirection(direction);
        rayCamera.target = {
            x: rayCamera.position.x + direction.x,
            y: rayCamera.position.y + direction.y,
            z: rayCamera.position.z + direction.z
        };
        rayCamera.fov = threeCamera.fov;
        rayCamera.aspect = threeCamera.aspect;
    }

    function rayFreeResources() {
        if (rayWorkers && rayWorkers.length > 0) {
            rayWorkers.forEach(w => w.terminate());
            rayWorkers = [];
        }
        rayTriangleData = null;
        rayNormalData = null;
        rayUVData = null;
    }

    // INICIALIZADOR PRINCIPAL
    function rayStartRendering(selectableObjects, threeCamera) {
        if (rayIsRendering) { rayStopRendering(); return; }
        console.log('=== Ray Tracer: Start (ReSTIR DI + Feature Aware Denoise + Jittered AA) ===');

        rayCanvasEl = document.getElementById('renderCanvas');
        if (!rayCanvasEl) return;
        rayCanvasEl.style.display = 'block';
        rayCanvasEl.width = innerWidth * rayConfig.pixelRatio;
        rayCanvasEl.height = innerHeight * rayConfig.pixelRatio;
        rayCanvasEl.style.width = innerWidth + 'px';
        rayCanvasEl.style.height = innerHeight + 'px';
        rayCtx = rayCanvasEl.getContext('2d', { willReadFrequently: true });

        rayFreeResources();

        rayImageData = rayCtx.createImageData(rayCanvasEl.width, rayCanvasEl.height);
        
        const size = rayCanvasEl.width * rayCanvasEl.height * 4;
        if (!rayAccumulationBuffer || rayAccumulationBuffer.length !== size) {
            rayAccumulationBuffer = new Float32Array(size);
            raySumSqBuffer = new Float32Array(size);
            raySampleCountBuffer = new Float32Array(size); 
            rayNormalDepthBuffer = new Float32Array(size);
            rayAlbedoBuffer = new Float32Array(size); 
            rayAuxBuffer = new Float32Array(size); // ALLOCATE AUX BUFFER
        } else {
            rayAccumulationBuffer.fill(0);
            raySumSqBuffer.fill(0);
            raySampleCountBuffer.fill(0);
            rayNormalDepthBuffer.fill(0);
            rayAlbedoBuffer.fill(0);
            rayAuxBuffer.fill(0);
        }
        
        // Reset Denoise Buffers
        rayDenoiseBufferA = null;
        rayDenoiseBufferB = null;

        raySamples = 0;
        rayActiveWorkersCount = 0;
        rayTileQueue = [];
        rayTileConvergence = [];

        let rawScene;
        try {
            rawScene = rayConvertThreeObjects(selectableObjects);
            if (!rawScene) { rayStopRendering(); return; }
            rayUpdateCamera(threeCamera);
        } catch (error) {
            console.error('Conversion Error:', error);
            rayStopRendering();
            return;
        }

        rayRunBVHWorker(rawScene, () => {
            rayCreateWorkers();
            raySetupWorkerListeners();

            let readyWorkers = 0;
            const workersToUse = Math.min(rayNumWorkers, rayWorkers.length);
            for (let i = 0; i < workersToUse; i++) {
                const worker = rayWorkers[i];
                const readyHandler = (e) => {
                    if (e.data.type === 'ready') {
                        readyWorkers++;
                        if (readyWorkers === workersToUse) {
                            worker.removeEventListener('message', readyHandler);
                            rayIsRendering = true;
                            rayRenderFrame();
                        }
                    }
                };
                worker.addEventListener('message', readyHandler);

                const initData = {
                    type: 'init',
                    data: {
                        bvhBounds: rayBVHBounds,
                        bvhContents: rayBVHContents,
                        bvhIndices: rayBVHIndices,
                        lights: rawScene.lights,
                        triangleData: rayTriangleData, 
                        normalData: rayNormalData, 
                        uvData: rayUVData,
                        materialData: rayMaterialData,
                        textureList: rayTextureList,
                        emissiveTrianglesData: rayEmissiveTrianglesData, 
                        camera: rayCamera,
                        config: rayConfig
                    }
                };
                if (raySkyboxData && rayConfig.useSkybox) {
                    initData.data.skyboxData = raySkyboxData;
                    initData.data.skyboxWidth = raySkyboxWidth;
                    initData.data.skyboxHeight = raySkyboxHeight;
                    initData.data.useSkybox = true;
                }
                
                worker.postMessage(initData);
            }
        });
    }

    function rayStopRendering() {
        if (!rayIsRendering) return;
        rayIsRendering = false;
        rayFreeResources(); 
        if (rayCanvasEl) rayCanvasEl.style.display = 'none';
        const progressDiv = document.getElementById('progresso');
        if (progressDiv) progressDiv.innerHTML = 'stopped';
        rayTileQueue = [];
    }

    function raySetupRenderButton() {
        rayRenderButton = document.getElementById('render');
        if (!rayRenderButton) return;
        rayRenderButton.addEventListener('click', () => {
            if (typeof selectableObjects === 'undefined' || typeof camera === 'undefined') return;
            if (rayIsRendering) {
                rayStopRendering();
                rayRenderButton.textContent = 'Iniciar Render';
            } else {
                rayStartRendering(selectableObjects, camera);
                rayRenderButton.textContent = 'Parar Render';
            }
        });
    }

    function raySetPixelRatio(ratio) { rayConfig.pixelRatio = Math.max(0.1, Math.min(1.0, ratio)); }
    function raySetMaxSamples(samples) { rayConfig.maxSamples = Math.max(1, samples); }
    function raySetMaxBounces(bounces) { rayConfig.maxBounces = Math.max(1, Math.min(16, bounces)); }
    function raySetDenoise(enabled) { rayConfig.denoise = enabled; }
    function raySetReSTIR(enabled) { rayConfig.useReSTIR = enabled; console.log("ReSTIR:", enabled ? "ON" : "OFF"); }
    function raySetAO(enabled, intensity=1.0, radius=1.5, samples=8) {
        rayConfig.aoEnabled = enabled;
        rayConfig.aoIntensity = intensity;
        rayConfig.aoRadius = radius;
        rayConfig.aoSamples = samples;
        console.log(`AO Configured: ${enabled ? 'ON' : 'OFF'}`);
    }

    window.addEventListener('beforeunload', () => { rayFreeResources(); });
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', raySetupRenderButton); } else { raySetupRenderButton(); }

    window.rayLoadSkybox = rayLoadSkybox;
    window.raySetPixelRatio = raySetPixelRatio;
    window.raySetMaxSamples = raySetMaxSamples;
    window.raySetMaxBounces = raySetMaxBounces;
    window.raySetDenoise = raySetDenoise;
    window.raySetReSTIR = raySetReSTIR;
    window.raySetAO = raySetAO;
    window.rayStartRendering = rayStartRendering; 
    window.rayStopRendering = rayStopRendering;    
    window.rayConfig = rayConfig;

})();