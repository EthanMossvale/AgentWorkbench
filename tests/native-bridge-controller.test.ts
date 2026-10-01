import { AttachmentStore } from '../apps/desktop/host/attachments';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {SharedMemoryStore} from '../packages/memory-core';
import {SharedSkillsStore} from '../packages/skills-core';
import {CodexBridgeService,codexHostBinding,type NativeCodexService} from '../services/codex-bridge';
import {CodexNativeAdapter,CodexRpcClient} from '../packages/runtime-codex';
import {missingBridgeChecks} from '../packages/session-core';
import {rememberedPermission} from '../packages/session-core/permissions';
import {decodeNativeFrame} from '../services/remote-supervisor';
import type {Session,SshHost,DraftPreview} from '../packages/contracts';

const wait=async(predicate:()=>boolean)=>{for(let i=0;i<250&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate());};

test('SSH Codex retains thread context, restores 1M capacity and submits the final selected model',async()=>{
 const f=await fixture();try{
  await f.controller.call('runtime/models',{sessionId:'session'});
  await f.controller.call('session/model',{sessionId:'session',selection:{model:'fixture-model',effort:'low'}});
  await f.submit(await f.prepare());
  f.emit('thread/tokenUsage/updated',{threadId:'native',turnId:'turn',tokenUsage:{last:{totalTokens:11715},total:{totalTokens:30000},modelContextWindow:1000000}});
  await wait(()=>f.store.snapshot().sessions[0]?.nativeContextUsage?.used===11715);
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');
  const commands=f.commands.length;
  await f.controller.call('session/model',{sessionId:'session',selection:{model:'second-model',effort:'high'}});
  assert.equal(f.store.snapshot().sessions[0]!.nativeContextUsage?.used,11715);assert.equal(f.store.snapshot().sessions[0]!.nativeContextUsage?.capacity,null);
  await f.controller.call('session/model',{sessionId:'session',selection:{model:'fixture-model',effort:'high'}});
  assert.equal(f.commands.length,commands);assert.equal(f.store.snapshot().sessions[0]!.binding.nativeSessionId,'native');
  const reloaded=(await new StateStore(f.dir).load()).sessions[0]!;assert.equal(reloaded.nativeContextUsage?.capacity,1000000);assert.equal(reloaded.nativeContextUsage?.used,11715);
  await f.submit(await f.prepare());assert.equal(f.turnParams.at(-1).model,'fixture-model');assert.equal(f.turnParams.at(-1).effort,'high');
 }finally{await f.close();}
});

test('every completed native message translates by default; the global intermediate preference retains earlier text',async()=>{
 let calls=0;
 const f=await fixture(false,undefined,async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'合成译文'}}]}),{headers:{'content-type':'application/json'}});});
 try{
  await f.controller.call('translation/settings',{profile:{...f.store.snapshot().translation,baseUrl:'http://127.0.0.1:1234/v1',protocol:'chat-completions',model:'fixture',consent:true},key:'synthetic-translation-key',translateInput:false,translateProgress:false,translateFinal:true});
  await f.controller.call('plugins/set-enabled',{id:'translation',enabled:true});
  await f.submit(await f.prepare());
  f.emit('item/completed',{threadId:'native',turnId:'turn',item:{id:'progress-one',type:'agentMessage',phase:'commentary',text:'First public message.'}});
  await wait(()=>f.store.snapshot().sessions[0]!.messages.some(m=>m.nativeItemId==='progress-one'&&['complete','failed'].includes(m.translationStatus??'')));assert.equal(f.store.snapshot().sessions[0]!.messages.find(m=>m.nativeItemId==='progress-one')?.translationStatus,'complete',JSON.stringify(f.store.snapshot().sessions[0]!.messages));
  await f.controller.call('translation/intermediate',{enabled:false});
  f.emit('item/completed',{threadId:'native',turnId:'turn',item:{id:'progress-two',type:'agentMessage',phase:'commentary',text:'Second public message.'}});
  f.emit('item/completed',{threadId:'native',turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'Final public message.'}});
  await wait(()=>f.store.snapshot().sessions[0]!.messages.some(m=>m.nativeItemId==='answer'&&m.translationStatus==='complete'));
  assert.equal(calls,2);const messages=f.store.snapshot().sessions[0]!.messages;assert.equal(messages.find(m=>m.nativeItemId==='progress-one')?.translation,'合成译文');assert.equal(messages.find(m=>m.nativeItemId==='progress-two')?.translation,undefined);
 }finally{await f.close();}
});

test('running native input steers the bound turn once, and settings use the native update RPC',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);
  await f.controller.call('session/permissions',{sessionId:'session',permissionMode:'read-only'});
  assert.equal(f.store.snapshot().sessions[0]!.permissionMode,'read-only');
  assert.deepEqual(f.settingsParams,[{threadId:'native',approvalPolicy:'never',sandboxPolicy:{type:'readOnly',networkAccess:false}}]);
  const preview=await f.controller.call('draft/prepare',{sessionId:'session',text:'Please inspect the second file instead.'}) as DraftPreview;
  await f.submit(preview);assert.equal(f.turns,1);assert(f.commands.includes('turn/steer'));
  assert.equal(f.turnParams.at(-1).expectedTurnId,'turn');assert.equal(f.turnParams.at(-1).clientUserMessageId,preview.id);
  assert.equal(f.store.snapshot().sessions[0]!.messages.at(-1)!.delivery,'accepted');
  await assert.rejects(f.submit(preview));
  const stale=await f.prepare();f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});
  await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');await assert.rejects(f.submit(stale),/回合已结束/);assert.equal(f.turns,1);await f.controller.call('session/permissions',{sessionId:'session',permissionMode:'read-only'});assert(f.commands.includes('thread/settings/update'));
 }finally{await f.close();}
});

