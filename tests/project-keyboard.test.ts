import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ index: 0, editing: true, draft: 'Unsaved draft', armed: false, renaming: false, error: '', deleteError: '', effects: [] as Array<() => void>, focusPending: { current: false }, setters: Array.from({ length: 7 }, () => vi.fn()) }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useId: () => 'project-errors',
  useState: () => {
    const index = state.index++;
    return [[state.editing, state.draft, state.armed, state.renaming, state.error, state.deleteError, ''][index], state.setters[index]];
  },
  useEffect: (effect: () => void, dependencies: unknown[]) => {
    Object.assign(effect, { dependencies });
    state.effects.push(effect);
  },
  useRef: (current: unknown) => current === false ? state.focusPending : { current },
}));
import { ProjectHome } from '../src/components/ProjectHome';

afterEach(() => { state.index = 0; state.editing = true; state.draft = 'Unsaved draft'; state.armed = false; state.renaming = false; state.error = ''; state.deleteError = ''; state.effects.length = 0; state.focusPending.current = false; vi.clearAllMocks(); });

it('cancels project instructions with Escape without saving or interrupting composition', () => {
  const onChange = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const textarea = view.props.children[1].props.children[1].props.children[0];
  for (const properties of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }, { defaultPrevented: true }]) {
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), nativeEvent: {}, ...properties };
    textarea.props.onKeyDown?.(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.setters[0]).not.toHaveBeenCalled();
  }
  const unrelated = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
  textarea.props.onKeyDown?.(unrelated);
  expect(state.setters[0]).not.toHaveBeenCalled();
  const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), nativeEvent: {} };
  textarea.props.onKeyDown?.(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith('Saved instructions');
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
  expect(onChange).not.toHaveBeenCalled();
});


it('restores the remounted instructions trigger after Escape, Cancel, or Save without stealing initial focus', () => {
  const props = {
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete: vi.fn(),
  };
  const render = (editing: boolean) => {
    state.index = 0;
    state.editing = editing;
    return ProjectHome(props);
  };
  const trigger = (view: any) => view.props.children[1].props.children[0].props.children[1];
  const focus = vi.fn();
  trigger(render(false)).ref?.({ focus });
  expect(focus).not.toHaveBeenCalled();
  for (const action of ['Escape', 'Cancel', 'Save']) {
    const editor = render(true).props.children[1].props.children[1];
    if (action === 'Escape') {
      editor.props.children[0].props.onKeyDown({
        key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      });
    } else {
      editor.props.children[1].props.children[action === 'Cancel' ? 0 : 1].props.onClick({ defaultPrevented: false });
    }
    expect(focus).not.toHaveBeenCalled();
    const button = trigger(render(false));
    button.ref?.(null);
    expect(focus).not.toHaveBeenCalled();
    button.ref?.({ focus });
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();
    button.ref?.({ focus });
    expect(focus).not.toHaveBeenCalled();
  }
  expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ instructions: 'Unsaved draft' });
});


it('lets Escape cancel armed project deletion without deleting or moving focus', () => {
  state.armed = true;
  const onDelete = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: '' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete,
  });
  const button = view.props.children[4];
  for (const properties of [
    { key: 'Enter' }, { nativeEvent: { isComposing: true } },
    { keyCode: 229 }, { defaultPrevented: true },
  ]) {
    const event = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...properties };
    button.props.onKeyDown?.(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(state.setters[2]).not.toHaveBeenCalled();
  }
  const event = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  button.props.onKeyDown?.(event);
  expect(state.setters[2]).toHaveBeenCalledExactlyOnceWith(false);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(onDelete).not.toHaveBeenCalled();
});

