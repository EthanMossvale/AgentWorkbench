// Hidden Electron interaction tests. All installer/plugin mutations below are
// intercepted fixtures; real native command acceptance lives in separate tests.
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openWorkbenchSettings } from './ui-control-helpers.mjs';

const root = process.cwd(), output = path.resolve(process.env.AGENT_WORKBENCH_RUNTIME_QA_OUTPUT ?? path.join(root, 'build/qa/runtime-management-ui'));
const data = path.join(output, 'data-' + Date.now()), env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: data, AGENT_WORKBENCH_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE; delete env.AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE;
await mkdir(output, { recursive: true }); const checks = [], errors = []; let app, page;
const record = name => { checks.push(name); console.log('PASS ' + name); };
try {
  app = await electron.launch({ executablePath: electronPath, args: [process.env.AGENT_WORKBENCH_TEST_APP ?? path.join(root, 'build/qa/native-resources/app')], cwd: root, env, timeout: 45000 }); page = await app.firstWindow(); await page.waitForFunction(() => !!window.workbench); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('workbench:call'); if (typeof original !== 'function') throw Error('IPC fixture handler unavailable');
    const cli = ['codex', 'claude'].map(runtime => ({ runtime, installed: true, version: '1.0.0', latest: '1.0.1', channel: 'latest', updateAvailable: true, autoUpdate: true, busy: false, canInstall: false, canUpdate: true, canUninstall: true, revision: runtime + '-revision', executable: 'D:\\Fixture\\' + runtime + '.exe', source: runtime === 'codex' ? 'npm' : 'native', installMethods: [{ method: 'native', available: true, command: `irm https://${runtime === 'codex' ? 'chatgpt.com/codex' : 'claude.ai'}/install.ps1 | iex` }, { method: 'npm', available: true, command: `npm install -g ${runtime === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code'}@latest` }] }));
    const plugins = [
      { id: 'codex-installed', runtime: 'codex', nativeId: 'computer-use@fixture', name: '电脑控制', marketplace: 'fixture', installed: true, enabled: false, scope: 'user', revision: 'fixture', canToggle: true, canInstall: false, detail: '启用会影响所属插件的技能与工具，新会话生效。' },
      { id: 'claude-available', runtime: 'claude', nativeId: 'pdf@fixture', name: 'PDF 示例插件', description: '用于界面验收的可安装插件', marketplace: 'fixture', installed: false, enabled: false, scope: 'user', revision: 'fixture', canToggle: false, canInstall: true, detail: '使用 Claude Code 原生安装命令。' },
    ];
    const state = globalThis.__runtimeQa = { cli, plugins, calls: [], releases: [] };
    ipcMain.removeHandler('workbench:call'); ipcMain.handle('workbench:call', async (event, method, payload) => {
      if (method.startsWith('local-cli/')) {
        if (method !== 'local-cli/list') state.calls.push({ method, ...payload });
        const selected = cli.find(item => item.runtime === payload?.runtime);
        if (method === 'local-cli/install' || method === 'local-cli/check') await new Promise(resolve => state.releases.push(resolve));
        if (method === 'local-cli/install') { selected.version = '1.0.1'; selected.updateAvailable = false; selected.installed = true; selected.canInstall = false; if (!payload.update) selected.source = payload.installMethod; }
        if (method === 'local-cli/uninstall') { selected.installed = false; selected.canInstall = true; }
        if (method === 'local-cli/configure') selected.autoUpdate = payload.enabled;
        return { ok: true, value: structuredClone(cli) };
      }
      if (method === 'native-plugins/list') return { ok: true, value: { plugins, errors: [] } };
      if (method === 'native-plugins/change') {
        state.calls.push({ method, ...payload }); const plugin = plugins.find(item => item.id === payload.id);
        if (payload.action === 'install') { plugin.installed = true; plugin.canInstall = false; plugin.canToggle = true; plugin.enabled = true; } else plugin.enabled = payload.action === 'enable';
        return { ok: true, value: { plugins, errors: [] } };
      }
      return original(event, method, payload);
    });
  });
  await openWorkbenchSettings(page, 'runtimes'); const codex = page.getByTestId('cli-codex'), claude = page.getByTestId('cli-claude'); await codex.getByText('已安装 · 1.0.0', { exact: true }).waitFor();
  await codex.getByRole('button', { name: '更新', exact: true }).click(); await codex.getByText('正在处理…', { exact: true }).waitFor(); assert.equal(await claude.getByRole('button', { name: '更新', exact: true }).isEnabled(), true);
  await claude.getByRole('button', { name: '更新', exact: true }).click(); await claude.getByText('正在处理…', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.__runtimeQa.calls.filter(call => call.method === 'local-cli/install').length), 2);
  await app.evaluate(() => { for (const release of globalThis.__runtimeQa.releases.splice(0)) release(); }); await codex.getByText('已安装 · 1.0.1', { exact: true }).waitFor(); await claude.getByText('已安装 · 1.0.1', { exact: true }).waitFor(); record('two CLI update cards remain independently actionable and both completions render');
  await codex.getByRole('button', { name: '检查更新', exact: true }).click(); await codex.getByText('正在处理…', { exact: true }).waitFor(); await page.getByLabel('自动更新 Codex', { exact: true }).uncheck();
  assert.equal(await app.evaluate(() => globalThis.__runtimeQa.cli[0].autoUpdate), false); await app.evaluate(() => { for (const release of globalThis.__runtimeQa.releases.splice(0)) release(); }); await codex.getByText('正在处理…', { exact: true }).waitFor({ state: 'detached' }); record('automatic update can be disabled while a version check is in flight');
  await page.getByRole('button', { name: '卸载 Claude Code', exact: true }).click(); await page.getByRole('dialog').waitFor(); assert.match(await page.getByRole('dialog').innerText(), /记忆.*保留/); await page.screenshot({ path: path.join(output, 'cli-uninstall-confirm.png') });
  await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await app.evaluate(() => globalThis.__runtimeQa.calls.filter(call => call.method === 'local-cli/uninstall').length), 0);
  await page.getByRole('button', { name: '卸载 Claude Code', exact: true }).click(); await page.getByRole('button', { name: '确认卸载', exact: true }).click(); await claude.getByText('未安装', { exact: true }).waitFor(); record('CLI uninstall requires a second confirmation; cancel sends no destructive request');
  assert.equal(await claude.getByRole('radio', { name: /原生安装/ }).isChecked(), true);
  await app.evaluate(() => { const item = globalThis.__runtimeQa.cli[0]; item.installed = false; item.canInstall = true; }); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await codex.getByRole('radiogroup', { name: 'Codex 安装方式', exact: true }).waitFor(); assert.equal(await codex.getByRole('radio', { name: /原生安装/ }).isChecked(), true);
  const countBeforeChoice = await app.evaluate(() => globalThis.__runtimeQa.calls.length); await codex.getByText('npm', { exact: true }).click(); assert.equal(await app.evaluate(() => globalThis.__runtimeQa.calls.length), countBeforeChoice);
  assert.equal(await codex.locator('select').count(),0);assert.equal(await codex.locator('code').isVisible(),false);await codex.locator('summary').click();assert.match(await codex.locator('code').innerText(), /npm install -g @openai\/codex@latest/);await codex.locator('summary').click();
  assert.equal(await page.locator('.runtime-cli-settings .settings-card').count(),0);
  await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await page.screenshot({path:path.join(output,'cli-flat-dark.png')});
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640)); await page.waitForFunction(() => innerWidth === 860); await page.screenshot({ path: path.join(output, 'cli-install-methods-narrow.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);await page.evaluate(()=>window.workbench.call('theme/set',{theme:'light'}));await page.screenshot({path:path.join(output,'cli-flat-light-narrow.png')}); record('flat runtime rows use native/npm text choices, hide technical details initially and fit both narrow themes without boxed cards');
  await codex.getByRole('button', { name: '安装', exact: true }).click(); await claude.getByRole('button', { name: '安装', exact: true }).click(); await claude.getByText('正在处理…', { exact: true }).waitFor();
  const installs = await app.evaluate(() => globalThis.__runtimeQa.calls.filter(call => call.method === 'local-cli/install' && !call.update)); assert.deepEqual(installs.map(item => [item.runtime, item.installMethod]), [['codex', 'npm'], ['claude', 'native']]);
  await app.evaluate(() => { for (const release of globalThis.__runtimeQa.releases.splice(0)) release(); });await codex.getByText('已安装 · 1.0.1',{exact:true}).waitFor();await claude.getByText('已安装 · 1.0.1',{exact:true}).waitFor();await page.screenshot({path:path.join(output,'cli-flat-installed-light.png')});await codex.locator('summary').click();await claude.locator('summary').click(); await codex.getByText('安装方式：npm', { exact: true }).waitFor(); await claude.getByText('安装方式：原生安装', { exact: true }).waitFor(); record('explicit npm and default native installations send separate method values and show their verified channel');
  await codex.locator('summary').click();await claude.locator('summary').click();await app.evaluate(()=>{const item=globalThis.__runtimeQa.cli[0];item.installed=false;item.canInstall=true;delete item.latest;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await codex.getByRole('radiogroup').waitFor();await codex.getByRole('radiogroup').locator('label').first().click();await page.evaluate(()=>window.workbench.call('theme/set',{theme:'dark'}));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,940));await page.waitForFunction(()=>innerWidth===1440);await page.locator('.toast').waitFor({state:'detached'});await page.screenshot({path:path.join(output,'cli-flat-mixed-dark.png')});
  const rowStyle=await codex.evaluate(e=>({border:getComputedStyle(e).borderTopWidth,radius:getComputedStyle(e).borderRadius,font:getComputedStyle(e).fontFamily}));assert.equal(rowStyle.border,'0px');assert.equal(rowStyle.radius,'0px');assert.match(rowStyle.font,/Serif|SimSun/);record('mixed installed and missing runtime rows retain the established reading type and flat outline-free layout');
  await page.getByTestId('settings-plugins').click(); await page.getByRole('tab', { name: '运行时插件', exact: true }).click(); await page.getByLabel('启用原生插件 电脑控制', { exact: true }).waitFor(); await page.getByLabel('启用原生插件 电脑控制', { exact: true }).click(); await page.getByRole('dialog').waitFor(); assert.match(await page.getByRole('dialog').innerText(), /技能与工具/); await page.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await page.getByLabel('启用原生插件 电脑控制', { exact: true }).isChecked(), false);
  await page.getByLabel('启用原生插件 电脑控制', { exact: true }).click(); await page.getByRole('button', { name: '确认启用', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-testid=native-plugin-codex-installed] input').checked); record('native plugin group switches explain scope and require confirmation');
  await page.getByRole('tab', { name: /可安装/ }).click(); await page.getByTestId('native-plugin-claude-available').waitFor(); assert.match(await page.getByTestId('native-plugin-claude-available').innerText(), /Claude Code/);
  await page.getByTestId('native-plugin-claude-available').getByRole('button', { name: '安装', exact: true }).click(); await page.getByRole('button', { name: '确认安装', exact: true }).click(); await page.getByLabel('启用原生插件 PDF 示例插件', { exact: true }).waitFor(); record('available plugins show their host runtime and move to installed after verified completion');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640)); await page.waitForFunction(() => innerWidth === 860); await page.screenshot({ path: path.join(output, 'native-plugins-narrow.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []); record('narrow plugin layout fits without horizontal overflow or renderer errors');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, scope: 'Hidden renderer interaction with intercepted maintenance/install IPC; no real CLI or plugin installation.' }, null, 2));
} catch (error) { if (app) console.error(await app.evaluate(() => ({ calls: globalThis.__runtimeQa?.calls, cli: globalThis.__runtimeQa?.cli }))); if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
finally { if (app) await app.close(); }
