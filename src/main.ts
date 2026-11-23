import './style.css';
import { initGpu, WebGpuUnavailable } from './gpu/device';
import { App } from './app';

function showUnsupported(reason: string): void {
  const box = document.createElement('div');
  box.className = 'unsupported';
  box.innerHTML = `
    <h1>tidepool needs WebGPU</h1>
    <p>This is a particle simulation that runs entirely in compute shaders, and this browser
    didn't give it a GPU to talk to.</p>
    <p class="reason"></p>
    <p>Recent Chrome, Edge, Safari and Firefox all ship WebGPU. If you are on one of those, check
    that hardware acceleration is enabled and that your GPU driver isn't blocklisted
    (<code>chrome://gpu</code> will tell you).</p>`;
  box.querySelector('.reason')!.textContent = reason;
  document.body.append(box);
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
  try {
    const gpu = await initGpu();
    const app = new App(gpu, canvas);
    app.start();
  } catch (err) {
    canvas.remove();
    showUnsupported(err instanceof WebGpuUnavailable ? err.message : `Startup failed: ${String(err)}`);
    if (!(err instanceof WebGpuUnavailable)) console.error(err);
  }
}

void main();
