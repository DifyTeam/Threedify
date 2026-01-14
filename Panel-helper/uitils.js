document.addEventListener("DOMContentLoaded", () => {
  // =========================================================
  // 1. CONFIGURAÇÃO INICIAL (UNIFICAÇÃO DOS BOTÕES)
  // =========================================================
  
  const realRenderBtn = document.getElementById("render"); // Botão original Laziness
  const unifiedTrigger = document.getElementById("baking"); // Imagem (Botão Unificado)
  
  // Esconde o botão original do Laziness (pois usaremos a imagem como gatilho)
  if (realRenderBtn) {
    realRenderBtn.style.display = "none";
  }
  
  // Adiciona o Listener "Mestre" na imagem
  // Usa {capture: true} para rodar antes dos outros scripts do IRIS
  if (unifiedTrigger) {
    unifiedTrigger.addEventListener("click", (e) => {
      const selector = document.getElementById("engine-selector");
      const currentMode = selector ? selector.querySelector(".select-selected").innerText.trim() : "Laziness";
      
      if (currentMode === "Laziness") {
        // --- MODO LAZINESS ---
        // 1. Impede que o IRIS rode (se ele estiver ouvindo o clique nesta imagem)
        e.preventDefault();
        e.stopImmediatePropagation();
        
        // 2. Clica "remotamente" no botão original do Laziness
        if (realRenderBtn) {
          console.log("Modo Laziness: Disparando renderizador...");
          realRenderBtn.click();
        }
      }
      else {
        // --- MODO IRIS ---
        // Deixa o evento passar normalmente. 
        // O script do IRIS (iris.js) vai capturar este clique no ID "baking".
        console.log("Modo IRIS: Disparando realtime...");
      }
    }, true);
  }
  
  // =========================================================
  // 2. LÓGICA DE UI (GAVETAS E DROPDOWNS)
  // =========================================================
  
  // Inicializa o seletor e as gavetas
  initUI();
  initIrisControls();
});

function initUI() {
  // --- A. LÓGICA DAS GAVETAS (DRAWER) ---
  document.querySelectorAll('#sparet3').forEach(header => {
    // Cria o container apenas se ainda não existir (evita duplicação)
    if (header.nextElementSibling && header.nextElementSibling.classList.contains('drawer-content')) return;
    
    const content = document.createElement('div');
    content.className = 'drawer-content';
    
    let next = header.nextElementSibling;
    while (next && next.id !== 'sparet3' && !next.classList.contains('drawer-content')) {
      const current = next;
      next = next.nextElementSibling;
      content.appendChild(current);
    }
    header.after(content);
    
    header.addEventListener('click', () => {
      header.classList.toggle('open');
      content.classList.toggle('open');
    });
  });
  
  // --- B. LÓGICA DO SELETOR DE RENDER (ENGINE) ---
  const selector = document.getElementById("engine-selector");
  if (!selector) return;
  
  const selectedDisplay = selector.querySelector(".select-selected");
  const itemsContainer = selector.querySelector(".select-items");
  const options = itemsContainer.querySelectorAll("div");
  const lazinessControls = document.getElementById("laziness-controls");
  const irisControls = document.getElementById("iris-controls");
  
  // Toggle Dropdown
  selectedDisplay.addEventListener("click", (e) => {
    e.stopPropagation();
    itemsContainer.classList.toggle("select-show");
    itemsContainer.classList.toggle("select-hide"); // Garante compatibilidade com CSS
  });
  
  // Fechar ao clicar fora
  window.addEventListener("click", () => {
    itemsContainer.classList.remove("select-show");
    itemsContainer.classList.add("select-hide");
  });
  
  // Seleção de Opção
  options.forEach(option => {
    option.addEventListener("click", function() {
      // Atualiza texto
      selectedDisplay.innerHTML = this.innerHTML;
      const engine = this.getAttribute("data-value");
      
      // Troca os Paineis de Controle
      if (engine === "laziness") {
        lazinessControls.classList.remove("renderer-hidden");
        lazinessControls.style.display = "block";
        
        irisControls.classList.add("renderer-hidden");
        irisControls.style.display = "none";
        
        // O ID do botão unificado tecnicamente continua "baking", 
        // mas o nosso Listener "Mestre" lá em cima redireciona o clique.
      } else if (engine === "iris") {
        lazinessControls.classList.add("renderer-hidden");
        lazinessControls.style.display = "none";
        
        irisControls.classList.remove("renderer-hidden");
        irisControls.style.display = "block";
      }
      
      // Fecha dropdown
      itemsContainer.classList.remove("select-show");
      itemsContainer.classList.add("select-hide");
    });
  });
}

