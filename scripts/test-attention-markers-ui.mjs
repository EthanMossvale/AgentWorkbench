import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as buildHost } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { initialState } from '../apps/desktop/host/store.ts';

// Background-session notifications and sidebar result markers in a hidden, isolated app.
// The hidden window is never focused, so every session counts as background.
const coreEvaluate = (fn, arg) => app.evaluate((_electron, { source, arg }) => globalThis.__workbenchCoreEvaluate(source, arg), { source: fn.toString(), arg });
const root = process.cwd(), output = path.join(root, 'build/qa/attention-markers-20261004');
const appRoot = path.join(output, 'app'), data = path.join(output, `data-${Date.now()}`);
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
const now = new Date().toISOString();
const id = n => `00000000-0000-4000-8000-00000000000${n}`;
const state = initialState(); state.plugins.translation.enabled = false;
// A large history makes every durable state write slow, like a long real profile.
const bulk = Array.from({ length: 6000 }, (_, i) => ({ id: 'bulk-' + i, role: 'assistant', original: 'x'.repeat(2000), demo: true, timestamp: now }));
state.sessions = [['1', '当前查看的会话', bulk], ['2', '后台完成的会话', []], ['3', '后台出错的会话', []], ['4', '静音完成的会话', []]].map(([n, title, messages]) => ({
  id: id(n), title, projectId: null, projectPath: '', pinned: false, archived: false, group: '',
  binding: { runtime: 'demo', provider: 'demo', accountRef: 'demo', executionId: 'local-device', egress: 'demo' }, status: 'idle', messages, createdAt: now, sidebarActivityAt: now,
}));
await put(path.join(data, 'state.json'), JSON.stringify(state));
await buildRenderer({ configFile: path.join(root, 'vite.config.ts'), build: { outDir: path.join(appRoot, 'renderer'), emptyOutDir: true }, logLevel: 'warn' });
await buildHost({ entryPoints: ['apps/desktop/host/main.ts'], outfile: path.join(appRoot, 'host/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'qa-state-handle', setup(build) { build.onLoad({ filter: /apps[\\/]desktop[\\/]host[\\/]core-process\.ts$/ }, async args => {
    const source = await readFile(args.path, 'utf8'), marker = 'registry.connectHost(core);';
    assert.equal(source.split(marker).length, 2);
    return { contents: source.replace(marker, marker + '\n(globalThis as any).__attentionQa=controller.developmentServices()["workbench.state"];'), loader: 'ts' };
  }); } }] });
