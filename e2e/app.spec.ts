import { expect, test } from '@playwright/test';
import { openWithGpu } from './gpu';
import { decodeState, encodeState, type AppState } from '../src/sim/url-state';
import { fromRows } from '../src/sim/matrix';
import { PRESETS } from '../src/sim/presets';
import { AUTO_COUNT, pickCount } from '../src/sim/probe';

const stateOf = (page: import('@playwright/test').Page) => page.evaluate(() => window.tidepool!.app.state);

test('boots, draws frames and reports no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openWithGpu(page);
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('.panel .wordmark')).toHaveText('tidepool');
  // The HUD only reports a frame rate once frames are actually being drawn.
  await expect(page.locator('.hud')).toContainText(/\d+ fps/, { timeout: 10_000 });
  const info = await page.evaluate(() => ({
    count: window.tidepool!.app.sim.count,
    preset: window.tidepool!.app.presetId,
  }));
  expect(info).toEqual({ count: 65536, preset: 'tidepool' });
  expect(errors).toEqual([]);
});

test('a URL hash round-trips through the running app', async ({ page }) => {
  const wanted: AppState = {
    seed: 4242,
    params: { count: 16384, species: 4, density: 55, force: 7.5, friction: 0.065, beta: 0.22 },
    matrix: fromRows([
      [0.5, -0.25, 0, 1],
      [-1, 0.33, 0.12, -0.07],
      [0.9, 0.01, -0.5, 0.25],
      [0, 0.75, -0.66, 0.1],
    ]),
    speed: 1.5,
    view: { trails: 0.8, glow: 1.25, exposure: 1.6 },
  };
  const hash = encodeState(wanted);
  await openWithGpu(page, `./#${hash}`);

  expect(await stateOf(page)).toEqual(wanted);
  expect(await page.evaluate(() => window.tidepool!.app.sim.count)).toBe(16384);
  // The app rewrites the hash in canonical form; it should be unchanged.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${hash}`);

  // Change something through the UI, then reload: the new state must survive.
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => location.hash)).not.toBe(`#${hash}`);
  const before = await stateOf(page);
  const url = page.url();
  expect(decodeState(new URL(url).hash)).toEqual(before);
  await page.reload();
  await page.waitForFunction(() => window.tidepool !== undefined);
  expect(await stateOf(page)).toEqual(before);
});

test('editing the hash by hand applies the new state', async ({ page }) => {
  await openWithGpu(page);
  await page.evaluate(() => {
    location.hash = '#seed=7&n=32768&k=3';
  });
  await expect.poll(() => page.evaluate(() => window.tidepool!.app.sim.count)).toBe(32768);
  const s = await stateOf(page);
  expect(s.seed).toBe(7);
  expect(s.params.species).toBe(3);
  expect(s.matrix.k).toBe(3);
});

test('number keys load presets and the matrix editor edits the rules', async ({ page }) => {
  await openWithGpu(page);
  await page.keyboard.press('3');
  const cells = PRESETS[2]!;
  await expect.poll(() => page.evaluate(() => window.tidepool!.app.presetId)).toBe(cells.id);
  expect((await stateOf(page)).matrix).toEqual(cells.matrix);
  await expect(page.locator('.matrix-cell')).toHaveCount(9);

  // Drag the top-left cell upwards: attraction goes up, the preset is left behind.
  const cell = page.locator('.matrix-cell').first();
  const box = (await cell.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 6 });
  await page.mouse.move(x, y - 60, { steps: 6 });
  await page.mouse.up();
  const after = await stateOf(page);
  expect(after.matrix.values[0]).toBeGreaterThan(cells.matrix.values[0]!);
  expect(await page.evaluate(() => window.tidepool!.app.presetId)).toBeNull();
});

test('a first visit picks the starting count from a GPU probe, and a reload keeps it', async ({ page }) => {
  // Automated browsers skip the probe unless asked, so the other tests start at the default.
  await openWithGpu(page, './?probe=1', { hardware: true });
  const outcome = await page.evaluate(() => window.tidepool!.probe);
  test.skip(!outcome, 'the probe did not run (no timestamp queries on this adapter)');
  const { timing, count } = outcome!;
  console.log(`[tidepool] probe at ${timing.count}: step ${timing.stepMs.toFixed(3)} ms, draw ${timing.drawMs.toFixed(3)} ms, composite ${timing.fixedMs.toFixed(3)} ms -> ${count}`);
  expect(timing.count).toBe(65536);
  expect(timing.stepMs).toBeGreaterThan(0);
  expect(count).toBe(pickCount(timing));
  expect(count).toBeGreaterThanOrEqual(AUTO_COUNT.min);
  expect(count).toBeLessThanOrEqual(AUTO_COUNT.max);
  await expect.poll(() => page.evaluate(() => window.tidepool!.app.sim.count)).toBe(count);
  expect(await page.evaluate(() => window.tidepool!.app.presetId)).toBe('tidepool');
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(`n=${count}&`);
  if (count !== timing.count) {
    await expect(page.locator('.toast')).toHaveText(`Started with ${count.toLocaleString('en-US')} particles for this GPU. [ and ] change it.`);
  }

  await page.reload();
  await page.waitForFunction(() => window.tidepool !== undefined);
  expect(await page.evaluate(() => window.tidepool!.probe)).toBeUndefined();
  expect(await page.evaluate(() => window.tidepool!.app.sim.count)).toBe(count);
});

test('shows a friendly message when WebGPU is missing', async ({ page }) => {
  // Runs everywhere, GPU or not: hide navigator.gpu before the app loads.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
  });
  await page.goto('./');
  await expect(page.locator('.unsupported h1')).toHaveText('tidepool needs WebGPU');
  await expect(page.locator('.unsupported .reason')).toContainText('navigator.gpu');
  await expect(page.locator('#stage')).toHaveCount(0);
});
