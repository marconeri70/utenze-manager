let utenze = JSON.parse(localStorage.getItem("utenze")) || [];
let fatture = JSON.parse(localStorage.getItem("fatture")) || [];
let autoletture = JSON.parse(localStorage.getItem("autoletture")) || [];

const DB_NAME = "utenzeManagerDB";
const DB_VERSION = 2;
const PDF_STORE = "pdfFiles";
const RECEIPT_STORE = "paymentReceipts";

let db = null;
let monthlyChart = null;
let utilityTypeChart = null;

async function initApp() {
  try {
    await initDB();
    normalizeStoredData();
    autoCreateUtilitiesFromInvoices();
    populateFilterOptions();
    refreshAll();
    showSection("dashboard");
    controllaENotificaScadenze(false);
  } catch (error) {
    console.error("Errore inizializzazione app:", error);
    alert("Errore durante l'avvio dell'app.");
  }
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
      rate: Array.isArray(f.rate)
        ? f.rate.map((r, index) => ({
            numero: index + 1,
            pagata: false,
            ...r,
            receiptMeta: r.receiptMeta || null
          }))
        : [],
      rateizzata: !!f.rateizzata,
      archiviata: !!f.archiviata,
      pagata: !!f.pagata
    };
  });

  saveData();
}

function saveData() {
  localStorage.setItem("utenze", JSON.stringify(utenze));
  localStorage.setItem("fatture", JSON.stringify(fatture));
  localStorage.setItem("autoletture", JSON.stringify(autoletture));
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

  const target = document.getElementById(id);
  if (target) target.classList.remove("hidden");
}

function openArchiveFromDashboard(mode) {
  resetFilters(false);

  const filterStatus = document.getElementById("filterStatus");

  if (mode === "pagata") filterStatus.value = "pagata";
  if (mode === "dapagare") filterStatus.value = "dapagare";
  if (mode === "archiviata") filterStatus.value = "archiviata";
  if (mode === "rateizzata") filterStatus.value = "rateizzata";
  if (mode === "rateizzatadaPagare") {
    filterStatus.value = "rateizzatadaPagare";
  }

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

  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return date.toLocaleDateString("it-IT");
}

