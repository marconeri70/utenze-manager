let utenze = JSON.parse(localStorage.getItem("utenze")) || [];
let fatture = JSON.parse(localStorage.getItem("fatture")) || [];
let autoletture = JSON.parse(localStorage.getItem("autoletture")) || [];

const DB_NAME = "utenzeManagerDB";
const DB_VERSION = 2;
const PDF_STORE = "pdfFiles";
let db = null;
let monthlyChart = null;
let utilityTypeChart = null;
let selectedFattureIds = new Set(); 

// --- GESTIONE CLOUD SYNC & AI ---
const SyncManager = {
  config: JSON.parse(localStorage.getItem("syncConfig")) || { url: "", secret: "" },
  lastError: "",
  
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
        saveData(false);
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
  },

  async extractDataFromText(text) {
    this.lastError = "";

    const cleanText = String(text || "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+/g, " ")
      .trim();

    if (!this.config.url || !this.config.secret) {
      this.lastError = "URL del Worker o token di sicurezza non configurati.";
      alert("Configura prima il Cloudflare Worker nelle impostazioni Cloud.");
      return null;
    }

    if (cleanText.length < 25) {
      this.lastError =
        "Il PDF non contiene testo selezionabile. Probabilmente è una scansione o un'immagine.";
      return null;
    }

    this.updateStatus("syncing");

    try {
      const textForAI = cleanText.slice(0, 120000);

      const res = await fetch(`${this.config.url}/sync/extract`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.secret}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: textForAI })
      });

      const rawResponse = await res.text();
      let responseData = null;

      if (rawResponse) {
        try {
          responseData = JSON.parse(rawResponse);
        } catch {
          responseData = rawResponse;
        }
      }

      if (!res.ok) {
        const detail =
          typeof responseData === "object" && responseData
            ? responseData.error || responseData.message || JSON.stringify(responseData)
            : String(responseData || res.statusText || "Errore sconosciuto");

        throw new Error(`Worker ${res.status}: ${detail}`);
      }

      const normalized = normalizeAIResponse(responseData);

      if (normalized?.error) {
        this.lastError = String(normalized.error);
        this.updateStatus("error");
        return normalized;
      }

      this.updateStatus("idle");
      return normalized;
    } catch (error) {
      console.error("Errore Worker/AI:", error);
      this.lastError = error?.message || "Errore sconosciuto durante la chiamata al Worker.";
      this.updateStatus("error");
      return null;
    }
  }
};

function saveSyncConfig() {
  let rawUrl = document.getElementById("syncUrl").value.trim();
  const secretInput = document.getElementById("syncSecret");
  let secret = secretInput.value.trim();

  if (!secret || secret === "********") {
    secret = SyncManager.config.secret || "";
  }

  const urlMatch = rawUrl.match(/(https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s)]*)?)/);
  const cleanUrl = urlMatch ? urlMatch[1] : rawUrl;

  document.getElementById("syncUrl").value = cleanUrl;

  if (!cleanUrl || !secret) {
    alert("Compila URL del Worker e Token di sicurezza.");
    return;
  }

  SyncManager.saveConfig(cleanUrl, secret);
  secretInput.value = "";
  secretInput.placeholder = "Token già salvato (lascia vuoto per mantenerlo)";
  alert("Configurazione Cloud salvata e download avviato.");
}

async function initApp() {
  await initDB();
  normalizeStoredData();
  
  if (SyncManager.config.url) {
    const retroCleanUrl = SyncManager.config.url.match(/(https?:\/\/[^\s)]+)/)?.[1] || SyncManager.config.url;
    
    document.getElementById("syncUrl").value = retroCleanUrl;
    const syncSecretInput = document.getElementById("syncSecret");
    syncSecretInput.value = "";
    syncSecretInput.placeholder = SyncManager.config.secret
      ? "Token già salvato (lascia vuoto per mantenerlo)"
      : "Token di sicurezza (Bearer)";
    
    if (retroCleanUrl !== SyncManager.config.url) {
      SyncManager.saveConfig(retroCleanUrl, SyncManager.config.secret);
    } else {
      await SyncManager.pullData();
    }
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
      rate: Array.isArray(f.rate) ? f.rate.map((r, idx) => ({
        id: r.id || `${f.id || Date.now()}-r${idx + 1}`,
        numero: r.numero || idx + 1,
        importo: r.importo || "0.00",
        scadenza: r.scadenza || "",
        pagata: !!r.pagata,
        dataPagamento: r.dataPagamento || "",
        note: r.note || "",
        ricevutaMeta: r.ricevutaMeta || null
      })) : [],
      rateizzata: !!f.rateizzata,
      archiviata: !!f.archiviata,
      pagata: !!f.pagata,
      pod: f.pod || "",
      pdr: f.pdr || "",
      codiceCliente: f.codiceCliente || "",
      indirizzoFornitura: f.indirizzoFornitura || "",
      consumo: f.consumo || "",
      unitaConsumo: f.unitaConsumo || ""
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

// --- DEEP LINKING ---
function showSection(id) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.add("hidden");
  });
  document.getElementById(id).classList.remove("hidden");
  clearSelection(); 
}

function jumpToFattura(fatturaId) {
  resetFilters(false);
  document.getElementById("filterStatus").value = "dapagare";
  
  const f = fatture.find(fat => fat.id === fatturaId);
  if (f) {
    document.getElementById("searchText").value = f.fornitore;
  }
  
  showSection("archivio");
  applyFilters();
}

