import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { spawn } from 'node:child_process';

// Real Electron lifecycle checks, using only independently launched test-data
// instances. No screenshots, remote access, native login, or user app control.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build/qa');
const runDirectory = path.join(output, `tray-synthetic-${Date.now()}`);
await mkdir(runDirectory, { recursive: true });
const checks = [];
const errors = [];
const instances = [];
const snapshots = [];
let current;
let failure;

const check = async (name, run) => {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; }
};
const waitUntil = async (predicate, description, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(25); }
  throw new Error(`Timed out waiting for ${description}`);
};
const bounded = (promise, description, timeout = 15000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeout); })]).finally(() => clearTimeout(timer));
};
const evaluate = (callback, argument, target = current) => bounded(target.application.evaluate(callback, argument), 'Electron main evaluation');
const snapshot = () => evaluate(({ app }) => app.__workbenchTrayTest.snapshot());
const saveSnapshot = async label => {
  const value = await snapshot(); snapshots.push({ label, ...value }); return value;
};
const launch = async (name, failTray = false) => {
  const dataDirectory = path.join(runDirectory, name);
  await mkdir(dataDirectory, { recursive: true });
  const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: dataDirectory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AGENT_WORKBENCH_TEST_TRAY_FAIL;
  if (failTray) env.AGENT_WORKBENCH_TEST_TRAY_FAIL = '1';
  const application = await electron.launch({ executablePath: electronPath, args: [root], cwd: root, env, timeout: 45000 });
  const processHandle = application.process();
  const record = { name, pid: processHandle.pid, dataDirectory, forcedCleanup: false };
  instances.push(record);
  current = { application, processHandle, record, exitRecord: path.join(dataDirectory, 'lifecycle-exit.json') };
  const page = await bounded(application.firstWindow(), 'the owned renderer window');
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.workbench);
  await evaluate(({ app }, file) => {
    if (!app.__workbenchTrayTest || typeof app.__workbenchTrayTest.snapshot !== 'function') throw new Error('Tray lifecycle test surface is unavailable. Build the current application first.');
    const fs = process.getBuiltinModule('node:fs');
    const events = [];
    const record = event => {
      events.push({ event, ...app.__workbenchTrayTest.snapshot() });
      fs.writeFileSync(file, JSON.stringify(events, null, 2), 'utf8');
    };
    app.on('before-quit', () => record('before-quit'));
    app.on('will-quit', () => record('will-quit'));
  }, current.exitRecord);
  current.page = page;
  return current;
};
const assertAlive = () => {
  assert.ok(current && Number.isSafeInteger(current.record.pid));
  assert.equal(current.processHandle.exitCode, null);
  assert.equal(current.processHandle.signalCode, null);
};
const exitAndRead = async kind => {
  const target = current;
  const closed = target.application.waitForEvent('close', { timeout: 15000 });
  // Keep an early evaluate failure from leaving this event promise unhandled.
  void closed.catch(() => {});
  const exited = target.processHandle.exitCode !== null || target.processHandle.signalCode !== null
    ? Promise.resolve()
    : new Promise(resolve => target.processHandle.once('exit', resolve));
  const trigger = evaluate(({ app, BrowserWindow }, method) => {
    setImmediate(() => {
      if (method === 'window') BrowserWindow.fromId(app.__workbenchTrayTest.snapshot().windowId).close();
      else { app.__workbenchTrayTest.quit(); app.__workbenchTrayTest.quit(); }
    });
  }, kind, target);
  await bounded(Promise.all([trigger, closed, exited]), 'explicit exit of the owned Electron test process');
  const events = JSON.parse(await readFile(target.exitRecord, 'utf8'));
  const final = events.at(-1);
  snapshots.push({ label: `${target.record.name}-exit`, ...final });
  assert.equal(final.event, 'will-quit');
  assert.equal(final.quitting, true);
  assert.equal(final.cleanupStarted, true);
  assert.equal(final.cleanupFinished, true);
  assert.equal(final.cleanupCalls, 1);
  assert.equal(target.processHandle.exitCode, 0);
  assert.equal(target.processHandle.signalCode, null);
  current = undefined;
  return events;
};
const closeOwnedInstance = async () => {
  if (!current) return;
  const target = current;
  if (target.processHandle.exitCode !== null || target.processHandle.signalCode !== null) { current = undefined; return; }
  try { await bounded(target.application.close(), 'normal test-instance cleanup'); }
  catch (error) {
    errors.push(`Test cleanup: ${error.message}`);
    // This handle and PID came only from this script's electron.launch().
    // Never enumerate, search for, or terminate the user's running workbench.
    if (Number.isSafeInteger(target.record.pid) && target.record.pid > 0 && target.processHandle.pid === target.record.pid && target.processHandle.exitCode === null && target.processHandle.signalCode === null) {
      target.record.forcedCleanup = true;
      const exited = new Promise(resolve => target.processHandle.once('exit', resolve));
      try {
        if (process.platform === 'win32') {
          await bounded(new Promise((resolve, reject) => {
            const killer = spawn('taskkill.exe', ['/PID', String(target.record.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
            killer.once('error', reject);
            killer.once('exit', code => code === 0 || target.processHandle.exitCode !== null || target.processHandle.signalCode !== null ? resolve() : reject(new Error(`Owned-process tree cleanup returned ${code}`)));
          }), 'owned Windows test process tree cleanup');
        } else target.processHandle.kill('SIGKILL');
        await bounded(exited, 'the owned test process to finish forced cleanup');
      } catch (cleanupError) { errors.push(`Forced test cleanup: ${cleanupError.message}`); }
    }
  } finally { current = undefined; }
};

try {
  let originalWindowId;
  const draft = '托盘恢复测试草稿：保持原窗口，不发送。';
  await check('the real Electron test instance creates an available tray and disables background throttling', async () => {
    await launch('normal');
    const value = await saveSnapshot('normal-ready');
    originalWindowId = value.windowId;
    assert.equal(value.trayAvailable, true);
    assert.equal(value.visible, true);
    assert.equal(value.quitting, false);
    assert.equal(value.cleanupStarted, false);
    assert.equal(value.cleanupFinished, false);
    assert.equal(value.cleanupCalls, 0);
    assert.equal(value.backgroundThrottling, false);
    assertAlive();
    const backgroundThrottling = await evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).webContents.getBackgroundThrottling(), originalWindowId);
    assert.equal(backgroundThrottling, false);
    assert.equal(await current.page.evaluate(() => typeof window.__workbenchTrayTest), 'undefined');
    await current.page.getByTestId('new-session').click();
    await current.page.getByTestId('composer-input').fill(draft);
  });
  await check('window close hides the same window without quitting, disposing, or losing the draft', async () => {
    await evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), originalWindowId);
    await waitUntil(async () => !(await snapshot()).visible, 'window close to hide into the tray');
    const value = await saveSnapshot('after-window-close');
    assert.equal(value.windowId, originalWindowId);
    assert.equal(value.trayAvailable, true);
    assert.equal(value.quitting, false);
    assert.equal(value.cleanupCalls, 0);
    assert.equal(value.cleanupStarted, false);
    assertAlive();
    assert.equal(current.page.isClosed(), false);
    assert.equal(await evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    assert.equal(await current.page.getByTestId('composer-input').inputValue(), draft);
  });
  await check('the real tray show action restores the original renderer and unsent draft', async () => {
    await evaluate(({ app }) => app.__workbenchTrayTest.show());
    await waitUntil(async () => (await snapshot()).visible, 'tray show to restore the window');
    const value = await saveSnapshot('after-tray-show');
    assert.equal(value.windowId, originalWindowId);
    assert.equal(value.cleanupCalls, 0);
    assert.equal(current.page, await bounded(current.application.firstWindow(), 'the same restored renderer window'));
    assert.equal(await current.page.getByTestId('composer-input').inputValue(), draft);
    assertAlive();
  });
  await check('an injected ordinary second-instance event wakes a hidden window without replacing its draft', async () => {
    await evaluate(({ app, BrowserWindow }, id) => {
      BrowserWindow.fromId(id).close();
      app.emit('second-instance', {}, [process.execPath, app.getAppPath()], app.getAppPath(), {});
    }, originalWindowId);
    await waitUntil(async () => (await snapshot()).visible, 'second-instance activation to show the hidden window');
    const value = await saveSnapshot('after-second-instance');
    assert.equal(value.windowId, originalWindowId);
    assert.equal(value.cleanupCalls, 0);
    assert.equal(await current.page.getByTestId('composer-input').inputValue(), draft);
    assertAlive();
  });
  await check('an injected valid deep-link event restores the same window and selects the existing task without sending', async () => {
    const session = await current.page.evaluate(() => window.workbench.call('session/create', { projectId: null, projectPath: '', runtime: 'demo' }));
    await evaluate(({ app, BrowserWindow }, value) => {
      BrowserWindow.fromId(value.windowId).close();
      app.emit('second-instance', {}, [process.execPath, app.getAppPath(), `agent-workbench://threads/${value.sessionId}`], app.getAppPath(), {});
    }, { windowId: originalWindowId, sessionId: session.id });
    await waitUntil(async () => (await snapshot()).visible, 'deep link to restore the window');
    await current.page.locator(`[data-session-id="${session.id}"] .session-select[aria-current="page"]`).waitFor();
    const state = await current.page.evaluate(() => window.workbench.call('state/get'));
    assert.equal(state.sessions.find(item => item.id === session.id).messages.length, 0);
    const value = await saveSnapshot('after-deep-link');
    assert.equal(value.windowId, originalWindowId);
    assert.equal(value.cleanupCalls, 0);
    assertAlive();
  });
  await check('explicit tray exit performs exactly one completed cleanup and terminates the test process', async () => {
    await evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), originalWindowId);
    await waitUntil(async () => !(await snapshot()).visible, 'hidden window before explicit tray quit');
    const events = await exitAndRead('tray');
    assert.ok(events.some(event => event.event === 'before-quit' && event.quitting && event.cleanupStarted));
  });
  await check('initial tray failure leaves the window visible and closing it exits instead of orphaning a hidden app', async () => {
    await launch('tray-failure', true);
    const value = await saveSnapshot('tray-failure-ready');
    assert.equal(value.trayAvailable, false);
    assert.equal(value.visible, true);
    assert.equal(value.quitting, false);
    assert.equal(value.cleanupCalls, 0);
    assertAlive();
    await exitAndRead('window');
  });
  await check('all test instances exit cleanly with no renderer error or forced process cleanup', async () => {
    assert.equal(current, undefined);
    assert.equal(instances.length, 2);
    assert.equal(new Set(instances.map(instance => instance.dataDirectory)).size, 2);
    assert.equal(instances.some(instance => instance.forcedCleanup), false);
    assert.deepEqual(errors, []);
  });
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  try { await closeOwnedInstance(); }
  finally { await writeFile(path.join(output, 'tray-ui-report.json'), JSON.stringify({ observedAt: new Date().toISOString(), screenshots: false, isolatedTestDataOnly: true, secondInstanceEventInjection: true, checks, errors, instances, snapshots, ...(failure ? { failure } : {}) }, null, 2)); }
}
console.log(`Tray UI: ${checks.length}/${checks.length} passed; screenshots=false; isolatedTestDataOnly=true`);
