document.addEventListener('DOMContentLoaded', () => {
  // Verifica se o rayConfig foi exportado corretamente
  if (typeof window.rayConfig === 'undefined') {
    console.error("ERRO: 'rayConfig' não encontrado. Adicione 'window.rayConfig = rayConfig;' ao final do arquivo ray.js");
    return;
  }
  
  const config = window.rayConfig;
  
  // --- ELEMENTOS DO DOM ---
  const inputs = {
    maxSamples: document.getElementById('maxSamples'),
    maxBounces: document.getElementById('maxBounces'),
    pixelRatio: document.getElementById('pixelRatio'),
    samplesPerFrame: document.getElementById('samples'), // Assumindo que este ID 'samples' controla samples por frame
    
    // Câmera
    aperture: document.getElementById('aperture'),
    focusDistance: document.getElementById('focusDistance'),
    
    // Adaptive
    adaptiveEnabled: document.getElementById('adaptiveEnabled'),
    varianceThreshold: document.getElementById('varianceThreshold'),
    
    // AO
    aoEnabled: document.getElementById('aoEnabled'),
    aoSamples: document.getElementById('aoSamples'),
    aoRadius: document.getElementById('aoRadius'),
    aoIntensity: document.getElementById('aoIntensity'),
    
    // Skybox
    useSkyboxCheckbox: document.getElementById('useSkybox_yes_no'),
    skyboxUploadBtn: document.getElementById('useSkybox'), // A div que serve de botão
    
    // Cor de Fundo
    colorDiv: document.getElementById('color-mat1')
  };
  
  // --- FUNÇÕES AUXILIARES DE COR ---
  
  // Converte Array [0..1, 0..1, 0..1] para Hex '#RRGGBB'
  function rgbToHex(r, g, b) {
    const to255 = (v) => Math.min(255, Math.max(0, Math.round(v * 255)));
    const componentToHex = (c) => {
      const hex = c.toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    };
    return "#" + componentToHex(to255(r)) + componentToHex(to255(g)) + componentToHex(to255(b));
  }
  
  // Converte Hex '#RRGGBB' para Array [0..1, 0..1, 0..1]
  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16) / 255.0,
      parseInt(result[2], 16) / 255.0,
      parseInt(result[3], 16) / 255.0
    ] : [0, 0, 0];
  }
  
  // --- 1. SINCRONIZAR UI COM VALORES INICIAIS DO RAY.JS ---
  function syncUI() {
    // Main Settings
    if (inputs.maxSamples) inputs.maxSamples.value = config.maxSamples;
    if (inputs.maxBounces) inputs.maxBounces.value = config.maxBounces;
    if (inputs.pixelRatio) inputs.pixelRatio.value = config.pixelRatio;
    if (inputs.samplesPerFrame) inputs.samplesPerFrame.value = config.samplesPerFrame || 1;
    
    // Camera
    if (inputs.aperture) inputs.aperture.value = config.aperture;
    if (inputs.focusDistance) inputs.focusDistance.value = config.focusDistance;
    
    // Adaptive
    if (inputs.adaptiveEnabled) inputs.adaptiveEnabled.checked = config.adaptiveEnabled;
    if (inputs.varianceThreshold) inputs.varianceThreshold.value = config.varianceThreshold;
    
    // AO
    if (inputs.aoEnabled) inputs.aoEnabled.checked = config.aoEnabled;
    if (inputs.aoSamples) inputs.aoSamples.value = config.aoSamples;
    if (inputs.aoRadius) inputs.aoRadius.value = config.aoRadius;
    if (inputs.aoIntensity) inputs.aoIntensity.value = config.aoIntensity;
    
    // Skybox Checkbox
    if (inputs.useSkyboxCheckbox) inputs.useSkyboxCheckbox.checked = config.useSkybox;
    
    // Background Color Div
    if (inputs.colorDiv && config.backgroundColor) {
      const hex = rgbToHex(config.backgroundColor[0], config.backgroundColor[1], config.backgroundColor[2]);
      inputs.colorDiv.style.backgroundColor = hex;
      inputs.colorDiv.style.border = "1px solid #555";
    }
  }
  
  // --- 2. CONFIGURAR LISTENERS (UI -> RAYCONFIG) ---
  
  // Helper para inputs numéricos
  function bindNumber(element, property, isFloat = false) {
    if (!element) return;
    element.addEventListener('input', (e) => {
      const val = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value);
      config[property] = val;
      // Se estiver renderizando, talvez precise reiniciar ou atualizar algo dinamicamente
      // Mas o ray.js lê o config a cada tile/frame, então deve funcionar.
    });
  }
  
  // Helper para Checkboxes
  function bindCheckbox(element, property) {
    if (!element) return;
    element.addEventListener('change', (e) => {
      config[property] = e.target.checked;
    });
  }
  
  // Bindings
  bindNumber(inputs.maxSamples, 'maxSamples');
  bindNumber(inputs.maxBounces, 'maxBounces');
  bindNumber(inputs.pixelRatio, 'pixelRatio', true);
  bindNumber(inputs.samplesPerFrame, 'samplesPerFrame');
  
  bindNumber(inputs.aperture, 'aperture', true);
  bindNumber(inputs.focusDistance, 'focusDistance', true);
  
  bindCheckbox(inputs.adaptiveEnabled, 'adaptiveEnabled');
  bindNumber(inputs.varianceThreshold, 'varianceThreshold', true);
  
  bindCheckbox(inputs.aoEnabled, 'aoEnabled');
  bindNumber(inputs.aoSamples, 'aoSamples');
  bindNumber(inputs.aoRadius, 'aoRadius', true);
  bindNumber(inputs.aoIntensity, 'aoIntensity', true);
  
  bindCheckbox(inputs.useSkyboxCheckbox, 'useSkybox');
  
  // --- 3. INTEGRAÇÃO COM O COLOR PICKER ---
  
  if (inputs.colorDiv) {
    inputs.colorDiv.addEventListener('click', (e) => {
      // Previne propagação para não fechar imediatamente
      e.stopPropagation();
      
      // Pega a cor atual do config
      const currentHex = rgbToHex(config.backgroundColor[0], config.backgroundColor[1], config.backgroundColor[2]);
      
      // Define a cor atual no picker (usando a função global do seu color picker)
      if (window.setColorPickerColor) {
        window.setColorPickerColor(currentHex);
      }
      
      // Abre o picker com callback
      if (window.openColorPicker) {
        window.openColorPicker((newHex) => {
          // Atualiza visual da div
          inputs.colorDiv.style.backgroundColor = newHex;
          
          // Atualiza rayConfig
          const rgb = hexToRgb(newHex);
          config.backgroundColor = [rgb[0], rgb[1], rgb[2], 1.0];
        });
      } else {
        console.warn("Função openColorPicker não encontrada.");
      }
    });
  }
  
  // --- 4. UPLOAD DE SKYBOX ---
  
  if (inputs.skyboxUploadBtn) {
    // Estiliza a div para parecer clicável
    inputs.skyboxUploadBtn.style.cursor = "pointer";
    
    
    // Cria input file invisível
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*'; // Aceita png, jpg, hdr (se o browser suportar)
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    
    inputs.skyboxUploadBtn.addEventListener('click', () => {
      fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const url = URL.createObjectURL(file);
      
      // Atualiza texto da div
      inputs.skyboxUploadBtn.textContent = "Carregando...";
      
      // Chama a função global do ray.js
      if (window.rayLoadSkybox) {
        window.rayLoadSkybox(url)
          .then(() => {
            inputs.skyboxUploadBtn.textContent = "Loaded!";
            inputs.useSkyboxCheckbox.checked = true;
            config.useSkybox = true;
          })
          .catch((err) => {
            console.error(err);
            inputs.skyboxUploadBtn.textContent = "Erro";
          });
      }
    });
  }
  
  // Inicializa a UI
  syncUI();
  console.log("Render Settings");
});