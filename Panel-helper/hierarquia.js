// ==========================================
// COMANDOS DE HIERARQUIA (UNDO/REDO)
// ==========================================

class ReparentCommand extends Command {
    constructor(object, newParent, oldParent) {
        super('Alterar Hierarquia');
        this.object = object;
        this.newParent = newParent;
        this.oldParent = oldParent;
    }

    execute() {
        // Usamos attach para manter a transformação global (posição visual)
        // O hook 'add' no arquivo abaixo cuidará da atualização da UI
        this.newParent.attach(this.object);
        
        // Garante atualização da seta do pai antigo se necessário
        if (this.oldParent && window.hierarchyMap && window.hierarchyMap.has(this.oldParent.uuid)) {
             // O updateArrow será chamado automaticamente pelos observers, mas forçamos visualização se precisar
        }
    }

    undo() {
        this.oldParent.attach(this.object);
    }
}

class RenameCommand extends Command {
    constructor(object, oldName, newName, labelElement) {
        super('Renomear Objeto');
        this.object = object;
        this.oldName = oldName;
        this.newName = newName;
        // Referência direta ao elemento DOM para atualização instantânea
        this.labelElement = labelElement; 
    }

    execute() {
        this.object.name = this.newName;
        this.updateUI(this.newName);
    }

    undo() {
        this.object.name = this.oldName;
        this.updateUI(this.oldName);
    }

    updateUI(name) {
        // Tenta usar o elemento passado, senão busca no mapa
        if (this.labelElement) {
            this.labelElement.textContent = name;
        } else if (window.hierarchyMap && window.hierarchyMap.has(this.object.uuid)) {
            const data = window.hierarchyMap.get(this.object.uuid);
            const label = data.div.querySelector(".label-obj");
            if (label) label.textContent = name;
        }
    }
}

// ==========================================
// LÓGICA DA HIERARQUIA
// ==========================================

