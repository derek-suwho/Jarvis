// Jarvis tools layer: import MCP servers and skills from Claude and ChatGPT, then share them with every model.
const { app, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sources = require('./sources.cjs');
const { createStore } = require('./store.cjs');
const { createHost } = require('./host.cjs');

let store = null;
let host = null;
let lastScan = null;

function init() {
  if (host) return host;
  store = createStore(path.join(app.getPath('userData'), 'tools'));
  host = createHost({
    store,
    openExternal: (url) => shell.openExternal(url),
    skillsServerPath: path.join(__dirname, 'skills-server.cjs'),
  });
  return host;
}

function state() {
  init();
  return {
    servers: host.status(),
    skills: store.skills().map(({ id, name, description, label }) => ({ id, name, description, label })),
  };
}

/** Imports the chosen items from the last scan; ids come from the renderer, so only scanned ids count. */
function importSelected(ids) {
  init();
  if (!lastScan || !Array.isArray(ids)) throw new Error('Scan again before importing.');
  const wanted = new Set(ids.filter((id) => typeof id === 'string'));
  let servers = 0;
  let skills = 0;
  const failed = [];
  for (const s of lastScan.servers) {
    if (!wanted.has(s.id)) continue;
    store.addServer(s);
    servers++;
  }
  for (const s of lastScan.skills) {
    if (!wanted.has(s.id)) continue;
    try {
      store.addSkill(s);
      skills++;
    } catch {
      failed.push(s.name);
    }
  }
  void host.refresh();
  return { servers, skills, failed };
}

/** Writes the Claude Code MCP config to an owner-only file (it can hold secrets, so never pass it as an argument). */
async function claudeMcpConfigFile() {
  init();
  const config = await host.claudeConfig();
  const names = Object.keys(config.mcpServers);
  if (!names.length) return null;
  const file = path.join(app.getPath('userData'), 'tools', 'claude-mcp.json');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return { file, names };
}

function registerIpc(ipcMain) {
  ipcMain.handle('tools:state', () => state());
  ipcMain.handle('tools:scan', () => {
    lastScan = sources.scan({ home: os.homedir(), env: process.env });
    return sources.preview(lastScan);
  });
  ipcMain.handle('tools:import', (_event, ids) => importSelected(ids));
  ipcMain.handle('tools:set-enabled', async (_event, id, enabled) => {
    init();
    if (typeof id !== 'string') return state();
    store.setEnabled(id, enabled === true);
    await host.disconnect(id);
    if (enabled === true) {
      const server = store.servers().find((s) => s.id === id);
      if (server) await host.connect(server);
    }
    return state();
  });
  ipcMain.handle('tools:remove-server', async (_event, id) => {
    init();
    if (typeof id === 'string') {
      await host.disconnect(id);
      store.removeServer(id);
    }
    return state();
  });
  ipcMain.handle('tools:remove-skill', (_event, id) => {
    init();
    if (typeof id === 'string') store.removeSkill(id);
    return state();
  });
  ipcMain.handle('tools:sign-in', async (_event, id) => {
    init();
    try {
      await host.signIn(id);
      return { ok: true, state: state() };
    } catch (err) {
      return { ok: false, error: err.message || 'Sign-in failed.', state: state() };
    }
  });
  ipcMain.handle('tools:refresh', async () => {
    await init().refresh();
    return state();
  });
}

module.exports = { registerIpc, catalog: () => init().catalog(), labelTool: (name) => init().labelTool(name), claudeMcpConfigFile };
