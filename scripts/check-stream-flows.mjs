import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

// Every page gets a fresh storage partition and a simulated Electron transport.
// No provider credentials, installed app state, or real model calls are used.
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    || '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox'],
});
const origin = process.env.JARVIS_TEST_URL || 'http://localhost:3000';
const mainMessage = '.chat-pane textarea[aria-label="Message"]';
const sideMessage = '.side-chat textarea[aria-label="Message"]';
const pageErrors = [];
const projects = [
  { id: 'alpha', name: 'Project Alpha', instructions: 'ALPHA_ONLY_INSTRUCTIONS', createdAt: 1 },
  { id: 'beta', name: 'Project Beta', instructions: 'BETA_ONLY_INSTRUCTIONS', createdAt: 2 },
];

async function createPage(chats = []) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.evaluateOnNewDocument(({ chats, projects }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('jarvis.chats', JSON.stringify(chats));
    localStorage.setItem('jarvis.projects', JSON.stringify(projects));
    localStorage.setItem('jarvis.preferences', JSON.stringify({
      name: 'Test', theme: 'dark', instructions: 'PERSONAL_PREFERENCE',
    }));
    const listeners = new Set();
    const harness = {
      requests: [],
      aborted: [],
      emit(index, event) {
        const request = this.requests[index];
        if (!request) throw new Error(`Missing simulated request ${index}`);
        for (const listener of [...listeners]) listener(request.id, event);
      },
    };
    window.__streamHarness = harness;
    window.jarvis = {
      isDesktop: true,
      platform: 'linux',
      setTheme() {},
      onCommand: () => () => {},
      chatgpt: {
        status: async () => ({ connected: true, registered: true, email: 'test@example.invalid' }),
        models: async () => [{ slug: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }],
        stream: async (id, payload) => {
          harness.requests.push({ id, payload: structuredClone(payload) });
        },
        abort: async (id) => { harness.aborted.push(id); },
        onStreamEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    };
  }, { chats, projects });
  await page.goto(origin, { waitUntil: 'networkidle2' });
  await page.waitForSelector(mainMessage);
  await page.waitForSelector('.plan-note');
  return { page, close: () => context.close() };
}

async function clickContaining(page, selector, text) {
  const target = await page.waitForFunction((selector, text) =>
    [...document.querySelectorAll(selector)].find((element) =>
      element.getClientRects().length > 0 && element.textContent.includes(text)), {}, selector, text);
  await target.asElement().click();
  await target.dispose();
}

async function fill(page, selector, text) {
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(selector, (element) => { element.focus(); element.select(); });
  await page.keyboard.type(text);
}

async function workspaceAction(page, text) {
  await page.click('[aria-label="Workspace options"]');
  await clickContaining(page, '[role="menuitem"]', text);
  await page.waitForFunction(() => !document.querySelector('.newtab-dropdown'));
}

async function request(page, pane, text, count) {
  await fill(page, pane === 'side' ? sideMessage : mainMessage, text);
  await page.click(`${pane === 'side' ? '.side-chat' : '.chat-pane'} [aria-label="Send message"]`);
  await page.waitForFunction((count) => window.__streamHarness.requests.length === count, {}, count);
}

async function complete(page, index, text, pane = '.chat-pane') {
  await page.evaluate(({ index, text }) => {
    window.__streamHarness.emit(index, { type: 'delta', text });
    window.__streamHarness.emit(index, { type: 'done' });
  }, { index, text });
  await page.waitForFunction((pane) => !document.querySelector(`${pane} [aria-label="Stop generating"]`), {}, pane);
}

