const { stat, readFile } = require('node:fs/promises');
const { join } = require('node:path');

// Unsigned engineering artifacts only. Signing requires a separate protected stage.
module.exports = {
  // Fail before native rebuild or artifact generation when the build is incomplete.
  async beforePack({ packager }) {
    let metadata;
    try {
      metadata = JSON.parse(await readFile(join(packager.appDir, 'package.json'), 'utf8'));
    } catch {
      throw new Error('Invalid packaging metadata: readable package.json required');
    }
    if (metadata?.name !== 'jarvis' || typeof metadata.version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version) ||
        metadata.main !== 'electron/main.cjs') {
      throw new Error('Invalid packaging metadata: expected jarvis, a release version, and electron/main.cjs');
    }
    for (const path of ['electron/main.cjs', 'electron/preload.cjs', 'dist/index.html', 'dist/backend/storage.cjs']) {
      const input = await stat(join(packager.appDir, path)).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!input?.isFile() || input.size === 0) {
        throw new Error(`Missing or empty packaging input: ${path}; run npm run build first`);
      }
    }
  },
  appId: 'com.jarvis.desktop',
  productName: 'Jarvis',
  directories: { output: 'release' },
  files: ['package.json', 'electron/**/*.cjs', 'dist/**/*'],
  asar: true,
  asarUnpack: ['node_modules/better-sqlite3/**'],
  npmRebuild: true,
  publish: null,
  mac: {
    category: 'public.app-category.productivity',
    minimumSystemVersion: '12.0',
    identity: null,
    hardenedRuntime: true,
    artifactName: 'Jarvis-${version}-${arch}-unsigned.${ext}',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
  },
};
