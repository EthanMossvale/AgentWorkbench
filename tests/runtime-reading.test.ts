import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {NativeActivityTracker,mergeActivity,mergeChild} from '../packages/collaboration-core/activity';
import {normalizeCodexEvent,CodexRpcClient} from '../packages/runtime-codex';
import {normalizeClaudeEvent} from '../packages/runtime-claude';
import {decodeNativeFrame} from '../services/remote-supervisor';
import type {ProcessSupervisor} from '../services/remote-supervisor';
import {readingTurns} from '../packages/collaboration-core/reading-turns';
import {conversationTimeline,sessionTimeline} from '../packages/collaboration-core/timeline';
import {ClaudeNativeChildTracker} from '../packages/collaboration-core/events';
import type {Session} from '../packages/contracts';
import type {RuntimeActivity,NativeChildSnapshot} from '../packages/collaboration-core/activity';
const at='2026-09-27T19:00:00.000Z';
const frame=(value:unknown)=>decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'),at);

test('retry recovery is scoped to the native turn and child and ignores malformed Claude content',()=>{
 const codex=new NativeActivityTracker('codex');
 const retry={method:'error',params:{turnId:'one',willRetry:true,error:{message:'Transient'}}};
 codex.observe(frame(retry));codex.observe(frame(retry),'child');
 const recovered=(turnId:string)=>frame({method:'item/completed',params:{turnId,item:{id:'answer',type:'agentMessage',text:'Recovered'}}});
 assert.ok(!codex.observe(recovered('other')).some(a=>a.category==='retry'));
 assert.equal(codex.observe(recovered('one'),'child').filter(a=>a.category==='retry').length,1);
 assert.equal(codex.observe(recovered('one')).filter(a=>a.category==='retry').length,1);
 const claude=new NativeActivityTracker('claude');
 claude.observe(frame({type:'system',subtype:'api_retry',attempt:1,max_retries:2,retry_delay_ms:1,error_status:503,error:'overloaded'}));
 for(const content of [[null,42],[{type:'thinking'}]])assert.ok(!claude.observe(frame({type:'assistant',message:{content}})).some(a=>a.category==='retry'));
 assert.ok(!claude.observe(frame({type:'assistant',isApiErrorMessage:true,message:{content:[{type:'text',text:'Failed'}]}})).some(a=>a.category==='retry'));
 const events=claude.observe(frame({type:'assistant',message:{content:[null,{type:'tool_use',id:'read',name:'Read',input:{file_path:'fixture'}}]}}));
 assert.equal(events.find(a=>a.category==='retry')?.status,'completed');assert.ok(events.some(a=>a.toolName==='Read'));
});

test('only a bound Codex child turn completion closes its lifecycle without a parent wait call',()=>{
  const transport=new EventEmitter(),rpc=new CodexRpcClient(transport as ProcessSupervisor,'session'),events:Record<string,unknown>[]=[];rpc.bindRootThread('root');rpc.on('childAgent',event=>events.push(event));
  transport.emit('frame',frame({method:'thread/started',params:{thread:{id:'child',parentThreadId:'root'}}}));
  transport.emit('frame',frame({method:'turn/completed',params:{threadId:'unknown',turn:{id:'unknown-turn',status:'completed'}}}));
  transport.emit('frame',frame({method:'turn/completed',params:{threadId:'child',turn:{id:'child-turn',status:'completed'}}}));
  assert.deepEqual(events.map(event=>[event.nativeChildId,event.operation]),[['child','spawn'],['child','completed']]);
});

