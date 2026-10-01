import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as buildHost } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { initialState } from '../apps/desktop/host/store.ts';

// Production renderer/preload/controller/store in a separate hidden application and synthetic home.
const root = process.cwd(), output = path.join(root, 'build/qa/session-order-20260930/ui');
const appRoot = path.join(output, 'app'), data = path.join(output, `data-${Date.now()}`);
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
const now = Date.now(), old = new Date(now - 2 * 3600_000).toISOString(), current = new Date(now).toISOString();
const state = initialState(); state.plugins.translation.enabled = false;
state.projects = ['p', 'q'].map((id, i) => ({ id, name: i ? '参考资料' : '并行任务', path: '', paths: [], authority: 'local', group: '' }));
state.sidebarExpandedProjectIds = ['p'];
state.sessions = [
  ['a', '手动保留在首位'], ['b', '持续活动的会话'], ['c', '待重新开始的会话'], ['d', '拖动这条会话'], ['e', '另一项并行任务'], ['f', '超过五条仍可调整'],
  ['pin1', '置顶会话一', { pinned: true }], ['pin2', '置顶会话二', { pinned: true }],
  ['recent1', '最近会话一', { projectId: null }], ['recent2', '最近会话二', { projectId: null }],
].map(([id, title, patch]) => ({ id, title, projectId: 'p', projectPath: '', pinned: false, archived: false, group: '',
  binding: { runtime: 'demo', provider: 'demo', accountRef: 'demo', executionId: 'local-device', egress: 'demo' }, status: 'idle',
  messages: [], createdAt: old, sidebarActivityAt: id === 'c' ? old : current, ...patch }));
state.sidebarSessionOrder = state.sessions.map(s => s.id);
await put(path.join(data, 'state.json'), JSON.stringify(state));
await buildRenderer({ configFile: path.join(root, 'vite.config.ts'), build: { outDir: path.join(appRoot, 'renderer'), emptyOutDir: true }, logLevel: 'warn' });
await buildHost({ entryPoints: ['apps/desktop/host/main.ts'], outfile: path.join(appRoot, 'host/main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'],
  plugins: [{ name: 'synthetic-activity-entry', setup(build) { build.onLoad({ filter: /apps[\\/]desktop[\\/]host[\\/]main\.ts$/ }, async args => {
    const source = await readFile(args.path, 'utf8'), marker = 'shared.native.plugins.connectHost(core);';
    assert.equal(source.split(marker).length, 2);
    return { contents: source.replace(marker, marker + '\n(globalThis as any).__sessionOrderQa=controller.developmentServices()["workbench.state"];'), loader: 'ts' };
  }); } }] });
