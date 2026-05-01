let utenze = JSON.parse(localStorage.getItem("utenze")) || [];
let fatture = JSON.parse(localStorage.getItem("fatture")) || [];
let autoletture = JSON.parse(localStorage.getItem("autoletture")) || [];

const DB_NAME = "utenzeManagerDB";
const DB_VERSION = 1;
const PDF_STORE = "pdfFiles";
let db = null;
let monthlyChart = null;
let utilityTypeChart = null;
let selectedFattureIds = new Set(); 

// --- GESTIONE CLOUD SYNC ---
const SyncManager = {
  config: JSON.parse(localStorage.getItem("syncConfig")) || { url: "", secret: "" },
  
  saveConfig(url, secret) {
    this.config = { url: url.replace(/\/$/, ""), secret };
    localStorage.setItem("syncConfig", JSON.stringify(this.config));
    this.pullData();
  },

  updateStatus(status) {
    const icon = document.getElementById("syncStatusIcon");
    if (!icon) return;
    icon.className = `sync-status ${status}`;
  },

  async pushData() {
    if (!this.config.url || !this.config.secret) return;
    this.updateStatus('syncing');
    try {
      const payload = { utenze, fatture, autoletture, timestamp: Date.now() };
      const res = await fetch(`${this.config.url}/sync/data`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${this.config.secret}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Sync upload failed");
      this.updateStatus('idle');
    } catch (e) {
      console.error(e);
      this.updateStatus('error');
    }
  },

  async pullData() {
    if (!this.config.url || !this.config.secret) return;
    this.updateStatus('syncing');
    try {
      const res = await fetch(`${this.config.url}/sync/data`, {
        headers: { 'Authorization': `Bearer ${this.config.secret}` }
      });
      if (!res.ok) throw new Error("Sync download failed");
      
      const data = await res.json();
      if (data && data.timestamp) {
        utenze = data.utenze || [];
        fatture = data.fatture || [];
        autoletture = data.autoletture || [];
        saveData(false); // Salva in locale senza innescare un loop di caricamento
        refreshAll();
      }
      this.updateStatus('idle');
    } catch (e) {
      console.error(e);
      this.updateStatus('error');
    }
  },

  async pushPdf(id, file) {
    if (!this.config.url || !this.config.secret) return;
    this.updateStatus('syncing');
    try {
      await fetch(`${this.config.url}/sync/pdf/${id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${this.config.secret}` },
        body: file
      });
      this.updateStatus('idle');
    } catch(e) { 
      this.updateStatus('error'); 
    }
  },

  async getPdf(id) {
    if (!this.config.url || !this.config.secret) return null;
    try {
      const res = await fetch(`${this.config.url}/sync/pdf/${id}`, {
        headers: { 'Authorization': `Bearer ${this.config.secret}` }
      });
      if (!res.ok) return null;
      return await res.blob();
    } catch(e) { return null; }
  },

  async deletePdf(id) {
    if (!this.config.url || !this.config.secret) return;
    try {
      await fetch(`${this.config.url}/sync/pdf/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.config.secret}` }
      });
    } catch(e) {}
  }
};

function saveSyncConfig() {
  const url = document.getElementById("syncUrl").value.trim();
  const secret = document.getElementById("syncSecret").value.trim();
  if (!url || !secret) {
    alert("Compila URL del Worker e Token di sicurezza.");
    return;
  }
  SyncManager.saveConfig(url, secret);
  alert("Configurazione Cloud salvata e download avviato.");
}
// --- FINE GESTIONE CLOUD SYNC ---

async function initApp() {
  await initDB();
  normalizeStoredData();
  
  // Popola l'interfaccia con i dati del Cloud se presenti
  if (SyncManager.config.url) {
    document.getElementById("syncUrl").value = SyncManager.config.url;
    document.getElementById("syncSecret").value = SyncManager.config.url ? "********" : "";
    await SyncManager.pullData();
  }

  autoCreateUtilitiesFromInvoices();
  populateFilterOptions();
  renderUtenze();
  renderFatture();
  renderScadenze();
  renderRateProssime();
  renderAutoletture();
  renderAutolettureProssime();
  renderNotifiche();
  renderStats();
  renderMonthlyChart();
  renderUtilityTypeChart();
  showSection("dashboard");
  controllaENotificaScadenze(false);
}

function normalizeStoredData() {
  fatture = fatture.map((f) => {
    const text = `${f.fornitore || ""} ${f.numeroFattura || ""} ${f.periodoFattura || ""}`;
    const inferredType =
      f.tipoFattura ||
      detectUtilityType(text) ||
      riconosciTipoDaFornitore(f.fornitore || "") ||
      "Altro";

    return {
      rate: [],
      rateizzata: false,
      archiviata: false,
      pagata: false,
      ...f,
      tipoFattura: inferredType,
      rate: Array.isArray(f.rate) ? f.rate : [],
      rateizzata: !!f.rateizzata,
      archiviata: !!f.archiviata,
      pagata: !!f.pagata
    };
  });

  saveData(false);
}

