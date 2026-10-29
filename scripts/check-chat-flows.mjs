import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  executablePath:
    '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const screenshotDir = path.resolve('temporary screenshots');
await mkdir(screenshotDir, { recursive: true });
const shot = async (label) => {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  const files = await readdir(screenshotDir);
  const number = Math.max(0, ...files.map((file) => Number(file.match(/^screenshot-(\d+)/)?.[1] ?? 0))) + 1;
  await page.screenshot({ path: path.join(screenshotDir, `screenshot-${number}-${label}.png`) });
};
const clickText = async (text, selector = 'button') => {
  const target = await page.waitForFunction(
    (text, selector) =>
      [...document.querySelectorAll(selector)].find(
        (node) => node.textContent.trim() === text && node.getClientRects().length,
      ),
    {},
    text,
    selector,
  );
  await target.asElement().click();
};
const fill = async (selector, value) => {
  await page.waitForSelector(selector, { visible: true });
  await page.focus(selector);
  await page.$eval(selector, (element) => element.select());
  await page.keyboard.type(value);
};
const message = '.chat-pane textarea[aria-label="Message"]';
const chatButton = async (name) => {
  const target = await page.waitForFunction(
    (title) => [...document.querySelectorAll('.history-select')].find(
      (node) => node.querySelector('.history-title')?.textContent.trim() === title && node.getClientRects().length,
    ),
    {},
    name,
  );
  await target.asElement().click();
};
const value = () => page.$eval(message, (element) => element.value);
const now = Date.now();
const fixtures = [
  {
    id: 'chat-focus',
    title: 'A calmer morning routine',
    updatedAt: now,
    messages: [
      { id: 'q1', role: 'user', content: 'Help me make room for focused work in the morning.' },
      {
        id: 'a1',
        role: 'assistant',
        model: 'Claude',
        content:
          'Start with **one hour you can protect**.\n\n1. Choose the most important task the night before.\n2. Keep the first 30 minutes free of messages.\n3. End with a short note about your next step.\n\n> A small, repeatable routine is easier to keep than a perfect schedule.\n\nWould you like to shape this around your current mornings?',
      },
    ],
  },
  {
    id: 'chat-plan',
    title: 'Notes for the next release',
    updatedAt: now - 86400000,
    messages: [
      { id: 'q2', role: 'user', content: 'Organize the release notes' },
      {
        id: 'a2',
        role: 'assistant',
        model: 'GPT',
        content:
          '## Release checklist\n\n| Area | Next step |\n| --- | --- |\n| Navigation | Check keyboard access |\n| Composer | Restore drafts |\n\n```ts\nconst ready = checks.every(check => check.passed);\n```',
      },
    ],
  },
  {
    id: 'chat-project',
    title: 'Research questions',
    projectId: 'project-notes',
    updatedAt: now,
    messages: [
      { id: 'q3', role: 'user', content: 'Where should this research begin?' },
      { id: 'a3', role: 'assistant', content: 'Define the question before choosing a method.' },
    ],
  },
];
const file = path.join(tmpdir(), `jarvis-ui-${process.pid}.txt`);
try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  await page.evaluate(
    ({ fixtures, now }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('jarvis.chats', JSON.stringify(fixtures));
      localStorage.setItem('jarvis.subscriptions', JSON.stringify({ anthropic: 'Pro' }));
      localStorage.setItem(
        'jarvis.projects',
        JSON.stringify([
          {
            id: 'project-notes',
            name: 'Product research',
            instructions: 'Lead with evidence and list open questions.',
            createdAt: now,
          },
        ]),
      );
      localStorage.setItem(
        'jarvis.preferences',
        JSON.stringify({ name: 'Derek', theme: 'dark', instructions: 'Use concise explanations.' }),
      );
    },
    { fixtures, now },
  );
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector(message);

  await clickText('Think it throughFind a fresh perspective');
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.value.includes('Help me think'),
    {},
    message,
  );
  assert.equal(await page.$$eval('.message.user', (nodes) => nodes.length), 0, 'suggestions must prepare a draft');
  await fill(message, 'An unsent home draft');
  await chatButton('A calmer morning routine');
  assert.equal(await value(), '', 'home draft must not leak into existing chat');
  await fill(message, 'Follow-up draft for morning routine');
  await chatButton('Notes for the next release');
  assert.equal(await value(), '');
  await chatButton('A calmer morning routine');
  assert.equal(await value(), 'Follow-up draft for morning routine');
  await shot('conversation-dark');
  await page.click('.nav-item[aria-label="New chat"]');
  assert.equal(await value(), 'An unsent home draft');

  await page.click('.model-trigger');
  await fill('.model-search-input', 'sonnet');
  await page.waitForSelector('.model-popover .menu-empty');
  assert.equal(await page.$$eval('.model-choice', (nodes) => nodes.length), 0, 'A locally tracked plan cannot unlock signed-out models');
  await fill('.model-search-input', 'auto');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.model-popover'));
  assert.match(await page.$eval('.model-trigger', (node) => node.textContent), /Auto/);

  await writeFile(file, 'Small attachment with actual provider-visible text.');
  const input = await page.$('.chat-pane input[type="file"]');
  await input.uploadFile(file);
  await page.waitForSelector('.composer-file-size');
  await fill(message, 'Summarize this attachment');
  await page.click('.chat-pane [aria-label="Send message"]');
  await page.waitForSelector('.chat-pane [aria-label="Stop generating"]');
  await fill(message, 'A draft while generation runs');
  await chatButton('Notes for the next release');
  await chatButton('Summarize this attachment');
  assert.equal(await value(), 'A draft while generation runs');
  const stop = await page.$('.chat-pane [aria-label="Stop generating"]');
  if (stop) await stop.click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.chats')));
  assert.equal(
    saved.find((chat) => chat.title === 'Summarize this attachment').messages[0].attachments[0].text,
    'Small attachment with actual provider-visible text.',
  );

  await page.click('.chat-menu.toolbar button');
  await clickText('Delete chat', '[role="menuitem"]');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('jarvis.chats')).some((chat) => chat.title === 'Summarize this attachment'));
  await clickText('Undo', '.toast button');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('jarvis.chats')).some((chat) => chat.title === 'Summarize this attachment'));
  await chatButton('Summarize this attachment');
  assert.equal(await page.$eval('.message.user .message-body', (element) => element.textContent), 'Summarize this attachment');

  await page.click('[aria-label="Workspace options"]');
  await clickText('Temporary chat', '[role="menuitem"]');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Temporary Chat');
  await fill(message, 'Private unsent draft');
  await page.click('.nav-item[aria-label="New chat"]');
  await page.click('[aria-label="Workspace options"]');
  await clickText('Temporary chat', '[role="menuitem"]');
  assert.equal(await value(), '', 'temporary draft must be discarded on navigation');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('jarvis.draft:temporary')), null);
  await fill(message, 'This temporary message must never persist');
  await page.click('.chat-pane [aria-label="Send message"]');
  await page.waitForSelector('.chat-pane [aria-label="Stop generating"]');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('jarvis.chats').includes('This temporary message')),
    false,
  );
  await page.click('.nav-item[aria-label="New chat"]');
  assert.equal(await page.$('.topbar .temp-pill'), null, 'new chat must leave temporary mode');

  await clickText('Product research1', '.project-item');
  await page.waitForSelector('.project-home');
  await shot('project-dark');
  await clickText('Rename project');
  await fill('#rename-input', 'Research notebook');
  await clickText('Save');
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Research notebook');

  await page.evaluate(() => {
    const preferences = JSON.parse(localStorage.getItem('jarvis.preferences'));
    localStorage.setItem('jarvis.preferences', JSON.stringify({ ...preferences, theme: 'light' }));
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await shot('home-light');
  await chatButton('Notes for the next release');
  await shot('conversation-light');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle2' });
  assert.equal(await page.$('.sidebar'), null);
  await shot('mobile-home');
  await page.click('[title="Open sidebar (⇧⌘S)"]');
  await page.waitForSelector('.sidebar-scrim', { visible: true });
  await shot('mobile-sidebar');
  await chatButton('A calmer morning routine');
  await page.waitForFunction(() => !document.querySelector('.sidebar'));
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'no mobile horizontal overflow',
  );
  await shot('mobile-conversation');
  await page.click('.model-trigger');
  const box = await page.$eval('.model-popover', (element) => {
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, bottom: r.bottom };
  });
  assert.ok(box.left >= 0 && box.right <= 390 && box.bottom <= 844, 'model picker stays in mobile viewport');
  await shot('mobile-model-picker');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(
    'PASS: prompt prefill; isolated drafts; restore; model keyboard selection; file contents; generation navigation; delete/undo; temporary cleanup; project rename; light/dark; mobile navigation and bounds.',
  );
} catch (error) {
  await shot('flow-failure');
  throw error;
} finally {
  await rm(file, { force: true });
  await browser.close();
}
