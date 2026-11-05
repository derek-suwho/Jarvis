import { expect, it, vi } from 'vitest';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (value: unknown) => [typeof value === 'function' ? true : value === false ? true : value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
}));
vi.mock('../src/components/ResizeHandle', () => ({ ResizeHandle: () => null, useStoredWidth: () => [null, vi.fn()] }));
vi.mock('../src/lib/desktop', () => ({ isMac: () => false }));
import { Sidebar } from '../src/components/Sidebar';

it('allows IME project-name confirmation without creating a project until ordinary Enter', () => {
  const onCreateProject = vi.fn();
  const view = Sidebar({ chats: [], projects: [], activeId: null, activeProjectId: null, renamingId: null, onCreateProject } as any);
  const history = view.props.children[3];
  const rename = history.props.children[1].props.children[1];
  const input = rename.type({ ...rename.props, initial: '新しい計画' });
  for (const nativeEvent of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
    input.props.onKeyDown({ key: 'Enter', nativeEvent, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onCreateProject).not.toHaveBeenCalled();
  }
  input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 }, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  expect(onCreateProject).toHaveBeenCalledExactlyOnceWith('新しい計画');
  input.props.onBlur();
  expect(onCreateProject).toHaveBeenCalledOnce();
});