function daysDiffFromToday(dateString) {
  if (!dateString) return Number.POSITIVE_INFINITY;

  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);

  const data = new Date(`${dateString}T00:00:00`);
  data.setHours(0, 0, 0, 0);

  return Math.ceil(
    (data.getTime() - oggi.getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

function convertiDataPerInput(dataStr) {
  if (!dataStr) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
    return dataStr;
  }

  const parts = dataStr.split(/[\/\-\.]/);

  if (parts.length === 3) {
    const [day, month, year] = parts;

    if (year.length === 4) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }

  return "";
}

function parseMoney(value) {
  if (typeof value !== "string") {
    value = String(value ?? "");
  }

  let normalized = value
    .replace(/\s/g, "")
    .replace(/[€]/g, "");

  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  normalized = normalized.replace(/[^\d.-]/g, "");

  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(num) {
  return Number(num || 0).toFixed(2);
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
    {
      name: "Enel",
      patterns: [
        "enel energia",
        "servizio elettrico nazionale",
        "enel"
      ]
    },
    {
      name: "Plenitude",
      patterns: [
        "eni plenitude",
        "plenitude",
        "eni gas e luce"
      ]
    },
    {
      name: "Acea",
      patterns: [
        "acea ato 5",
        "acea ato",
        "acea acqua",
        "acea energia",
        "acea ambiente",
        "acea"
      ]
    },
    { name: "Fastweb", patterns: ["fastweb"] },
    { name: "TIM", patterns: ["telecom italia", "tim s.p.a", "tim"] },
    { name: "Vodafone", patterns: ["vodafone"] },
    { name: "Iliad", patterns: ["iliad"] },
    { name: "WindTre", patterns: ["windtre", "wind tre"] },
    { name: "Italgas", patterns: ["italgas"] },
    { name: "A2A", patterns: ["a2a energia", "a2a"] },
    { name: "Sorgenia", patterns: ["sorgenia"] },
    { name: "Edison", patterns: ["edison energia", "edison"] },
    { name: "Hera", patterns: ["gruppo hera", "hera comm", "hera"] },
    { name: "Sky Wifi", patterns: ["sky wifi"] },
    {
      name: "E-distribuzione",
      patterns: ["e-distribuzione", "edistribuzione"]
    },
    {
      name: "Acquedotto",
      patterns: [
        "servizio idrico integrato",
        "servizio idrico",
        "acquedotto"
      ]
    }
  ];

  for (const provider of providerMap) {
    if (provider.patterns.some((pattern) => source.includes(pattern))) {
      return provider.name;
    }
  }

  return "";
}

function detectUtilityType(text) {
  const source = ` ${String(text || "").toLowerCase()} `;

  const scores = {
    Luce: 0,
    Gas: 0,
    Acqua: 0,
    Internet: 0,
    Telefono: 0,
    Rifiuti: 0
  };

  const addScore = (type, points, patterns) => {
    patterns.forEach((pattern) => {
      if (pattern.test(source)) {
        scores[type] += points;
      }
    });
  };

  addScore("Luce", 5, [
    /\bpod\b/i,
    /\bkwh\b/i,
    /energia elettrica/i,
    /fornitura elettrica/i,
    /potenza impegnata/i,
    /fascia f1/i,
    /fascia f2/i,
    /fascia f3/i,
    /contatore elettrico/i
  ]);

  addScore("Gas", 5, [
    /\bpdr\b/i,
    /\bsmc\b/i,
    /gas naturale/i,
    /metano/i,
    /coefficiente c/i,
    /potere calorifico/i,
    /contatore gas/i
  ]);

  addScore("Acqua", 5, [
    /servizio idrico/i,
    /acquedotto/i,
    /fognatura/i,
    /depurazione/i,
    /metri cubi acqua/i,
    /consumo idrico/i,
    /utenza idrica/i
  ]);

  addScore("Internet", 5, [
    /\bftth\b/i,
    /\bfttc\b/i,
    /\badsl\b/i,
    /fibra/i,
    /banda larga/i,
    /connessione internet/i,
    /modem/i,
    /router/i
  ]);

  addScore("Telefono", 5, [
    /telefonia mobile/i,
    /telefonia fissa/i,
    /\bsim\b/i,
    /traffico voce/i,
    /numero mobile/i,
    /minuti inclusi/i,
    /\bgiga\b/i
  ]);

  addScore("Rifiuti", 5, [
    /\btari\b/i,
    /tassa rifiuti/i,
    /igiene urbana/i,
    /raccolta rifiuti/i
  ]);

  addScore("Luce", 2, [
    /\bluce\b/i,
    /elettric/i,
    /servizio elettrico/i
  ]);

  addScore("Gas", 2, [
    /\bgas\b/i
  ]);

  addScore("Acqua", 2, [
    /\bacqua\b/i,
    /\bidrico\b/i
  ]);

  const ordered = Object.entries(scores)
    .sort((a, b) => b[1] - a[1]);

  if (!ordered.length || ordered[0][1] === 0) {
    return "";
  }

  if (
    ordered.length > 1 &&
    ordered[0][1] === ordered[1][1]
  ) {
    return "";
  }

  return ordered[0][0];
}

function riconosciTipoDaFornitore(nome) {
  const valore = (nome || "").toLowerCase();

  if (
    valore.includes("servizio elettrico") ||
    valore.includes("e-distribuzione")
  ) {
    return "Luce";
  }

  if (valore.includes("italgas")) {
    return "Gas";
  }

  if (
    valore.includes("acquedotto") ||
    valore.includes("servizio idrico")
  ) {
    return "Acqua";
  }

  if (
    valore.includes("fastweb") ||
    valore.includes("sky wifi")
  ) {
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

  return "";
}

function detectRatePlan(text) {
  const source = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  const lower = source.toLowerCase();

  const hasRateKeywords =
    lower.includes("piano di rientro") ||
    lower.includes("piano rate") ||
    lower.includes("rateizzazione") ||
    lower.includes("pagamento rateale") ||
    lower.includes("numero rata") ||
    lower.includes("scadenza rata");

  const rowRegex =
    /(?:rata\s*)?(\d{1,2})(?:\s*(?:di|\/)\s*\d{1,2})?\s*(?:[-–—:|]\s*)?(?:€\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})\s*(?:€)?\s*(?:[-–—:|]\s*)?(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/gi;

  const rows = [];
  let match;

  while ((match = rowRegex.exec(source)) !== null) {
    rows.push({
      numero: parseInt(match[1], 10),
      importo: formatMoney(parseMoney(match[2])),
      scadenza: convertiDataPerInput(match[3]),
      pagata: false
    });
  }

  const uniqueRows = [];
  const seen = new Set();

  rows.forEach((row) => {
    const key = `${row.numero}-${row.importo}-${row.scadenza}`;

    if (
      row.numero > 0 &&
      row.importo &&
      row.scadenza &&
      !seen.has(key)
    ) {
      seen.add(key);
      uniqueRows.push(row);
    }
  });

  uniqueRows.sort((a, b) => a.numero - b.numero);

  let numeroRate = uniqueRows.length;
  let importoRata = uniqueRows[0]?.importo || "";
  let primaScadenzaRata = uniqueRows[0]?.scadenza || "";

  if (!numeroRate) {
    const numeroMatch =
      source.match(/numero\s+(?:delle\s+)?rate\s*[:\-]?\s*(\d{1,2})/i) ||
      source.match(/totale\s+rate\s*[:\-]?\s*(\d{1,2})/i) ||
      source.match(/(?:in|di)\s+(\d{1,2})\s+rate/i);

    if (numeroMatch) {
      numeroRate = parseInt(numeroMatch[1], 10);
    }
  }

  if (!importoRata) {
    const importoMatch =
      source.match(/importo\s+(?:della\s+)?rata\s*[:\-]?\s*€?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i) ||
      source.match(/rata\s+da\s*€?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i);

    if (importoMatch) {
      importoRata = formatMoney(parseMoney(importoMatch[1]));
    }
  }

  if (!primaScadenzaRata) {
    const firstDeadlineMatch =
      source.match(/prima\s+scadenza(?:\s+rata)?\s*[:\-]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i) ||
      source.match(/scadenza\s+rata\s*[:\-]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i);

    if (firstDeadlineMatch) {
      primaScadenzaRata = convertiDataPerInput(firstDeadlineMatch[1]);
    }
  }

  return {
    rateizzata:
      hasRateKeywords ||
      uniqueRows.length >= 2 ||
      numeroRate >= 2,
    numeroRate,
    importoRata,
    primaScadenzaRata,
    rate: uniqueRows
  };
}

function utilityExists(nome, tipo) {
  return utenze.some((u) => {
    return (
      (u.nome || "").trim().toLowerCase() ===
        (nome || "").trim().toLowerCase() &&
      (u.tipo || "").trim().toLowerCase() ===
        (tipo || "").trim().toLowerCase()
    );
  });
}

function autoCreateUtilitiesFromInvoices() {
  let changed = false;

  fatture.forEach((f) => {
    const nome = (f.fornitore || "").trim();
    const tipo = (
      f.tipoFattura ||
      riconosciTipoDaFornitore(nome) ||
      "Altro"
    ).trim();

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
  const checked =
    document.getElementById("rateizzata").checked;

  document
    .getElementById("rateFields")
    .classList.toggle("hidden", !checked);
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
  const [year, month, day] =
    dateString.split("-").map(Number);

  const result = new Date(year, month - 1, day);
  const originalDay = result.getDate();

  result.setMonth(result.getMonth() + monthsToAdd);

  if (result.getDate() < originalDay) {
    result.setDate(0);
  }

  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, "0");
  const dd = String(result.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function generaPianoRate(
  numeroRate,
  importoRata,
  primaScadenza,
  frequenza
) {
  const rate = [];

  for (let i = 0; i < numeroRate; i++) {
    let dataRata = primaScadenza;

    if (frequenza === "mensile") {
      dataRata = addMonths(primaScadenza, i);
    }

    rate.push({
      numero: i + 1,
      importo: formatMoney(importoRata),
      scadenza: dataRata,
      pagata: false,
      receiptMeta: null
    });
  }

  return rate;
}

function addUtenza() {
  const nome =
    document.getElementById("nomeUtenza").value.trim();

  const tipo =
    document.getElementById("tipoUtenza").value;

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
    `${a.nome} ${a.tipo}`.localeCompare(
      `${b.nome} ${b.tipo}`,
      "it"
    )
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

            <div class="small-text">
              Tipo: ${escapeHtml(u.tipo)}
            </div>

            <div class="small-text">
              Origine:
              ${
                u.origin === "fattura"
                  ? "Creata da fattura"
                  : "Inserita manualmente"
              }
            </div>
          </div>
        </div>
      </div>
    `;

    ul.appendChild(li);
  });
}

async function addFattura() {
  const fornitore =
    document.getElementById("fornitore").value.trim();

  const tipoFattura =
    document.getElementById("tipoFattura").value;

  const scadenza =
    document.getElementById("scadenza").value;

  const importo =
    document.getElementById("importo").value.trim();

  const numeroFattura =
    document.getElementById("numeroFattura").value.trim();

  const periodoFattura =
    document.getElementById("periodoFattura").value.trim();

  const pdfInput =
    document.getElementById("pdf");

  const file = pdfInput.files[0];

  const rateizzata =
    document.getElementById("rateizzata").checked;

  const numeroRate = parseInt(
    document.getElementById("numeroRate").value || "0",
    10
  );

  let importoRata =
    document.getElementById("importoRata").value.trim();

  const primaScadenzaRata =
    document.getElementById("primaScadenzaRata").value;

  const frequenzaRate =
    document.getElementById("frequenzaRate").value;

  if (!fornitore || !scadenza || !importo) {
    alert("Compila almeno fornitore, scadenza e importo.");
    return;
  }

  if (rateizzata) {
    if (
      !numeroRate ||
      numeroRate < 2 ||
      !primaScadenzaRata
    ) {
      alert(
        "Per la rateizzazione devi compilare numero rate e prima scadenza."
      );
      return;
    }

    if (!importoRata) {
      const totale = parseMoney(importo);

      if (!totale) {
        alert(
          "Importo totale non valido per calcolare automaticamente le rate."
        );
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
    detectUtilityType(
      `${fornitore} ${numeroFattura} ${periodoFattura}`
    ) ||
    riconosciTipoDaFornitore(fornitore) ||
    "Altro";

  const rate = rateizzata
    ? generaPianoRate(
        numeroRate,
        parseMoney(importoRata),
        primaScadenzaRata,
        frequenzaRate
      )
    : [];

  fatture.push({
    id,
    fornitore,
    tipoFattura: tipoFinale,
    scadenza,
    importo: formatMoney(parseMoney(importo)),
    numeroFattura,
    periodoFattura,
    pdfMeta,
    pagata: false,
    archiviata: false,
    rateizzata,
    numeroRate: rateizzata ? numeroRate : 0,
    importoRata: rateizzata
      ? formatMoney(parseMoney(importoRata))
      : "",
    primaScadenzaRata: rateizzata
      ? primaScadenzaRata
      : "",
    frequenzaRate: rateizzata
      ? frequenzaRate
      : "",
    rate,
    createdAt: new Date().toISOString()
  });

  saveData();
  refreshAll();
  clearFatturaForm();

  alert("Fattura salvata correttamente.");
}

function hasUnpaidInstallments(f) {
  return (
    Array.isArray(f.rate) &&
    f.rate.some((r) => !r.pagata)
  );
}

function getFilteredFatture() {
  const search = (
    document.getElementById("searchText")?.value || ""
  )
    .trim()
    .toLowerCase();

  const filterMonth =
    document.getElementById("filterMonth")?.value || "";

  const filterYear =
    document.getElementById("filterYear")?.value || "";

  const filterTipo =
    document.getElementById("filterTipo")?.value || "";

  const filterStatus =
    document.getElementById("filterStatus")?.value || "";

  return [...fatture]
    .filter((f) => {
      const date = new Date(`${f.scadenza}T00:00:00`);

      const month = String(
        date.getMonth() + 1
      ).padStart(2, "0");

      const year = String(date.getFullYear());

      const matchesSearch =
        !search ||
        (f.fornitore || "")
          .toLowerCase()
          .includes(search) ||
        (f.numeroFattura || "")
          .toLowerCase()
          .includes(search);

      const matchesMonth =
        !filterMonth || month === filterMonth;

      const matchesYear =
        !filterYear || year === filterYear;

      const matchesTipo =
        !filterTipo ||
        (f.tipoFattura || "") === filterTipo;

      let matchesStatus = true;

      if (filterStatus === "pagata") {
        matchesStatus = !!f.pagata;
      }

      if (filterStatus === "dapagare") {
        matchesStatus = !f.pagata;
      }

      if (filterStatus === "archiviata") {
        matchesStatus = !!f.archiviata;
      }

      if (filterStatus === "rateizzata") {
        matchesStatus = !!f.rateizzata;
      }

      if (filterStatus === "rateizzatadaPagare") {
        matchesStatus =
          !!f.rateizzata &&
          hasUnpaidInstallments(f);
      }

      return (
        matchesSearch &&
        matchesMonth &&
        matchesYear &&
        matchesTipo &&
        matchesStatus
      );
    })
    .sort(
      (a, b) =>
        new Date(`${a.scadenza}T00:00:00`) -
        new Date(`${b.scadenza}T00:00:00`)
    );
}

function renderFatture() {
  const ul = document.getElementById("listaFatture");
  ul.innerHTML = "";

  const fattureOrdinate = getFilteredFatture();

  const filteredCount =
    document.getElementById("filteredCount");

  const filteredTotal =
    document.getElementById("filteredTotal");

  if (filteredCount) {
    filteredCount.textContent = fattureOrdinate.length;
  }

  if (filteredTotal) {
    filteredTotal.textContent = formatMoney(
      fattureOrdinate.reduce(
        (sum, f) => sum + parseMoney(f.importo),
        0
      )
    );
  }

  if (fattureOrdinate.length === 0) {
    ul.innerHTML =
      "<li>Nessuna fattura trovata con i filtri selezionati.</li>";
    return;
  }

  fattureOrdinate.forEach((f) => {
    const originalIndex =
      fatture.findIndex((item) => item.id === f.id);

    const stato =
      f.pagata ? "Pagata" : "Da pagare";

    const badgeClass =
      f.pagata ? "paid" : "pending";

    const badgeArchivio =
      f.archiviata
        ? `<span class="badge archived">Archiviata</span>`
        : "";

    const badgeRate =
      f.rateizzata
        ? `<span class="badge installment">Rateizzata</span>`
        : "";

    const icon = getProviderIcon(f.fornitore);

    const rateHtml =
      f.rateizzata && Array.isArray(f.rate)
        ? `
          <div class="installments-box">
            <strong>Piano rate</strong>

            ${f.rate
              .map((r, idx) => {
                const hasReceipt =
                  Boolean(r.receiptMeta);

                const receiptName =
                  r.receiptMeta?.name || "";

                return `
                  <div class="installment-row">
                    <div class="installment-main">
                      <div class="installment-title">
                        Rata ${r.numero} • € ${escapeHtml(r.importo)}
                      </div>

                      <div class="installment-date-editor">
                        <label for="installment-date-${f.id}-${idx}">
                          Scadenza
                        </label>

                        <input
                          id="installment-date-${f.id}-${idx}"
                          type="date"
                          value="${escapeHtml(r.scadenza)}"
                        />

                        <button
                          class="small-btn edit-btn"
                          onclick="updateInstallmentDate(${originalIndex}, ${idx})"
                        >
                          Salva data
                        </button>
                      </div>

                      <div class="small-text">
                        Stato:
                        <strong>
                          ${r.pagata ? "Pagata" : "Da pagare"}
                        </strong>
                      </div>

                      ${
                        r.dataPagamento
                          ? `
                            <div class="small-text">
                              Data pagamento:
                              ${formatDate(r.dataPagamento)}
                            </div>
                          `
                          : ""
                      }

                      ${
                        hasReceipt
                          ? `
                            <div class="receipt-status">
                              ✅ Ricevuta allegata:
                              <strong>
                                ${escapeHtml(receiptName)}
                              </strong>
                            </div>
                          `
                          : `
                            <div class="receipt-status receipt-missing">
                              Nessuna ricevuta allegata
                            </div>
                          `
                      }

                      <div class="receipt-upload">
                        <label
                          class="receipt-file-label"
                          for="receipt-${f.id}-${idx}"
                        >
                          Ricevuta pagamento
                        </label>

                        <input
                          id="receipt-${f.id}-${idx}"
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp"
                        />

                        <div class="receipt-actions">
                          <button
                            class="small-btn receipt-save-btn"
                            onclick="uploadReceipt(${originalIndex}, ${idx})"
                          >
                            ${
                              hasReceipt
                                ? "Sostituisci ricevuta"
                                : "Salva ricevuta"
                            }
                          </button>

                          ${
                            hasReceipt
                              ? `
                                <button
                                  class="small-btn open-btn"
                                  onclick="openReceipt(${originalIndex}, ${idx})"
                                >
                                  Apri ricevuta
                                </button>

                                <button
                                  class="small-btn delete-btn"
                                  onclick="removeReceipt(${originalIndex}, ${idx})"
                                >
                                  Elimina ricevuta
                                </button>
                              `
                              : ""
                          }
                        </div>
                      </div>
                    </div>

                    <div class="installment-payment-action">
                      ${
                        !r.pagata
                          ? `
                            <button
                              class="small-btn pay-btn"
                              onclick="segnaRataPagata(${originalIndex}, ${idx})"
                            >
                              Segna pagata
                            </button>
                          `
                          : `
                            <span class="paid-installment-label">
                              ✓ Pagata
                            </span>
                          `
                      }
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        `
        : "";

    const li = document.createElement("li");

    li.innerHTML = `
      <div class="bill-header">
        <div class="provider-inline">
          <span class="provider-icon">${icon}</span>

          <div>
            <strong>${escapeHtml(f.fornitore)}</strong>

            <div class="small-text">
              Tipo:
              ${escapeHtml(f.tipoFattura || "-")}
            </div>

            <div class="small-text">
              Scadenza:
              ${formatDate(f.scadenza)}
            </div>
          </div>
        </div>

        <div>
          <span class="badge ${badgeClass}">
            ${stato}
          </span>

          ${badgeArchivio}
          ${badgeRate}
        </div>
      </div>

      <div class="small-text">
        Importo totale:
        € ${escapeHtml(f.importo)}
      </div>

      <div class="small-text">
        Numero fattura:
        ${escapeHtml(f.numeroFattura || "-")}
      </div>

      <div class="small-text">
        Periodo:
        ${escapeHtml(f.periodoFattura || "-")}
      </div>

      <div class="small-text">
        PDF:
        ${escapeHtml(f.pdfMeta?.name || "Non allegato")}
      </div>

      ${
        f.rateizzata
          ? `
            <div class="small-text">
              Rate:
              ${escapeHtml(f.numeroRate)}
              • Importo rata:
              € ${escapeHtml(f.importoRata)}
              • Prima scadenza rata:
              ${formatDate(f.primaScadenzaRata)}
            </div>
          `
          : ""
      }

      ${rateHtml}

      <div class="actions">
        ${
          !f.pagata
            ? `
              <button
                class="small-btn pay-btn"
                onclick="segnaPagata(${originalIndex})"
              >
                Segna bolletta pagata
              </button>
            `
            : ""
        }

        <button
          class="small-btn archive-btn"
          onclick="toggleArchivio(${originalIndex})"
        >
          ${
            f.archiviata
              ? "Togli da archivio"
              : "Archivia"
          }
        </button>

        ${
          f.pdfMeta
            ? `
              <button
                class="small-btn open-btn"
                onclick="apriPDF(${f.id})"
              >
                Apri PDF
              </button>
            `
            : ""
        }

        <button
          class="small-btn delete-btn"
          onclick="deleteFattura(${originalIndex})"
        >
          Elimina
        </button>
      </div>
    `;

    ul.appendChild(li);
  });
}

function applyFilters() {
  renderFatture();
}

function resetFilters(renderNow = true) {
  document.getElementById("searchText").value = "";
  document.getElementById("filterMonth").value = "";
  document.getElementById("filterYear").value = "";
  document.getElementById("filterTipo").value = "";
  document.getElementById("filterStatus").value = "";

  if (renderNow) renderFatture();
}

function populateFilterOptions() {
  const monthSelect =
    document.getElementById("filterMonth");

  const yearSelect =
    document.getElementById("filterYear");

  if (!monthSelect || !yearSelect) return;

  const currentMonth = monthSelect.value;
  const currentYear = yearSelect.value;

  const months = new Set();
  const years = new Set();

  fatture.forEach((f) => {
    if (!f.scadenza) return;

    const d =
      new Date(`${f.scadenza}T00:00:00`);

    if (Number.isNaN(d.getTime())) return;

    months.add(
      String(d.getMonth() + 1).padStart(2, "0")
    );

    years.add(String(d.getFullYear()));
  });

  monthSelect.innerHTML =
    `<option value="">Tutti i mesi</option>`;

  [...months].sort().forEach((m) => {
    monthSelect.innerHTML +=
      `<option value="${m}">${m}</option>`;
  });

  yearSelect.innerHTML =
    `<option value="">Tutti gli anni</option>`;

  [...years].sort().forEach((y) => {
    yearSelect.innerHTML +=
      `<option value="${y}">${y}</option>`;
  });

  monthSelect.value = currentMonth;
  yearSelect.value = currentYear;
}

function renderMonthlyChart() {
  const canvas =
    document.getElementById("monthlyChart");

  if (!canvas || typeof Chart === "undefined") return;

  const map = {};

  fatture.forEach((f) => {
    if (!f.scadenza) return;

    const d =
      new Date(`${f.scadenza}T00:00:00`);

    if (Number.isNaN(d.getTime())) return;

    const key =
      `${d.getFullYear()}-${String(
        d.getMonth() + 1
      ).padStart(2, "0")}`;

    map[key] =
      (map[key] || 0) + parseMoney(f.importo);
  });

  const labels = Object.keys(map).sort();
  const values =
    labels.map((key) => Number(formatMoney(map[key])));

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
      onClick: (_, elements) => {
        if (!elements.length) return;

        const index = elements[0].index;
        const key = labels[index];

        const [year, month] = key.split("-");

        resetFilters(false);

        document.getElementById("filterYear").value = year;
        document.getElementById("filterMonth").value = month;

        showSection("archivio");
        renderFatture();
      },
      plugins: {
        legend: {
          display: true
        }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

function renderUtilityTypeChart() {
  const canvas =
    document.getElementById("utilityTypeChart");

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

    if (!Object.prototype.hasOwnProperty.call(map, tipo)) {
      map[tipo] = 0;
    }

    map[tipo] += parseMoney(f.importo);
  });

  const labels =
    Object.keys(map).filter((key) => map[key] > 0);

  const values =
    labels.map((key) => Number(formatMoney(map[key])));

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
      onClick: (_, elements) => {
        if (!elements.length) return;

        const index = elements[0].index;
        const tipo = labels[index];

        resetFilters(false);
        document.getElementById("filterTipo").value = tipo;

        showSection("archivio");
        renderFatture();
      },
      plugins: {
        legend: {
          position: "bottom"
        }
      }
    }
  });
}

function segnaPagata(index) {
  const fattura = fatture[index];

  if (!fattura) return;

  fattura.pagata = true;

  if (Array.isArray(fattura.rate)) {
    fattura.rate = fattura.rate.map((r) => ({
      ...r,
      pagata: true,
      dataPagamento:
        r.dataPagamento ||
        new Date().toISOString().split("T")[0]
    }));
  }

  saveData();
  refreshAll();
}

function segnaRataPagata(fatturaIndex, rataIndex) {
  const fattura = fatture[fatturaIndex];

  if (!fattura || !Array.isArray(fattura.rate)) {
    return;
  }

  const rata = fattura.rate[rataIndex];

  if (!rata) return;

  rata.pagata = true;
  rata.dataPagamento =
    new Date().toISOString().split("T")[0];

  if (fattura.rate.every((item) => item.pagata)) {
    fattura.pagata = true;
  }

  saveData();
  refreshAll();
}

function toggleArchivio(index) {
  if (!fatture[index]) return;

  fatture[index].archiviata =
    !fatture[index].archiviata;

  saveData();
  refreshAll();
}

async function deleteFattura(index) {
  const conferma = confirm(
    "Vuoi eliminare questa fattura, il PDF e tutte le ricevute?"
  );

  if (!conferma) return;

  const item = fatture[index];

  if (item?.id) {
    await deletePdfFromDB(item.id).catch(() => null);
    await deleteAllInvoiceReceipts(item);
  }

  fatture.splice(index, 1);

  saveData();
  refreshAll();
}

function renderScadenze() {
  const div =
    document.getElementById("scadenze");

  div.innerHTML = "";

  const prossime = fatture
    .filter((f) => !f.pagata && !f.rateizzata)
    .map((f) => ({
      ...f,
      diffGiorni:
        daysDiffFromToday(f.scadenza)
    }))
    .filter((f) => f.diffGiorni <= 10)
    .sort((a, b) => a.diffGiorni - b.diffGiorni);

  if (prossime.length === 0) {
    div.innerHTML = `
      <div class="empty-state">
        Nessuna scadenza imminente nei prossimi 10 giorni.
      </div>
    `;
    return;
  }

  prossime.forEach((f) => {
    let testoGiorni = "";

    if (f.diffGiorni < 0) {
      testoGiorni =
        `Scaduta da ${Math.abs(f.diffGiorni)} giorni`;
    } else if (f.diffGiorni === 0) {
      testoGiorni = "Scade oggi";
    } else {
      testoGiorni =
        `Scade tra ${f.diffGiorni} giorni`;
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

function getAllUnpaidInstallments() {
  const result = [];

  fatture.forEach((f, fatturaIndex) => {
    if (
      f.rateizzata &&
      Array.isArray(f.rate)
    ) {
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
            diffGiorni:
              daysDiffFromToday(r.scadenza)
          });
        }
      });
    }
  });

  return result;
}

function renderRateProssime() {
  const div =
    document.getElementById("rateProssime");

  div.innerHTML = "";

  const rate = getAllUnpaidInstallments()
    .filter((r) => r.diffGiorni <= 10)
    .sort((a, b) => a.diffGiorni - b.diffGiorni);

  if (rate.length === 0) {
    div.innerHTML = `
      <div class="empty-state">
        Nessuna rata imminente nei prossimi 10 giorni.
      </div>
    `;
    return;
  }

  rate.forEach((r) => {
    let testo = "";

    if (r.diffGiorni < 0) {
      testo =
        `Scaduta da ${Math.abs(r.diffGiorni)} giorni`;
    } else if (r.diffGiorni === 0) {
      testo = "Scade oggi";
    } else {
      testo =
        `Scade tra ${r.diffGiorni} giorni`;
    }

    const item = document.createElement("div");
    item.className = "info-item";

    item.innerHTML = `
      <strong>${escapeHtml(r.fornitore)}</strong><br>
      Rata ${r.numeroRata}
      • € ${escapeHtml(r.importo)}<br>
      Data: ${formatDate(r.scadenza)}<br>
      <strong>${testo}</strong>
    `;

    div.appendChild(item);
  });
}

function addAutolettura() {
  const contatore =
    document.getElementById("contatore").value.trim();

  const tipo =
    document.getElementById("tipoContatore").value;

  const data =
    document.getElementById("dataAutolettura").value;

  const nota =
    document.getElementById("notaAutolettura").value.trim();

  if (!contatore || !tipo || !data) {
    alert(
      "Compila contatore, tipo e data autolettura."
    );
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
  const ul =
    document.getElementById("listaAutoletture");

  ul.innerHTML = "";

  if (autoletture.length === 0) {
    ul.innerHTML =
      "<li>Nessuna autolettura salvata.</li>";
    return;
  }

  const lista = [...autoletture].sort(
    (a, b) =>
      new Date(`${a.data}T00:00:00`) -
      new Date(`${b.data}T00:00:00`)
  );

  lista.forEach((a) => {
    const li = document.createElement("li");

    li.innerHTML = `
      <div class="bill-header">
        <div>
          <strong>${escapeHtml(a.contatore)}</strong>

          <div class="small-text">
            Tipo: ${escapeHtml(a.tipo)}
          </div>

          <div class="small-text">
            Data: ${formatDate(a.data)}
          </div>

          <div class="small-text">
            Nota: ${escapeHtml(a.nota || "-")}
          </div>
        </div>
      </div>
    `;

    ul.appendChild(li);
  });
}

function renderAutolettureProssime() {
  const div =
    document.getElementById("autolettureProssime");

  div.innerHTML = "";

  const lista = autoletture
    .map((a) => ({
      ...a,
      diffGiorni:
        daysDiffFromToday(a.data)
    }))
    .filter((a) => a.diffGiorni <= 7)
    .sort((a, b) => a.diffGiorni - b.diffGiorni);

  if (lista.length === 0) {
    div.innerHTML = `
      <div class="empty-state">
        Nessuna autolettura imminente nei prossimi 7 giorni.
      </div>
    `;
    return;
  }

  lista.forEach((a) => {
    let testo = "";

    if (a.diffGiorni < 0) {
      testo =
        `In ritardo di ${Math.abs(a.diffGiorni)} giorni`;
    } else if (a.diffGiorni === 0) {
      testo = "Da fare oggi";
    } else {
      testo =
        `Da fare tra ${a.diffGiorni} giorni`;
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

function raccogliNotifiche() {
  const notifiche = [];

  fatture.forEach((f) => {
    if (!f.pagata && !f.rateizzata) {
      const diff =
        daysDiffFromToday(f.scadenza);

      if (diff < 0) {
        notifiche.push({
          tipo: "danger",
          testo:
            `${f.fornitore}: bolletta scaduta da ` +
            `${Math.abs(diff)} giorni`
        });
      } else if (diff <= 3) {
        notifiche.push({
          tipo: "info",
          testo:
            `${f.fornitore}: bolletta in scadenza il ` +
            `${formatDate(f.scadenza)}`
        });
      }
    }
  });

  getAllUnpaidInstallments().forEach((r) => {
    if (r.diffGiorni < 0) {
      notifiche.push({
        tipo: "danger",
        testo:
          `${r.fornitore}: rata ${r.numeroRata} scaduta da ` +
          `${Math.abs(r.diffGiorni)} giorni`
      });
    } else if (r.diffGiorni <= 3) {
      notifiche.push({
        tipo: "info",
        testo:
          `${r.fornitore}: rata ${r.numeroRata} in scadenza il ` +
          `${formatDate(r.scadenza)}`
      });
    }
  });

  autoletture.forEach((a) => {
    const diff =
      daysDiffFromToday(a.data);

    if (diff < 0) {
      notifiche.push({
        tipo: "danger",
        testo:
          `${a.contatore}: autolettura in ritardo di ` +
          `${Math.abs(diff)} giorni`
      });
    } else if (diff <= 2) {
      notifiche.push({
        tipo: "info",
        testo:
          `${a.contatore}: autolettura da fare il ` +
          `${formatDate(a.data)}`
      });
    }
  });

  return notifiche;
}

function renderNotifiche() {
  const box =
    document.getElementById("notificheBox");

  box.innerHTML = "";

  const notifiche =
    raccogliNotifiche();

  if (notifiche.length === 0) {
    box.innerHTML = `
      <div class="empty-state">
        Nessuna notifica al momento.
      </div>
    `;
    return;
  }

  notifiche.forEach((n) => {
    const div = document.createElement("div");

    div.className =
      n.tipo === "danger"
        ? "danger-item"
        : "info-item";

    div.textContent = n.testo;
    box.appendChild(div);
  });
}

function renderStats() {
  const totalRate =
    fatture.reduce(
      (sum, f) =>
        sum +
        (Array.isArray(f.rate)
          ? f.rate.length
          : 0),
      0
    );

  const totalRateDaPagare =
    fatture.reduce(
      (sum, f) =>
        sum +
        (Array.isArray(f.rate)
          ? f.rate.filter((r) => !r.pagata).length
          : 0),
      0
    );

  document.getElementById("totFatture").textContent =
    fatture.length;

  document.getElementById("totDaPagare").textContent =
    fatture.filter((f) => !f.pagata).length;

  document.getElementById("totPagate").textContent =
    fatture.filter((f) => f.pagata).length;

  document.getElementById("totArchiviate").textContent =
    fatture.filter((f) => f.archiviata).length;

  document.getElementById("totRate").textContent =
    totalRate;

  document.getElementById("totRateDaPagare").textContent =
    totalRateDaPagare;
}

async function leggiPDF() {
  const file =
    document.getElementById("pdf").files[0];

  if (!file) {
    alert("Carica prima un PDF.");
    return;
  }

  try {
    const arrayBuffer =
      await file.arrayBuffer();

    const typedArray =
      new Uint8Array(arrayBuffer);

    const pdf =
      await pdfjsLib.getDocument(typedArray).promise;

    let testoCompleto = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page =
        await pdf.getPage(i);

      const content =
        await page.getTextContent();

      testoCompleto +=
        " " +
        content.items
          .map((item) => item.str)
          .join(" ");
    }

    analizzaTestoPDF(
      testoCompleto,
      file.name
    );
  } catch (error) {
    console.error(
      "Errore lettura PDF:",
      error
    );

    alert(
      "Non sono riuscito a leggere questo PDF. " +
      "Controlla che non sia una scansione fotografica."
    );
  }
}

function analizzaTestoPDF(testo, fileName = "") {
  const testoPulito =
    String(testo || "")
      .replace(/\s+/g, " ")
      .trim();

  const importoPatterns = [
    /totale\s+da\s+pagare\s*[:\-]?\s*€?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i,
    /importo\s+totale\s*[:\-]?\s*€?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i,
    /da\s+pagare\s*[:\-]?\s*€?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i,
    /totale\s*[:\-]?\s*€?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i
  ];

  const scadenzaPatterns = [
    /data\s+di\s+scadenza\s*[:\-]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i,
    /scadenza\s*[:\-]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i,
    /pagare\s+entro\s+il\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i
  ];

  const numeroPatterns = [
    /numero\s+fattura\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /fattura\s+n[°.]?\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /documento\s+n[°.]?\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ];

  const importo =
    trovaMatch(testoPulito, importoPatterns);

  const scadenza =
    trovaMatch(testoPulito, scadenzaPatterns);

  const numeroFattura =
    trovaMatch(testoPulito, numeroPatterns);

  const fornitore =
    detectProvider(testoPulito, fileName);

  const tipoUtenza =
    detectUtilityType(
      `${testoPulito} ${fileName}`
    ) ||
    riconosciTipoDaFornitore(fornitore);

  const pianoRate =
    detectRatePlan(testoPulito);

  if (importo) {
    document.getElementById("importo").value =
      formatMoney(parseMoney(importo));
  }

  if (scadenza) {
    document.getElementById("scadenza").value =
      convertiDataPerInput(scadenza);
  }

  if (numeroFattura) {
    document.getElementById("numeroFattura").value =
      numeroFattura;
  }

  if (fornitore) {
    document.getElementById("fornitore").value =
      fornitore;
  }

  if (tipoUtenza) {
    document.getElementById("tipoFattura").value =
      tipoUtenza;
  }

  if (pianoRate.rateizzata) {
    document.getElementById("rateizzata").checked = true;
    toggleRateFields();

    if (pianoRate.numeroRate >= 2) {
      document.getElementById("numeroRate").value =
        pianoRate.numeroRate;
    }

    if (pianoRate.importoRata) {
      document.getElementById("importoRata").value =
        pianoRate.importoRata;
    }

    if (pianoRate.primaScadenzaRata) {
      document.getElementById("primaScadenzaRata").value =
        pianoRate.primaScadenzaRata;
    }
  }

  const found = [];

  if (fornitore) {
    found.push(`gestore: ${fornitore}`);
  }

  if (tipoUtenza) {
    found.push(`tipo: ${tipoUtenza}`);
  }

  if (importo) {
    found.push(`importo: € ${formatMoney(parseMoney(importo))}`);
  }

  if (scadenza) {
    found.push(`scadenza: ${formatDate(convertiDataPerInput(scadenza))}`);
  }

  if (pianoRate.rateizzata) {
    found.push("piano rate rilevato");
  }

  alert(
    found.length
      ? `Analisi completata.\n\n${found.join("\n")}\n\nControlla i dati prima di salvare.`
      : "Analisi completata, ma non sono stati riconosciuti dati certi."
  );
}

function initDB() {
  return new Promise((resolve, reject) => {
    const request =
      indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database =
        event.target.result;

      if (
        !database.objectStoreNames.contains(PDF_STORE)
      ) {
        database.createObjectStore(
          PDF_STORE,
          { keyPath: "id" }
        );
      }

      if (
        !database.objectStoreNames.contains(RECEIPT_STORE)
      ) {
        database.createObjectStore(
          RECEIPT_STORE,
          { keyPath: "id" }
        );
      }
    };
  });
}

function savePdfToDB(id, file) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(
        new Error("Database non inizializzato")
      );
      return;
    }

    const transaction =
      db.transaction(
        [PDF_STORE],
        "readwrite"
      );

    const store =
      transaction.objectStore(PDF_STORE);

    const request =
      store.put({ id, file });

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

function getPdfFromDB(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(
        new Error("Database non inizializzato")
      );
      return;
    }

    const transaction =
      db.transaction(
        [PDF_STORE],
        "readonly"
      );

    const store =
      transaction.objectStore(PDF_STORE);

    const request =
      store.get(id);

    request.onsuccess = () =>
      resolve(request.result?.file || null);

    request.onerror = () =>
      reject(request.error);
  });
}

function deletePdfFromDB(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve(false);
      return;
    }

    const transaction =
      db.transaction(
        [PDF_STORE],
        "readwrite"
      );

    const store =
      transaction.objectStore(PDF_STORE);

    const request =
      store.delete(id);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function apriPDF(id) {
  try {
    const file =
      await getPdfFromDB(id);

    if (!file) {
      alert(
        "PDF non trovato nell'archivio locale del browser."
      );
      return;
    }

    const url =
      URL.createObjectURL(file);

    window.open(url, "_blank");

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30000);
  } catch (error) {
    console.error(
      "Errore apertura PDF:",
      error
    );

    alert(
      "Non è stato possibile aprire il PDF."
    );
  }
}

