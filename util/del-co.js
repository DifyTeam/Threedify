// -------------------------------
// utill-simples-cop-del.js - COM UNDO/REDO
// -------------------------------
const btnCopy = document.getElementById("copyyy");
const btnDelete = document.getElementById("dell");

// função para limpar geometria/material
function disposeObject(obj) {
	if (!obj) return;
	
	if (obj.geometry) obj.geometry.dispose();
	
	if (obj.material) {
		if (Array.isArray(obj.material)) {
			obj.material.forEach(m => m.dispose());
		} else {
			obj.material.dispose();
		}
	}
	
	obj.children.forEach(child => disposeObject(child));
}

// função recursiva para remover do hierarchyMap e DOM
function removeFromHierarchy(obj) {
	if (!obj || !window.hierarchyMap) return;
	
	const data = hierarchyMap.get(obj.uuid);
	if (data) {
		// remover DOM
		if (data.container && data.container.parentNode) {
			data.container.parentNode.removeChild(data.container);
		}
		hierarchyMap.delete(obj.uuid);
	}
	
	// recursivamente para filhos
	if (obj.children && obj.children.length > 0) {
		obj.children.forEach(child => removeFromHierarchy(child));
	}
}

// ==============================================
// COMANDO: DELETAR OBJETO
// ==============================================
class DeleteObjectCommand extends Command {
	constructor(object, parent, selectableObjects) {
		super('Deletar Objeto');
		this.object = object;
		this.parent = parent;
		this.selectableObjects = selectableObjects;
		
		// Salvar informações para restauração
		this.objectIndex = selectableObjects.indexOf(object);
		this.wasSelected = (window.selectedObject === object);
		
		// Salvar dados da hierarquia antes de deletar
		this.hierarchyData = null;
		if (window.hierarchyMap && hierarchyMap.has(object.uuid)) {
			const data = hierarchyMap.get(object.uuid);
			this.hierarchyData = {
				uuid: object.uuid,
				container: data.container,
				parentElement: data.container ? data.container.parentNode : null
			};
		}
		
		// Salvar estado do TransformControls
		this.hadTransformControls = false;
		if (window.transformControls && transformControls.object === object) {
			this.hadTransformControls = true;
		}
	}
	
	execute() {
		// Desanexa TransformControls se estiver ativo
		if (window.transformControls && transformControls.object === this.object) {
			transformControls.detach();
		}
		
		// Remover da cena
		if (this.object.parent) {
			this.object.parent.remove(this.object);
		}
		
		// Remover da lista de selecionáveis
		const index = this.selectableObjects.indexOf(this.object);
		if (index !== -1) {
			this.selectableObjects.splice(index, 1);
		}
		
		// Remover do hierarchyMap e DOM
		removeFromHierarchy(this.object);
		
		// Limpar seleção se estava selecionado
		if (this.wasSelected) {
			window.selectedObject = null;
		}
	}
	
	undo() {
		// Adicionar de volta à cena
		if (this.parent) {
			this.parent.add(this.object);
		}
		
		// Adicionar de volta à lista de selecionáveis na posição original
		if (this.objectIndex >= 0) {
			this.selectableObjects.splice(this.objectIndex, 0, this.object);
		} else {
			this.selectableObjects.push(this.object);
		}
		
		// Restaurar hierarquia
		if (typeof addToHierarchy === "function") {
			addToHierarchy(this.object);
		} else if (this.hierarchyData && this.hierarchyData.container) {
			// Restaurar manualmente se addToHierarchy não existir
			if (this.hierarchyData.parentElement) {
				this.hierarchyData.parentElement.appendChild(this.hierarchyData.container);
			}
			if (window.hierarchyMap) {
				hierarchyMap.set(this.object.uuid, {
					container: this.hierarchyData.container
				});
			}
		}
		
		// Restaurar seleção se estava selecionado
		if (this.wasSelected) {
			window.selectedObject = this.object;
			
			// Restaurar TransformControls se estava ativo
			if (this.hadTransformControls && window.transformControls) {
				transformControls.attach(this.object);
			}
		}
	}
}

// ==============================================
// COMANDO: COPIAR OBJETO
// ==============================================
class CopyObjectCommand extends Command {
	constructor(sourceObject, parent, selectableObjects) {
		super('Copiar Objeto');
		this.sourceObject = sourceObject;
		this.parent = parent;
		this.selectableObjects = selectableObjects;
		this.clone = null;
		this.previousSelection = window.selectedObject;
	}
	
	execute() {
		// Criar clone se ainda não existe
		if (!this.clone) {
			this.clone = this.sourceObject.clone(true);
			
			// Copiar transformações
			this.clone.position.copy(this.sourceObject.position);
			this.clone.rotation.copy(this.sourceObject.rotation);
			this.clone.scale.copy(this.sourceObject.scale);
			
			// Deslocar ligeiramente
			this.clone.position.x += 0.0001;
		}
		
		// Adicionar à cena
		if (this.parent) {
			this.parent.add(this.clone);
		}
		
		// Adicionar à lista de selecionáveis
		if (!this.selectableObjects.includes(this.clone)) {
			this.selectableObjects.push(this.clone);
		}
		
		// Tornar clone selecionado
		window.selectedObject = this.clone;
		
		// Adicionar à hierarquia
		if (typeof addToHierarchy === "function") {
			addToHierarchy(this.clone);
		}
		
		// Anexar TransformControls se existir
		if (window.transformControls) {
			transformControls.attach(this.clone);
		}
	}
	
	undo() {
		// Desanexa TransformControls se estiver no clone
		if (window.transformControls && transformControls.object === this.clone) {
			transformControls.detach();
		}
		
		// Remover da cena
		if (this.clone.parent) {
			this.clone.parent.remove(this.clone);
		}
		
		// Remover da lista de selecionáveis
		const index = this.selectableObjects.indexOf(this.clone);
		if (index !== -1) {
			this.selectableObjects.splice(index, 1);
		}
		
		// Remover da hierarquia
		removeFromHierarchy(this.clone);
		
		// Restaurar seleção anterior
		window.selectedObject = this.previousSelection;
		
		// Restaurar TransformControls na seleção anterior
		if (this.previousSelection && window.transformControls) {
			transformControls.attach(this.previousSelection);
		}
	}
}

// ==============================================
// EVENT LISTENERS COM UNDO/REDO
// ==============================================

// --- DELETAR OBJETO ---
btnDelete.addEventListener("click", () => {
	if (!selectedObject) return;
	
	const parent = selectedObject.parent;
	
	// Criar e executar comando através do CommandManager
	const deleteCommand = new DeleteObjectCommand(
		selectedObject,
		parent,
		selectableObjects
	);
	
	commandManager.execute(deleteCommand);
});

// --- COPIAR OBJETO ---
btnCopy.addEventListener("click", () => {
	if (!selectedObject) return;
	
	const parent = selectedObject.parent;
	
	// Criar e executar comando através do CommandManager
	const copyCommand = new CopyObjectCommand(
		selectedObject,
		parent,
		selectableObjects
	);
	
	commandManager.execute(copyCommand);
});