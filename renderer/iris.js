// =========================================================
// 0. CONFIGURAÇÕES GERAIS
// =========================================================

// Alterado de const para let para permitir edição via UI
let LIGHT_INTENSITY_FACTOR = 0.01; 
let GI_INTENSITY = 1.2; // Aumentado de 1.0 para 1.2

// --- CONTROLE DE AMBIENT OCCLUSION (AO) ---
// Mantemos const pois alteramos as propriedades do objeto
const AO_OPTIONS = {
    strength: 1.2,    // Reduzido de 1.5 para 1.2 (menos agressivo)
    radius: 0.03,     // Raio da esfera de amostragem (em metros). Afeta a "escala" da sombra.
    bias: 0.01        // Evita "acne" (pontos pretos) em superfícies planas.
};

// --- CONTROLE DO CÉU / SKYBOX ---
const SKY_OPTIONS = {
    mode: 'unity', 
    textureUrl: '/img/IMG_20260102_122652.jpg', 
    customColor: 0x121212, 
    unityColors: {
        top: 0x3A4B5C,
        horizon: 0x85919D,
        bottom: 0x2D2F31
    },
    intensity: 0.3  // Aumentado de 0.05 para 0.3 (skylight mais forte)
};

const SKY_COLOR_FALLBACK = new THREE.Color(0x323232);
let ENABLE_ANTIALIAS = true; 
let ENABLE_GI = true;             
let ENABLE_RESTIR = true; // --- ReSTIR: CONTROLE DE LIGAR/DESLIGAR ---

// --- BLOOM CONFIG ---
let ENABLE_BLOOM = true;
let BLOOM_STRENGTH = 0.8;   
let BLOOM_RADIUS = 0.5;       
let BLOOM_THRESHOLD = 1.0;  
let BLOOM_MIPS = 5;         

// =========================================================
// 1. SHADERS
// =========================================================

const SSGI_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BLOOM_HIGHPASS_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMap;     
uniform sampler2D tNormal;
uniform sampler2D tData;
uniform float threshold;

void main() {
    vec3 normal = texture2D(tNormal, vUv).rgb;
    if (length(normal) < 0.1) { gl_FragColor = vec4(0.0); return; }
    
    vec4 texel = texture2D(tMap, vUv);
    vec3 color = texel.rgb;
    
    // Pega dados do material
    vec4 matData = texture2D(tData, vUv);
    float roughness = matData.r;
    float emission = matData.b;
    
    // Se for emissivo, usa threshold mais baixo
    float adaptiveThreshold = threshold;
    if (emission > 0.01) {
        adaptiveThreshold = threshold * 0.3;
    }
    // Se for muito especular (roughness baixo), facilita bloom
    else if (roughness < 0.2) {
        adaptiveThreshold = threshold * 0.7;
    }
    
    float brightness = max(color.r, max(color.g, color.b));
    float contribution = max(0.0, brightness - adaptiveThreshold);
    
    if (brightness > 0.0001) {
        color = color * (contribution / brightness);
    } else {
        color = vec3(0.0);
    }
    
    gl_FragColor = vec4(color, 1.0);
}
`;

const BLOOM_DOWNSAMPLE_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMap;
uniform vec2 resolution;
void main() {
    vec2 texelSize = 1.0 / resolution;
    float x = texelSize.x; float y = texelSize.y;
    vec3 a = texture2D(tMap, vUv + vec2(-2.0*x, 2.0*y)).rgb;
    vec3 b = texture2D(tMap, vUv + vec2( 0.0*x, 2.0*y)).rgb;
    vec3 c = texture2D(tMap, vUv + vec2( 2.0*x, 2.0*y)).rgb;
    vec3 d = texture2D(tMap, vUv + vec2(-2.0*x, 0.0*y)).rgb;
    vec3 e = texture2D(tMap, vUv + vec2( 0.0*x, 0.0*y)).rgb;
    vec3 f = texture2D(tMap, vUv + vec2( 2.0*x, 0.0*y)).rgb;
    vec3 g = texture2D(tMap, vUv + vec2(-2.0*x,-2.0*y)).rgb;
    vec3 h = texture2D(tMap, vUv + vec2( 0.0*x,-2.0*y)).rgb;
    vec3 i = texture2D(tMap, vUv + vec2( 2.0*x,-2.0*y)).rgb;
    vec3 j = texture2D(tMap, vUv + vec2(-1.0*x, 1.0*y)).rgb;
    vec3 k = texture2D(tMap, vUv + vec2( 1.0*x, 1.0*y)).rgb;
    vec3 l = texture2D(tMap, vUv + vec2(-1.0*x,-1.0*y)).rgb;
    vec3 m = texture2D(tMap, vUv + vec2( 1.0*x,-1.0*y)).rgb;
    vec3 color = e * 0.125;
    color += (a+c+g+i) * 0.03125; color += (b+d+f+h) * 0.0625; color += (j+k+l+m) * 0.125;
    gl_FragColor = vec4(color, 1.0);
}
`;

