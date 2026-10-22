import SQLite from 'better-sqlite3';
import { migrate } from './migrations';
export type Database = SQLite.Database;

export function openDatabase(path: string): Database {
  const db = new SQLite(path);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
