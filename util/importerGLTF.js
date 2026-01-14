// gltf_importer.js - VERSÃO FINAL (INTEGRADO COM MATERIAL MANAGER)

// ======================================================
// 1. SISTEMA DE UI (TERMINAL VISUAL)
// ======================================================
const GLTFLogSystem = {
    id: 'gltf-console-overlay',
    
    show: function() {
        let el = document.getElementById(this.id);
        if (!el) {
            el = document.createElement('div');
            el.id = this.id;
            const styleSheet = document.createElement("style");
            styleSheet.innerText = `
                #${this.id} {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(10, 10, 10, 0.90); z-index: 99999;
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    font-family: 'Consolas', monospace; transition: opacity 0.3s; opacity: 0;
                }
                .gltf-box {
                    width: 600px; background: #000; border: 1px solid #444;
                    box-shadow: 0 0 30px rgba(0,255,100,0.1); padding: 5px;
                }
                .gltf-header { background: #222; color: #fff; padding: 5px 10px; font-size: 12px; display: flex; justify-content: space-between; }
                .gltf-content { padding: 20px; color: #0f0; font-size: 14px; min-height: 40px; }
                .gltf-bar-bg { width: 100%; height: 4px; background: #333; margin-top: 10px; }
                .gltf-bar-fill { height: 100%; background: #0f0; width: 0%; transition: width 0.2s; }
            `;
            document.head.appendChild(styleSheet);
            el.innerHTML = `
                <div class="gltf-box">
                    <div class="gltf-header"><span>GLTF IMPORTER IV</span><span>MATERIAL SYNC</span></div>
                    <div class="gltf-content" id="gltf-txt">Inicializando...</div>
                    <div class="gltf-bar-bg"><div class="gltf-bar-fill" id="gltf-bar"></div></div>
                </div>`;
            document.body.appendChild(el);
        }
        el.style.display = 'flex';
        requestAnimationFrame(() => el.style.opacity = '1');
    },

    update: function(msg, percent) {
        const txt = document.getElementById('gltf-txt');
        const bar = document.getElementById('gltf-bar');
        if(txt) txt.innerText = "> " + msg;
        if(bar && percent !== undefined) bar.style.width = percent + '%';
    },

    hide: function() {
        const el = document.getElementById(this.id);
        if (el) {
            setTimeout(() => {
                el.style.opacity = '0';
                setTimeout(() => el.style.display = 'none', 300);
            }, 500);
        }
    }
};

// ======================================================
// 2. ENGINE DE DESCOMPACTAÇÃO (Nativo)
// ======================================================
class SimpleUnzipper {
    constructor(buffer) {
        this.buffer = buffer;
        this.view = new DataView(buffer);
        this.uint8 = new Uint8Array(buffer);
        this.files = new Map();
    }

    async extract() {
        GLTFLogSystem.update("Extraindo ZIP...", 20);
        let offset = 0;
        const len = this.view.byteLength;

        while (offset < len) {
            if (this.view.getUint32(offset, true) !== 0x04034b50) break; // Signature check
            
            offset += 26; // Pula headers fixos
            const nameLen = this.view.getUint16(offset, true); offset += 2;
            const extraLen = this.view.getUint16(offset, true); offset += 2;
            const name = new TextDecoder().decode(this.uint8.slice(offset, offset + nameLen));
            offset += nameLen + extraLen;

            // Recalcula para pegar compressed size
            const headerOffset = offset - (nameLen + extraLen + 30);
            const compSize = this.view.getUint32(headerOffset + 18, true);
            
            const data = this.uint8.slice(offset, offset + compSize);
            offset += compSize;

            if (compSize > 0 && !name.endsWith('/')) {
                try {
                    const stream = new ReadableStream({start(c){c.enqueue(data);c.close()}});
                    const decomp = stream.pipeThrough(new DecompressionStream("deflate-raw"));
                    const buff = await new Response(decomp).arrayBuffer();
                    this.files.set(name, new Blob([buff]));
                } catch(e) {
                    this.files.set(name, new Blob([data])); // Fallback Store
                }
            }
        }
        return this.files;
    }
}

