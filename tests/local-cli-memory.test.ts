import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { LocalCliService, newerVersion } from '../packages/native-runtime/cli';
import { NativeMemoryControls } from '../packages/native-memory/controls';
import { NativeMemoryService } from '../packages/native-memory';
import { codexConfiguration, runCommand, type Command } from '../packages/native-runtime/process';

const put = async (file: string, value: string) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'awb-cli-memory-')), home = path.join(root, 'home'), data = path.join(root, 'data');
  await mkdir(home); t.after(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }));
  const env = { SYSTEMROOT: process.env.SYSTEMROOT, PATH: '', HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
  return { root, home, data, env, claude: path.join(home, '.local', 'bin', 'claude.exe'), codexNative: path.join(home, 'AppData/Local/Programs/OpenAI/Codex/bin/codex.exe'), codex: path.join(home, 'AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe') };
}
test('CLI discovery reflects zero, one, two and removed installations without creating native directories', async t => {
  const f = await fixture(t), service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', isolated: true, run: async () => '2.1.281' });
  await service.initialize(); t.after(() => service.dispose());
  assert.deepEqual((await service.list()).map(s => s.installed), [false, false]);
  await put(f.claude, 'fixture'); assert.deepEqual((await service.list()).map(s => s.installed), [false, true]);
  await put(f.codex, 'fixture'); const both = await service.list(); assert.deepEqual(both.map(s => s.installed), [true, true]); assert.equal(both[0]!.source, 'npm');
  await service.configure('claude', true); await rm(f.claude); assert.equal((await service.list())[1]!.autoUpdate, true);
  await assert.rejects(access(path.join(f.home, '.claude')));
});
test('official install commands preserve default locations and reject state changes and concurrent installs', async t => {
  const f = await fixture(t), commands: Command[] = []; let release: (() => void) | undefined;
  const service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', isolated: true, run: async command => {
    if (command.args[0] === '--version') return '0.155.1'; commands.push(command);
    await new Promise<void>(resolve => { release = resolve; }); await put(f.codexNative, 'fixture'); return '';
  } }); await service.initialize(); t.after(() => service.dispose());
  const installed = service.install('codex'); while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  try { await assert.rejects(service.install('codex'), /RUNTIME_BUSY/); } finally { release(); } await installed;
  assert.match(commands[0]!.args.at(-1)!, /https:\/\/chatgpt.com\/codex\/install.ps1/); assert.doesNotMatch(JSON.stringify(commands), /--prefix|CODEX_HOME|\.agent-workbench/);
  await assert.rejects(service.install('codex'), /STATE_CHANGED/);
  const claude = (await service.list())[1]!; assert.equal(claude.command, 'irm https://claude.ai/install.ps1 | iex');
});
test('official checks validate responses and native Claude release channel without changing settings', async t => {
  const f = await fixture(t), urls: string[] = []; await put(path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json'), '{"autoUpdatesChannel":"stable","sentinel":42}');
  const service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', isolated: true, fetcher: (async url => { urls.push(String(url)); return new Response(urls.length === 1 ? '2.1.300' : 'not json'); }) as typeof fetch });
  await service.initialize(); t.after(() => service.dispose()); let result = await service.check('claude'); assert.equal(result[1]!.channel, 'stable'); assert.equal(result[1]!.latest, '2.1.300');
  assert.equal(urls[0], 'https://downloads.claude.ai/claude-code-releases/stable'); result = await service.check('codex'); assert.equal(result[0]!.error, 'CLI_UPDATE_CHECK_FAILED');
  assert.equal(JSON.parse(await readFile(path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')).sentinel, 42);
  assert.equal(newerVersion('0.156.0', '0.155.1'), true); assert.equal(newerVersion('2.1.0', '2.1.0-beta'), true); assert.equal(newerVersion('garbage', '2.1.0'), false);
});
test('automatic update is opt-in, idle-only, does not install a missing CLI and stops when disabled during check', async t => {
  const f = await fixture(t); let idle = true, checks = 0, updates = 0, release: (() => void) | undefined;
  const service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', idle: () => idle, run: async command => { if (command.args[0] === 'update') updates++; return '2.1.281'; }, fetcher: (async () => { checks++; if (checks === 2) await new Promise<void>(resolve => { release = resolve; }); return new Response('2.1.300'); }) as typeof fetch });
  await service.initialize(); t.after(() => service.dispose()); const tick = () => (service as any).automatic();
  await tick(); assert.equal(checks, 0); await service.configure('claude', true); idle = false; await tick(); assert.equal(checks, 0); idle = true;
  await tick(); assert.equal(checks, 1); assert.equal(updates, 0);
  await put(f.claude, 'fixture'); (service as any).preferences.lastAttempt.claude = 0; const pending = tick(); while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  await service.configure('claude', false); release(); await pending; assert.equal(updates, 0);
  await service.configure('claude', true); (service as any).preferences.lastAttempt.claude = 0; await tick(); assert.equal(updates, 1); assert.equal((await service.list())[1]!.error, 'CLI_UPDATE_NOT_APPLIED'); await tick(); assert.equal(updates, 1);
});
test('uncertain installer cleanup fences only the affected runtime', async t => {
  const f = await fixture(t), service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', isolated: true, run: async command => { if (command.args.at(-1)?.includes('codex/install.ps1')) throw Error('CLI_PROCESS_STATE_UNKNOWN'); await put(f.claude, 'fixture'); return '2.1.283'; } });
  await service.initialize(); t.after(() => service.dispose()); await assert.rejects(service.install('codex'), /PROCESS_STATE_UNKNOWN/); await assert.rejects(service.install('codex'), /PROCESS_STATE_UNKNOWN/); await service.install('claude'); assert.equal((await service.list())[1]!.installed, true);
});

test('different runtimes install concurrently and preferences remain writable during maintenance', async t => {
  const f = await fixture(t), releases: (() => void)[] = [];
  const service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', isolated: true, run: async command => {
    if (command.args[0] === '--version') return '2.1.283';
    await new Promise<void>(resolve => releases.push(resolve)); await put(command.args.at(-1)!.includes('codex/install.ps1') ? f.codexNative : f.claude, 'fixture'); return '';
  } }); await service.initialize(); t.after(() => service.dispose());
  const first = service.install('codex'), second = service.install('claude');
  try {
    while (releases.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(service.isMaintaining(), true); assert.ok((await service.list()).every(item => item.busy));
    await service.configure('codex', true); await service.configure('claude', true); await service.configure('codex', false);
  } finally { releases.forEach(release => release()); }
  await Promise.all([first, second]); assert.equal(service.isMaintaining(), false);
  const preferences = JSON.parse(await readFile(path.join(f.data, 'local-cli.json'), 'utf8')); assert.deepEqual(preferences.autoUpdate, { codex: false, claude: true });
});

test('uninstall revalidates identity, original package channel and idle state while preserving all user data', async t => {
  const f = await fixture(t), commands: Command[] = []; let idle = true;
  await put(f.codex, 'fixture'); await put(f.claude, 'fixture');
  const retained = [path.join(f.env.CODEX_HOME, 'config.toml'), path.join(f.env.CODEX_HOME, 'memories/MEMORY.md'), path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json'), path.join(f.env.CLAUDE_CONFIG_DIR, 'skills/retained/SKILL.md'), path.join(f.data, 'pending-handoff.json')];
  for (const file of retained) await put(file, 'retained');
  const service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', isolated: true, idle: () => idle, run: async command => {
    if (command.args[0] === '--version') return '2.1.283'; commands.push(command); const script = command.args.at(-1)!;
    if (script.includes('prefix -g')) return path.join(f.home, 'AppData/Roaming/npm');
    await rm(script.includes('uninstall -g') ? f.codex : f.claude); return '';
  } }); await service.initialize(); t.after(() => service.dispose()); await service.configure('codex', true);
  let installed = await service.list(); assert.ok(installed.every(item => item.canUninstall));
  await put(f.codex, 'updated-installation'); await assert.rejects(service.uninstall('codex', installed[0]!.revision), /STATE_CHANGED/); assert.equal(commands.length, 0);
  installed = await service.list(); idle = false; await assert.rejects(service.uninstall('claude', installed[1]!.revision), /TASKS_ACTIVE/); idle = true;
  await service.uninstall('codex', installed[0]!.revision); await service.uninstall('claude', installed[1]!.revision);
  assert.ok((await service.list()).every(item => !item.installed)); assert.equal((await service.list())[0]!.autoUpdate, true);
  for (const file of retained) assert.equal(await readFile(file, 'utf8'), 'retained');
  assert.match(commands[1]!.args.at(-1)!, /uninstall -g '@openai\/codex'/); assert.match(commands[2]!.args.at(-1)!, /Remove-Item -LiteralPath/);
  assert.doesNotMatch(JSON.stringify(commands), /\.claude['"\\/]|\.codex|pending-handoff/);
});

test('uninstall refuses an npm prefix mismatch and unknown PATH installations', async t => {
  const f = await fixture(t); await put(f.codex, 'fixture'); let removals = 0;
  const service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', isolated: true, run: async command => { if (command.args[0] === '--version') return '0.157.1'; if (command.args.at(-1)!.includes('prefix -g')) return path.join(f.home, 'another-prefix'); removals++; return ''; } });
  const item = (await service.list())[0]!; await assert.rejects(service.uninstall('codex', item.revision), /UNINSTALL_UNSUPPORTED/); assert.equal(removals, 0); assert.equal(await readFile(f.codex, 'utf8'), 'fixture');
  const external = path.join(f.home, 'other/claude.exe'); await put(external, 'fixture'); const other = new LocalCliService(f.data, { home: f.home, env: { ...f.env, PATH: path.dirname(external) }, platform: 'win32', run: async () => '2.1.283' });
  const claude = (await other.list())[1]!; assert.equal(claude.canUninstall, false); await assert.rejects(other.uninstall('claude', claude.revision), /UNINSTALL_UNSUPPORTED/);
});

test('automatic updater rechecks idle after the network check before launching an installer', async t => {
  const f = await fixture(t); await put(f.claude, 'fixture'); let idle = true, updates = 0;
  const service = new LocalCliService(f.data, { home: f.home, env: f.env, platform: 'win32', idle: () => idle, run: async command => { if (command.args[0] !== '--version') updates++; return '2.1.283'; }, fetcher: (async () => { idle = false; return new Response('2.1.300'); }) as typeof fetch });
  await service.initialize(); t.after(() => service.dispose()); await service.configure('claude', true); await (service as any).automatic(); assert.equal(updates, 0);
});
test('Claude native switch preserves other settings, rejects stale revisions and reflects external changes', async t => {
  const f = await fixture(t); await put(f.claude, 'fixture'); const file = path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json'); await put(file, '{"autoMemoryDirectory":"custom","sentinel":{"a":1}}');
  const service = new LocalCliService(f.data, { home: f.home, env: f.env, isolated: true }), controls = new NativeMemoryControls(service);
  let state = (await controls.list())[1]!; assert.equal(state.enabled, true); await controls.write('claude', state.revision, 'enabled', false);
  const changed = JSON.parse(await readFile(file, 'utf8')); assert.equal(changed.autoMemoryEnabled, false); assert.deepEqual(changed.sentinel, { a: 1 }); assert.equal(changed.autoMemoryDirectory, 'custom');
  await assert.rejects(controls.write('claude', state.revision, 'enabled', true), /CONFLICT/);
  await put(file, JSON.stringify({ ...changed, autoMemoryEnabled: true })); state = (await controls.list())[1]!; assert.equal(state.enabled, true);
  await put(file, '{broken'); state = (await controls.list())[1]!; assert.equal(state.enabled, null); assert.equal(state.canToggle, false); assert.equal(await controls.canReceive('claude'), false);
});
test('Claude environment, managed and project overrides retain effective native precedence', async t => {
  const f = await fixture(t); await put(f.claude, 'fixture'); const project = path.join(f.home, 'project'); await put(path.join(project, '.claude/settings.local.json'), '{"autoMemoryEnabled":false}');
  const cli = new LocalCliService(f.data, { home: f.home, env: f.env, isolated: true }), controls = new NativeMemoryControls(cli, () => [project]);
  assert.equal((await controls.list())[1]!.warning, 'NATIVE_MEMORY_PROJECT_SETTINGS'); assert.equal(await controls.canReceive('claude'), true); assert.equal(await controls.canReceive('claude', project), false);
  cli.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'; const state = (await controls.list())[1]!; assert.equal(state.enabled, false); assert.equal(state.canToggle, false); await assert.rejects(controls.write('claude', state.revision, 'enabled', true), /OVERRIDDEN/);
  delete cli.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  const programFiles = path.join(f.home, 'program-files'); await put(path.join(programFiles, 'ClaudeCode/managed-settings.json'), '{"autoMemoryEnabled":false}');
  const managed = new NativeMemoryControls(new LocalCliService(f.data, { home: f.home, env: { ...f.env, ProgramFiles: programFiles }, platform: 'win32' }));
  assert.equal((await managed.list())[1]!.source, 'managed'); assert.equal((await managed.list())[1]!.canToggle, false);
});
test('missing runtime pauses capture and receipt delivery without clearing preferences or pending archives', async t => {
  const f = await fixture(t); let installed = true, enabled = true;
  const service = new NativeMemoryService(f.data, { home: f.home, codexHome: f.env.CODEX_HOME, claudeHome: f.env.CLAUDE_CONFIG_DIR, intervalMs: 999999, canSync: async () => installed, canReceive: async () => enabled });
  await service.initialize(); t.after(() => service.dispose()); await put(path.join(f.env.CODEX_HOME, 'memories/MEMORY.md'), 'An English memory.'); await service.configure({ enabled: true, initialSources: 'codex' });
  const before = await service.status(); assert.equal(before.pendingClaude, 1); installed = false; await put(path.join(f.env.CODEX_HOME, 'memories/topic.md'), 'Another English memory.'); await service.sync();
  const session = service.session('claude', 'fixture'); assert.equal(await session.prepare('Task', 'first'), 'Task'); assert.equal((await service.status()).pendingClaude, 1); assert.equal((await service.status()).enabled, true); assert.equal((await service.status()).paused, true);
  installed = true; enabled = false; await service.sync(); assert.equal((await service.status()).pendingClaude, 2); assert.equal(await session.prepare('Task', 'second'), 'Task');
  enabled = true; assert.notEqual(await session.prepare('Task', 'third'), 'Task'); assert.equal((await service.status()).acknowledgedCount, 0);
});
test('bounded command timeout terminates the process tree before returning', async t => {
  const f = await fixture(t); const pidFile = path.join(f.home, 'child.pid');
  const script = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`;
  await assert.rejects(runCommand({ executable: process.execPath, args: ['-e', script] }, { cwd: f.home, env: process.env, timeout: 700 }), /TIMED_OUT/);
  const pid = Number(await readFile(pidFile, 'utf8')); assert.throws(() => process.kill(pid, 0));
});
test('real installed Codex config API reads and writes isolated native settings with project and CAS checks', { timeout: 60000 }, async t => {
  const f = await fixture(t); const binary = process.env.AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE ?? path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
  try { await access(binary); } catch { t.skip('Installed Codex is unavailable for the isolated offline check.'); return; }
  const cli = new LocalCliService(f.data, { home: f.home, env: f.env, isolated: true, executables: { codex: binary } }), controls = new NativeMemoryControls(cli);
  await mkdir(f.env.CODEX_HOME, { recursive: true });
  let state = (await controls.list())[0]!; assert.equal(state.enabled, false); assert.equal(state.canToggle, true);
  await controls.write('codex', state.revision, 'enabled', true); state = (await controls.list())[0]!; assert.equal(state.enabled, true); assert.equal(state.generate, true); assert.equal(state.use, true);
  await controls.write('codex', state.revision, 'allowToolChats', false); state = (await controls.list())[0]!; assert.equal(state.allowToolChats, false);
  const file = path.join(f.env.CODEX_HOME, 'config.toml'), before = await readFile(file, 'utf8'); await put(file, '# external\n' + before);
  await assert.rejects(controls.write('codex', state.revision, 'enabled', false), /CONFLICT/);
  await codexConfiguration(binary, f.env, f.home, async rpc => {
    const original = await rpc('config/read', { includeLayers: true }); const user = original.layers.find((layer: any) => layer.name.type === 'user');
    await put(file, 'model_context_window = 8192\n' + before); await assert.rejects(rpc('config/batchWrite', { filePath: file, expectedVersion: user.version, edits: [{ keyPath: 'features.memories', value: false, mergeStrategy: 'replace' }] }), /REJECTED/);
  });
  const project = path.join(f.home, 'project'); await put(path.join(project, '.git/HEAD'), 'ref: refs/heads/main\n'); await put(path.join(project, '.codex/config.toml'), '[memories]\nuse_memories = false\n');
  await put(file, before + '\n[projects.' + JSON.stringify(project) + ']\ntrust_level = "trusted"\n');
  assert.equal(await controls.canReceive('codex', project), false, 'project cwd must affect effective native memory');
  assert.equal(await controls.canReceive('codex'), true);
});
