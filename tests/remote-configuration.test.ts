import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {RemoteConfigurationRegistry,WorkbenchConfigurationAdapter,remoteConfigurationScript,type RemoteConfigurationAdapter} from '../packages/remote-account-catalog/configuration';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import type {SshHost,Session} from '../packages/contracts';

const host:SshHost={id:'admin',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',ownerId:'fixture',workspaceGeneration:'g',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts')};
const row=(name='fixture')=>({installed:true,running:true,currentVersion:name,bundledVersion:'new',canInstall:false,canUpdate:true,canUninstall:true});
function adapter(name='core'):RemoteConfigurationAdapter{return {status:async()=>row(name),plan:async(_h,operation)=>({token:'fixture',operation,currentVersion:name,version:'new',targets:['/opt/fixture/program'],preserves:['accounts']}),apply:async()=>row(name)};}

test('configuration plans bind exact SSH identity, component, expiry and one explicit attempt',async()=>{
 let now=0,calls=0;const a=adapter();a.apply=async()=>{calls++;throw Error('Unknown receipt');};const service=new RemoteConfigurationRegistry(a,()=>now);
 await assert.rejects(service.list({...host,role:'workspace'}),/root/);
 let plan=await service.plan(host,'workbench','update');
 await assert.rejects(service.apply({...host,knownHostsFile:path.resolve('another')},'workbench',plan.id),/变化/);
 await assert.rejects(service.apply(host,'another',plan.id));assert.equal(calls,0);
 now=300001;await assert.rejects(service.apply(host,'workbench',plan.id),/过期/);
 plan=await service.plan(host,'workbench','update');await assert.rejects(service.apply(host,'workbench',plan.id),/Unknown/);
 await assert.rejects(service.apply(host,'workbench',plan.id),/过期/);assert.equal(calls,1);
});

test('late results and plans from disabled, restored or replaced adapters are rejected',async()=>{
 const service=new RemoteConfigurationRegistry(adapter());let release!:(v:any)=>void;
 const pending=new Promise<any>(r=>release=r),a=adapter('plugin');a.plan=()=>pending;
 const handle=service.replace('workbench',a),plan=service.plan(host,'workbench','update');handle.dispose();release({token:'late',operation:'update',targets:['/opt/fixture/program'],preserves:[]});await assert.rejects(plan,/变化/);
 const core=adapter();core.status=()=>new Promise(r=>release=r);const directory=new RemoteConfigurationRegistry(core),list=directory.list(host),h=directory.replace('workbench',adapter());h.dispose();release(row());assert.deepEqual(await list,[]);
 const p=await service.plan(host,'workbench','update'),replacement=service.replace('workbench',adapter('other'));replacement.dispose();await assert.rejects(service.apply(host,'workbench',p.id),/过期/);
});