// ======================================================
// 3. FUNÇÃO DE CARREGAMENTO (Com Texturas e Materiais)
// ======================================================
async function loadGLTF(url, customName) {
    GLTFLogSystem.show();
    GLTFLogSystem.update("Baixando...", 10);

    const rootGroup = new THREE.Group();
    rootGroup.name = customName || "GLTF_Model";

    try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();

        let files = new Map();
        let mainBuffer = buffer;
        let mainFileName = customName || "model.glb";

        // Verifica ZIP
        const dv = new DataView(buffer);
        if (dv.getUint32(0, true) === 0x04034b50) {
            const zip = new SimpleUnzipper(buffer);
            files = await zip.extract();
            const gltfFile = [...files.keys()].find(k => k.match(/\.(gltf|glb)$/i));
            if (!gltfFile) throw new Error("ZIP sem modelo 3D.");
            mainBuffer = await files.get(gltfFile).arrayBuffer();
            mainFileName = gltfFile;
        } else {
            files.set(mainFileName, new Blob([buffer]));
        }

        GLTFLogSystem.update("Lendo Estrutura...", 40);

        // Parse GLTF/GLB
        let json, binChunk;
        if (mainFileName.toLowerCase().endsWith('.glb')) {
            const glbDv = new DataView(mainBuffer);
            const jsonLen = glbDv.getUint32(12, true);
            if (glbDv.getUint32(16, true) !== 0x4E4F534A) throw new Error("Erro GLB JSON");
            
            const jsonTxt = new TextDecoder().decode(new Uint8Array(mainBuffer, 20, jsonLen));
            json = JSON.parse(jsonTxt);
            
            if (mainBuffer.byteLength > 20 + jsonLen) {
                const binHeaderPos = 20 + jsonLen;
                const binLen = glbDv.getUint32(binHeaderPos, true);
                if (glbDv.getUint32(binHeaderPos + 4, true) === 0x004E4942) {
                    binChunk = mainBuffer.slice(binHeaderPos + 8, binHeaderPos + 8 + binLen);
                }
            }
        } else {
            json = JSON.parse(new TextDecoder().decode(mainBuffer));
        }

        // --- CONSTRUTOR 3D ---
        GLTFLogSystem.update("Sincronizando Materiais...", 60);
        await buildGLTFScene(rootGroup, json, binChunk, files);

        // --- OTIMIZADOR ---
        optimizeScaleOnly(rootGroup);

        // --- INTEGRAÇÃO ---
        if (typeof scene !== 'undefined') {
            scene.add(rootGroup);
            rootGroup.updateMatrixWorld(true); 
        }

        if (typeof selectableObjects !== 'undefined' && Array.isArray(selectableObjects)) {
            selectableObjects.push(rootGroup);
        }

        GLTFLogSystem.update("Sucesso!", 100);
        console.log("✅ GLTF Importado (R123 + Materials):", rootGroup);
        GLTFLogSystem.hide();

    } catch (e) {
        console.error(e);
        GLTFLogSystem.update("ERRO: " + e.message, 0);
        alert("Erro: " + e.message);
    }

    return rootGroup;
}

