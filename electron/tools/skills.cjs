// Skills as model tools: the model sees a catalog of skill names and loads a skill's instructions on demand.
// Shared by the in-process ChatGPT tool loop and the skills MCP server that Claude Code runs.
const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_CHARS = 100_000;
const MAX_LISTED_FILES = 60;

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_LISTED_FILES || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  try {
    walk(root);
  } catch {
    // A missing folder lists as empty.
  }
  return out;
}

/** Resolves `file` inside the skill folder, refusing anything that escapes it. */
function insideSkill(skill, file) {
  const target = path.resolve(skill.folder, file);
  return target.startsWith(skill.folder + path.sep) ? target : null;
}

function find(skills, name) {
  return skills.find((s) => s.name === name) ?? skills.find((s) => s.name.toLowerCase() === String(name).toLowerCase());
}

function loadSkill(skills, name) {
  const skill = find(skills, name);
  if (!skill) return `No skill named "${name}". Available: ${skills.map((s) => s.name).join(', ')}`;
  const body = fs.readFileSync(path.join(skill.folder, 'SKILL.md'), 'utf8').slice(0, MAX_FILE_CHARS);
  const files = listFiles(skill.folder).filter((f) => f !== 'SKILL.md');
  return files.length ? `${body}\n\n---\nOther files in this skill (read with read_skill_file):\n${files.join('\n')}` : body;
}

function readSkillFile(skills, name, file) {
  const skill = find(skills, name);
  if (!skill) return `No skill named "${name}".`;
  const target = typeof file === 'string' && insideSkill(skill, file);
  if (!target) return 'That path is outside the skill.';
  try {
    return fs.readFileSync(target, 'utf8').slice(0, MAX_FILE_CHARS);
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
