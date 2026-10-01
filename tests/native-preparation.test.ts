import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider';
import {StateStore} from '../apps/desktop/host/store';
import {ProcessSupervisor,decodeNativeFrame} from '../services/remote-supervisor';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {draftRecovery} from '../packages/session-core/draft-recovery';
import type {DraftPreview,Session} from '../packages/contracts';

const input:DraftPreview={id:'input',original:'Exact original',translated:'Exact submitted',revision:1,sourceHash:'fixture',demo:false,bypass:true};
const until=async(check:()=>boolean)=>{for(let n=0;n<300&&!check();n++)await delay(5);assert.ok(check());};
class Wire extends ProcessSupervisor {
  writes:any[]=[];started=0;stopped=0;fail=false;
  constructor(readonly runtime:'claude'|'codex',readonly startupMs:number){super({executable:'synthetic',args:[]});}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async start(){this.started++;await delay(this.startupMs);if(this.fail)throw Error('SYNTHETIC_START_FAILED');this.state='running';}
  override async write(value:any){
    this.writes.push(value);
    if(value.method&&value.id!==undefined){const result=value.method.startsWith('thread/')?{thread:{id:'thread'}}:value.method==='turn/start'?{turn:{id:'turn'}}:{};queueMicrotask(()=>this.frame({jsonrpc:'2.0',id:value.id,result}));}
  }
  override async stop(reason='fixture'){this.stopped++;this.state='closed';this.emit('disconnect');return {code:0,signal:null,reason};}
}
async function fixture(t:test.TestContext,runtime:'claude'|'codex'='claude',remote=false,startupMs=0){
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-preparation-')),store=new StateStore(root);await store.load();const wires:Wire[]=[];let scans=0,contextCalls=0,restorations=0;
  const model={id:'model',model:'fixture',name:'Fixture',enabled:true,efforts:['low','high']},connection={id:'source',enabled:true,auth:'none',protocol:'chat-completions',models:[model]};
  const session:Session={id:'chat',projectId:null,projectPath:root,title:'Fixture',titleSource:'fallback',createdAt:'2026-10-01T00:00:00Z',status:'idle',messages:[],pinned:false,archived:false,group:'',binding:{runtime,provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:remote?'vps':'direct-api',...(remote?{hostId:'host'}:{modelConnectionId:'source',modelMappingId:'model'})},modelSelection:{model:'fixture'}};
  await store.update(s=>{s.sessions=[session];});
  const make=()=>{const wire=new Wire(runtime,startupMs);wires.push(wire);return wire;};
  const runner=new NativeProviderRunner({connection:()=>connection,key:async()=>''} as any,{home:root,env:{},locate:async()=>{scans++;return {executable:'synthetic'};},isMaintaining:()=>false} as any,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),context:async()=>{contextCalls++;return '';},peers:()=>({definitions:[],call:async()=>{throw Error('No tool calls during preparation');}}) as any,observe:async()=>{},translate:()=>{},assertRemoteClaude:()=>model,beforeRemoteClaude:async()=>{restorations++;},remoteClaude:{createTransport:make} as any},async()=>{throw Error('No inference during preparation');},undefined,make);
  t.after(async()=>{await runner.dispose();await rm(root,{recursive:true,force:true});});
  return {root,store,runner,wires,connection,get:()=>store.snapshot().sessions[0]!,scans:()=>scans,contexts:()=>contextCalls,restorations:()=>restorations};
}
for(const [runtime,remote] of [['claude',false],['codex',false],['claude',true]] as const)test(`${remote?'SSH':'local'} ${runtime}: preparation moves startup before explicit send without inference`,async t=>{
  const f=await fixture(t,runtime,remote,160),cold=performance.now();await Promise.all([f.runner.prepare('chat'),f.runner.prepare('chat')]);const preparationMs=performance.now()-cold;
  assert.equal(f.wires.length,1);assert.equal(f.runner.busy('chat'),false);assert.equal(f.get().status,'idle');assert.equal(f.get().messages.length,0);assert.equal(f.contexts(),0);
  assert.equal(f.wires[0]!.writes.filter(v=>v.type==='user'||v.method==='turn/start').length,0);
  const begin=performance.now();await f.runner.submit('chat',input);const sendMs=performance.now()-begin;
  assert.equal(f.wires.length,1);assert.equal(f.scans(),1);assert.equal(f.contexts(),1);
  assert.equal(f.wires[0]!.writes.filter(v=>v.type==='user'||v.method==='turn/start').length,1);assert.ok(sendMs<preparationMs/2,JSON.stringify({preparationMs,sendMs}));
  if(remote)assert.equal(f.restorations(),1);t.diagnostic(JSON.stringify({runtime,remote,preparationMs,sendMs}));
});
test('changing model/permission after preparation discards the old process before sending',async t=>{
  const f=await fixture(t);await f.runner.prepare('chat');await f.store.update(s=>{s.sessions[0]!.permissionMode='full-access';});await f.runner.submit('chat',input);await until(()=>f.wires.length===2&&f.wires[1]!.writes.length>0);
  assert.equal(f.wires[0]!.writes.length,0);assert.ok(f.wires[0]!.stopped);assert.equal(f.wires[1]!.writes.filter(v=>v.type==='user').length,1);
});

