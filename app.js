/* ===================================================
   Risk SN Check – app.js
   Triple-engine barcode decoder:
     1. Native BarcodeDetector  (Chrome / Edge Android – fastest)
     2. ZBar WASM               (primary fallback – best for 1-D barcodes)
     3. ZXing-js                (secondary fallback – broadest format support)
   =================================================== */

const RISK_CSV_URL = "./Risk_SN.csv";

/**
 * SN format: P + exactly 22 decimal digits = 23 chars total
 * Derived from Risk_SN.csv analysis.
 */
const SN_REGEX = /^P\d{22}$/;

/* CDN libraries – loaded on demand, only when native API is absent */
const ZBAR_CDN  = "https://cdn.jsdelivr.net/npm/zbar-wasm@0.10.1/dist/main.js";
const ZXING_CDN = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";

/* =========================================================
   i18n
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
    loadingEngine:    "正在加载扫码引擎（ZBar + ZXing）…",
    engineZbar:       "ZBar 引擎就绪",
    engineZxing:      "ZBar + ZXing 双引擎就绪",
    engineNative:     "原生扫码引擎就绪",
    engineFailed:     "扫码引擎加载失败，请手动输入 SN。",
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
    loadingEngine:    "Loading barcode engine (ZBar + ZXing)…",
    engineZbar:       "ZBar engine ready",
    engineZxing:      "ZBar + ZXing dual engine ready",
    engineNative:     "Native barcode engine ready",
    engineFailed:     "Barcode engine failed to load. Enter SN manually.",
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

function t(key, ...args) {
  const str = STRINGS[state.lang][key];
  return typeof str === "function" ? str(...args) : (str ?? key);
}

/* =========================================================
   State
   ========================================================= */
