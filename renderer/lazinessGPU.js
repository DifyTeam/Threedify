// ray-webgl2.js - GPU Path Tracer usando WebGL2 + GLSL
// Migração completa de CPU para GPU

// --- VARIÁVEIS GLOBAIS ---
let gl = null;
let rayCanvas = null;
let rayIsRendering = false;
let raySamples = 0;
let rayRenderButton = null;

// WebGL Resources
let renderProgram = null;
let displayProgram = null;
let quadVAO = null;
let framebuffers = [null, null]; // Ping-pong
let accumTextures = [null, null];
let currentFB = 0;

// Data Textures
let triangleTexture = null;
let uvTexture = null;
let materialTexture = null;
let bvhBoundsTexture = null;
let bvhContentsTexture = null;
let bvhIndicesTexture = null;
let skyboxTexture = null;
let sceneTextures = []; // Texturas do modelo

let rayTotalTriangles = 0;
let rayBVHNodeCount = 0;
let raySceneLights = [];
let rayCamera = {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    fov: 60,
    aspect: 1
};

const rayConfig = {
    maxSamples: 1000,
    maxBounces: 50,
    pixelRatio: 1.0,
    backgroundColor: [10/255, 10/255, 10/255],
    useSkybox: false
};

// --- VERTEX SHADER (Simples quad) ---
const vertexShaderSource = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// --- FRAGMENT SHADER PATH TRACER ---
const fragmentShaderSource = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D; // Necessário para texturas de uint

in vec2 v_uv;
out vec4 fragColor;

// Uniforms
uniform sampler2D u_triangleData;    // RGB32F: posições dos vértices
uniform sampler2D u_uvData;          // RG32F: coordenadas UV
uniform sampler2D u_materialData;    // RGBA32F: dados de material
uniform sampler2D u_bvhBounds;       // RGBA32F: bounds do BVH
uniform sampler2D u_skybox;          // RGB: skybox
uniform sampler2D u_prevFrame;       // Acumulação anterior

// CORREÇÃO: Usar usampler2D para texturas de Inteiros (UINT)
uniform usampler2D u_bvhContents;    // RGBA32UI: topologia do BVH
uniform usampler2D u_bvhIndices;     // R32UI: índices dos triângulos

uniform vec3 u_camPos;
uniform vec3 u_camTarget;
uniform float u_camFov;
uniform float u_camAspect;
uniform int u_sample;
uniform int u_maxBounces;
uniform int u_totalTriangles;
uniform int u_bvhNodeCount;
uniform bool u_useSkybox;
uniform vec3 u_backgroundColor;

// Estruturas
struct Ray {
    vec3 origin;
    vec3 direction;
};

struct HitRecord {
    bool hit;
    float t;
    vec3 point;
    vec3 normal;
    vec2 uv;
    vec3 albedo;
    float roughness;
    int matType;
    vec3 emissive;
    float metalness;
    float reflection;
    int textureId;
};

