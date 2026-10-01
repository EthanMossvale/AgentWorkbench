import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { NativeEventMonitor, NativeEventRegistry, inspectNativeEvent, nativeEventCatalog } from '../packages/native-events';
import { decodeNativeFrame, type NativeFrame } from '../services/remote-supervisor';
import { attachNativeObservation } from '../apps/desktop/host/native-observation';
import { NativeActivityTracker } from '../packages/collaboration-core/activity';
import { normalizeCodexEvent } from '../packages/runtime-codex';
import { normalizeClaudeEvent } from '../packages/runtime-claude';
import { claudeResultOutcome } from '../packages/runtime-claude/result';
import type { AppState, Session } from '../packages/contracts';

const at='2026-09-29T20:00:00.000Z';
const frame=(value:unknown,sequence?:number):NativeFrame=>({...decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'),at),sequence});
function fixture(runtime:'codex'|'claude'='codex'){
  const session={id:'session',projectId:null,projectPath:'',title:'Fixture',status:'running',createdAt:at,pinned:false,archived:false,group:'',messages:[],binding:{runtime,provider:'fixture',accountRef:'fixture',modelConnectionId:'provider',modelMappingId:'model',nativeSessionId:'root',executionId:'local',egress:'direct-api'}} as Session;
  return {session,state:{sessions:[session],hosts:[]} as unknown as AppState};
}
test('independent version inventory covers every Codex notification, request and item and published Claude message',async()=>{
  const source=JSON.parse(await readFile(new URL('./fixtures/native-event-catalog.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.values(source.codex).map((values:any)=>values.length),[82,11,19]);
  const keys=nativeEventCatalog.map(e=>e.runtime+':'+e.key);assert.equal(new Set(keys).size,keys.length);
  for(const [group,prefix]of [['notifications','notification/'],['requests','request/'],['items','item/']] as const)for(const name of source.codex[group])assert.ok(keys.includes('codex:'+prefix+name),name);
  for(const [group,prefix]of [['messages','message/'],['systems','system/']] as const)for(const name of source.claude[group])assert.ok(keys.includes('claude:'+prefix+name),name);
  assert.equal(nativeEventCatalog.find(e=>e.key==='notification/thread/realtime/outputAudio/delta')?.disposition,'unsupported');
  assert.equal(nativeEventCatalog.find(e=>e.key==='system/memory_recall')?.disposition,'private');
});
test('unknown envelopes and nested item, content, output, delta, status and result variants remain observable',()=>{
  for(const [runtime,value,key]of [
    ['codex',{method:'future/new',params:{token:'SECRET'}},'notification/future/new'],
    ['codex',{method:'future/request',id:1},'request/future/request'],
    ['codex',{method:'item/started',params:{item:{type:'futureItem',content:'SECRET'}}},'item/futureItem'],
    ['codex',{method:'item/completed',params:{item:{type:'mcpToolCall',result:{content:[{type:'futureOutput',text:'SECRET'}]}}}},'content/futureOutput'],
    ['codex',{method:'turn/completed',params:{turn:{status:'futureStatus'}}},'turn-status/futureStatus'],
    ['claude',{type:'futureEnvelope',data:'SECRET'},'message/futureEnvelope'],
    ['claude',{type:'system',subtype:'futureNotice'},'system/futureNotice'],
    ['claude',{type:'assistant',message:{content:[{type:'text',text:'public'},{type:'futureBlock',data:'SECRET'}]}},'content/futureBlock'],
    ['claude',{type:'user',message:{content:[{type:'tool_result',content:[{type:'futureMedia',data:'SECRET'}]}]}},'content/futureMedia'],
    ['claude',{type:'stream_event',event:{type:'content_block_delta',delta:{type:'futureDelta',text:'SECRET'}}},'delta/futureDelta'],
    ['claude',{type:'result',subtype:'future_result',is_error:false},'result/future_result'],
    ['claude',{type:'control_request',request_id:'q',request:{subtype:'future_control'}},'control/future_control'],
  ] as const){const events=inspectNativeEvent(runtime,value);assert.equal(events.find(e=>e.key===key)?.disposition,'unknown',key);assert.doesNotMatch(JSON.stringify(events),/SECRET/);}
  assert.equal(inspectNativeEvent('claude',{type:'system'}).at(-1)?.disposition,'malformed');
  assert.equal(inspectNativeEvent('codex',{method:'https://secret/token'}).at(-1)?.key,'notification/[invalid]');
});
test('bounded receipts coalesce repeats, retain totals after overflow and never retain hidden payloads',()=>{
  const monitor=new NativeEventMonitor('codex',new NativeEventRegistry());
  for(let n=0;n<400;n++)monitor.observe(frame({method:'future/one',params:{secret:'HIDDEN',thinking:'THINKING'}},n));
  assert.equal(monitor.snapshot().unknown,400);assert.equal(monitor.snapshot().receipts.length,1);assert.equal(monitor.snapshot().receipts[0]?.count,400);
  let last;for(let n=0;n<400;n++)last=monitor.observe(frame({method:'future/type'+n,params:{secret:'HIDDEN'}},400+n));
  const audit=monitor.snapshot();assert.equal(audit.frames,800);assert.equal(audit.receipts.length,256);assert.equal(audit.omitted,145);assert.equal(last?.at(-1)?.receipt.key,'audit/overflow');
  assert.doesNotMatch(JSON.stringify(audit),/HIDDEN|THINKING|rawText|rawBase64/);
  const resumed=new NativeEventMonitor('codex',new NativeEventRegistry(),audit);resumed.observe(frame({method:'future/one'}));assert.equal(resumed.snapshot().receipts[0]?.count,401);
  const privateMonitor=new NativeEventMonitor('claude',new NativeEventRegistry());assert.equal(privateMonitor.observe(frame({type:'system',subtype:'memory_recall',memories:[{content:'PRIVATE_MEMORY'}]})).length,0);assert.doesNotMatch(JSON.stringify(privateMonitor.snapshot()),/PRIVATE_MEMORY/);
});
test('nonpublic root and child events reach production observation without becoming text or completing a turn',async()=>{
  const {session,state}=fixture(),source=new EventEmitter(),registry=new NativeEventRegistry();
  const observation=attachNativeObservation('session',source,()=>state,async change=>{change(state);},undefined,registry);
  const unknown=frame({method:'future/notify',params:{threadId:'root',text:'OPAQUE_SECRET'}},1);
  assert.equal(normalizeCodexEvent(unknown,'session',1).public,false);source.emit('event',normalizeCodexEvent(unknown,'session',1));
  source.emit('childEvent',{nativeThreadId:'child',frame:frame({method:'future/child',params:{threadId:'child',text:'CHILD_SECRET'}},2)});
  source.emit('event',normalizeCodexEvent(frame({method:'future/foreign',params:{threadId:'foreign'}},3),'session',3));
  source.emit('raw',frame({id:17,result:{token:'RPC_SECRET'}},4));
  await observation.flush();assert.equal(session.nativeEventAudit?.frames,3);assert.equal(session.nativeEventAudit?.unknown,2);assert.equal(session.activities?.length,2);assert.equal(session.activities?.find(a=>a.protocol?.receipt.key==='notification/future/child')?.nativeChildId,'child');
  assert.equal(session.messages.length,0);assert.equal(session.status,'running');assert.doesNotMatch(JSON.stringify(session),/OPAQUE_SECRET|CHILD_SECRET|RPC_SECRET|future\/foreign/);
  source.emit('disconnect');await observation.flush();const before=session.nativeEventAudit?.frames;source.emit('event',normalizeCodexEvent(frame({method:'after/dispose'}),'session',5));assert.equal(session.nativeEventAudit?.frames,before);await observation.dispose();
});
test('schema-specific patch, warning, denial and background task events reach actual activity handlers',()=>{
  const codex=new NativeActivityTracker('codex');
  const patch=frame({method:'item/fileChange/patchUpdated',params:{threadId:'root',turnId:'turn',itemId:'edit',changes:[{path:'fixture.txt',kind:{type:'update'},diff:'-before\n+after'}]}});
  assert.equal(normalizeCodexEvent(patch,'session',1).public,true);const edit=codex.observe(patch)[0]!;assert.equal(edit.fileChanges?.[0]?.path,'fixture.txt');assert.equal(edit.status,'running');
  const warning=frame({method:'configWarning',params:{summary:'Invalid fixture setting',details:'Public warning',private:'SECRET'}});
  assert.equal(normalizeCodexEvent(warning,'session',2).public,true);assert.match(codex.observe(warning)[0]!.output!,/Public warning/);
  const claude=new NativeActivityTracker('claude');const denial=frame({type:'system',subtype:'permission_denied',tool_name:'Bash',tool_use_id:'tool',message:'Native denial'});
  assert.equal(normalizeClaudeEvent(denial,'session',1).public,true);assert.equal(claude.observe(denial)[0]?.status,'failed');
  claude.observe(frame({type:'assistant',message:{content:[{type:'tool_use',id:'shell',name:'Bash',input:{run_in_background:true}}]}}));
  claude.observe(frame({type:'system',subtype:'task_started',task_id:'task',tool_use_id:'shell',task_type:'local_bash'}));
  assert.equal(claude.observe(frame({type:'system',subtype:'task_updated',task_id:'task',patch:{status:'completed'}}))[0]?.status,'completed');
});
test('future terminal outcomes cannot masquerade as successful Claude results',()=>{
  assert.equal(claudeResultOutcome({type:'result',is_error:false,subtype:'success'}),'completed');
  assert.equal(claudeResultOutcome({type:'result',is_error:false,subtype:'error_max_turns'}),'failed');
  assert.equal(claudeResultOutcome({type:'result',is_error:false,subtype:'future_success'}),undefined);
  assert.equal(claudeResultOutcome({type:'result',subtype:'success'}),undefined);
  assert.equal(normalizeClaudeEvent(frame({type:'result',is_error:false,subtype:'future_success'}),'session',1).type,'error');
});

test('new status values stay uncertain and bounded inspection never truncates silently',()=>{
  const cases:[ 'codex'|'claude',Record<string,unknown>,string ][]=[
    ['codex',{method:'item/completed',params:{item:{id:'tool',type:'commandExecution',status:'futureStatus'}}},'item-status/futureStatus'],
    ['codex',{method:'mcpServer/startupStatus/updated',params:{name:'fixture',status:'futureStatus'}},'mcp-startup-status/futureStatus'],
    ['codex',{method:'hook/completed',params:{run:{id:'hook',status:'futureStatus'}}},'hook-status/futureStatus'],
    ['codex',{method:'item/autoApprovalReview/completed',params:{reviewId:'review',review:{status:'futureStatus'}}},'review-status/futureStatus'],
    ['claude',{type:'system',subtype:'plugin_install',name:'fixture',status:'futureStatus'},'plugin-status/futureStatus'],
    ['claude',{type:'system',subtype:'hook_response',hook_id:'hook',outcome:'futureStatus'},'hook-outcome/futureStatus'],
  ];
  for(const [runtime,value,key]of cases){assert.equal(new NativeActivityTracker(runtime).observe(frame(value))[0]?.status,'uncertain',key);assert.equal(inspectNativeEvent(runtime,value).find(e=>e.key===key)?.disposition,'unknown',key);}
  const completed=frame({method:'turn/completed',params:{turn:{status:'futureStatus'}}});assert.equal(normalizeCodexEvent(completed,'session',1).type,'error');
  const retry=new NativeActivityTracker('claude');retry.observe(frame({type:'system',subtype:'api_retry',attempt:1,max_retries:3,retry_delay_ms:100,error_status:503,error:'overloaded'}));assert.equal(retry.observe(frame({type:'result',is_error:false,subtype:'future_success'}))[0]?.status,'uncertain');
  const oversize=inspectNativeEvent('claude',{type:'assistant',message:{content:Array.from({length:300},()=>({type:'text',text:'SECRET'}))}});assert.equal(oversize.at(-1)?.key,'inspection/truncated');assert.doesNotMatch(JSON.stringify(oversize),/SECRET/);
  const malformed=inspectNativeEvent('claude',{type:'result',subtype:'success'});assert.equal(malformed.at(-1)?.disposition,'malformed');
});
test('presentation failures, asynchronous returns, hidden data and multiple layers preserve the core fallback',async()=>{
  const registry=new NativeEventRegistry(),monitor=new NativeEventMonitor('claude',registry);
  const first=registry.register('one',{id:'p',runtime:'claude',keys:['system/future'],present:()=>({title:'First'})});
  const second=registry.register('two',{id:'p',runtime:'claude',keys:['system/future'],present:()=>({title:'Second'})});
  assert.equal(monitor.observe(frame({type:'system',subtype:'future'}))[0]?.presentation?.title,'Second');second();
  assert.equal(monitor.observe(frame({type:'system',subtype:'future'}))[0]?.presentation?.title,'First');
  const faulty=registry.register('bad',{id:'p',runtime:'claude',keys:['system/future'],present:()=>{throw Error('SECRET_FAILURE');}});
  const notice=monitor.observe(frame({type:'system',subtype:'future'}))[0]!;assert.equal(notice.presentation?.title,'First');assert.equal(notice.receipt.adapterFailed,true);assert.doesNotMatch(JSON.stringify(notice),/SECRET_FAILURE/);faulty();
  const late=registry.register('late',{id:'p',runtime:'claude',keys:['system/future'],present:(()=>Promise.resolve({title:'Late'})) as any});
  assert.equal(monitor.observe(frame({type:'system',subtype:'future'}))[0]?.presentation?.title,'First');late();await new Promise(resolve=>setImmediate(resolve));
  let called=false;const privateRelease=registry.register('private',{id:'p',runtime:'claude',keys:['content/thinking'],present:()=>{called=true;return{title:'Do not display'};}});
  monitor.observe(frame({type:'assistant',message:{content:[{type:'thinking',thinking:'SECRET_REASONING'}]}}));assert.equal(called,false);privateRelease();
  assert.throws(()=>registry.register('invalid',{id:'bad/id',runtime:'claude',keys:['*'],present:()=>undefined}),/INVALID/);
  first();assert.ok(monitor.releaseMissingPresenters().every(n=>!n.presentation));
});
