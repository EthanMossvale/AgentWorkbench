import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FirstPresentation} from '../apps/desktop/host/first-presentation';

for(const order of ['document-first','state-first'])test(`first presentation waits for both barriers: ${order}`,async()=>{
  let count=0;
  const gate=new FirstPresentation(async()=>{count++;},()=>assert.fail('Unexpected failure'));
  if(order==='document-first')gate.documentLoaded();else gate.appearanceReady();
  assert.equal(count,0);
  if(order==='document-first')gate.appearanceReady();else gate.documentLoaded();
  assert.equal(count,1);
  gate.documentLoaded();gate.appearanceReady();
  assert.equal(count,1,'Later state/plugin changes must not refocus the window');
});
test('failed presentation reports recovery instead of becoming an unhandled rejection',async()=>{
  const error=Error('renderer exited');let reported:unknown;
  const gate=new FirstPresentation(async()=>{throw error;},value=>{reported=value;});
  gate.documentLoaded();gate.appearanceReady();await Promise.resolve();
  assert.equal(reported,error);
});
