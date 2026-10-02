import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { access, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { LocalCliService, type CliOptions } from '../packages/native-runtime/cli';
import { codexWindowsInstall } from '../packages/native-runtime/native-install';
import { cliFailureCode, runCommand, type Command } from '../packages/native-runtime/process';

test('copied Windows Path detects both npm CLIs and updates through their existing channel', async t => {
  const f = await fixture(t), prefix = path.join(f.home, 'custom-npm'), commands: Command[] = [];
  const codex = path.join(prefix, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe');
  await put(codex); await put(path.join(prefix, 'node_modules/@anthropic-ai/claude-code/bin/claude.exe')); await put(path.join(prefix, 'npm.cmd'));
  const env: NodeJS.ProcessEnv = { ...f.env, Path: prefix }; delete env.PATH;
  const service = f.service({ isolated: false, env, run: async command => { if (command.args[0] === '--version') return '0.136.0'; commands.push(command); return ''; } });
  assert.ok((await service.list()).every(item => item.source === 'npm' && item.canUpdate));
  await service.install('codex', true); await service.install('claude', true);
  assert.ok(commands.every(command => command.args.at(-1)!.includes('npm.cmd') && command.args.at(-1)!.includes('install -g')));
  const hoisted = path.join(prefix, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
  await rm(codex); await put(hoisted); assert.equal((await service.locate('codex'))!.executable, hoisted);
});

test('other-channel binaries remain untouched and only explicit native installation adds a maintainable CLI', async t => {
  const f = await fixture(t), external = path.join(f.home, 'desktop-owned'), commands: Command[] = [];
  for (const runtime of ['codex', 'claude']) await put(path.join(external, runtime + '.exe'), 'retained');
  const service = f.service({ isolated: false, env: { ...f.env, PATH: external }, run: async command => {
    if (command.args[0] === '--version') return '0.136.0';
    commands.push(command); await put(command.args.at(-1)!.includes('codex/install.ps1') ? f.codex.executable : f.claude); return '';
  } });
  assert.ok((await service.list()).every(item => item.source === 'path' && item.canInstall && !item.canUpdate && !item.canUninstall));
  for (const runtime of ['codex', 'claude'] as const) {
    await assert.rejects(service.install(runtime, true), /PREREQUISITE/);
    await assert.rejects(service.install(runtime), /STATE_CHANGED/);
    await service.configure(runtime, true);
    await assert.rejects(service.install(runtime, false, true, 'native'), /STATE_CHANGED/);
  }
  assert.equal(commands.length, 0);
  for (const runtime of ['codex', 'claude'] as const) {
    await service.install(runtime, false, false, 'native');
    assert.equal(await readFile(path.join(external, runtime + '.exe'), 'utf8'), 'retained');
  }
  assert.ok((await service.list()).every(item => item.source === 'native' && item.canUpdate));
  assert.equal(commands.length, 2);
});

test('Codex hoisted npm payload removal verifies the same prefix and preserves other programs', async t => {
  const f = await fixture(t), binary = path.join(f.prefix, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe');
  await put(binary); await put(path.join(f.prefix, 'other-program.exe'), 'keep');
  const service = f.service({ run: async command => {
    if (command.args[0] === '--version') return '0.136.0';
    if (command.args.at(-1)!.includes('prefix -g')) return f.prefix;
    assert.match(command.args.at(-1)!, /uninstall -g '@openai\/codex'/); await rm(binary); return '';
  } });
  const item = (await service.list())[0]!; assert.equal(item.source, 'npm');
  await service.uninstall('codex', item.revision);
  assert.equal((await service.list())[0]!.installed, false); assert.equal(await readFile(path.join(f.prefix, 'other-program.exe'), 'utf8'), 'keep');
});

test('official installer failures expose only bounded stage codes', async () => {
  assert.equal(cliFailureCode('Failed to get manifest: private detail'), 'CLI_INSTALL_DOWNLOAD_FAILED');
  assert.equal(cliFailureCode('Checksum verification failed'), 'CLI_INSTALL_CHECKSUM_FAILED');
  assert.equal(cliFailureCode('Access is denied'), 'CLI_INSTALL_PERMISSION_DENIED');
  assert.equal(cliFailureCode('unexpected secret text'), 'CLI_COMMAND_FAILED');
  await assert.rejects(runCommand({ executable: process.execPath, args: ['-e', "process.stderr.write('Failed to download binary: private detail');process.exit(1)"] }, { cwd: process.cwd(), env: process.env, timeout: 5000 }), error => (error as Error).message === 'CLI_INSTALL_DOWNLOAD_FAILED');
});

const put = async (file: string, value = 'fixture') => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); };
async function fixture(t: TestContext) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'awb-install-method-')), data = path.join(home, 'workbench');
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { SYSTEMROOT: process.env.SYSTEMROOT, HOME: home, USERPROFILE: home, PATH: '', APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
  const codex = codexWindowsInstall(home, env), claude = path.join(home, '.local/bin/claude.exe'), prefix = path.join(env.APPDATA, 'npm');
  const npm = { codex: path.join(prefix, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'), claude: path.join(prefix, 'node_modules/@anthropic-ai/claude-code/bin/claude.exe') };
  const service = (options: Partial<CliOptions> = {}) => new LocalCliService(data, { home, env, platform: 'win32', isolated: true, ...options });
  const native = async () => {
    const release = path.join(codex.root, 'releases/0.157.1-x86_64-pc-windows-msvc'); await put(path.join(release, 'bin/codex.exe')); await put(path.join(release, 'codex-package.json'), '{}');
    await symlink(release, path.join(codex.root, 'current'), 'junction'); await mkdir(path.dirname(codex.bin), { recursive: true }); await symlink(path.join(codex.root, 'current/bin'), codex.bin, 'junction'); return release;
  };
  return { home, data, env, codex, claude, prefix, npm, service, native };
}

test('both native installers are available without npm and leave their default directories to the installer', async t => {
  const f = await fixture(t), commands: Command[] = [], environments: NodeJS.ProcessEnv[] = [];
  const service = f.service({ isolated: false, run: async (command, options) => { if (command.args[0] === '--version') return '0.157.1'; commands.push(command); environments.push(options.env); await put(command.args.at(-1)!.includes('codex/install.ps1') ? f.codex.executable : f.claude); return ''; } });
  const missing = await service.list(); assert.ok(missing.every(item => item.canInstall && item.installMethods[0]!.method === 'native' && item.installMethods[0]!.available && !item.installMethods[1]!.available));
  await service.install('codex'); await service.install('claude');
  assert.match(commands[0]!.args.at(-1)!, /chatgpt.com\/codex\/install.ps1/); assert.match(commands[1]!.args.at(-1)!, /claude.ai\/install.ps1/);
  assert.doesNotMatch(JSON.stringify(commands), /npm|--prefix|CODEX_INSTALL_DIR|CODEX_HOME|CLAUDE_CONFIG_DIR/);
  assert.equal(environments[0]!.CODEX_HOME, f.env.CODEX_HOME); assert.equal(environments[0]!.CODEX_RELEASE, 'latest'); assert.equal(environments[0]!.CODEX_NON_INTERACTIVE, '1'); assert.equal((f.env as NodeJS.ProcessEnv).CODEX_RELEASE, undefined);
});

test('Codex native installation can use a selected drive before first install', async t => {
  const f = await fixture(t), chosen = path.join(f.home, 'other-drive', 'Codex');
  const commands: NodeJS.ProcessEnv[] = [];
  const service = f.service({ isolated: false, run: async (command, options) => {
    if (command.args[0] === '--version') return '0.157.1';
    commands.push(options.env);
    await put(path.join(chosen, 'bin', 'codex.exe'));
    return '';
  } });
  await service.initialize();
  assert.equal((await service.setCodexInstallDirectory(chosen))[0]!.installDirectory, chosen);
  assert.equal(service.env.CODEX_HOME,f.env.CODEX_HOME);
  await service.install('codex');
  assert.equal(commands[0]!.CODEX_HOME, path.join(chosen, 'home'));
  assert.equal(commands[0]!.CODEX_INSTALL_DIR, path.join(chosen, 'bin'));
  assert.equal((await service.list())[0]!.executable, path.join(chosen, 'bin', 'codex.exe'));
  assert.equal(service.env.CODEX_HOME,f.env.CODEX_HOME);
  await assert.rejects(service.setCodexInstallDirectory(path.join(f.home, 'different')), /STATE_CHANGED/);
  await service.dispose();
});

test('explicit npm selection installs both official packages and their updates stay on npm', async t => {
  const f = await fixture(t), commands: Command[] = [], urls: string[] = [];
  const service = f.service({ run: async command => { if (command.args[0] === '--version') return '2.1.283'; commands.push(command); await put(command.args.at(-1)!.includes('@anthropic-ai') ? f.npm.claude : f.npm.codex); return ''; }, fetcher: (async url => { urls.push(String(url)); return new Response('{"version":"2.1.283"}'); }) as typeof fetch });
  await service.install('codex', false, false, 'npm'); await service.install('claude', false, false, 'npm');
  assert.ok((await service.list()).every(item => item.source === 'npm' && item.canUpdate && item.canUninstall));
  await service.install('codex', true); await service.install('claude', true); assert.equal(commands.length, 4); assert.ok(commands.every(command => command.args.at(-1)!.includes('install -g')));
  assert.match(commands[0]!.args.at(-1)!, /@openai\/codex@latest/); assert.match(commands[1]!.args.at(-1)!, /@anthropic-ai\/claude-code@latest/);
  await service.check('codex'); await service.check('claude'); assert.deepEqual(urls, ['https://registry.npmjs.org/@openai/codex/latest', 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest']);
  await assert.rejects(service.install('codex', true, false, 'native'), /STATE_CHANGED/); assert.equal(commands.length, 4);
});

test('Codex native launcher is preferred and keeps the short visible path through a versioned junction', async t => {
  const f = await fixture(t); await f.native(); await put(f.npm.codex); const service = f.service({ run: async () => '0.157.1' });
  const item = (await service.list())[0]!; assert.equal(item.executable, f.codex.executable); assert.equal(item.source, 'native'); assert.equal(item.canUninstall, true); assert.match(item.command!, /chatgpt.com\/codex\/install.ps1/);
});

test('native Codex version checks use the installer release channel and native updates do not invoke npm', async t => {
  const f = await fixture(t); await f.native(); const commands: Command[] = [], urls: string[] = []; let version = '0.157.0';
  const service = f.service({ run: async command => { if (command.args[0] === '--version') return version; commands.push(command); version = '0.157.1'; return ''; }, fetcher: (async url => { urls.push(String(url)); return new Response('{"tag_name":"rust-v0.157.1"}'); }) as typeof fetch });
  assert.equal((await service.check('codex'))[0]!.updateAvailable, true); await service.install('codex', true); assert.deepEqual(urls, ['https://releases.openai.com/codex/channels/latest']); assert.match(commands[0]!.args.at(-1)!, /codex\/install.ps1/); assert.doesNotMatch(JSON.stringify(commands), /npm/);
});

test('npm absence is an explicit optional-method limitation and never falls back silently', async t => {
  const f = await fixture(t); let calls = 0; const service = f.service({ isolated: false, run: async () => { calls++; return ''; } });
  await assert.rejects(service.install('codex', false, false, 'npm'), /PREREQUISITE/); assert.equal(calls, 0); assert.equal((await service.list())[0]!.canInstall, true);
  await assert.rejects(service.install('claude', false, false, 'other' as any), /METHOD_INVALID/); assert.equal(calls, 0);
});

test('native removal unlinks only owned Codex junctions and package payload while retaining native user data', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); await f.native();
  const retained = [path.join(f.env.CODEX_HOME, 'config.toml'), path.join(f.env.CODEX_HOME, 'memories/MEMORY.md'), path.join(f.env.CODEX_HOME, 'packages/app-server-daemon/retained'), path.join(f.codex.root, 'unrelated-note.txt'), path.join(f.env.LOCALAPPDATA, 'Packages/desktop-sentinel')];
  for (const file of retained) await put(file, 'retained'); await put(path.join(f.codex.root, 'auto-update-version'), '0.157.1');
  const service = f.service({ run: async (command, options) => command.args[0] === '--version' ? '0.157.1' : runCommand(command, options) });
  await service.uninstall('codex', (await service.list())[0]!.revision); assert.equal((await service.list())[0]!.installed, false);
  await assert.rejects(access(path.join(f.codex.root, 'releases'))); for (const file of retained) assert.equal(await readFile(file, 'utf8'), 'retained');
});

test('native Codex removal refuses substituted junctions and release payload links', async t => {
  const f = await fixture(t), release = await f.native(); let removals = 0; const service = f.service({ run: async command => { if (command.args[0] !== '--version') removals++; return '0.157.1'; } });
  const item = (await service.list())[0]!; const outside = path.join(f.home, 'outside'); await mkdir(outside); await symlink(outside, path.join(release, 'escape'), 'junction');
  await assert.rejects(service.uninstall('codex', item.revision), /UNINSTALL_UNSUPPORTED/); assert.equal(removals, 0); await unlink(path.join(release, 'escape'));
  await unlink(f.codex.bin); await put(path.join(outside, 'codex.exe')); await symlink(outside, f.codex.bin, 'junction'); const substituted = (await service.list())[0]!; assert.equal(substituted.canUninstall, false); await assert.rejects(service.uninstall('codex', substituted.revision), /UNINSTALL_UNSUPPORTED/); assert.equal(removals, 0);
});

test('native uninstall detects an external binary replacement after the host revision check', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); await f.native();
  const service = f.service({ run: async (command, options) => { if (command.args[0] === '--version') return '0.157.1'; await put(f.codex.executable, 'external replacement must survive'); return runCommand(command, options); } });
  await assert.rejects(service.uninstall('codex', (await service.list())[0]!.revision), /CLI_COMMAND_FAILED/);
  assert.equal(await readFile(f.codex.executable, 'utf8'), 'external replacement must survive');
});

test('Claude npm removal verifies the package prefix and preserves its native settings', async t => {
  const f = await fixture(t), commands: Command[] = []; await put(f.npm.claude); await put(path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json'), '{"sentinel":true}');
  const service = f.service({ run: async command => { if (command.args[0] === '--version') return '2.1.283'; commands.push(command); if (command.args.at(-1)!.includes('prefix -g')) return f.prefix; await rm(f.npm.claude); return ''; } });
  await service.uninstall('claude', (await service.list())[1]!.revision); assert.match(commands[1]!.args.at(-1)!, /uninstall -g '@anthropic-ai\/claude-code'/); assert.equal(await readFile(path.join(f.env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'), '{"sentinel":true}');
});