test('configuration adapters receive only an explicit management request and ASCII remote code',async()=>{
 const script=remoteConfigurationScript({method:'status'}),payloads=[...script.matchAll(/b64decode\('([^']+)'\)/g)].map(m=>JSON.parse(Buffer.from(m[1]!,'base64').toString()));
 assert.equal(payloads.length,2);assert.deepEqual(payloads[1].request,{method:'status'});
 for(const content of [...Object.values(payloads[0].sources),payloads[1].source])assert.match(content as string,/^[\x00-\x7f]*$/);
 assert.ok(payloads[0].sources['claude_session.py']);assert.ok(payloads[1].known['broker.py'].length);
 assert.equal(script.includes("sys.modules['setup'].dispatch"),false);
 const client=new WorkbenchConfigurationAdapter(async()=>({exitCode:0,signal:null,stderr:'not exposed',stdout:JSON.stringify({ok:false,error:'PRIVATE_DIAGNOSTIC_MUST_NOT_LEAK'})}));
 await assert.rejects(client.status(host),error=>/未确认/.test(String(error))&&!/PRIVATE/.test(String(error)));
});

async function fixture(actions:Partial<HostActions>={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-config-test-')),store=new StateStore(directory);await store.load();
 const member={...host,id:'member',username:'member',role:'workspace' as const};await store.update(s=>{s.hosts=[host,member];s.activeWorkspaceId=member.id;});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>{throw Error('No secrets');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],...actions},()=>{});
 const core=controller.remoteConfigurations.replace('workbench',adapter());
 const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();
 for(const [id,value]of Object.entries(controller.developmentServices()))if(value)plugins.services.register(id,value,{version:1});plugins.connectHost(({method,payload})=>controller.call(method,payload));
 const install=async(id:string,source:string)=>{const file=path.join(directory,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic configuration lifecycle',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(file);return (await plugins.list()).find(p=>p.manifest.id===id)!;};
 return {directory,store,member,controller,plugins,install,close:async()=>{await plugins.dispose();core.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}
const pluginSource=(name:string,fail=false)=>`export function activate(api){
 const registry=api.services.get('remote.configurations'),status={installed:true,running:false,currentVersion:'${name}',bundledVersion:'fixture',canInstall:false,canUpdate:true,canUninstall:true};
 const adapter={status:async()=>status,plan:async(host,operation)=>({token:'fixture',operation,targets:['/opt/fixture/program'],preserves:['profiles']}),apply:async()=>status};
 const added=registry.register('${name}',{id:'config',label:'Synthetic extension',adapter}),replacement=registry.replace('workbench',adapter);
 api.onDispose(()=>{replacement.dispose();added.dispose();});
 api.registerCommand('rows',()=>api.call('remote-configuration/list',{id:'admin'}));
 ${fail?"throw Error('Synthetic activation failure');":''}
}`;

test('approved plugins register real configuration rows and commands, coexist and restore on disable or failure',async()=>{
 const f=await fixture();try{
  const p=await f.install('test.config-a',pluginSource('test.config-a'));await assert.rejects(f.plugins.setEnabled(p.manifest.id,p.hash,true),/Explicit approval/);await f.plugins.setEnabled(p.manifest.id,p.hash,true,true);
  let rows:any=await f.plugins.command(p.manifest.id,'rows',{});assert.deepEqual(rows.map((r:any)=>r.id),['workbench','test.config-a:config']);assert.equal(rows[0].currentVersion,'test.config-a');
  const plan:any=await f.controller.call('remote-configuration/plan',{id:host.id,configurationId:'test.config-a:config',operation:'update'});
  const result:any=await f.controller.call('remote-configuration/apply',{id:host.id,configurationId:plan.configurationId,planId:plan.id,confirm:true});assert.equal(result.currentVersion,'test.config-a');
  const p2=await f.install('test.config-b',pluginSource('test.config-b'));await f.plugins.setEnabled(p2.manifest.id,p2.hash,true,true);assert.equal((await f.controller.remoteConfigurations.list(host))[0]!.currentVersion,'test.config-b');
  await f.plugins.setEnabled(p.manifest.id,p.hash,false);assert.equal((await f.controller.remoteConfigurations.list(host))[0]!.currentVersion,'test.config-b');
  await f.plugins.setEnabled(p2.manifest.id,p2.hash,false);assert.equal((await f.controller.remoteConfigurations.list(host))[0]!.currentVersion,'core');
  await f.plugins.setEnabled(p.manifest.id,p.hash,true);rows=await f.controller.remoteConfigurations.list(host);assert.equal(rows.length,2);
  const failed=await f.install('test.config-fail',pluginSource('test.config-fail',true));await f.plugins.setEnabled(failed.manifest.id,failed.hash,true,true);rows=await f.controller.remoteConfigurations.list(host);assert.equal(rows.length,2);assert.equal(rows[0].currentVersion,'test.config-a');
  await f.plugins.setEnabled(p.manifest.id,p.hash,false);assert.equal((await f.controller.remoteConfigurations.list(host)).length,1);
 }finally{await f.close();}
});

test('maintenance confirmation fences both runtimes and all saved connections until the receipt',async()=>{
 let release!:(v:any)=>void,started!:()=>void;const pending=new Promise<any>(r=>release=r),entered=new Promise<void>(r=>started=r),f=await fixture();
 try{
  const a=adapter();a.apply=async()=>{started();return pending;};const handle=f.controller.remoteConfigurations.replace('workbench',a);
  const p:any=await f.controller.call('remote-configuration/plan',{id:host.id,configurationId:'workbench',operation:'update'});
  await assert.rejects(f.controller.call('remote-configuration/apply',{id:host.id,configurationId:'workbench',planId:p.id}),/确认/);
  const applying=f.controller.call('remote-configuration/apply',{id:host.id,configurationId:'workbench',planId:p.id,confirm:true});await entered;
  assert.equal(f.controller.hasActiveSessionWork(),true);
  for(const id of [host.id,f.member.id])for(const method of ['accounts/list','accounts/setup-apply','native-accounts/create-claude','codex-auth/start','remote-cli/apply'])await assert.rejects(f.controller.call(method,{id}),/维护/);
  for(const runtime of ['codex','claude']){
   const s={id:runtime,projectId:null,pinned:false,archived:false,group:'',title:'Synthetic',status:'idle',createdAt:'now',messages:[],binding:{runtime,provider:runtime==='claude'?'anthropic':'openai',hostId:f.member.id,executionId:'local-device',egress:'vps',accountRef:'fixture',accountRuntime:'native-owner'}} as Session;
   await f.store.update(state=>{state.sessions.push(s);});await assert.rejects(f.controller.call('draft/prepare',{sessionId:runtime,text:'Never sent'}),/维护/);
  }
  await assert.rejects(f.controller.call('host/remove',{id:f.member.id,confirm:true}),/回执/);
  let disposed=false;const disposal=f.controller.dispose().then(()=>{disposed=true;});await new Promise(r=>setTimeout(r,10));assert.equal(disposed,false);
  release({...row(),running:false});await applying;await disposal;assert.equal(disposed,true);handle.dispose();
 }finally{release?.({...row(),running:false});await f.close();}
});

test('running, uncertain and pending local work prevents any remote configuration mutation',async()=>{
 const f=await fixture();let applies=0;try{
  const a=adapter();a.apply=async()=>{applies++;return row();};f.controller.remoteConfigurations.replace('workbench',a);
  for(const status of ['running','uncertain'] as const){await f.store.update(state=>{state.sessions=[{id:'fixture',projectId:null,pinned:false,archived:false,group:'',title:'Synthetic',createdAt:'now',status,messages:[],binding:{runtime:'claude',provider:'anthropic',hostId:f.member.id,executionId:'local-device',egress:'vps',accountRef:'fixture'}} as Session];});
   const p:any=await f.controller.call('remote-configuration/plan',{id:host.id,configurationId:'workbench',operation:'update'});await assert.rejects(f.controller.call('remote-configuration/apply',{id:host.id,configurationId:'workbench',planId:p.id,confirm:true}),/会话/);
  }assert.equal(applies,0);
 }finally{await f.close();}
});

test('fresh catalog receipts after configuration apply invalidate old model capability caches',async()=>{
 let reads=0;const f=await fixture({accountCatalog:{list:async()=>{reads++;return {source:'native-owner',availability:'ready',authorityId:'fixture',generation:'g',workspaceId:'w',revision:reads,selectionRevision:0,accounts:[]};},select:async()=>{throw Error('No selection');},start:async()=>{throw Error('No login');},status:async()=>{throw Error('No login');},cancel:async()=>{throw Error('No login');},dispose:async()=>{}}});
 try{(f.controller as any).modelCatalogs.set('stale',[]);(f.controller as any).claudeRemoteCapabilities.add('stale');const p:any=await f.controller.call('remote-configuration/plan',{id:host.id,configurationId:'workbench',operation:'update'});await f.controller.call('remote-configuration/apply',{id:host.id,configurationId:'workbench',planId:p.id,confirm:true});assert.equal(reads,2);assert.equal((f.controller as any).modelCatalogs.size,0);assert.equal((f.controller as any).claudeRemoteCapabilities.size,0);assert.equal(f.store.snapshot().accountCatalogs?.[f.member.id]?.availability,'ready');}finally{await f.close();}
});

test('automatic adapters are opt-in compatible, preserve unknown attempts and allow busy deferral',async()=>{
 const service=new RemoteConfigurationRegistry(adapter());await assert.rejects(service.configure(host,'workbench',0,true),/UNSUPPORTED/);assert.equal(await service.autoUpdate(host,'workbench'),undefined);
 let revision=0,enabled=false,attempts=0,defer=true,unknown=false;
 const a:RemoteConfigurationAdapter={...adapter(),status:async()=>({...row(),installedRevision:1,bundledRevision:2,policy:{schemaVersion:1,revision,autoUpdate:enabled}}),configure:async(_h,r,value)=>{if(r!==revision)throw Error('Conflict');revision++;enabled=value;return a.status(host);},autoUpdate:async()=>{attempts++;if(unknown)throw Error('Unknown receipt');return defer?undefined:{...await a.status(host),currentVersion:'new',installedRevision:2};}};
 service.replace('workbench',a);await service.autoUpdate(host,'workbench');assert.equal(attempts,0);
 const preview=await service.plan(host,'workbench','update');await service.configure(host,'workbench',0,true);
 await assert.rejects(service.apply(host,'workbench',preview.id),/过期/);await assert.rejects(service.configure(host,'workbench',0,false),/Conflict/);
 await service.autoUpdate(host,'workbench');await service.autoUpdate(host,'workbench');assert.equal(attempts,2);
 defer=false;unknown=true;await assert.rejects(service.autoUpdate(host,'workbench'),/Unknown/);await service.autoUpdate(host,'workbench');assert.equal(attempts,3);
});

test('automatic updates through approved registered and replacement plugins use the production idle scheduler',async()=>{
 const f=await fixture();try{
  const source=`export function activate(api){
   const service=api.services.get('remote.configurations');let policy={schemaVersion:1,revision:0,autoUpdate:false},attempts=0,installedRevision=1;
   const status=()=>({installed:true,running:true,currentVersion:installedRevision===1?'old':'new',bundledVersion:'new',installedRevision,bundledRevision:2,canInstall:false,canUpdate:true,canUninstall:true,policy});
   const adapter={status:async()=>status(),plan:async(host,operation)=>({token:'fixture',operation,targets:['/opt/fixture/program'],preserves:[]}),apply:async()=>status(),configure:async(host,revision,autoUpdate)=>{if(revision!==policy.revision)throw Error('Conflict');policy={...policy,revision:revision+1,autoUpdate};return status();},autoUpdate:async()=>{attempts++;installedRevision=2;return {...status(),running:false};}};
   const registered=service.register('test.config-auto',{id:'config',label:'Automatic configuration',adapter}),replaced=service.replace('workbench',adapter);
   api.onDispose(()=>{replaced.dispose();registered.dispose();});api.registerCommand('attempts',()=>attempts);
   api.registerCommand('enable',()=>api.call('remote-configuration/configure',{id:'admin',configurationId:registered.id,revision:policy.revision,autoUpdate:true}));
  }`;
  const p=await f.install('test.config-auto',source);await f.plugins.setEnabled(p.manifest.id,p.hash,true,true);
  await f.controller.maintainRemote();assert.equal(await f.plugins.command(p.manifest.id,'attempts',{}),0);
  await f.plugins.command(p.manifest.id,'enable',{});
  for(const status of ['running','uncertain'] as const){await f.store.update(s=>{s.sessions=[{id:'active',projectId:null,title:'Synthetic',pinned:false,archived:false,group:'',createdAt:'now',status,binding:{hostId:f.member.id,runtime:'claude',provider:'anthropic',accountRef:'fixture',executionId:'local-device',egress:'vps'},messages:[]}];});await f.controller.maintainRemote();assert.equal(await f.plugins.command(p.manifest.id,'attempts',{}),0);}
  await f.store.update(s=>{s.sessions=[];});
  (f.controller as any).remoteStorageMaintenance.add((f.controller as any).maintenanceKey(host,'codex'));await f.controller.maintainRemote();assert.equal(await f.plugins.command(p.manifest.id,'attempts',{}),0);
  (f.controller as any).remoteStorageMaintenance.clear();
  await f.controller.maintainRemote();assert.equal(await f.plugins.command(p.manifest.id,'attempts',{}),1);
  await f.controller.maintainRemote();assert.equal(await f.plugins.command(p.manifest.id,'attempts',{}),1);
  await f.plugins.setEnabled(p.manifest.id,p.hash,false);await f.controller.maintainRemote();assert.equal((await f.controller.remoteConfigurations.list(host))[0]!.policy,undefined);
 }finally{await f.close();}
});

test('a disabled adapter cannot publish late configuration writes or start a scheduled mutation',async()=>{
 const service=new RemoteConfigurationRegistry(adapter());let release!:(value:any)=>void,attempts=0;
 const pending=new Promise<any>(r=>release=r),value={...row(),installedRevision:0,bundledRevision:1,policy:{schemaVersion:1 as const,revision:1,autoUpdate:true}};
 const a:RemoteConfigurationAdapter={...adapter(),status:()=>pending,configure:()=>pending,autoUpdate:async()=>{attempts++;return value;}};
 let handle=service.replace('workbench',a);const automatic=service.autoUpdate(host,'workbench');handle.dispose();release(value);await assert.rejects(automatic,/变化/);assert.equal(attempts,0);
 handle=service.replace('workbench',a);const saving=service.configure(host,'workbench',0,true);handle.dispose();await assert.rejects(saving,/变化/);
});

test('configuration policy receipts freeze connection edits and shutdown waits without interrupting running work',async()=>{
 const f=await fixture();let release!:(value:any)=>void,entered!:()=>void;const pending=new Promise<any>(r=>release=r),started=new Promise<void>(r=>entered=r);
 try{
  const a:RemoteConfigurationAdapter={...adapter(),configure:async()=>{entered();return pending;},autoUpdate:async()=>undefined};f.controller.remoteConfigurations.replace('workbench',a);
  const saving=f.controller.call('remote-configuration/configure',{id:host.id,configurationId:'workbench',revision:0,autoUpdate:true});await started;
  await assert.rejects(f.controller.call('host/remove',{id:host.id,confirm:true}),/回执/);
  let disposed=false;const disposal=f.controller.dispose().then(()=>{disposed=true;});await new Promise(r=>setTimeout(r,10));assert.equal(disposed,false);
  release({...row(),policy:{schemaVersion:1,revision:1,autoUpdate:true}});await saving;await disposal;assert.equal(disposed,true);
 }finally{release?.({...row(),policy:{schemaVersion:1,revision:1,autoUpdate:true}});await f.close();}
});

test('connection identity changed during scheduler discovery cannot update the old destination',async()=>{
 const f=await fixture();let release!:(value:any)=>void,entered!:()=>void,attempts=0;const pending=new Promise<any>(r=>release=r),started=new Promise<void>(r=>entered=r);
 try{
  const a:RemoteConfigurationAdapter={...adapter(),status:async()=>{entered();return pending;},configure:async()=>row(),autoUpdate:async()=>{attempts++;return row();}};f.controller.remoteConfigurations.replace('workbench',a);
  const cycle=f.controller.maintainRemote();await started;await f.store.update(s=>{s.hosts[0]!.hostname='changed.invalid';});
  release({...row(),installedRevision:0,bundledRevision:1,policy:{schemaVersion:1,revision:1,autoUpdate:true}});await cycle;assert.equal(attempts,0);
 }finally{release?.(row());await f.close();}
});
