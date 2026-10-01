import test from 'node:test';
import assert from 'node:assert/strict';
import {shareState} from '../apps/desktop/renderer/state-sharing';

test('IPC snapshots keep unchanged conversations and messages stable without losing late fields or deletions',()=>{
 const old={sessions:[{id:'a',messages:[{id:'old',text:'Read **this**.'},{id:'live',text:'Hello'}]},{id:'b',messages:[]}],theme:'light',option:{active:true}};
 const wire=structuredClone(old);wire.sessions[0]!.messages[1]!.text+=' world';
 const next=shareState(old,wire);
 assert.notEqual(next,old);assert.notEqual(next.sessions[0],old.sessions[0]);assert.equal(next.sessions[1],old.sessions[1]);
 assert.equal(next.sessions[0]!.messages[0],old.sessions[0]!.messages[0]);assert.equal(next.option,old.option);
 assert.equal(old.sessions[0]!.messages[1]!.text,'Hello');assert.equal(next.sessions[0]!.messages[1]!.text,'Hello world');
 assert.equal(shareState(next,structuredClone(next)),next);
 assert.deepEqual(shareState<any>({a:undefined},{b:undefined}),{b:undefined});
 assert.deepEqual(shareState<any>({a:1},{}),{});assert.deepEqual(shareState<any>([1,2],[1]),[1]);
});
