const menu_btn = document.getElementById("file");
const add_btn = document.getElementById("add");
const menu1  = document.getElementById('file-menu');
const menu2  = document.getElementById('drop-obj');
const menu3  = document.getElementById('modos-menu');

const menu4  = document.getElementById('edittools');
const menu5  = document.getElementById('tollaction');
const menu6  = document.getElementById('tollaction2');
const menu7  = document.getElementById('materr-edit');
const menu8  = document.getElementById('make_mat');
const menu9  = document.getElementById('hier-three');
const menu10  = document.getElementById('prop-obj');
const menu11  = document.getElementById('render_setting');

//const div_cor_piker = document.getElementById("tobpar-Mt");
//const heirarquia = document.getElementById("heirarquia")

const modes_btn = document.getElementById("modes");
const add_box = document.getElementById("add-box");
const add_plan = document.getElementById("add_plan");
const add_ef = document.getElementById("add_ef");
const add_mc = document.getElementById("add_mc");
const add_cill = document.getElementById("add_cill");
const add_pira = document.getElementById("add_pira");

const btn_menu_prop_three = document.getElementById("three");
const btn_menu_prop_mat = document.getElementById("mat");
const btn_menu_prop_atrib = document.getElementById("prop");
const btn_menu_prop_render = document.getElementById("renderS");
//const div_cor_mat = document.getElementById("color-mat");



function menu_show() {
	menu1.style.display  = "flex"
	menu2.style.display = "none"
}

function modes_obj() {
	modes_btn.textContent = "objet-mode ▼"
}



function modes_edit() {
	modes_btn.textContent = "modeling-mode ▼"
}

function menu4_show() {
	menu4.style.display = "flex"
}

function menu5_show() {
	menu5.style.display = "flex"
}

function menu5_none() {
	menu5.style.display = "none"
}

function menu6_show() {
	menu6.style.display = "flex"
}

function menu6_none() {
	menu6.style.display = "none"
}

function menu4_none() {
	menu4.style.display = "none"
}



function menu2_show() {
	menu1.style.display  = "none"
	menu2.style.display = "flex"
}

function modos_show() {
	menu3.style.display = "flex"
}

function modos_none() {
	menu3.style.display = "none"
}

function menu_none() {
	menu1.style.display = "none"
}

function menu2_none() {
	menu2.style.display = "none"
}


function menu7_none() {
  menu7.style.display = "none"
  menu8.style.display = "none"
  menu9.style.display = "flex"
  menu10.style.display = "none"
  menu11.style.display = "none"
}

function menu7_show() {
	menu7.style.display = "block"
	menu8.style.display = "block"
	menu9.style.display = "none"
	menu10.style.display = "none"
	menu11.style.display = "none"
}

function menu8_show() {
	menu7.style.display = "none"
	menu8.style.display = "none"
	menu9.style.display = "none"
	menu11.style.display = "none"
	menu10.style.display = "block"
}

function menu9_show() {
	menu7.style.display = "none"
	menu8.style.display = "none"
	menu9.style.display = "none"
	menu10.style.display = "none"
	menu11.style.display = "block"
}


menu7_none()

function color_pik() {
	div_cor_piker.style.display  = "block";
}


function color_pik_hid() {
	div_cor_piker.style.display = "none";
}


canvas.addEventListener("touchmove", menu_none)
canvas.addEventListener("touchmove", menu2_none)
canvas.addEventListener("touchmove", modos_none)

btnNormal.addEventListener("click", modos_none)
btnEdicao.addEventListener("click", modos_none)
modes_btn.addEventListener("click", modos_show);
menu_btn.addEventListener("click", menu_show);
add_btn.addEventListener("click", menu2_show);
add_box.addEventListener("click", make_box);
add_plan.addEventListener("click", make_plan);
add_ef.addEventListener("click", eferaadd);
add_mc.addEventListener("click", monkey_blender);
add_cill.addEventListener("click", cilindro);
add_pira.addEventListener("click", piramide);
btn_menu_prop_mat.addEventListener("click", menu7_show);
btn_menu_prop_three.addEventListener("click", menu7_none);
btn_menu_prop_atrib.addEventListener("click", menu8_show);
btn_menu_prop_render.addEventListener("click", menu9_show);
//div_cor_mat.addEventListener("click", color_pik);
//heirarquia.addEventListener("click", color_pik_hid);