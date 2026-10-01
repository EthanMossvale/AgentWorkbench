import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, writeFile, readFile, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { openWorkbenchSettings } from './ui-control-helpers.mjs';

const root = process.cwd(), output = path.join(root, 'build/qa/local-cli-ui'), appRoot = path.join(root, 'build/qa/native-resources/app');
const data = path.join(output, 'data-' + Date.now()), home = path.join(data, 'native-home'), links = { codex: path.join(data, 'codex-runtime'), claude: path.join(data, 'claude-runtime') };
const originals = {
  codex: process.env.AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE ?? path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
  claude: process.env.AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE ?? path.join(os.homedir(), '.local/bin/claude.exe'),
};
await mkdir(home, { recursive: true });
const put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: data, AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE: path.join(links.codex, 'codex.exe'), AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE: path.join(links.claude, 'claude.exe') }; delete env.ELECTRON_RUN_AS_NODE;
const checks = [], errors = []; let app, page;
const record = name => { checks.push(name); console.log('PASS ' + name); };
const call = (method, payload = {}) => page.evaluate(({ method, payload }) => window.workbench.call(method, payload), { method, payload });
const focus = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const runtimeOptions = async () => { await page.getByTestId('composer-runtime').click(); const values = await page.locator('[role=menuitemradio][data-value]').evaluateAll(items => items.map(item => item.dataset.value)); await page.keyboard.press('Escape'); return values; };
const install = runtime => symlink(path.dirname(originals[runtime]), links[runtime], 'junction');
try {
  app = await electron.launch({ executablePath: electronPath, args: [appRoot], cwd: root, env, timeout: 45000 }); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => !!window.workbench);
  await openWorkbenchSettings(page, 'memory'); await page.getByTestId('memory-empty').waitFor(); assert.equal(await page.locator('[data-testid=native-memory-settings] input[type=checkbox]').count(), 0); assert.equal(await page.getByRole('button', { name: '查看与管理记忆', exact: true }).count(), 0);
  await page.getByRole('button', { name: '管理运行时 CLI', exact: true }).click(); await page.getByTestId('runtime-cli-settings').waitFor(); await page.getByTestId('cli-codex').getByText('未安装', { exact: true }).waitFor(); assert.equal(await page.getByTestId('cli-claude').getByText('未安装', { exact: true }).count(), 1);
  await page.screenshot({ path: path.join(output, 'cli-missing-dark.png') }); await page.getByTestId('nav-workspace').click(); assert.deepEqual(await runtimeOptions(), ['demo']); record('zero CLI state hides native memory and synchronization controls while the workbench and CLI management remain usable');
  await install('claude'); await focus(); await page.waitForFunction(async () => (await window.workbench.call('local-cli/list', {}))[1].installed);
  await openWorkbenchSettings(page, 'memory'); await page.getByTestId('memory-control-claude').waitFor(); assert.equal(await page.getByTestId('memory-control-codex').count(), 0); assert.equal(await page.getByLabel('Codex与Claude Code自动同步', { exact: true }).count(), 0); await page.screenshot({ path: path.join(output, 'memory-one-dark.png') });
  await page.getByTestId('nav-workspace').click(); await focus(); await page.getByTestId('composer-input').fill('Keep this unfinished draft.'); assert.deepEqual(await runtimeOptions(), ['claude', 'demo']); await page.getByTestId('composer-runtime').click(); await page.locator('[role=menuitemradio][data-value=claude]').click();
  await unlink(links.claude); await focus(); await page.waitForFunction(() => document.querySelector('[data-testid=composer-runtime]')?.textContent.includes('离线示例')); assert.equal(await page.getByTestId('composer-input').inputValue(), 'Keep this unfinished draft.'); record('one installed runtime shows its native memory only; external removal updates the selector and retains the draft');
  await install('claude'); await install('codex'); await put(path.join(home, '.codex/memories/MEMORY.md'), 'A retained native memory.'); await focus(); await openWorkbenchSettings(page, 'memory'); await page.getByTestId('memory-control-codex').waitFor(); await page.getByLabel('Codex与Claude Code自动同步', { exact: true }).check(); await page.getByRole('button', { name: '上传现有记忆', exact: true }).click(); await page.getByTestId('memory-initial-import').waitFor({ state: 'detached' });
  const before = await call('native-memory/get'); assert.equal(before.pendingClaude, 1); await page.getByLabel('Codex 原生记忆', { exact: true }).check(); await page.waitForFunction(() => !document.querySelector('[data-testid=memory-control-codex] fieldset').disabled);
  await page.screenshot({ path: path.join(output, 'memory-both-dark.png') });
  await put(path.join(home, '.claude/settings.json'), '{"autoMemoryEnabled":false,"sentinel":1}'); await focus(); await page.waitForFunction(() => !document.querySelector('[data-testid=memory-control-claude] input').checked); await page.getByLabel('Claude Code 原生记忆', { exact: true }).check(); await page.waitForFunction(() => !document.querySelector('[data-testid=memory-control-claude] fieldset').disabled); assert.equal(JSON.parse(await readFile(path.join(home, '.claude/settings.json'), 'utf8')).sentinel, 1); record('both installed runtimes show synchronization and native switches reflect external settings changes');
  await unlink(links.claude); await focus(); await page.getByTestId('memory-sync-paused').waitFor(); assert.equal(await page.getByLabel('Codex与Claude Code自动同步', { exact: true }).count(), 0); const paused = await call('native-memory/get'); assert.equal(paused.enabled, true); assert.equal(paused.pendingClaude, 1); assert.equal(paused.paused, true);
  await page.screenshot({ path: path.join(output, 'memory-paused-dark.png') }); await unlink(links.codex); await focus(); await page.getByTestId('memory-empty').waitFor(); assert.equal(await page.getByRole('button', { name: '查看与管理记忆', exact: true }).count(), 1); await page.getByRole('button', { name: '查看与管理记忆', exact: true }).click(); await page.getByTestId('native-memory-list').getByText('A retained native memory.', { exact: true }).waitFor(); await page.keyboard.press('Escape'); record('uninstalling keeps queues, preferences and native memory management accessible');
  await install('codex'); await install('claude'); await focus(); await page.getByTestId('memory-control-codex').waitFor(); assert.equal(await page.getByLabel('Codex与Claude Code自动同步', { exact: true }).isChecked(), true); assert.equal((await call('native-memory/get')).pendingClaude, 1);
  await call('theme/set', { theme: 'light' }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640)); await page.waitForFunction(() => innerWidth === 860); await page.screenshot({ path: path.join(output, 'memory-both-light-narrow.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByTestId('settings-runtimes').click(); await page.getByTestId('cli-codex').waitFor(); const actualCli = (await call('local-cli/list')).find(item => item.runtime === 'codex'); assert.ok((await page.getByTestId('cli-codex').innerText()).includes(actualCli.version)); await page.getByLabel('自动更新 Codex', { exact: true }).waitFor(); await page.screenshot({ path: path.join(output, 'cli-installed-light-narrow.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); record('reinstallation resumes the saved synchronization choice and both CLI/memory pages fit the narrow light layout');
  assert.deepEqual(errors, []); record('no renderer exceptions'); await put(path.join(output, 'report.json'), JSON.stringify({ checks, errors, appRoot, data }, null, 2));
} catch (error) { if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-4000)); } throw error; }
finally { if (app) await app.close(); for (const link of Object.values(links)) await unlink(link).catch(() => {}); }