// RNG (PCG Hash)
uint pcg_hash(uint seed) {
    uint state = seed * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

float random(inout uint seed) {
    seed = pcg_hash(seed);
    return float(seed) / 4294967296.0;
}

vec3 randomInUnitSphere(inout uint seed) {
    vec3 p;
    do {
        p = vec3(random(seed), random(seed), random(seed)) * 2.0 - 1.0;
    } while (dot(p, p) >= 1.0);
    return p;
}

vec3 randomUnitVector(inout uint seed) {
    return normalize(randomInUnitSphere(seed));
}

// Sample Texture Data (texelFetch wrapper)
vec3 getTriangleVertex(int triIndex, int vertIndex) {
    int baseIndex = triIndex * 3 + vertIndex;
    int texWidth = textureSize(u_triangleData, 0).x;
    ivec2 coord = ivec2(baseIndex % texWidth, baseIndex / texWidth);
    return texelFetch(u_triangleData, coord, 0).rgb;
}

vec2 getTriangleUV(int triIndex, int vertIndex) {
    int baseIndex = triIndex * 3 + vertIndex;
    int texWidth = textureSize(u_uvData, 0).x;
    ivec2 coord = ivec2(baseIndex % texWidth, baseIndex / texWidth);
    return texelFetch(u_uvData, coord, 0).rg;
}

// Material: [r, g, b, roughness] [type, emR, emG, emB] [metalness, reflection, textureId, padding]
void getMaterial(int triIndex, out vec3 albedo, out float roughness, out int matType,
                 out vec3 emissive, out float metalness, out float reflection, out int texId) {
    int texWidth = textureSize(u_materialData, 0).x;
    int baseIndex = triIndex * 3;
    
    ivec2 coord0 = ivec2(baseIndex % texWidth, baseIndex / texWidth);
    ivec2 coord1 = ivec2((baseIndex + 1) % texWidth, (baseIndex + 1) / texWidth);
    ivec2 coord2 = ivec2((baseIndex + 2) % texWidth, (baseIndex + 2) / texWidth);
    
    // CORREÇÃO ANTERIOR: Renomeado mat0..2 para mData0..2
    vec4 mData0 = texelFetch(u_materialData, coord0, 0);
    vec4 mData1 = texelFetch(u_materialData, coord1, 0);
    vec4 mData2 = texelFetch(u_materialData, coord2, 0);
    
    albedo = mData0.rgb;
    roughness = mData0.a;
    matType = int(mData1.r);
    emissive = mData1.gba;
    metalness = mData2.r;
    reflection = mData2.g;
    texId = int(mData2.b);
}

// BVH Bounds
void getBVHBounds(int nodeIndex, out vec3 bmin, out vec3 bmax) {
    int texWidth = textureSize(u_bvhBounds, 0).x;
    int baseIndex = nodeIndex * 2;
    
    ivec2 coord0 = ivec2(baseIndex % texWidth, baseIndex / texWidth);
    ivec2 coord1 = ivec2((baseIndex + 1) % texWidth, (baseIndex + 1) / texWidth);
    
    vec4 bounds0 = texelFetch(u_bvhBounds, coord0, 0);
    vec4 bounds1 = texelFetch(u_bvhBounds, coord1, 0);
    
    bmin = vec3(bounds0.rgb);
    bmax = vec3(bounds0.a, bounds1.rg);
}

// BVH Contents (left/offset, right/count)
void getBVHContents(int nodeIndex, out int data1, out int data2, out bool isLeaf) {
    int texWidth = textureSize(u_bvhContents, 0).x;
    ivec2 coord = ivec2(nodeIndex % texWidth, nodeIndex / texWidth);
    
    // CORREÇÃO: texelFetch em usampler2D retorna uvec4
    uvec2 contents = texelFetch(u_bvhContents, coord, 0).rg;
    
    data1 = int(contents.r);
    data2 = int(contents.g & 0x7FFFFFFFu);
    isLeaf = (contents.g & 0x80000000u) != 0u;
}

// BVH Triangle Index
int getBVHTriangleIndex(int offset) {
    int texWidth = textureSize(u_bvhIndices, 0).x;
    ivec2 coord = ivec2(offset % texWidth, offset / texWidth);
    // CORREÇÃO: texelFetch em usampler2D retorna uvec4
    return int(texelFetch(u_bvhIndices, coord, 0).r);
}

// Skybox sampling
vec3 sampleSkybox(vec3 dir) {
    if (!u_useSkybox) return u_backgroundColor;
    
    float theta = atan(dir.x, dir.z);
    float phi = asin(clamp(dir.y, -1.0, 1.0));
    
    vec2 uv = vec2(0.5 + theta / (2.0 * 3.14159265), 0.5 - phi / 3.14159265);
    return texture(u_skybox, uv).rgb;
}

// Ray-AABB Intersection
bool intersectAABB(vec3 ro, vec3 invRd, vec3 bmin, vec3 bmax, float tMax) {
    vec3 t0 = (bmin - ro) * invRd;
    vec3 t1 = (bmax - ro) * invRd;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tNear = max(max(tmin.x, tmin.y), tmin.z);
    float tFar = min(min(tmax.x, tmax.y), tmax.z);
    return tNear <= tFar && tFar > 0.0 && tNear < tMax;
}

// Ray-Triangle Intersection (Möller-Trumbore)
bool intersectTriangle(Ray ray, int triIndex, float tMax, out float t, out float u, out float v) {
    vec3 v0 = getTriangleVertex(triIndex, 0);
    vec3 v1 = getTriangleVertex(triIndex, 1);
    vec3 v2 = getTriangleVertex(triIndex, 2);
    
    vec3 e1 = v1 - v0;
    vec3 e2 = v2 - v0;
    vec3 h = cross(ray.direction, e2);
    float a = dot(e1, h);
    
    if (abs(a) < 0.0000001) return false;
    
    float f = 1.0 / a;
    vec3 s = ray.origin - v0;
    u = f * dot(s, h);
    
    if (u < 0.0 || u > 1.0) return false;
    
    vec3 q = cross(s, e1);
    v = f * dot(ray.direction, q);
    
    if (v < 0.0 || u + v > 1.0) return false;
    
    t = f * dot(e2, q);
    return t > 0.0001 && t < tMax;
}

// BVH Traversal (Stack-based iterative)
HitRecord intersectScene(Ray ray, float tMax) {
    HitRecord closest;
    closest.hit = false;
    closest.t = tMax;
    
    vec3 invDir = 1.0 / ray.direction;
    
    // Stack para travessia
    int stack[64];
    int stackPtr = 0;
    stack[stackPtr++] = 0; // Root
    
    while (stackPtr > 0) {
        int nodeIdx = stack[--stackPtr];
        
        vec3 bmin, bmax;
        getBVHBounds(nodeIdx, bmin, bmax);
        
        if (!intersectAABB(ray.origin, invDir, bmin, bmax, closest.t)) {
            continue;
        }
        
        int data1, data2;
        bool isLeaf;
        getBVHContents(nodeIdx, data1, data2, isLeaf);
        
        if (isLeaf) {
            int offset = data1;
            int count = data2;
            
            for (int i = 0; i < count; i++) {
                int triIdx = getBVHTriangleIndex(offset + i);
                float t, u, v;
                
                if (intersectTriangle(ray, triIdx, closest.t, t, u, v)) {
                    closest.hit = true;
                    closest.t = t;
                    closest.point = ray.origin + ray.direction * t;
                    
                    // Normal
                    vec3 v0 = getTriangleVertex(triIdx, 0);
                    vec3 v1 = getTriangleVertex(triIdx, 1);
                    vec3 v2 = getTriangleVertex(triIdx, 2);
                    closest.normal = normalize(cross(v1 - v0, v2 - v0));
                    
                    // UV
                    vec2 uv0 = getTriangleUV(triIdx, 0);
                    vec2 uv1 = getTriangleUV(triIdx, 1);
                    vec2 uv2 = getTriangleUV(triIdx, 2);
                    float w = 1.0 - u - v;
                    closest.uv = w * uv0 + u * uv1 + v * uv2;
                    
                    // Material
                    getMaterial(triIdx, closest.albedo, closest.roughness, closest.matType,
                               closest.emissive, closest.metalness, closest.reflection, closest.textureId);
                }
            }
        } else {
            // Push children
            if (stackPtr < 62) {
                stack[stackPtr++] = data2; // Right
                stack[stackPtr++] = data1; // Left
            }
        }
    }
    
    return closest;
}

// Fresnel Schlick
float schlick(float cosine, float refIdx) {
    float r0 = (1.0 - refIdx) / (1.0 + refIdx);
    r0 = r0 * r0;
    return r0 + (1.0 - r0) * pow(1.0 - cosine, 5.0);
}

// Path Tracing
vec3 pathTrace(Ray ray, inout uint seed) {
    vec3 throughput = vec3(1.0);
    vec3 radiance = vec3(0.0);
    
    for (int depth = 0; depth < u_maxBounces; depth++) {
        HitRecord hit = intersectScene(ray, 1e10);
        
        if (!hit.hit) {
            radiance += throughput * sampleSkybox(ray.direction);
            break;
        }
        
        // Emissive
        radiance += throughput * hit.emissive;
        
        // Material Scattering
        vec3 scatterDir;
        
        if (hit.matType == 2) { // Glass/Reflective
            float refIdx = 1.5;
            float etai_over_etat = dot(ray.direction, hit.normal) > 0.0 ? refIdx : 1.0 / refIdx;
            vec3 normal = dot(ray.direction, hit.normal) > 0.0 ? -hit.normal : hit.normal;
            
            float cosTheta = min(dot(-ray.direction, normal), 1.0);
            float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
            
            bool cannotRefract = etai_over_etat * sinTheta > 1.0;
            float reflectProb = schlick(cosTheta, 1.0 / refIdx) * hit.reflection;
            
            if (cannotRefract || random(seed) < reflectProb) {
                scatterDir = reflect(ray.direction, normal);
            } else {
                scatterDir = refract(ray.direction, normal, etai_over_etat);
            }
            
            scatterDir += randomInUnitSphere(seed) * hit.roughness;
            
        } else if (hit.matType == 1) { // Metal
            vec3 reflected = reflect(ray.direction, hit.normal);
            scatterDir = reflected + randomInUnitSphere(seed) * hit.roughness;
            
            // Mix with diffuse based on metalness
            if (hit.metalness < 1.0) {
                vec3 diffuse = hit.normal + randomUnitVector(seed);
                scatterDir = mix(diffuse, scatterDir, hit.metalness);
            }
            
            if (dot(scatterDir, hit.normal) <= 0.0) break;
            
        } else { // Diffuse
            scatterDir = hit.normal + randomUnitVector(seed);
            if (dot(scatterDir, scatterDir) < 0.00001) {
                scatterDir = hit.normal;
            }
        }
        
        throughput *= hit.albedo;
        
        // Russian Roulette
        if (depth > 3) {
            float p = max(throughput.r, max(throughput.g, throughput.b));
            if (random(seed) > p) break;
            throughput /= p;
        }
        
        // Next Ray
        ray.origin = hit.point + hit.normal * 0.001;
        ray.direction = normalize(scatterDir);
    }
    
    return radiance;
}

void main() {
    // Initialize RNG
    uint seed = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(u_sample) * 26699u;
    seed = pcg_hash(seed);
    
    // Camera Setup
    vec3 forward = normalize(u_camTarget - u_camPos);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);
    
    float fovScale = tan(radians(u_camFov) * 0.5);
    
    // Jittered pixel
    vec2 jitter = vec2(random(seed) - 0.5, random(seed) - 0.5);
    vec2 ndc = (gl_FragCoord.xy + jitter) / vec2(textureSize(u_prevFrame, 0)) * 2.0 - 1.0;
    
    vec3 rayDir = normalize(
        forward + 
        right * ndc.x * u_camAspect * fovScale + 
        up * ndc.y * fovScale
    );
    
    Ray ray;
    ray.origin = u_camPos;
    ray.direction = rayDir;
    
    // Path Trace
    vec3 color = pathTrace(ray, seed);
    
    // Accumulate
    vec3 prevColor = texelFetch(u_prevFrame, ivec2(gl_FragCoord.xy), 0).rgb;
    vec3 accumulated = prevColor + color;
    
    fragColor = vec4(accumulated, 1.0);
}
`;

// --- DISPLAY SHADER (Tonemap e Gamma Correction) ---
const displayFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_accumTexture;
uniform int u_sampleCount;

// ACES Tonemap
vec3 acesTonemap(vec3 color) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
}

void main() {
    vec3 accumulated = texelFetch(u_accumTexture, ivec2(gl_FragCoord.xy), 0).rgb;
    vec3 avgColor = accumulated / float(u_sampleCount);
    
    // Tonemap + Gamma
    vec3 toneMapped = acesTonemap(avgColor);
    vec3 gammaCorrected = pow(toneMapped, vec3(1.0 / 2.2));
    
    fragColor = vec4(gammaCorrected, 1.0);
}
`;