test('queue mode and inverse shortcut freeze distinct actions and drain only after completion',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);
  const a=await f.controller.call('draft/prepare',{sessionId:'session',text:'Queued A',followUpMode:'queue'}) as DraftPreview;assert.equal(a.followUp?.action,'queue');await f.submit(a);
  assert.equal(f.turns,1);assert.equal(f.commands.filter(m=>m==='turn/steer').length,0);assert.equal(f.store.snapshot().sessions[0]!.followUps![0]!.preview.original,'Queued A');
  const b=await f.controller.call('draft/prepare',{sessionId:'session',text:'Immediate B',followUpMode:'queue',invertFollowUp:true}) as DraftPreview;assert.equal(b.followUp?.action,'steer');await f.submit(b);assert.equal(f.commands.filter(m=>m==='turn/steer').length,1);
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});await wait(()=>f.turns===2);await wait(()=>!f.store.snapshot().sessions[0]!.followUps?.length);assert.equal(f.submitted.at(-1),'Queued A');assert.equal(f.store.snapshot().sessions[0]!.messages.filter(m=>m.id===a.id).length,1);
  await assert.rejects(f.submit(a));
 }finally{await f.close();}
});

test('queued preview may finish translation after its turn ends without silently steering a different turn',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);
  const queued=await f.controller.call('draft/prepare',{sessionId:'session',text:'After completion',followUpMode:'steer',invertFollowUp:true}) as DraftPreview;
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');await f.submit(queued);await wait(()=>f.turns===2);
  await wait(()=>!f.store.snapshot().sessions[0]!.followUps?.length);assert.equal(f.store.snapshot().sessions[0]!.messages.find(message=>message.id===queued.id)?.nativeTurnId,'turn');assert.equal(f.commands.filter(method=>method==='turn/steer').length,0);assert.equal(f.submitted.at(-1),'After completion');
 }finally{await f.close();}
});

test('failed native turn pauses pending user queue and does not auto-submit another task',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);
  const queued=await f.controller.call('draft/prepare',{sessionId:'session',text:'Keep this request',followUpMode:'queue'}) as DraftPreview;await f.submit(queued);
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'failed',error:{message:'Synthetic failure'}}});await wait(()=>f.store.snapshot().sessions[0]!.followUps?.[0]?.status==='paused');assert.equal(f.turns,1);
  await f.controller.call('follow-up/cancel',{sessionId:'session',id:queued.id});assert.equal(f.store.snapshot().sessions[0]!.followUps?.length,0);
 }finally{await f.close();}
});

