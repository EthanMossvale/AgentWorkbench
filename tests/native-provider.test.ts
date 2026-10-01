import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeProviderLaunch } from '../packages/model-api/native-launch';
import { nativeWireEvents, nativeWireRequest } from '../packages/model-api/native-wire';
import { openNativeGateway } from '../packages/model-api/native-gateway';
import { modelMetadata, API_DEFAULTS } from '../packages/model-api/config';
import { freezeSessionBinding } from '../packages/session-core';
import type { ApiModel, ModelConnection } from '../packages/model-api/types';
import { PeerMcpSession } from '../packages/collaboration-core/mcp';

const model:ApiModel={id:'mapping',model:'mapped-upstream',name:'Model',enabled:true,efforts:['minimal','high','ultra'],defaultEffort:'high',contextWindow:256000};
const connection:ModelConnection={id:'source',revision:'one',name:'Source',baseUrl:'https://fixture.invalid/v1',protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],discoveredModels:[model],...API_DEFAULTS};

for (const from of ['responses', 'anthropic-messages'] as const) for (const to of ['responses', 'anthropic-messages', 'chat-completions'] as const) {
  test(`native question discovery preserves name, description and schema: ${from} -> ${to}`, () => {
    const name = from === 'responses' ? 'request_user_input' : 'AskUserQuestion';
    const description = 'Ask the user a question and wait for their answer.';
    const schema = { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } } }, required: ['questions'], additionalProperties: false };
    const request = from === 'responses'
      ? { instructions: 'Native instructions.', input: 'Task.', tools: [{ type: 'function', name, description, parameters: schema }] }
      : { system: 'Native instructions.', messages: [{ role: 'user', content: 'Task.' }], tools: [{ name, description, input_schema: schema }] };
    const forwarded = nativeWireRequest(request, from, to, model);
    const tool = to === 'chat-completions' ? forwarded.tools[0].function : forwarded.tools[0];
    assert.equal(tool.name, name); assert.equal(tool.description, description);
    assert.deepEqual(to === 'anthropic-messages' ? tool.input_schema : tool.parameters, schema);
    const instructions = to === 'responses' ? forwarded.instructions : to === 'anthropic-messages' ? forwarded.system : forwarded.messages[0].content;
    if (from === to) assert.equal(instructions, 'Native instructions.', 'Native protocol instructions remain unchanged.');
    else assert.equal(instructions, 'Native instructions.', 'The wire mapper preserves instructions; the gateway adds the completion contract.');
    const events = nativeWireEvents({ text: '', calls: [{ id: 'question', name, arguments: JSON.stringify({ questions: [{ question: 'Choose a format.' }] }) }], usage: { inputTokens: 1, outputTokens: 1 }, raw: {} }, from, request);
    if (from === 'responses') assert.equal(events.at(-1)!.response.output[0].name, name);
    else assert.equal(events.find(event => event.type === 'content_block_start')!.content_block.name, name);
  });
}
test('native launches bind provider per process, preserve parent environment, and leave native configuration untouched',()=>{
  const parent={PATH:'fixture',OPENAI_API_KEY:'must-not-inherit',ANTHROPIC_API_KEY:'must-not-inherit',CLAUDE_CODE_OAUTH_TOKEN:'must-not-inherit',CODEX_HOME:'fixture-native-home'};
  const gateway={baseUrl:'http://127.0.0.1:12345/nonce',token:'synthetic-session-token'};
  const codex=nativeProviderLaunch('codex',model,gateway,'read-only',{model:model.model,effort:'ultra'},parent,undefined,'chat-completions');
  assert.ok(codex.args.includes('model_provider="workbench"'));assert.ok(codex.args.includes('model_context_window=256000'));assert.ok(codex.args.includes('web_search="disabled"'));assert.equal(codex.env.AWB_PROVIDER_TOKEN,gateway.token);assert.equal(codex.env.OPENAI_API_KEY,undefined);assert.equal(parent.OPENAI_API_KEY,'must-not-inherit');
  const claude=nativeProviderLaunch('claude',model,gateway,'plan',{model:model.model,effort:'ultra'},parent,'12345678-1234-1234-1234-123456789012');
  assert.equal(claude.env.ANTHROPIC_AUTH_TOKEN,gateway.token);assert.equal(claude.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.ok(claude.args.includes('--resume'));assert.ok(!claude.args.includes('--effort'),'Unknown native enums are forwarded exactly by the gateway, never silently down-mapped');assert.ok(!claude.args.includes('--max-turns'));assert.ok(!claude.args.includes('--dangerously-skip-permissions'));
  assert.ok(claude.args.includes('--permission-prompt-tool'));assert.doesNotMatch(codex.args.join(' '),/multi_agent|max_threads|max_depth|deferred_executor/,'Native agent admission and capacity are not overwritten');
});

test('same-protocol compaction preserves native payload and cross-protocol token counting is not invented',async()=>{
  let body:any,url='';const gateway=await openNativeGateway({runtime:'codex',model,effort:'high',credentials:async()=>({connection:{...connection,protocol:'responses'},key:'synthetic'}),fetcher:async(input,init)=>{url=String(input);body=JSON.parse(String(init?.body));return new Response(JSON.stringify({output:[{type:'compaction',encrypted_content:'opaque'}]}),{headers:{'content-type':'application/json'}});}});
  try{const response=await fetch(gateway.baseUrl+'/v1/responses/compact',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:JSON.stringify({model:'alias',input:[{type:'reasoning',encrypted_content:'native'}]})});assert.match(url,/responses\/compact$/);assert.deepEqual(body,{model:model.model,input:[{type:'reasoning',encrypted_content:'native'}]});assert.equal((await response.json()).output[0].encrypted_content,'opaque');}finally{await gateway.close();}
  const other=await openNativeGateway({runtime:'claude',model,credentials:async()=>({connection,key:''}),fetcher:async()=>{throw Error('Must not call a fabricated endpoint');}});
  try{const response=await fetch(other.baseUrl+'/v1/messages/count_tokens',{method:'POST',headers:{Authorization:'Bearer '+other.token},body:'{}'});assert.equal(response.status,501);}finally{await other.close();}
});
test('upstream effort schemas map exact ranges and defaults without guessing from model names',()=>{
  assert.deepEqual(modelMetadata({supported_reasoning_levels:[{reasoning_effort:'minimal'},{value:'high'},{level:'ultra'}],default_reasoning_effort:'ultra'}).efforts,['minimal','high','ultra']);
  assert.equal(modelMetadata({reasoning:{levels:['low','high'],default:'high'}}).defaultEffort,'high');
  assert.equal(modelMetadata({id:'reasoning-pro',supported_parameters:['reasoning']}).efforts,undefined);
  assert.equal(modelMetadata({reasoning:{levels:['high'],default:'low'}}).defaultEffort,undefined);
});
test('native and SSH bindings remain distinct while an API provider can use either native runtime',()=>{
  for(const runtime of ['codex','claude'] as const)assert.equal(freezeSessionBinding({runtime,provider:'source',accountRef:'model-api:source',executionId:'local-device',egress:'direct-api',modelConnectionId:'source',modelMappingId:'mapping'}).runtime,runtime);
  assert.throws(()=>freezeSessionBinding({runtime:'codex',provider:'source',accountRef:'source',executionId:'local-device',egress:'direct-api'}));
});
test('namespace and custom tools round trip through Chat without replacing the native tool loop',()=>{
  const request={instructions:'Native instructions',input:[{role:'user',content:[{type:'input_text',text:'Task'}]}],tools:[{type:'namespace',name:'native_agents',tools:[{type:'function',name:'spawn_agent',description:'Native child',parameters:{type:'object'}}]},{type:'custom',name:'apply_patch',description:'Native patch'}]};
  const mapped=nativeWireRequest(request,'responses','chat-completions',model,'ultra');
  assert.equal(mapped.model,model.model);assert.equal(mapped.reasoning_effort,'ultra');assert.equal(mapped.messages[0].content,'Native instructions');
  const events=nativeWireEvents({text:'',calls:[{id:'child',name:mapped.tools[0].function.name,arguments:'{"message":"Task"}'},{id:'patch',name:'apply_patch',arguments:'{"input":"*** patch"}'}],usage:{inputTokens:15,outputTokens:9},raw:{}},'responses',request);
  const response=events.at(-1)!.response;assert.equal(response.output[0].name,'spawn_agent');assert.equal(response.output[0].namespace,'native_agents');assert.equal(response.output[1].type,'custom_tool_call');assert.equal(response.output[1].input,'*** patch');assert.equal(response.usage.total_tokens,24);
  const followup=nativeWireRequest({...request,input:[...request.input,...response.output,{type:'custom_tool_call_output',call_id:'patch',output:'Applied'}]},'responses','chat-completions',model,'ultra');
  assert.equal(followup.messages.at(-1).tool_call_id,'patch');assert.equal(followup.messages[2].tool_calls[0].function.name,mapped.tools[0].function.name);
});
test('Claude messages and tool results convert to Responses while tool execution stays native',()=>{
  const request={system:'System',messages:[{role:'user',content:'Task'},{role:'assistant',content:[{type:'tool_use',id:'read',name:'Read',input:{file_path:'fixture.txt'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'read',content:'Evidence'}]}],tools:[{name:'Read',input_schema:{type:'object'}}]};
  const body=nativeWireRequest(request,'anthropic-messages','responses',model,'high');assert.deepEqual(body.input.at(-1),{type:'function_call_output',call_id:'read',output:'Evidence'});assert.equal(body.reasoning.effort,'high');
  const events=nativeWireEvents({text:'Reply',calls:[],usage:{inputTokens:10,outputTokens:2},raw:{}},'anthropic-messages',{model:model.model});assert.equal(events.at(-2)!.delta.stop_reason,'end_turn');assert.equal(events.at(-1)!.type,'message_stop');
});
test('session gateway rejects foreign credentials and origins, scopes keys and makes a single upstream request',async()=>{
  const requests:any[]=[];
  const gateway=await openNativeGateway({runtime:'codex',model,effort:'ultra',credentials:async()=>({connection,key:'synthetic-private-key'}),fetcher:async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'Native response'}}],usage:{prompt_tokens:3,completion_tokens:4}}),{headers:{'content-type':'application/json'}});}});
  try{
    assert.equal((await fetch(gateway.baseUrl+'/v1/responses',{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(gateway.baseUrl+'/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+gateway.token,Origin:'https://foreign.invalid'},body:'{}'})).status,403);
    const result=await fetch(gateway.baseUrl+'/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:JSON.stringify({model:'native-alias',instructions:'Native',input:'Task',stream:true})});
    const output=await result.text();assert.equal(result.status,200);assert.match(output,/response.completed/);assert.doesNotMatch(output,/synthetic-private-key/);assert.equal(requests.length,1);assert.equal(requests[0].init.headers.authorization,'Bearer synthetic-private-key');assert.equal(JSON.parse(requests[0].init.body).reasoning_effort,'ultra');
  }finally{await gateway.close();}
});
test('same-protocol forwarding preserves native opaque items and unknown effort stays unset',()=>{
  const body={model:'alias',input:[{type:'reasoning',encrypted_content:'opaque'}],tools:[{type:'custom',name:'patch'}],reasoning:{effort:'high',summary:'auto'}};
  const mapped=nativeWireRequest(body,'responses','responses',{...model,efforts:undefined},undefined);assert.deepEqual(mapped.input,body.input);assert.deepEqual(mapped.tools,body.tools);assert.deepEqual(mapped.reasoning,{summary:'auto'});
});

test('native MCP clients have independent handshakes and source admission is rechecked before tool access',async()=>{
  let enabled=true,calls=0;
  const gateway=await openNativeGateway({runtime:'claude',model,credentials:async()=>{if(!enabled)throw Error('SOURCE_DISABLED');return {connection,key:''};},mcp:()=>new PeerMcpSession({definitions:[{name:'fixture',description:'Synthetic',inputSchema:{type:'object'}}],call:async()=>({calls:++calls})} as any)});
  const send=(body:unknown,id?:string)=>fetch(gateway.baseUrl+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+gateway.token,...(id?{'Mcp-Session-Id':id}:{})},body:JSON.stringify(body)});
  try{
    const ids:string[]=[];
    for(let i=0;i<2;i++){const response=await send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}});assert.equal(response.status,200);ids.push(response.headers.get('mcp-session-id')!);await send({jsonrpc:'2.0',method:'notifications/initialized'},ids[i]);}
    assert.notEqual(ids[0],ids[1]);
    for(const id of ids){const response=await send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'fixture'}},id);assert.equal((await response.json()).result.isError,false);}
    assert.equal(calls,2);enabled=false;
    assert.equal((await send({jsonrpc:'2.0',id:3,method:'tools/list'},ids[0])).status,502);assert.equal(calls,2);
  }finally{await gateway.close();}
});
