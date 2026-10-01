import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider';
import {ProcessSupervisor,decodeNativeFrame} from '../services/remote-supervisor';
import {normalizeClaudeEvent} from '../packages/runtime-claude';
import {draftRecovery} from '../packages/session-core/draft-recovery';
import {runtimeTarget,rememberRuntimeModel} from '../packages/model-api/runtime-target';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import type {DraftPreview,Session,SshHost} from '../packages/contracts';
import type {ModelTarget} from '../packages/model-api/types';

const preview=(id:string):DraftPreview=>({id,original:'原稿 '+id,translated:'Translated '+id,sourceHash:id,revision:1,demo:false,bypass:true});
async function fixture(t:test.TestContext,attachments?:any){
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-send-recovery-')),store=new StateStore(dir);await store.load();
  const host:SshHost={id:'ssh',name:'Workspace',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',ownerId:'local-owner',workspaceGeneration:'one',identityFile:'unused',knownHostsFile:'unused'};
  const session:Session={id:'chat',projectId:null,projectPath:dir,title:'Synthetic',createdAt:'now',status:'idle',messages:[],pinned:false,archived:false,group:'',binding:{runtime:'claude',provider:'anthropic',accountRef:'fixture',executionId:'local-device',egress:'vps',hostId:host.id},modelSelection:{model:'opus'}};
  await store.update(s=>{s.hosts=[host];s.sessions=[session];s.plugins={translation:{enabled:false}};});
  const controller=new WorkbenchController(store,new SecretStore(dir,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>''}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],attachments},()=>{});
  t.after(async()=>{await controller.dispose();await rm(dir,{recursive:true,force:true,maxRetries:3});});
  return {dir,store,controller,get:()=>store.snapshot().sessions[0]!};
}
class RemoteWire extends ProcessSupervisor {
  writes:any[]=[];
  constructor(private failStart=false){super({executable:'synthetic',args:[]});}
  override async start(){if(this.failStart)throw Error('SYNTHETIC_PREPARATION_FAILURE');this.state='running';}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async write(value:any){
    this.writes.push(value);
    if(value.type==='user')setTimeout(()=>{
      this.frame({type:'system',subtype:'init',session_id:'native-thread',permissionMode:'default'});
      this.frame({type:'assistant',session_id:'native-thread',uuid:'reply-'+value.uuid,message:{content:[{type:'text',text:'Reply '+value.uuid}]}});
      this.frame({type:'result',session_id:'native-thread',subtype:'success',is_error:false,uuid:'result-'+value.uuid});
    },5);
  }
  override async stop(reason='fixture'){if(this.state!=='closed'){this.state='closed';this.emit('disconnect',{code:0,signal:null,reason});}return {code:0,signal:null,reason};}
}
async function settled(runner:NativeProviderRunner){for(let n=0;n<500&&runner.busy('chat');n++)await new Promise(r=>setTimeout(r,10));assert.equal(runner.busy('chat'),false);}

test('SSH Claude first and second real runner turns retain a valid observer',async t=>{
  const f=await fixture(t),wires:RemoteWire[]=[],failures:unknown[]=[];
  const runner=new NativeProviderRunner({} as any,{home:f.dir,env:{},locate:async()=>({executable:'synthetic'}),isMaintaining:()=>false} as any,{
    snapshot:()=>f.store.snapshot(),update:change=>f.store.update(change),peers:()=>({definitions:[]}) as any,context:async()=>'',translate:()=>{},
    observe:(id,source)=>f.controller.observeNativeSession(id,source),failure:e=>failures.push(e),
    assertRemoteClaude:()=>({id:'opus',model:'opus',name:'Opus catalog label',enabled:true}),
    remoteClaude:{createTransport:()=>{const wire=new RemoteWire();wires.push(wire);return wire;}} as any,
  });
  t.after(()=>runner.dispose());
  for(const id of ['first','second']){
    await f.store.update(s=>draftRecovery.capture(s.sessions[0]!,preview(id)));
    await runner.submit('chat',preview(id));await settled(runner);
    assert.equal(f.get().nativeTurnStatus,'completed');assert.equal(f.get().binding.nativeSessionId,'native-thread');
    assert.equal(f.get().draftRecoveries?.length,0);
  }
  assert.deepEqual(failures,[]);assert.equal(f.get().messages.filter(m=>m.role==='user').length,2);
  assert.equal(wires.flatMap(w=>w.writes).filter(v=>v.type==='user').length,2);
});

