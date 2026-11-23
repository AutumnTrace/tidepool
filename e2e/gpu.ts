import { test, type Page } from '@playwright/test';
import type {} from '../src/debug';

/** Loads the app and skips the current test if there is no usable WebGPU adapter. */
export async function openWithGpu(page: Page, path = './'): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.tidepool !== undefined || document.querySelector('.unsupported') !== null);
  const reason = await page.evaluate(() => {
    if (!window.tidepool) return document.querySelector('.unsupported .reason')?.textContent ?? 'WebGPU unavailable';
    return null;
  });
  if (reason !== null) console.log(`[tidepool] no usable WebGPU adapter, skipping: ${reason}`);
  test.skip(reason !== null, `No usable WebGPU adapter: ${reason}`);
}
