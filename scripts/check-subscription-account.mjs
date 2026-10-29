import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const base = process.env.JARVIS_CHECK_URL ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use the isolated localhost fixture');
const browser = await puppeteer.launch({
  executablePath: process.env.JARVIS_BROWSER ?? '/Users/dereksu/.cache/puppeteer/chrome/mac_arm-146.0.7680.66/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const state = () => page.evaluate(() => window.subscriptionFixture.state());
const phase = (expected) => page.waitForFunction((value) => window.subscriptionFixture?.state().phase === value, {}, expected);

try {
  await page.goto(`${base}/tests/fixtures/subscription-account.html`, { waitUntil: 'networkidle0' });
  await phase('signed-out');
  await page.evaluate(() => window.subscriptionFixture.signIn());
  assert.deepEqual(await state(), { phase: 'signed-out', signingIn: true }, 'Launching sign-in never proves connection');
  await page.evaluate(() => window.subscriptionFixture.setStatus({ connected: true, name: 'Alex Example', email: 'alex@example.com', plan: 'Pro' }));
  await phase('connected');
  assert.equal((await state()).name, 'Alex Example');
  assert.equal(await page.$eval('button', (button) => button.textContent), 'Sign out');

  await page.evaluate(() => {
    window.subscriptionFixture.deferSignOut(true);
    void window.subscriptionFixture.signOut();
  });
  const duringLogout = await page.evaluate(() => window.subscriptionFixture.calls.status);
  await page.evaluate(() => window.subscriptionFixture.refresh());
  assert.equal(await page.evaluate(() => window.subscriptionFixture.calls.status), duringLogout, 'Focus refresh cannot race an active logout');
  await page.evaluate(() => window.subscriptionFixture.resolveSignOut({ ok: true }));
  await phase('signed-out');
  await page.evaluate(() => {
    window.subscriptionFixture.deferSignOut(false);
    window.subscriptionFixture.deferSignIn(true);
    void window.subscriptionFixture.signIn();
  });
  await page.evaluate(() => window.subscriptionFixture.refresh());
  await phase('connected');
  await page.evaluate(() => window.subscriptionFixture.resolveSignIn({ ok: false, error: 'Stale launch failure' }));
  assert.equal((await state()).phase, 'connected', 'Verified status wins over a late sign-in launch error');
  await page.evaluate(() => window.subscriptionFixture.deferSignIn(false));

  await page.evaluate(() => window.subscriptionFixture.setSignOutResult({ ok: false, error: 'Fixture denied sign-out' }));
  assert.equal(await page.evaluate(() => window.subscriptionFixture.signOut()), false);
  assert.equal((await state()).phase, 'connected');
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.$eval('[role="alert"]', (node) => node.textContent), /denied/);
  await page.evaluate(() => window.subscriptionFixture.rejectSignOut(true));
  assert.equal(await page.evaluate(() => window.subscriptionFixture.signOut()), false);
  assert.equal((await state()).phase, 'connected');
  await page.evaluate(() => {
    window.subscriptionFixture.rejectSignOut(false);
    window.subscriptionFixture.setSignOutResult({ ok: true });
    window.subscriptionFixture.setStatus({ connected: false });
  });
  assert.equal(await page.evaluate(() => window.subscriptionFixture.signOut()), true);
  await phase('signed-out');
  console.log('PASS Only verified status connects; failed logout preserves connection and displays error');

  await page.evaluate(() => {
    window.subscriptionFixture.deferSignIn(true);
    void window.subscriptionFixture.signIn();
  });
  await page.waitForFunction(() => window.subscriptionFixture.state().signingIn);
  await page.evaluate(() => window.subscriptionFixture.cancel());
  await page.evaluate(() => window.subscriptionFixture.resolveSignIn({ ok: true }));
  assert.deepEqual(await state(), { phase: 'signed-out', signingIn: false }, 'Late successful sign-in result cannot undo cancellation');

  await page.evaluate(() => {
    window.subscriptionFixture.deferStatus(true);
    void window.subscriptionFixture.refresh();
  });
  await page.evaluate(() => window.subscriptionFixture.cancel());
  await page.evaluate(() => window.subscriptionFixture.resolveStatus({ installed: true, connected: true, name: 'Stale identity', email: null, plan: null }));
  assert.equal((await state()).phase, 'signed-out', 'Stale status cannot restore a cancelled operation');
  await page.evaluate(() => {
    window.subscriptionFixture.deferStatus(false);
    void window.subscriptionFixture.signIn();
  });
  await page.waitForFunction(() => window.subscriptionFixture.state().error?.includes('timed out'), { timeout: 3000 });
  assert.equal((await state()).signingIn, false);
  console.log('PASS Cancel ignores stale sign-in/status; sign-in deadline stops waiting');

  await page.evaluate(() => {
    window.subscriptionFixture.setStatus({ installed: false });
    return window.subscriptionFixture.refresh();
  });
  await phase('not-installed');
  assert.equal(await page.$eval('button', (button) => button.textContent), 'Install Gemini');
  await page.click('button');
  assert.equal(await page.evaluate(() => window.subscriptionFixture.calls.install), 1);

  await page.evaluate(() => {
    window.subscriptionFixture.setStatus({ installed: true });
    void window.subscriptionFixture.signIn();
  });
  await page.waitForFunction(() => window.subscriptionFixture.state().signingIn);
  const before = await page.evaluate(() => ({ ...window.subscriptionFixture.calls }));
  await page.evaluate(() => window.subscriptionFixture.unmount());
  assert.equal(await page.evaluate(() => window.subscriptionFixture.calls.cancel), before.cancel + 1);
  await page.evaluate(() => window.subscriptionFixture.resolveSignIn({ ok: true }));
  assert.equal(await page.evaluate(() => window.subscriptionFixture.calls.status), before.status, 'Unmounted hook cannot resume status polling');
  console.log('PASS Install handoff and unmount cancellation; no real account calls');
  assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser.close();
}
