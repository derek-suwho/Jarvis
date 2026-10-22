// Connects to the user's MCP servers and exposes their tools (plus imported skills) to any model.
// ChatGPT calls tools through `catalog()`; Claude Code gets the same servers through `claudeConfig()`.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport, getDefaultEnvironment } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');
const oauth = require('./oauth.cjs');
const { skillTools } = require('./skills.cjs');
const { serverTarget } = require('./sources.cjs');

const CONNECT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;
const RETRY_FAILED_MS = 60_000;
const MAX_RESULT_CHARS = 60_000;
const SKILLS_KEY = 'skills';

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(
    () => clearTimeout(timer),
  );
}

let pathCache = null;
/** GUI apps don't inherit the login shell's PATH, which servers launched with npx/uvx rely on. */
function shellPath() {
  if (!pathCache) {
    const shell = process.env.SHELL || '/bin/zsh';
    pathCache = new Promise((resolve) =>
      execFile(shell, ['-ilc', 'printf %s "$PATH"'], { timeout: 5000 }, (err, out) =>
        resolve(!err && out.trim() ? out.trim().split('\n').pop() : process.env.PATH || '/usr/bin:/bin'),
      ),
    );
  }
  return pathCache;
}

/** Tool names the Responses API accepts: ^[a-zA-Z0-9_-]{1,64}$, unique across servers. */
function toolName(prefix, name, taken) {
  const base = `${prefix}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  let out = base;
  for (let n = 2; taken.has(out); n++) out = `${base.slice(0, 60)}_${n}`;
  taken.add(out);
  return out;
}

/** Flattens an MCP tool result into text a model can read. */
function resultText(result) {
  const parts = (result?.content ?? []).map((c) => {
    if (c.type === 'text') return c.text;
    if (c.type === 'resource') return c.resource?.text ?? `[resource ${c.resource?.uri ?? ''}]`;
    if (c.type === 'resource_link') return `[${c.name ?? 'resource'}: ${c.uri}]`;
    return `[${c.type} content omitted]`;
  });
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join('\n') || '(no output)';
  const clipped = text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n…(truncated)` : text;
  return result?.isError ? `Error: ${clipped}` : clipped;
}

function describeError(err) {
  if (err instanceof UnauthorizedError || /\b401\b|unauthori[sz]ed|invalid_token/i.test(err?.message ?? '')) {
    return { status: 'needs-auth', error: 'Sign in to use this server.' };
  }
  const message = err?.code === 'ENOENT' ? 'Command not found on this Mac.' : err?.message || 'Could not connect.';
  return { status: 'error', error: message.slice(0, 300) };
}

