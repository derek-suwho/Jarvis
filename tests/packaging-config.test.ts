import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { expect, it } from 'vitest';

it('defines an unsigned, non-publishing macOS package with native SQLite outside asar', () => {
  const require = createRequire(import.meta.url);
  const config = require('../config/electron-builder.cjs');
  expect(config.appId).toBe('com.jarvis.desktop');
  expect(config.productName).toBe('Jarvis');
  expect(config.directories.output).toBe('release');
  expect(config.asar).toBe(true);
  expect(config.asarUnpack).toContain('node_modules/better-sqlite3/**');
  expect(config.npmRebuild).toBe(true);
  expect(config.publish).toBeNull();
  expect(config.files).toEqual(['package.json', 'electron/**/*.cjs', 'dist/**/*']);
  expect(config.mac).toMatchObject({
    category: 'public.app-category.productivity', minimumSystemVersion: '12.0',
    identity: null, hardenedRuntime: true,
    artifactName: 'Jarvis-${version}-${arch}-unsigned.${ext}',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }, { target: 'zip', arch: ['arm64', 'x64'] }],
  });
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(pkg.scripts['package:mac:unsigned']).toBe('npm run build && electron-builder --config config/electron-builder.cjs --mac --publish never');
});

it('refuses packaging when a required production build output is missing or empty', async () => {
  const config = createRequire(import.meta.url)('../config/electron-builder.cjs');
  const root = mkdtempSync(join(process.cwd(), '.package-payload-preflight-'));
  const required = ['electron/main.cjs', 'electron/preload.cjs', 'dist/index.html', 'dist/backend/storage.cjs'];
  const put = (path: string, content = 'fixture') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const context = { packager: { appDir: root } };
  try {
    for (const path of required) put(path);
    put('package.json', JSON.stringify({ name: 'jarvis', version: '0.1.0', main: 'electron/main.cjs' }));
    await expect(config.beforePack(context)).resolves.toBeUndefined();
    for (const path of required) {
      rmSync(join(root, path));
      await expect(config.beforePack(context)).rejects.toThrow(/missing or empty packaging input/i);
      put(path, '');
      await expect(config.beforePack(context)).rejects.toThrow(/missing or empty packaging input/i);
      put(path);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


it('stops packaging when application metadata cannot identify the runnable release', async () => {
  const config = createRequire(import.meta.url)('../config/electron-builder.cjs');
  const root = mkdtempSync(join(process.cwd(), '.package-payload-metadata-'));
  const metadata = { name: 'jarvis', version: '0.1.0', main: 'electron/main.cjs' };
  try {
    for (const path of ['electron/main.cjs', 'electron/preload.cjs', 'dist/index.html', 'dist/backend/storage.cjs']) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), 'fixture');
    }
    for (const value of [
      '{', JSON.stringify({ ...metadata, name: 'other' }),
      JSON.stringify({ ...metadata, version: 'latest' }),
      JSON.stringify({ ...metadata, main: 'missing.cjs' }),
    ]) {
      writeFileSync(join(root, 'package.json'), value);
      await expect(config.beforePack({ packager: { appDir: root } })).rejects.toThrow(/invalid packaging metadata/i);
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify(metadata));
    await expect(config.beforePack({ packager: { appDir: root } })).resolves.toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
