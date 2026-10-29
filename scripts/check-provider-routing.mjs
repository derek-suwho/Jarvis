import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const url = process.env.JARVIS_CHECK_URL ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Use the isolated localhost application');
const browser = await puppeteer.launch({
  executablePath: process.env.JARVIS_BROWSER ?? '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.setViewport({ width: 1440, height: 900 });
page.setDefaultTimeout(10000);
await page.setRequestInterception(true);
page.on('request', (request) => {
  const target = new URL(request.url());
  if (['localhost', '127.0.0.1'].includes(target.hostname) || ['data:', 'blob:'].includes(target.protocol)) void request.continue();
  else void request.abort();
});

const message = '.chat-pane textarea[aria-label="Message"]';
const send = '.chat-pane button[aria-label="Send message"]';
async function clickText(selector, text) {
  const target = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(
    (node) => node.textContent.trim() === text && node.getClientRects().length,
  ), {}, selector, text);
  await target.asElement().click();
}
async function chooseModel(name) {
  await page.click('.chat-pane .model-trigger');
  await page.waitForSelector('.model-search-input');
  await page.type('.model-search-input', name);
  await clickText('.model-choice', name);
  await page.waitForSelector('.model-popover', { hidden: true });
  assert.equal(await page.$eval('.chat-pane .model-trigger > span', (node) => node.textContent), name);
}
async function requests(count) {
  await page.waitForFunction((count) => window.__routing.requests.length === count, {}, count);
  return page.evaluate(() => window.__routing.requests.at(-1));
}
async function attach(name, type, text, base64 = false) {
  await page.evaluate(({ name, type, text, base64 }) => {
    const data = base64 ? Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0)) : text;
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], name, { type }));
    document.querySelector('.chat-pane .composer').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, { name, type, text, base64 });
  await page.waitForFunction((name) => [...document.querySelectorAll('.composer-files .file-chip')].some((node) => node.title === name), {}, name);
  await page.waitForFunction((selector) => !document.querySelector(selector).disabled, {}, send);
}