for(const runtime of ['claude','codex'] as const)test(`${runtime}: model selection does not wait for warm shutdown and explicit send validates the changed launch`,async t=>{
  const f=await fixture(t,runtime);await f.runner.prepare('chat');
  await f.runner.settleCompleted('chat',false);assert.equal(f.wires[0]!.stopped,0);
  await f.store.update(s=>{s.sessions[0]!.modelSelection={model:'fixture',effort:'high'};});
  await f.runner.submit('chat',input);await until(()=>f.wires.length===2&&f.wires[1]!.writes.some(v=>v.type==='user'||v.method==='turn/start'));
  assert.ok(f.wires[0]!.stopped);assert.equal(f.wires[0]!.writes.filter(v=>v.type==='user'||v.method==='turn/start').length,0);
  assert.equal(f.wires[1]!.writes.filter(v=>v.type==='user'||v.method==='turn/start').length,1);
});
test('stop during preparation and late startup never submit input',async t=>{
  const f=await fixture(t,'claude',false,100);const pending=f.runner.prepare('chat');const rejection=assert.rejects(pending);await until(()=>f.wires.length===1);await f.runner.stop('chat');await rejection;
  assert.equal(f.wires[0]!.writes.length,0);assert.equal(f.get().status,'idle');assert.equal(f.get().nativeError,undefined);assert.equal(f.runner.hasTransport('chat'),false);
});
test('send while preparation is in flight shares the same startup and sends once',async t=>{
  const f=await fixture(t,'claude',false,80);const preparing=f.runner.prepare('chat');await until(()=>!!f.wires.length);await f.runner.submit('chat',input);await preparing;
  assert.equal(f.wires.length,1);assert.equal(f.wires[0]!.writes.filter(v=>v.type==='user').length,1);
});
test('revoked provider admission rejects a prepared process without a model request',async t=>{
  const f=await fixture(t);await f.runner.prepare('chat');f.connection.enabled=false;await assert.rejects(f.runner.submit('chat',input));assert.equal(f.wires[0]!.writes.length,0);
});
test('idle disconnect is cleaned and only an explicit later send may create a replacement',async t=>{
  const f=await fixture(t);await f.runner.prepare('chat');f.wires[0]!.emit('disconnect');await until(()=>!f.runner.hasTransport('chat'));assert.equal(f.get().nativeError,undefined);await delay(10);assert.equal(f.wires.length,1);await f.runner.submit('chat',input);await until(()=>f.wires.length===2&&!!f.wires[1]!.writes.length);
});
test('pending input presentation is immediate, deduplicated and never stored as a native receipt',()=>{
  const session={messages:[],draftRecoveries:[]} as unknown as Session;draftRecovery.capture(session,input);
  const visible=draftRecovery.pendingMessages(session,'2026-10-01T00:00:00Z');assert.equal(visible[0]!.delivery,'pending');assert.equal(visible[0]!.submitted,input.translated);assert.equal(session.messages.length,0);
  session.messages.push(visible[0]!);assert.deepEqual(draftRecovery.pendingMessages(session,''),[]);session.messages=[];draftRecovery.fail(session,input.id);assert.deepEqual(draftRecovery.pendingMessages(session,''),[]);
});
test('approved lifecycle plugins call, intercept and replace the real preparation entry with cleanup',async t=>{
  const f=await fixture(t),plugins=new PluginRegistry(path.join(f.root,'plugins'));await plugins.initialize();plugins.services.register('runtime.native-provider',f.runner,{version:1});t.after(()=>plugins.dispose());
  const install=async(id:string,fail=false,replace=false)=>{
    const manifest={schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic preparation policy',capabilities:['host'],main:'main.mjs'};
    const source=`export function activate(api){const runner=api.services.get('runtime.native-provider');api.registerCommand('prepare',({id})=>runner.prepare(id));${replace?`api.services.override('runtime.native-provider',{prepare:async()=>({ready:false,owner:'${id}'})});`:`api.services.intercept('runtime.native-provider','prepare',async(next,...args)=>({...await next(...args),owner:'${id}'}));`}${fail?"throw Error('Synthetic registration failure');":''}}`;
    const file=path.join(f.root,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(file);return (await plugins.list()).find(p=>p.manifest.id===id)!;
  };
  const one=await install('qa.prepare-one'),two=await install('qa.prepare-two'),bad=await install('qa.prepare-fail',true);
  await assert.rejects(plugins.setEnabled(one.manifest.id,one.hash,true),/approval/i);await plugins.setEnabled(one.manifest.id,one.hash,true,true);await plugins.setEnabled(two.manifest.id,two.hash,true,true);
  assert.equal((await plugins.command(one.manifest.id,'prepare',{id:'chat'}) as any).owner,two.manifest.id);assert.equal(f.wires.length,1);assert.equal(f.wires[0]!.writes.length,0);
  await plugins.setEnabled(bad.manifest.id,bad.hash,true,true);assert.ok((await plugins.list()).find(p=>p.manifest.id===bad.manifest.id)?.error);
  await plugins.setEnabled(two.manifest.id,two.hash,false);assert.equal((await f.runner.prepare('chat') as any).owner,one.manifest.id);
  await plugins.setEnabled(one.manifest.id,one.hash,false);assert.equal((await f.runner.prepare('chat') as any).owner,undefined);
  const replacement=await install('qa.prepare-replacement',false,true);await plugins.setEnabled(replacement.manifest.id,replacement.hash,true,true);assert.equal((await f.runner.prepare('chat') as any).ready,false);await plugins.setEnabled(replacement.manifest.id,replacement.hash,false);assert.equal((await f.runner.prepare('chat')).ready,true);
  await f.runner.stop('chat');await plugins.setEnabled(one.manifest.id,one.hash,true);assert.equal((await f.runner.prepare('chat') as any).owner,one.manifest.id);assert.equal(f.wires.length,2);
  await rm(one.directory,{recursive:true});await plugins.refresh();assert.equal((await f.runner.prepare('chat') as any).owner,undefined);
});

test('bundled Codex metadata is single-flight by executable revision and per-session files stay independent',async t=>{
  const {prepareCodexModelCatalog}=await import('../packages/model-api/native-catalog');
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-catalog-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const executable=path.join(root,'fixture-native');await writeFile(executable,'version one');let reads=0;
  const model={id:'model',model:'custom',name:'Custom',enabled:true,contextWindow:200000};
  const run=async()=>{reads++;await delay(20);return JSON.stringify({models:[{slug:'native',visibility:'list',base_instructions:'Native fixture'}]});};
  const [one,two]=await Promise.all([prepareCodexModelCatalog(executable,model,{},run),prepareCodexModelCatalog(executable,model,{},run)]);
  assert.equal(reads,1);assert.notEqual(one.file,two.file);await one.dispose();await two.dispose();
  await writeFile(executable,'different version two');const three=await prepareCodexModelCatalog(executable,model,{},run);assert.equal(reads,2);await three.dispose();
  let fail=true;const recover=async()=>{if(fail)return JSON.stringify({models:[]});return run();};await assert.rejects(prepareCodexModelCatalog(executable,model,{},recover));fail=false;const four=await prepareCodexModelCatalog(executable,model,{},recover);await four.dispose();
});
