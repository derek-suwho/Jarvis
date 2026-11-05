import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';

it.each(['async', 'sync'])('closes every MCP client once despite %s close failure, fences late connections, and prevents reopening after shutdown', async (failure) => {
  const clients: any[] = [];
  let finish!: () => void;
  class Client {
    close = vi.fn(() => {
      if (clients[0] === this) {
        if (failure === 'sync') throw new Error('close failed');
        return Promise.reject(new Error('close failed'));
      }
      return Promise.resolve();
    });
    callTool = vi.fn(async () => ({ content: [] }));
    constructor() { clients.push(this); }
    async connect() { if (clients.length === 3) await new Promise<void>((resolve) => { finish = resolve; }); }
    async listTools() { return { tools: [{ name: 'read' }] }; }
  }
  const require = createRequire(import.meta.url);
  const mod = { exports: {} as any };
  vm.runInNewContext(fs.readFileSync(new URL('../electron/tools/host.cjs', import.meta.url), 'utf8'), {
    module: mod, setTimeout, clearTimeout, process, URL,
    require: (id: string) => id === '@modelcontextprotocol/sdk/client/index.js' ? { Client }
      : require(id.startsWith('./') ? `../electron/tools/${id.slice(2)}` : id),
  });
  const servers = ['one', 'two', 'late'].map((id) => ({ id, key: id, name: id, enabled: true, transport: 'http', url: 'https://example.test/mcp' }));
  const runtime = mod.exports.createHost({ store: {
    servers: () => servers, skills: () => [], secrets: () => ({ headers: { Authorization: 'fixture' } }),
  } });
  await Promise.all(servers.slice(0, 2).map(runtime.connect));
  const late = runtime.connect(servers[2]);
  const shuttingDown = runtime.shutdown();
  const repeated = runtime.shutdown();
  await Promise.resolve();
  expect(clients.slice(0, 2).map((client) => client.close.mock.calls.length)).toEqual([1, 1]);
  finish();
  await Promise.all([late, shuttingDown, repeated]);
  expect(clients.map((client) => client.close.mock.calls.length)).toEqual([1, 1, 1]);
  expect(await runtime.catalog()).toEqual([]);
  await runtime.refresh();
  await runtime.connect(servers[0]);
  expect(clients).toHaveLength(3);
  expect(runtime.status().every((row: any) => row.status === 'idle')).toBe(true);
});
