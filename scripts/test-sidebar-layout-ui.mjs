import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(root, 'build/qa/sidebar-layout-20260926');
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'awb-sidebar-layout-'));
const folder = path.join(dataDir, '写作项目'); await mkdir(folder);
const checks = [], errors = [], measurements = [];
const record = name => { checks.push(name); console.log('PASS ' + name); };
const launch = () => electron.launch({ executablePath: electronPath, args: [root], cwd: root, env: { ...process.env, AGENT_WORKBENCH_TEST_DATA: dataDir, ELECTRON_RUN_AS_NODE: undefined } });
let app = await launch();
try {
  let page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.getByTestId('composer-input').waitFor();
  const call = (method, payload = {}) => page.evaluate(({ method, payload }) => window.workbench.call(method, payload), { method, payload });
  const command = id => app.evaluate(({ Menu, BrowserWindow }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(undefined, BrowserWindow.getAllWindows()[0], {}), id);
  const waitWidth = width => page.waitForFunction(width => Math.abs(document.querySelector('.sidebar-slot').getBoundingClientRect().width - width) < 1, width);
  const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
  const within = async () => {
    const value = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="sidebar"]'), main = document.querySelector('.main-panel');
      return { viewport: innerWidth, width: sidebar.getBoundingClientRect().width, main: main.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth - innerWidth, sidebarOverflow: sidebar.scrollWidth - sidebar.clientWidth,
        scrollOverflow: sidebar.querySelector('.sidebar-scroll').scrollWidth - sidebar.querySelector('.sidebar-scroll').clientWidth };
    });
    measurements.push(value); assert.ok(value.overflow <= 1 && value.sidebarOverflow <= 1 && value.scrollOverflow <= 1, JSON.stringify(value));
    assert.ok(value.main >= 520, JSON.stringify(value));
  };
  const dragTo = async (target, cancel = false) => {
    const bounds = await page.getByTestId('sidebar-divider').boundingBox();
    const current = await page.locator('.sidebar-slot').evaluate(e => e.getBoundingClientRect().width);
    const start = bounds.x + bounds.width / 2;
    await page.mouse.move(start, bounds.y + 130); await page.mouse.down();
    await page.mouse.move(start + target - current, bounds.y + 130, { steps: 12 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await call('theme/set', { theme: 'light' });
  const project = await call('project/create', { name: '文学写作', paths: [folder] });
  const entries = [];
  for (const title of ['春日来信', 'chapter two', '📚 Écriture', '𠮷野的札记', 'e\u0301bauche', '夏末随笔', '远行之前']) {
    const session = await call('session/create', { runtime: 'demo', projectId: project.id });
    await call('session/update', { id: session.id, title }); entries.push({ ...session, title });
  }
  const pinned = await call('session/create', { runtime: 'demo' });
  await call('session/update', { id: pinned.id, title: '置顶的书信', pinned: true });
  const group = await call('session/create', { runtime: 'demo' });
  await call('session/update', { id: group.id, title: 'Notes', group: '随手记' });
  const projectRows = page.locator(`[data-project-id="${project.id}"]`);
  const row = id => page.getByTestId(`sidebar-session-${id}`);
  await waitWidth(240); await within();
  await page.getByTestId(`project-show-more-${project.id}`).click();
  await row(entries[0].id).locator('.session-select').click();
  await page.getByTestId('composer-input').fill('折叠、拖动、打开设置之后仍保留这份草稿。');
  await page.getByTestId('sidebar-toggle').click(); await waitWidth(64);
  assert.equal(await page.getByTestId('sidebar-toggle').getAttribute('aria-label'), '展开侧边栏');
  assert.equal(await page.getByTestId('sidebar').isVisible(), true);
  assert.equal(await projectRows.locator('.project-rail-initial').innerText(), '文');
  assert.equal(await row(entries[0].id).locator('.session-rail-initial').innerText(), '春');
  assert.equal(await row(entries[1].id).locator('.session-rail-initial').innerText(), 'C');
  assert.equal(await row(entries[2].id).locator('.session-rail-initial').innerText(), 'É');
  assert.equal(await row(entries[3].id).locator('.session-rail-initial').innerText(), '𠮷');
  assert.equal(await row(entries[4].id).locator('.session-rail-initial').innerText(), 'E\u0301');
  assert.equal(await row(entries[0].id).locator('.session-select').getAttribute('aria-label'), '春日来信');
  assert.equal(await row(pinned.id).isVisible(), true); assert.equal(await row(group.id).isVisible(), true);
  await within(); await page.mouse.move(500, 80); await shot('rail-light');
  record('titlebar collapse retains accessible Chinese, Latin and Unicode session initials, distinct projects, pinned chats and groups');

  await row(entries[1].id).locator('.session-select').focus(); await row(entries[1].id).hover(); await page.getByTestId('sidebar-session-preview').waitFor();
  assert.ok((await page.getByTestId('sidebar-session-preview').innerText()).includes('chapter two'));
  assert.ok((await page.getByTestId('sidebar-session-preview').innerText()).includes('文学写作'));
  const preview = await page.getByTestId('sidebar-session-preview').boundingBox(); assert.ok(preview.x >= 64);
  await shot('rail-preview-light');
  await row(entries[1].id).locator('.session-select').click();
  await page.waitForFunction(id => document.querySelector(`[data-session-id="${id}"] .session-select`)?.getAttribute('aria-current') === 'page', entries[1].id);
  await row(entries[0].id).locator('.session-select').click();
  await page.getByTestId('composer-input').fill('折叠、拖动、打开设置之后仍保留这份草稿。');
  record('compact session click navigates immediately and hover shows full title and project metadata');

  await row(entries[0].id).click({ button: 'right' });
  await page.getByTestId('session-copy-submenu').hover(); await page.getByTestId('copy-session-link').waitFor();
  await shot('rail-menu-light'); await page.getByTestId('copy-session-link').click();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText()); assert.ok(copied.includes(entries[0].id));
  await row(entries[1].id).locator('.session-select').focus(); await page.keyboard.press('Shift+F10');
  await page.getByTestId('session-unread').click(); assert.equal((await call('state/get')).sessions.find(s => s.id === entries[1].id).unread, true);
  assert.equal(await row(entries[1].id).getByLabel('未读', { exact: true }).isVisible(), true);
  await projectRows.locator('.project-title').click({ button: 'right' }); await page.getByTestId('project-pin').click();
  assert.equal((await call('state/get')).projects.find(p => p.id === project.id).pinned, true);
  await projectRows.locator('.project-title').focus(); await page.keyboard.press('Shift+F10'); await page.getByTestId('project-manage-folders').waitFor();
  await page.keyboard.press('Escape');
  record('compact session/project right-click and keyboard menus keep real copy, unread and pin actions');

  await projectRows.locator('.project-title').click(); assert.equal(await projectRows.locator('.session-row').count(), 0);
  await projectRows.locator('.project-title').click(); assert.equal(await projectRows.locator('.session-row').count(), 7);
  await page.getByTestId(`project-show-more-${project.id}`).click(); assert.equal(await projectRows.locator('.session-row').count(), 5);
  await page.getByTestId(`project-show-more-${project.id}`).click(); assert.equal(await projectRows.locator('.session-row').count(), 7);
  await page.keyboard.press('Control+b'); await waitWidth(240);
  assert.equal(await projectRows.locator('.session-row').count(), 7);
  assert.equal(await page.getByTestId('composer-input').inputValue(), '折叠、拖动、打开设置之后仍保留这份草稿。');
  record('project folding, paging and Ctrl+B work without replacing the active workspace');

  await dragTo(410); await waitWidth(410); await within(); await page.mouse.move(650, 100); await shot('expanded-light');
  await dragTo(500, true); await waitWidth(410);
  await dragTo(80); await waitWidth(240);
  await dragTo(1200); await waitWidth(600); await within();
  await page.getByTestId('sidebar-divider').focus(); await page.keyboard.press('Home'); await waitWidth(240);
  await page.keyboard.press('ArrowRight'); await waitWidth(256); await page.keyboard.press('Shift+ArrowRight'); await waitWidth(288);
  await page.keyboard.press('End'); await waitWidth(600);
  await page.getByTestId('sidebar-divider').dblclick(); await waitWidth(240);
  await dragTo(410); await waitWidth(410); await command('toggle-sidebar'); await waitWidth(64); await command('toggle-sidebar'); await waitWidth(410);
  assert.equal(await page.getByTestId('composer-input').inputValue(), '折叠、拖动、打开设置之后仍保留这份草稿。');
  record('real pointer drag, capture, Escape, bounds, keyboard resizing and double-click reset preserve draft and chosen width');

  await command('toggle-sidebar'); await waitWidth(64); await page.getByTestId('sidebar-search-toggle').click();
  await page.getByTestId('session-search').waitFor(); await waitWidth(410);
  assert.equal(await page.getByTestId('session-search').evaluate(e => e === document.activeElement), true);
  await page.getByTestId('session-search').fill('chapter'); assert.equal(await page.locator('.sidebar .session-row').count(), 1);
  await command('toggle-sidebar'); await waitWidth(64); assert.equal(await page.getByTestId('session-search').count(), 0);
  assert.equal(await projectRows.locator('.session-row').count(), 7);
  await page.keyboard.press('Control+k'); await page.getByTestId('session-search').waitFor(); await waitWidth(410); await page.keyboard.press('Escape');
  record('search expands the sidebar and focuses input; collapsing clears hidden filters');

  await command('toggle-sidebar'); await waitWidth(64);
  await page.getByTestId('sidebar-footer-menu').click(); await page.getByTestId('settings-open').click();
  await page.getByTestId('settings-layout').waitFor(); assert.equal(await page.getByTestId('sidebar-toggle').isDisabled(), true);
  await page.getByTestId('nav-workspace').click(); await waitWidth(64);
  assert.equal(await page.getByTestId('composer-input').inputValue(), '折叠、拖动、打开设置之后仍保留这份草稿。');
  await page.getByTestId('sidebar-new-project').click(); await page.getByRole('dialog', { name: '创建项目' }).waitFor(); await page.keyboard.press('Escape');
  await page.getByTestId('sidebar-footer-menu').click(); await page.getByTestId('theme-toggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.mouse.move(500, 80); await shot('rail-dark');
  await row(entries[1].id).click({ button: 'right' }); await shot('rail-menu-dark'); await page.keyboard.press('Escape');
  record('compact footer, new project, settings return and theme toggle remain usable');

  await command('toggle-sidebar'); await waitWidth(410); await dragTo(480); await waitWidth(480);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640));
  await page.waitForFunction(() => innerWidth === 860); await waitWidth(340); await within(); await shot('expanded-dark-860');
  await command('toggle-sidebar'); await waitWidth(64); await within(); await page.mouse.move(400, 80); await shot('rail-dark-860');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.waitForFunction(() => innerWidth === 1440); await command('toggle-sidebar'); await waitWidth(480); await within();
  record('narrow windows clamp the displayed width and recover the preference on widening; both layouts fit without overflow');

  await command('toggle-sidebar'); await waitWidth(64);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('workbench.sidebar-layout.v1')).compact);
  await app.close(); app = await launch(); page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.getByTestId('composer-input').waitFor(); await waitWidth(64);
  await page.getByTestId('sidebar-toggle').click(); await waitWidth(480);
  assert.equal(await page.getByTestId('sidebar-toggle').getAttribute('aria-expanded'), 'true');
  record('a fresh Electron process restores compact state and the last expanded width');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, timestamp: new Date().toISOString(), checks, errors, measurements, dataDir,
    scope: 'Real isolated Electron UI, real host session/project IPC and clipboard, synthetic conversations. No model, SSH, credentials or production data.' }, null, 2));
  console.log(`Sidebar layout QA: ${checks.length} checks passed`);
} catch (error) {
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error.stack ?? error), checks, errors }, null, 2));
  try { await (await app.firstWindow()).screenshot({ path: path.join(output, 'failure.png') }); } catch {}
  throw error;
} finally { await app.close(); }