it('names the project deletion action and consequence throughout two-step confirmation', () => {
  const onDelete = vi.fn();
  const props = {
    project: { id: 'p', name: 'Project', instructions: '' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete,
  };
  const renderButton = () => {
    state.index = 0;
    return ProjectHome(props).props.children[4];
  };
  const initial = renderButton();
  expect(initial.props.children).toBe('Delete project');
  initial.props.onClick({ defaultPrevented: false });
  expect(state.setters[2]).toHaveBeenCalledExactlyOnceWith(true);
  expect(onDelete).not.toHaveBeenCalled();
  state.armed = true;
  const confirmation = renderButton();
  expect(confirmation.props.children).toBe('Confirm delete project and its data');
  confirmation.props.onClick({ defaultPrevented: false });
  expect(onDelete).toHaveBeenCalledOnce();
  confirmation.props.onBlur();
  expect(state.setters[2]).toHaveBeenLastCalledWith(false);
  state.armed = false;
  expect(renderButton().props.children).toBe('Delete project');
});


it('dismisses an unsaved project rename when switching to another project', () => {
  const props = {
    project: { id: 'first', name: 'First project', instructions: '' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete: vi.fn(),
  };
  ProjectHome(props);
  state.effects.splice(0).forEach((effect) => effect());
  state.setters[3].mockClear();
  state.renaming = true;
  state.index = 0;
  const open = ProjectHome(props);
  expect(open.props.children[5]).toBeTruthy();
  state.effects.length = 0;
  state.index = 0;
  ProjectHome({ ...props, project: { ...props.project, id: 'second', name: 'Second project' } });
  state.effects.splice(0).forEach((effect) => effect());
  expect(state.setters[3]).toHaveBeenCalledWith(false);
  state.renaming = state.setters[3].mock.lastCall![0];
  state.index = 0;
  const switched = ProjectHome({ ...props, project: { ...props.project, id: 'second', name: 'Second project' } });
  expect(switched.props.children[5]).toBe(false);
  expect(props.onChange).not.toHaveBeenCalled();
});


it('preserves project instruction drafts after save failure and clears the safe error on retry', () => {
  const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('private storage details'); });
  state.setters[4].mockImplementation((value: string) => { state.error = value; });
  const renderEditor = () => {
    state.index = 0;
    return ProjectHome({
      project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
      chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
    }).props.children[1].props.children[1];
  };
  const save = () => renderEditor().props.children[1].props.children[1].props.onClick({ defaultPrevented: false });
  expect(save).not.toThrow();
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(state.focusPending.current).toBe(false);
  const failed = renderEditor();
  expect(failed.props.children[0].props.value).toBe('Unsaved draft');
  expect(failed.props.children[0].props['aria-invalid']).toBeUndefined();
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert.props.id).toBeTruthy();
  expect(failed.props.children[0].props['aria-describedby'].split(' ')).toContain(alert.props.id);
  expect(failed.props.children.find((child: any) => child?.props?.role === 'alert')?.props.children)
    .toBe('Could not save instructions. Your draft is still here. Try again.');
  save();
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith({ instructions: 'Unsaved draft' });
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
  expect(state.error).toBe('');
  expect(renderEditor().props.children[0].props['aria-describedby']).toBe('project-errors-instructions-help');
});

it('preserves an instruction draft when saved instructions refresh for the same project', () => {
  const props = {
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete: vi.fn(),
  };
  ProjectHome(props);
  state.effects.length = 0;
  state.index = 0;
  const refreshed = { ...props, project: { ...props.project, instructions: 'Updated elsewhere' } };
  ProjectHome(refreshed);
  // Run only effects whose dependencies changed during the same-project refresh.
  state.effects.forEach((effect: any) => {
    if (effect.dependencies?.includes('Updated elsewhere')) effect();
  });
  expect(state.setters[1]).not.toHaveBeenCalled();
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(props.onChange).not.toHaveBeenCalled();
});

it('refreshes saved instructions while the editor is closed', () => {
  state.editing = false;
  ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Updated elsewhere' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete: vi.fn(),
  });
  state.effects.forEach((effect: any) => {
    if (effect.dependencies?.includes('Updated elsewhere')) effect();
  });
  expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith('Updated elsewhere');
});


