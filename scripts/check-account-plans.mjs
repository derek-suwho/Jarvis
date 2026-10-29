import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  executablePath: '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000/tests/fixtures/account-plans.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.provider-row.added');
  const row = id => `.provider-row[data-provider="${id}"]`;
  const text = id => page.$eval(row(id), node => node.textContent);
  assert.equal(await page.$('.provider-row select'), null, 'Plans are read-only');
  assert.match(await text('openai'), /Plus/, 'ChatGPT uses account metadata');
  assert.doesNotMatch(await text('openai'), /Business/, 'Saved manual choices are ignored');
  assert.match(await text('anthropic'), /Pro/);
  assert.match(await text('google'), /AI Pro/);
  assert.doesNotMatch(await text('google'), /AI Ultra/);
  const manage = (await page.$$(row('openai') + ' button'))[0];
  await manage.click();
  assert.equal(await page.evaluate(() => window.lastOpenedUrl), 'https://chatgpt.com/settings/usage');
  await page.evaluate(() => {
    window.accountPlanFixture.chatgpt.plan = null;
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(() => document.querySelector('[data-provider="openai"]').textContent.includes('Plan unavailable'));
  await page.evaluate(() => {
    window.accountPlanFixture.chatgpt.connected = false;
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(() => document.querySelector('[data-provider="openai"]').textContent.includes('Not connected'));
  assert.doesNotMatch(await text('openai'), /Plus|Plan unavailable/);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto('http://localhost:3000/tests/fixtures/account-plans.html?theme=light', { waitUntil: 'networkidle0' });
  assert.equal(await page.$('.provider-row select'), null);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile remains within viewport');
  assert.deepEqual(errors, []);
  console.log('PASS Account plans: read-only, provider metadata, unknown/signed-out states, usage link, mobile layout');
} finally {
  await browser.close();
}