// Helper: Constrói Cena + Materiais + Texturas
async function buildGLTFScene(root, json, binChunk, files) {
    const buffers = [];
    
    // 1. Helper Buffers
    const getBuf = async (idx) => {
        if (buffers[idx]) return buffers[idx];
        if (idx === undefined && binChunk) return binChunk;
        const def = json.buffers[idx];
        if (!def.uri && binChunk) return binChunk;
        
        let blob = files.get(def.uri);
        if(!blob) blob = files.get(def.uri.replace('./', '')); 
        
        if (blob) {
            const b = await blob.arrayBuffer();
            buffers[idx] = b;
            return b;
        }
        // Fallback Base64
        if (def.uri && def.uri.startsWith('data:')) {
            const res = await fetch(def.uri);
            return await res.arrayBuffer();
        }
        return new ArrayBuffer(0);
    };

    // 2. Helper Accessor
    const getAcc = async (idx) => {
        const acc = json.accessors[idx];
        const bv = json.bufferViews[acc.bufferView];
        const buf = await getBuf(bv.buffer);
        const off = (bv.byteOffset||0) + (acc.byteOffset||0);
        
        const Type = acc.componentType === 5126 ? Float32Array : 
                     acc.componentType === 5123 ? Uint16Array : Uint32Array;
        const comps = { 'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16 }[acc.type];
        return new Type(buf.slice(off, off + acc.count * comps * Type.BYTES_PER_ELEMENT));
    };

    // 3. Helper Texturas
    const textureCache = [];
    const loadTex = async (texIndex) => {
        if (texIndex === undefined) return null;
        if (textureCache[texIndex]) return textureCache[texIndex];

        const texDef = json.textures[texIndex];
        const imgDef = json.images[texDef.source];
        let blob = null;

        if (imgDef.uri) {
            blob = files.get(imgDef.uri) || files.get(imgDef.uri.replace('./',''));
        } else if (imgDef.bufferView !== undefined) {
            const bv = json.bufferViews[imgDef.bufferView];
            const buf = await getBuf(bv.buffer);
            blob = new Blob([buf.slice(bv.byteOffset||0, (bv.byteOffset||0)+bv.byteLength)]);
        }

        if (blob) {
            const url = URL.createObjectURL(blob);
            const tex = new THREE.TextureLoader().load(url);
            tex.flipY = false; 
            
            // Tratamento de encoding para R123
            tex.encoding = THREE.sRGBEncoding; 
            
            textureCache[texIndex] = tex;
            return tex;
        }
        return null;
    };

    // 4. Carregar Materiais E ENVIAR PARA O GERENCIADOR
    const materials = [];
    if (json.materials) {
        for (let mDef of json.materials) {
            const mat = new THREE.MeshStandardMaterial({
                name: mDef.name || 'Material',
                side: mDef.doubleSided ? THREE.DoubleSide : THREE.FrontSide
            });

            if (mDef.pbrMetallicRoughness) {
                const pbr = mDef.pbrMetallicRoughness;
                if (pbr.baseColorFactor) mat.color.fromArray(pbr.baseColorFactor);
                if (pbr.metallicFactor !== undefined) mat.metalness = pbr.metallicFactor;
                if (pbr.roughnessFactor !== undefined) mat.roughness = pbr.roughnessFactor;
                
                // Mapas
                if (pbr.baseColorTexture) mat.map = await loadTex(pbr.baseColorTexture.index);
                if (pbr.metallicRoughnessTexture) {
                    const tex = await loadTex(pbr.metallicRoughnessTexture.index);
                    mat.metalnessMap = tex;
                    mat.roughnessMap = tex;
                }
            }
            
            if (mDef.normalTexture) mat.normalMap = await loadTex(mDef.normalTexture.index);
            if (mDef.emissiveFactor) mat.emissive.setRGB(...mDef.emissiveFactor);
            if (mDef.emissiveTexture) mat.emissiveMap = await loadTex(mDef.emissiveTexture.index);

            // --- INTEGRAÇÃO CRÍTICA COM GERENCIADOR DE MATERIAIS ---
            // Se a função global existir (criada no outro script), registra o material
            if (typeof window.addImportedMaterial === 'function') {
                window.addImportedMaterial(mat);
            }

            materials.push(mat);
        }
    }
    // Material Default (Fallback)
    const defaultMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });

    // 5. Build Meshes
    const meshes = [];
    if (json.meshes) {
        for(let mDef of json.meshes) {
            const grp = new THREE.Group();
            grp.name = mDef.name || "Mesh";
            
            for(let prim of mDef.primitives) {
                const geo = new THREE.BufferGeometry();
                
                // Atributos Obrigatórios
                if(prim.attributes.POSITION !== undefined) 
                    geo.setAttribute('position', new THREE.BufferAttribute(await getAcc(prim.attributes.POSITION), 3));
                
                if(prim.attributes.NORMAL !== undefined) 
                    geo.setAttribute('normal', new THREE.BufferAttribute(await getAcc(prim.attributes.NORMAL), 3));
                else geo.computeVertexNormals();
                
                if(prim.attributes.TEXCOORD_0 !== undefined)
                    geo.setAttribute('uv', new THREE.BufferAttribute(await getAcc(prim.attributes.TEXCOORD_0), 2));
                
                if(prim.indices !== undefined)
                    geo.setIndex(new THREE.BufferAttribute(await getAcc(prim.indices), 1));
                
                // Escolhe o material correto
                const targetMat = (prim.material !== undefined && materials[prim.material]) 
                                ? materials[prim.material] 
                                : defaultMat;

                const mesh = new THREE.Mesh(geo, targetMat); 
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                grp.add(mesh);
            }
            meshes.push(grp);
        }
    }

    // Nodes e Hierarquia Simplificada
    if (json.nodes) {
        meshes.forEach(m => root.add(m));
    } else if (meshes.length > 0) {
         meshes.forEach(m => root.add(m));
    }
}

// Helper: Ajusta ESCALA mas NÃO a Posição (Fix 0,0,0)
function optimizeScaleOnly(group) {
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);

    if (size.lengthSq() === 0) return;

    // Escala Normalizada
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
        const targetSize = 2.0; 
        const scale = targetSize / maxDim; 
        group.scale.set(scale, scale, scale);
        
        // RESET DE POSIÇÃO ABSOLUTA (0,0,0)
        group.position.set(0, 0, 0); 
        
        console.log(`📏 Escala Ajustada: ${scale.toFixed(4)}x. Posição mantida em 0,0,0.`);
    }
}

// ======================================================
// 4. INTEGRAÇÃO UI
// ======================================================
function _model_imp_GLTF() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.gltf,.glb'; 
    input.style.display = 'none';

    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const blobUrl = URL.createObjectURL(file);
        loadGLTF(blobUrl, file.name);
        input.remove();
    };

    document.body.appendChild(input);
    input.click();
}

const gltfBtn = document.getElementById('imp-gltf');
if (gltfBtn) {
    const newBtn = gltfBtn.cloneNode(true);
    gltfBtn.parentNode.replaceChild(newBtn, gltfBtn);
    newBtn.addEventListener('click', _model_imp_GLTF);
}