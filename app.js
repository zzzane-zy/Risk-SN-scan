const RISK_CSV_URL = "./Risk_SN.csv";

const elements = {
  badge: document.getElementById("csvBadge"),
  status: document.getElementById("status"),
  preview: document.getElementById("preview"),
  cameraStage: document.querySelector(".camera-stage"),
  scanButton: document.getElementById("scanButton"),
  stopButton: document.getElementById("stopButton"),
  checkButton: document.getElementById("checkButton"),
  snInput: document.getElementById("snInput"),
  csvFile: document.getElementById("csvFile"),
  dialog: document.getElementById("resultDialog"),
  resultMark: document.getElementById("resultMark"),
  resultTitle: document.getElementById("resultTitle"),
  resultSn: document.getElementById("resultSn"),
  resultMessage: document.getElementById("resultMessage"),
};

const state = {
  riskSet: new Set(),
  sourceName: "Risk_SN.csv",
  detector: null,
  stream: null,
  scanTimer: 0,
  scanning: false,
  lastScanSn: "",
  lastScanAt: 0,
};

init();

async function init() {
  bindEvents();
  await loadDefaultCsv();
}

function bindEvents() {
  elements.scanButton.addEventListener("click", startCamera);
  elements.stopButton.addEventListener("click", stopCamera);
  elements.checkButton.addEventListener("click", () => checkSn(elements.snInput.value));
  elements.snInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      checkSn(elements.snInput.value);
    }
  });
  elements.csvFile.addEventListener("change", handleCsvUpload);
  window.addEventListener("pagehide", stopCamera);
}

async function loadDefaultCsv() {
  try {
    const response = await fetch(`${RISK_CSV_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    loadRiskCsv(text, "Risk_SN.csv");
  } catch {
    setStatus("Risk_SN.csv not loaded. Choose CSV to continue.", "warn");
  }
}

async function handleCsvUpload(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    loadRiskCsv(text, file.name);
  } catch {
    setStatus("CSV read failed.", "risk");
  }
}

function loadRiskCsv(text, sourceName) {
  const nextSet = new Set();
  for (const row of parseCsv(text)) {
    for (const cell of row) {
      for (const value of extractCsvValues(cell)) {
        nextSet.add(value);
      }
    }
  }

  state.riskSet = nextSet;
  state.sourceName = sourceName;
  elements.badge.textContent = sourceName;
  setStatus(`${sourceName} / ${nextSet.size} valid rows`, nextSet.size > 0 ? "ok" : "warn");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
