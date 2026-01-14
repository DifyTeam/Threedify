// gizmo.js - Funções de controle do gizmo

function desativarGizmo() {
  gizmoAtivo = false;
  transformControls.detach();
}

function ativarGizmo() {
  gizmoAtivo = true;
  if (selectedObject) {
    transformControls.attach(selectedObject);
  }
}

function setModoGizmo(modo) {
  if (['translate', 'rotate', 'scale'].includes(modo)) {
    transformControls.setMode(modo);
  }
}

function alternarModoGizmo() {
  const modos = ['translate', 'rotate', 'scale'];
  const modoAtual = transformControls.mode;
  const indexAtual = modos.indexOf(modoAtual);
  const proximoIndex = (indexAtual + 1) % modos.length;
  transformControls.setMode(modos[proximoIndex]);
  return modos[proximoIndex];
}

function getModoGizmo() {
  return transformControls.mode;
}


