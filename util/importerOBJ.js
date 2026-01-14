// ======================================================
// 1. SISTEMA DE UI (TERMINAL LOG / PROCESSO HORIZONTAL)
// ======================================================
const LoaderSystem = {
    id: 'console-loader-overlay',
    
    show: function() {
        let el = document.getElementById(this.id);
        if (!el) {
            el = document.createElement('div');
            el.id = this.id;
            
            const styleSheet = document.createElement("style");
            styleSheet.innerText = `
                /* Fundo escuro leve para foco */
                #${this.id} {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(10, 10, 10, 0.85);
                    z-index: 9999;
                    display: flex; flex-direction: column; 
                    align-items: center; justify-content: center;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    transition: opacity 0.3s;
                    opacity: 0;
                    backdrop-filter: blur(2px);
                }

                /* A Caixa do Console Horizontal */
                .console-box {
                    width: 650px;
                    max-width: 90%;
                    background: #050505;
                    border: 1px solid #333;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.8);
                    padding: 0;
                    position: relative;
                    overflow: hidden;
                    border-radius: 4px;
                }

                /* Cabeçalho do Terminal */
                .console-header {
                    background: #151515;
                    padding: 6px 12px;
                    color: #888;
                    font-size: 11px;
                    text-transform: uppercase;
                    border-bottom: 1px solid #222;
                    display: flex; justify-content: space-between;
                    letter-spacing: 1px;
                }

                /* Área de Texto (Log) */
                .console-body {
                    padding: 20px 25px;
                    color: #ccc; 
                    font-size: 13px;
                    min-height: 24px;
                    display: flex;
                    align-items: center;
                }

                .prefix { color: #00ff88; margin-right: 12px; font-weight: bold; text-shadow: 0 0 5px rgba(0,255,136,0.3); }
                .cursor { animation: blink 1s infinite; margin-left: 8px; background: #00ff88; width: 8px; height: 15px; display: inline-block; }

                /* Barra de Progresso Horizontal Fina */
                .progress-track {
                    height: 3px;
                    width: 100%;
                    background: #222;
                    position: absolute;
                    bottom: 0; left: 0;
                }
                .progress-fill {
                    height: 100%;
                    background: #00ff88;
                    width: 0%;
                    transition: width 0.1s linear;
                    box-shadow: 0 0 15px #00ff88;
                }

                @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
            `;
            document.head.appendChild(styleSheet);
            
            el.innerHTML = `
                <div class="console-box">
                    <div class="console-header">
                        <span>SYS.IO.WORKER_THREAD</span>
                        <span>MEM_ALLOC: DYNAMIC</span>
                    </div>
                    <div class="console-body">
                        <span class="prefix">root@importer:~$</span>
                        <span id="console-msg">Inicializando protocolo...</span>
                        <span class="cursor"></span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" id="console-progress"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(el);
        }
        
        el.style.display = 'flex';
        const bar = document.getElementById('console-progress');
        if(bar) bar.style.width = '0%';
        
        requestAnimationFrame(() => el.style.opacity = '1');
    },

    update: function(msg, percent) {
        const txt = document.getElementById('console-msg');
        const bar = document.getElementById('console-progress');
        if(txt) txt.innerText = msg;
        if(bar && percent !== undefined) bar.style.width = percent + '%';
    },

    hide: function() {
        const el = document.getElementById(this.id);
        if (el) {
            this.update("Operação Concluída com Sucesso.", 100);
            setTimeout(() => {
                el.style.opacity = '0';
                setTimeout(() => {
                    el.style.display = 'none';
                    this.update("Aguardando...", 0);
                }, 300);
            }, 600); 
        }
    }
};

// ======================================================
// 2. FUNÇÃO LOAD OBJ "TURBO PRO" (MULTI-OBJECT + INDEXED)
// ======================================================
function loadOBJ(url) {
    const parentObject = new THREE.Group();
    // Nome do grupo pai baseado no arquivo
    const fileName = url.split('/').pop().split('?')[0];
    parentObject.name = fileName; 

    if (typeof LoaderSystem !== 'undefined') {
        LoaderSystem.show();
        LoaderSystem.update("Handshake com Worker...", 0);
    }

    const absoluteUrl = new URL(url, window.location.href).href;

    const workerCode = `
    self.onmessage = async function(e) {
        const url = e.data;
        const log = (msg, pct) => self.postMessage({ type: 'status', text: msg, percent: pct });

        try {
            // --- 1. DOWNLOAD ---
            log('Requisitando Stream Binário...', 5);
            const response = await fetch(url);
            if (!response.ok) throw new Error("HTTP " + response.status);
            
            const contentLength = response.headers.get('content-length');
            const buffer = await response.arrayBuffer();
            const data = new Uint8Array(buffer);
            const len = data.length;

            log('Parseando ' + (len / 1024 / 1024).toFixed(2) + ' MB (Modo Indexed)...', 20);

            // --- 2. ALOCAÇÃO GLOBAL (Pool de Vértices) ---
            const estimatedVerts = Math.floor(len / 30); 
            
            // Buffers GLOBAIS (O arquivo OBJ define v/vn/vt globalmente)
            const vArray = new Float32Array(estimatedVerts * 3);
            const vnArray = new Float32Array(estimatedVerts * 3);
            const vtArray = new Float32Array(estimatedVerts * 2);
            
            let vCount = 0;
            let vnCount = 0;
            let vtCount = 0;

            // --- 3. ESTRUTURA DE OBJETOS ---
            const meshes = []; 
            
            // Objeto atual sendo construído
            // ADICIONADO: indices e indexCache para criar geometria indexada (soldada)
            let currentMesh = {
                name: "Mesh_Base",
                positions: [], 
                normals: [],
                uvs: [],
                indices: [],      // Lista de índices (topologia)
                indexCache: {}    // Mapa "v_vt_vn" -> índice existente
            };

            // Função para salvar o objeto atual e começar um novo
            function flushMesh(newName) {
                // Só salva se tiver geometria
                if (currentMesh.positions.length > 0) {
                    // Limpa o cache antes de salvar para economizar memória na transferência
                    delete currentMesh.indexCache;
                    meshes.push(currentMesh);
                }
                // Reseta para novo objeto
                currentMesh = {
                    name: newName || "Object_" + (meshes.length + 1),
                    positions: [],
                    normals: [],
                    uvs: [],
                    indices: [],
                    indexCache: {}
                };
            }

            // --- 4. PARSER HELPERS ---
            let ptr = 0;
            
            function skipSpace() {
                while (ptr < len && (data[ptr] === 32 || data[ptr] === 9)) ptr++;
            }

            function skipLine() {
                while (ptr < len && data[ptr] !== 10) ptr++;
                ptr++; // Pula o \\n
            }

            function parseString() {
                skipSpace();
                let start = ptr;
                while (ptr < len && data[ptr] !== 10 && data[ptr] !== 13) {
                    ptr++;
                }
                let str = "";
                for (let i = start; i < ptr; i++) str += String.fromCharCode(data[i]);
                return str.trim();
            }

            function parseFloatCustom() {
                skipSpace();
                let sign = 1;
                if (data[ptr] === 45) { sign = -1; ptr++; }
                let val = 0;
                while (ptr < len) {
                    const c = data[ptr];
                    if (c >= 48 && c <= 57) { val = val * 10 + (c - 48); ptr++; } 
                    else break;
                }
                if (data[ptr] === 46) {
                    ptr++;
                    let p = 0.1;
                    while (ptr < len) {
                        const c = data[ptr];
                        if (c >= 48 && c <= 57) { val += (c - 48) * p; p *= 0.1; ptr++; }
                        else break;
                    }
                }
                if (data[ptr] === 101 || data[ptr] === 69) {
                    ptr++;
                    let eSign = 1;
                    if(data[ptr]===45){eSign=-1;ptr++} else if(data[ptr]===43)ptr++;
                    let exp = 0;
                    while(ptr<len){
                        const c=data[ptr];
                        if(c>=48&&c<=57){exp=exp*10+(c-48);ptr++} else break;
                    }
                    val = val * Math.pow(10, exp*eSign);
                }
                return val * sign;
            }

            function parseIntCustom() {
                skipSpace();
                let sign = 1;
                if (data[ptr] === 45) { sign = -1; ptr++; }
                let val = 0;
                while (ptr < len) {
                    const c = data[ptr];
                    if (c >= 48 && c <= 57) { val = val * 10 + (c - 48); ptr++; }
                    else break;
                }
                return val * sign;
            }

            // --- 5. LOOP PRINCIPAL ---
            let lastLog = 0;

            while (ptr < len) {
                // UI Update
                if (ptr - lastLog > 800000) { 
                    const pct = Math.round((ptr / len) * 100);
                    if (pct % 5 === 0) log('Processando Topologia... ' + pct + '%', 20 + (pct * 0.7));
                    lastLog = ptr;
                }

                let c = data[ptr];

                if (c === 10 || c === 13 || c === 32) { ptr++; continue; }
                if (c === 35) { skipLine(); continue; }

                // 'o' ou 'g'
                if (c === 111 || c === 103) { 
                    ptr++; 
                    if (data[ptr] === 32 || data[ptr] === 10 || data[ptr] === 13) {
                        const name = parseString();
                        flushMesh(name);
                        continue;
                    }
                }

                // 'v...'
                if (c === 118) { 
                    ptr++;
                    const c2 = data[ptr];
                    
                    // v
                    if (c2 === 32) { 
                        vArray[vCount++] = parseFloatCustom();
                        vArray[vCount++] = parseFloatCustom();
                        vArray[vCount++] = parseFloatCustom();
                        continue;
                    }
                    // vn
                    if (c2 === 110) { 
                        ptr++;
                        vnArray[vnCount++] = parseFloatCustom();
                        vnArray[vnCount++] = parseFloatCustom();
                        vnArray[vnCount++] = parseFloatCustom();
                        continue;
                    }
                    // vt
                    if (c2 === 116) { 
                        ptr++;
                        vtArray[vtCount++] = parseFloatCustom();
                        vtArray[vtCount++] = parseFloatCustom();
                        skipLine(); 
                        continue;
                    }
                }

                // 'f' (Face)
                if (c === 102) { 
                    ptr++;
                    const faceVerts = []; 
                    
                    while (ptr < len && data[ptr] !== 10 && data[ptr] !== 13) {
                        skipSpace();
                        if (data[ptr] === 10 || data[ptr] === 13) break;
                        
                        const vIdx = parseIntCustom();
                        if (vIdx === 0) break; 

                        let vtIdx = 0;
                        let vnIdx = 0;

                        if (data[ptr] === 47) { // '/'
                            ptr++;
                            if (data[ptr] !== 47) vtIdx = parseIntCustom();
                            if (data[ptr] === 47) {
                                ptr++;
                                vnIdx = parseIntCustom();
                            }
                        }
                        faceVerts.push({ v: vIdx, vt: vtIdx, vn: vnIdx });
                    }

                    // Triangulação
                    if (faceVerts.length >= 3) {
                        for (let i = 1; i < faceVerts.length - 1; i++) {
                            addVertexToCurrent(faceVerts[0]);
                            addVertexToCurrent(faceVerts[i]);
                            addVertexToCurrent(faceVerts[i+1]);
                        }
                    }
                    continue;
                }

                skipLine();
            }

            // MUDANÇA CRÍTICA: Lógica de Soldagem (Indexing)
            function addVertexToCurrent(idxData) {
                // Cria uma chave única baseada na combinação v/vt/vn
                // Se dois triângulos usam o mesmo v, vt e vn, eles devem compartilhar o índice.
                const key = idxData.v + '_' + idxData.vt + '_' + idxData.vn;

                // Se já existe no cache deste mesh, reutiliza o índice (SOLDA O VÉRTICE)
                if (currentMesh.indexCache[key] !== undefined) {
                    currentMesh.indices.push(currentMesh.indexCache[key]);
                    return;
                }

                // Se não existe, cria um novo vértice físico
                const newIndex = currentMesh.positions.length / 3;
                currentMesh.indexCache[key] = newIndex;
                currentMesh.indices.push(newIndex);

                // --- Adiciona Dados aos Arrays ---
                
                // Position
                let vi = idxData.v;
                if (vi < 0) vi = (vCount/3) + vi + 1;
                vi = vi - 1; 
                currentMesh.positions.push(vArray[vi*3], vArray[vi*3+1], vArray[vi*3+2]);

                // UV
                if (idxData.vt !== 0) {
                    let ti = idxData.vt;
                    if (ti < 0) ti = (vtCount/2) + ti + 1;
                    ti = ti - 1;
                    currentMesh.uvs.push(vtArray[ti*2], vtArray[ti*2+1]);
                } else {
                    currentMesh.uvs.push(0, 0);
                }

                // Normal
                if (idxData.vn !== 0) {
                    let ni = idxData.vn;
                    if (ni < 0) ni = (vnCount/3) + ni + 1;
                    ni = ni - 1;
                    currentMesh.normals.push(vnArray[ni*3], vnArray[ni*3+1], vnArray[ni*3+2]);
                } else {
                    currentMesh.normals.push(0, 1, 0); 
                }
            }

            flushMesh();

            // --- 6. SERIALIZAÇÃO FINAL (AGORA COM INDICES) ---
            log('Otimizando Topologia...', 95);

            const finalParts = [];
            const transferList = [];

            for (let m of meshes) {
                const p32 = new Float32Array(m.positions);
                const n32 = new Float32Array(m.normals);
                const u32 = new Float32Array(m.uvs);
                // Cria buffer de índices
                const i32 = new Uint32Array(m.indices);

                finalParts.push({
                    name: m.name,
                    positions: p32,
                    normals: n32,
                    uvs: u32,
                    indices: i32 // Envia os índices
                });

                transferList.push(p32.buffer, n32.buffer, u32.buffer, i32.buffer);
            }

            self.postMessage({ type: 'success', parts: finalParts }, transferList);

        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));

    worker.postMessage(absoluteUrl);

    worker.onmessage = function(e) {
        const msg = e.data;

        if (msg.type === 'status') {
            if (typeof LoaderSystem !== 'undefined') LoaderSystem.update(msg.text, msg.percent);
        }
        else if (msg.type === 'success') {
            console.log(`✓ OBJ Importado (Indexed): ${msg.parts.length} partes.`);
            
            const defaultMaterial = new THREE.MeshStandardMaterial({
                color: 0xeeeeee,
                roughness: 0.6,
                metalness: 0.1,
                side: THREE.DoubleSide
            });

            msg.parts.forEach(part => {
                const geometry = new THREE.BufferGeometry();
                
                // Configura índices (Isso é o que permite a soldagem funcionar)
                if (part.indices && part.indices.length > 0) {
                    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
                }

                geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
                
                if (part.normals.length > 0) {
                      geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
                } else {
                    geometry.computeVertexNormals();
                }

                geometry.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2));

                const mesh = new THREE.Mesh(geometry, defaultMaterial.clone());
                mesh.name = part.name;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.frustumCulled = true; 
                
                parentObject.add(mesh);
            });
            
            if (typeof scene !== 'undefined') scene.add(parentObject);
            if (typeof LoaderSystem !== 'undefined') LoaderSystem.hide();
            
            worker.terminate();
        } 
        else if (msg.type === 'error') {
            console.error(msg.error);
            if (typeof LoaderSystem !== 'undefined') LoaderSystem.update("ERRO CRÍTICO: " + msg.error, 100);
            worker.terminate();
        }
    };

    return parentObject;
}