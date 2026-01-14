// ray.js - Path Tracer ULTIMATE (Tile + AO + Joint Bilateral Denoise)

// --- VARIÁVEIS GLOBAIS ---
let rayCanvas = null;
let rayCtx = null;
let rayIsRendering = false;
let raySamples = 0;
let rayImageData = null;

// BUFFERS PRINCIPAIS
let rayAccumulationBuffer = null; // Armazena RGB (Color)
let rayNormalDepthBuffer = null;  // NOVO: Armazena Normals (xyz) e Depth (w)

let rayWorkers = [];
let rayNumWorkers = navigator.hardwareConcurrency || 4;
let rayRenderButton = null;

// TILE RENDERING VARIABLES
const TILE_SIZE = 70; 
let rayTileQueue = [];
let rayActiveWorkersCount = 0;

// ARRAYS DE DADOS GEOMÉTRICOS
let rayTriangleData = null;
let rayUVData = null; 
let rayMaterialData = null;
let rayTextureList = []; 
let rayTotalTriangles = 0;

// SKYBOX
let raySkyboxImage = null;
let raySkyboxData = null;
let raySkyboxWidth = 0;
let raySkyboxHeight = 0;

// BVH STRUCTURES
let rayBVHBounds = null;
let rayBVHContents = null;
let rayBVHIndices = null;

// CONFIGURAÇÕES
const rayConfig = {
    maxSamples: 10,      // Aumentado sugerido para ver o denoise final agir bem
    samplesPerFrame: 1,
    maxBounces: 5,       
    pixelRatio: 1.5,      
    backgroundColor: [40/255, 40/255, 40/255, 1],
    denoise: false,       
    useSkybox: true,
    
    // AO SETTINGS
    aoEnabled: true,
    aoSamples: 4,
    aoRadius: 1.0,
    aoIntensity: 0.5
};

// Estruturas de cena
let raySceneData = null;
let rayCamera = {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    fov: 60,
    aspect: 1
};

// --- CONSTANTES BVH ---
const BVH_NODE_SIZE = 6;
const BVH_CONTENT_SIZE = 4;

// --- FUNÇÕES AUXILIARES (Skybox, Texture, Geometry) ---
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
            raySkyboxData = new Float32Array(img.width * img.height * 4);
            for (let i = 0; i < imageData.data.length; i++) {
                raySkyboxData[i] = imageData.data[i] / 255.0;
            }
            rayConfig.useSkybox = true;
            console.log(`Skybox loaded: ${img.width}x${img.height}`);
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
    const floatData = new Float32Array(imgData.data.length);
    for(let i=0; i<imgData.data.length; i++) {
        floatData[i] = imgData.data[i] / 255.0;
    }
    return {
        width: img.width,
        height: img.height,
        data: floatData
    };
}

function rayCountTrianglesRecursive(objects) {
    let count = 0;
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        const isLight = obj.children && obj.children.some(child => 
            child.type === 'Mesh' && child.geometry && child.geometry.type === 'SphereGeometry'
        );
        if (isLight) continue;
        if (obj.isMesh && obj.visible !== false && obj.geometry) {
            const geo = obj.geometry;
            if (geo.index) count += geo.index.count / 3;
            else if (geo.attributes.position) count += geo.attributes.position.count / 3;
        }
        if (obj.children && obj.children.length > 0) count += rayCountTrianglesRecursive(obj.children);
    }
    return count;
}

function rayFillBuffersRecursive(objects, lights, cursor) {
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        const isLight = obj.children && obj.children.some(child => 
            child.type === 'Mesh' && child.geometry && child.geometry.type === 'SphereGeometry'
        );
        if (isLight) {
            lights.push({
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                color: [1, 1, 1],
                intensity: 15.0
            });
            continue;
        }

        if (obj.isMesh && obj.geometry && obj.visible !== false) {
            const geo = obj.geometry;
            const positions = geo.attributes.position.array;
            const indices = geo.index ? geo.index.array : null;
            const uvs = geo.attributes.uv ? geo.attributes.uv.array : null;
            
            obj.updateMatrixWorld(true);
            const mw = obj.matrixWorld.elements;
            let r=0.7, g=0.7, b=0.7;
            let roughness = 0.5;
            let matType = 0; 
            let emR=0, emG=0, emB=0;
            let metalnessValue = 0.0;
            let reflectionValue = 0.0;
            let textureId = -1.0;
            
            if (obj.material) {
                const m = obj.material;
                if(m.color) { r=m.color.r; g=m.color.g; b=m.color.b; }
                if (m.map && m.map.image) {
                    const texData = rayExtractTexture(m.map.image);
                    textureId = rayTextureList.length;
                    rayTextureList.push(texData);
                }
                if (m.rayemission !== undefined && m.rayemission > 0) {
                    const intensity = m.rayemission * 10.0;
                    emR = r * intensity; emG = g * intensity; emB = b * intensity;
                } else if(m.emissive) { 
                    emR=m.emissive.r; emG=m.emissive.g; emB=m.emissive.b; 
                }
                if (m.rayroughness !== undefined) roughness = m.rayroughness;
                else if(m.roughness !== undefined) roughness = m.roughness;

                if (m.raymetalness !== undefined) metalnessValue = m.raymetalness;
                else if (m.metalness !== undefined) metalnessValue = m.metalness;

                if (m.rayreflection !== undefined) reflectionValue = m.rayreflection;

                if (reflectionValue > 0.01) matType = 2; 
                else if (metalnessValue > 0.01) matType = 1; 
                else matType = 0; 
            }

            const transformAndStore = (x, y, z, offset) => {
                const tx = x * mw[0] + y * mw[4] + z * mw[8] + mw[12];
                const ty = x * mw[1] + y * mw[5] + z * mw[9] + mw[13];
                const tz = x * mw[2] + y * mw[6] + z * mw[10] + mw[14];
                rayTriangleData[offset] = tx;
                rayTriangleData[offset+1] = ty; rayTriangleData[offset+2] = tz;
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
                transformAndStore(v0x, v0y, v0z, baseIdx);
                transformAndStore(v1x, v1y, v1z, baseIdx+3);
                transformAndStore(v2x, v2y, v2z, baseIdx+6);

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
                rayMaterialData[matIdx+3] = roughness; rayMaterialData[matIdx+4] = matType;
                rayMaterialData[matIdx+5] = emR; rayMaterialData[matIdx+6] = emG; rayMaterialData[matIdx+7] = emB;
                rayMaterialData[matIdx+8] = metalnessValue; rayMaterialData[matIdx+9] = reflectionValue;
                rayMaterialData[matIdx+10] = textureId;
                cursor.index++;
            }
        }
        if (obj.children && obj.children.length > 0) rayFillBuffersRecursive(obj.children, lights, cursor);
    }
}

