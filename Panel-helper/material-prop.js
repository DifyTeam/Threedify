const prevcanvas = document.getElementById('materialPreview');
const ctx = prevcanvas.getContext('2d');

// Input invisível para upload de textura
const textureInput = document.createElement('input');
textureInput.type = 'file';
textureInput.accept = 'image/*';
textureInput.style.display = 'none';
document.body.appendChild(textureInput);

// Mapeamento dos inputs
const inputs = {
    color: document.getElementById('color-mat'),
    roughness: document.getElementById('roughnessInput'), // Material: Roughness | Luz: Intensity
    emission: document.getElementById('emissionInput'),   // Material: Emission  | Luz Point: Range
    metalness: document.getElementById('metalnessInput'), // Material: Metalness | Luz: Softness
    reflection: document.getElementById('reflectionInput'),
    smooth: document.getElementById('SmoothInput')        // Material: Flat/Smooth | Luz: Cast Shadow
};

// Botões e Containers
const addBtn = document.getElementById('add_material');
const applyBtn = document.getElementById('apply');
const materialsContainer = document.querySelector('.materials');
const previewContainer = prevcanvas; 

// Sistema de materiais
let materials = [];
let selectedMaterial = null;
let materialIdCounter = 0;
let isUpdatingInputs = false; 
let currentColor = '#FFFFFF';

// Estado da Interface e CACHE
let currentMode = 'MATERIAL'; 
let lastSelectedUuid = null;
let currentLightInstance = null; // <--- O SEGREDO: Guarda a luz que estamos editando

// Garante que o array de luzes existe
window.ray_lights = window.ray_lights || [];

// Direção da luz para o Preview 2D
const lightDir = normalize({ x: -0.5, y: 0.5, z: 1 });

function normalize(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

// ==============================================
// COMANDO: APLICAR MATERIAL (UNDO/REDO)
// ==============================================
class ApplyMaterialCommand extends Command {
    constructor(targetObject, newMaterial) {
        super('Aplicar Material');
        this.targetObject = targetObject;
        this.newMaterial = newMaterial;
        
        // Armazena lista de alterações: { mesh: THREE.Mesh, oldMaterial: THREE.Material }
        this.modifications = [];
        
        // Prepara o estado inicial (percorre recursivamente para salvar materiais antigos)
        this._prepareState(this.targetObject);
    }

    _prepareState(obj) {
        // Verifica se o objeto pode receber material e é uma Mesh
        if (canReceiveMaterial(obj) && obj.isMesh) {
            this.modifications.push({
                mesh: obj,
                oldMaterial: obj.material // Salva referência do material anterior
            });
        }
        
        // Recursão para filhos
        if (obj.children && obj.children.length > 0) {
            obj.children.forEach(child => this._prepareState(child));
        }
    }

    execute() {
        // Aplica o novo material em todas as malhas identificadas
        let appliedCount = 0;
        this.modifications.forEach(item => {
            // Lógica de atualização de geometria (normais) ao aplicar
            applyMaterialLogic(item.mesh, this.newMaterial);
            appliedCount++;
        });
        
        if (appliedCount > 0) console.log(`Comando executado: Material aplicado a ${appliedCount} objetos.`);
    }

    undo() {
        // Restaura o material antigo
        this.modifications.forEach(item => {
            // Apenas reverte o material, não precisamos recalcular normais no undo necessariamente,
            // mas usamos a mesma lógica para garantir consistência.
            applyMaterialLogic(item.mesh, item.oldMaterial);
        });
        console.log('Comando desfeito: Material restaurado.');
    }
}

// Função auxiliar com a lógica "pura" de aplicar (extraída para uso do Command)
function applyMaterialLogic(obj, material) {
    obj.material = material;
    obj.material.needsUpdate = true;
    
    if (obj.geometry && obj.geometry.isBufferGeometry) {
        // Se o material não é flat (é smooth), precisamos garantir normais
        const isSmooth = !material.flatShading;
        const geometry = obj.geometry;
        
        if (isSmooth) {
            if (!geometry.attributes.normal || geometry.attributes.normal.count !== geometry.attributes.position.count) {
                const normalsArray = new Float32Array(geometry.attributes.position.count * 3);
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalsArray, 3));
            }
            if (geometry.computeVertexNormals) geometry.computeVertexNormals();
        } 
        
        if (geometry.attributes.normal) geometry.attributes.normal.needsUpdate = true;
        if (geometry.attributes.position) geometry.attributes.position.needsUpdate = true;
        geometry.elementsNeedUpdate = true; 
        geometry.attributesNeedUpdate = true;
    }
}