it('disarms failed project deletion and requires fresh confirmation to retry while preserving safe feedback', () => {
  state.armed = true;
  state.setters[2].mockImplementation((value: boolean) => { state.armed = value; });
  const onDelete = vi.fn().mockImplementationOnce(() => { throw new Error('private storage path'); });
  state.setters[5].mockImplementation((value: string) => { state.deleteError = value; });
  const render = () => {
    state.index = 0;
    return ProjectHome({
      project: { id: 'p', name: 'Project', instructions: '' } as any,
      chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete,
    });
  };
  expect(() => render().props.children[4].props.onClick({ defaultPrevented: false })).not.toThrow();
  const failed = render();
  expect(failed.props.children[4].props.children).toBe('Delete project');
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(alert.props.id).toBeTruthy();
  expect(failed.props.children[4].props['aria-describedby']).toBe(alert.props.id);
  expect(failed.props.children.find((child: any) => child?.props?.role === 'alert')?.props.children)
    .toBe('Could not delete project. Try again.');
  render().props.children[4].props.onClick({ defaultPrevented: false });
  expect(onDelete).toHaveBeenCalledOnce();
  expect(render().props.children[4].props.children).toContain('Confirm delete project');
  render().props.children[4].props.onClick({ defaultPrevented: false });
  expect(onDelete).toHaveBeenCalledTimes(2);
  expect(state.deleteError).toBe('');
  expect(render().props.children[4].props['aria-describedby']).toBe('project-errors-delete-confirmation');
});

it('requires a fresh activation to confirm project deletion instead of a held key', () => {
  state.armed = true;
  const onDelete = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: '' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete,
  });
  const button = view.props.children[4];
  for (const key of ['Enter', ' ']) {
    const held = { key, repeat: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    button.props.onKeyDown(held);
    // Repeated native button keydown must not produce its default click.
    expect(held.preventDefault).toHaveBeenCalledOnce();
    if (!held.preventDefault.mock.calls.length) button.props.onClick({ defaultPrevented: false });
  }
  expect(onDelete).not.toHaveBeenCalled();
  const fresh = { key: 'Enter', repeat: false, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  button.props.onKeyDown(fresh);
  expect(fresh.preventDefault).not.toHaveBeenCalled();
  button.props.onClick({ defaultPrevented: false });
  expect(onDelete).toHaveBeenCalledOnce();
});

it('prevents IME confirmation from activating armed project deletion', () => {
  state.armed = true;
  const onDelete = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: '' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete,
  });
  const button = view.props.children[4];
  for (const key of ['Enter', ' ']) {
    for (const composition of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
      const event = { key, nativeEvent: {}, preventDefault: vi.fn(), ...composition };
      button.props.onKeyDown(event);
      // Model the native button activation unless keydown cancels its default.
      if (!event.preventDefault.mock.calls.length) button.props.onClick({ defaultPrevented: false });
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(onDelete).not.toHaveBeenCalled();
    }
  }
  const fresh = { key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() };
  button.props.onKeyDown(fresh);
  expect(fresh.preventDefault).not.toHaveBeenCalled();
  button.props.onClick({ defaultPrevented: false });
  expect(onDelete).toHaveBeenCalledOnce();
});


it('returns focus to the retained instructions draft when saving fails', () => {
  const onChange = vi.fn(() => { throw new Error('Storage unavailable'); });
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const editor = view.props.children[1].props.children[1];
  const textarea = editor.props.children[0];
  const focus = vi.fn();
  if (textarea.ref) textarea.ref.current = { focus };
  editor.props.children[1].props.children[1].props.onClick({ defaultPrevented: false });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ instructions: 'Unsaved draft' });
  expect(focus).toHaveBeenCalledOnce();
  expect(textarea.props.value).toBe('Unsaved draft');
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(state.focusPending.current).toBe(false);
});