const BLOOM_UPSAMPLE_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMap;         
uniform float radius;
uniform vec2 resolution;
void main() {
    vec2 texelSize = 1.0 / resolution;
    float x = texelSize.x * radius; float y = texelSize.y * radius;
    vec3 a = texture2D(tMap, vUv + vec2(-x, y)).rgb;
    vec3 b = texture2D(tMap, vUv + vec2( 0, y)).rgb;
    vec3 c = texture2D(tMap, vUv + vec2( x, y)).rgb;
    vec3 d = texture2D(tMap, vUv + vec2(-x, 0)).rgb;
    vec3 e = texture2D(tMap, vUv + vec2( 0, 0)).rgb;
    vec3 f = texture2D(tMap, vUv + vec2( x, 0)).rgb;
    vec3 g = texture2D(tMap, vUv + vec2(-x,-y)).rgb;
    vec3 h = texture2D(tMap, vUv + vec2( 0,-y)).rgb;
    vec3 i = texture2D(tMap, vUv + vec2( x,-y)).rgb;
    vec3 upsampled = e * 4.0;
    upsampled += (b+d+f+h) * 2.0; upsampled += (a+c+g+i); upsampled *= 1.0 / 16.0;
    gl_FragColor = vec4(upsampled, 1.0);
}
`;

const DATA_FRAGMENT_SHADER = `
uniform float uRoughness;
uniform float uMetalness;
uniform float uEmission;
uniform float uReflection;
void main() {
    gl_FragColor = vec4(uRoughness, uMetalness, uEmission, uReflection);
}
`;

const SSGI_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;

uniform sampler2D tColor;
uniform sampler2D tAlbedo;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform sampler2D tAccum; 
uniform sampler2D tData; 
uniform sampler2D tSkyboxMap; 

uniform mat4 cameraProjectionMatrix;        
uniform mat4 cameraProjectionMatrixInv;
uniform mat4 cameraViewMatrixInv;

uniform vec2 resolution;
uniform float frame;
uniform vec3 uSkyColor;      
uniform float uGiIntensity; 
uniform float uUseSkybox; 
uniform float uEnableRestir; // --- ReSTIR Uniform ---

uniform float uSkyIntensity;
uniform float uAoStrength;
uniform float uAoRadius;
uniform float uAoBias;

uniform vec3 uUnityTop;
uniform vec3 uUnityHorizon;
uniform vec3 uUnityBottom;

#define PI 3.14159265359
#define GI_SAMPLES 24  // Aumentado de 16 para 24
#define AO_SAMPLES 12
#define MAX_DIST 50.0  // Reduzido de 1000.0 para 50.0 (mais realista)
#define ENERGY_CONSERVATION 0.95  // Aumentado de 0.85 para 0.95 (mais generoso)
#define RIS_CANDIDATES 4 // --- ReSTIR: Número de candidatos para Importance Sampling ---

vec3 sanitize(vec3 color) {
    if (any(isinf(color)) || any(isnan(color))) return vec3(0.0);
    return clamp(color, 0.0, 100.0);  // Aumentado de 50.0 para 100.0
}

float hash(vec2 p) {
    vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Blue noise para melhor distribuição
vec2 hash2(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// Gera vetor aleatório na semiesfera orientada pela normal
vec3 randomHemisphereVector(vec3 normal, vec2 uv, float offset) {
    vec2 rand = hash2(uv * (frame + 10.0 + offset));
    float phi = 2.0 * PI * rand.x;
    float costheta = rand.y; // Cosine-weighted para melhor distribuição
    float theta = acos(sqrt(costheta));
    
    float x = sin(theta) * cos(phi);
    float y = sin(theta) * sin(phi);
    float z = cos(theta);
    
    vec3 randVec = vec3(x, y, z);
    // Se estiver oposto à normal, inverte
    if (dot(randVec, normal) < 0.0) randVec = -randVec;
    return normalize(randVec);
}

vec3 getViewPos(vec2 uv, float depth) {
    vec4 clipSpacePosition = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 viewSpacePosition = cameraProjectionMatrixInv * clipSpacePosition;
    return viewSpacePosition.xyz / viewSpacePosition.w;
}

float screenFade(vec2 uv) {
    vec2 fade = smoothstep(0.0, 0.1, uv) * smoothstep(1.0, 0.9, uv);
    return fade.x * fade.y;
}

vec2 equirectangularMapping(vec3 dir) {
    vec2 uv = vec2(atan(dir.z, dir.x), asin(dir.y));
    uv *= vec2(0.1591, 0.3183); 
    uv += 0.5;
    return uv;
}

vec3 getSkyColor(vec3 dir) {
    vec3 baseColor;
    if (uUseSkybox > 1.5) { 
        float y = dir.y;
        float factor = clamp(y, -1.0, 1.0);
        float mixFactor = pow(abs(factor), 0.6); 
        if (factor > 0.0) baseColor = mix(uUnityHorizon, uUnityTop, mixFactor);
        else baseColor = mix(uUnityHorizon, uUnityBottom, mixFactor);
        baseColor *= uSkyColor; 
    }
    else if (uUseSkybox > 0.5) { 
        vec2 skyUV = equirectangularMapping(normalize(dir));
        baseColor = texture2D(tSkyboxMap, skyUV).rgb * uSkyColor; 
    }
    else { baseColor = uSkyColor; }
    
    // Aumentado limite de 10.0 para 50.0
    return clamp(baseColor * uSkyIntensity, 0.0, 50.0);
}

// --- ReSTIR HELPER: Calcula Luminância ---
float getLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec4 litColor = texture2D(tColor, vUv);
    vec4 albedoColor = texture2D(tAlbedo, vUv);
    float depth = texture2D(tDepth, vUv).r;
    vec3 normal = texture2D(tNormal, vUv).rgb * 2.0 - 1.0;
    vec3 viewPos = getViewPos(vUv, depth);
    vec3 viewDir = normalize(viewPos);
    
    vec4 matData = texture2D(tData, vUv);
    float roughness = clamp(matData.r, 0.0, 1.0);   
    float metalness = clamp(matData.g, 0.0, 1.0);   
    float emission = clamp(matData.b, 0.0, 1.0);     

    // --- BACKGROUND ---
    if (depth >= 0.999) {
        vec4 prev = texture2D(tAccum, vUv);
        vec3 worldDir = normalize((cameraViewMatrixInv * vec4(viewPos, 0.0)).xyz);
        vec3 finalBg;
        if (uUseSkybox > 0.5) finalBg = getSkyColor(worldDir);
        else finalBg = mix(uSkyColor * uSkyIntensity, litColor.rgb, litColor.a);

        if (prev.a < 0.5 || any(isinf(prev.rgb))) prev = vec4(finalBg, 1.0);
        
        // Blend temporal mais rápido para background
        float blend = min(0.2, 1.0 / (frame + 1.0));
        gl_FragColor = mix(prev, vec4(finalBg, 1.0), blend);
        return;
    }

    if (length(normal) < 0.1) normal = vec3(0.0, 1.0, 0.0);

    // =========================================================
    // 1. CÁLCULO DE SSAO (SCREEN SPACE AMBIENT OCCLUSION)
    // =========================================================
    float occlusion = 0.0;
    
    // Bias adaptativo baseado na distância
    float adaptiveBias = uAoBias * (1.0 + abs(viewPos.z) * 0.01);
    
    for (int i = 0; i < AO_SAMPLES; i++) {
        // Gera amostra na semiesfera com melhor distribuição
        vec3 sampleDir = randomHemisphereVector(normal, vUv, float(i) * 7.919);
        
        // Posiciona a amostra a partir do pixel atual
        vec3 samplePos = viewPos + sampleDir * uAoRadius; 
        
        // Projeta de volta para a tela (UV)
        vec4 offset = cameraProjectionMatrix * vec4(samplePos, 1.0);
        vec2 offsetUV = (offset.xy / offset.w) * 0.5 + 0.5;
        
        // Verifica se UV está na tela
        if (offsetUV.x >= 0.0 && offsetUV.x <= 1.0 && offsetUV.y >= 0.0 && offsetUV.y <= 1.0) {
            // Pega profundidade real naquele ponto
            float sampleDepthBuffer = texture2D(tDepth, offsetUV).r;
            vec3 actualPos = getViewPos(offsetUV, sampleDepthBuffer);
            float actualDepth = actualPos.z;
            
            // Valida normais para evitar false positives
            vec3 sampleNormal = texture2D(tNormal, offsetUV).rgb * 2.0 - 1.0;
            float normalCheck = dot(sampleNormal, normal);
            
            // Verifica oclusão com validação de normais
            if (actualDepth >= samplePos.z + adaptiveBias && normalCheck > -0.5) {
                // Range check melhorado
                float distance = abs(viewPos.z - actualDepth);
                float rangeCheck = smoothstep(uAoRadius * 2.0, 0.0, distance);
                occlusion += rangeCheck;
            }
        }
    }
    
    occlusion = 1.0 - (occlusion / float(AO_SAMPLES));
    // Aplica força com curve mais suave
    occlusion = pow(occlusion, max(0.5, uAoStrength));

    // =========================================================
    // 2. SKYLIGHT AMBIENTE (NOVO!)
    // =========================================================
    // Calcula iluminação ambiente do céu baseada na normal
    vec3 worldNormal = normalize((cameraViewMatrixInv * vec4(normal, 0.0)).xyz);
    vec3 skylightColor = getSkyColor(worldNormal);
    
    // Aplica AO ao skylight de forma suave
    vec3 ambientLight = skylightColor * albedoColor.rgb * mix(occlusion, 1.0, 0.5);

    // =========================================================
    // 3. CÁLCULO DE GI (RAYMARCHING) COM ReSTIR
    // =========================================================
    
    // Configuração inicial do raio
    vec3 randVec = randomHemisphereVector(normal, vUv, 100.0);
    vec3 targetDiffuse = normalize(normal + randVec);
    vec3 targetSpecular = reflect(viewDir, normal);
    
    float mixingFactor = roughness * roughness;
    if (roughness < 0.05) mixingFactor = 0.0; 
    
    vec3 rayDir = normalize(mix(targetSpecular, targetDiffuse, mixingFactor));
    if (dot(rayDir, normal) < 0.0) rayDir = targetDiffuse;

    // --- ReSTIR: RESAMPLED IMPORTANCE SAMPLING (RIS) ---
    // Em vez de usar apenas um raio aleatório, geramos candidatos e escolhemos o melhor
    // baseado na iluminação incidente estimada (Skybox).
    if (uEnableRestir > 0.5) {
        vec3 selectedDir = rayDir;
        float wSum = 0.0;
        float selectedPdf = 0.0;
        
        for (int k = 0; k < RIS_CANDIDATES; k++) {
            // Gera candidato
            vec3 candidateRand = randomHemisphereVector(normal, vUv, float(k) * 13.5 + frame * 0.1);
            vec3 candidateDiffuse = normalize(normal + candidateRand);
            vec3 candidateDir = normalize(mix(targetSpecular, candidateDiffuse, mixingFactor));
            if (dot(candidateDir, normal) < 0.0) candidateDir = candidateDiffuse;

            // Avalia importância (Target PDF)
            // Converte para world space para amostrar a skybox
            vec3 candidateWorld = normalize((cameraViewMatrixInv * vec4(candidateDir, 0.0)).xyz);
            vec3 skySample = getSkyColor(candidateWorld);
            float luminance = getLuminance(skySample) + 0.01; // +0.01 evita zero
            
            // Peso geométrico (Cosine term)
            float NdotL = max(0.001, dot(normal, candidateDir));
            
            // Peso final do candidato (p_hat)
            float weight = luminance * NdotL;
            
            // Stream Reservoir Sampling (WRS)
            wSum += weight;
            float r = hash(vUv * (frame + float(k) * 3.14));
            if (r < (weight / wSum)) {
                selectedDir = candidateDir;
                selectedPdf = weight; // Aproximação da PDF
            }
        }
        
        // Se encontramos algo válido, atualizamos o raio e compensamos a energia
        if (wSum > 0.001) {
            rayDir = selectedDir;
            // O fator de normalização seria aplicado aqui, mas como estamos acumulando
            // temporalmente, deixamos a integração Monte Carlo resolver a média.
            // No entanto, o ReSTIR garante que os raios "importantes" sejam traçados com mais frequência.
        }
    }
    
    vec3 rayDirWorld = normalize((cameraViewMatrixInv * vec4(rayDir, 0.0)).xyz);
    vec3 hitColor = getSkyColor(rayDirWorld); 
    
    vec3 marchPos = viewPos + (normal * 0.05); 
    
    // Jitter melhorado com blue noise
    vec2 blueNoise = hash2(vUv * frame * 7.919);
    float jitter = blueNoise.x * 0.8; 
    
    float currentDist = 0.0;
    
    // Step size constante para evitar pular geometria
    float baseStepSize = 0.08 + (length(viewPos) * 0.02);  // Reduzido de 0.03 para 0.02
    vec3 stepVec = rayDir * baseStepSize;
    marchPos += stepVec * jitter; 
    
    float accumulatedFade = 0.0; 
    bool hitFound = false;

    if (uGiIntensity > 0.001) {
        for(int i = 0; i < GI_SAMPLES; i++) {
            marchPos += stepVec;
            currentDist += length(stepVec);
            if(currentDist > MAX_DIST) break; 

            vec4 projected = cameraProjectionMatrix * vec4(marchPos, 1.0);
            vec2 sampleUV = (projected.xy / projected.w) * 0.5 + 0.5;

            if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
                accumulatedFade = 0.0; break;
            }

            float bufferDepth = texture2D(tDepth, sampleUV).r;
            float rayDepth = projected.z / projected.w;
            float linearZRay = projected.w; 
            
            // Thickness adaptativo mais conservador
            float thickness = 0.05 + (linearZRay * 0.008); 
            float depthDiff = (rayDepth * 0.5 + 0.5) - bufferDepth;

            // Valida direção do hit com a normal da superfície
            vec3 hitNormal = texture2D(tNormal, sampleUV).rgb * 2.0 - 1.0;
            float normalDot = dot(rayDir, hitNormal);
            
            if (depthDiff > 0.0 && depthDiff < thickness && normalDot < 0.3) { 
                vec3 rawColor;
                if (frame > 1.0) {
                    rawColor = texture2D(tAccum, sampleUV).rgb;
                } else {
                    vec3 direct = texture2D(tColor, sampleUV).rgb;
                    vec3 albedoHit = texture2D(tAlbedo, sampleUV).rgb;
                    
                    // NOVO: Adiciona skylight ao hit inicial
                    vec3 hitWorldNormal = normalize((cameraViewMatrixInv * vec4(hitNormal, 0.0)).xyz);
                    vec3 hitSkylight = getSkyColor(hitWorldNormal) * albedoHit * 0.8;
                    
                    rawColor = direct + hitSkylight;
                }
                rawColor = sanitize(rawColor);
                
                // Emissão controlada mas menos agressiva
                float hitEmission = texture2D(tData, sampleUV).b;
                if(hitEmission > 0.0) {
                    // Multiplicador aumentado de 2.5x para 4.0x
                    float emissionBoost = 1.0 + (hitEmission * 4.0);
                    rawColor *= emissionBoost;
                    // Clamp menos agressivo
                    rawColor = clamp(rawColor, 0.0, 30.0);  // Aumentado de 15.0 para 30.0
                }
                
                hitColor = rawColor;
                accumulatedFade = screenFade(sampleUV);
                hitFound = true;
                break; 
            }
            
            // Step size cresce mais devagar
            stepVec *= 1.05;  // Reduzido de 1.08 para 1.05
        }
    }

    // IMPORTANTE: Sempre mistura com skylight, mesmo quando há hit
    vec3 skyContribution = getSkyColor(rayDirWorld) * (1.0 - accumulatedFade * 0.7);
    hitColor = hitColor * accumulatedFade + skyContribution;
    
    if (length(hitColor) > 50.0) hitColor = normalize(hitColor) * 50.0;  // Aumentado de 20.0

    // =========================================================
    // 4. COMBINAÇÃO FINAL (Lighting + GI + AO + SKYLIGHT)
    // =========================================================

    // Cálculo PBR melhorado para o bounce
    float NdotV = max(0.001, dot(-viewDir, normal));
    float fresnel = pow(1.0 - NdotV, 5.0);
    
    // Fresnel considera roughness
    fresnel *= (1.0 - roughness * 0.9); 
    
    vec3 F0 = mix(vec3(0.04), albedoColor.rgb, metalness);
    vec3 F = F0 + (vec3(1.0) - F0) * fresnel;
    
    vec3 diffuseBounce = hitColor * albedoColor.rgb; 
    vec3 specularBounce = hitColor; 

    vec3 finalGI;
    
    // Transição suave de metalness
    float metallicBlend = smoothstep(0.7, 1.0, metalness);
    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallicBlend);
    
    finalGI = (kD * diffuseBounce + kS * specularBounce);
    
    // Aplica conservação de energia (menos agressiva agora)
    finalGI *= ENERGY_CONSERVATION;
    
    // Aplica intensidade de GI
    finalGI *= uGiIntensity;
    
    // Emissão controlada na superfície atual
    if (emission > 0.0) {
        // Multiplicador aumentado
        vec3 emissiveContrib = albedoColor.rgb * emission * 5.0;  // Aumentado de 3.0
        finalGI += clamp(emissiveContrib, 0.0, 20.0);  // Aumentado de 10.0
    }
    
    // NOVO: Combina Luz Direta + Skylight Ambiente + GI
    vec3 combinedColor = litColor.rgb + ambientLight * 0.6 + finalGI;
    
    // APLICA O AO de forma mais suave - NÃO afeta skylight fortemente
    if (emission <= 0.01) {
        // AO só afeta 50% da luz direta e 30% do GI
        // Skylight ambiente passa quase totalmente
        vec3 directWithAO = litColor.rgb * mix(1.0, occlusion, 0.5);
        vec3 giWithAO = finalGI * mix(1.0, occlusion, 0.3);
        
        combinedColor = directWithAO + ambientLight * mix(1.0, occlusion, 0.2) + giWithAO;
    }

    combinedColor = sanitize(combinedColor);

    vec4 prevColor = texture2D(tAccum, vUv);
    if (frame < 1.0) prevColor = vec4(0.0);
    
    // Blend temporal adaptativo
    float blendFactor;
    if (frame < 10.0) {
        blendFactor = 1.0 / (frame + 1.0);
    } else if (frame < 30.0) {
        blendFactor = 0.15;
    } else {
        blendFactor = 0.08;
    }
    
    gl_FragColor = mix(prevColor, vec4(combinedColor, 1.0), blendFactor);
}
`;