function jumpToAutolettura(contatoreName) {
  showSection("autoletture");
  document.getElementById("contatore").value = contatoreName;
  document.getElementById("dataAutolettura").value = new Date().toISOString().split("T")[0];
  document.getElementById("contatore").focus();
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

function jumpToArchiveWithFilters(filters) {
  resetFilters(false);
  if (filters.year) document.getElementById("filterYear").value = filters.year;
  if (filters.month) document.getElementById("filterMonth").value = filters.month;
  if (filters.tipo) document.getElementById("filterTipo").value = filters.tipo;

  showSection("archivio");
  applyFilters();
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

function parseMoney(value) {
  if (typeof value !== "string") value = String(value ?? "");
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(num) {
  return Number(num).toFixed(2);
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

  if (valore.includes("enel") || valore.includes("servizio elettrico") || valore.includes("a2a energia") || valore.includes("sorgenia") || valore.includes("edison energia") || valore.includes("e-distribuzione")) return "Luce";
  if (valore.includes("eni") || valore.includes("plenitude") || valore.includes("italgas") || valore.includes("gas")) return "Gas";
  if (valore.includes("acea") || valore.includes("acqua") || valore.includes("idrico") || valore.includes("acquedotto")) return "Acqua";
  if (valore.includes("fastweb") || valore.includes("sky wifi")) return "Internet";
  if (valore.includes("tim") || valore.includes("vodafone") || valore.includes("wind") || valore.includes("iliad") || valore.includes("telecom")) return "Telefono";
  if (valore.includes("rifiuti") || valore.includes("ambiente") || valore.includes("tari")) return "Rifiuti";

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

// --- UTENZE CRUD ---
function resetUtenzaForm() {
  document.getElementById("editUtenzaId").value = "";
  document.getElementById("nomeUtenza").value = "";
  document.getElementById("tipoUtenza").value = "";
  
  document.getElementById("utenzaFormTitle").textContent = "Nuova Utenza";
  document.getElementById("btnSalvaUtenza").textContent = "Salva utenza";
  document.getElementById("btnAnnullaUtenza").classList.add("hidden");
  document.getElementById("btnEliminaUtenza").classList.add("hidden");
}

function editUtenza(id) {
  const u = utenze.find(item => item.id === id);
  if (!u) return;

  document.getElementById("editUtenzaId").value = u.id;
  document.getElementById("nomeUtenza").value = u.nome;
  document.getElementById("tipoUtenza").value = u.tipo || "";
  
  document.getElementById("utenzaFormTitle").textContent = "Modifica Utenza";
  document.getElementById("btnSalvaUtenza").textContent = "Aggiorna utenza";
  document.getElementById("btnAnnullaUtenza").classList.remove("hidden");
  document.getElementById("btnEliminaUtenza").classList.remove("hidden");
  
  document.getElementById("nomeUtenza").focus();
}

function deleteEditingUtenza() {
  const idStr = document.getElementById("editUtenzaId").value;
  if (!idStr) return;
  const id = parseInt(idStr, 10);
  
  const conferma = confirm("Vuoi eliminare definitivamente questa utenza?");
  if (!conferma) return;
  
  utenze = utenze.filter(u => u.id !== id);
  saveData();
  renderUtenze();
  resetUtenzaForm();
}

function saveUtenza() {
  const editIdStr = document.getElementById("editUtenzaId").value;
  const nome = document.getElementById("nomeUtenza").value.trim();
  const tipo = document.getElementById("tipoUtenza").value;

  if (!nome || !tipo) {
    alert("Compila nome fornitore e tipo utenza.");
    return;
  }

  if (editIdStr) {
    const id = parseInt(editIdStr, 10);
    const index = utenze.findIndex(u => u.id === id);
    if (index !== -1) {
      const exists = utenze.some(u => 
        u.id !== id && 
        u.nome.toLowerCase() === nome.toLowerCase() && 
        u.tipo.toLowerCase() === tipo.toLowerCase()
      );
      if (exists) {
        alert("Questa utenza esiste già.");
        return;
      }
      
      utenze[index].nome = nome;
      utenze[index].tipo = tipo;
    }
  } else {
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
  }

  saveData();
  renderUtenze();
  resetUtenzaForm();
}

function renderUtenze() {
  const ul = document.getElementById("listaUtenze");
  ul.innerHTML = "";

  if (utenze.length === 0) {
    ul.innerHTML = "<li class='empty-state'>Nessuna utenza inserita.</li>";
    return;
  }

  const utenzeOrdinate = [...utenze].sort((a, b) =>
    `${a.nome} ${a.tipo}`.localeCompare(`${b.nome} ${b.tipo}`, "it")
  );

  utenzeOrdinate.forEach((u) => {
    const icon = getProviderIcon(u.nome);
    const li = document.createElement("li");
    li.className = "clickable-item";
    li.onclick = () => editUtenza(u.id);
    
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
        <div class="small-text">✎ Modifica</div>
      </div>
    `;
    ul.appendChild(li);
  });
}

function clearFatturaForm() {
  const editId = document.getElementById("editFatturaId");
  if (editId) editId.value = "";

  document.getElementById("fornitore").value = "";
  document.getElementById("tipoFattura").value = "";
  document.getElementById("scadenza").value = "";
  document.getElementById("importo").value = "";
  document.getElementById("numeroFattura").value = "";
  document.getElementById("periodoFattura").value = "";
  document.getElementById("pod").value = "";
  document.getElementById("pdr").value = "";
  document.getElementById("codiceCliente").value = "";
  document.getElementById("indirizzoFornitura").value = "";
  document.getElementById("consumo").value = "";
  document.getElementById("unitaConsumo").value = "";
  document.getElementById("pdf").value = "";
  document.getElementById("rateizzata").checked = false;
  document.getElementById("numeroRate").value = "";
  document.getElementById("importoRata").value = "";
  document.getElementById("primaScadenzaRata").value = "";
  document.getElementById("frequenzaRate").value = "mensile";
  toggleRateFields();

  const title = document.getElementById("fatturaFormTitle");
  const saveButton = document.getElementById("btnSalvaFattura");
  const cancelButton = document.getElementById("btnAnnullaFattura");
  const pdfInfo = document.getElementById("existingPdfInfo");

  if (title) title.textContent = "Nuova Fattura";
  if (saveButton) saveButton.textContent = "Salva fattura";
  if (cancelButton) cancelButton.classList.add("hidden");
  if (pdfInfo) {
    pdfInfo.textContent = "";
    pdfInfo.classList.add("hidden");
  }
}

function cancelEditFattura() {
  clearFatturaForm();
  showSection("archivio");
  renderFatture();
}

function formatConsumoScheda(consumo, unita) {
  const valore = String(consumo || "").trim();
  const misura = String(unita || "").trim();

  if (!valore) return "";
  if (!misura) return valore;

  const valoreNormalizzato = valore.toLowerCase().replace(/\s+/g, "");
  const misuraNormalizzata = misura.toLowerCase().replace(/\s+/g, "");

  return valoreNormalizzato.endsWith(misuraNormalizzata)
    ? valore
    : `${valore} ${misura}`;
}

function editFattura(fatturaId, creaRateizzazione = false) {
  const fattura = fatture.find((item) => Number(item.id) === Number(fatturaId));

  if (!fattura) {
    alert("Fattura non trovata.");
    return;
  }

  showSection("fatture");

  document.getElementById("editFatturaId").value = fattura.id;
  document.getElementById("fornitore").value = fattura.fornitore || "";
  document.getElementById("tipoFattura").value = fattura.tipoFattura || "";
  document.getElementById("scadenza").value = fattura.scadenza || "";
  document.getElementById("importo").value = fattura.importo || "";
  document.getElementById("numeroFattura").value = fattura.numeroFattura || "";
  document.getElementById("periodoFattura").value = fattura.periodoFattura || "";
  document.getElementById("pod").value = fattura.pod || "";
  document.getElementById("pdr").value = fattura.pdr || "";
  document.getElementById("codiceCliente").value = fattura.codiceCliente || "";
  document.getElementById("indirizzoFornitura").value = fattura.indirizzoFornitura || "";
  document.getElementById("consumo").value = fattura.consumo || "";
  document.getElementById("unitaConsumo").value = fattura.unitaConsumo || "";
  document.getElementById("pdf").value = "";

  const abilitaRateizzazione = !!fattura.rateizzata || !!creaRateizzazione;
  document.getElementById("rateizzata").checked = abilitaRateizzazione;
  toggleRateFields();

  if (fattura.rateizzata) {
    document.getElementById("numeroRate").value =
      fattura.numeroRate || fattura.rate?.length || "";
    document.getElementById("importoRata").value = fattura.importoRata || "";
    document.getElementById("primaScadenzaRata").value =
      fattura.primaScadenzaRata || fattura.rate?.[0]?.scadenza || "";
    document.getElementById("frequenzaRate").value =
      fattura.frequenzaRate || "mensile";
  } else if (creaRateizzazione) {
    const numeroRatePredefinito = 2;
    document.getElementById("numeroRate").value = numeroRatePredefinito;
    document.getElementById("importoRata").value =
      parseMoney(fattura.importo)
        ? formatMoney(parseMoney(fattura.importo) / numeroRatePredefinito)
        : "";
    document.getElementById("primaScadenzaRata").value =
      fattura.scadenza || new Date().toISOString().slice(0, 10);
    document.getElementById("frequenzaRate").value = "mensile";
  } else {
    document.getElementById("numeroRate").value = "";
    document.getElementById("importoRata").value = "";
    document.getElementById("primaScadenzaRata").value = "";
    document.getElementById("frequenzaRate").value = "mensile";
  }

  const title = document.getElementById("fatturaFormTitle");
  const saveButton = document.getElementById("btnSalvaFattura");
  const cancelButton = document.getElementById("btnAnnullaFattura");
  const pdfInfo = document.getElementById("existingPdfInfo");

  if (title) {
    title.textContent = creaRateizzazione
      ? "Crea rateizzazione"
      : "Modifica Fattura";
  }

  if (saveButton) {
    saveButton.textContent = creaRateizzazione
      ? "Salva rateizzazione"
      : "Aggiorna fattura";
  }

  if (cancelButton) cancelButton.classList.remove("hidden");

  if (pdfInfo) {
    if (fattura.pdfMeta?.name) {
      pdfInfo.textContent =
        `PDF già allegato: ${fattura.pdfMeta.name}. ` +
        "Se non scegli un nuovo file, quello attuale resterà invariato.";
    } else {
      pdfInfo.textContent =
        "Nessun PDF allegato. Puoi aggiungerne uno durante la modifica.";
    }
    pdfInfo.classList.remove("hidden");
  }

  requestAnimationFrame(() => {
    document.getElementById("fatturaFormCard")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    document.getElementById("fornitore")?.focus();
  });
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
      id: `${Date.now()}-${i + 1}-${Math.floor(Math.random() * 100000)}`,
      numero: i + 1,
      importo: formatMoney(importoRata),
      scadenza: dataRata,
      pagata: false,
      dataPagamento: "",
      note: "",
      ricevutaMeta: null
    });
  }
  return rate;
}

async function addFattura() {
  const editIdRaw = document.getElementById("editFatturaId")?.value || "";
  const editId = editIdRaw ? Number(editIdRaw) : null;
  const existingIndex = editId === null
    ? -1
    : fatture.findIndex((item) => Number(item.id) === editId);
  const existing = existingIndex >= 0 ? fatture[existingIndex] : null;

  const fornitore = document.getElementById("fornitore").value.trim();
  const tipoFattura = document.getElementById("tipoFattura").value;
  const scadenza = document.getElementById("scadenza").value;
  const importo = document.getElementById("importo").value.trim();
  const numeroFattura = document.getElementById("numeroFattura").value.trim();
  const periodoFattura = document.getElementById("periodoFattura").value.trim();
  const pod = document.getElementById("pod").value.trim();
  const pdr = document.getElementById("pdr").value.trim();
  const codiceCliente = document.getElementById("codiceCliente").value.trim();
  const indirizzoFornitura = document.getElementById("indirizzoFornitura").value.trim();
  const consumo = document.getElementById("consumo").value.trim();
  const unitaConsumo = document.getElementById("unitaConsumo").value.trim();
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

  let rate = [];
  let ricevuteDaEliminare = [];

  if (rateizzata) {
    const importoRataNormalizzato = formatMoney(parseMoney(importoRata));

    const pianoInvariato =
      existing?.rateizzata &&
      Array.isArray(existing.rate) &&
      existing.rate.length === numeroRate &&
      String(existing.importoRata || "") === importoRataNormalizzato &&
      String(existing.primaScadenzaRata || existing.rate?.[0]?.scadenza || "") ===
        String(primaScadenzaRata || "") &&
      String(existing.frequenzaRate || "mensile") === String(frequenzaRate || "mensile");

    if (pianoInvariato) {
      rate = existing.rate;
    } else {
      if (Array.isArray(existing?.rate) && existing.rate.length > 0) {
        const contieneDatiImportanti = existing.rate.some(
          (rata) => rata.pagata || rata.dataPagamento || rata.ricevutaMeta
        );

        const messaggio = contieneDatiImportanti
          ? "La modifica del piano rate sostituirà le rate esistenti e rimuoverà eventuali pagamenti o ricevute. Continuare?"
          : "Vuoi sostituire il piano rate esistente con quello appena indicato?";

        if (!confirm(messaggio)) return;

        ricevuteDaEliminare = existing.rate
          .map((rata) => rata.ricevutaMeta?.storageId)
          .filter(Boolean);
      }

      rate = generaPianoRate(
        numeroRate,
        parseMoney(importoRataNormalizzato),
        primaScadenzaRata,
        frequenzaRate
      );
    }
  } else if (Array.isArray(existing?.rate) && existing.rate.length > 0) {
    if (
      !confirm(
        "Disattivando la rateizzazione saranno eliminate tutte le rate e le relative ricevute. Continuare?"
      )
    ) {
      return;
    }

    ricevuteDaEliminare = existing.rate
      .map((rata) => rata.ricevutaMeta?.storageId)
      .filter(Boolean);
  }

  const id = existing?.id || Date.now();
  let pdfMeta = existing?.pdfMeta || null;

  if (file) {
    await savePdfToDB(id, file);
    pdfMeta = {
      name: file.name,
      type: file.type || "application/pdf",
      size: file.size || 0
    };
  }

  for (const storageId of ricevuteDaEliminare) {
    await deletePdfFromDB(storageId);
  }

  const tipoFinale =
    tipoFattura ||
    detectUtilityType(`${fornitore} ${numeroFattura} ${periodoFattura}`) ||
    riconosciTipoDaFornitore(fornitore) ||
    "Altro";

  const pagataFinale = rateizzata
    ? rate.length > 0 && rate.every((rata) => rata.pagata)
    : !!existing?.pagata;

  const fatturaAggiornata = {
    ...(existing || {}),
    id,
    fornitore,
    tipoFattura: tipoFinale,
    scadenza,
    importo,
    numeroFattura,
    periodoFattura,
    pod,
    pdr,
    codiceCliente,
    indirizzoFornitura,
    consumo,
    unitaConsumo,
    pdfMeta,
    pagata: pagataFinale,
    archiviata: !!existing?.archiviata,
    rateizzata,
    numeroRate: rateizzata ? numeroRate : 0,
    importoRata: rateizzata ? formatMoney(parseMoney(importoRata)) : "",
    primaScadenzaRata: rateizzata ? primaScadenzaRata : "",
    frequenzaRate: rateizzata ? frequenzaRate : "",
    rate,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    fatture[existingIndex] = fatturaAggiornata;
  } else {
    fatture.push(fatturaAggiornata);
  }

  saveData();
  refreshAll();
  clearFatturaForm();

  if (existingIndex >= 0) {
    showSection("archivio");
    renderFatture();
    alert(
      rateizzata && !existing?.rateizzata
        ? "Rateizzazione creata correttamente."
        : "Fattura aggiornata correttamente."
    );
  } else {
    alert("Fattura salvata correttamente.");
  }
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

// --- BULK ACTIONS ---
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
    ul.innerHTML = "<li class='empty-state'>Nessuna fattura trovata con i filtri selezionati.</li>";
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
          ${f.rate.map((r) => `
            <div class="installment-row installment-editor">
              <div class="installment-main">
                <strong>Rata ${r.numero}</strong>
                <span class="badge ${r.pagata ? "paid" : "pending"}">${r.pagata ? "Pagata" : "Da pagare"}</span>
                ${r.ricevutaMeta ? '<span class="badge receipt">Ricevuta allegata</span>' : ''}
              </div>
              <div class="installment-edit-grid">
                <label>Importo
                  <input id="rata-importo-${f.id}-${r.id}" value="${escapeHtml(r.importo)}" inputmode="decimal">
                </label>
                <label>Scadenza
                  <input id="rata-scadenza-${f.id}-${r.id}" type="date" value="${escapeHtml(r.scadenza)}">
                </label>
                <label>Data pagamento
                  <input id="rata-pagamento-${f.id}-${r.id}" type="date" value="${escapeHtml(r.dataPagamento || '')}">
                </label>
                <label class="installment-note">Note
                  <input id="rata-note-${f.id}-${r.id}" value="${escapeHtml(r.note || '')}" placeholder="Note sulla rata">
                </label>
              </div>
              <div class="installment-actions">
                <button class="small-btn open-btn" onclick="salvaModificheRata(${f.id}, '${r.id}')">Salva modifiche</button>
                <button class="small-btn pay-btn" onclick="toggleRataPagata(${f.id}, '${r.id}')">${r.pagata ? "Segna da pagare" : "Segna pagata"}</button>
                <label class="small-btn receipt-btn">${r.ricevutaMeta ? "Sostituisci ricevuta" : "Carica ricevuta"}
                  <input type="file" accept="application/pdf,image/*" hidden onchange="caricaRicevutaRata(${f.id}, '${r.id}', this)">
                </label>
                ${r.ricevutaMeta ? `<button class="small-btn open-btn" onclick="apriRicevutaRata(${f.id}, '${r.id}')">Apri ricevuta</button>
                <button class="small-btn delete-btn" onclick="eliminaRicevutaRata(${f.id}, '${r.id}')">Elimina ricevuta</button>` : ''}
                <button class="small-btn delete-btn" onclick="eliminaRata(${f.id}, '${r.id}')">Elimina rata</button>
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
        ${f.pod ? `<div class="small-text">POD: ${escapeHtml(f.pod)}</div>` : ""}
        ${f.pdr ? `<div class="small-text">PDR: ${escapeHtml(f.pdr)}</div>` : ""}
        ${f.codiceCliente ? `<div class="small-text">Codice cliente: ${escapeHtml(f.codiceCliente)}</div>` : ""}
        ${f.indirizzoFornitura ? `<div class="small-text">Fornitura: ${escapeHtml(f.indirizzoFornitura)}</div>` : ""}
        ${f.consumo ? `<div class="small-text">Consumo: ${escapeHtml(formatConsumoScheda(f.consumo, f.unitaConsumo))}</div>` : ""}
        <div class="small-text">PDF: ${escapeHtml(f.pdfMeta?.name || "Non allegato")}</div>

        ${
          f.rateizzata
            ? `<div class="small-text">Rate: ${escapeHtml(f.numeroRate)} • Importo rata: € ${escapeHtml(f.importoRata)} • Prima scadenza rata: ${formatDate(f.primaScadenzaRata)}</div>`
            : ""
        }

        ${rateHtml}

        <div class="actions">
          <button class="small-btn edit-btn" onclick="editFattura(${f.id})">Modifica scheda</button>
          ${
            !f.rateizzata
              ? `<button class="small-btn installment-create-btn" onclick="editFattura(${f.id}, true)">Crea rateizzazione</button>`
              : ""
          }
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

// --- GRAFICI INTERATTIVI ---
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
          data: values,
          backgroundColor: "#0b6fc2",
          borderRadius: 6,
          hoverBackgroundColor: "#005195"
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true }
      },
      onHover: (event, chartElement) => {
        event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
      },
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const label = labels[index]; 
          const [year, month] = label.split("-");
          jumpToArchiveWithFilters({ year, month });
        }
      }
    }
  });
}

