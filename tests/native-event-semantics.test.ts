import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeNativeFrame} from '../services/remote-supervisor';
import {ClaudeNativeChildTracker} from '../packages/collaboration-core/events';
import {NativeChildLifecycle} from '../packages/collaboration-core/child-conversation';
import {NativeActivityTracker,mergeActivity} from '../packages/collaboration-core/activity';
import {nativeEventSemantics,hasNativeBackground} from '../packages/native-events/semantics';
import {inspectNativeEvent,refreshNativeEventHistory,NativeEventRegistry,NativeEventMonitor} from '../packages/native-events';
import {normalizeClaudeEvent} from '../packages/runtime-claude';
import {ActivityGroupingRegistry} from '../packages/collaboration-core/activity-groups';
import {readingTurns} from '../packages/collaboration-core/reading-turns';
import {conversationTimeline} from '../packages/collaboration-core/timeline';
import type {Session} from '../packages/contracts';
import type {RuntimeActivity} from '../packages/collaboration-core/activity';

const at='2026-09-30T00:00:00.000Z';
const frame=(value:unknown)=>decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'),at);
const state=()=>({id:'s',status:'idle',messages:[],binding:{runtime:'claude'},nativeChildren:[]} as unknown as Session);
const start={type:'system',subtype:'task_started',task_id:'child',tool_use_id:'agent',task_type:'local_agent',is_backgrounded:true};
const empty={type:'system',subtype:'background_tasks_changed',tasks:[]};
test('known native wire notifications and requesting never use unknown fallback',()=>{
  for(const value of [{type:'command_lifecycle',command_uuid:'prompt',state:'completed'},{type:'system',subtype:'status',status:'requesting'},{type:'system',subtype:'code_change_published'},empty])assert.ok(inspectNativeEvent('claude',value).every(e=>!['unknown','malformed','unsupported'].includes(e.disposition)));
  for(const value of [{type:'command_lifecycle',command_uuid:'prompt',state:'future'},{type:'system',subtype:'session_state_changed',state:'future'},{type:'system',subtype:'status',status:'future'}])assert.equal(inspectNativeEvent('claude',value).at(-1)?.disposition,'unknown');
  for(const value of [{type:'command_lifecycle',state:'started'},{type:'system',subtype:'background_tasks_changed',tasks:[{task_id:'one'}]}])assert.equal(inspectNativeEvent('claude',value).at(-1)?.disposition,'malformed');
});
test('command receipts change only their own prompt metadata, never result or resubmission',()=>{
  const s=state();s.messages=[{id:'prompt',role:'user',original:'Task',demo:false,timestamp:at}];
  for(const status of ['queued','started','completed','cancelled','discarded','refused']){nativeEventSemantics.apply(s,frame({type:'command_lifecycle',command_uuid:'prompt',state:status}));assert.equal(s.messages[0]!.nativeCommandState,status);assert.equal(s.nativeTurnStatus,undefined);assert.equal(s.status,'idle');}
  nativeEventSemantics.apply(s,frame({type:'command_lifecycle',command_uuid:'foreign',state:'completed'}));assert.equal(s.messages[0]!.nativeCommandState,'refused');
});
test('requesting and compaction success/failure finish their own status without unknown outcomes',()=>{
  const tracker=new NativeActivityTracker('claude'),items:RuntimeActivity[]=[];
  for(const value of [{status:'requesting'},{status:null},{status:'compacting'},{status:null,compact_result:'failed',compact_error:'Synthetic failed compaction'}]){const f=frame({type:'system',subtype:'status',...value});assert.equal(normalizeClaudeEvent(f,'s',1).public,true);for(const activity of tracker.observe(f))mergeActivity(items,activity);}
  assert.equal(items.find(a=>a.category==='wait')?.status,'completed');assert.equal(items.find(a=>a.category==='compaction')?.status,'failed');assert.match(items.find(a=>a.category==='compaction')!.output!,/Synthetic/);
});
test('background snapshots replace activity indicators but drain waits for idle or terminal edge',()=>{
  const tracker=new ClaudeNativeChildTracker(),lifecycle=new NativeChildLifecycle(),s=state();
  const child=tracker.observe(frame(start)).events[0]!;lifecycle.observe(child);s.nativeChildren!.push({...child,updatedAt:at});assert.equal(lifecycle.pending,true);
  lifecycle.observeFrame(frame(empty));nativeEventSemantics.apply(s,frame(empty));assert.equal(lifecycle.pending,true);assert.equal(hasNativeBackground(s),false);assert.equal(s.nativeChildren![0]!.backgroundActive,false);assert.equal(s.nativeChildren![0]!.operation,'spawn');
  lifecycle.observeFrame(frame({type:'system',subtype:'session_state_changed',state:'idle'}));assert.equal(lifecycle.pending,false);
  const done=tracker.observe(frame({type:'system',subtype:'task_notification',task_id:'child',status:'completed'}));assert.equal(done.events[0]?.operation,'completed');
});
test('snapshot-only agents correlate later results; shell and ambient tasks never fabricate agents',()=>{
  const tracker=new ClaudeNativeChildTracker(),s=state(),snapshot={type:'system',subtype:'background_tasks_changed',tasks:[{task_id:'agent',task_type:'local_agent',description:'Agent'},{task_id:'bash',task_type:'local_bash',description:'Shell'},{task_id:'watcher',task_type:'local_agent',description:'Watcher',ambient:true}]};
  const observed=tracker.observe(frame(snapshot));assert.equal(observed.child,false);assert.deepEqual(observed.events.map(e=>e.nativeChildId),['agent']);nativeEventSemantics.apply(s,frame(snapshot));assert.equal(hasNativeBackground(s),true);
  nativeEventSemantics.apply(s,frame({...snapshot,tasks:[snapshot.tasks[2]]}));assert.equal(hasNativeBackground(s),false);
  assert.equal(tracker.observe(frame({type:'system',subtype:'task_notification',task_id:'agent',status:'failed'})).events[0]?.operation,'failed');
});
test('foreground tool result settles agent; delayed progress/start do not reopen its terminal identity',()=>{
  const tracker=new ClaudeNativeChildTracker();
  tracker.observe(frame({type:'assistant',message:{content:[{type:'tool_use',id:'agent',name:'Agent',input:{prompt:'Task'}}]}}));
  tracker.observe(frame({...start,is_backgrounded:false}));
  const result=tracker.observe(frame({type:'user',tool_use_result:{agentId:'child'},message:{content:[{type:'tool_result',tool_use_id:'agent',content:'Result'}]}}));assert.equal(result.events[0]?.operation,'completed');
  for(const value of [start,{type:'system',subtype:'task_progress',task_id:'child'},{type:'assistant',parent_tool_use_id:'agent',message:{content:[{type:'text',text:'Late text'}]}}])assert.equal(tracker.observe(frame(value)).events.length,0);
});
test('TaskStop requires matching typed task receipt; failed or text-only results do not close children',()=>{
  for(const [payload,isError,expected]of [[undefined,false,false],[{task_id:'other',task_type:'local_agent'},false,false],[{task_id:'child',task_type:'local_agent'},true,false],[{task_id:'child',task_type:'local_agent'},false,true]] as const){
    const tracker=new ClaudeNativeChildTracker();tracker.observe(frame(start));tracker.observe(frame({type:'assistant',message:{content:[{type:'tool_use',id:'stop',name:'TaskStop',input:{task_id:'child'}}]}}));
    const result=tracker.observe(frame({type:'user',tool_use_result:payload,message:{content:[{type:'tool_result',tool_use_id:'stop',is_error:isError,content:'Stopped'}]}}));assert.equal(result.events.some(e=>e.operation==='closed'),expected);
  }
});
test('reset and command snapshots retain history and remove only active context state',()=>{
  const s=state();s.messages=[{id:'old',role:'assistant',original:'History',demo:false,timestamp:at}];s.nativeContextUsage={used:100} as any;
  nativeEventSemantics.apply(s,frame({type:'system',subtype:'commands_changed',commands:[{name:'first',description:'First',argumentHint:''}]}));nativeEventSemantics.apply(s,frame({type:'system',subtype:'commands_changed',commands:[]}));assert.deepEqual(s.nativeProtocol?.commands,[]);
  nativeEventSemantics.apply(s,frame({type:'conversation_reset',new_conversation_id:'new'}));assert.equal(s.nativeProtocol?.conversationId,'new');assert.equal(s.messages.length,1);assert.equal(s.nativeContextUsage,undefined);
});
const entry=(id:string,runtime:RuntimeActivity['runtime']='claude',change:Partial<RuntimeActivity>={})=>({id,activity:{id,runtime,kind:'command' as const,status:'completed' as const,startedAt:at,updatedAt:at,...change}});
test('grouping is shared across runtimes and preserves text, attention, scope and turn boundaries',()=>{
  const registry=new ActivityGroupingRegistry();
  for(const runtime of ['claude','codex'] as const){const items=[entry('one',runtime),entry('two',runtime),{id:'text'},entry('three',runtime),entry('four',runtime,{status:'failed'}),entry('five',runtime,{turnId:'other'})];const groups=registry.group(items);assert.deepEqual(groups.map(g=>g.items.length),[2,1,2,1]);assert.equal(groups[2]!.attention,1);assert.deepEqual(groups.flatMap(g=>g.items),items);}
  assert.equal(registry.group([entry('a','claude'),entry('b','codex')]).length,2);
});
test('approved registry contributions can replace grouping labels but cannot hide live or failed work',()=>{
  const registry=new ActivityGroupingRegistry(),items=[entry('one'),entry('two')];let changes=0;const unsub=registry.subscribe(()=>changes++);
  const one=registry.register('plugin.one',{id:'view',classify:()=>({key:'same',label:'替换汇总'})});assert.equal(registry.group(items)[0]!.label,'替换汇总');
  const two=registry.register('plugin.two',{id:'bad',classify:()=>{throw Error('Failure');}});assert.equal(registry.group(items)[0]!.label,'替换汇总');
  const mixed=registry.group([entry('running','claude',{status:'running',title:'echo fixture'}),entry('failed','claude',{status:'failed'})]);assert.deepEqual(mixed.map(g=>g.items.length),[2]);assert.equal(mixed[0]!.attention,1);assert.equal(mixed[0]!.label,'替换汇总 · 正在运行 echo fixture');
  two.dispose();one.dispose();unsub();assert.equal(registry.group(items)[0]!.label,'运行了 2 个命令');assert.equal(changes,4);
});
test('startup metadata and unknown receipts use one diagnostic group without becoming pending tools',()=>{
  const registry=new ActivityGroupingRegistry(),items=[entry('mcp','codex',{presentation:'diagnostic'}),entry('state','codex',{presentation:'diagnostic'}),{id:'prompt'},entry('tool')];
  const groups=registry.group(items);assert.equal(groups[0]!.diagnostic,true);assert.equal(groups[0]!.items.length,2);assert.equal(groups[0]!.attention,0);assert.deepEqual(groups.flatMap(g=>g.items),items);
});
test('completed turn timing wins over a later legacy session stop flag',()=>{
  const s=state();s.nativeTurnStatus='interrupted';s.messages=[{id:'u',nativeTurnId:'turn',role:'user',original:'Task',demo:false,timestamp:at},{id:'a',nativeTurnId:'turn',role:'assistant',original:'Result',demo:false,timestamp:at,phase:'final',nativeTurnEnd:true}];s.turnTimings=[{id:'time',userMessageId:'u',nativeTurnId:'turn',startedAt:at,endedAt:at,status:'completed'}];
  const turn=readingTurns(conversationTimeline(s),s)[0]!;assert.equal(turn.completed,true);assert.equal(turn.replyId,'a');assert.equal(turn.timing?.id,'time');
});
test('old unknown notices become known metadata after upgrade without replay or success inference',()=>{
  const s=state(),monitor=new NativeEventMonitor('claude',new NativeEventRegistry());monitor.observe(frame({type:'system',subtype:'status',status:'future'}));
  const r={...monitor.snapshot().receipts.at(-1)!,key:'system-status/requesting'};s.nativeEventAudit=monitor.snapshot();s.nativeEventAudit.receipts=[r];s.activities=[entry('legacy','claude',{status:'uncertain',protocol:{receipt:{...r}}}).activity];
  refreshNativeEventHistory(s);assert.equal(s.nativeEventAudit.receipts[0]?.disposition,'handled');assert.equal(s.activities[0]?.status,'completed');assert.equal(s.status,'idle');assert.equal(s.nativeTurnStatus,undefined);assert.equal(s.messages.length,0);
});
test('copy diagnostics shares the public plugin projection and never copies extra payload fields',()=>{
  const registry=new NativeEventRegistry(),monitor=new NativeEventMonitor('claude',registry);monitor.observe(frame({type:'future_event',secret:'SECRET'}));const r=monitor.snapshot().receipts[0]!;const api=registry.scope('fixture',()=>{},release=>release);const output=api.diagnostic({...r,payload:'SECRET'} as any);assert.equal(JSON.parse(output).event,'message/future_event');assert.doesNotMatch(output,/SECRET|payload/);
});