test('Codex public item categories include search images compaction and metadata-only reasoning',()=>{
  const tracker=new NativeActivityTracker('codex');
  for(const [type,category]of [['webSearch','search'],['imageView','image'],['imageGeneration','image-generation'],['contextCompaction','compaction'],['reasoning','reasoning'],['sleep','wait'],['enteredReviewMode','review'],['hookPrompt','hook']]){
    const f=frame({method:'item/started',params:{threadId:'root',turnId:'turn',item:{id:type,type,summary:['PRIVATE_REASONING'],content:['PRIVATE_REASONING'],result:'BASE64_IMAGE_PAYLOAD'}}});
    assert.equal(normalizeCodexEvent(f,'session',1).public,true);const item=tracker.observe(f)[0]!;assert.equal(item.category,category);assert.equal(item.status,'running');assert.doesNotMatch(JSON.stringify(item),/PRIVATE_REASONING|BASE64_IMAGE_PAYLOAD/);
    const complete=tracker.observe(frame({method:'item/completed',params:{turnId:'turn',item:{id:type,type}}}))[0]!;assert.equal(complete.status,'completed');
  }
});
test('Codex standalone outputs and hook context retain only bounded public text',()=>{
  const tracker=new NativeActivityTracker('codex');
  const output=tracker.observe(frame({method:'item/completed',params:{item:{id:'o',type:'functionCallOutput',name:'fixture',output:[{type:'inputText',text:'Public output'},{type:'image',data:'SECRET_IMAGE'}]}}}))[0]!;
  assert.equal(output.output,'Public output');assert.equal(output.toolName,'fixture');assert.doesNotMatch(JSON.stringify(output),/SECRET_IMAGE/);
  const hook=tracker.observe(frame({method:'item/completed',params:{item:{id:'h',type:'hookPrompt',fragments:[{text:'Public hook context'}]}}}))[0]!;assert.equal(hook.input,'Public hook context');
});
test('Codex retry progress hook and reroute notices are public, bounded, and do not invent attempt counts',()=>{
  const tracker=new NativeActivityTracker('codex'),items:RuntimeActivity[]=[];
  const values=[{method:'error',params:{turnId:'turn',willRetry:true,error:{message:'Transient stream interruption'}}},{method:'hook/started',params:{run:{id:'hook',eventName:'PreToolUse'}}},{method:'hook/completed',params:{run:{id:'hook',eventName:'PreToolUse',status:'completed',statusMessage:'Hook finished'}}},{method:'model/rerouted',params:{turnId:'turn',fromModel:'old',toModel:'new',reason:'native_reason'}},{method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}}];
  for(const value of values){const f=frame(value);assert.equal(normalizeCodexEvent(f,'root',1).public,true);for(const update of tracker.observe(f))mergeActivity(items,update);}
  assert.equal(items.length,3);assert.equal(items.find(i=>i.category==='retry')?.status,'completed');assert.equal(items.find(i=>i.category==='retry')?.attempt,undefined);assert.equal(items.find(i=>i.category==='hook')?.status,'completed');assert.match(items.find(i=>i.title==='Model rerouted')?.output??'',/old → new/);
});
test('Claude compaction retry hook and tool heartbeat preserve native progress without fake completion',()=>{
  const tracker=new NativeActivityTracker('claude'),items:RuntimeActivity[]=[];
  const values=[{type:'system',subtype:'status',status:'compacting'},{type:'system',subtype:'compact_boundary',compact_metadata:{trigger:'auto',pre_tokens:88000}},{type:'system',subtype:'api_retry',attempt:2,max_retries:5,retry_delay_ms:700,error_status:503,error:'overloaded'},{type:'assistant',message:{content:[{type:'tool_use',id:'tool',name:'Read',input:{file_path:'fixture.txt'}}]}},{type:'tool_progress',tool_use_id:'tool',tool_name:'Read',parent_tool_use_id:null,elapsed_time_seconds:30},{type:'system',subtype:'hook_started',hook_id:'hook',hook_name:'Check',hook_event:'PreToolUse'},{type:'system',subtype:'hook_response',hook_id:'hook',hook_name:'Check',outcome:'success',output:'Hook finished'},{type:'tool_use_summary',uuid:'summary',summary:'Read a fixture'},{type:'rate_limit_event',rate_limit_info:{status:'allowed_warning',utilization:0.9}}];
  for(const value of values){const f=frame(value);assert.equal(normalizeClaudeEvent(f,'root',1).public,true);for(const update of tracker.observe(f))mergeActivity(items,update);}
  assert.equal(items.filter(i=>i.category==='compaction').length,1);assert.equal(items.find(i=>i.category==='compaction')?.status,'completed');assert.equal(items.find(i=>i.category==='retry')?.attempt,2);assert.equal(items.find(i=>i.toolName==='Read')?.durationMs,30000);assert.equal(items.find(i=>i.toolName==='Read')?.status,'running');
  assert.equal(items.find(i=>i.category==='retry')?.status,'completed');
  const final=tracker.observe(frame({type:'result',is_error:true}));assert.equal(final.find(i=>i.category==='retry'),undefined);
  const second=tracker.observe(frame({type:'system',subtype:'api_retry',attempt:1,max_retries:5,retry_delay_ms:1,error_status:503,error:'overloaded'}))[0]!;assert.notEqual(second.id,items.find(i=>i.category==='retry')?.id);
  const result=tracker.observe(frame({type:'result',uuid:'result',duration_ms:700,num_turns:2,usage:{input_tokens:31,output_tokens:15},total_cost_usd:123}));const usage=result.find(i=>i.category==='usage')!;assert.match(usage.output??'',/inputTokens/);assert.doesNotMatch(usage.output??'',/cost|123/);
});
test('MCP progress and terminal input attach to their existing tool rather than creating duplicate rows',()=>{
  const tracker=new NativeActivityTracker('codex');
  tracker.observe(frame({method:'item/started',params:{turnId:'t',item:{id:'tool',type:'mcpToolCall',tool:'fixture'}}}));
  const item=tracker.observe(frame({method:'item/mcpToolCall/progress',params:{turnId:'t',itemId:'tool',message:'Halfway'}}))[0]!;assert.match(item.output??'',/Halfway/);assert.equal(item.id,'codex:root:t:tool');
});
test('Claude thinking indicator stores lifecycle only and excludes hidden text and signatures',()=>{
  const tracker=new NativeActivityTracker('claude');
  const start=frame({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'PRIVATE_THOUGHT',signature:'OPAQUE_SIGNATURE'}}});
  assert.equal(normalizeClaudeEvent(start,'root',1).text,'');assert.equal(normalizeClaudeEvent(start,'root',1).public,true);
  const begin=tracker.observe(start)[0]!;assert.equal(begin.category,'reasoning');assert.doesNotMatch(JSON.stringify(begin),/PRIVATE_THOUGHT|OPAQUE_SIGNATURE/);
  assert.equal(tracker.observe(frame({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'PRIVATE_THOUGHT'}}})).length,0);
  const end=tracker.observe(frame({type:'stream_event',event:{type:'content_block_stop',index:0}}))[0]!;assert.equal(end.id,begin.id);assert.equal(end.status,'completed');
});
test('completed reading turns preserve chronological follow-ups and final answers',()=>{
  const session={id:'root',status:'idle',messages:[{id:'u1',role:'user',original:'First',timestamp:at,nativeTurnId:'t'},{id:'comment',role:'assistant',original:'Working',timestamp:at,phase:'commentary',nativeTurnId:'t'},{id:'u2',role:'user',original:'Also check this',timestamp:at,nativeTurnId:'t'},{id:'final',role:'assistant',original:'Done',timestamp:at,phase:'final',nativeTurnEnd:true,nativeTurnId:'t'}]} as Session;
  const saved=JSON.stringify(session),turns=readingTurns(conversationTimeline(session),session);assert.equal(turns.length,1);assert.equal(turns[0]!.completed,true);assert.equal(turns[0]!.attention,false);assert.deepEqual(turns[0]!.users.map(e=>e.id),['u1','u2']);assert.deepEqual(turns[0]!.ordered!.map(e=>e.id),['u1','comment','u2','final']);assert.deepEqual(turns[0]!.answers.map(e=>e.id),['final']);assert.deepEqual(turns[0]!.process.map(e=>e.id),['comment']);assert.equal(JSON.stringify(session),saved);
  session.status='running';assert.equal(readingTurns(conversationTimeline(session),session)[0]!.completed,false);
});

