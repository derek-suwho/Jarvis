import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';

// Fresh browser context; fixtures never touch the user's running desktop app.
const browser = await puppeteer.launch({
  executablePath: process.env.JARVIS_BROWSER ?? '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.setViewport({ width: 1440, height: 900 });

async function clickText(selector, text) {
  for (const element of await page.$$(selector)) {
    if (await element.evaluate((item) => item.textContent.trim()) === text) {
      await element.click();
      return;
    }
  }
  assert.fail(`Missing ${selector}: ${text}`);
}

async function replaceInput(selector, value) {
  await page.$eval(selector, (element) => {
    element.focus();
    element.select();
  });
  await page.keyboard.press('Backspace');
  await page.type(selector, value);
}

async function screenshot(label) {
  if (!process.argv.includes('--screenshots')) return;
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
  const directory = resolve('temporary screenshots');
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const next = 1 + Math.max(0, ...readdirSync(directory).map((name) => Number(name.match(/^screenshot-(\d+)/)?.[1] ?? 0)));
  const path = resolve(directory, `screenshot-${next}-navigation-${label}.png`);
  await page.screenshot({ path });
  console.log(`Screenshot: ${path}`);
}

try {
  await page.goto(process.env.JARVIS_CHECK_URL ?? 'http://localhost:3000', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.app');
  await page.evaluate(() => {
    const now = Date.now();
    const chat = (id, title, updatedAt, extra = {}) => ({
      id, title, updatedAt, ...extra,
      messages: [{ id: `${id}-user`, role: 'user', content: 'A nebula research question' }, { id: `${id}-reply`, role: 'assistant', content: 'A useful research response.' }],
    });
    localStorage.setItem('jarvis.chats', JSON.stringify([
      chat('navigation-recent', 'Nebula research plan', now),
      chat('navigation-archived', 'Archived release plan', now - 1000, { archived: true }),
      chat('navigation-project-chat', 'Project nebula discussion', now - 2000, { projectId: 'navigation-project' }),
      ...Array.from({ length: 24 }, (_, index) => ({ ...chat(`navigation-history-${index}`, `Earlier conversation ${index + 1}`, now - 3000 - index), messages: [] })),
    ]));
    localStorage.setItem('jarvis.projects', JSON.stringify([{ id: 'navigation-project', name: 'Research workspace', instructions: '', createdAt: now }]));
    localStorage.setItem('jarvis.preferences', JSON.stringify({ name: 'Navigation test', theme: 'dark', instructions: '' }));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.profile-btn');

  await page.click('.sidebar [aria-label="Search chats"]');
  const search = '[role="combobox"][aria-label="Search conversations"]';
  await page.waitForSelector(search);
  await page.type(search, 'nebula');
  await page.waitForFunction(() => document.querySelectorAll('.search-row:not(.search-new)').length === 3);
  assert.ok(await page.$$eval('mark', (marks) => marks.length >= 3), 'Search highlights matching text');
  assert.ok(await page.$eval('.search-results', (element) => element.textContent.includes('Research workspace')), 'Search shows project context');
  await page.keyboard.press('ArrowDown');
  assert.match(await page.$eval('.search-row[aria-selected="true"]', (element) => element.textContent), /Archived release plan/);
  await screenshot('search');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.topbar-title')?.textContent === 'Archived release plan');
  console.log('PASS Search matching, highlights, project context, archived results, arrows and Enter');

  await page.click('.sidebar [aria-label="Search chats"]');
  await page.waitForSelector(search);
  await page.type(search, 'Project nebula discussion');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.topbar-title')?.textContent === 'Project nebula discussion');
  await page.click('.chat-menu.toolbar .chat-menu-trigger');
  await clickText('.floating-chat-menu [role="menuitem"]', 'Rename');
  await page.waitForSelector('#rename-input');
  assert.equal(await page.$eval('.compact-dialog h2', (element) => element.textContent), 'Rename chat');
  await replaceInput('#rename-input', 'Renamed project conversation');
  assert.equal(await page.$eval('#rename-input', (element) => element.value), 'Renamed project conversation');
  await clickText('.compact-dialog button', 'Save');
  await page.waitForFunction(() => document.querySelector('.topbar-title')?.textContent === 'Renamed project conversation');
  console.log('PASS Project conversation rename opens central dialog and saves');

  const lastTrigger = '.history-group:last-child .history-item:last-child .chat-menu-trigger';
  await page.$eval(lastTrigger, (element) => element.scrollIntoView({ block: 'nearest' }));
  await page.click(lastTrigger);
  await page.waitForSelector('.floating-chat-menu');
  const bounds = await page.$eval('.floating-chat-menu', (element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: innerWidth, height: innerHeight };
  });
  assert.ok(bounds.top >= 0 && bounds.left >= 0 && bounds.bottom <= bounds.height && bounds.right <= bounds.width, 'Menu stays inside viewport at bottom of history');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Rename');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Pin chat');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Research workspace');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Move to project');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Delete chat');
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('chat-menu-trigger')), 'Menu restores trigger focus');
  console.log('PASS Menu placement, initial focus, arrows, End and Escape focus restoration');

  await page.click('.profile-btn');
  await page.click('.profile-menu [role="menuitem"]');
  await clickText('.dialog-nav-item', 'Data controls');
  await page.waitForSelector('.archive-search');
  await page.type('.archive-search', 'does not exist');
  assert.equal(await page.$$eval('.archived-list li', (items) => items.length), 0);
  await replaceInput('.archive-search', 'release');
  assert.equal(await page.$$eval('.archived-list li', (items) => items.length), 1);
  await page.$eval('.dialog button', (element) => element.focus());
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Unarchive');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'General');
  await clickText('.dialog-nav-item', 'Keyboard shortcuts');
  assert.equal(await page.$$eval('.shortcut-list > div', (items) => items.length), 9);
  await screenshot('settings');
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('profile-btn')), 'Settings restores opener focus');
  console.log('PASS Archive filtering, modal focus wrap, shortcut reference and focus restoration');

  await page.setViewport({ width: 390, height: 844 });
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.waitForSelector('.search-dialog');
  const narrow = await page.$eval('.search-dialog', (element) => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, viewport: innerWidth }));
  assert.ok(narrow.left >= 0 && narrow.right <= narrow.viewport, 'Narrow search fits viewport');
  await screenshot('narrow-search');
  await page.keyboard.press('Escape');
  console.log('PASS Narrow-window search layout');
  assert.deepEqual(errors, [], 'No runtime errors');
} finally {
  await browser.close();
}
