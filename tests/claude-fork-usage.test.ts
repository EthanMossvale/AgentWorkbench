import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Session} from '../packages/contracts';
import {forkUnavailable,createSessionFork} from '../packages/session-core/fork';
import {recordedNativeFork} from '../packages/session-core/native-fork';
import {nativeProviderLaunch} from '../packages/model-api/native-launch';
import {nativeWireEvents} from '../packages/model-api/native-wire';
import {currentProviderContext} from '../packages/model-api/native-context';
import {metricsSource,parseTokenCounts,recordSessionUsage,sessionMetrics} from '../packages/session-metrics';

const model={id:'mapping',model:'configured-model',name:'Model',enabled:true,contextWindow:1000000};
const fixture=():Session=>({id:randomUUID(),title:'Source',projectId:null,pinned:false,archived:false,group:'',status:'idle',createdAt:'2026-09-28T00:00:00Z',modelSelection:{model:model.model},binding:{runtime:'claude',provider:'source',accountRef:'model-api:source',executionId:'local-device',egress:'direct-api',modelConnectionId:'source',modelMappingId:model.id,nativeSessionId:randomUUID()},messages:[{id:'user',role:'user',original:'Read a fixture',timestamp:'2026-09-28T00:00:00Z',demo:false,nativeTurnId:'turn'},{id:'answer',role:'assistant',original:'READY',timestamp:'2026-09-28T00:00:01Z',demo:false,nativeTurnId:'turn',nativeItemId:randomUUID(),nativeTurnEnd:true}]});

test('Claude branch records exact native assistant UUID and keeps independent identity',()=>{
 const source=fixture(),before=structuredClone(source),native=recordedNativeFork(source,'answer')!;
 assert.equal(forkUnavailable(source,'answer'),undefined);assert.equal(native.runtime,'claude');assert.equal(native.lastMessageId,source.messages[1]!.nativeItemId);
 const child=createSessionFork(source,randomUUID(),'now','answer',native);assert.equal(child.binding.nativeSessionId,undefined);assert.deepEqual(source,before);
 assert.deepEqual(recordedNativeFork(child,'answer'),native);
 const launch=nativeProviderLaunch('claude',model,{baseUrl:'http://localhost:1',token:'fixture'},'default',undefined,{},undefined,'chat-completions',undefined,native,child.id);
 assert.deepEqual(launch.args.slice(launch.args.indexOf('--resume')),['--resume',source.binding.nativeSessionId,'--fork-session','--resume-session-at',native.lastMessageId,'--session-id',child.id]);
 const resumed=nativeProviderLaunch('claude',model,{baseUrl:'http://localhost:1',token:'fixture'},'default',undefined,{},child.id,'chat-completions',undefined,native,child.id);assert.ok(!resumed.args.includes('--fork-session'));
});
test('unverified Claude boundaries and remote transports stay blocked',()=>{
 for(const mutate of [(s:Session)=>{s.binding.hostId='remote';},(s:Session)=>{s.binding.egress='vps';},(s:Session)=>{s.messages[1]!.nativeTurnEnd=false;},(s:Session)=>{s.messages[1]!.nativeItemId=undefined;},(s:Session)=>{s.messages[1]!.modelSource={name:'Other',targetId:'other',runtime:'codex'};}]){const s=fixture();mutate(s);assert.ok(forkUnavailable(s,'answer'));assert.throws(()=>recordedNativeFork(s,'answer'));}
 const s=fixture();assert.ok(forkUnavailable(s,'user'));assert.throws(()=>recordedNativeFork(s,'user'));s.messages[1]!.nativeItemId='not-a-native-uuid';assert.throws(()=>recordedNativeFork(s),/BOUNDARY/);
 const n=recordedNativeFork(fixture())!;assert.throws(()=>nativeProviderLaunch('claude',model,{baseUrl:'http://localhost:1',token:'fixture'},'default',undefined,{},undefined,'chat-completions',undefined,n,n.threadId),/BOUNDARY/);
});
test('DeepSeek hit/miss counters do not invent cache writes or double input totals',()=>{
 const counts=parseTokenCounts({prompt_tokens:1200,completion_tokens:40,prompt_cache_hit_tokens:1000,prompt_cache_miss_tokens:200},'chat-completions');
 assert.deepEqual(counts,{inputTokens:1200,outputTokens:40,totalTokens:1240,cacheReadTokens:1000,cacheWriteTokens:null});
 const s=fixture();recordSessionUsage(s,{id:'one',model:model.model,...counts},{source:metricsSource(s),turnId:'turn',at:'2026-09-28T00:00:02Z'});assert.equal(sessionMetrics(s).cacheHitRate,1000/1200);
});
test('wire conversion preserves cached input in both native protocols exactly once',()=>{
 const counts=parseTokenCounts({prompt_tokens:1200,completion_tokens:40,prompt_cache_hit_tokens:1000},'chat-completions'),turn={text:'Done',calls:[],usage:{inputTokens:1200,outputTokens:40},raw:{}};
 for(const protocol of ['responses','anthropic-messages'] as const){const events=nativeWireEvents(turn,protocol,{model:model.model},counts),usage=protocol==='responses'?events.at(-1)!.response.usage:events[0]!.message.usage;assert.deepEqual(parseTokenCounts(usage,protocol),counts);}
 const events=nativeWireEvents(turn,'responses',{model:model.model});assert.equal(events.at(-1)!.response.usage.input_tokens_details,undefined);
});
test('lost context recovers latest exact-lane receipt, not accumulated usage or another model',()=>{
 const s=fixture(),source=metricsSource(s);
 for(const [id,input,output] of [['first',1000,50],['last',1500,70]] as const)recordSessionUsage(s,{id,model:model.model,...parseTokenCounts({prompt_tokens:input,completion_tokens:output},'chat-completions')},{source,turnId:id,at:id==='first'?'2026-09-28T00:00:01Z':'2026-09-28T00:00:02Z'});
 assert.equal(sessionMetrics(s).totalTokens,2620);assert.equal(currentProviderContext(s,model)?.used,1570);assert.equal(s.nativeContextUsage,undefined);
 s.binding.nativeSessionId=randomUUID();assert.equal(currentProviderContext(s,model),undefined);
 s.binding.runtime='codex';assert.equal(currentProviderContext(s,model),undefined);
});
test('native compression receipt outranks older provider statistics and missing counters stay unknown',()=>{
 const s=fixture();recordSessionUsage(s,{id:'one',model:model.model,...parseTokenCounts({prompt_tokens:1200},'chat-completions')},{source:metricsSource(s),turnId:'one',at:'2026-09-28T00:00:01Z'});assert.equal(currentProviderContext(s,model),undefined);
 s.nativeContextUsage={used:100,total:100,capacity:1000000,updatedAt:'2026-09-28T00:00:02Z'};assert.equal(currentProviderContext(s,model)?.used,100);
});

