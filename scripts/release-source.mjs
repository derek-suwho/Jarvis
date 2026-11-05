import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run before generating artifacts, in a clean release checkout. Resolving the
// tag as a commit supports both annotated and lightweight tags without a shell.
export function releaseSource(directory) {
  const cwd = resolve(directory);
  const { version } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Invalid release version');
  }
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (git(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    throw new Error('Release requires a clean worktree, including untracked files');
  }
  const revision = git(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const tag = `v${version}`;
  const taggedRevision = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]).trim();
  if (!/^[a-f0-9]{40}$/.test(revision) || taggedRevision !== revision) {
    throw new Error('Release version tag must resolve to HEAD');
  }
  return { version, revision, tag };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/release-source.mjs <checkout-directory>');
    process.stdout.write(`${JSON.stringify(releaseSource(process.argv[2]), null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
