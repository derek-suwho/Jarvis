import { describe, expect, it } from 'vitest';
import { vetFiles, fileExtension, formatBytes } from '../src/lib/attachments';
import { greeting, initials, sanitizePreferences } from '../src/lib/preferences';
import { createProject, updateProject } from '../src/lib/projects';

describe('preferences', () => {
  it('sanitizes unknown input', () => {
    expect(sanitizePreferences({ name: 3, theme: 'neon', instructions: 'Be brief' })).toEqual({
      name: '',
      theme: 'dark',
      instructions: 'Be brief',
    });
    expect(sanitizePreferences(null).theme).toBe('dark');
  });

  it('greets by time of day and first name', () => {
    expect(greeting('', 8)).toBe('Good morning');
    expect(greeting('Ada Lovelace', 13)).toBe('Good afternoon, Ada');
    expect(greeting('', 2)).toBe('Good evening');
  });

  it('derives initials', () => {
    expect(initials('ada king lovelace')).toBe('AL');
    expect(initials('  ')).toBe('Y');
  });
});

describe('projects', () => {
  it('requires a name and keeps the old one on blank rename', () => {
    expect(createProject('   ')).toBeNull();
    const p = createProject('  Thesis   draft ', 1)!;
    expect(p.name).toBe('Thesis draft');
    expect(updateProject([p], p.id, { name: ' ' })[0].name).toBe('Thesis draft');
    expect(updateProject([p], p.id, { instructions: 'Cite sources' })[0].instructions).toBe('Cite sources');
  });
});

describe('attachments', () => {
  const f = (name: string, size: number) => ({ name, size, type: 'text/plain' });

  it('rejects empty, oversized and excess files', () => {
    const { accepted, errors } = vetFiles([f('a.txt', 10), f('b.txt', 0), f('c.bin', 30 * 1024 * 1024)], 0);
    expect(accepted.map((x) => x.name)).toEqual(['a.txt']);
    expect(errors).toHaveLength(2);
    expect(vetFiles([f('a', 1), f('b', 1)], 9).accepted).toHaveLength(1);
  });

  it('formats sizes and extensions', () => {
    expect(formatBytes(2048)).toBe('2 KB');
    expect(fileExtension('report.final.pdf')).toBe('PDF');
    expect(fileExtension('Makefile')).toBe('FILE');
  });
});
