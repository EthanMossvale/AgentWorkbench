import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {ProcessSupervisor,createNativeProcess,nativeStreams} from '../services/remote-supervisor';
import {NATIVE_OWNER_REMOTE_BRIDGE} from '../services/codex-bridge/native-owner-remote';
import {collectStream,parseTurn,ApiConversationClient} from '../packages/model-api/provider';
import {nativeWireStream} from '../packages/model-api/native-wire';
import {openNativeGateway} from '../packages/model-api/native-gateway';
import {API_DEFAULTS} from '../packages/model-api/config';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
const model={id:'fixture',model:'fixture',name:'Fixture',enabled:true},connection={...API_DEFAULTS,id:'fixture',revision:'1',name:'Fixture',baseUrl:'http://fixture.invalid',protocol:'chat-completions' as const,enabled:true,auth:'none' as const,hasKey:false,models:[model],discoveredModels:[]};
for(const runtime of ['codex','claude'] as const)test(runtime+' native gateway accepts a request larger than 32 MiB',async()=>{
 const text='x'.repeat(33*1024*1024)+'中😀';let observed='';const gateway=await openNativeGateway({runtime,model,credentials:async()=>({connection,key:''}),fetcher:async(_url,init)=>{observed=JSON.parse(String(init!.body)).messages.at(-1).content;return Response.json({choices:[{finish_reason:'stop',message:{content:'Done'}}]});}});
 try{const response=await fetch(gateway.baseUrl+(runtime==='codex'?'/v1/responses':'/v1/messages'),{method:'POST',headers:{authorization:'Bearer '+gateway.token},body:JSON.stringify(runtime==='codex'?{input:text}:{messages:[{role:'user',content:text}]})});assert.equal(response.status,200);await response.text();assert.equal(observed,text);}finally{await gateway.close();}
});
for(const protocol of ['chat-completions','responses','anthropic-messages'] as const)test(protocol+' collects over 32 MB with more than 64 tools and large arguments',async()=>{
 const args=JSON.stringify({text:'x'.repeat(520000)}),calls=Array.from({length:66},(_,i)=>({id:'call'+i,name:'Read',arguments:args}));const raw=protocol==='responses'?{status:'completed',output:calls.map(c=>({type:'function_call',call_id:c.id,name:c.name,arguments:c.arguments}))}:protocol==='anthropic-messages'?{stop_reason:'tool_use',content:calls.map(c=>({type:'tool_use',id:c.id,name:c.name,input:JSON.parse(c.arguments)}))}:{choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:calls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.arguments}}))}}]};
 const frames=protocol==='responses'?[{type:'response.completed',response:raw}]:protocol==='anthropic-messages'?[...calls.flatMap((c,index)=>[{type:'content_block_start',index,content_block:{type:'tool_use',id:c.id,name:c.name,input:{}}},{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:c.arguments}}]),{type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'}]:[...calls.map((c,index)=>({choices:[{delta:{tool_calls:[{index:index+5000,id:c.id,function:{name:c.name,arguments:c.arguments}}]}}]})),{choices:[{finish_reason:'tool_calls'}]},'[DONE]'];
 let index=0;const stream=new ReadableStream<Uint8Array>({pull(c){if(index===frames.length){c.close();return;}const frame=frames[index++];c.enqueue(Buffer.from('data: '+(typeof frame==='string'?frame:JSON.stringify(frame))+'\n\n'));}});
 const value=await collectStream(new Response(stream),protocol),turn=parseTurn(value,protocol);assert.deepEqual(turn.calls,calls);for(const target of ['responses','anthropic-messages'] as const){const wire=nativeWireStream(target,{});for(let i=0;i<calls.length;i++)wire.push({type:'tool',index:i+5000,id:calls[i]!.id,name:'Read',argumentsDelta:args});assert.ok(wire.finish(turn).length);}
});
test('non-streaming API JSON above four MB preserves the full text',async()=>{const text='x'.repeat(4200000),client=new ApiConversationClient({connection,model,system:'',history:[{role:'user',content:'Source'}],tools:[]},'',async()=>Response.json({choices:[{finish_reason:'stop',message:{content:text}}]}));assert.equal((await client.next(new AbortController().signal,()=>{})).text,text);});
test('chunked native JSONL accepts a >48 MiB frame followed by another frame and writes >8 MiB intact',async()=>{
 const child=new ProcessSupervisor({executable:process.execPath,args:['-e',`let raw='';process.stdin.on('data',c=>{raw+=c;if(raw.endsWith('\\n')){const input=JSON.parse(raw);process.stdout.write(JSON.stringify({length:input.text.length,text:'x'.repeat(49*1024*1024)})+'\\n'+JSON.stringify({next:true})+'\\n',()=>process.exit());}});`]});let length=0,frames=0;const faults:Error[]=[];child.on('fault',e=>faults.push(e));child.on('frame',frame=>{frames++;if(frame.value.text){length=String(frame.value.text).length;assert.equal(frame.value.length,9*1024*1024);}});try{await child.start();await child.write({text:'a'.repeat(9*1024*1024)});await child.waitForExit();assert.equal(frames,2);assert.equal(length,49*1024*1024);assert.deepEqual(faults,[]);}finally{await child.stop();}
});
test('approved process factories and interception affect actual processes and restore on disable',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-stream-plugin-')),plugins=new PluginRegistry(dir);await plugins.initialize();plugins.services.register('runtime.native-streams',nativeStreams,{version:1});const id='qa.streams',manifest={schemaVersion:1,apiVersion:1,id,name:'Streams fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs'},code=`export function activate(api){const streams=api.services.get('runtime.native-streams');api.onDispose(streams.register({id:'plugin:'+api.id+'/process',create:(spec,core)=>core({...spec,env:{...spec.env,QA_FACTORY:'registered'}})}));api.services.intercept('runtime.native-streams','create',(next,spec)=>next({...spec,env:{...spec.env,QA_INTERCEPT:'replaced'}}));}`;
 try{const file=path.join(dir,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(code)}]));await plugins.importZip(file);const hash=(await plugins.list())[0]!.hash;await plugins.setEnabled(id,hash,true,true);
 for(const enabled of [true,false,true]){await plugins.setEnabled(id,hash,enabled);let frame:any;const child=createNativeProcess({executable:process.execPath,args:['-e',`process.stdout.write(JSON.stringify({factory:process.env.QA_FACTORY??null,intercept:process.env.QA_INTERCEPT??null})+'\\n')`],env:{...process.env}});child.on('frame',v=>frame=v.value);await child.start();await child.waitForExit();assert.deepEqual(frame,{factory:enabled?'registered':null,intercept:enabled?'replaced':null});}
 }finally{await plugins.dispose();await rm(dir,{recursive:true,force:true});}
});
test('both SSH relay envelopes and account-owner decoder preserve frames beyond old thresholds',()=>{
 const code=String.raw`
import sys,json,io,threading,types
sys.path.insert(0,sys.argv[1])
from runtime import NativePipe
size=49*1024*1024
for runtime in ('codex','claude'):
    value={'method':'item/completed','params':{'text':'x'*size}} if runtime=='codex' else {'type':'assistant','message':{'text':'x'*size}}
    raw=(json.dumps(value)+'\n').encode()
    pipe=NativePipe(None);pipe.buffer=bytearray(raw)
    assert pipe.receive()==value
    source=sys.stdin.read() if runtime=='codex' else source
    fragment=source[source.index('def downstream(reader):'):source.index('def interrupted(')]
    output=io.BytesIO()
    env={'closing':threading.Event(),'wire_lock':threading.Lock(),'sys':types.SimpleNamespace(stdout=types.SimpleNamespace(buffer=output,flush=lambda:None)),'os':types.SimpleNamespace(kill=lambda *args:None,getpid=lambda:1),'signal':types.SimpleNamespace(SIGTERM=15)}
    exec(fragment,env);env['downstream'](io.BytesIO(raw));assert output.getvalue()==raw
`;
 const result=spawnSync('python',['-B','-c',code,path.resolve('services/vps-account-broker')],{input:NATIVE_OWNER_REMOTE_BRIDGE,encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stderr);
});