function renderUtilityTypeChart() {
  const canvas = document.getElementById("utilityTypeChart");
  if (!canvas || typeof Chart === "undefined") return;

  const map = {
    Luce: 0, Gas: 0, Acqua: 0, Internet: 0, Telefono: 0, Rifiuti: 0, Altro: 0
  };

  fatture.forEach((f) => {
    const tipo = f.tipoFattura || "Altro";
    if (!Object.prototype.hasOwnProperty.call(map, tipo)) map[tipo] = 0;
    map[tipo] += parseMoney(f.importo);
  });

  const labels = Object.keys(map);
  const values = labels.map((k) => Number(formatMoney(map[k])));

  if (utilityTypeChart) utilityTypeChart.destroy();

  const backgroundColors = [
    "#f59e0b", 
    "#ef4444", 
    "#3b82f6", 
    "#8b5cf6", 
    "#10b981", 
    "#64748b", 
    "#cbd5e1"  
  ];

  utilityTypeChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          label: "Spese per tipo",
          data: values,
          backgroundColor: backgroundColors,
          borderWidth: 2,
          hoverOffset: 10
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom" }
      },
      onHover: (event, chartElement) => {
        event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
      },
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const label = labels[index]; 
          jumpToArchiveWithFilters({ tipo: label });
        }
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