function getReceiptId(fatturaId, rataIndex) {
  return `${fatturaId}-${rataIndex}`;
}

function saveReceiptToDB(
  fatturaId,
  rataIndex,
  file
) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(
        new Error("Database non inizializzato")
      );
      return;
    }

    const transaction =
      db.transaction(
        [RECEIPT_STORE],
        "readwrite"
      );

    const store =
      transaction.objectStore(RECEIPT_STORE);

    const receiptId =
      getReceiptId(fatturaId, rataIndex);

    const request =
      store.put({
        id: receiptId,
        fatturaId,
        rataIndex,
        file,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        savedAt: new Date().toISOString()
      });

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

function getReceiptFromDB(
  fatturaId,
  rataIndex
) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(
        new Error("Database non inizializzato")
      );
      return;
    }

    const transaction =
      db.transaction(
        [RECEIPT_STORE],
        "readonly"
      );

    const store =
      transaction.objectStore(RECEIPT_STORE);

    const receiptId =
      getReceiptId(fatturaId, rataIndex);

    const request =
      store.get(receiptId);

    request.onsuccess = () =>
      resolve(request.result || null);

    request.onerror = () =>
      reject(request.error);
  });
}

function deleteReceiptFromDB(
  fatturaId,
  rataIndex
) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve(false);
      return;
    }

    const transaction =
      db.transaction(
        [RECEIPT_STORE],
        "readwrite"
      );

    const store =
      transaction.objectStore(RECEIPT_STORE);

    const receiptId =
      getReceiptId(fatturaId, rataIndex);

    const request =
      store.delete(receiptId);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

