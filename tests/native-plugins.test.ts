import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';
import { NativePluginsService } from '../packages/native-plugins';
import { LocalCliService } from '../packages/native-runtime/cli';
import { digest, optionalText, readJson } from '../packages/native-resources/files';

const put = async (file: string, text: string) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };
async function fixture(t: TestContext) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'awb-plugins-')); t.after(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const codexHome = path.join(home, '.codex'), claudeHome = path.join(home, '.claude'), config = path.join(codexHome, 'config.toml'), settings = path.join(claudeHome, 'settings.json');
  const executables = { codex: path.join(home, 'codex.exe'), claude: path.join(home, 'claude.exe') }; for (const file of Object.values(executables)) await put(file, 'fixture');
  await put(config, '[plugins."fixture@local"]\nenabled = false\n[plugins."unrelated@local"]\nenabled = false\n');
  await put(settings, '{"sentinel":42,"enabledPlugins":{"fixture@local":true}}');
  await put(path.join(claudeHome, 'plugins/known_marketplaces.json'), '{"claude-plugins-official":{}}');
  const installed = { codex: true, claude: true }; const calls: { method: string; params: any }[] = [];
  const cli = new LocalCliService(path.join(home, 'data'), { home, isolated: true, executables, run: async () => '2.1.283' }); await cli.initialize(); t.after(() => cli.dispose());
  const options = {
    rpc: async (method: string, params: any) => {
      calls.push({ method, params }); const raw = (await optionalText(config))!, data = parse(raw) as any;
      if (method === 'plugin/list') return { marketplaces: [{ name: 'local', path: path.join(home, 'marketplace.json'), plugins: [{ id: 'fixture@local', name: 'Fixture Codex', installed: installed.codex, enabled: data.plugins['fixture@local'].enabled, installPolicy: 'AVAILABLE', availability: 'AVAILABLE' }] }] };
      if (method === 'plugin/install') { installed.codex = true; return {}; }
      if (method === 'config/read') return { layers: [{ name: { type: 'user', file: config }, version: digest(raw), config: data }] };
      if (method === 'config/batchWrite') { assert.equal(params.expectedVersion, digest(raw)); data.plugins = params.edits[0].value; await put(config, stringify(data)); return { status: 'ok' }; }
      throw Error('Unexpected fixture RPC');
    },
    run: async (command: { args: string[] }) => {
      calls.push({ method: 'claude', params: command.args }); const data = await readJson<any>(settings, {});
      if (command.args[1] === 'list') return JSON.stringify({ installed: installed.claude ? [{ id: 'fixture@local', scope: 'user', enabled: data.enabledPlugins['fixture@local'], version: '1.0.0' }] : [], available: installed.claude ? [] : [{ pluginId: 'fixture@local', name: 'Fixture Claude', marketplaceName: 'local', source: './fixture' }] });
      if (command.args[1] === 'install') { assert.deepEqual(command.args.slice(-3), ['--scope', 'user', '--json']); assert.ok(!command.args.includes('-y')); installed.claude = true; return '{"outcome":"ok"}'; }
      throw Error('Unexpected fixture command');
    },
    fetcher: (async () => new Response(JSON.stringify({ name: 'claude-plugins-official', plugins: [{ name: 'official-fixture', source: './plugins/fixture', description: 'Public fixture' }] }))) as typeof fetch,
  };
  return { home, codexHome, claudeHome, config, settings, cli, options, calls, installed, service: new NativePluginsService(cli, options) };
}

test('native plugin catalog identifies both runtimes, uses original controls and preserves unrelated settings', async t => {
  const f = await fixture(t); let scan = await f.service.scan(); assert.deepEqual(scan.errors, []); assert.equal(scan.plugins.length, 2);
  const codex = scan.plugins.find(p => p.runtime === 'codex')!; await f.service.change('codex', codex.id, codex.revision, 'enable');
  assert.equal((parse(await readFile(f.config, 'utf8')) as any).plugins['unrelated@local'].enabled, false);
  scan = await f.service.scan(); const claude = scan.plugins.find(p => p.runtime === 'claude')!; await f.service.change('claude', claude.id, claude.revision, 'disable');
  assert.equal((await readJson<any>(f.settings, {})).sentinel, 42); assert.equal((await f.service.scan()).plugins.find(p => p.runtime === 'claude')!.enabled, false);
});

test('available native plugins install only the selected runtime package and require fresh catalog revisions', async t => {
  const f = await fixture(t); f.installed.codex = false; f.installed.claude = false;
  let scan = await f.service.scan(); assert.ok(scan.plugins.every(p => !p.installed && p.canInstall)); const codex = scan.plugins.find(p => p.runtime === 'codex')!;
  await f.service.change('codex', codex.id, codex.revision, 'install'); assert.equal(f.calls.filter(c => c.method === 'plugin/install').length, 1); assert.equal(f.installed.claude, false);
  scan = await f.service.scan(); const claude = scan.plugins.find(p => p.runtime === 'claude')!;
  await put(f.settings, '{"sentinel":99,"enabledPlugins":{"fixture@local":true}}'); await assert.rejects(f.service.change('claude', claude.id, claude.revision, 'install'), /CONFLICT/);
  const current = (await f.service.scan()).plugins.find(p => p.runtime === 'claude')!; await f.service.change('claude', current.id, current.revision, 'install'); assert.equal(f.installed.claude, true);
});

test('public official catalog adds available entries without registering or installing anything on discovery', async t => {
  const f = await fixture(t); await rm(path.join(f.claudeHome, 'plugins/known_marketplaces.json'));
  const scan = await f.service.scan(); const entry = scan.plugins.find(p => p.nativeId === 'official-fixture@claude-plugins-official')!; assert.equal(entry.needsMarketplace, true); assert.equal(entry.canInstall, true);
  assert.ok(!f.calls.some(c => c.method === 'claude' && ['install', 'marketplace'].includes(c.params[1])));
});

test('unavailable public catalog preserves installed records and surfaces a partial-discovery warning', async t => {
  const f = await fixture(t); await rm(path.join(f.claudeHome, 'plugins/known_marketplaces.json'));
  const service = new NativePluginsService(f.cli, { ...f.options, fetcher: (async () => new Response('', { status: 503 })) as typeof fetch });
  const scan = await service.scan(); assert.equal(scan.plugins.filter(p => p.installed).length, 2); assert.equal(scan.errors[0]!.runtime, 'claude');
});

test('project overrides keep native plugin controls unavailable instead of claiming a successful write', async t => {
  const f = await fixture(t), project = path.join(f.home, 'project'); await put(path.join(project, '.claude/settings.local.json'), '{"enabledPlugins":{"fixture@local":false}}');
  const service = new NativePluginsService(f.cli, { ...f.options, projects: () => [project] }); const entry = (await service.scan()).plugins.find(p => p.runtime === 'claude')!; assert.equal(entry.canToggle, false); await assert.rejects(service.change('claude', entry.id, entry.revision, 'disable'), /UNAVAILABLE/);
});

test('native installed discovery survives an unavailable Codex installation catalog', async t => {
  const f = await fixture(t);
  const service = new NativePluginsService(f.cli, { ...f.options, rpc: async (method, params) => {
    if (method === 'plugin/installed') return f.options.rpc('plugin/list', params);
    if (method === 'plugin/list') throw Error('Catalog unavailable');
    return f.options.rpc(method, params);
  } });
  const scan = await service.scan(); assert.equal(scan.plugins.find(item => item.runtime === 'codex')?.installed, true); assert.equal(scan.errors[0]?.runtime, 'codex');
});
