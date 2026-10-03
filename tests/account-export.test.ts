import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalAccountExport } from '../apps/desktop/host/account-export';
import type { AccountExportFormatId } from '../packages/model-management/account-export-types';
import type { LocalModelAccount } from '../packages/model-management/types';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';

const id = '11111111-1111-4111-a111-111111111111';
const account = (provider: 'codex' | 'claude' = 'codex'): LocalModelAccount => ({ id, revision: 'r1', provider, name: 'Synthetic account', enabled: true, status: 'authenticated', models: [], email: 'member@example.com' });
const request = { id, revision: 'r1' };
const jwt = (data: object) => 'fixture.' + Buffer.from(JSON.stringify(data)).toString('base64url') + '.signature';
const credentials = () => ({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: jwt({ email: 'member@example.com' }), access_token: jwt({ exp: 2000000000, 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_user_id: 'synthetic-user', chatgpt_plan_type: 'plus' } }), refresh_token: 'synthetic-refresh-never-real', account_id: 'synthetic-account' }, last_refresh: '2026-09-29T12:00:00Z' });
async function fixture(t: test.TestContext, provider: 'codex' | 'claude' = 'codex') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'awb-export-')), directory = path.join(root, 'data');
  const a = account(provider), file = path.join(directory, 'native-accounts', id, provider, provider === 'codex' ? 'auth.json' : '.credentials.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(provider === 'codex' ? credentials() : { claudeAiOauth: { accessToken: 'synthetic-claude-access', refreshToken: 'synthetic-claude-refresh', expiresAt: 2000000000000, scopes: ['user:inference'], subscriptionType: 'max' } }));
  let copied = '', pickedName = '', target: string | null = path.join(root, 'export.json');
  const service = new LocalAccountExport(directory, { account: value => { if (value !== a.id) throw Error('LOCAL_ACCOUNT_NOT_FOUND'); return a; }, copy: text => { copied = text; }, pickSave: async name => { pickedName = name; return target; } });
  t.after(async () => { service.dispose(); await rm(root, { force: true, recursive: true }); });
  return { root, directory, a, file, service, copied: () => copied, pickedName: () => pickedName, target: (value: string | null) => { target = value; } };
}
test('all built-in formats use email-provider-format names in preview and the save picker without changing JSON', async t => {
  for (const provider of ['codex', 'claude'] as const) {
    const f = await fixture(t, provider); f.a.email = 'member+work@example.com';
    for (const formatId of ['official', 'sub2api', 'cpa'] as const) {
      const preview = await f.service.preview({ ...request, formatId, reveal: true });
      assert.equal(preview.fileName, `member+work@example.com-${provider}-${formatId}.json`);
      await f.service.save({ ...request, formatId }); assert.equal(f.pickedName(), preview.fileName);
      const saved = JSON.parse(await readFile(path.join(f.root, 'export.json'), 'utf8')), expected = JSON.parse(preview.content);
      if (formatId === 'sub2api') { assert.ok(Date.parse(saved.exported_at) >= Date.parse(expected.exported_at)); delete saved.exported_at; delete expected.exported_at; }
      assert.deepEqual(saved, expected);
    }
  }
});
test('missing email falls back to existing credential metadata, a safe account name, then the short account ID', async t => {
  const f = await fixture(t); delete f.a.email;
  assert.equal((await f.service.preview(request)).fileName, 'member@example.com-codex-official.json');
  const raw = credentials(); raw.tokens.id_token = ''; await writeFile(f.file, JSON.stringify(raw)); f.a.name = '账号 / 备用';
  assert.equal((await f.service.preview(request)).fileName, '账号_备用-codex-official.json');
  f.a.name = ''; assert.equal((await f.service.preview(request)).fileName, 'account-11111111-codex-official.json');
  f.a.email = '../../folder\\unsafe:*?<>|@example.com';
  const safe = (await f.service.preview(request)).fileName; assert.equal(/[\\/:*?<>|]/.test(safe), false); assert.equal(safe.startsWith('.'), false); assert.ok(safe.endsWith('-codex-official.json'));
  f.a.email = 'con.member@example.com'; assert.equal((await f.service.preview(request)).fileName, '_con.member@example.com-codex-official.json');
  f.a.email = '用'.repeat(300) + '@example.com';
  const bounded = (await f.service.preview(request)).fileName; assert.ok(Buffer.byteLength(bounded) <= 181); assert.ok(bounded.endsWith('-codex-official.json'));
});
test('custom filenames retain backward compatibility, accept email characters, and reject unsafe destinations', async t => {
  const f = await fixture(t);
  for (const fileName of ['fixture.json', '.credentials.json', 'user+work@example.com.json', '账号-claude-cpa.json']) {
    const release = f.service.overrideFormat('official', { label: 'Fixture', description: 'Synthetic', serialize: () => ({ fileName, value: {} }) });
    assert.equal((await f.service.preview(request)).fileName, fileName); release();
  }
  for (const fileName of ['../other.json', 'folder/file.json', 'folder\\file.json', 'CON.json', 'NUL .json', 'name\u202e.json', 'x'.repeat(250) + '.json']) {
    const release = f.service.overrideFormat('official', { label: 'Fixture', description: 'Synthetic', serialize: () => ({ fileName, value: {} }) });
    await assert.rejects(f.service.preview(request), /ACCOUNT_EXPORT_DOCUMENT_INVALID/); release();
  }
  assert.equal((await f.service.preview(request)).fileName, 'member@example.com-codex-official.json');
});
test('official default is lossless while preview masks all credential and identity strings', async t => {
  const f = await fixture(t), original = await readFile(f.file, 'utf8');
  const preview = await f.service.preview(request);
  assert.equal(preview.formatId, 'official'); assert.equal(preview.fileName, 'member@example.com-codex-official.json'); assert.equal(preview.redacted, true);
  for (const secret of ['synthetic-refresh-never-real', 'synthetic-account', 'member@example.com']) assert.equal(preview.content.includes(secret), false);
  assert.deepEqual(JSON.parse((await f.service.preview({ ...request, reveal: true })).content), JSON.parse(original));
  assert.deepEqual(await f.service.copy(request), { status: 'copied' }); assert.deepEqual(JSON.parse(f.copied()), JSON.parse(original));
  assert.deepEqual(await f.service.save(request), { status: 'saved' }); assert.deepEqual(JSON.parse(await readFile(path.join(f.root, 'export.json'), 'utf8')), JSON.parse(original));
  assert.equal(await readFile(f.file, 'utf8'), original);
});
test('Codex sub2api and cpa encode provider-specific upstream field structures', async t => {
  const { service } = await fixture(t);
  const output = async (formatId: AccountExportFormatId) => JSON.parse((await service.preview({ ...request, formatId, reveal: true })).content);
  const sub = await output('sub2api'); assert.equal(sub.type, 'sub2api-data'); assert.equal(sub.version, 1); assert.deepEqual(sub.proxies, []); assert.equal(sub.accounts.length, 1);
  assert.equal(sub.accounts[0].platform, 'openai'); assert.equal(sub.accounts[0].type, 'oauth'); assert.equal(sub.accounts[0].credentials.chatgpt_account_id, 'synthetic-account'); assert.equal(sub.accounts[0].credentials.chatgpt_user_id, 'synthetic-user'); assert.equal(sub.accounts[0].credentials.expires_at, '2033-05-18T03:33:20.000Z');
  const cpa = await output('cpa'); assert.equal(cpa.type, 'codex'); assert.equal(cpa.account_id, 'synthetic-account'); assert.equal(cpa.plan_type, 'plus'); assert.equal(cpa.expired, sub.accounts[0].credentials.expires_at); assert.equal(cpa.refresh_token, credentials().tokens.refresh_token);
  assert.equal(JSON.stringify(await service.formats()).includes('refresh'), false);
});
test('Claude exports preserve official structure and map milliseconds to ISO expiry', async t => {
  const { service, file } = await fixture(t, 'claude');
  const official = await service.preview({ ...request, reveal: true }); assert.equal(official.fileName, 'member@example.com-claude-official.json'); assert.deepEqual(JSON.parse(official.content), JSON.parse(await readFile(file, 'utf8')));
  const sub = JSON.parse((await service.preview({ ...request, formatId: 'sub2api', reveal: true })).content); assert.equal(sub.accounts[0].platform, 'anthropic'); assert.equal(sub.accounts[0].credentials.access_token, 'synthetic-claude-access'); assert.equal(sub.accounts[0].credentials.expires_at, '2033-05-18T03:33:20.000Z');
  const cpa = JSON.parse((await service.preview({ ...request, formatId: 'cpa', reveal: true })).content); assert.equal(cpa.type, 'claude'); assert.equal(cpa.expired, sub.accounts[0].credentials.expires_at); assert.equal(cpa.account_id, undefined);
});
test('API keys and agent identities never silently become OAuth; unsupported formats fail closed', async t => {
  const f = await fixture(t);
  for (const value of [{ auth_mode: 'apikey', OPENAI_API_KEY: 'synthetic-key' }, { auth_mode: 'agent_identity', agent_identity: { agent_runtime_id: 'runtime', agent_private_key: 'synthetic-private-value', chatgpt_account_id: 'account' } }]) {
    await writeFile(f.file, JSON.stringify(value));
    assert.deepEqual(JSON.parse((await f.service.preview({ ...request, reveal: true })).content), value);
    await assert.rejects(f.service.copy({ ...request, formatId: 'cpa' }), /ACCOUNT_EXPORT_FORMAT_UNSUPPORTED/);
    const sub = JSON.parse((await f.service.preview({ ...request, formatId: 'sub2api', reveal: true })).content);
    assert.equal(sub.accounts[0].type, value.auth_mode === 'apikey' ? 'apikey' : 'oauth');
  }
  assert.equal(f.copied(), '');
});
test('missing, corrupt, linked, oversized and stale credential sources are rejected without global fallback', async t => {
  const f = await fixture(t); await assert.rejects(f.service.preview({ ...request, revision: 'old' }), /LOCAL_ACCOUNT_CHANGED/);
  await assert.rejects(f.service.preview({ ...request, id: '../../escape' }), /REQUEST_INVALID/);
  await writeFile(f.file, 'secret-malformed'); await assert.rejects(f.service.preview(request), error => String(error) === 'Error: ACCOUNT_EXPORT_CREDENTIALS_INVALID');
  await writeFile(f.file, 'x'.repeat(1024 * 1024 + 1)); await assert.rejects(f.service.preview(request), /CREDENTIALS_INVALID/);
  await writeFile(f.file, JSON.stringify(credentials())); await link(f.file, path.join(f.root, 'linked-auth')); await assert.rejects(f.service.preview(request), /CREDENTIALS_INVALID/); await rm(path.join(f.root, 'linked-auth'));
  await rm(f.file); await assert.rejects(f.service.preview(request), /CREDENTIALS_MISSING/);
});
test('save cancellation and protected destination perform no write', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8');
  f.target(null); assert.deepEqual(await f.service.save(request), { status: 'cancelled' });
  const exportPath=path.join(f.directory,'export.json'); f.target(exportPath); assert.deepEqual(await f.service.save(request), {status:'saved'}); assert.deepEqual(JSON.parse(await readFile(exportPath,'utf8')),JSON.parse(before));
  f.target(f.file); await assert.rejects(f.service.save(request), /DESTINATION_PROTECTED/); assert.equal(await readFile(f.file, 'utf8'), before);
  let finish!: (path: string) => void;
  const service = new LocalAccountExport(f.directory, { account: () => f.a, copy: () => {}, pickSave: () => new Promise(resolve => { finish = resolve; }) });
  const pending = service.save(request); while (!finish) await new Promise(resolve => setTimeout(resolve, 1)); f.a.revision = 'r2'; finish(path.join(f.root, 'changed.json'));
  await assert.rejects(pending, /LOCAL_ACCOUNT_CHANGED/); await assert.rejects(readFile(path.join(f.root, 'changed.json')), /ENOENT/); service.dispose();
});
test('format registration, layered overrides, release, late results, and disposal use the live directory', async t => {
  const { service } = await fixture(t); let changes = 0; const unwatch = service.subscribe(() => changes++);
  const definition = { id: 'test.export:sample' as const, label: 'Sample', description: 'Synthetic', serialize: () => ({ fileName: 'sample.json', value: { secret: 'synthetic-plugin-secret' } }) };
  const release = service.registerFormat(definition); assert.throws(() => service.registerFormat(definition), /DUPLICATE/); assert.throws(() => service.registerFormat({ ...definition, id: 'official' }), /ID_INVALID/);
  assert.equal(service.formats().at(-1)?.id, definition.id); assert.equal((await service.preview({ ...request, formatId: definition.id })).content.includes('synthetic-plugin-secret'), false);
  const first = service.overrideFormat('official', { ...definition, label: 'First' }), second = service.overrideFormat('official', { ...definition, label: 'Second' });
  const generation = service.formats()[0]!.generation; first(); assert.equal(service.formats()[0]!.label, 'Second'); second(); assert.equal(service.formats()[0]!.label, '官方auth.json'); assert.notEqual(service.formats()[0]!.generation, generation);
  let started!: () => void, signal: AbortSignal | undefined; const ready = new Promise<void>(resolve => { started = resolve; });
  const releaseSlow = service.registerFormat({ ...definition, id: 'test.export:slow', serialize: context => { signal = context.signal; started(); return new Promise(() => {}); } });
  const pending = service.preview({ ...request, formatId: 'test.export:slow' }); await ready; releaseSlow(); await assert.rejects(pending, /FORMAT_UNAVAILABLE/); assert.equal(signal?.aborted, true);
  const releaseFail = service.registerFormat({ ...definition, id: 'test.export:fail', serialize: () => { throw Error('SECRET-DO-NOT-EXPOSE'); } });
  await assert.rejects(service.preview({ ...request, formatId: 'test.export:fail' }), error => String(error) === 'Error: ACCOUNT_EXPORT_SERIALIZER_FAILED'); releaseFail();
  release(); assert.ok(changes >= 8); unwatch(); service.dispose(); assert.throws(() => service.formats(), /DISPOSED/);
});
test('approved ZIP registers formats in the production controller, invokes consumers, and restores on disable and uninstall', async t => {
  const f = await fixture(t), store = new StateStore(f.directory); await store.load(); await store.update(s => { s.localModelAccounts = [f.a]; });
  let copied = '';
  const controller = new WorkbenchController(store, new SecretStore(f.directory, { encrypt: () => { throw Error('Unused'); }, decrypt: () => { throw Error('Unused'); } }), { pickDirectory: async () => null, openPath: async () => {}, copy: value => { copied = value; }, nativeCapabilities: () => [] }, () => {});
  const registry = new PluginRegistry(path.join(f.root, 'plugins')); await registry.initialize();
  for (const [name, service] of Object.entries(controller.developmentServices())) if (service) registry.services.register(name, service, { version: 1 });
  registry.connectHost(({ method, payload }) => controller.call(method, payload));
  t.after(async () => { await registry.dispose(); await controller.dispose(); });
  const manifest = { schemaVersion: 1, apiVersion: 1, id: 'test.account-export', name: 'Account export fixture', version: '1.0.0', description: 'Synthetic lifecycle', capabilities: ['host'], main: 'main.mjs' };
  const code = `export function activate(api) { const service=api.services.get('models.account-export'); api.onDispose(service.registerFormat({id:api.id+':fixture',label:'Fixture',description:'Synthetic',serialize:({credentials})=>({fileName:'fixture.json',value:{token:credentials.tokens.refresh_token}})})); api.registerCommand('formats',()=>api.call('models/accounts/export-formats',${JSON.stringify(request)})); }`;
  const zip = path.join(f.root, 'plugin.zip'); await writeFile(zip, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'main.mjs', data: Buffer.from(code) }]));
  await registry.importZip(zip); const record = (await registry.list())[0]!; await assert.rejects(registry.setEnabled(manifest.id, record.hash, true), /approv/i); await registry.setEnabled(manifest.id, record.hash, true, true);
  assert.ok((await controller.call('models/accounts/export-formats', request) as { id: string }[]).some(x => x.id === manifest.id + ':fixture'));
  const preview = await controller.call('models/accounts/export-preview', { ...request, formatId: manifest.id + ':fixture' }) as { content: string; fileName: string }; assert.equal(preview.content.includes(credentials().tokens.refresh_token), false); assert.equal(preview.fileName, 'fixture.json');
  await controller.call('models/accounts/export-copy', { ...request, formatId: manifest.id + ':fixture' }); assert.equal(JSON.parse(copied).token, credentials().tokens.refresh_token);
  assert.equal(JSON.stringify(await controller.call('state/get', {})).includes(credentials().tokens.refresh_token), false);
  await registry.setEnabled(manifest.id, record.hash, false); await assert.rejects(controller.call('models/accounts/export-preview', { ...request, formatId: manifest.id + ':fixture' }), /FORMAT_UNAVAILABLE/);
  assert.equal((await controller.call('models/accounts/export-preview', request) as { fileName: string }).fileName, 'member@example.com-codex-official.json');
  await registry.setEnabled(manifest.id, record.hash, true); assert.equal((await controller.call('models/accounts/export-formats', request) as unknown[]).length, 4);
  await registry.setEnabled(manifest.id, record.hash, false); await rm(record.directory, { recursive: true, force: true }); await registry.refresh(); assert.equal((await controller.call('models/accounts/export-formats', request) as unknown[]).length, 3);
});
