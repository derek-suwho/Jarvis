import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it('rejects incomplete or contaminated release payloads before packaging', async () => {
  const modulePath = '../scripts/check-package-payload.mjs';
  const { checkPackagePayload } = await import(modulePath);
  const root = mkdtempSync(join(process.cwd(), '.package-payload-'));
  const put = (path: string, content: string | Buffer = 'fixture') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const required = ['electron/main.cjs', 'electron/preload.cjs', 'dist/index.html',
    'dist/backend/storage.cjs', 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'];
  try {
    put('package.json', JSON.stringify({ name: 'jarvis', version: '0.1.0', main: 'electron/main.cjs' }));
    for (const path of required) put(path);
    const nativePath = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
    const native = Buffer.alloc(32);
    native.writeUInt32LE(0xfeedfacf, 0);
    native.writeUInt32LE(0x0100000c, 4);
    put(nativePath, native);
    put('node_modules/better-sqlite3/package.json', JSON.stringify({ main: 'lib/index.js' }));
    put('node_modules/better-sqlite3/lib/index.js');
    put('dist/assets/index.js');
    put('dist/index.html', '<script type="module" src="./assets/index.js"></script>');
    expect(await checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).toMatchObject({ valid: true });
    put('dist/index.html', '<script type="module" src="./assets/index.js"></script><link rel="stylesheet" href="./assets/index.css">');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/missing.*stylesheet/i);
    put('dist/assets/index.css', 'body { color: black; }');
    expect(await checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).toMatchObject({ valid: true });
    put('dist/assets/index.css', '');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/empty.*stylesheet/i);
    put('dist/assets/index.css', 'body { color: black; }');
    put('dist/index.html', '<script type="module" src="./assets/index.js"></script><link href="https://example.com/app.css" rel="stylesheet">');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/invalid.*stylesheet/i);
    put('dist/index.html', '<script type="module" src="./assets/index.js"></script>');
    put('dist/index.html', '<script type="module" src="./assets/index.js"></script><link rel="modulepreload" href="./assets/vendor.js">');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/missing.*modulepreload/i);
    put('dist/assets/vendor.js', 'export const ready = true;');
    expect(await checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).toMatchObject({ valid: true });
    put('dist/assets/vendor.js', '');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/empty.*modulepreload/i);
    put('dist/assets/vendor.js', 'export const ready = true;');
    put('dist/index.html', '<script type="module" src="./assets/index.js"></script><link href="https://example.com/vendor.js" rel="modulepreload">');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/invalid.*modulepreload/i);
    put('dist/index.html', '<script type="module" src="./assets/index.js"></script>');
    rmSync(join(root, 'node_modules/better-sqlite3/lib/index.js'));
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/SQLite.*entry/i);
    put('node_modules/better-sqlite3/lib/index.js');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'x64' })).rejects.toThrow(/native.*target/i);
    const linux = Buffer.alloc(64);
    linux.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    linux.writeUInt16LE(183, 18);
    put(nativePath, linux);
    expect(await checkPackagePayload(root, { platform: 'linux', arch: 'arm64' })).toMatchObject({ valid: true });
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/native.*target/i);
    put(nativePath, native);
    put('dist/index.html', '<script type="module" src="./assets/missing.js"></script>');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/renderer.*missing|missing.*renderer/i);
    put('dist/index.html', '<script type="module" src="./assets/index.js"></script>');
    for (const path of required) {
      rmSync(join(root, path));
      await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/missing|required/i);
      put(path, path === nativePath ? native : path === 'dist/index.html' ? '<script type="module" src="./assets/index.js"></script>' : 'fixture');
    }
    for (const path of ['.env.production', '.ralph/state.json', 'tests/fixture.ts', 'src/App.tsx', '.runtime/session.json']) {
      put(path);
      await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/unexpected/i);
      rmSync(join(root, path.split('/')[0]), { recursive: true });
    }
    put('electron/.env');
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/unexpected/i);
    rmSync(join(root, 'electron/.env'));
    symlinkSync(join(root, 'electron/main.cjs'), join(root, 'electron/alias.cjs'));
    await expect(checkPackagePayload(root, { platform: 'darwin', arch: 'arm64' })).rejects.toThrow(/symbolic link/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