// --- BUSCA POR UUID (Executada apenas ao clicar) ---
function getLightInstanceFromSelection(selection) {
    if (!selection) return null;
    if (window.ray_lights.length === 0) return null;

    return window.ray_lights.find(light => {
        // Verifica o objeto container principal da luz
        if (light.object && light.object.uuid === selection.uuid) return true;
        
        // Suporte legado para estruturas antigas de luz
        if (light.sphere && light.sphere.uuid === selection.uuid) return true;
        if (light.line && light.line.uuid === selection.uuid) return true;
        
        // Verifica hierarquia (caso clique em uma parte do gizmo)
        let parent = selection.parent;
        while (parent) {
            if (light.object && parent.uuid === light.object.uuid) return true;
            parent = parent.parent;
        }
        return false;
    });
}

// --- Preview 2D ---
function getFloorColor(x, z) {
    const scale = 0.005;
    const check = (Math.floor(x * scale) + Math.floor(z * scale)) % 2;
    return check === 0 ? { r: 200, g: 200, b: 200 } : { r: 50, g: 50, b: 50 };
}

function getTexturePixelData(img) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0);
    return tempCtx.getImageData(0, 0, img.width, img.height);
}

function updatePreview() {
    if (currentMode === 'LIGHT') return;

    const hasTexture = selectedMaterial && selectedMaterial.textureData;
    let texData = null;
    let texW = 0;
    let texH = 0;

    if (hasTexture) {
        texData = selectedMaterial.textureData.data;
        texW = selectedMaterial.textureData.width;
        texH = selectedMaterial.textureData.height;
    }

    const solidColor = hexToRgb(currentColor);
    
    const roughness = parseFloat(inputs.roughness.value);
    const emission = parseFloat(inputs.emission.value);
    const metalness = parseFloat(inputs.metalness.value);
    const reflectionStrength = parseFloat(inputs.reflection.value);

    const width = prevcanvas.width;
    const height = prevcanvas.height;
    const centerX = width / 2 - 5;
    const centerY = height / 2;
    const radius = 60;
    const floorY = -radius - 5;

    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = x - centerX;
            const py = -(y - centerY);
            const distSq = px * px + py * py;

            if (distSq <= radius * radius) {
                const pz = Math.sqrt(radius * radius - distSq);
                const invRadius = 1 / radius;
                const nx = px * invRadius;
                const ny = py * invRadius;
                const nz = pz * invRadius;

                let baseColor = solidColor;

                if (hasTexture) {
                    const u = 0.5 + Math.atan2(nz, nx) / (2 * Math.PI);
                    const v = 0.5 - Math.asin(ny) / Math.PI;
                    const texX = Math.floor(u * texW) % texW;
                    const texY = Math.floor(v * texH) % texH;
                    const texIdx = (texY * texW + texX) * 4;
                    baseColor = {
                        r: texData[texIdx],
                        g: texData[texIdx + 1],
                        b: texData[texIdx + 2]
                    };
                }

                const vx = 0, vy = 0, vz = 1;
                const dotNL = Math.max(0, nx * lightDir.x + ny * lightDir.y + nz * lightDir.z);

                const diffR = baseColor.r * (1 - metalness);
                const diffG = baseColor.g * (1 - metalness);
                const diffB = baseColor.b * (1 - metalness);

                const dotNV = Math.max(0, nx * vx + ny * vy + nz * vz);
                const rx = 2 * dotNV * nx - vx;
                const ry = 2 * dotNV * ny - vy;
                const rz = 2 * dotNV * nz - vz;

                let reflectionColor = { r: 0, g: 0, b: 0 };
                let hasReflection = false;

                if (ry < 0) {
                    const t = (floorY - py) / ry;
                    if (t > 0) {
                        const hitX = px + t * rx;
                        const hitZ = pz + t * rz;
                        const reflectionColorData = getFloorColor(hitX, hitZ);
                        reflectionColor = reflectionColorData;
                        hasReflection = true;
                    }
                }

                const rLx = 2 * dotNL * nx - lightDir.x;
                const rLy = 2 * dotNL * ny - lightDir.y;
                const rLz = 2 * dotNL * nz - lightDir.z;
                const specBase = Math.max(0, rLx * vx + rLy * vy + rLz * vz);
                const shininess = (1 - roughness) * 100 + 1;
                let specIntensity = Math.pow(specBase, shininess);
                specIntensity *= (1 - roughness);

                const specR = (metalness * baseColor.r + (1 - metalness) * 255) * specIntensity;
                const specG = (metalness * baseColor.g + (1 - metalness) * 255) * specIntensity;
                const specB = (metalness * baseColor.b + (1 - metalness) * 255) * specIntensity;

                const F0 = 0.04 + (0.96 * metalness);
                const fresnel = F0 + (1.0 - F0) * Math.pow(1.0 - dotNV, 3);

                let finalR = diffR * (dotNL + 0.15);
                let finalG = diffG * (dotNL + 0.15);
                let finalB = diffB * (dotNL + 0.15);

                if (hasReflection) {
                    const refFactor = reflectionStrength * fresnel * (1 - roughness * 0.8);
                    finalR = finalR * (1 - refFactor) + reflectionColor.r * refFactor;
                    finalG = finalG * (1 - refFactor) + reflectionColor.g * refFactor;
                    finalB = finalB * (1 - refFactor) + reflectionColor.b * refFactor;
                }

                finalR += specR;
                finalG += specG;
                finalB += specB;

                finalR += baseColor.r * emission;
                finalG += baseColor.g * emission;
                finalB += baseColor.b * emission;

                const idx = (y * width + x) * 4;
                data[idx] = Math.min(255, finalR);
                data[idx + 1] = Math.min(255, finalG);
                data[idx + 2] = Math.min(255, finalB);
                data[idx + 3] = 255;
            } else {
                const idx = (y * width + x) * 4;
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 0;
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
    
    if (!hasTexture) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Click for Texture", width/2 - 5, height/2 + 5);
    }
}

