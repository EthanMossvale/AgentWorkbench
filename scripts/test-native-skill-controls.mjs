// Offline native acceptance. No login, model turn, real profile, or user Skill writes.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { NativeSkillsService } from '../packages/native-skills/index.ts';
import { codexConfiguration } from '../packages/native-runtime/process.ts';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativePluginsService } from '../packages/native-plugins/index.ts';

const exec = promisify(execFile), root = process.cwd(), base = await mkdtemp(path.join(os.tmpdir(), 'awb-native-skill-acceptance-'));
const home = path.join(base, 'home'), codexHome = path.join(home, '.codex'), claudeHome = path.join(home, '.claude');
const codex = process.env.AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE || path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'), claude = process.env.AWB_QA_CLAUDE || path.join(os.homedir(), '.local/bin/claude.exe');
const checks = [], put = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
const json = (file, value) => put(file, JSON.stringify(value));
const mark = text => { checks.push(text); console.log('PASS ' + text); };
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT'].includes(key.toUpperCase())));
Object.assign(env, { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), TEMP: base, TMP: base, OTEL_SDK_DISABLED: 'true', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
async function protocol(executable, args, requests, isClaude = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: base, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let index = 0, buffer = '', done = false; const values = [];
    const timer = setTimeout(() => finish(Error('Native metadata request timed out.')), 15000);
    function finish(error) { if (done) return; done = true; clearTimeout(timer); child.once('close', () => error ? reject(error) : resolve(values)); child.kill(); }
    const send = () => child.stdin.write(JSON.stringify(requests[index]) + '\n');
    child.on('error', reject); child.on('exit', () => { if (!done) { clearTimeout(timer); reject(Error('Native metadata process exited early.')); } }); child.stdout.setEncoding('utf8');
    child.stdout.on('data', text => { buffer += text; while (buffer.includes('\n')) { const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (done || !line.trim()) continue; const message = JSON.parse(line);
      if (isClaude ? message.type !== 'control_response' : message.id !== requests[index].id) continue;
      if (message.error || message.response?.subtype === 'error') return finish(Error(JSON.stringify(message)));
      values.push(isClaude ? message.response.response : message.result); if (++index === requests.length) return finish(); send();
    } }); send();
  });
}
const codexCall = async (method, params) => codexConfiguration(codex, env, base, rpc => rpc(method, params));
const codexList = async () => (await codexCall('skills/list', { cwds: [base], forceReload: true })).data[0].skills;
const claudeCommands = async () => (await protocol(claude, ['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--no-session-persistence'], [{ type: 'control_request', request_id: 'metadata', request: { subtype: 'initialize' } }], true))[0].commands;
const markdown = name => `---\nname: ${name}\ndescription: Offline acceptance fixture.\n---\nReturn the fixture.\n`;
let failure, versions;
try {
  await mkdir(codexHome, { recursive: true }); await mkdir(claudeHome, { recursive: true });
  const cli = new LocalCliService(path.join(base, 'data'), { home, env, isolated: true, executables: { codex, claude } });
  const plugins = new NativePluginsService(cli, { fetcher: async () => new Response(JSON.stringify({ name: 'claude-plugins-official', plugins: [] })) });
  versions = { codex: (await exec(codex, ['--version'], { env, cwd: base, windowsHide: true })).stdout.trim(), claude: (await exec(claude, ['--version'], { env, cwd: base, windowsHide: true })).stdout.trim() }; assert.match(versions.claude, /^\d+\.\d+\.\d+ \(Claude Code\)/);
  assert.equal((await codexCall('account/read', { refreshToken: false })).account, null);
  await codexList(); // Let the pinned runtime materialize its own built-in files in this fixture.
  const service = new NativeSkillsService(path.join(base, 'data'), { home, codexHome, claudeHome, codexExecutable: codex, claudeExecutable: claude }); await service.initialize();
  let catalog = await service.scan(); const official = catalog.skills.find(s => s.name === 'imagegen' && s.origins[0].provider === 'codex'); assert.ok(official);
  await service.setEnabled(official.id, false); assert.equal((await codexList()).find(s => s.name === 'imagegen').enabled, false);
  assert.match(await readFile(path.join(codexHome, 'config.toml'), 'utf8'), /\[\[skills.config\]\]/); mark('Codex state is persisted through native skills/config/write');
  await service.setEnabled(official.id, true); assert.equal((await codexList()).find(s => s.name === 'imagegen').enabled, true);
  mark('Codex official Skill disable and re-enable confirmed by fresh native skills/list');
  const codexMarket = path.join(home, '.agents/plugins/marketplace.json'), codexPlugin = path.join(home, 'plugins/fixture-plugin');
  await json(path.join(codexPlugin, '.codex-plugin/plugin.json'), { name: 'fixture-plugin', version: '1.0.0', skills: './skills/' });
  await put(path.join(codexPlugin, 'skills/plugin-fixture/SKILL.md'), markdown('plugin-fixture'));
  await json(codexMarket, { name: 'fixture-local', interface: { displayName: 'Offline fixture' }, plugins: [{ name: 'fixture-plugin', source: { source: 'local', path: './plugins/fixture-plugin' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] });
  const availableCodex = (await plugins.scan()).plugins.find(p => p.nativeId === 'fixture-plugin@fixture-local'); assert.ok(availableCodex?.canInstall); await plugins.change('codex', availableCodex.id, availableCodex.revision, 'install');
  mark('Codex available plugin installs through the real native API into the disposable user profile');
  const pluginSkills = await codexList(), nativePlugin = pluginSkills.find(s => /(?:^|:)plugin-fixture$/.test(s.name)); assert.ok(nativePlugin, JSON.stringify(pluginSkills.map(s => ({ name: s.name, pluginId: s.pluginId }))));
  catalog = await service.scan(); const codexPluginSkill = catalog.skills.find(s => s.name === 'plugin-fixture'); assert.ok(codexPluginSkill);
  await service.setEnabled(codexPluginSkill.id, false); assert.equal((await codexList()).find(s => s.name === nativePlugin.name).enabled, false);
  await service.setEnabled(codexPluginSkill.id, true); assert.equal((await codexList()).find(s => s.name === nativePlugin.name).enabled, true);
  mark('Codex installed plugin Skill also respects native per-Skill disable and re-enable');
  let config = await readFile(path.join(codexHome, 'config.toml'), 'utf8');
  config = config.replace(/(\[plugins\.[^\n]+\]\s*\nenabled\s*=\s*)true/, '$1false');
  await put(path.join(codexHome, 'config.toml'), config + '\n[plugins."sentinel@fixture-local"]\nenabled = false\n');
  catalog = await service.scan(); const disabledParent = catalog.skills.find(s => s.id === codexPluginSkill.id); assert.equal(disabledParent.enabled, false); assert.equal(disabledParent.control.canToggle, true); assert.equal(disabledParent.control.enableParent, true);
  await assert.rejects(service.setEnabled(disabledParent.id, true), /explicit confirmation/);
  await service.setEnabled(disabledParent.id, true, true); assert.equal((await codexList()).find(s => s.name === nativePlugin.name).enabled, true);
  assert.match(await readFile(path.join(codexHome, 'config.toml'), 'utf8'), /\[plugins\."sentinel@fixture-local"\]\s+enabled = false/);
  mark('Codex disabled parent can be enabled after confirmation, preserving unrelated native plugin settings');
  const builtin = catalog.skills.find(s => s.builtin && s.name === 'debug'); assert.ok(builtin); assert.equal(catalog.skills.some(s => s.builtin && ['help', 'compact'].includes(s.name)), false);
  mark(`Claude runtime automatically exposes ${catalog.skills.filter(s => s.builtin).length} bundled Skills, excluding fixed commands`);
  await service.setEnabled(builtin.id, false); assert.equal((await claudeCommands()).some(s => s.name === 'debug'), false);
  const denied = await exec(claude, ['--print', '--no-session-persistence', '/debug'], { env, cwd: base, windowsHide: true, timeout: 8000 }); assert.match(denied.stdout, /disabled via skillOverrides/);
  await service.setEnabled(builtin.id, true); assert.ok((await claudeCommands()).some(s => s.name === 'debug'));
  mark('Claude bundled Skill is absent from native discovery, direct invocation is rejected, and re-enable restores it');
  await assert.rejects(service.exportZip(builtin.id, builtin.hash, path.join(base, 'invalid.zip')), /no exportable/); mark('Bundled Skills do not pretend to provide exportable SKILL.md files');
  await put(path.join(claudeHome, 'skills', 'personal-fixture', 'SKILL.md'), markdown('frontmatter-alias')); catalog = await service.scan(); const personal = catalog.skills.find(s => s.name === 'frontmatter-alias');
  assert.ok((await claudeCommands()).some(s => s.name === 'frontmatter-alias')); await service.setEnabled(personal.id, false); assert.equal((await claudeCommands()).some(s => s.name === 'frontmatter-alias'), false);
  const aliasDenied = await exec(claude, ['--print', '--no-session-persistence', '/frontmatter-alias'], { env, cwd: base, windowsHide: true, timeout: 8000 }); assert.match(aliasDenied.stdout, /disabled via skillOverrides/);
  mark('Claude personal Skill uses native directory identity; frontmatter alias invocation is also rejected');
  const pluginRoot = path.join(claudeHome, 'plugins/cache/anthropic-agent-skills/document-skills/1.0.0'), market = path.join(claudeHome, 'plugins/marketplaces/anthropic-agent-skills');
  await put(path.join(pluginRoot, 'skills', 'fixture-pdf', 'SKILL.md'), markdown('fixture-pdf'));
  await json(path.join(market, '.claude-plugin/marketplace.json'), { name: 'anthropic-agent-skills', owner: { name: 'Offline fixture' }, plugins: [{ name: 'document-skills', source: './', strict: false, skills: ['./skills/fixture-pdf'] }] });
  await json(path.join(claudeHome, 'plugins/installed_plugins.json'), { version: 2, plugins: { 'document-skills@anthropic-agent-skills': [{ scope: 'user', installPath: pluginRoot, version: '1.0.0', installedAt: '2026-09-26T00:00:00Z', lastUpdated: '2026-09-26T00:00:00Z' }] } });
  await json(path.join(claudeHome, 'plugins/known_marketplaces.json'), { 'anthropic-agent-skills': { source: { source: 'github', repo: 'anthropics/skills' }, installLocation: market, lastUpdated: new Date().toISOString() } });
  const settings = JSON.parse(await readFile(path.join(claudeHome, 'settings.json'), 'utf8')); settings.enabledPlugins = { 'document-skills@anthropic-agent-skills': true }; await json(path.join(claudeHome, 'settings.json'), settings);
  catalog = await service.scan(); const plugin = catalog.skills.find(s => s.name === 'fixture-pdf'); assert.ok(plugin); assert.equal(plugin.origins[0].kind, 'official');
  const pluginCommands = await claudeCommands(); assert.ok(pluginCommands.some(s => s.name === 'document-skills:fixture-pdf'), JSON.stringify(pluginCommands.map(s => s.name)));
  await service.setEnabled(plugin.id, false); assert.equal((await claudeCommands()).some(s => s.name === 'document-skills:fixture-pdf'), false);
  await service.setEnabled(plugin.id, true); assert.ok((await claudeCommands()).some(s => s.name === 'document-skills:fixture-pdf'));
  mark('Claude installed official-plugin fixture is removed and restored through native enabledPlugins');
  let native = await plugins.scan(); assert.deepEqual(native.errors, []);
  const nativeCodex = native.plugins.find(p => p.runtime === 'codex' && p.nativeId === codexPluginSkill.origins[0].pluginId); assert.ok(nativeCodex?.installed, JSON.stringify(native));
  await plugins.change('codex', nativeCodex.id, nativeCodex.revision, 'disable'); assert.equal((await codexList()).some(s => s.name === nativePlugin.name && s.enabled), false);
  native = await plugins.scan(); const off = native.plugins.find(p => p.id === nativeCodex.id); await plugins.change('codex', off.id, off.revision, 'enable'); assert.equal((await codexList()).find(s => s.name === nativePlugin.name).enabled, true);
  const nativeClaude = native.plugins.find(p => p.runtime === 'claude' && p.installed); assert.ok(nativeClaude); await plugins.change('claude', nativeClaude.id, nativeClaude.revision, 'disable'); assert.equal((await claudeCommands()).some(s => s.name === 'document-skills:fixture-pdf'), false);
  mark('Native plugin catalog and group switches are verified against fresh Codex and Claude runtime discovery');
  const installMarket = path.join(base, 'install-market');
  await put(path.join(installMarket, 'plugins/install-fixture/.claude-plugin/plugin.json'), JSON.stringify({ name: 'install-fixture', version: '1.0.0', description: 'Install fixture' }));
  await json(path.join(installMarket, '.claude-plugin/marketplace.json'), { name: 'install-market', owner: { name: 'Offline fixture' }, plugins: [{ name: 'install-fixture', source: './plugins/install-fixture', description: 'Install fixture' }] });
  await exec(claude, ['plugin', 'marketplace', 'add', installMarket], { env, cwd: home, windowsHide: true, timeout: 20000 });
  native = await plugins.scan(); const available = native.plugins.find(p => p.nativeId === 'install-fixture@install-market'); assert.ok(available?.canInstall, JSON.stringify(native)); await plugins.change('claude', available.id, available.revision, 'install');
  assert.equal((await plugins.scan()).plugins.find(p => p.nativeId === available.nativeId)?.installed, true); mark('Claude available plugin installs through the real native CLI into the disposable user profile');
} catch (error) { failure = String(error.stack || error); throw error; }
finally {
  const output = path.join(root, 'build/qa/native-skill-controls-report.json'); await mkdir(path.dirname(output), { recursive: true });
  await json(output, { versions, checks, passed: checks.length, failure, scope: 'Isolated native discovery, local fixture plugin installation and disabled-command rejection only; no model turn or real user settings.' });
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