it('clears stale instruction-save failure feedback when correcting the draft without saving again', () => {
  const onChange = vi.fn(() => { throw new Error('Storage unavailable'); });
  state.setters[4].mockImplementation((value: string) => { state.error = value; });
  const editor = () => {
    state.index = 0;
    return ProjectHome({
      project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
      chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
    }).props.children[1].props.children[1];
  };
  editor().props.children[1].props.children[1].props.onClick({ defaultPrevented: false });
  expect(editor().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(true);
  editor().props.children[0].props.onChange({ target: { value: 'Corrected instructions' } });
  expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith('Corrected instructions');
  expect(editor().props.children.some((child: any) => child?.props?.role === 'alert')).toBe(false);
  expect(editor().props.children[0].props['aria-describedby']).toBe('project-errors-instructions-help');
  expect(onChange).toHaveBeenCalledOnce();
  expect(state.setters[0]).not.toHaveBeenCalled();
});

it('requires fresh project deletion confirmation after the application window loses focus', () => {
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    removeEventListener: (name: string, listener: () => void) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  });
  state.armed = true;
  state.setters[2].mockImplementation((value: boolean) => { state.armed = value; });
  const onDelete = vi.fn();
  const render = () => {
    state.index = 0;
    return ProjectHome({ project: { id: 'p', name: 'Project', instructions: '' } as any,
      chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete }).props.children[4];
  };
  const cleanups: Array<void | (() => void)> = [];
  try {
    expect(render().props.children).toContain('Confirm delete');
    // Mount only the interruption effect; project initialization already ran before arming.
    state.effects.forEach((effect: any) => {
      if (effect.dependencies?.includes(true)) cleanups.push(effect());
    });
    expect(listeners.has('blur')).toBe(true);
    listeners.get('blur')!();
    expect(render().props.children).toBe('Delete project');
    render().props.onClick({ defaultPrevented: false });
    expect(onDelete).not.toHaveBeenCalled();
    expect(render().props.children).toContain('Confirm delete');
    render().props.onClick({ defaultPrevented: false });
    expect(onDelete).toHaveBeenCalledOnce();
  } finally {
    cleanups.forEach((cleanup) => cleanup?.());
    vi.unstubAllGlobals();
  }
  expect(listeners.size).toBe(0);
});

it('cancels instructions with Escape after tabbing to either editor action and restores trigger focus', () => {
  const onChange = vi.fn();
  for (const action of [0, 1]) {
    state.index = 0;
    state.setters.forEach((setter) => setter.mockClear());
    state.focusPending.current = false;
    const view = ProjectHome({
      project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
      chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
    });
    const card = view.props.children[1];
    const button = card.props.children[1].props.children[1].props.children[action];
    for (const flags of [{}, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { defaultPrevented: true }]) {
      const event = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), target: button, ...flags };
      card.props.onKeyDown?.(event);
      if (Object.keys(flags).length === 0) {
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith('Saved instructions');
        expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
        expect(state.focusPending.current).toBe(true);
        state.setters.forEach((setter) => setter.mockClear());
      } else {
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(state.setters[0]).not.toHaveBeenCalled();
      }
    }
  }
  expect(onChange).not.toHaveBeenCalled();
});

it('associates storage failure feedback without marking valid project instructions invalid', () => {
  const onChange = vi.fn(() => { throw new Error('Storage unavailable'); });
  state.setters[4].mockImplementation((value: string) => { state.error = value; });
  const editor = () => {
    state.index = 0;
    return ProjectHome({
      project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
      chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
    }).props.children[1].props.children[1];
  };
  expect(editor().props.children[0].props['aria-invalid']).toBeUndefined();
  editor().props.children[1].props.children[1].props.onClick({ defaultPrevented: false });
  const failed = editor();
  const textarea = failed.props.children[0];
  const alert = failed.props.children.find((child: any) => child?.props?.role === 'alert');
  expect(textarea.props['aria-invalid']).toBeUndefined();
  expect(textarea.props['aria-describedby'].split(' ')).toContain(alert.props.id);
  expect(textarea.props.value).toBe('Unsaved draft');
  textarea.props.onChange({ target: { value: 'Corrected instructions' } });
  expect(editor().props.children[0].props['aria-invalid']).toBeUndefined();
  expect(editor().props.children[0].props['aria-describedby']).toBe('project-errors-instructions-help');
  expect(onChange).toHaveBeenCalledOnce();
});

