// Jarvis's own registry of MCP servers and skills. Public settings, secrets and skill files are kept apart:
// secrets live in an owner-only file and never reach the renderer.
const fs = require('node:fs');
const path = require('node:path');
const { slug } = require('./sources.cjs');

const SKIP = new Set(['node_modules', '.git']);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Atomic write with owner-only permissions. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function createStore(dir) {
  const serversFile = path.join(dir, 'servers.json');
  const secretsFile = path.join(dir, 'secrets.json');
  const skillsFile = path.join(dir, 'skills.json');
  const skillsDir = path.join(dir, 'skills');

  const servers = () => readJson(serversFile, []);
  const secretsAll = () => readJson(secretsFile, {});
  const skills = () => readJson(skillsFile, []);

  /** Unique tool-name prefix per server, e.g. `github` or `github-2`. */
  function uniqueKey(name, taken) {
    const base = slug(name).replace(/-/g, '_').slice(0, 24) || 'server';
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
    return key;
  }

  return {
    skillsDir,
    servers,
    skills,
    secrets: (id) => secretsAll()[id] ?? { env: {}, headers: {} },

    saveSecrets(id, patch) {
      const all = secretsAll();
      all[id] = { env: {}, headers: {}, ...all[id], ...patch };
      writeJson(secretsFile, all);
    },

    /** Adds or replaces a scanned server; returns its stored record. */
    addServer(scanned) {
      const list = servers().filter((s) => s.id !== scanned.id);
      // `skills` is reserved for Jarvis's own skills server.
      const key = uniqueKey(scanned.name, new Set(['skills', ...list.map((s) => s.key)]));
      const { secrets, disabled, project, ...pub } = scanned;
      const record = { ...pub, key, enabled: true };
      writeJson(serversFile, [...list, record]);
      this.saveSecrets(scanned.id, { env: secrets.env, headers: secrets.headers, oauth: undefined });
      return record;
    },

    setEnabled(id, enabled) {
      writeJson(serversFile, servers().map((s) => (s.id === id ? { ...s, enabled: !!enabled } : s)));
    },

    removeServer(id) {
      writeJson(serversFile, servers().filter((s) => s.id !== id));
      const all = secretsAll();
      delete all[id];
      writeJson(secretsFile, all);
    },

    /** Copies a skill folder into Jarvis so it keeps working if the original app is removed. */
    addSkill(scanned) {
      const folder = path.join(skillsDir, slug(scanned.id.replace(':', '-')));
      fs.rmSync(folder, { recursive: true, force: true });
      fs.mkdirSync(skillsDir, { recursive: true, mode: 0o700 });
      fs.cpSync(scanned.dir, folder, { recursive: true, dereference: true, filter: (src) => !SKIP.has(path.basename(src)) });
      const record = { id: scanned.id, name: scanned.name, description: scanned.description, label: scanned.label, folder };
      writeJson(skillsFile, [...skills().filter((s) => s.id !== scanned.id), record]);
      return record;
    },

    removeSkill(id) {
      const skill = skills().find((s) => s.id === id);
      if (skill && path.dirname(skill.folder) === skillsDir) fs.rmSync(skill.folder, { recursive: true, force: true });
      writeJson(skillsFile, skills().filter((s) => s.id !== id));
    },
  };
}

module.exports = { createStore };
