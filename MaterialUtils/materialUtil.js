const colorSquare = document.getElementById('colorSquare');
const colorSlider = document.getElementById('colorSlider');
const colorDot = document.getElementById('colorDot');
const sliderHandle = document.getElementById('sliderHandle');
const hexValue = document.getElementById('hexValue');

let hue = 0;
let sat = 100;
let val = 100;
let colorCallback = null;
let colorPickerContainer = null;

/* ------------------ SLIDER (MATIZ) --------------------- */

function createHueSlider() {
	if (!colorSlider) return;
	
	const rect = colorSlider.getBoundingClientRect();
	
	const ctx = document.createElement("canvas").getContext("2d");
	const canvas = ctx.canvas;
	
	// Agora o canvas tem EXATAMENTE o tamanho do slider real
	canvas.width = rect.width;
	canvas.height = rect.height;
	
	const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
	
	for (let i = 0; i <= 360; i += 60) {
		grad.addColorStop(i / 360, `hsl(${i}, 100%, 50%)`);
	}
	
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	
	colorSlider.style.background = `url(${canvas.toDataURL()})`;
	colorSlider.style.backgroundSize = "100% 100%"; // garante que preenche exato
}
/* ------------------ QUADRADO HSV --------------------- */

function updateColorSquare() {
	if (!colorSquare) return;
	
	const ctx = document.createElement("canvas").getContext("2d");
	const canvas = ctx.canvas;
	
	// Canvas interno também fixo
	canvas.width = 256;
	canvas.height = 256;
	
	ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	
	const whiteGrad = ctx.createLinearGradient(0, 0, canvas.width, 0);
	whiteGrad.addColorStop(0, "rgba(255,255,255,1)");
	whiteGrad.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = whiteGrad;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	
	const blackGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
	blackGrad.addColorStop(0, "rgba(0,0,0,0)");
	blackGrad.addColorStop(1, "rgba(0,0,0,1)");
	ctx.fillStyle = blackGrad;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	
	colorSquare.style.backgroundImage = `url(${canvas.toDataURL()})`;
}

/* ------------------ HSV → HEX --------------------- */

