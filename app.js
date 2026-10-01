const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const result = document.getElementById("result");
const captureButton = document.getElementById("capture-button");

let reading = false;
let barcodeDetector = null;
let barcodeScanActive = false;
let lastBarcode = "";
let lastBarcodeTime = 0;

async function startBarcodeScanner() {
  if (!("BarcodeDetector" in window)) {
    console.log("BarcodeDetector não é suportado neste navegador.");
    return;
  }

  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = supported.filter(format =>
      [
        "aztec",
        "code_128",
        "code_39",
        "code_93",
        "codabar",
        "data_matrix",
        "ean_13",
        "ean_8",
        "itf",
        "pdf417",
        "qr_code",
        "upc_a",
        "upc_e"
      ].includes(format)
    );

    if (!formats.length) return;

    barcodeDetector = new BarcodeDetector({ formats });
    barcodeScanActive = true;

    const scan = async () => {
      if (!barcodeScanActive || !barcodeDetector || video.readyState < 2) {
        if (barcodeScanActive) requestAnimationFrame(scan);
        return;
      }

      try {
        const barcodes = await barcodeDetector.detect(video);

        for (const barcode of barcodes) {
          const value = String(barcode.rawValue || "").trim();

          if (!value) continue;

          // Enquanto o mesmo código continuar diante da câmera,
          // registra apenas uma vez. Depois de 1,5 s ele pode ser lido novamente.
          const now = Date.now();
          if (value !== lastBarcode || now - lastBarcodeTime > 1500) {
            registerNumber(normalizeNumber(value));
            lastBarcode = value;
            lastBarcodeTime = now;
          }
        }
      } catch (error) {
        console.error("Barcode recognition error:", error);
      }

      requestAnimationFrame(scan);
    };

    scan();
  } catch (error) {
    console.error("BarcodeDetector initialization error:", error);
  }
}

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
  startBarcodeScanner();
}

function registerNumber(number) {
  if (!number) return false;

  result.value += (result.value ? "\n" : "") + number;
  result.scrollTop = result.scrollHeight;
  return true;
}

function normalizeNumber(value) {
  return String(value || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 20);
}

function captureFrame() {
  if (!video.videoWidth || !video.videoHeight) return null;

  const width = video.videoWidth;
  const height = video.videoHeight;

  // Envia somente a área marcada no centro da câmera.
  const sx = Math.round(width * 0.20);
  const sy = Math.round(height * 0.36);
  const sw = Math.round(width * 0.60);
  const sh = Math.round(height * 0.28);

  const scale = Math.min(2.2, 1600 / sw);

  canvas.width = Math.max(1, Math.floor(sw * scale));
  canvas.height = Math.max(1, Math.floor(sh * scale));

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(
    video,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL("image/jpeg", 0.78);
}

async function readNumber() {
  if (reading || video.readyState < 2) return;

  reading = true;
  captureButton.disabled = true;
  captureButton.classList.add("reading");

  try {
    const image = captureFrame();

    if (!image) {
      throw new Error("A câmera ainda não está pronta.");
    }

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

    if (number) {
      registerNumber(number);
    }
  } catch (error) {
    console.error("Recognition error:", error);
  } finally {
    reading = false;
    captureButton.disabled = false;
    captureButton.classList.remove("reading");
  }
}

async function init() {
  // O resultado não é salvo: cada recarregamento começa com a lista vazia.
  result.value = "";

  try {
    await startCamera();
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

captureButton.addEventListener("click", readNumber);

// Duplo clique seleciona o número inteiro para facilitar a cópia.
result.addEventListener("dblclick", () => {
  if (!result.value) return;

  result.focus();
  result.select();
});

window.addEventListener("beforeunload", () => {
  video.srcObject?.getTracks().forEach(track => track.stop());
});

init();
