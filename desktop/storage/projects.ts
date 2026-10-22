import { randomUUID } from 'node:crypto';
import type { ProjectRecord } from '../../src/shared/domain';
import type { Database } from './database';
import { reconcileMemory } from './memory';

type ProjectRow = { id: string; name: string; aliases_json: string; created_at: string };
const record = (row: ProjectRow): ProjectRecord => ({ id: row.id, name: row.name, aliases: JSON.parse(row.aliases_json) as string[], createdAt: row.created_at });

export function createProjectStore(db: Database) {
  return {
    list(): ProjectRecord[] { return (db.prepare('SELECT * FROM projects ORDER BY created_at, rowid').all() as ProjectRow[]).map(record); },
    get(id: string): ProjectRecord | null { const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined; return row ? record(row) : null; },
    create(name: string, aliases: string[]): ProjectRecord {
      if (typeof name !== 'string' || !name.trim() || !Array.isArray(aliases) || aliases.some(a => typeof a !== 'string' || !a.trim())) throw new Error('Invalid project');
      const project = { id: randomUUID(), name: name.trim(), aliases: [...new Set(aliases.map(a => a.trim()))], createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO projects(id, name, aliases_json, created_at) VALUES (?, ?, ?, ?)').run(project.id, project.name, JSON.stringify(project.aliases), project.createdAt);
      return project;
    },
    delete(id: string): void {
      db.transaction(() => {
        db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        reconcileMemory(db);
      }).immediate();
    },
  };
}
export type ProjectStore = ReturnType<typeof createProjectStore>;
