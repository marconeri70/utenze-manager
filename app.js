let utenze = JSON.parse(localStorage.getItem("utenze")) || [];
let fatture = JSON.parse(localStorage.getItem("fatture")) || [];
let autoletture = JSON.parse(localStorage.getItem("autoletture")) || [];

const DB_NAME = "utenzeManagerDB";
const DB_VERSION = 1;
const PDF_STORE = "pdfFiles";
let db = null;

async function initApp() {
  await initDB();
  renderUtenze();
  renderFatture();
  renderScadenze();
  renderAutoletture();
  renderAutolettureProssime();
  renderStats();
  showSection("dashboard");
}

function saveData() {
  localStorage.setItem("utenze", JSON.stringify(utenze));
  localStorage.setItem("fatture", JSON.stringify(fatture));
  localStorage.setItem("autoletture", JSON.stringify(autoletture));
}

function showSection(id) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.add("hidden");
  });
  document.getElementById(id).classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("it-IT");
}

function daysDiffFromToday(dateString) {
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);

  const data = new Date(dateString);
  data.setHours(0, 0, 0, 0);

  return Math.ceil((data.getTime() - oggi.getTime()) / (1000 * 60 * 60 * 24));
}

function convertiDataPerInput(dataStr) {
  if (!dataStr) return "";

  if (dataStr.includes("/")) {
    const parts = dataStr.split("/");
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  if (dataStr.includes("-")) {
    const parts = dataStr.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) return dataStr;
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  return "";
}

function trovaMatch(testo, patterns, groupIndex = 1) {
  for (const pattern of patterns) {
    const match = testo.match(pattern);
    if (match && match[groupIndex]) {
      return match[groupIndex].trim();
    }
  }
  return "";
}

function riconosciTipoDaFornitore(nome) {
  const valore = (nome || "").toLowerCase();

  if (
    valore.includes("enel") ||
    valore.includes("servizio elettrico") ||
    valore.includes("a2a energia") ||
    valore.includes("sorgenia") ||
    valore.includes("edison energia")
  ) {
    return "Luce";
  }

  if (
    valore.includes("eni") ||
    valore.includes("plenitude") ||
    valore.includes("italgas") ||
    valore.includes("gas")
  ) {
    return "Gas";
  }

  if (
    valore.includes("acea") ||
    valore.includes("acqua") ||
    valore.includes("idrico")
  ) {
    return "Acqua";
  }

  if (
    valore.includes("tim") ||
    valore.includes("vodafone") ||
    valore.includes("fastweb") ||
    valore.includes("wind") ||
    valore.includes("iliad")
  ) {
    return "Telefono";
  }

  return "";
}

function clearFatturaForm() {
  document.getElementById("fornitore").value = "";
  document.getElementById("tipoFattura").value = "";
  document.getElementById("scadenza").value = "";
  document.getElementById("importo").value = "";
  document.getElementById("numeroFattura").value = "";
  document.getElementById("periodoFattura").value = "";
  document.getElementById("pdf").value = "";
}

function clearAutoletturaForm() {
  document.getElementById("contatore").value = "";
  document.getElementById("tipoContatore").value = "";
  document.getElementById("dataAutolettura").value = "";
  document.getElementById("notaAutolettura").value = "";
}

function addUtenza() {
  const nome = document.getElementById("nomeUtenza").value.trim();
  const tipo = document.getElementById("tipoUtenza").value;

  if (!nome || !tipo) {
    alert("Compila nome fornitore e tipo utenza.");
    return;
  }

  utenze.push({
    id: Date.now(),
    nome,
    tipo
  });

  saveData();
  renderUtenze();

  document.getElementById("nomeUtenza").value = "";
  document.getElementById("tipoUtenza").value = "";
}

function renderUtenze() {
  const ul = document.getElementById("listaUtenze");
  ul.innerHTML = "";

  if (utenze.length === 0) {
    ul.innerHTML = "<li>Nessuna utenza inserita.</li>";
    return;
  }

  utenze.forEach((u) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="bill-header">
        <div>
          <strong>${escapeHtml(u.nome)}</strong>
          <div class="small-text">Tipo: ${escapeHtml(u.tipo)}</div>
        </div>
      </div>
    `;
    ul.appendChild(li);
  });
}

async function addFattura() {
  const fornitore = document.getElementById("fornitore").value.trim();
  const tipoFattura = document.getElementById("tipoFattura").value;
  const scadenza = document.getElementById("scadenza").value;
  const importo = document.getElementById("importo").value.trim();
  const numeroFattura = document.getElementById("numeroFattura").value.trim();
  const periodoFattura = document.getElementById("periodoFattura").value.trim();
  const pdfInput = document.getElementById("pdf");
  const file = pdfInput.files[0];

  if (!fornitore || !scadenza || !importo) {
    alert("Compila almeno fornitore, scadenza e importo.");
    return;
  }

  const id = Date.now();
  let pdfMeta = null;

  if (file) {
    await savePdfToDB(id, file);
    pdfMeta = {
      name: file.name,
      type: file.type || "application/pdf",
      size: file.size || 0
    };
  }

  fatture.push({
    id,
    fornitore,
    tipoFattura: tipoFattura || riconosciTipoDaFornitore(fornitore) || "",
    scadenza,
    importo,
    numeroFattura,
    periodoFattura,
    pdfMeta,
    pagata: false,
    archiviata: false,
    createdAt: new Date().toISOString()
  });

  saveData();
  renderFatture();
  renderScadenze();
  renderStats();
  clearFatturaForm();

  alert("Fattura salvata correttamente.");
}

function renderFatture() {
  const ul = document.getElementById("listaFatture");
  ul.innerHTML = "";

  if (fatture.length === 0) {
    ul.innerHTML = "<li>Nessuna fattura salvata.</li>";
    return;
  }

  const fattureOrdinate = [...fatture].sort((a, b) => {
    return new Date(a.scadenza) - new Date(b.scadenza);
  });

  fattureOrdinate.forEach((f) => {
    const originalIndex = fatture.findIndex((item) => item.id === f.id);
    const stato = f.pagata ? "Pagata" : "Da pagare";
    const badgeClass = f.pagata ? "paid" : "pending";
    const badgeArchivio = f.archiviata
      ? `<span class="badge archived">Archiviata</span>`
      : "";

    const li = document.createElement("li");
    li.innerHTML = `
      <div class="bill-header">
        <div>
          <strong>${escapeHtml(f.fornitore)}</strong>
          <div class="small-text">Tipo: ${escapeHtml(f.tipoFattura || "-")}</div>
          <div class="small-text">Scadenza: ${formatDate(f.scadenza)}</div>
        </div>
        <div>
          <span class="badge ${badgeClass}">${stato}</span>
          ${badgeArchivio}
        </div>
      </div>

      <div class="small-text">Importo: € ${escapeHtml(f.importo)}</div>
      <div class="small-text">Numero fattura: ${escapeHtml(f.numeroFattura || "-")}</div>
      <div class="small-text">Periodo: ${escapeHtml(f.periodoFattura || "-")}</div>
      <div class="small-text">PDF: ${escapeHtml(f.pdfMeta?.name || "Non allegato")}</div>

      <div class="actions">
        ${
          !f.pagata
            ? `<button class="small-btn pay-btn" onclick="segnaPagata(${originalIndex})">Segna pagata</button>`
            : ""
        }
        <button class="small-btn archive-btn" onclick="toggleArchivio(${originalIndex})">
          ${f.archiviata ? "Togli da archivio" : "Archivia"}
        </button>
        ${
          f.pdfMeta
            ? `<button class="small-btn open-btn" onclick="apriPDF(${f.id})">Apri PDF</button>`
            : ""
        }
        <button class="small-btn delete-btn" onclick="deleteFattura(${originalIndex})">Elimina</button>
      </div>
    `;
    ul.appendChild(li);
  });
}

function segnaPagata(index) {
  fatture[index].pagata = true;
  saveData();
  renderFatture();
  renderScadenze();
  renderStats();
}

function toggleArchivio(index) {
  fatture[index].archiviata = !fatture[index].archiviata;
  saveData();
  renderFatture();
  renderStats();
}

async function deleteFattura(index) {
  const conferma = confirm("Vuoi eliminare questa fattura?");
  if (!conferma) return;

  const item = fatture[index];
  if (item?.id) {
    await deletePdfFromDB(item.id);
  }

  fatture.splice(index, 1);
  saveData();
  renderFatture();
  renderScadenze();
  renderStats();
}

function renderScadenze() {
  const div = document.getElementById("scadenze");
  div.innerHTML = "";

  const prossime = fatture
    .filter((f) => !f.pagata)
    .map((f) => ({ ...f, diffGiorni: daysDiffFromToday(f.scadenza) }))
    .filter((f) => f.diffGiorni <= 10)
    .sort((a, b) => a.diffGiorni - b.diffGiorni);

  if (prossime.length === 0) {
    div.innerHTML = `<div class="empty-state">Nessuna scadenza imminente nei prossimi 10 giorni.</div>`;
    return;
  }

  prossime.forEach((f) => {
    let testoGiorni = "";
    if (f.diffGiorni < 0) {
      testoGiorni = `Scaduta da ${Math.abs(f.diffGiorni)} giorni`;
    } else if (f.diffGiorni === 0) {
      testoGiorni = "Scade oggi";
    } else {
      testoGiorni = `Scade tra ${f.diffGiorni} giorni`;
    }

    const item = document.createElement("div");
    item.className = "alert-item";
    item.innerHTML = `
      <strong>${escapeHtml(f.fornitore)}</strong><br>
      Tipo: ${escapeHtml(f.tipoFattura || "-")}<br>
      Importo: € ${escapeHtml(f.importo)}<br>
      Data: ${formatDate(f.scadenza)}<br>
      <strong>${testoGiorni}</strong>
    `;
    div.appendChild(item);
  });
}

function addAutolettura() {
  const contatore = document.getElementById("contatore").value.trim();
  const tipo = document.getElementById("tipoContatore").value;
  const data = document.getElementById("dataAutolettura").value;
  const nota = document.getElementById("notaAutolettura").value.trim();

  if (!contatore || !tipo || !data) {
    alert("Compila contatore, tipo e data autolettura.");
    return;
  }

  autoletture.push({
    id: Date.now(),
    contatore,
    tipo,
    data,
    nota
  });

  saveData();
  renderAutoletture();
  renderAutolettureProssime();
  clearAutoletturaForm();
}

function renderAutoletture() {
  const ul = document.getElementById("listaAutoletture");
  ul.innerHTML = "";

  if (autoletture.length === 0) {
    ul.innerHTML = "<li>Nessuna autolettura salvata.</li>";
    return;
  }

  const lista = [...autoletture].sort((a, b) => new Date(a.data) - new Date(b.data));

  lista.forEach((a) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="bill-header">
        <div>
          <strong>${escapeHtml(a.contatore)}</strong>
          <div class="small-text">Tipo: ${escapeHtml(a.tipo)}</div>
          <div class="small-text">Data: ${formatDate(a.data)}</div>
          <div class="small-text">Nota: ${escapeHtml(a.nota || "-")}</div>
        </div>
      </div>
    `;
    ul.appendChild(li);
  });
}

