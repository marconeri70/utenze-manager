let utenze = JSON.parse(localStorage.getItem("utenze")) || [];
let fatture = JSON.parse(localStorage.getItem("fatture")) || [];

function saveData() {
  localStorage.setItem("utenze", JSON.stringify(utenze));
  localStorage.setItem("fatture", JSON.stringify(fatture));
}

function showSection(id) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.add("hidden");
  });
  document.getElementById(id).classList.remove("hidden");
}

function addUtenza() {
  const nome = document.getElementById("nomeUtenza").value.trim();
  const tipo = document.getElementById("tipoUtenza").value.trim();

  if (!nome || !tipo) {
    alert("Compila nome fornitore e tipo utenza.");
    return;
  }

  utenze.push({
    id: Date.now(),
    nome,
    tipo,
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

function addFattura() {
  const fornitore = document.getElementById("fornitore").value.trim();
  const scadenza = document.getElementById("scadenza").value;
  const importo = document.getElementById("importo").value.trim();
  const numeroFattura = document.getElementById("numeroFattura").value.trim();
  const periodoFattura = document.getElementById("periodoFattura").value.trim();
  const pdfInput = document.getElementById("pdf");
  const pdfName = pdfInput.files[0] ? pdfInput.files[0].name : "";

  if (!fornitore || !scadenza || !importo) {
    alert("Compila almeno fornitore, scadenza e importo.");
    return;
  }

  fatture.push({
    id: Date.now(),
    fornitore,
    scadenza,
    importo,
    numeroFattura,
    periodoFattura,
    pdfName,
    pagata: false,
    archiviata: false,
    createdAt: new Date().toISOString(),
  });

  saveData();
  renderFatture();
  renderScadenze();
  renderStats();
  clearFatturaForm();

  alert("Fattura salvata correttamente.");
}

function clearFatturaForm() {
  document.getElementById("fornitore").value = "";
  document.getElementById("scadenza").value = "";
  document.getElementById("importo").value = "";
  document.getElementById("numeroFattura").value = "";
  document.getElementById("periodoFattura").value = "";
  document.getElementById("pdf").value = "";
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

    const li = document.createElement("li");
    li.innerHTML = `
      <div class="bill-header">
        <div>
          <strong>${escapeHtml(f.fornitore)}</strong>
          <div class="small-text">Scadenza: ${formatDate(f.scadenza)}</div>
        </div>
        <span class="badge ${badgeClass}">${stato}</span>
      </div>

      <div class="small-text">Importo: € ${escapeHtml(f.importo)}</div>
      <div class="small-text">Numero fattura: ${escapeHtml(f.numeroFattura || "-")}</div>
      <div class="small-text">Periodo: ${escapeHtml(f.periodoFattura || "-")}</div>
      <div class="small-text">PDF: ${escapeHtml(f.pdfName || "Non allegato")}</div>
      <div class="small-text">Archiviata: ${f.archiviata ? "Sì" : "No"}</div>

      <div class="actions">
        ${
          !f.pagata
            ? `<button class="small-btn pay-btn" onclick="segnaPagata(${originalIndex})">Segna pagata</button>`
            : ""
        }
        <button class="small-btn archive-btn" onclick="toggleArchivio(${originalIndex})">
          ${f.archiviata ? "Togli da archivio" : "Archivia"}
        </button>
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
}

function deleteFattura(index) {
  const conferma = confirm("Vuoi eliminare questa fattura?");
  if (!conferma) return;

  fatture.splice(index, 1);
  saveData();
  renderFatture();
  renderScadenze();
  renderStats();
}

function renderScadenze() {
  const div = document.getElementById("scadenze");
  div.innerHTML = "";

  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);

  const prossime = fatture
    .filter((f) => !f.pagata)
    .map((f) => {
      const dataScadenza = new Date(f.scadenza);
      dataScadenza.setHours(0, 0, 0, 0);

      const diffGiorni = Math.ceil(
        (dataScadenza.getTime() - oggi.getTime()) / (1000 * 60 * 60 * 24)
      );

      return { ...f, diffGiorni };
    })
    .filter((f) => f.diffGiorni <= 10)
    .sort((a, b) => a.diffGiorni - b.diffGiorni);

  if (prossime.length === 0) {
    div.innerHTML = `<div class="empty-state">Nessuna scadenza imminente nei prossimi 10 giorni.</div>`;
    return;
  }

  prossime.forEach((f) => {
    const item = document.createElement("div");
    item.className = "alert-item";

    let testoGiorni = "";
    if (f.diffGiorni < 0) {
      testoGiorni = `Scaduta da ${Math.abs(f.diffGiorni)} giorni`;
    } else if (f.diffGiorni === 0) {
      testoGiorni = "Scade oggi";
    } else {
      testoGiorni = `Scade tra ${f.diffGiorni} giorni`;
    }

    item.innerHTML = `
      <strong>${escapeHtml(f.fornitore)}</strong><br>
      Importo: € ${escapeHtml(f.importo)}<br>
      Data: ${formatDate(f.scadenza)}<br>
      <strong>${testoGiorni}</strong>
    `;
    div.appendChild(item);
  });
}

function renderStats() {
  const totFatture = fatture.length;
  const totDaPagare = fatture.filter((f) => !f.pagata).length;
  const totPagate = fatture.filter((f) => f.pagata).length;

  document.getElementById("totFatture").textContent = totFatture;
  document.getElementById("totDaPagare").textContent = totDaPagare;
  document.getElementById("totPagate").textContent = totPagate;
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
      const pageText = content.items.map((item) => item.str).join(" ");
      testoCompleto += " " + pageText;
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
    /€\s*([0-9]+[.,][0-9]{2})/i
  ];

  const scadenzaPatterns = [
    /scadenza\s*[:\-]?\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i,
    /scadenza\s*[:\-]?\s*([0-9]{2}\-[0-9]{2}\-[0-9]{4})/i,
    /data\s+scadenza\s*[:\-]?\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
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

  const fornitorePatterns = [
    /enel/i,
    /eni/i,
    /acea/i,
    /fastweb/i,
    /tim/i,
    /vodafone/i,
    /italgas/i,
    /hera/i,
    /a2a/i
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

  for (const pattern of fornitorePatterns) {
    const match = testoPulito.match(pattern);
    if (match) {
      fornitore = match[0].toUpperCase();
      break;
    }
  }

  if (importo) {
    importo = importo.replace(",", ".");
    document.getElementById("importo").value = importo;
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

  const campoFornitore = document.getElementById("fornitore");
  if (fornitore && !campoFornitore.value.trim()) {
    campoFornitore.value = fornitore;
  }

  alert("Analisi PDF completata. Controlla i dati trovati prima di salvare.");
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

function convertiDataPerInput(dataStr) {
  if (dataStr.includes("/")) {
    const parts = dataStr.split("/");
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  if (dataStr.includes("-")) {
    const parts = dataStr.split("-");
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  return "";
}

function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString("it-IT");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

renderUtenze();
renderFatture();
renderScadenze();
renderStats();
showSection("dashboard");
