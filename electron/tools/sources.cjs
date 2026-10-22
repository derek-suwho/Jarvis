// Finds MCP servers and skills already installed for Codex (ChatGPT), Claude Code and Claude Desktop,
// so they can be imported into Jarvis's own tools layer. Reads local config only; nothing leaves the Mac.
const fs = require('node:fs');
const path = require('node:path');
const { parse: parseToml } = require('smol-toml');

const MAX_SKILL_BYTES = 256 * 1024;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readToml(file) {
  try {
    return parseToml(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);
const stringMap = (v) =>
  isObject(v) ? Object.fromEntries(Object.entries(v).filter(([, s]) => typeof s === 'string')) : {};

/** Lowercase identifier safe for tool names and file names. */
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';

/** Expands `${VAR}`, `${VAR:-default}` and `${CLAUDE_PLUGIN_ROOT}` the way Claude Code does. */
function expand(value, vars) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name, fallback) =>
    vars[name] !== undefined ? vars[name] : fallback !== undefined ? fallback : whole,
  );
}

/**
 * Normalizes one server entry from any of the supported formats:
 * Claude (`type`, `command`, `args`, `env`, `url`, `headers`) or Codex (`env_vars`, `http_headers`,
 * `env_http_headers`, `bearer_token_env_var`, `enabled`). Secrets are kept apart from the public record.
 */
