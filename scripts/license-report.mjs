import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Compare complete expressions: approving MIT does not approve an arbitrary
// compound expression. Include optional/platform packages for all release targets.
export function licenseReport(lock, policy) {
  if (!lock || lock.lockfileVersion !== 3 || !lock.packages ||
      Array.isArray(lock.packages) || typeof lock.packages !== 'object' || !lock.packages['']) {
    throw new Error('Expected a v3 lockfile with a root package');
  }
  if (!policy || !Array.isArray(policy.allowedLicenses) ||
      policy.allowedLicenses.some(value => typeof value !== 'string' || !value.trim() || value !== value.trim())) {
    throw new Error('Invalid license policy');
  }
  const allowed = new Set(policy.allowedLicenses);
  const dependencies = [];
  for (const path of Object.keys(lock.packages).sort()) {
    if (path === '') continue;
    const entry = lock.packages[path];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid lockfile package');
    if (entry.dev === true) continue;
    if (entry.link) throw new Error(`Linked production dependency is not supported: ${path}`);
    if (!/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/.test(path)) throw new Error('Invalid lockfile package path');
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const text = value => typeof value === 'string' && value.trim() ? value : null;
    const version = text(entry.version);
    const license = text(entry.license);
    const source = text(entry.resolved);
    const integrity = text(entry.integrity);
    const issues = [];
    if (!version) issues.push('Missing package version');
    if (!source || !integrity) issues.push('Missing package source or integrity');
    if (!license) issues.push('Missing license metadata');
    else if (!allowed.has(license)) issues.push('License expression is not approved');
    dependencies.push({ path, name, version, license, source, integrity, issues });
  }
  return { schemaVersion: 1, passed: dependencies.every(entry => entry.issues.length === 0), dependencies };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/license-report.mjs <package-lock.json> <license-policy.json>');
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const report = licenseReport(read(process.argv[2]), read(process.argv[3]));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