async function checkRemovedProjectScope() {
  const { page, close } = await createPage();
  try {
    await clickContaining(page, '.project-item', 'Project Alpha');
    await request(page, 'main', 'Created in Alpha', 1);
    await complete(page, 0, 'First response');
    assert.match(await page.evaluate(() => window.__streamHarness.requests[0].payload.messages[0].content), /ALPHA_ONLY_INSTRUCTIONS/);

    await page.click('.chat-menu.toolbar button');
    await clickContaining(page, '[role="menuitem"]', 'Move to project');
    await clickContaining(page, '[role="menuitem"]', 'Remove from project');
    await page.waitForFunction(() => !document.querySelector('.topbar .crumb'));
    await request(page, 'main', 'Now outside the project', 2);
    const payload = await page.evaluate(() => window.__streamHarness.requests[1].payload);
    assert.ok(payload.messages.every((message) => !message.content.includes('ALPHA_ONLY_INSTRUCTIONS')),
      'removing a chat from its project must remove that instruction scope from the next payload');
    assert.match(payload.messages[0].content, /PERSONAL_PREFERENCE/);
    await complete(page, 1, 'Independent response');
  } finally {
    await close();
  }
}

async function checkSideScopeAndLifecycle() {
  const source = {
    id: 'alpha-source', title: 'Alpha source', projectId: 'alpha', updatedAt: 1,
    messages: [{ id: 'alpha-question', role: 'user', content: 'ALPHA_CONTEXT' }],
  };
  const { page, close } = await createPage([source]);
  try {
    await clickContaining(page, '.project-item', 'Project Alpha');
    await clickContaining(page, '.project-chats button', 'Alpha source');
    await workspaceAction(page, 'Side chat');
    const sidebarToggle = '[title="Open sidebar (⇧⌘S)"]';
    if (await page.$eval(sidebarToggle, (button) => button.getClientRects().length > 0)) {
      await page.click(sidebarToggle);
    }
    await clickContaining(page, '.project-item', 'Project Beta');

    await request(page, 'side', 'Side question from Alpha', 1);
    const payload = await page.evaluate(() => window.__streamHarness.requests[0].payload);
    assert.match(payload.messages[0].content, /ALPHA_CONTEXT/);
    assert.match(payload.messages[0].content, /ALPHA_ONLY_INSTRUCTIONS/);
    assert.ok(payload.messages.every((message) => !message.content.includes('BETA_ONLY_INSTRUCTIONS')),
      'side chat must retain its source scope after main-project navigation');
    await complete(page, 0, 'Completed side answer', '.side-chat');

    await request(page, 'side', 'A second side question', 2);
    assert.equal(await page.$$eval('.side-chat .streaming', (elements) => elements.length), 0,
      'a pending new turn must not mark the previous answer as streaming');
    assert.ok(await page.$('.side-chat .message.assistant [aria-label="Copy"]'),
      'the previous completed answer must retain its Copy action');

    await page.evaluate(() => window.__streamHarness.emit(1, {
      type: 'tool', id: 'tool-only', server: 'Example', tool: 'lookup', status: 'running',
    }));
    await page.waitForSelector('.side-chat .tool-activity .running');
    await page.click('.side-chat [aria-label="Stop generating"]');
    await page.waitForFunction(() => !document.querySelector('.side-chat [aria-label="Stop generating"]'));
    assert.equal(await page.$$eval('.side-chat .skeleton', (elements) => elements.length), 0,
      'stopped tool-only replies must not keep a generating skeleton');
    assert.equal(await page.$$eval('.side-chat .tool-activity .running', (elements) => elements.length), 0);
    assert.equal(await page.evaluate(() => window.__streamHarness.aborted.includes(window.__streamHarness.requests[1].id)), true);
    await page.evaluate(() => window.__streamHarness.emit(1, { type: 'delta', text: 'LATE_ABORTED_TOKEN' }));
    assert.equal(await page.$eval('.side-chat', (element) => element.textContent.includes('LATE_ABORTED_TOKEN')), false);
  } finally {
    await close();
  }
}