test('a completed unlabelled native final still translates when intermediate translation is off',async()=>{
 let calls=0;
 const f=await fixture(false,undefined,async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'最终译文'}}]}),{headers:{'content-type':'application/json'}});});
 try{
  await f.controller.call('translation/settings',{profile:{...f.store.snapshot().translation,baseUrl:'http://127.0.0.1:1234/v1',protocol:'chat-completions',model:'fixture',consent:true},key:'synthetic-translation-key',translateInput:false,translateProgress:false,translateFinal:false});
  await f.controller.call('plugins/set-enabled',{id:'translation',enabled:true});await f.controller.call('translation/intermediate',{enabled:false});
  await f.submit(await f.prepare());f.emit('item/completed',{threadId:'native',turnId:'turn',item:{id:'unlabelled',type:'agentMessage',text:'An unlabelled final reply.'}});
  await wait(()=>f.store.snapshot().sessions[0]!.messages.some(m=>m.nativeItemId==='unlabelled'));assert.equal(calls,0);
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});
  await wait(()=>f.store.snapshot().sessions[0]!.messages.some(m=>m.nativeItemId==='unlabelled'&&m.translationStatus==='complete'));
  assert.equal(calls,1);assert.equal(f.store.snapshot().sessions[0]!.messages.at(-1)!.phase,'final');
 }finally{await f.close();}
});
async function fixture(cold=false,quotaAccounting?:any,translationFetcher?:typeof fetch){
 const dir=await mkdtemp(path.join(os.tmpdir(),'aw-native-controller-')),store=new StateStore(dir);await store.load();
 const host:SshHost={id:'host',hostname:'localhost',port:22,username:'member',role:'workspace',identityFile:path.join(dir,'key-reference'),knownHostsFile:path.join(dir,'hosts-reference'),ownerId:'owner',workspaceGeneration:'generation',name:'Fixture'};
 const session:Session={id:'session',projectId:null,projectPath:dir,binding:{runtime:'codex',provider:'openai',hostId:'host',executionId:'local-device',egress:'vps',accountRef:'fixture-account'},createdAt:new Date().toISOString(),status:'idle',messages:[],title:'Fixture',pinned:false,archived:false,group:''};
 const evidence:any={runtime:'codex',runtimeVersion:'0.155.1',hostId:host.id,executionId:'local-device',accountRef:session.binding.accountRef,checks:Object.fromEntries(missingBridgeChecks('codex').map(k=>[k,'verified']))};
 await store.update(s=>{s.hosts=[host];s.sessions=[session];s.plugins={translation:{enabled:false}};s.profiles=[{version:1,id:'profile',hostId:host.id,ownerId:host.ownerId,observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),guarantee:'projected',fields:{}}];});
 const transport:any=new EventEmitter();let turns=0,handle:any,ownerReceipt:any,rejection:any,releaseStop:()=>void=()=>{},settingsUpdate:(()=>Promise<void>)|undefined;const turnParams:any[]=[];const settingsParams:any[]=[];const submitted:string[]=[];const replies:any[]=[];const commands:string[]=[];
 const emit=(method:string,params:any,id?:string|number)=>transport.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify({method,params,...(id===undefined?{}:{id})})+'\n')));
 transport.write=async(m:any)=>{
  if(!m.method){replies.push(m);emit('serverRequest/resolved',{requestId:m.id});return;}
  commands.push(m.method);
  if(m.method==='thread/settings/update'){
   settingsParams.push(structuredClone(m.params));
   try{await settingsUpdate?.();}catch(error){transport.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify({id:m.id,error:{code:-32602,message:error instanceof Error?error.message:String(error)}})+'\n')));return;}
  }
  if(m.method==='turn/start'&&rejection){const error=rejection;rejection=undefined;transport.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify({id:m.id,error})+'\n')));return;}
  if(m.method==='initialized')return;
  let result:any={};if(m.method==='thread/start')result={thread:{id:'native',environments:[{environmentId:'local-device',cwd:dir}]}};
  if(m.method==='thread/read')result={thread:{id:'native',environments:cold?null:[{environmentId:'local-device',cwd:dir}],turns:[{id:'turn',status:'completed',items:[{id:'answer',type:'agentMessage',phase:'final_answer',text:'Recovered final.'}]}]}};
  if(m.method==='thread/turns/list')result={data:[{id:'turn',status:'completed',items:[{id:'answer',type:'agentMessage',phase:'final_answer',text:'Recovered final.'}]}],nextCursor:null};
  if(m.method==='thread/resume')result={thread:{id:'native',environments:[{environmentId:'local-device',cwd:dir}]}};
  if(m.method==='turn/steer'){turnParams.push(structuredClone(m.params));result={turnId:m.params.expectedTurnId};}
  if(m.method==='turn/start'){turnParams.push(structuredClone(m.params));turns++;submitted.push(m.params.input[0].text);result={turn:{id:'turn'}};}
  transport.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify({id:m.id,result})+'\n')));
  if(m.method==='turn/start')emit('turn/started',{threadId:'native',turn:{id:'turn'}});
 };
 transport.stop=async()=>{transport.emit('disconnect');return {};};
 const service:NativeCodexService={supports:(h,s)=>h.id===host.id&&s.binding.runtime==='codex'&&s.binding.accountRef==='fixture-account',defaultDirectory:()=>dir,models:async()=>['fixture-model','second-model'].map(model=>({id:model,model,name:model,isDefault:model==='fixture-model',efforts:['low','high'],serviceTiers:[{id:'priority',name:'Fast',description:'Fixture'}]})),connect:async(_h,s,options)=>{
  if(handle){handle.adapter.setPermissionMode(s.permissionMode??'default');return handle;}
  const rpc=new CodexRpcClient(transport,s.id);await rpc.initialize();
  const adapter=new CodexNativeAdapter(rpc,s.binding,{environmentId:'local-device',cwd:dir},evidence,'0.155.1',s.binding.nativeSessionId?{}:options.context,s.permissionMode??'default');
  await adapter.registerEnvironment('ws://127.0.0.1:12345/'+'a'.repeat(64));
  const saved=s.nativeEnvironmentReceipt??(ownerReceipt?{...ownerReceipt,runtimeVersion:'0.155.1',accountRef:s.binding.accountRef}:undefined);
  await(s.binding.nativeSessionId||ownerReceipt?adapter.resumeThread('native',saved):adapter.startThread());
  handle={adapter,threadId:'native',ownerReceipt,connection:{rpc,dispose:async()=>{transport.emit('disconnect');handle=undefined;},interrupt:async()=>{emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'interrupted'}});await new Promise<void>(r=>{releaseStop=r;});transport.emit('disconnect');handle=undefined;}}};return handle;
 },close:async()=>{if(handle){transport.emit('disconnect');handle=undefined;}},dispose:async()=>{transport.emit('disconnect');handle=undefined;}};
 const shared={memory:new SharedMemoryStore(dir),skills:new SharedSkillsStore(dir)};await shared.memory.initialize();await shared.skills.initialize();
 const controller=new WorkbenchController(store,new SecretStore(dir,{encrypt:value=>Buffer.from(value),decrypt:value=>value.toString()}),{translationFetcher,attachments:new AttachmentStore(path.join(dir,'attachments')),quotaAccounting,nativeCodex:service,copy:()=>{},openPath:async()=>{},pickDirectory:async()=>null,nativeCapabilities:()=>[]},()=>{},shared);
 const prepare=()=>controller.call('draft/prepare',{sessionId:session.id,text:'Exact user task'}) as Promise<DraftPreview>;
 const submit=(p:DraftPreview)=>controller.call('draft/submit',{sessionId:session.id,id:p.id,sourceHash:p.sourceHash});
 return {dir,store,controller,prepare,submit,emit,submitted,replies,turnParams,settingsParams,session,host,evidence,commands,setSettingsUpdate:(handler:(()=>Promise<void>)|undefined)=>{settingsUpdate=handler;},setTurnRejection:(value:any)=>{rejection=value;},setOwnerReceipt:(receipt:any)=>{ownerReceipt=receipt;},get turns(){return turns;},releaseStop:()=>releaseStop(),disconnect:()=>{transport.emit('disconnect');handle=undefined;},close:async()=>{await controller.dispose();await rm(dir,{recursive:true,force:true});}};
}