function trovaRata(fatturaId, rataId) {
  const fattura = fatture.find((f) => Number(f.id) === Number(fatturaId));
  if (!fattura || !Array.isArray(fattura.rate)) return { fattura: null, rata: null };
  const rata = fattura.rate.find((r) => String(r.id) === String(rataId));
  return { fattura, rata };
}

function salvaModificheRata(fatturaId, rataId) {
  const { fattura, rata } = trovaRata(fatturaId, rataId);
  if (!fattura || !rata) return;
  const importo = document.getElementById(`rata-importo-${fatturaId}-${rataId}`)?.value || "";
  const scadenza = document.getElementById(`rata-scadenza-${fatturaId}-${rataId}`)?.value || "";
  const dataPagamento = document.getElementById(`rata-pagamento-${fatturaId}-${rataId}`)?.value || "";
  const note = document.getElementById(`rata-note-${fatturaId}-${rataId}`)?.value.trim() || "";
  if (!parseMoney(importo) || !scadenza) {
    alert("Inserisci un importo valido e la data di scadenza.");
    return;
  }
  rata.importo = formatMoney(parseMoney(importo));
  rata.scadenza = scadenza;
  rata.dataPagamento = dataPagamento;
  rata.note = note;
  if (dataPagamento) rata.pagata = true;
  fattura.pagata = fattura.rate.length > 0 && fattura.rate.every((r) => r.pagata);
  saveData();
  refreshAll();
  alert("Rata aggiornata.");
}