test('a preparation failure preserves the exact preview before any native send',async t=>{
  const f=await fixture(t),wire=new RemoteWire(true),input={...preview('failed'),attachments:[{id:'attachment',name:'fixture.txt',mime:'text/plain',size:2}],skills:[{id:'skill',hash:'h',displayName:'Fixture'}]} as DraftPreview;
  const runner=new NativeProviderRunner({} as any,{home:f.dir,env:{},locate:async()=>({executable:'synthetic'}),isMaintaining:()=>false} as any,{
    snapshot:()=>f.store.snapshot(),update:change=>f.store.update(change),peers:()=>({definitions:[]}) as any,context:async()=>'',translate:()=>{},
    observe:(id,source)=>f.controller.observeNativeSession(id,source),assertRemoteClaude:()=>({id:'opus',model:'opus',name:'Opus',enabled:true}),remoteClaude:{createTransport:()=>wire} as any,
  });t.after(()=>runner.dispose());
  await f.store.update(s=>draftRecovery.capture(s.sessions[0]!,input));await runner.submit('chat',input);await settled(runner);
  assert.equal(f.get().draftRecoveries?.[0]?.outcome,'not-sent');assert.deepEqual(f.get().draftRecoveries?.[0]?.preview,input);
  assert.equal(wire.writes.length,0);assert.equal(f.get().messages.length,0);
  const reloaded=await new StateStore(f.dir).load();assert.deepEqual(reloaded.sessions[0]!.draftRecoveries,f.get().draftRecoveries);
});

test('changed authority and native thread stay fenced; failed cleanup cannot poison a new connection',async t=>{
  const f=await fixture(t),source=new EventEmitter(),observation=await f.controller.observeNativeSession('chat',source);
  await f.store.update(s=>{s.sessions[0]!.binding.nativeSessionId='first';s.hosts[0]!.name='Renamed';});
  source.emit('event',normalizeClaudeEvent(decodeNativeFrame(Buffer.from('{"type":"system","subtype":"init","session_id":"first"}\n')),'chat',1));
  await observation.flush();
  await f.store.update(s=>{s.sessions[0]!.binding.nativeSessionId='wrong-thread';});
  await assert.rejects(observation.flush(),/identity changed/);
  const replacement=await f.controller.observeNativeSession('chat',new EventEmitter());await replacement.flush();
  assert.equal(source.listenerCount('event'),0);
  await f.store.update(s=>{s.hosts[0]!.workspaceGeneration='two';});
  await assert.rejects(replacement.flush(),/identity changed/);
  await (await f.controller.observeNativeSession('chat',new EventEmitter())).flush();
});

test('unknown sends require explicit recovery and startup never replays; corrupt state is preserved',async t=>{
  const f=await fixture(t);
  await f.store.update(s=>{draftRecovery.capture(s.sessions[0]!,preview('unknown'));s.sessions[0]!.status='running';});
  const reloaded=await new StateStore(f.dir).load();assert.equal(reloaded.sessions[0]!.draftRecoveries![0]!.outcome,'uncertain');
  await assert.rejects(f.controller.call('draft/recovery-dismiss',{sessionId:'chat',id:'stale'}),/CONFLICT/);
  const filename=path.join(f.dir,'state.json'),bad=JSON.parse(await readFile(filename,'utf8'));bad.sessions[0].draftRecoveries[0].preview.original=null;
  await writeFile(filename,JSON.stringify(bad));const before=await readFile(filename,'utf8');await assert.rejects(new StateStore(f.dir).load(),/DRAFT_RECOVERY_INVALID/);assert.equal(await readFile(filename,'utf8'),before);
});

test('attachment cleanup retains failed-send originals until their exact backup is dismissed',async t=>{
  let retained:string[]=[];const f=await fixture(t,{cleanup:async(ids:string[])=>{retained=ids;}});
  await f.store.update(s=>{draftRecovery.capture(s.sessions[0]!,{...preview('attached'),attachments:[{id:'saved-file',name:'fixture.txt',mime:'text/plain',size:2}] as any});draftRecovery.fail(s.sessions[0]!,'attached');});
  await f.controller.call('attachments/cleanup',{});assert.deepEqual(retained,['saved-file']);
  await f.controller.call('draft/recovery-dismiss',{sessionId:'chat',id:'attached'});await f.controller.call('attachments/cleanup',{});assert.deepEqual(retained,[]);
});

test('runtime choice uses the same SSH source and restores an existing lane',()=>{
  const session={binding:{runtime:'claude',hostId:'member'},modelSelection:{model:'opus'},modelLanes:[{targetId:'codex-saved'}]} as Session;
  const target=(id:string,hostId:string,ready=true)=>({id,runtime:'codex',ready,binding:{hostId},selection:{model:id}} as ModelTarget);
  const targets=[target('foreign','other'),target('default','member'),target('codex-saved','member')];
  assert.equal(runtimeTarget(targets,'codex',session)?.id,'codex-saved');
  assert.equal(runtimeTarget(targets.slice(0,2),'codex',session)?.id,'default');
  assert.equal(runtimeTarget([target('unavailable','member',false),targets[0]!],'codex',session),undefined);
});

