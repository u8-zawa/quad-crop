import { initCamera } from './camera.js';
import { drawQuad } from './overlay.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const captureBtn = document.getElementById('captureBtn');

let worker;

async function init() {
  await initCamera(video);
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;

  worker = new Worker(new URL('./worker/detect.worker.js', import.meta.url));

  // const offscreen = overlay.transferControlToOffscreen();
  // worker.postMessage({ type: 'INIT', canvas: offscreen }, [offscreen]);
  worker.addEventListener('message', (e) => {
    if (e.data.type === 'RESULT' && e.data.quad) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      // 既存の drawQuad を利用
      drawQuad(ctx, e.data.quad);
    }
  });

  requestAnimationFrame(loop);
}

function loop() {
  if (video.readyState >= 2) {
    createImageBitmap(video).then((bmp) => {
      worker.postMessage({ type: 'FRAME', frame: bmp }, [bmp]);
    });
  }
  requestAnimationFrame(loop);
}

worker?.addEventListener('message', (e) => {
  if (e.data.type === 'RESULT' && e.data.quad) {
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    drawQuad(ctx, e.data.quad);
  }
});

captureBtn.addEventListener('click', () => {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'capture.png';
    a.click();
    URL.revokeObjectURL(a.href);
  });
});

init();
