/* ===================================================
   Risk SN Check – app.js
   =================================================== */

const RISK_CSV_URL = "./Risk_SN.csv";

/**
 * SN validation rule (derived from Risk_SN.csv analysis):
 *   P + exactly 22 digits = 23 characters total
 *   Digits only after the leading P
 */
const SN_REGEX = /^P\d{22}$/;

/* =========================================================
   i18n strings
   ========================================================= */
const STRINGS = {
  zh: {
    modeLabel:        "扫描",
    scan:             "扫描",
    stop:             "停止",
    check:            "查询",
    ok:               "确认",
    fallbackHint:     "将P开头SN码置于绿框内",
    instruction:      "将右侧P开头的SN码置于绿框内，其他条码将被忽略。",
    tapFocus:         "点击对焦",
    selectLens:       "选择镜头",
    defaultCam:       "默认后置摄像头",
    lensCamera:       (n) => `摄像头 ${n}`,
    lensBack:         "后置",
    lensFront:        "前置",
    lensWide:         "超广角",
    lensTele:         "长焦",
    lensUltra:        "长焦微距",
    loadingCsv:       "加载 Risk_SN.csv…",
    csvNotLoaded:     "Risk_SN.csv 未加载，请选择 CSV 文件继续。",
    csvReadFailed:    "CSV 读取失败。",
    csvLoaded:        (name, n) => `${name} / ${n} 条有效记录`,
    cameraFailed:     "相机启动失败，请检查权限。",
    cameraPerm:       "请检查相机权限。",
    cameraReady:      "相机就绪。当前浏览器不支持扫码，请手动输入 SN。",
    noResult:         "无结果",
    noContent:        "未检测到可查询的 SN 内容。",
    riskItem:         "风险件",
    riskMsg:          "该SN在风险清单中，请停机复核！",
    noRisk:           "未发现风险",
    noRiskMsg:        "该SN不在风险清单中。",
    manualLabel:      "手动输入 SN",
    inputPlaceholder: "输入 SN / Enter SN",
    langBtn:          "EN",
  },
  en: {
    modeLabel:        "Scan",
    scan:             "Scan",
    stop:             "Stop",
    check:            "Check",
    ok:               "OK",
    fallbackHint:     "Place P-starting SN in the green frame",
    instruction:      "Place the right-side P-starting SN in the green frame. Other barcodes are ignored.",
    tapFocus:         "Tap to focus",
    selectLens:       "Select lens",
    defaultCam:       "Default rear camera",
    lensCamera:       (n) => `Camera ${n}`,
    lensBack:         "Rear",
    lensFront:        "Front",
    lensWide:         "Ultra-wide",
    lensTele:         "Telephoto",
    lensUltra:        "Tele-macro",
    loadingCsv:       "Loading Risk_SN.csv…",
    csvNotLoaded:     "Risk_SN.csv not loaded. Choose CSV to continue.",
    csvReadFailed:    "CSV read failed.",
    csvLoaded:        (name, n) => `${name} / ${n} valid rows`,
    cameraFailed:     "Camera failed.",
    cameraPerm:       "Please check camera permission.",
    cameraReady:      "Camera ready. Enter SN manually in this browser.",
    noResult:         "No result",
    noContent:        "No QR content to check.",
    riskItem:         "Risk item",
    riskMsg:          "This SN is in the risk list. Hold and review.",
    noRisk:           "No risk found",
    noRiskMsg:        "This SN is not in the risk list.",
    manualLabel:      "Manual SN",
    inputPlaceholder: "Enter SN / 输入SN",
    langBtn:          "中",
  },
};

/* =========================================================
   State
   ========================================================= */
const state = {
  riskSet:      new Set(),
  sourceName:   "Risk_SN.csv",
  detector:     null,
  stream:       null,
  scanTimer:    0,
  scanning:     false,
  lastScanSn:   "",
  lastScanAt:   0,
  lang:         "zh",
  cameras:      [],   // array of { deviceId, label, facing }
  cameraIndex:  0,    // current index into state.cameras
};

