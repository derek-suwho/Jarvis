import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TOTAL_FILE_BYTES } from '../src/lib/attachments';

let storage: Map<string, string>;
let drafts: typeof import('../src/lib/drafts');

beforeEach(async () => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    get length() { return storage.size; },
    key: (index: number) => [...storage.keys()][index] ?? null,
  });
  drafts = await import('../src/lib/drafts');
});

afterEach(() => vi.unstubAllGlobals());

function deferredFile(name = 'notes.txt', size = 1) {
  const content = name.endsWith('.pdf') ? '%PDF-1.4\n' + ' '.repeat(size - 15) + '\n%%EOF' : 'x'.repeat(size);
  const file = new File([content], name);
  let resolve!: (buffer: ArrayBuffer) => void;
  const promise = new Promise<ArrayBuffer>((done) => { resolve = done; });
  vi.spyOn(file, 'arrayBuffer').mockReturnValue(promise);
  return { file, finish: () => resolve(new TextEncoder().encode(content).buffer) };
}

describe('conversation drafts', () => {
  it('clears current and unopened persisted drafts without touching other session data', () => {
    drafts.setDraftText('current', 'Unsent message');
    storage.set('jarvis.draft:unopened', 'Earlier draft');
    storage.set('unrelated', 'Keep');
    drafts.clearAllDrafts();
    expect(drafts.getDraft('current').text).toBe('');
    expect([...storage.entries()]).toEqual([['unrelated', 'Keep']]);
  });

  it('keeps independent text and attachments across subscriptions and navigation', async () => {
    drafts.setDraftText('first', 'First prompt');
    await drafts.attachDraftFiles('first', [new File(['notes'], 'notes.md')]);
    const unsubscribe = drafts.subscribeToDraft('first', vi.fn());
    unsubscribe();
    drafts.setDraftText('second', 'Second prompt');
    expect(drafts.getDraft('first')).toMatchObject({ text: 'First prompt', attachments: [{ text: 'notes' }] });
    expect(drafts.getDraft('second')).toMatchObject({ text: 'Second prompt', attachments: [] });
  });

  it('restores only persistent text after reload, never attachment contents', async () => {
    drafts.setDraftText('saved', 'Keep this text');
    await drafts.attachDraftFiles('saved', [new File(['private file contents'], 'notes.txt')]);
    drafts.setDraftText('temporary', 'Temporary prompt', false);
    await drafts.attachDraftFiles('temporary', [new File(['temporary file'], 'notes.txt')], false);
    expect([...storage.entries()]).toEqual([['jarvis.draft:saved', 'Keep this text']]);
    vi.resetModules();
    const reloaded = await import('../src/lib/drafts');
    expect(reloaded.getDraft('saved')).toMatchObject({ text: 'Keep this text', attachments: [] });
    expect(reloaded.getDraft('temporary', false)).toMatchObject({ text: '', attachments: [] });
  });

  it('clears the source on send without clearing an existing destination draft', async () => {
    drafts.setDraftText('new', 'Send this');
    await drafts.attachDraftFiles('new', [new File(['context'], 'context.txt')]);
    drafts.setDraftText('existing', 'Keep this follow-up');
    const sent = drafts.getDraft('new');
    drafts.clearDraft('new');
    expect(sent).toMatchObject({ text: 'Send this', attachments: [{ text: 'context' }] });
    expect(drafts.getDraft('new')).toMatchObject({ text: '', attachments: [] });
    expect(storage.has('jarvis.draft:new')).toBe(false);
    expect(drafts.getDraft('existing').text).toBe('Keep this follow-up');
  });

  it('reserves slots before async reads so overlapping picks cannot exceed ten files', async () => {
    const pending = Array.from({ length: 9 }, (_, index) => deferredFile(`file-${index}.txt`));
    const first = drafts.attachDraftFiles('chat', pending.map(({ file }) => file));
    expect(drafts.getDraft('chat').pendingFiles).toBe(9);
    const second = drafts.attachDraftFiles('chat', [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
    expect(drafts.getDraft('chat').pendingFiles).toBe(10);
    pending.forEach(({ finish }) => finish());
    await Promise.all([first, second]);
    expect(drafts.getDraft('chat').attachments).toHaveLength(10);
    expect(drafts.getDraft('chat').pendingFiles).toBe(0);
    expect(drafts.getDraft('chat').errors.join()).toContain('Up to 10 files');
  });

  it('includes pending bytes in aggregate limits', async () => {
    const pending = Array.from({ length: 2 }, (_, index) => deferredFile(`file-${index}.pdf`, MAX_TOTAL_FILE_BYTES / 2));
    const first = drafts.attachDraftFiles('chat', pending.map(({ file }) => file));
    expect(await drafts.attachDraftFiles('chat', [new File(['extra'], 'extra.txt')])).toBe(0);
    expect(drafts.getDraft('chat').errors.join()).toContain('10.0 MB');
    pending.forEach(({ finish }) => finish());
    await first;
    expect(drafts.getDraft('chat').attachments).toHaveLength(2);
  });

  it('keeps async reads with their original chat while preserving new typing', async () => {
    const pending = deferredFile();
    const read = drafts.attachDraftFiles('first', [pending.file]);
    drafts.setDraftText('second', 'Elsewhere');
    drafts.setDraftText('first', 'Typed while reading');
    pending.finish();
    await read;
    expect(drafts.getDraft('first')).toMatchObject({ text: 'Typed while reading', attachments: [{ name: 'notes.txt' }] });
    expect(drafts.getDraft('second')).toMatchObject({ text: 'Elsewhere', attachments: [] });
  });

  it('settles failed reads without rejecting valid files or leaving the composer busy', async () => {
    const failed = new File(['bad'], 'bad.txt');
    vi.spyOn(failed, 'arrayBuffer').mockRejectedValue(new Error('unreadable'));
    expect(await drafts.attachDraftFiles('chat', [failed, new File(['good'], 'good.txt')])).toBe(1);
    expect(drafts.getDraft('chat')).toMatchObject({ attachments: [{ name: 'good.txt' }], pendingFiles: 0 });
    expect(drafts.getDraft('chat').errors.join()).toContain("Couldn't read bad.txt");
    drafts.clearDraftErrors('chat');
    expect(drafts.getDraft('chat').errors).toEqual([]);
  });

  it('does not resurrect a cleared draft when an old read finishes', async () => {
    const pending = deferredFile();
    const read = drafts.attachDraftFiles('chat', [pending.file]);
    drafts.clearDraft('chat');
    drafts.setDraftText('chat', 'New draft');
    pending.finish();
    await read;
    expect(drafts.getDraft('chat')).toMatchObject({ text: 'New draft', attachments: [], pendingFiles: 0 });
  });

  it('keeps working when browser storage throws and notifies subscribers', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    const listener = vi.fn();
    const stop = drafts.subscribeToDraft('private', listener);
    drafts.setDraftText('private', 'Still retained');
    expect(drafts.getDraft('private').text).toBe('Still retained');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    drafts.clearDraft('private');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('asynchronous draft acceptance', () => {
  it('consumes accepted content while preserving later text and files', async () => {
    drafts.setDraftText('chat', 'Original');
    await drafts.attachDraftFiles('chat', [new File(['old'], 'old.txt')]);
    const submitted = drafts.captureDraft('chat');
    drafts.setDraftText('chat', 'Original plus a new instruction');
    await drafts.attachDraftFiles('chat', [new File(['new'], 'new.txt')]);
    drafts.consumeSubmittedDraft('chat', submitted);
    expect(drafts.getDraft('chat').text).toBe(' plus a new instruction');
    expect(drafts.getDraft('chat').attachments.map((file) => file.name)).toEqual(['new.txt']);
  });
  it('preserves replaced text, rejected drafts, and drafts cleared during acceptance', () => {
    drafts.setDraftText('first', 'Original');
    const submitted = drafts.captureDraft('first');
    expect(drafts.getDraft('first').text).toBe('Original');
    drafts.setDraftText('first', 'Replacement');
    drafts.consumeSubmittedDraft('first', submitted);
    expect(drafts.getDraft('first').text).toBe('Replacement');
    const old = drafts.captureDraft('first');
    drafts.clearDraft('first');
    drafts.setDraftText('first', 'Replacement');
    drafts.consumeSubmittedDraft('first', old);
    expect(drafts.getDraft('first').text).toBe('Replacement');
  });
});
