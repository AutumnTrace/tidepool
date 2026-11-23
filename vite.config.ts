import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/tidepool/',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