/* =========================================================
   Elements
   ========================================================= */
const el = {
  badge:         document.getElementById("csvBadge"),
  status:        document.getElementById("status"),
  preview:       document.getElementById("preview"),
  cameraStage:   document.getElementById("cameraStage"),
  scanButton:    document.getElementById("scanButton"),
  stopButton:    document.getElementById("stopButton"),
  checkButton:   document.getElementById("checkButton"),
  snInput:       document.getElementById("snInput"),
  csvFile:       document.getElementById("csvFile"),
  dialog:        document.getElementById("resultDialog"),
  resultMark:    document.getElementById("resultMark"),
  resultTitle:   document.getElementById("resultTitle"),
  resultSn:      document.getElementById("resultSn"),
  resultMessage: document.getElementById("resultMessage"),
  langToggle:    document.getElementById("langToggle"),
  focusRing:     document.getElementById("focusRing"),
  focusHint:     document.getElementById("focusHint"),
  lensBar:       document.getElementById("lensBar"),
  lensLabel:     document.getElementById("lensLabel"),
  lensPrev:      document.getElementById("lensPrev"),
  lensNext:      document.getElementById("lensNext"),
  lensPanel:     document.getElementById("lensPanel"),
  cameraSelect:  document.getElementById("cameraSelect"),
};

/* =========================================================
   i18n
   ========================================================= */
function t(key, ...args) {
  const str = STRINGS[state.lang][key];
  return typeof str === "function" ? str(...args) : (str ?? key);
}

function applyI18n() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  el.snInput.placeholder = t("inputPlaceholder");
  el.langToggle.textContent = t("langBtn");

  // Refresh camera select option labels
  rebuildCameraSelect();

  // Refresh status
  const cur = el.status.textContent.trim();
  const isDefault = [
    STRINGS.zh.loadingCsv, STRINGS.en.loadingCsv,
    STRINGS.zh.csvNotLoaded, STRINGS.en.csvNotLoaded,
  ].map((s) => s.trim()).includes(cur);
  if (isDefault && state.riskSet.size === 0) {
    setStatus(t("loadingCsv"), "");
  }
  if (state.riskSet.size > 0) {
    setStatus(t("csvLoaded", state.sourceName, state.riskSet.size), "ok");
  }

  // Update overlay lens label
  updateLensBarLabel();
}

/* =========================================================
   Init
   ========================================================= */
init();

async function init() {
  bindEvents();
  applyI18n();
  await loadDefaultCsv();
  // Enumerate cameras once (requires a permission prompt on first visit;
  // we enumerate with a short getUserMedia to unlock labels on Safari/iOS)
  await enumerateCameras();
}

/* =========================================================
   Events
   ========================================================= */
function bindEvents() {
  el.scanButton.addEventListener("click",  startCamera);
  el.stopButton.addEventListener("click",  stopCamera);
  el.checkButton.addEventListener("click", () => checkSn(el.snInput.value));
  el.snInput.addEventListener("keydown",   (e) => { if (e.key === "Enter") checkSn(el.snInput.value); });
  el.csvFile.addEventListener("change",    handleCsvUpload);
  el.langToggle.addEventListener("click",  toggleLang);
  el.cameraStage.addEventListener("click", handleStageTap);
  el.lensPrev.addEventListener("click",    () => shiftCamera(-1));
  el.lensNext.addEventListener("click",    () => shiftCamera(+1));
  el.cameraSelect.addEventListener("change", handleSelectChange);
  window.addEventListener("pagehide", stopCamera);
}

function toggleLang() {
  state.lang = state.lang === "zh" ? "en" : "zh";
  applyI18n();
}

/* =========================================================
   Camera enumeration
   ========================================================= */

/**
 * Guess a human-friendly label for a camera device.
 * We use the browser-provided label when available, then fall back
 * to keyword detection (wide / tele / front) or a numbered fallback.
 */
