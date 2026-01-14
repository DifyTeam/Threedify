class RayLight {
  constructor(type = "point") {
    this.type = type;

    // --- Configurações Padrão ---
    this.position = new THREE.Vector3(0, 5, 0);
    this.intensity = 15.0;
    this.color = new THREE.Color(0xFFFFFF);
    this.castShadow = true;
    this.shadowSoftness = 0.5; 
    
    const rayLength = 0.3; 
    const vertices = [];

    const directions = [
      [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
      [1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]
    ];

    directions.forEach(dir => {
      vertices.push(0, 0, 0);
      vertices.push(dir[0] * rayLength, dir[1] * rayLength, dir[2] * rayLength);
    });

    vertices.push(0, 0, 0);
    vertices.push(0, -this.position.y, 0);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

    const material = new THREE.LineBasicMaterial({
      color: this.color,
      linewidth: 1, 
      transparent: true,
      opacity: 0.8
    });

    this.object = new THREE.LineSegments(geometry, material);
    this.object.position.copy(this.position);
    this.object.name = "RayLight_C4D_Style";
    this.object.frustumCulled = false;
    // === 3. Bloqueios Rígidos (Congelar Rotação e Escala) ===
    // Sobrescrevemos as propriedades diretamente no objeto principal
    Object.defineProperties(this.object.rotation, {
      x: { get: () => 0, set: () => {} },
      y: { get: () => 0, set: () => {} },
      z: { get: () => 0, set: () => {} },
      isEuler: { value: true }
    });

    Object.defineProperties(this.object.scale, {
      x: { get: () => 1, set: () => {} },
      y: { get: () => 1, set: () => {} },
      z: { get: () => 1, set: () => {} }
    });

    // === 4. Dados para o Raytracer (UserData no Objeto Principal) ===
    this.object.userData = {
      isLight: true,
      intensity: this.intensity,
      color: { r: 1, g: 1, b: 1 },
      radius: this.shadowSoftness,
      castShadow: this.castShadow,
      helperType: "C4D_Gizmo"
    };

    // Adicionar à cena
    if (typeof scene !== 'undefined') scene.add(this.object);
    if (typeof selectableObjects !== 'undefined') selectableObjects.push(this.object);

    this.updateLine();
  }

  // === ATUALIZAÇÃO DA GEOMETRIA ===
  updateLine() {
    if (!this.object) return;

    // A linha do chão são os últimos 2 vértices do array de posições.
    // Total de vértices = 18. Índices vão de 0 a 17.
    // O vértice que toca o chão é o último (índice 17).
    
    const positions = this.object.geometry.attributes.position.array;
    const lastIndex = positions.length - 1;

    // O ponto inicial da linha do chão é sempre (0,0,0) local (junto com a luz)
    // O ponto final deve ser (0, -altura, 0) localmente para tocar o y=0 do mundo.
    
    // positions[lastIndex - 2] = 0; // x
    positions[lastIndex - 1] = -this.object.position.y; // y (distância até o chão)
    // positions[lastIndex] = 0; // z

    this.object.geometry.attributes.position.needsUpdate = true;
  }

  update() {
    this.updateLine();
  }

  // === SETTERS ===
  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.object.position.copy(this.position);
    this.updateLine();
  }

  setColor(value) {
    this.color.set(value);
    this.object.material.color.copy(this.color);
    this.object.userData.color = { r: this.color.r, g: this.color.g, b: this.color.b };
  }

  setIntensity(value) {
    this.intensity = value;
    this.object.userData.intensity = this.intensity;
  }

  setShadowSoftness(radius) {
    const r = Math.max(0.01, radius);
    this.shadowSoftness = r;
    this.object.userData.radius = r;
    // Não alteramos visualmente o tamanho do ícone, apenas os dados físicos.
  }

  setCastShadow(bool) {
    this.castShadow = bool;
    this.object.userData.castShadow = bool;
  }

  dispose() {
    if (typeof scene !== 'undefined') scene.remove(this.object);
    if (typeof selectableObjects !== 'undefined') {
      const index = selectableObjects.indexOf(this.object);
      if (index > -1) selectableObjects.splice(index, 1);
    }
    
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}





class RayLight2 {
  constructor(type = "directional") {
    this.type = type;
    
    // --- Configurações Padrão ---
    // Luzes direcionais dependem de rotação, não apenas posição.
    this.position = new THREE.Vector3(5, 5, 5);
    this.intensity = 2.0; // Intensidade padrão menor pois lights direcionais cobrem tudo
    this.color = new THREE.Color(0xFFFFFF);
    this.castShadow = true;
    this.shadowSoftness = 0.5;
    
    // Parâmetros visuais do Gizmo
    const radius = 0.5; // Raio do tubo de luz
    const length = 1.0; // Comprimento dos raios indicadores
    const segments = 8; // Octágono para parecer técnico (estilo C4D)
    
    const vertices = [];
    
    // --- GERAÇÃO DA GEOMETRIA (Cilindro de Raios) ---
    // 1. Cria o anel traseiro e os raios paralelos
    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const nextTheta = ((i + 1) / segments) * Math.PI * 2;
      
      // Coordenadas do círculo (Plano XY local)
      const x = Math.cos(theta) * radius;
      const y = Math.sin(theta) * radius;
      
      const nextX = Math.cos(nextTheta) * radius;
      const nextY = Math.sin(nextTheta) * radius;
      
      // A. Segmentos do Anel (Conectando os pontos do círculo)
      vertices.push(x, y, 0);
      vertices.push(nextX, nextY, 0);
      
      // B. Raios Paralelos (Estendendo no eixo Z negativo - frente padrão do Three.js)
      // Isso cria o visual de "fluxo" de luz
      vertices.push(x, y, 0);
      vertices.push(x, y, -length);
    }
    
    // 2. Linha Central (Eixo) para indicar o centro exato
    vertices.push(0, 0, 0);
    vertices.push(0, 0, -length * 1.2); // Um pouco mais longa para indicar direção
    
    // 3. Adiciona a "Linha de Terra" (placeholder, será atualizada no updateLine)
    // Reservamos os dois últimos vértices para a linha vertical que conecta ao chão
    vertices.push(0, 0, 0);
    vertices.push(0, -this.position.y, 0);
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    
    const material = new THREE.LineBasicMaterial({
      color: this.color,
      linewidth: 1,
      transparent: true,
      opacity: 0.8
    });
    
    this.object = new THREE.LineSegments(geometry, material);
    this.object.position.copy(this.position);
    
    // Rotação inicial para apontar para o centro (0,0,0) como exemplo
    this.object.lookAt(0, 0, 0);
    
    this.object.name = "RayLight2_Directional_C4D";
    this.object.frustumCulled = false;
    
    // === 3. Bloqueios Rígidos ===
    // IMPORTANTE: Removemos o bloqueio de Rotação.
    // Uma Directional Light PRECISA ser rotacionada para apontar a luz.
    // Mantemos apenas o bloqueio de escala para evitar distorção do gizmo.
    
    Object.defineProperties(this.object.scale, {
      x: { get: () => 1, set: () => {} },
      y: { get: () => 1, set: () => {} },
      z: { get: () => 1, set: () => {} }
    });
    
    // === 4. Dados para o Raytracer ===
    this.object.userData = {
      isLight: true,
      type: "directional", // Identificador crucial para o renderizador
      intensity: this.intensity,
      color: { r: 1, g: 1, b: 1 },
      radius: this.shadowSoftness, // Em directional, isso pode ser "angle blur" ou tamanho do sol
      castShadow: this.castShadow,
      helperType: "C4D_Directional_Gizmo"
    };
    
    // Adicionar à cena
    if (typeof scene !== 'undefined') scene.add(this.object);
    if (typeof selectableObjects !== 'undefined') selectableObjects.push(this.object);
    
    this.updateLine();
  }
  
  // === ATUALIZAÇÃO DA GEOMETRIA ===
  updateLine() {
    if (!this.object) return;
    
    // Lógica da Linha do Chão:
    // Em uma luz direcional rotacionável, a linha para o chão (0,-y,0) 
    // visualmente pode ficar estranha se o objeto estiver muito inclinado,
    // mas mantemos para referência de altura da "fonte" imaginária.
    
    const positions = this.object.geometry.attributes.position.array;
    const lastIndex = positions.length - 1;
    
    // Para desenhar uma linha reta para baixo INDEPENDENTE da rotação do objeto,
    // precisaríamos converter coordenadas de mundo para local.
    // Como queremos manter este código leve e similar ao anterior, 
    // vamos simplificar: a linha aponta para -Y local do objeto.
    
    // Se preferir que a linha suma em luzes direcionais (comum em C4D), 
    // basta comentar as linhas abaixo.
    
    // positions[lastIndex - 1] = -this.object.position.y; // y local
    
    // NOTA: Para luzes direcionais, a linha para o chão é menos relevante 
    // do que para Point Lights, então deixamos fixo ou zerado para limpar o visual.
    // Aqui optei por zerar para deixar o gizmo "flutuante" e mais limpo.
    positions[lastIndex - 2] = 0;
    positions[lastIndex - 1] = 0;
    positions[lastIndex] = 0;
    
    this.object.geometry.attributes.position.needsUpdate = true;
  }
  
  update() {
    this.updateLine();
    
    // Atualiza direção no userData se necessário pelo Raytracer
    // Alguns raytracers precisam do vetor de direção explícito
    if (this.object.userData) {
      const direction = new THREE.Vector3(0, 0, -1);
      direction.applyQuaternion(this.object.quaternion);
      this.object.userData.direction = { x: direction.x, y: direction.y, z: direction.z };
    }
  }
  
  // === SETTERS ===
  setPosition(x, y, z) {
    this.position.set(x, y, z);
    this.object.position.copy(this.position);
    this.updateLine();
  }
  
  // Adicionado Setter de Rotação (LookAt) para facilitar apontar a luz
  setTarget(x, y, z) {
    this.object.lookAt(x, y, z);
    this.update();
  }
  
  setColor(value) {
    this.color.set(value);
    this.object.material.color.copy(this.color);
    this.object.userData.color = { r: this.color.r, g: this.color.g, b: this.color.b };
  }
  
  setIntensity(value) {
    this.intensity = value;
    this.object.userData.intensity = this.intensity;
  }
  
  setShadowSoftness(val) {
    const r = Math.max(0.00, val);
    this.shadowSoftness = r;
    this.object.userData.radius = r;
  }
  
  setCastShadow(bool) {
    this.castShadow = bool;
    this.object.userData.castShadow = bool;
  }
  
  dispose() {
    if (typeof scene !== 'undefined') scene.remove(this.object);
    if (typeof selectableObjects !== 'undefined') {
      const index = selectableObjects.indexOf(this.object);
      if (index > -1) selectableObjects.splice(index, 1);
    }
    
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}