// --- GERENCIAMENTO DE INTERFACE ---
function getLabelForInput(inputElement) {
    let prev = inputElement.previousElementSibling;
    if (prev && (prev.tagName === 'P' || prev.tagName === 'LABEL' || prev.tagName === 'SPAN')) {
        return prev;
    }
    if (inputElement.parentElement && inputElement.parentElement.tagName === 'LABEL') {
        return inputElement.parentElement;
    }
    return null;
}

// === ALTERNA UI ENTRE MODO LUZ E MODO MATERIAL ===
function updateInterfaceMode(targetObj) {
    const lightInstance = getLightInstanceFromSelection(targetObj);
    const isLight = !!lightInstance;
    
    isUpdatingInputs = true; 

    if (isLight) {
        currentMode = 'LIGHT';
        currentLightInstance = lightInstance; // Guarda no Cache!

        // Identifica se é Direcional ou Point Light
        const isDirectional = lightInstance.type === 'directional' || (lightInstance.object && lightInstance.object.userData.type === 'directional');

        // 1. Esconder Interface de Material
        prevcanvas.style.display = 'none';
        applyBtn.style.display = 'none';
        materialsContainer.style.display = 'none';
        addBtn.style.display = 'none';
        
        // Reflection sempre oculto para luzes
        inputs.reflection.parentElement.style.display = 'none';

        // 2. Ajustar Ranges para LUZ
        
        // --- Intensity (antigo Roughness) ---
        inputs.roughness.parentElement.style.display = 'block';
        const labelRough = getLabelForInput(inputs.roughness);
        if(labelRough) labelRough.innerText = "Intensity";
        inputs.roughness.max = "100";
        inputs.roughness.min = "0";
        inputs.roughness.step = "0.5";

        // --- Softness (antigo Metalness) ---
        inputs.metalness.parentElement.style.display = 'block';
        const labelMetal = getLabelForInput(inputs.metalness);
        if(labelMetal) labelMetal.innerText = "Softness";
        inputs.metalness.max = "1";
        inputs.metalness.min = "0"; // Softness 0 é sombra dura
        inputs.metalness.step = "0.01";

        // --- Cast Shadow (antigo Smooth) ---
        inputs.smooth.parentElement.style.display = 'block';
        const labelSmooth = getLabelForInput(inputs.smooth);
        if(labelSmooth) labelSmooth.innerText = "Cast Shadow";
        inputs.smooth.min = "0";
        inputs.smooth.max = "1";
        inputs.smooth.step = "1";

        // --- Range / Alcance (Reutilizando Emission) ---
        // Só exibe Range se for Point Light. Luz direcional "global" não costuma ter range.
        if (!isDirectional) {
            inputs.emission.parentElement.style.display = 'block';
            const labelEmission = getLabelForInput(inputs.emission);
            if(labelEmission) labelEmission.innerText = "Range";
            inputs.emission.min = "0";
            inputs.emission.max = "200"; // Defina um máximo razoável para a cena
            inputs.emission.step = "1";
        } else {
            inputs.emission.parentElement.style.display = 'none';
        }

        // 3. Pegar valores da Instância da Luz e colocar na UI
        if (lightInstance) {
            const hexColor = "#" + lightInstance.color.getHexString().toUpperCase();
            currentColor = hexColor; 
            inputs.color.style.backgroundColor = currentColor;

            inputs.roughness.value = lightInstance.intensity;
            inputs.metalness.value = lightInstance.shadowSoftness;
            inputs.smooth.value = lightInstance.castShadow ? 1 : 0; 
            
            // Popula o valor do Range se existir e não for direcional
            if (!isDirectional) {
                // Tenta pegar de propriedade ou método get
                let rangeVal = 50; // Default
                if (lightInstance.range !== undefined) rangeVal = lightInstance.range;
                else if (typeof lightInstance.getRange === 'function') rangeVal = lightInstance.getRange();
                
                inputs.emission.value = rangeVal;
            }
        }

    } else {
        currentMode = 'MATERIAL';
        currentLightInstance = null; // Limpa Cache

        // 1. Restaurar Interface Material
        prevcanvas.style.display = 'block';
        applyBtn.style.display = 'inline-block';
        materialsContainer.style.display = 'block';
        addBtn.style.display = 'inline-block';
        
        inputs.emission.parentElement.style.display = 'block';
        inputs.reflection.parentElement.style.display = 'block';
        inputs.roughness.parentElement.style.display = 'block';
        inputs.metalness.parentElement.style.display = 'block';
        inputs.smooth.parentElement.style.display = 'block';

        // 2. HARD RESET DOS RANGES (Voltar para 0-1)
        const labelRough = getLabelForInput(inputs.roughness);
        if(labelRough) labelRough.innerText = "Roughness";
        inputs.roughness.max = "1"; 
        inputs.roughness.min = "0";
        inputs.roughness.step = "0.01";

        const labelMetal = getLabelForInput(inputs.metalness);
        if(labelMetal) labelMetal.innerText = "Metalness";
        inputs.metalness.max = "1";
        inputs.metalness.min = "0";
        inputs.metalness.step = "0.01";

        const labelEmission = getLabelForInput(inputs.emission);
        if(labelEmission) labelEmission.innerText = "Emission";
        inputs.emission.min = "0";
        inputs.emission.max = "10"; // Emission pode ir acima de 1 no material
        inputs.emission.step = "0.1";

        const labelSmooth = getLabelForInput(inputs.smooth);
        if(labelSmooth) labelSmooth.innerText = "Smooth";
        inputs.smooth.min = "0";
        inputs.smooth.max = "1";
        inputs.smooth.step = "1";

        // 3. Restaurar valores do material ou reset
        if (selectedMaterial) {
            selectMaterial(selectedMaterial);
        } else {
             currentColor = '#FFFFFF';
             inputs.color.style.backgroundColor = currentColor;
             inputs.roughness.value = 1;
             inputs.metalness.value = 0;
             inputs.emission.value = 0;
             inputs.smooth.value = 1; 
        }
    }
    
    isUpdatingInputs = false;
}

