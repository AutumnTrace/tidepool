/**
 * Measures the real thing: builds the app, serves it, drives Chrome with
 * Playwright and reads the GPU timestamp averages and frame intervals from
 * window.tidepool.bench(). Prints a Markdown table and writes the raw
 * numbers to bench/results.json (or --out).
 *
 *   npm run bench                    # default sizes, headless
 *   npm run bench -- --headed        # real window, vsync-limited frame rate
 *   npm run bench -- --counts 16384,65536 --brute
 *   npm run bench -- --counts 1048576 --preset cells --out bench/cells.json
 *
 * Needs a GPU that Chrome will use for WebGPU.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import type { BenchResult } from '../src/debug.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const counts = option('counts', '16384,65536,262144,1048576').split(',').map(Number);
const preset = option('preset', '');
const warmup = Number(option('warmup', '600'));
const frames = Number(option('frames', '300'));
const out = option('out', 'bench/results.json');
const PORT = 4392;

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !flag('headed'),
  args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

interface Row extends BenchResult {
  method: 'grid' | 'brute';
}

const rows: Row[] = [];
let adapter = '';
try {
  const methods: ('grid' | 'brute')[] = flag('brute') ? ['grid', 'brute'] : ['grid'];
  for (const method of methods) {
    for (const count of counts) {
      // Brute force at a million particles is ~2 s per step; not worth waiting for.
      if (method === 'brute' && count > 1 << 18) continue;
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      const query = method === 'brute' ? '?method=brute' : '';
      await page.goto(`http://localhost:${PORT}/tidepool/${query}#n=${count}`);
      await page.waitForFunction(() => window.tidepool !== undefined, null, { timeout: 30_000 });
      adapter = await page.evaluate(() => {
        const a = window.tidepool!.adapter;
        return [a.vendor, a.architecture, a.description].filter(Boolean).join(' ');
      });
      if (preset) {
        await page.evaluate((id) => {
          const t = window.tidepool!;
          const p = t.presets.find((x) => x.id === id);
          if (p) t.app.applyPreset(p);
        }, preset);
      }
      await page.evaluate(() => document.querySelector('.panel')?.classList.add('collapsed'));
      const result = await page.evaluate(
        (req) => window.tidepool!.bench(req),
        { warmup: method === 'brute' ? Math.min(warmup, 60) : warmup, frames, stepsPerFrame: 1 },
      );
      rows.push({ ...result, method });
      const p = result.passes;
      console.log(
        `${method.padEnd(5)} ${String(count).padStart(8)}  forces ${(p.forces ?? p['brute force'] ?? 0).toFixed(3)} ms  ` +
          `frame ${result.frameMs.toFixed(2)} ms  gpu/frame ${result.gpuFrameMs.toFixed(3)} ms`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}

const sum = (r: Row, names: string[]) => names.reduce((s, n) => s + (r.passes[n] ?? 0), 0);
const fmt = (v: number) => (v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(1));
const table = [
  '| Particles | Method | Sort (clear+count+scan+scatter) | Forces + integrate | Sim step total | Draw + composite | GPU per frame | Frame interval (mean / p95) | Candidates per particle |',
  '|---:|---|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map((r) => {
    const sort = sum(r, ['clear', 'count', 'scan', 'scatter']);
    const forces = sum(r, ['forces', 'brute force']);
    const render = sum(r, ['draw', 'composite']);
    const sortCell = r.method === 'grid' ? `${fmt(sort)} ms` : 'n/a';
    return `| ${r.count.toLocaleString('en-US')} | ${r.method} | ${sortCell} | ${fmt(forces)} ms | ${fmt(sort + forces)} ms | ${fmt(render)} ms | ${fmt(r.gpuFrameMs)} ms | ${r.frameMs.toFixed(2)} / ${r.frameP95Ms.toFixed(2)} ms | ${r.method === 'grid' ? Math.round(r.candidates) : r.count} |`;
  }),
].join('\n');

console.log(`\nAdapter: ${adapter}\nChrome ${browser.version()}, ${flag('headed') ? 'headed' : 'headless'}\n`);
console.log(table);

mkdirSync('bench', { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      adapter,
      chrome: browser.version(),
      mode: flag('headed') ? 'headed' : 'headless',
      preset: preset || 'tidepool',
      warmup,
      frames,
      rows,
    },
    null,
    2,
  ) + '\n',
);
