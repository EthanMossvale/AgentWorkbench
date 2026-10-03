import test from 'node:test';
import assert from 'node:assert/strict';
import {uncachedInput,type TokenCounts} from '../packages/session-metrics';
const counts:TokenCounts={inputTokens:100,cacheReadTokens:60,cacheWriteTokens:10,outputTokens:5,totalTokens:105};
test('display partitions input without changing receipts or adding cache twice',()=>{
  assert.deepEqual(uncachedInput(counts),{value:30,upperBound:false});assert.equal(counts.inputTokens,100);
  assert.deepEqual(uncachedInput({...counts,cacheWriteTokens:null}),{value:40,upperBound:true});
  assert.deepEqual(uncachedInput({...counts,incomplete:['cacheReadTokens']}),{value:30,upperBound:true});
  assert.deepEqual(uncachedInput({...counts,incomplete:['inputTokens']}),{value:null,upperBound:false});
  assert.deepEqual(uncachedInput({...counts,inputTokens:0,cacheReadTokens:null,cacheWriteTokens:null}),{value:0,upperBound:false});
  assert.deepEqual(uncachedInput({...counts,inputTokens:null}),{value:null,upperBound:false});
});