function normalizeServer(name, raw, { source, label, env, root }) {
  if (!isObject(raw)) return null;
  const vars = { ...env, ...(root ? { CLAUDE_PLUGIN_ROOT: root } : {}) };
  const x = (s) => expand(s, vars);
  const secretEnv = Object.fromEntries(Object.entries(stringMap(raw.env)).map(([k, v]) => [k, x(v)]));
  for (const key of strings(raw.env_vars)) if (env[key] !== undefined) secretEnv[key] = env[key];
  const headers = Object.fromEntries(
    Object.entries({ ...stringMap(raw.headers), ...stringMap(raw.http_headers) }).map(([k, v]) => [k, x(v)]),
  );
  for (const [header, variable] of Object.entries(stringMap(raw.env_http_headers))) {
    if (env[variable] !== undefined) headers[header] = env[variable];
  }
  if (typeof raw.bearer_token_env_var === 'string' && env[raw.bearer_token_env_var] !== undefined) {
    headers.Authorization = `Bearer ${env[raw.bearer_token_env_var]}`;
  }

  const base = { id: `${slug(source)}:${slug(name)}`, name, source, label, disabled: raw.enabled === false || raw.disabled === true };
  if (typeof raw.url === 'string') {
    let url;
    try {
      url = new URL(x(raw.url));
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const transport = raw.type === 'sse' ? 'sse' : 'http';
    return { ...base, transport, url: url.toString(), secrets: { env: {}, headers } };
  }
  if (typeof raw.command !== 'string' || !raw.command.trim()) return null;
  return {
    ...base,
    transport: 'stdio',
    command: x(raw.command),
    args: strings(raw.args).map(x),
    cwd: typeof raw.cwd === 'string' ? x(raw.cwd) : root,
    secrets: { env: secretEnv, headers: {} },
  };
}

/** Reads `name` and `description` from SKILL.md frontmatter, including folded (`>`/`|`) values. */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(value.startsWith('|') ? '\n' : ' ');
    }
    out[m[1]] = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return out;
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith('.'))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** Every `<dir>/<skill>/SKILL.md` under a skills folder. */
function scanSkills(dir, { source, label }) {
  const skills = [];
  for (const skillDir of listDirs(dir)) {
    const file = path.join(skillDir, 'SKILL.md');
    let text;
    try {
      if (fs.statSync(file).size > MAX_SKILL_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const meta = parseFrontmatter(text);
    const name = meta.name || path.basename(skillDir);
    skills.push({ id: `${slug(source)}:${slug(name)}`, name, description: meta.description || '', source, label, dir: skillDir });
  }
  return skills;
}

/** MCP servers and skills a plugin folder contributes (`.mcp.json`, manifest `mcpServers`, `skills/`). */
function scanPlugin(root, { source, label, env }) {
  const manifest =
    readJson(path.join(root, '.claude-plugin', 'plugin.json')) ?? readJson(path.join(root, '.codex-plugin', 'plugin.json')) ?? {};
  let servers = readJson(path.join(root, '.mcp.json'))?.mcpServers ?? {};
  if (typeof manifest.mcpServers === 'string') servers = readJson(path.join(root, manifest.mcpServers))?.mcpServers ?? servers;
  else if (isObject(manifest.mcpServers)) servers = { ...servers, ...manifest.mcpServers };
  const skillsDir = typeof manifest.skills === 'string' ? path.join(root, manifest.skills) : path.join(root, 'skills');
  return {
    servers: Object.entries(isObject(servers) ? servers : {})
      .map(([name, raw]) => normalizeServer(name, raw, { source, label, env, root }))
      .filter(Boolean),
    skills: scanSkills(skillsDir, { source, label }),
    connector: typeof manifest.apps === 'string',
  };
}

/** Codex keeps versions side by side; prefer `latest`, else the newest folder. */
function newestVersion(dir) {
  const dirs = listDirs(dir);
  const latest = dirs.find((d) => path.basename(d) === 'latest');
  if (latest) return latest;
  return dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
}

function scanCodex(home, env, out) {
  const codex = path.join(home, '.codex');
  const config = readToml(path.join(codex, 'config.toml')) ?? {};
  const opts = { source: 'codex', label: 'ChatGPT / Codex', env };
  for (const [name, raw] of Object.entries(isObject(config.mcp_servers) ? config.mcp_servers : {})) {
    out.servers.push(normalizeServer(name, raw, opts));
  }
  out.skills.push(...scanSkills(path.join(codex, 'skills'), opts));
  let connectors = 0;
  for (const [key, value] of Object.entries(isObject(config.plugins) ? config.plugins : {})) {
    if (isObject(value) && value.enabled === false) continue;
    const [plugin, market] = key.split('@');
    const root = market && newestVersion(path.join(codex, 'plugins', 'cache', market, plugin));
    if (!root) continue;
    const found = scanPlugin(root, { source: `codex-plugin-${plugin}`, label: `Codex plugin · ${plugin}`, env });
    if (found.connector && !found.servers.length && !found.skills.length) connectors++;
    out.servers.push(...found.servers);
    out.skills.push(...found.skills);
  }
  if (connectors) {
    out.notes.push(`${connectors} ChatGPT connector${connectors === 1 ? '' : 's'} live in your OpenAI account and can't be copied. Add the same service as an MCP server instead.`);
  }
}

function scanClaudeCode(home, env, out) {
  const config = readJson(path.join(home, '.claude.json')) ?? {};
  const opts = { source: 'claude-code', label: 'Claude Code', env };
  for (const [name, raw] of Object.entries(isObject(config.mcpServers) ? config.mcpServers : {})) {
    out.servers.push(normalizeServer(name, raw, opts));
  }
  // Project servers only apply inside that folder, so they start unselected.
  for (const [dir, project] of Object.entries(isObject(config.projects) ? config.projects : {})) {
    const servers = isObject(project?.mcpServers) ? project.mcpServers : {};
    for (const [name, raw] of Object.entries(servers)) {
      const s = normalizeServer(name, raw, { ...opts, label: `Claude Code · ${path.basename(dir)}` });
      if (s) out.servers.push({ ...s, id: `${s.id}@${slug(path.basename(dir))}`, project: true });
    }
  }
  out.skills.push(...scanSkills(path.join(home, '.claude', 'skills'), opts));
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  const enabled = readJson(path.join(home, '.claude', 'settings.json'))?.enabledPlugins ?? {};
  for (const [key, installs] of Object.entries(isObject(installed?.plugins) ? installed.plugins : {})) {
    if (enabled[key] === false || !Array.isArray(installs)) continue;
    const root = installs[installs.length - 1]?.installPath;
    if (typeof root !== 'string' || !fs.existsSync(root)) continue;
    const plugin = key.split('@')[0];
    const found = scanPlugin(root, { source: `claude-plugin-${plugin}`, label: `Claude plugin · ${plugin}`, env });
    out.servers.push(...found.servers);
    out.skills.push(...found.skills);
  }
}

function scanClaudeDesktop(home, env, out) {
  const file = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  const config = readJson(file) ?? {};
  const opts = { source: 'claude-desktop', label: 'Claude Desktop', env };
  for (const [name, raw] of Object.entries(isObject(config.mcpServers) ? config.mcpServers : {})) {
    out.servers.push(normalizeServer(name, raw, opts));
  }
}

const SECRET_FLAG = /key|token|secret|password|auth/i;
const SECRET_VALUE = /^(sk|ctx7sk|ghp|gho|glpat|xox[abp]|pat)[-_]|^[A-Za-z0-9_-]{32,}$/;

/** Command line or URL for display, with keys passed as arguments or query params masked. */
function serverTarget(s) {
  if (s.transport !== 'stdio') {
    const url = new URL(s.url);
    for (const [k] of url.searchParams) if (SECRET_FLAG.test(k)) url.searchParams.set(k, '•••');
    return url.toString();
  }
  const args = s.args.map((a, i) => {
    const eq = /^(--?[\w-]+)=(.*)$/.exec(a);
    if (eq && SECRET_FLAG.test(eq[1])) return `${eq[1]}=•••`;
    if (i > 0 && /^--?[\w-]+$/.test(s.args[i - 1]) && SECRET_FLAG.test(s.args[i - 1])) return '•••';
    return SECRET_VALUE.test(a) ? '•••' : a;
  });
  return [s.command, ...args].join(' ');
}

/**
 * Everything importable on this Mac. Duplicates (same name and target from two apps) keep the first.
 * Servers carry `secrets` and must not be sent to the renderer as-is; see `preview`.
 */
function scan({ home, env }) {
  const out = { servers: [], skills: [], notes: [] };
  scanCodex(home, env, out);
  scanClaudeCode(home, env, out);
  scanClaudeDesktop(home, env, out);
  out.notes.push('Connectors added on claude.ai or chatgpt.com belong to those accounts and can\'t be imported.');

  const seen = new Set();
  const ids = new Set();
  const unique = (key, item) => {
    if (seen.has(key) || ids.has(item.id)) return false;
    seen.add(key);
    ids.add(item.id);
    return true;
  };
  return {
    servers: out.servers.filter((s) => s && unique(`server:${s.name}|${serverTarget(s)}`, s)),
    skills: out.skills.filter((s) => unique(`skill:${s.name}`, s)),
    notes: out.notes,
  };
}

/** Renderer-safe view of a scan: secret names only, never values. */
function preview(result) {
  return {
    servers: result.servers.map((s) => ({
      id: s.id,
      name: s.name,
      label: s.label,
      transport: s.transport,
      target: serverTarget(s),
      secretKeys: [...Object.keys(s.secrets.env), ...Object.keys(s.secrets.headers)],
      selected: !s.disabled && !s.project,
    })),
    skills: result.skills.map((s) => ({ id: s.id, name: s.name, description: s.description, label: s.label, selected: true })),
    notes: result.notes,
  };
}

module.exports = { scan, preview, normalizeServer, parseFrontmatter, scanSkills, expand, slug, serverTarget };