function rayBuildFlatBVH(triangleIndices) {
    const nodes = [];
    function build(indices) {
        const nodeIndex = nodes.length;
        nodes.push({ min: null, max: null, left: -1, right: -1, offset: -1, count: 0 });
        const count = indices.length;
        let minX=Infinity, minY=Infinity, minZ=Infinity;
        let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
        for(let i=0; i<count; i++) {
            const base = indices[i] * 9;
            for(let k=0; k<9; k+=3) {
                const x = rayTriangleData[base+k];
                const y = rayTriangleData[base+k+1];
                const z = rayTriangleData[base+k+2];
                if(x < minX) minX = x; if(x > maxX) maxX = x;
                if(y < minY) minY = y; if(y > maxY) maxY = y;
                if(z < minZ) minZ = z; if(z > maxZ) maxZ = z;
            }
        }
        nodes[nodeIndex].min = {x: minX, y: minY, z: minZ};
        nodes[nodeIndex].max = {x: maxX, y: maxY, z: maxZ};
        if (count <= 4) {
            nodes[nodeIndex].offset = rayBVHIndices.length;
            nodes[nodeIndex].count = count;
            for(let i=0; i<count; i++) rayBVHIndices.push(indices[i]);
            return nodeIndex;
        }
        const extentX = maxX - minX; const extentY = maxY - minY; const extentZ = maxZ - minZ;
        let axis = 0;
        if (extentY > extentX && extentY > extentZ) axis = 1;
        else if (extentZ > extentX && extentZ > extentY) axis = 2;
        indices.sort((a, b) => {
            const baseA = a * 9;
            const cA = (rayTriangleData[baseA+axis] + rayTriangleData[baseA+3+axis] + rayTriangleData[baseA+6+axis]) / 3;
            const baseB = b * 9;
            const cB = (rayTriangleData[baseB+axis] + rayTriangleData[baseB+3+axis] + rayTriangleData[baseB+6+axis]) / 3;
            return cA - cB;
        });
        const mid = Math.floor(count / 2);
        const leftIdx = build(indices.slice(0, mid));
        const rightIdx = build(indices.slice(mid));
        nodes[nodeIndex].left = leftIdx; nodes[nodeIndex].right = rightIdx;
        return nodeIndex;
    }
    rayBVHIndices = []; 
    build(triangleIndices);
    const nodeCount = nodes.length;
    rayBVHBounds = new Float32Array(nodeCount * BVH_NODE_SIZE);
    rayBVHContents = new Uint32Array(nodeCount * BVH_CONTENT_SIZE);
    for(let i=0; i<nodeCount; i++) {
        const n = nodes[i];
        rayBVHBounds[i*6+0] = n.min.x; rayBVHBounds[i*6+1] = n.min.y; rayBVHBounds[i*6+2] = n.min.z;
        rayBVHBounds[i*6+3] = n.max.x; rayBVHBounds[i*6+4] = n.max.y; rayBVHBounds[i*6+5] = n.max.z;
        if (n.count > 0) {
            rayBVHContents[i*2+0] = n.offset; rayBVHContents[i*2+1] = n.count | 0x80000000;
        } else {
            rayBVHContents[i*2+0] = n.left; rayBVHContents[i*2+1] = n.right;
        }
    }
    return { bounds: rayBVHBounds, contents: rayBVHContents, indices: new Uint32Array(rayBVHIndices) };
}

function rayConvertThreeObjects(selectableObjects) {
    const lights = [];
    const progressDiv = document.getElementById('progresso');
    rayTextureList = [];
    if (progressDiv) progressDiv.innerHTML = 'counting triangles...';
    rayTotalTriangles = rayCountTrianglesRecursive(selectableObjects);
    if (rayTotalTriangles === 0) { console.error("Nenhum triângulo encontrado!"); return null; }

    rayTriangleData = new Float32Array(rayTotalTriangles * 9); 
    rayUVData = new Float32Array(rayTotalTriangles * 6);
    rayMaterialData = new Float32Array(rayTotalTriangles * 11);
    
    if (progressDiv) progressDiv.innerHTML = 'extracting data...';
    const cursor = { index: 0 };
    rayFillBuffersRecursive(selectableObjects, lights, cursor);
    if (progressDiv) progressDiv.innerHTML = 'building optimized BVH...';
    const allIndices = new Array(cursor.index);
    for(let i=0; i<cursor.index; i++) allIndices[i] = i;
    const bvhData = rayBuildFlatBVH(allIndices);
    return {
        bvhBounds: bvhData.bounds, bvhContents: bvhData.contents, bvhIndices: bvhData.indices,
        lights: lights, triangleData: rayTriangleData, uvData: rayUVData,
        materialData: rayMaterialData, textureList: rayTextureList
    };
}