function guessLensName(device, index) {
  const raw = (device.label || "").toLowerCase();

  if (raw.includes("front") || raw.includes("user") || raw.includes("前"))
    return { name: t("lensFront"), facing: "user" };
  if (raw.includes("ultra") || raw.includes("wide") || raw.includes("广"))
    return { name: t("lensWide"), facing: "environment" };
  if (raw.includes("tele") || raw.includes("zoom") || raw.includes("telephoto") || raw.includes("长焦"))
    return { name: t("lensTele"), facing: "environment" };
  if (raw.includes("macro") || raw.includes("微距"))
    return { name: t("lensUltra"), facing: "environment" };
  if (raw.includes("back") || raw.includes("rear") || raw.includes("environment") || raw.includes("后"))
    return { name: t("lensBack"), facing: "environment" };

  // iOS: cameras are labelled "Back Camera", "Back Ultra Wide Camera", etc.
  if (raw.includes("back ultra wide"))   return { name: t("lensWide"),  facing: "environment" };
  if (raw.includes("back telephoto"))    return { name: t("lensTele"),  facing: "environment" };
  if (raw.includes("back"))             return { name: t("lensBack"),  facing: "environment" };

  return { name: t("lensCamera", index + 1), facing: "environment" };
}

async function enumerateCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");

    // Build camera list with friendly names
    state.cameras = videoDevices.map((d, i) => {
      const { name, facing } = guessLensName(d, i);
      return { deviceId: d.deviceId, label: name, facing };
    });

    // Default: prefer first rear camera
    const rearIdx = state.cameras.findIndex((c) => c.facing === "environment");
    state.cameraIndex = rearIdx >= 0 ? rearIdx : 0;

    rebuildCameraSelect();
    updateLensBarLabel();

    // Show lens panel only if we found more than one camera
    el.lensPanel.style.display = state.cameras.length > 1 ? "" : "none";
  } catch {
    el.lensPanel.style.display = "none";
  }
}

function rebuildCameraSelect() {
  const select = el.cameraSelect;
  select.innerHTML = "";

  if (state.cameras.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("defaultCam");
    select.appendChild(opt);
    return;
  }

  state.cameras.forEach((cam, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = cam.label;
    if (idx === state.cameraIndex) opt.selected = true;
    select.appendChild(opt);
  });
}

function updateLensBarLabel() {
  if (state.cameras.length === 0) {
    el.lensLabel.textContent = "—";
    return;
  }
  const cam = state.cameras[state.cameraIndex];
  el.lensLabel.textContent = cam ? cam.label : "—";

  // Disable prev/next if only one camera
  el.lensPrev.disabled = state.cameras.length <= 1;
  el.lensNext.disabled = state.cameras.length <= 1;
}

/* Change camera while live (or just update the selection when stopped) */
async function shiftCamera(delta) {
  if (state.cameras.length <= 1) return;
  state.cameraIndex = (state.cameraIndex + delta + state.cameras.length) % state.cameras.length;

  // Keep select in sync
  if (el.cameraSelect.options[state.cameraIndex]) {
    el.cameraSelect.selectedIndex = state.cameraIndex;
  }
  updateLensBarLabel();

  if (state.scanning) {
    await restartWithCurrentCamera();
  }
}

async function handleSelectChange() {
  const idx = parseInt(el.cameraSelect.value, 10);
  if (!isNaN(idx) && idx !== state.cameraIndex) {
    state.cameraIndex = idx;
    updateLensBarLabel();
    if (state.scanning) {
      await restartWithCurrentCamera();
    }
  }
}

/** Stop current stream and reopen with the selected camera */
async function restartWithCurrentCamera() {
  // Pause scan loop but keep scanning flag
  window.clearTimeout(state.scanTimer);
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }

  const cam = state.cameras[state.cameraIndex];
  const constraints = cam
    ? { video: { deviceId: { exact: cam.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }
    : { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };

  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    el.preview.srcObject = state.stream;
    await el.preview.play();
    // Resume scan loop
    scanLoop();
  } catch {
    setStatus(t("cameraPerm"), "risk");
    stopCamera();
  }
}

