import { PaddleOCR } from "@paddleocr/paddleocr-js";

const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const result = document.getElementById("result");

let ocr;
let recognizing = false;
let candidate = "";
let candidateHits = 0;
const registeredNumbers = new Set();

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

async function startOCR() {
  // PaddleOCR.js roda PP-OCRv5 no navegador.
  // Worker + WASM evita travar a interface durante a inferência.
  // Os headers COOP/COEP do Vercel permitem WASM com threads.
  ocr = await PaddleOCR.create({
    lang: "en",
    ocrVersion: "PP-OCRv5",
    worker: true,
    textDetectionBatchSize: 1,
    textRecognitionBatchSize: 4,
    ortOptions: {
      backend: "wasm",
      wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/",
      numThreads: 2,
      simd: true
    }
  });

  requestAnimationFrame(ocrLoop);
}

function drawTarget() {
  if (!video.videoWidth || !video.videoHeight) return false;

  const width = video.videoWidth;
  const height = video.videoHeight;

  // Só a área central da mira entra no PaddleOCR.
  // Assim ele não tenta ler todos os números que aparecem na câmera.
  const sx = Math.round(width * 0.12);
  const sy = Math.round(height * 0.36);
  const sw = Math.round(width * 0.76);
  const sh = Math.round(height * 0.28);

  const scale = Math.min(2.5, 1800 / sw);
  canvas.width = Math.max(1, Math.floor(sw * scale));
  canvas.height = Math.max(1, Math.floor(sh * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  return true;
}

function normalizeNumber(text) {
  return text
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8")
    .replace(/[^0-9]/g, "");
}

function extractOneNumber(items) {
  const candidates = items
    .map(item => ({
      text: item.text || "",
      score: Number(item.score || 0)
    }))
    .filter(item => item.score >= 0.45)
    .map(item => ({
      number: normalizeNumber(item.text),
      score: item.score
    }))
    .filter(item => item.number.length > 0);

  if (!candidates.length) return "";

  // A mira deve conter um único número.
  // Se o detector encontrar mais de uma linha, usamos a de maior confiança.
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].number;
}

function registerNumber(number) {
  if (!number || registeredNumbers.has(number)) return;

  registeredNumbers.add(number);
  result.value += (result.value ? "\n" : "") + number;
  result.scrollTop = result.scrollHeight;
}

async function recognizeTarget() {
  if (!drawTarget()) return;

  try {
    const [prediction] = await ocr.predict(canvas, {
      textDetLimitSideLen: 960,
      textDetThresh: 0.25,
      textDetBoxThresh: 0.35,
      textDetUnclipRatio: 1.8,
      textRecScoreThresh: 0.35
    });

    const number = extractOneNumber(prediction?.items || []);

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

    // Confirma a mesma leitura em dois ciclos consecutivos.
    if (candidateHits >= 2) {
      registerNumber(number);
      candidate = "";
      candidateHits = 0;

      // Dá tempo para tirar o número da mira.
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error("PaddleOCR error:", error);
  }
}

async function recognizeFrame() {
  if (recognizing || !ocr || video.readyState < 2) return;

  recognizing = true;

  try {
    await recognizeTarget();
  } finally {
    recognizing = false;
  }
}

async function ocrLoop() {
  await recognizeFrame();
  setTimeout(() => requestAnimationFrame(ocrLoop), 80);
}

async function init() {
  try {
    await startCamera();
    await startOCR();
  } catch (error) {
    console.error(error);

    const message =
      error.name === "NotAllowedError"
        ? "Permita o acesso à câmera para continuar."
        : error.message || "Não foi possível iniciar o PaddleOCR.";

    const status = document.createElement("div");
    status.className = "error";
    status.textContent = message;
    document.querySelector(".camera-panel").appendChild(status);
  }
}

window.addEventListener("beforeunload", () => {
  video.srcObject?.getTracks().forEach(track => track.stop());
  ocr?.dispose?.();
});

init();
