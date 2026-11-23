import { defineConfig } from '@playwright/test';

const PORT = 4391;

/**
 * The tests drive the real Chrome install (channel: 'chrome') so they get
 * the machine's actual GPU. Where Chrome can't get a WebGPU adapter, as on
 * most CI runners, the GPU tests skip themselves with a message instead of
 * failing.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/tidepool/`,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--enable-unsafe-webgpu'] },
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/tidepool/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
