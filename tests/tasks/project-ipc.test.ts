import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);

it('validates project deletion before dispatch and waits for durable cancellation settlement', async () => {
  const { registerProjectIpc } = require('../../electron/projects.cjs');
  const handlers = new Map<string, Function>();
  let settle!: () => void;
  const projects = { delete: vi.fn(() => new Promise<void>(resolve => { settle = resolve; })) };
  registerProjectIpc({ handle: (name: string, handler: Function) => handlers.set(name, handler) }, projects);
  const remove = handlers.get('projects:delete')!;
  for (const invalid of [null, {}, '', '../private', 'x'.repeat(121), 123]) {
    await expect(Promise.resolve().then(() => remove({}, invalid))).rejects.toThrow('Invalid project');
  }
  expect(projects.delete).not.toHaveBeenCalled();
  let received = false;
  const receipt = remove({}, 'project:design-1').then((result: boolean) => { received = result; });
  await Promise.resolve();
  expect(projects.delete).toHaveBeenCalledExactlyOnceWith('project:design-1');
  expect(received).toBe(false);
  settle();
  await receipt;
  expect(received).toBe(true);
});
