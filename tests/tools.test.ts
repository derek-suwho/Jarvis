import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
