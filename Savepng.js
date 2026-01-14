const salvarBtn = document.getElementById("salvarBtn");

salvarBtn.addEventListener("click", () => {
  // 1. O segredo está aqui: pegar o ID correto ("renderCanvas") usado no ray.js
  const canvassave = document.getElementById("renderCanvas");
  
  if (!canvassave) {
    alert("Erro: O Canvas do Render não foi encontrado. Inicie o render primeiro.");
    return;
  }
  
  // 2. Garante que pegamos a imagem em alta qualidade
  const dataURL = canvassave.toDataURL("image/png", 1.0);
  
  // 3. Cria um nome único com base na hora para organizar seus renders
  const data = new Date();
  const timestamp = `${data.getHours()}h${data.getMinutes()}m${data.getSeconds()}s`;
  
  const link = document.createElement("a");
  link.download = `Render_RayTracer_${timestamp}.png`;
  link.href = dataURL;
  
  document.body.appendChild(link); // Necessário em alguns navegadores (Firefox)
  link.click();
  document.body.removeChild(link); // Limpa o elemento
  
  console.log("Imagem salva com sucesso!");
});