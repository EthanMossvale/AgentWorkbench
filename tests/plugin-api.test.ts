import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { PluginRegistry, parseManifest } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import { codexMemoryOverrides } from '../packages/native-memory/controls';

async function fixture(t: test.TestContext, main?: string, renderer?: string, id='test.full') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'awb-plugin-api-'));
  t.after(() => rm(root, {recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const manifest = {schemaVersion:1,apiVersion:1,id,name:'Test',version:'1.0.0',description:'Test',capabilities:['host'],...(main ? {main:'main.mjs'} : {}),...(renderer ? {renderer:'renderer.mjs'} : {})};
  const file = path.join(root,'plugin.zip');
  await writeFile(file, encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},...(main ? [{name:'main.mjs',data:Buffer.from(main)}] : []),...(renderer ? [{name:'renderer.mjs',data:Buffer.from(renderer)}] : [])]));
  const service = new PluginRegistry(path.join(root,'data')); await service.initialize();
  t.after(() => service.dispose()); await service.importZip(file);
  return {root,service,record:(await service.list())[0]!};
}

test('renderer bundles need full trust and a present entry; changed bytes revoke the complete package', async t => {
  assert.throws(() => parseManifest({schemaVersion:1,apiVersion:1,id:'test.bad',name:'Bad',description:'',version:'1.0.0',capabilities:['theme'],renderer:'ui.mjs'}), /host access/);
  const source = 'export function activate(api) { api.root.textContent = "Verified source"; }';
  const {service,record} = await fixture(t, undefined, source);
  assert.deepEqual(await service.renderers(), []);
  await assert.rejects(service.setEnabled(record.manifest.id, record.hash, true), /Explicit approval/);
  await service.setEnabled(record.manifest.id, record.hash, true, true);
  assert.deepEqual(await service.renderers(), [{id:record.manifest.id,hash:record.hash,source}]);
  await service.rendererFailed(record.manifest.id, record.hash);
  assert.equal((await service.list())[0]!.error, 'PLUGIN_RENDERER_ACTIVATION_FAILED');
  await writeFile(path.join(record.directory,'renderer.mjs'), source+'\n// Changed');
  assert.deepEqual(await service.renderers(), []); const changed = (await service.list())[0]!;
  assert.equal(changed.enabled, false); assert.equal(changed.approved, false);
  await assert.rejects(service.setEnabled(changed.manifest.id, changed.hash, true), /Explicit approval/);
  await service.setEnabled(changed.manifest.id, changed.hash, true, true);
  await service.disableAll(); assert.deepEqual(await service.renderers(), []);
  const restarted = new PluginRegistry(path.join(path.dirname(record.directory),'..')); await restarted.initialize(); t.after(()=>restarted.dispose());
  assert.deepEqual(await restarted.renderers(), []);
});

test('host plugins call core services, observe isolated state events, and release services on disable', async t => {
  const {service,record} = await fixture(t, `export async function activate(api) {
    const initial = await api.call('state/get'); let latest = initial, count = 0;
    api.onEvent(event => { latest = event.payload; count++; event.payload.changedByPlugin = true; });
    api.registerCommand('read', () => ({latest,count}));
    api.registerCommand('invoke', payload => api.call('theme/set',payload));
    api.useHost(async (request,next) => request.method.startsWith('native-plugins/') ? 'plugin replacement' : next());
    api.onDispose(() => api.call('theme/set', {theme:'should-not-run'}));
  }`);
  const requests: unknown[] = [];
  service.connectHost(async request => { requests.push(request); return {theme:'light'}; });
  await service.setEnabled(record.manifest.id, record.hash, true, true);
  assert.deepEqual(requests,[{method:'state/get',payload:{}}]);
  const original = {theme:'dark'}; service.publish({type:'state',payload:original}); await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(original,{theme:'dark'}); assert.equal((await service.command('test.full','read',null) as any).count,1);
  await service.command('test.full','invoke',{theme:'dark'}); assert.equal(requests.length,2);
  assert.equal(await service.dispatch({method:'native-plugins/list',payload:{}},async()=> 'native'), 'plugin replacement');
  await service.disableAll(); service.publish({type:'state',payload:{}}); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2); await assert.rejects(service.command('test.full','read',null));
});

