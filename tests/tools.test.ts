import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import claude from '../electron/claude-code.cjs';
import inference from '../electron/chatgpt-inference.cjs';
import host from '../electron/tools/host.cjs';
import skills from '../electron/tools/skills.cjs';
import sources from '../electron/tools/sources.cjs';
import store from '../electron/tools/store.cjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- scan records come from untyped CommonJS
type Item = any;
let home: string;
const write = (rel: string, content: string) => {
  const file = path.join(home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
const skill = (dir: string, name: string, description: string) =>
  write(`${dir}/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\nDo the thing.`);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tools-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

function fixture() {
  write(
    '.codex/config.toml',
    `[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env = { API_KEY = "secret-1" }

[mcp_servers.gitlab]
url = "https://gitlab.com/api/v4/mcp"
bearer_token_env_var = "GITLAB_TOKEN"

[mcp_servers.old]
command = "old-server"
enabled = false

[mcp_servers.higgsfield]
url = "https://mcp.higgsfield.ai/mcp"

[plugins."figma@market"]
enabled = true
`,
  );
  write(
    '.codex/plugins/cache/market/figma/1.0.0/.mcp.json',
    JSON.stringify({ mcpServers: { figma: { type: 'http', url: 'https://mcp.figma.com/mcp', headers: { 'X-Bundle': 'b' } } } }),
  );
  skill('.codex/plugins/cache/market/figma/1.0.0/skills', 'figma-use', 'Use Figma');
  skill('.codex/skills', 'game-idea', 'Check game ideas');
  write(
    '.claude.json',
    JSON.stringify({
      mcpServers: { higgsfield: { type: 'http', url: 'https://mcp.higgsfield.ai/mcp' } },
      projects: { '/Users/me/app': { mcpServers: { db: { command: 'db-mcp' } } } },
    }),
  );
  skill('.claude/skills', 'copywriting', 'Write copy');
  skill('.claude/skills', 'game-idea', 'Duplicate name');
  const root = path.join(home, '.claude/plugins/cache/m/tool/1.0');
  write('.claude/plugins/cache/m/tool/1.0/.mcp.json', JSON.stringify({ mcpServers: { tool: { command: '${CLAUDE_PLUGIN_ROOT}/bin/tool', args: ['--key', '${TOOL_KEY:-none}'] } } }));
  write('.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'tool@m': [{ installPath: root }] } }));
  return root;
}

describe('sources.scan', () => {
  it('finds servers and skills across Codex, Claude Code and plugins', () => {
    const root = fixture();
    const result = sources.scan({ home, env: { GITLAB_TOKEN: 'glpat' } });
    const byName: Record<string, Item> = Object.fromEntries(result.servers.map((s: Item) => [s.name, s]));

    expect(byName.context7).toMatchObject({ transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] });
    expect(byName.context7.secrets.env).toEqual({ API_KEY: 'secret-1' });
    expect(byName.gitlab.secrets.headers).toEqual({ Authorization: 'Bearer glpat' });
    expect(byName.old.disabled).toBe(true);
    expect(byName.figma).toMatchObject({ transport: 'http', label: 'Codex plugin · figma' });
    expect(byName.tool).toMatchObject({ command: `${root}/bin/tool`, args: ['--key', 'none'] });
    expect(byName.db.project).toBe(true);
    // Same name and URL in Codex and Claude Code is imported once.
    expect(result.servers.filter((s: { name: string }) => s.name === 'higgsfield')).toHaveLength(1);
    expect(result.skills.map((s: { name: string }) => s.name).sort()).toEqual(['copywriting', 'figma-use', 'game-idea']);
  });

  it('previews without secret values and leaves disabled or project servers unselected', () => {
    fixture();
    const view = sources.preview(sources.scan({ home, env: { GITLAB_TOKEN: 'glpat' } }));
    expect(JSON.stringify(view)).not.toMatch(/secret-1|glpat/);
    const find = (name: string) => view.servers.find((s: { name: string }) => s.name === name);
    expect(find('context7')).toMatchObject({ secretKeys: ['API_KEY'], selected: true });
    expect(find('old').selected).toBe(false);
    expect(find('db').selected).toBe(false);
  });

  it('returns nothing on a Mac without these apps', () => {
    expect(sources.scan({ home, env: {} })).toMatchObject({ servers: [], skills: [] });
  });
});

describe('serverTarget', () => {
  it('keeps URL login credentials out of import previews and server status', () => {
    const server = sources.normalizeServer('private', {
      url: 'https://private-user:private-password@example.test/mcp?project=public',
    }, { source: 'test', label: 'Test', env: {}, root: undefined });
    if (!server || !('url' in server)) throw new Error('Expected HTTP fixture');
    const preview = sources.preview({ servers: [server], skills: [], notes: [] });
    const runtime = host.createHost({
      store: { servers: () => [{ ...server, enabled: true }] },
      openExternal: vi.fn(),
      skillsServerPath: '',
    });
    for (const view of [preview.servers[0], runtime.status()[0]]) {
      expect(view.target).toBe('https://%E2%80%A2%E2%80%A2%E2%80%A2:%E2%80%A2%E2%80%A2%E2%80%A2@example.test/mcp?project=public');
      expect(JSON.stringify(view)).not.toMatch(/private-user|private-password/);
    }
    // Display redaction must not rewrite the actual connection configuration.
    expect(server.url).toContain('private-user:private-password@');
  });

  it('masks keys passed as arguments or query params', () => {
    const stdio = { transport: 'stdio', command: 'npx', args: ['ctx', '--api-key', 'abc', '--token=xyz', 'ctx7sk-123', 'plain'] };
    expect(sources.serverTarget(stdio)).toBe('npx ctx --api-key ••• --token=••• ••• plain');
    expect(sources.serverTarget({ transport: 'http', url: 'https://x.dev/mcp?project=p&api_key=k' })).toBe(
      'https://x.dev/mcp?project=p&api_key=%E2%80%A2%E2%80%A2%E2%80%A2',
    );
  });
});

describe('parseFrontmatter', () => {
  it('reads plain, quoted and folded values', () => {
    expect(sources.parseFrontmatter('---\nname: "a"\ndescription: >\n  one\n  two\nmetadata:\n  v: 1\n---\nbody')).toEqual({
      name: 'a',
      description: 'one two',
    });
  });
});

describe('store', () => {
  it.each([
    ['test:safe', 'test-safe'],
    ['test:Safe', 'test:safe'],
    [`test:${'a'.repeat(60)}first`, `test:${'a'.repeat(60)}second`],
  ])('rejects a colliding skill ID without overwriting %s', (firstId, secondId) => {
    skill('lib', 'safe', 'Safe skill');
    skill('lib', 'other', 'Other skill');
    const s = store.createStore(path.join(home, 'jarvis'));
    const scanned = { id: firstId, name: 'safe', description: 'Safe skill', label: 'Test', dir: path.join(home, 'lib/safe') };
    const original = s.addSkill(scanned);
    const originalText = fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8');
    expect(() => s.addSkill({ ...scanned, id: secondId, dir: path.join(home, 'lib/other') })).toThrow(/skill.*folder.*another/i);
    expect(s.skills()).toEqual([original]);
    expect(fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8')).toBe(originalText);
    expect(fs.readdirSync(s.skillsDir)).toEqual([path.basename(original.folder)]);
    // Reimporting the same identity must remain supported.
    expect(s.addSkill(scanned)).toEqual(original);
  });

  it.each(['preflight', 'copy'])('rejects an ancestor replaced before child validation during %s', (phase) => {
    skill('lib', 'safe', 'Safe skill');
    write('lib/safe/references/note.txt', 'safe supporting content');
    write('outside/references/note.txt', 'private fixture content');
    const root = path.join(home, 'lib/safe');
    const child = path.join(root, 'references');
    const scanned = { id: 'test:safe', name: 'safe', description: 'Safe skill', label: 'Test', dir: root };
    const s = store.createStore(path.join(home, 'jarvis'));
    const original = s.addSkill(scanned);
    const lstat = fs.lstatSync;
    const opendir = fs.opendirSync;
    let rootOpens = 0;
    let replaced = false;
    let traversed = false;
    const statSpy = vi.spyOn(fs, 'lstatSync').mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
      if (args[0] === child && !replaced && rootOpens === (phase === 'preflight' ? 1 : 2)) {
        fs.renameSync(root, `${root}.previous`);
        fs.renameSync(path.join(home, 'outside'), root);
        replaced = true;
      }
      return lstat(...args);
    });
    const openSpy = vi.spyOn(fs, 'opendirSync').mockImplementation((...args: Parameters<typeof fs.opendirSync>) => {
      if (args[0] === root) rootOpens++;
      if (args[0] === child && replaced) traversed = true;
      return opendir(...args);
    });
    try {
      expect(() => s.addSkill(scanned)).toThrow(/changed during import/i);
      expect(replaced).toBe(true);
      expect(traversed).toBe(false);
    } finally {
      statSpy.mockRestore();
      openSpy.mockRestore();
    }
    expect(s.skills()).toEqual([original]);
    expect(fs.readFileSync(path.join(original.folder, 'references/note.txt'), 'utf8')).toBe('safe supporting content');
    expect(fs.readdirSync(s.skillsDir)).toEqual([path.basename(original.folder)]);
  });

  it.each(['preflight', 'copy'])('rejects a directory substituted while opening during %s', (phase) => {
    skill('lib', 'safe', 'Safe skill');
    write('lib/safe/references/note.txt', 'safe supporting content');
    write('outside/note.txt', 'private fixture content');
    const dir = path.join(home, 'lib/safe');
    const target = path.join(dir, 'references');
    const scanned = { id: 'test:safe', name: 'safe', description: 'Safe skill', label: 'Test', dir };
    const s = store.createStore(path.join(home, 'jarvis'));
    const original = s.addSkill(scanned);
    const opendir = fs.opendirSync;
    let visits = 0;
    let replaced = false;
    let closed = false;
    const spy = vi.spyOn(fs, 'opendirSync').mockImplementation((...args: Parameters<typeof fs.opendirSync>) => {
      if (args[0] === target && ++visits === (phase === 'preflight' ? 1 : 2)) {
        fs.renameSync(target, `${target}.previous`);
        fs.symlinkSync(path.join(home, 'outside'), target);
        replaced = true;
        const handle = opendir(...args);
        const close = handle.closeSync.bind(handle);
        handle.closeSync = () => { closed = true; close(); };
        return handle;
      }
      return opendir(...args);
    });
    try {
      expect(() => s.addSkill(scanned)).toThrow(/changed during import/i);
      expect(replaced).toBe(true);
      expect(closed).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(s.skills()).toEqual([original]);
    expect(fs.readFileSync(path.join(original.folder, 'references/note.txt'), 'utf8')).toBe('safe supporting content');
    expect(fs.readdirSync(s.skillsDir)).toEqual([path.basename(original.folder)]);
  });

  it.each(['file', 'directory'])('rejects a %s substituted before the import file opens', (kind) => {
    skill('lib', 'safe', 'Safe skill');
    const target = write('lib/safe/references/note.txt', 'safe supporting content');
    const outside = write('outside/note.txt', 'private fixture content');
    const scanned = { id: 'test:safe', name: 'safe', description: 'Safe skill', label: 'Test', dir: path.join(home, 'lib/safe') };
    const s = store.createStore(path.join(home, 'jarvis'));
    const original = s.addSkill(scanned);
    const open = fs.openSync;
    let replaced = false;
    const spy = vi.spyOn(fs, 'openSync').mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      if (args[0] === target && !replaced) {
        replaced = true;
        const replacedPath = kind === 'file' ? target : path.dirname(target);
        fs.renameSync(replacedPath, `${replacedPath}.previous`);
        if (kind === 'file') fs.copyFileSync(outside, target);
        else fs.symlinkSync(path.dirname(outside), replacedPath);
      }
      return open(...args);
    });
    try {
      expect(() => s.addSkill(scanned)).toThrow(/changed during import/i);
      expect(replaced).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(s.skills()).toEqual([original]);
    expect(fs.readFileSync(path.join(original.folder, 'references/note.txt'), 'utf8')).toBe('safe supporting content');
    expect(fs.readdirSync(s.skillsDir)).toEqual([path.basename(original.folder)]);
  });

  it.each(['copy failure', 'late link'])('preserves the installed skill after a %s during replacement', (failure) => {
    skill('lib', 'safe', 'Safe skill');
    const scanned = { id: 'test:safe', name: 'safe', description: 'Safe skill', label: 'Test', dir: path.join(home, 'lib/safe') };
    const s = store.createStore(path.join(home, 'jarvis'));
    const original = s.addSkill(scanned);
    const originalText = fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8');
    write('lib/safe/SKILL.md', 'replacement instructions');
    const privateFile = write('outside/private.txt', 'private fixture content');
    const read = fs.readSync;
    const spy = vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
      if (failure === 'copy failure') throw new Error('source disappeared during copy');
      // A link appears in staging after copying begins; publication must still reject it.
      const staging = fs.readdirSync(s.skillsDir).find((name) => name.startsWith('.import-'))!;
      fs.symlinkSync(privateFile, path.join(s.skillsDir, staging, 'skill', 'late-link'));
      spy.mockRestore();
      return read(...args);
    });
    try {
      expect(() => s.addSkill(scanned)).toThrow(failure === 'copy failure' ? /source disappeared/ : /symbolic link/i);
    } finally {
      spy.mockRestore();
    }
    expect(s.skills()).toEqual([original]);
    expect(fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8')).toBe(originalText);
    expect(fs.readdirSync(path.dirname(original.folder))).toEqual([path.basename(original.folder)]);
    expect(fs.readdirSync(original.folder)).toEqual(['SKILL.md']);
  });

  it('stops a file growing during copy at the byte budget and preserves the installation', () => {
    skill('lib', 'safe', 'Safe skill');
    const dir = path.join(home, 'lib/safe');
    const scanned = { id: 'test:safe', name: 'safe', description: 'Safe skill', label: 'Test', dir };
    const s = store.createStore(path.join(home, 'jarvis'));
    const original = s.addSkill(scanned);
    const originalText = fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8');
    // Grow the already-open source after validation, before the first copy read.
    const read = fs.readSync;
    let grown = false;
    const spy = vi.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
      if (!grown) {
        grown = true;
        fs.truncateSync(path.join(dir, 'SKILL.md'), 12 * 1024 * 1024);
      }
      return read(...args);
    });
    const writeSpy = vi.spyOn(fs, 'writeSync');
    try {
      expect(() => s.addSkill(scanned)).toThrow(/skill import.*limit/i);
      const bytesWritten = writeSpy.mock.results.reduce((sum, result) => sum + (result.type === 'return' ? Number(result.value) : 0), 0);
      expect(bytesWritten).toBeLessThanOrEqual(10 * 1024 * 1024);
    } finally {
      spy.mockRestore();
      writeSpy.mockRestore();
    }
    expect(s.skills()).toEqual([original]);
    expect(fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8')).toBe(originalText);
    expect(fs.readdirSync(s.skillsDir)).toEqual([path.basename(original.folder)]);
  });

  it.each(['depth', 'entries', 'bytes'])('rejects imports exceeding the %s budget without replacing an installed skill', (budget) => {
    skill('lib', 'safe', 'Safe skill');
    const dir = path.join(home, 'lib/safe');
    const scanned = { id: 'test:safe', name: 'safe', description: 'Safe skill', label: 'Test', dir };
    const s = store.createStore(path.join(home, 'jarvis'));
    const original = s.addSkill(scanned);
    const originalText = fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8');
    if (budget === 'depth') {
      write(`lib/safe/${Array(17).fill('nested').join('/')}/file.txt`, 'too deep');
    } else if (budget === 'entries') {
      for (let i = 0; i < 1000; i++) write(`lib/safe/file-${i}.txt`, '');
    } else {
      // Sparse files exercise the aggregate limit without allocating a large fixture.
      for (let i = 0; i < 2; i++) {
        const file = write(`lib/safe/large-${i}.bin`, '');
        fs.truncateSync(file, 6 * 1024 * 1024);
      }
    }
    expect(() => s.addSkill(scanned)).toThrow(/skill import.*limit/i);
    expect(s.skills()).toEqual([original]);
    expect(fs.readdirSync(original.folder)).toEqual(['SKILL.md']);
    expect(fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8')).toBe(originalText);
  });

  it.each(['file', 'directory', 'root'])('rejects a linked %s without replacing the installed skill', (kind) => {
    skill('lib', 'safe', 'Safe skill');
    const dir = path.join(home, 'lib/safe');
    const scanned = { id: 'test:safe', name: 'safe', description: 'Safe skill', label: 'Test', dir };
    const s = store.createStore(path.join(home, 'jarvis'));
    const original = s.addSkill(scanned);
    const originalText = fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8');
    write('outside/private.txt', 'private fixture content');
    if (kind === 'root') {
      fs.symlinkSync(dir, path.join(home, 'linked-root'));
      scanned.dir = path.join(home, 'linked-root');
    } else {
      fs.symlinkSync(path.join(home, kind === 'file' ? 'outside/private.txt' : 'outside'), path.join(dir, 'linked'));
    }
    expect(() => s.addSkill(scanned)).toThrow(/symbolic link/i);
    expect(s.skills()).toEqual([original]);
    expect(fs.readFileSync(path.join(original.folder, 'SKILL.md'), 'utf8')).toBe(originalText);
    expect(fs.existsSync(path.join(original.folder, 'linked'))).toBe(false);
  });

  it('isolates credential-bearing URLs while preserving runtime configuration after restart', async () => {
    const url = 'https://fixture-user:fixture-password@example.test/mcp?api_key=fixture-key&project=public';
    const scanned = sources.normalizeServer('private', { url, headers: { Authorization: 'Bearer fixture' } },
      { source: 'test', label: 'Test', env: {}, root: undefined });
    if (!scanned) throw new Error('Expected HTTP fixture');
    const dir = path.join(home, 'jarvis');
    const added = store.createStore(dir).addServer(scanned);
    const publicJson = fs.readFileSync(path.join(dir, 'servers.json'), 'utf8');
    expect(publicJson).not.toMatch(/fixture-user|fixture-password|fixture-key/);
    expect(JSON.stringify(added)).not.toMatch(/fixture-user|fixture-password|fixture-key/);
    const restarted = store.createStore(dir);
    expect(restarted.secrets(added.id)).toMatchObject({ url });
    expect(fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777).toBe(0o600);
    const runtime = host.createHost({ store: restarted, openExternal: vi.fn(), skillsServerPath: '' });
    const config: Item = await runtime.claudeConfig();
    expect(config.mcpServers.private.url).toBe(url);
    expect(JSON.stringify(runtime.status())).not.toMatch(/fixture-user|fixture-password|fixture-key/);

    const clean = sources.normalizeServer('private', { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer fixture' } },
      { source: 'test', label: 'Test', env: {}, root: undefined });
    if (!clean) throw new Error('Expected HTTP fixture');
    restarted.addServer(clean);
    expect(restarted.secrets(added.id).url).toBeUndefined();
    const cleanConfig: Item = await runtime.claudeConfig();
    expect(cleanConfig.mcpServers.private.url).toBe('https://example.test/mcp');
  });

  it('migrates legacy credential URLs before exposing records and preserves them across restarts', async () => {
    const url = 'https://legacy-user:legacy-password@example.test/mcp?api_key=legacy-key&project=public';
    const dir = path.join(home, 'jarvis');
    const record = { id: 'test:legacy', key: 'legacy', name: 'Legacy', transport: 'http', url, enabled: false };
    write('jarvis/servers.json', JSON.stringify([record]));
    const existing = { env: { FIXTURE: 'value' }, headers: { Authorization: 'Bearer fixture' }, oauth: { fixture: true } };
    write('jarvis/secrets.json', JSON.stringify({ [record.id]: existing, unrelated: { env: { KEEP: 'yes' } } }));

    const migrated = store.createStore(dir);
    expect(JSON.stringify(migrated.servers())).not.toMatch(/legacy-user|legacy-password|legacy-key/);
    expect(fs.readFileSync(path.join(dir, 'servers.json'), 'utf8')).not.toMatch(/legacy-user|legacy-password|legacy-key/);
    expect(migrated.servers()[0]).toMatchObject({ ...record, url: expect.stringContaining('project=public') });
    expect(migrated.secrets(record.id)).toEqual({ ...existing, url });
    expect(migrated.secrets('unrelated')).toEqual({ env: { KEEP: 'yes' } });
    expect(fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777).toBe(0o600);

    const restarted = store.createStore(dir);
    expect(restarted.secrets(record.id)).toEqual({ ...existing, url });
    restarted.setEnabled(record.id, true);
    const runtime = host.createHost({ store: restarted, openExternal: vi.fn(), skillsServerPath: '' });
    const config: Item = await runtime.claudeConfig();
    expect(config.mcpServers.legacy.url).toBe(url);
  });

  it.each(['__proto__', 'constructor', 'toString'])('preserves private URLs for special-property identity %s across migration and restart', (id) => {
    const dir = path.join(home, 'jarvis');
    const empty = store.createStore(dir);
    expect(empty.secrets(id)).toEqual({ env: {}, headers: {} });
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    write('jarvis/servers.json', JSON.stringify([{ id, transport: 'http', url }]));
    write('jarvis/secrets.json', JSON.stringify({ unrelated: { env: { KEEP: 'fixture' } } }));

    const migrated = store.createStore(dir);
    expect(JSON.stringify(migrated.servers())).not.toContain('fixture-password');
    expect(migrated.secrets(id)).toEqual({ env: {}, headers: {}, url });
    const restarted = store.createStore(dir);
    expect(restarted.secrets(id)).toEqual({ env: {}, headers: {}, url });
    restarted.saveSecrets(id, { headers: { Authorization: 'Bearer fixture' } });
    expect(store.createStore(dir).secrets(id)).toEqual({ env: {}, headers: { Authorization: 'Bearer fixture' }, url });
    expect(restarted.secrets('unrelated')).toEqual({ env: { KEEP: 'fixture' } });
    restarted.removeServer(id);
    expect(store.createStore(dir).secrets(id)).toEqual({ env: {}, headers: {} });
  });

  it.each(['{}', 'null', '"invalid"', '42', '{broken-json', '[null]', '[[]]', '[42]', '["invalid"]'])(
    'preserves malformed public registry (%s) and recovers after repair', (malformed) => {
      const dir = path.join(home, 'jarvis');
      const publicFile = write('jarvis/servers.json', malformed);
      const privateData = JSON.stringify({ unrelated: { env: { KEEP: 'fixture' } } });
      const privateFile = write('jarvis/secrets.json', privateData);

      expect(() => store.createStore(dir)).toThrow('Invalid tool server storage');
      expect(fs.readFileSync(publicFile, 'utf8')).toBe(malformed);
      expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);

      const url = 'https://fixture-user:fixture-password@example.test/mcp';
      write('jarvis/servers.json', JSON.stringify([{ id: 'test:repaired', transport: 'http', url }]));
      const recovered = store.createStore(dir);
      expect(recovered.secrets('test:repaired').url).toBe(url);
      expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
      expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
    },
  );

  it.each([undefined, null, '', '   ', 42, {}, []])('rejects invalid legacy identity %j before migrating and recovers after repair', (id) => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id, transport: 'http', url }]);
    const privateData = JSON.stringify({ unrelated: { env: { KEEP: 'fixture' } } });
    const publicFile = write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', privateData);

    expect(() => store.createStore(dir)).toThrow('Invalid tool server identities');
    expect(fs.readFileSync(publicFile, 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);

    write('jarvis/servers.json', JSON.stringify([{ id: 'test:repaired', transport: 'http', url }]));
    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:repaired').url).toBe(url);
    expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
  });

  it('rejects duplicate legacy identities without losing either private URL and recovers after repair', () => {
    const dir = path.join(home, 'jarvis');
    const first = { id: 'test:legacy', transport: 'http', url: 'https://first:fixture-password@example.test/mcp' };
    const second = { ...first, url: 'https://second:other-password@example.test/mcp' };
    const records = JSON.stringify([first, second]);
    const privateData = JSON.stringify({ unrelated: { env: { KEEP: 'fixture' } } });
    const publicFile = write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', privateData);

    expect(() => store.createStore(dir)).toThrow('Invalid tool server identities');
    expect(fs.readFileSync(publicFile, 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);

    write('jarvis/servers.json', JSON.stringify([first, { ...second, id: 'test:second' }]));
    const recovered = store.createStore(dir);
    expect(recovered.secrets(first.id).url).toBe(first.url);
    expect(recovered.secrets('test:second').url).toBe(second.url);
    expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
    expect(JSON.stringify(recovered.servers())).not.toMatch(/fixture-password|other-password/);
  });

  it.each(['[]', 'null', '"invalid"', '42', '{broken-json'])('preserves legacy URLs when private storage is malformed (%s)', (malformed) => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id: 'test:legacy', transport: 'http', url }]);
    write('jarvis/servers.json', records);
    write('jarvis/secrets.json', malformed);

    expect(() => store.createStore(dir)).toThrow('Invalid private tool storage');
    expect(fs.readFileSync(path.join(dir, 'servers.json'), 'utf8')).toBe(records);
    expect(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).toBe(malformed);

    write('jarvis/secrets.json', '{}');
    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:legacy').url).toBe(url);
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
  });

  it.each([null, [], 'private-fixture-value', 42, false])('preserves malformed private records (%j) before migration and recovers after repair', (malformed) => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id: 'test:legacy', transport: 'http', url }]);
    const privateData = JSON.stringify({ 'test:legacy': malformed, unrelated: { env: { KEEP: 'fixture' } } });
    const publicFile = write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', privateData);

    expect(() => store.createStore(dir)).toThrow('Invalid private tool storage');
    expect(fs.readFileSync(publicFile, 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);

    write('jarvis/secrets.json', JSON.stringify({ 'test:legacy': { headers: { Authorization: 'Bearer fixture' } }, unrelated: { env: { KEEP: 'fixture' } } }));
    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:legacy')).toEqual({ env: {}, headers: { Authorization: 'Bearer fixture' }, url });
    expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
  });

  it.each(['env', 'headers'].flatMap((field) =>
    [null, [], 'fixture-secret', 42, false, { TOKEN: 42 }, { TOKEN: null }].map((value) => ({ field, value })),
  ))('preserves malformed private $field ($value) before migration and recovers after repair', ({ field, value }) => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id: 'test:legacy', transport: 'http', url }]);
    const privateData = JSON.stringify({ 'test:legacy': { [field]: value }, unrelated: { env: { KEEP: 'fixture' } } });
    const publicFile = write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', privateData);

    expect(() => store.createStore(dir)).toThrow('Invalid private tool storage');
    expect(fs.readFileSync(publicFile, 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);

    write('jarvis/secrets.json', JSON.stringify({ 'test:legacy': { [field]: { TOKEN: 'fixture' } }, unrelated: { env: { KEEP: 'fixture' } } }));
    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:legacy')[field]).toEqual({ TOKEN: 'fixture' });
    expect(recovered.secrets('test:legacy').url).toBe(url);
    expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
  });

  it.each([null, [], {}, 42, false, '', 'not-a-url', '/relative', 'file:///private/fixture', 'javascript:fixture()'])('rejects malformed private connection URL (%j) without changing migration files', (value) => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id: 'test:legacy', transport: 'http', url }]);
    const privateData = JSON.stringify({ 'test:legacy': { url: value }, unrelated: { env: { KEEP: 'fixture' } } });
    const publicFile = write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', privateData);

    expect(() => store.createStore(dir)).toThrow('Invalid private tool storage');
    expect(fs.readFileSync(publicFile, 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);

    write('jarvis/secrets.json', JSON.stringify({ 'test:legacy': { url }, unrelated: { env: { KEEP: 'fixture' } } }));
    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:legacy').url).toBe(url);
    expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
    expect(store.createStore(dir).secrets('test:legacy').url).toBe(url);
  });

  it.each([
    ...[null, [], 'fixture-secret', 42, false].map((oauth) => ({ oauth })),
    ...['client', 'tokens'].flatMap((field) =>
      [null, [], 'fixture-secret', 42, false].map((value) => ({ oauth: { [field]: value } }))),
    ...[null, [], {}, 42, false].map((verifier) => ({ oauth: { verifier } })),
  ])('rejects malformed persisted OAuth shape (%j) before migration and recovers after repair', (record) => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id: 'test:legacy', transport: 'http', url }]);
    const privateData = JSON.stringify({ 'test:legacy': record, unrelated: { env: { KEEP: 'fixture' } } });
    const publicFile = write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', privateData);

    expect(() => store.createStore(dir)).toThrow('Invalid private tool storage');
    expect(fs.readFileSync(publicFile, 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);

    const oauth = { client: { client_id: 'fixture-client' }, tokens: { access_token: 'fixture-token', token_type: 'Bearer' }, verifier: 'fixture-verifier' };
    write('jarvis/secrets.json', JSON.stringify({ 'test:legacy': { oauth }, unrelated: { env: { KEEP: 'fixture' } } }));
    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:legacy')).toMatchObject({ oauth, url });
    expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
    expect(store.createStore(dir).secrets('test:legacy')).toMatchObject({ oauth, url });
    recovered.saveSecrets('test:legacy', { oauth: {} });
    expect(store.createStore(dir).secrets('test:legacy').oauth).toEqual({});
  });

  it('preserves legacy files when private storage cannot be read and recovers on retry', () => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id: 'test:legacy', transport: 'http', url }]);
    const privateData = JSON.stringify({ unrelated: { env: { KEEP: 'fixture' } } });
    write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', privateData);
    const read = fs.readFileSync.bind(fs);
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === privateFile) throw Object.assign(new Error('fixture read failure'), { code: 'EACCES' });
      return read(...args);
    });
    try {
      expect(() => store.createStore(dir)).toThrow('Invalid private tool storage');
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(path.join(dir, 'servers.json'), 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);
    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:legacy').url).toBe(url);
    expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
  });

  it('refuses a preexisting staging symlink without leaking private migration data', () => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id: 'test:legacy', transport: 'http', url }]);
    const publicFile = write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', '{}');
    const unrelated = write('unrelated.txt', 'preserve this file');
    const staging = `${privateFile}.${process.pid}.tmp`;
    fs.symlinkSync(unrelated, staging);

    expect(() => store.createStore(dir)).toThrow();
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('preserve this file');
    expect(fs.readFileSync(publicFile, 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe('{}');
    expect(fs.lstatSync(staging).isSymbolicLink()).toBe(true);

    fs.unlinkSync(staging);
    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:legacy').url).toBe(url);
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
    expect(fs.statSync(privateFile).mode & 0o777).toBe(0o600);
  });

  it('cleans private staging data after a failed migration write and recovers on retry', () => {
    const dir = path.join(home, 'jarvis');
    const url = 'https://fixture-user:fixture-password@example.test/mcp';
    const records = JSON.stringify([{ id: 'test:legacy', transport: 'http', url }]);
    const privateData = JSON.stringify({ unrelated: { env: { KEEP: 'fixture' } } });
    const publicFile = write('jarvis/servers.json', records);
    const privateFile = write('jarvis/secrets.json', privateData);
    const rename = fs.renameSync.bind(fs);
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
      if (args[1] === privateFile) throw Object.assign(new Error('fixture write failure'), { code: 'EACCES' });
      return rename(...args);
    });
    try {
      expect(() => store.createStore(dir)).toThrow('fixture write failure');
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(publicFile, 'utf8')).toBe(records);
    expect(fs.readFileSync(privateFile, 'utf8')).toBe(privateData);
    expect(fs.readdirSync(dir).sort()).toEqual(['secrets.json', 'servers.json']);

    const recovered = store.createStore(dir);
    expect(recovered.secrets('test:legacy').url).toBe(url);
    expect(recovered.secrets('unrelated').env).toEqual({ KEEP: 'fixture' });
    expect(JSON.stringify(recovered.servers())).not.toContain('fixture-password');
  });

  it('keeps secrets apart, gives unique tool prefixes, and copies skills', () => {
    fixture();
    const scan = sources.scan({ home, env: {} });
    const s = store.createStore(path.join(home, 'jarvis'));
    const higgs: Item = scan.servers.find((x: Item) => x.name === 'higgsfield');
    const a = s.addServer(higgs);
    const b = s.addServer({ ...higgs, id: 'other:higgsfield' });
    expect([a.key, b.key]).toEqual(['higgsfield', 'higgsfield_2']);
    expect(s.addServer({ ...higgs, id: 'x:skills', name: 'skills' }).key).toBe('skills_2');

    const ctx = s.addServer(scan.servers.find((x: { name: string }) => x.name === 'context7'));
    expect(JSON.stringify(s.servers())).not.toContain('secret-1');
    expect(s.secrets(ctx.id).env).toEqual({ API_KEY: 'secret-1' });
    expect(fs.statSync(path.join(home, 'jarvis', 'secrets.json')).mode & 0o777).toBe(0o600);

    const copied = s.addSkill(scan.skills.find((x: { name: string }) => x.name === 'copywriting'));
    expect(fs.existsSync(path.join(copied.folder, 'SKILL.md'))).toBe(true);
    s.removeSkill(copied.id);
    expect(fs.existsSync(copied.folder)).toBe(false);
    expect(s.skills()).toEqual([]);
  });
});

