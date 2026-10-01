import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import { nativeRequestCodec } from '../packages/model-api/native-request';
import { NativeResources } from '../apps/desktop/host/native-resources';
import { SharedMemoryStore } from '../packages/memory-core';
import { SharedSkillsStore } from '../packages/skills-core';

test('approved request codecs reach the production gateway with layered cleanup and existing/later consumers', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'awb-request-plugin-'));
  const store = new StateStore(home); await store.load();
  const native = new NativeResources(home, { openZip: async () => null, saveZip: async () => null }, () => [], () => {}, home, { cliOptions: { executables: { codex: process.execPath, claude: process.execPath } } });
  const controller = new WorkbenchController(store, new SecretStore(home, { encrypt: () => { throw Error('No credentials'); }, decrypt: () => { throw Error('No credentials'); } }), { pickDirectory: async () => null, openPath: async () => {}, copy: () => {}, nativeCapabilities: () => [] }, () => {}, { memory: new SharedMemoryStore(home), skills: new SharedSkillsStore(home), native });
  const plugins = new PluginRegistry(path.join(home, 'plugins')); await plugins.initialize();
  for (const [id, service] of Object.entries(controller.developmentServices())) if (service) plugins.services.register(id, service, { version: 1 });
  assert.equal(plugins.services.get('runtime.native-request'), nativeRequestCodec);
  const runner = plugins.services.get('runtime.native-provider') as any;
  const seen: any[] = []; let gate: Promise<void> | undefined, entered: (() => void) | undefined;
  const options = { runtime: 'codex', model: { id: 'fixture', model: 'fixture', name: 'Fixture', enabled: true }, credentials: async () => ({ key: '', connection: { protocol: 'chat-completions', baseUrl: 'https://fixture.invalid', timeoutMs: 2000 } }), fetcher: async (_url: any, init: any) => {
    seen.push(JSON.parse(init.body)); entered?.(); await gate;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Fixture' } }] });
  } };
  const first = await runner.openGateway(options); const gateways = [first];
  const call = async (gateway = first) => {
    const reply = await fetch(gateway.baseUrl + '/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ stream: true, input: [{ type: 'function_call_output', call_id: 'one', output: [{ type: 'input_image', image_url: 'https://fixture.invalid/image.png' }] }] }) });
    assert.match(await reply.text(), /Fixture/);
    const body = seen.at(-1); assert.equal(body.messages[2].content[1].image_url.url, 'https://fixture.invalid/image.png');
    return body;
  };
  async function install(id: string, fail = false, replace = false) {
    const manifest = { schemaVersion: 1, apiVersion: 1, id, name: id, version: '1.0.0', description: 'Synthetic request codec', capabilities: ['host'], main: 'main.mjs' };
    const source = `export function activate(api){const codec=api.services.get('runtime.native-request'); api.registerCommand('map',args=>codec.map(...args));${replace ? `const base=codec.map.bind(codec);api.services.override('runtime.native-request',{map(...args){const mapped=base(...args);mapped.fixtureOwners=['${id}'];return mapped;}});` : `api.services.intercept('runtime.native-request','map',(next,...args)=>{const mapped=next(...args);mapped.fixtureOwners=[...(mapped.fixtureOwners??[]),'${id}'];return mapped;});`}${fail ? "throw Error('Synthetic activation failure');" : ''}}`;
    const file = path.join(home, id + '.zip'); await writeFile(file, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'main.mjs', data: Buffer.from(source) }]));
    await plugins.importZip(file); return (await plugins.list()).find(p => p.manifest.id === id)!;
  }
  try {
    const one = await install('qa.request-one'), two = await install('qa.request-two'), bad = await install('qa.request-failed', true);
    await assert.rejects(plugins.setEnabled(one.manifest.id, one.hash, true), /Explicit approval/);
    assert.equal((await call()).fixtureOwners, undefined);
    await plugins.setEnabled(one.manifest.id, one.hash, true, true); await plugins.setEnabled(two.manifest.id, two.hash, true, true);
    assert.deepEqual((await call()).fixtureOwners, ['qa.request-one', 'qa.request-two']);
    const later = await runner.openGateway(options); gateways.push(later); assert.deepEqual((await call(later)).fixtureOwners, ['qa.request-one', 'qa.request-two']);
    await plugins.setEnabled(bad.manifest.id, bad.hash, true, true); assert.ok((await plugins.list()).find(p => p.manifest.id === bad.manifest.id)?.error);
    assert.deepEqual((await call()).fixtureOwners, ['qa.request-one', 'qa.request-two']);
    let release!: () => void; gate = new Promise<void>(r => { release = r; }); const ready = new Promise<void>(r => { entered = r; });
    const pending = call(); await ready; await plugins.setEnabled(one.manifest.id, one.hash, false); await plugins.setEnabled(two.manifest.id, two.hash, false);
    release(); assert.deepEqual((await pending).fixtureOwners, ['qa.request-one', 'qa.request-two']); gate = undefined; entered = undefined;
    assert.equal((await call()).fixtureOwners, undefined);
    await plugins.setEnabled(one.manifest.id, one.hash, true); assert.deepEqual((await call(later)).fixtureOwners, ['qa.request-one']);
    await rm(one.directory, { recursive: true }); await plugins.refresh(); assert.equal((await call()).fixtureOwners, undefined);
    const replacement = await install('qa.request-replacement', false, true);
    await plugins.setEnabled(replacement.manifest.id, replacement.hash, true, true); assert.deepEqual((await call()).fixtureOwners, ['qa.request-replacement']);
    await plugins.setEnabled(replacement.manifest.id, replacement.hash, false); assert.equal((await call(later)).fixtureOwners, undefined);
  } finally { for (const gateway of gateways) await gateway.close(); await plugins.dispose(); await controller.dispose(); await rm(home, { recursive: true, force: true }); }
});
