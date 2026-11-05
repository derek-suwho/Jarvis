// Jarvis's own registry of MCP servers and skills. Public settings, secrets and skill files are kept apart:
// secrets live in an owner-only file and never reach the renderer.
const fs = require('node:fs');
const path = require('node:path');
const { slug, serverTarget } = require('./sources.cjs');

const SKIP = new Set(['node_modules', '.git']);
// Keep untrusted imports bounded while synchronous work runs in the main process.
const MAX_SKILL_DEPTH = 16;
const MAX_SKILL_ENTRIES = 1000;
const MAX_SKILL_BYTES = 10 * 1024 * 1024;

// Recheck the directory path after opening, before consulting any child paths.
// Ancestor identities travel with recursion to detect replaced parents too.
// This is not an openat-style guarantee against every concurrent mutation.
function assertSkillDirectory(source, expected) {
  const current = fs.lstatSync(source);
  if (!current.isDirectory() || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error('Skill source changed during import.');
  }
}

// Inspect the complete tree before touching an installed copy. Never follow links
// from an imported skill into unrelated local data.
function validateSkillTree(source, depth = 0, budget = { entries: 0, bytes: 0 }, ancestors = []) {
  if (depth > MAX_SKILL_DEPTH) throw new Error('Skill import depth limit exceeded.');
  if (++budget.entries > MAX_SKILL_ENTRIES) throw new Error('Skill import entry limit exceeded.');
  const stat = fs.lstatSync(source);
  for (const [ancestor, expected] of ancestors) assertSkillDirectory(ancestor, expected);
  if (stat.isSymbolicLink()) throw new Error('Skill imports cannot contain a symbolic link.');
  if (stat.isDirectory()) {
    // Stream entries so an oversized directory cannot allocate an unbounded list.
    const directory = fs.opendirSync(source);
    try {
      for (const [ancestor, expected] of ancestors) assertSkillDirectory(ancestor, expected);
      assertSkillDirectory(source, stat);
      let entry;
      while ((entry = directory.readSync()) !== null) {
        for (const [ancestor, expected] of ancestors) assertSkillDirectory(ancestor, expected);
        assertSkillDirectory(source, stat);
        if (!SKIP.has(entry.name)) validateSkillTree(path.join(source, entry.name), depth + 1, budget, [...ancestors, [source, stat]]);
      }
    } finally {
      directory.closeSync();
    }
  } else if (!stat.isFile()) {
    throw new Error('Skill imports can contain only regular files and directories.');
  } else {
    budget.bytes += stat.size;
    if (budget.bytes > MAX_SKILL_BYTES) throw new Error('Skill import byte limit exceeded.');
  }
}

// Enforce limits while copying too: preflight metadata can become stale.
function copySkillTree(source, destination, depth = 0, budget = { entries: 0, bytes: 0 }, ancestors = []) {
  if (depth > MAX_SKILL_DEPTH) throw new Error('Skill import depth limit exceeded.');
  if (++budget.entries > MAX_SKILL_ENTRIES) throw new Error('Skill import entry limit exceeded.');
  const stat = fs.lstatSync(source);
  for (const [ancestor, expected] of ancestors) assertSkillDirectory(ancestor, expected);
  if (stat.isSymbolicLink()) throw new Error('Skill imports cannot contain a symbolic link.');
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { mode: 0o700 });
    const directory = fs.opendirSync(source);
    try {
      for (const [ancestor, expected] of ancestors) assertSkillDirectory(ancestor, expected);
      assertSkillDirectory(source, stat);
      let entry;
      while ((entry = directory.readSync()) !== null) {
        for (const [ancestor, expected] of ancestors) assertSkillDirectory(ancestor, expected);
        assertSkillDirectory(source, stat);
        if (!SKIP.has(entry.name)) copySkillTree(path.join(source, entry.name), path.join(destination, entry.name), depth + 1, budget, [...ancestors, [source, stat]]);
      }
    } finally {
      directory.closeSync();
    }
    return;
  }
  if (!stat.isFile()) throw new Error('Skill imports can contain only regular files and directories.');
  // NOFOLLOW also rejects a final-component link introduced after lstat.
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(input);
    if (!opened.isFile()) throw new Error('Skill imports can contain only regular files and directories.');
    // Refuse substitutions after lstat, including a replaced parent directory.
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error('Skill source changed during import.');
    if (opened.size > MAX_SKILL_BYTES - budget.bytes) throw new Error('Skill import byte limit exceeded.');
    const output = fs.openSync(destination, 'wx', 0o600);
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let count;
      // Read one extra byte at the limit to distinguish EOF from a growing source.
      while ((count = fs.readSync(input, buffer, 0, Math.min(buffer.length, MAX_SKILL_BYTES - budget.bytes + 1), null)) > 0) {
        budget.bytes += count;
        if (budget.bytes > MAX_SKILL_BYTES) throw new Error('Skill import byte limit exceeded.');
        let offset = 0;
        while (offset < count) {
          const written = fs.writeSync(output, buffer, offset, count - offset);
          if (written === 0) throw new Error('Skill import write made no progress.');
          offset += written;
        }
      }
    } finally {
      fs.closeSync(output);
    }
  } finally {
    fs.closeSync(input);
  }
}

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
  // Exclusive creation rejects existing files and symlinks before writing secrets.
  const descriptor = fs.openSync(tmp, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(descriptor, JSON.stringify(data, null, 2));
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    // Failed writes must not leave an extra copy of private connection data.
    fs.rmSync(tmp, { force: true });
  }
}

