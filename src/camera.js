export async function initCamera(videoEl) {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
    });
    videoEl.srcObject = stream;
    return new Promise((resolve) => {
        videoEl.onloadedmetadata = () => resolve();
    });
}
