// Native desktop acceptance: no provider accounts, credentials, or default user profile.
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { nativeElectronLaunch } = require('./native-electron-launch.cjs');

async function nativePhase(phase, directory) {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', join(directory, 'profile'));
  let storage;
  let window;
  try {
    await app.whenReady();
    window = new BrowserWindow({ show: false, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    await window.loadURL('data:text/html,<title>Storage acceptance</title>');
    assert.equal(await window.webContents.executeJavaScript('typeof process'), 'undefined');
    const { openDesktopStorage } = require(join(directory, 'backend/storage.cjs'));
    storage = openDesktopStorage(join(directory, 'storage.db'));
    if (phase === 'delete') {
      const turn = (chatId) => {
        const run = storage.beginShippingTurn({ requestId: chatId, chatId,
          text: 'Remember this preference', model: { providerId: 'claude', modelId: 'fixture' } });
        storage.runs.appendDelta(run.id, 'Preference acknowledged');
        storage.runs.finish(run.id, 'complete');
        return run;
      };
      turn('deleted');
      turn('kept');
      storage.checkpoints.save(['deleted', 'kept'].map(id => ({
        id, title: id, updatedAt: 1, messages: [{ id: `${id}-user`, role: 'user', content: id }],
      })));
      storage.chats.delete('deleted');
    } else {
      assert.equal(phase, 'reopen');
    }
    assert.equal(storage.chats.get('deleted'), null);
    assert.equal(storage.chats.get('kept').runs.length, 1);
    assert.deepEqual(storage.checkpoints.load().map(chat => chat.id), ['kept']);
    assert.equal(storage.memory.jobs().length, 1);
    assert.equal(storage.memory.jobs()[0].chatId, 'kept');
    await storage.close();
    storage = null;
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (storage) await storage.close();
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(1);
  }
}

async function main() {
  const directory = mkdtempSync(join(resolve(__dirname, '..'), '.native-storage-'));
  try {
    const { buildBackend } = await import('./build-backend.mjs');
    await buildBackend(join(directory, 'backend'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    for (const phase of ['delete', 'reopen']) {
      const launch = nativeElectronLaunch(process.platform, require('electron'), [__filename, phase, directory]);
      const result = spawnSync(launch.command, launch.args, {
        env, encoding: 'utf8', timeout: 20_000,
      });
      assert.equal(result.status, 0, `${phase}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    }
    console.log('PASS native storage deletion and relaunch');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.versions.electron) nativePhase(process.argv[2], process.argv[3]);
else main().catch(error => { console.error(error); process.exitCode = 1; });
