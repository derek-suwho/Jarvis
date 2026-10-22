import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the built app loads from file:// inside Electron.
  base: './',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'] },
});