describe('skills tools', () => {
  it('does not catalog children through an ancestor replaced before child validation', () => {
    skill('lib', 'safe', 'Safe skill');
    write('lib/safe/references/guide.txt', 'guide');
    write('unrelated/references/private-name.txt', 'private fixture');
    const root = path.join(home, 'lib/safe');
    const child = path.join(root, 'references');
    const lstat = fs.lstatSync;
    let replaced = false;
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) === child && !replaced) {
        replaced = true;
        fs.renameSync(root, `${root}-original`);
        fs.renameSync(path.join(home, 'unrelated'), root);
      }
      return lstat(...args);
    });
    try {
      const loaded = skills.loadSkill([{ name: 'safe', folder: root }], 'safe');
      expect(replaced).toBe(true);
      expect(loaded).toContain('# safe');
      expect(loaded).not.toContain('private-name.txt');
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['root', 'nested'])('does not catalog a %s directory substituted while opening', (kind) => {
    skill('lib', 'safe', 'Safe skill');
    write('lib/safe/references/guide.txt', 'guide');
    write('unrelated/private-name.txt', 'private fixture');
    const root = path.join(home, 'lib/safe');
    const target = kind === 'root' ? root : path.join(root, 'references');
    const opendir = fs.opendirSync;
    let substituted = false;
    let reads = 0;
    let closed = false;
    const spy = vi.spyOn(fs, 'opendirSync').mockImplementation((...args: Parameters<typeof fs.opendirSync>) => {
      if (String(args[0]) !== target) return opendir(...args);
      fs.renameSync(target, `${target}-original`);
      fs.symlinkSync(path.join(home, 'unrelated'), target, 'dir');
      substituted = true;
      const dir = opendir(...args);
      const read = dir.readSync.bind(dir);
      const close = dir.closeSync.bind(dir);
      dir.readSync = () => { reads++; return read(); };
      dir.closeSync = () => { closed = true; close(); };
      return dir;
    });
    try {
      const loaded = skills.loadSkill([{ name: 'safe', folder: root }], 'safe');
      expect(substituted).toBe(true);
      expect(loaded).toContain('# safe');
      expect(loaded).not.toContain('private-name.txt');
      expect(reads).toBe(0);
      expect(closed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('streams catalog entries within a shared budget and closes directory handles', () => {
    skill('lib', 'safe', 'Safe skill');
    for (let i = 0; i < 1100; i++) write(`lib/safe/.hidden-${i}`, 'ignored');
    const readdir = vi.spyOn(fs, 'readdirSync');
    const opendir = fs.opendirSync;
    let reads = 0;
    let opened = 0;
    let closed = 0;
    const spy = vi.spyOn(fs, 'opendirSync').mockImplementation((...args: Parameters<typeof fs.opendirSync>) => {
      const dir = opendir(...args);
      opened++;
      const read = dir.readSync.bind(dir);
      const close = dir.closeSync.bind(dir);
      dir.readSync = () => { reads++; return read(); };
      dir.closeSync = () => { closed++; close(); };
      return dir;
    });
    try {
      expect(skills.loadSkill([{ name: 'safe', folder: path.join(home, 'lib/safe') }], 'safe')).toContain('# safe');
      expect(readdir).not.toHaveBeenCalled();
      expect(opened).toBeGreaterThan(0);
      expect(reads).toBeLessThanOrEqual(1000);
      expect(closed).toBe(opened);
    } finally {
      spy.mockRestore();
      readdir.mockRestore();
    }
  });

  it('limits catalog descent while retaining ordinary supporting files', () => {
    skill('lib', 'safe', 'Safe skill');
    write('lib/safe/references/guide.txt', 'guide');
    const deep = `${'nested/'.repeat(17)}secret.txt`;
    write(`lib/safe/${deep}`, 'deep');
    const loaded = skills.loadSkill([{ name: 'safe', folder: path.join(home, 'lib/safe') }], 'safe');
    expect(loaded).toContain('references/guide.txt');
    expect(loaded).not.toContain(deep);
  });

  it('bounds file reads while preserving UTF-8 text across partial reads', () => {
    const content = 'aé界😀'.repeat(100_000);
    write('lib/safe/note.txt', content);
    const list = [{ name: 'safe', folder: path.join(home, 'lib/safe') }];
    const read = fs.readSync;
    let bytes = 0;
    const wholeFile = vi.spyOn(fs, 'readFileSync');
    const partial = vi.spyOn(fs, 'readSync').mockImplementation((fd: number, buffer: NodeJS.ArrayBufferView, offset: number | fs.ReadSyncOptions = 0, length?: number, position: fs.ReadPosition | null = null) => {
      const count = typeof offset === 'number'
        ? read(fd, buffer, offset, Math.min(Number(length), 4093), position)
        : read(fd, buffer, offset);
      bytes += count;
      return count;
    });
    try {
      expect(skills.readSkillFile(list, 'safe', 'note.txt')).toBe(content.slice(0, 100_000));
      expect(wholeFile).not.toHaveBeenCalled();
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThanOrEqual(400_000);
    } finally {
      partial.mockRestore();
      wholeFile.mockRestore();
    }
  });

  it.each(['root', 'nested'])('refuses a %s directory replaced during path validation', (kind) => {
    write('lib/safe/references/note.txt', 'safe content');
    write('unrelated/references/note.txt', 'private fixture content');
    write('unrelated/note.txt', 'private fixture content');
    const folder = path.join(home, 'lib/safe');
    const replacedPath = kind === 'root' ? folder : path.join(folder, 'references');
    const lstat = fs.lstatSync;
    let replaced = false;
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
      const result = lstat(...args);
      if (String(args[0]) === replacedPath && !replaced) {
        replaced = true;
        fs.renameSync(replacedPath, `${replacedPath}-original`);
        fs.renameSync(path.join(home, 'unrelated'), replacedPath);
      }
      return result;
    });
    try {
      expect(skills.readSkillFile([{ name: 'safe', folder }], 'safe', 'references/note.txt')).toBe('That path is outside the skill.');
      expect(replaced).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['file', 'directory'])('refuses a %s replaced between validation and opening', (kind) => {
    skill('lib', 'safe', 'Safe skill');
    const target = write('lib/safe/references/note.txt', 'safe supporting content');
    const outside = write('outside/note.txt', 'private fixture content');
    const folder = path.join(home, 'lib/safe');
    const realpath = fs.realpathSync;
    let replaced = false;
    const spy = vi.spyOn(fs, 'realpathSync').mockImplementation((...args: Parameters<typeof fs.realpathSync>) => {
      const resolved = realpath(...args);
      if (args[0] === target && !replaced) {
        replaced = true;
        const replacedPath = kind === 'file' ? target : path.dirname(target);
        fs.renameSync(replacedPath, `${replacedPath}.previous`);
        fs.symlinkSync(kind === 'file' ? outside : path.dirname(outside), replacedPath);
      }
      return resolved;
    });
    try {
      expect(skills.readSkillFile([{ name: 'safe', folder }], 'safe', 'references/note.txt')).toBe('Could not read references/note.txt.');
      expect(replaced).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['file', 'directory', 'instructions', 'root'])('refuses an installed skill with a linked %s at read time', (kind) => {
    skill('lib', 'safe', 'Safe skill');
    write('outside/private.txt', 'private fixture content');
    write('outside/SKILL.md', 'private fixture content');
    let folder = path.join(home, 'lib/safe');
    let requested = 'linked';
    if (kind === 'root') {
      fs.symlinkSync(path.join(home, 'outside'), path.join(home, 'linked-root'));
      folder = path.join(home, 'linked-root');
      requested = 'private.txt';
    } else if (kind === 'instructions') {
      fs.unlinkSync(path.join(folder, 'SKILL.md'));
      fs.symlinkSync(path.join(home, 'outside/private.txt'), path.join(folder, 'SKILL.md'));
      requested = 'SKILL.md';
    } else {
      fs.symlinkSync(path.join(home, kind === 'file' ? 'outside/private.txt' : 'outside'), path.join(folder, 'linked'));
      if (kind === 'directory') requested = 'linked/private.txt';
    }
    const list = [{ name: 'safe', folder }];
    expect(skills.readSkillFile(list, 'safe', requested)).toBe('That path is outside the skill.');
    const loaded = skills.loadSkill(list, 'safe');
    expect(loaded).not.toContain('private fixture content');
    expect(loaded).not.toContain('linked');
  });

  it('loads a skill and refuses paths outside it', () => {
    skill('lib', 'copywriting', 'Write copy');
    write('lib/copywriting/references/tone.md', 'Be warm.');
    const list = [{ name: 'copywriting', description: 'Write copy', folder: path.join(home, 'lib/copywriting') }];
    const [load, read] = skills.skillTools(list);
    expect(load.description).toContain('- copywriting: Write copy');
    expect(load.run({ name: 'copywriting' })).toContain('references/tone.md');
    expect(read.run({ name: 'copywriting', path: 'references/tone.md' })).toBe('Be warm.');
    expect(read.run({ name: 'copywriting', path: '../../.claude.json' })).toBe('That path is outside the skill.');
    expect(skills.skillTools([])).toEqual([]);
  });
});

describe('host helpers', () => {
  it('makes unique API-safe tool names', () => {
    const taken = new Set<string>();
    expect(host.toolName('git_hub', 'create.issue', taken)).toBe('git_hub__create_issue');
    expect(host.toolName('git_hub', 'create.issue', taken)).toBe('git_hub__create_issue_2');
    expect(host.toolName('x', 'y'.repeat(100), taken)).toHaveLength(64);
  });

  it('flattens tool results and flags errors', () => {
    expect(host.resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }] })).toBe('a\n[image content omitted]');
    expect(host.resultText({ content: [], structuredContent: { n: 1 } })).toBe('{"n":1}');
    expect(host.resultText({ content: [{ type: 'text', text: 'nope' }], isError: true })).toBe('Error: nope');
  });

  it('treats 401s as needing sign-in', () => {
    expect(host.describeError(new Error('HTTP 401 Unauthorized')).status).toBe('needs-auth');
    expect(host.describeError(Object.assign(new Error('spawn x'), { code: 'ENOENT' }))).toEqual({
      status: 'error',
      error: 'Command not found on this Mac.',
    });
  });
});