function toggleRataPagata(fatturaId, rataId) {
  const { fattura, rata } = trovaRata(fatturaId, rataId);
  if (!fattura || !rata) return;
  rata.pagata = !rata.pagata;
  rata.dataPagamento = rata.pagata ? (rata.dataPagamento || new Date().toISOString().slice(0, 10)) : "";
  fattura.pagata = fattura.rate.length > 0 && fattura.rate.every((r) => r.pagata);
  saveData();
  refreshAll();
}

async function caricaRicevutaRata(fatturaId, rataId, input) {
  const file = input.files?.[0];
  if (!file) return;
  const valid = file.type === "application/pdf" || file.type.startsWith("image/");
  if (!valid) {
    alert("Puoi caricare solo PDF o immagini.");
    input.value = "";
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    alert("Il file supera 15 MB.");
    input.value = "";
    return;
  }
  const { fattura, rata } = trovaRata(fatturaId, rataId);
  if (!fattura || !rata) return;
  const storageId = `ricevuta-${fatturaId}-${rataId}`;
  await savePdfToDB(storageId, file);
  rata.ricevutaMeta = { storageId, name: file.name, type: file.type, size: file.size };
  rata.pagata = true;
  rata.dataPagamento = rata.dataPagamento || new Date().toISOString().slice(0, 10);
  fattura.pagata = fattura.rate.every((r) => r.pagata);
  saveData();
  refreshAll();
}

async function apriRicevutaRata(fatturaId, rataId) {
  const { rata } = trovaRata(fatturaId, rataId);
  if (!rata?.ricevutaMeta?.storageId) return;
  await apriAllegato(rata.ricevutaMeta.storageId, "Ricevuta non trovata in locale o nel cloud.");
}

async function eliminaRicevutaRata(fatturaId, rataId) {
  const { rata } = trovaRata(fatturaId, rataId);
  if (!rata?.ricevutaMeta?.storageId) return;
  if (!confirm("Vuoi eliminare la ricevuta allegata?")) return;
  await deletePdfFromDB(rata.ricevutaMeta.storageId);
  rata.ricevutaMeta = null;
  saveData();
  refreshAll();
}

async function eliminaRata(fatturaId, rataId) {
  const fattura = fatture.find((f) => Number(f.id) === Number(fatturaId));
  if (!fattura || !confirm("Vuoi eliminare questa rata dal piano?")) return;
  const rata = fattura.rate.find((r) => String(r.id) === String(rataId));
  if (rata?.ricevutaMeta?.storageId) await deletePdfFromDB(rata.ricevutaMeta.storageId);
  fattura.rate = fattura.rate.filter((r) => String(r.id) !== String(rataId));
  fattura.rate.forEach((r, idx) => { r.numero = idx + 1; });
  fattura.numeroRate = fattura.rate.length;
  fattura.rateizzata = fattura.rate.length > 0;
  fattura.pagata = fattura.rate.length > 0 && fattura.rate.every((r) => r.pagata);
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
  if (Array.isArray(item?.rate)) {
    for (const rata of item.rate) {
      if (rata.ricevutaMeta?.storageId) await deletePdfFromDB(rata.ricevutaMeta.storageId);
    }
  }

  fatture.splice(index, 1);
  saveData();
  refreshAll();
}

// --- DASHBOARD RENDERERS ---
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
    item.className = "alert-item clickable-item";
    item.onclick = () => jumpToFattura(f.id);
    
    item.innerHTML = `
      <div style="flex:1;">
        <strong>${escapeHtml(f.fornitore)}</strong><br>
        Tipo: ${escapeHtml(f.tipoFattura || "-")}<br>
        Importo: € ${escapeHtml(f.importo)}<br>
        Data: ${formatDate(f.scadenza)}<br>
        <strong>${testoGiorni}</strong>
      </div>
      <div class="jump-icon">➔</div>
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
    item.className = "info-item clickable-item";
    item.onclick = () => jumpToFattura(r.fatturaId);
    
    item.innerHTML = `
      <div style="flex:1;">
        <strong>${escapeHtml(r.fornitore)}</strong><br>
        Rata ${r.numeroRata} • € ${escapeHtml(r.importo)}<br>
        Data: ${formatDate(r.scadenza)}<br>
        <strong>${testo}</strong>
      </div>
      <div class="jump-icon">➔</div>
    `;
    div.appendChild(item);
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
    item.className = "info-item clickable-item";
    item.onclick = () => jumpToAutolettura(a.contatore);
    
    item.innerHTML = `
      <div style="flex:1;">
        <strong>${escapeHtml(a.contatore)}</strong><br>
        Tipo: ${escapeHtml(a.tipo)}<br>
        Data: ${formatDate(a.data)}<br>
        <strong>${testo}</strong>
      </div>
      <div class="jump-icon">➔</div>
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
    div.className = `${n.tipo === "danger" ? "danger-item" : "info-item"} clickable-item`;
    
    div.onclick = () => {
      if (n.targetType === "fattura") jumpToFattura(n.targetId);
      if (n.targetType === "autolettura") jumpToAutolettura(n.targetId);
    };

    div.innerHTML = `
      <div style="flex:1;">${n.testo}</div>
      <div class="jump-icon">➔</div>
    `;
    box.appendChild(div);
  });
}

