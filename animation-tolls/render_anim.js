// =========================================================
// ARQUIVO: render-anim.js
// SISTEMA DE RENDERIZAÇÃO MP4 "DO ZERO" (NO DEPENDENCIES)
// =========================================================

// ---------------------------------------------------------
// CLASSE 1: MINI MUXER (O "Empacotador" MP4)
// Responsável por criar a estrutura binária do arquivo .mp4
// ---------------------------------------------------------
class MiniMuxer {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.chunks = [];   // Armazena os dados brutos de vídeo (mdat)
        this.samples = [];  // Armazena informações de cada frame (para o índice)
        this.totalSize = 0;
        this.trackId = 1;
        this.timeScale = 30000; // Precisão de tempo padrão do MP4
        this.avcConfig = null;  // Configuração do Codec (crítico)
    }

    // Recebe o pedaço já comprimido pelo navegador
    addVideoChunk(chunk, meta, duration) {
        // Copia os dados da GPU/Memória para um buffer seguro
        const buffer = new Uint8Array(chunk.byteLength);
        chunk.copyTo(buffer);

        // Salva a configuração do codec (apenas no primeiro frame chave)
        if (meta && meta.decoderConfig && meta.decoderConfig.description) {
            this.avcConfig = new Uint8Array(meta.decoderConfig.description);
        }

        // Guarda metadados para construir o índice depois
        this.samples.push({
            size: buffer.byteLength,
            duration: duration, 
            isKeyframe: chunk.type === 'key'
        });

        // Guarda o dado bruto
        this.chunks.push(buffer);
        this.totalSize += buffer.byteLength;
    }

    // Fecha o arquivo e gera o Blob final
    finalize() {
        if (!this.avcConfig) {
            console.error("Erro: Nenhuma configuração de codec (avcC) encontrada.");
            return null;
        }

        // Calcula tamanhos
        const ftyp = this.createFtypBox();
        const mdatHeaderSize = 8;
        const mdatSize = mdatHeaderSize + this.totalSize;
        const moov = this.createMoovBox(); // O índice gigante

        const finalSize = ftyp.byteLength + mdatSize + moov.byteLength;
        const finalBuffer = new Uint8Array(finalSize);
        let offset = 0;

        // 1. Escreve FTYP (Assinatura do arquivo)
        finalBuffer.set(ftyp, offset);
        offset += ftyp.byteLength;

        // 2. Escreve Cabeçalho MDAT (Media Data)
        const mdatHeader = new Uint8Array(8);
        const view = new DataView(mdatHeader.buffer);
        view.setUint32(0, mdatSize); // Tamanho total do media
        mdatHeader.set([109, 100, 97, 116], 4); // "mdat" em ASCII
        finalBuffer.set(mdatHeader, offset);
        offset += 8;

        // 3. Escreve os Chunks (Frames comprimidos)
        for (const chunk of this.chunks) {
            finalBuffer.set(chunk, offset);
            offset += chunk.byteLength;
        }

        // 4. Escreve MOOV (O índice no final)
        finalBuffer.set(moov, offset);

        return new Blob([finalBuffer], { type: 'video/mp4' });
    }

    // --- FUNÇÕES AUXILIARES DE ESCRITA BINÁRIA (BOX WRITERS) ---

    createFtypBox() {
        return new Uint8Array([
            0, 0, 0, 24, // Size
            102, 116, 121, 112, // "ftyp"
            105, 115, 111, 109, // "isom"
            0, 0, 0, 1, // v1
            105, 115, 111, 109, // "isom"
            97, 118, 99, 49 // "avc1"
        ]);
    }

    createMoovBox() {
        // Cálculo do offset onde os dados começam (ftyp + mdat header)
        let currentOffset = 24 + 8; 

        // 1. Tabela STCO (Onde começa cada frame no arquivo?)
        const stcoContent = new Uint8Array(4 + 4 + (this.samples.length * 4));
        const stcoView = new DataView(stcoContent.buffer);
        stcoView.setUint32(4, this.samples.length); // Count
        for(let i=0; i<this.samples.length; i++) {
            stcoView.setUint32(8 + (i*4), currentOffset);
            currentOffset += this.samples[i].size;
        }
        const stco = this.box('stco', stcoContent);

        // 2. Tabela STSZ (Qual o tamanho de cada frame?)
        const stszContent = new Uint8Array(4 + 4 + 4 + (this.samples.length * 4));
        const stszView = new DataView(stszContent.buffer);
        stszView.setUint32(8, this.samples.length); // Count
        for(let i=0; i<this.samples.length; i++) {
            stszView.setUint32(12 + (i*4), this.samples[i].size);
        }
        const stsz = this.box('stsz', stszContent);

        // 3. Tabela STSC (Chunks - Simplificado: 1 frame por chunk)
        const stscContent = new Uint8Array(4 + 4 + 12);
        const stscView = new DataView(stscContent.buffer);
        stscView.setUint32(4, 1); // 1 entrada
        stscView.setUint32(8, 1); // Primeiro chunk
        stscView.setUint32(12, 1); // Samples por chunk
        stscView.setUint32(16, 1); // ID
        const stsc = this.box('stsc', stscContent);

        // 4. Tabela STTS (Duração - Time to Sample)
        const sttsContent = new Uint8Array(4 + 4 + 8);
        const sttsView = new DataView(sttsContent.buffer);
        sttsView.setUint32(4, 1); // 1 entrada (assumindo FPS constante para simplificar o muxer)
        sttsView.setUint32(8, this.samples.length);
        // Duração média do primeiro sample
        const avgDur = this.samples.length > 0 ? this.samples[0].duration : 1000;
        sttsView.setUint32(12, avgDur); 
        const stts = this.box('stts', sttsContent);

        // 5. STSD (Sample Description - Config do Codec)
        const avcc = this.box('avcC', this.avcConfig);
        const avc1Header = new Uint8Array(78);
        const avc1View = new DataView(avc1Header.buffer);
        avc1View.setUint16(6, 1); // Data ref index
        avc1View.setUint16(24, this.width);
        avc1View.setUint16(26, this.height);
        avc1View.setUint16(74, 24); // Depth
        avc1View.setUint16(76, 65535); // Color ID
        
        const avc1Content = new Uint8Array(78 + avcc.byteLength);
        avc1Content.set(avc1Header);
        avc1Content.set(avcc, 78);
        const avc1 = this.box('avc1', avc1Content);

        const stsdContent = new Uint8Array(8 + avc1.byteLength);
        new DataView(stsdContent.buffer).setUint32(4, 1); // Count
        stsdContent.set(avc1, 8);
        const stsd = this.box('stsd', stsdContent);

        // 6. Monta a árvore de caixas
        const stbl = this.box('stbl', this.concat([stsd, stts, stsc, stsz, stco]));
        
        const vmhd = this.box('vmhd', new Uint8Array([0,0,0,1, 0,0,0,1, 0,0,0,0, 0,0,0,0]));
        const dref = this.box('dref', new Uint8Array([0,0,0,0, 0,0,0,1, 0,0,0,12, 117,114,108, 32, 0,0,0,1])); // url
        const dinf = this.box('dinf', dref);
        const minf = this.box('minf', this.concat([vmhd, dinf, stbl]));

        const mdhdContent = new Uint8Array(24);
        const mdhdView = new DataView(mdhdContent.buffer);
        mdhdView.setUint32(12, this.timeScale);
        const totalDuration = this.samples.reduce((a,b) => a + b.duration, 0);
        mdhdView.setUint32(16, totalDuration);
        mdhdView.setUint16(20, 21956); // Lang 'und'
        const mdhd = this.box('mdhd', mdhdContent);

        const hdlr = this.box('hdlr', new Uint8Array([0,0,0,0, 0,0,0,0, 118,105,100,101, 0,0,0,0, 0,0,0,0, 0,0,0,0, 86,105,100,101,111,72,97,110,100,108,101,114,0])); // 'vide'
        const mdia = this.box('mdia', this.concat([mdhd, hdlr, minf]));

        const tkhdContent = new Uint8Array(84);
        const tkhdView = new DataView(tkhdContent.buffer);
        tkhdView.setUint32(12, 1); // ID
        tkhdView.setUint32(20, totalDuration);
        tkhdView.setUint32(36, 65536); // Matrix Identity
        tkhdView.setUint32(52, 65536);
        tkhdView.setUint32(68, 1073741824);
        tkhdView.setUint32(76, this.width * 65536);
        tkhdView.setUint32(80, this.height * 65536);
        const tkhd = this.box('tkhd', tkhdContent);

        const trak = this.box('trak', this.concat([tkhd, mdia]));

        const mvhdContent = new Uint8Array(100);
        const mvhdView = new DataView(mvhdContent.buffer);
        mvhdView.setUint32(12, this.timeScale);
        mvhdView.setUint32(16, totalDuration);
        mvhdView.setUint32(20, 65536); // Rate 1.0
        mvhdView.setUint16(24, 256); // Volume
        mvhdView.setUint32(32, 65536); // Matrix
        mvhdView.setUint32(48, 65536);
        mvhdView.setUint32(64, 1073741824);
        mvhdView.setUint32(96, 2); // Next ID
        const mvhd = this.box('mvhd', mvhdContent);

        return this.box('moov', this.concat([mvhd, trak]));
    }

    // Utilitário para criar box [tamanho, nome, dados]
    box(type, data) {
        const len = 8 + data.byteLength;
        const buffer = new Uint8Array(len);
        const view = new DataView(buffer.buffer);
        view.setUint32(0, len); // Big Endian size
        for (let i = 0; i < 4; i++) buffer[4 + i] = type.charCodeAt(i);
        buffer.set(data, 8);
        return buffer;
    }

    concat(arrays) {
        let total = 0;
        for(const arr of arrays) total += arr.byteLength;
        const res = new Uint8Array(total);
        let offset = 0;
        for(const arr of arrays) {
            res.set(arr, offset);
            offset += arr.byteLength;
        }
        return res;
    }
}

