import { expect, it, vi } from 'vitest';
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useRef: (current: unknown) => ({ current }) }));
vi.mock('../src/components/ResizeHandle', () => ({ ResizeHandle: () => null, useStoredWidth: () => [null, vi.fn()] }));
import { TabPanel } from '../src/components/TabPanel';

it('navigates workspace tabs with wrapping arrows and Home/End while keeping the active tab in the Tab sequence', () => {
  const onSelect = vi.fn();
  const view = TabPanel({ tabs: ['a', 'b', 'c'].map(id => ({ id, kind: 'sidechat', title: id, sidechat: {} })), activeTabId: 'b', fullView: true, tasks: [], onSelect } as any);
  const tabs = view.props.children[1].props.children[0];
  expect(tabs.map((tab: any) => tab.props.tabIndex)).toEqual([-1, 0, -1]);
  const focus = [vi.fn(), vi.fn(), vi.fn()];
  const nodes = focus.map(focus => ({ focus }));
  for (const [index, key, destination] of [[0, 'ArrowLeft', 2], [2, 'ArrowRight', 0], [1, 'Home', 0], [1, 'End', 2]] as const) {
    const currentTarget = { parentElement: { querySelectorAll: () => nodes } };
    const event = { key, target: currentTarget, currentTarget, nativeEvent: {}, preventDefault: vi.fn() };
    tabs[index].props.onKeyDown(event);
    expect(onSelect).toHaveBeenLastCalledWith(['a', 'b', 'c'][destination]);
    expect(focus[destination]).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  }
  onSelect.mockClear();
  for (const extra of [{ defaultPrevented: true }, { ctrlKey: true }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }, { target: {} }]) {
    const currentTarget = {};
    const event = { key: 'ArrowRight', target: currentTarget, currentTarget, nativeEvent: {}, preventDefault: vi.fn(), ...extra };
    tabs[1].props.onKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  }
});

it('associates each workspace tab with its labelled content panel and hides inactive panels', () => {
  const view = TabPanel({ tabs: ['a', 'b'].map(id => ({ id, kind: 'sidechat', title: id, sidechat: {} })), activeTabId: 'b', fullView: true, tasks: [] } as any);
  const tabs = view.props.children[1].props.children[0];
  const panels = view.props.children[2];
  for (let index = 0; index < tabs.length; index++) {
    expect(panels[index].props.role).toBe('tabpanel');
    expect(tabs[index].props.id).toBeTruthy();
    expect(panels[index].props.id).toBeTruthy();
    expect(tabs[index].props['aria-controls']).toBe(panels[index].props.id);
    expect(panels[index].props['aria-labelledby']).toBe(tabs[index].props.id);
    expect(panels[index].props.hidden).toBe(index === 0);
  }
  expect(tabs[0].props.id).not.toBe(tabs[1].props.id);
  expect(panels[0].props.id).not.toBe(panels[1].props.id);
});

it('closes the focused workspace tab with Delete while respecting nested controls and keyboard ownership', () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const view = TabPanel({ tabs: [{ id: 'a', kind: 'sidechat', sidechat: {} }], activeTabId: 'a', fullView: true, tasks: [], onClose, onSelect } as any);
  const tab = view.props.children[1].props.children[0][0];
  const currentTarget = {};
  const event = { key: 'Delete', target: currentTarget, currentTarget, nativeEvent: {}, preventDefault: vi.fn() };
  tab.props.onKeyDown(event);
  expect(onClose).toHaveBeenCalledExactlyOnceWith('a');
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
  onClose.mockClear();
  for (const extra of [{ defaultPrevented: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { nativeEvent: { isComposing: true } }, { nativeEvent: { keyCode: 229 } }, { target: {} }]) {
    const guarded = { ...event, preventDefault: vi.fn(), ...extra };
    tab.props.onKeyDown(guarded);
    expect(onClose).not.toHaveBeenCalled();
    expect(guarded.preventDefault).not.toHaveBeenCalled();
  }
});

it.each([[0, 1], [1, 2], [2, 1]])('keeps keyboard focus on a surviving neighbor when Delete closes tab %s', (index, destination) => {
  const focus = [vi.fn(), vi.fn(), vi.fn()];
  const nodes = focus.map(focus => ({ focus }));
  const onClose = vi.fn(() => {
    // Focus must leave the tab before its node is removed.
    expect(focus[destination]).toHaveBeenCalledOnce();
  });
  const view = TabPanel({ tabs: ['a', 'b', 'c'].map(id => ({ id, kind: 'sidechat', sidechat: {} })), activeTabId: ['a', 'b', 'c'][index], fullView: true, tasks: [], onClose } as any);
  const tab = view.props.children[1].props.children[0][index];
  const currentTarget = { parentElement: { querySelectorAll: () => nodes } };
  tab.props.onKeyDown({ key: 'Delete', target: currentTarget, currentTarget, nativeEvent: {}, preventDefault: vi.fn() });
  expect(onClose).toHaveBeenCalledExactlyOnceWith(['a', 'b', 'c'][index]);
  expect(focus[index]).not.toHaveBeenCalled();
});

it.each([[0, 1], [1, 2], [2, 1]])('keeps focus on a surviving tab when its Close button closes tab %s', (index, destination) => {
  const focus = [vi.fn(), vi.fn(), vi.fn()];
  const nodes = focus.map(focus => ({ focus }));
  const onClose = vi.fn(() => {
    expect(focus[destination]).toHaveBeenCalledOnce();
  });
  const view = TabPanel({ tabs: ['a', 'b', 'c'].map(id => ({ id, kind: 'sidechat', sidechat: {} })), activeTabId: ['a', 'b', 'c'][index], fullView: true, tasks: [], onClose } as any);
  const tab = view.props.children[1].props.children[0][index];
  const close = tab.props.children[3];
  const strip = { querySelectorAll: () => nodes };
  const event = { currentTarget: { parentElement: { parentElement: strip } }, stopPropagation: vi.fn() };
  close.props.onClick(event);
  expect(onClose).toHaveBeenCalledExactlyOnceWith(['a', 'b', 'c'][index]);
  expect(event.stopPropagation).toHaveBeenCalledOnce();
  expect(focus[index]).not.toHaveBeenCalled();
});


it('makes workspace content panels keyboard reachable after the tab strip while inactive panels remain hidden', () => {
  const view = TabPanel({ tabs: ['a', 'b'].map(id => ({ id, kind: 'sidechat', sidechat: {} })), activeTabId: 'b', fullView: true, tasks: [] } as any);
  const panels = view.props.children[2];
  expect(panels[1].props.hidden).toBe(false);
  expect(panels[1].props.tabIndex).toBe(0);
  expect(panels[0].props.hidden).toBe(true);
  expect(panels[0].props.tabIndex).toBe(0);
});