function raccogliNotifiche() {
  const notifiche = [];

  fatture.forEach((f) => {
    if (!f.pagata) {
      const diff = daysDiffFromToday(f.scadenza);
      if (diff < 0) notifiche.push({ tipo: "danger", testo: `${f.fornitore}: bolletta scaduta da ${Math.abs(diff)} giorni`, targetType: "fattura", targetId: f.id });
      else if (diff <= 3) notifiche.push({ tipo: "info", testo: `${f.fornitore}: bolletta in scadenza il ${formatDate(f.scadenza)}`, targetType: "fattura", targetId: f.id });
    }
  });

  getAllUnpaidInstallments().forEach((r) => {
    if (r.diffGiorni < 0) notifiche.push({ tipo: "danger", testo: `${r.fornitore}: rata ${r.numeroRata} scaduta da ${Math.abs(r.diffGiorni)} giorni`, targetType: "fattura", targetId: r.fatturaId });
    else if (r.diffGiorni <= 3) notifiche.push({ tipo: "info", testo: `${r.fornitore}: rata ${r.numeroRata} in scadenza il ${formatDate(r.scadenza)}`, targetType: "fattura", targetId: r.fatturaId });
  });

  autoletture.forEach((a) => {
    const diff = daysDiffFromToday(a.data);
    if (diff < 0) notifiche.push({ tipo: "danger", testo: `${a.contatore}: autolettura in ritardo di ${Math.abs(diff)} giorni`, targetType: "autolettura", targetId: a.contatore });
    else if (diff <= 2) notifiche.push({ tipo: "info", testo: `${a.contatore}: autolettura da fare il ${formatDate(a.data)}`, targetType: "autolettura", targetId: a.contatore });
  });

  return notifiche;
}

function renderAutoletture() {
  const ul = document.getElementById("listaAutoletture");
  ul.innerHTML = "";

  if (autoletture.length === 0) {
    ul.innerHTML = "<li class='empty-state'>Nessuna autolettura salvata.</li>";
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

// --- LETTURA PDF E INTEGRAZIONE AI CLOUDFLARE ---
function parsePossibleJson(value) {
  if (typeof value !== "string") return value;

  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        return value;
      }
    }
    return value;
  }
}

function normalizeAIResponse(payload) {
  let current = payload;

  for (let i = 0; i < 6; i++) {
    current = parsePossibleJson(current);

    if (!current || typeof current !== "object") break;

    const hasBillFields = [
      "fornitore",
      "supplier",
      "importo",
      "amount",
      "scadenza",
      "dueDate",
      "numeroFattura",
      "numero_fattura",
      "tipoFattura",
      "tipo_utenza",
      "pod",
      "pdr"
    ].some((key) => key in current);

    if (hasBillFields || current.error) break;

    if (current.data != null) {
      current = current.data;
      continue;
    }
    if (current.result != null) {
      current = current.result;
      continue;
    }
    if (current.response != null) {
      current = current.response;
      continue;
    }
    if (current.output != null) {
      current = current.output;
      continue;
    }

    break;
  }

  current = parsePossibleJson(current);

  if (!current || typeof current !== "object" || Array.isArray(current)) {
    return current ? { error: "Il Worker ha restituito una risposta non riconosciuta." } : null;
  }

  const normalized = {
    ...current,
    fornitore: current.fornitore || current.supplier || current.gestore || "",
    tipoFattura:
      current.tipoFattura ||
      current.tipo_fattura ||
      current.tipoUtenza ||
      current.tipo_utenza ||
      current.utilityType ||
      "",
    importo: current.importo || current.amount || current.totale || "",
    scadenza:
      current.scadenza ||
      current.dataScadenza ||
      current.data_scadenza ||
      current.dueDate ||
      "",
    numeroFattura:
      current.numeroFattura ||
      current.numero_fattura ||
      current.invoiceNumber ||
      "",
    periodo:
      current.periodo ||
      current.periodoFattura ||
      current.periodo_fattura ||
      current.billingPeriod ||
      "",
    codiceCliente:
      current.codiceCliente ||
      current.codice_cliente ||
      current.customerCode ||
      "",
    indirizzoFornitura:
      current.indirizzoFornitura ||
      current.indirizzo_fornitura ||
      current.supplyAddress ||
      "",
    consumo: current.consumo || current.consumption || "",
    unitaConsumo:
      current.unitaConsumo ||
      current.unita_consumo ||
      current.consumptionUnit ||
      "",
    numeroRate:
      current.numeroRate ||
      current.numero_rate ||
      current.installmentCount ||
      0,
    importoRata:
      current.importoRata ||
      current.importo_rata ||
      current.installmentAmount ||
      "",
    primaScadenzaRata:
      current.primaScadenzaRata ||
      current.prima_scadenza_rata ||
      current.firstInstallmentDueDate ||
      ""
  };

  if (!normalized.tipoFattura) {
    normalized.tipoFattura = detectUtilityType(
      `${normalized.fornitore} ${current.testo || ""}`
    );
  }

  return normalized;
}

function normalizeDateForInput(value) {
  if (!value) return "";

  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const match = raw.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  if (!match) return "";

  let [, day, month, year] = match;
  if (year.length === 2) year = `20${year}`;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function cleanExtractedMoney(value) {
  if (!value) return "";
  const match = String(value).match(/(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))/);
  return match ? match[1].replace(/\s/g, "") : "";
}