const OUTPUT_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMap;
uniform sampler2D tBloom;
uniform float exposure;
uniform float bloomStrength;

vec3 ACESFilmic(vec3 x) {
    float a = 2.51; float b = 0.03; float c = 2.43; float d = 0.59; float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec4 hdrColor = texture2D(tMap, vUv);
    vec4 bloomColor = texture2D(tBloom, vUv);
    vec3 safeBloom = clamp(bloomColor.rgb, 0.0, 20.0); 
    vec3 finalColor = hdrColor.rgb + (safeBloom * bloomStrength);
    vec3 mapped = finalColor * exposure;
    mapped = ACESFilmic(mapped);
    mapped = pow(mapped, vec3(1.0 / 2.2));
    gl_FragColor = vec4(mapped, 1.0);
}
`;

// =========================================================
// 2. SETUP
// =========================================================

const bakingBtn = document.getElementById("baking");
const renderAnimBtn = document.getElementById("render-anim");
const irisCanvas = document.getElementById("renderCanvas2");

irisCanvas.style.display = "none";
irisCanvas.style.pointerEvents = "none"; 

const context = irisCanvas.getContext('webgl2', { alpha: true, antialias: false, depth: true });
const irisRenderer = new THREE.WebGLRenderer({ canvas: irisCanvas, context: context, alpha: true });

irisRenderer.setSize(window.innerWidth, window.innerHeight);
irisRenderer.setPixelRatio(1);
irisRenderer.shadowMap.enabled = true;
irisRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

const size = new THREE.Vector2();
irisRenderer.getSize(size);

const bufferOptions = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat };

// --- RENDER TARGETS ---
const rtColor = new THREE.WebGLRenderTarget(size.x, size.y, bufferOptions);
rtColor.depthTexture = new THREE.DepthTexture(); 
rtColor.depthTexture.type = THREE.UnsignedShortType; 

const rtAlbedo = new THREE.WebGLRenderTarget(size.x, size.y, bufferOptions);
const rtNormal = new THREE.WebGLRenderTarget(size.x, size.y, { ...bufferOptions, type: THREE.HalfFloatType });
const rtData = new THREE.WebGLRenderTarget(size.x, size.y, { ...bufferOptions, type: THREE.FloatType });
const rtAccumA = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType });
const rtAccumB = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.FloatType });
const rtShadowPass = new THREE.WebGLRenderTarget(1, 1);

// --- LOAD TEXTURE SKYBOX ---
let skyboxTexture = null;
if (SKY_OPTIONS.mode === 'texture' && SKY_OPTIONS.textureUrl) {
    new THREE.TextureLoader().load(SKY_OPTIONS.textureUrl, (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        skyboxTexture = tex;
        if(isBakingActive) currentFrame = 0;
        console.log("Skybox carregado.");
    });
}

// --- BLOOM SETUP ---
let bloomMips = [];
function initBloomTargets(width, height) {
    bloomMips.forEach(mip => mip.dispose());
    bloomMips = [];
    let w = width; let h = height;
    for (let i = 0; i < BLOOM_MIPS; i++) {
        w = Math.round(w / 2); h = Math.round(h / 2);
        if (w < 2) w = 2; if (h < 2) h = 2;
        const target = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat, type: THREE.HalfFloatType
        });
        bloomMips.push(target);
    }
}
initBloomTargets(size.x, size.y);

const bloomHighPassMat = new THREE.ShaderMaterial({
    vertexShader: SSGI_VERTEX_SHADER, fragmentShader: BLOOM_HIGHPASS_FRAGMENT,
    uniforms: { 
        tMap: { value: null }, 
        tNormal: { value: null }, 
        tData: { value: null },
        threshold: { value: BLOOM_THRESHOLD } 
    },
    depthTest: false, depthWrite: false
});
const bloomDownMat = new THREE.ShaderMaterial({
    vertexShader: SSGI_VERTEX_SHADER, fragmentShader: BLOOM_DOWNSAMPLE_FRAGMENT,
    uniforms: { tMap: { value: null }, resolution: { value: new THREE.Vector2() } },
    depthTest: false, depthWrite: false
});
const bloomUpMat = new THREE.ShaderMaterial({
    vertexShader: SSGI_VERTEX_SHADER, fragmentShader: BLOOM_UPSAMPLE_FRAGMENT,
    uniforms: { tMap: { value: null }, resolution: { value: new THREE.Vector2() }, radius: { value: BLOOM_RADIUS } },
    depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending 
});

// --- CENAS AUXILIARES ---
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadGeometry = new THREE.PlaneGeometry(2, 2);
const quadScene = new THREE.Scene();

const ssgiMaterial = new THREE.ShaderMaterial({
    vertexShader: SSGI_VERTEX_SHADER,
    fragmentShader: SSGI_FRAGMENT_SHADER,
    uniforms: {
        tColor: { value: null },
        tAlbedo: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        tAccum: { value: null },
        tData: { value: null },
        tSkyboxMap: { value: null }, 
        
        cameraProjectionMatrix: { value: new THREE.Matrix4() },
        cameraProjectionMatrixInv: { value: new THREE.Matrix4() },
        cameraViewMatrixInv: { value: new THREE.Matrix4() },
        resolution: { value: size },
        frame: { value: 0 },
        uSkyColor: { value: new THREE.Color(0x000000) }, 
        uGiIntensity: { value: GI_INTENSITY },
        uUseSkybox: { value: 0.0 },
        uEnableRestir: { value: ENABLE_RESTIR ? 1.0 : 0.0 }, // Passa o valor para o shader
        
        uSkyIntensity: { value: SKY_OPTIONS.intensity },
        uAoStrength: { value: AO_OPTIONS.strength },
        uAoRadius: { value: AO_OPTIONS.radius },
        uAoBias: { value: AO_OPTIONS.bias },

        uUnityTop: { value: new THREE.Color(SKY_OPTIONS.unityColors.top) },
        uUnityHorizon: { value: new THREE.Color(SKY_OPTIONS.unityColors.horizon) },
        uUnityBottom: { value: new THREE.Color(SKY_OPTIONS.unityColors.bottom) }
    },
    depthWrite: false, depthTest: false
});
const quad = new THREE.Mesh(quadGeometry, ssgiMaterial);
quadScene.add(quad);

const outputScene = new THREE.Scene();
const outputMaterial = new THREE.ShaderMaterial({
    vertexShader: SSGI_VERTEX_SHADER, fragmentShader: OUTPUT_FRAGMENT_SHADER,
    uniforms: { tMap: { value: null }, tBloom: { value: null }, exposure: { value: 1.0 }, bloomStrength: { value: BLOOM_STRENGTH } },
    depthWrite: false, depthTest: false
});
const outputQuad = new THREE.Mesh(quadGeometry, outputMaterial);
outputScene.add(outputQuad);

const bloomQuad = new THREE.Mesh(quadGeometry, bloomHighPassMat); 
const bloomScene = new THREE.Scene();
bloomScene.add(bloomQuad);

const albedoLight = new THREE.AmbientLight(0xffffff, 1.5);

// --- ESTADOS GLOBAIS ---
let isBakingActive = false;
let currentFrame = 0; 
const TOTAL_FRAMES = 50; 
let renderLoopId = null;
let lastCameraMatrix = new THREE.Matrix4();

// =========================================================
// 3. EVENTOS
// =========================================================

if (bakingBtn) {
    bakingBtn.addEventListener("click", () => {
        isBakingActive = !isBakingActive;
        if (isBakingActive) {
            console.log("Baking: ATIVADO");
            irisCanvas.style.display = "block";
            prepareSceneForRender(); 
            startRenderLoop();
        } else {
            console.log("Baking: DESATIVADO");
            stopRenderLoop();
        }
    });
}

if (renderAnimBtn) {
    renderAnimBtn.addEventListener("click", () => {
        if(typeof VideoRenderer !== 'undefined') VideoRenderer.startExport();
        else console.error("VideoRenderer não carregado.");
    });
}

window.addEventListener('resize', () => {
    irisRenderer.setSize(window.innerWidth, window.innerHeight);
    const newSize = new THREE.Vector2();
    irisRenderer.getSize(newSize);
    
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    rtColor.setSize(newSize.x, newSize.y);
    rtAlbedo.setSize(newSize.x, newSize.y);
    rtNormal.setSize(newSize.x, newSize.y);
    rtData.setSize(newSize.x, newSize.y);
    rtAccumA.setSize(newSize.x, newSize.y);
    rtAccumB.setSize(newSize.x, newSize.y);
    
    initBloomTargets(newSize.x, newSize.y);
    ssgiMaterial.uniforms.resolution.value = newSize;
    if(isBakingActive) currentFrame = 0; 
});

// =========================================================
// 4. ENGINE E CONTROLE
// =========================================================

function halton(index, base) {
    let result = 0; let f = 1 / base; let i = index;
    while (i > 0) { result = result + f * (i % base); i = Math.floor(i / base); f = f / base; }
    return result;
}

function startRenderLoop() {
    currentFrame = 0;
    irisRenderer.setRenderTarget(rtAccumA); irisRenderer.clear();
    irisRenderer.setRenderTarget(rtAccumB); irisRenderer.clear();
    bloomMips.forEach(mip => { irisRenderer.setRenderTarget(mip); irisRenderer.clear(); });
    lastCameraMatrix.copy(camera.matrixWorld);
    if (renderLoopId) cancelAnimationFrame(renderLoopId);
    progressiveLoop();
}

function stopRenderLoop() {
    if (renderLoopId) { cancelAnimationFrame(renderLoopId); renderLoopId = null; }
    isBakingActive = false;
    restoreScene(); 
    irisCanvas.style.display = "none";
    if (camera.view) camera.clearViewOffset();
}

function renderBloom(sourceTexture) {
    if (!ENABLE_BLOOM) return null;
    bloomQuad.material = bloomHighPassMat;
    bloomHighPassMat.uniforms.tMap.value = sourceTexture;
    bloomHighPassMat.uniforms.tNormal.value = rtNormal.texture;
    bloomHighPassMat.uniforms.tData.value = rtData.texture;
    bloomHighPassMat.uniforms.threshold.value = BLOOM_THRESHOLD;
    
    irisRenderer.setRenderTarget(bloomMips[0]);
    irisRenderer.render(bloomScene, orthoCamera);

    bloomQuad.material = bloomDownMat;
    for (let i = 0; i < bloomMips.length - 1; i++) {
        const source = bloomMips[i]; const dest = bloomMips[i + 1];
        bloomDownMat.uniforms.tMap.value = source.texture;
        bloomDownMat.uniforms.resolution.value.set(source.width, source.height);
        irisRenderer.setRenderTarget(dest);
        irisRenderer.render(bloomScene, orthoCamera);
    }

    bloomQuad.material = bloomUpMat;
    for (let i = bloomMips.length - 1; i > 0; i--) {
        const source = bloomMips[i]; const dest = bloomMips[i - 1];
        bloomUpMat.uniforms.tMap.value = source.texture;
        bloomUpMat.uniforms.resolution.value.set(source.width, source.height);
        irisRenderer.setRenderTarget(dest);
        irisRenderer.render(bloomScene, orthoCamera);
    }
    return bloomMips[0].texture;
}

function progressiveLoop() {
    if (!isBakingActive) return;
    if (!camera.matrixWorld.equals(lastCameraMatrix)) {
        currentFrame = 0;
        lastCameraMatrix.copy(camera.matrixWorld);
    }

    if (currentFrame === 0) {
        irisRenderer.setRenderTarget(rtAccumA); irisRenderer.clearColor();
        irisRenderer.setRenderTarget(rtAccumB); irisRenderer.clearColor();
    }

    if (currentFrame < TOTAL_FRAMES) {
        if (ENABLE_ANTIALIAS && currentFrame > 0) {
            const width = size.x; const height = size.y;
            const jitterX = (halton(currentFrame, 2) - 0.5);
            const jitterY = (halton(currentFrame, 3) - 0.5);
            camera.setViewOffset(width, height, jitterX, jitterY, width, height);
        } else {
            camera.clearViewOffset();
        }

        let targetSky = new THREE.Color();
        let useTex = 0.0; 

        if (SKY_OPTIONS.mode === 'unity') {
            useTex = 2.0;
            targetSky.setHex(0xffffff);
            ssgiMaterial.uniforms.uUnityTop.value.setHex(SKY_OPTIONS.unityColors.top);
            ssgiMaterial.uniforms.uUnityHorizon.value.setHex(SKY_OPTIONS.unityColors.horizon);
            ssgiMaterial.uniforms.uUnityBottom.value.setHex(SKY_OPTIONS.unityColors.bottom);
        }
        else if (SKY_OPTIONS.mode === 'texture' && skyboxTexture) {
            useTex = 1.0; targetSky.setHex(0xffffff); 
        } 
        else if (SKY_OPTIONS.mode === 'color') {
            targetSky.setHex(SKY_OPTIONS.customColor);
        }
        else if (scene.background && scene.background.isColor) targetSky.copy(scene.background);
        else targetSky.copy(SKY_COLOR_FALLBACK);
        
        ssgiMaterial.uniforms.uSkyColor.value.copy(targetSky);
        ssgiMaterial.uniforms.uGiIntensity.value = ENABLE_GI ? GI_INTENSITY : 0.0;
        ssgiMaterial.uniforms.uUseSkybox.value = useTex;
        ssgiMaterial.uniforms.uEnableRestir.value = ENABLE_RESTIR ? 1.0 : 0.0; // Atualiza uniform
        
        ssgiMaterial.uniforms.uSkyIntensity.value = SKY_OPTIONS.intensity;
        ssgiMaterial.uniforms.uAoStrength.value = AO_OPTIONS.strength;
        ssgiMaterial.uniforms.uAoRadius.value = AO_OPTIONS.radius;
        ssgiMaterial.uniforms.uAoBias.value = AO_OPTIONS.bias;
        
        if (useTex > 0.5 && useTex < 1.5) ssgiMaterial.uniforms.tSkyboxMap.value = skyboxTexture;

        // =========================================================
        // JITTER DETERMINÍSTICO (HALTON) + BLUR SUAVE (PCF)
        // =========================================================
        
        tempLights.forEach((light, idx) => {
            if(light.userData.softness > 0) {
                const soft = light.userData.softness;
                // Bases primas diferentes + stratification
                const baseOffset = idx * 13.719; // Prima para cada luz
                const ox = (halton(currentFrame + baseOffset, 2) - 0.5) * soft;
                const oy = (halton(currentFrame + baseOffset, 3) - 0.5) * soft;
                const oz = (halton(currentFrame + baseOffset, 5) - 0.5) * soft;

                light.position.set(
                    light.userData.originalPos.x + ox, 
                    light.userData.originalPos.y + oy, 
                    light.userData.originalPos.z + oz
                );
                
                // Radius adaptativo baseado em softness
                light.shadow.radius = 1.5 + (soft * 0.5); 
            }
        });

        // Passo de Sombra
        irisRenderer.shadowMap.autoUpdate = true;
        irisRenderer.setRenderTarget(rtShadowPass);
        irisRenderer.render(scene, camera);

        // Restaura as luzes para a posição ORIGINAL
        tempLights.forEach(light => {
            if(light.userData.softness > 0) {
                light.position.copy(light.userData.originalPos);
            }
        });

        // Desativa a atualização de sombras para o render final
        irisRenderer.shadowMap.autoUpdate = false;

        // =========================================================
        // RENDER DE DADOS (Albedo, Normal, Data)
        // =========================================================

        const lightsVisibility = new Map();
        scene.traverse(obj => { if(obj.isLight) { lightsVisibility.set(obj, obj.visible); obj.visible = false; } });
        scene.add(albedoLight);
        irisRenderer.setRenderTarget(rtAlbedo); irisRenderer.clear(); irisRenderer.render(scene, camera);
        scene.remove(albedoLight);
        lightsVisibility.forEach((visible, obj) => { obj.visible = visible; });

        // =========================================================
        // RENDER COLOR (Lighting Pass)
        // =========================================================
        
        irisRenderer.setRenderTarget(rtColor);
        const clearCol = targetSky.clone().multiplyScalar(SKY_OPTIONS.intensity);
        irisRenderer.setClearColor(clearCol, useTex > 0.5 ? 0.0 : 1.0); 
        irisRenderer.clear(); 
        irisRenderer.render(scene, camera);
        
        // =========================================================
        // OUTROS PASSOS
        // =========================================================
        
        irisRenderer.setRenderTarget(rtNormal);
        irisRenderer.setClearColor(new THREE.Color(0,0,0), 0); irisRenderer.clear();
        
        const originalMatsNorm = new Map();
        const processNormals = (obj) => {
            if (isIgnored(obj)) return; 
            if (obj.isMesh && obj.material) {
                originalMatsNorm.set(obj, obj.material);
                const isFlat = obj.material.flatShading === true;
                obj.material = new THREE.MeshNormalMaterial({ flatShading: isFlat });
            }
        };
        scene.traverse(processNormals); camera.traverse(processNormals);
        irisRenderer.render(scene, camera);
        scene.traverse(obj => { if (originalMatsNorm.has(obj)) obj.material = originalMatsNorm.get(obj); });
        camera.traverse(obj => { if (originalMatsNorm.has(obj)) obj.material = originalMatsNorm.get(obj); });

        const originalMatsData = new Map();
        const processData = (obj) => {
            if (isIgnored(obj)) return;
            if (obj.isMesh && obj.material) {
                originalMatsData.set(obj, obj.material);
                const r = obj.material.rayroughness !== undefined ? obj.material.rayroughness : 0.5;
                const m = obj.material.raymetalness !== undefined ? obj.material.raymetalness : 0.0;
                const e = obj.material.rayemission !== undefined ? obj.material.rayemission : 0.0;
                const refl = obj.material.rayreflection !== undefined ? obj.material.rayreflection : 0.5;
                const isFlat = obj.material.flatShading === true;
                const dataMat = new THREE.ShaderMaterial({
                    vertexShader: SSGI_VERTEX_SHADER, fragmentShader: DATA_FRAGMENT_SHADER,
                    uniforms: { uRoughness: { value: r }, uMetalness: { value: m }, uEmission: { value: e }, uReflection: { value: refl } },
                    flatShading: isFlat
                });
                obj.material = dataMat;
            }
        };
        scene.traverse(processData); camera.traverse(processData);
        irisRenderer.setRenderTarget(rtData); irisRenderer.clear(); irisRenderer.render(scene, camera);
        scene.traverse(obj => { if (originalMatsData.has(obj)) obj.material = originalMatsData.get(obj); });
        camera.traverse(obj => { if (originalMatsData.has(obj)) obj.material = originalMatsData.get(obj); });

        const writeBuffer = currentFrame % 2 === 0 ? rtAccumA : rtAccumB;
        const readBuffer = currentFrame % 2 === 0 ? rtAccumB : rtAccumA;

        ssgiMaterial.uniforms.tColor.value = rtColor.texture;
        ssgiMaterial.uniforms.tAlbedo.value = rtAlbedo.texture;
        ssgiMaterial.uniforms.tDepth.value = rtColor.depthTexture; 
        ssgiMaterial.uniforms.tNormal.value = rtNormal.texture;
        ssgiMaterial.uniforms.tData.value = rtData.texture; 
        ssgiMaterial.uniforms.tAccum.value = readBuffer.texture;
        ssgiMaterial.uniforms.frame.value = currentFrame;
        
        ssgiMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
        ssgiMaterial.uniforms.cameraProjectionMatrixInv.value.copy(camera.projectionMatrix).invert();
        ssgiMaterial.uniforms.cameraViewMatrixInv.value.copy(camera.matrixWorld);

        irisRenderer.setRenderTarget(writeBuffer); irisRenderer.render(quadScene, orthoCamera);
        if (ENABLE_ANTIALIAS) camera.clearViewOffset();
        currentFrame++;
    }

    const accumBuffer = (currentFrame % 2 === 0) ? rtAccumB : rtAccumA; 
    const bloomTexture = renderBloom(accumBuffer.texture);
    
    irisRenderer.setRenderTarget(null); irisRenderer.clear(); 
    outputMaterial.uniforms.tMap.value = accumBuffer.texture;
    outputMaterial.uniforms.tBloom.value = bloomTexture;
    outputMaterial.uniforms.exposure.value = 1.0; 
    outputMaterial.uniforms.bloomStrength.value = BLOOM_STRENGTH;
    irisRenderer.render(outputScene, orthoCamera);

    renderLoopId = requestAnimationFrame(progressiveLoop);
}

// =========================================================
// 5. HELPERS
// =========================================================

let originalState = new Map();
let tempLights = [];

function isIgnored(obj) {
    if (!obj) return true;
    if (obj.name === 'Main Camera') return true;
    if (obj.isTransformControlsGizmo || obj.type === 'TransformControlsGizmo') return true;
    if (obj.type === 'GridHelper' || obj.isGridHelper) return true; 
    let parent = obj.parent;
    while(parent) {
        if (parent.name === 'Main Camera') return true;
        if (parent.isTransformControlsGizmo || parent.type === 'TransformControlsGizmo' || parent.type === 'TransformControls') return true;
        parent = parent.parent;
    }
    return false;
}

function processObjectForRender(obj) {
    if (originalState.has(obj)) return;
    if (isIgnored(obj)) { if (obj.visible) { originalState.set(obj, { type: 'helper', visible: true }); obj.visible = false; } return; }

    if (obj.isLight) {
        originalState.set(obj, { type: 'light', visible: obj.visible }); obj.visible = false;
    }
    else if (obj.isMesh) {
        originalState.set(obj, { type: 'mesh', castShadow: obj.castShadow, receiveShadow: obj.receiveShadow, shadowSide: obj.material ? obj.material.shadowSide : null });
        obj.receiveShadow = true; obj.castShadow = true;
        const isFlat = obj.geometry && (obj.geometry.type.includes("Plane") || obj.geometry.type.includes("Circle") || obj.geometry.type.includes("Ring"));
        if (!isFlat) { if(obj.material) obj.material.shadowSide = THREE.BackSide; }
    }
}

function prepareSceneForRender() {
    scene.traverse(processObjectForRender); camera.traverse(processObjectForRender);
    const setupLight = (l) => {
        l.castShadow = true; 
        l.shadow.bias = -0.00005; 
        l.shadow.normalBias = 0.0; 
        l.shadow.mapSize.set(4096, 4096); 
        l.shadow.radius = 1; 
        if (l.shadow && l.shadow.camera) {
            const camSize = 30; 
            l.shadow.camera.left = -camSize; 
            l.shadow.camera.right = camSize;
            l.shadow.camera.top = camSize; 
            l.shadow.camera.bottom = -camSize; 
            l.shadow.camera.near = 0.1; 
            l.shadow.camera.far = 100;
            l.shadow.camera.updateProjectionMatrix();
        }
    };
    if (window.ray_lights && window.ray_lights.length > 0) {
        window.ray_lights.forEach(rayLight => {
            if (!rayLight.object) return;
            if(!originalState.has(rayLight.object)) originalState.set(rayLight.object, { type: 'light_source_mesh', visible: rayLight.object.visible });
            
            rayLight.object.visible = false;
            rayLight.object.updateMatrixWorld(true);
            const worldPos = new THREE.Vector3(); rayLight.object.getWorldPosition(worldPos);

            const isDirectional = rayLight.type === 'directional' || (rayLight.object && rayLight.object.userData.type === 'directional');
            let l;

            if (isDirectional) {
                l = new THREE.DirectionalLight(rayLight.color, rayLight.intensity * LIGHT_INTENSITY_FACTOR);
                l.position.copy(worldPos);
                
                const direction = new THREE.Vector3(0, 0, -1);
                direction.applyQuaternion(rayLight.object.quaternion);
                
                l.target.position.copy(worldPos).add(direction);
                scene.add(l.target);
                l.userData.hasTarget = true; 
            } else {
                l = new THREE.PointLight(rayLight.color, rayLight.intensity * LIGHT_INTENSITY_FACTOR);
                l.position.copy(worldPos);
                
                let range = 0;
                if (rayLight.range !== undefined) range = rayLight.range;
                else if (rayLight.object && rayLight.object.userData.range !== undefined) range = rayLight.object.userData.range;
                
                l.distance = range;
            }

            l.userData.originalPos = worldPos.clone();
            l.userData.softness = rayLight.shadowSoftness !== undefined ? rayLight.shadowSoftness : 0.0;
            
            if (rayLight.castShadow) setupLight(l);
            scene.add(l); tempLights.push(l);
        });
    }
}

function restoreScene() {
    tempLights.forEach(l => {
        scene.remove(l);
        if (l.userData.hasTarget && l.target) {
            scene.remove(l.target);
        }
    }); 
    tempLights = []; 
    scene.remove(albedoLight);
    originalState.forEach((state, obj) => {
        if (state.type === 'mesh') { obj.castShadow = state.castShadow; obj.receiveShadow = state.receiveShadow; if(obj.material && state.shadowSide !== undefined) obj.material.shadowSide = state.shadowSide; } 
        else obj.visible = state.visible;
    });
    originalState.clear();
    if (camera.clearViewOffset) camera.clearViewOffset();
}

class MiniMuxer {
    constructor(width, height) {
        this.width = width; this.height = height; this.chunks = []; this.samples = []; this.totalSize = 0; this.timeScale = 30000; this.avcConfig = null;
    }
    addVideoChunk(chunk, meta, duration) {
        const buffer = new Uint8Array(chunk.byteLength); chunk.copyTo(buffer);
        if (meta && meta.decoderConfig && meta.decoderConfig.description) this.avcConfig = new Uint8Array(meta.decoderConfig.description);
        this.samples.push({ size: buffer.byteLength, duration: duration, isKeyframe: chunk.type === 'key' });
        this.chunks.push(buffer); this.totalSize += buffer.byteLength;
    }
    finalize() {
        if (!this.avcConfig) return null;
        const ftyp = this.createFtypBox(); const mdatSize = 8 + this.totalSize; const moov = this.createMoovBox();
        const finalSize = ftyp.byteLength + mdatSize + moov.byteLength;
        const finalBuffer = new Uint8Array(finalSize); let offset = 0;
        finalBuffer.set(ftyp, offset); offset += ftyp.byteLength;
        const mdatHeader = new Uint8Array(8); new DataView(mdatHeader.buffer).setUint32(0, mdatSize); mdatHeader.set([109, 100, 97, 116], 4); 
        finalBuffer.set(mdatHeader, offset); offset += 8;
        for (const chunk of this.chunks) { finalBuffer.set(chunk, offset); offset += chunk.byteLength; }
        finalBuffer.set(moov, offset); return new Blob([finalBuffer], { type: 'video/mp4' });
    }
    createFtypBox() { return new Uint8Array([0,0,0,24, 102,116,121,112, 105,115,111,109, 0,0,0,1, 105,115,111,109, 97,118,99,49]); }
    createMoovBox() {
        let currentOffset = 24 + 8; 
        const stcoContent = new Uint8Array(4 + 4 + (this.samples.length * 4)); const stcoView = new DataView(stcoContent.buffer); stcoView.setUint32(4, this.samples.length);
        for(let i=0; i<this.samples.length; i++) { stcoView.setUint32(8 + (i*4), currentOffset); currentOffset += this.samples[i].size; }
        const stco = this.box('stco', stcoContent);
        const stszContent = new Uint8Array(4 + 4 + 4 + (this.samples.length * 4)); const stszView = new DataView(stszContent.buffer); stszView.setUint32(8, this.samples.length);
        for(let i=0; i<this.samples.length; i++) stszView.setUint32(12 + (i*4), this.samples[i].size);
        const stsz = this.box('stsz', stszContent);
        const stscContent = new Uint8Array(4 + 4 + 12); const stscView = new DataView(stscContent.buffer); stscView.setUint32(4, 1); stscView.setUint32(8, 1); stscView.setUint32(12, 1); stscView.setUint32(16, 1);
        const stsc = this.box('stsc', stscContent);
        const sttsContent = new Uint8Array(4 + 4 + 8); const sttsView = new DataView(sttsContent.buffer); sttsView.setUint32(4, 1); sttsView.setUint32(8, this.samples.length); sttsView.setUint32(12, this.samples.length > 0 ? this.samples[0].duration : 1000);
        const stts = this.box('stts', sttsContent);
        const avcc = this.box('avcC', this.avcConfig); const avc1Header = new Uint8Array(78); const avc1View = new DataView(avc1Header.buffer);
        avc1View.setUint16(6, 1); avc1View.setUint16(24, this.width); avc1View.setUint16(26, this.height); avc1View.setUint16(74, 24); avc1View.setUint16(76, 65535);
        const avc1Content = new Uint8Array(78 + avcc.byteLength); avc1Content.set(avc1Header); avc1Content.set(avcc, 78);
        const avc1 = this.box('avc1', avc1Content);
        const stsdContent = new Uint8Array(8 + avc1.byteLength); new DataView(stsdContent.buffer).setUint32(4, 1); stsdContent.set(avc1, 8);
        const stsd = this.box('stsd', stsdContent);
        const stbl = this.box('stbl', this.concat([stsd, stts, stsc, stsz, stco]));
        const vmhd = this.box('vmhd', new Uint8Array([0,0,0,1, 0,0,0,1, 0,0,0,0, 0,0,0,0]));
        const dref = this.box('dref', new Uint8Array([0,0,0,0, 0,0,0,1, 0,0,0,12, 117,114,108, 32, 0,0,0,1]));
        const dinf = this.box('dinf', dref);
        const minf = this.box('minf', this.concat([vmhd, dinf, stbl]));
        const mdhdContent = new Uint8Array(24); const mdhdView = new DataView(mdhdContent.buffer); mdhdView.setUint32(12, this.timeScale); mdhdView.setUint32(16, this.samples.reduce((a,b)=>a+b.duration, 0)); mdhdView.setUint16(20, 21956);
        const mdhd = this.box('mdhd', mdhdContent);
        const hdlr = this.box('hdlr', new Uint8Array([0,0,0,0, 0,0,0,0, 118,105,100,101, 0,0,0,0, 0,0,0,0, 0,0,0,0, 86,105,100,101,111,72,97,110,100,108,101,114,0]));
        const mdia = this.box('mdia', this.concat([mdhd, hdlr, minf]));
        const tkhdContent = new Uint8Array(84); const tkhdView = new DataView(tkhdContent.buffer); tkhdView.setUint32(12, 1); tkhdView.setUint32(20, this.samples.reduce((a,b)=>a+b.duration, 0)); tkhdView.setUint32(36, 65536); tkhdView.setUint32(52, 65536); tkhdView.setUint32(68, 1073741824); tkhdView.setUint32(76, this.width * 65536); tkhdView.setUint32(80, this.height * 65536);
        const tkhd = this.box('tkhd', tkhdContent);
        const trak = this.box('trak', this.concat([tkhd, mdia]));
        const mvhdContent = new Uint8Array(100); const mvhdView = new DataView(mvhdContent.buffer); mvhdView.setUint32(12, this.timeScale); mvhdView.setUint32(16, this.samples.reduce((a,b)=>a+b.duration, 0)); mvhdView.setUint32(20, 65536); mvhdView.setUint16(24, 256); mvhdView.setUint32(32, 65536); mvhdView.setUint32(48, 65536); mvhdView.setUint32(64, 1073741824); mvhdView.setUint32(96, 2);
        const mvhd = this.box('mvhd', mvhdContent);
        return this.box('moov', this.concat([mvhd, trak]));
    }
    box(type, data) {
        const len = 8 + data.byteLength; const buffer = new Uint8Array(len); const view = new DataView(buffer.buffer); view.setUint32(0, len);
        for (let i = 0; i < 4; i++) buffer[4 + i] = type.charCodeAt(i);
        buffer.set(data, 8); return buffer;
    }
    concat(arrays) {
        let total = 0; for(const arr of arrays) total += arr.byteLength;
        const res = new Uint8Array(total); let offset = 0; for(const arr of arrays) { res.set(arr, offset); offset += arr.byteLength; } return res;
    }
}

const VideoRenderer = {
    isRendering: false, width: 1920, height: 1080, bitrate: 5000000, samplesPerFrame: 32, miniMuxer: null, videoEncoder: null, canvas: irisCanvas, 
    startExport: async function(filename = "render.mp4") {
        if (this.isRendering) return;
        console.log("Iniciando Renderização MP4..."); this.isRendering = true;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        let targetWidth = 1920; let targetHeight = 1080;
        if (isMobile) { targetWidth = 1280; targetHeight = 720; }
        if (targetWidth % 2 !== 0) targetWidth -= 1; if (targetHeight % 2 !== 0) targetHeight -= 1;
        const configsToTry = [ { codec: 'avc1.4d002a', width: targetWidth, height: targetHeight, bitrate: this.bitrate }, { codec: 'avc1.42001f', width: targetWidth, height: targetHeight, bitrate: this.bitrate }, { codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 2000000 } ];
        let selectedConfig = null;
        for (const config of configsToTry) { try { const support = await VideoEncoder.isConfigSupported(config); if (support.supported) { selectedConfig = config; break; } } catch (e) { continue; } }
        if (!selectedConfig) { alert("Erro Fatal: Codec não suportado."); this.isRendering = false; return; }
        this.width = selectedConfig.width; this.height = selectedConfig.height; this.miniMuxer = new MiniMuxer(this.width, this.height);
        if (typeof AnimationTimeline !== 'undefined') AnimationTimeline.isPlaying = false;
        if (!isBakingActive) { isBakingActive = true; irisCanvas.style.display = "block"; prepareSceneForRender(); startRenderLoop(); }
        try {
            this.videoEncoder = new VideoEncoder({ output: (chunk, meta) => { const duration = (chunk.duration / 1000000) * this.miniMuxer.timeScale; this.miniMuxer.addVideoChunk(chunk, meta, duration); }, error: (e) => { console.error(e); alert("Erro Codec: " + e.message); this.isRendering = false; } });
            this.videoEncoder.configure({ codec: selectedConfig.codec, width: selectedConfig.width, height: selectedConfig.height, bitrate: selectedConfig.bitrate, framerate: (typeof AnimationTimeline !== 'undefined') ? AnimationTimeline.fps : 30 });
            await this.processFrames(filename);
        } catch (e) { alert("Erro ao iniciar: " + e.message); this.isRendering = false; }
    },
    processFrames: async function(filename) {
        const start = (typeof AnimationTimeline !== 'undefined') ? AnimationTimeline.startFrame : 0;
        const end = (typeof AnimationTimeline !== 'undefined') ? AnimationTimeline.endFrame : 100;
        const fps = (typeof AnimationTimeline !== 'undefined') ? AnimationTimeline.fps : 30;
        const originalSize = new THREE.Vector2(); irisRenderer.getSize(originalSize); irisRenderer.setSize(this.width, this.height); window.dispatchEvent(new Event('resize')); 
        for (let frame = start; frame <= end; frame++) {
            if (typeof AnimationTimeline !== 'undefined') AnimationTimeline.goToFrame(frame);
            currentFrame = 0; await this.waitForBake();
            const timestamp = (frame - start) * (1000000 / fps);
            try { const videoFrame = new VideoFrame(this.canvas, { timestamp: timestamp, duration: 1000000 / fps }); const isKey = frame % fps === 0; this.videoEncoder.encode(videoFrame, { keyFrame: isKey }); videoFrame.close(); } catch(err) { console.warn("Frame pulado:", err); }
            await new Promise(r => setTimeout(r, 0)); console.log(`Render: Frame ${frame}/${end}`);
        }
        irisRenderer.setSize(originalSize.x, originalSize.y); window.dispatchEvent(new Event('resize')); await this.finishExport(filename);
    },
    waitForBake: async function() { return new Promise(resolve => { const check = () => { if (currentFrame >= this.samplesPerFrame) resolve(); else requestAnimationFrame(check); }; check(); }); },
    finishExport: async function(filename) {
        console.log("Finalizando arquivo..."); await this.videoEncoder.flush(); const blob = this.miniMuxer.finalize();
        if (blob && blob.size > 0) {
            const reader = new FileReader(); reader.readAsDataURL(blob);
            reader.onloadend = function() {
                const base64data = reader.result; const date = new Date(); const timeStr = `${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`; const finalName = `Render_${timeStr}.mp4`;
                if (window.Android && window.Android.salvarVideo) { window.Android.salvarVideo(base64data, finalName); alert("Processando vídeo... Aguarde a confirmação."); } 
                else { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = finalName; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 1000); alert("Vídeo baixado (Modo Desktop)."); }
            };
        } else { alert("Erro: O vídeo gerado está vazio."); }
        this.isRendering = false;
    }
};

// =========================================================
// 6. UI BINDING
// =========================================================

function setupIrisUI() {
    function bind(id, callback) {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('input', (e) => {
                callback(e);
                currentFrame = 0;
            });
            callback({ target: el });
        }
    }

    bind('iris_enable_gi', (e) => { ENABLE_GI = e.target.checked; });
    bind('iris_enable_restir', (e) => { ENABLE_RESTIR = e.target.checked; }); // Binding do ReSTIR
    bind('ENABLE_ANTIALIAS', (e) => { ENABLE_ANTIALIAS = e.target.checked; });
    bind('iris_light_intensity', (e) => { LIGHT_INTENSITY_FACTOR = parseFloat(e.target.value); });
    bind('iris_gi_intensity', (e) => { GI_INTENSITY = parseFloat(e.target.value); });

    bind('iris_ao_strength', (e) => { AO_OPTIONS.strength = parseFloat(e.target.value); });
    bind('iris_ao_radius', (e) => { AO_OPTIONS.radius = parseFloat(e.target.value); });
    bind('iris_ao_bias', (e) => { AO_OPTIONS.bias = parseFloat(e.target.value); });

    bind('iris_enable_bloom', (e) => { ENABLE_BLOOM = e.target.checked; });
    bind('iris_bloom_strength', (e) => { BLOOM_STRENGTH = parseFloat(e.target.value); });
    bind('iris_bloom_radius', (e) => { BLOOM_RADIUS = parseFloat(e.target.value); });
    bind('iris_bloom_threshold', (e) => { 
        BLOOM_THRESHOLD = parseFloat(e.target.value); 
        bloomHighPassMat.uniforms.threshold.value = BLOOM_THRESHOLD;
    });
    bind('iris_bloom_mips', (e) => { 
        const val = parseInt(e.target.value);
        if(val !== BLOOM_MIPS) {
            BLOOM_MIPS = val;
            const size = new THREE.Vector2();
            irisRenderer.getSize(size);
            initBloomTargets(size.x, size.y);
        }
    });

    bind('iris_sky_intensity', (e) => { SKY_OPTIONS.intensity = parseFloat(e.target.value); });
    bind('iris_sky_mode_select', (e) => { SKY_OPTIONS.mode = e.target.value; });
    
    bind('iris_sky_top', (e) => { 
        SKY_OPTIONS.unityColors.top = parseInt(e.target.value.replace('#', '0x'));
    });
    bind('iris_sky_horizon', (e) => { 
        SKY_OPTIONS.unityColors.horizon = parseInt(e.target.value.replace('#', '0x'));
    });
    bind('iris_sky_bottom', (e) => { 
        SKY_OPTIONS.unityColors.bottom = parseInt(e.target.value.replace('#', '0x'));
    });
}

setupIrisUI();