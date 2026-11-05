import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('runs the full sequential verification gate in read-only macOS PR CI with pinned actions', () => {
  // JSON is a YAML subset accepted by GitHub Actions; parse without a new dependency.
  const workflow = JSON.parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  expect(workflow.on).toEqual({ pull_request: {}, push: { branches: ['main'] }, workflow_dispatch: {} });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  const job = workflow.jobs.verify;
  expect(job['runs-on']).toBe('macos-14');
  expect(job['timeout-minutes']).toBe(20);
  for (const step of job.steps.filter((step: { uses?: string }) => step.uses)) {
    expect(step.uses).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/);
  }
  expect(job.steps[0].with['persist-credentials']).toBe(false);
  expect(job.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/setup-node@')).with['node-version']).toMatch(/^\d+\.\d+\.\d+$/);
  expect(job.steps.filter((step: { run?: string }) => step.run).map((step: { run: string }) => step.run)).toEqual([
    'npm ci --no-audit --no-fund', 'npm run ralph:verify',
    'npm audit --omit=dev --audit-level=low', 'npm run release:licenses',
  ]);
  expect(JSON.stringify(workflow)).not.toMatch(/secrets\.|pull_request_target|--no-sandbox/);
});

it('exposes the fail-closed production license inventory as the CI release command', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(pkg.scripts['release:licenses']).toBe('node scripts/license-report.mjs package-lock.json config/allowed-licenses.json');
});