test('approved recovery plugins reach persisted production writes and cleanly disable and reenable',async t=>{
  const f=await fixture(t),plugins=new PluginRegistry(path.join(f.dir,'plugins'));await plugins.initialize();t.after(()=>plugins.dispose());
  for(const [id,service] of Object.entries(f.controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  plugins.connectHost(({method,payload})=>f.controller.call(method,payload));
  const manifest={schemaVersion:1,apiVersion:1,id:'test.recovery',name:'Recovery fixture',version:'1.0.0',description:'Synthetic recovery contract',capabilities:['host'],main:'main.mjs'};
  const file=path.join(f.dir,'recovery.zip');
  await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from("export function activate(api){let count=0;api.services.intercept('composer.recovery','observe',(next,...args)=>{count++;return next(...args);});api.registerCommand('count',()=>count);api.registerCommand('discard',p=>api.call('draft/recovery-dismiss',p));}")}]));
  await plugins.importZip(file);const record=(await plugins.list())[0]!;
  await assert.rejects(plugins.setEnabled(manifest.id,record.hash,true),/approval/);
  await plugins.setEnabled(manifest.id,record.hash,true,true);
  await f.store.update(s=>draftRecovery.capture(s.sessions[0]!,preview('saved')));
  await f.store.update(s=>draftRecovery.fail(s.sessions[0]!,'saved'));
  assert.ok(Number(await plugins.command(manifest.id,'count',{}))>=2);
  await plugins.setEnabled(manifest.id,record.hash,false);
  assert.equal((await new StateStore(f.dir).load()).sessions[0]!.draftRecoveries![0]!.outcome,'not-sent');
  await plugins.setEnabled(manifest.id,record.hash,true);
  await plugins.command(manifest.id,'discard',{sessionId:'chat',id:'saved'});assert.equal(f.get().draftRecoveries?.length,0);
  await plugins.setEnabled(manifest.id,record.hash,false);
  await f.store.update(s=>draftRecovery.capture(s.sessions[0]!,preview('later')));assert.equal(f.get().draftRecoveries?.length,1);
});

test('runtime restoration does not require the outgoing provider mapping or model',()=>{
 const session={binding:{runtime:'claude',modelConnectionId:'provider',modelMappingId:'opus'},modelSelection:{model:'opus'}} as Session;
 const target={id:'codex-model',runtime:'codex',ready:true,binding:{modelConnectionId:'provider',modelMappingId:'gpt'},selection:{model:'gpt'}} as ModelTarget;
 assert.equal(runtimeTarget([target],'codex',session),target);
 const state:any={lastSelectedRuntime:'claude',lastModelTargetId:'opus-target',lastModelSelection:{model:'opus',effort:'high',serviceTier:'priority'}};
 rememberRuntimeModel(state);state.lastSelectedRuntime='codex';state.lastModelTargetId=target.id;state.lastModelSelection={model:'gpt',effort:'low'};rememberRuntimeModel(state);
 assert.deepEqual(state.runtimeModelPreferences.entries.claude?.selection,{model:'opus',effort:'high',serviceTier:'priority'});
 assert.equal(runtimeTarget([target],'codex',session,state.runtimeModelPreferences.entries.codex),target);
});

test('per-runtime choices survive reload, preserve unavailable choices and reject corrupt preference files',async t=>{
 const f=await fixture(t);
 for(const [runtime,target,model,effort] of [['claude','claude-target','opus','high'],['codex','codex-target','gpt','low']] as const){
  await f.store.update(s=>{s.lastSelectedRuntime=runtime;s.lastModelTargetId=target;s.lastModelSelection={model,effort};});
  await f.controller.call('theme/set',{theme:'dark'});
 }
 const restored=await new StateStore(f.dir).load();assert.deepEqual(restored.runtimeModelPreferences?.entries.claude?.selection,{model:'opus',effort:'high'});assert.equal(restored.runtimeModelPreferences?.entries.codex?.selection?.model,'gpt');
 await assert.rejects(f.controller.call('runtime/choice',{runtime:'codex',sessionId:'chat'}),/UNAVAILABLE/);
 assert.deepEqual(f.store.snapshot().runtimeModelPreferences,restored.runtimeModelPreferences);
 const file=path.join(f.dir,'state.json'),raw=JSON.stringify({...restored,runtimeModelPreferences:{version:2,entries:{}}});await writeFile(file,raw);
 await assert.rejects(new StateStore(f.dir).load(),/PREFERENCES_INVALID/);assert.equal(await readFile(file,'utf8'),raw);
});
