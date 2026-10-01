import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

// Run after the normal application build: node scripts/test-sidebar-ui.mjs
// This exercises the real renderer with a synthetic IPC service and a fresh
// test-data directory. It never opens SSH, a real directory, or a browser,
// reads credentials, sends a model turn, captures screenshots, or reads images.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build/qa');
const dataDir = path.join(output, `sidebar-synthetic-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const checks = [];
const errors = [];
const measurements = [];
let app;
let failure;
const check = async (name, run) => {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; }
};
const waitUntil = async (predicate, description) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(25); }
  throw new Error(`Timed out waiting for ${description}`);
};
const project = (id, name, paths) => ({ id, name, path: paths[0], paths, authority: 'local', group: '', pinned: false });
const alphaPath = 'C:\\synthetic-only\\sidebar\\Alpha 工作目录';
const detailPath = `${alphaPath}\\nested-workspace-with-a-long-name-for-layout-checking`;
const session = (id, projectId, title, order, patch = {}) => ({
  id, projectId, title, pinned: false, archived: false, unread: false, group: '',
  binding: { runtime: 'demo', provider: 'synthetic', accountRef: 'synthetic-only', executionId: id, egress: 'demo' },
  status: 'idle', messages: [], createdAt: new Date(Date.UTC(2026, 8, 1, 12, 30 - order)).toISOString(),
  projectPath: projectId === 'alpha' ? alphaPath : 'C:\\synthetic-only\\sidebar\\Beta',
  ...patch,
});
const detailSession = session('a5', 'alpha', '真实合成标题 · 长标题会话元数据必须完整呈现并保持路径不截断', 5, {
  projectPath: detailPath,
  messages: [{ id: 'synthetic-message-a5', role: 'assistant', original: 'Synthetic immutable message', demo: true, timestamp: '2026-09-01T12:25:30.000Z' }],
});

try {
  app = await electron.launch({ executablePath: electronPath, args: [root], cwd: root, env, timeout: 45000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.workbench);
  const state = await page.evaluate(() => window.workbench.call('state/get'));
  state.theme = 'light';
  state.hosts = [];
  state.profiles = [];
  state.projects = [
    project('alpha', 'Alpha 合成项目', [alphaPath, `${alphaPath}\\second`]),
    project('beta', 'Beta 合成项目名称足够长以验证窄侧栏截断', ['C:\\synthetic-only\\sidebar\\Beta']),
  ];
  state.sessions = [
    session('a1', 'alpha', '运行中的合成任务', 1, { status: 'running' }),
    session('a2', 'alpha', '需要处理的合成任务', 2, { status: 'blocked' }),
    session('a3', 'alpha', '回执待确认的合成任务', 3, { status: 'uncertain' }),
    session('a4', 'alpha', '未读合成任务', 4, { unread: true }),
    detailSession,
    session('a6', 'alpha', '补充第六条', 6),
    session('a7', 'alpha', '补充第七条', 7),
    session('b1', 'beta', 'Beta 会话', 8),
    session('loose', null, '无目录的合成会话', 9, { projectPath: undefined }),
    session('pinned', null, '已置顶合成会话', 10, { pinned: true, projectPath: undefined }),
    session('archived', 'beta', '已归档合成会话', 11, { archived: true }),
    session('grouped', 'alpha', '自定义分组合成会话', 12, { group: '合成分组' }),
  ];
  await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
    const harness = globalThis.__sidebarHarness = { state: fixture, requests: [], unexpected: [], clipboard: '', opened: [] };
    ipcMain.removeHandler('workbench:call');
    ipcMain.handle('workbench:call', async (_event, method, payload = {}) => {
      harness.requests.push({ method, payload });
      const ok = value => ({ ok: true, value });
      if (method === 'state/get') return ok(harness.state);
      if (method === 'navigation/get') return ok({ sessionId: null });
      if (method === 'translation/usage') return ok({ calls: 0, cost: null });
      // Current shell discovery and presentation IPC stay synthetic as well.
      if (['extensions/renderers','model-targets/list','runtime/catalog','local-cli/list'].includes(method)) return ok([]);
      if (method === 'extensions/appearance') return ok({variables:{}});
      if (method === 'plugin-recovery/status') return ok({safeMode:false});
      if (method === 'session/fork-options') return ok({workspace:{available:true},worktree:{available:false,reason:'Synthetic non-Git folder'}});
      if (['navigation/view','desktop/titlebar','plugin-recovery/core-ready','plugin-recovery/pulse','plugin-recovery/ui-language','plugin-recovery/repair-draft'].includes(method)) return ok(null);
      if (method === 'sidebar/project-visibility') {
        for (const [key,field] of [['collapsed','sidebarCollapsedProjectIds'],['expanded','sidebarExpandedProjectIds']]) if(payload[key]!==undefined) {
          const ids=new Set(harness.state[field]??[]);if(payload[key])ids.add(payload.id);else ids.delete(payload.id);harness.state[field]=[...ids];
        }
        return ok(null);
      }
      if (method === 'session/update' || method === 'project/update') {
        const collection = method === 'session/update' ? harness.state.sessions : harness.state.projects;
        const item = collection.find(candidate => candidate.id === payload.id);
        if (!item) return { ok: false, error: 'Unknown synthetic target' };
        Object.assign(item, payload);
        return ok(item);
      }
      if (method === 'theme/set') { harness.state.theme = payload.theme; return ok(harness.state); }
      if (method === 'deep-link/copy') { harness.clipboard = `agent-workbench://threads/${payload.sessionId}`; return ok(harness.clipboard); }
      if (method === 'session/copy') {
        const item = harness.state.sessions.find(candidate => candidate.id === payload.id);
        if (!item) return { ok: false, error: 'Unknown synthetic copy target' };
        harness.clipboard = payload.format === 'directory' ? item.projectPath : `# ${item.title}\n\nSynthetic immutable message`;
        return ok(harness.clipboard);
      }
      if (method === 'path/open' || method === 'session/open-workspace') { harness.opened.push(payload); return ok(null); }
      harness.unexpected.push({ method, payload });
      return { ok: false, error: `Unexpected synthetic request: ${method}` };
    });
    BrowserWindow.getAllWindows()[0].webContents.send('workbench:state', fixture);
  }, state);

  const row = id => page.getByTestId(`sidebar-session-${id}`);
  const select = id => row(id).locator('.session-select');
  const projectGroup = id => page.locator(`.project-group[data-project-id="${id}"]`);
  const menu = page.getByTestId('sidebar-context-menu');
  const focused = id => page.evaluate(id => document.activeElement?.getAttribute('data-testid') === id, id);
  const requests = () => app.evaluate(() => globalThis.__sidebarHarness.requests);
  const count = async method => (await requests()).filter(item => item.method === method).length;
  const expectRequest = async (method, payload, after) => {
    await waitUntil(async () => (await count(method)) > after, method);
    assert.deepEqual((await requests()).filter(item => item.method === method).at(-1).payload, payload);
  };
  const openBrand = async () => { await page.getByTestId('sidebar-footer-menu').click(); await menu.waitFor(); };
  const closeMenu = async () => { await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' }); };
  const openSessionMenu = async id => {
    await select(id).focus();
    await page.keyboard.press('Shift+F10');
    await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'), '会话菜单');
  };
  const openProjectMenu = async id => {
    await projectGroup(id).locator('.project-title').focus();
    await page.keyboard.press('Shift+F10');
    await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'), '项目菜单');
  };
  const openCopy = async () => {
    await page.getByTestId('session-copy-submenu').focus();
    await page.keyboard.press('ArrowRight');
    await page.getByTestId('session-copy-menu').waitFor();
  };
  const setSize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), { width, height });
    await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width, height });
    await pause(80);
  };
  const assertInsideViewport = async (locator, label) => {
    const bounds = await locator.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds, `${label} must have bounds`);
    assert.ok(bounds.x >= 7 && bounds.y >= 7 && bounds.x + bounds.width <= viewport.width - 7 && bounds.y + bounds.height <= viewport.height - 7, `${label} must be clamped inside the viewport: ${JSON.stringify({ bounds, viewport })}`);
    measurements.push({ label, ...bounds, viewport });
    return bounds;
  };
  const assertSidebarLayout = async (width, height) => {
    await setSize(width, height);
    const layout = await page.getByTestId('sidebar').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const scroll = element.querySelector('.sidebar-scroll');
      const footer = element.querySelector('.sidebar-footer').getBoundingClientRect();
      return { width: bounds.width, background: getComputedStyle(element).backgroundColor, documentOverflow: document.documentElement.scrollWidth - innerWidth, sidebarOverflow: element.scrollWidth - element.clientWidth, listOverflow: scroll.scrollWidth - scroll.clientWidth, footerBottom: footer.bottom, height: innerHeight };
    });
    assert.equal(layout.width, 240, `fixed sidebar width: ${JSON.stringify(layout)}`);
    assert.equal(layout.background, 'rgb(239, 237, 232)');
    assert.ok(layout.documentOverflow <= 1 && layout.sidebarOverflow <= 1 && layout.listOverflow <= 1, `no horizontal overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.footerBottom <= layout.height + 1);
    measurements.push({ label: `sidebar ${width}x${height}`, ...layout });
    for (const [id, expectedTextX] of [['a1', 40], ['pinned', 16], ['grouped', 16], ['loose', 40]]) {
      const geometry = await row(id).evaluate(element => {
        const sidebar = element.closest('.sidebar').getBoundingClientRect();
        const background = element.getBoundingClientRect();
        const title = element.querySelector('.session-select > span:first-child').getBoundingClientRect();
        return { backgroundX: background.left - sidebar.left, backgroundRight: background.right - sidebar.left, titleX: title.left - sidebar.left };
      });
      assert.equal(geometry.backgroundX, 8, `${id} background starts at the sidebar's 8px inset`);
      assert.equal(geometry.titleX, expectedTextX, `${id} title uses the correct project or flat-list inset`);
      measurements.push({ label: `${id} row geometry ${width}x${height}`, ...geometry });
    }
  };

  await row('a1').waitFor();
  await check('compact sidebar remains within standard and 860px window bounds', async () => {
    await assertSidebarLayout(1360, 900);
    const rowStyle = await select('a1').evaluate(element => ({ fontSize: parseFloat(getComputedStyle(element).fontSize), fontFamily: getComputedStyle(element).fontFamily, rowHeight: element.closest('.session-row').getBoundingClientRect().height, radius: getComputedStyle(element.closest('.session-row')).borderRadius }));
    assert.equal(rowStyle.fontSize, 15);
    const configuredFont=await page.evaluate(()=>{const probe=document.createElement('span');probe.style.fontFamily='var(--font-ui)';document.body.append(probe);const family=getComputedStyle(probe).fontFamily;probe.remove();return family;});
    assert.equal(rowStyle.fontFamily, configuredFont, 'session titles follow the configured UI font');
    assert.equal(rowStyle.rowHeight, 31);
    assert.equal(rowStyle.radius, '10px');
    await row('a1').hover();
    assert.equal(await row('a1').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(227, 223, 216)');
    await assertSidebarLayout(860, 640);
    await setSize(1360, 900);
  });
  await check('projects initially show their five newest sessions without a folder-count subline', async () => {
    assert.deepEqual(await projectGroup('alpha').locator('.session-row').evaluateAll(elements => elements.map(element => element.dataset.sessionId)), ['a1', 'a2', 'a3', 'a4', 'a5']);
    assert.equal(await page.getByTestId('project-show-more-alpha').getAttribute('aria-expanded'), 'false');
    for (const id of ['alpha', 'beta']) {
      const heading = projectGroup(id).locator('.project-heading');
      assert.equal(await heading.locator('small,p').count(), 0);
      assert.doesNotMatch(await heading.innerText(), /\d+\s*个文件夹/);
    }
  });
  await check('project expand, collapse, and folder toggle preserve the five-row default', async () => {
    await page.getByTestId('project-show-more-alpha').click();
    assert.equal(await projectGroup('alpha').locator('.session-row').count(), 7);
    assert.equal(await page.getByTestId('project-show-more-alpha').innerText(), '收起');
    await page.getByTestId('project-show-more-alpha').click();
    assert.equal(await projectGroup('alpha').locator('.session-row').count(), 5);
    await projectGroup('alpha').locator('.project-title').click();
    assert.equal(await projectGroup('alpha').locator('.session-row').count(), 0);
    await projectGroup('alpha').locator('.project-title').click();
    assert.equal(await projectGroup('alpha').locator('.session-row').count(), 5);
  });
  await check('search icon focuses an on-demand field and finds sessions beyond the first five', async () => {
    assert.equal(await page.getByTestId('session-search').count(), 0);
    await page.getByTestId('sidebar-search-toggle').click();
    await waitUntil(() => focused('session-search'), 'search focus');
    await page.getByTestId('session-search').fill('补充第七条');
    await row('a7').waitFor();
    assert.equal(await page.getByTestId('sidebar').locator('.session-row').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('session-search').inputValue(), '');
    assert.equal(await projectGroup('alpha').locator('.session-row').count(), 5);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('session-search').count(), 0);
    assert.equal(await focused('sidebar-search-toggle'), true);
  });
  await check('Ctrl+K opens search while IME key events cannot open or dismiss it', async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, keyCode: 229, bubbles: true }));
    });
    assert.equal(await page.getByTestId('session-search').count(), 0);
    await page.keyboard.press('Control+k');
    await waitUntil(() => focused('session-search'), 'Ctrl+K focus');
    await page.getByTestId('session-search').fill('中文候选');
    await page.getByTestId('session-search').dispatchEvent('keydown', { key: 'Escape', isComposing: true, keyCode: 229, bubbles: true });
    assert.equal(await page.getByTestId('session-search').inputValue(), '中文候选');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await select('a5').dispatchEvent('keydown', { key: 'F10', shiftKey: true, isComposing: true, keyCode: 229, bubbles: true });
    assert.equal(await menu.count(), 0);
  });
  await check('brand menu supports Arrow, Home, End, and Escape with focus restoration', async () => {
    await page.getByTestId('sidebar-footer-menu').focus();
    await page.keyboard.press('ArrowDown');
    await menu.waitFor();
    assert.equal(await focused('settings-open'), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused('theme-toggle'), true);
    await page.keyboard.press('End');
    assert.equal(await focused('theme-toggle'), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused('settings-open'), true);
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused('theme-toggle'), true);
    await page.keyboard.press('Home');
    assert.equal(await focused('settings-open'), true);
    await closeMenu();
    assert.equal(await focused('sidebar-footer-menu'), true);
  });
  await check('brand settings and appearance entries perform their real UI actions', async () => {
    await openBrand();
    await page.getByTestId('settings-open').click();
    await page.getByRole('navigation', { name: '设置分类' }).waitFor();
    await navigateWorkbench(page,'workspace');
    const before = await count('theme/set');
    await openBrand();
    await page.getByTestId('theme-toggle').click();
    await expectRequest('theme/set', { theme: 'dark' }, before);
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await openBrand();
    await page.getByTestId('theme-toggle').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await navigateWorkbench(page,'workspace');
    await page.getByTestId('composer-input').waitFor();
  });
  await check('brand archive entry switches to archived records and returns to active records', async () => {
    await openWorkbenchSettings(page,'archive');
    await page.getByTestId('archived-sessions').waitFor();
    assert.equal(await page.getByTestId('archived-session-archived').count(),1);
    assert.equal(await row('a1').isVisible(),false);
    await navigateWorkbench(page,'workspace');
    await row('a1').waitFor();
    assert.equal(await row('archived').count(), 0);
  });
  await check('running, blocked, uncertain, and unread states have distinct accessible indicators', async () => {
    const ring = row('a1').getByRole('img', { name: '运行中', exact: true });
    assert.equal(await ring.count(), 1);
    const style = await ring.evaluate(element => { const style = getComputedStyle(element); return { border: parseFloat(style.borderTopWidth), radius: style.borderRadius, width: parseFloat(style.width) }; });
    assert.ok(style.border > 0 && style.width >= 9 && style.width <= 15 && style.radius === '50%', `running indicator is a ring: ${JSON.stringify(style)}`);
    assert.equal(await row('a2').getByRole('img', { name: '需要处理', exact: true }).count(), 1);
    assert.equal(await row('a3').getByRole('img', { name: '状态待确认', exact: true }).count(), 1);
    assert.equal(await row('a4').getByRole('img', { name: '未读', exact: true }).count(), 1);
    assert.equal(await row('a5').getByRole('img').count(), 0);
  });
  await check('hover metadata contains the actual full title, project, directory, timestamp, and status', async () => {
    await page.getByTestId('composer-input').focus();
    await select('a5').hover();
    const preview = page.getByTestId('sidebar-session-preview');
    await preview.waitFor();
    const text = await preview.innerText();
    assert.ok(text.includes(detailSession.title));
    assert.ok(text.includes('Alpha 合成项目'));
    assert.ok(text.includes(detailPath));
    assert.equal(await preview.locator('.session-preview-meta').getAttribute('aria-label'), '空闲');
    assert.equal(await preview.locator('.session-preview-status').count(), 0);
    assert.equal(await preview.locator('time').getAttribute('datetime'), detailSession.messages[0].timestamp);
    assert.match(await preview.locator('time').getAttribute('title'), /最后消息/);
    assert.ok((await preview.locator('time').innerText()).length > 0);
    const previewBounds = await assertInsideViewport(preview, 'standard hover preview');
    assert.equal(await preview.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 253, 249)');
    const sidebarBounds = await page.getByTestId('sidebar').boundingBox();
    assert.equal(previewBounds.width, 320);
    assert.equal(previewBounds.x, sidebarBounds.x + sidebarBounds.width - 15);
    await page.getByTestId('composer-input').hover();
    await preview.waitFor({ state: 'hidden' });
  });
  await check('keyboard focus exposes the same metadata and updates it for a different session', async () => {
    await select('a5').focus();
    const preview = page.getByTestId('sidebar-session-preview');
    await preview.waitFor();
    assert.ok((await preview.innerText()).includes(detailSession.title));
    assert.equal(await select('a5').getAttribute('aria-describedby'), 'sidebar-session-preview');
    await select('a2').focus();
    await waitUntil(async () => (await preview.innerText()).includes('需要处理的合成任务'), 'focused session preview');
    assert.match(await preview.innerText(), /需要处理/);
    assert.equal(await preview.locator('.session-preview-project .session-preview-status').innerText(), '需要处理');
    assert.equal(await preview.locator('time').getAttribute('datetime'), state.sessions.find(item => item.id === 'a2').createdAt);
    await select('b1').focus();
    await waitUntil(async () => (await preview.innerText()).includes('Beta 会话'), 'ordinary project session preview');
    assert.equal(await preview.locator('.session-preview-path').count(), 0);
    assert.equal(await preview.locator('.session-preview-status').count(), 0);
    assert.equal(await preview.locator('[data-workbench-session-preview] > *').count(), 2);
    assert.equal(await preview.locator('.session-preview-meta').getAttribute('aria-label'), '空闲');
    await page.getByTestId('composer-input').focus();
    await preview.waitFor({ state: 'hidden' });
  });
  await check('real right-click and Shift+F10 open the correct session menu without selecting it', async () => {
    await select('a5').click({ button: 'right' });
    await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'), '会话菜单');
    assert.equal(await select('a5').getAttribute('aria-current'), null);
    await closeMenu();
    assert.equal(await select('a5').evaluate(element => document.activeElement === element), true);
    await openSessionMenu('a5');
    assert.equal(await focused('session-rename'), true);
    await closeMenu();
  });
  await check('context menu and copy submenu remain inside the lower-right edge of a narrow viewport', async () => {
    await setSize(860, 640);
    // Playwright's generic contextmenu dispatch creates an Event in this
    // runtime, which drops clientX/clientY. Use a real MouseEvent to exercise
    // pointer-edge clamping; Shift+F10 already covers anchor positioning.
    const cornerEvent = await row('a5').evaluate(element => {
      const event = new MouseEvent('contextmenu', { clientX: innerWidth - 1, clientY: innerHeight - 1, bubbles: true, cancelable: true, button: 2 });
      element.dispatchEvent(event);
      return { constructor: event.constructor.name, clientX: event.clientX, clientY: event.clientY };
    });
    measurements.push({ label: 'lower-right synthetic pointer event', ...cornerEvent });
    await menu.waitFor();
    const parentBounds = await assertInsideViewport(menu, 'narrow context menu');
    await openCopy();
    const childBounds = await assertInsideViewport(page.getByTestId('session-copy-menu'), 'narrow copy submenu');
    assert.ok(childBounds.x + childBounds.width <= parentBounds.x, 'submenu opens to the left when there is no space on the right');
    await page.keyboard.press('ArrowLeft');
    await page.getByTestId('session-copy-menu').waitFor({ state: 'hidden' });
    assert.equal(await focused('session-copy-submenu'), true);
    await closeMenu();
    await select('a5').focus();
    await page.getByTestId('sidebar-session-preview').waitFor();
    await assertInsideViewport(page.getByTestId('sidebar-session-preview'), 'narrow focused preview');
    await page.getByTestId('composer-input').focus();
    await setSize(1360, 900);
  });
  await check('copy submenu supports Right, Left, Arrow, Home, and End keyboard navigation', async () => {
    await openSessionMenu('a5');
    await openCopy();
    assert.equal(await focused('copy-session-link'), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused('copy-session-directory'), true);
    await page.keyboard.press('End');
    assert.equal(await focused('copy-session-markdown'), true);
    await page.keyboard.press('Home');
    assert.equal(await focused('copy-session-link'), true);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focused('session-copy-submenu'), true);
    assert.equal(await page.getByTestId('session-copy-menu').count(), 0);
    await closeMenu();
  });
  for (const format of ['link', 'directory', 'markdown']) {
    await check(`copy ${format} requests the exact session and format`, async () => {
      const method = format === 'link' ? 'deep-link/copy' : 'session/copy';
      const before = await count(method);
      await openSessionMenu('a5');
      await openCopy();
      await page.getByTestId(`copy-session-${format}`).click();
      await expectRequest(method, format === 'link' ? { sessionId: 'a5' } : { id: 'a5', format }, before);
      await menu.waitFor({ state: 'hidden' });
      const clipboard = await app.evaluate(() => globalThis.__sidebarHarness.clipboard);
      assert.equal(clipboard, format === 'link' ? 'agent-workbench://threads/a5' : format === 'directory' ? detailPath : `# ${detailSession.title}\n\nSynthetic immutable message`);
    });
  }
  await check('a session without a directory disables both directory copy and open actions', async () => {
    await openSessionMenu('loose');
    assert.equal(await page.getByTestId('open-session-folder').isDisabled(), true);
    await openCopy();
    assert.equal(await page.getByTestId('copy-session-directory').isDisabled(), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused('copy-session-markdown'), true);
    await page.keyboard.press('ArrowLeft');
    await closeMenu();
  });
  await check('open directory actions send exact session and project bindings to the synthetic service', async () => {
    let before = await count('session/open-workspace');
    await openSessionMenu('a5');
    await page.getByTestId('open-session-folder').click();
    await expectRequest('session/open-workspace', { sessionId: 'a5' }, before);
    before = await count('path/open');
    await openProjectMenu('alpha');
    await page.getByTestId('project-open-folder').click();
    await expectRequest('path/open', { projectId: 'alpha' }, before);
  });
  await check('direct pin and unpin buttons update one session without opening or selecting it', async () => {
    let before = await count('session/update');
    await row('a5').hover();
    await page.getByTestId('quick-pin-a5').click();
    await expectRequest('session/update', { id: 'a5', pinned: true }, before);
    await page.getByTestId('pinned-sessions').getByTestId('sidebar-session-a5').waitFor();
    assert.equal(await select('a5').getAttribute('aria-current'), null);
    assert.equal(await menu.count(), 0);
    before = await count('session/update');
    await row('a5').hover();
    await page.getByTestId('quick-pin-a5').click();
    await expectRequest('session/update', { id: 'a5', pinned: false }, before);
    await projectGroup('alpha').getByTestId('sidebar-session-a5').waitFor();
  });
  await check('quick-action tooltips remain visible and replace the larger metadata preview', async () => {
    await page.getByTestId('composer-input').focus();
    await row('a5').hover();
    await page.getByTestId('quick-pin-a5').hover();
    const tooltip = page.getByTestId('sidebar-quick-tooltip');
    await tooltip.waitFor();
    assert.match(await tooltip.innerText(), /置顶/);
    await assertInsideViewport(tooltip, 'quick pin tooltip');
    assert.equal(await page.getByTestId('sidebar-session-preview').count(), 0);
    await page.getByTestId('quick-archive-a5').focus();
    await waitUntil(async () => (await tooltip.innerText()).includes('归档'), 'archive tooltip');
    assert.equal(await page.getByTestId('sidebar-session-preview').count(), 0);
    await page.getByTestId('composer-input').hover();
    await page.getByTestId('composer-input').focus();
    await tooltip.waitFor({ state: 'hidden' });
  });
  await check('direct archive hides one session and its archive-view action restores it', async () => {
    let before = await count('session/update');
    await row('a5').hover();
    await page.getByTestId('quick-archive-a5').click();
    await expectRequest('session/update', { id: 'a5', archived: true }, before);
    await row('a5').waitFor({ state: 'hidden' });
    await row('a6').waitFor();
    await openWorkbenchSettings(page,'archive');
    await page.getByTestId('archived-session-a5').waitFor();
    before = await count('session/update');
    await page.getByTestId('archived-session-a5').getByRole('button',{name:/恢复会话/}).click();
    await expectRequest('session/update', { id: 'a5', archived: false }, before);
    await page.getByTestId('archived-session-a5').waitFor({state:'hidden'});
    await navigateWorkbench(page,'workspace');
    await row('a5').waitFor();
  });
  await check('project pin moves the project first and unpin restores its ordinary order', async () => {
    let before = await count('project/update');
    await openProjectMenu('beta');
    await page.getByTestId('project-pin').click();
    await expectRequest('project/update', { id: 'beta', pinned: true }, before);
    await waitUntil(async () => (await page.locator('.project-group:not([data-project-id="__recent__"])').first().getAttribute('data-project-id')) === 'beta', 'pinned project order');
    assert.equal(await projectGroup('beta').getByLabel('已置顶').count(), 1);
    before = await count('project/update');
    await openProjectMenu('beta');
    await page.getByTestId('project-pin').click();
    await expectRequest('project/update', { id: 'beta', pinned: false }, before);
    await waitUntil(async () => (await page.locator('.project-group:not([data-project-id="__recent__"])').first().getAttribute('data-project-id')) === 'alpha', 'restored project order');
  });
  await check('mark unread updates the visible dot and opening the session marks it read', async () => {
    let before = await count('session/update');
    await openSessionMenu('a5');
    await page.getByTestId('session-unread').click();
    await expectRequest('session/update', { id: 'a5', unread: true }, before);
    await row('a5').getByRole('img', { name: '未读', exact: true }).waitFor();
    before = await count('session/update');
    await select('a5').click();
    await expectRequest('session/update', { id: 'a5', unread: false }, before);
    await row('a5').getByRole('img', { name: '未读', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await select('a5').getAttribute('aria-current'), 'page');
  });
  for (const spec of [
    { item: 'session-delete', title: '永久删除会话', method: 'session/delete', sessionId: 'a5', text: detailSession.title },
    { item: 'project-archive-chats', title: '归档项目内会话', method: 'project/archive-sessions', projectId: 'alpha', text: 'Alpha 合成项目' },
    { item: 'project-remove', title: '移除项目', method: 'project/remove', projectId: 'alpha', text: 'Alpha 合成项目' },
  ]) {
    await check(`${spec.item} opens a bound confirmation and cancel sends no mutation`, async () => {
      const before = await count(spec.method);
      if (spec.sessionId) await openSessionMenu(spec.sessionId); else await openProjectMenu(spec.projectId);
      await page.getByTestId(spec.item).click();
      const dialog = page.getByRole('dialog', { name: spec.title, exact: true });
      await dialog.waitFor();
      assert.ok((await dialog.innerText()).includes(spec.text));
      assert.equal(await page.getByTestId('confirm-sidebar-action').isEnabled(), true);
      assert.equal(await count(spec.method), before);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await count(spec.method), before);
    });
  }
  await check('content-pane scroll events preserve the sidebar menu and copy submenu', async () => {
    await page.getByTestId('original-pane').waitFor();
    await page.getByTestId('translation-pane').waitFor();
    await openSessionMenu('a5');
    await openCopy();
    for (const pane of ['original-pane', 'translation-pane']) {
      // Element scroll events do not bubble, but the window capture listener
      // observes them. They must not dismiss a sibling sidebar's anchored menu.
      await page.getByTestId(pane).dispatchEvent('scroll', { bubbles: false });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await menu.isVisible(), true, `${pane} scrolling preserves the menu`);
      assert.equal(await page.getByTestId('session-copy-menu').isVisible(), true, `${pane} scrolling preserves the copy submenu`);
      assert.equal(await focused('copy-session-link'), true);
    }
    await page.keyboard.press('ArrowLeft');
    await closeMenu();
  });
  await check('scrolling the sidebar ancestor dismisses its menu and copy submenu', async () => {
    await openSessionMenu('a5');
    await openCopy();
    const scrollContainer = page.getByTestId('sidebar').locator('.sidebar-scroll');
    assert.equal(await scrollContainer.evaluate(element => element.contains(document.querySelector('[data-testid="sidebar-session-a5"] .session-select'))), true);
    await scrollContainer.dispatchEvent('scroll', { bubbles: false });
    await menu.waitFor({ state: 'hidden' });
    await page.getByTestId('session-copy-menu').waitFor({ state: 'hidden' });
  });
  await check('settings footer is compact and contains no large brand mark', async () => {
    const sidebar = page.getByTestId('sidebar');
    assert.equal(await sidebar.locator('.brand-mark').count(), 0);
    assert.equal(await sidebar.locator('.sidebar-footer button').count(), 1);
    assert.ok((await sidebar.locator('.sidebar-footer').boundingBox()).height <= 45);
    const settings = page.getByTestId('sidebar-footer-menu');
    const bounds = await settings.boundingBox();
    assert.ok(bounds && bounds.height <= 36);
    assert.ok((await settings.innerText()).includes('设置'));
    assert.equal(await settings.locator('svg').count(),2);
    assert.ok((await settings.locator('svg').first().boundingBox()).width <= 18);
    await settings.click();
    await page.getByTestId('settings-open').click();
    await page.getByRole('navigation',{name:'设置分类'}).waitFor();
    await navigateWorkbench(page,'workspace');
    await assertSidebarLayout(860,640);
  });
  await check('renderer has no errors, unexpected IPC requests, destructive actions, or external execution', async () => {
    assert.deepEqual(errors, []);
    const unexpected = await app.evaluate(() => globalThis.__sidebarHarness.unexpected);
    assert.deepEqual(unexpected, []);
    assert.equal(await page.getByRole('alert').count(), 0);
    const methods = (await requests()).map(item => item.method);
    assert.equal(methods.filter(method => ['session/delete', 'project/remove', 'project/archive-sessions'].includes(method)).length, 0);
    assert.equal(methods.filter(method => /^(?:host\/|codex-auth\/|draft\/|translation\/(?:models|settings|candidates))/.test(method)).length, 0);
  });
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  if (app) await app.close();
  await writeFile(path.join(output, 'sidebar-ui-report.json'), JSON.stringify({ observedAt: new Date().toISOString(), screenshots: false, syntheticOnly: true, checks, errors, measurements, ...(failure ? { failure } : {}) }, null, 2));
}
console.log(`Sidebar UI: ${checks.length}/${checks.length} passed; screenshots=false; syntheticOnly=true`);