describe('ChatGPT tool calls', () => {
  const catalog = [{ name: 'skills__load_skill', description: 'd', parameters: { $schema: 'x', type: 'object' }, run: (a: { name: string }) => `loaded ${a.name}` }];

  it('converts tools to Responses API functions', () => {
    expect(inference.functionTools(catalog)).toEqual([
      { type: 'function', name: 'skills__load_skill', description: 'd', parameters: { type: 'object' }, strict: false },
    ]);
  });

  it('runs calls and reports bad ones back to the model', async () => {
    expect(await inference.runCall(catalog, { name: 'skills__load_skill', arguments: '{"name":"seo"}' })).toBe('loaded seo');
    expect(await inference.runCall(catalog, { name: 'skills__load_skill', arguments: '{' })).toBe('Tool arguments were not valid JSON.');
    expect(await inference.runCall(catalog, { name: 'missing', arguments: '{}' })).toBe('Unknown tool missing.');
  });
});

describe('tool activity events', () => {
  const catalog = [
    { name: 'skills__load_skill', server: 'Skills', tool: 'load_skill', description: '', parameters: {}, run: () => '' },
    { name: 'context7__query', server: 'context7', tool: 'query', description: '', parameters: {}, run: () => '' },
  ];

  it('labels ChatGPT calls by server and names the skill being loaded', () => {
    expect(inference.toolEvent(catalog, { call_id: 'c1', name: 'skills__load_skill', arguments: '{"name":"seo"}' }, 'running')).toEqual({
      type: 'tool',
      id: 'c1',
      server: 'Skills',
      tool: 'load_skill',
      detail: 'seo',
      status: 'running',
    });
    expect(inference.toolEvent(catalog, { call_id: 'c2', name: 'context7__query', arguments: '{' }, 'done')).toEqual({
      type: 'tool',
      id: 'c2',
      server: 'context7',
      tool: 'query',
      status: 'done',
    });
  });

  it('reads Claude Code tool starts and results from stream-json', () => {
    const label = (name: string) => ({ server: name.startsWith('mcp__skills') ? 'Skills' : 'Claude Code', tool: name.split('__').pop() });
    const start = claude.toolEvents(
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'mcp__skills__load_skill', input: { name: 'seo' } }] } },
      label,
    );
    expect(start).toEqual([{ type: 'tool', id: 't1', server: 'Skills', tool: 'load_skill', detail: 'seo', status: 'running' }]);
    const done = claude.toolEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } }, label);
    expect(done).toEqual([{ type: 'tool', id: 't1', server: '', tool: '', status: 'error' }]);
    expect(claude.toolEvents({ type: 'system' }, label)).toEqual([]);
  });
});