async function uploadReceipt(
  fatturaIndex,
  rataIndex
) {
  const fattura =
    fatture[fatturaIndex];

  if (
    !fattura ||
    !Array.isArray(fattura.rate) ||
    !fattura.rate[rataIndex]
  ) {
    alert("Rata non trovata.");
    return;
  }

  const inputId =
    `receipt-${fattura.id}-${rataIndex}`;

  const input =
    document.getElementById(inputId);

  const file =
    input?.files?.[0];

  if (!file) {
    alert(
      "Seleziona prima una foto o un PDF."
    );
    return;
  }

  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    alert(
      "Formato non valido. Usa PDF, JPG, PNG o WebP."
    );
    return;
  }

  const maxSize =
    15 * 1024 * 1024;

  if (file.size > maxSize) {
    alert(
      "Il file non può superare 15 MB."
    );
    return;
  }

  try {
    await saveReceiptToDB(
      fattura.id,
      rataIndex,
      file
    );

    fattura.rate[rataIndex].receiptMeta = {
      name: file.name,
      type: file.type,
      size: file.size,
      savedAt:
        new Date().toISOString()
    };

    saveData();
    renderFatture();

    alert(
      "Ricevuta salvata correttamente."
    );
  } catch (error) {
    console.error(
      "Errore salvataggio ricevuta:",
      error
    );

    alert(
      "Non è stato possibile salvare la ricevuta."
    );
  }
}

