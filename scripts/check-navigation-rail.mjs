import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const labelIndex = process.argv.indexOf('--label');
const label = (labelIndex >= 0 ? process.argv[labelIndex + 1] : 'check')?.replace(/[^a-z0-9-]/gi, '-') || 'check';
const url = process.env.JARVIS_CHECK_URL ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Run visual checks against localhost');

// Isolated fixture data; never attach to the user's desktop browser or accounts.
const browser = await puppeteer.launch({
  executablePath: process.env.JARVIS_BROWSER ?? '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.setViewport({ width: 1440, height: 900 });

const rail = '.navigation-rail';
const profile = `${rail} .profile-btn`;
const historyToggle = `${rail} [aria-label="Chat history"]`;
const accountMenu = '[role="menu"][aria-label="Account"]';

async function clickText(selector, label) {
  for (const element of await page.$$(selector)) {
    const matches = await element.evaluate((node, text) => node.textContent.trim().startsWith(text), label);
    if (matches) {
      await element.click();
      return;
    }
  }
  assert.fail(`Missing ${selector}: ${label}`);
}

async function rect(selector) {
  return page.$eval(selector, (element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
  });
}

async function assertInViewport(selector) {
  const bounds = await rect(selector);
  const viewport = page.viewport();
  assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= viewport.width && bounds.bottom <= viewport.height,
    `${selector} fits ${viewport.width}×${viewport.height}: ${JSON.stringify(bounds)}`);
}

async function screenshot(state) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
  const directory = path.resolve('temporary screenshots');
  await mkdir(directory, { recursive: true });
  const files = await readdir(directory);
  const number = Math.max(0, ...files.map((file) => Number(file.match(/^screenshot-(\d+)/)?.[1] ?? 0))) + 1;
  const file = path.join(directory, `screenshot-${number}-rail-${label}-${state}.png`);
  await page.screenshot({ path: file });
  console.log(`Screenshot: ${file}`);
}

async function openProfile() {
  await page.click(profile);
  await page.waitForSelector(accountMenu, { visible: true });
  assert.equal(await page.$eval(profile, (element) => element.getAttribute('aria-expanded')), 'true');
}

async function closeProfile() {
  await page.keyboard.press('Escape');
  await page.waitForSelector(accountMenu, { hidden: true });
  assert.equal(await page.$eval(profile, (element) => element.getAttribute('aria-expanded')), 'false');
  assert.ok(await page.$eval(profile, (element) => element === document.activeElement), 'Escape restores profile trigger focus');
}

async function replaceName(name) {
  const input = '.dialog input[placeholder="Your name"]';
  await page.$eval(input, (element) => {
    element.focus();
    element.select();
  });
  await page.keyboard.press('Backspace');
  await page.type(input, name);
}

