// tempo inicial em segundos (ex: 40 minuto = 2400)
let tempo = 30;
const timerEl = document.getElementById("timer");

// render inicial IMEDIATO (corrige o atraso)
atualizarTimer();

// inicia o contador
const intervalo = setInterval(() => {
  
  tempo--;
  
  if (tempo < 0) {
    clearInterval(intervalo);
    tempoAcabou();
    return;
  }
  
  atualizarTimer();
  
}, 1000);

// atualiza o texto do cronômetro
function atualizarTimer() {
  const minutos = Math.floor(tempo / 60);
  const segundos = tempo % 60;
  
  timerEl.textContent =
    `Beta Test Time:\n${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
}

// função chamada ao acabar o tempo
function tempoAcabou() {
  
}

const splash = document.querySelector(".splash");

splash.addEventListener("click", (e) => {
  // só fecha se clicar NA PRÓPRIA splash
  if (e.target === splash) {
    splash.classList.add("hide");
    
    setTimeout(() => {
      splash.style.display = "none";
    }, 0);
  }
});