async function openReceipt(
  fatturaIndex,
  rataIndex
) {
  const fattura =
    fatture[fatturaIndex];

  if (!fattura) {
    alert("Fattura non trovata.");
    return;
  }

  try {
    const receipt =
      await getReceiptFromDB(
        fattura.id,
        rataIndex
      );

    if (!receipt?.file) {
      alert("Ricevuta non trovata.");
      return;
    }

    const url =
      URL.createObjectURL(receipt.file);

    window.open(url, "_blank");

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30000);
  } catch (error) {
    console.error(
      "Errore apertura ricevuta:",
      error
    );

    alert(
      "Non è stato possibile aprire la ricevuta."
    );
  }
}

async function removeReceipt(
  fatturaIndex,
  rataIndex
) {
  const fattura =
    fatture[fatturaIndex];

  if (
    !fattura ||
    !fattura.rate?.[rataIndex]
  ) {
    alert("Rata non trovata.");
    return;
  }

  const conferma = confirm(
    "Vuoi eliminare la ricevuta allegata a questa rata?"
  );

  if (!conferma) return;

  try {
    await deleteReceiptFromDB(
      fattura.id,
      rataIndex
    );

    fattura.rate[rataIndex].receiptMeta = null;

    saveData();
    renderFatture();

    alert("Ricevuta eliminata.");
  } catch (error) {
    console.error(
      "Errore eliminazione ricevuta:",
      error
    );

    alert(
      "Non è stato possibile eliminare la ricevuta."
    );
  }
}

