import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(root, 'build/qa/session-workspace-20260926'); await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'awb-workspace-ui-'));
const primary = path.join(dataDir, 'project-main'), secondary = path.join(dataDir, 'session-folder');
await Promise.all([primary, secondary].map(folder => mkdir(folder)));
const launch = () => electron.launch({ executablePath: electronPath, args: [root], cwd: root, env: { ...process.env, AGENT_WORKBENCH_TEST_DATA: dataDir, ELECTRON_RUN_AS_NODE: undefined } });
const checks = [], errors = [];
const record = name => { checks.push(name); console.log('PASS ' + name); };
let app = await launch();
try {
  let page = await app.firstWindow(); await page.getByTestId('composer-input').waitFor();
  const call = (method, payload = {}) => page.evaluate(({ method, payload }) => window.workbench.call(method, payload), { method, payload });
  const project = await call('project/create', { name: '双目录项目', paths: [primary, secondary] });
  const bound = await call('session/create', { runtime: 'demo', projectId: project.id, projectPath: secondary });
  await call('session/update', { id: bound.id, title: '使用第二目录的会话' });
  const recent = await call('session/create', { runtime: 'demo' });
  await call('session/update', { id: recent.id, title: '未运行的独立工作区' });
  const used = await call('session/create', { runtime: 'demo' });
  await call('session/update', { id: used.id, title: '目录已丢失的旧会话' });
  // Only this test's own profile is patched to reproduce pre-fix history.
  await app.close();
  const file = path.join(dataDir, 'state.json'), state = JSON.parse(await readFile(file, 'utf8'));
  for (const [id, started] of [[recent.id, false], [used.id, true]]) {
    const item = state.sessions.find(s => s.id === id);
    item.projectPath = path.join(dataDir, 'native-codex/workspaces', id);
    item.binding.runtime = 'codex'; item.binding.provider = 'openai';
    if (started) item.binding.nativeSessionId = 'synthetic-previously-started';
  }
  await writeFile(file, JSON.stringify(state));
  app = await launch(); page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.getByTestId('composer-input').waitFor();
  await app.evaluate(({ shell }) => { globalThis.__workspaceOpened = []; shell.openPath = async target => { globalThis.__workspaceOpened.push(target); return ''; }; });
  const opened = async count => app.evaluate(async count => {
    for (let i = 0; i < 100 && globalThis.__workspaceOpened.length < count; i++) await new Promise(resolve => setTimeout(resolve, 20));
    return globalThis.__workspaceOpened;
  }, count);
  const menu = async id => { await page.getByTestId(`sidebar-session-${id}`).click({ button: 'right' }); await page.getByTestId('open-session-folder').waitFor(); };
  const cwd = path.join(dataDir, 'native-codex/workspaces', recent.id);
  await assert.rejects(stat(cwd), { code: 'ENOENT' });
  await menu(recent.id);
  assert.equal(await page.getByTestId('open-session-folder').innerText(), '打开会话工作区');
  await page.screenshot({ path: path.join(output, 'session-menu.png') });
  await page.getByTestId('open-session-folder').click();
  assert.deepEqual(await opened(1), [cwd]); assert.equal((await stat(cwd)).isDirectory(), true);
  assert.equal(await page.getByRole('alert').count(), 0);
  record('recent-session menu initializes its old unstarted managed workspace and calls the real host route');

  await menu(bound.id); await page.getByTestId('open-session-folder').click();
  await page.locator(`[data-project-id="${project.id}"] .project-heading`).click({ button: 'right' });
  await page.getByTestId('project-open-folder').click();
  assert.deepEqual(await opened(3), [cwd, secondary, primary]);
  record('session opens its second folder while the project menu opens the main folder');

  await page.getByTestId('sidebar-toggle').click();
  await menu(bound.id); await page.getByTestId('session-copy-submenu').hover(); await page.getByTestId('copy-session-directory').click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), secondary);
  await menu(recent.id); await page.getByTestId('open-session-folder').click();
  assert.equal((await opened(4)).at(-1), cwd);
  record('compact navigation retains workspace open and exact bound-path copy');

  await menu(used.id); await page.getByTestId('open-session-folder').click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /会话工作区已不存在/);
  assert.doesNotMatch(await page.getByRole('alert').innerText(), /ENOENT/);
  await assert.rejects(stat(path.join(dataDir, 'native-codex/workspaces', used.id)), { code: 'ENOENT' });
  assert.equal((await opened(4)).length, 4);
  record('missing previously-used workspace reports a readable error and does not recreate an empty directory');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors, opened: await opened(4), dataDir,
    scope: 'Isolated Electron profile with synthetic history, real filesystem and host IPC. OS folder launch is captured by a shell.openPath substitute; no real model or SSH.' }, null, 2));
  console.log(`Session workspace QA: ${checks.length} checks passed`);
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error.stack ?? error), checks, errors }, null, 2));
  try { await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') }); } catch {}
  throw error;
} finally { await app.close(); }