await buildHost({ entryPoints: ['apps/desktop/host/preload.ts'], outfile: path.join(appRoot, 'host/preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
for (const [from, to] of [['vps-workspace-control', 'workspace-control'], ['vps-account-broker', 'account-runtime'], ['vps-browser', 'remote-browser']]) await cp(path.join(root, 'services', from), path.join(appRoot, 'host', to), { recursive: true, filter: file => !file.includes('__pycache__') });
await put(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'attention-markers-qa', version: '0.1.0', main: 'host/main.cjs' }));
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: data, AGENT_WORKBENCH_TEST_HIDDEN: '1', AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE: path.join(data, 'absent-codex.exe'), AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE: path.join(data, 'absent-claude.exe') };
delete env.ELECTRON_RUN_AS_NODE;
const checks = [], errors = []; let app, page;
const record = text => { checks.push(text); console.log('PASS ' + text); };
const wait = async (condition, label, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await pause(10); } throw Error('Timed out: ' + label); };
const row = n => page.getByTestId('sidebar-session-' + id(n));
const shown = () => app.evaluate(({ app }) => app.__workbenchNotificationsTest.shown());
// Returns the session's markers as stored right after the mutation that changed the status.
const setStatus = (n, patch) => coreEvaluate(async (_, { sid, patch }) => { await globalThis.__attentionQa.updateSession(sid, s => { Object.assign(s, patch); }); const s = globalThis.__attentionQa.get().sessions.find(s => s.id === sid); return { unread: !!s.unread, errorMark: s.errorMark ?? null }; }, { sid: id(n), patch });
// Durable writes of the large state, queued like turn-end saves (translation, timings, receipts).
const slowWrites = count => coreEvaluate(async (_, count) => { for (let i = 0; i < count; i++) void globalThis.__attentionQa.update(s => { s.sessions[0].title = '当前查看的会话 ' + i; }); }, count);
const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
try {
  app = await electron.launch({ executablePath: electronPath, args: [appRoot], cwd: root, env, timeout: 45000 });
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await row(1).waitFor({ timeout: 30000 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
  await row(1).locator('.session-select').click();

  // 1. Completion: the dot follows the notification even while slow durable writes are queued.
  await setStatus(2, { status: 'running' }); await pause(200);
  const before = (await shown()).length;
  await slowWrites(15); const same = await setStatus(2, { status: 'idle', nativeTurnStatus: 'completed' });
  assert.equal(same.unread, true, 'unread must be set in the same revision that ends the turn');
  const started = Date.now(); let notifiedAt = 0, dotAt = 0;
  try { await wait(async () => { if (!notifiedAt && (await shown()).length > before) notifiedAt = Date.now(); if (!dotAt && await row(2).locator('.unread-dot').count()) dotAt = Date.now(); return notifiedAt && dotAt; }, 'notification and unread dot'); }
  catch (error) { console.log('diagnostics', JSON.stringify({ notifiedAt, dotAt, shown: await shown(), session: await coreEvaluate(async (_, sid) => { const s = globalThis.__attentionQa.get().sessions.find(s => s.id === sid); return { status: s.status, unread: s.unread }; }, id(2)) })); throw error; }
  const toast = (await shown()).at(-1);
  assert.equal(toast.title, '后台完成的会话'); assert.equal(toast.body, '任务已完成'); assert.equal(toast.sound, true); assert.equal(toast.sessionId, id(2));
  console.log(`notification after ${notifiedAt - started} ms, unread dot after ${dotAt - started} ms`);
  assert.ok(dotAt - notifiedAt < 500, `unread dot lagged the notification by ${dotAt - notifiedAt} ms`);
  assert.equal(await row(2).locator('.unread-dot').getAttribute('title'), '任务已完成，尚未查看');
  record(`background completion: unread set in the same state revision as the turn end; Chinese notification with sound, unread dot ${dotAt - notifiedAt} ms after it despite 15 queued writes of a large state`);
  await shot('01-unread-dot');

  // 2. Opening the session clears the dot immediately and the cleared state is saved.
  const clickAt = Date.now(); await row(2).locator('.session-select').click();
  await wait(async () => !(await row(2).locator('.unread-dot').count()), 'dot cleared on open', 2000);
  const cleared = Date.now() - clickAt;
  await wait(async () => (await coreEvaluate(async (_, sid) => globalThis.__attentionQa.get().sessions.find(s => s.id === sid).unread, id(2))) === false, 'unread saved false');
  record(`opening the session hides the dot after ${cleared} ms and stores unread=false`);

  // 3. Error ending: a persistent error mark that survives opening and leaving the session.
  await setStatus(3, { status: 'running' }); await pause(200);
  const failed = await setStatus(3, { status: 'idle', nativeTurnStatus: 'failed', nativeError: '上游连接中断' });
  assert.equal(failed.errorMark?.detail, '上游连接中断');
  const mark = row(3).locator('[data-workbench-error-mark]');
  await mark.waitFor({ timeout: 3000 });
  assert.match(await mark.getAttribute('title'), /运行出错：上游连接中断/);
  assert.equal((await shown()).at(-1).body, '任务出错停止');
  await row(3).locator('.session-select').click(); await row(1).locator('.session-select').click(); await pause(300);
  assert.equal(await mark.count(), 1);
  await shot('02-error-mark');
  await row(3).click({ button: 'right' }); await page.getByTestId('session-clear-error').click();
  await wait(async () => !(await mark.count()), 'error mark cleared', 3000);
  record('error ending shows a mark with the error text, it survives opening and leaving, and only the context menu clears it');

  // 4. Sound switch: the notification still appears, without sound.
  await page.getByTestId('sidebar-footer-menu').click(); await page.getByTestId('settings-open').click(); await page.getByTestId('settings-general').click();
  const toggle = page.getByRole('checkbox', { name: '通知提示音' });
  assert.equal(await toggle.isChecked(), true); await toggle.uncheck({ force: true });
  await wait(async () => (await coreEvaluate(async () => null)) === null && !(await toggle.isChecked()), 'toggle off');
  await shot('03-sound-switch');
  const count = (await shown()).length;
  await setStatus(4, { status: 'running' }); await pause(200); await setStatus(4, { status: 'idle' });
  await wait(async () => (await shown()).length > count, 'silent notification');
  assert.equal((await shown()).at(-1).sound, false);
  record('with 通知提示音 off the notification is still shown, silent');
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks.length} attention marker checks; screenshots in ${output}`);
} finally { await app?.close().catch(() => {}); }
