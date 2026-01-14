//main_anim.js
// =========================================================
// RULER TIMELINE & PRO TOOLS (TRUE STOP-MOTION FPS)
// Interpolação Hermite Profissional (como Maya/Blender)
// =========================================================

// 1. MATH CORE - BEZIER CÚBICA COMPLETA
const BezierEasing = {
    // Resolve a curva Bezier corretamente
    // Dado um t de entrada (0-1), encontra o Y correspondente
    sampleCurve: function(t, x1, y1, x2, y2) {
        // Parâmetros da curva cúbica: P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1)
        const c = 3 * x1;
        const b = 3 * (x2 - x1) - c;
        const a = 1 - c - b;
        
        // Resolve x = at³ + bt² + ct para encontrar t que dá o x desejado
        return this.sampleCurveY(t, y1, y2);
    },
    
    sampleCurveY: function(t, y1, y2) {
        // Calcula Y usando os control points Y
        const oneMinusT = 1 - t;
        const oneMinusTSquared = oneMinusT * oneMinusT;
        const tSquared = t * t;
        
        return 3 * oneMinusTSquared * t * y1 + 
               3 * oneMinusT * tSquared * y2 + 
               tSquared * t;
    },
    
    // Função principal que resolve X->Y na curva Bezier
    get: function(x, x1, y1, x2, y2) {
        // Linear: retorna direto
        if (x1 === y1 && x2 === y2) {
            return x;
        }
        
        // Usa Newton-Raphson para encontrar t que corresponde ao x
        let t = x; // Chute inicial
        
        // Iterações para convergir
        for (let i = 0; i < 8; i++) {
            const currentX = this.sampleCurveX(t, x1, x2);
            const currentSlope = this.sampleCurveDerivativeX(t, x1, x2);
            
            if (currentSlope === 0) break;
            
            const deltaX = currentX - x;
            t -= deltaX / currentSlope;
        }
        
        return this.sampleCurveY(t, y1, y2);
    },
    
    sampleCurveX: function(t, x1, x2) {
        const oneMinusT = 1 - t;
        const oneMinusTSquared = oneMinusT * oneMinusT;
        const tSquared = t * t;
        
        return 3 * oneMinusTSquared * t * x1 + 
               3 * oneMinusT * tSquared * x2 + 
               tSquared * t;
    },
    
    sampleCurveDerivativeX: function(t, x1, x2) {
        const oneMinusT = 1 - t;
        const oneMinusTSquared = oneMinusT * oneMinusT;
        const tSquared = t * t;
        
        return 3 * oneMinusTSquared * x1 + 
               6 * oneMinusT * t * (x2 - x1) + 
               3 * tSquared * (1 - x2);
    }
};