it('saves instructions with a disclosed Cmd/Ctrl+Enter shortcut while preserving newlines and failed drafts', () => {
  const onChange = vi.fn().mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const editor = view.props.children[1].props.children[1];
  const textarea = editor.props.children[0];
  const focus = vi.fn();
  textarea.ref.current = { focus };
  const press = (properties: Record<string, unknown>) => {
    const event = { key: 'Enter', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...properties };
    textarea.props.onKeyDown(event);
    return event;
  };
  for (const properties of [{}, { metaKey: true, repeat: true }, { ctrlKey: true, nativeEvent: { isComposing: true } },
    { ctrlKey: true, nativeEvent: { keyCode: 229 } }, { metaKey: true, defaultPrevented: true }]) {
    expect(press(properties).preventDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  }
  const failed = press({ metaKey: true });
  expect(failed.preventDefault).toHaveBeenCalledOnce();
  expect(failed.stopPropagation).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ instructions: 'Unsaved draft' });
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(state.setters[4]).toHaveBeenLastCalledWith('Could not save instructions. Your draft is still here. Try again.');
  expect(focus).toHaveBeenCalledOnce();
  press({ ctrlKey: true });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
  const save = editor.props.children[1].props.children[1];
  expect(save.props['aria-keyshortcuts']).toBe('Meta+Enter Control+Enter');
  expect(save.props.title).toContain('⌘');
  expect(save.props.title).toContain('Ctrl');
});