test('successful completion folds recovered failed attempts but preserves outstanding native work',()=>{
  const session={id:'root',status:'idle',nativeTurnStatus:'completed',messages:[{id:'u',role:'user',original:'Check',timestamp:at,nativeTurnId:'t'},{id:'final',role:'assistant',original:'Recovered and complete',timestamp:at,nativeTurnId:'t',phase:'final',nativeTurnEnd:true}],activities:[{id:'attempt',runtime:'codex',kind:'command',status:'failed',turnId:'t',startedAt:at,updatedAt:at}]} as Session;
  let turn=readingTurns(conversationTimeline(session),session)[0]!;assert.equal(turn.completed,true);assert.equal(turn.attention,false);assert.ok(turn.process.some(e=>e.id==='attempt'));
  session.activities![0]!.status='uncertain';turn=readingTurns(conversationTimeline(session),session)[0]!;assert.equal(turn.attention,true);
});
test('child lifecycle start and completion occupy separate chronological positions without duplicate replies',()=>{
  const items:NativeChildSnapshot[]=[];mergeChild(items,{runtime:'codex',nativeChildId:'child',operation:'spawn',status:'started'},at);mergeChild(items,{runtime:'codex',nativeChildId:'child',operation:'completed',status:'completed'},'2026-09-27T19:00:04.000Z');
  const entries=sessionTimeline({id:'root',messages:[],nativeChildren:items} as unknown as Session);assert.deepEqual(entries.map(e=>[e.type,e.type==='child'?e.lifecycle:undefined]),[['child','started'],['child','finished']]);
});
test('Claude task patches and public usage stay child-scoped',()=>{
  const tracker=new ClaudeNativeChildTracker();tracker.observe(frame({type:'system',subtype:'task_started',task_id:'child',task_type:'local_agent'}),'root');
  const progress=tracker.observe(frame({type:'system',subtype:'task_progress',task_id:'child',usage:{total_tokens:40,tool_uses:2,duration_ms:700},last_tool_name:'Read'}));assert.deepEqual(progress.events[0]!.usage,{tokens:40,toolUses:2,durationMs:700});
  const done=tracker.observe(frame({type:'system',subtype:'task_updated',task_id:'child',patch:{status:'killed'}}));assert.equal(done.events[0]?.operation,'closed');assert.equal(done.child,true);
});