test('switching native runtimes restores each thread context receipt through the host API',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {StateStore,SecretStore}=await import('../apps/desktop/host/store'),{WorkbenchController}=await import('../apps/desktop/host/controller'),{NativeResources}=await import('../apps/desktop/host/native-resources');
 const {SharedMemoryStore}=await import('../packages/memory-core'),{SharedSkillsStore}=await import('../packages/skills-core');
 const directory=await mkdtemp(path.join(tmpdir(),'awb-context-switch-')),store=new StateStore(directory);await store.load();
 const native=new NativeResources(directory,{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},directory,{cliOptions:{executables:{codex:process.execPath,claude:process.execPath}}});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],modelFetcher:async()=>new Response(JSON.stringify({data:[{id:'upstream'}]}),{headers:{'content-type':'application/json'}})},()=>{},{memory:new SharedMemoryStore(directory),skills:new SharedSkillsStore(directory),native});
 try{
   await controller.call('model-api/save',{connection:{name:'Fixture',baseUrl:'http://127.0.0.1:12345',protocol:'chat-completions',models:[{id:'map',model:'upstream',name:'Fixture',enabled:true}]},key:''});
   const targets=await controller.call('model-targets/list') as {id:string;runtime:string}[],codex=targets.find(t=>t.runtime==='codex')!,claude=targets.find(t=>t.runtime==='claude')!;
   const chat=await controller.call('session/create',{modelTargetId:codex.id}) as Session;
   const codexUsage={used:1234,total:5000,capacity:1000000,updatedAt:'2026-09-28T00:00:00Z'};
   await store.update(s=>{s.sessions[0]!.nativeContextUsage=codexUsage;s.sessions[0]!.binding.nativeSessionId=randomUUID();});
   await controller.call('session/model-target',{sessionId:chat.id,targetId:claude.id});assert.equal(store.snapshot().sessions[0]!.nativeContextUsage?.used,1234);assert.equal(store.snapshot().sessions[0]!.nativeContextUsage?.capacity,null);assert.equal(store.snapshot().sessions[0]!.nativeContextUsage?.estimated,true);
   const claudeUsage={...codexUsage,used:5432};await store.update(s=>{s.sessions[0]!.nativeContextUsage=claudeUsage;s.sessions[0]!.binding.nativeSessionId=randomUUID();});
   await controller.call('session/model-target',{sessionId:chat.id,targetId:codex.id});assert.deepEqual(store.snapshot().sessions[0]!.nativeContextUsage,codexUsage);
   await controller.call('session/model-target',{sessionId:chat.id,targetId:claude.id});assert.deepEqual(store.snapshot().sessions[0]!.nativeContextUsage,claudeUsage);
 }finally{await controller.dispose();await rm(directory,{recursive:true,force:true});}
});

test('Claude native owner SSH forks preserve exact boundary and execution lane identity',()=>{
 const source=fixture();source.binding={runtime:'claude',provider:'anthropic',hostId:'fixture',accountRuntime:'native-owner',accountRef:'vps-account:a/g/claude/c/cg',egress:'vps',executionId:'local-device',nativeSessionId:randomUUID(),executionSessionId:randomUUID()};
 assert.equal(forkUnavailable(source,'answer'),undefined);
 const native=recordedNativeFork(source,'answer')!;assert.equal(native.sourceSessionId,source.binding.executionSessionId);
 const child=createSessionFork(source,randomUUID(),'now','answer',native);assert.equal(child.binding.executionSessionId,undefined);assert.equal(child.binding.hostId,'fixture');assert.deepEqual(recordedNativeFork(child,'answer'),native);
 source.binding.accountRuntime=undefined;assert.ok(forkUnavailable(source,'answer'));
});