/* =========================================================
   Tap-to-focus
   ========================================================= */
function handleStageTap(event) {
  // Ignore taps on the lens-bar buttons
  if (event.target.closest(".lens-bar")) return;
  if (!state.scanning || !state.stream) return;

  const rect = el.cameraStage.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  showFocusRing(x, y);
  tryFocusAt(x / rect.width, y / rect.height);
}

function showFocusRing(x, y) {
  const ring = el.focusRing;
  ring.style.left = `${x}px`;
  ring.style.top  = `${y}px`;
  ring.style.display = "block";
  ring.style.animation = "none";
  void ring.offsetWidth;
  ring.style.animation = "focusPop 0.7s ease forwards";
  clearTimeout(ring._hideTimer);
  ring._hideTimer = setTimeout(() => { ring.style.display = "none"; }, 750);
}

async function tryFocusAt(xNorm, yNorm) {
  if (!state.stream) return;
  const [track] = state.stream.getVideoTracks();
  if (!track) return;
  if (typeof window.ImageCapture !== "undefined") {
    try {
      const capture = new window.ImageCapture(track);
      const caps = await capture.getPhotoCapabilities?.();
      if (caps?.focusMode?.includes("manual")) {
        await track.applyConstraints({
          advanced: [{ focusMode: "manual", pointsOfInterest: [{ x: xNorm, y: yNorm }] }],
        });
        return;
      }
    } catch { /* not supported */ }
  }
  try {
    await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
  } catch { /* silently ignore */ }
}

/* =========================================================
   CSV loading
   ========================================================= */
