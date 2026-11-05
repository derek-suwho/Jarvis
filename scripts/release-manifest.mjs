import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Emit to stdout; store the manifest outside the artifact directory so it never hashes itself.
export async function releaseManifest(directory) {
  const root = resolve(directory);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) throw new Error('Symbolic link in artifacts: root');
  if (!rootStat.isDirectory()) throw new Error('Artifact root must be a directory');
  const files = [];
  async function visit(relative) {
    const path = join(root, relative);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link in artifacts: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) {
        if (/[\r\n\\]/.test(name)) throw new Error('Unsupported artifact filename');
        await visit(relative ? `${relative}/${name}` : name);
      }
    } else if (stat.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Unsupported artifact entry: ${relative}`);
    }
  }
  await visit('');
  if (files.length === 0) throw new Error('No artifacts found');
  const lines = [];
  for (const file of files.sort()) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(root, file))) hash.update(chunk);
    lines.push(`${hash.digest('hex')}  ${file}\n`);
  }
  return lines.join('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/release-manifest.mjs <artifact-directory>');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(await releaseManifest(process.argv[2]));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