test('accepted native submission streams exact public text, reviews native changes and never duplicates a turn',async()=>{
 const f=await fixture();try{
  const p=await f.prepare();assert.equal(f.turns,0);await f.submit(p);assert.equal(f.turns,1);assert.ok(f.submitted[0]!.startsWith('Exact user task'));
  await assert.rejects(f.submit(p));assert.equal(f.turns,1);
  f.emit('item/reasoning/textDelta',{threadId:'native',delta:'PRIVATE REASONING'});
  f.emit('item/agentMessage/delta',{threadId:'native',itemId:'answer',delta:'Hello'});
  f.emit('item/started',{threadId:'native',item:{id:'patch',type:'fileChange',changes:[{path:'fixture.txt',diff:'+example'}]}});
  f.emit('item/fileChange/requestApproval',{threadId:'native',turnId:'turn',itemId:'patch'},7);
  await wait(()=>!!f.store.snapshot().sessions[0]?.nativeApprovals?.length);
  assert.match(f.store.snapshot().sessions[0]!.nativeApprovals![0]!.details,/\+example/);
  await f.controller.call('session/approval',{sessionId:'session',requestId:7,decision:'accept'});
  await assert.rejects(f.controller.call('session/approval',{sessionId:'session',requestId:7,decision:'accept'}));
  assert.equal(f.replies.length,1);
  f.emit('item/completed',{threadId:'native',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'Hello complete.'}});
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});
  await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');
  const messages=f.store.snapshot().sessions[0]!.messages;assert.equal(messages.length,2);assert.equal(messages[1]!.original,'Hello complete.');assert.ok(!JSON.stringify(messages).includes('PRIVATE REASONING'));
 }finally{await f.close();}
});
test('Stop keeps the turn running until executor cleanup completes, even after a native interrupted event',async()=>{
 const f=await fixture();try{await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);
  const stopping=f.controller.call('session/stop',{sessionId:'session'});await new Promise(r=>setTimeout(r,30));assert.equal(f.store.snapshot().sessions[0]!.status,'running');
  f.releaseStop();assert.equal((await stopping as any).stopped,true);assert.equal(f.store.snapshot().sessions[0]!.status,'idle');assert.equal(f.turns,1);
 }finally{f.releaseStop();await f.close();}
});
test('disconnect preserves uncertainty; explicit reconciliation reads the completed native turn without resubmitting',async()=>{
 const f=await fixture(true);try{await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);f.disconnect();await wait(()=>f.store.snapshot().sessions[0]?.status==='uncertain');
  await assert.rejects(f.prepare());await f.controller.call('session/reconcile',{sessionId:'session'});assert.equal(f.turns,1);assert.equal(f.store.snapshot().sessions[0]!.status,'idle');assert.equal(f.store.snapshot().sessions[0]!.messages.at(-1)!.original,'Recovered final.');
 }finally{await f.close();}
});
test('cold resume refuses missing or changed environment receipts without submitting a new model turn',async()=>{
 const f=await fixture(true);try{await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);f.disconnect();await wait(()=>f.store.snapshot().sessions[0]?.status==='uncertain');
  await f.store.update(s=>{s.sessions[0]!.nativeEnvironmentReceipt!.cwd=path.join(f.dir,'wrong-directory');});
  await assert.rejects(f.controller.call('session/reconcile',{sessionId:'session'}),/environment is missing or mismatched/);assert.equal(f.turns,1);assert.equal(f.store.snapshot().sessions[0]!.status,'uncertain');
 }finally{await f.close();}
});
for(const scope of ['project','projectless'] as const){
 test(`running native permissions await CLI acknowledgement before saving ${scope} preferences`,async()=>{
  const f=await fixture();let release!:()=>void;const acknowledgement=new Promise<void>(resolve=>{release=resolve;});
  try{
   const projectId=scope==='project'?(await f.controller.call('project/create',{name:'Permission fixture',paths:[f.dir]}) as any).id:null;
   await f.store.update(s=>{s.sessions[0]!.projectId=projectId;});
   await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);
   f.setSettingsUpdate(()=>acknowledgement);
   const changing=f.controller.call('session/permissions',{sessionId:'session',permissionMode:'full-access'});
   await wait(()=>f.settingsParams.length===1);
   assert.deepEqual(f.settingsParams[0],{threadId:'native',approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}});
   assert.equal(f.store.snapshot().sessions[0]!.permissionMode,undefined);
   assert.equal(rememberedPermission(f.store.snapshot(),projectId,'codex'),'default');
   assert.equal(rememberedPermission(await new StateStore(f.dir).load(),projectId,'codex'),'default');
   await assert.rejects(f.controller.call('session/permissions',{sessionId:'session',permissionMode:'read-only'}),/正在保存/);
   release();await changing;
   const saved=await new StateStore(f.dir).load();
   assert.equal(saved.sessions[0]!.permissionMode,'full-access');assert.equal(rememberedPermission(saved,projectId,'codex'),'full-access');
   assert.equal(rememberedPermission(saved,projectId===null?'unrelated-project':null,'codex'),'default');assert.equal(rememberedPermission(saved,projectId,'claude'),'default');
   assert.equal(f.store.snapshot().sessions[0]!.status,'running');assert.equal(f.store.snapshot().sessions[0]!.nativeTurnId,'turn');
   assert.equal(f.store.snapshot().sessions[0]!.nativeActiveSettings?.permissionMode,'default');assert.equal(f.turnParams[0].approvalPolicy,'on-request');
   assert.equal(f.turns,1);assert(!f.commands.includes('turn/interrupt'));
  }finally{release();await f.close();}
 });
 test(`rejected running native permissions preserve ${scope} selection and preference`,async()=>{
  const f=await fixture();try{
   const projectId=scope==='project'?(await f.controller.call('project/create',{name:'Permission fixture',paths:[f.dir]}) as any).id:null;
   await f.store.update(s=>{s.sessions[0]!.projectId=projectId;});
   await f.controller.call('session/permissions',{sessionId:'session',permissionMode:'read-only'});
   await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);
   f.setSettingsUpdate(async()=>{throw Error('Synthetic native settings rejection');});
   await assert.rejects(f.controller.call('session/permissions',{sessionId:'session',permissionMode:'full-access'}),/Synthetic native settings rejection/);
   assert.equal(f.settingsParams.length,1);assert.equal(f.store.snapshot().sessions[0]!.permissionMode,'read-only');
   const saved=await new StateStore(f.dir).load();assert.equal(saved.sessions[0]!.permissionMode,'read-only');assert.equal(rememberedPermission(saved,projectId,'codex'),'read-only');
   assert.equal(f.store.snapshot().sessions[0]!.status,'running');assert.equal(f.turns,1);assert(!f.commands.includes('turn/interrupt'));
   f.setSettingsUpdate(undefined);await f.controller.call('session/permissions',{sessionId:'session',permissionMode:'full-access'});
   assert.equal(f.settingsParams.length,2);assert.equal(f.store.snapshot().sessions[0]!.permissionMode,'full-access');
  }finally{await f.close();}
 });
}
test('running native permissions require an available CLI connection',async()=>{
 const f=await fixture();try{
  await f.store.update(s=>{s.sessions[0]!.status='running';});
  await assert.rejects(f.controller.call('session/permissions',{sessionId:'session',permissionMode:'full-access'}),/原生连接不可用/);
  assert.equal(f.settingsParams.length,0);assert.equal(f.store.snapshot().sessions[0]!.permissionMode,undefined);assert.equal(rememberedPermission(f.store.snapshot(),null,'codex'),'default');
 }finally{await f.close();}
});

