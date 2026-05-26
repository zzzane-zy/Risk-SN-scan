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
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (quoted && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((item) => item.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function extractCsvValues(cell) {
  const clean = cell.replace(/^\uFEFF/, "").trim().toUpperCase();
  if (!clean || clean === "SN" || clean === "RISK_SN") {
    return [];
  }

  const pSnValues = clean.match(/P[A-Z0-9]{8,}/g);
  if (pSnValues) {
    return pSnValues.map(normalizeSn);
  }

  if (/^[A-Z0-9_-]{8,}$/.test(clean)) {
    return [clean];
  }

  return [];
}

async function startCamera() {
  if (state.scanning) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera failed.", "risk");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    elements.preview.srcObject = state.stream;
    await elements.preview.play();
    elements.cameraStage.classList.add("is-live");
    state.scanning = true;
    elements.scanButton.disabled = true;
    elements.stopButton.disabled = false;

    await prepareDetector();
    if (state.detector) {
      setStatus(`${state.sourceName} / ${state.riskSet.size} valid rows`, "ok");
      scanLoop();
    } else {
      setStatus("Camera ready. Enter SN manually in this browser.", "warn");
    }
  } catch {
    setStatus("Please check camera permission.", "risk");
    stopCamera();
  }
}

async function prepareDetector() {
  if (!("BarcodeDetector" in window)) {
    state.detector = null;
    return;
  }

  try {
    const supportedFormats = await window.BarcodeDetector.getSupportedFormats();
    const preferredFormats = [
      "qr_code",
      "code_128",
      "code_39",
      "code_93",
      "data_matrix",
      "aztec",
      "pdf417",
      "ean_13",
      "ean_8",
      "upc_a",
      "upc_e",
      "itf",
    ].filter((format) => supportedFormats.includes(format));

    state.detector = new window.BarcodeDetector({
      formats: preferredFormats.length > 0 ? preferredFormats : supportedFormats,
    });
  } catch {
    state.detector = null;
  }
}

async function scanLoop() {
  if (!state.scanning || !state.detector) {
    return;
  }

  try {
    if (elements.preview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const barcodes = await state.detector.detect(elements.preview);
      for (const barcode of barcodes) {
        const sn = findTargetSn(barcode.rawValue);
        if (sn) {
          const now = Date.now();
          const isDuplicate = state.lastScanSn === sn && now - state.lastScanAt < 1800;
          if (!isDuplicate) {
            state.lastScanSn = sn;
            state.lastScanAt = now;
            checkSn(sn, { fromScan: true });
          }
          break;
        }
      }
    }
  } catch {
    setStatus("No result", "warn");
  }

  state.scanTimer = window.setTimeout(scanLoop, 260);
}

function stopCamera() {
  window.clearTimeout(state.scanTimer);
  state.scanTimer = 0;
  state.scanning = false;
  state.detector = null;
  elements.scanButton.disabled = false;
  elements.stopButton.disabled = true;
  elements.cameraStage.classList.remove("is-live");

  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
  elements.preview.srcObject = null;
}

function checkSn(rawValue, options = {}) {
  const sn = findTargetSn(rawValue) || normalizeSn(rawValue);

  if (!sn) {
    showNotice("No result", "", "No QR content to check.");
    return;
  }

  if (!sn.startsWith("P")) {
    if (!options.fromScan) {
      showNotice("No result", sn, "No QR content to check.");
    }
    return;
  }

  if (state.riskSet.size === 0) {
    setStatus("Risk_SN.csv not loaded. Choose CSV to continue.", "warn");
    return;
  }

  elements.snInput.value = sn;
  const isRisk = state.riskSet.has(sn);
  if (isRisk) {
    setStatus("Risk item", "risk");
    showResult({
      kind: "risk",
      mark: "RISK",
      title: "Risk item",
      sn,
      message: "This SN is in the risk list. Hold and review.",
    });
  } else {
    setStatus("No risk found", "ok");
    showResult({
      kind: "ok",
      mark: "NOTICE",
      title: "No risk found",
      sn,
      message: "This SN is not in the risk list.",
    });
  }
}

function findTargetSn(value) {
  const raw = String(value ?? "").toUpperCase();
  const [match] = raw.match(/P[A-Z0-9]{8,}/g) ?? [];
  return match ? normalizeSn(match) : "";
}

function normalizeSn(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status-line ${type}`.trim();
}

function showNotice(title, sn, message) {
  showResult({
    kind: "",
    mark: "NOTICE",
    title,
    sn,
    message,
  });
}

function showResult({ kind, mark, title, sn, message }) {
  elements.dialog.className = `result-dialog ${kind}`.trim();
  elements.resultMark.textContent = mark;
  elements.resultTitle.textContent = title;
  elements.resultSn.textContent = sn ? `SN ${sn}` : "";
  elements.resultMessage.textContent = message;

  if (typeof elements.dialog.showModal === "function") {
    elements.dialog.showModal();
  } else {
    window.alert(`${title}\n${sn ? `SN ${sn}\n` : ""}${message}`);
  }
}