await buildHost({ entryPoints: ['apps/desktop/host/preload.ts'], outfile: path.join(appRoot, 'host/preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
for (const [from, to] of [['vps-workspace-control', 'workspace-control'], ['vps-account-broker', 'account-runtime'], ['vps-browser', 'remote-browser']]) await cp(path.join(root, 'services', from), path.join(appRoot, 'host', to), { recursive: true, filter: file => !file.includes('__pycache__') });
await put(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'session-order-qa', version: '0.1.0', main: 'host/main.cjs' }));
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: data, AGENT_WORKBENCH_TEST_HIDDEN: '1', AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE: path.join(data, 'absent-codex.exe'), AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE: path.join(data, 'absent-claude.exe') };
delete env.ELECTRON_RUN_AS_NODE;
const checks = [], errors = []; let app, page;
const record = text => { checks.push(text); console.log('PASS ' + text); };
const wait = async (condition, label) => { const end = Date.now() + 15000; while (Date.now() < end) { if (await condition()) return; await pause(40); } throw Error('Timed out: ' + label); };
const call = (method, payload = {}) => page.evaluate(({ method, payload }) => window.workbench.call(method, payload), { method, payload });
const rows = () => page.locator('[data-project-id="p"] .session-row').evaluateAll(elements => elements.map(el => el.dataset.sessionId));
const row = id => page.getByTestId('sidebar-session-' + id);
const select = id => row(id).locator('.session-select');
const order = async expected => wait(async () => JSON.stringify(await rows()) === JSON.stringify(expected), expected.join(','));
const launch = async () => { app = await electron.launch({ executablePath: electronPath, args: [appRoot], cwd: root, env, timeout: 45000 }); page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message)); await page.getByTestId('new-session').waitFor(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900)); };
const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
try {
  await launch(); await order(['a', 'b', 'c', 'd', 'e', 'f']);
  await app.evaluate(async () => { await globalThis.__sessionOrderQa.update(s => { s.sessions.find(s => s.id === 'b').status = 'running'; }); });
  await row('b').getByLabel('运行中', { exact: true }).waitFor(); await order(['a', 'b', 'c', 'd', 'e', 'f']);
  await app.evaluate(async () => { await globalThis.__sessionOrderQa.update(s => { s.sessions.find(s => s.id === 'c').status = 'running'; }); });
  await order(['c', 'a', 'b', 'd', 'e', 'f']);
  await app.evaluate(async () => { await globalThis.__sessionOrderQa.update(s => { const session = s.sessions.find(s => s.id === 'b'); session.status = 'blocked'; session.nativeApprovals = [{ id: 'synthetic', kind: 'command', turnId: 'turn', details: 'Fixture', decisions: ['accept'] }]; }); });
  await order(['c', 'a', 'b', 'd', 'e', 'f']);
  record('one-hour active rows remain fixed while only a dormant reactivated row moves');

  await select('d').dragTo(select('a'), { targetPosition: { x: 35, y: 3 } }); await order(['c', 'd', 'a', 'b', 'e', 'f']);
  await select('d').dragTo(select('e'), { targetPosition: { x: 35, y: 25 } }); await order(['c', 'a', 'b', 'e', 'd', 'f']);
  assert.equal((await call('state/get')).sessions.find(s => s.id === 'd').projectId, 'p');
  record('native Chromium session drag inserts before/after within a project without changing membership');

  await select('d').focus(); await page.keyboard.press('Alt+ArrowUp'); await order(['c', 'a', 'b', 'd', 'e', 'f']);
  assert.equal(await select('d').evaluate(el => el === document.activeElement), true);
  await page.getByTestId('sidebar-search-toggle').click(); await page.getByTestId('session-search').fill('会话');
  const allBefore = (await call('state/get')).sidebarSessionOrder;
  await select('d').focus(); await page.keyboard.press('Alt+ArrowUp');
  await wait(async () => (await call('state/get')).sidebarSessionOrder.indexOf('d') < (await call('state/get')).sidebarSessionOrder.indexOf('b'), 'filtered reorder');
  assert.deepEqual((await call('state/get')).sidebarSessionOrder.filter(id => id !== 'd'), allBefore.filter(id => id !== 'd'));
  await page.getByTestId('session-search').fill(''); await page.keyboard.press('Escape');
  record('keyboard and filtered reordering preserve focus and all hidden rows');

  await select('pin2').dragTo(select('pin1'), { targetPosition: { x: 35, y: 3 } });
  await wait(async () => await page.getByTestId('pinned-sessions').locator('.session-row').first().getAttribute('data-session-id') === 'pin2', 'pinned order');
  await select('recent2').dragTo(select('recent1'), { targetPosition: { x: 35, y: 3 } });
  await wait(async () => (await call('state/get')).sidebarSessionOrder.indexOf('recent2') < (await call('state/get')).sidebarSessionOrder.indexOf('recent1'), 'recent order');
  record('pinned and recent sections support independent native dragging');

  const sourceBox = await select('e').boundingBox(), targetBox = await select('a').boundingBox();
  await page.mouse.move(sourceBox.x + 45, sourceBox.y + sourceBox.height / 2); await page.mouse.down();
  await page.mouse.move(sourceBox.x + 45, sourceBox.y + sourceBox.height / 2 + 8, { steps: 3 });
  await page.mouse.move(targetBox.x + 45, targetBox.y + 3, { steps: 8 });
  const anchor = await select('a').boundingBox();
  await page.mouse.move(anchor.x + 45, anchor.y + 3); await page.mouse.move(anchor.x + 45, anchor.y + 3);
  await page.waitForFunction(() => document.querySelector('[data-session-id="a"]').classList.contains('session-drop-before'));
  assert.equal(await page.getByTestId('attachment-drop-overlay').isVisible(), false);
  const line = await row('a').evaluate(el => { const s = getComputedStyle(el, '::before'); return { height: s.height, background: s.backgroundColor, position: s.position }; });
  assert.equal(line.height, '2px'); assert.equal(line.position, 'absolute');
  await shot('session-insertion-light');
  const cancelOrder = (await call('state/get')).sidebarSessionOrder;
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual((await call('state/get')).sidebarSessionOrder, cancelOrder);
  await page.waitForFunction(() => !document.querySelector('.session-drop-before,.session-drop-after,.is-dragging'));
  record('insertion line is visible, internal drag does not open attachments, and Escape preserves order');

  const original = (await call('state/get')).sessions.find(s => s.id === 'e');
  await select('e').dragTo(page.locator('[data-project-id="q"] .project-title'));
  await wait(async () => (await call('state/get')).sessions.find(s => s.id === 'e').projectId === 'q', 'cross-project move');
  assert.deepEqual((await call('state/get')).sessions.find(s => s.id === 'e').binding, original.binding);
  await page.locator('[data-project-id="q"] .project-title').dragTo(page.locator('[data-project-id="p"] .project-title'), { targetPosition: { x: 45, y: 3 } });
  await wait(async () => (await call('state/get')).sidebarProjectOrder.indexOf('q') < (await call('state/get')).sidebarProjectOrder.indexOf('p'), 'project order');
  record('existing cross-project chat moves and project drag still preserve execution identity');

  await Promise.all([
    call('session/reorder', { id: 'b', targetId: 'a', edge: 'before', scope: 'project:p' }),
    call('session/reorder', { id: 'f', targetId: 'c', edge: 'before', scope: 'project:p' }),
  ]);
  const concurrent = (await call('state/get')).sidebarSessionOrder;
  assert.ok(concurrent.indexOf('b') < concurrent.indexOf('a') && concurrent.indexOf('f') < concurrent.indexOf('c'));
  await app.evaluate(async () => { await globalThis.__sessionOrderQa.update(s => { for (const session of s.sessions.filter(s => ['a', 'b', 'c', 'd', 'f'].includes(s.id))) { session.status = 'idle'; session.nativeApprovals = []; session.unread = true; session.messages.push({ id: 'message-' + session.id, role: 'assistant', original: 'Synthetic update', demo: true, timestamp: new Date().toISOString() }); } }); });
  assert.deepEqual((await call('state/get')).sidebarSessionOrder, concurrent);
  record('concurrent IPC anchor moves survive subsequent parallel native state updates');

  await call('theme/set', { theme: 'dark' }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640));
  await page.waitForFunction(() => innerWidth === 860);
  await select('d').scrollIntoViewIfNeeded(); await select('d').focus(); await page.keyboard.press('Alt+ArrowDown');
  await page.mouse.move(700, 180); await shot('session-order-dark-narrow');
  assert.equal(await page.getByTestId('sidebar').evaluate(el => el.scrollWidth > el.clientWidth), false);
  await page.getByTestId('sidebar-toggle').click(); await page.waitForFunction(() => document.querySelector('.sidebar').classList.contains('is-compact'));
  await select('d').focus(); await page.keyboard.press('Alt+ArrowUp'); await shot('session-order-compact');
  record('dark narrow and compact sidebar keep sorting accessible without horizontal overflow');

  const saved = (await call('state/get')).sidebarSessionOrder;
  await app.close(); app = null; await launch();
  assert.deepEqual((await call('state/get')).sidebarSessionOrder, saved);
  assert.equal((await call('state/get')).sessions.find(s => s.id === 'e').projectId, 'q');
  assert.deepEqual(errors, []); record('restart preserves manual order and membership with zero renderer errors');
  await put(path.join(output, 'report.json'), JSON.stringify({ checks, errors, hidden: true, syntheticOnly: true }, null, 2));
} catch (error) {
  if (page) await shot('failure').catch(() => {});
  await put(path.join(output, 'report.json'), JSON.stringify({ checks, errors, failure: String(error) }, null, 2)); throw error;
} finally { if (app) await app.close(); }
