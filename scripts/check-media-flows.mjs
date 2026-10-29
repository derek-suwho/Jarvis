import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

// Exercise the real composer/history with simulated provider transport. No model calls.
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    || '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox'],
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-media-'));
const screenshotDir = path.resolve('temporary screenshots');
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(10000);
await page.setViewport({ width: 1440, height: 900 });
const message = '.chat-pane textarea[aria-label="Message"]';
const send = '.chat-pane button[aria-label="Send message"]';
const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n';

async function shot(label) {
  await mkdir(screenshotDir, { recursive: true });
  const files = await readdir(screenshotDir);
  const number = Math.max(0, ...files.map((file) => Number(file.match(/^screenshot-(\d+)/)?.[1] ?? 0))) + 1;
  const file = path.join(screenshotDir, `screenshot-${number}-${label}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}

async function finishReply() {
  await page.evaluate(() => window.__mediaHarness.finish());
  await page.waitForSelector(send);
}

async function requestCount(count) {
  await page.waitForFunction((count) => window.__mediaHarness.requests.length === count, {}, count);
  return page.evaluate(() => window.__mediaHarness.requests.at(-1));
}

try {
  await page.evaluateOnNewDocument(() => {
    const listeners = new Set();
    window.__mediaHarness = {
      requests: [],
      finish() {
        const { id } = this.requests.at(-1);
        for (const listener of listeners) listener(id, { type: 'delta', text: 'Simulated provider response.' });
        for (const listener of [...listeners]) listener(id, { type: 'done' });
      },
    };
    const bridge = (provider) => ({
      stream: async (id, payload) => window.__mediaHarness.requests.push({ id, provider, payload }),
      abort: async () => {},
      onStreamEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    window.jarvis = {
      isDesktop: true, platform: 'linux', setTheme() {}, onCommand: () => () => {},
      chatgpt: {
        ...bridge('chatgpt'),
        status: async () => ({ connected: true, registered: true, email: 'test@example.invalid' }),
        models: async () => [{ slug: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }],
      },
      claude: {
        ...bridge('claude'),
        status: async () => ({ installed: true, connected: true, email: 'test@example.invalid', plan: 'max' }),
      },
    };
  });
  await page.goto(process.env.JARVIS_TEST_URL || 'http://localhost:3000', { waitUntil: 'networkidle2' });
  await page.waitForSelector(message);
  await page.waitForSelector('.plan-note');
  await page.type(message, 'Compare the chart and report');
  const pdfPath = path.join(directory, 'Quarterly report.pdf');
  await writeFile(pdfPath, pdf);
  await (await page.$('.chat-pane input[type="file"]')).uploadFile(pdfPath);
  await page.waitForSelector('.composer-files .file-chip');

  // Clipboard image and drag/drop text both use the same validated attachment path.
  const imageData = await page.evaluate((selector) => {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f5f7f6';
    ctx.fillRect(0, 0, 720, 420);
    ctx.fillStyle = '#28483f';
    ctx.font = '30px sans-serif';
    ctx.fillText('Quarterly revenue', 36, 52);
    [120, 180, 240, 290].forEach((height, index) => {
      ctx.fillStyle = '#57998a';
      ctx.fillRect(55 + index * 165, 360 - height, 100, height);
      ctx.fillStyle = '#28483f';
      ctx.font = '20px sans-serif';
      ctx.fillText(`Q${index + 1}`, 90 + index * 165, 390);
    });
    const data = canvas.toDataURL('image/png').split(',')[1];
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([bytes], 'Revenue chart.png', { type: 'image/png' }));
    document.querySelector(selector).dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: clipboard }));
    const dropped = new DataTransfer();
    dropped.items.add(new File(['Compare Q1 and Q4.'], 'notes.txt', { type: 'text/plain' }));
    document.querySelector('.composer').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dropped }));
    return data;
  }, message);
  await page.waitForFunction(() => document.querySelectorAll('.composer-files .file-chip').length === 3);
  await page.waitForFunction(() => document.querySelector('.composer-file-preview')?.naturalWidth > 0);
  await shot('media-composer-pass-1');
  await page.click(send);
  const first = await requestCount(1);
  assert.equal(first.provider, 'chatgpt');
  assert.equal(first.payload.messages[0].media.length, 2);
  assert.equal(first.payload.messages[0].media[0].data, Buffer.from(pdf).toString('base64'));
  assert.equal(first.payload.messages[0].media[1].data, imageData);
  assert.match(first.payload.messages[0].content, /Compare Q1 and Q4/);
  await finishReply();
  await page.type(message, 'Explain the largest change');
  await page.click(send);
  const followup = await requestCount(2);
  assert.deepEqual(followup.payload.messages[0].media, first.payload.messages[0].media);
  await finishReply();

  await page.click('.chat-pane button[aria-label^="Choose model,"]');
  await page.waitForSelector('.model-choice');
  await page.evaluate(() => [...document.querySelectorAll('.model-choice')].find((button) => button.textContent.includes('Sonnet')).click());
  await page.type(message, 'Review these files with Claude');
  await page.click(send);
  const switched = await requestCount(3);
  assert.equal(switched.provider, 'claude');
  assert.deepEqual(switched.payload.messages[0].media, first.payload.messages[0].media);
  await finishReply();
  await page.waitForFunction(() => {
    const chats = JSON.parse(localStorage.getItem('jarvis.chats') || '[]');
    return chats[0]?.messages.length === 6 && !chats[0].messages[0].attachments[0].data;
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('.history-select');
  await page.waitForFunction(() => document.querySelector('.msg-thumb')?.naturalWidth > 0);
  await page.$eval('.messages-scroll', (node) => node.scrollTo({ top: 0, behavior: 'instant' }));
  await shot('media-restored-pass-2');
  await page.type(message, 'What does the original image show?');
  await page.click(send);
  const reloaded = await requestCount(1);
  assert.deepEqual(reloaded.payload.messages[0].media, first.payload.messages[0].media);
  await finishReply();
  await shot('media-history-pass-2');

  await page.type(message, 'Keep this unsent question');
  await page.evaluate(() => {
    const dropped = new DataTransfer();
    dropped.items.add(new File(['not a PDF'], 'broken.pdf', { type: 'application/pdf' }));
    dropped.items.add(new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'too-big.png', { type: 'image/png' }));
    document.querySelector('.composer').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dropped }));
  });
  await page.waitForFunction(() => document.querySelector('.composer-errors')?.textContent.includes('damaged'));
  assert.match(await page.$eval('.composer-errors', (node) => node.textContent), /3.0 MB/);
  assert.equal(await page.$eval(message, (node) => node.value), 'Keep this unsent question');
  assert.equal(await page.$$eval('.composer-files .file-chip', (nodes) => nodes.length), 0);

  // Attachment-only sends are valid, including a PDF without a typed prompt.
  await page.$eval(message, (node) => { node.focus(); node.select(); });
  await page.keyboard.press('Backspace');
  await (await page.$('.chat-pane input[type="file"]')).uploadFile(pdfPath);
  await page.waitForFunction((selector) => !document.querySelector(selector).disabled, {}, send);
  await page.click(send);
  const attachmentOnly = await requestCount(2);
  assert.equal(attachmentOnly.payload.messages.at(-1).content, '');
  assert.equal(attachmentOnly.payload.messages.at(-1).media[0].name, 'Quarterly report.pdf');
  await finishReply();
  await page.setViewport({ width: 390, height: 844 });
  await page.click('.sidebar button[title="Close sidebar"]');
  await page.waitForSelector('.sidebar-scrim', { hidden: true });
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await shot('media-mobile-pass-2');
  assert.deepEqual(errors, []);
  console.log('Media flows passed: picker, paste, drop, both providers, follow-up, reload, rejection, attachment-only, mobile.');
} finally {
  await context.close();
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