test('native question UI route answers the exact request once without submitting another turn',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());
  f.emit('item/tool/requestUserInput',{threadId:'native',turnId:'turn',itemId:'ask',isBlocking:true,questions:[{id:'target',header:'Target',question:'Which file?',isOther:true,isSecret:false,options:[{label:'A',description:'First'},{label:'B',description:'Second'}]}]},'question');
  await wait(()=>f.store.snapshot().sessions[0]!.nativeInteractions?.[0]?.status==='pending');
  await assert.rejects(f.controller.call('session/approval',{sessionId:'session',requestId:'question',decision:'accept'}));
  const receipt=f.store.snapshot().sessions[0]!.nativeInteractions![0]!.receipt;
  const answer=await f.controller.call('interaction/prepare',{sessionId:'session',requestId:'question',receipt,answers:{target:['B']},clientRequest:'answer'}) as any;
  await f.controller.call('interaction/submit',{sessionId:'session',id:answer.id,sourceHash:answer.sourceHash});
  assert.deepEqual(f.replies.at(-1),{id:'question',result:{answers:{target:{answers:['B']}}}});
  assert.equal(f.store.snapshot().sessions[0]!.nativeInteractions?.[0]?.status,'answered');assert.equal(f.turns,1);
  await assert.rejects(f.controller.call('session/interaction',{sessionId:'session',requestId:'question',reply:{action:'submit',answers:{target:['B']}}}));
 }finally{await f.close();}
});
test('native plans, async questions, future requests and expiry are visible without fabricated continuation',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());
  f.emit('turn/plan/updated',{threadId:'native',turnId:'turn',plan:[{step:'Inspect fixture',status:'inProgress'}]});
  f.emit('item/completed',{threadId:'native',turnId:'turn',item:{id:'async',type:'agentMessage',text:'A question for later.',questions:[{title:'Which target?',options:['A','B']}]}});
  f.emit('future/interactive',{threadId:'native',turnId:'turn'},'future');
  await wait(()=>!!f.store.snapshot().sessions[0]!.nativePlan);
  await wait(()=>f.store.snapshot().sessions[0]!.nativeInteractions?.[0]?.status==='unsupported');
  assert.equal(f.replies.at(-1).error.code,-32601);assert.equal(f.store.snapshot().sessions[0]!.messages.at(-1)?.questions?.[0]?.question,'Which target?');
  f.emit('item/tool/requestUserInput',{threadId:'native',turnId:'turn',questions:[{id:'q',question:'Wait?',options:null}]},'expired');
  await wait(()=>f.store.snapshot().sessions[0]!.nativeInteractions?.at(-1)?.status==='pending');
  f.emit('serverRequest/resolved',{threadId:'native',requestId:'expired'});
  await wait(()=>f.store.snapshot().sessions[0]!.nativeInteractions?.at(-1)?.status==='expired');
  await assert.rejects(f.controller.call('session/interaction',{sessionId:'session',requestId:'expired',reply:{action:'submit',answers:{q:['Yes']}}}));assert.equal(f.turns,1);
 }finally{await f.close();}
});
test('native MCP form and permission requests return exact typed payloads and cannot expand scope',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());
  f.emit('mcpServer/elicitation/request',{threadId:'native',turnId:'turn',serverName:'Fixture',mode:'form',message:'Choose',requestedSchema:{type:'object',properties:{answer:{type:'string',enum:['Yes','No']}},required:['answer']}},'form');
  await wait(()=>f.store.snapshot().sessions[0]!.nativeInteractions?.[0]?.status==='pending');
  const receipt=f.store.snapshot().sessions[0]!.nativeInteractions![0]!.receipt;
  await assert.rejects(f.controller.call('session/interaction',{sessionId:'session',requestId:'form',receipt,reply:{action:'submit',content:{answer:'Injected'}}}));
  await f.controller.call('session/interaction',{sessionId:'session',requestId:'form',receipt,reply:{action:'submit',content:{answer:'Yes'}}});
  assert.deepEqual(f.replies.at(-1).result,{action:'accept',content:{answer:'Yes'},_meta:null});
  f.emit('item/permissions/requestApproval',{threadId:'native',turnId:'turn',permissions:{network:{enabled:true},fileSystem:null}},'permission');
  await wait(()=>f.store.snapshot().sessions[0]!.nativeInteractions?.at(-1)?.status==='pending');
  await f.controller.call('session/interaction',{sessionId:'session',requestId:'permission',receipt:f.store.snapshot().sessions[0]!.nativeInteractions!.at(-1)!.receipt,reply:{action:'submit',content:{fileSystem:{write:['/']},scope:'session'}}});
  assert.deepEqual(f.replies.at(-1).result,{permissions:{network:{enabled:true}},scope:'turn'});
 }finally{await f.close();}
});
test('restart expires unanswered interactions and marks interrupted question translations without resuming tasks',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());
  f.emit('item/tool/requestUserInput',{threadId:'native',turnId:'turn',questions:[{id:'q',question:'Which target?',options:null}]},'restart');
  await wait(()=>f.store.snapshot().sessions[0]!.nativeInteractions?.[0]?.status==='pending');
  await f.store.update(state=>{const session=state.sessions[0]!;session.nativeInteractions![0]!.questionTranslation={status:'pending',values:{'q0.question':'哪个目标？'}};session.messages.push({id:'async-question',role:'assistant',original:'Please choose.',demo:false,timestamp:'fixture',questions:session.nativeInteractions![0]!.questions,questionTranslation:{status:'pending'}});});
  const previous=f.store.snapshot().sessions[0]!.nativeInteractions![0]!,restored=await new StateStore(f.dir).load();
  assert.equal(restored.sessions[0]!.nativeInteractions![0]!.receipt,previous.receipt);
  assert.equal(restored.sessions[0]!.nativeInteractions![0]!.status,'uncertain');
  assert.equal(restored.sessions[0]!.nativeInteractions![0]!.questionTranslation?.status,'failed');
  assert.equal(restored.sessions[0]!.nativeInteractions![0]!.questionTranslation?.values?.['q0.question'],'哪个目标？');
  assert.equal(restored.sessions[0]!.messages.at(-1)?.questionTranslation?.status,'failed');assert.equal(f.turns,1);assert.equal(f.replies.length,0);
 }finally{await f.close();}
});
test('changing the bound native account still requires fresh acceptance',async()=>{
 const f=await fixture();try{await f.submit(await f.prepare());
  await f.store.update(s=>{s.sessions[0]!.binding.accountRef='other-account';s.sessions[0]!.status='idle';});await assert.rejects(f.prepare(),/验收/);assert.equal(f.turns,1);
 }finally{await f.close();}
});
test('acceptance receipt binds executable bytes, workspace identity, account and version',async()=>{
 const f=await fixture();try{f.session.binding.accountRuntime='native-owner';
  const executable=path.join(f.dir,'synthetic-executor'),receipt=path.join(f.dir,'receipt.json');await writeFile(executable,'synthetic, never executed');
  const accepted={version:1,accountRuntime:'native-owner',observedAt:new Date().toISOString(),hostBinding:codexHostBinding(f.host),executableSha256:createHash('sha256').update('synthetic, never executed').digest('hex'),evidence:f.evidence,reports:['synthetic']};await writeFile(receipt,JSON.stringify(accepted));
  const service=await CodexBridgeService.load(executable,f.dir,receipt);assert.ok(service.supports(f.host,f.session));assert.equal(service.supports({...f.host,workspaceGeneration:'new'},f.session),false);assert.equal(service.supports(f.host,{...f.session,binding:{...f.session.binding,accountRef:'other'}}),false);
  await writeFile(executable,'changed');const changed=await CodexBridgeService.load(executable,f.dir,receipt);assert.equal(changed.supports(f.host,f.session),false);await service.dispose();
 }finally{await f.close();}
});


