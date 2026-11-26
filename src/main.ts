import './style.css';
import { initGpu, WebGpuUnavailable } from './gpu/device';
import { App } from './app';
import { installDebugApi } from './debug';
import { PointerControls } from './input';
import { PRESETS } from './sim/presets';
import { probeWanted } from './sim/probe';
import { Panel } from './ui/panel';
import { HelpOverlay, Toast } from './ui/overlays';
import { installShortcuts } from './ui/shortcuts';

function showUnsupported(reason: string): void {
  const box = document.createElement('div');
  box.className = 'unsupported';
  box.innerHTML = `
    <h1>tidepool needs WebGPU</h1>
    <p>It's a particle simulation that runs entirely in GPU compute shaders, and this browser
    didn't hand over a GPU to run them on.</p>
    <p class="reason"></p>
    <p>Current Chrome, Edge, Safari and Firefox all ship WebGPU, though not yet on every OS and
    GPU. If you're on one of those, check that hardware acceleration is switched on and that the
    GPU isn't blocklisted (<code>chrome://gpu</code> in Chromium browsers will say).</p>
    <p><a href="https://github.com/AutumnTrace/tidepool">Source and screenshots on GitHub</a></p>`;
  box.querySelector('.reason')!.textContent = reason;
  document.body.append(box);
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
  // Decided before the app writes its state (count included) into the hash.
  const probe = probeWanted(location.search, location.hash, navigator.webdriver === true);
  let app: App;
  try {
    const gpu = await initGpu();
    app = new App(gpu, canvas);
  } catch (err) {
    canvas.remove();
    showUnsupported(err instanceof WebGpuUnavailable ? err.message : `Startup failed: ${String(err)}`);
    if (!(err instanceof WebGpuUnavailable)) console.error(err);
    return;
  }

  const help = new HelpOverlay();
  const toast = new Toast();
  const copyLink = () => {
    const url = app.link();
    navigator.clipboard?.writeText(url).then(
      () => toast.show('Link copied'),
      () => toast.show('Copy failed; the address bar has the link'),
    );
  };
  const panel = new Panel(app, PRESETS, { copyLink, toggleHelp: () => help.toggle() });
  document.body.append(panel.el, help.el, toast.el);
  new PointerControls(app, canvas);
  installShortcuts(app, {
    presets: PRESETS,
    togglePanel: () => panel.toggle(),
    toggleHelp: (force) => help.toggle(force),
    helpOpen: () => help.open,
    copyLink,
    toast: (m) => toast.show(m),
  });
  app.device.lost.then((info) => {
    if (info.reason !== 'destroyed') toast.show(`GPU device lost: ${info.message}. Reload to continue.`);
  });
  installDebugApi(app);
  app.start();
  if (probe) {
    const outcome = app.probeCount();
    window.tidepool!.probe = outcome;
    void outcome.then((o) => {
      if (o && o.count !== o.timing.count) {
        toast.show(`Started with ${o.count.toLocaleString('en-US')} particles for this GPU. [ and ] change it.`);
      }
    });
  }
}

void main();
