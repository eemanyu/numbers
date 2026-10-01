const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const result = document.getElementById("result");

let worker;
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
  worker = await Tesseract.createWorker("eng");

  // PSM 8 = trata a região como UMA única palavra/número.
  // Isso é intencional: não queremos ler todos os números da câmera.
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    user_defined_dpi: "300",
    classify_bln_numeric_mode: "1"
  });

  requestAnimationFrame(ocrLoop);
}

function drawTarget(mode = "gray") {
  if (!video.videoWidth || !video.videoHeight) return false;

  const width = video.videoWidth;
  const height = video.videoHeight;

  // Região central correspondente à área de mira.
  // Só esta área é enviada ao OCR.
  const sx = Math.round(width * 0.12);
  const sy = Math.round(height * 0.36);
  const sw = Math.round(width * 0.76);
  const sh = Math.round(height * 0.28);

  const scale = Math.min(3, 1800 / sw);
  canvas.width = Math.max(1, Math.floor(sw * scale));
  canvas.height = Math.max(1, Math.floor(sh * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(
      data[i] * 0.299 +
      data[i + 1] * 0.587 +
      data[i + 2] * 0.114
    );

    let value = gray;

    if (mode === "threshold") {
      value = gray > 145 ? 255 : 0;
    } else if (mode === "contrast") {
      value = Math.max(0, Math.min(255, (gray - 128) * 1.8 + 128));
    }

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(image, 0, 0);
  return true;
}

function normalizeOCR(text) {
  return text
    .toUpperCase()
    .replace(/[OQD]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/Z/g, "2")
    .replace(/[S]/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function extractOneNumber(text) {
  const normalized = normalizeOCR(text);
  const matches = normalized.match(/\d+/g) || [];

  // Apenas UMA leitura por ciclo.
  // Se o OCR enxergar vários grupos, usamos somente o primeiro.
  return matches[0] || "";
}

function registerNumber(number) {
  if (!number || registeredNumbers.has(number)) return;

  registeredNumbers.add(number);
  result.value += (result.value ? "\n" : "") + number;
  result.scrollTop = result.scrollHeight;
}

async function recognizeTarget() {
  const readings = [];

  // Duas versões da mesma região aumentam a chance de reconhecer
  // impressão e números escritos à mão.
  for (const mode of ["gray", "contrast", "threshold"]) {
    if (!drawTarget(mode)) continue;

    try {
      const data = await worker.recognize(canvas);
      const number = extractOneNumber(data.data.text);

      if (number) {
        readings.push(number);
      }
    } catch (error) {
      console.error("OCR pass error:", error);
    }
  }

  if (!readings.length) {
    candidate = "";
    candidateHits = 0;
    return;
  }

  // Escolhe a leitura mais repetida nas 3 passagens.
  const counts = new Map();
  for (const value of readings) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  const best = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];

  const number = best[0];
  const hits = best[1];

  // Exige confirmação em mais de uma imagem antes de registrar.
  // Isso reduz bastante falsos positivos enquanto a câmera se move.
  if (number === candidate) {
    candidateHits++;
  } else {
    candidate = number;
    candidateHits = 1;
  }

  if (hits >= 2 && candidateHits >= 2) {
    registerNumber(number);
    candidate = "";
    candidateHits = 0;

    // Pequena pausa depois de registrar para a pessoa tirar o número
    // da mira antes que ele possa ser interpretado novamente.
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function recognizeFrame() {
  if (recognizing || !worker || video.readyState < 2) return;

  recognizing = true;

  try {
    await recognizeTarget();
  } catch (error) {
    console.error("OCR error:", error);
  } finally {
    recognizing = false;
  }
}

async function ocrLoop() {
  await recognizeFrame();
  setTimeout(() => requestAnimationFrame(ocrLoop), 120);
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
        : error.message || "Não foi possível abrir a câmera.";

    const status = document.createElement("div");
    status.className = "error";
    status.textContent = message;
    document.querySelector(".camera-panel").appendChild(status);
  }
}

window.addEventListener("beforeunload", () => {
  video.srcObject?.getTracks().forEach(track => track.stop());
  worker?.terminate();
});

init();