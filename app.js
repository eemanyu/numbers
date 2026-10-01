const video=document.getElementById("camera");
const canvas=document.getElementById("canvas");
const result=document.getElementById("result");
const copyButton=document.getElementById("copy");
const cameraStatus=document.getElementById("camera-status");
const ocrStatus=document.getElementById("ocr-status");
let worker;
let recognizing=false;
let lastResult="";

async function startCamera(){
if(!navigator.mediaDevices?.getUserMedia)throw new Error("Este navegador não permite acesso à câmera.");
const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});
video.srcObject=stream;
await video.play();
cameraStatus.textContent="Aponte o número para a área marcada";
}

async function startOCR(){
ocrStatus.textContent="Carregando OCR…";
worker=await Tesseract.createWorker("eng");
await worker.setParameters({tessedit_char_whitelist:"0123456789",tessedit_pageseg_mode:"7"});
ocrStatus.textContent="OCR pronto";
requestAnimationFrame(ocrLoop);
}

function captureRegion(){
const sourceWidth=video.videoWidth,sourceHeight=video.videoHeight;
if(!sourceWidth||!sourceHeight)return false;
const cropX=Math.floor(sourceWidth*.08),cropWidth=Math.floor(sourceWidth*.84);
const cropY=Math.floor(sourceHeight*.35),cropHeight=Math.floor(sourceHeight*.30);
const scale=Math.min(2,1000/cropWidth);
canvas.width=Math.floor(cropWidth*scale);
canvas.height=Math.floor(cropHeight*scale);
const ctx=canvas.getContext("2d",{willReadFrequently:true});
ctx.drawImage(video,cropX,cropY,cropWidth,cropHeight,0,0,canvas.width,canvas.height);
const image=ctx.getImageData(0,0,canvas.width,canvas.height),data=image.data;
for(let i=0;i<data.length;i+=4){
const gray=Math.round(data[i]*.299+data[i+1]*.587+data[i+2]*.114);
data[i]=gray;data[i+1]=gray;data[i+2]=gray;
}
ctx.putImageData(image,0,0);
return true;
}

function extractNumbers(text){return (text.match(/\d+/g)||[]).join(" ");}

async function recognizeFrame(){
if(recognizing||!worker||video.readyState<2)return;
if(!captureRegion())return;
recognizing=true;
try{
const {data:{text}}=await worker.recognize(canvas);
const numbers=extractNumbers(text);
if(numbers&&numbers!==lastResult){lastResult=numbers;result.value=numbers;copyButton.disabled=false;}
}catch(error){console.error("OCR error:",error)}
finally{recognizing=false}
}

async function ocrLoop(){await recognizeFrame();setTimeout(()=>requestAnimationFrame(ocrLoop),250)}

copyButton.addEventListener("click",async()=>{
if(!result.value)return;
try{await navigator.clipboard.writeText(result.value)}
catch{result.focus();result.select();document.execCommand("copy")}
copyButton.textContent="Copiado";
setTimeout(()=>copyButton.textContent="Copiar",1000);
});

async function init(){
try{await startCamera();await startOCR()}
catch(error){
console.error(error);
cameraStatus.textContent=error.name==="NotAllowedError"?"Permita o acesso à câmera para continuar":error.message||"Não foi possível abrir a câmera";
ocrStatus.textContent="Não iniciado";
}
}
window.addEventListener("beforeunload",()=>{video.srcObject?.getTracks().forEach(track=>track.stop());worker?.terminate()});
init();