async function checkPayloadPreflight() {
  const file = (id) => ({ id, name: `${id}.txt`, size: 100000, type: 'text/plain', text: 'a'.repeat(100000) });
  const source = {
    id: 'large-history', title: 'Large existing context', updatedAt: 1,
    messages: [
      { id: 'u1', role: 'user', content: 'Earlier files', attachments: [file('one'), file('two')] },
      { id: 'a1', role: 'assistant', content: 'Reviewed' },
      { id: 'u2', role: 'user', content: 'Another file', attachments: [file('three')] },
      { id: 'a2', role: 'assistant', content: 'Reviewed again' },
    ],
  };
  const { page, close } = await createPage([source]);
  try {
    await clickContaining(page, '.history-select', 'Large existing context');
    const draft = 'Keep this complete draft after the size check.';
    await fill(page, mainMessage, draft);
    await page.$eval('.chat-pane input[type="file"]', (element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['b'.repeat(110000)], 'new-context.txt', { type: 'text/plain' }));
      element.files = transfer.files;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('.chat-pane .composer-files .file-chip');
    await page.click('.chat-pane [aria-label="Send message"]');
    await page.waitForFunction(() => document.querySelector('.chat-pane [role="alert"]')?.textContent.includes('too long'));
    assert.equal(await page.$eval(mainMessage, (element) => element.value), draft);
    assert.match(await page.$eval('.chat-pane .composer-files', (element) => element.textContent), /new-context\.txt/);
    assert.equal(await page.evaluate(() => window.__streamHarness.requests.length), 0,
      'oversized combined history must not reach the provider');
    assert.equal(await page.$$eval('.chat-pane .message.user', (elements) => elements.length), 2,
      'a rejected draft must not be appended to saved conversation history');
  } finally {
    await close();
  }
}

async function checkTemporaryToggle() {
  const { page, close } = await createPage();
  try {
    await workspaceAction(page, 'Temporary chat');
    await fill(page, mainMessage, 'Private temporary draft');
    await workspaceAction(page, 'Turn off temporary chat');
    await workspaceAction(page, 'Temporary chat');
    assert.equal(await page.$eval(mainMessage, (element) => element.value), '',
      'turning off temporary mode must discard its draft');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('jarvis.draft:temporary')), null);
  } finally {
    await close();
  }
}

async function checkErrorRetryAndEdit() {
  const { page, close } = await createPage();
  try {
    await request(page, 'main', 'A request that can be retried', 1);
    await page.evaluate(() => window.__streamHarness.emit(0, { type: 'error', message: 'Connection interrupted. Please try again.' }));
    await page.waitForSelector('.reply-error', { visible: true });
    await clickContaining(page, '.reply-error button', 'Try again');
    await page.waitForFunction(() => window.__streamHarness.requests.length === 2);
    assert.equal(await page.$$eval('.message.user', (elements) => elements.length), 1, 'retry must not duplicate the prompt');
    await complete(page, 1, 'Recovered response');
    await page.click('[aria-label="Edit message"]');
    await fill(page, 'textarea[aria-label="Edit message"]', 'Updated request');
    await clickContaining(page, '.edit-actions button', 'Send');
    await page.waitForFunction(() => window.__streamHarness.requests.length === 3);
    const messages = await page.evaluate(() => window.__streamHarness.requests[2].payload.messages);
    assert.equal(messages.length, 1, 'editing removes later conversation context');
    assert.match(messages[0].content, /Updated request/);
    assert.ok(!messages[0].content.includes('Recovered response'));
    await complete(page, 2, 'Edited response');
  } finally {
    await close();
  }
}

try {
  await checkRemovedProjectScope();
  await checkSideScopeAndLifecycle();
  await checkPayloadPreflight();
  await checkTemporaryToggle();
  await checkErrorRetryAndEdit();
  assert.deepEqual(pageErrors, [], 'no browser runtime errors');
  console.log('PASS: removed project scope; frozen side scope; pending reply identity; tool-only stop; payload preflight retains draft; temporary toggle cleanup; error retry and edit. Simulated transport only.');
} finally {
  await browser.close();
}
