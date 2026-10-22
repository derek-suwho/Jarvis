import { newId } from './chats';

/** A workspace grouping chats, with instructions every chat in it should follow. */
export interface Project {
  id: string;
  name: string;
  instructions: string;
  createdAt: number;
}

const STORAGE_KEY = 'jarvis.projects';
const NAME_MAX = 60;

export function createProject(name: string, now = Date.now()): Project | null {
  const n = name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
  return n ? { id: newId(), name: n, instructions: '', createdAt: now } : null;
}

export function updateProject(projects: Project[], id: string, patch: Partial<Omit<Project, 'id'>>): Project[] {
  return projects.map((p) => {
    if (p.id !== id) return p;
    const name = patch.name?.trim().slice(0, NAME_MAX);
    return { ...p, ...patch, name: name || p.name };
  });
}

function isProject(v: unknown): v is Project {
  const p = v as Project;
  return !!p && typeof p.id === 'string' && typeof p.name === 'string';
}

export function loadProjects(): Project[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(isProject).map((p) => ({ ...p, instructions: typeof p.instructions === 'string' ? p.instructions : '' }))
      : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // Storage unavailable — keep in memory only.
  }
}