// --- WEBGL2 SETUP ---
function initWebGL2() {
    rayCanvas = document.getElementById('renderCanvas');
    if (!rayCanvas) {
        console.error('Canvas não encontrado');
        return false;
    }
    
    gl = rayCanvas.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: true
    });
    
    if (!gl) {
        console.error('WebGL2 não suportado');
        return false;
    }
    
    // Check extensions
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) {
        console.error('EXT_color_buffer_float não disponível');
        return false;
    }
    
    console.log('WebGL2 inicializado com sucesso');
    return true;
}

// --- SHADER COMPILATION ---
function compileShader(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    
    return shader;
}

function createProgram(vsSource, fsSource) {
    const vs = compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = compileShader(fsSource, gl.FRAGMENT_SHADER);
    
    if (!vs || !fs) return null;
    
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        return null;
    }
    
    return program;
}

// --- QUAD VAO ---
function createQuadVAO() {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    
    const positions = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1
    ]);
    
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    
    gl.bindVertexArray(null);
    return vao;
}

// --- TEXTURE CREATION ---
function createDataTexture(data, width, height, internalFormat, format, type) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
    
    return texture;
}

// --- DATA UPLOAD ---
function uploadSceneData(sceneData) {
    const triangleCount = sceneData.triangleData.length / 9;
    
    // Triangle Data (3 vértices * 3 floats = 9 floats por tri)
    // Organizamos como: 1 texel RGB = 1 vértice
    const triVertCount = triangleCount * 3;
    const triTexWidth = Math.ceil(Math.sqrt(triVertCount));
    const triTexHeight = Math.ceil(triVertCount / triTexWidth);
    const triTexData = new Float32Array(triTexWidth * triTexHeight * 3);
    
    for (let i = 0; i < sceneData.triangleData.length; i++) {
        triTexData[i] = sceneData.triangleData[i];
    }
    
    triangleTexture = createDataTexture(
        triTexData, triTexWidth, triTexHeight,
        gl.RGB32F, gl.RGB, gl.FLOAT
    );
    
    // UV Data (3 vértices * 2 floats = 6 floats por tri)
    const uvTexData = new Float32Array(triTexWidth * triTexHeight * 2);
    for (let i = 0; i < sceneData.uvData.length; i++) {
        uvTexData[i] = sceneData.uvData[i];
    }
    
    uvTexture = createDataTexture(
        uvTexData, triTexWidth, triTexHeight,
        gl.RG32F, gl.RG, gl.FLOAT
    );
    
    // Material Data (11 floats por tri -> 3 texels RGBA)
    const matTexWidth = Math.ceil(Math.sqrt(triangleCount * 3));
    const matTexHeight = Math.ceil((triangleCount * 3) / matTexWidth);
    const matTexData = new Float32Array(matTexWidth * matTexHeight * 4);
    
    for (let i = 0; i < triangleCount; i++) {
        const baseIdx = i * 11;
        const texBaseIdx = i * 12; // 3 texels * 4 components
        
        // Texel 0: [r, g, b, roughness]
        matTexData[texBaseIdx + 0] = sceneData.materialData[baseIdx + 0];
        matTexData[texBaseIdx + 1] = sceneData.materialData[baseIdx + 1];
        matTexData[texBaseIdx + 2] = sceneData.materialData[baseIdx + 2];
        matTexData[texBaseIdx + 3] = sceneData.materialData[baseIdx + 3];
        
        // Texel 1: [type, emR, emG, emB]
        matTexData[texBaseIdx + 4] = sceneData.materialData[baseIdx + 4];
        matTexData[texBaseIdx + 5] = sceneData.materialData[baseIdx + 5];
        matTexData[texBaseIdx + 6] = sceneData.materialData[baseIdx + 6];
        matTexData[texBaseIdx + 7] = sceneData.materialData[baseIdx + 7];
        
        // Texel 2: [metalness, reflection, textureId, padding]
        matTexData[texBaseIdx + 8] = sceneData.materialData[baseIdx + 8];
        matTexData[texBaseIdx + 9] = sceneData.materialData[baseIdx + 9];
        matTexData[texBaseIdx + 10] = sceneData.materialData[baseIdx + 10];
        matTexData[texBaseIdx + 11] = 0.0;
    }
    
    materialTexture = createDataTexture(
        matTexData, matTexWidth, matTexHeight,
        gl.RGBA32F, gl.RGBA, gl.FLOAT
    );
    
    // BVH Bounds (6 floats = 2 texels RGB)
    const nodeCount = sceneData.bvhBounds.length / 6;
    rayBVHNodeCount = nodeCount;
    const bvhTexWidth = Math.ceil(Math.sqrt(nodeCount * 2));
    const bvhTexHeight = Math.ceil((nodeCount * 2) / bvhTexWidth);
    const bvhBoundsData = new Float32Array(bvhTexWidth * bvhTexHeight * 4);
    
    for (let i = 0; i < nodeCount; i++) {
        const srcIdx = i * 6;
        const dstIdx = i * 8; // 2 texels * 4 components
        
        // Texel 0: [minX, minY, minZ, maxX]
        bvhBoundsData[dstIdx + 0] = sceneData.bvhBounds[srcIdx + 0];
        bvhBoundsData[dstIdx + 1] = sceneData.bvhBounds[srcIdx + 1];
        bvhBoundsData[dstIdx + 2] = sceneData.bvhBounds[srcIdx + 2];
        bvhBoundsData[dstIdx + 3] = sceneData.bvhBounds[srcIdx + 3];
        
        // Texel 1: [maxY, maxZ, padding, padding]
        bvhBoundsData[dstIdx + 4] = sceneData.bvhBounds[srcIdx + 4];
        bvhBoundsData[dstIdx + 5] = sceneData.bvhBounds[srcIdx + 5];
        bvhBoundsData[dstIdx + 6] = 0.0;
        bvhBoundsData[dstIdx + 7] = 0.0;
    }
    
    bvhBoundsTexture = createDataTexture(
        bvhBoundsData, bvhTexWidth, bvhTexHeight,
        gl.RGBA32F, gl.RGBA, gl.FLOAT
    );
    
    // BVH Contents (2 uints = 1 texel RG32UI)
    const bvhContentsData = new Uint32Array(bvhTexWidth * bvhTexHeight * 2);
    for (let i = 0; i < sceneData.bvhContents.length; i++) {
        bvhContentsData[i] = sceneData.bvhContents[i];
    }
    bvhContentsTexture = createDataTexture(
        bvhContentsData, bvhTexWidth, bvhTexHeight,
        gl.RG32UI, gl.RG_INTEGER, gl.UNSIGNED_INT
    );
    
    // BVH Indices (1 uint = 1 texel R32UI)
    const indicesCount = sceneData.bvhIndices.length;
    const indicesTexWidth = Math.ceil(Math.sqrt(indicesCount));
    const indicesTexHeight = Math.ceil(indicesCount / indicesTexWidth);
    const indicesData = new Uint32Array(indicesTexWidth * indicesTexHeight);
    
    for (let i = 0; i < sceneData.bvhIndices.length; i++) {
        indicesData[i] = sceneData.bvhIndices[i];
    }
    
    bvhIndicesTexture = createDataTexture(
        indicesData, indicesTexWidth, indicesTexHeight,
        gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT
    );
    
    console.log('Scene data uploaded to GPU');
    console.log(`Triangles: ${triangleCount}, BVH Nodes: ${nodeCount}`);
}