it('preserves instruction drafts for held Escape from the textarea and editor actions', () => {
  const onChange = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const card = view.props.children[1];
  const textarea = card.props.children[1].props.children[0];
  const press = (repeat: boolean) => ({ key: 'Escape', repeat, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  const held = press(true);
  textarea.props.onKeyDown(held);
  card.props.onKeyDown(held);
  expect(state.setters[1]).not.toHaveBeenCalled();
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(state.focusPending.current).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
  const fresh = press(false);
  textarea.props.onKeyDown(fresh);
  expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith('Saved instructions');
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
  expect(fresh.preventDefault).toHaveBeenCalledOnce();
  expect(fresh.stopPropagation).toHaveBeenCalledOnce();
});

it('saves project instructions with Cmd/Ctrl+Enter after tabbing to editor actions', () => {
  const onChange = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const card = view.props.children[1];
  const actions = card.props.children[1].props.children[1].props.children;
  for (const [index, modifier] of [{ metaKey: true }, { ctrlKey: true }].entries()) {
    const press = (extra = {}) => {
      const event = { key: 'Enter', ...modifier, target: actions[index], nativeEvent: {},
        preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
      card.props.onKeyDown(event);
      return event;
    };
    for (const extra of [{ repeat: true }, { defaultPrevented: true },
      { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }]) {
      expect(press(extra).preventDefault).not.toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledTimes(index);
    }
    const event = press();
    expect(onChange).toHaveBeenCalledTimes(index + 1);
    expect(onChange).toHaveBeenLastCalledWith({ instructions: 'Unsaved draft' });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  }
});


it('discloses permanent project data deletion accessibly before confirmation and clears on cancellation', () => {
  state.editing = false;
  state.setters[2].mockImplementation((value: boolean) => { state.armed = value; });
  const onDelete = vi.fn();
  const render = () => {
    state.index = 0;
    return ProjectHome({ project: { id: 'p', name: 'Project', instructions: '' } as any,
      chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete });
  };
  const status = (view: any) => view.props.children.find((child: any) => child?.props?.role === 'status');
  expect(status(render())?.props.children).toBe('');
  render().props.children[4].props.onClick({ defaultPrevented: false });
  expect(onDelete).not.toHaveBeenCalled();
  const armed = render();
  const disclosure = status(armed);
  expect(disclosure.props.children).toBe('Deleting this project permanently removes its chats, project memory, and project history, including project history in chats moved elsewhere. This cannot be undone. Press Escape or move focus away to cancel.');
  expect(disclosure.props['aria-atomic']).toBe(true);
  expect(disclosure.props.id).toBe('project-errors-delete-confirmation');
  expect(armed.props.children[4].props['aria-describedby']).toBe(disclosure.props.id);
  expect(armed.props.children[4].props.children).toBe('Confirm delete project and its data');
  armed.props.children[4].props.onBlur();
  expect(status(render()).props.children).toBe('');
  expect(render().props.children[4].props['aria-describedby']).toBeUndefined();
  expect(onDelete).not.toHaveBeenCalled();
});

it('describes instruction save and cancel shortcuts while retaining associated failure feedback', () => {
  const render = (error: string) => {
    state.index = 0;
    state.error = error;
    return ProjectHome({ project: { id: 'p', name: 'Project', instructions: 'Saved' } as any,
      chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete: vi.fn() })
      .props.children[1].props.children[1];
  };
  for (const error of ['', 'Could not save instructions. Your draft is still here. Try again.']) {
    const editor = render(error);
    const input = editor.props.children[0];
    const hint = editor.props.children.find((child: any) => child?.props?.id === 'project-errors-instructions-help');
    expect(hint).toBeDefined();
    expect(hint.props.children).toBe('Press ⌘Enter or Ctrl+Enter to save. Press Escape to cancel without saving.');
    expect(input.props['aria-describedby'].split(' ')).toEqual(error
      ? ['project-errors-instructions-help', 'project-errors-instructions']
      : ['project-errors-instructions-help']);
    expect(input.props['aria-invalid']).toBeUndefined();
  }
});

it('preserves unsaved project instructions for modified Escape and cancels only on plain Escape', () => {
  const onChange = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const card = view.props.children[1];
  const textarea = card.props.children[1].props.children[0];
  for (const handler of [textarea.props.onKeyDown, card.props.onKeyDown]) {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
      const event = { key: 'Escape', [modifier]: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      handler(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
      expect(state.setters[0]).not.toHaveBeenCalled();
      expect(state.setters[1]).not.toHaveBeenCalled();
    }
  }
  expect(onChange).not.toHaveBeenCalled();
  const escape = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  card.props.onKeyDown(escape);
  expect(escape.preventDefault).toHaveBeenCalledOnce();
  expect(state.setters[1]).toHaveBeenCalledExactlyOnceWith('Saved instructions');
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
});

it('keeps IME confirmation from activating instruction Save or Cancel while allowing fresh activation', () => {
  const onChange = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const card = view.props.children[1];
  const actions = card.props.children[1].props.children[1].props.children;
  for (const button of actions) {
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = { key: 'Enter', nativeEvent: composition, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      button.props.onKeyDown?.(event);
      // Button activation follows keydown unless its default was cancelled.
      if (!event.preventDefault.mock.calls.length) button.props.onClick({ defaultPrevented: false });
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(state.setters[0]).not.toHaveBeenCalled();
      expect(state.setters[1]).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    }
    const fresh = { key: 'Enter', nativeEvent: {}, preventDefault: vi.fn() };
    button.props.onKeyDown?.(fresh);
    expect(fresh.preventDefault).not.toHaveBeenCalled();
  }
  actions[1].props.onClick({ defaultPrevented: false });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ instructions: 'Unsaved draft' });
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
});

it('requires a fresh Enter to retry saving project instructions after storage fails', () => {
  const onChange = vi.fn(() => { throw new Error('Storage unavailable'); });
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const editor = view.props.children[1].props.children[1];
  const save = editor.props.children[1].props.children[1];
  const press = (repeat: boolean) => {
    const event = { key: 'Enter', repeat, nativeEvent: {}, preventDefault: vi.fn() };
    save.props.onKeyDown(event);
    // The browser activates the focused button for uncancelled Enter presses.
    if (!event.preventDefault.mock.calls.length) save.props.onClick({ defaultPrevented: false });
    return event;
  };
  press(false);
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ instructions: 'Unsaved draft' });
  expect(press(true).preventDefault).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledOnce();
  expect(state.setters[0]).not.toHaveBeenCalled();
  expect(editor.props.children[0].props.value).toBe('Unsaved draft');
  press(false);
  expect(onChange).toHaveBeenCalledTimes(2);
});