test('missing renderer files are rejected before installing a package', async t => {
  const {root,service} = await fixture(t);
  const file = path.join(root,'bad.zip');
  await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id:'test.missing',name:'Missing',description:'',version:'1.0.0',capabilities:['host'],renderer:'absent.mjs'}))}]));
  await assert.rejects(service.importZip(file), /entry point is missing/);
  assert.equal((await service.list()).length,1);
});

test('all host namespaces support replacement, custom methods and cooperative restoration', async t => {
  const {service,record}=await fixture(t,`export function activate(api) {
    const prefixes=['extensions','native-memory','native-skills','native-plugins','local-cli','session','accounts','remote-cli'];
    for(const prefix of prefixes) api.registerMethod(prefix+'/example',payload=>({replacement:prefix,payload}));
    api.registerMethod('personal/new-feature',payload=>({added:payload}));
    api.registerCommand('invoke',payload=>api.invoke('personal/new-feature',payload));
    api.registerCommand('core',()=>api.call('state/get'));
    api.services.override('translation',{translate:()=> 'replacement'});
    api.services.register('personal.helper',{read:()=>42});
    api.emit('ready',{custom:true});
  }`);
  const translation={translate:()=> 'core'},events:unknown[]=[];
  service.services.register('translation',translation);service.connectEvents(event=>events.push(event));
  service.connectHost(async request=>({core:request.method}));
  await service.setEnabled(record.manifest.id,record.hash,true,true);
  for(const prefix of ['extensions','native-memory','native-skills','native-plugins','local-cli','session','accounts','remote-cli'])assert.deepEqual(await service.dispatch({method:prefix+'/example',payload:1},async()=> 'core'),{replacement:prefix,payload:1});
  assert.deepEqual(await service.command(record.manifest.id,'invoke',9),{added:9});
  assert.deepEqual(await service.command(record.manifest.id,'core',null),{core:'state/get'});
  assert.equal(translation.translate(),'replacement');assert.equal(events.length,1);
  await service.disableAll();assert.equal(translation.translate(),'core');assert.throws(()=>service.services.get('personal.helper'),/unavailable/);
  assert.equal(await service.dispatch({method:'local-cli/example',payload:{}},async()=> 'core'),'core');
});

test('failed host activation releases service overrides and custom dispatch methods', async t => {
  const {service,record}=await fixture(t,`export function activate(api) {
    api.services.override('core',{run:()=>2});api.registerMethod('local-cli/list',()=>['replacement']);throw Error('intentional failure');
  }`);
  const core={run:()=>1};service.services.register('core',core);
  await service.setEnabled(record.manifest.id,record.hash,true,true);
  assert.equal(core.run(),1);assert.equal((await service.list())[0]!.enabled,false);
  assert.equal(await service.dispatch({method:'local-cli/list',payload:{}},async()=> 'core'),'core');
});

test('Codex source restrictions and memory settings have independent override ownership', () => {
  assert.deepEqual(codexMemoryOverrides({'memories.use_memories':{name:{type:'project'}}}), {memory:true,tools:false});
  assert.deepEqual(codexMemoryOverrides({'memories.disable_on_external_context':{name:{type:'project'}}}), {memory:false,tools:true});
  assert.deepEqual(codexMemoryOverrides({'memories.no_memories_if_mcp_or_web_search':{name:{type:'session'}}}), {memory:false,tools:true});
  assert.deepEqual(codexMemoryOverrides({'memories.extract_model':{name:{type:'project'}}}), {memory:false,tools:false});
});


test('imported translation implementations activate through the same service extension contract', async t => {
  const {service,record}=await fixture(t, `export function activate(api) {
    api.services.override('translation',{translate:()=> 'plugin translation'});
  }`,undefined,'translation');
  const translation={translate:()=> 'core translation'};service.services.register('translation',translation);
  assert.equal(record.enabled,false);assert.equal(translation.translate(),'core translation');
  await service.setEnabled(record.manifest.id,record.hash,true,true);
  assert.equal(translation.translate(),'plugin translation');await service.disableAll();
  assert.equal(translation.translate(),'core translation');
});
