import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PluginRegistry} from '../packages/plugins-core';
import {PluginRecoveryStore} from '../packages/plugins-core/recovery';
import {repairCompatibilityBatch} from '../packages/plugins-core/compatibility-repair';
import {buildPluginRepairPrompt,recoveryDiagnostic} from '../packages/plugins-core/repair-draft';
import {encodeZip} from '../packages/native-resources/archive';

async function temporary(t:test.TestContext){const directory=await mkdtemp(path.join(os.tmpdir(),'awb-batch-repair-'));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return directory;}
test('batch repair continues after activation failure and keeps every unresolved plugin in one draft',async t=>{
  const directory=await temporary(t),registry=new PluginRegistry(directory);await registry.initialize();t.after(()=>registry.dispose());
  registry.services.register('core.reader',{readNew:()=>42},{version:2,adapters:[{version:1,members:{readOld:'readNew'}}]});
  for(const [id,source,version] of [
    ['test.first','export function activate(api){api.registerCommand("ping",()=>api.services.get("core.reader").readOld());}',1],
    ['test.fails','export function activate(){throw Error("PRIVATE_BATCH_SENTINEL");}',1],
    ['test.second','export function activate(api){api.registerCommand("ping",()=>api.services.get("core.reader").readOld()+1);}',1],
    ['test.unsupported','export function activate(){}',99],
  ] as const){
    const manifest={schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic batch fixture',capabilities:['host'],main:'main.mjs',requires:{services:[{id:'core.reader',version,members:['readOld']}]}};
    const file=path.join(directory,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await registry.importZip(file);
    const record=(await registry.list()).find(p=>p.manifest.id===id)!;await registry.setEnabled(id,record.hash,true,true);
  }
  assert.equal(registry.recovery.snapshot().incidents.length,4);
  const attempts:string[]=[];const result=await repairCompatibilityBatch(registry.recovery,async(id,hash)=>{attempts.push(id);return registry.repairCompatibility(id,hash);});
  assert.deepEqual(attempts,['test.first','test.fails','test.second']);assert.equal(result.complete,false);
  assert.deepEqual(Object.fromEntries(result.repairs.map(r=>[r.id,r.status])),{'test.first':'repaired','test.fails':'failed','test.second':'repaired','test.unsupported':'unavailable'});
  assert.equal(await registry.command('test.first','ping',null),42);assert.equal(await registry.command('test.second','ping',null),43);
  assert.deepEqual(new Set(result.remaining.map(i=>i.id)),new Set(['test.fails','test.unsupported']));
  const prompt=buildPluginRepairPrompt(registry.recovery.snapshot(),'zh');assert.match(prompt,/test.fails/);assert.match(prompt,/test.unsupported/);assert.doesNotMatch(prompt,/PRIVATE_BATCH_SENTINEL|test.first|test.second/);
  assert.equal(recoveryDiagnostic(registry.recovery.snapshot()).diagnosticScope.unobservedPlugins,'not_checked');
});
test('batch deduplicates package incidents and simultaneous requests while continuing after a rejected repair',async t=>{
  const store=new PluginRecoveryStore(await temporary(t),'2.0.0');await store.initialize();const hash='a'.repeat(64);
  await store.incident({id:'test.first',hash},'SERVICE_MEMBER_UNAVAILABLE','compatibility','confirmed',true);
  await store.incident({id:'test.first',hash},'PLUGIN_CLEANUP_FAILED','cleanup');
  await store.incident({id:'test.next',hash},'SERVICE_CONTRACT_UNSUPPORTED','compatibility','confirmed',true);
  const attempts:string[]=[],repair=async(id:string)=>{attempts.push(id);if(id==='test.first')throw Error('unavailable');await store.clear(id);return {applied:true};};
  const first=repairCompatibilityBatch(store,repair),second=repairCompatibilityBatch(store,repair);assert.equal(first,second);
  const result=await first;assert.deepEqual(attempts,['test.first','test.next']);assert.equal(result.repairs.length,2);assert.equal(result.complete,false);assert.ok(result.remaining.every(i=>i.id==='test.first'));
});
test('batch success requires both applied adapters and no remaining faults',async t=>{
  const store=new PluginRecoveryStore(await temporary(t),'2.0.0');await store.initialize();const hash='b'.repeat(64);
  for(const id of ['test.one','test.two'])await store.incident({id,hash},'SERVICE_CONTRACT_UNSUPPORTED','compatibility','confirmed',true);
  const uncleared=await repairCompatibilityBatch(store,async()=>({applied:true}));assert.equal(uncleared.complete,false);assert.equal(uncleared.remaining.length,2);
  const cleared=await repairCompatibilityBatch(store,async id=>{await store.clear(id);return {applied:true};});assert.equal(cleared.complete,true);assert.deepEqual(cleared.remaining,[]);assert.equal(cleared.repairs.length,2);
});