// --- FRAMEBUFFER SETUP ---
function createFramebuffers(width, height) {
    for (let i = 0; i < 2; i++) {
        // Accumulation texture
        accumTextures[i] = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, accumTextures[i]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
        
        // Framebuffer
        framebuffers[i] = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumTextures[i], 0);
        
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer incomplete:', status);
            return false;
        }
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    // Clear both buffers
    for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[i]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
}

// --- SKYBOX LOADING ---
function rayLoadSkybox(imagePath) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            skyboxTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, skyboxTexture);
            
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            
            rayConfig.useSkybox = true;
            console.log(`Skybox loaded: ${img.width}x${img.height}`);
            resolve();
        };
        
        img.onerror = () => {
            console.error('Failed to load skybox:', imagePath);
            rayConfig.useSkybox = false;
            reject(new Error('Failed to load skybox'));
        };
        
        img.src = imagePath;
    });
}

// --- SCENE CONVERSION (Mesmas funções do código original) ---
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
            if (geo.index) {
                count += geo.index.count / 3;
            } else if (geo.attributes.position) {
                count += geo.attributes.position.count / 3;
            }
        }
        
        if (obj.children && obj.children.length > 0) {
            count += rayCountTrianglesRecursive(obj.children);
        }
    }
    return count;
}

