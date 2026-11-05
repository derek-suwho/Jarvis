import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useId: () => 'project-feedback',
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
}));
import { ProjectHome } from '../src/components/ProjectHome';
afterEach(() => { state.index = 0; state.values = []; });

it('retains project chats with safe open-failure feedback and clears it on successful retry', () => {
  const onSelect = vi.fn().mockImplementationOnce(() => { throw new Error('private storage path'); });
  const props = {
    project: { id: 'p', name: 'Project', instructions: '' } as any,
    chats: [{ id: 'chat', projectId: 'p', title: 'Saved chat', updatedAt: 1, messages: [] }] as any,
    onSelect, onChange: vi.fn(), onDelete: vi.fn(),
  };
  const render = () => { state.index = 0; return ProjectHome(props); };
  const button = (view: any) => view.props.children[3].props.children[0].props.children;
  expect(() => button(render()).props.onClick()).not.toThrow();
  const failed = render();
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert?.props.children).toBe('Could not open this conversation. Try again.');
  expect(button(failed).props['aria-describedby']).toBe(alert.props.id);
  expect(button(failed).props.children[1].props.children).toBe('Saved chat');
  button(failed).props.onClick();
  expect(onSelect).toHaveBeenCalledTimes(2);
  expect(onSelect).toHaveBeenLastCalledWith('chat');
  expect(render().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
  expect(button(render()).props['aria-describedby']).toBeUndefined();
});

it('keeps cancelled project deletion clicks from arming or deleting while preserving confirmation feedback', () => {
  const onDelete = vi.fn().mockImplementationOnce(() => { throw new Error('storage unavailable'); });
  const props = {
    project: { id: 'p', name: 'Project', instructions: '' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete,
  };
  const render = () => { state.index = 0; return ProjectHome(props); };
  const click = (defaultPrevented: boolean) => render().props.children[4].props.onClick({ defaultPrevented });
  click(true);
  expect(render().props.children[4].props.children).toBe('Delete project');
  click(false);
  click(true);
  expect(render().props.children[4].props.children).toBe('Confirm delete project and its data');
  expect(onDelete).not.toHaveBeenCalled();
  click(false);
  expect(onDelete).toHaveBeenCalledOnce();
  const failed = render();
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert.props.children).toBe('Could not delete project. Try again.');
  click(true);
  expect(render().props.children[4].props['aria-describedby']).toBe(alert.props.id);
  expect(render().props.children[4].props.children).toBe('Delete project');
  click(false);
  click(false);
  expect(onDelete).toHaveBeenCalledTimes(2);
});

it('retains unsaved project instructions and save feedback when Cancel was consumed', () => {
  const onChange = vi.fn(() => { throw new Error('storage unavailable'); });
  const props = {
    project: { id: 'p', name: 'Project', instructions: 'Original instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  };
  const render = () => { state.index = 0; return ProjectHome(props); };
  const card = () => render().props.children[1];
  card().props.children[0].props.children[1].props.onClick();
  const editor = () => card().props.children[1];
  editor().props.children[0].props.onChange({ target: { value: 'Unsaved correction' } });
  editor().props.children[1].props.children[1].props.onClick();
  const failed = editor();
  const error = failed.props.children[3].props.children;
  expect(error).toBe('Could not save instructions. Your draft is still here. Try again.');
  failed.props.children[1].props.children[0].props.onClick({ defaultPrevented: true });
  expect(editor().props.children[0].type).toBe('textarea');
  expect(editor().props.children[0].props.value).toBe('Unsaved correction');
  expect(editor().props.children[3].props.children).toBe(error);
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ instructions: 'Unsaved correction' });
  editor().props.children[1].props.children[0].props.onClick({ defaultPrevented: false });
  expect(card().props.children[1].props.children).toBe('Original instructions');
});
