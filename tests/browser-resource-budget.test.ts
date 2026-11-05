import { expect, it, vi } from 'vitest';
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
  useId: () => 'browser',
  useEffect: () => {},
}));
vi.mock('../src/components/ResizeHandle', () => ({ ResizeHandle: () => null, useStoredWidth: () => [null, vi.fn()] }));
vi.mock('../src/lib/desktop', () => ({ isDesktop: () => true, openExternal: vi.fn() }));
import { TabPanel } from '../src/components/TabPanel';
import { BrowserTab } from '../src/components/BrowserTab';
import { ChromiumView } from '../src/components/ChromiumView';
import { currentUrl, goBack } from '../src/lib/tabs';

it('bounds live browser pages to the selected tab and restores its retained URL and history', () => {
  const tabs = Array.from({ length: 20 }, (_, index) => ({
    id: String(index), kind: 'browser' as const,
    browser: { history: [`https://example.com/${index}/first`, `https://example.com/${index}/second`], index: 1, reloadKey: 0 },
  }));
  const onBrowserChange = vi.fn();
  const render = (activeTabId: string | null) => {
    const panel = TabPanel({ tabs, activeTabId, fullView: true, tasks: [], onBrowserChange } as any);
    return panel.props.children[2].map((body: any) => {
      const browser = body.props.children;
      expect(browser.type).toBe(BrowserTab);
      const view = BrowserTab(browser.props);
      const viewport = view.props.children.find((child: any) => child?.props?.className === 'browser-viewport');
      return { browser, page: viewport?.props.children };
    });
  };
  for (const selected of ['0', '19', '0', null]) {
    const views = render(selected);
    const live = views.filter((view: any) => view.page?.type === ChromiumView);
    expect(live).toHaveLength(selected === null ? 0 : 1);
    if (selected !== null) expect(live[0].page.props.url).toBe(currentUrl(tabs[Number(selected)].browser));
    expect(views[0].browser.props.state).toBe(tabs[0].browser);
  }
  const restored = render('0')[0];
  restored.browser.props.onChange(goBack(restored.browser.props.state));
  expect(onBrowserChange).toHaveBeenCalledWith('0', expect.objectContaining({ index: 0, history: tabs[0].browser.history }));
  expect(tabs[0].browser.index).toBe(1);
});