function rayFillBuffersRecursive(objects, lights, cursor, triangleData, uvData, materialData) {
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

                if (m.rayemission !== undefined && m.rayemission > 0) {
                    const intensity = m.rayemission * 10.0;
                    emR = r * intensity;
                    emG = g * intensity; 
                    emB = b * intensity;
                } else if(m.emissive) { 
                    emR=m.emissive.r;
                    emG=m.emissive.g; 
                    emB=m.emissive.b; 
                }

                if (m.rayroughness !== undefined) roughness = m.rayroughness;
                else if(m.roughness !== undefined) roughness = m.roughness;

                if (m.raymetalness !== undefined) {
                    metalnessValue = m.raymetalness;
                } else if (m.metalness !== undefined) {
                    metalnessValue = m.metalness;
                }

                if (m.rayreflection !== undefined) {
                    reflectionValue = m.rayreflection;
                }

                if (reflectionValue > 0.01) {
                    matType = 2;
                } else if (metalnessValue > 0.01) {
                    matType = 1;
                } else {
                    matType = 0;
                }
            }

            const transformAndStore = (x, y, z, offset) => {
                const tx = x * mw[0] + y * mw[4] + z * mw[8] + mw[12];
                const ty = x * mw[1] + y * mw[5] + z * mw[9] + mw[13];
                const tz = x * mw[2] + y * mw[6] + z * mw[10] + mw[14];
                triangleData[offset] = tx;
                triangleData[offset+1] = ty; 
                triangleData[offset+2] = tz;
            };

            const triCount = indices ? (indices.length / 3) : (positions.length / 9);
            for (let t = 0; t < triCount; t++) {
                let i0, i1, i2;
                if (indices) {
                    i0 = indices[t*3];
                    i1 = indices[t*3+1]; 
                    i2 = indices[t*3+2];
                } else {
                    i0 = t * 3;
                    i1 = t * 3 + 1; 
                    i2 = t * 3 + 2;
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
                    uvData[uvBaseIdx] = uvs[i0*2]; 
                    uvData[uvBaseIdx+1] = uvs[i0*2+1];
                    uvData[uvBaseIdx+2] = uvs[i1*2]; 
                    uvData[uvBaseIdx+3] = uvs[i1*2+1];
                    uvData[uvBaseIdx+4] = uvs[i2*2]; 
                    uvData[uvBaseIdx+5] = uvs[i2*2+1];
                } else {
                    uvData[uvBaseIdx] = 0; 
                    uvData[uvBaseIdx+1] = 0;
                    uvData[uvBaseIdx+2] = 0; 
                    uvData[uvBaseIdx+3] = 0;
                    uvData[uvBaseIdx+4] = 0; 
                    uvData[uvBaseIdx+5] = 0;
                }

                materialData[matIdx] = r;
                materialData[matIdx+1] = g;
                materialData[matIdx+2] = b;
                materialData[matIdx+3] = roughness; 
                materialData[matIdx+4] = matType;
                materialData[matIdx+5] = emR; 
                materialData[matIdx+6] = emG;
                materialData[matIdx+7] = emB;
                materialData[matIdx+8] = metalnessValue;
                materialData[matIdx+9] = reflectionValue;
                materialData[matIdx+10] = textureId;

                cursor.index++;
            }
        }

        if (obj.children && obj.children.length > 0) {
            rayFillBuffersRecursive(obj.children, lights, cursor, triangleData, uvData, materialData);
        }
    }
}