function createStore(dir) {
  const serversFile = path.join(dir, 'servers.json');
  const secretsFile = path.join(dir, 'secrets.json');
  const skillsFile = path.join(dir, 'skills.json');
  const skillsDir = path.join(dir, 'skills');

  const servers = () => {
    let contents;
    try {
      contents = fs.readFileSync(serversFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error('Invalid tool server storage. Repair servers.json before continuing.');
    }
    try {
      const data = JSON.parse(contents);
      if (!Array.isArray(data) || data.some((server) => !server || typeof server !== 'object' || Array.isArray(server))) {
        throw new Error();
      }
      return data;
    } catch {
      throw new Error('Invalid tool server storage. Repair servers.json before continuing.');
    }
  };
  const secretsAll = () => {
    let contents;
    try {
      contents = fs.readFileSync(secretsFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return Object.create(null);
      throw new Error('Invalid private tool storage. Restore secrets.json before continuing.');
    }
    try {
      const data = JSON.parse(contents);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      // Never normalize malformed private records by spreading them during migration.
      if (Object.values(data).some((record) => !record || typeof record !== 'object' || Array.isArray(record))) {
        throw new Error();
      }
      // Optional connection dictionaries must contain strings; do not let malformed
      // persisted values reach process environments or HTTP request headers.
      for (const record of Object.values(data)) {
        if (Object.hasOwn(record, 'url')) {
          if (typeof record.url !== 'string') throw new Error();
          const url = new URL(record.url);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
        }
        if (Object.hasOwn(record, 'oauth')) {
          const oauth = record.oauth;
          if (!oauth || typeof oauth !== 'object' || Array.isArray(oauth)) throw new Error();
          for (const field of ['client', 'tokens']) {
            if (Object.hasOwn(oauth, field)
              && (!oauth[field] || typeof oauth[field] !== 'object' || Array.isArray(oauth[field]))) {
              throw new Error();
            }
          }
          if (Object.hasOwn(oauth, 'verifier') && typeof oauth.verifier !== 'string') throw new Error();
        }
        for (const field of ['env', 'headers']) {
          if (!Object.hasOwn(record, field)) continue;
          const values = record[field];
          if (!values || typeof values !== 'object' || Array.isArray(values)
            || Object.values(values).some((value) => typeof value !== 'string')) {
            throw new Error();
          }
        }
      }
      // Server identities are data, including names such as __proto__.
      // A prototype-free dictionary keeps reads and writes on own entries.
      return Object.assign(Object.create(null), data);
    } catch {
      throw new Error('Invalid private tool storage. Restore secrets.json before continuing.');
    }
  };
  const skills = () => readJson(skillsFile, []);

  // Upgrade legacy URLs before any caller can obtain public records. Persist
  // the private originals first so interruption cannot lose connection details.
  const legacy = servers();
  // Private records are keyed by identity. Reject collisions before migrating
  // anything, otherwise the last URL silently replaces earlier connection data.
  const identities = new Set();
  for (const server of legacy) {
    if (typeof server.id !== 'string' || !server.id.trim() || identities.has(server.id)) {
      throw new Error('Invalid tool server identities. Repair servers.json before continuing.');
    }
    identities.add(server.id);
  }
  const privateData = secretsAll();
  if (!privateData || typeof privateData !== 'object' || Array.isArray(privateData)) {
    throw new Error('Invalid private tool storage. Restore secrets.json before migration.');
  }
  let migrated = false;
  const sanitized = legacy.map((server) => {
    if (server.transport === 'stdio') return server;
    const displayUrl = serverTarget(server);
    if (displayUrl === server.url) return server;
    privateData[server.id] = { env: {}, headers: {}, ...privateData[server.id], url: server.url };
    migrated = true;
    return { ...server, url: displayUrl };
  });
  if (migrated) {
    writeJson(secretsFile, privateData);
    writeJson(serversFile, sanitized);
  }

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
      // Persist only the display URL publicly. Keep the original connection URL
      // alongside headers when it contains credentials or masked query values.
      const displayUrl = pub.transport === 'stdio' ? undefined : serverTarget(pub);
      const privateUrl = displayUrl !== undefined && displayUrl !== pub.url ? pub.url : undefined;
      const record = { ...pub, ...(displayUrl === undefined ? {} : { url: displayUrl }), key, enabled: true };
      this.saveSecrets(scanned.id, { env: secrets.env, headers: secrets.headers, url: privateUrl, oauth: undefined });
      writeJson(serversFile, [...list, record]);
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
      validateSkillTree(scanned.dir);
      const folder = path.join(skillsDir, slug(scanned.id.replace(':', '-')));
      // Slugs are lossy (case, punctuation and truncation). Never let a new
      // identity replace files owned by a different registered skill.
      if (skills().some((skill) => skill.id !== scanned.id && path.resolve(skill.folder) === path.resolve(folder))) {
        throw new Error('Skill folder is already owned by another skill.');
      }
      fs.mkdirSync(skillsDir, { recursive: true, mode: 0o700 });
      // Copy into a private staging directory. The source can change after preflight;
      // validate the actual copied tree before replacing any installed content.
      const staging = fs.mkdtempSync(path.join(skillsDir, '.import-'));
      const staged = path.join(staging, 'skill');
      const backup = path.join(staging, 'previous');
      const record = { id: scanned.id, name: scanned.name, description: scanned.description, label: scanned.label, folder };
      let backedUp = false;
      let published = false;
      try {
        copySkillTree(scanned.dir, staged);
        validateSkillTree(staged);
        if (fs.existsSync(folder)) {
          fs.renameSync(folder, backup);
          backedUp = true;
        }
        fs.renameSync(staged, folder);
        published = true;
        writeJson(skillsFile, [...skills().filter((s) => s.id !== scanned.id), record]);
      } catch (error) {
        if (published) fs.rmSync(folder, { recursive: true, force: true });
        if (backedUp) fs.renameSync(backup, folder);
        throw error;
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
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
