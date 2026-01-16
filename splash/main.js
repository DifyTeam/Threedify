// configuração temporal inicial
let t = 27000; // 45 minutos = 2700 segundos
const d = document.getElementById("timer");

// persistência de estado
const sk = "app_state_v2";
const tk = "timestamp_ref";

// recuperar estado anterior
const recuperarEstado = () => {
  try {
    const saved = localStorage.getItem(sk);
    const ts = localStorage.getItem(tk);
    if (saved && ts) {
      const elapsed = Math.floor((Date.now() - parseInt(ts)) / 1000);
      const remaining = parseInt(saved) - elapsed;
      return remaining > 0 ? remaining : -1;
    }
  } catch (e) {}
  return t;
};

// salvar progresso
const salvarEstado = (val) => {
  try {
    localStorage.setItem(sk, val.toString());
    localStorage.setItem(tk, Date.now().toString());
  } catch (e) {}
};

// FUNÇÃO DE RESET (apenas para desenvolvedor)
window.resetarTempoBeta = function() {
  localStorage.removeItem(sk);
  localStorage.removeItem(tk);
  location.reload();
};

// inicializar com estado recuperado
t = recuperarEstado();

// renderização inicial
atualizarTimer();

// verificação inicial de estado
if (t < 0) {
  aplicarLimitacoes();
}

// ciclo principal
const intervalo = setInterval(() => {
  t--;
  salvarEstado(t);
  
  if (t < 0) {
    clearInterval(intervalo);
    aplicarLimitacoes();
    return;
  }
  
  atualizarTimer();
}, 1000);

// atualização visual
function atualizarTimer() {
  const m = Math.floor(t / 60);
  const s = t % 60;
  d.textContent = `Beta Test Time:\n${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// sistema de proteção
function aplicarLimitacoes() {
  const splash = document.querySelector(".splash");
  
  if (splash) {
    splash.style.display = "flex";
    splash.classList.remove("hide");
    
    // Atualizar conteúdo da splash
    const conteudoSplash = splash.querySelector(".splash-content") || splash;
    conteudoSplash.innerHTML = `
      <h1 style="color: #ff4444; font-size: 3rem; margin-bottom: 1rem;">Beta Test Ended</h1>
      <p style="font-size: 1.5rem; color: #fff;">Your test period has expired.</p>
      <p style="font-size: 1rem; color: #aaa; margin-top: 1rem;">Thank you for participating!</p>
    `;
  }
  
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:transparent;z-index:999998;cursor:not-allowed;";
  document.body.appendChild(overlay);
  
  document.body.style.cssText += "pointer-events:none;user-select:none;-webkit-user-select:none;";
  document.documentElement.style.cssText += "pointer-events:none;user-select:none;";
  
  const bloqueio = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  };
  
  ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'keydown', 'keyup', 'contextmenu', 'submit', 'input', 'change'].forEach(ev => {
    document.addEventListener(ev, bloqueio, { capture: true, passive: false });
    window.addEventListener(ev, bloqueio, { capture: true, passive: false });
  });
  
  Object.defineProperty(document, 'body', {
    get: () => document.getElementsByTagName('body')[0],
    set: () => {},
    configurable: false
  });
  
  setInterval(() => {
    if (!overlay.parentNode) document.body.appendChild(overlay);
    if (splash && splash.style.display === "none") {
      splash.style.display = "flex";
      splash.classList.remove("hide");
    }
  }, 100);
}

const splash = document.querySelector(".splash");
if (splash) {
  splash.addEventListener("click", (e) => {
    if (t >= 0 && e.target === splash) {
      splash.classList.add("hide");
      setTimeout(() => {
        splash.style.display = "none";
      }, 0);
    }
  });
}

