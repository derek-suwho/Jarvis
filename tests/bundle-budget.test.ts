import { expect, it, vi } from 'vitest';

it('bounds initial static imports, individual deferred chunks and total JavaScript bytes', async () => {
  const modulePath = '../scripts/check-bundle-budget.mjs';
  const { checkBundleBudget } = await import(modulePath);
  const chunk = (fileName: string, bytes: number, isEntry = false, imports: string[] = []) =>
    ({ type: 'chunk', fileName, code: 'a'.repeat(bytes), isEntry, imports });
  const good = { 'entry.js': chunk('entry.js', 200_000, true, ['shared.js']),
    'shared.js': chunk('shared.js', 100_000), 'lazy.js': chunk('lazy.js', 1_400_000) };
  expect(checkBundleBudget(good)).toEqual({ initialBytes: 300_000, largestChunkBytes: 1_400_000, totalBytes: 1_700_000 });
  expect(() => checkBundleBudget({ ...good, 'shared.js': chunk('shared.js', 210_000) })).toThrow(/initial/i);
  expect(() => checkBundleBudget({ ...good, 'lazy.js': chunk('lazy.js', 1_500_001) })).toThrow(/chunk/i);
  expect(() => checkBundleBudget({ ...good, ...Object.fromEntries(Array.from({ length: 4 }, (_, i) =>
    [`extra${i}.js`, chunk(`extra${i}.js`, 1_100_000)])) })).toThrow(/total/i);
  expect(() => checkBundleBudget({})).toThrow(/entry/i);
  expect(() => checkBundleBudget({ 'entry.js': chunk('entry.js', 1, true, ['missing.js']) })).toThrow(/missing/i);
  expect(checkBundleBudget({ 'entry.js': { ...chunk('entry.js', 1, true), code: 'é' } }).initialBytes).toBe(2);
});

it('rejects renderer builds above the peak resident memory budget', async () => {
  const modulePath = '../scripts/check-bundle-budget.mjs';
  const { checkBuildMemoryBudget } = await import(modulePath);
  // Node reports resourceUsage().maxRSS in KiB on supported desktop hosts.
  expect(checkBuildMemoryBudget({ maxRSS: 1_572_864 })).toEqual({ peakRssKiB: 1_572_864 });
  expect(() => checkBuildMemoryBudget({ maxRSS: 1_572_865 })).toThrow(/build memory budget exceeded/i);
  for (const maxRSS of [NaN, Infinity, -1, 0]) {
    expect(() => checkBuildMemoryBudget({ maxRSS })).toThrow(/invalid.*memory/i);
  }
});

it('enforces peak memory in the production build plugin', async () => {
  const modulePath = '../scripts/check-bundle-budget.mjs';
  const { bundleBudgetPlugin } = await import(modulePath);
  const usage = vi.spyOn(process, 'resourceUsage').mockReturnValue({ maxRSS: 1_572_865 } as NodeJS.ResourceUsage);
  try {
    expect(() => bundleBudgetPlugin().closeBundle()).toThrow(/build memory budget exceeded/i);
  } finally {
    usage.mockRestore();
  }
});

it('avoids gzip reporting for the Electron local-file production build', async () => {
  const { resolveConfig } = await import('vite');
  const config = await resolveConfig({}, 'build');
  expect(config.base).toBe('./');
  expect(config.build.reportCompressedSize).toBe(false);
  expect(config.plugins.some(plugin => plugin.name === 'jarvis-bundle-budget')).toBe(true);
});

it('runs the renderer build with an explicit heap bound below the RSS ceiling', async () => {
  const { readFile } = await import('node:fs/promises');
  const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  // Leave resident-memory headroom for Rollup buffers, native code and esbuild.
  expect(scripts.build).toContain('node --max-old-space-size=1024 node_modules/vite/bin/vite.js build');
  expect(scripts.build).toContain('tsc --noEmit');
  expect(scripts.build).toContain('npm run build:backend');
});
