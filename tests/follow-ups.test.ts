import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {FollowUpService} from '../apps/desktop/host/follow-ups';
import {FollowUpModeRegistry,recoverFollowUps} from '../packages/session-core/follow-ups';
import {UiPreferenceStore} from '../packages/ui-preferences/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import type {DraftPreview,Session,AppState} from '../packages/contracts';

const session=():Session=>({id:'s',title:'Fixture',projectId:null,status:'running',nativeTurnId:'t1',nativeTurnStatus:'inProgress',createdAt:'2026-09-30T00:00:00Z',pinned:false,archived:false,group:'',binding:{runtime:'codex',provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'vps'},messages:[]});
const preview=(id:string):DraftPreview=>({id,original:'原稿 '+id,translated:'Sent '+id,revision:1,sourceHash:'fixture-'+id,bypass:true,demo:false});
const until=async(check:()=>boolean)=>{for(let i=0;i<200;i++){if(check())return;await delay(5);}assert.ok(check(),'condition did not settle');};
async function fixture(t:test.TestContext){
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-follow-up-')),store=new StateStore(dir);await store.load();await store.update(s=>s.sessions=[session()]);
  const calls:{id:string;action?:string}[]=[];let fail=false,block=false,canSteer=true;
  const service=new FollowUpService({snapshot:()=>store.snapshot(),blocked:()=>block,canSteer:()=>canSteer,update:async fn=>{const value=await store.update(fn);service.observe();return value;},dispatch:async(id,p,action,turn,beforeDispatch)=>{beforeDispatch();calls.push({id:p.id,action});if(fail)throw Error('UNCONFIRMED');await store.update(s=>{s.sessions[0]!.status='running';s.sessions[0]!.nativeTurnId=p.id;s.sessions[0]!.nativeTurnStatus='inProgress';});}});
  const update=async(fn:(s:Session)=>void)=>{await store.update(s=>fn(s.sessions[0]!));service.observe();};
  t.after(async()=>{service.dispose();await delay(20);await rm(dir,{recursive:true,force:true,maxRetries:5});});
  return {dir,store,service,calls,get:()=>store.snapshot().sessions[0]!,update,setFail:(v:boolean)=>fail=v,setBlock:(v:boolean)=>block=v,setSteer:(v:boolean)=>canSteer=v};
}
test('explicit queue persists exact input, drains once in FIFO order after each successful turn',async t=>{
  const f=await fixture(t);await f.service.enqueue('s',preview('a'),'t1');await f.service.enqueue('s',preview('b'),'t1');await delay(20);assert.equal(f.calls.length,0);
  assert.equal(f.get().followUps![0]!.preview.translated,'Sent a');await f.update(s=>{s.status='idle';s.nativeTurnStatus='completed';});await until(()=>f.calls.length===1);await until(()=>f.get().followUps?.length===1);assert.equal(f.calls[0]!.id,'a');
  f.service.observe();await delay(20);assert.equal(f.calls.length,1);await f.update(s=>{s.status='idle';s.nativeTurnStatus='completed';});await until(()=>f.calls.length===2);await until(()=>f.get().followUps?.length===0);assert.deepEqual(f.calls.map(c=>c.id),['a','b']);
});
test('stop failure uncertainty and changed identities hold the queue without replay',async t=>{
  const f=await fixture(t);await f.service.enqueue('s',preview('a'),'t1');await f.service.pause('s');await f.update(s=>{s.status='idle';s.nativeTurnStatus='completed';});await delay(20);assert.equal(f.calls.length,0);assert.equal(f.get().followUps![0]!.status,'paused');
  await f.update(s=>s.binding.accountRef='other');await assert.rejects(f.service.send('s','a'),/BINDING_CHANGED/);assert.equal(f.calls.length,0);await f.update(s=>s.binding.accountRef='fixture');f.setFail(true);await assert.rejects(f.service.send('s','a'),/UNCONFIRMED/);assert.equal(f.get().followUps![0]!.status,'uncertain');await assert.rejects(f.service.send('s','a'));assert.equal(f.get().followUps![0]!.status,'uncertain');await assert.rejects(f.service.send('s','a'));await delay(20);assert.equal(f.calls.length,1);
});
test('manual queued steering and cancellation consume only the selected entry',async t=>{
  const f=await fixture(t);await f.service.enqueue('s',preview('a'),'t1');await f.service.enqueue('s',preview('b'),'t1');await f.service.cancel('s','b');await f.service.send('s','a');assert.deepEqual(f.calls,[{id:'a',action:'steer'}]);assert.equal(f.get().followUps?.length,0);await assert.rejects(f.service.send('s','a'));
});
test('runtime without steering queues normally and rejects premature manual steering',async t=>{
  const f=await fixture(t);f.setSteer(false);await f.service.enqueue('s',preview('a'),'t1');await assert.rejects(f.service.send('s','a'),/STEER_UNAVAILABLE/);assert.equal(f.calls.length,0);await f.update(s=>{s.status='idle';s.nativeTurnStatus='completed';});await f.service.send('s','a');assert.equal(f.calls.length,1);
});
test('restart holds unsent records, fences uncertain delivery and preserves malformed storage',async t=>{
  const f=await fixture(t);await f.service.enqueue('s',preview('a'),'t1');await f.service.enqueue('s',preview('b'),'t1');await f.update(s=>s.followUps![1]!.status='sending');const restored=await new StateStore(f.dir).load();assert.deepEqual(restored.sessions[0]!.followUps!.map(q=>q.status),['paused','uncertain']);assert.equal(restored.sessions[0]!.followUps![0]!.preview.original,'原稿 a');
  const damaged=JSON.stringify({...restored,sessions:[{...restored.sessions[0],followUps:[{id:'bad'}]}]});await writeFile(path.join(f.dir,'state.json'),damaged);await assert.rejects(new StateStore(f.dir).load(),/STORAGE_INVALID/);assert.equal(await readFile(path.join(f.dir,'state.json'),'utf8'),damaged);
});
test('mode registration replacement inversion and disable restore share the real catalog',()=>{
  const modes=new FollowUpModeRegistry();assert.equal(modes.resolve('steer',true),'steer');assert.equal(modes.resolve('steer',true,true),'queue');assert.equal(modes.resolve('queue',true,true),'steer');assert.equal(modes.resolve('queue',false,true),'queue');
  const a=modes.register({id:'plugin:test/later',label:'Later',description:'Fixture',action:'queue'}),b=modes.replace(a.id,{label:'Now',description:'Override',action:'steer'});assert.equal(modes.resolve(a.id,true),'steer');b.dispose();assert.equal(modes.resolve(a.id,true),'queue');a.dispose();assert.equal(modes.resolve(a.id,true),'steer');assert.throws(()=>modes.register({id:'queue',label:'Duplicate',description:'',action:'queue'}),/CONFLICT/);
});
test('follow-up preference is profile scoped, revision checked, restartable and resettable',async t=>{
  const f=await fixture(t),prefs=new UiPreferenceStore(f.dir);await prefs.load();assert.equal(prefs.get('composer.follow-up').value,'steer');await prefs.update({id:'composer.follow-up',value:'plugin:test/later',revision:0});await assert.rejects(prefs.update({id:'composer.follow-up',value:'queue',revision:0}),/CONFLICT/);const reopened=new UiPreferenceStore(f.dir);await reopened.load();assert.equal(reopened.get('composer.follow-up').value,'plugin:test/later');await reopened.update({id:'composer.follow-up',revision:reopened.get('composer.follow-up').revision,reset:true});assert.equal(reopened.get('composer.follow-up').value,'steer');
});
test('approved ZIP mode extension reaches preparation, replacement, late consumers and lifecycle rollback',async t=>{
  const f=await fixture(t),plugins=new PluginRegistry(f.dir);await plugins.initialize();await f.store.update(s=>s.plugins={translation:{enabled:false}});
  const controller=new WorkbenchController(f.store,new SecretStore(f.dir,{encrypt:()=>Buffer.from(''),decrypt:()=>''}),{runtimeExtensions:plugins.runtimes,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  for(const [id,service]of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  plugins.connectHost(({method,payload})=>controller.call(method,payload));t.after(async()=>{await controller.dispose();await plugins.dispose();});
  const add=async(id:string,code:string)=>{const file=path.join(f.dir,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({id,name:id,version:'1.0.0',schemaVersion:1,apiVersion:1,description:'Synthetic follow-up test',main:'host.mjs',capabilities:['host']}))},{name:'host.mjs',data:Buffer.from(code)}]));await plugins.importZip(file);const record=(await plugins.list()).find(p=>p.manifest.id===id)!;return {record,enable:()=>plugins.setEnabled(id,record.hash,true,true),disable:()=>plugins.setEnabled(id,record.hash,false)};};
  const plugin=await add('qa.followups',"export const activate=api=>{let calls=0;const m=api.services.get('sessions.follow-up-modes');const h=m.register({id:'plugin:qa.followups/later',label:'Fixture later',description:'Synthetic',action:'queue'});api.onDispose(()=>h.dispose());api.onDispose(api.services.intercept('sessions.follow-ups','enqueue',async(next,...args)=>{const result=await next(...args);calls++;return result;}));api.registerCommand('calls',()=>calls);}");await plugin.enable();
  // A registered production runtime keeps a real controller turn open.
  let finish!:()=>void;plugins.runtimes.register('qa.runtime',{apiVersion:1,id:'plugin:qa.runtime',name:'Fixture',description:'Fixture',permissions:[{value:'default',label:'Default',description:'Fixture'}]},{run:async()=>new Promise<void>(resolve=>finish=resolve),stop:async()=>finish?.(),steer:async()=>{}});
  await controller.call('runtime/catalog');const s=await controller.call('session/create',{runtime:'plugin:qa.runtime'}) as Session;
  const first=await controller.call('draft/prepare',{sessionId:s.id,text:'start'}) as DraftPreview;await controller.call('draft/submit',{sessionId:s.id,id:first.id,sourceHash:first.sourceHash});await until(()=>!!finish);
  const prepare=()=>controller.call('draft/prepare',{sessionId:s.id,text:'next',followUpMode:'plugin:qa.followups/later'}) as Promise<DraftPreview>;
  assert.equal((await prepare()).followUp?.action,'queue');const replacement=await add('qa.replace',"export const activate=api=>{const h=api.services.get('sessions.follow-up-modes').replace('plugin:qa.followups/later',{label:'Fixture now',description:'Synthetic',action:'steer'});api.onDispose(()=>h.dispose());}");await replacement.enable();assert.equal((await prepare()).followUp?.action,'steer');await replacement.disable();assert.equal((await prepare()).followUp?.action,'queue');
  const p=await prepare();await controller.call('draft/submit',{sessionId:s.id,id:p.id,sourceHash:p.sourceHash});assert.equal(f.store.snapshot().sessions.find(x=>x.id===s.id)!.followUps?.length,1);assert.equal(await plugins.command(plugin.record.manifest.id,'calls',{}),1);
  await plugin.disable();assert.equal((await controller.call('state/get') as AppState).followUpModes?.some(m=>m.id==='plugin:qa.followups/later'),false);assert.equal((await prepare()).followUp?.action,'steer');await plugin.enable();assert.equal((await prepare()).followUp?.action,'queue');
  const failed=await add('qa.failed',"export const activate=api=>{const h=api.services.get('sessions.follow-up-modes').register({id:'plugin:qa.failed/later',label:'Bad',description:'Synthetic',action:'queue'});api.onDispose(()=>h.dispose());throw Error('Fixture activation failure');}");await failed.enable();assert.ok((await plugins.list()).find(p=>p.manifest.id===failed.record.manifest.id)?.error);assert.equal((await controller.call('state/get') as AppState).followUpModes?.some(m=>m.id==='plugin:qa.failed/later'),false);
  await controller.call('session/stop',{sessionId:s.id});assert.equal(f.store.snapshot().sessions.find(x=>x.id===s.id)!.followUps![0]!.status,'paused');finish();
});



