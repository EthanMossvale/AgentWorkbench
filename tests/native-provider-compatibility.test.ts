import test from 'node:test';
import assert from 'node:assert/strict';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import { nativeWireRequest } from '../packages/model-api/native-wire';
import { nativeCompletionCodec } from '../packages/model-api/native-completion';
import { API_DEFAULTS } from '../packages/model-api/config';
import type { ApiModel, ModelConnection } from '../packages/model-api/types';

const model: ApiModel = { id:'mapped', model:'fixture', name:'Fixture', enabled:true, manualEfforts:['high','xhigh'], defaultEffort:'xhigh' };
const parameters = { type:'object', properties:{}, additionalProperties:false };
for (const runtime of ['codex','claude'] as const) for (const prefix of ['', '/v1', '/proxy']) {
  test(`strict Chat provider accepts ${runtime} history and automatic tools at explicit prefix ${prefix || '/'}`, async () => {
    const baseUrl = 'https://fixture.invalid' + prefix;
    const connection: ModelConnection = { id:'fixture', revision:'one', name:'Fixture', baseUrl, protocol:'chat-completions', enabled:true, auth:'none', hasKey:false, models:[model], discoveredModels:[], ...API_DEFAULTS };
    let calls = 0;
    const gateway = await openNativeGateway({ runtime, model, effort:'xhigh', credentials:async()=>({connection,key:''}), fetcher:async(url,init)=>{
      calls++; assert.equal(String(url), baseUrl + '/chat/completions');
      const body = JSON.parse(String(init?.body));
      // A strict upstream would return 422 for these message shapes, or 400
      // for forced tools while thinking. This fixture rejects the former mapper.
      assert.equal(body.tool_choice,'auto'); assert.equal(body.reasoning_effort,'xhigh');
      assert.ok(body.messages.every((m:any)=>['system','user','assistant','tool'].includes(m.role)));
      assert.ok(body.messages.every((m:any)=>m.content === null || typeof m.content === 'string'));
      assert.match(body.messages[0].content,/Native instruction/);
      if(runtime==='codex') assert.match(body.messages[0].content,/Developer instruction/);
      const assistant = body.messages.find((m:any)=>m.tool_calls);
      assert.equal(assistant.content,'Checking.'); assert.equal(assistant.tool_calls[0].id,'read-one');
      assert.equal(body.messages.find((m:any)=>m.role==='tool').content,'Evidence');
      assert.equal(body.messages.at(-1).content,'Continue');
      const complete = body.tools.find((t:any)=>t.function.name.startsWith('awb_complete_turn'));
      return Response.json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'done',type:'function',function:{name:complete.function.name,arguments:JSON.stringify({outcome:'completed',message:'Strict provider accepted.'})}}]}}]});
    }});
    const body = runtime==='codex' ? { instructions:'Native instruction', input:[
      {role:'developer',content:[{type:'input_text',text:'Developer instruction'}]},
      {role:'user',content:[{type:'input_text',text:'Read the fixture.'}]},
      {role:'assistant',content:[{type:'output_text',text:'Checking.'}]},
      {type:'function_call',name:'read',call_id:'read-one',arguments:'{}'},
      {type:'function_call_output',call_id:'read-one',output:'Evidence'},
      {role:'user',content:[{type:'input_text',text:'Continue'}]},
    ], tools:[{type:'function',name:'read',parameters}]} : { system:'Native instruction', messages:[
      {role:'user',content:[{type:'text',text:'Read the fixture.'}]},
      {role:'assistant',content:[{type:'text',text:'Checking.'},{type:'tool_use',id:'read-one',name:'read',input:{}}]},
      {role:'user',content:[{type:'tool_result',tool_use_id:'read-one',content:'Evidence'},{type:'text',text:'Continue'}]},
    ], tools:[{name:'read',input_schema:parameters}]};
    try {
      const response=await fetch(gateway.baseUrl+(runtime==='codex'?'/v1/responses':'/v1/messages'),{method:'POST',headers:{authorization:'Bearer '+gateway.token},body:JSON.stringify(body)});
      assert.equal(response.status,200); assert.match(await response.text(),/Strict provider accepted/); assert.equal(calls,1);
    } finally { await gateway.close(); }
  });
}

test('developer instructions retain instruction priority when converted to Messages',()=>{
  const request=nativeWireRequest({instructions:'Base',input:[{role:'developer',content:'Private developer instruction'},{role:'user',content:'Question'}]},'responses','anthropic-messages',model);
  assert.equal(request.system,'Base\n\nPrivate developer instruction');
  assert.equal(request.messages.length,1); assert.equal(request.messages[0].content[0].text,'Question');
});

test('completion conversion preserves explicitly requested tool policies and rejects unmarked text',()=>{
  for(const protocol of ['chat-completions','responses','anthropic-messages'] as const){
    const tools=protocol==='chat-completions'?[{type:'function',function:{name:'read',parameters}}]:protocol==='responses'?[{type:'function',name:'read',parameters}]:[{name:'read',input_schema:parameters}];
    const tool_choice=protocol==='anthropic-messages'?{type:'any'}:'required';
    const boundary=nativeCompletionCodec.prepare({tools,tool_choice,messages:[],system:'',instructions:''},protocol)!;
    assert.deepEqual(boundary.request.tool_choice,tool_choice);
    assert.throws(()=>boundary.finish({text:'I will continue.',calls:[],usage:{inputTokens:1,outputTokens:1},raw:{}}),/NATIVE_COMPLETION_REQUIRED/);
  }
});
