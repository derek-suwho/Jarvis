import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('pins every direct build and runtime dependency to its installed lockfile version', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  for (const group of ['dependencies', 'devDependencies']) {
    expect(lock.packages[''][group]).toEqual(pkg[group]);
    for (const [name, version] of Object.entries(pkg[group])) {
      expect(version, `${group}: ${name} must use an exact release version`).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
      expect(lock.packages[`node_modules/${name}`].version, `${name} lock agreement`).toBe(version);
    }
  }
});
