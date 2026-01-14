
window.ray_lights = window.ray_lights || [];

// === REFERÊNCIAS DO DOM ===
const addLightBtn = document.getElementById('add_spl');

// === FUNÇÃO DE CRIAR LUZ ===
function createNewLight() {
  // 1. Instancia a nova luz
  const light = new RayLight("point");
  
  // 2. Define uma posição padrão levemente aleatória (para não encavalarem)
  light.setPosition(0, 5,0);
  light.name = "Spotlight";
  // 3. Configurações padrão
  light.setIntensity(15.0);
  light.setColor(0xFFFFFF);
  light.setShadowSoftness(0.5);
  
  // 4. Nome único (Opcional, ajuda na hierarquia)
  light.object.name = `Point Light ${window.ray_lights.length + 1}`;
  
  // 5. Adiciona ao array global de luzes
  window.ray_lights.push(light);
  //selectableObjects.push(light);
  
  // 6. (Opcional) Selecionar automaticamente a nova luz criada
  if (typeof window.selectedObject !== 'undefined') {
    window.selectedObject = light.object;
    // Se tiver uma função global para atualizar a UI de seleção, chame aqui
    // ex: updateInterfaceMode(light.object);
  }
  
  console.log("Nova luz criada:", light.object.name);
  return light;
}

// === EVENT LISTENER DO BOTÃO ===
if (addLightBtn) {
  addLightBtn.addEventListener('click', createNewLight);
} else {
  console.warn("Botão 'add_spl' não encontrado!");
}




// === REFERÊNCIAS DO DOM ===
const addDirectionalBtn = document.getElementById('add_dtl');

// === FUNÇÃO DE CRIAR LUZ DIRECIONAL ===
function createNewDirectionalLight() {
  // 1. Instancia a nova luz (Tipo Directional / RayLight2)
  const light = new RayLight2("directional");
  
  // 2. Define uma posição padrão "Solar" (Alta e angular)
  light.setPosition(0, 5, 0);
  
  // Orienta a luz para o centro (0,0,0) para visualização imediata
  if (light.setTarget) {
    light.setTarget(0, 0, 0);
  }
  
  // 3. Configurações padrão
  light.setIntensity(2.0); // Intensidade inicial ajustada para luz direcional
  light.setColor(0xFFFFFF);
  light.setShadowSoftness(0.2); // Sombras geralmente mais duras por padrão em Directional
  light.setCastShadow(true);
  
  // 4. Nome único
  // Usamos o tamanho do array global para manter consistência nos IDs
  light.object.name = `Directional Light ${window.ray_lights.length + 1}`;
  
  // 5. Adiciona ao array global de luzes
  window.ray_lights.push(light);
  
  // Se você estiver gerenciando array de selecionáveis separadamente:
  // if (typeof selectableObjects !== 'undefined' && !selectableObjects.includes(light.object)) {
  //    selectableObjects.push(light.object);
  // }
  
  // 6. Selecionar automaticamente a nova luz criada
  if (typeof window.selectedObject !== 'undefined') {
    window.selectedObject = light.object;
    // Atualizar UI de propriedades se necessário
    // if (typeof updatePropertiesPanel === 'function') updatePropertiesPanel();
  }
  
  console.log("Nova luz direcional criada:", light.object.name);
  return light;
}

// === EVENT LISTENER DO BOTÃO ===
if (addDirectionalBtn) {
  addDirectionalBtn.addEventListener('click', createNewDirectionalLight);
} else {
  console.warn("Botão 'add_dtl' não encontrado!");
}