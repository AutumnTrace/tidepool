/**
 * Records the README media from the real app on the real GPU:
 *
 *   docs/media/hero.gif         the animated header
 *   docs/media/<preset>.jpg     stills of a few presets
 *   docs/media/panel.jpg        the UI with the panel open
 *
 * The simulation is paused and stepped by hand between captures, so the GIF
 * plays at a steady rate however long each capture takes. Frames are read
 * back in the same task that rendered them (see captureFrame in debug.ts)
 * and encoded with gifenc against one shared palette, which keeps colours
 * from flickering between frames.
 *
 *   npm run capture
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const PORT = 4393;
const OUT = 'docs/media';

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
mkdirSync(OUT, { recursive: true });

async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/tidepool/#${hash}`);
  await page.waitForFunction(() => window.tidepool !== undefined);
  await page.evaluate(() => {
    window.tidepool!.app.running = false;
  });
}

async function hideChrome(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.panel, .hud, .toast, .pointer-ring { display: none !important; }' });
}

async function advance(page: Page, steps: number): Promise<void> {
  await page.evaluate(async (n) => {
    const app = window.tidepool!.app;
    for (let done = 0; done < n; done += 50) {
      app.advance(Math.min(50, n - done));
      await app.device.queue.onSubmittedWorkDone();
    }
  }, steps);
}

async function presetHash(page: Page, id: string, extra: Record<string, number> = {}): Promise<string> {
  return page.evaluate(
    ({ id, extra }) => {
      const t = window.tidepool!;
      t.app.applyPreset(t.presets.find((p) => p.id === id)!);
      for (const [k, v] of Object.entries(extra)) t.app.setView(k as 'trails', v);
      return t.app.link().split('#')[1]!;
    },
    { id, extra },
  );
}

// ---- hero GIF -------------------------------------------------------------

async function hero(): Promise<void> {
  const W = 512;
  const H = 288;
  const FRAMES = 90;
  const STEPS_PER_FRAME = 3;
  const COLORS = 64;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await open(page, '');
  const hash = await presetHash(page, 'tidepool', { trails: 0.45 });
  await open(page, hash);
  await hideChrome(page);
  // Let the worms form first, then zoom in so they are readable at GIF size.
  // (The first few hundred steps are a dense soup that GIF compresses badly.)
  await page.evaluate(() => {
    const app = window.tidepool!.app;
    app.zoomAt(2.2, 640, 360);
  });
  await advance(page, 700);

  const frames: Uint8Array[] = [];
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((n) => window.tidepool!.app.advance(n), STEPS_PER_FRAME);
    const b64 = await page.evaluate(({ w, h }) => window.tidepool!.captureFrame(w, h), { w: W, h: H });
    const rgba = new Uint8Array(Buffer.from(b64, 'base64'));
    // The composite pass adds half a step of noise to hide banding. GIF's
    // LZW hates noise, and in the near-black water it's invisible anyway,
    // so flatten it before quantising.
    for (let p = 0; p < rgba.length; p += 4) {
      if (rgba[p]! + rgba[p + 1]! + rgba[p + 2]! < 24) rgba[p] = rgba[p + 1] = rgba[p + 2] = 0;
    }
    frames.push(rgba);
  }
  await page.close();

  // One palette from a sample of frames across the clip.
  const sample = new Uint8Array(W * H * 4 * 6);
  for (let k = 0; k < 6; k++) sample.set(frames[Math.floor(((k + 0.5) * FRAMES) / 6)]!, k * W * H * 4);
  // The last palette slot is kept for "same as the previous frame": every
  // pixel whose colour index didn't change becomes transparent, and long
  // runs of one index are exactly what LZW compresses well.
  const palette = quantize(sample, COLORS - 1);
  while (palette.length < COLORS - 1) palette.push([0, 0, 0]);
  const KEEP = palette.length;
  palette.push([0, 0, 0]);
  const gif = GIFEncoder();
  let previous: Uint8Array | null = null;
  for (const rgba of frames) {
    const index = applyPalette(rgba, palette.slice(0, KEEP));
    if (!previous) {
      gif.writeFrame(index, W, H, { palette, delay: 40 });
    } else {
      const delta = new Uint8Array(index.length);
      for (let p = 0; p < index.length; p++) delta[p] = index[p] === previous[p] ? KEEP : index[p]!;
      gif.writeFrame(delta, W, H, { palette, delay: 40, transparent: true, transparentIndex: KEEP });
    }
    previous = index;
  }
  gif.finish();
  const bytes = gif.bytes();
  writeFileSync(`${OUT}/hero.gif`, bytes);
  console.log(`hero.gif: ${FRAMES} frames, ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
}

// ---- stills ---------------------------------------------------------------

async function still(id: string, steps: number, zoom: number, view: Record<string, number> = {}): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  await open(page, '');
  const hash = await presetHash(page, id, view);
  await open(page, hash);
  await hideChrome(page);
  await advance(page, steps);
  await page.evaluate((z) => window.tidepool!.app.zoomAt(z, 600, 337), zoom);
  // Two frames so the zoomed view is what's on screen.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${OUT}/${id}.jpg`, type: 'jpeg', quality: 92 });
  console.log(`${id}.jpg`);
  await page.close();
}

async function panel(): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await open(page, '');
  const hash = await presetHash(page, 'caterpillars');
  await open(page, hash);
  await page.addStyleTag({ content: '.toast { display: none !important; }' });
  await advance(page, 900);
  await page.evaluate(() => {
    const app = window.tidepool!.app;
    app.hud.toggle(true);
    // One step per frame, as on a 60 Hz display at speed 1.
    app.fixedSteps = 1;
    app.togglePause();
  });
  // Hover a matrix cell so the readout explains it, as it would for a visitor.
  await page.locator('.matrix-cell').nth(3).hover();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/panel.jpg`, type: 'jpeg', quality: 92 });
  console.log('panel.jpg');
  await page.close();
}

try {
  await hero();
  if (!process.env.HERO_ONLY) await still('cells', 1500, 1.4);
  if (!process.env.HERO_ONLY) await still('necklaces', 1500, 1.6);
  if (!process.env.HERO_ONLY) await still('rainbow', 1200, 1.3, { trails: 0.6 });
  if (!process.env.HERO_ONLY) await panel();
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}