async function loadDefaultCsv() {
  try {
    const response = await fetch(`${RISK_CSV_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    loadRiskCsv(text, "Risk_SN.csv");
  } catch {
    setStatus(t("csvNotLoaded"), "warn");
  }
}

async function handleCsvUpload(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const text = await file.text();
    loadRiskCsv(text, file.name);
  } catch {
    setStatus(t("csvReadFailed"), "risk");
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
  state.riskSet    = nextSet;
  state.sourceName = sourceName;
  el.badge.textContent = sourceName;
  setStatus(
    nextSet.size > 0
      ? t("csvLoaded", sourceName, nextSet.size)
      : t("csvNotLoaded"),
    nextSet.size > 0 ? "ok" : "warn"
  );
}

/* =========================================================
   CSV parser
   ========================================================= */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (ch === '"') {
      if (quoted && nx === '"') { cell += '"'; i++; }
      else { quoted = !quoted; }
      continue;
    }
    if (ch === "," && !quoted) { row.push(cell); cell = ""; continue; }
    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && nx === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = []; cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

function extractCsvValues(cell) {
  const clean = cell.replace(/^\uFEFF/, "").trim().toUpperCase();
  if (!clean || clean === "SN" || clean === "RISK_SN") return [];
  const matches = clean.match(/P\d{22}/g);
  if (matches) return matches.map(normalizeSn);
  if (/^[A-Z0-9_-]{8,}$/.test(clean)) return [clean];
  return [];
}

/* =========================================================
   Camera start / stop
   ========================================================= */
async function startCamera() {
  if (state.scanning) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus(t("cameraFailed"), "risk");
    return;
  }

  // First call: enumerate cameras (gets real labels after permission granted)
  const cam = state.cameras[state.cameraIndex];
  const constraints = cam?.deviceId
    ? { video: { deviceId: { exact: cam.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }
    : { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };

  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    el.preview.srcObject = state.stream;
    await el.preview.play();
    el.cameraStage.classList.add("is-live");
    state.scanning = true;
    el.scanButton.disabled = true;
    el.stopButton.disabled = false;

    // Re-enumerate now that permission is granted (labels become available)
    await enumerateCameras();

    await prepareDetector();
    if (state.detector) {
      setStatus(t("csvLoaded", state.sourceName, state.riskSet.size), "ok");
      scanLoop();
    } else {
      setStatus(t("cameraReady"), "warn");
    }
  } catch {
    setStatus(t("cameraPerm"), "risk");
    stopCamera();
  }
}

async function prepareDetector() {
  if (!("BarcodeDetector" in window)) { state.detector = null; return; }
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const preferred = [
      "qr_code","code_128","code_39","code_93",
      "data_matrix","aztec","pdf417",
      "ean_13","ean_8","upc_a","upc_e","itf",
    ].filter((f) => supported.includes(f));
    state.detector = new window.BarcodeDetector({
      formats: preferred.length > 0 ? preferred : supported,
    });
  } catch {
    state.detector = null;
  }
}

async function scanLoop() {
  if (!state.scanning || !state.detector) return;
  try {
    if (el.preview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const barcodes = await state.detector.detect(el.preview);
      for (const barcode of barcodes) {
        const sn = extractValidSn(barcode.rawValue);
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
  } catch { /* ignore decode errors */ }
  state.scanTimer = window.setTimeout(scanLoop, 260);
}

function stopCamera() {
  window.clearTimeout(state.scanTimer);
  state.scanTimer = 0;
  state.scanning  = false;
  state.detector  = null;
  el.scanButton.disabled = false;
  el.stopButton.disabled = true;
  el.cameraStage.classList.remove("is-live");
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  el.preview.srcObject = null;
}

/* =========================================================
   SN validation & check
   ========================================================= */
function extractValidSn(rawValue) {
  const raw = String(rawValue ?? "").trim().toUpperCase();
  const match = raw.match(/P\d{22}/);
  if (!match) return "";
  const sn = match[0];
  return SN_REGEX.test(sn) ? sn : "";
}

function normalizeSn(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function checkSn(rawValue, options = {}) {
  if (!rawValue?.trim()) {
    if (!options.fromScan) showNotice(t("noResult"), "", t("noContent"));
    return;
  }
  const sn = extractValidSn(rawValue) || normalizeSn(rawValue);
  if (!sn) {
    if (!options.fromScan) showNotice(t("noResult"), "", t("noContent"));
    return;
  }

  // SN format gate
  if (!SN_REGEX.test(sn)) {
    if (!options.fromScan) showNotice(t("noResult"), sn, t("noContent"));
    return;
  }

  if (state.riskSet.size === 0) {
    setStatus(t("csvNotLoaded"), "warn");
    return;
  }

  el.snInput.value = sn;
  const isRisk = state.riskSet.has(sn);
  if (isRisk) {
    setStatus(t("riskItem"), "risk");
    showResult({ kind: "risk", mark: "RISK", title: t("riskItem"), sn, message: t("riskMsg") });
  } else {
    setStatus(t("noRisk"), "ok");
    showResult({ kind: "ok", mark: "OK", title: t("noRisk"), sn, message: t("noRiskMsg") });
  }
}

/* =========================================================
   UI helpers
   ========================================================= */
function setStatus(message, type = "") {
  el.status.textContent = message;
  el.status.className   = `status-line ${type}`.trim();
}

function showNotice(title, sn, message) {
  showResult({ kind: "", mark: "NOTICE", title, sn, message });
}

function showResult({ kind, mark, title, sn, message }) {
  el.dialog.className          = `result-dialog ${kind}`.trim();
  el.resultMark.textContent    = mark;
  el.resultTitle.textContent   = title;
  el.resultSn.textContent      = sn ? `SN  ${sn}` : "";
  el.resultMessage.textContent = message;
  if (typeof el.dialog.showModal === "function") {
    el.dialog.showModal();
  } else {
    window.alert(`${title}\n${sn ? `SN ${sn}\n` : ""}${message}`);
  }
}
