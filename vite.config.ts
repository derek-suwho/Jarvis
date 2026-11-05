import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { bundleBudgetPlugin } from './scripts/check-bundle-budget.mjs';

export default defineConfig({
  // Relative asset paths so the built app loads from file:// inside Electron.
  base: './',
  plugins: [react(), bundleBudgetPlugin()],
  // Electron reads local assets directly; raw-byte budgets cover shipped cost.
  // Avoid compressing every deferred diagram chunk just to report gzip sizes.
  build: { reportCompressedSize: false },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