function rayBuildFlatBVH(triangleIndices, triangleData) {
    const nodes = [];
    const bvhIndices = [];
    
    function build(indices) {
        const nodeIndex = nodes.length;
        nodes.push({ min: null, max: null, left: -1, right: -1, offset: -1, count: 0 });

        const count = indices.length;
        let minX=Infinity, minY=Infinity, minZ=Infinity;
        let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;

        for(let i=0; i<count; i++) {
            const base = indices[i] * 9;
            for(let k=0; k<9; k+=3) {
                const x = triangleData[base+k];
                const y = triangleData[base+k+1];
                const z = triangleData[base+k+2];
                if(x < minX) minX = x; if(x > maxX) maxX = x;
                if(y < minY) minY = y; if(y > maxY) maxY = y;
                if(z < minZ) minZ = z; if(z > maxZ) maxZ = z;
            }
        }
        
        nodes[nodeIndex].min = {x: minX, y: minY, z: minZ};
        nodes[nodeIndex].max = {x: maxX, y: maxY, z: maxZ};

        if (count <= 4) {
            nodes[nodeIndex].offset = bvhIndices.length;
            nodes[nodeIndex].count = count;
            for(let i=0; i<count; i++) bvhIndices.push(indices[i]);
            return nodeIndex;
        }

        const extentX = maxX - minX;
        const extentY = maxY - minY;
        const extentZ = maxZ - minZ;
        let axis = 0;
        if (extentY > extentX && extentY > extentZ) axis = 1;
        else if (extentZ > extentX && extentZ > extentY) axis = 2;
        
        indices.sort((a, b) => {
            const baseA = a * 9;
            const cA = (triangleData[baseA+axis] + triangleData[baseA+3+axis] + triangleData[baseA+6+axis]) / 3;
            const baseB = b * 9;
            const cB = (triangleData[baseB+axis] + triangleData[baseB+3+axis] + triangleData[baseB+6+axis]) / 3;
            return cA - cB;
        });

        const mid = Math.floor(count / 2);
        const leftIdx = build(indices.slice(0, mid));
        const rightIdx = build(indices.slice(mid));
        nodes[nodeIndex].left = leftIdx;
        nodes[nodeIndex].right = rightIdx;
        
        return nodeIndex;
    }

    build(triangleIndices);
    
    const nodeCount = nodes.length;
    const bvhBounds = new Float32Array(nodeCount * 6);
    const bvhContents = new Uint32Array(nodeCount * 2);

    for(let i=0; i<nodeCount; i++) {
        const n = nodes[i];
        bvhBounds[i*6+0] = n.min.x; 
        bvhBounds[i*6+1] = n.min.y; 
        bvhBounds[i*6+2] = n.min.z;
        bvhBounds[i*6+3] = n.max.x; 
        bvhBounds[i*6+4] = n.max.y; 
        bvhBounds[i*6+5] = n.max.z;
        
        if (n.count > 0) {
            bvhContents[i*2+0] = n.offset;
            bvhContents[i*2+1] = n.count | 0x80000000;
        } else {
            bvhContents[i*2+0] = n.left;
            bvhContents[i*2+1] = n.right;
        }
    }

    return {
        bounds: bvhBounds,
        contents: bvhContents,
        indices: new Uint32Array(bvhIndices)
    };
}

