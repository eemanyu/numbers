const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const result = document.getElementById("result");
const copyButton = document.getElementById("copy");
const cameraStatus = document.getElementById("camera-status");
const ocrStatus = document.getElementById("ocr-status");

let worker;
let recognizing = false;
let lastResult = "";

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
  cameraStatus.textContent = "Aponte a câmera para os números";
}

async function startOCR() {
  ocrStatus.textContent = "Carregando OCR…";

  worker = await Tesseract.createWorker("eng");

  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300"
  });

  ocrStatus.textContent = "OCR pronto";
  requestAnimationFrame(ocrLoop);
}

function prepareFrame(mode = "gray") {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!sourceWidth || !sourceHeight) return false;

  // Processa TODA a imagem da câmera, não apenas a caixa central.
  const scale = Math.min(2, 1600 / sourceWidth);

  canvas.width = Math.floor(sourceWidth * scale);
  canvas.height = Math.floor(sourceHeight * scale);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(
      data[i] * 0.299 +
      data[i + 1] * 0.587 +
      data[i + 2] * 0.114
    );

    if (mode === "threshold") {
      const value = gray > 145 ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    } else {
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  }

  ctx.putImageData(image, 0, 0);
  return true;
}

function normalizeOCR(text) {
  return text
    .replace(/[OoQ]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function extractNumbers(text) {
  const normalized = normalizeOCR(text);
  return (normalized.match(/\d+/g) || []).join(" ");
}

function mergeResults(results) {
  const values = results
    .map(extractNumbers)
    .filter(Boolean);

  if (!values.length) return "";

  // Mantém todas as sequências encontradas pelas diferentes
  // pré-processamentos, removendo apenas duplicatas exatas.
  return [...new Set(values.join(" ").split(/\s+/).filter(Boolean))].join(" ");
}

async function recognizeFrame() {
  if (recognizing || !worker || video.readyState < 2) return;

  recognizing = true;

  try {
    const recognized = [];

    // Primeira passada: imagem em tons de cinza.
    if (prepareFrame("gray")) {
      const first = await worker.recognize(canvas);
      recognized.push(first.data.text);
    }

    // Segunda passada: alto contraste/threshold.
    // Isso recupera números que o primeiro processamento perde.
    if (prepareFrame("threshold")) {
      const second = await worker.recognize(canvas);
      recognized.push(second.data.text);
    }

    const numbers = mergeResults(recognized);

    if (numbers && numbers !== lastResult) {
      lastResult = numbers;
      result.value = numbers;
      copyButton.disabled = false;
    }
  } catch (error) {
    console.error("OCR error:", error);
  } finally {
    recognizing = false;
  }
}

async function ocrLoop() {
  await recognizeFrame();
  setTimeout(() => requestAnimationFrame(ocrLoop), 100);
}

copyButton.addEventListener("click", async () => {
  if (!result.value) return;

  try {
    await navigator.clipboard.writeText(result.value);
  } catch {
    result.focus();
    result.select();
    document.execCommand("copy");
  }

  copyButton.textContent = "Copiado";
  setTimeout(() => {
    copyButton.textContent = "Copiar";
  }, 1000);
});

async function init() {
  try {
    await startCamera();
    await startOCR();
  } catch (error) {
    console.error(error);

    cameraStatus.textContent =
      error.name === "NotAllowedError"
        ? "Permita o acesso à câmera para continuar"
        : error.message || "Não foi possível abrir a câmera";

    ocrStatus.textContent = "Não iniciado";
  }
}

window.addEventListener("beforeunload", () => {
  video.srcObject?.getTracks().forEach(track => track.stop());
  worker?.terminate();
});

init();