(function waitForHierarchy() {
  const hierarchyContainer = document.querySelector(".objscts");

  if (!hierarchyContainer) {
    console.warn("Aguardando div .objscts...");
    return setTimeout(waitForHierarchy, 100);
  }

  console.log("Hierarquia carregada com suporte a Undo/Redo!");

  window.selectableObjects = window.selectableObjects || [];
  window.selectedObject = window.selectedObject || null;

  // Mapa para rastrear UUID -> Elementos DOM
  const hierarchyMap = new Map();

  // EXPORTA O hierarchyMap PARA O ESCOPO GLOBAL
  window.hierarchyMap = hierarchyMap;

  // FUNÇÃO AUXILIAR PARA REMOÇÃO RECURSIVA DA HIERARQUIA
  function removeHierarchyRecursive(obj) {
    if (!obj || !hierarchyMap) return;
    
    const data = hierarchyMap.get(obj.uuid);
    if (data) {
      // Remover o container DOM completamente
      if (data.container && data.container.parentNode) {
        data.container.parentNode.removeChild(data.container);
      }
      // Remover do mapa
      hierarchyMap.delete(obj.uuid);
    }
    
    // Remover filhos recursivamente (IMPORTANTE: iterar sobre cópia do array)
    if (obj.children && obj.children.length > 0) {
      // Fazer cópia do array porque estamos modificando durante a iteração
      const childrenCopy = [...obj.children];
      childrenCopy.forEach(child => {
        removeHierarchyRecursive(child);
      });
    }
  }

  function addToHierarchy(obj, parentDiv = null) {
    // Se o objeto já existe, retornamos os dados dele para manipulação externa,
    // mas não recriamos o HTML para evitar duplicatas.
    if (hierarchyMap.has(obj.uuid)) {
        return hierarchyMap.get(obj.uuid);
    }

    // --- FILTRO DE PARTES INTERNAS DA LUZ ---
    if (obj.name === "RayLightSource" || obj.isLine) return;

    const container = document.createElement("div");
    container.className = "hierarchy-item-container";
    container.dataset.uuid = obj.uuid;

    // Estilo inicial para animação de entrada
    container.style.opacity = "0";
    container.style.transform = "translateY(-10px)";
    container.style.transition = "opacity 0.3s ease, transform 0.3s ease";

    const div = document.createElement("div");
    div.className = "entity-objto";
    div.draggable = true;
    div.style.cssText = `
      display: flex;
      align-items: center;
      padding: 1px 8px;
      cursor: pointer;
      user-select: none;
      border-radius: 3px;
      margin: 1px 0;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      min-height: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    `;

    // Seta para expandir/colapsar - Estilo Maya/Blender
    const arrow = document.createElement("span");
    arrow.className = "hierarchy-arrow";
    arrow.innerHTML = "▸";
    arrow.style.cssText = `
      display: none;
      cursor: pointer;
      margin-right: 6px;
      font-size: 12px;
      color: #aaaaaa;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      transform: rotate(0deg);
      width: 14px;
      height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 2px;
      flex-shrink: 0;
    `;

    // Ícone do objeto - Estilo profissional
    const icon = document.createElement("img");
    icon.src = "Panel-helper/obj-rep.png";
    icon.className = "hierarchy-icon";
    icon.style.cssText = `
      width: 16px;
      height: 16px;
      margin-right: 6px;
      opacity: 0.85;
      flex-shrink: 0;
      filter: brightness(0.95);
    `;

    // Label do objeto
    const label = document.createElement("p");
    label.className = "label-obj";
    label.textContent = obj.name || "SemNome";
    label.style.cssText = `
      margin: 0;
      padding: 0;
      font-size: 12px;
      color: #d4d4d4;
      font-weight: 400;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      letter-spacing: 0.2px;
    `;

    div.appendChild(arrow);
    div.appendChild(icon);
    div.appendChild(label);

    // Hover effect
    div.addEventListener("mouseenter", () => {
      if (!div.classList.contains("selected")) {
        div.style.backgroundColor = "#3a3a3a";
      }
    });

    div.addEventListener("mouseleave", () => {
      if (!div.classList.contains("selected")) {
        div.style.backgroundColor = "";
      }
    });

    // Container para os filhos (aninhamento)
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "hierarchy-children";
    childrenContainer.style.cssText = `
      margin-left: 20px;
      overflow: hidden;
      max-height: 0px;
      transition: max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      border-left: 1px solid #333333;
      padding-left: 4px;
    `;

    container.appendChild(div);
    container.appendChild(childrenContainer);

    // Armazena no Map
    const nodeData = {
      div,
      container,
      childrenContainer,
      arrow,
      obj
    };
    hierarchyMap.set(obj.uuid, nodeData);

    // Animação de entrada
    setTimeout(() => {
      container.style.opacity = "1";
      container.style.transform = "translateY(0)";
    }, 10);

    // --- Recursividade com FILTRO ---
    if (obj.children && obj.children.length > 0) {
      obj.children.forEach(child => {
        if (child.name === "RayLightSource" || child.isLine) {
            return; 
        }
        if (child.isMesh || child.isGroup || child.isObject3D) {
          addToHierarchy(child, childrenContainer);
        }
      });
    }

    // Lógica da Seta (Expandir/Colapsar)
    arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = childrenContainer.style.maxHeight !== "0px" && childrenContainer.style.maxHeight !== "";

      if (isExpanded) {
        // Colapsar
        childrenContainer.style.maxHeight = childrenContainer.scrollHeight + "px";
        setTimeout(() => {
          childrenContainer.style.maxHeight = "0px";
        }, 10);
        arrow.style.transform = "rotate(0deg)";
        arrow.style.color = "#aaaaaa";
      } else {
        // Expandir
        childrenContainer.style.maxHeight = "none";
        const totalHeight = childrenContainer.scrollHeight;
        childrenContainer.style.maxHeight = "0px";
        
        setTimeout(() => {
          childrenContainer.style.maxHeight = (totalHeight + 500) + "px";
        }, 10);
        
        arrow.style.transform = "rotate(90deg)";
        arrow.style.color = "#ffffff";
      }
    });

    // Hover na seta
    arrow.addEventListener("mouseenter", () => {
      arrow.style.backgroundColor = "#444444";
    });

    arrow.addEventListener("mouseleave", () => {
      arrow.style.backgroundColor = "";
    });

    // Função para atualizar visibilidade da seta
    function updateArrow() {
      if (obj.name === "Point ligth") {
          arrow.style.display = "none";
          return;
      }

      let hasValidChildren = false;
      if (obj.children && obj.children.length > 0) {
          for(let c of obj.children) {
              if (c.name !== "RayLightSource" && !c.isLine) {
                  hasValidChildren = true;
                  break;
              }
          }
      }
      arrow.style.display = hasValidChildren ? "inline-flex" : "none";
    }

    // --- Observer para Adições/Remoções Futuras ---
    // Apenas sobrescrevemos se ainda não tiver sido feito (evitar recursão infinita se chamar addToHierarchy 2x)
    if (!obj._hierarchyHooked) {
        obj._hierarchyHooked = true; // Flag para garantir que só aplicamos o hook uma vez

        const originalAdd = obj.add;
        obj.add = function(child) {
            // Chama a função original do Three.js
            const result = originalAdd.call(this, child);
            
            // Filtra visualização
            if (child.name !== "RayLightSource" && !child.isLine) {
                
                // === CORREÇÃO DE HIERARQUIA VISUAL ===
                const existingData = hierarchyMap.get(child.uuid);

                if (existingData) {
                    // Se JÁ EXISTE, apenas movemos o elemento DOM para o novo container
                    // appendChild remove automaticamente do pai anterior no DOM
                    childrenContainer.appendChild(existingData.container);
                } else {
                    // Se NÃO EXISTE, cria
                    addToHierarchy(child, childrenContainer);
                }
                
                updateArrow();
            }
            
            // Auto-expandir se não for a Luz
            if (obj.name !== "Point ligth" && childrenContainer.style.maxHeight === "0px" && child.name !== "RayLightSource" && !child.isLine) {
                 setTimeout(() => {
                     childrenContainer.style.maxHeight = "none";
                     arrow.style.transform = "rotate(90deg)";
                     arrow.style.color = "#ffffff";
                 }, 50);
            }
            
            return result;
        };

        const originalRemove = obj.remove;
        obj.remove = function(child) {
            const result = originalRemove.call(this, child);
            
            // Nota: No Three.js, quando você faz um .add() em um novo pai, ele chama .remove() do pai antigo automaticamente.
            // Não queremos deletar o DOM se ele estiver sendo apenas movido (o add do novo pai cuidará disso).
            // A deleção real só deve ocorrer se o objeto for removido da cena completamente, não num re-parenting.
            
            setTimeout(() => {
                // Se o child não tem pai ou o pai é null, removemos do DOM.
                // Se ele tem um novo pai, o 'add' do novo pai já moveu o DOM, então não deletamos.
                if (!child.parent && hierarchyMap.has(child.uuid)) {
                   const childData = hierarchyMap.get(child.uuid);
                   childData.container.remove();
                   hierarchyMap.delete(child.uuid);
                }
                updateArrow();
            }, 0);

            return result;
        };
    }
    
    // Atualiza estado inicial da seta e flag do hook
    updateArrow();

    // Seleção do Objeto
    div.addEventListener("click", (e) => {
      if (e.target.tagName === "INPUT") return;
      
      window.selectedObject = obj;
      if (typeof selectedObject !== 'undefined') selectedObject = obj;
      
      if (window.transformControls && typeof gizmoAtivo !== 'undefined' && gizmoAtivo) {
        window.transformControls.attach(obj);
      }
      highlightHierarchyItem(div);
    });

    // === Edição de nome (Duplo Clique) COM UNDO/REDO ===
    div.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const label = div.querySelector(".label-obj");
      const currentName = label.textContent;

      const input = document.createElement("input");
      input.type = "text";
      input.value = currentName;
      input.className = "hierarchy-name-edit";
      input.style.cssText = `
          background: #2a2a2a;
          color: #ffffff;
          border: 0px solid #4a90e2;
          outline: none;
          font-size: 12px;
          font-weight: 400;
          padding: 2px 6px;
          border-radius: 3px;
          width: ${label.offsetWidth + 30}px;
          height: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          letter-spacing: 0.2px;
          box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2);
        `;

      div.replaceChild(input, label);
      input.focus();
      input.select();

      const saveEdit = () => {
        const newName = input.value.trim() || "SemNome";
        
        // Verifica se houve mudança real
        if (newName !== currentName) {
            // Executa comando de renomeação
            commandManager.execute(new RenameCommand(obj, currentName, newName, label));
        }
        
        // A label já é atualizada pelo execute() do comando, só precisamos recolocar no DOM
        if(div.contains(input)) div.replaceChild(label, input);
      };

      input.addEventListener("blur", saveEdit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
             saveEdit();
             input.blur(); 
        }
        if (e.key === "Escape") {
            if(div.contains(input)) div.replaceChild(label, input);
        }
      });
    });

    // === Drag & Drop (Início) ===
    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", obj.uuid);
      div.style.opacity = "0.5";
      div.style.transform = "scale(0.98)";
    });

    div.addEventListener("dragend", (e) => {
      div.style.opacity = "1";
      div.style.transform = "scale(1)";
    });

    // === Drag & Drop (Alvo) ===
    div.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (obj.name === "Point ligth") return;

      div.classList.add("drag-over");
      div.style.backgroundColor = "#494949"; 
      div.style.boxShadow = "inset 0 0 0 2px #494949";
    });

    div.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      div.classList.remove("drag-over");
      div.style.backgroundColor = "";
      div.style.boxShadow = "";
    });

    div.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      div.classList.remove("drag-over");
      div.style.backgroundColor = "";
      div.style.boxShadow = "";
      
      if (obj.name === "Point ligth") return;

      const draggedUUID = e.dataTransfer.getData("text/plain");
      const draggedObj = scene.getObjectByProperty('uuid', draggedUUID);
      
      if (!draggedObj || draggedObj === obj) return;

      // Verificação de ciclo (não pode ser pai do próprio avô)
      let parent = obj;
      while (parent) {
        if (parent === draggedObj) {
            console.warn("Loop de parentesco evitado");
            return;
        }
        parent = parent.parent;
      }

      // Executa comando de Reparent (Undo/Redo suportado)
      // Passamos o objeto, o NOVO pai (obj atual do drop) e o ANTIGO pai
      commandManager.execute(new ReparentCommand(draggedObj, obj, draggedObj.parent));
    });

    if (parentDiv) {
      parentDiv.appendChild(container);
    } else {
      hierarchyContainer.appendChild(container);
    }

    return nodeData;
  }

  function highlightHierarchyItem(div) {
    if (!div) return;
    
    document.querySelectorAll('.entity-objto').forEach(el => {
        el.style.backgroundColor = "";
        el.style.boxShadow = "";
        el.classList.remove("selected");
        const l = el.querySelector(".label-obj");
        if(l) {
          l.style.color = "#d4d4d4";
          l.style.fontWeight = "400";
        }
        const i = el.querySelector(".hierarchy-icon");
        if(i) i.style.opacity = "0.85";
    });

    div.style.backgroundColor = "#494949";
    div.style.boxShadow = "inset 0 0 0 1px #494949";
    div.classList.add("selected");
    const label = div.querySelector(".label-obj");
    if (label) {
      label.style.color = "#FB9C40";
      label.style.fontWeight = "500";
    }
    const icon = div.querySelector(".hierarchy-icon");
    if (icon) icon.style.opacity = "1";
  }

  // === Drop na Raiz COM UNDO/REDO ===
  hierarchyContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  hierarchyContainer.addEventListener("drop", (e) => {
    // Evita conflito se dropar em cima de um item existente (já tratado no div drop)
    if (e.target.closest(".entity-objto")) return;
    
    e.preventDefault();

    const draggedUUID = e.dataTransfer.getData("text/plain");
    const draggedObj = scene.getObjectByProperty('uuid', draggedUUID);
    
    if (!draggedObj) return;
    if (draggedObj.parent === scene) return; // Já está na raiz

    // Executa comando de Reparent para a CENA (Raiz)
    commandManager.execute(new ReparentCommand(draggedObj, scene, draggedObj.parent));
    
    // O comando usa .attach(), o hook .add da scene (se houver) ou a lógica abaixo lida com o DOM
    // Como a Scene padrão do Threejs não tem nosso hook 'add' customizado, garantimos visualmente aqui
    // Nota: Se 'add' da Scene não tiver hook, o DOM não atualiza sozinho.
    // Mas no execute() do comando chamamos newParent.attach(). 
    
    // Fallback visual para a raiz:
    setTimeout(() => {
        const childData = hierarchyMap.get(draggedUUID);
        if (childData && childData.container) {
            hierarchyContainer.appendChild(childData.container);
        }
    }, 10);
  });

  const originalPush = selectableObjects.push;
  selectableObjects.push = function(obj) {
    // Verifica se já não foi adicionado antes de chamar
    if (!hierarchyMap.has(obj.uuid)) {
        addToHierarchy(obj);
    }
    return originalPush.call(this, obj);
  };

  // Inicializa com objetos existentes
  selectableObjects.forEach(obj => {
      if(!hierarchyMap.has(obj.uuid)) addToHierarchy(obj);
  });

  // A função removeFromHierarchy que você usará no seu script de deleção
  window.removeFromHierarchy = function(obj) {
    removeHierarchyRecursive(obj);
  };

  Object.defineProperty(window, "selectedObject", {
    get() {
      return this._selectedObject;
    },
    set(value) {
      this._selectedObject = value;
    }
  });

})();