function hsvToHex(h, s, v) {
	s /= 100;
	v /= 100;
	let c = v * s;
	let x = c * (1 - Math.abs((h / 60) % 2 - 1));
	let m = v - c;
	
	let r, g, b;
	
	if (h < 60)[r, g, b] = [c, x, 0];
	else if (h < 120)[r, g, b] = [x, c, 0];
	else if (h < 180)[r, g, b] = [0, c, x];
	else if (h < 240)[r, g, b] = [0, x, c];
	else if (h < 300)[r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	
	r = Math.round((r + m) * 255).toString(16).padStart(2, "0").toUpperCase();
	g = Math.round((g + m) * 255).toString(16).padStart(2, "0").toUpperCase();
	b = Math.round((b + m) * 255).toString(16).padStart(2, "0").toUpperCase();
	
	return `#${r}${g}${b}`;
}

function updateSelectedColor() {
	const hex = hsvToHex(hue, sat, val);
	if (hexValue) {
		hexValue.textContent = hex;
	}
	
	// Chama o callback se existir
	if (colorCallback) {
		colorCallback(hex);
	}
}

/* ------------------ EVENTOS DO QUADRADO --------------------- */

if (colorSquare) {
	colorSquare.addEventListener("mousedown", startSquareDrag);
	colorSquare.addEventListener("touchstart", startSquareDrag);
}

function startSquareDrag(e) {
	e.preventDefault();
	document.addEventListener("mousemove", dragSquare);
	document.addEventListener("touchmove", dragSquare);
	document.addEventListener("mouseup", stopSquareDrag);
	document.addEventListener("touchend", stopSquareDrag);
	updateSquare(e);
}

function dragSquare(e) {
	updateSquare(e);
}

function stopSquareDrag() {
	document.removeEventListener("mousemove", dragSquare);
	document.removeEventListener("touchmove", dragSquare);
	document.removeEventListener("mouseup", stopSquareDrag);
	document.removeEventListener("touchend", stopSquareDrag);
}

function updateSquare(e) {
	if (!colorSquare) return;
	
	const rect = colorSquare.getBoundingClientRect();
	
	const x = Math.max(0, Math.min(1,
		((e.clientX || e.touches[0].clientX) - rect.left) / rect.width
	));
	
	const y = Math.max(0, Math.min(1,
		((e.clientY || e.touches[0].clientY) - rect.top) / rect.height
	));
	
	sat = Math.round(x * 100);
	val = Math.round(100 - y * 100);
	
	if (colorDot) {
		colorDot.style.left = `${x * 100}%`;
		colorDot.style.top = `${y * 100}%`;
	}
	
	updateSelectedColor();
}

/* ------------------ EVENTOS DO SLIDER --------------------- */

if (colorSlider) {
	colorSlider.addEventListener("mousedown", startSliderDrag);
	colorSlider.addEventListener("touchstart", startSliderDrag);
}

function startSliderDrag(e) {
	e.preventDefault();
	document.addEventListener("mousemove", dragSlider);
	document.addEventListener("touchmove", dragSlider);
	document.addEventListener("mouseup", stopSliderDrag);
	document.addEventListener("touchend", stopSliderDrag);
	updateSlider(e);
}

function dragSlider(e) {
	updateSlider(e);
}

function stopSliderDrag() {
	document.removeEventListener("mousemove", dragSlider);
	document.removeEventListener("touchmove", dragSlider);
	document.removeEventListener("mouseup", stopSliderDrag);
	document.removeEventListener("touchend", stopSliderDrag);
}

function updateSlider(e) {
	if (!colorSlider) return;
	
	const rect = colorSlider.getBoundingClientRect();
	
	const x = Math.max(0, Math.min(1,
		((e.clientX || e.touches[0].clientX) - rect.left) / rect.width
	));
	
	hue = Math.round(x * 360);
	
	if (sliderHandle) {
		sliderHandle.style.left = `${x * 100}%`;
	}
	
	updateColorSquare();
	updateSelectedColor();
}

/* ------------------ FUNÇÕES GLOBAIS --------------------- */

// Função para inicializar o container (chamar isso no HTML depois que o DOM carregar)
window.initColorPicker = function(containerId) {
	colorPickerContainer = document.getElementById(containerId);
	
	if (!colorPickerContainer) {
		console.error(`Container do color picker '${containerId}' não encontrado!`);
	}
};

// Função global para abrir o color picker
window.openColorPicker = function(callback) {
	// Tenta pegar o container se ainda não foi inicializado
	if (!colorPickerContainer) {
		colorPickerContainer = document.getElementById('colorPickerContainer');
	}
	
	if (!colorPickerContainer) {
		console.error('Color picker container não encontrado! Certifique-se de ter um elemento com id="colorPickerContainer"');
		return;
	}
	
	colorCallback = callback;
	colorPickerContainer.style.display = 'block';
	
	// Recria o slider caso o tamanho tenha mudado
	setTimeout(() => {
		createHueSlider();
	}, 10);
};

// Função global para fechar o color picker
window.closeColorPicker = function() {
	if (colorPickerContainer) {
		colorPickerContainer.style.display = 'none';
	}
	colorCallback = null;
};

// Função global para obter a cor atual
window.getCurrentColor = function() {
	return hsvToHex(hue, sat, val);
};

// Função global para definir uma cor
window.setColorPickerColor = function(hexColor) {
	if (!hexColor || hexColor.length < 7) return;
	
	// Converte hex para HSV
	const r = parseInt(hexColor.substr(1, 2), 16) / 255;
	const g = parseInt(hexColor.substr(3, 2), 16) / 255;
	const b = parseInt(hexColor.substr(5, 2), 16) / 255;
	
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	
	// Value
	val = Math.round(max * 100);
	
	// Saturation
	sat = max === 0 ? 0 : Math.round((delta / max) * 100);
	
	// Hue
	if (delta === 0) {
		hue = 0;
	} else if (max === r) {
		hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
	} else if (max === g) {
		hue = ((b - r) / delta + 2) * 60;
	} else {
		hue = ((r - g) / delta + 4) * 60;
	}
	
	hue = Math.round(hue);
	
	// Atualiza UI
	if (sliderHandle) {
		sliderHandle.style.left = `${(hue / 360) * 100}%`;
	}
	
	if (colorDot) {
		colorDot.style.left = `${sat}%`;
		colorDot.style.top = `${100 - val}%`;
	}
	
	updateColorSquare();
	updateSelectedColor();
};

// Fechar ao clicar fora do picker
document.addEventListener('click', (e) => {
	if (colorPickerContainer && 
	    colorPickerContainer.style.display === 'block' &&
	    !colorPickerContainer.contains(e.target) &&
	    !e.target.closest('#color-mat')) {
		window.closeColorPicker();
	}
});

/* ------------------ INIT --------------------- */

// Inicialização com delay para garantir que DOM carregou
setTimeout(() => {
	createHueSlider();
	updateColorSquare();
	updateSelectedColor();
}, 100);