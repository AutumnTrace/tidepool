import { test, type Page } from '@playwright/test';
import type {} from '../src/debug';

interface OpenOptions {
  /**
   * Also skip on software adapters (SwiftShader, llvmpipe and other fallback
   * adapters). Hosted CI runners expose one: the app boots and draws on it, but
   * long compute-and-readback sequences lose the device there. Set
   * TIDEPOOL_E2E_SOFTWARE_GPU=1 to run these tests on a software adapter anyway.
   */
  hardware?: boolean;
}

const SOFTWARE_ADAPTER = /swiftshader|llvmpipe|lavapipe|software|warp/i;

/** Loads the app and skips the current test if there is no usable WebGPU adapter. */
export async function openWithGpu(page: Page, path = './', options: OpenOptions = {}): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.tidepool !== undefined || document.querySelector('.unsupported') !== null);
  const found = await page.evaluate(() => {
    if (!window.tidepool) {
      return { reason: document.querySelector('.unsupported .reason')?.textContent ?? 'WebGPU unavailable' };
    }
    const { vendor, architecture, description, isFallback } = window.tidepool.adapter;
    return { reason: null, adapter: `${vendor} ${architecture} ${description}`.trim(), isFallback };
  });

  let reason = found.reason;
  if (
    reason === null &&
    options.hardware &&
    process.env.TIDEPOOL_E2E_SOFTWARE_GPU !== '1' &&
    (found.isFallback || SOFTWARE_ADAPTER.test(found.adapter ?? ''))
  ) {
    reason = `software adapter (${found.adapter || 'fallback'})`;
  }
  if (reason !== null) console.log(`[tidepool] skipping, no hardware WebGPU adapter: ${reason}`);
  test.skip(reason !== null, `No usable WebGPU adapter: ${reason}`);
}
