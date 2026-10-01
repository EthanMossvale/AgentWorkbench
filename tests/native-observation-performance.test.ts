import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {attachNativeObservation} from '../apps/desktop/host/native-observation';
import {decodeNativeFrame} from '../services/remote-supervisor';
import {normalizeClaudeEvent} from '../packages/runtime-claude';
import type {AppState} from '../packages/contracts';

test('sustained private native deltas retain receipts without per-frame state persistence or snapshots',async()=>{
 const state={hosts:[],sessions:[{id:'fixture',status:'running',messages:[],binding:{runtime:'claude',egress:'runtime-managed',localAccountId:'fixture'}}]} as unknown as AppState;
 const source=new EventEmitter();let writes=0,snapshots=0;
 const observation=attachNativeObservation('fixture',source,()=>{snapshots++;return structuredClone(state);},async change=>{writes++;change(state);});
 try{
  await observation.flush();writes=0;snapshots=0;
  for(let i=0;i<200;i++){
   const frame=decodeNativeFrame(Buffer.from(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'PRIVATE_TEST_BODY'}}})+'\n'));
   source.emit('event',normalizeClaudeEvent(frame,'fixture',i));await delay(2);
  }
  await observation.flush();
  assert.ok(writes<=4,`Unexpected persistence amplification: ${writes}`);assert.equal(snapshots,0);
  assert.equal(state.sessions[0]!.nativeEventAudit?.receipts.find(r=>r.key==='delta/thinking_delta')?.count,200);
  assert.doesNotMatch(JSON.stringify(state),/PRIVATE_TEST_BODY/);
 }finally{await observation.dispose();}
});