test('model choices bind to the native catalog and next turn while usage comes from the root thread',async()=>{
 const f=await fixture();try{
  await f.controller.call('runtime/models',{sessionId:'session'});
  await f.controller.call('session/model',{sessionId:'session',selection:{model:'fixture-model',effort:'low'}});
  await assert.rejects(f.controller.call('session/model',{sessionId:'session',selection:{model:'fixture-model',effort:'ultra'}}));
  await f.submit(await f.prepare());assert.equal(f.turnParams[0].model,'fixture-model');assert.equal(f.turnParams[0].effort,'low');
  await f.controller.call('session/model',{sessionId:'session',selection:{model:'fixture-model',effort:'high',serviceTier:'priority'}});
  await f.controller.call('session/permissions',{sessionId:'session',permissionMode:'full-access'});
  assert.equal(f.store.snapshot().sessions[0]!.nativeActiveSettings?.modelSelection?.effort,'low');
  f.emit('thread/tokenUsage/updated',{threadId:'child',turnId:'child-turn',tokenUsage:{last:{totalTokens:999},total:{totalTokens:999},modelContextWindow:1000}});
  f.emit('thread/tokenUsage/updated',{threadId:'native',turnId:'turn',tokenUsage:{last:{totalTokens:1200},total:{totalTokens:9000},modelContextWindow:10000}});
  await wait(()=>f.store.snapshot().sessions[0]?.nativeContextUsage?.used===1200);
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');
  await f.submit(await f.prepare());assert.equal(f.turnParams[1].effort,'high');assert.equal(f.turnParams[1].serviceTierForTurn,'priority');assert.equal(f.turnParams[1].sandboxPolicy.type,'dangerFullAccess');
 }finally{await f.close();}
});

