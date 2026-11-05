// Skills as model tools: the model sees a catalog of skill names and loads a skill's instructions on demand.
// Shared by the in-process ChatGPT tool loop and the skills MCP server that Claude Code runs.
const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_CHARS = 100_000;
const MAX_LISTED_FILES = 60;

// Bound work even for trees modified after import, including hidden entries.
const MAX_CATALOG_ENTRIES = 1000;
const MAX_CATALOG_DEPTH = 16;

function listFiles(root) {
  const out = [];
  let visited = 0;
  const walk = (dir, depth, assertAncestors = () => {}) => {
    if (depth > MAX_CATALOG_DEPTH || visited >= MAX_CATALOG_ENTRIES || out.length >= MAX_LISTED_FILES) return;
    const expected = fs.lstatSync(dir);
    const assertDirectory = () => {
      // A child must remain beneath the directories already validated.
      assertAncestors();
      const current = fs.lstatSync(dir);
      if (!current.isDirectory() || current.isSymbolicLink()
        || current.dev !== expected.dev || current.ino !== expected.ino) {
        throw new Error('Skill directory changed during catalog traversal.');
      }
    };
    assertDirectory();
    const handle = fs.opendirSync(dir);
    try {
      assertDirectory();
      while (visited < MAX_CATALOG_ENTRIES && out.length < MAX_LISTED_FILES) {
        assertDirectory();
        const entry = handle.readSync();
        assertDirectory();
        if (!entry) break;
        visited++;
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1, assertDirectory);
        else if (entry.isFile()) out.push(path.relative(root, full));
      }
    } finally {
      handle.closeSync();
    }
  };
  try {
    walk(root, 0);
  } catch {
    // Keep the bounded partial catalog if a directory disappears or is unreadable.
  }
  return out;
}

/** Resolves `file` inside the skill folder and captures its validated identity. */
function insideSkill(skill, file) {
  const root = path.resolve(skill.folder);
  const target = path.resolve(root, file);
  if (!target.startsWith(root + path.sep)) return null;
  try {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
    const directories = [[root, rootStat]];
    let current = root;
    let stat;
    for (const part of path.relative(root, target).split(path.sep)) {
      current = path.join(current, part);
      stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return null;
      if (current !== target) {
        if (!stat.isDirectory()) return null;
        directories.push([current, stat]);
      }
    }
    // Reject ancestor replacements before accepting the final file's identity.
    // These checks detect validation-time substitutions, not every concurrent race.
    for (const [directory, expected] of directories) {
      const actual = fs.lstatSync(directory);
      if (!actual.isDirectory() || actual.dev !== expected.dev || actual.ino !== expected.ino) return null;
    }
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    return realTarget.startsWith(realRoot + path.sep) ? { path: realTarget, stat } : null;
  } catch {
    return null;
  }
}

function find(skills, name) {
  return skills.find((s) => s.name === name) ?? skills.find((s) => s.name.toLowerCase() === String(name).toLowerCase());
}

function loadSkill(skills, name) {
  const skill = find(skills, name);
  if (!skill) return `No skill named "${name}". Available: ${skills.map((s) => s.name).join(', ')}`;
  if (!insideSkill(skill, 'SKILL.md')) return 'That path is outside the skill.';
  const body = readSkillFile(skills, name, 'SKILL.md');
  const files = listFiles(skill.folder).filter((f) => f !== 'SKILL.md');
  return files.length ? `${body}\n\n---\nOther files in this skill (read with read_skill_file):\n${files.join('\n')}` : body;
}

function readSkillFile(skills, name, file) {
  const skill = find(skills, name);
  if (!skill) return `No skill named "${name}".`;
  const target = typeof file === 'string' && insideSkill(skill, file);
  if (!target) return 'That path is outside the skill.';
  try {
    // Bind the read to the file validated above, even if a parent is replaced.
    const fd = fs.openSync(target.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.dev !== target.stat.dev || opened.ino !== target.stat.ino) {
        return `Could not read ${file}.`;
      }
      // A UTF-8 character uses at most four bytes. Bound allocation and I/O
      // independently of file size (including files growing during the read).
      const buffer = Buffer.alloc(MAX_FILE_CHARS * 4);
      let used = 0;
      while (used < buffer.length) {
        const count = fs.readSync(fd, buffer, used, buffer.length - used, null);
        if (count === 0) break;
        used += count;
      }
      return buffer.toString('utf8', 0, used).slice(0, MAX_FILE_CHARS);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return `Could not read ${file}.`;
  }
}

function catalog(skills) {
  return skills.map((s) => `- ${s.name}: ${(s.description || '').replace(/\s+/g, ' ').slice(0, 240)}`).join('\n');
}

/** Tool definitions in MCP form ({ name, description, inputSchema }) plus a runner. */
function skillTools(skills) {
  if (!skills.length) return [];
  return [
    {
      name: 'load_skill',
      description: `Load a skill's instructions. Use one when the request matches its description, before answering.\nSkills:\n${catalog(skills)}`,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill name from the list.' } },
        required: ['name'],
      },
      run: (args) => loadSkill(skills, args?.name),
    },
    {
      name: 'read_skill_file',
      description: 'Read a supporting file (reference, template or script) that a loaded skill points to.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, path: { type: 'string', description: 'Path relative to the skill folder.' } },
        required: ['name', 'path'],
      },
      run: (args) => readSkillFile(skills, args?.name, args?.path),
    },
  ];
}

module.exports = { skillTools, loadSkill, readSkillFile };