function renderAutolettureProssime() {
  const div = document.getElementById("autolettureProssime");
  div.innerHTML = "";

  const lista = autoletture
    .map((a) => ({ ...a, diffGiorni: daysDiffFromToday(a.data) }))
    .filter((a) => a.diffGiorni <= 7)
    .sort((a, b) => a.diffGiorni - b.diffGiorni);

  if (lista.length === 0) {
    div.innerHTML = `<div class="empty-state">Nessuna autolettura imminente nei prossimi 7 giorni.</div>`;
    return;
  }

  lista.forEach((a) => {
    let testo = "";
    if (a.diffGiorni < 0) {
      testo = `In ritardo di ${Math.abs(a.diffGiorni)} giorni`;
    } else if (a.diffGiorni === 0) {
      testo = "Da fare oggi";
    } else {
      testo = `Da fare tra ${a.diffGiorni} giorni`;
    }

    const item = document.createElement("div");
    item.className = "info-item";
    item.innerHTML = `
      <strong>${escapeHtml(a.contatore)}</strong><br>
      Tipo: ${escapeHtml(a.tipo)}<br>
      Data: ${formatDate(a.data)}<br>
      <strong>${testo}</strong>
    `;
    div.appendChild(item);
  });
}

function renderStats() {
  document.getElementById("totFatture").textContent = fatture.length;
  document.getElementById("totDaPagare").textContent = fatture.filter((f) => !f.pagata).length;
  document.getElementById("totPagate").textContent = fatture.filter((f) => f.pagata).length;
  document.getElementById("totArchiviate").textContent = fatture.filter((f) => f.archiviata).length;
}