test('quota denial blocks the actual native turn submission',async()=>{
 const quota={begin:async()=>{throw Error('Quota denied by fixture');},observe:()=>{},finish:async()=>{},dispose:async()=>{}};
 const f=await fixture(false,quota);try{
  await assert.rejects(f.submit(await f.prepare()),/Quota denied by fixture/);
  assert.equal(f.turns,0);assert.equal(f.store.snapshot().sessions[0]!.status,'idle');
  assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
 }finally{await f.close();}
});

test('owner receipt restores old thread and turn after local startup receipt is lost without replay',async()=>{
 const f=await fixture(true);try{
  await f.store.update(s=>{s.sessions[0]!.binding.accountRuntime='native-owner';});
  await f.submit(await f.prepare());await wait(()=>!!f.store.snapshot().sessions[0]?.nativeTurnId);f.disconnect();await wait(()=>f.store.snapshot().sessions[0]?.status==='uncertain');
  await f.store.update(s=>{delete s.sessions[0]!.binding.nativeSessionId;delete s.sessions[0]!.nativeTurnId;delete s.sessions[0]!.nativeEnvironmentReceipt;});
  f.setOwnerReceipt({threadId:'native',turnId:'turn',uncertain:true,environmentId:'local-device',cwd:f.dir});
  await f.controller.call('session/reconcile',{sessionId:'session'});
  const session=f.store.snapshot().sessions[0]!;assert.equal(session.binding.nativeSessionId,'native');assert.equal(session.nativeTurnId,'turn');assert.equal(session.status,'idle');
  assert.equal(f.turns,1);assert.equal(f.commands.filter(m=>m==='thread/start').length,1);assert.equal(session.messages.at(-1)!.original,'Recovered final.');
 }finally{await f.close();}
});

test('an unknown managed turn stays uncertain even when older completed history is available',async()=>{
 const f=await fixture(true);try{
  await f.store.update(s=>{s.sessions[0]!.binding.accountRuntime='native-owner';s.sessions[0]!.status='uncertain';s.sessions[0]!.nativeTurnId='turn';});
  f.setOwnerReceipt({threadId:'native',uncertain:true,environmentId:'local-device',cwd:f.dir});
  await assert.rejects(f.controller.call('session/reconcile',{sessionId:'session'}),/尚无可核对/);
  assert.equal(f.store.snapshot().sessions[0]!.status,'uncertain');assert.equal(f.turns,0);assert.ok(!f.commands.includes('thread/start'));
 }finally{await f.close();}
});

test('explicit pre-model gate rejection stays usable and does not create an uncertain phantom turn',async()=>{
 const f=await fixture();try{
  f.setTurnRejection({code:-32071,message:'ACCOUNT_RATE_LIMITED',data:{errorSource:'workbench-account-gate',notSubmitted:true}});
  await assert.rejects(f.submit(await f.prepare()),/没有提交给模型/);
  assert.equal(f.turns,0);assert.equal(f.store.snapshot().sessions[0]!.status,'idle');assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
  await f.submit(await f.prepare());assert.equal(f.turns,1);assert.equal(f.commands.filter(m=>m==='thread/start').length,1);
 }finally{await f.close();}
});

test('an ordinary native error cannot claim the trusted gateway no-submission receipt',async()=>{
 const f=await fixture();try{
  f.setTurnRejection({code:-32000,message:'ACCOUNT_RATE_LIMITED'});
  await assert.rejects(f.submit(await f.prepare()));assert.equal(f.store.snapshot().sessions[0]!.status,'uncertain');await assert.rejects(f.prepare());
 }finally{await f.close();}
});

