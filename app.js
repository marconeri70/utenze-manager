let utenze = JSON.parse(localStorage.getItem("utenze")) || []
let fatture = JSON.parse(localStorage.getItem("fatture")) || []
let autoletture = JSON.parse(localStorage.getItem("autoletture")) || []

function saveData(){

localStorage.setItem("utenze",JSON.stringify(utenze))

localStorage.setItem("fatture",JSON.stringify(fatture))

localStorage.setItem("autoletture",JSON.stringify(autoletture))

}

function showSection(id){

document.querySelectorAll("section").forEach(s=>s.classList.add("hidden"))

document.getElementById(id).classList.remove("hidden")

}

function addUtenza(){

let nome=document.getElementById("nomeUtenza").value

let tipo=document.getElementById("tipoUtenza").value

utenze.push({nome,tipo})

saveData()

renderUtenze()

}

function renderUtenze(){

let ul=document.getElementById("listaUtenze")

ul.innerHTML=""

utenze.forEach(u=>{

let li=document.createElement("li")

li.textContent=u.nome+" - "+u.tipo

ul.appendChild(li)

})

}

async function addFattura(){

let fornitore=document.getElementById("fornitore").value

let scadenza=document.getElementById("scadenza").value

let importo=document.getElementById("importo").value

let numero=document.getElementById("numeroFattura").value

let file=document.getElementById("pdf").files[0]

let pdfData=""

if(file){

pdfData=await file.arrayBuffer()

}

fatture.push({

fornitore,

scadenza,

importo,

numero,

pdfData,

pagata:false

})

saveData()

renderFatture()

renderScadenze()

}

function renderFatture(){

let ul=document.getElementById("listaFatture")

ul.innerHTML=""

fatture.forEach((f,i)=>{

let li=document.createElement("li")

li.innerHTML=

f.fornitore+" - "+f.importo+"€ - "+f.scadenza+

" <button onclick='paga("+i+")'>Pagata</button>"+

" <button onclick='apriPDF("+i+")'>Apri PDF</button>"

ul.appendChild(li)

})

}

function apriPDF(i){

let blob=new Blob([fatture[i].pdfData],{type:"application/pdf"})

let url=URL.createObjectURL(blob)

window.open(url)

}

function paga(i){

fatture[i].pagata=true

saveData()

renderFatture()

renderScadenze()

}

function renderScadenze(){

let div=document.getElementById("scadenze")

div.innerHTML=""

let oggi=new Date()

fatture.forEach(f=>{

let data=new Date(f.scadenza)

let diff=(data-oggi)/(1000*60*60*24)

if(diff<10 && !f.pagata){

let p=document.createElement("p")

p.textContent=f.fornitore+" scade "+f.scadenza

div.appendChild(p)

}

})

}

function addAutolettura(){

let contatore=document.getElementById("contatore").value

let data=document.getElementById("dataAutolettura").value

autoletture.push({contatore,data})

saveData()

renderAutoletture()

renderAutolettureProssime()

}

function renderAutoletture(){

let ul=document.getElementById("listaAutoletture")

ul.innerHTML=""

autoletture.forEach(a=>{

let li=document.createElement("li")

li.textContent=a.contatore+" - "+a.data

ul.appendChild(li)

})

}

function renderAutolettureProssime(){

let div=document.getElementById("autolettureProssime")

div.innerHTML=""

let oggi=new Date()

autoletture.forEach(a=>{

let data=new Date(a.data)

let diff=(data-oggi)/(1000*60*60*24)

if(diff<7){

let p=document.createElement("p")

p.textContent="Autolettura "+a.contatore+" il "+a.data

div.appendChild(p)

}

})

}

async function leggiPDF(){

let file=document.getElementById("pdf").files[0]

if(!file){

alert("Carica prima un PDF")

return

}

let reader=new FileReader()

reader.onload=async function(){

let typedarray=new Uint8Array(this.result)

let pdf=await pdfjsLib.getDocument(typedarray).promise

let text=""

for(let i=1;i<=pdf.numPages;i++){

let page=await pdf.getPage(i)

let content=await page.getTextContent()

content.items.forEach(item=>{

text+=item.str+" "

})

}

analizzaTesto(text)

}

reader.readAsArrayBuffer(file)

}

function analizzaTesto(testo){

let importoMatch=testo.match(/([0-9]+,[0-9]{2})\s?€/)

let scadenzaMatch=testo.match(/scadenza\s?([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i)

if(importoMatch){

document.getElementById("importo").value=importoMatch[1]

}

if(scadenzaMatch){

let data=scadenzaMatch[1].split("/").reverse().join("-")

document.getElementById("scadenza").value=data

}

alert("Dati trovati nel PDF")

}

renderUtenze()

renderFatture()

renderScadenze()

renderAutoletture()

renderAutolettureProssime()
