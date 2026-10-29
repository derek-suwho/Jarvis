import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    || '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox'],
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
const origin = process.env.JARVIS_TEST_URL || 'http://localhost:3000';
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

async function savedTitle(title) {
  await page.waitForFunction((title) => JSON.parse(localStorage.getItem('jarvis.chats') || '[]')[0]?.title === title, {}, title);
}

async function storedMedia() {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('jarvis.media', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('attachments', 'readonly');
        const request = transaction.objectStore('attachments').getAll();
        request.onsuccess = () => resolve(request.result.map(({ id, data }) => ({ id, length: data.length })));
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

try {
  await page.goto(origin, { waitUntil: 'networkidle2' });
  await page.evaluate(async () => {
    const { saveChats } = await import('/src/lib/chats.ts');
    const data = 'YWJj'.repeat(1024 * 1024);
    window.__mediaFixture = {
      id: 'persisted', title: 'Media persisted', updatedAt: 1,
      messages: [{ id: 'message', role: 'user', content: 'Analyze', attachments: [
        { id: 'image', name: 'image.png', size: 3 * 1024 * 1024, type: 'image/png', data, preview: `data:image/png;base64,${data}` },
        { id: 'pdf', name: 'report.pdf', size: 15, type: 'application/pdf', data: 'JVBERi0xLjcKJSVFT0Y=' },
      ] }],
    };
    await saveChats([window.__mediaFixture, {
      id: 'temporary', title: 'Do not store', updatedAt: 2, temporary: true,
      messages: [{ id: 'private', role: 'user', content: '', attachments: [
        { id: 'secret', name: 'secret.pdf', size: 4, type: 'application/pdf', data: 'c2VjcmV0' },
      ] }],
    }]);
  });
  await savedTitle('Media persisted');
  const metadata = await page.evaluate(() => localStorage.getItem('jarvis.chats'));
  assert.ok(metadata.length < 1000, 'Binary data and previews must not fill localStorage');
  assert.ok(!metadata.includes('secret'), 'Temporary chats must stay out of saved metadata');
  assert.deepEqual((await storedMedia()).map((row) => row.id).sort(), ['image', 'pdf']);

  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.history-select');
  await page.click('.history-select');
  await page.waitForSelector('.msg-thumb');
  assert.ok(await page.$eval('.msg-thumb', (image) => image.getAttribute('src').length > 4 * 1024 * 1024),
    'App must hydrate image previews before showing a saved conversation');
  const restored = await page.evaluate(async () => {
    const { initializeChatMedia, loadChats } = await import('/src/lib/chats.ts');
    // Vite's HMR timestamp can give evaluated imports their own module cache.
    await initializeChatMedia();
    const attachments = loadChats()[0].messages[0].attachments;
    return attachments.map(({ id, type, data, preview }) => ({
      id, type, length: data?.length, previewMatches: preview === `data:${type};base64,${data}`,
    }));
  });
  assert.deepEqual(restored, [
    { id: 'image', type: 'image/png', length: 4 * 1024 * 1024, previewMatches: true },
    { id: 'pdf', type: 'application/pdf', length: 20, previewMatches: false },
  ]);

  // Failed metadata writes must not remove media referenced by the last durable snapshot.
  const quotaFailure = await page.evaluate(async () => {
    const { loadChats, saveChats, subscribeToChatStorageErrors } = await import('/src/lib/chats.ts');
    window.__storageErrors = [];
    window.__unsubscribeStorage = subscribeToChatStorageErrors((message) => window.__storageErrors.push(message));
    window.__savedChats = loadChats();
    window.__originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'jarvis.chats') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return window.__originalSetItem.call(this, key, value);
    };
    return saveChats([]).then(() => null, (error) => error.name);
  });
  assert.equal(quotaFailure, 'QuotaExceededError');
  await page.waitForFunction(() => window.__storageErrors.length > 0);
  assert.equal((await storedMedia()).length, 2);
  assert.match(await page.evaluate(() => window.__storageErrors[0]), /save|storage/i);
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });

  // Rapid saves serialize; the final snapshot owns both metadata and retained files.
  await page.evaluate(async () => {
    const { saveChats } = await import('/src/lib/chats.ts');
    const original = window.__savedChats[0];
    const earlier = saveChats([{ ...original, title: 'Earlier snapshot' }]);
    const later = saveChats([{ ...original, title: 'Later snapshot', messages: [
      { ...original.messages[0], attachments: [original.messages[0].attachments[1]] },
    ] }]);
    await Promise.all([earlier, later]);
  });
  await savedTitle('Later snapshot');
  await page.waitForFunction(async () => {
    const request = indexedDB.open('jarvis.media', 1);
    const database = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
    const transaction = database.transaction('attachments', 'readonly');
    const count = transaction.objectStore('attachments').count();
    const result = await new Promise((resolve) => { count.onsuccess = () => resolve(count.result); });
    database.close();
    return result === 1;
  });
  assert.deepEqual((await storedMedia()).map((row) => row.id), ['pdf']);

  // Clearing all chats removes the retained binary data too.
  await page.evaluate(async () => {
    const { saveChats } = await import('/src/lib/chats.ts');
    await saveChats([]);
  });
  await page.waitForFunction(() => localStorage.getItem('jarvis.chats') === '[]');
  await page.waitForFunction(async () => {
    const request = indexedDB.open('jarvis.media', 1);
    const database = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
    const transaction = database.transaction('attachments', 'readonly');
    const count = transaction.objectStore('attachments').count();
    const result = await new Promise((resolve) => { count.onsuccess = () => resolve(count.result); });
    database.close();
    return result === 0;
  });
  assert.deepEqual(await storedMedia(), []);

  // Old data URLs migrate without losing their original image bytes.
  await page.evaluate(() => {
    localStorage.setItem('jarvis.chats', JSON.stringify([{
      id: 'legacy', title: 'Legacy preview', updatedAt: 1,
      messages: [{ id: 'legacy-message', role: 'user', content: '', attachments: [
        { id: 'legacy-image', name: 'old.png', type: 'image/png', size: 3, preview: 'data:image/png;base64,YWJj' },
      ] }],
    }]));
  });
  await page.reload({ waitUntil: 'networkidle2' });
  const legacy = await page.evaluate(async () => {
    const { initializeChatMedia, loadChats } = await import('/src/lib/chats.ts');
    await initializeChatMedia();
    return loadChats()[0].messages[0].attachments[0];
  });
  assert.equal(legacy.data, 'YWJj');
  assert.equal(legacy.preview, 'data:image/png;base64,YWJj');
  assert.equal((await storedMedia())[0].id, 'legacy-image');
  assert.ok(!await page.evaluate(() => localStorage.getItem('jarvis.chats').includes('data:image/')));

  // The old preview contract also accepted image/jpg, which must migrate to canonical JPEG.
  await page.evaluate(() => {
    localStorage.setItem('jarvis.chats', JSON.stringify([{
      id: 'legacy-jpg', title: 'Legacy JPG alias', updatedAt: 1,
      messages: [{ id: 'legacy-jpg-message', role: 'user', content: '', attachments: [
        { id: 'legacy-jpg-image', name: 'old.jpg', type: 'image/jpg', size: 3, preview: 'data:image/jpg;base64,/9j/' },
      ] }],
    }]));
  });
  await page.reload({ waitUntil: 'networkidle2' });
  const legacyJpg = await page.evaluate(async () => {
    const { initializeChatMedia, loadChats } = await import('/src/lib/chats.ts');
    await initializeChatMedia();
    return loadChats()[0].messages[0].attachments[0];
  });
  assert.equal(legacyJpg.data, '/9j/');
  assert.equal(legacyJpg.type, 'image/jpeg');
  assert.equal(legacyJpg.preview, 'data:image/jpeg;base64,/9j/');
  assert.equal((await storedMedia())[0].id, 'legacy-jpg-image');

  // Binary writes must succeed before metadata stops carrying inline legacy bytes.
  const diskFailure = await page.evaluate(async () => {
    const { loadChats, saveChats, subscribeToChatStorageErrors } = await import('/src/lib/chats.ts');
    window.__storageErrors = [];
    subscribeToChatStorageErrors((message) => window.__storageErrors.push(message));
    window.__originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (mode === 'readwrite') throw new DOMException('Disk unavailable', 'UnknownError');
      return window.__originalTransaction.call(this, names, mode, options);
    };
    const chat = loadChats()[0];
    return saveChats([{ ...chat, title: 'Must not save', messages: [{ ...chat.messages[0], attachments: [
      { id: 'unsaved', name: 'unsaved.pdf', size: 3, type: 'application/pdf', data: 'YWJj' },
    ] }] }]).then(() => null, (error) => error.name);
  });
  assert.equal(diskFailure, 'UnknownError');
  await page.waitForFunction(() => window.__storageErrors.length > 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.chats'))[0].title), 'Legacy JPG alias');
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.__originalTransaction; });
  assert.deepEqual((await storedMedia()).map((row) => row.id), ['legacy-jpg-image']);

  // Missing binary records remain explicit attachments, with a visible recovery error.
  await page.evaluate(async () => {
    const { initializeChatMedia } = await import('/src/lib/chats.ts');
    window.__storageErrors = [];
    localStorage.setItem('jarvis.chats', JSON.stringify([{
      id: 'missing', title: 'Missing data', updatedAt: 1,
      messages: [{ id: 'missing-message', role: 'user', content: '', attachments: [
        { id: 'missing-file', name: 'lost.pdf', size: 100, type: 'application/pdf' },
      ] }],
    }]));
    await initializeChatMedia();
  });
  assert.match(await page.evaluate(() => window.__storageErrors[0]), /unavailable.*reattach/i);
  assert.deepEqual(errors, []);
  console.log('Media persistence passed: binary storage, reload, temporary exclusion, quota/write failures, ordering, cleanup, legacy migration, missing-file recovery.');
} finally {
  await context.close();
  await browser.close();
}
