var HtmlGizmo = (function() {
  
  var _container;
  var _center = { x: 45, y: 45 };
  var _radius = 35;
  var _invRot = new THREE.Quaternion();
  
  // Lista de eixos
  var _axes = [
    { id: 'x', vec: new THREE.Vector3(1, 0, 0), color: '#ff3653', label: 'X' },
    { id: 'y', vec: new THREE.Vector3(0, 1, 0), color: '#8adb00', label: 'Y' },
    { id: 'z', vec: new THREE.Vector3(0, 0, 1), color: '#2c8fff', label: 'Z' }
  ];
  
  var _centerEl;
  
  return {
    // MUDANÇA: Agora aceita um parâmetro 'onClick'
    init: function(onClick) {
      
      // --- CSS (Mantido igual) ---
      var style = document.createElement('style');
      style.innerHTML = `
                #gizmo-container {
                    position: absolute;
                    top: 35px; right: 170px;
                    width: 90px; height: 90px;
                    z-index: 0;
                    pointer-events: none;
                    user-select: none;
                   
                }
                #g-center {
                    position: absolute;
                    width: 14px; height: 14px;
                    background: #ffffff;
                    border-radius: 50%;
                    transform: translate(38px, 38px);
                    box-shadow: 0 0 2px rgba(0,0,0,0.2);
                }
                .g-tip {
                    position: absolute;
                    width: 18px; height: 18px;
                    border-radius: 50%;
                    font-family: Arial, sans-serif;
                    font-size: 11px; font-weight: bold;
                    color: white; text-align: center; line-height: 18px;
                    cursor: pointer;
                    pointer-events: auto; /* IMPORTANTE: Permite clicar */
                    box-shadow: 1px 1px 3px rgba(0,0,0,0.3);
                    transition: transform 0.1s; /* Efeitinho ao passar o mouse */
                }
                .g-tip:hover { transform: scale(1.2); }
                .g-line {
                    position: absolute; height: 3px;
                    transform-origin: 0 50%; border-radius: 2px;
                }
            `;
      if (!document.getElementById('gizmo-style')) {
        style.id = 'gizmo-style';
        document.head.appendChild(style);
      }
      
      // --- HTML ---
      _container = document.createElement('div');
      _container.id = 'gizmo-container';
      
      _centerEl = document.createElement('div');
      _centerEl.id = 'g-center';
      _container.appendChild(_centerEl);
      
      _axes.forEach(axis => {
        var line = document.createElement('div');
        line.className = 'g-line';
        line.style.backgroundColor = axis.color;
        axis.elLine = line;
        _container.appendChild(line);
        
        var tip = document.createElement('div');
        tip.className = 'g-tip';
        tip.style.backgroundColor = axis.color;
        tip.innerText = axis.label;
        
        // --- NOVO: Lógica de Clique ---
        tip.onclick = function(e) {
          // Impede que o clique passe para o canvas 3D
          e.stopPropagation();
          if (onClick) onClick(axis.vec); // Envia o vetor (ex: 1,0,0) para o main
        };
        
        axis.elTip = tip;
        _container.appendChild(tip);
      });
      
      document.body.appendChild(_container);
    },
    
    update: function(camera) {
      if (!_container) return;
      
      _invRot.copy(camera.quaternion).invert();
      var sortList = [];
      sortList.push({ type: 'center', z: 0, el: _centerEl });
      
      _axes.forEach(axis => {
        var v = axis.vec.clone().applyQuaternion(_invRot);
        var endX = _center.x + (v.x * _radius);
        var endY = _center.y + (-v.y * _radius);
        
        // Posiciona Bolinha
        axis.elTip.style.left = (endX - 9) + 'px';
        axis.elTip.style.top = (endY - 9) + 'px';
        
        // Posiciona Linha
        var deltaX = endX - _center.x;
        var deltaY = endY - _center.y;
        var angle = Math.atan2(deltaY, deltaX);
        var len = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        axis.elLine.style.width = len + 'px';
        axis.elLine.style.transform = `translate(${_center.x}px, ${_center.y - 1.5}px) rotate(${angle}rad)`;
        
        sortList.push({ type: 'axis', z: v.z, elLine: axis.elLine, elTip: axis.elTip });
      });
      
      sortList.sort((a, b) => a.z - b.z);
      
      sortList.forEach((item, index) => {
        var zVal = index * 10;
        if (item.type === 'center') item.el.style.zIndex = zVal;
        else {
          item.elLine.style.zIndex = zVal;
          item.elTip.style.zIndex = zVal + 1;
        }
      });
    }
  };
})();



HtmlGizmo.init();



function animate2() {
  requestAnimationFrame(animate2);
  
  // ... controles e renderização normais ...
  
  // Atualiza a rotação do Gizmo HTML
  HtmlGizmo.update(camera);
}


animate2()