function saveData(triggerCloudSync = true) {
  localStorage.setItem("utenze", JSON.stringify(utenze));
  localStorage.setItem("fatture", JSON.stringify(fatture));
  localStorage.setItem("autoletture", JSON.stringify(autoletture));
  
  if (triggerCloudSync) {
    SyncManager.pushData();
  }
}

function refreshAll() {
  autoCreateUtilitiesFromInvoices();
  populateFilterOptions();
  renderUtenze();
  renderFatture();
  renderScadenze();
  renderRateProssime();
  renderAutoletture();
  renderAutolettureProssime();
  renderNotifiche();
  renderStats();
  renderMonthlyChart();
  renderUtilityTypeChart();
}

function showSection(id) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.add("hidden");
  });
  document.getElementById(id).classList.remove("hidden");
  clearSelection(); 
}

function openArchiveFromDashboard(mode) {
  resetFilters(false);

  const filterStatus = document.getElementById("filterStatus");
  if (mode === "pagata") filterStatus.value = "pagata";
  if (mode === "dapagare") filterStatus.value = "dapagare";
  if (mode === "archiviata") filterStatus.value = "archiviata";
  if (mode === "rateizzata") filterStatus.value = "rateizzata";
  if (mode === "rateizzatadaPagare") filterStatus.value = "rateizzatadaPagare";

  showSection("archivio");
  renderFatture();
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
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
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

function parseMoney(value) {
  if (typeof value !== "string") value = String(value ?? "");
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(num) {
  return Number(num).toFixed(2);
}

function trovaMatch(testo, patterns, groupIndex = 1) {
  for (const pattern of patterns) {
    const match = testo.match(pattern);
    if (match && match[groupIndex]) return match[groupIndex].trim();
  }
  return "";
}

function getProviderIcon(name) {
  const n = (name || "").toLowerCase();

  if (n.includes("enel")) return "⚡";
  if (n.includes("plenitude") || n.includes("eni")) return "🔥";
  if (n.includes("acea") || n.includes("acqua") || n.includes("acquedotto")) return "💧";
  if (n.includes("fastweb")) return "🌐";
  if (n.includes("tim") || n.includes("telecom")) return "📞";
  if (n.includes("vodafone")) return "📶";
  if (n.includes("iliad")) return "📱";
  if (n.includes("wind")) return "📡";
  if (n.includes("italgas")) return "🔥";
  if (n.includes("a2a")) return "⚡";
  if (n.includes("sorgenia")) return "⚡";
  if (n.includes("edison")) return "💡";
  if (n.includes("hera")) return "🏠";
  if (n.includes("sky")) return "📺";
  if (n.includes("rifiuti") || n.includes("ambiente")) return "♻️";

  return "🏢";
}

function detectProvider(text, fileName = "") {
  const source = `${text} ${fileName}`.toLowerCase();

  const providerMap = [
    { name: "Enel", patterns: ["enel", "enel energia", "enel mercato libero", "servizio elettrico nazionale"] },
    { name: "Plenitude", patterns: ["eni plenitude", "plenitude", "eni gas e luce", "eni"] },
    { name: "Acea", patterns: ["acea", "acea energia", "acea ato", "acea ambiente"] },
    { name: "Fastweb", patterns: ["fastweb"] },
    { name: "TIM", patterns: ["tim", "telecom italia"] },
    { name: "Vodafone", patterns: ["vodafone"] },
    { name: "Iliad", patterns: ["iliad"] },
    { name: "WindTre", patterns: ["windtre", "wind tre", "wind"] },
    { name: "Italgas", patterns: ["italgas"] },
    { name: "A2A", patterns: ["a2a", "a2a energia"] },
    { name: "Sorgenia", patterns: ["sorgenia"] },
    { name: "Edison", patterns: ["edison", "edison energia"] },
    { name: "Hera", patterns: ["hera", "gruppo hera"] },
    { name: "Sky Wifi", patterns: ["sky wifi", "sky italia"] },
    { name: "E-distribuzione", patterns: ["e-distribuzione", "edistribuzione"] },
    { name: "Acquedotto", patterns: ["acquedotto", "servizio idrico", "idrico integrato"] },
    { name: "Rifiuti", patterns: ["tari", "rifiuti", "igiene urbana", "raccolta rifiuti", "ambiente"] }
  ];

  for (const provider of providerMap) {
    if (provider.patterns.some((p) => source.includes(p))) {
      return provider.name;
    }
  }

  return "";
}

function detectUtilityType(text) {
  const source = (text || "").toLowerCase();

  if (
    source.includes("pod") ||
    source.includes("energia elettrica") ||
    source.includes("fornitura elettrica") ||
    source.includes("kwh") ||
    source.includes("elettric") ||
    source.includes("luce") ||
    source.includes("contatore elettrico")
  ) {
    return "Luce";
  }

  if (
    source.includes("pdr") ||
    source.includes("smc") ||
    source.includes("standard metri cubi") ||
    source.includes("gas naturale") ||
    source.includes("metano") ||
    source.includes("gas")
  ) {
    return "Gas";
  }

  if (
    source.includes("mc acqua") ||
    source.includes("servizio idrico") ||
    source.includes("idrico") ||
    source.includes("acqua") ||
    source.includes("acquedotto")
  ) {
    return "Acqua";
  }

  if (
    source.includes("fibra") ||
    source.includes("internet") ||
    source.includes("adsl") ||
    source.includes("fttc") ||
    source.includes("ftth") ||
    source.includes("banda larga")
  ) {
    return "Internet";
  }

  if (
    source.includes("telefono") ||
    source.includes("mobile") ||
    source.includes("sim") ||
    source.includes("voce") ||
    source.includes("telefonia")
  ) {
    return "Telefono";
  }

  if (
    source.includes("tari") ||
    source.includes("rifiuti") ||
    source.includes("igiene urbana")
  ) {
    return "Rifiuti";
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
    valore.includes("edison energia") ||
    valore.includes("e-distribuzione")
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
    valore.includes("idrico") ||
    valore.includes("acquedotto")
  ) {
    return "Acqua";
  }

  if (valore.includes("fastweb") || valore.includes("sky wifi")) {
    return "Internet";
  }

  if (
    valore.includes("tim") ||
    valore.includes("vodafone") ||
    valore.includes("wind") ||
    valore.includes("iliad") ||
    valore.includes("telecom")
  ) {
    return "Telefono";
  }

  if (
    valore.includes("rifiuti") ||
    valore.includes("ambiente") ||
    valore.includes("tari")
  ) {
    return "Rifiuti";
  }

  return "";
}

function utilityExists(nome, tipo) {
  return utenze.some(
    (u) =>
      (u.nome || "").trim().toLowerCase() === (nome || "").trim().toLowerCase() &&
      (u.tipo || "").trim().toLowerCase() === (tipo || "").trim().toLowerCase()
  );
}

function autoCreateUtilitiesFromInvoices() {
  let changed = false;

  fatture.forEach((f) => {
    const nome = (f.fornitore || "").trim();
    const tipo = (f.tipoFattura || riconosciTipoDaFornitore(nome) || "Altro").trim();

    if (nome && !utilityExists(nome, tipo)) {
      utenze.push({
        id: Date.now() + Math.floor(Math.random() * 100000),
        nome,
        tipo,
        origin: "fattura"
      });
      changed = true;
    }
  });

  if (changed) saveData();
}

function toggleRateFields() {
  const checked = document.getElementById("rateizzata").checked;
  const fields = document.getElementById("rateFields");
  fields.classList.toggle("hidden", !checked);
}

function clearFatturaForm() {
  document.getElementById("fornitore").value = "";
  document.getElementById("tipoFattura").value = "";
  document.getElementById("scadenza").value = "";
  document.getElementById("importo").value = "";
  document.getElementById("numeroFattura").value = "";
  document.getElementById("periodoFattura").value = "";
  document.getElementById("pdf").value = "";
  document.getElementById("rateizzata").checked = false;
  document.getElementById("numeroRate").value = "";
  document.getElementById("importoRata").value = "";
  document.getElementById("primaScadenzaRata").value = "";
  document.getElementById("frequenzaRate").value = "mensile";
  toggleRateFields();
}

function clearAutoletturaForm() {
  document.getElementById("contatore").value = "";
  document.getElementById("tipoContatore").value = "";
  document.getElementById("dataAutolettura").value = "";
  document.getElementById("notaAutolettura").value = "";
}

function addMonths(dateString, monthsToAdd) {
  const d = new Date(dateString);
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + monthsToAdd);

  if (d.getDate() < originalDay) d.setDate(0);

  return d.toISOString().split("T")[0];
}

function generaPianoRate(numeroRate, importoRata, primaScadenza, frequenza) {
  const rate = [];
  for (let i = 0; i < numeroRate; i++) {
    let dataRata = primaScadenza;
    if (frequenza === "mensile") dataRata = addMonths(primaScadenza, i);

    rate.push({
      numero: i + 1,
      importo: formatMoney(importoRata),
      scadenza: dataRata,
      pagata: false
    });
  }
  return rate;
}

function addUtenza() {
  const nome = document.getElementById("nomeUtenza").value.trim();
  const tipo = document.getElementById("tipoUtenza").value;

  if (!nome || !tipo) {
    alert("Compila nome fornitore e tipo utenza.");
    return;
  }

  if (utilityExists(nome, tipo)) {
    alert("Questa utenza esiste già.");
    return;
  }

  utenze.push({
    id: Date.now(),
    nome,
    tipo,
    origin: "manuale"
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

  const utenzeOrdinate = [...utenze].sort((a, b) =>
    `${a.nome} ${a.tipo}`.localeCompare(`${b.nome} ${b.tipo}`, "it")
  );

  utenzeOrdinate.forEach((u) => {
    const icon = getProviderIcon(u.nome);
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="bill-header">
        <div class="provider-inline">
          <span class="provider-icon">${icon}</span>
          <div>
            <strong>${escapeHtml(u.nome)}</strong>
            <div class="small-text">Tipo: ${escapeHtml(u.tipo)}</div>
            <div class="small-text">Origine: ${u.origin === "fattura" ? "Creata da fattura" : "Inserita manualmente"}</div>
          </div>
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

  const rateizzata = document.getElementById("rateizzata").checked;
  const numeroRate = parseInt(document.getElementById("numeroRate").value || "0", 10);
  let importoRata = document.getElementById("importoRata").value.trim();
  const primaScadenzaRata = document.getElementById("primaScadenzaRata").value;
  const frequenzaRate = document.getElementById("frequenzaRate").value;

  if (!fornitore || !scadenza || !importo) {
    alert("Compila almeno fornitore, scadenza e importo.");
    return;
  }

  if (rateizzata) {
    if (!numeroRate || numeroRate < 2 || !primaScadenzaRata) {
      alert("Per la rateizzazione devi compilare numero rate e prima scadenza.");
      return;
    }

    if (!importoRata) {
      const totale = parseMoney(importo);
      if (!totale) {
        alert("Importo totale non valido per calcolare automaticamente le rate.");
        return;
      }
      importoRata = formatMoney(totale / numeroRate);
    }
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

  const tipoFinale =
    tipoFattura ||
    detectUtilityType(`${fornitore} ${numeroFattura} ${periodoFattura}`) ||
    riconosciTipoDaFornitore(fornitore) ||
    "Altro";

  const rate = rateizzata
    ? generaPianoRate(numeroRate, parseMoney(importoRata), primaScadenzaRata, frequenzaRate)
    : [];

  fatture.push({
    id,
    fornitore,
    tipoFattura: tipoFinale,
    scadenza,
    importo,
    numeroFattura,
    periodoFattura,
    pdfMeta,
    pagata: false,
    archiviata: false,
    rateizzata,
    numeroRate: rateizzata ? numeroRate : 0,
    importoRata: rateizzata ? formatMoney(parseMoney(importoRata)) : "",
    primaScadenzaRata: rateizzata ? primaScadenzaRata : "",
    frequenzaRate: rateizzata ? frequenzaRate : "",
    rate,
    createdAt: new Date().toISOString()
  });

  saveData();
  refreshAll();
  clearFatturaForm();

  alert("Fattura salvata correttamente.");
}

function hasUnpaidInstallments(f) {
  return Array.isArray(f.rate) && f.rate.some((r) => !r.pagata);
}

function getFilteredFatture() {
  const search = (document.getElementById("searchText")?.value || "").trim().toLowerCase();
  const filterMonth = document.getElementById("filterMonth")?.value || "";
  const filterYear = document.getElementById("filterYear")?.value || "";
  const filterTipo = document.getElementById("filterTipo")?.value || "";
  const filterStatus = document.getElementById("filterStatus")?.value || "";

  return [...fatture]
    .filter((f) => {
      const date = new Date(f.scadenza);
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = String(date.getFullYear());

      const matchesSearch =
        !search ||
        (f.fornitore || "").toLowerCase().includes(search) ||
        (f.numeroFattura || "").toLowerCase().includes(search);

      const matchesMonth = !filterMonth || month === filterMonth;
      const matchesYear = !filterYear || year === filterYear;
      const matchesTipo = !filterTipo || (f.tipoFattura || "") === filterTipo;

      let matchesStatus = true;
      if (filterStatus === "pagata") matchesStatus = !!f.pagata;
      if (filterStatus === "dapagare") matchesStatus = !f.pagata;
      if (filterStatus === "archiviata") matchesStatus = !!f.archiviata;
      if (filterStatus === "rateizzata") matchesStatus = !!f.rateizzata;
      if (filterStatus === "rateizzatadaPagare") matchesStatus = !!f.rateizzata && hasUnpaidInstallments(f);

      return matchesSearch && matchesMonth && matchesYear && matchesTipo && matchesStatus;
    })
    .sort((a, b) => new Date(a.scadenza) - new Date(b.scadenza));
}

// BULK ACTIONS
function toggleSelectFattura(id) {
  if (selectedFattureIds.has(id)) {
    selectedFattureIds.delete(id);
  } else {
    selectedFattureIds.add(id);
  }
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById("bulkActionsBar");
  const countSpan = document.getElementById("selectedCount");
  if (!bar || !countSpan) return;
  
  if (selectedFattureIds.size > 0) {
    bar.classList.remove("hidden");
    countSpan.textContent = selectedFattureIds.size;
  } else {
    bar.classList.add("hidden");
  }
}

function clearSelection() {
  selectedFattureIds.clear();
  updateBulkBar();
  const inputs = document.querySelectorAll('.selection-control input');
  inputs.forEach(input => input.checked = false);
}

function bulkArchive(status = true) {
  if (selectedFattureIds.size === 0) return;

  fatture = fatture.map(f => {
    if (selectedFattureIds.has(f.id)) {
      return { ...f, archiviata: status };
    }
    return f;
  });

  saveData();
  selectedFattureIds.clear();
  refreshAll();
  updateBulkBar();
}

async function bulkDelete() {
  if (selectedFattureIds.size === 0) return;
  
  const conferma = confirm(`Sei sicuro di voler eliminare ${selectedFattureIds.size} fatture in modo permanente?`);
  if (!conferma) return;

  const idsToDelete = Array.from(selectedFattureIds);

  for (const id of idsToDelete) {
    const item = fatture.find(f => f.id === id);
    if (item?.id) await deletePdfFromDB(item.id);
  }

  fatture = fatture.filter(f => !selectedFattureIds.has(f.id));

  saveData();
  selectedFattureIds.clear();
  refreshAll();
  updateBulkBar();
}

function renderFatture() {
  const ul = document.getElementById("listaFatture");
  ul.innerHTML = "";

  const fattureOrdinate = getFilteredFatture();

  document.getElementById("filteredCount").textContent = fattureOrdinate.length;
  document.getElementById("filteredTotal").textContent = formatMoney(
    fattureOrdinate.reduce((sum, f) => sum + parseMoney(f.importo), 0)
  );

  if (fattureOrdinate.length === 0) {
    ul.innerHTML = "<li>Nessuna fattura trovata con i filtri selezionati.</li>";
    return;
  }

  fattureOrdinate.forEach((f) => {
    const originalIndex = fatture.findIndex((item) => item.id === f.id);
    const stato = f.pagata ? "Pagata" : "Da pagare";
    const badgeClass = f.pagata ? "paid" : "pending";
    const badgeArchivio = f.archiviata ? `<span class="badge archived">Archiviata</span>` : "";
    const badgeRate = f.rateizzata ? `<span class="badge installment">Rateizzata</span>` : "";
    const icon = getProviderIcon(f.fornitore);
    const isChecked = selectedFattureIds.has(f.id) ? "checked" : "";

    const rateHtml = f.rateizzata && Array.isArray(f.rate)
      ? `
        <div class="installments-box">
          <strong>Piano rate</strong>
          ${f.rate.map((r, idx) => `
            <div class="installment-row">
              <div>
                Rata ${r.numero} • € ${escapeHtml(r.importo)} • ${formatDate(r.scadenza)}
                <div class="small-text">${r.pagata ? "Pagata" : "Da pagare"}</div>
              </div>
              <div>
                ${!r.pagata ? `<button class="small-btn pay-btn" onclick="segnaRataPagata(${originalIndex}, ${idx})">Segna pagata</button>` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      `
      : "";

    const li = document.createElement("li");
    li.className = "fattura-item";
    li.innerHTML = `
      <div class="selection-control">
        <input type="checkbox" ${isChecked} onchange="toggleSelectFattura(${f.id})">
      </div>
      <div class="bill-content">
        <div class="bill-header">
          <div class="provider-inline">
            <span class="provider-icon">${icon}</span>
            <div>
              <strong>${escapeHtml(f.fornitore)}</strong>
              <div class="small-text">Tipo: ${escapeHtml(f.tipoFattura || "-")}</div>
              <div class="small-text">Scadenza: ${formatDate(f.scadenza)}</div>
            </div>
          </div>
          <div>
            <span class="badge ${badgeClass}">${stato}</span>
            ${badgeArchivio}
            ${badgeRate}
          </div>
        </div>

        <div class="small-text">Importo totale: € ${escapeHtml(f.importo)}</div>
        <div class="small-text">Numero fattura: ${escapeHtml(f.numeroFattura || "-")}</div>
        <div class="small-text">Periodo: ${escapeHtml(f.periodoFattura || "-")}</div>
        <div class="small-text">PDF: ${escapeHtml(f.pdfMeta?.name || "Non allegato")}</div>

        ${
          f.rateizzata
            ? `<div class="small-text">Rate: ${escapeHtml(f.numeroRate)} • Importo rata: € ${escapeHtml(f.importoRata)} • Prima scadenza rata: ${formatDate(f.primaScadenzaRata)}</div>`
            : ""
        }

        ${rateHtml}

        <div class="actions">
          ${
            !f.pagata
              ? `<button class="small-btn pay-btn" onclick="segnaPagata(${originalIndex})">Segna bolletta pagata</button>`
              : ""
          }
          <button class="small-btn archive-btn" onclick="toggleArchivio(${originalIndex})">
            ${f.archiviata ? "Togli da archivio" : "Archivia"}
          </button>
          ${f.pdfMeta ? `<button class="small-btn open-btn" onclick="apriPDF(${f.id})">Apri PDF</button>` : ""}
          <button class="small-btn delete-btn" onclick="deleteFattura(${originalIndex})">Elimina</button>
        </div>
      </div>
    `;
    ul.appendChild(li);
  });
}

function applyFilters() {
  clearSelection();
  renderFatture();
}

function resetFilters(renderNow = true) {
  document.getElementById("searchText").value = "";
  document.getElementById("filterMonth").value = "";
  document.getElementById("filterYear").value = "";
  document.getElementById("filterTipo").value = "";
  document.getElementById("filterStatus").value = "";
  clearSelection();
  if (renderNow) renderFatture();
}

function populateFilterOptions() {
  const monthSelect = document.getElementById("filterMonth");
  const yearSelect = document.getElementById("filterYear");
  if (!monthSelect || !yearSelect) return;

  const currentMonth = monthSelect.value;
  const currentYear = yearSelect.value;

  const months = new Set();
  const years = new Set();

  fatture.forEach((f) => {
    if (!f.scadenza) return;
    const d = new Date(f.scadenza);
    months.add(String(d.getMonth() + 1).padStart(2, "0"));
    years.add(String(d.getFullYear()));
  });

  monthSelect.innerHTML = `<option value="">Tutti i mesi</option>`;
  [...months].sort().forEach((m) => {
    monthSelect.innerHTML += `<option value="${m}">${m}</option>`;
  });

  yearSelect.innerHTML = `<option value="">Tutti gli anni</option>`;
  [...years].sort().forEach((y) => {
    yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
  });

  monthSelect.value = currentMonth;
  yearSelect.value = currentYear;
}

function renderMonthlyChart() {
  const canvas = document.getElementById("monthlyChart");
  if (!canvas || typeof Chart === "undefined") return;

  const map = {};
  fatture.forEach((f) => {
    if (!f.scadenza) return;
    const d = new Date(f.scadenza);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map[key] = (map[key] || 0) + parseMoney(f.importo);
  });

  const labels = Object.keys(map).sort();
  const values = labels.map((k) => Number(formatMoney(map[k])));

  if (monthlyChart) monthlyChart.destroy();

  monthlyChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Spese mensili (€)",
          data: values
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

function renderUtilityTypeChart() {
  const canvas = document.getElementById("utilityTypeChart");
  if (!canvas || typeof Chart === "undefined") return;

  const map = {
    Luce: 0,
    Gas: 0,
    Acqua: 0,
    Internet: 0,
    Telefono: 0,
    Rifiuti: 0,
    Altro: 0
  };

  fatture.forEach((f) => {
    const tipo = f.tipoFattura || "Altro";
    if (!Object.prototype.hasOwnProperty.call(map, tipo)) map[tipo] = 0;
    map[tipo] += parseMoney(f.importo);
  });

  const labels = Object.keys(map);
  const values = labels.map((k) => Number(formatMoney(map[k])));

  if (utilityTypeChart) utilityTypeChart.destroy();

  utilityTypeChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          label: "Spese per tipo",
          data: values
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" }
      }
    }
  });
}

function segnaPagata(index) {
  fatture[index].pagata = true;

  if (Array.isArray(fatture[index].rate)) {
    fatture[index].rate = fatture[index].rate.map((r) => ({ ...r, pagata: true }));
  }

  saveData();
  refreshAll();
}

function segnaRataPagata(fatturaIndex, rataIndex) {
  const fattura = fatture[fatturaIndex];
  if (!fattura || !Array.isArray(fattura.rate)) return;

  fattura.rate[rataIndex].pagata = true;
  if (fattura.rate.every((r) => r.pagata)) fattura.pagata = true;

  saveData();
  refreshAll();
}

function toggleArchivio(index) {
  fatture[index].archiviata = !fatture[index].archiviata;
  saveData();
  refreshAll();
}

async function deleteFattura(index) {
  const conferma = confirm("Vuoi eliminare questa fattura?");
  if (!conferma) return;

  const item = fatture[index];
  if (item?.id) await deletePdfFromDB(item.id);

  fatture.splice(index, 1);
  saveData();
  refreshAll();
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
    if (f.diffGiorni < 0) testoGiorni = `Scaduta da ${Math.abs(f.diffGiorni)} giorni`;
    else if (f.diffGiorni === 0) testoGiorni = "Scade oggi";
    else testoGiorni = `Scade tra ${f.diffGiorni} giorni`;

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

function getAllUnpaidInstallments() {
  const result = [];

  fatture.forEach((f, fatturaIndex) => {
    if (f.rateizzata && Array.isArray(f.rate)) {
      f.rate.forEach((r, rataIndex) => {
        if (!r.pagata) {
          result.push({
            fatturaId: f.id,
            fatturaIndex,
            rataIndex,
            fornitore: f.fornitore,
            tipoFattura: f.tipoFattura || "",
            numeroRata: r.numero,
            importo: r.importo,
            scadenza: r.scadenza,
            diffGiorni: daysDiffFromToday(r.scadenza)
          });
        }
      });
    }
  });

  return result;
}

function renderRateProssime() {
  const div = document.getElementById("rateProssime");
  div.innerHTML = "";

  const rate = getAllUnpaidInstallments()
    .filter((r) => r.diffGiorni <= 10)
    .sort((a, b) => a.diffGiorni - b.diffGiorni);

  if (rate.length === 0) {
    div.innerHTML = `<div class="empty-state">Nessuna rata imminente nei prossimi 10 giorni.</div>`;
    return;
  }

  rate.forEach((r) => {
    let testo = "";
    if (r.diffGiorni < 0) testo = `Scaduta da ${Math.abs(r.diffGiorni)} giorni`;
    else if (r.diffGiorni === 0) testo = "Scade oggi";
    else testo = `Scade tra ${r.diffGiorni} giorni`;

    const item = document.createElement("div");
    item.className = "info-item";
    item.innerHTML = `
      <strong>${escapeHtml(r.fornitore)}</strong><br>
      Rata ${r.numeroRata} • € ${escapeHtml(r.importo)}<br>
      Data: ${formatDate(r.scadenza)}<br>
      <strong>${testo}</strong>
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
  refreshAll();
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
    if (a.diffGiorni < 0) testo = `In ritardo di ${Math.abs(a.diffGiorni)} giorni`;
    else if (a.diffGiorni === 0) testo = "Da fare oggi";
    else testo = `Da fare tra ${a.diffGiorni} giorni`;

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

function renderNotifiche() {
  const box = document.getElementById("notificheBox");
  box.innerHTML = "";

  const notifiche = raccogliNotifiche();

  if (notifiche.length === 0) {
    box.innerHTML = `<div class="empty-state">Nessuna notifica al momento.</div>`;
    return;
  }

  notifiche.forEach((n) => {
    const div = document.createElement("div");
    div.className = n.tipo === "danger" ? "danger-item" : "info-item";
    div.textContent = n.testo;
    box.appendChild(div);
  });
}

function raccogliNotifiche() {
  const notifiche = [];

  fatture.forEach((f) => {
    if (!f.pagata) {
      const diff = daysDiffFromToday(f.scadenza);
      if (diff < 0) notifiche.push({ tipo: "danger", testo: `${f.fornitore}: bolletta scaduta da ${Math.abs(diff)} giorni` });
      else if (diff <= 3) notifiche.push({ tipo: "info", testo: `${f.fornitore}: bolletta in scadenza il ${formatDate(f.scadenza)}` });
    }
  });

  getAllUnpaidInstallments().forEach((r) => {
    if (r.diffGiorni < 0) notifiche.push({ tipo: "danger", testo: `${r.fornitore}: rata ${r.numeroRata} scaduta da ${Math.abs(r.diffGiorni)} giorni` });
    else if (r.diffGiorni <= 3) notifiche.push({ tipo: "info", testo: `${r.fornitore}: rata ${r.numeroRata} in scadenza il ${formatDate(r.scadenza)}` });
  });

  autoletture.forEach((a) => {
    const diff = daysDiffFromToday(a.data);
    if (diff < 0) notifiche.push({ tipo: "danger", testo: `${a.contatore}: autolettura in ritardo di ${Math.abs(diff)} giorni` });
    else if (diff <= 2) notifiche.push({ tipo: "info", testo: `${a.contatore}: autolettura da fare il ${formatDate(a.data)}` });
  });

  return notifiche;
}

function renderStats() {
  const totalRate = fatture.reduce((sum, f) => sum + (Array.isArray(f.rate) ? f.rate.length : 0), 0);
  const totalRateDaPagare = fatture.reduce(
    (sum, f) => sum + (Array.isArray(f.rate) ? f.rate.filter((r) => !r.pagata).length : 0),
    0
  );

  document.getElementById("totFatture").textContent = fatture.length;
  document.getElementById("totDaPagare").textContent = fatture.filter((f) => !f.pagata).length;
  document.getElementById("totPagate").textContent = fatture.filter((f) => f.pagata).length;
  document.getElementById("totArchiviate").textContent = fatture.filter((f) => f.archiviata).length;
  document.getElementById("totRate").textContent = totalRate;
  document.getElementById("totRateDaPagare").textContent = totalRateDaPagare;
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

    analizzaTestoPDF(testoCompleto, file.name);
  } catch (error) {
    console.error("Errore lettura PDF:", error);
    alert("Non sono riuscito a leggere questo PDF. Prova con un PDF testuale.");
  }
}

function analizzaTestoPDF(testo, fileName = "") {
  const testoPulito = testo.replace(/\s+/g, " ").trim();

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

  let importo = trovaMatch(testoPulito, importoPatterns, 1);
  let scadenza = trovaMatch(testoPulito, scadenzaPatterns, 1);
  let numeroFattura = trovaMatch(testoPulito, numeroPatterns, 1);
  let periodo = "";
  let fornitore = detectProvider(testoPulito, fileName);
  let tipoUtenza =
    detectUtilityType(`${testoPulito} ${fileName} ${fornitore}`) ||
    riconosciTipoDaFornitore(fornitore);

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

  if (importo) document.getElementById("importo").value = importo.replace(",", ".");
  if (scadenza) document.getElementById("scadenza").value = convertiDataPerInput(scadenza);
  if (numeroFattura) document.getElementById("numeroFattura").value = numeroFattura;
  if (periodo) document.getElementById("periodoFattura").value = periodo;
  if (fornitore) document.getElementById("fornitore").value = fornitore;
  if (tipoUtenza) document.getElementById("tipoFattura").value = tipoUtenza;

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
    const request = store.put({ id, file });

    request.onsuccess = () => {
      SyncManager.pushPdf(id, file); // Fire and forget al Cloud
      resolve(true);
    };
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

    request.onsuccess = async () => {
      if (request.result?.file) {
        resolve(request.result.file);
      } else {
        // Fallback al Cloudflare R2
        const cloudBlob = await SyncManager.getPdf(id);
        if (cloudBlob) {
          await savePdfToDB(id, cloudBlob); // Salva in locale per la prossima volta
          resolve(cloudBlob);
        } else {
          resolve(null);
        }
      }
    };
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

    request.onsuccess = () => {
      SyncManager.deletePdf(id); // Fire and forget al Cloud
      resolve(true);
    };
    request.onerror = () => reject(request.error);
  });
}

async function apriPDF(id) {
  try {
    const file = await getPdfFromDB(id);
    if (!file) {
      alert("PDF non trovato in locale e Cloud non raggiungibile.");
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

function esportaBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    utenze,
    fatture,
    autoletture
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "backup-utenze.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importaBackup() {
  const file = document.getElementById("backupFile").files[0];

  if (!file) {
    alert("Seleziona prima un file di backup JSON.");
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);

      if (!data || !Array.isArray(data.utenze) || !Array.isArray(data.fatture) || !Array.isArray(data.autoletture)) {
        alert("File backup non valido.");
        return;
      }

      utenze = data.utenze;
      fatture = data.fatture;
      autoletture = data.autoletture;
      saveData();
      refreshAll();

      alert("Backup importato correttamente.");
    } catch (error) {
      console.error(error);
      alert("Errore durante l'importazione del backup.");
    }
  };

  reader.readAsText(file);
}

async function richiediPermessoNotifiche() {
  if (!("Notification" in window)) {
    alert("Questo browser non supporta le notifiche.");
    return;
  }

  const permission = await Notification.requestPermission();

  if (permission === "granted") alert("Notifiche browser attivate.");
  else alert("Permesso notifiche non concesso.");
}

function inviaNotificaBrowser(titolo, corpo) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  new Notification(titolo, { body: corpo });
}

function controllaENotificaScadenze(forzaManuale = false) {
  const notifiche = raccogliNotifiche();
  const chiaviInviate = JSON.parse(localStorage.getItem("notificheInviate")) || {};
  const oggi = new Date().toISOString().slice(0, 10);

  notifiche.forEach((n) => {
    const key = `${oggi}-${n.testo}`;
    if (forzaManuale || !chiaviInviate[key]) {
      inviaNotificaBrowser("Promemoria Gestione Utenze", n.testo);
      chiaviInviate[key] = true;
    }
  });

  localStorage.setItem("notificheInviate", JSON.stringify(chiaviInviate));
}

initApp();
