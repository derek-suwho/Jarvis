import { expect, it } from 'vitest';

it('inventories production lockfile entries deterministically and fails unknown or unapproved licenses', async () => {
  const modulePath = '../scripts/license-report.mjs';
  const { licenseReport } = await import(modulePath);
  const packages = {
    '': { name: 'app', version: '1.0.0' },
    'node_modules/z': { version: '2.0.0', license: 'MIT', resolved: 'https://registry.npmjs.org/z.tgz', integrity: 'sha512-z' },
    'node_modules/dev': { version: '1.0.0', dev: true, license: 'UNLICENSED' },
    'node_modules/z/node_modules/@scope/a': { version: '1.0.0', license: '(MIT OR Apache-2.0)', resolved: 'https://registry.npmjs.org/a.tgz', integrity: 'sha512-a', optional: true },
    'node_modules/unknown': { version: '3.0.0', resolved: 'https://registry.npmjs.org/u.tgz', integrity: 'sha512-u' },
  };
  const policy = { allowedLicenses: ['MIT'] };
  const report = licenseReport({ lockfileVersion: 3, packages }, policy);
  expect(report.passed).toBe(false);
  expect(report.dependencies.map((entry: { name: string }) => entry.name)).toEqual(['unknown', 'z', '@scope/a']);
  expect(report.dependencies[1]).toEqual({ path: 'node_modules/z', name: 'z', version: '2.0.0', license: 'MIT', source: 'https://registry.npmjs.org/z.tgz', integrity: 'sha512-z', issues: [] });
  expect(report.dependencies[0].issues).toContain('Missing license metadata');
  expect(report.dependencies[2].issues).toContain('License expression is not approved');
  expect(licenseReport({ lockfileVersion: 3, packages: Object.fromEntries(Object.entries(packages).reverse()) }, policy)).toEqual(report);
  const approved = { lockfileVersion: 3, packages: { '': packages[''], 'node_modules/z': packages['node_modules/z'] } };
  expect(licenseReport(approved, policy).passed).toBe(true);
  expect(licenseReport(approved, { allowedLicenses: [] }).passed).toBe(false);
});

it('fails closed on malformed inventories, policy, links and incomplete package identity', async () => {
  const modulePath = '../scripts/license-report.mjs';
  const { licenseReport } = await import(modulePath);
  for (const lock of [{}, { lockfileVersion: 1, packages: {} }, { lockfileVersion: 3, packages: {} }]) {
    expect(() => licenseReport(lock, { allowedLicenses: [] })).toThrow(/lockfile/i);
  }
  const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/a': { version: '1.0.0', license: 'MIT' } } };
  for (const policy of [{}, { allowedLicenses: [''] }, { allowedLicenses: '*' }]) {
    expect(() => licenseReport(lock, policy)).toThrow(/policy/i);
  }
  expect(licenseReport(lock, { allowedLicenses: ['MIT'] }).passed).toBe(false);
  expect(() => licenseReport({ ...lock, packages: { '': {}, 'node_modules/a': { link: true, resolved: '../a' } } }, { allowedLicenses: ['MIT'] })).toThrow(/link/i);
});