// =========================================================
// 3. IRIS CONTROLS (CONEXÃO COM SHADERS/MATERIAIS)
// =========================================================
function initIrisControls() {
  const updateRender = () => {
    if (typeof currentFrame !== 'undefined') currentFrame = 0;
  };
  
  // --- GI & LIGHTING ---
  const elGiCheck = document.getElementById("iris_enable_gi");
  if (elGiCheck) {
    elGiCheck.addEventListener("change", (e) => {
      if (typeof ssgiMaterial !== 'undefined') {
        ssgiMaterial.uniforms.uGiIntensity.value = e.target.checked ?
          parseFloat(document.getElementById("iris_gi_intensity").value) : 0.0;
        updateRender();
      }
    });
  }
  
  const elGiInt = document.getElementById("iris_gi_intensity");
  if (elGiInt) {
    elGiInt.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      if (typeof ssgiMaterial !== 'undefined') {
        ssgiMaterial.uniforms.uGiIntensity.value = val;
        updateRender();
      }
    });
  }
  
  const elLightInt = document.getElementById("iris_light_intensity");
  if (elLightInt) {
    elLightInt.addEventListener("input", (e) => {
      const factor = parseFloat(e.target.value);
      if (typeof tempLights !== 'undefined') {
        tempLights.forEach(light => {
          if (light.userData.originalIntensity === undefined) {
            light.userData.originalIntensity = light.intensity / 0.01;
          }
          light.intensity = light.userData.originalIntensity * factor;
        });
        updateRender();
      }
    });
  }
  
  // --- AMBIENT OCCLUSION (AO) ---
  const updateAO = () => {
    if (typeof ssgiMaterial === 'undefined') return;
    const strength = parseFloat(document.getElementById("iris_ao_strength").value);
    const radius = parseFloat(document.getElementById("iris_ao_radius").value);
    const bias = parseFloat(document.getElementById("iris_ao_bias").value);
    
    if (typeof AO_OPTIONS !== 'undefined') {
      AO_OPTIONS.strength = strength;
      AO_OPTIONS.radius = radius;
      AO_OPTIONS.bias = bias;
    }
    ssgiMaterial.uniforms.uAoStrength.value = strength;
    ssgiMaterial.uniforms.uAoRadius.value = radius;
    ssgiMaterial.uniforms.uAoBias.value = bias;
    updateRender();
  };
  
  ['iris_ao_strength', 'iris_ao_radius', 'iris_ao_bias'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateAO);
  });
  
  // --- BLOOM ---
  const elBloomCheck = document.getElementById("iris_enable_bloom");
  if (elBloomCheck) {
    elBloomCheck.addEventListener("change", (e) => {
      if (typeof outputMaterial !== 'undefined') {
        const strengthVal = parseFloat(document.getElementById("iris_bloom_strength").value);
        outputMaterial.uniforms.bloomStrength.value = e.target.checked ? strengthVal : 0.0;
      }
    });
  }
  
  const updateBloom = () => {
    const strength = parseFloat(document.getElementById("iris_bloom_strength").value);
    const radius = parseFloat(document.getElementById("iris_bloom_radius").value);
    const threshold = parseFloat(document.getElementById("iris_bloom_threshold").value);
    const isEnabled = document.getElementById("iris_enable_bloom").checked;
    
    if (typeof outputMaterial !== 'undefined') {
      outputMaterial.uniforms.bloomStrength.value = isEnabled ? strength : 0.0;
    }
    if (typeof bloomUpMat !== 'undefined') {
      bloomUpMat.uniforms.radius.value = radius;
    }
    if (typeof bloomHighPassMat !== 'undefined') {
      bloomHighPassMat.uniforms.threshold.value = threshold;
    }
  };
  
  ['iris_bloom_strength', 'iris_bloom_radius', 'iris_bloom_threshold'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateBloom);
  });
  
  // --- SKY / ENVIRONMENT ---
  const updateSky = () => {
    if (typeof ssgiMaterial === 'undefined') return;
    const intensity = parseFloat(document.getElementById("iris_sky_intensity").value);
    const colTop = new THREE.Color(document.getElementById("iris_sky_top").value);
    const colHorizon = new THREE.Color(document.getElementById("iris_sky_horizon").value);
    const colBottom = new THREE.Color(document.getElementById("iris_sky_bottom").value);
    
    if (typeof SKY_OPTIONS !== 'undefined') {
      SKY_OPTIONS.intensity = intensity;
      SKY_OPTIONS.unityColors.top = colTop.getHex();
      SKY_OPTIONS.unityColors.horizon = colHorizon.getHex();
      SKY_OPTIONS.unityColors.bottom = colBottom.getHex();
    }
    ssgiMaterial.uniforms.uSkyIntensity.value = intensity;
    ssgiMaterial.uniforms.uUnityTop.value.copy(colTop);
    ssgiMaterial.uniforms.uUnityHorizon.value.copy(colHorizon);
    ssgiMaterial.uniforms.uUnityBottom.value.copy(colBottom);
    updateRender();
  };
  
  ['iris_sky_intensity', 'iris_sky_top', 'iris_sky_horizon', 'iris_sky_bottom'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", updateSky);
      el.addEventListener("change", updateSky);
    }
  });
}