function rayConvertThreeObjects(selectableObjects) {
    const lights = [];
    const progressDiv = document.getElementById('progresso');
    
    if (progressDiv) progressDiv.innerHTML = 'counting triangles...';
    rayTotalTriangles = rayCountTrianglesRecursive(selectableObjects);

    if (rayTotalTriangles === 0) {
        console.error("Nenhum triângulo encontrado!");
        return null;
    }

    const triangleData = new Float32Array(rayTotalTriangles * 9); 
    const uvData = new Float32Array(rayTotalTriangles * 6);
    const materialData = new Float32Array(rayTotalTriangles * 11);
    
    if (progressDiv) progressDiv.innerHTML = 'extracting data...';
    const cursor = { index: 0 };
    rayFillBuffersRecursive(selectableObjects, lights, cursor, triangleData, uvData, materialData);
    
    if (progressDiv) progressDiv.innerHTML = 'building BVH...';
    const allIndices = new Array(cursor.index);
    for(let i=0; i<cursor.index; i++) allIndices[i] = i;
    const bvhData = rayBuildFlatBVH(allIndices, triangleData);
    
    return {
        bvhBounds: bvhData.bounds,
        bvhContents: bvhData.contents,
        bvhIndices: bvhData.indices,
        lights: lights,
        triangleData: triangleData,
        uvData: uvData,
        materialData: materialData
    };
}