function updateInstallmentDate(
  fatturaIndex,
  rataIndex
) {
  const fattura =
    fatture[fatturaIndex];

  if (
    !fattura ||
    !fattura.rate?.[rataIndex]
  ) {
    alert("Rata non trovata.");
    return;
  }

  const inputId =
    `installment-date-${fattura.id}-${rataIndex}`;

  const input =
    document.getElementById(inputId);

  const nuovaData =
    input?.value;

  if (!nuovaData) {
    alert("Inserisci una data valida.");
    return;
  }

  fattura.rate[rataIndex].scadenza =
    nuovaData;

  if (rataIndex === 0) {
    fattura.primaScadenzaRata =
      nuovaData;
  }

  saveData();
  refreshAll();

  alert(
    "Scadenza della rata aggiornata."
  );
}

async function deleteAllInvoiceReceipts(fattura) {
  if (
    !fattura ||
    !Array.isArray(fattura.rate)
  ) {
    return;
  }

  await Promise.all(
    fattura.rate.map((_, rataIndex) =>
      deleteReceiptFromDB(
        fattura.id,
        rataIndex
      ).catch(() => null)
    )
  );
}

function esportaBackup() {
  const data = {
    version: 2,
    exportedAt:
      new Date().toISOString(),
    utenze,
    fatture,
    autoletture
  };

  const blob =
    new Blob(
      [JSON.stringify(data, null, 2)],
      { type: "application/json" }
    );

  const url =
    URL.createObjectURL(blob);

  const a =
    document.createElement("a");

  a.href = url;
  a.download = "backup-utenze.json";
  a.click();

  URL.revokeObjectURL(url);
}

