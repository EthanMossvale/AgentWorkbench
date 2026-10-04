import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import type {AccountCatalog,Session,SshHost} from '../packages/contracts';
import type {ModelTarget,ModelTargetCatalog} from '../packages/model-api/types';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';

async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-target-catalog-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'member',name:'A',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',ownerId:'fixture',workspaceGeneration:'wg',identityFile:'unused',knownHostsFile:'unused'};
 const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'w',revision:1,selectionRevision:1,selectedAccountId:'codex',selectedClaudeAccountId:'claude',accounts:['codex','claude'].map(provider=>({id:provider,generation:'ag',provider:provider as 'codex'|'claude',status:'authenticated',observedAt:'now'}))};
 await store.update(s=>{s.hosts=[host];s.accountCatalogs={[host.id]:catalog};s.plugins={translation:{enabled:false}};});
 const calls:string[]=[],forbidden=async(..._args:unknown[])=>{calls.push('external');throw Error('Real requests are forbidden in this fixture');};
 const native:NonNullable<HostActions['nativeCodex']>={supports:()=>false,defaultDirectory:()=>directory,models:forbidden,connect:forbidden,close:async()=>{},dispose:async()=>{}};
 const remote={status:forbidden,createClaude:forbidden,loginCommand:forbidden,models:async()=>[{id:'fixture-claude',model:'fixture-claude',name:'Fixture Claude',isDefault:true,efforts:['low','high'],serviceTiers:[]}]};
 const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],nativeCodex:native,nativeAccounts:remote,modelFetcher:forbidden,translationFetcher:forbidden,runtimeExtensions:plugins.runtimes,accountCatalog:{list:async()=>structuredClone(catalog),select:forbidden,start:forbidden,status:forbidden,cancel:forbidden,dispose:async()=>{}}},()=>{});
 for(const [id,service] of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
 plugins.connectHost(({method,payload})=>controller.call(method,payload));
 const install=async(id:string,source:string)=>{
  const manifest={schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic model catalog lifecycle',capabilities:['host'],main:'main.mjs'},file=path.join(directory,id+'.zip');
  await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(file);return (await plugins.list()).find(p=>p.manifest.id===id)!;
 };
 return {directory,store,host,native,remote,plugins,controller,calls,install,targets:(refresh=true)=>controller.call('model-targets/list',{refresh}) as Promise<ModelTarget[]>,close:async()=>{await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('authenticated SSH Claude exposes synthetic native models while execution remains blocked',async()=>{
 const f=await fixture();try{
  const targets=await f.targets();assert.equal(targets.length,3);
  const claude=targets.find(t=>t.runtime==='claude')!,codex=targets.find(t=>t.runtime==='codex')!;
  assert.equal(claude.name,'Claude Code');assert.equal(claude.description,'A · SSH');assert.equal(claude.ready,false);assert.match(claude.unavailableReason!,/本机文件和工具执行桥尚未接通/);assert.equal(claude.selection,undefined);
  assert.equal(codex.ready,false);assert.match(codex.unavailableReason!,/尚未验收/);
  await assert.rejects(f.controller.call('session/create',{modelTargetId:claude.id}),/尚未完成执行验收/);
  assert.equal((await f.controller.call('runtime/models',{runtime:'claude',hostId:f.host.id}) as any[])[0].model,'fixture-claude');
  assert.equal(targets.find(t=>t.selection?.model==='fixture-claude')?.ready,false);
  assert.equal(f.store.snapshot().sessions.length,0);assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});

test('a verified Codex catalog is separate from the unavailable Claude account',async()=>{
 const f=await fixture();try{
  let catalogs=0;f.native.supports=(_host,s)=>s.binding.runtime==='codex';f.native.models=async(_host,s)=>{assert.equal(s.binding.runtime,'codex');catalogs++;return [{id:'synthetic',model:'synthetic',name:'Synthetic model',isDefault:true,efforts:[],serviceTiers:[]}];};
  const targets=await f.targets();assert.equal(catalogs,1);assert.equal(targets.filter(t=>t.runtime==='claude').length,2);assert.equal(targets.find(t=>t.runtime==='claude')?.ready,false);assert.equal(targets.find(t=>t.selection?.model==='synthetic')?.runtime,'codex');assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});

test('concurrent SSH catalog reads coalesce and a late account change cannot populate the cache',async()=>{
 const f=await fixture();try{
  let resolve!:(models:any[])=>void,reads=0;f.remote.models=()=>{reads++;return new Promise(r=>resolve=r);};
  const first=f.controller.call('runtime/models',{runtime:'claude',hostId:f.host.id,refresh:true}),second=f.controller.call('runtime/models',{runtime:'claude',hostId:f.host.id,refresh:true});
  assert.equal(reads,1);await f.store.update(s=>{s.accountCatalogs![f.host.id]!.accounts.find(a=>a.id==='claude')!.generation='changed';});
  resolve([{id:'stale',model:'stale',name:'Stale',isDefault:true,efforts:[],serviceTiers:[]}]);
  for(const result of await Promise.allSettled([first,second])){assert.equal(result.status,'rejected');if(result.status==='rejected')assert.match(result.reason.message,/账号已变化/);}
  f.remote.models=async()=>[];assert.ok(!(await f.targets(false)).some(t=>t.selection?.model==='stale'));assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});

test('an older broker error is visible without fake models or local account fallback',async()=>{
 const f=await fixture();try{
  f.remote.models=async()=>{throw Error('Synthetic old broker does not implement runtime/models');};
  const target=(await f.targets()).find(t=>t.runtime==='claude')!;assert.match(target.unavailableReason!,/old broker/);assert.equal(target.ready,false);assert.equal(target.selection,undefined);assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});

test('approved catalog plugins call, register and replace production consumers with lifecycle cleanup',async()=>{
 const f=await fixture();try{
  const observer=await f.install('test.target-observer',`export function activate(api){let hits=0,reads=0;api.services.intercept('models.targets','list',(next,...args)=>{hits++;return next(...args);});api.services.intercept('actions.native-accounts','models',(next,...args)=>{reads++;return next(...args);});api.registerCommand('hits',()=>hits);api.registerCommand('reads',()=>reads);}`);
  const extension=await f.install('test.target-label',`export function activate(api){
   let live=true;const service=api.services.get('models.targets'),original=service.list.bind(service);
   const release=api.services.override('models.targets',{list:async refresh=>{const rows=await original(refresh);return live?rows.map(t=>t.runtime==='claude'?{...t,unavailableReason:'Synthetic extension explanation'}:t):rows;}});
   api.registerCommand('list',()=>api.call('model-targets/list',{refresh:true}));
   api.runtimes.register({apiVersion:1,id:'plugin:test.catalog',name:'Synthetic runtime',description:'Catalog fixture',permissions:[{value:'default',label:'Default',description:'Synthetic'}],models:[{id:'fixture',model:'fixture',name:'Fixture model',isDefault:true,efforts:[],serviceTiers:[]}]},{async discover(){return {ready:true};},async run(){throw Error('No model turns in this fixture');},async stop(){}});
   return ()=>{live=false;release();};
  }`);
  await assert.rejects(f.plugins.setEnabled(extension.manifest.id,extension.hash,true),/Explicit approval/);
  await f.plugins.setEnabled(observer.manifest.id,observer.hash,true,true);await f.plugins.setEnabled(extension.manifest.id,extension.hash,true,true);
  await f.controller.call('runtime/catalog');
  const rows=await f.plugins.command(extension.manifest.id,'list',{}) as ModelTarget[],blocked=rows.find(t=>t.runtime==='claude')!,registered=rows.find(t=>t.runtime==='plugin:test.catalog')!;
  assert.equal(blocked.unavailableReason,'Synthetic extension explanation');assert.equal(blocked.ready,false);assert.ok(registered.ready);
  await f.controller.call('runtime/select',{runtime:registered.runtime,targetId:registered.id});assert.equal(f.store.snapshot().lastModelTargetId,registered.id);
  await assert.rejects(f.controller.call('session/create',{modelTargetId:blocked.id}),/尚未完成执行验收/);
  assert.ok((await f.plugins.command(observer.manifest.id,'hits',{}) as number)>=3);
  assert.ok((await f.plugins.command(observer.manifest.id,'reads',{}) as number)>=1);
  // A display replacement cannot satisfy the independent native execution gate.
  const release=f.plugins.services.override('models.targets',{list:async()=>[{...blocked,ready:true}]});
  const session=await f.controller.call('session/create',{modelTargetId:blocked.id}) as Session;assert.equal(session.status,'blocked');
  await assert.rejects(f.controller.call('draft/prepare',{sessionId:session.id,text:'Synthetic gate check'}),/验收|尚未/);release();
  await f.plugins.setEnabled(extension.manifest.id,extension.hash,false);
  assert.match((await f.targets()).find(t=>t.runtime==='claude')!.unavailableReason!,/尚未接通/);assert.ok(!(await f.targets()).some(t=>t.runtime===registered.runtime));assert.equal(f.store.snapshot().lastModelTargetId,registered.id);
  await assert.rejects(f.plugins.command(extension.manifest.id,'list',{}),/not found/);
  await f.plugins.setEnabled(extension.manifest.id,extension.hash,true);await f.controller.call('runtime/catalog');assert.ok((await f.targets()).some(t=>t.id===registered.id));
  await f.plugins.setEnabled(extension.manifest.id,extension.hash,false);await f.plugins.setEnabled(observer.manifest.id,observer.hash,false);
  const failed=await f.install('test.target-failure',`export function activate(api){api.services.override('models.targets',{list:()=>{throw Error('Must be removed');}});throw Error('Synthetic activation failure');}`);
  await f.plugins.setEnabled(failed.manifest.id,failed.hash,true,true);assert.equal((await f.plugins.list()).find(p=>p.manifest.id===failed.manifest.id)!.enabled,false);assert.equal((await f.targets()).length,3);
  assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});

test('late catalog calls complete without persisting extension metadata after disable',async()=>{
 const f=await fixture();let finish!:()=>void;try{
  const base=f.plugins.services.get<ModelTargetCatalog>('models.targets'),original=base.list.bind(base);let entered!:()=>void;const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>finish=r);
  const release=f.plugins.services.override('models.targets',{list:async(refresh:boolean)=>{entered();await hold;return original(refresh);}});
  const plugin=await f.install('test.target-late',`export function activate(api){let live=true;api.services.intercept('models.targets','list',async(next,...args)=>{const rows=await next(...args);return live?rows.map(t=>({...t,unavailableReason:'Late extension'})):rows;});return ()=>{live=false;};}`);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);const pending=f.targets();await started;await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);finish();
  assert.match((await pending).find(t=>t.runtime==='claude')!.unavailableReason!,/尚未接通/);release();
  const restarted=new StateStore(f.directory);await restarted.load();assert.ok(!JSON.stringify(restarted.snapshot()).includes('Late extension'));assert.deepEqual(f.calls,[]);
 }finally{finish?.();await f.close();}
});


test('runtime choice reads current catalogs without refreshing either SSH runtime',async()=>{
 const f=await fixture();try{
  let reads=0;const models=async()=>{reads++;return [{id:'cached',model:'cached',name:'Cached',isDefault:true,efforts:[],serviceTiers:[]}];};
  f.native.supports=(_host,s)=>s.binding.runtime==='codex';f.native.models=models;f.remote.models=models;
  const plugin=await f.install('test.choice-catalog',`export function activate(api){api.services.intercept('models.targets','list',async(next,refresh)=>{const rows=await next(refresh);return rows.map(t=>({...t,ready:true}));});}`);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  await f.targets(true);assert.equal(reads,2);
  for(const runtime of ['codex','claude']){
   const choice=await f.controller.call('runtime/choice',{runtime,hostId:f.host.id}) as {target:ModelTarget};
   assert.equal(choice.target.runtime,runtime);assert.equal(choice.target.selection?.model,'cached');
  }
  assert.equal(reads,2,'choosing must not await SSH model discovery');
  await f.targets(true);assert.equal(reads,4,'explicit refresh still discovers both catalogs');
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);
  await assert.rejects(f.controller.call('runtime/choice',{runtime:'claude',hostId:f.host.id}),/RUNTIME_MODEL_UNAVAILABLE/);
  assert.equal(f.store.snapshot().sessions.length,0);
 }finally{await f.close();}
});

test('first ordinary SSH listing discovers models and failed refresh retains the catalog',async()=>{
 const f=await fixture();try{let reads=0;f.remote.models=async()=>{reads++;return [{id:'first',model:'first',name:'First',isDefault:true,efforts:[],serviceTiers:[]}];};
 assert.ok((await f.targets(false)).some(t=>t.selection?.model==='first'));await f.targets(false);assert.equal(reads,1);
 f.remote.models=async()=>{throw Error('temporary network failure');};assert.ok((await f.targets(true)).some(t=>t.selection?.model==='first'));
 await f.store.update(s=>{s.accountCatalogs![f.host.id]!.accounts.find(a=>a.id==='claude')!.generation='new';});assert.ok(!(await f.targets(false)).some(t=>t.selection?.model==='first'));
 }finally{await f.close();}});

test('runtime choice probes once when the cached catalog has no ready target and reports the reason',async()=>{
 const f=await fixture();try{
  const models=async()=>[{id:'m',model:'m',name:'M',isDefault:true,efforts:[],serviceTiers:[]}];
  f.native.supports=(_host,s)=>s.binding.runtime==='codex';f.native.models=models;f.remote.models=models;
  let refreshed=false;
  const plugin=await f.install('test.choice-probe',`export function activate(api){api.services.intercept('models.targets','list',async(next,refresh)=>{const rows=await next(refresh);if(refresh)globalThis.__probed=true;return rows.map(t=>t.runtime==='claude'?{...t,ready:!!globalThis.__probed,unavailableReason:globalThis.__probed?undefined:'Install the local Claude CLI.'}:t);});}`);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  const choice=await f.controller.call('runtime/choice',{runtime:'claude',hostId:f.host.id}) as {target:ModelTarget};
  assert.equal(choice.target.runtime,'claude');refreshed=!!(globalThis as {__probed?:boolean}).__probed;assert.ok(refreshed);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);delete (globalThis as {__probed?:boolean}).__probed;
  const blocked=await f.install('test.choice-reason',`export function activate(api){api.services.intercept('models.targets','list',async(next,refresh)=>(await next(refresh)).map(t=>t.runtime==='claude'?{...t,ready:false,unavailableReason:'Install the local Claude CLI.'}:t));}`);
  await f.plugins.setEnabled(blocked.manifest.id,blocked.hash,true,true);
  await assert.rejects(f.controller.call('runtime/choice',{runtime:'claude',hostId:f.host.id}),/RUNTIME_MODEL_UNAVAILABLE: Install the local Claude CLI\./);
 }finally{await f.close();}
});