// --- CAMERA UPDATE ---
function rayUpdateCamera(threeCamera) {
    rayCamera.position = { 
        x: threeCamera.position.x, 
        y: threeCamera.position.y, 
        z: threeCamera.position.z 
    };
    
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

// --- RENDER LOOP ---
function rayRenderFrame() {
    if (!rayIsRendering) return;
    
    // Render to accumulation buffer (ping-pong)
    const readFB = currentFB;
    const writeFB = 1 - currentFB;
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[writeFB]);
    gl.viewport(0, 0, rayCanvas.width, rayCanvas.height);
    
    gl.useProgram(renderProgram);
    
    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, triangleTexture);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_triangleData'), 0);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, uvTexture);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_uvData'), 1);
    
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, materialTexture);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_materialData'), 2);
    
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, bvhBoundsTexture);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_bvhBounds'), 3);
    
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, bvhContentsTexture);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_bvhContents'), 4);
    
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, bvhIndicesTexture);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_bvhIndices'), 5);
    
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, skyboxTexture || triangleTexture);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_skybox'), 6);
    
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, accumTextures[readFB]);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_prevFrame'), 7);
    
    // Set uniforms
    gl.uniform3f(gl.getUniformLocation(renderProgram, 'u_camPos'), 
        rayCamera.position.x, rayCamera.position.y, rayCamera.position.z);
    gl.uniform3f(gl.getUniformLocation(renderProgram, 'u_camTarget'), 
        rayCamera.target.x, rayCamera.target.y, rayCamera.target.z);
    gl.uniform1f(gl.getUniformLocation(renderProgram, 'u_camFov'), rayCamera.fov);
    gl.uniform1f(gl.getUniformLocation(renderProgram, 'u_camAspect'), rayCamera.aspect);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_sample'), raySamples);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_maxBounces'), rayConfig.maxBounces);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_totalTriangles'), rayTotalTriangles);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_bvhNodeCount'), rayBVHNodeCount);
    gl.uniform1i(gl.getUniformLocation(renderProgram, 'u_useSkybox'), rayConfig.useSkybox ? 1 : 0);
    gl.uniform3f(gl.getUniformLocation(renderProgram, 'u_backgroundColor'), 
        rayConfig.backgroundColor[0], rayConfig.backgroundColor[1], rayConfig.backgroundColor[2]);
    
    // Draw
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    currentFB = writeFB;
    raySamples++;
    
    // Display to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, rayCanvas.width, rayCanvas.height);
    
    gl.useProgram(displayProgram);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accumTextures[writeFB]);
    gl.uniform1i(gl.getUniformLocation(displayProgram, 'u_accumTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(displayProgram, 'u_sampleCount'), raySamples);
    
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    // Update progress
    const progressDiv = document.getElementById('progresso');
    if (progressDiv) {
        progressDiv.innerHTML = `rendering sample ${raySamples}/${rayConfig.maxSamples}`;
    }
    
    // Continue or finish
    if (raySamples < rayConfig.maxSamples && rayIsRendering) {
        requestAnimationFrame(rayRenderFrame);
    } else {
        console.log('Ray Tracer: Complete!');
        if (progressDiv) progressDiv.innerHTML = 'rendering complete';
        rayIsRendering = false;
        if (rayRenderButton) rayRenderButton.textContent = 'Iniciar Render';
    }
}

// --- START RENDERING ---
function rayStartRendering(selectableObjects, threeCamera) {
    if (rayIsRendering) { 
        rayStopRendering(); 
        return;
    }
    
    console.log('=== Ray Tracer GPU (WebGL2) Started ===');

    rayCanvas = document.getElementById('renderCanvas');
    if (!rayCanvas) {
        console.error('Canvas não encontrado');
        return;
    }
    
    if (!gl && !initWebGL2()) {
        console.error('Falha ao inicializar WebGL2');
        return;
    }
    
    rayCanvas.style.display = 'block';
    rayCanvas.width = window.innerWidth * rayConfig.pixelRatio;
    rayCanvas.height = window.innerHeight * rayConfig.pixelRatio;
    rayCanvas.style.width = window.innerWidth + 'px';
    rayCanvas.style.height = window.innerHeight + 'px';
    
    raySamples = 0;
    currentFB = 0;
    
    try {
        const sceneData = rayConvertThreeObjects(selectableObjects);
        if (!sceneData) {
            rayStopRendering();
            return;
        }
        
        raySceneLights = sceneData.lights;
        rayUpdateCamera(threeCamera);
        
        // Create programs if needed
        if (!renderProgram) {
            renderProgram = createProgram(vertexShaderSource, fragmentShaderSource);
            if (!renderProgram) {
                console.error('Failed to create render program');
                return;
            }
        }
        
        if (!displayProgram) {
            displayProgram = createProgram(vertexShaderSource, displayFragmentShader);
            if (!displayProgram) {
                console.error('Failed to create display program');
                return;
            }
        }
        
        // Create quad VAO
        if (!quadVAO) {
            quadVAO = createQuadVAO();
        }
        
        // Upload scene data to GPU
        uploadSceneData(sceneData);
        
        // Create framebuffers
        if (!createFramebuffers(rayCanvas.width, rayCanvas.height)) {
            console.error('Failed to create framebuffers');
            return;
        }
        
        rayIsRendering = true;
        rayRenderFrame();
        
    } catch (error) {
        console.error('Conversion Error:', error);
        rayStopRendering();
    }
}

// --- STOP RENDERING ---
function rayStopRendering() {
    if (!rayIsRendering) return;
    rayIsRendering = false;
    
    if (rayCanvas) rayCanvas.style.display = 'none';
    
    const progressDiv = document.getElementById('progresso');
    if (progressDiv) progressDiv.innerHTML = 'stopped';
}

// --- SETUP BUTTON ---
function raySetupRenderButton() {
    rayRenderButton = document.getElementById('render');
    if (!rayRenderButton) return;
    
    rayRenderButton.addEventListener('click', () => {
        if (typeof selectableObjects === 'undefined' || typeof camera === 'undefined') {
            console.error('selectableObjects ou camera não definidos');
            return;
        }
        
        if (rayIsRendering) {
            rayStopRendering();
            rayRenderButton.textContent = 'Iniciar Render';
        } else {
            rayStartRendering(selectableObjects, camera);
            rayRenderButton.textContent = 'Parar Render';
        }
    });
}

// --- CONFIG FUNCTIONS ---
function raySetPixelRatio(ratio) { 
    rayConfig.pixelRatio = Math.max(0.1, Math.min(1.0, ratio));
}

function raySetMaxSamples(samples) { 
    rayConfig.maxSamples = Math.max(1, samples); 
}

function raySetMaxBounces(bounces) { 
    rayConfig.maxBounces = Math.max(1, Math.min(50, bounces));
}

// --- CLEANUP ---
window.addEventListener('beforeunload', () => {
    if (gl) {
        // Cleanup WebGL resources
        if (triangleTexture) gl.deleteTexture(triangleTexture);
        if (uvTexture) gl.deleteTexture(uvTexture);
        if (materialTexture) gl.deleteTexture(materialTexture);
        if (bvhBoundsTexture) gl.deleteTexture(bvhBoundsTexture);
        if (bvhContentsTexture) gl.deleteTexture(bvhContentsTexture);
        if (bvhIndicesTexture) gl.deleteTexture(bvhIndicesTexture);
        if (skyboxTexture) gl.deleteTexture(skyboxTexture);
        
        framebuffers.forEach(fb => { if (fb) gl.deleteFramebuffer(fb); });
        accumTextures.forEach(tex => { if (tex) gl.deleteTexture(tex); });
        
        if (renderProgram) gl.deleteProgram(renderProgram);
        if (displayProgram) gl.deleteProgram(displayProgram);
        if (quadVAO) gl.deleteVertexArray(quadVAO);
    }
});

// --- INITIALIZATION ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', raySetupRenderButton);
} else {
    raySetupRenderButton();
}

// --- EXPORTS ---
window.rayLoadSkybox = rayLoadSkybox;
window.raySetPixelRatio = raySetPixelRatio;
window.raySetMaxSamples = raySetMaxSamples;
window.raySetMaxBounces = raySetMaxBounces;
window.rayStartRendering = rayStartRendering;
window.rayStopRendering = rayStopRendering;