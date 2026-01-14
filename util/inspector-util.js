// -----------------------------
// Inspector robusto - inspector.js
// -----------------------------

// pegar inputs
const posX = document.getElementById("pos_X");
const posY = document.getElementById("pos_Y");
const posZ = document.getElementById("pos_Z");

const scaleX = document.getElementById("scaleX");
const scaleY = document.getElementById("scaleY");
const scaleZ = document.getElementById("scaleZ");

const rotX = document.getElementById("rotX");
const rotY = document.getElementById("rotY");
const rotZ = document.getElementById("rotZ");

const allInputs = Array.from(document.querySelectorAll(".inp-prop"));

// variável global que você já usa
// let selectedObject = null;

// estado do editor
let editingField = null; // id do input atualmente em edição (ou null)
let lastAppliedValues = {}; // guarda últimos valores aplicados ao objeto para evitar re-aplicações inúteis

// Formatação segura
function toNum(v) {
    if (v === "" || v === null || v === undefined) return 0;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

// compara floats com tolerância
function nearlyEqual(a, b, eps = 1e-6) {
    return Math.abs(a - b) <= eps;
}

// atualiza inputs com valores do objeto (não sobrescreve o campo em edição)
function updateInspectorUI() {
    if (!selectedObject) {
        // se quiser que scale padrão seja 1 mude aqui; por especificação anterior colocamos 0
        setInputIfNotEditing(posX, 0);
        setInputIfNotEditing(posY, 0);
        setInputIfNotEditing(posZ, 0);

        setInputIfNotEditing(scaleX, 0);
        setInputIfNotEditing(scaleY, 0);
        setInputIfNotEditing(scaleZ, 0);

        setInputIfNotEditing(rotX, 0);
        setInputIfNotEditing(rotY, 0);
        setInputIfNotEditing(rotZ, 0);
        return;
    }

    setInputIfNotEditing(posX, selectedObject.position.x.toFixed(3));
    setInputIfNotEditing(posY, selectedObject.position.y.toFixed(3));
    setInputIfNotEditing(posZ, selectedObject.position.z.toFixed(3));

    setInputIfNotEditing(scaleX, selectedObject.scale.x.toFixed(3));
    setInputIfNotEditing(scaleY, selectedObject.scale.y.toFixed(3));
    setInputIfNotEditing(scaleZ, selectedObject.scale.z.toFixed(3));

    setInputIfNotEditing(rotX, THREE.MathUtils.radToDeg(selectedObject.rotation.x).toFixed(2));
    setInputIfNotEditing(rotY, THREE.MathUtils.radToDeg(selectedObject.rotation.y).toFixed(2));
    setInputIfNotEditing(rotZ, THREE.MathUtils.radToDeg(selectedObject.rotation.z).toFixed(2));
}

// só escreve no input se não for o que está sendo editado (ou se o valor mudou realmente)
function setInputIfNotEditing(inputEl, value) {
    if (!inputEl) return;
    const id = inputEl.id;
    // se usuário está editando esse campo, não sobrescrever
    if (editingField === id) return;

    const asString = String(value);
    if (inputEl.value === asString) return; // já está igual

    inputEl.value = asString;
}

// aplica mudanças do input para o objeto, mas evita re-aplicar o mesmo valor repetidamente
function applyToObject(field, newValue) {
    if (!selectedObject) return;

    // cache key
    const key = field;

    const prev = lastAppliedValues[key];
    if (typeof prev !== "undefined" && nearlyEqual(prev, newValue)) {
        // já aplicado
        return;
    }

    switch (field) {
        case "posX":
            if (!nearlyEqual(selectedObject.position.x, newValue)) selectedObject.position.x = newValue;
            break;
        case "posY":
            if (!nearlyEqual(selectedObject.position.y, newValue)) selectedObject.position.y = newValue;
            break;
        case "posZ":
            if (!nearlyEqual(selectedObject.position.z, newValue)) selectedObject.position.z = newValue;
            break;
        case "scaleX":
            if (!nearlyEqual(selectedObject.scale.x, newValue)) selectedObject.scale.x = newValue;
            break;
        case "scaleY":
            if (!nearlyEqual(selectedObject.scale.y, newValue)) selectedObject.scale.y = newValue;
            break;
        case "scaleZ":
            if (!nearlyEqual(selectedObject.scale.z, newValue)) selectedObject.scale.z = newValue;
            break;
        case "rotX":
            {
                const rad = THREE.MathUtils.degToRad(newValue);
                if (!nearlyEqual(selectedObject.rotation.x, rad)) selectedObject.rotation.x = rad;
            }
            break;
        case "rotY":
            {
                const rad = THREE.MathUtils.degToRad(newValue);
                if (!nearlyEqual(selectedObject.rotation.y, rad)) selectedObject.rotation.y = rad;
            }
            break;
        case "rotZ":
            {
                const rad = THREE.MathUtils.degToRad(newValue);
                if (!nearlyEqual(selectedObject.rotation.z, rad)) selectedObject.rotation.z = rad;
            }
            break;
    }

    lastAppliedValues[key] = newValue;
}

// configurar listeners de inputs
function applyInputListeners() {
    // ajuda comum: handle generic
    function onInputHandler(evt, fieldKey) {
        const el = evt.target;
        const num = toNum(el.value);
        applyToObject(fieldKey, num);
    }

    posX.addEventListener("input", (e) => onInputHandler(e, "posX"));
    posY.addEventListener("input", (e) => onInputHandler(e, "posY"));
    posZ.addEventListener("input", (e) => onInputHandler(e, "posZ"));

    scaleX.addEventListener("input", (e) => onInputHandler(e, "scaleX"));
    scaleY.addEventListener("input", (e) => onInputHandler(e, "scaleY"));
    scaleZ.addEventListener("input", (e) => onInputHandler(e, "scaleZ"));

    rotX.addEventListener("input", (e) => onInputHandler(e, "rotX"));
    rotY.addEventListener("input", (e) => onInputHandler(e, "rotY"));
    rotZ.addEventListener("input", (e) => onInputHandler(e, "rotZ"));

    // On change (finaliza) - força uma última aplicação e remove edição
    allInputs.forEach(inp => {
        inp.addEventListener("change", (e) => {
            const id = e.target.id;
            // aplicar última vez
            const mapping = idToFieldKey(id);
            if (mapping) {
                applyToObject(mapping, toNum(e.target.value));
            }
            // se o input estiver vazio e você quiser restaurar para 0, já está tratado em toNum
        });
    });
}

// mapeia id do input para chave usada em applyToObject
function idToFieldKey(id) {
    switch (id) {
        case "pos_X": return "posX";
        case "pos_Y": return "posY";
        case "pos_Z": return "posZ";
        case "scaleX": return "scaleX";
        case "scaleY": return "scaleY";
        case "scaleZ": return "scaleZ";
        case "rotX": return "rotX";
        case "rotY": return "rotY";
        case "rotZ": return "rotZ";
    }
    return null;
}

// configurar edição (focus/blur) e escape/cancel
function applyEditingGuards() {
    allInputs.forEach(inp => {
        inp.addEventListener("focus", (e) => {
            editingField = e.target.id;
        });
        inp.addEventListener("blur", (e) => {
            // aplicar valor final no blur
            const mapping = idToFieldKey(e.target.id);
            if (mapping) applyToObject(mapping, toNum(e.target.value));
            // limpar estado
            editingField = null;
        });

        // pointer events ajudam no mobile para marcar início de edição antes do focus
        inp.addEventListener("pointerdown", () => {
            // não substitui focus, apenas ajuda:
            editingField = inp.id;
        });
    });

    // ESC cancela edição e restaura valor real do objeto
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && editingField) {
            // restaurar valor do selectedObject naquele campo
            if (selectedObject) {
                updateInspectorUI(); // isso não sobrescreverá o campo se ainda estiver em focus? chamamos blur a seguir
            }
            // tirar foco do campo atual
            const el = document.getElementById(editingField);
            if (el) el.blur();
            editingField = null;
        }
    });
}

// loop de atualização (atualiza somente campos não editáveis no momento)
function liveInspectorUpdate() {
    // atualiza inspector com base no objeto
    updateInspectorUI();
    requestAnimationFrame(liveInspectorUpdate);
}

// opcional: conectar um TransformControls para atualizar quando objeto muda
// usage: attachTransformControls(myTransformControls);
function attachTransformControls(transformControls) {
    if (!transformControls || typeof transformControls.addEventListener !== "function") return;
    // event names differ por versão; 'objectChange' é comum; 'change' também pode ser disparado.
    transformControls.addEventListener("objectChange", () => {
        // só atualizamos UI (updateInspectorUI respeita editingField)
        updateInspectorUI();
    });
    transformControls.addEventListener("change", () => {
        updateInspectorUI();
    });
}

// iniciar
applyInputListeners();
applyEditingGuards();
liveInspectorUpdate();

// quando selecionar objeto no seu código faz:
// selectedObject = objeto;
// // reset cache dos valores aplicados para não bloquear aplicação de novos valores
// lastAppliedValues = {};
// updateInspectorUI();

// se quiser ligar ao transformcontrols
// attachTransformControls(transformControls);