const AnimationTimeline = {
    // Configurações
    startFrame: 0,
    endFrame: 50,
    currentFrame: 0,
    
    fps: 30, 
    BASE_FPS: 30, 

    isPlaying: false,
    
    dom: {},
    lastSelectedID: null,
    
    // Estado do Editor
    activeKeyIndex: -1,
    isDraggingHandle: null, 
    currentCurve: [0.33, 0.33, 0.67, 0.67], // Padrão Auto (smooth)
    
    lastTime: 0,
    keyframeClipboard: null,

    init: function() {
        this.injectStyles();
        this.createDOM();
        this.generateRulerTicks();
        this.setupInteractions();
        this.setupBezierInteractions(); 
        this.startSelectionCheck();
        
        window.addEventListener('mousedown', (e) => this.handleOutsideClick(e));
        window.addEventListener('touchstart', (e) => this.handleOutsideClick(e));

        // Expõe método de debug globalmente
        window.debugAnimation = () => this.debugAnimation();

        console.log("✓ Timeline: Quaternion-Based Animation System (Gimbal Lock Free!)");
        console.log("  - Bezier easing curves: ENABLED");
        console.log("  - Quaternion SLERP interpolation: ENABLED");
        console.log("  - Use window.debugAnimation() to check animation state");
        console.log("  - Scene reference:", (typeof scene !== 'undefined' && scene) ? "✓ Found" : "❌ Not found (will auto-detect on first use)");
    },

    show: function() {
        if (this.dom.container) {
            this.dom.container.style.display = 'flex';
            this.generateRulerTicks();
        }
    },

    hide: function() {
        if (this.dom.container) {
            this.dom.container.style.display = 'none';
        }
        
        if (this.isPlaying) {
            this.isPlaying = false;
            if(this.dom.btnPlay) this.dom.btnPlay.innerText = '▶';
        }
        
        this.goToFrame(this.startFrame);
        
        if (this.dom.popup) this.dom.popup.style.display = 'none';
    },

    handleOutsideClick: function(e) {
        const popup = this.dom.popup;
        const btn = this.dom.btnCurve;
        if (popup.style.display === 'flex') {
            if (!popup.contains(e.target) && !btn.contains(e.target)) {
                popup.style.display = 'none';
            }
        }
    },

    // =========================================================
    // VISUAL
    // =========================================================
    injectStyles: function() {
        const style = document.createElement('style');
        style.innerHTML = `
            #anim-timeline { 
                position: fixed; bottom: 0; left: 0; width: 100%; height: 60px; 
                background-color: #22272B; border-top: 1px solid #111; 
                font-family: 'Segoe UI', sans-serif; user-select: none; 
                z-index: 99999; 
                display: none;
                flex-direction: column; 
            }
            #anim-controls { 
                height: 28px; background-color: #1D2123; 
                display: flex; align-items: center; padding: 0 10px; 
                border-bottom: 1px solid #111; 
            }
            
            .anim-btn { 
                background: #2b3035; border: 1px solid #000; color: #ccc; 
                cursor: pointer; margin-right: 4px; height: 20px; 
                display: flex; align-items: center; justify-content: center;
                font-size: 11px; padding: 0 6px; transition: all 0.1s;
                border-radius: 0px; outline: none;
            }
            .anim-btn:hover { background: #4bf3c9; color: #000; border-color: #4bf3c9; }
            .anim-btn:active { background: #3aa88b; }
            .anim-btn:disabled { opacity: 0.3; cursor: not-allowed; }
            .anim-btn svg { width: 14px; height: 14px; fill: currentColor; }
            
            #anim-right-group { margin-left: auto; display: flex; align-items: center; }
            
            .anim-label { font-size: 9px; color: #666; margin-left: 8px; margin-right: 3px; font-weight: bold; text-transform: uppercase;}
            .anim-input {
                background: #000; border: 1px solid #444; color: #4bf3c9;
                width: 35px; height: 18px; font-size: 10px; text-align: center;
                border-radius: 0px; outline: none; font-family: monospace;
            }
            .anim-input:focus { border-color: #4bf3c9; }
            .anim-sep { width: 1px; height: 16px; background: #333; margin: 0 8px; }

            #anim-counter { 
                background: #000; border: 1px solid #444; color: #4bf3c9; 
                padding: 2px 8px; min-width: 40px; text-align: center; margin-left: 5px; 
                font-weight: bold; letter-spacing: 1px; font-size: 11px;
            }
            
            #anim-track-container { flex-grow: 1; position: relative; overflow-x: auto; overflow-y: hidden; background-color: #22272B; }
            #anim-ruler { position: relative; height: 100%; min-width: 100%; display: flex; align-items: flex-end; padding-left: 20px; padding-right: 20px; cursor: crosshair; }
            .frame-tick { width: 10px; height: 40%; border-left: 1px solid #444; box-sizing: border-box; position: relative; flex-shrink: 0; }
            .frame-tick.major { height: 100%; border-left: 1px solid #777; }
            .frame-tick.major span { position: absolute; top: 2px; left: 3px; font-size: 9px; color: #888; }
            #anim-playhead { position: absolute; top: 0; left: 0; width: 2px; height: 100%; background-color: #4bf3c9; pointer-events: none; z-index: 10; }
            .keyframe-marker { position: absolute; bottom: 2px; width: 8px; height: 8px; background: #ffcc00; transform: rotate(45deg); border: 1px solid #000; left: -4px; z-index: 5; pointer-events: none; }

            #bezier-editor {
                position: absolute; bottom: 62px; left: 10px; width: 140px;
                background: #1D2123; border: 2px solid #000; border-radius: 0px; 
                display: none; flex-direction: column; z-index: 100000;
            }
            .curve-header { background: #111; color: #888; font-size: 10px; padding: 4px; text-align: center; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #333; }
            .curve-area { width: 100%; height: 140px; background: #151515; position: relative; cursor: crosshair; touch-action: none; }
            #curve-canvas { width: 100%; height: 100%; display: block; }
            .curve-presets { display: flex; height: 32px; border-top: 2px solid #000; }
            .preset-btn { flex: 1; background: #2b3035; border: none; border-right: 1px solid #000; color: #aaa; cursor: pointer; border-radius: 0px; display: flex; align-items: center; justify-content: center; transition: background 0.1s; outline: none; font-size: 9px; }
            .preset-btn:focus { outline: none; }
            .preset-btn:last-child { border-right: none; }
            .preset-btn:hover { background: #333; color: #fff; }
            .preset-btn.active { background: #4bf3c9; color: #000; }
            .preset-btn svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; fill: none; }
        `;
        document.head.appendChild(style);
    },

    // =========================================================
    // HTML
    // =========================================================
    createDOM: function() {
        const container = document.createElement('div');
        container.id = 'anim-timeline';
        
        const iGraph = `<svg viewBox="0 0 24 24"><path d="M3 3v18h18" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 17c2-5 5-9 10-10" stroke="#4bf3c9" stroke-width="2" fill="none"/></svg>`;
        const iCopy = `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
        const iPaste = `<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke="currentColor" stroke-width="2" fill="none"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
        const iCut = `<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2" fill="none"/><line x1="20" y1="4" x2="8.12" y2="15.88" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="14.47" y1="14.48" x2="20" y2="20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8.12" y1="8.12" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
        const iTrash = `<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" fill="none"/><line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" stroke-width="2"/><line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" stroke-width="2"/></svg>`;
        
        const iconLinear = `<svg viewBox="0 0 24 24"><line x1="4" y1="20" x2="20" y2="4" /></svg>`;
        const iconEaseIn = `<svg viewBox="0 0 24 24"><path d="M4 20 C 15 20, 20 15, 20 4" /></svg>`;
        const iconEaseOut = `<svg viewBox="0 0 24 24"><path d="M4 20 C 4 9, 9 4, 20 4" /></svg>`;
        const iconEaseInOut = `<svg viewBox="0 0 24 24"><path d="M4 20 C 4 15, 8 12, 12 12 C 16 12, 20 9, 20 4" /></svg>`;
        const iconAuto = `<svg viewBox="0 0 24 24"><path d="M4 20 C 8 18, 16 6, 20 4" /></svg>`;
        const iconBounce = `<svg viewBox="0 0 24 24"><path d="M4 20 L 10 4 L 14 16 L 20 4" /></svg>`;
        const iconElastic = `<svg viewBox="0 0 24 24"><path d="M4 20 Q 8 4, 12 12 T 20 4" /></svg>`;

        container.innerHTML = `
            <div id="anim-controls">
                <button class="anim-btn" id="btn-play">▶</button>
                <button class="anim-btn" id="btn-stop">■</button>
                <div class="anim-sep"></div>
                <button class="anim-btn" id="btn-curve" title="Editor Gráfico">${iGraph}</button>
                <button class="anim-btn" id="btn-key" style="color: #ffcc00; border-color: #ffcc00;">◆ Key</button>
                <div id="anim-counter">0</div>

                <div id="anim-right-group">
                    <button class="anim-btn" id="btn-copy" title="Copiar">${iCopy}</button>
                    <button class="anim-btn" id="btn-paste" title="Colar">${iPaste}</button>
                    <button class="anim-btn" id="btn-cut" title="Recortar">${iCut}</button>
                    <div class="anim-sep"></div>
                    <button class="anim-btn" id="btn-delete" title="Deletar" style="color:#ff5555">${iTrash}</button>
                    <div class="anim-sep"></div>
                    <span class="anim-label">FPS</span>
                    <input type="number" id="inp-fps" class="anim-input" value="${this.fps}">
                    <span class="anim-label">MAX</span>
                    <input type="number" id="inp-max" class="anim-input" value="${this.endFrame}">
                </div>
            </div>
            
            <div id="anim-track-container">
                <div id="anim-ruler"><div id="anim-playhead"></div></div>
            </div>
            
            <div id="bezier-editor">
                <div class="curve-header">Interpolação</div>
                <div class="curve-area"><canvas id="curve-canvas" width="280" height="280"></canvas></div>
                <div class="curve-presets">
                    <button class="preset-btn" title="Linear" data-type="linear">${iconLinear}</button>
                    <button class="preset-btn" title="Ease In" data-type="easeIn">${iconEaseIn}</button>
                    <button class="preset-btn" title="Ease Out" data-type="easeOut">${iconEaseOut}</button>
                    <button class="preset-btn" title="Ease In-Out" data-type="easeInOut">${iconEaseInOut}</button>
                </div>
                <div class="curve-presets" style="border-top: 1px solid #000;">
                    <button class="preset-btn" title="Auto (Smooth)" data-type="auto">${iconAuto}</button>
                    <button class="preset-btn" title="Bounce" data-type="bounce">${iconBounce}</button>
                    <button class="preset-btn" title="Elastic" data-type="elastic">${iconElastic}</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        this.dom = {
            container: container,
            ruler: document.getElementById('anim-ruler'),
            playhead: document.getElementById('anim-playhead'),
            counter: document.getElementById('anim-counter'),
            btnPlay: document.getElementById('btn-play'),
            btnStop: document.getElementById('btn-stop'),
            btnKey: document.getElementById('btn-key'),
            btnCurve: document.getElementById('btn-curve'),
            btnCopy: document.getElementById('btn-copy'),
            btnPaste: document.getElementById('btn-paste'),
            btnCut: document.getElementById('btn-cut'),
            btnDelete: document.getElementById('btn-delete'),
            inpFPS: document.getElementById('inp-fps'),
            inpMax: document.getElementById('inp-max'),
            popup: document.getElementById('bezier-editor'),
            canvas: document.getElementById('curve-canvas'),
            presets: document.querySelectorAll('.preset-btn')
        };
        
        this.ctx = this.dom.canvas.getContext('2d');
        this.ctx.scale(2, 2); 
    },

    generateRulerTicks: function() {
        document.querySelectorAll('.frame-tick').forEach(e => e.remove());
        for (let i = 0; i <= this.endFrame; i++) {
            const tick = document.createElement('div');
            tick.className = i % 10 === 0 ? 'frame-tick major' : 'frame-tick';
            if (i % 10 === 0) tick.innerHTML = `<span>${i}</span>`;
            tick.dataset.frame = i;
            this.dom.ruler.appendChild(tick);
        }
        this.dom.ruler.style.width = (this.endFrame * 10 + 100) + 'px';
    },

    setupInteractions: function() {
        const self = this;
        this.dom.ruler.addEventListener('mousedown', e => {
            self.handleScrub(e);
            const move = ev => self.handleScrub(ev);
            const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        });

        this.dom.btnPlay.addEventListener('click', () => this.togglePlay());
        this.dom.btnStop.addEventListener('click', () => { 
            this.isPlaying = false; 
            this.goToFrame(this.startFrame);
            this.dom.btnPlay.innerText = '▶'; 
        });
        this.dom.btnKey.addEventListener('click', () => this.saveKeyframe());

        this.dom.btnCurve.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = this.dom.popup.style.display === 'none' || this.dom.popup.style.display === '';
            if (isHidden) {
                if (this.loadActiveSegmentCurve()) {
                    this.dom.popup.style.display = 'flex';
                    this.drawCurve();
                    this.dom.btnCurve.style.color = "#4bf3c9";
                } else {
                    this.dom.btnCurve.style.color = "#ff3333";
                    setTimeout(() => this.dom.btnCurve.style.color = "#fff", 500);
                }
            } else {
                this.dom.popup.style.display = 'none';
                this.dom.btnCurve.style.color = "#fff";
            }
        });

        this.dom.btnCopy.addEventListener('click', () => this.copyKeyframe());
        this.dom.btnPaste.addEventListener('click', () => this.pasteKeyframe());
        this.dom.btnCut.addEventListener('click', () => this.cutKeyframe());
        this.dom.btnDelete.addEventListener('click', () => this.deleteKeyframe());
        
        this.dom.inpFPS.addEventListener('change', (e) => {
            let v = parseInt(e.target.value);
            if(v < 1) v = 1;
            this.fps = v;
            console.log("FPS changed to:", this.fps);
        });
        
        this.dom.inpMax.addEventListener('change', (e) => {
            const newMax = parseInt(e.target.value) || 100;
            if(newMax > 0) {
                this.endFrame = newMax;
                this.generateRulerTicks();
            }
        });

        this.dom.presets.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.currentTarget.dataset.type;
                // Presets compatíveis com Maya/After Effects
                if (type === 'linear') this.currentCurve = [0, 0, 1, 1];
                if (type === 'easeIn') this.currentCurve = [0.42, 0, 1, 1]; // Maya default ease-in
                if (type === 'easeOut') this.currentCurve = [0, 0, 0.58, 1]; // Maya default ease-out
                if (type === 'easeInOut') this.currentCurve = [0.42, 0, 0.58, 1]; // Ease both sides
                if (type === 'auto') this.currentCurve = [0.33, 0.33, 0.67, 0.67]; // Smooth (auto tangent)
                if (type === 'bounce') this.currentCurve = [0.68, -0.55, 0.265, 1.55]; // Bounce effect
                if (type === 'elastic') this.currentCurve = [0.68, -0.75, 0.265, 1.55]; // Elastic spring
                this.drawCurve();
                this.saveCurveToKeyframe();
            });
        });
    },

    deleteKeyframe: function() {
        const obj = window.selectedObject;
        if(!obj || !obj.userData.animationData) return;
        const index = obj.userData.animationData.findIndex(k => k.frame === this.currentFrame);
        if(index > -1) {
            obj.userData.animationData.splice(index, 1);
            this.loadKeyframesVisuals(obj);
            this.goToFrame(this.currentFrame);
        }
    },
    
    copyKeyframe: function() {
        const obj = window.selectedObject;
        if(!obj || !obj.userData.animationData) return;
        const key = obj.userData.animationData.find(k => k.frame === this.currentFrame);
        if(key) {
            this.keyframeClipboard = JSON.parse(JSON.stringify(key));
            this.dom.btnCopy.style.color = "#4bf3c9";
            setTimeout(() => this.dom.btnCopy.style.color = "#ccc", 200);
        }
    },
    
    pasteKeyframe: function() {
        if(!this.keyframeClipboard) return;
        const obj = window.selectedObject;
        if(!obj) return;
        if(!obj.userData.animationData) obj.userData.animationData = [];
        
        const existingIndex = obj.userData.animationData.findIndex(k => k.frame === this.currentFrame);
        if(existingIndex > -1) obj.userData.animationData.splice(existingIndex, 1);
        
        const newKey = JSON.parse(JSON.stringify(this.keyframeClipboard));
        newKey.frame = this.currentFrame;
        
        obj.userData.animationData.push(newKey);
        obj.userData.animationData.sort((a, b) => a.frame - b.frame);
        
        this.loadKeyframesVisuals(obj);
        this.goToFrame(this.currentFrame);
        this.dom.btnPaste.style.color = "#4bf3c9";
        setTimeout(() => this.dom.btnPaste.style.color = "#ccc", 200);
    },
    
    cutKeyframe: function() {
        this.copyKeyframe();
        this.deleteKeyframe();
    },

    setupBezierInteractions: function() {
        const canvas = this.dom.canvas;
        const getPointerPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            let clientX, clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }
            const size = 140; 
            const mouseX = (clientX - rect.left) / size; 
            const mouseY = 1.0 - ((clientY - rect.top) / size); 
            return { x: mouseX, y: mouseY };
        };

        const onPointerDown = (e) => {
            if(e.cancelable && e.type === 'touchstart') e.preventDefault();
            const pos = getPointerPos(e);
            const p1 = {x: this.currentCurve[0], y: this.currentCurve[1]};
            const p2 = {x: this.currentCurve[2], y: this.currentCurve[3]};
            const dist1 = Math.hypot(p1.x - pos.x, p1.y - pos.y);
            const dist2 = Math.hypot(p2.x - pos.x, p2.y - pos.y);
            if (dist1 < 0.2) this.isDraggingHandle = 1;
            else if (dist2 < 0.2) this.isDraggingHandle = 2;
            else this.isDraggingHandle = null;
        };

        const onPointerMove = (e) => {
            if (!this.isDraggingHandle) return;
            if(e.cancelable) e.preventDefault();
            const pos = getPointerPos(e);
            const mx = Math.max(0, Math.min(1, pos.x)); 
            const my = pos.y; 
            if (this.isDraggingHandle === 1) { this.currentCurve[0] = mx; this.currentCurve[1] = my; } 
            else { this.currentCurve[2] = mx; this.currentCurve[3] = my; }
            this.drawCurve();
            this.saveCurveToKeyframe();
        };

        const onPointerUp = () => { this.isDraggingHandle = null; };

        canvas.addEventListener('mousedown', onPointerDown);
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);
        canvas.addEventListener('touchstart', onPointerDown, {passive: false});
        window.addEventListener('touchmove', onPointerMove, {passive: false});
        window.addEventListener('touchend', onPointerUp);
    },

    drawCurve: function() {
        const ctx = this.ctx;
        const w = 140; const h = 140;
        const [x1, y1, x2, y2] = this.currentCurve;
        
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();
        
        const p1x = x1 * w; const p1y = h - (y1 * h);
        const p2x = x2 * w; const p2y = h - (y2 * h);
        
        ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(p1x, p1y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(p2x, p2y); ctx.stroke();
        
        ctx.strokeStyle = '#4bf3c9'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, h);
        ctx.bezierCurveTo(p1x, p1y, p2x, p2y, w, 0);
        ctx.stroke();
        
        ctx.fillStyle = '#fff'; 
        ctx.beginPath(); ctx.arc(p1x, p1y, 6, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(p2x, p2y, 6, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p1x, p1y, 6, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.arc(p2x, p2y, 6, 0, Math.PI*2); ctx.stroke();
    },

    handleScrub: function(e) {
        if (this.isPlaying) this.togglePlay();
        const rect = this.dom.ruler.getBoundingClientRect();
        let frame = Math.round((e.clientX - rect.left - 20) / 10);
        this.goToFrame(Math.max(0, Math.min(frame, this.endFrame)));
        if (this.dom.popup.style.display === 'flex') {
            this.loadActiveSegmentCurve();
            this.drawCurve();
        }
    },

    startSelectionCheck: function() {
        setInterval(() => {
            const obj = window.selectedObject;
            if (!obj) { 
                if (this.lastSelectedID) { 
                    this.clearVisualMarkers(); 
                    this.lastSelectedID = null; 
                } 
                return; 
            }
            if (obj.uuid !== this.lastSelectedID) {
                this.lastSelectedID = obj.uuid;
                this.loadKeyframesVisuals(obj);
            }
        }, 300);
    },

    saveKeyframe: function() {
        const obj = window.selectedObject;
        if (!obj) { alert("Selecione um objeto!"); return; }
        
        obj.updateMatrixWorld(true);
        if (!obj.userData.animationData) obj.userData.animationData = [];

        const existingIndex = obj.userData.animationData.findIndex(k => k.frame === this.currentFrame);
        
        let curve = [0.33, 0.33, 0.67, 0.67]; // Padrão Auto (smooth)
        if (existingIndex > -1) {
            curve = obj.userData.animationData[existingIndex].curve || curve;
            obj.userData.animationData.splice(existingIndex, 1);
        }

        // SOLUÇÃO DEFINITIVA PARA GIMBAL LOCK:
        // Salva APENAS Quaternion (representação matemática correta)
        // Euler é apenas para debug/visualização
        const keyframe = {
            frame: this.currentFrame,
            pos: obj.position.toArray(),
            quat: obj.quaternion.toArray(), // QUATERNION (usado na interpolação)
            scl: obj.scale.toArray(),
            curve: curve,
            // Debug info (não usado na animação)
            _debugEuler: [obj.rotation.x, obj.rotation.y, obj.rotation.z]
        };
        
        obj.userData.animationData.push(keyframe);
        obj.userData.animationData.sort((a, b) => a.frame - b.frame);
        this.addVisualMarker(this.currentFrame);
        
        // DEBUG: Mostra feedback visual
        const eulerDeg = keyframe._debugEuler.map(r => (r * 180 / Math.PI).toFixed(1) + '°');
        console.log(`✓ Keyframe saved at frame ${this.currentFrame}:`, {
            pos: keyframe.pos,
            rotation: eulerDeg,
            quat: keyframe.quat
        });
        this.dom.btnKey.style.background = "#4bf3c9";
        this.dom.btnKey.style.color = "#000";
        setTimeout(() => {
            this.dom.btnKey.style.background = "";
            this.dom.btnKey.style.color = "#ffcc00";
        }, 300);
    },
    
    loadActiveSegmentCurve: function() {
        const obj = window.selectedObject;
        if (!obj || !obj.userData.animationData) return false;
        const data = obj.userData.animationData;
        const nextIndex = data.findIndex(k => k.frame > this.currentFrame);
        if (nextIndex > 0) {
            this.activeKeyIndex = nextIndex - 1;
            const key = data[this.activeKeyIndex];
            this.currentCurve = key.curve ? [...key.curve] : [0.33, 0.33, 0.67, 0.67];
            return true;
        }
        return false;
    },
    
    saveCurveToKeyframe: function() {
        const obj = window.selectedObject;
        if (obj && this.activeKeyIndex > -1 && obj.userData.animationData[this.activeKeyIndex]) {
            obj.userData.animationData[this.activeKeyIndex].curve = [...this.currentCurve];
            this.evaluateAnimation(obj, this.currentFrame);
        }
    },

    loadKeyframesVisuals: function(obj) {
        this.clearVisualMarkers();
        if (obj.userData.animationData) {
            obj.userData.animationData.forEach(k => this.addVisualMarker(k.frame));
        }
    },
    
    clearVisualMarkers: function() { 
        this.dom.ruler.querySelectorAll('.keyframe-marker').forEach(m => m.remove()); 
    },
    
    addVisualMarker: function(frame) {
        const tick = this.dom.ruler.querySelector(`.frame-tick[data-frame="${frame}"]`);
        if (tick && !tick.querySelector('.keyframe-marker')) {
            const m = document.createElement('div'); 
            m.className = 'keyframe-marker'; 
            tick.appendChild(m);
        }
    },

    // =========================================================
    // DEBUG HELPER
    // =========================================================
    debugAnimation: function() {
        const obj = window.selectedObject;
        if (!obj) {
            console.log("❌ No object selected");
            return;
        }
        
        console.log("=== ANIMATION DEBUG ===");
        console.log("Object:", obj.name || obj.uuid);
        console.log("Current Frame:", this.currentFrame);
        console.log("Keyframes:", obj.userData.animationData);
        console.log("Current Position:", obj.position);
        console.log("Current Rotation (Euler):", obj.rotation);
        console.log("Current Scale:", obj.scale);
        console.log("Scene reference:", (typeof scene !== 'undefined' && scene) ? "✓" : "❌");
        console.log("======================");
    },

    // =========================================================
    // MOTOR DE INTERPOLAÇÃO (QUATERNION PURO - SEM GIMBAL LOCK)
    // =========================================================
    evaluateAnimation: function(obj, frame) {
        if (!obj.userData.animationData || obj.userData.animationData.length === 0) return;
        const keys = obj.userData.animationData;
        
        // Caso especial: Antes do primeiro keyframe
        if (frame <= keys[0].frame) { 
            this.applyTransform(obj, keys[0]); 
            return; 
        }
        
        // Caso especial: Depois do último keyframe
        if (frame >= keys[keys.length - 1].frame) { 
            this.applyTransform(obj, keys[keys.length - 1]); 
            return; 
        }

        // Encontra segmento
        const nextIndex = keys.findIndex(key => key.frame > frame);
        if (nextIndex === -1) return;

        const prevKey = keys[nextIndex - 1];
        const nextKey = keys[nextIndex];

        // Calcula t normalizado [0,1] no segmento
        const duration = nextKey.frame - prevKey.frame;
        const progress = frame - prevKey.frame;
        const linearT = progress / duration;

        // Aplica curva de easing
        const curve = prevKey.curve || [0.33, 0.33, 0.67, 0.67];
        const easedT = BezierEasing.get(linearT, curve[0], curve[1], curve[2], curve[3]);

        // ===== POSIÇÃO (LERP SIMPLES) =====
        const p0 = new THREE.Vector3().fromArray(prevKey.pos);
        const p1 = new THREE.Vector3().fromArray(nextKey.pos);
        const pos = p0.lerp(p1, easedT);

        // ===== ESCALA (LERP SIMPLES) =====
        const s0 = new THREE.Vector3().fromArray(prevKey.scl);
        const s1 = new THREE.Vector3().fromArray(nextKey.scl);
        const scl = s0.lerp(s1, easedT);
        
        // ===== ROTAÇÃO (QUATERNION SLERP - SEM GIMBAL LOCK!) =====
        // Usa sempre Quaternion, NUNCA Euler (solução definitiva)
        const q1 = new THREE.Quaternion().fromArray(prevKey.quat || prevKey.rot);
        const q2 = new THREE.Quaternion().fromArray(nextKey.quat || nextKey.rot);
        
        // CRÍTICO: Força caminho mais curto
        // Se o dot product é negativo, inverte q2 para pegar rota mais curta
        if (q1.dot(q2) < 0) {
            q2.x = -q2.x;
            q2.y = -q2.y;
            q2.z = -q2.z;
            q2.w = -q2.w;
        }
        
        const rot = q1.clone().slerp(q2, easedT);

        // Aplica transformação
        obj.position.copy(pos);
        obj.quaternion.copy(rot);
        obj.scale.copy(scl);
        obj.updateMatrix();
        obj.updateMatrixWorld(true);
    },

    applyTransform: function(obj, keyData) {
        obj.position.fromArray(keyData.pos);
        obj.quaternion.fromArray(keyData.quat || keyData.rot);
        obj.scale.fromArray(keyData.scl);
        obj.updateMatrix();
        obj.updateMatrixWorld(true);
    },

    // =========================================================
    // PLAYBACK (TRUE FPS LOGIC)
    // =========================================================
    goToFrame: function(frame) {
        this.currentFrame = frame;
        this.dom.counter.innerText = Math.round(frame);
        
        const pos = 20 + (frame * 10);
        this.dom.playhead.style.transform = `translateX(${pos}px)`;

        // Calcula frame stepped para visual de baixo FPS
        const step = this.BASE_FPS / this.fps; 
        const steppedFrame = Math.floor(frame / step) * step;

        // CORREÇÃO: Usa mesma sintaxe do código original
        // Referência direta à variável global 'scene' (não window.scene)
        if (typeof scene !== 'undefined' && scene) {
            scene.traverse((object) => {
                if (object.userData && object.userData.animationData) {
                    this.evaluateAnimation(object, steppedFrame);
                }
            });
        }

        // Atualiza transform control se existir
        if (window.transformControl) {
            window.transformControl.update();
        }
        
        // CORREÇÃO: Reset render counter (código original)
        if (typeof currentFrame !== 'undefined') currentFrame = 0;
    },

    togglePlay: function() {
        this.isPlaying = !this.isPlaying;
        this.dom.btnPlay.innerText = this.isPlaying ? '❚❚' : '▶';
        if (this.isPlaying) {
            this.lastTime = performance.now();
            this.loop();
        }
    },

    loop: function() {
        if (!this.isPlaying) return;
        requestAnimationFrame(() => this.loop());

        const now = performance.now();
        const deltaSeconds = (now - this.lastTime) / 1000;
        this.lastTime = now;

        const ticksToMove = deltaSeconds * this.BASE_FPS;
        let next = this.currentFrame + ticksToMove;
        
        if (next > this.endFrame) next = this.startFrame;
        
        this.goToFrame(next);
    }
};

// Start
AnimationTimeline.init();