import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const { git } = vi.hoisted(() => ({ git: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: git }));

it('allows release source only when all work is clean and the version tag resolves to HEAD', async () => {
  const modulePath = '../scripts/release-source.mjs';
  const { releaseSource } = await import(modulePath);
  const root = mkdtempSync(join(process.cwd(), '.release-source-'));
  const revision = 'a'.repeat(40);
  let status = '';
  let tagRevision = revision;
  git.mockImplementation((command, args, options) => {
    expect(command).toBe('git');
    expect(options).toMatchObject({ cwd: root, encoding: 'utf8' });
    if (args[0] === 'status') {
      expect(args).toEqual(['status', '--porcelain=v1', '--untracked-files=all']);
      return status;
    }
    if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') return `${revision}\n`;
    if (args.join(' ') === 'rev-parse --verify refs/tags/v0.1.0^{commit}') return `${tagRevision}\n`;
    throw new Error('missing tag');
  });
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }));
    expect(releaseSource(root)).toEqual({ version: '0.1.0', revision, tag: 'v0.1.0' });
    for (const dirty of [' M src/App.tsx\n', 'M  package.json\n', '?? new-file\n']) {
      status = dirty;
      expect(() => releaseSource(root)).toThrow(/clean worktree/i);
    }
    status = '';
    tagRevision = 'b'.repeat(40);
    expect(() => releaseSource(root)).toThrow(/tag.*HEAD/i);
    tagRevision = revision;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.2.0' }));
    expect(() => releaseSource(root)).toThrow(/missing tag/);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '--unsafe' }));
    expect(() => releaseSource(root)).toThrow(/version/i);
  } finally {
    git.mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});
