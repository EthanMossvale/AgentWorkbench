import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { NativeChildConversationTracker,NativeChildLifecycle,recordChildMessage } from '../packages/collaboration-core/child-conversation';
import { ClaudeNativeChildTracker } from '../packages/collaboration-core/events';
import { attachNativeObservation } from '../apps/desktop/host/native-observation';
import { conversationTimeline } from '../packages/collaboration-core/timeline';
import type { NativeChildSnapshot } from '../packages/collaboration-core/activity';
import type { AppState,Session } from '../packages/contracts';
import { decodeNativeFrame } from '../services/remote-supervisor';
const at='2026-09-27T18:00:00Z';
const frame=(value:unknown)=>decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'),at);
const snapshot=():NativeChildSnapshot=>({runtime:'codex',nativeChildId:'child',operation:'spawn',status:'started',updatedAt:at});

test('child messages merge streaming and final text without retaining reasoning or replay duplicates',()=>{
  const tracker=new NativeChildConversationTracker(),child=snapshot();
  for(const value of [{method:'item/agentMessage/delta',params:{itemId:'message',delta:'Hello '}},{method:'item/agentMessage/delta',params:{itemId:'message',delta:'child'}},{method:'item/completed',params:{item:{id:'message',type:'agentMessage',text:'Hello child',encrypted_content:'hidden'}}},{method:'item/agentMessage/delta',params:{itemId:'message',delta:'duplicate'}}]){const item=frame(value),update=tracker.observe('codex','child',item);if(update)recordChildMessage(child,update,item);}
  assert.equal(child.messages?.length,1);assert.equal(child.messages[0]!.text,'Hello child');assert.equal(child.messages[0]!.complete,true);assert.doesNotMatch(JSON.stringify(child),/hidden|duplicate/);
  assert.equal(tracker.observe('codex','child',frame({method:'item/reasoning/textDelta',params:{delta:'private'}})),undefined);
});

test('Claude native Agent metadata and foreground completion remain correlated to the originating tool',()=>{
  const tracker=new ClaudeNativeChildTracker();
  tracker.observe(frame({type:'assistant',session_id:'parent',message:{content:[{type:'tool_use',id:'agent-tool',name:'Agent',input:{description:'Review parsing',prompt:'Review the public parser.',model:'sonnet'}}]}}));
  const started=tracker.observe(frame({type:'assistant',parent_tool_use_id:'agent-tool',message:{id:'msg',content:[{type:'text',text:'Working'}]}}),'parent').events[0]!;assert.equal(started.title,'Review parsing');assert.equal(started.task,'Review the public parser.');
  const finished=tracker.observe(frame({type:'user',session_id:'parent',tool_use_result:{agentId:'native-agent'},message:{content:[{type:'tool_result',tool_use_id:'agent-tool',content:'Done'}]}})).events[0]!;assert.equal(finished.nativeChildId,'native-agent');assert.equal(finished.operation,'completed');
});

test('Claude native async receipt does not complete a child even when the request omitted background mode',()=>{
  const tracker=new ClaudeNativeChildTracker(),conversation=new NativeChildConversationTracker();
  tracker.observe(frame({type:'assistant',session_id:'parent',message:{content:[{type:'tool_use',id:'agent-tool',name:'Agent',input:{description:'Review',prompt:'Review input.'}}]}}));
  tracker.observe(frame({type:'system',subtype:'task_started',task_id:'child',tool_use_id:'agent-tool',task_type:'local_agent',is_backgrounded:true,session_id:'parent'}));
  const receipt=tracker.observe(frame({type:'user',session_id:'parent',tool_use_result:{agentId:'child',isAsync:true},message:{content:[{type:'tool_result',tool_use_id:'agent-tool',content:'Async agent launched'}]}}));assert.equal(receipt.events.length,0);
  const done=frame({type:'system',subtype:'task_notification',task_id:'child',tool_use_id:'agent-tool',status:'completed',summary:'Public child result',session_id:'parent'});assert.equal(tracker.observe(done).events[0]?.operation,'completed');assert.equal(conversation.observe('claude','child',done)?.text,'Public child result');
});

test('native observation persists a child conversation without mixing it into parent messages',async()=>{
  const parent={id:'root',binding:{runtime:'claude',provider:'source',accountRef:'model-api:source',executionId:'local-device',egress:'direct-api',modelConnectionId:'source',modelMappingId:'model'},messages:[]} as unknown as Session;
  const state={sessions:[parent],hosts:[]} as unknown as AppState,source=new EventEmitter();
  const observer=attachNativeObservation('root',source,()=>structuredClone(state),async change=>change(state));
  source.emit('childAgent',{runtime:'claude',nativeChildId:'parent-tool-use:tool',toolCallId:'tool',operation:'progress',status:'message'});
  source.emit('childEvent',{nativeChildId:'parent-tool-use:tool',frame:frame({type:'assistant',parent_tool_use_id:'tool',message:{id:'reply',content:[{type:'thinking',thinking:'Hidden',signature:'private'},{type:'text',text:'Public child reply'}]}})});
  source.emit('childAgent',{runtime:'claude',nativeChildId:'actual-child',toolCallId:'tool',nativeParentId:'root-thread',title:'Review',operation:'completed',status:'completed'});
  await observer.flush();assert.equal(parent.messages.length,0);assert.equal(parent.nativeChildren?.length,1);assert.equal(parent.nativeChildren[0]!.nativeChildId,'actual-child');assert.equal(parent.nativeChildren[0]!.messages?.[0]!.text,'Public child reply');assert.doesNotMatch(JSON.stringify(parent.nativeChildren),/Hidden|private/);
  await observer.dispose();assert.equal(parent.nativeChildren[0]!.operation,'completed');
});

test('native child lifecycle has no workbench capacity limit and waits for every observed child',()=>{
  const lifecycle=new NativeChildLifecycle();
  for(let i=0;i<150;i++)lifecycle.observe({runtime:'codex',nativeChildId:String(i),operation:'spawn',status:'running'});
  for(let i=0;i<149;i++)lifecycle.observe({runtime:'codex',nativeChildId:String(i),operation:'completed',status:'completed'});
  assert.equal(lifecycle.pending,true);lifecycle.observe({runtime:'codex',nativeChildId:'149',operation:'completed',status:'completed'});assert.equal(lifecycle.pending,false);
  lifecycle.observe({runtime:'codex',nativeChildId:'149',operation:'progress',status:'message'});assert.equal(lifecycle.pending,false);
});

test('parent timeline shows navigable native and cross-source cards while child tools stay in their child view',()=>{
  const parent={id:'parent',messages:[],activities:[{id:'tool',nativeChildId:'child',startedAt:at}],nativeChildren:[{...snapshot(),nativeChildId:'child',startedAt:at},{...snapshot(),nativeChildId:'nested',nativeParentId:'child',startedAt:at}]} as unknown as Session;
  const delegated={id:'other-source',createdAt:at,agentParent:{sessionId:'parent'}} as Session;
  assert.deepEqual(conversationTimeline(parent,[],[delegated]).map(entry=>entry.type),['child','delegated']);
});
