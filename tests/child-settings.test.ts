import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { childSettings,mergeChildSettings,nativeChildFrameSettings } from '../packages/collaboration-core/child-settings';
import { parseCodexNativeChildEvents,ClaudeNativeChildTracker } from '../packages/collaboration-core/events';
import { mergeChild,type NativeChildSnapshot } from '../packages/collaboration-core/activity';
import { attachNativeObservation } from '../apps/desktop/host/native-observation';
import { decodeNativeFrame } from '../services/remote-supervisor';
import type { AppState,Session } from '../packages/contracts';
const frame=(value:unknown)=>decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'),'2026-09-28T00:00:00Z');

test('child settings retain explicit false and ignore absent, synthetic and malformed fields',()=>{
  assert.deepEqual(childSettings({model:'inherit',serviceTier:null},'requested'),{});
  assert.deepEqual(childSettings({model:'<synthetic>',effort:'bad\nvalue'},'native'),{});
  assert.deepEqual(childSettings({serviceTier:'standard'},'native').fast,{value:false,source:'native'});
  assert.equal(childSettings({serviceTier:'unknown'},'native').fast,undefined);
  assert.equal(childSettings({fastMode:false},'native').fast?.value,false);
});

test('Codex configuration outranks requested model and keeps independent effort evidence',()=>{
  const items:NativeChildSnapshot[]=[];
  const native=parseCodexNativeChildEvents(frame({method:'thread/started',params:{thread:{id:'child',parentThreadId:'root',model:'selected-child',reasoningEffort:'medium'}}}))[0]!;
  const request=parseCodexNativeChildEvents(frame({method:'item/completed',params:{item:{type:'collabAgentToolCall',tool:'spawnAgent',senderThreadId:'root',receiverThreadIds:['child'],agentsStates:{child:{status:'running'}},model:'requested-child',reasoningEffort:'high'}}}))[0]!;
  mergeChild(items,native,'1');mergeChild(items,request,'2');
  assert.equal(items[0]!.settings?.model?.value,'selected-child');assert.equal(items[0]!.settings?.effort?.value,'medium');assert.equal(items[0]!.settings?.fast,undefined);
  assert.deepEqual(mergeChildSettings(childSettings({model:'m'},'native'),childSettings({effort:'high'},'requested')),{model:{value:'m',source:'native'},effort:{value:'high',source:'requested'}});
});

test('Claude response model is protocol metadata; identity claims in public prose are not parsed',()=>{
  const tracker=new ClaudeNativeChildTracker();tracker.observe(frame({type:'assistant',message:{content:[{type:'tool_use',id:'call',name:'Agent',input:{model:'sonnet'}}]}}));
  const task=tracker.observe(frame({type:'system',subtype:'task_started',task_type:'local_agent',task_id:'child',tool_use_id:'call'}));assert.deepEqual(task.events[0]!.settings,{model:{value:'sonnet',source:'requested'}});
  const value=nativeChildFrameSettings('claude',frame({type:'assistant',message:{model:'native-child',content:[{type:'text',text:'I use other-model with Fast and max effort.'}]}}));
  assert.deepEqual(value,{model:{value:'native-child',source:'native'}});
  assert.deepEqual(nativeChildFrameSettings('claude',frame({type:'stream_event',event:{type:'message_start',message:{model:'stream-model'}}})),{model:{value:'stream-model',source:'native'}});
});

test('observed child mapping is frozen, survives native identity replacement and never borrows later parent controls',async()=>{
  const session={id:'root',binding:{runtime:'claude',provider:'source',accountRef:'model-api:source',executionId:'local-device',egress:'direct-api',modelConnectionId:'source',modelMappingId:'mapping'},modelSelection:{model:'mapped-model',effort:'high'},messages:[]} as unknown as Session;
  const state={sessions:[session],hosts:[],modelConnections:[{id:'source',models:[{id:'mapping',model:'mapped-model',efforts:['high']}]}]} as unknown as AppState,source=new EventEmitter();
  const observer=attachNativeObservation('root',source,()=>structuredClone(state),async change=>change(state));
  source.emit('childAgent',{runtime:'claude',nativeChildId:'parent-tool-use:tool',toolCallId:'tool',model:'sonnet',operation:'spawn',status:'started'});
  source.emit('childEvent',{nativeChildId:'parent-tool-use:tool',frame:frame({type:'assistant',parent_tool_use_id:'tool',message:{id:'reply',model:'claude-alias',content:[{type:'text',text:'Done'}]}})});
  session.modelSelection={model:'later-parent',effort:'low',serviceTier:'priority'};
  source.emit('childAgent',{runtime:'claude',nativeChildId:'actual-child',toolCallId:'tool',operation:'completed',status:'completed'});
  await observer.flush();assert.equal(session.nativeChildren?.length,1);
  assert.deepEqual(session.nativeChildren![0]!.settings,{model:{value:'mapped-model',source:'provider'},effort:{value:'high',source:'provider'}});
  assert.equal(session.nativeChildren![0]!.messages?.[0]?.text,'Done');await observer.dispose();
});

test('unmapped children keep their own observed model without inventing parent effort or fast',async()=>{
  const session={id:'root',binding:{runtime:'claude',provider:'source',accountRef:'source',executionId:'local-device',egress:'vps',hostId:'host'},modelSelection:{model:'parent',effort:'max',serviceTier:'priority'},messages:[]} as unknown as Session;
  const state={sessions:[session],hosts:[{id:'host'}]} as unknown as AppState,source=new EventEmitter();
  const observer=attachNativeObservation('root',source,()=>structuredClone(state),async change=>change(state));
  source.emit('childAgent',{runtime:'claude',nativeChildId:'child',operation:'spawn',status:'started'});
  source.emit('childEvent',{nativeChildId:'child',frame:frame({type:'assistant',parent_tool_use_id:'tool',message:{model:'child-model',content:[]}})});
  await observer.flush();assert.deepEqual(session.nativeChildren![0]!.settings,{model:{value:'child-model',source:'native'}});await observer.dispose();
});
