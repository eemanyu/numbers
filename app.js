import { BrowserMultiFormatReader } from "@zxing/browser";

const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const result = document.getElementById("result");

let recognizing = false;
let barcodeDetector = null;
let zxingReader = null;
let zxingControls = null;

let candidate = "";
let candidateHits = 0;
let registeredNumbers = new Set();
let cooldownUntil = 0;

const RECOGNITION_INTERVAL = 650;
const CONFIRMATION_FRAMES = 2;

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador não permite acesso à câmera.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  });

  video.srcObject = stream;
  await video.play();
}

function loadRegisteredNumbers() {
  try {
    const saved = JSON.parse(localStorage.getItem("numbers-registered") || "[]");
    if (Array.isArray(saved)) {
      registeredNumbers = new Set(
        saved.filter(value => typeof value === "string" && /^\d+$/.test(value))
      );
    }
  } catch {
    registeredNumbers = new Set();
  }

  result.value = [...registeredNumbers].join("\n");
}

function saveRegisteredNumbers() {
  localStorage.setItem(
    "numbers-registered",
    JSON.stringify([...registeredNumbers])
  );
}

function registerNumber(number) {
  if (!number || registeredNumbers.has(number)) return false;

  registeredNumbers.add(number);
  result.value += (result.value ? "\n" : "") + number;
  result.scrollTop = result.scrollHeight;
  saveRegisteredNumbers();
  return true;
}

function normalizeNumber(value) {
  return String(value || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 20);
}

function drawTarget() {
  if (!video.videoWidth || !video.videoHeight) return false;

  const width = video.videoWidth;
  const height = video.videoHeight;

  // Crop menor e centralizado para impedir que o modelo tente ler
  // todos os números que aparecem na câmera.
  const sx = Math.round(width * 0.20);
  const sy = Math.round(height * 0.36);
  const sw = Math.round(width * 0.60);
  const sh = Math.round(height * 0.28);

  const scale = Math.min(2.2, 1600 / sw);
  canvas.width = Math.max(1, Math.floor(sw * scale));
  canvas.height = Math.max(1, Math.floor(sh * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  return true;
}

async function setupBarcodeDetector() {
  if (!("BarcodeDetector" in window)) return;

  try {
    const supported = await BarcodeDetector.getSupportedFormats();

    const preferred = [
      "ean_13",
      "ean_8",
      "upc_a",
      "upc_e",
      "code_128",
      "code_39",
      "code_93",
      "itf",
      "codabar"
    ];

    const formats = preferred.filter(format => supported.includes(format));

    barcodeDetector = formats.length
      ? new BarcodeDetector({ formats })
      : new BarcodeDetector();
  } catch (error) {
    console.warn("BarcodeDetector indisponível:", error);
    barcodeDetector = null;
  }
}

async function setupZXingFallback() {
  if (barcodeDetector) return;

  try {
    zxingReader = new BrowserMultiFormatReader();

    zxingControls = await zxingReader.decodeFromVideoElement(
      video,
      decoded => {
        if (!decoded || Date.now() < cooldownUntil) return;

        const number = normalizeNumber(decoded.getText());

        if (number) {
          registerNumber(number);
          candidate = "";
          candidateHits = 0;
          cooldownUntil = Date.now() + 800;
        }
      }
    );
  } catch (error) {
    console.warn("ZXing fallback indisponível:", error);
    zxingReader = null;
    zxingControls = null;
  }
}

async function detectBarcode() {
  if (!barcodeDetector || Date.now() < cooldownUntil) return false;

  try {
    const codes = await barcodeDetector.detect(video);

    if (!codes?.length) return false;

    // Se houver mais de um, usa apenas o código cujo centro
    // estiver mais próximo do centro da câmera.
    const cx = video.videoWidth / 2;
    const cy = video.videoHeight / 2;

    codes.sort((a, b) => {
      const ax = (a.boundingBox?.x || 0) + (a.boundingBox?.width || 0) / 2;
      const ay = (a.boundingBox?.y || 0) + (a.boundingBox?.height || 0) / 2;
      const bx = (b.boundingBox?.x || 0) + (b.boundingBox?.width || 0) / 2;
      const by = (b.boundingBox?.y || 0) + (b.boundingBox?.height || 0) / 2;

      return Math.hypot(ax - cx, ay - cy) - Math.hypot(bx - cx, by - cy);
    });

    const number = normalizeNumber(codes[0].rawValue);

    if (!number) return false;

    registerNumber(number);
    candidate = "";
    candidateHits = 0;
    cooldownUntil = Date.now() + 800;
    return true;
  } catch (error) {
    console.warn("BarcodeDetector error:", error);
    return false;
  }
}

async function recognizeHandwrittenNumber() {
  if (Date.now() < cooldownUntil || !drawTarget()) return;

  const image = canvas.toDataURL("image/jpeg", 0.72);

  const response = await fetch("/api/ler", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ image })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Falha na leitura do número.");
  }

  const data = await response.json();
  const number = normalizeNumber(data.number);

  if (!number) {
    candidate = "";
    candidateHits = 0;
    return;
  }

  if (number === candidate) {
    candidateHits++;
  } else {
    candidate = number;
    candidateHits = 1;
  }

  // Só registra quando dois frames consecutivos concordarem.
  if (candidateHits >= CONFIRMATION_FRAMES) {
    if (registerNumber(number)) {
      cooldownUntil = Date.now() + 900;
    }

    candidate = "";
    candidateHits = 0;
  }
}

async function recognizeFrame() {
  if (recognizing || video.readyState < 2) return;

  recognizing = true;

  try {
    // Código de barras: leitura local, imediata, sem enviar imagem.
    if (await detectBarcode()) return;

    // Handwriting/números impressos: Gemini lê somente o recorte central.
    await recognizeHandwrittenNumber();
  } catch (error) {
    console.error("Recognition error:", error);
    candidate = "";
    candidateHits = 0;
  } finally {
    recognizing = false;
  }
}

async function recognitionLoop() {
  await recognizeFrame();
  setTimeout(() => requestAnimationFrame(recognitionLoop), RECOGNITION_INTERVAL);
}

async function init() {
  try {
    loadRegisteredNumbers();
    await startCamera();
    await setupBarcodeDetector();
    await setupZXingFallback();
    requestAnimationFrame(recognitionLoop);
  } catch (error) {
    console.error(error);

    const message =
      error.name === "NotAllowedError"
        ? "Permita o acesso à câmera para continuar."
        : error.message || "Não foi possível iniciar a câmera.";

    const status = document.createElement("div");
    status.className = "error";
    status.textContent = message;
    document.querySelector(".camera-panel").appendChild(status);
  }
}

window.addEventListener("beforeunload", () => {
  video.srcObject?.getTracks().forEach(track => track.stop());
  zxingControls?.stop?.();
  zxingReader?.reset?.();
});

init();
