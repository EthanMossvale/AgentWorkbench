import test from 'node:test';
import assert from 'node:assert/strict';
import {openNativeGateway} from '../packages/model-api/native-gateway';
import {nativeWireEvents} from '../packages/model-api/native-wire';
import {collectStream,parseTurn} from '../packages/model-api/provider';

const model={id:'fixture',model:'fixture',name:'Fixture',enabled:true};
const connection={id:'fixture',revision:'1',name:'Fixture',baseUrl:'https://fixture.invalid/v1',timeoutMs:2000,enabled:true,auth:'none' as const,hasKey:false,models:[model],discoveredModels:[],tools:true,maxOutputTokens:8192};
for(const runtime of ['codex','claude'] as const)for(const upstream of ['responses','anthropic-messages','chat-completions'] as const)for(const incomingStream of [true,false,undefined])for(const upstreamStream of [true,false]){
  const native=runtime==='codex'?'responses':'anthropic-messages';if(native===upstream)continue;
  test(`${runtime}/${upstream}: stream=${incomingStream} with ${upstreamStream?'SSE':'JSON'} upstream`,async()=>{
    let requests=0;
    const gateway=await openNativeGateway({runtime,model,credentials:async()=>({connection:{...connection,protocol:upstream},key:''}),fetcher:async()=>{
      requests++;
      const calls=[{id:'one',name:'inspect',arguments:'{"path":"one"}'},{id:'two',name:'inspect',arguments:'{"path":"two"}'}];
      const turn={text:'Inspecting both files.',calls,usage:{inputTokens:12,outputTokens:9},raw:{}};
      if(upstream==='chat-completions'){
        const tool_calls=calls.map((call,index)=>({index,id:call.id,type:'function',function:{name:call.name,arguments:call.arguments}}));
        return upstreamStream?new Response([{choices:[{delta:{content:turn.text}}]},{choices:[{delta:{tool_calls},finish_reason:'tool_calls'}]},'[DONE]'].map(frame=>'data: '+(typeof frame==='string'?frame:JSON.stringify(frame))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}):Response.json({choices:[{message:{content:turn.text,tool_calls},finish_reason:'tool_calls'}]});
      }
      const events=nativeWireEvents(turn,upstream,{model:model.model});
      const data=upstream==='responses'?events.at(-1)!.response:{...events[0]!.message,content:[{type:'text',text:turn.text},...calls.map(c=>({type:'tool_use',id:c.id,name:c.name,input:JSON.parse(c.arguments)}))],stop_reason:'tool_use'};
      return upstreamStream?new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}}):Response.json(data);
    }});
    try{
      const body={model:model.model,stream:incomingStream,...(runtime==='claude'?{messages:[{role:'user',content:'Inspect files'}],tools:[{name:'inspect',input_schema:{type:'object'}}]}:{input:'Inspect files',tools:[{type:'function',name:'inspect',parameters:{type:'object'}}]})};
      const response=await fetch(gateway.baseUrl+(runtime==='claude'?'/v1/messages':'/v1/responses'),{method:'POST',headers:{authorization:'Bearer '+gateway.token},body:JSON.stringify(body)});
      assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,incomingStream?/text\/event-stream/:/application\/json/);
      const data=incomingStream?await collectStream(response,native):await response.json();
      const turn=parseTurn(data,native);assert.equal(turn.text,'Inspecting both files.');assert.deepEqual(turn.calls.map(c=>JSON.parse(c.arguments)),[{path:'one'},{path:'two'}]);assert.equal(requests,1);
    }finally{await gateway.close();}
  });
}
