import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityGroupingRegistry} from '../packages/collaboration-core/activity-groups';
import type {RuntimeActivity} from '../packages/collaboration-core/activity';
import {inspectNativeEvent} from '../packages/native-events/catalog';
import {refreshNativeEventHistory} from '../packages/native-events';
const activity=(toolName:string,input:unknown={},output:unknown={}):RuntimeActivity=>({id:toolName,runtime:'claude',kind:'tool',status:'completed',startedAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',toolName,input:JSON.stringify(input),output:JSON.stringify(output)});
test('chat targets use typed input or create receipt, never message text or unrelated output IDs',()=>{
 const r=new ActivityGroupingRegistry();
 for(const prefix of ['','mcp__workbench__']){
  assert.equal(r.chat(activity(prefix+'workbench_read_session',{sessionId:'target'},{session:{id:'wrong'}}))?.targetSessionId,'target');
  assert.equal(r.chat(activity(prefix+'workbench_send_message',{targetSessionId:'recipient'}))?.targetSessionId,'recipient');
  assert.equal(r.chat(activity(prefix+'workbench_create_session',{}, {sessionId:'new'}))?.targetSessionId,'new');
 }
 assert.equal(r.chat({...activity('workbench_read_session'),input:'{"sessionId":'})?.targetSessionId,undefined);
 assert.equal(r.chat(activity('workbench_read_session',{sessionId:{id:'fake'}}))?.targetSessionId,undefined);
 assert.equal(r.chat(activity('workbench_list_sessions',{}, {sessions:[{id:'not-a-target'}]}))?.targetSessionId,undefined);
});
test('single chats are standalone boundaries, multiple chats group without changing generic singleton behavior',()=>{
 const r=new ActivityGroupingRegistry(),chat=activity('workbench_read_session',{sessionId:'target'}),ordinary=activity('other');
 const entries=[ordinary,chat,ordinary].map((activity,i)=>({id:String(i),activity}));
 assert.deepEqual(r.group(entries).map(g=>g.items.length),[1,1,1]);assert.equal(r.group(entries)[1]!.label,'');assert.match(r.group(entries)[0]!.label,/工具/);
 assert.equal(r.group([{id:'a',activity:chat},{id:'b',activity:{...chat,kind:'message'}}])[0]!.label,'2 次聊天交互');
});
test('chat extensions share production grouping registry and restore on cleanup; bad and async layers cannot hide records',()=>{
 const r=new ActivityGroupingRegistry(),a=activity('custom');let updates=0;r.subscribe(()=>updates++);
 const handle=r.registerChat('test',{id:'chat',present:()=>({label:'Custom',targetSessionId:'t'})});
 assert.equal(r.chat(a)?.label,'Custom');assert.equal(r.group([{id:'a',activity:a}])[0]!.label,'');
 assert.throws(()=>r.registerChat('test',{id:'chat',present:()=>undefined}),/DUPLICATE/);
 const bad=r.registerChat('bad',{id:'chat',present:()=>{throw Error('fixture');}});assert.equal(r.chat(a)?.label,'Custom');bad.dispose();
 const asyncRule=r.registerChat('bad',{id:'async',present:(()=>Promise.resolve({label:'Late'})) as any});assert.equal(r.chat(a)?.label,'Custom');asyncRule.dispose();
 handle.dispose();assert.equal(r.chat(a),undefined);assert.match(r.group([{id:'a',activity:a}])[0]!.label,/工具/);assert.equal(updates,6);
});
test('nested tool references are observed metadata and old unknown receipts reclassify without replay',()=>{
 const event=inspectNativeEvent('claude',{type:'user',message:{content:[{type:'tool_result',content:[{type:'tool_reference',tool_name:'fixture'}]}]}}).find(e=>e.key==='content/tool_reference')!;assert.equal(event.disposition,'observed');
 const session:any={activities:[{status:'uncertain',protocol:{receipt:{...event,disposition:'unknown'}}}]};refreshNativeEventHistory(session);assert.equal(session.activities[0].status,'completed');assert.equal(session.activities[0].protocol.presentation.title,'原生工具引用已接收');assert.equal(session.activities[0].output,undefined);
});