// ---------------------------------------------------------
// CLASSE 2: RENDERIZADOR (O "Gerente")
// Controla a Timeline, o Canvas e o WebCodecs
// ---------------------------------------------------------
const VideoRenderer = {
    isRendering: false,
    width: 1920,
    height: 1080,
    bitrate: 8000000, // 8 Mbps (Boa qualidade)
    samplesPerFrame: 1, // Se > 1, espera o Path Tracer limpar a imagem
    
    miniMuxer: null,
    videoEncoder: null,
    canvas: null,
    
    // Configura o canvas alvo
    init: function(canvasElement) {
        this.canvas = canvasElement;
        console.log("Renderer: Vinculado ao Canvas", canvasElement);
    },

    // Inicia o processo
    startExport: async function(filename = "render_final.mp4") {
        if (this.isRendering) return;
        if (!this.canvas) { alert("Erro: Canvas não definido no Renderer."); return; }
        
        console.log("Renderer: Iniciando Exportação...");
        this.isRendering = true;

        // 1. Instancia nosso Muxer Artesanal
        this.miniMuxer = new MiniMuxer(this.width, this.height);

        // 2. Configura o Hardware Encoder do Navegador
        try {
            this.videoEncoder = new VideoEncoder({
                output: (chunk, meta) => {
                    // Converte tempo para escala do Muxer
                    const duration = (chunk.duration / 1000000) * this.miniMuxer.timeScale;
                    this.miniMuxer.addVideoChunk(chunk, meta, duration);
                },
                error: (e) => {
                    console.error("Erro no Encoder:", e);
                    alert("Erro de Renderização: " + e.message);
                    this.isRendering = false;
                }
            });

            this.videoEncoder.configure({
                codec: 'avc1.4d002a', // H.264 High Profile
                width: this.width,
                height: this.height,
                bitrate: this.bitrate,
                framerate: AnimationTimeline.fps // Pega do seu sistema de timeline
            });

            // 3. Começa o trabalho duro
            await this.processFrames(filename);

        } catch (e) {
            console.error(e);
            alert("Seu navegador não suporta WebCodecs ou H.264 export.");
            this.isRendering = false;
        }
    },

    // O Loop Principal
    processFrames: async function(filename) {
        // Pega dados da sua Timeline (Objetos globais)
        const start = AnimationTimeline.startFrame;
        const end = AnimationTimeline.endFrame;
        const fps = AnimationTimeline.fps;
        
        // Pausa a timeline visual para controlarmos manualmente
        AnimationTimeline.isPlaying = false;

        console.log(`Renderer: Renderizando frames ${start} até ${end} a ${fps} FPS`);

        for (let frame = start; frame <= end; frame++) {
            
            // A. Move a cena para o frame exato
            AnimationTimeline.goToFrame(frame);

            // B. Espera o Renderizador (Bake/Path Tracing)
            await this.waitForRender();

            // C. Captura o Frame
            // timestamp deve ser em microsegundos (1 segundo = 1.000.000)
            const timestamp = (frame - start) * (1000000 / fps);
            
            const videoFrame = new VideoFrame(this.canvas, {
                timestamp: timestamp,
                duration: 1000000 / fps // Duração precisa
            });

            // D. Encodar (Frame chave a cada segundo para seek funcionar bem)
            const isKeyFrame = frame % fps === 0;
            this.videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
            videoFrame.close(); // Limpa VRAM imediatamente

            // Delay mínimo para a UI não travar completamente e o Garbage Collector respirar
            await new Promise(r => setTimeout(r, 0));
            
            // Log de progresso (poderíamos atualizar uma barra de loading aqui)
            console.log(`Render: ${Math.round(((frame-start)/(end-start))*100)}%`);
        }

        await this.finishExport(filename);
    },

    // Espera inteligente (se for Path Tracing)
    waitForRender: async function() {
        // Se for render normal (Three.js padrão), espera 1 frame para garantir desenho
        if (this.samplesPerFrame <= 1) {
            return new Promise(requestAnimationFrame);
        }

        // Se for Path Tracing, espera X samples
        return new Promise(resolve => {
            let samples = 0;
            const check = () => {
                samples++;
                // Aqui você pode chamar seu renderer.update() se precisar forçar
                if (samples >= this.samplesPerFrame) {
                    resolve();
                } else {
                    requestAnimationFrame(check);
                }
            };
            check();
        });
    },

    // Finaliza e baixa
    finishExport: async function(filename) {
        console.log("Renderer: Finalizando arquivo...");
        
        // Garante que o encoder terminou tudo
        await this.videoEncoder.flush();
        
        // Gera o arquivo final via Muxer
        const blob = this.miniMuxer.finalize();
        
        if (blob) {
            // Download automático
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            console.log("Renderer: Sucesso! Download iniciado.");
        } else {
            console.error("Renderer: Falha ao gerar Blob.");
        }

        this.isRendering = false;
        
        // Opcional: Volta a timeline para o inicio
        AnimationTimeline.goToFrame(AnimationTimeline.startFrame);
    }
};