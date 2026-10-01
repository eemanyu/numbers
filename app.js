const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const result = document.getElementById("result");

let worker;
let recognizing = false;
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

  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300"
  });

  requestAnimationFrame(ocrLoop);
}

function drawFrame(mode = "gray", sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight) {
  if (!video.videoWidth || !video.videoHeight) return false;

  const scale = Math.min(2.5, 1800 / sw);
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
    } else if (mode === "high-contrast") {
      value = Math.max(0, Math.min(255, (gray - 128) * 1.7 + 128));
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
    .replace(/[OoQ]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/G/g, "6")
    .replace(/B/g, "8");
}

function extractNumbers(text) {
  const normalized = normalizeOCR(text);
  return normalized.match(/\d+/g) || [];
}

function addNumbers(numbers) {
  let changed = false;

  for (const number of numbers) {
    if (!number || registeredNumbers.has(number)) continue;

    registeredNumbers.add(number);
    result.value += (result.value ? "\n" : "") + number;
    changed = true;
  }

  if (changed) {
    result.scrollTop = result.scrollHeight;
  }
}

async function recognizeCurrentFrame() {
  const passes = [];
  const width = video.videoWidth;
  const height = video.videoHeight;

  // 1) Quadro inteiro: encontra números espalhados pela câmera.
  passes.push({ mode: "gray", sx: 0, sy: 0, sw: width, sh: height });

  // 2) Quatro áreas sobrepostas: aumenta a resolução efetiva dos números pequenos.
  const overlap = 0.10;
  const halfW = width / 2;
  const halfH = height / 2;
  const cropW = halfW * (1 + overlap);
  const cropH = halfH * (1 + overlap);

  passes.push(
    { mode: "gray", sx: 0, sy: 0, sw: cropW, sh: cropH },
    { mode: "gray", sx: width - cropW, sy: 0, sw: cropW, sh: cropH },
    { mode: "gray", sx: 0, sy: height - cropH, sw: cropW, sh: cropH },
    { mode: "gray", sx: width - cropW, sy: height - cropH, sw: cropW, sh: cropH },

    // Threshold apenas no quadro inteiro; ajuda em números de baixo contraste.
    { mode: "threshold", sx: 0, sy: 0, sw: width, sh: height }
  );

  const found = [];

  for (const pass of passes) {
    if (!drawFrame(pass.mode, pass.sx, pass.sy, pass.sw, pass.sh)) continue;

    try {
      const resultData = await worker.recognize(canvas);
      found.push(...extractNumbers(resultData.data.text));
    } catch (error) {
      console.error("OCR pass error:", error);
    }
  }

  addNumbers(found);
}

async function recognizeFrame() {
  if (recognizing || !worker || video.readyState < 2) return;

  recognizing = true;

  try {
    await recognizeCurrentFrame();
  } catch (error) {
    console.error("OCR error:", error);
  } finally {
    recognizing = false;
  }
}

async function ocrLoop() {
  await recognizeFrame();

  // O próximo ciclo só começa depois que o anterior termina.
  // Isso evita acumular centenas de reconhecimentos simultâneos no celular.
  setTimeout(() => requestAnimationFrame(ocrLoop), 150);
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