const state = {
  riskSet:      new Set(),
  sourceName:   "Risk_SN.csv",
  lang:         "zh",

  /* camera */
  stream:       null,
  scanning:     false,
  cameras:      [],
  cameraIndex:  0,

  /* scan loop */
  scanTimer:    0,
  lastScanSn:   "",
  lastScanAt:   0,

  /* decoder engines */
  detector:     null,  // native BarcodeDetector
  zbarScan:     null,  // zbar-wasm scanImageData function
  zxingReader:  null,  // ZXing MultiFormatReader

  /* shared canvas for ZBar / ZXing frame capture */
  frameCanvas:  null,
  frameCtx:     null,
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
   Init
   ========================================================= */
init();

async function init() {
  // Pre-create shared offscreen canvas
  state.frameCanvas = document.createElement("canvas");
  state.frameCtx    = state.frameCanvas.getContext("2d", { willReadFrequently: true });

  bindEvents();
  applyI18n();
  await loadDefaultCsv();
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
   i18n apply
   ========================================================= */
function applyI18n() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  el.snInput.placeholder = t("inputPlaceholder");
  el.langToggle.textContent = t("langBtn");
  rebuildCameraSelect();
  updateLensBarLabel();
  if (state.riskSet.size > 0) {
    setStatus(t("csvLoaded", state.sourceName, state.riskSet.size), "ok");
  }
}

/* =========================================================
   Decoder engines
   ========================================================= */

/**
 * Engine 1: Native BarcodeDetector (Chrome / Edge Android)
 * Fastest – uses device hardware acceleration.
 */
async function tryLoadNative() {
  if (!("BarcodeDetector" in window)) return false;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const preferred = [
      "code_128","code_39","code_93","qr_code",
      "data_matrix","aztec","pdf417",
      "ean_13","ean_8","upc_a","upc_e","itf",
    ].filter((f) => supported.includes(f));
    state.detector = new window.BarcodeDetector({
      formats: preferred.length > 0 ? preferred : supported,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Engine 2: ZBar WASM (primary JS fallback)
 * Excellent at 1-D barcodes (Code 128, Code 39, EAN…).
 * Uses WebAssembly – loads once, ~300 KB.
 */
async function tryLoadZbar() {
  if (state.zbarScan) return true;
  try {
    // Dynamic ESM import – works because app.js is type="module"
    const mod = await import(/* webpackIgnore: true */ ZBAR_CDN);
    // The package exports scanImageData directly
    if (typeof mod.scanImageData === "function") {
      state.zbarScan = mod.scanImageData;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Engine 3: ZXing-js (secondary JS fallback)
 * Broadest format coverage; pure JS so heavier but universally compatible.
 */
async function tryLoadZxing() {
  if (state.zxingReader) return true;
  if (!window.ZXing) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ZXING_CDN;
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  try {
    state.zxingReader = new window.ZXing.MultiFormatReader();
    const hints = new Map();
    hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      window.ZXing.BarcodeFormat.CODE_128,
      window.ZXing.BarcodeFormat.CODE_39,
      window.ZXing.BarcodeFormat.CODE_93,
      window.ZXing.BarcodeFormat.QR_CODE,
      window.ZXing.BarcodeFormat.DATA_MATRIX,
      window.ZXing.BarcodeFormat.EAN_13,
      window.ZXing.BarcodeFormat.EAN_8,
      window.ZXing.BarcodeFormat.UPC_A,
      window.ZXing.BarcodeFormat.ITF,
      window.ZXing.BarcodeFormat.PDF_417,
    ]);
    hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
    state.zxingReader.setHints(hints);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepare the best available decoder pipeline.
 * Called after camera stream starts (so permission is already granted).
 *
 * Priority:  Native → ZBar (+ZXing async) → ZXing alone
 * ZBar and ZXing are loaded in parallel to minimise wait time.
 */
async function prepareDecoders() {
  state.detector    = null;
  state.zbarScan    = null;
  state.zxingReader = null;

  // ── Try native first ──────────────────────────────────────────────────────
  const hasNative = await tryLoadNative();
  if (hasNative) {
    setStatus(t("engineNative"), "ok");
    return;
  }

  // ── Native unavailable: load ZBar + ZXing in parallel ────────────────────
  setStatus(t("loadingEngine"), "warn");

  const [zbarOk, zxingOk] = await Promise.allSettled([
    tryLoadZbar(),
    tryLoadZxing(),
  ]);

  const gotZbar  = zbarOk.status  === "fulfilled" && zbarOk.value;
  const gotZxing = zxingOk.status === "fulfilled" && zxingOk.value;

  if (!gotZbar && !gotZxing) {
    setStatus(t("engineFailed"), "risk");
    return;
  }

  if (gotZbar && gotZxing) {
    setStatus(t("engineZxing"), "ok");
  } else {
    setStatus(t("engineZbar"), "ok");
  }
}

/* =========================================================
   Shared frame capture helper
   ========================================================= */
function captureFrame() {
  const video = el.preview;
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  const w = video.videoWidth  || 640;
  const h = video.videoHeight || 480;
  if (state.frameCanvas.width  !== w) state.frameCanvas.width  = w;
  if (state.frameCanvas.height !== h) state.frameCanvas.height = h;
  state.frameCtx.drawImage(video, 0, 0, w, h);
  return state.frameCtx.getImageData(0, 0, w, h);
}

/**
 * ZXing decode from already-captured ImageData (synchronous).
 */
function zxingDecodeImageData(imageData) {
  if (!state.zxingReader) return null;
  try {
    const { width: w, height: h } = imageData;
    const lum    = new window.ZXing.RGBLuminanceSource(imageData.data, w, h);
    const bitmap = new window.ZXing.BinaryBitmap(new window.ZXing.HybridBinarizer(lum));
    const result = state.zxingReader.decode(bitmap);
    return result ? result.getText() : null;
  } catch {
    return null; // NotFoundException is normal when no barcode in view
  }
}

/* =========================================================
   Scan loop  –  triple-engine pipeline
   ========================================================= */
async function scanLoop() {
  if (!state.scanning) return;

  let rawValue = null;

  try {
    /* ── Engine 1: Native BarcodeDetector ────────────────────────────── */
    if (state.detector) {
      if (el.preview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await state.detector.detect(el.preview);
        if (codes.length > 0) rawValue = codes[0].rawValue;
      }

    } else {
      /* ── Engines 2 & 3: capture frame ONCE, pass to ZBar then ZXing ── */
      const imageData = captureFrame();
      if (imageData) {

        /* Engine 2: ZBar WASM (fast, excellent for Code-128) */
        if (state.zbarScan && rawValue === null) {
          const symbols = await state.zbarScan(imageData);
          if (symbols && symbols.length > 0) {
            rawValue = symbols[0].decode();
          }
        }

        /* Engine 3: ZXing-js (fallback if ZBar found nothing) */
        if (state.zxingReader && rawValue === null) {
          rawValue = zxingDecodeImageData(imageData);
        }
      }
    }
  } catch { /* ignore per-frame errors */ }

  /* ── Handle decoded value ─────────────────────────────────────────── */
  if (rawValue !== null) {
    const sn = extractValidSn(rawValue);
    if (sn) {
      const now = Date.now();
      const isDuplicate = state.lastScanSn === sn && now - state.lastScanAt < 1800;
      if (!isDuplicate) {
        state.lastScanSn = sn;
        state.lastScanAt = now;
        checkSn(sn, { fromScan: true });
      }
    }
  }

  state.scanTimer = window.setTimeout(scanLoop, 260);
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

    // Re-enumerate now labels are available
    await enumerateCameras();

    // Load decoders (may show a loading status briefly)
    await prepareDecoders();

    // Show CSV row count once engines are ready
    if (state.riskSet.size > 0) {
      setStatus(t("csvLoaded", state.sourceName, state.riskSet.size), "ok");
    }

    scanLoop();
  } catch {
    setStatus(t("cameraPerm"), "risk");
    stopCamera();
  }
}

function stopCamera() {
  window.clearTimeout(state.scanTimer);
  state.scanTimer = 0;
  state.scanning  = false;
  el.scanButton.disabled = false;
  el.stopButton.disabled = true;
  el.cameraStage.classList.remove("is-live");
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  el.preview.srcObject = null;
}

async function restartWithCurrentCamera() {
  window.clearTimeout(state.scanTimer);
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  const cam = state.cameras[state.cameraIndex];
  const constraints = cam?.deviceId
    ? { video: { deviceId: { exact: cam.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }
    : { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    el.preview.srcObject = state.stream;
    await el.preview.play();
    scanLoop();
  } catch {
    setStatus(t("cameraPerm"), "risk");
    stopCamera();
  }
}

/* =========================================================
   Camera enumeration & lens selection
   ========================================================= */
function guessLensName(device, index) {
  const raw = (device.label || "").toLowerCase();
  if (raw.includes("back ultra wide"))   return { name: t("lensWide"),  facing: "environment" };
  if (raw.includes("back telephoto"))    return { name: t("lensTele"),  facing: "environment" };
  if (raw.includes("macro"))             return { name: t("lensUltra"), facing: "environment" };
  if (raw.includes("front") || raw.includes("user") || raw.includes("前"))
    return { name: t("lensFront"), facing: "user" };
  if (raw.includes("ultra") || raw.includes("wide") || raw.includes("广"))
    return { name: t("lensWide"),  facing: "environment" };
  if (raw.includes("tele") || raw.includes("zoom") || raw.includes("telephoto") || raw.includes("长焦"))
    return { name: t("lensTele"),  facing: "environment" };
  if (raw.includes("back") || raw.includes("rear") || raw.includes("environment") || raw.includes("后"))
    return { name: t("lensBack"),  facing: "environment" };
  return { name: t("lensCamera", index + 1), facing: "environment" };
}

async function enumerateCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices     = await navigator.mediaDevices.enumerateDevices();
    const videoDevs   = devices.filter((d) => d.kind === "videoinput");
    state.cameras     = videoDevs.map((d, i) => {
      const { name, facing } = guessLensName(d, i);
      return { deviceId: d.deviceId, label: name, facing };
    });
    const rearIdx = state.cameras.findIndex((c) => c.facing === "environment");
    if (state.cameraIndex === 0 && rearIdx >= 0) state.cameraIndex = rearIdx;
    rebuildCameraSelect();
    updateLensBarLabel();
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
  const cam = state.cameras[state.cameraIndex];
  el.lensLabel.textContent = cam ? cam.label : "—";
  el.lensPrev.disabled = state.cameras.length <= 1;
  el.lensNext.disabled = state.cameras.length <= 1;
}

async function shiftCamera(delta) {
  if (state.cameras.length <= 1) return;
  state.cameraIndex = (state.cameraIndex + delta + state.cameras.length) % state.cameras.length;
  if (el.cameraSelect.options[state.cameraIndex]) {
    el.cameraSelect.selectedIndex = state.cameraIndex;
  }
  updateLensBarLabel();
  if (state.scanning) await restartWithCurrentCamera();
}

async function handleSelectChange() {
  const idx = parseInt(el.cameraSelect.value, 10);
  if (!isNaN(idx) && idx !== state.cameraIndex) {
    state.cameraIndex = idx;
    updateLensBarLabel();
    if (state.scanning) await restartWithCurrentCamera();
  }
}

/* =========================================================
   Tap-to-focus
   ========================================================= */
function handleStageTap(event) {
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
    loadRiskCsv(await response.text(), "Risk_SN.csv");
  } catch {
    setStatus(t("csvNotLoaded"), "warn");
  }
}

async function handleCsvUpload(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    loadRiskCsv(await file.text(), file.name);
  } catch {
    setStatus(t("csvReadFailed"), "risk");
  }
}

function loadRiskCsv(text, sourceName) {
  const nextSet = new Set();
  for (const row of parseCsv(text)) {
    for (const cell of row) {
      for (const value of extractCsvValues(cell)) nextSet.add(value);
    }
  }
  state.riskSet    = nextSet;
  state.sourceName = sourceName;
  el.badge.textContent = sourceName;
  setStatus(
    nextSet.size > 0 ? t("csvLoaded", sourceName, nextSet.size) : t("csvNotLoaded"),
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
      if (quoted && nx === '"') { cell += '"'; i++; } else { quoted = !quoted; }
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
   SN validation & check
   ========================================================= */
function extractValidSn(rawValue) {
  const raw   = String(rawValue ?? "").trim().toUpperCase();
  const match = raw.match(/P\d{22}/);
  if (!match) return "";
  return SN_REGEX.test(match[0]) ? match[0] : "";
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
  if (!sn || !SN_REGEX.test(sn)) {
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