try {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.app');
  await page.evaluate(() => {
    const now = Date.now();
    const titles = [
      'Research outline', 'Plan the next release', 'Notes from the design review', 'Draft the project brief',
      'Prepare a workshop', 'Review the onboarding flow', 'Compare research methods', 'Write the team update',
      'Organize interview notes', 'Explore a new idea', 'Create a reading list', 'Summarize weekly progress',
      'Simplify the navigation', 'Build a study schedule', 'Review the experiment', 'Outline a presentation',
      'Refine the product story', 'Plan the next sprint', 'Map the customer journey', 'Review accessibility',
      'Write a project summary', 'Discuss design tradeoffs', 'Prepare the launch notes', 'Organize reference material',
      'Draft a proposal', 'Review the implementation', 'Plan a working session', 'Create a testing checklist',
      'Explore the next milestone', 'Collect open questions',
    ];
    localStorage.clear();
    localStorage.setItem('jarvis.preferences', JSON.stringify({ name: 'Alex Morgan', theme: 'dark', instructions: '' }));
    localStorage.setItem('jarvis.projects', JSON.stringify([
      { id: 'rail-research', name: 'Research', instructions: '', createdAt: now },
      { id: 'rail-writing', name: 'Writing', instructions: '', createdAt: now },
    ]));
    localStorage.setItem('jarvis.chats', JSON.stringify(titles.map((title, index) => ({
      id: `rail-chat-${index}`, title, updatedAt: now - index * 1000,
      ...(index === 0 ? { projectId: 'rail-research' } : {}),
      messages: [
        { id: `rail-user-${index}`, role: 'user', content: 'Help me outline the next steps for this project.' },
        { id: `rail-reply-${index}`, role: 'assistant', content: 'Start with the research questions, gather the evidence, and decide which questions to investigate first.' },
      ],
    }))));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector(rail, { visible: true });
  await page.waitForSelector('.sidebar', { visible: true });
  assert.equal(await page.$eval(profile, (element) => element.getAttribute('aria-label')), 'Profile menu');
  assert.equal(await page.$eval(`${profile} .avatar`, (element) => element.textContent), 'AM');
  assert.ok(await page.$eval(rail, (element) => !element.querySelector('.history')), 'History is separate from global navigation');

  const railBefore = await rect(rail);
  const profileBefore = await rect(profile);
  assert.ok((await rect('.sidebar')).left >= railBefore.right, 'History occupies its own column beside the rail');
  const scrolled = await page.$eval('.history', (element) => {
    element.scrollTop = element.scrollHeight;
    return { top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight };
  });
  assert.ok(scrolled.total > scrolled.height && scrolled.top > 0, 'History scrolls with many conversations');
  assert.deepEqual(await rect(rail), railBefore, 'Rail stays fixed while history scrolls');
  assert.deepEqual(await rect(profile), profileBefore, 'Profile stays anchored while history scrolls');
  await page.$eval('.history', (element) => { element.scrollTop = 0; });
  await screenshot('dark-history');
  console.log('PASS Separate history column and independent scrolling');

  await page.click('.history-select[title="Plan the next release"]');
  await page.waitForFunction(() => document.querySelector('.topbar-title')?.textContent === 'Plan the next release');
  await page.click(`${rail} [aria-label="Home"]`);
  await page.waitForFunction(() => document.querySelector('.topbar-title')?.textContent === '');
  await page.click(historyToggle);
  await page.waitForSelector('.sidebar', { hidden: true });
  assert.equal(await page.$eval(historyToggle, (element) => element.getAttribute('aria-expanded')), 'false');
  await assertInViewport(`${rail} [aria-label="Settings"]`);
  await assertInViewport(profile);
  await page.click(`${rail} [aria-label="Settings"]`);
  await page.waitForSelector('.dialog', { visible: true });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialog', { hidden: true });
  assert.ok(await page.$eval(`${rail} [aria-label="Settings"]`, (element) => element === document.activeElement), 'Direct Settings restores rail focus');
  await page.click(historyToggle);
  await page.waitForSelector('.sidebar', { visible: true });
  console.log('PASS Home navigation; rail and Settings survive history collapse');

  await openProfile();
  assert.equal(await page.$eval(`${accountMenu} .profile-name`, (element) => element.textContent), 'Alex Morgan');
  await assertInViewport(accountMenu);
  await screenshot('dark-profile');
  await page.keyboard.press('End');
  assert.ok(await page.$eval(accountMenu, (element) => element.contains(document.activeElement)), 'End keeps focus in account menu');
  await page.keyboard.press('Home');
  assert.match(await page.evaluate(() => document.activeElement.textContent.trim()), /^Settings/);
  await page.keyboard.press('ArrowDown');
  assert.match(await page.evaluate(() => document.activeElement.textContent.trim()), /^Help/);
  await closeProfile();

  await openProfile();
  await page.click('.chat-pane textarea[aria-label="Message"]');
  await page.waitForSelector(accountMenu, { hidden: true });
  assert.equal(await page.$eval(profile, (element) => element.getAttribute('aria-expanded')), 'false');
  console.log('PASS Real profile name, initials, menu keyboard controls, Escape and outside dismissal');

  await openProfile();
  await clickText(`${accountMenu} [role="menuitem"]`, 'Settings');
  await page.waitForSelector('.dialog', { visible: true });
  await page.waitForSelector(accountMenu, { hidden: true });
  await replaceName('Taylor Quinn');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialog', { hidden: true });
  assert.ok(await page.$eval(profile, (element) => element === document.activeElement), 'Settings opened from menu restores profile trigger');
  await openProfile();
  assert.equal(await page.$eval(`${accountMenu} .profile-name`, (element) => element.textContent), 'Taylor Quinn');
  assert.equal(await page.$eval(`${profile} .avatar`, (element) => element.textContent), 'TQ');
  await closeProfile();
  await page.reload({ waitUntil: 'networkidle0' });
  await openProfile();
  assert.equal(await page.$eval(`${accountMenu} .profile-name`, (element) => element.textContent), 'Taylor Quinn');
  await clickText(`${accountMenu} [role="menuitem"]`, 'Help');
  await clickText('[role="menuitem"]', 'Keyboard shortcuts');
  await page.waitForSelector('.shortcut-list', { visible: true });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialog', { hidden: true });
  assert.ok(await page.$eval(profile, (element) => element === document.activeElement), 'Help restores profile trigger focus');
  console.log('PASS Profile-to-Settings focus, persisted display-name changes, Help shortcuts');

  await page.click(`${rail} [aria-label="Settings"]`);
  await page.waitForSelector('.dialog', { visible: true });
  await replaceName('Alex Morgan');
  await clickText('[role="radiogroup"][aria-label="Theme"] [role="radio"]', 'Light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialog', { hidden: true });
  await openProfile();
  await assertInViewport(accountMenu);
  await screenshot('light-profile');
  await closeProfile();

  await page.click(`${rail} [aria-label="Settings"]`);
  await page.waitForSelector('.dialog', { visible: true });
  await clickText('[role="radiogroup"][aria-label="Theme"] [role="radio"]', 'Dark');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialog', { hidden: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector(rail, { visible: true });
  await page.waitForSelector('.sidebar', { hidden: true });
  await assertInViewport(rail);
  await assertInViewport(profile);
  await screenshot('mobile-home');
  await page.click(historyToggle);
  await page.waitForSelector('.sidebar', { visible: true });
  await assertInViewport('.sidebar');
  await screenshot('mobile-history');
  await page.click('.history-select[title="Plan the next release"]');
  await page.waitForSelector('.sidebar', { hidden: true });
  await page.waitForFunction(() => document.querySelector('.topbar-title')?.textContent === 'Plan the next release');
  await openProfile();
  await assertInViewport(accountMenu);
  await screenshot('mobile-profile');
  await closeProfile();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile has no horizontal overflow');
  console.log('PASS Light theme, mobile rail/history/menu bounds and chat navigation');

  // Connected UI fixture only: never call the user's real account bridges.
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('jarvis.preferences', JSON.stringify({ name: '', theme: 'dark', instructions: '' }));
    localStorage.setItem('jarvis.subscriptions', JSON.stringify({ google: 'AI Pro', xai: 'SuperGrok' }));
    window.providerFixture = {
      gemini: { installed: true, connected: false, name: 'Alex Morgan', email: 'alex@example.com', plan: null },
      grok: { installed: true, connected: false, name: 'Alex Morgan', email: 'alex@example.com', plan: null },
    };
    const connection = (key) => ({
      status: async () => ({ ...window.providerFixture[key] }),
      signIn: async () => ({ ok: true }),
      cancel: async () => {},
      signOut: async () => { window.providerFixture[key].connected = false; return { ok: true }; },
    });
    window.jarvis = {
      isDesktop: true,
      platform: 'darwin',
      setTheme: () => {},
      onCommand: () => () => {},
      openExternal: async () => {},
      chatgpt: {
        status: async () => ({ connected: true, registered: true, name: 'Alex Morgan', email: 'alex@example.com' }),
        models: async () => [{ slug: 'gpt-fixture', name: 'GPT Fixture' }],
        signOut: async () => ({ ok: true, revoked: true }),
      },
      claude: {
        status: async () => ({ installed: true, connected: true, email: 'alex@example.com', plan: 'pro' }),
        signOut: async () => ({ ok: false, error: 'Fixture logout failure' }),
      },
      gemini: connection('gemini'),
      grok: connection('grok'),
    };
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.profile-btn')?.getAttribute('title') === 'Alex Morgan');
  await openProfile();
  assert.equal(await page.$eval(`${accountMenu} .profile-name`, (element) => element.textContent), 'Alex Morgan');
  await screenshot('connected-profile');
  await clickText(`${accountMenu} [role="menuitem"]`, 'Log out');
  assert.match(await page.$eval('[role="menu"][aria-label="Log out"]', (element) => element.textContent), /Also signs out Terminal/);
  await clickText('[role="menu"][aria-label="Log out"] [role="menuitem"]', 'Claude Code');
  await page.waitForSelector('.profile-menu-error');
  assert.match(await page.$eval('.profile-plan', (element) => element.textContent), /2 accounts connected/);
  await closeProfile();
  await page.click(`${rail} [aria-label="Settings"]`);
  await page.waitForSelector('.dialog');
  await clickText('.dialog-nav-item', 'Subscriptions');
  await page.waitForSelector('.account-action');
  await screenshot('account-buttons-dark');
  await clickText('.dialog-nav-item', 'General');
  await clickText('[role="radiogroup"][aria-label="Theme"] [role="radio"]', 'Light');
  await clickText('.dialog-nav-item', 'Subscriptions');
  await screenshot('account-buttons-light');
  console.log('PASS Connected account name, explicit logout choices, failed logout retains connection; account buttons captured');
  for (const [id, key, plan] of [['google', 'gemini', 'AI Ultra'], ['xai', 'grok', 'SuperGrok Heavy']]) {
    const row = `.provider-row[data-provider="${id}"]`;
    assert.equal(await page.$(`${row} select`), null, 'A stored plan cannot bypass sign-in');
    await clickText(`${row} button`, 'Sign in');
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('Finish signing in'), {}, row);
    assert.equal(await page.$(`${row} select`), null, 'Plans remain read-only during sign-in');
    await screenshot(`${key}-waiting-for-signin`);
    await page.evaluate(({ provider, plan }) => {
      window.providerFixture[provider].connected = true;
      window.providerFixture[provider].plan = plan;
      window.dispatchEvent(new Event('focus'));
    }, { provider: key, plan });
    await page.waitForFunction((selector, label) => document.querySelector(selector)?.textContent.includes(label), {}, row, plan);
    assert.equal(await page.$(`${row} select`), null, 'Connected plans are account metadata, not editable choices');
    await screenshot(`${key}-verified-plan`);
    await clickText(`${row} button`, 'Sign out');
    if (key === 'gemini') await clickText(`${row} button`, 'Confirm sign out');
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('Not connected'), {}, row);
  }
  console.log('PASS Gemini and Grok plans display only after verified status and disappear on sign-out');
  assert.deepEqual(errors, [], 'No runtime errors');
} finally {
  await browser.close();
}