function extractLocalBillData(text) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  const lower = source.toLowerCase();
  const data = {};

  const providers = [
    ["Enel Energia", /\benel(?:\s+energia)?\b/i],
    ["Servizio Elettrico Nazionale", /servizio elettrico nazionale/i],
    ["Plenitude", /\bplenitude\b|\beni gas e luce\b/i],
    ["Acea", /\bacea\b/i],
    ["A2A Energia", /\ba2a(?:\s+energia)?\b/i],
    ["Sorgenia", /\bsorgenia\b/i],
    ["Edison Energia", /\bedison(?:\s+energia)?\b/i],
    ["Hera", /\bhera\b/i],
    ["Fastweb", /\bfastweb\b/i],
    ["TIM", /\b(?:tim|telecom italia)\b/i],
    ["Vodafone", /\bvodafone\b/i],
    ["WindTre", /\bwind\s*tre\b|\bwind3\b/i],
    ["Iliad", /\biliad\b/i],
    ["Sky", /\bsky\b/i]
  ];

  const provider = providers.find(([, regex]) => regex.test(source));
  if (provider) data.fornitore = provider[0];

  data.tipoFattura = detectUtilityType(source) || "";

  const amountPatterns = [
    /(?:totale\s+(?:da\s+pagare|bolletta)|importo\s+(?:da\s+pagare|totale)|da\s+pagare)\s*[:€]?\s*€?\s*([0-9.\s]+,\d{2})/i,
    /€\s*([0-9.\s]+,\d{2})/i
  ];

  for (const pattern of amountPatterns) {
    const match = source.match(pattern);
    if (match) {
      data.importo = cleanExtractedMoney(match[1]);
      break;
    }
  }

  const dueMatch = source.match(
    /(?:data\s+di\s+scadenza|scadenza|entro\s+il)\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i
  );
  if (dueMatch) data.scadenza = normalizeDateForInput(dueMatch[1]);

  const invoiceMatch = source.match(
    /(?:numero|n\.?|nr\.?)\s*(?:della\s+)?fattura\s*[:\-]?\s*([A-Z0-9\/._-]{3,})/i
  );
  if (invoiceMatch) data.numeroFattura = invoiceMatch[1];

  const podMatch = source.match(/\bPOD\s*[:\-]?\s*(IT[0-9A-Z]{10,20})\b/i);
  if (podMatch) data.pod = podMatch[1].toUpperCase();

  const pdrMatch = source.match(/\bPDR\s*[:\-]?\s*([0-9]{10,20})\b/i);
  if (pdrMatch) data.pdr = pdrMatch[1];

  const customerMatch = source.match(
    /(?:codice\s+cliente|numero\s+cliente|cod\.\s*cliente)\s*[:\-]?\s*([A-Z0-9._\/-]{3,})/i
  );
  if (customerMatch) data.codiceCliente = customerMatch[1];

  const consumptionPatterns = [
    [/([0-9.,]+)\s*kWh\b/i, "kWh"],
    [/([0-9.,]+)\s*Smc\b/i, "Smc"],
    [/([0-9.,]+)\s*m[³3]\b/i, "mc"]
  ];

  for (const [pattern, unit] of consumptionPatterns) {
    const match = source.match(pattern);
    if (match) {
      data.consumo = match[1];
      data.unitaConsumo = unit;
      break;
    }
  }

  const installmentMatch = lower.match(
    /(?:rateizz(?:azione|ata)|piano\s+rate)[^0-9]{0,30}(\d{1,2})\s+rate(?:\s+da)?\s*€?\s*([0-9.,]+)?/i
  );

  if (installmentMatch) {
    data.numeroRate = Number(installmentMatch[1]);
    if (installmentMatch[2]) data.importoRata = cleanExtractedMoney(installmentMatch[2]);
  }

  return data;
}

function hasUsefulBillData(data) {
  if (!data || typeof data !== "object") return false;
  return Boolean(
    data.fornitore ||
    data.importo ||
    data.scadenza ||
    data.numeroFattura ||
    data.pod ||
    data.pdr
  );
}

function applyExtractedBillData(data) {
  if (!data || typeof data !== "object") return;

  const setValue = (id, value) => {
    const element = document.getElementById(id);
    if (element && value !== undefined && value !== null && String(value).trim() !== "") {
      element.value = String(value).trim();
    }
  };

  setValue("fornitore", data.fornitore);
  setValue("tipoFattura", data.tipoFattura);
  setValue("importo", cleanExtractedMoney(data.importo) || data.importo);
  setValue("scadenza", normalizeDateForInput(data.scadenza) || data.scadenza);
  setValue("numeroFattura", data.numeroFattura);
  setValue("periodoFattura", data.periodo || data.periodoFattura);
  setValue("pod", data.pod);
  setValue("pdr", data.pdr);
  setValue("codiceCliente", data.codiceCliente);
  setValue("indirizzoFornitura", data.indirizzoFornitura);
  setValue("consumo", data.consumo);
  setValue("unitaConsumo", data.unitaConsumo);

  const numeroRateAI = Number(data.numeroRate || data.rate?.length || 0);
  const primaScadenzaAI =
    normalizeDateForInput(data.primaScadenzaRata || data.rate?.[0]?.scadenza || "");
  const importoRataAI = data.importoRata || data.rate?.[0]?.importo || "";

  if (numeroRateAI >= 2) {
    document.getElementById("rateizzata").checked = true;
    toggleRateFields();
    document.getElementById("numeroRate").value = numeroRateAI;

    if (primaScadenzaAI) {
      document.getElementById("primaScadenzaRata").value = primaScadenzaAI;
    }

    if (importoRataAI) {
      document.getElementById("importoRata").value =
        cleanExtractedMoney(importoRataAI) || importoRataAI;
    }
  }
}

async function verificaCollegamentoAI() {
  const result = await SyncManager.extractDataFromText(
    "Fattura di prova Enel Energia. Totale da pagare euro 25,50. Scadenza 31/12/2026. POD IT001E123456789."
  );

  if (result && !result.error) {
    alert("Collegamento al Worker e all'Intelligenza Artificiale funzionante.");
    return;
  }

  alert(
    "Collegamento AI non riuscito.\n\nMotivo: " +
      (result?.error || SyncManager.lastError || "Risposta non valida del Worker.")
  );
}

function setOCRProgress({
  visible = true,
  title = "Riconoscimento OCR",
  text = "Preparazione...",
  percent = 0
} = {}) {
  const box = document.getElementById("ocrProgressBox");
  const titleElement = document.getElementById("ocrProgressTitle");
  const textElement = document.getElementById("ocrProgressText");
  const percentElement = document.getElementById("ocrProgressPercent");
  const barElement = document.getElementById("ocrProgressBar");

  if (!box) return;

  box.classList.toggle("hidden", !visible);

  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));

  if (titleElement) titleElement.textContent = title;
  if (textElement) textElement.textContent = text;
  if (percentElement) percentElement.textContent = `${safePercent}%`;
  if (barElement) barElement.style.width = `${safePercent}%`;
}

function hideOCRProgress(delay = 0) {
  window.setTimeout(() => {
    setOCRProgress({ visible: false, percent: 0 });
  }, delay);
}

async function renderPdfPageForOCR(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const maxWidth = 1800;
  const scale = Math.max(1.5, Math.min(2.2, maxWidth / baseViewport.width));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
    background: "rgb(255,255,255)"
  }).promise;

  return canvas;
}