describe('tool revocation', () => {
  it('blocks retained tools after disable, removal or disconnect and closes late connections', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }));
    const clients: Item[] = [];
    let finishConnect: (() => void) | undefined;
    let pending = false;
    class Client {
      close = vi.fn(async () => {});
      callTool = callTool;
      constructor() { clients.push(this); }
      async connect() {
        if (pending) await new Promise<void>((resolve) => { finishConnect = resolve; });
      }
      async listTools() { return { tools: [{ name: 'write', inputSchema: { type: 'object' } }] }; }
    }
    const require = createRequire(import.meta.url);
    const mod = { exports: {} as Item };
    vm.runInNewContext(fs.readFileSync(new URL('../electron/tools/host.cjs', import.meta.url), 'utf8'), {
      module: mod, exports: mod.exports, setTimeout, clearTimeout, process, URL,
      require: (id: string) => id === '@modelcontextprotocol/sdk/client/index.js' ? { Client } : require(id.startsWith('./') ? `../electron/tools/${id.slice(2)}` : id),
    });
    const server = { id: 'test:write', key: 'write', name: 'Writer', transport: 'http', url: 'https://example.test/mcp', enabled: true };
    let servers = [server];
    const runtime = mod.exports.createHost({
      store: { servers: () => servers, secrets: () => ({ headers: { Authorization: 'fixture' } }), skills: () => [] },
      openExternal: vi.fn(), skillsServerPath: '',
    });
    const [tool] = await runtime.catalog();
    expect(await tool.run({})).toBe('done');
    callTool.mockClear();
    server.enabled = false;
    await expect(tool.run({})).rejects.toThrow(/revoked|disabled|unavailable/i);
    server.enabled = true;
    servers = [];
    await expect(tool.run({})).rejects.toThrow(/revoked|disabled|unavailable/i);
    servers = [server];
    await runtime.disconnect(server.id);
    await expect(tool.run({})).rejects.toThrow(/revoked|disabled|unavailable/i);
    expect(callTool).not.toHaveBeenCalled();
    pending = true;
    const connecting = runtime.connect(server);
    await runtime.disconnect(server.id);
    finishConnect!();
    await connecting;
    expect(clients[1].close).toHaveBeenCalledOnce();
    expect(runtime.status()[0].status).toBe('idle');
    pending = false;
    const [replacement] = await runtime.catalog();
    await expect(tool.run({})).rejects.toThrow(/revoked|disabled|unavailable/i);
    expect(await replacement.run({})).toBe('done');
    await runtime.disconnect(server.id);
  });
});