test('retired H receipts cannot enable execution even alongside native-owner acceptance',async()=>{
 const f=await fixture();try{
  const executable=path.join(f.dir,'synthetic-executor'),receipt=path.join(f.dir,'acceptance.json');await writeFile(executable,'synthetic');
  const accepted={version:1,observedAt:new Date().toISOString(),hostBinding:codexHostBinding(f.host),executableSha256:createHash('sha256').update('synthetic').digest('hex'),evidence:f.evidence,reports:['synthetic']};
  const managed={...f.session,binding:{...f.session.binding,accountRuntime:'native-owner' as const}};
  await writeFile(receipt,JSON.stringify(accepted));const old=await CodexBridgeService.load(executable,f.dir,receipt);
  assert.equal(old.supports(f.host,f.session),false);assert.equal(old.supports(f.host,managed),false);await old.dispose();
  await writeFile(receipt,JSON.stringify({version:2,acceptances:[accepted,{...accepted,accountRuntime:'native-owner'}]}));
  const both=await CodexBridgeService.load(executable,f.dir,receipt);assert.equal(both.supports(f.host,f.session),false);assert.ok(both.supports(f.host,managed));await both.dispose();
  await writeFile(receipt,JSON.stringify({...accepted,accountRuntime:'native-owner'}));
  const native=await CodexBridgeService.load(executable,f.dir,receipt);assert.equal(native.supports(f.host,f.session),false);assert.ok(native.supports(f.host,managed));await native.dispose();
 }finally{await f.close();}
});

test('Stop during quota preflight prevents a later turn submission',async()=>{
 let started=false,release:()=>void=()=>{},finished=0;
 const quota={begin:async()=>{started=true;await new Promise<void>(resolve=>{release=resolve;});},observe:()=>{},finish:async()=>{finished++;},dispose:async()=>{}};
 const f=await fixture(false,quota);try{
  const pending=f.submit(await f.prepare());await wait(()=>started);
  await f.controller.call('session/stop',{sessionId:'session'});release();
  await assert.rejects(pending,/连接准备已取消/);assert.equal(f.turns,0);assert.ok(finished>0);
  assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
 }finally{release();await f.close();}
});

test('historical messages recover fork boundaries from native item IDs without replaying or mutating the parent',async()=>{
 const f=await fixture();try{
  await f.submit(await f.prepare());
  f.emit('item/completed',{threadId:'native',turnId:'turn',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'Historical final.'}});
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});
  await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');
  await f.store.update(state=>{for(const message of state.sessions[0]!.messages){delete message.nativeTurnId;delete message.nativeTurnEnd;}});
  const parent=f.store.snapshot().sessions[0]!,answer=parent.messages.find(m=>m.role==='assistant')!;
  const child=await f.controller.call('session/fork',{sessionId:parent.id,messageId:answer.id}) as Session;
  assert.deepEqual(child.branch?.native,{sourceSessionId:parent.id,threadId:'native',lastTurnId:'turn'});
  const before=await f.controller.call('session/fork',{sessionId:parent.id,messageId:parent.messages[0]!.id}) as Session;
  assert.equal(before.branch?.native?.beforeTurnId,'turn');assert.equal(before.messages.length,0);assert.equal(f.turns,1);
  assert.deepEqual(f.store.snapshot().sessions.find(s=>s.id===parent.id)!.messages,parent.messages);
 }finally{await f.close();}
});


test('native turn sends attachment image bytes in the verified image input variant',async()=>{
 const f=await fixture();try{
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=','base64');
  const files=await f.controller.call('attachments/import',{files:[{name:'fixture.png',bytes}]}) as any[];
  const preview=await f.controller.call('draft/prepare',{sessionId:f.session.id,text:'Describe the attachment',attachmentIds:[files[0].id]}) as DraftPreview;
  await f.submit(preview);assert.equal(f.turnParams[0].input[1].type,'image');assert.equal(f.turnParams[0].input[1].url,'data:image/png;base64,'+bytes.toString('base64'));assert.match(f.submitted[0]!,/workbench-attachments/);
  assert.equal(f.store.snapshot().sessions[0]!.messages[0]!.attachments?.[0]?.id,files[0].id);
  f.emit('turn/completed',{threadId:'native',turn:{id:'turn',status:'completed'}});await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');
 }finally{await f.close();}
});

test('SSH Codex preparation performs handshake before send and keeps quota admission on send',async()=>{
 let quota=0;const f=await fixture(false,{begin:async()=>{quota++;},observe:()=>{},finish:async()=>{},dispose:async()=>{}});
 try{
  const runner=f.controller.developmentServices()['runtime.codex'] as import('../apps/desktop/host/native-codex').NativeCodexRunner,service=runner.service,connect=service.connect.bind(service);let starts=0;
  service.connect=async(...args:Parameters<typeof connect>)=>{starts++;await new Promise(resolve=>setTimeout(resolve,160));return connect(...args);};
  const before=performance.now();await f.controller.call('session/prepare-runtime',{sessionId:'session'});const prepareMs=performance.now()-before;
  assert.equal(f.turns,0);assert.equal(quota,0);assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
  const preview=await f.prepare(),sendAt=performance.now();await f.submit(preview);const sendMs=performance.now()-sendAt;
  assert.equal(starts,1);assert.equal(quota,1);assert.equal(f.turns,1);assert.ok(sendMs<prepareMs/2,JSON.stringify({prepareMs,sendMs}));
 }finally{await f.close();}
});
