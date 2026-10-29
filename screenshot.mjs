import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';

const screenshotsDir = join(__dirname, 'temporary screenshots');
if (!existsSync(screenshotsDir)) {
  mkdirSync(screenshotsDir, { recursive: true });
}

const existing = readdirSync(screenshotsDir).filter(f => f.endsWith('.png'));
const numbers = existing
  .map(f => parseInt(f.match(/^screenshot-(\d+)/)?.[1] || '0'))
  .filter(Boolean);
const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

const filename = label
  ? `screenshot-${nextNum}-${label}.png`
  : `screenshot-${nextNum}.png`;

const browser = await puppeteer.launch({
  executablePath:
    '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

// Allow animations to settle
await new Promise(r => setTimeout(r, 800));

const filepath = join(screenshotsDir, filename);
await page.screenshot({ path: filepath, fullPage: false });
console.log(`Screenshot saved: ${filepath}`);

await browser.close();