function createHost({ store, openExternal, skillsServerPath }) {
  const live = new Map();

  async function open(server) {
    const secrets = store.secrets(server.id);
    let transport;
    if (server.transport === 'stdio') {
      transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        cwd: server.cwd && fs.existsSync(server.cwd) ? server.cwd : undefined,
        env: { ...getDefaultEnvironment(), PATH: await shellPath(), ...secrets.env },
        stderr: 'ignore',
      });
    } else {
      const authProvider = secrets.headers.Authorization ? undefined : oauth.createProvider(store, server.id);
      const opts = { requestInit: { headers: secrets.headers }, authProvider };
      const url = new URL(server.url);
      transport = server.transport === 'sse' ? new SSEClientTransport(url, opts) : new StreamableHTTPClientTransport(url, opts);
    }
    const client = new Client({ name: 'Jarvis', version: '0.1.0' });
    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'Timed out connecting.');
      const tools = [];
      let cursor;
      do {
        const page = await withTimeout(client.listTools(cursor ? { cursor } : undefined), CONNECT_TIMEOUT_MS, 'Timed out listing tools.');
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return { client, tools };
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    }
  }

  /** Connects once; failures are remembered briefly so each message doesn't retry a broken server. */
  function connect(server) {
    const existing = live.get(server.id);
    if (existing && !(existing.status !== 'connected' && existing.status !== 'connecting' && Date.now() - existing.at > RETRY_FAILED_MS)) {
      return existing.promise;
    }
    const entry = { status: 'connecting', tools: [], error: null, at: Date.now(), client: null };
    entry.promise = open(server).then(
      ({ client, tools }) => {
        Object.assign(entry, { client, tools, status: 'connected' });
        client.onclose = () => live.get(server.id) === entry && live.delete(server.id);
      },
      (err) => Object.assign(entry, describeError(err), { at: Date.now() }),
    );
    live.set(server.id, entry);
    return entry.promise;
  }

  async function disconnect(id) {
    const entry = live.get(id);
    live.delete(id);
    await entry?.client?.close().catch(() => {});
  }

  const enabled = () => store.servers().filter((s) => s.enabled);

  /** All tools from enabled servers plus skills: [{ name, description, parameters, run(args) }]. */
  async function catalog() {
    const servers = enabled();
    await Promise.all(servers.map(connect));
    const taken = new Set();
    const tools = [];
    for (const server of servers) {
      const entry = live.get(server.id);
      if (entry?.status !== 'connected') continue;
      for (const tool of entry.tools) {
        tools.push({
          name: toolName(server.key, tool.name, taken),
          description: `[${server.name}] ${tool.description ?? ''}`.slice(0, 1024),
          parameters: tool.inputSchema ?? { type: 'object', properties: {} },
          run: async (args) =>
            resultText(
              await entry.client.callTool({ name: tool.name, arguments: args ?? {} }, undefined, { timeout: CALL_TIMEOUT_MS }),
            ),
        });
      }
    }
    for (const tool of skillTools(store.skills())) {
      tools.push({ name: toolName(SKILLS_KEY, tool.name, taken), description: tool.description, parameters: tool.inputSchema, run: tool.run });
    }
    return tools;
  }

  /** Server list for Settings, with live connection state. */
  function status() {
    return store.servers().map((s) => {
      const entry = live.get(s.id);
      return {
        id: s.id,
        name: s.name,
        label: s.label,
        transport: s.transport,
        target: serverTarget(s),
        enabled: s.enabled,
        status: !s.enabled ? 'off' : (entry?.status ?? 'idle'),
        error: entry?.error ?? null,
        toolCount: entry?.tools.length ?? 0,
      };
    });
  }

  async function signIn(id) {
    const server = store.servers().find((s) => s.id === id);
    if (!server || server.transport === 'stdio') throw new Error('This server does not use sign-in.');
    await disconnect(id);
    await oauth.signIn(oauth.createProvider(store, id), server.url, openExternal);
    await connect(server);
  }

  async function refresh() {
    await Promise.all([...live.keys()].map(disconnect));
    await Promise.all(enabled().map(connect));
  }

  /**
   * Claude Code `--mcp-config` for the same servers. Remote servers get Jarvis's OAuth token as a header,
   * since Claude Code can't sign in on its own in print mode.
   */
  async function claudeConfig() {
    const mcpServers = {};
    for (const s of enabled()) {
      const secrets = store.secrets(s.id);
      if (s.transport === 'stdio') {
        mcpServers[s.key] = { type: 'stdio', command: s.command, args: s.args, env: { PATH: await shellPath(), ...secrets.env } };
      } else {
        const headers = { ...secrets.headers };
        if (!headers.Authorization) {
          const bearer = await oauth.bearerHeader(oauth.createProvider(store, s.id), s.url);
          if (bearer) headers.Authorization = bearer;
        }
        mcpServers[s.key] = { type: s.transport, url: s.url, headers };
      }
    }
    if (store.skills().length) {
      mcpServers[SKILLS_KEY] = {
        type: 'stdio',
        command: process.execPath,
        args: [skillsServerPath, path.join(path.dirname(store.skillsDir), 'skills.json')],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      };
    }
    return { mcpServers };
  }

  return { catalog, status, connect, disconnect, signIn, refresh, claudeConfig };
}

module.exports = { createHost, toolName, resultText, describeError };