try {
  await page.evaluateOnNewDocument(() => {
    localStorage.clear();
    const now = Date.now();
    localStorage.setItem('jarvis.preferences', JSON.stringify({ name: 'Routing fixture', theme: 'dark', instructions: 'Prefer exact, concise answers.' }));
    localStorage.setItem('jarvis.subscriptions', JSON.stringify({ google: 'AI Pro', xai: 'SuperGrok' }));
    localStorage.setItem('jarvis.projects', JSON.stringify([{ id: 'routing-project', name: 'Routing project', instructions: 'Keep the project constraints intact.', createdAt: now }]));
    localStorage.setItem('jarvis.chats', JSON.stringify([{
      id: 'routing-chat', title: 'Provider routing context', projectId: 'routing-project', updatedAt: now,
      messages: [
        { id: 'history-user', role: 'user', content: 'Retain this earlier user question.', attachments: [{ id: 'history-note', name: 'context.txt', size: 19, type: 'text/plain', text: 'Original saved note' }] },
        { id: 'history-assistant', role: 'assistant', content: 'Retain this earlier assistant reply.' },
      ],
    }]));

    const taskListeners = new Set();
    const records = [];
    const statuses = {
      gemini: { installed: true, connected: true, name: 'Alex Fixture', email: 'alex@example.invalid', plan: 'AI Pro' },
      grok: { installed: true, connected: true, name: 'Alex Fixture', email: 'alex@example.invalid', plan: 'SuperGrok' },
    };
    window.__routing = { requests: [], statuses, streamCalls: [] };
    const auth = (provider) => ({
      status: async () => ({ ...statuses[provider] }),
      signIn: async () => ({ ok: true }),
      cancel: async () => {},
      signOut: async () => ({ ok: true }),
      stream: async () => { window.__routing.streamCalls.push(provider); throw new Error('Native task requests must not use renderer stream fallback'); },
      abort: async () => {},
      onStreamEvent: () => () => {},
    });
    const unused = () => { throw new Error('Unexpected task action'); };
    const noop = async () => {};
    window.jarvis = {
      isDesktop: true,
      platform: 'linux',
      setTheme() {},
      onCommand: () => () => {},
      openExternal: noop,
      chatgpt: {
        status: async () => ({ connected: false, registered: false, name: null, email: null }),
        models: async () => [],
      },
      claude: { status: async () => ({ installed: true, connected: false, email: null, plan: null }) },
      gemini: auth('gemini'),
      grok: auth('grok'),
      tasks: {
        async start(input) {
          const received = structuredClone(input);
          window.__routing.requests.push(received);
          const id = `routing-task-${window.__routing.requests.length}`;
          const timestamp = Date.now();
          const task = {
            id, requestId: input.requestId, target: input.target, title: input.title, modelLabel: input.modelLabel,
            state: 'complete', revision: 1, createdAt: timestamp, updatedAt: timestamp, queue: [], unread: false,
            ...(input.creation ? { creation: input.creation } : {}),
            messages: [
              { ...input.input, taskId: id, delivery: 'applied' },
              { id: `${id}-reply`, role: 'assistant', content: `Fixture ${input.provider} response.`, model: input.modelLabel, taskId: id, outcome: 'complete' },
            ],
          };
          records.push(task);
          for (const listener of taskListeners) listener({ type: 'snapshot', task });
          return { ok: true, task };
        },
        queue: unused,
        removeQueued: unused,
        interrupt: unused,
        stop: unused,
        snapshot: async () => records,
        ack: noop,
        forgetTarget: noop,
        detach: noop,
        markRead: noop,
        setVisibleTargets: noop,
        setPreferences: noop,
        ready: noop,
        onEvent(listener) { taskListeners.add(listener); return () => taskListeners.delete(listener); },
        onOpenTarget: () => () => {},
      },
    };
  });

  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector(message);
  await page.click('.project-item[title="Routing project"]');
  await page.waitForSelector('.project-home');
  await page.click('.project-chats button');
  await page.waitForFunction(() => document.querySelector('.topbar-title')?.textContent === 'Provider routing context');
  await chooseModel('Gemini');
  await attach('prompt.txt', 'text/plain', 'Include this current text attachment.');
  await page.type(message, 'Send this follow-up through Gemini.');
  await page.click(send);
  const gemini = await requests(1);
  assert.equal(gemini.provider, 'gemini');
  assert.equal(gemini.model, 'gemini-default');
  assert.equal(gemini.target.id, 'routing-chat');
  assert.equal(gemini.input.content, 'Send this follow-up through Gemini.');
  assert.equal(gemini.input.attachments[0].text, 'Include this current text attachment.');
  assert.deepEqual(gemini.history.map(({ role, content }) => ({ role, content })), [
    { role: 'user', content: 'Retain this earlier user question.' },
    { role: 'assistant', content: 'Retain this earlier assistant reply.' },
  ]);
  assert.equal(gemini.history[0].attachments[0].text, 'Original saved note');
  assert.match(gemini.instructions, /Personal preferences:\nPrefer exact, concise answers\./);
  assert.match(gemini.instructions, /Project instructions:\nKeep the project constraints intact\./);
  await page.waitForFunction(() => document.querySelector('.chat-pane textarea[aria-label="Message"]').value === '');

  await chooseModel('Grok');
  await page.type(message, 'Continue this conversation through Grok.');
  await page.click(send);
  const grok = await requests(2);
  assert.equal(grok.provider, 'grok');
  assert.equal(grok.model, 'grok-default');
  assert.equal(grok.input.content, 'Continue this conversation through Grok.');
  assert.equal(grok.history.length, 4);
  assert.equal(grok.history[2].content, gemini.input.content);
  assert.equal(grok.history[2].attachments[0].text, gemini.input.attachments[0].text);
  assert.equal(grok.history[3].content, 'Fixture gemini response.');
  assert.equal(grok.instructions, gemini.instructions);
  assert.deepEqual(await page.evaluate(() => window.__routing.streamCalls), []);
  console.log('PASS Gemini/Grok select their native task adapters; history, instructions, text attachments survive model switches');

  await page.waitForFunction(() => document.querySelector('.chat-pane textarea[aria-label="Message"]').value === '');
  await page.type(message, 'Keep this unsent draft.');
  await attach('route-image.png', 'image/png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', true);
  await page.click(send);
  await page.waitForFunction(() => document.querySelector('.composer-errors')?.textContent.includes('Grok currently supports text attachments'));
  assert.equal(await page.$eval(message, (node) => node.value), 'Keep this unsent draft.');
  assert.equal(await page.evaluate(() => window.__routing.requests.length), 2);
  await page.click('[aria-label="Remove route-image.png"]');
  await chooseModel('Gemini');
  await attach('route-document.pdf', 'application/pdf', '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
  await page.click(send);
  await page.waitForFunction(() => document.querySelector('.composer-errors')?.textContent.includes('Gemini currently supports text attachments'));
  assert.equal(await page.$eval(message, (node) => node.value), 'Keep this unsent draft.');
  assert.equal(await page.evaluate(() => window.__routing.requests.length), 2);
  assert.equal(await page.$$eval('.composer-files .file-chip', (nodes) => nodes.length), 1);
  console.log('PASS Unsupported image/PDF requests stay unsent and preserve draft plus attachment');

  await page.evaluate(() => {
    window.__routing.statuses.gemini.connected = false;
    window.__routing.statuses.grok.connected = false;
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(() => document.querySelector('.chat-pane .model-trigger > span')?.textContent === 'Auto');
  await page.click('.navigation-rail [aria-label="Settings"]');
  await clickText('.dialog-nav-item', 'Subscriptions');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Gemini plan"], [aria-label="Grok plan"]'));
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.subscriptions'))), { google: 'AI Pro', xai: 'SuperGrok' });
  for (const provider of ['google', 'xai']) {
    assert.equal(await page.$eval(`[data-provider="${provider}"] .provider-actions button`, (node) => node.textContent), 'Sign in');
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialog', { hidden: true });
  await page.click('.chat-pane .model-trigger');
  assert.equal(await page.$$eval('.model-group', (nodes) => nodes.length), 0, 'Unverified saved plans cannot enable models');
  console.log('PASS Legacy plan metadata cannot bypass required provider sign-in');
  assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser.close();
}