test('stop fences queue dispatch after asynchronous validation',async t=>{
  const f=await fixture(t);f.service.dispose();let resume!:()=>void,entered=false,dispatched=0;
  const service=new FollowUpService({snapshot:()=>f.store.snapshot(),update:fn=>f.store.update(fn),blocked:()=>false,canSteer:()=>true,dispatch:async(id,p,action,turn,beforeDispatch)=>{entered=true;await new Promise<void>(resolve=>resume=resolve);beforeDispatch();dispatched++;}});t.after(()=>service.dispose());
  await service.enqueue('s',preview('late'),'t1');const sending=service.send('s','late');await until(()=>entered);await service.pause('s');resume();await assert.rejects(sending,/FOLLOW_UP_STOPPED/);assert.equal(dispatched,0);assert.equal(f.get().followUps![0]!.status,'paused');
});

test('queue save failure stays visible but cannot block stopping the active runtime',async t=>{
  const f=await fixture(t);f.service.dispose();const plugins=new PluginRegistry(f.dir);await plugins.initialize();await f.store.update(s=>s.plugins={translation:{enabled:false}});
  let finish:()=>void=()=>{},started=false,stops=0;
  plugins.runtimes.register('qa.stop',{apiVersion:1,id:'plugin:qa.stop',name:'Fixture',description:'Fixture',permissions:[{value:'default',label:'Default',description:'Fixture'}]},{run:async()=>new Promise<void>(resolve=>{started=true;finish=resolve;}),stop:async()=>{stops++;finish();}});
  const controller=new WorkbenchController(f.store,new SecretStore(f.dir,{encrypt:()=>Buffer.from(''),decrypt:()=>''}),{runtimeExtensions:plugins.runtimes,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  t.after(async()=>{finish();await controller.dispose();await plugins.dispose();});
  await controller.call('runtime/catalog');const s=await controller.call('session/create',{runtime:'plugin:qa.stop'}) as Session;
  const p=await controller.call('draft/prepare',{sessionId:s.id,text:'start'}) as DraftPreview;await controller.call('draft/submit',{sessionId:s.id,id:p.id,sourceHash:p.sourceHash});await until(()=>started);
  const running=f.store.snapshot().sessions.find(item=>item.id===s.id)!;await controller.followUps.enqueue(s.id,preview('held'),running.nativeTurnId!);
  const update=f.store.update.bind(f.store);let rejectNext=true;
  f.store.update=async change=>{if(rejectNext){rejectNext=false;throw Error('DISK_FULL');}return update(change);};
  const error=await controller.call('session/stop',{sessionId:s.id}).then(()=>undefined,error=>error);
  assert.equal(stops,1,'the runtime receives Stop even if pausing its queue cannot be saved');assert.equal(error,undefined);
  const current=(await controller.call('state/get') as AppState).sessions.find(item=>item.id===s.id)!;
  assert.equal(current.status,'idle');assert.match(current.followUpError??'',/队列状态未能保存/);assert.equal(current.followUps?.length,1);
});

test('persistence failure holds the automatic queue visibly without a retry loop',async t=>{
  const f=await fixture(t);await f.service.enqueue('s',preview('disk'),'t1');f.service.dispose();await f.store.update(s=>{s.sessions[0]!.status='idle';s.sessions[0]!.nativeTurnStatus='completed';});let writes=0,dispatched=0,notified=0;
  const service=new FollowUpService({snapshot:()=>f.store.snapshot(),update:async()=>{writes++;throw Error('DISK_FULL');},blocked:()=>false,canSteer:()=>true,dispatch:async()=>{dispatched++;}});t.after(()=>service.dispose());service.subscribe(()=>notified++);service.observe();await until(()=>!!service.status('s').error);const initial=writes;for(let i=0;i<5;i++)service.observe();await delay(20);assert.equal(writes,initial);assert.equal(dispatched,0);assert.ok(notified);assert.equal(f.get().followUps![0]!.status,'queued');
});
