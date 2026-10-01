import test from 'node:test';
import assert from 'node:assert/strict';
import {usagePresentation} from '../packages/collaboration-core/usage-presentation';
test('native Claude statistics keep separate input and cache counters and readable units',()=>{
  assert.deepEqual(usagePresentation(JSON.stringify({durationMs:26791,apiDurationMs:14731,turns:5,inputTokens:10,outputTokens:859,cacheReadTokens:45431,cacheCreationTokens:6284})),[
    {label:'运行耗时',value:'26.8 秒'},{label:'API 耗时',value:'14.7 秒'},
    {label:'模型调用',value:'5 次'},{label:'未缓存输入',value:'10 tokens'},
    {label:'输出',value:'859 tokens'},{label:'缓存读取',value:'45,431 tokens'},{label:'缓存写入',value:'6,284 tokens'},
  ]);
});
test('missing invalid and future counters are not invented; zero and historical JSON remain readable',()=>{
  for(const value of ['null','[]','broken','{}'])assert.deepEqual(usagePresentation(value),[]);
  assert.deepEqual(usagePresentation(JSON.stringify({durationMs:59999,inputTokens:0,outputTokens:-1,turns:1.5,cacheReadTokens:'100',future:10})),[{label:'运行耗时',value:'1 分 0 秒'},{label:'未缓存输入',value:'0 tokens'}]);
});
