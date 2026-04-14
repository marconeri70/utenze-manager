let utenze = JSON.parse(localStorage.getItem("utenze")) || [];
let fatture = JSON.parse(localStorage.getItem("fatture")) || [];

function showSection(id){

document.querySelectorAll("section").forEach(s=>s.classList.add("hidden"));

document.getElementById(id).classList.remove("hidden");

}

function addUtenza(){

let nome = document.getElementById("nomeUtenza").value;

let tipo = document.getElementById("tipoUtenza").value;

utenze.push({nome,tipo});

localStorage.setItem("utenze",JSON.stringify(utenze));

renderUtenze();

}

function renderUtenze(){

let ul = document.getElementById("listaUtenze");

ul.innerHTML="";

utenze.forEach(u=>{

let li = document.createElement("li");

li.textContent = u.nome+" - "+u.tipo;

ul.appendChild(li);

});

}

function addFattura(){

let fornitore = document.getElementById("fornitore").value;

let scadenza = document.getElementById("scadenza").value;

let importo = document.getElementById("importo").value;

fatture.push({

fornitore,

scadenza,

importo,

pagata:false

});

localStorage.setItem("fatture",JSON.stringify(fatture));

renderFatture();

renderScadenze();

}

function renderFatture(){

let ul = document.getElementById("listaFatture");

ul.innerHTML="";

fatture.forEach((f,i)=>{

let li = document.createElement("li");

li.innerHTML = f.fornitore+" - "+f.importo+"€ - "+f.scadenza+

" <button onclick='paga("+i+")'>Pagata</button>";

ul.appendChild(li);

});

}

function paga(i){

fatture[i].pagata=true;

localStorage.setItem("fatture",JSON.stringify(fatture));

renderFatture();

renderScadenze();

}

function renderScadenze(){

let div = document.getElementById("scadenze");

div.innerHTML="";

let oggi = new Date();

fatture.forEach(f=>{

let data = new Date(f.scadenza);

let diff = (data-oggi)/(1000*60*60*24);

if(diff<10 && !f.pagata){

let p = document.createElement("p");

p.textContent = f.fornitore+" scade "+f.scadenza;

div.appendChild(p);

}

});

}

renderUtenze();

renderFatture();

renderScadenze();
