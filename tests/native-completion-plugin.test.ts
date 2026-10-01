import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import { nativeCompletionCodec } from '../packages/model-api/native-completion';
import { openNativeGateway } from '../packages/model-api/native-gateway';

test('approved codec overrides reach the production gateway and release across failure, disable and inflight completion', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'awb-completion-plugin-'));
  const store = new StateStore(home); await store.load();
  const controller = new WorkbenchController(store, new SecretStore(home, { encrypt: () => { throw Error('No credentials'); }, decrypt: () => { throw Error('No credentials'); } }), { pickDirectory: async () => null, openPath: async () => {}, copy: () => {}, nativeCapabilities: () => [] }, () => {});
  const plugins = new PluginRegistry(path.join(home, 'plugins')); await plugins.initialize();
  for (const [id, service] of Object.entries(controller.developmentServices())) if (service) plugins.services.register(id, service, { version: 1 });
  assert.equal(plugins.services.get('runtime.native-completion'), nativeCompletionCodec);
  const model = { id: 'fixture', model: 'fixture', name: 'Fixture', enabled: true };
  const connection: any = { id: 'fixture', protocol: 'chat-completions', baseUrl: 'https://fixture.invalid', timeoutMs: 1000 };
  const seen: string[] = []; let gate: Promise<void> | undefined, entered: (() => void) | undefined;
  const gateway = await openNativeGateway({ runtime: 'codex', model, credentials: async () => ({ connection, key: '' }), fetcher: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); seen.push(body.messages[0].content); entered?.(); await gate;
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'finish', function: { name: body.tools.at(-1).function.name, arguments: '{"outcome":"completed","message":"Verified."}' } }] } }] });
  } });
  const call = () => fetch(gateway.baseUrl + '/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + gateway.token }, body: JSON.stringify({ stream:true,instructions: 'Native', input: 'Fixture', tools: [{ type: 'function', name: 'inspect', parameters: { type: 'object' } }] }) }).then(r => r.text());
  async function install(id: string, fail = false) {
    const manifest = { schemaVersion: 1, apiVersion: 1, id, name: id, version: '1.0.0', description: 'Synthetic completion codec', capabilities: ['host'], main: 'main.mjs' };
    const source = `export function activate(api){api.services.intercept('runtime.native-completion','prepare',(next,request,protocol)=>{const boundary=next(request,protocol); if(boundary)boundary.request.messages[0].content+=' ${id}';return boundary;});${fail ? "throw Error('Synthetic activation failure');" : ''}}`;
    const file = path.join(home, id + '.zip'); await writeFile(file, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'main.mjs', data: Buffer.from(source) }]));
    await plugins.importZip(file); return (await plugins.list()).find(p => p.manifest.id === id)!;
  }
  try {
    const one = await install('qa.completion-one'), two = await install('qa.completion-two'), bad = await install('qa.completion-failed', true);
    await assert.rejects(plugins.setEnabled(one.manifest.id, one.hash, true), /Explicit approval/);
    await plugins.setEnabled(one.manifest.id, one.hash, true, true); await plugins.setEnabled(two.manifest.id, two.hash, true, true);
    assert.match(await call(), /Verified/); assert.match(seen.at(-1)!, /qa.completion-one.*qa.completion-two/);
    await plugins.setEnabled(bad.manifest.id, bad.hash, true, true);
    assert.ok((await plugins.list()).find(p => p.manifest.id === bad.manifest.id)?.error);
    await call(); assert.doesNotMatch(seen.at(-1)!, /qa.completion-failed/);
    let release!: () => void; gate = new Promise<void>(r => { release = r; }); const ready = new Promise<void>(r => { entered = r; });
    const pending = call(); await ready;
    await plugins.setEnabled(one.manifest.id, one.hash, false); await plugins.setEnabled(two.manifest.id, two.hash, false);
    release(); assert.match(await pending, /response.completed/); gate = undefined; entered = undefined;
    await call(); assert.doesNotMatch(seen.at(-1)!, /qa.completion-/);
    await plugins.setEnabled(one.manifest.id, one.hash, true); await call(); assert.match(seen.at(-1)!, /qa.completion-one/);
    assert.equal(path.dirname(one.directory), path.join(home, 'plugins', 'plugins')); await rm(one.directory, { recursive: true }); await plugins.refresh(); await call(); assert.doesNotMatch(seen.at(-1)!, /qa.completion-/);
  } finally { await gateway.close(); await plugins.dispose(); await controller.dispose(); await rm(home, { recursive: true, force: true }); }
});
