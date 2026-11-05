// Raw UTF-8 bytes: Electron loads local files without HTTP compression.
export function checkBundleBudget(bundle) {
  const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
  const entries = chunks.filter(item => item.isEntry);
  if (!entries.length) throw new Error('Bundle has no entry chunk.');
  const initial = new Set();
  function visit(name) {
    if (initial.has(name)) return;
    const item = bundle[name];
    if (!item || item.type !== 'chunk') throw new Error(`Missing static chunk: ${name}`);
    initial.add(name);
    item.imports.forEach(visit);
  }
  entries.forEach(item => visit(item.fileName));
  const size = item => Buffer.byteLength(item.code, 'utf8');
  const report = {
    initialBytes: [...initial].reduce((total, name) => total + size(bundle[name]), 0),
    largestChunkBytes: Math.max(...chunks.map(size)),
    totalBytes: chunks.reduce((total, item) => total + size(item), 0),
  };
  if (report.initialBytes > 400_000) throw new Error(`Initial JavaScript budget exceeded: ${report.initialBytes} > 400000`);
  if (report.largestChunkBytes > 1_500_000) throw new Error(`JavaScript chunk budget exceeded: ${report.largestChunkBytes} > 1500000`);
  if (report.totalBytes > 6_000_000) throw new Error(`Total JavaScript budget exceeded: ${report.totalBytes} > 6000000`);
  return report;
}

// A 1.5 GiB ceiling bounds the renderer build independently of output size.
// Node normalizes maxRSS to KiB on both Linux and macOS. This measures this
// process's lifetime peak, not the separate TypeScript/backend build processes.
export function checkBuildMemoryBudget({ maxRSS }) {
  if (!Number.isFinite(maxRSS) || maxRSS <= 0) throw new Error('Invalid build memory measurement.');
  if (maxRSS > 1_572_864) throw new Error(`Build memory budget exceeded: ${maxRSS} KiB > 1572864 KiB`);
  return { peakRssKiB: maxRSS };
}

/** @returns {import('vite').Plugin} */
export function bundleBudgetPlugin() {
  return {
    name: 'jarvis-bundle-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      const report = checkBundleBudget(bundle);
      console.info(`JavaScript bytes: initial=${report.initialBytes}, largest=${report.largestChunkBytes}, total=${report.totalBytes}`);
    },
    closeBundle() {
      const report = checkBuildMemoryBudget(process.resourceUsage());
      console.info(`Renderer build peak RSS: ${report.peakRssKiB} KiB (budget=1572864 KiB)`);
    },
  };
}
