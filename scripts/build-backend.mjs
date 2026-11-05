import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltin } from 'node:module';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));

// Bundle TypeScript ahead of launch; Electron loads ordinary CJS without a TS loader.
export async function buildBackend(outDir = resolve(root, 'dist/backend')) {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      lib: { entry: resolve(root, 'desktop/runtime.ts'), formats: ['cjs'], fileName: () => 'storage.cjs' },
      // Native SQLite must resolve in the Electron main process, never in a renderer bundle.
      rollupOptions: { external: (id) => id === 'better-sqlite3' || isBuiltin(id) },
    },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildBackend(process.argv[2] && resolve(process.argv[2]));
}
