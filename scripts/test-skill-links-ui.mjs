import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as hostBuild } from 'esbuild';
import { build as rendererBuild } from 'vite';
import { mkdir, writeFile, readFile, realpath, readlink, lstat, symlink, unlink, cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openWorkbenchSettings } from './ui-control-helpers.mjs';

const root = process.cwd(), output = path.resolve(process.env.AWB_SKILL_LINK_UI_QA ?? 'build/qa/skill-links-20260928/ui'), appRoot = path.join(output, 'app'), data = path.join(output, 'data-' + Date.now()), home = path.join(data, 'native-home');
assert.ok(process.env.AWB_QA_CODEX && process.env.AWB_QA_CLAUDE, 'Explicit native executables required.');
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
const mark = name => { checks.push(name); console.log('PASS ' + name); };
const fixtures = [['drawing-review', '角色绘图检查', '检查贴图与参考资料，保持原始资源完整。'], ['mesh-review', '模型与形态键检查', '检查模型数据及资源引用，生成简明检查结果。'], ['ui-review', '界面布局审阅', '审阅层级、留白与交互状态。'], ['collision', '同名冲突示例', '保留另一方已有文件，不自动覆盖。']];
for (const [name, title, description] of fixtures) {
  const source = path.join(home, 'cc-switch-fixture', name), entry = path.join(home, '.codex', 'skills', name);
  await put(path.join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nLINKED_SKILL_${name}: Answer concisely. Read references/check.txt if needed.\n`);
  await put(path.join(source, 'references/check.txt'), 'LINKED_RESOURCE');
  await put(path.join(source, 'agents/openai.yaml'), `interface:\n  display_name: "${title}"\n  short_description: "${description}"\n`);
  await mkdir(path.dirname(entry), { recursive: true }); await symlink(source, entry, process.platform === 'win32' ? 'junction' : 'dir');
}
const claudeSource = path.join(home, '.claude', 'skills', 'claude-fixture');
await put(path.join(claudeSource, 'SKILL.md'), '---\nname: claude-fixture\ndescription: A native standalone Claude skill.\n---\nLINKED_SKILL_CODEX_REVERSE: Answer concisely.\n');
await put(path.join(claudeSource, 'agents/openai.yaml'), 'interface:\n  display_name: "写作检查"\n  short_description: "由 Claude Code 个人目录接入 Codex。"\n');
await put(path.join(home, '.claude', 'skills', 'collision', 'SKILL.md'), '---\nname: other-collision\ndescription: Existing external skill.\n---\nPRESERVE_EXTERNAL_FILE');
await put(path.join(home, '.codex', 'skills', '.system', 'official-fixture', 'SKILL.md'), '---\nname: official-fixture\ndescription: Official scope fixture.\n---\nOfficial fixture.');
let app, page; const checks = [], errors = [], requests = [];
const server = createServer(async (req, res) => { try {
  res.setHeader('content-type', 'application/json'); if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic skill acceptance complete.' } }], usage: { prompt_tokens: 100, completion_tokens: 8 } }));
} catch (error) { errors.push(String(error)); res.writeHead(500).end('{}'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await rendererBuild({ configFile: path.join(root, 'vite.config.ts'), build: { outDir: path.join(appRoot, 'renderer'), emptyOutDir: true }, logLevel: 'warn' });
for (const entry of ['main', 'preload']) await hostBuild({ entryPoints: [`apps/desktop/host/${entry}.ts`], outfile: path.join(appRoot, `host/${entry}.cjs`), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
await cp('services/vps-workspace-control', path.join(appRoot, 'host/workspace-control'), { recursive: true }); await cp('services/vps-account-broker', path.join(appRoot, 'host/account-runtime'), { recursive: true });
await put(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'awb-skill-link-qa', version: '1.0.0', main: 'host/main.cjs' }));
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: data, AGENT_WORKBENCH_TEST_HIDDEN: '1', AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE: process.env.AWB_QA_CODEX, AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE: process.env.AWB_QA_CLAUDE }; delete env.ELECTRON_RUN_AS_NODE;
const call = (method, payload = {}) => page.evaluate(({ method, payload }) => window.workbench.call(method, payload), { method, payload });
const wait = async (fn, message) => { const end = Date.now() + 60000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timed out: ' + message); };
const shot = name => page.screenshot({ path: path.join(output, name) });
const row = title => page.locator('.native-skill-list article').filter({ has: page.getByTitle(title, { exact: true }) });
try {
  app = await electron.launch({ executablePath: electronPath, args: [appRoot], cwd: root, env, timeout: 45000 }); page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); await page.waitForFunction(() => !!window.workbench);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 860)); await call('theme/set', { theme: 'light' }); await openWorkbenchSettings(page, 'skills');
  await row('角色绘图检查').waitFor();
  const count = await page.locator('.native-skill-list article').count(); assert.equal(await page.locator('.native-skill-list .skill-runtime-button').count(), count * 2);
  assert.equal(await row('角色绘图检查').locator('[data-runtime=codex]').getAttribute('aria-pressed'), 'true'); assert.equal(await row('角色绘图检查').locator('[data-runtime=codex]').getAttribute('aria-disabled'), 'true');
  assert.equal(await row('角色绘图检查').locator('[data-runtime=claude]').getAttribute('aria-pressed'), 'false');
  assert.equal(await row('同名冲突示例').locator('[data-runtime=claude]').getAttribute('data-state'), 'conflict');
  await shot('skills-light.png'); mark('every personal row has two native runtime logos beside its enable switch; external entries and conflicts are distinct');
  await row('角色绘图检查').locator('[data-runtime=claude]').click(); await wait(async () => await row('角色绘图检查').locator('[data-runtime=claude]').getAttribute('aria-pressed') === 'true', 'row connection');
  const entry = path.join(home, '.claude', 'skills', 'drawing-review'); assert.equal(await realpath(entry), await realpath(path.join(home, 'cc-switch-fixture', 'drawing-review'))); assert.ok((await readlink(entry)).includes('cc-switch-fixture')); assert.equal(await readFile(path.join(entry, 'references/check.txt'), 'utf8'), 'LINKED_RESOURCE');
  assert.equal(await row('角色绘图检查').count(), 1); mark('one row click creates a direct final-target link with all resources and merges the native origins');
  await page.getByLabel('搜索技能').fill('检查');
  await page.getByRole('button', { name: '批量管理 Claude Code 接入', exact: true }).click(); let dialog = page.getByRole('dialog', { name: '接入 Claude Code', exact: true }); await dialog.waitFor();
  assert.match(await dialog.innerText(), /当前列表 · 3 项技能/); assert.match(await dialog.innerText(), /新接入 1 项/); assert.ok((await dialog.boundingBox()).width <= 441);
  await shot('batch-light.png'); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  await assert.rejects(lstat(path.join(home, '.claude', 'skills', 'mesh-review')), { code: 'ENOENT' });
  assert.equal(await page.getByRole('button', { name: '批量管理 Claude Code 接入', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '批量管理 Claude Code 接入', exact: true }).click(); await dialog.waitFor(); await dialog.getByRole('button', { name: '确认接入 1 项', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  assert.ok((await lstat(path.join(home, '.claude', 'skills', 'mesh-review'))).isSymbolicLink()); await assert.rejects(lstat(path.join(home, '.claude', 'skills', 'ui-review')), { code: 'ENOENT' }); mark('compact bulk confirmation acts only on filtered skills; Escape cancels and restores focus');
  await page.getByLabel('搜索技能').fill(''); await page.getByRole('button', { name: '批量管理 Claude Code 接入', exact: true }).click(); await dialog.waitFor(); await dialog.getByRole('button', { name: /查看跳过的项目/ }).click(); assert.match(await dialog.innerText(), /同名条目已存在/); await shot('batch-conflict-light.png'); await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /官方/ }).click(); assert.equal(await page.getByTestId('skill-connections-toolbar').count(), 0); assert.equal(await page.locator('.skill-runtime-button').count(), 0); assert.equal(await page.getByTestId('skills-import').count(), 0);
  await page.getByRole('tab', { name: /个人/ }).click(); await page.getByTestId('skills-import').click(); assert.equal(await page.getByRole('tab', { name: 'Codex', exact: true }).getAttribute('aria-selected'), 'true'); await page.keyboard.press('Escape'); mark('official tab stays read-only for sharing and ZIP import retains its native target selection');
  await call('theme/set', { theme: 'dark' }); await shot('skills-dark.png'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640)); await page.waitForFunction(() => innerWidth === 860); await shot('skills-dark-narrow.png');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const positions = await row('角色绘图检查').evaluate(node => { const icons = node.querySelector('.skill-connections').getBoundingClientRect(), origin = node.querySelector('.native-skill-origin').getBoundingClientRect(), toggle = node.querySelector('.toggle-row').getBoundingClientRect(); return { iconsLeft: icons.left, iconsRight: icons.right, originRight: origin.right, toggleLeft: toggle.left, height: node.getBoundingClientRect().height }; }); assert.ok(positions.originRight <= positions.iconsLeft && positions.iconsRight <= positions.toggleLeft && positions.height <= 90);
  const description = row('模型与形态键检查').locator('.native-skill-description'); await description.hover();
  assert.equal(await description.getAttribute('title'), fixtures[1][2]);
  const descriptionLayout = await row('模型与形态键检查').evaluate(node => { const description = node.querySelector('.native-skill-description'), origin = node.querySelector('.native-skill-origin'); return { overflow: description.scrollWidth > description.clientWidth, gap: origin.getBoundingClientRect().left - description.getBoundingClientRect().right }; });
  assert.equal(descriptionLayout.overflow, true); assert.ok(descriptionLayout.gap >= 23.5); mark('truncated descriptions retain complete native hover text and at least 24px separation from origin labels');
  await page.getByRole('button', { name: '批量管理 Claude Code 接入', exact: true }).click(); await dialog.waitFor(); await shot('batch-dark-narrow.png'); const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 860 && bounds.y + bounds.height <= 640); await page.keyboard.press('Escape');
  await call('theme/set', { theme: 'light' }); await shot('skills-light-narrow.png'); mark('light/dark and 860x640 layouts keep logos after the origin and before the switch, with compact dialogs and no overflow');
  await row('写作检查').locator('[data-runtime=codex]').click(); await wait(async () => await row('写作检查').locator('[data-runtime=codex]').getAttribute('aria-pressed') === 'true', 'reverse link'); assert.equal(await realpath(path.join(home, '.agents', 'skills', 'claude-fixture')), await realpath(claudeSource));
  await page.getByRole('button', { name: '返回工作台', exact: true }).click(); await call('plugins/set-enabled', { id: 'translation', enabled: false });
  const connection = await call('model-api/save', { connection: { name: '隔离技能链接验收', baseUrl: `http://127.0.0.1:${server.address().port}`, protocol: 'chat-completions', models: [{ id: 'fixture', model: 'fixture-model', name: 'Synthetic fixture', enabled: true }] }, key: 'synthetic-fixture-key' });
  for (const [runtime, query, title, sentinel] of [['claude', '/drawing', '角色绘图检查', 'LINKED_SKILL_drawing-review'], ['codex', '$claude-fixture', '写作检查', 'LINKED_SKILL_CODEX_REVERSE']]) {
    const target = (await call('model-targets/list')).find(t => t.binding.runtime === runtime && t.binding.modelConnectionId === connection.id); assert.ok(target);
    const chat = await call('session/create', { modelTargetId: target.id, projectId: null, permissionMode: 'full-access' }); await page.getByTestId('sidebar-session-' + chat.id).locator('.session-select').click();
    const input = page.getByTestId('composer-input'); await input.fill(query); await page.getByTestId('composer-menu').getByRole('option', { name: new RegExp(title) }).click(); await input.fill('Read the selected fixture.'); await page.getByTestId('prepare-draft').click();
    await wait(async () => (await call('state/get')).sessions.find(s => s.id === chat.id).nativeTurnStatus === 'completed', runtime + ' linked skill completion'); assert.ok(requests.some(b => JSON.stringify(b.messages).includes(sentinel)), runtime + ' native runtime expands the linked skill body');
  }
  assert.ok(requests.every(b => !JSON.stringify(b.messages).includes('"title":"Native skills"'))); mark('both actual native CLIs load skills through new links using only a synthetic loopback model, without a supplemental catalog');
  await openWorkbenchSettings(page, 'skills'); await row('角色绘图检查').locator('[data-runtime=claude]').click(); await wait(async () => await row('角色绘图检查').locator('[data-runtime=claude]').getAttribute('aria-pressed') === 'false', 'row removal'); await assert.rejects(lstat(entry), { code: 'ENOENT' }); assert.ok((await lstat(path.join(home, '.codex', 'skills', 'drawing-review'))).isSymbolicLink());
  assert.match(await readFile(path.join(home, '.claude', 'skills', 'collision', 'SKILL.md'), 'utf8'), /PRESERVE_EXTERNAL_FILE/); mark('row removal preserves source and external directory ownership');
  await app.close(); app = undefined; app = await electron.launch({ executablePath: electronPath, args: [appRoot], cwd: root, env, timeout: 45000 }); page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message)); await page.waitForFunction(() => !!window.workbench); await openWorkbenchSettings(page, 'skills');
  assert.equal(await row('模型与形态键检查').locator('[data-runtime=claude]').getAttribute('aria-pressed'), 'true'); assert.match(await row('模型与形态键检查').locator('[data-runtime=claude]').getAttribute('title'), /撤销工作台链接/); mark('restart rereads persisted ownership and actual native filesystem state');
  const externalEntry = path.join(home, '.claude', 'skills', 'mesh-review'); await unlink(externalEntry); await symlink(path.join(home, 'cc-switch-fixture', 'mesh-review'), externalEntry, process.platform === 'win32' ? 'junction' : 'dir'); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await wait(async () => await row('模型与形态键检查').locator('[data-runtime=claude]').getAttribute('aria-disabled') === 'true', 'external replacement refresh'); assert.match(await row('模型与形态键检查').locator('[data-runtime=claude]').getAttribute('title'), /外部管理/); mark('focus refresh detects externally replaced links and immediately removes workbench deletion authority');
  await page.getByRole('button', { name: '批量管理 Codex 接入', exact: true }).click(); await page.getByRole('button', { name: '撤销工作台链接', exact: true }).click(); dialog = page.getByRole('dialog', { name: '撤销 Codex', exact: true }); await dialog.waitFor(); await dialog.getByRole('button', { name: '撤销 1 项', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await assert.rejects(lstat(path.join(home, '.agents', 'skills', 'claude-fixture')), { code: 'ENOENT' }); assert.ok((await lstat(claudeSource)).isDirectory()); assert.ok((await lstat(path.join(home, '.codex', 'skills', 'drawing-review'))).isSymbolicLink()); mark('bulk disconnect removes only owned links and preserves external native entries');
  assert.deepEqual(errors, []); mark('no renderer or synthetic upstream exceptions');
} catch (error) { if (app) { await shot('failure.png').catch(() => {}); console.error((await page.locator('body').innerText()).slice(-5500)); } throw error; }
finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await put(path.join(output, 'report.json'), JSON.stringify({ checks, errors, requestCount: requests.length, nativeExecutables: { codex: process.env.AWB_QA_CODEX, claude: process.env.AWB_QA_CLAUDE }, scope: 'Hidden isolated Electron, temporary native homes, synthetic loopback upstream only. No real credentials, production client, model or SSH access.' }, null, 2)); }
