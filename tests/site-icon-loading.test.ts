import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: [null, null] as Array<string | null>, index: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => {
    const index = state.index++;
    return [state.values[index], (value: string | null) => { state.values[index] = value; }];
  },
}));
import { SiteIcon } from '../src/components/SiteIcon';

afterEach(() => { state.values = [null, null]; state.index = 0; });

it('keeps a fallback visible during favicon loading and failure, revealing only a loaded host', () => {
  const render = (site = 'https://example.com/') => {
    state.index = 0;
    return SiteIcon({ site, fallback: 'E' });
  };
  const children = (view: any) => [view.props.children].flat();
  const image = (view: any) => children(view).find((child: any) => child?.type === 'img');
  const loading = render();
  expect(children(loading)).toContain('E');
  expect(image(loading).props.hidden).toBe(true);
  expect(image(loading).props.style).toEqual({ display: 'none' });
  image(loading).props.onLoad();
  const loaded = render();
  expect(children(loaded)).not.toContain('E');
  expect(image(loaded).props.hidden).toBe(false);
  expect(image(loaded).props.style).toBeUndefined();
  const changed = render('https://other.example/');
  expect(children(changed)).toContain('E');
  expect(image(changed).props.hidden).toBe(true);
  image(changed).props.onError();
  const failed = render('https://other.example/');
  expect(children(failed)).toContain('E');
  expect(image(failed)).toBeUndefined();
});

it('keeps fallback feedback until a changed-size favicon loads and recovers from a failed previous size', () => {
  const render = (size: number) => {
    state.index = 0;
    return SiteIcon({ site: 'https://example.com/', size, fallback: 'E' });
  };
  const children = (view: any) => [view.props.children].flat();
  const image = (view: any) => children(view).find((child: any) => child?.type === 'img');
  image(render(16)).props.onLoad();
  expect(children(render(16))).not.toContain('E');
  const larger = render(32);
  expect(children(larger)).toContain('E');
  expect(image(larger).props.hidden).toBe(true);
  expect(image(larger).props.src).toContain('sz=64');
  image(larger).props.onError();
  expect(image(render(32))).toBeUndefined();
  const retry = render(24);
  expect(children(retry)).toContain('E');
  expect(image(retry).props.hidden).toBe(true);
  image(retry).props.onLoad();
  expect(children(render(24))).not.toContain('E');
  expect(image(render(24)).props.hidden).toBe(false);
});