it('preserves the instructions draft for Alt or Shift modified save shortcuts', () => {
  const onChange = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  });
  const textarea = view.props.children[1].props.children[1].props.children[0];
  for (const primary of [{ metaKey: true }, { ctrlKey: true }]) {
    for (const modifier of [{ altKey: true }, { shiftKey: true }]) {
      const event = { key: 'Enter', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...primary, ...modifier };
      textarea.props.onKeyDown(event);
      expect(onChange).not.toHaveBeenCalled();
      expect(state.setters[0]).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  }
  textarea.props.onKeyDown({ key: 'Enter', ctrlKey: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ instructions: 'Unsaved draft' });
  expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(false);
});


it('retains overlength project instructions for correction and saves after shortening them', () => {
  const onChange = vi.fn();
  const props = {
    project: { id: 'p', name: 'Project', instructions: 'Saved instructions' } as any,
    chats: [], onSelect: vi.fn(), onChange, onDelete: vi.fn(),
  };
  const render = () => {
    state.index = 0;
    return ProjectHome(props).props.children[1].props.children[1];
  };
  state.draft = 'a'.repeat(4001);
  const editor = render();
  const focus = vi.fn();
  editor.props.children[0].ref.current = { focus };
  editor.props.children[1].props.children[1].props.onClick({ defaultPrevented: false });
  expect(onChange).not.toHaveBeenCalled();
  expect(state.setters[0]).not.toHaveBeenCalledWith(false);
  expect(state.setters[4]).toHaveBeenLastCalledWith('Use instructions of 4,000 characters or fewer.');
  expect(focus).toHaveBeenCalledOnce();
  expect(editor.props.children[0].props.value).toBe(state.draft);
  state.error = 'Use instructions of 4,000 characters or fewer.';
  const invalid = render();
  expect(invalid.props.children[0].props['aria-invalid']).toBe(true);
  expect(invalid.props.children[0].props['aria-describedby']).toContain(invalid.props.children[3].props.id);
  state.draft = 'a'.repeat(4000);
  render().props.children[1].props.children[1].props.onClick({ defaultPrevented: false });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ instructions: state.draft });
  expect(state.setters[0]).toHaveBeenCalledWith(false);
});

it('preserves system Escape shortcuts while project deletion confirmation is armed', () => {
  state.armed = true;
  const onDelete = vi.fn();
  const view = ProjectHome({
    project: { id: 'p', name: 'Project', instructions: '' } as any,
    chats: [], onSelect: vi.fn(), onChange: vi.fn(), onDelete,
  });
  const button = view.props.children[4];
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
    const event = { key: 'Escape', [modifier]: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    button.props.onKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(state.setters[2]).not.toHaveBeenCalled();
  }
  const escape = { key: 'Escape', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  button.props.onKeyDown(escape);
  expect(state.setters[2]).toHaveBeenCalledExactlyOnceWith(false);
  expect(escape.preventDefault).toHaveBeenCalledOnce();
  expect(escape.stopPropagation).toHaveBeenCalledOnce();
  expect(onDelete).not.toHaveBeenCalled();
});