// --- WORKER CREATION (RETORNA GEOMETRY BUFFERS PARA DENOISING) ---
function rayCreateWorkers() {
    const workerCode = `
// WORKER - G-BUFFER SUPPORT (Normal + Depth)

let bvhBounds = null; let bvhContents = null; let bvhIndices = null;
let triangleData = null; let uvData = null; let materialData = null;
let textureList = null; let sceneLights = null; let camera = null; let config = null;
let skyboxData = null; let skyboxWidth = 0; let skyboxHeight = 0; let useSkybox = false;
const stack = new Uint32Array(64);

function vec3_dot(ax, ay, az, bx, by, bz) { return ax*bx + ay*by + az*bz; }
function random_in_unit_sphere() {
    let x, y, z; do { x = Math.random()*2-1; y = Math.random()*2-1; z = Math.random()*2-1; } while (x*x+y*y+z*z>=1); return {x,y,z};
}
function random_unit_vector() {
    const v = random_in_unit_sphere(); const len = Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z); return {x:v.x/len, y:v.y/len, z:v.z/len};
}
function reflect(vx, vy, vz, nx, ny, nz) {
    const dt = vx*nx + vy*ny + vz*nz; return { x: vx - 2*dt*nx, y: vy - 2*dt*ny, z: vz - 2*dt*nz };
}
function refract(uvx, uvy, uvz, nx, ny, nz, etai_over_etat) {
    const cos_theta = Math.min(vec3_dot(-uvx, -uvy, -uvz, nx, ny, nz), 1.0);
    const r_out_perp_x = etai_over_etat * (uvx + cos_theta * nx);
    const r_out_perp_y = etai_over_etat * (uvy + cos_theta * ny);
    const r_out_perp_z = etai_over_etat * (uvz + cos_theta * nz);
    const r_out_parallel_abs = Math.sqrt(Math.abs(1.0 - (r_out_perp_x*r_out_perp_x + r_out_perp_y*r_out_perp_y + r_out_perp_z*r_out_perp_z)));
    return { x: r_out_perp_x - r_out_parallel_abs * nx, y: r_out_perp_y - r_out_parallel_abs * ny, z: r_out_perp_z - r_out_parallel_abs * nz };
}
function schlick(cosine, ref_idx) {
    let r0 = (1 - ref_idx) / (1 + ref_idx); r0 = r0 * r0; return r0 + (1 - r0) * Math.pow((1 - cosine), 5);
}
function sampleTexture(texId, u, v) {
    const tex = textureList[texId]; if(!tex) return [1,0,1]; 
    let tx = u - Math.floor(u); let ty = v - Math.floor(v); ty = 1.0 - ty; 
    const w = tex.width; const h = tex.height;
    const x = tx*(w-1); const y = ty*(h-1);
    const x0 = Math.floor(x); const y0 = Math.floor(y); const x1 = Math.min(x0+1, w-1); const y1 = Math.min(y0+1, h-1);
    const fx = x-x0; const fy = y-y0;
    const idx00=(y0*w+x0)*4; const idx10=(y0*w+x1)*4; const idx01=(y1*w+x0)*4; const idx11=(y1*w+x1)*4;
    const r = (1-fx)*(1-fy)*tex.data[idx00] + fx*(1-fy)*tex.data[idx10] + (1-fx)*fy*tex.data[idx01] + fx*fy*tex.data[idx11];
    const g = (1-fx)*(1-fy)*tex.data[idx00+1] + fx*(1-fy)*tex.data[idx10+1] + (1-fx)*fy*tex.data[idx01+1] + fx*fy*tex.data[idx11+1];
    const b = (1-fx)*(1-fy)*tex.data[idx00+2] + fx*(1-fy)*tex.data[idx10+2] + (1-fx)*fy*tex.data[idx01+2] + fx*fy*tex.data[idx11+2];
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
    const r = (1-fx)*(1-fy)*skyboxData[idx00] + fx*(1-fy)*skyboxData[idx10] + (1-fx)*fy*skyboxData[idx01] + fx*fy*skyboxData[idx11];
    const g = (1-fx)*(1-fy)*skyboxData[idx00+1] + fx*(1-fy)*skyboxData[idx10+1] + (1-fx)*fy*skyboxData[idx01+1] + fx*fy*skyboxData[idx11+1];
    const b = (1-fx)*(1-fy)*skyboxData[idx00+2] + fx*(1-fy)*skyboxData[idx10+2] + (1-fx)*fy*skyboxData[idx01+2] + fx*fy*skyboxData[idx11+2];
    return [r, g, b];
}
function intersectTriangle(rox, roy, roz, rdx, rdy, rdz, triIndex, tMax) {
    const base = triIndex * 9;
    const v0x = triangleData[base]; const v0y = triangleData[base+1]; const v0z = triangleData[base+2];
    const v1x = triangleData[base+3]; const v1y = triangleData[base+4]; const v1z = triangleData[base+5];
    const v2x = triangleData[base+6]; const v2y = triangleData[base+7]; const v2z = triangleData[base+8];
    const e1x = v1x - v0x; const e1y = v1y - v0y; const e1z = v1z - v0z;
    const e2x = v2x - v0x; const e2y = v2y - v0y; const e2z = v2z - v0z;
    const hx = rdy * e2z - rdz * e2y; const hy = rdz * e2x - rdx * e2z; const hz = rdx * e2y - rdy * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (a > -0.0000001 && a < 0.0000001) return null;
    const f = 1.0 / a;
    const sx = rox - v0x; const sy = roy - v0y; const sz = roz - v0z;
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0.0 || u > 1.0) return null;
    const qx = sy * e1z - sz * e1y; const qy = sz * e1x - sx * e1z; const qz = sx * e1y - sy * e1x;
    const v = f * (rdx * qx + rdy * qy + rdz * qz);
    if (v < 0.0 || u + v > 1.0) return null;
    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t > 0.0000001 && t < tMax) return { t: t, u: u, v: v };
    return null;
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
function intersectScene(rox, roy, roz, rdx, rdy, rdz, tMax) {
    const rinvDx = 1.0 / rdx; const rinvDy = 1.0 / rdy; const rinvDz = 1.0 / rdz;
    let closestHit = { hit: false, distance: tMax, index: -1, u: 0, v: 0 };
    let stackPtr = 0; stack[stackPtr++] = 0;
    while (stackPtr > 0) {
        const nodeIdx = stack[--stackPtr];
        if (!intersectAABB(rox, roy, roz, rinvDx, rinvDy, rinvDz, nodeIdx, closestHit.distance)) continue;
        const contentData1 = bvhContents[nodeIdx * 2]; const contentData2 = bvhContents[nodeIdx * 2 + 1];
        const isLeaf = (contentData2 & 0x80000000) !== 0;
        if (isLeaf) {
            const count = contentData2 & 0x7FFFFFFF; const offset = contentData1;
            for(let i = 0; i < count; i++) {
                const triIdx = bvhIndices[offset + i];
                const hitResult = intersectTriangle(rox, roy, roz, rdx, rdy, rdz, triIdx, closestHit.distance);
                if (hitResult !== null) {
                    closestHit.distance = hitResult.t; closestHit.u = hitResult.u; closestHit.v = hitResult.v;
                    closestHit.hit = true; closestHit.index = triIdx;
                }
            }
        } else { stack[stackPtr++] = contentData2; stack[stackPtr++] = contentData1; }
    }
    if (closestHit.hit) {
         const idx = closestHit.index; const base = idx * 9;
         const v0x = triangleData[base]; const v0y = triangleData[base+1]; const v0z = triangleData[base+2];
         const v1x = triangleData[base+3]; const v1y = triangleData[base+4]; const v1z = triangleData[base+5];
         const v2x = triangleData[base+6]; const v2y = triangleData[base+7]; const v2z = triangleData[base+8];
         let nx = (v1y - v0y) * (v2z - v0z) - (v1z - v0z) * (v2y - v0y);
         let ny = (v1z - v0z) * (v2x - v0x) - (v1x - v0x) * (v2z - v0z);
         let nz = (v1x - v0x) * (v2y - v0y) - (v1y - v0y) * (v2x - v0x);
         const len =Math.sqrt(nx*nx + ny*ny + nz*nz);
         const uvBase = idx * 6;
         const u0 = uvData[uvBase], v0 = uvData[uvBase+1];
         const u1 = uvData[uvBase+2], v1 = uvData[uvBase+3];
         const u2 = uvData[uvBase+4], v2 = uvData[uvBase+5];
         const w = 1.0 - closestHit.u - closestHit.v;
         const finalU = w * u0 + closestHit.u * u1 + closestHit.v * u2;
         const finalV = w * v0 + closestHit.u * v1 + closestHit.v * v2;
         const mBase = idx * 11;
         closestHit.point = { x: rox + rdx * closestHit.distance, y: roy + rdy * closestHit.distance, z: roz + rdz * closestHit.distance };
         closestHit.normal = { x: nx/len, y: ny/len, z: nz/len };
         closestHit.uv = { u: finalU, v: finalV };
         closestHit.material = {
             color: [materialData[mBase], materialData[mBase+1], materialData[mBase+2]],
             roughness: materialData[mBase+3], type: materialData[mBase+4], 
             emissive: [materialData[mBase+5], materialData[mBase+6], materialData[mBase+7]],
             metalness: materialData[mBase+8], reflection: materialData[mBase+9], textureId: materialData[mBase+10]
         };
    }
    return closestHit;
}
function computeAO(px, py, pz, nx, ny, nz) {
    if (!config.aoEnabled) return 1.0;
    let occlusion = 0.0; const samples = config.aoSamples; const radius = config.aoRadius; const intensity = config.aoIntensity;
    for(let i=0; i<samples; i++) {
        const r = random_unit_vector(); let dx = r.x, dy = r.y, dz = r.z;
        if (vec3_dot(dx, dy, dz, nx, ny, nz) < 0) { dx = -dx; dy = -dy; dz = -dz; }
        const hit = intersectScene(px + nx * 0.001, py + ny * 0.001, pz + nz * 0.001, dx, dy, dz, radius);
        if (hit.hit) occlusion += 1.0;
    }
    return 1.0 - ((occlusion / samples) * intensity);
}
function pathTraceIterative(camX, camY, camZ, rdx, rdy, rdz) {
    let throughput = [1, 1, 1]; let accumulatedLight = [0, 0, 0];
    let curX = camX, curY = camY, curZ = camZ; let curDx = rdx, curDy = rdy, curDz = rdz;
    
    // G-BUFFER DATA (From First Hit)
    let firstHitNormal = {x:0, y:0, z:0};
    let firstHitDepth = -1.0;

    for (let depth = 0; depth < config.maxBounces; depth++) {
        const hit = intersectScene(curX, curY, curZ, curDx, curDy, curDz, Infinity);
        
        // CAPTURE FIRST HIT DATA FOR DENOISER
        if (depth === 0) {
            if (hit.hit) {
                firstHitNormal = hit.normal;
                firstHitDepth = hit.distance;
            } else {
                firstHitDepth = 10000.0; // Sky depth
            }
        }

        if (!hit.hit) {
            const skyColor = sampleSkybox(curDx, curDy, curDz);
            accumulatedLight[0] += throughput[0] * skyColor[0];
            accumulatedLight[1] += throughput[1] * skyColor[1];
            accumulatedLight[2] += throughput[2] * skyColor[2];
            break;
        }

        if (hit.material.textureId >= 0) {
             const texColor = sampleTexture(hit.material.textureId, hit.uv.u, hit.uv.v);
             hit.material.color[0] *= texColor[0]; hit.material.color[1] *= texColor[1]; hit.material.color[2] *= texColor[2];
        }
        
        if (depth === 0 && config.aoEnabled) {
            const aoFactor = computeAO(hit.point.x, hit.point.y, hit.point.z, hit.normal.x, hit.normal.y, hit.normal.z);
            throughput[0] *= aoFactor; throughput[1] *= aoFactor; throughput[2] *= aoFactor;
        }

        let emR = throughput[0] * hit.material.emissive[0];
        let emG = throughput[1] * hit.material.emissive[1];
        let emB = throughput[2] * hit.material.emissive[2];
        emR = emR > 10.0 ? 10.0 : emR; emG = emG > 10.0 ? 10.0 : emG; emB = emB > 10.0 ? 10.0 : emB;
        accumulatedLight[0] += emR; accumulatedLight[1] += emG; accumulatedLight[2] += emB;

        const matType = hit.material.type;
        const reflectionStrength = hit.material.reflection;
        const metalnessStrength = hit.material.metalness;
        let scatterDir = {x:0, y:0, z:0}; let attenuation = hit.material.color;
        
        if (matType === 2) { 
            attenuation = hit.material.color;
            const refraction_ratio = 1.5; let etai_over_etat = 1.0 / refraction_ratio;
            let normal = hit.normal;
            const dot = vec3_dot(curDx, curDy, curDz, normal.x, normal.y, normal.z);
            let cos_theta = Math.min(-dot, 1.0);
            if (dot > 0) { normal = {x: -normal.x, y: -normal.y, z: -normal.z}; etai_over_etat = refraction_ratio; cos_theta = Math.min(vec3_dot(curDx, curDy, curDz, normal.x, normal.y, normal.z), 1.0); }
            const sin_theta = Math.sqrt(1.0 - cos_theta*cos_theta);
            const cannot_refract = etai_over_etat * sin_theta > 1.0;
            const reflectProb = schlick(cos_theta, 1.0/refraction_ratio) * reflectionStrength;
            if (cannot_refract || reflectProb > Math.random()) { scatterDir = reflect(curDx, curDy, curDz, normal.x, normal.y, normal.z); } 
            else { scatterDir = refract(curDx, curDy, curDz, normal.x, normal.y, normal.z, etai_over_etat); }
            if (hit.material.roughness > 0) {
                const fuzz = random_in_unit_sphere();
                scatterDir.x += fuzz.x * hit.material.roughness; scatterDir.y += fuzz.y * hit.material.roughness; scatterDir.z += fuzz.z * hit.material.roughness;
            }
        } else if (matType === 1) { 
            const reflected = reflect(curDx, curDy, curDz, hit.normal.x, hit.normal.y, hit.normal.z);
            const fuzz = hit.material.roughness; const rand = random_in_unit_sphere();
            const metalScatterX = reflected.x + fuzz * rand.x; const metalScatterY = reflected.y + fuzz * rand.y; const metalScatterZ = reflected.z + fuzz * rand.z;
            if (metalnessStrength < 1.0) {
                const diffuseRand = random_unit_vector();
                const diffuseScatterX = hit.normal.x + diffuseRand.x; const diffuseScatterY = hit.normal.y + diffuseRand.y; const diffuseScatterZ = hit.normal.z + diffuseRand.z;
                scatterDir = { x: diffuseScatterX * (1.0 - metalnessStrength) + metalScatterX * metalnessStrength, y: diffuseScatterY * (1.0 - metalnessStrength) + metalScatterY * metalnessStrength, z: diffuseScatterZ * (1.0 - metalnessStrength) + metalScatterZ * metalnessStrength };
            } else { scatterDir = { x: metalScatterX, y: metalScatterY, z: metalScatterZ }; }
            if (vec3_dot(scatterDir.x, scatterDir.y, scatterDir.z, hit.normal.x, hit.normal.y, hit.normal.z) <= 0) break;
        } else { 
            const rand = random_unit_vector();
            scatterDir = { x: hit.normal.x + rand.x, y: hit.normal.y + rand.y, z: hit.normal.z + rand.z };
            if (Math.abs(scatterDir.x) < 1e-8 && Math.abs(scatterDir.y) < 1e-8 && Math.abs(scatterDir.z) < 1e-8) scatterDir = hit.normal;
            for(let i=0; i<sceneLights.length; i++) {
                const light = sceneLights[i];
                let ldx = light.position.x - hit.point.x; let ldy = light.position.y - hit.point.y; let ldz = light.position.z - hit.point.z;
                const distSq = ldx*ldx + ldy*ldy + ldz*ldz; const dist = Math.sqrt(distSq); ldx /= dist; ldy /= dist; ldz /= dist;
                const cosTheta = hit.normal.x * ldx + hit.normal.y * ldy + hit.normal.z * ldz;
                if (cosTheta > 0) {
                    const shadowHitResult = intersectScene(hit.point.x + hit.normal.x * 0.001, hit.point.y + hit.normal.y * 0.001, hit.point.z + hit.normal.z * 0.001, ldx, ldy, ldz, dist - 0.01);
                    if (!shadowHitResult.hit) {
                         const att = light.intensity / distSq; const pdf = 1 / Math.PI; 
                         let directR = throughput[0] * hit.material.color[0] * pdf * light.color[0] * cosTheta * att;
                         let directG = throughput[1] * hit.material.color[1] * pdf * light.color[1] * cosTheta * att;
                         let directB = throughput[2] * hit.material.color[2] * pdf * light.color[2] * cosTheta * att;
                         directR = directR > 5.0 ? 5.0 : directR; directG = directG > 5.0 ? 5.0 : directG; directB = directB > 5.0 ? 5.0 : directB;
                         accumulatedLight[0] += directR; accumulatedLight[1] += directG; accumulatedLight[2] += directB;
                    }
                }
            }
        }
        throughput[0] *= attenuation[0]; throughput[1] *= attenuation[1]; throughput[2] *= attenuation[2];
        if (depth > 3) {
            const p = Math.max(throughput[0], Math.max(throughput[1], throughput[2]));
            if (Math.random() > p) break; throughput[0] /= p; throughput[1] /= p; throughput[2] /= p;
        }
        const len = Math.sqrt(scatterDir.x*scatterDir.x + scatterDir.y*scatterDir.y + scatterDir.z*scatterDir.z);
        curDx = scatterDir.x / len; curDy = scatterDir.y / len; curDz = scatterDir.z / len;
        curX = hit.point.x + curDx * 0.001; curY = hit.point.y + curDy * 0.001; curZ = hit.point.z + curDz * 0.001;
    }
    
    // RETORNAR COR + DADOS GEOMÉTRICOS (NORMAL + DEPTH)
    return {
        r: accumulatedLight[0], g: accumulatedLight[1], b: accumulatedLight[2],
        nx: firstHitNormal.x, ny: firstHitNormal.y, nz: firstHitNormal.z,
        depth: firstHitDepth
    };
}
self.onmessage = function(e) {
    const { type, data } = e.data;
    if (type === 'init') {
        bvhBounds = data.bvhBounds; bvhContents = data.bvhContents; bvhIndices = data.bvhIndices;
        sceneLights = data.lights; triangleData = data.triangleData; uvData = data.uvData;
        materialData = data.materialData; textureList = data.textureList; camera = data.camera; config = data.config;
        if (data.skyboxData) { skyboxData = data.skyboxData; skyboxWidth = data.skyboxWidth; skyboxHeight = data.skyboxHeight; useSkybox = data.useSkybox; }
        self.postMessage({ type: 'ready' });
    } else if (type === 'renderTile') {
        const { startX, startY, tileW, tileH, width, height } = data;
        // 8 FLOATS PER PIXEL: R, G, B, A, Nx, Ny, Nz, Depth
        const tileData = new Float32Array(tileW * tileH * 8); 
        
        const camX = camera.position.x; const camY = camera.position.y; const camZ = camera.position.z;
        const aspect = camera.aspect; const fovScale = Math.tan(camera.fov * Math.PI / 180 / 2);
        let fx = camera.target.x - camX; let fy = camera.target.y - camY; let fz = camera.target.z - camZ;
        let len = Math.sqrt(fx*fx + fy*fy + fz*fz); fx/=len; fy/=len; fz/=len;
        let rx = -fz; let ry = 0; let rz = fx; 
        len = Math.sqrt(rx*rx + ry*ry + rz*rz); rx/=len; ry/=len; rz/=len;
        let ux = ry * fz - rz * fy; let uy = rz * fx - rx * fz; let uz = rx * fy - ry * fx;
        len = Math.sqrt(ux*ux + uy*uy + uz*uz); ux/=len; uy/=len; uz/=len;
        
        let idx = 0;
        for (let y = startY; y < startY + tileH; y++) {
            for (let x = startX; x < startX + tileW; x++) {
                const r1 = Math.random() - 0.5; const r2 = Math.random() - 0.5;
                const u = (2 * (x + r1) / width - 1) * aspect * fovScale;
                const v = (1 - 2 * (y + r2) / height) * fovScale;
                let rdx = fx + rx * u + ux * v; let rdy = fy + ry * u + uy * v; let rdz = fz + rz * u + uz * v;
                const rlen = Math.sqrt(rdx*rdx + rdy*rdy + rdz*rdz);
                
                // RECEBER ESTRUTURA COMPLETA
                const result = pathTraceIterative(camX, camY, camZ, rdx/rlen, rdy/rlen, rdz/rlen);
                
                tileData[idx++] = result.r;
                tileData[idx++] = result.g;
                tileData[idx++] = result.b;
                tileData[idx++] = 1.0; // Alpha
                tileData[idx++] = result.nx;
                tileData[idx++] = result.ny;
                tileData[idx++] = result.nz;
                tileData[idx++] = result.depth;
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

// --- JOINT BILATERAL FILTER (GEOMETRY AWARE) ---
function rayJointBilateralFilter(width, height, colorBuffer, normalDepthBuffer, samples) {
    const output = new Float32Array(colorBuffer.length);
    const w = width; const h = height;
    const invSamples = 1.0 / samples;

    // Configuração do Filtro
    const sigmaSpatial = 4.0;    // Raio do blur (pode ser maior agora que temos proteção de borda)
    const sigmaColor = 1.0;      // Tolerância de cor
    const sigmaNormal = 0.5;     // Sensibilidade à mudança de ângulo (0.1 a 1.0)
    const sigmaDepth = 0.5;      // Sensibilidade à mudança de profundidade

    const kSize = 2; // Kernel 5x5
    
    // Pré-calcular pesos espaciais
    const kernelWeights = [];
    for(let ky=-kSize; ky<=kSize; ky++) {
        for(let kx=-kSize; kx<=kSize; kx++) {
            const distSq = kx*kx + ky*ky;
            const wS = Math.exp(-distSq / (2 * sigmaSpatial * sigmaSpatial));
            kernelWeights.push({ x: kx, y: ky, w: wS });
        }
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            
            // Dados do pixel central
            const r0 = colorBuffer[idx] * invSamples;
            const g0 = colorBuffer[idx+1] * invSamples;
            const b0 = colorBuffer[idx+2] * invSamples;
            
            const nx0 = normalDepthBuffer[idx];
            const ny0 = normalDepthBuffer[idx+1];
            const nz0 = normalDepthBuffer[idx+2];
            const d0 = normalDepthBuffer[idx+3];

            let sumR = 0, sumG = 0, sumB = 0;
            let weightSum = 0;

            for (let k = 0; k < kernelWeights.length; k++) {
                const kw = kernelWeights[k];
                const nx = x + kw.x;
                const ny = y + kw.y;

                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    const nIdx = (ny * w + nx) * 4;
                    
                    // 1. Peso de Cor (Luminância ou RGB)
                    const r1 = colorBuffer[nIdx] * invSamples;
                    const g1 = colorBuffer[nIdx+1] * invSamples;
                    const b1 = colorBuffer[nIdx+2] * invSamples;
                    const dr = r1 - r0; const dg = g1 - g0; const db = b1 - b0;
                    const distColorSq = dr*dr + dg*dg + db*db;
                    const wColor = Math.exp(-distColorSq / (2 * sigmaColor * sigmaColor));

                    // 2. Peso de Normal (Dot Product)
                    const nx1 = normalDepthBuffer[nIdx];
                    const ny1 = normalDepthBuffer[nIdx+1];
                    const nz1 = normalDepthBuffer[nIdx+2];
                    // Dot product: Se for 1, normais iguais. Se < 0.8, quina forte.
                    let dot = nx0*nx1 + ny0*ny1 + nz0*nz1;
                    // Potência alta (32, 64) pune severamente ângulos diferentes
                    const wNormal = Math.pow(Math.max(0, dot), 128 * sigmaNormal); 

                    // 3. Peso de Profundidade
                    const d1 = normalDepthBuffer[nIdx+3];
                    const distDepth = Math.abs(d0 - d1);
                    const wDepth = Math.exp(-distDepth / (sigmaDepth));

                    // Peso Final Conjunto
                    const totalWeight = kw.w * wColor * wNormal * wDepth;

                    sumR += r1 * totalWeight;
                    sumG += g1 * totalWeight;
                    sumB += b1 * totalWeight;
                    weightSum += totalWeight;
                }
            }

            if (weightSum > 0) {
                output[idx] = sumR / weightSum;
                output[idx+1] = sumG / weightSum;
                output[idx+2] = sumB / weightSum;
                output[idx+3] = 1.0;
            } else {
                output[idx] = r0; output[idx+1] = g0; output[idx+2] = b0; output[idx+3] = 1.0;
            }
        }
    }
    return output;
}

function rayProcessNextTile(worker) {
    if (rayTileQueue.length > 0) {
        const tile = rayTileQueue.shift();
        rayActiveWorkersCount++;
        worker.postMessage({ type: 'renderTile', data: tile });
    } else {
        if (rayActiveWorkersCount === 0) rayFinalizePass();
    }
}

function rayFinalizePass() {
    raySamples++;
    const width = rayCanvas.width;
    const height = rayCanvas.height;
    const progressDiv = document.getElementById('progresso');

    // BUFFER DE VISUALIZAÇÃO
    let displayBuffer = rayAccumulationBuffer;
    let sampleDivisor = raySamples;
    
    // --- LÓGICA DE DENOISE ATUALIZADA ---
    // SÓ EXECUTA NO ÚLTIMO SAMPLE
    if (rayConfig.denoise && raySamples === rayConfig.maxSamples) {
        if (progressDiv) progressDiv.innerHTML = 'Applying Joint Bilateral Denoise...';
        
        // Pequeno timeout para o browser renderizar o texto de progresso antes de travar no calculo
        setTimeout(() => {
             displayBuffer = rayJointBilateralFilter(width, height, rayAccumulationBuffer, rayNormalDepthBuffer, raySamples);
             sampleDivisor = 1; // Já normalizado
             rayUpdateCanvas(displayBuffer, sampleDivisor);
             
             console.log('Ray Tracer: Complete with Joint Bilateral Denoise!');
             if (progressDiv) progressDiv.innerHTML = 'rendering complete';
             rayIsRendering = false;
             if (rayRenderButton) rayRenderButton.textContent = 'Iniciar Render';
        }, 10);
        return; 
    } 

    // Render normal (preview granulado durante o processo)
    rayUpdateCanvas(displayBuffer, sampleDivisor);
    
    if (progressDiv) progressDiv.innerHTML = `rendering sample ${raySamples}/${rayConfig.maxSamples}`;

    if (raySamples < rayConfig.maxSamples && rayIsRendering) {
        rayGenerateTileQueue();
        rayWorkers.forEach(w => rayProcessNextTile(w));
    } else if (!rayConfig.denoise) {
        // Se denoise desligado, finaliza aqui
        console.log('Ray Tracer: Complete!');
        if (progressDiv) progressDiv.innerHTML = 'rendering complete';
        rayIsRendering = false;
        if (rayRenderButton) rayRenderButton.textContent = 'Iniciar Render';
    }
}

function rayUpdateCanvas(buffer, divisor) {
    for (let i = 0; i < rayImageData.data.length; i += 4) {
        const avgColor = [
            buffer[i + 0] / divisor,
            buffer[i + 1] / divisor,
            buffer[i + 2] / divisor
        ];
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
    const width = rayCanvas.width;
    const height = rayCanvas.height;
    for (let y = 0; y < height; y += TILE_SIZE) {
        for (let x = 0; x < width; x += TILE_SIZE) {
            rayTileQueue.push({
                startX: x, startY: y,
                tileW: Math.min(TILE_SIZE, width - x),
                tileH: Math.min(TILE_SIZE, height - y),
                width: width, height: height
            });
        }
    }
}

function rayRenderFrame() {
    if (!rayIsRendering) return;
    if (rayTileQueue.length === 0 && rayActiveWorkersCount === 0) {
        rayGenerateTileQueue();
        rayWorkers.forEach(w => rayProcessNextTile(w));
    }
}

function raySetupWorkerListeners() {
    rayWorkers.forEach((worker) => {
        worker.onmessage = (e) => {
            if (e.data.type === 'result') {
                const { startX, startY, tileW, tileH, tileData } = e.data.data;
                const width = rayCanvas.width;
                
                let tileIdx = 0;
                for (let y = startY; y < startY + tileH; y++) {
                    for (let x = startX; x < startX + tileW; x++) {
                        const bufferIdx = (y * width + x) * 4;
                        
                        // 1. Color Buffer (Accumulate)
                        rayAccumulationBuffer[bufferIdx + 0] += tileData[tileIdx++];
                        rayAccumulationBuffer[bufferIdx + 1] += tileData[tileIdx++];
                        rayAccumulationBuffer[bufferIdx + 2] += tileData[tileIdx++];
                        rayAccumulationBuffer[bufferIdx + 3] += tileData[tileIdx++]; // Alpha dummy

                        // 2. Normal/Depth Buffer (Apenas sobrescrever ou média simples)
                        // Para simplificar e economizar memória, pegamos a geometria do sample atual.
                        // Em imagens estáticas, a geometria é sempre a mesma.
                        rayNormalDepthBuffer[bufferIdx + 0] = tileData[tileIdx++]; // Nx
                        rayNormalDepthBuffer[bufferIdx + 1] = tileData[tileIdx++]; // Ny
                        rayNormalDepthBuffer[bufferIdx + 2] = tileData[tileIdx++]; // Nz
                        rayNormalDepthBuffer[bufferIdx + 3] = tileData[tileIdx++]; // Depth
                    }
                }

                // Preview rápido no canvas
                tileIdx = 0;
                for (let y = startY; y < startY + tileH; y++) {
                    for (let x = startX; x < startX + tileW; x++) {
                        // Recalcular índice para pular os dados de geometria e pegar só cor para o preview
                        // O array tileData tem 8 floats. Cor é 0,1,2.
                        const r = tileData[tileIdx];
                        const g = tileData[tileIdx+1];
                        const b = tileData[tileIdx+2];
                        tileIdx += 8; // Pula os 8 floats deste pixel

                        const pixelIdx = (y * width + x) * 4;
                        // Tone map simples para preview (Gamma)
                        rayImageData.data[pixelIdx] = Math.min(255, Math.pow(r, 1/2.2) * 255);
                        rayImageData.data[pixelIdx+1] = Math.min(255, Math.pow(g, 1/2.2) * 255);
                        rayImageData.data[pixelIdx+2] = Math.min(255, Math.pow(b, 1/2.2) * 255);
                        rayImageData.data[pixelIdx+3] = 255;
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

function rayStartRendering(selectableObjects, threeCamera) {
    if (rayIsRendering) { rayStopRendering(); return; }
    console.log('=== Ray Tracer: Start (Tile + AO + Joint Bilateral) ===');

    rayCanvas = document.getElementById('renderCanvas');
    if (!rayCanvas) return;
    rayCanvas.style.display = 'block';
    rayCanvas.width = innerWidth * rayConfig.pixelRatio;
    rayCanvas.height = innerHeight * rayConfig.pixelRatio;
    rayCanvas.style.width = innerWidth + 'px';
    rayCanvas.style.height = innerHeight + 'px';
    rayCtx = rayCanvas.getContext('2d', { willReadFrequently: true });

    rayImageData = rayCtx.createImageData(rayCanvas.width, rayCanvas.height);
    // Color Buffer
    rayAccumulationBuffer = new Float32Array(rayCanvas.width * rayCanvas.height * 4);
    // Geometry Buffer (Nx, Ny, Nz, Depth)
    rayNormalDepthBuffer = new Float32Array(rayCanvas.width * rayCanvas.height * 4);
    
    raySamples = 0;
    rayActiveWorkersCount = 0;
    rayTileQueue = [];

    try {
        raySceneData = rayConvertThreeObjects(selectableObjects);
        if (!raySceneData) { rayStopRendering(); return; }
        rayUpdateCamera(threeCamera);
    } catch (error) {
        console.error('Conversion Error:', error);
        rayStopRendering();
        return;
    }

    if (rayWorkers.length === 0) {
        rayCreateWorkers();
        raySetupWorkerListeners();
    } else {
        raySetupWorkerListeners();
    }

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
                bvhBounds: raySceneData.bvhBounds,
                bvhContents: raySceneData.bvhContents,
                bvhIndices: raySceneData.bvhIndices,
                lights: raySceneData.lights,
                triangleData: raySceneData.triangleData,
                uvData: raySceneData.uvData,
                materialData: raySceneData.materialData,
                textureList: raySceneData.textureList,
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
}

function rayStopRendering() {
    if (!rayIsRendering) return;
    rayIsRendering = false;
    if (rayCanvas) rayCanvas.style.display = 'none';
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
function raySetAO(enabled, intensity=1.0, radius=1.5, samples=8) {
    rayConfig.aoEnabled = enabled;
    rayConfig.aoIntensity = intensity;
    rayConfig.aoRadius = radius;
    rayConfig.aoSamples = samples;
    console.log(`AO Configured: ${enabled ? 'ON' : 'OFF'}`);
}

window.addEventListener('beforeunload', () => { rayWorkers.forEach(worker => worker.terminate()); rayWorkers = []; });
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', raySetupRenderButton); } else { raySetupRenderButton(); }

// EXPORTS
window.rayLoadSkybox = rayLoadSkybox;
window.raySetPixelRatio = raySetPixelRatio;
window.raySetMaxSamples = raySetMaxSamples;
window.raySetMaxBounces = raySetMaxBounces;
window.raySetDenoise = raySetDenoise;
window.raySetAO = raySetAO;


//rayLoadSkybox('img/30 Sem Título_20251128140027.png');