import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Input is the staging directory (or extracted app.asar contents), not an .app.
// This checks payload structure only; native ABI and launch need packaged smoke.
export async function checkPackagePayload(directory, { platform = process.platform, arch = process.arch } = {}) {
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory()) throw new Error('Expected payload directory');
  const allowedRoots = new Set(['package.json', 'electron', 'dist', 'node_modules']);
  const files = new Set();
  async function walk(relative = '') {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const stat = await lstat(join(root, path));
      if (stat.isSymbolicLink()) throw new Error(`Symbolic link in payload: ${path}`);
      if ((!relative && !allowedRoots.has(name)) || name.startsWith('.') ||
          /\.(?:sqlite(?:-shm|-wal)?|log)$/i.test(name)) {
        throw new Error(`Unexpected payload entry: ${path}`);
      }
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) files.add(path);
      else throw new Error(`Unexpected special file: ${path}`);
    }
  }
  await walk();
  const required = ['package.json', 'electron/main.cjs', 'electron/preload.cjs',
    'dist/index.html', 'dist/backend/storage.cjs',
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node'];
  for (const path of required) {
    if (!files.has(path) || (await lstat(join(root, path))).size === 0) {
      throw new Error(`Missing or empty required payload file: ${path}`);
    }
  }
  // Resolve without loading native code. Never accept an ancestor workspace's
  // dependency as evidence that the staged backend has its own SQLite entry.
  let sqliteEntry;
  try {
    sqliteEntry = createRequire(join(root, 'dist/backend/storage.cjs')).resolve('better-sqlite3');
  } catch {
    throw new Error('Missing SQLite runtime entry in payload');
  }
  const stagedEntry = relative(root, sqliteEntry).split('\\').join('/');
  if (!stagedEntry.startsWith('node_modules/better-sqlite3/') || !files.has(stagedEntry) ||
      (await lstat(sqliteEntry)).size === 0) {
    throw new Error('Missing or empty SQLite runtime entry in payload');
  }
  // Thin 64-bit Mach-O and little-endian ELF are the supported target formats.
  // Headers catch cross-target staging mistakes; they do not prove Electron ABI.
  const native = await readFile(join(root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'));
  const machine = { x64: { darwin: 0x01000007, linux: 62 }, arm64: { darwin: 0x0100000c, linux: 183 } }[arch];
  const matches = machine && (
    (platform === 'darwin' && native.length >= 32 && native.readUInt32LE(0) === 0xfeedfacf &&
      native.readUInt32LE(4) === machine.darwin) ||
    (platform === 'linux' && native.length >= 64 && native.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1])) &&
      native.readUInt16LE(18) === machine.linux));
  if (!matches) throw new Error(`Native SQLite payload does not match supported target ${platform}/${arch}`);
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (metadata.name !== 'jarvis' || typeof metadata.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version) || metadata.main !== 'electron/main.cjs') {
    throw new Error('Invalid payload package metadata');
  }
  if (![...files].some(path => /^dist\/assets\/.+\.js$/.test(path))) {
    throw new Error('Missing required renderer JavaScript assets');
  }
  const html = await readFile(join(root, 'dist/index.html'), 'utf8');
  const entries = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)];
  if (!entries.length) throw new Error('Missing renderer script entry in dist/index.html');
  const linkedAssets = [...html.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1];
    const relations = rel?.toLowerCase().split(/\s+/) ?? [];
    const kind = ['stylesheet', 'modulepreload'].find(value => relations.includes(value));
    if (!kind) return [];
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) throw new Error(`Missing ${kind} href`);
    return [[href, kind]];
  });
  for (const [source, kind] of [...entries.map(([, source]) => [source, 'renderer entry']), ...linkedAssets]) {
    // The desktop renderer loads through file://; every linked asset must exist locally.
    if (!source.startsWith('./') || source.includes('\\') || /[?#]/.test(source)) {
      throw new Error(`Invalid ${kind}: ${source}`);
    }
    const entry = resolve(root, 'dist', source);
    const relative = entry.slice(root.length + 1).split('\\').join('/');
    if (!relative.startsWith('dist/') || !files.has(relative) ||
        (await lstat(entry)).size === 0) {
      throw new Error(`Missing or empty ${kind}: ${source}`);
    }
  }
  return { valid: true, version: metadata.version, files: files.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (![3, 5].includes(process.argv.length)) throw new Error('Usage: node scripts/check-package-payload.mjs <staged-or-extracted-payload> [platform arch]');
    console.log(JSON.stringify(await checkPackagePayload(process.argv[2], process.argv.length === 5 ? { platform: process.argv[3], arch: process.argv[4] } : undefined)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