function importaBackup() {
  const file =
    document.getElementById("backupFile").files[0];

  if (!file) {
    alert(
      "Seleziona prima un file di backup JSON."
    );
    return;
  }

  const reader =
    new FileReader();

  reader.onload = function (event) {
    try {
      const data =
        JSON.parse(event.target.result);

      if (
        !data ||
        !Array.isArray(data.utenze) ||
        !Array.isArray(data.fatture) ||
        !Array.isArray(data.autoletture)
      ) {
        alert("File backup non valido.");
        return;
      }

      utenze = data.utenze;
      fatture = data.fatture;
      autoletture = data.autoletture;

      normalizeStoredData();
      saveData();
      refreshAll();

      alert(
        "Backup importato correttamente."
      );
    } catch (error) {
      console.error(
        "Errore importazione backup:",
        error
      );

      alert(
        "Errore durante l'importazione del backup."
      );
    }
  };

  reader.readAsText(file);
}

async function richiediPermessoNotifiche() {
  if (!("Notification" in window)) {
    alert(
      "Questo browser non supporta le notifiche."
    );
    return;
  }

  const permission =
    await Notification.requestPermission();

  if (permission === "granted") {
    alert("Notifiche browser attivate.");
  } else {
    alert(
      "Permesso notifiche non concesso."
    );
  }
}

function inviaNotificaBrowser(
  titolo,
  corpo
) {
  if (!("Notification" in window)) return;

  if (Notification.permission !== "granted") {
    return;
  }

  new Notification(titolo, {
    body: corpo
  });
}

function controllaENotificaScadenze(
  forzaManuale = false
) {
  const notifiche =
    raccogliNotifiche();

  const chiaviInviate =
    JSON.parse(
      localStorage.getItem("notificheInviate")
    ) || {};

  const oggi =
    new Date().toISOString().slice(0, 10);

  notifiche.forEach((n) => {
    const key =
      `${oggi}-${n.testo}`;

    if (
      forzaManuale ||
      !chiaviInviate[key]
    ) {
      inviaNotificaBrowser(
        "Promemoria Gestione Utenze",
        n.testo
      );

      chiaviInviate[key] = true;
    }
  });

  localStorage.setItem(
    "notificheInviate",
    JSON.stringify(chiaviInviate)
  );
}

initApp();