async function leggiPDF() {
  const file = document.getElementById("pdf").files[0];

  if (!file) {
    alert("Carica prima un PDF.");
    return;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument(typedArray).promise;

    let testoCompleto = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      testoCompleto += " " + content.items.map((item) => item.str).join(" ");
    }

    analizzaTestoPDF(testoCompleto);
  } catch (error) {
    console.error("Errore lettura PDF:", error);
    alert("Non sono riuscito a leggere questo PDF. Prova con un PDF testuale.");
  }
}

function analizzaTestoPDF(testo) {
  const testoPulito = testo.replace(/\s+/g, " ").trim();
  console.log("Testo PDF:", testoPulito);

  const importoPatterns = [
    /totale\s+da\s+pagare\s*[:\-]?\s*€?\s*([0-9]+[.,][0-9]{2})/i,
    /importo\s+totale\s*[:\-]?\s*€?\s*([0-9]+[.,][0-9]{2})/i,
    /da\s+pagare\s*[:\-]?\s*€?\s*([0-9]+[.,][0-9]{2})/i,
    /totale\s*[:\-]?\s*€?\s*([0-9]+[.,][0-9]{2})/i,
    /€\s*([0-9]+[.,][0-9]{2})/i
  ];

  const scadenzaPatterns = [
    /data\s+di\s+scadenza\s*[:\-]?\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i,
    /scadenza\s*[:\-]?\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i,
    /scadenza\s*[:\-]?\s*([0-9]{2}\-[0-9]{2}\-[0-9]{4})/i
  ];

  const numeroPatterns = [
    /numero\s+fattura\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /fattura\s*n\.?\s*([A-Z0-9\-\/]+)/i,
    /n\.?\s+fattura\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ];

  const periodoPatterns = [
    /periodo\s*[:\-]?\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4}\s*-\s*[0-9]{2}\/[0-9]{2}\/[0-9]{4})/i,
    /dal\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s*al\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
  ];

  const fornitori = [
    "Enel",
    "Eni",
    "Plenitude",
    "Acea",
    "Fastweb",
    "Tim",
    "Vodafone",
    "Iliad",
    "Italgas",
    "A2A",
    "Sorgenia",
    "Edison",
    "Hera"
  ];

  let importo = trovaMatch(testoPulito, importoPatterns, 1);
  let scadenza = trovaMatch(testoPulito, scadenzaPatterns, 1);
  let numeroFattura = trovaMatch(testoPulito, numeroPatterns, 1);
  let periodo = "";
  let fornitore = "";

  for (const pattern of periodoPatterns) {
    const match = testoPulito.match(pattern);
    if (match) {
      if (match.length >= 3 && pattern.toString().includes("dal")) {
        periodo = `${match[1]} - ${match[2]}`;
      } else {
        periodo = match[1];
      }
      break;
    }
  }

  for (const nome of fornitori) {
    const regex = new RegExp(nome, "i");
    if (regex.test(testoPulito)) {
      fornitore = nome;
      break;
    }
  }

  if (importo) {
    document.getElementById("importo").value = importo.replace(",", ".");
  }

  if (scadenza) {
    document.getElementById("scadenza").value = convertiDataPerInput(scadenza);
  }

  if (numeroFattura) {
    document.getElementById("numeroFattura").value = numeroFattura;
  }

  if (periodo) {
    document.getElementById("periodoFattura").value = periodo;
  }

  if (fornitore && !document.getElementById("fornitore").value.trim()) {
    document.getElementById("fornitore").value = fornitore;
  }

  const nomeFornitore = document.getElementById("fornitore").value.trim() || fornitore;
  const tipoRiconosciuto = riconosciTipoDaFornitore(nomeFornitore);
  if (tipoRiconosciuto && !document.getElementById("tipoFattura").value) {
    document.getElementById("tipoFattura").value = tipoRiconosciuto;
  }

  alert("Analisi PDF completata. Controlla i dati trovati prima di salvare.");
}

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(PDF_STORE)) {
        database.createObjectStore(PDF_STORE, { keyPath: "id" });
      }
    };
  });
}

function savePdfToDB(id, file) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database non inizializzato"));
      return;
    }

    const transaction = db.transaction([PDF_STORE], "readwrite");
    const store = transaction.objectStore(PDF_STORE);

    const request = store.put({
      id,
      file
    });

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

function getPdfFromDB(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database non inizializzato"));
      return;
    }

    const transaction = db.transaction([PDF_STORE], "readonly");
    const store = transaction.objectStore(PDF_STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result?.file || null);
    request.onerror = () => reject(request.error);
  });
}

function deletePdfFromDB(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database non inizializzato"));
      return;
    }

    const transaction = db.transaction([PDF_STORE], "readwrite");
    const store = transaction.objectStore(PDF_STORE);
    const request = store.delete(id);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function apriPDF(id) {
  try {
    const file = await getPdfFromDB(id);
    if (!file) {
      alert("PDF non trovato nell'archivio locale del browser.");
      return;
    }

    const url = URL.createObjectURL(file);
    window.open(url, "_blank");

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000);
  } catch (error) {
    console.error(error);
    alert("Errore nell'apertura del PDF.");
  }
}

initApp();
