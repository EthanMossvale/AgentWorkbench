import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PluginRegistry, parseManifest, type PluginRegistryOptions} from '../packages/plugins-core';
import {PluginRecoveryStore, readSafeMode, writeSafeMode} from '../packages/plugins-core/recovery';
import {checkCompatibility, validateRequirements} from '../packages/plugins-core/compatibility';
import {encodeZip} from '../packages/native-resources/archive';
import {createRecoveryPresentationGate} from '../apps/desktop/host/plugin-recovery-presentation';

async function fixture(t:test.TestContext, source='export function activate(api){api.registerCommand("ping",()=>"ok");}', requires?:unknown, options:PluginRegistryOptions={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const registry=new PluginRegistry(directory,()=>{},options);await registry.initialize();t.after(()=>registry.dispose());
  const manifest={schemaVersion:1,apiVersion:1,id:'test.recovery',name:'Recovery fixture',version:'1.0.0',description:'Synthetic',capabilities:['host'],main:'main.mjs',...(requires?{requires}:{})};
  const zip=path.join(directory,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
  await registry.importZip(zip);return {directory,registry,record:(await registry.list())[0]!};
}
test('legacy v1 remains supported but is explicitly unchecked; new requirements are bounded',()=>{
  assert.deepEqual(checkCompatibility(undefined,'1.2.3',[]),{status:'unchecked',issues:[]});
  for(const invalid of [null,[],{extra:1},{services:[{id:'core',version:0,members:[]}]},{services:[{id:'core',version:1,members:['__proto__']}]},{host:null},{host:false},{host:{min:'latest'}},{host:{min:'2.0.0',before:'1.0.0'}}])assert.throws(()=>validateRequirements(invalid));
  assert.throws(()=>parseManifest({apiVersion:2}),/PLUGIN_API_VERSION_UNSUPPORTED/);
});
test('host version bounds, missing contracts and missing members never pretend to be repairable',()=>{
  assert.equal(checkCompatibility({host:{min:'1.0.0',before:'2.0.0'}},'2.0.0',[]).issues[0]?.repairable,false);
  assert.equal(checkCompatibility({services:[{id:'core',version:1,members:['read']}]},'1.0.0',[]).issues[0]?.code,'SERVICE_UNAVAILABLE');
  assert.equal(checkCompatibility({services:[{id:'core',version:1,members:['read']}]},'1.0.0',[{id:'core',members:[],contractVersion:1}]).issues[0]?.code,'SERVICE_MEMBER_UNAVAILABLE');
});
test('safe mode never loads third-party host code, preserves approval/preferences, and rejects enable',async t=>{
  const {directory,registry,record}=await fixture(t);await registry.setEnabled(record.manifest.id,record.hash,true,true);
  const before=await readFile(path.join(directory,'plugins.json'),'utf8');await registry.dispose();await writeSafeMode(directory,true);
  const safe=new PluginRegistry(directory);await safe.initialize();t.after(()=>safe.dispose());
  assert.equal((await safe.list())[0]!.enabled,false);assert.equal((await safe.list())[0]!.requestedEnabled,true);assert.equal((await safe.list())[0]!.origin,'third-party');
  await assert.rejects(safe.command(record.manifest.id,'ping',{}));await assert.rejects(safe.setEnabled(record.manifest.id,record.hash,true,true),/PLUGIN_SAFE_MODE_ACTIVE/);
  assert.equal(await readFile(path.join(directory,'plugins.json'),'utf8'),before);
  await writeSafeMode(directory,false);const normal=new PluginRegistry(directory);await normal.initialize();t.after(()=>normal.dispose());assert.equal(await normal.command(record.manifest.id,'ping',{}),'ok');
});
test('unreadable manifests remain visible in durable diagnosis, including unsupported API versions',async t=>{
  const {directory,registry}=await fixture(t);
  for(const [id,value] of [['test.corrupt','{'],['test.future','{"apiVersion":2}']] as const){await mkdir(path.join(directory,'plugins',id));await writeFile(path.join(directory,'plugins',id,'workbench.plugin.json'),value);}
  await registry.list();assert.ok(registry.recovery.snapshot().incidents.some(i=>i.id==='test.future'&&i.code==='PLUGIN_API_VERSION_UNSUPPORTED'));assert.ok(registry.recovery.snapshot().incidents.some(i=>i.id==='test.corrupt'&&i.code==='PLUGIN_PACKAGE_INVALID'));
  const reboot=new PluginRegistry(directory);await reboot.initialize();t.after(()=>reboot.dispose());assert.ok(reboot.recovery.snapshot().incidents.some(i=>i.id==='test.corrupt'));
});
test('corrupt preferences are retained and cannot be overwritten by a recovery toggle',async t=>{
  const {directory,registry,record}=await fixture(t);await registry.dispose();await writeFile(path.join(directory,'plugins.json'),'{broken');
  const broken=new PluginRegistry(directory);await broken.initialize();t.after(()=>broken.dispose());assert.ok(broken.recovery.snapshot().incidents.some(i=>i.code==='PLUGIN_PREFERENCES_INVALID'));
  await assert.rejects(broken.setEnabled(record.manifest.id,record.hash,true,true),/PLUGIN_PREFERENCES_INVALID/);assert.equal(await readFile(path.join(directory,'plugins.json'),'utf8'),'{broken');
});
test('concurrent preference edits fail closed without replacing externally changed bytes',async t=>{
  const {directory,registry,record}=await fixture(t);const other=JSON.stringify({version:1,entries:{}});await writeFile(path.join(directory,'plugins.json'),other);
  await assert.rejects(registry.setEnabled(record.manifest.id,record.hash,true,true),/PLUGIN_PREFERENCES_CONFLICT/);assert.equal(await readFile(path.join(directory,'plugins.json'),'utf8'),other);assert.equal((await registry.list())[0]!.enabled,false);
});
test('activation rejection is attributed, disabled once, persisted and never logs raw errors',async t=>{
  const {directory,registry,record}=await fixture(t,'export function activate(){throw Error("synthetic-secret-and-private-path");}');
  await registry.setEnabled(record.manifest.id,record.hash,true,true);assert.equal((await registry.list())[0]!.enabled,false);
  const ledger=await readFile(path.join(directory,'plugin-recovery.json'),'utf8');assert.match(ledger,/PLUGIN_HOST_ACTIVATION_FAILED/);assert.doesNotMatch(ledger,/synthetic-secret-and-private-path/);
  const reboot=new PluginRegistry(directory);await reboot.initialize();t.after(()=>reboot.dispose());assert.equal((await reboot.list())[0]!.error,'PLUGIN_HOST_ACTIVATION_FAILED');
});
test('async activation timeout fences late registrations and executes late cleanup',async t=>{
  const key='awbRecoveryLate'+Date.now();
  const {registry,record}=await fixture(t,`export async function activate(api){await new Promise(r=>setTimeout(r,80));try{api.registerCommand('late',()=>1);}catch{}return()=>{globalThis['${key}']=true;};}`,undefined,{activationTimeoutMs:15});
  await registry.setEnabled(record.manifest.id,record.hash,true,true);assert.equal((await registry.list())[0]!.enabled,false);assert.ok(registry.recovery.snapshot().incidents.some(i=>i.code==='PLUGIN_ACTIVATION_TIMEOUT'));
  await new Promise(r=>setTimeout(r,120));assert.equal((globalThis as any)[key],true);delete (globalThis as any)[key];await assert.rejects(registry.command(record.manifest.id,'late',null));
});
test('uncooperative asynchronous cleanup does not block core restoration',async t=>{
  const {registry,record}=await fixture(t,'export function activate(api){api.services.override("core",{read:()=>2});api.onDispose(()=>new Promise(()=>{}));}',undefined,{cleanupTimeoutMs:15});const core={read:()=>1};registry.services.register('core',core);
  await registry.setEnabled(record.manifest.id,record.hash,true,true);await registry.setEnabled(record.manifest.id,record.hash,false);assert.equal(core.read(),1);assert.ok(registry.recovery.snapshot().incidents.some(i=>i.code==='PLUGIN_CLEANUP_FAILED'));
});
test('a known old service contract can be repaired once using a hash-pinned host adapter',async t=>{
  const requires={services:[{id:'core',version:1,members:['readOld']}]};
  const {directory,registry,record}=await fixture(t,'export function activate(api){const core=api.services.get("core");api.registerCommand("ping",()=>core.readOld());api.services.intercept("core","readOld",next=>next()+1);}',requires);
  const core={readNew:()=>41};registry.services.register('core',core,{version:2,adapters:[{version:1,members:{readOld:'readNew'}}]});
  await registry.setEnabled(record.manifest.id,record.hash,true,true);assert.equal(core.readNew(),41);assert.equal((await registry.list())[0]!.enabled,false);assert.equal(registry.recovery.snapshot().incidents.at(-1)?.repairable,true);
  assert.equal((await registry.repairCompatibility(record.manifest.id,record.hash)).applied,true);assert.equal(await registry.command(record.manifest.id,'ping',null),42);
  await registry.setEnabled(record.manifest.id,record.hash,false);assert.equal(core.readNew(),41);await registry.setEnabled(record.manifest.id,record.hash,true);await registry.dispose();
  const reboot=new PluginRegistry(directory);reboot.services.register('core',core,{version:2,adapters:[{version:1,members:{readOld:'readNew'}}]});await reboot.initialize();t.after(()=>reboot.dispose());assert.equal(await reboot.command(record.manifest.id,'ping',null),42);
  await reboot.dispose();const changed=new PluginRegistry(directory);changed.services.register('core',{newer:()=>42},{version:3,adapters:[{version:1,members:{readOld:'newer'}}]});await changed.initialize();t.after(()=>changed.dispose());assert.equal((await changed.list())[0]!.enabled,false);
});
test('repair refuses changed packages, unsupported contracts and disabled plugins',async t=>{
  const {registry,record}=await fixture(t,undefined,{services:[{id:'core',version:8,members:['read']}]});registry.services.register('core',{read:()=>1},{version:1});await registry.setEnabled(record.manifest.id,record.hash,true,true);
  await assert.rejects(registry.repairCompatibility(record.manifest.id,record.hash),/PLUGIN_REPAIR_UNAVAILABLE/);await assert.rejects(registry.repairCompatibility(record.manifest.id,'0'.repeat(64)),/PLUGIN_REPAIR_UNAVAILABLE/);
  await registry.setEnabled(record.manifest.id,record.hash,false);await assert.rejects(registry.repairCompatibility(record.manifest.id,record.hash));
});

test('successful compatibility repair preserves independent cleanup failures for that package',async t=>{
  const {registry,record}=await fixture(t,'export function activate(api){api.registerCommand("ping",()=>api.services.get("core").readOld());}',{services:[{id:'core',version:1,members:['readOld']}]});
  registry.services.register('core',{readNew:()=>42},{version:2,adapters:[{version:1,members:{readOld:'readNew'}}]});await registry.setEnabled(record.manifest.id,record.hash,true,true);
  await registry.recovery.incident({id:record.manifest.id,hash:record.hash},'PLUGIN_CLEANUP_FAILED','cleanup');
  assert.equal((await registry.repairCompatibility(record.manifest.id,record.hash)).applied,true);assert.equal(await registry.command(record.manifest.id,'ping',null),42);
  assert.deepEqual(registry.recovery.snapshot().incidents.map(i=>i.code),['PLUGIN_CLEANUP_FAILED']);
});

test('a later service registration clears resolved compatibility faults without hiding other errors',async t=>{
  const {registry,record}=await fixture(t,'export function activate(api){api.registerCommand("ping",()=>api.services.get("late.service").read());}',{services:[{id:'late.service',version:1,members:['read']}]});
  await registry.setEnabled(record.manifest.id,record.hash,true,true);assert.ok(registry.recovery.snapshot().incidents.some(i=>i.code==='SERVICE_UNAVAILABLE'));
  const unchanged=registry.recovery.snapshot().incidents[0]!.key;await registry.refresh();assert.equal(registry.recovery.snapshot().incidents[0]!.key,unchanged);
  await registry.recovery.incident({id:record.manifest.id,hash:record.hash},'PLUGIN_CLEANUP_FAILED','cleanup');
  registry.services.register('late.service',{read:()=>42},{version:1});assert.equal(await registry.command(record.manifest.id,'ping',null),42);
  assert.ok(!registry.recovery.snapshot().incidents.some(i=>i.phase==='compatibility'));assert.ok(registry.recovery.snapshot().incidents.some(i=>i.code==='PLUGIN_CLEANUP_FAILED'));
});
test('an interrupted startup enters durable safe mode before any plugin is loaded',async t=>{
  const {directory}=await fixture(t);const ledger=new PluginRecoveryStore(directory,'1.0.0');await ledger.initialize();await ledger.beginBoot();await ledger.begin({id:'test.old',hash:'a'.repeat(64),version:'1.0.0'},'host');
  const next=new PluginRecoveryStore(directory,'2.0.0');await next.initialize();assert.equal(next.snapshot().safeMode,true);assert.equal(await readSafeMode(directory),true);assert.equal(next.snapshot().incidents.at(-1)?.certainty,'suspected');assert.equal(next.snapshot().previousHostVersion,'1.0.0');
});
test('ready and clean exit do not create a false crash suspect',async t=>{
  const {directory}=await fixture(t);const ledger=new PluginRecoveryStore(directory,'1.0.0');await ledger.initialize();await ledger.beginBoot();await ledger.begin({id:'test.ok'},'renderer');await ledger.finish('test.ok','renderer');await ledger.ready();await ledger.closed();
  const next=new PluginRecoveryStore(directory,'2.0.0');await next.initialize();assert.equal(next.snapshot().safeMode,false);assert.deepEqual(next.snapshot().pending,[]);assert.ok(!next.snapshot().incidents.some(i=>i.code==='PLUGIN_STARTUP_INTERRUPTED'));
});
test('malformed safe mode markers fail closed',async t=>{const {directory}=await fixture(t);await writeFile(path.join(directory,'plugin-safe-mode.json'),'{}');assert.equal(await readSafeMode(directory),true);});

test('automatic recovery presentation is coalesced and does not refocus after dismissal',()=>{
  const gate=createRecoveryPresentationGate();
  assert.equal(gate.consumeAutomatic(),true);
  assert.equal(gate.consumeAutomatic(),false);
  gate.markDismissed();
  assert.equal(gate.consumeAutomatic(),false);

  const explicitlyOpened=createRecoveryPresentationGate();
  explicitlyOpened.markExplicit();
  assert.equal(explicitlyOpened.consumeAutomatic(),false);
});

test('corrupt recovery journal is retained byte-for-byte while core enters safe mode',async t=>{
  const {directory}=await fixture(t);const file=path.join(directory,'plugin-recovery.json');await writeFile(file,'{damaged');
  const ledger=new PluginRecoveryStore(directory,'2.0.0');await ledger.initialize();await ledger.beginBoot();await ledger.ready();await ledger.closed();assert.equal(ledger.snapshot().safeMode,true);assert.equal(await readFile(file,'utf8'),'{damaged');
});

test('the full bounded multi-plugin journal remains readable after restart',async t=>{
  const {directory}=await fixture(t),store=new PluginRecoveryStore(directory,'2.0.0');await store.initialize();
  const issues=Array.from({length:20},()=>({code:'SERVICE_MEMBER_UNAVAILABLE' as const,service:'s'.repeat(120),member:'m'.repeat(120),expected:Number.MAX_SAFE_INTEGER,actual:Number.MAX_SAFE_INTEGER,repairable:false}));
  for(let i=0;i<50;i++)await store.incident({id:'test.full-'+i,hash:'f'.repeat(64)},'SERVICE_MEMBER_UNAVAILABLE','compatibility','confirmed',false,issues);
  const bytes=await readFile(store.file);assert.ok(bytes.length>128*1024);assert.ok(bytes.length<1024*1024);
  const next=new PluginRecoveryStore(directory,'2.0.0');await next.initialize();assert.equal(next.snapshot().incidents.length,50);assert.equal(next.snapshot().storageError,undefined);assert.equal(next.snapshot().incidents[49]!.issues!.length,20);
});

test('boot completion and guardian subscribers independently observe late host activation',async t=>{
  const {directory}=await fixture(t),store=new PluginRecoveryStore(directory,'2.0.0');await store.initialize();await store.beginBoot();await store.begin({id:'test.slow'},'host');
  const guardian:string[]=[],boot:string[]=[];const stopGuardian=store.subscribe(s=>guardian.push(s.boot+':'+s.pending.length));
  const stopBoot=store.subscribe(s=>{boot.push(s.boot+':'+s.pending.length);if(s.boot==='starting'&&!store.hasPendingActivation())void store.ready();});
  await store.finish('test.slow','host');for(let i=0;i<20&&!guardian.includes('ready:0');i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(store.snapshot().boot,'ready');assert.ok(guardian.includes('ready:0'));assert.ok(boot.includes('ready:0'));
  stopBoot();const count=boot.length;await store.closed();assert.equal(boot.length,count);assert.equal(guardian.at(-1),'closed:0');stopGuardian();
});
test('active middleware attribution is transient and clears even after failure',async t=>{
  const {registry,record}=await fixture(t,'export function activate(api){api.useHost(async(request,next)=>{if(request.method==="qa/wait"){await new Promise(r=>setTimeout(r,100));throw Error("fixture");}return next();});}');
  await registry.setEnabled(record.manifest.id,record.hash,true,true);const result=assert.rejects(registry.dispatch({method:'qa/wait',payload:null},async()=>null),/fixture/);
  for(let i=0;i<50&&!registry.recovery.snapshot().pending.length;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.ok(registry.recovery.snapshot().pending.some(i=>i.id===record.manifest.id&&i.phase==='host'));
  assert.equal(registry.recovery.hasPendingActivation(),false);
  await result;assert.equal(registry.recovery.snapshot().pending.length,0);
});