// --- Loop Verificação ---
setInterval(() => {
    let targetObject = null;
    if (typeof window.getSelectedObject === 'function') targetObject = window.getSelectedObject();
    else if (window.selectedObject !== undefined) targetObject = window.selectedObject;
    else if (typeof selectedObject !== 'undefined') targetObject = selectedObject;

    if (targetObject) {
        if (targetObject.uuid !== lastSelectedUuid) {
            lastSelectedUuid = targetObject.uuid;
            updateInterfaceMode(targetObject);
        }
    } else {
        if (lastSelectedUuid !== null) {
            lastSelectedUuid = null;
            updateInterfaceMode(null);
        }
    }
}, 100);

// --- Textura ---
textureInput.addEventListener('change', (e) => {
    if (currentMode === 'LIGHT') return; 

    const file = e.target.files[0];
    if (!file || !selectedMaterial) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const pixelData = getTexturePixelData(img);
            
            selectedMaterial.textureImg = img;
            selectedMaterial.textureData = {
                data: pixelData.data,
                width: pixelData.width,
                height: pixelData.height
            };

            const loader = new THREE.TextureLoader();
            const textureUrl = event.target.result;
            
            loader.load(textureUrl, (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                selectedMaterial.threeMaterial.map = tex;
                selectedMaterial.threeMaterial.needsUpdate = true;
                
                updatePreview();
                updateSelectedMaterial();
            });
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

prevcanvas.addEventListener('click', () => {
    if (currentMode === 'LIGHT') return;
    if(selectedMaterial) {
        textureInput.click();
    }
});

// --- Lógica Materiais ---
function createMaterial() {
    materialIdCounter++;
    currentColor = '#FFFFFF';
    inputs.color.style.backgroundColor = currentColor;

    const defaultRoughness = 1.0; 
    const defaultEmission = 0.0;
    const defaultMetalness = 0.0;
    const defaultReflection = 0.0;
    const defaultFlatShading = true; 
    
    if (currentMode === 'MATERIAL') {
        inputs.roughness.value = defaultRoughness;
        inputs.emission.value = defaultEmission;
        inputs.metalness.value = defaultMetalness;
        inputs.reflection.value = defaultReflection;
        inputs.smooth.value = defaultFlatShading ? 0 : 1;
    }

    const material = {
        id: `material${materialIdCounter}`,
        name: `material${materialIdCounter}`,
        color: currentColor,
        flatShading: defaultFlatShading,
        rayroughness: defaultRoughness,
        rayemission: defaultEmission,
        raymetalness: defaultMetalness,
        rayreflection: defaultReflection,
        textureImg: null,
        textureData: null,
        threeMaterial: null
    };

    material.threeMaterial = new THREE.MeshStandardMaterial({
        color: material.color,
        flatShading: material.flatShading,
        roughness: defaultRoughness,
        metalness: defaultMetalness,
    });
    material.threeMaterial.rayroughness = defaultRoughness;
    material.threeMaterial.rayemission = defaultEmission;
    material.threeMaterial.raymetalness = defaultMetalness;
    material.threeMaterial.rayreflection = defaultReflection;

    materials.push(material);
    createMaterialElement(material);
    selectMaterial(material);
    
    return material;
}

function createMaterialElement(material) {
    const button = document.createElement('button');
    button.className = 'matarial-content'; 
    button.dataset.materialId = material.id;
    button.textContent = material.name;

    button.addEventListener('click', () => selectMaterial(material));
    materialsContainer.appendChild(button);
}

function selectMaterial(material) {
    selectedMaterial = material;
    document.querySelectorAll('.matarial-content').forEach(el => el.classList.remove('selected'));
    const element = document.querySelector(`[data-material-id="${material.id}"]`);
    if (element) element.classList.add('selected');

    if (currentMode === 'LIGHT') return;

    isUpdatingInputs = true;
    
    currentColor = material.color;
    inputs.color.style.backgroundColor = currentColor;
    if (typeof window.setColorPickerColor === 'function') window.setColorPickerColor(currentColor);
    
    inputs.roughness.max = "1";
    inputs.metalness.max = "1";
    
    // Assegura que emission esteja configurado para material
    const labelEmission = getLabelForInput(inputs.emission);
    if(labelEmission) labelEmission.innerText = "Emission";
    inputs.emission.min = "0";

    inputs.roughness.value = material.rayroughness;
    inputs.emission.value = material.rayemission;
    inputs.metalness.value = material.raymetalness;
    inputs.reflection.value = material.rayreflection;
    inputs.smooth.value = material.flatShading ? 0 : 1; 
    textureInput.value = '';
    
    updatePreview();
    isUpdatingInputs = false;
}

function canReceiveMaterial(obj) {
    if (!obj) return false;
    if (getLightInstanceFromSelection(obj)) return false;
    if (obj.isLight) return false;
    if (obj.isLine || obj.isLineSegments) return false;
    if (obj.userData && obj.userData.isLight) return false;
    return true;
}

// MODIFICADO: Função apenas lógica (para uso interno e do comando)
// Para aplicar, use applyMaterialToSelected ou commandManager
function applyMaterialToObject(obj, material) {
    // Mantido para compatibilidade se algo chamar diretamente, mas
    // idealmente deve-se usar o Command.
    if (!canReceiveMaterial(obj)) return 0;
    
    let appliedCount = 0;
    if (obj.isMesh && obj.material) {
        applyMaterialLogic(obj, material);
        appliedCount++;
        console.log(`Material aplicado a mesh: ${obj.name || 'sem nome'}`);
    }
    
    if (obj.children && obj.children.length > 0) {
        obj.children.forEach(child => {
            if (canReceiveMaterial(child)) {
                appliedCount += applyMaterialToObject(child, material);
            }
        });
    }
    return appliedCount;
}

// MODIFICADO: Agora usa o sistema de COMANDO
function applyMaterialToSelected() {
    if (currentMode === 'LIGHT') return; 
    if (!selectedMaterial) return;

    let targetObject = window.selectedObject;
    if (!targetObject) return;

    if (!canReceiveMaterial(targetObject)) {
        console.warn('Objeto inválido para material.');
        return;
    }

    // Cria e executa o comando de Undo/Redo
    const command = new ApplyMaterialCommand(targetObject, selectedMaterial.threeMaterial);
    commandManager.execute(command);
}

// === UPDATE EM TEMPO REAL: LUZ (USANDO CACHE) ===
function updateLightFromUI() {
    // Usa a variável de cache definida no updateInterfaceMode
    if (currentLightInstance) {
        const isDirectional = currentLightInstance.type === 'directional' || (currentLightInstance.object && currentLightInstance.object.userData.type === 'directional');

        // Cor
        if (typeof currentLightInstance.setColor === 'function') {
             currentLightInstance.setColor(currentColor);
        }
        
        // Intensidade
        const intensity = parseFloat(inputs.roughness.value);
        if (typeof currentLightInstance.setIntensity === 'function') {
            currentLightInstance.setIntensity(intensity);
        }

        // Softness (Shadow Softness / Radius)
        const radius = parseFloat(inputs.metalness.value);
        if (typeof currentLightInstance.setShadowSoftness === 'function') {
             currentLightInstance.setShadowSoftness(radius);
        }

        // Cast Shadow (Value 1 = True)
        const isShadowOn = parseFloat(inputs.smooth.value) >= 0.5;
        if (typeof currentLightInstance.setCastShadow === 'function') {
            currentLightInstance.setCastShadow(isShadowOn);
        }

        // Range (Apenas para Point Light)
        if (!isDirectional) {
             const rangeVal = parseFloat(inputs.emission.value);
             // Verifica se existe método setter, se não define propriedade direta
             if (typeof currentLightInstance.setRange === 'function') {
                 currentLightInstance.setRange(rangeVal);
             } else {
                 currentLightInstance.range = rangeVal;
                 if(currentLightInstance.object && currentLightInstance.object.userData) {
                     currentLightInstance.object.userData.range = rangeVal;
                 }
             }
        }
    }
}

// === UPDATE EM TEMPO REAL: MATERIAL ===
function updateSelectedMaterial() {
    if (isUpdatingInputs) return;

    if (currentMode === 'LIGHT') {
        updateLightFromUI();
        return;
    }
    
    if (selectedMaterial) {
        const flatShadingValue = parseFloat(inputs.smooth.value) === 0;
        const rayRoughnessValue = parseFloat(inputs.roughness.value);
        const rayMetalnessValue = parseFloat(inputs.metalness.value);
        const rayEmissionValue = parseFloat(inputs.emission.value);
        const rayReflectionValue = parseFloat(inputs.reflection.value);

        selectedMaterial.color = currentColor;
        selectedMaterial.flatShading = flatShadingValue;
        selectedMaterial.rayroughness = rayRoughnessValue;
        selectedMaterial.rayemission = rayEmissionValue;
        selectedMaterial.raymetalness = rayMetalnessValue;
        selectedMaterial.rayreflection = rayReflectionValue;

        selectedMaterial.threeMaterial.color.setHex(parseInt(selectedMaterial.color.slice(1), 16));
        selectedMaterial.threeMaterial.flatShading = selectedMaterial.flatShading;
        selectedMaterial.threeMaterial.roughness = rayRoughnessValue;
        selectedMaterial.threeMaterial.metalness = rayMetalnessValue;
        
        selectedMaterial.threeMaterial.rayroughness = rayRoughnessValue;
        selectedMaterial.threeMaterial.rayemission = rayEmissionValue;
        selectedMaterial.threeMaterial.raymetalness = rayMetalnessValue;
        selectedMaterial.threeMaterial.rayreflection = rayReflectionValue;
        
        selectedMaterial.threeMaterial.needsUpdate = true;
    }
}

// Event listener para abrir o color picker
inputs.color.addEventListener('click', () => {
    window.openColorPicker((color) => {
        currentColor = color;
        inputs.color.style.backgroundColor = currentColor;
        
        if (currentMode === 'MATERIAL') {
            updatePreview();
            updateSelectedMaterial();
        } else {
            updateLightFromUI();
        }
    });
});

addBtn.addEventListener('click', createMaterial);
applyBtn.addEventListener('click', applyMaterialToSelected);

// Listeners unificados
[inputs.roughness, inputs.emission, inputs.metalness, inputs.reflection, inputs.smooth].forEach(input => {
    input.addEventListener('input', () => {
        if (currentMode === 'MATERIAL') {
            updatePreview();
        }
        updateSelectedMaterial(); 
    });
});

if (materials.length === 0) createMaterial();
updatePreview();

// ======================================================
// NOVO: API GLOBAL PARA IMPORTADORES (OBJ/GLTF)
// ======================================================
window.addImportedMaterial = function(threeMaterial) {
    if (!threeMaterial) return;

    materialIdCounter++;
    
    // Converte a cor do Three.js para HEX
    const hexColor = "#" + threeMaterial.color.getHexString().toUpperCase();
    
    const newMat = {
        id: `material_imp_${materialIdCounter}`,
        name: threeMaterial.name || `Imported_${materialIdCounter}`,
        color: hexColor,
        flatShading: threeMaterial.flatShading || false,
        
        // Pega os parâmetros do Three.js ou usa defaults
        rayroughness: threeMaterial.roughness !== undefined ? threeMaterial.roughness : 0.5,
        raymetalness: threeMaterial.metalness !== undefined ? threeMaterial.metalness : 0.0,
        rayemission: threeMaterial.emissive ? Math.max(threeMaterial.emissive.r, threeMaterial.emissive.g, threeMaterial.emissive.b) : 0,
        rayreflection: threeMaterial.rayreflection || 0, // Propriedade custom se existir
        
        textureImg: null,
        textureData: null,
        threeMaterial: threeMaterial // VINCULA O MATERIAL EXISTENTE
    };

    // Sincroniza propriedades customizadas no objeto Three.js
    threeMaterial.rayroughness = newMat.rayroughness;
    threeMaterial.raymetalness = newMat.raymetalness;
    threeMaterial.rayemission = newMat.rayemission;
    threeMaterial.rayreflection = newMat.rayreflection;

    // Processa Textura (Se houver mapa) para o Preview 2D
    if (threeMaterial.map && threeMaterial.map.image) {
        const img = threeMaterial.map.image;
        // Se a imagem já estiver carregada
        if (img.width > 0) {
            newMat.textureImg = img;
            const pixelData = getTexturePixelData(img);
            newMat.textureData = {
                data: pixelData.data,
                width: pixelData.width,
                height: pixelData.height
            };
        } else {
            // Se ainda estiver carregando, espera
            img.onload = function() {
                newMat.textureImg = img;
                const pixelData = getTexturePixelData(img);
                newMat.textureData = {
                    data: pixelData.data,
                    width: pixelData.width,
                    height: pixelData.height
                };
                if(selectedMaterial === newMat) updatePreview();
            };
        }
    }

    materials.push(newMat);
    createMaterialElement(newMat);
    
    // Opcional: Seleciona o material importado automaticamente
    // selectMaterial(newMat);
    
    console.log(`📦 Material Importado Registrado: ${newMat.name}`);
    return newMat;
};