function improveCanvasForOCR(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(
      pixels[i] * 0.299 +
      pixels[i + 1] * 0.587 +
      pixels[i + 2] * 0.114
    );

    // Contrasto leggero: conserva loghi e testi sottili senza una soglia troppo aggressiva.
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.25 + 128));

    pixels[i] = contrasted;
    pixels[i + 1] = contrasted;
    pixels[i + 2] = contrasted;
    pixels[i + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function tesseractStatusToItalian(status) {
  const labels = {
    "loading tesseract core": "Caricamento motore OCR",
    "initializing tesseract": "Inizializzazione OCR",
    "loading language traineddata": "Caricamento lingua italiana",
    "initializing api": "Preparazione riconoscimento",
    "recognizing text": "Lettura del testo"
  };

  return labels[status] || "Riconoscimento del testo";
}

async function extractTextWithOCR(pdf) {
  if (!window.Tesseract?.createWorker) {
    throw new Error(
      "Il modulo OCR non è stato caricato. Controlla la connessione Internet e aggiorna la pagina."
    );
  }

  const maxPages = 10;
  const pagesToProcess = Math.min(pdf.numPages, maxPages);
  let currentPage = 1;

  setOCRProgress({
    visible: true,
    title: "PDF scansionato: avvio OCR",
    text: "Il primo utilizzo può richiedere più tempo per caricare la lingua italiana.",
    percent: 1
  });

  const worker = await Tesseract.createWorker("ita", 1, {
    logger: (message) => {
      const pageBase = ((currentPage - 1) / pagesToProcess) * 100;
      const pageShare = 100 / pagesToProcess;
      const localProgress = Number(message.progress || 0);
      const totalProgress = pageBase + pageShare * localProgress;

      setOCRProgress({
        visible: true,
        title: `OCR pagina ${currentPage} di ${pagesToProcess}`,
        text: tesseractStatusToItalian(message.status),
        percent: totalProgress
      });
    }
  });

  let ocrText = "";

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "3"
    });

    for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber++) {
      currentPage = pageNumber;

      setOCRProgress({
        visible: true,
        title: `OCR pagina ${pageNumber} di ${pagesToProcess}`,
        text: "Conversione della pagina in immagine...",
        percent: ((pageNumber - 1) / pagesToProcess) * 100
      });

      const page = await pdf.getPage(pageNumber);
      let canvas = await renderPdfPageForOCR(page);
      canvas = improveCanvasForOCR(canvas);

      try {
        const result = await worker.recognize(canvas);
        const pageText = String(result?.data?.text || "").trim();

        if (pageText) {
          ocrText += `\n\n--- PAGINA ${pageNumber} ---\n${pageText}`;
        }
      } catch (pageError) {
        console.error(`Errore OCR pagina ${pageNumber}:`, pageError);
      } finally {
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup?.();
      }
    }
  } finally {
    await worker.terminate();
  }

  setOCRProgress({
    visible: true,
    title: "OCR completato",
    text:
      pdf.numPages > maxPages
        ? `Analizzate le prime ${maxPages} pagine su ${pdf.numPages}.`
        : `Analizzate ${pagesToProcess} pagine.`,
    percent: 100
  });

  return ocrText.replace(/\u0000/g, "").trim();
}

async function leggiPDF() {
  const file = document.getElementById("pdf").files[0];

  if (!file) {
    alert("Carica prima un PDF.");
    return;
  }

  const btn = document.querySelector("button[onclick='leggiPDF()']");
  const originalText = btn?.textContent || "Importa dati da PDF";
  let usedOCR = false;

  if (btn) {
    btn.textContent = "Analisi documento in corso...";
    btn.disabled = true;
  }

  setOCRProgress({
    visible: true,
    title: "Analisi del PDF",
    text: "Ricerca del testo digitale...",
    percent: 2
  });

  try {
    if (!window.pdfjsLib) {
      throw new Error("Il lettore PDF non è stato caricato.");
    }

    if (window.pdfjsLib?.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);
    const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;

    let testoCompleto = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      setOCRProgress({
        visible: true,
        title: "Analisi del PDF",
        text: `Controllo testo digitale: pagina ${i} di ${pdf.numPages}`,
        percent: Math.min(20, (i / pdf.numPages) * 20)
      });

      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      testoCompleto +=
        "\n" +
        content.items
          .map((item) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`)
          .join("");

      page.cleanup?.();
    }

    testoCompleto = testoCompleto.replace(/\u0000/g, "").trim();

    if (testoCompleto.length < 25) {
      usedOCR = true;

      if (btn) {
        btn.textContent = "OCR in corso: non chiudere...";
      }

      testoCompleto = await extractTextWithOCR(pdf);

      if (testoCompleto.length < 25) {
        throw new Error(
          "L'OCR è terminato, ma non è riuscito a riconoscere testo sufficiente. " +
          "Prova con una scansione più nitida, ben orientata e con maggiore contrasto."
        );
      }
    }

    setOCRProgress({
      visible: true,
      title: usedOCR ? "OCR completato" : "Testo PDF trovato",
      text: "Analisi intelligente dei dati della bolletta...",
      percent: usedOCR ? 100 : 35
    });

    if (btn) {
      btn.textContent = "Analisi IA in corso...";
    }

    const localData = extractLocalBillData(testoCompleto);
    const aiData = await SyncManager.extractDataFromText(testoCompleto);

    if (aiData && !aiData.error) {
      const mergedData = { ...localData, ...aiData };
      applyExtractedBillData(mergedData);

      setOCRProgress({
        visible: true,
        title: "Analisi completata",
        text: usedOCR
          ? "Testo riconosciuto con OCR e campi compilati."
          : "Campi compilati dal testo digitale del PDF.",
        percent: 100
      });

      hideOCRProgress(3500);

      alert(
        usedOCR
          ? "OCR e analisi completati. Controlla i campi prima di salvare."
          : "Analisi completata. Controlla i campi prima di salvare."
      );
      return;
    }

    if (hasUsefulBillData(localData)) {
      applyExtractedBillData(localData);

      setOCRProgress({
        visible: true,
        title: "Recupero parziale completato",
        text: "Alcuni dati sono stati estratti direttamente dal documento.",
        percent: 100
      });

      hideOCRProgress(5000);

      alert(
        "L'Intelligenza Artificiale non ha risposto correttamente, " +
          "ma l'app ha recuperato alcuni dati direttamente dal documento.\n\n" +
          "Motivo AI: " +
          (aiData?.error || SyncManager.lastError || "Risposta non valida del Worker.") +
          "\n\nControlla e completa i campi prima di salvare."
      );
      return;
    }

    throw new Error(
      aiData?.error ||
        SyncManager.lastError ||
        "Il documento è stato letto, ma non sono stati individuati dati utili."
    );
  } catch (error) {
    console.error("Errore PDF/OCR/IA:", error);

    setOCRProgress({
      visible: true,
      title: "Analisi non completata",
      text: error?.message || "Errore sconosciuto",
      percent: 0
    });

    alert(
      "Errore durante la lettura del documento.\n\nDettaglio: " +
        (error?.message || "errore sconosciuto")
    );
  } finally {
    if (btn) {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
}

// --- GESTIONE DATABASE LOCALE INDEXED DB ---
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
      SyncManager.pushPdf(id, file); 
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
        const cloudBlob = await SyncManager.getPdf(id);
        if (cloudBlob) {
          await savePdfToDB(id, cloudBlob); 
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
      SyncManager.deletePdf(id); 
      resolve(true);
    };
    request.onerror = () => reject(request.error);
  });
}

async function apriAllegato(id, messaggioErrore = "Allegato non trovato.") {
  try {
    const file = await getPdfFromDB(id);
    if (!file) {
      alert(messaggioErrore);
      return;
    }
    const url = URL.createObjectURL(file);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch (error) {
    console.error(error);
    alert("Errore nell'apertura dell'allegato.");
  }
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

// --- BACKUP LOCALE E NOTIFICHE PUSH ---
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
