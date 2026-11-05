import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseManifest } from './release-manifest.mjs';

// Emit outside the artifact directory. Identity is supplied by the build job;
// this records its claims, not evidence of signing, notarization, or a clean tree.
export async function releaseProvenance(directory, identity) {
  const version = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!identity || !['version', 'node', 'npm', 'electron'].every(key =>
    typeof identity[key] === 'string' && version.test(identity[key])) ||
    !/^[a-f0-9]{40}$/.test(identity.revision ?? '') ||
    !['arm64', 'x64'].includes(identity.architecture) ||
    !['unsigned', 'signed'].includes(identity.mode)) {
    throw new Error('Invalid build identity');
  }
  const manifest = await releaseManifest(directory);
  const artifacts = manifest.slice(0, -1).split('\n').map(line => ({
    path: line.slice(66), sha256: line.slice(0, 64),
  }));
  return `${JSON.stringify({ schemaVersion: 1, version: identity.version,
    revision: identity.revision, architecture: identity.architecture, mode: identity.mode,
    node: identity.node, npm: identity.npm, electron: identity.electron, artifacts }, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 10) {
      throw new Error('Usage: node scripts/release-provenance.mjs <artifact-directory> <version> <revision> <arm64|x64> <unsigned|signed> <node-version> <npm-version> <electron-version>');
    }
    const [, , directory, version, revision, architecture, mode, node, npm, electron] = process.argv;
    process.stdout.write(await releaseProvenance(directory, { version, revision, architecture, mode, node, npm, electron }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
