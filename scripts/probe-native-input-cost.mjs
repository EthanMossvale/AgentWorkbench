import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';

// Installed CLIs with empty profiles and synthetic inference. Persist sizes only.
const output=path.resolve('build/qa/native-input-cost'),home=await mkdtemp(path.join(os.tmpdir(),'awb-input-cost-'));await mkdir(output,{recursive:true});
for(const name of ['.codex','.claude'])await mkdir(path.join(home,name),{recursive:true});
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit QA executables required.');
const cli=new LocalCliService(output,{home,isolated:true,executables:{codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
const model={id:'fixture',model:'fixture-model',name:'Fixture',enabled:true};
const connection={id:'fixture',name:'Fixture',protocol:'chat-completions',baseUrl:'http://127.0.0.1:12345/v1',enabled:true,auth:'key',hasKey:true,models:[model],timeoutMs:45000};
const state={hosts:[],sessions:[],modelConnections:[connection]},requests=[];
let runtime;
const previousBodies=new Map();
const commonPrefix=(a,b)=>{let n=0;while(n<Math.min(a.length,b.length)&&a[n]===b[n])n++;return n;};
const size=value=>JSON.stringify(value??'').length;
const fetcher=async(_url,init)=>{
  const body=JSON.parse(init.body);
  const previous=previousBodies.get(runtime),system=body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const prefix=previous?{systemIdentical:system===previous.system,systemCommonPrefixCharacters:commonPrefix(system,previous.system),toolsIdentical:JSON.stringify(body.tools)===JSON.stringify(previous.body.tools),priorMessagesPreserved:JSON.stringify(body.messages.slice(1,previous.body.messages.length))===JSON.stringify(previous.body.messages.slice(1))}:undefined;
  previousBodies.set(runtime,{body,system});
  requests.push({runtime,requestCharacters:size(body),systemCharacters:size(body.messages.filter(m=>m.role==='system')),toolCharacters:size(body.tools),toolCount:body.tools?.length??0,messages:body.messages.filter(m=>m.role!=='system').map(m=>({role:m.role,characters:size(m.content)}))});
  const complete=body.tools?.find(t=>t.function.name==='awb_complete_turn');
  if(prefix)Object.assign(requests.at(-1),{prefix});
  const message=complete?{role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:complete.function.name,arguments:JSON.stringify({outcome:'completed',message:'Hello.'})}}]}:{role:'assistant',content:'Hello.'};
  return new Response(JSON.stringify({choices:[{finish_reason:complete?'tool_calls':'stop',message}],usage:{prompt_tokens:100,completion_tokens:2}}),{headers:{'content-type':'application/json'}});
};
const runner=new NativeProviderRunner({connection:()=>connection,key:async()=> 'synthetic'},cli,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>'',translate:()=>{},observe:async()=>{},failure:error=>console.error(error),peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('No tool invocation expected');}})},fetcher);
try{
  for(runtime of ['codex','claude']){
    const session={id:randomUUID(),projectId:null,projectPath:home,title:'Input cost probe',pinned:false,archived:false,group:'',createdAt:new Date().toISOString(),status:'idle',permissionMode:'default',binding:{runtime,provider:connection.id,accountRef:'model-api:'+connection.id,executionId:'local-device',egress:'direct-api',modelConnectionId:connection.id,modelMappingId:model.id},modelSelection:{model:model.model},messages:[]};state.sessions.push(session);
    for(let i=0;i<2;i++){
      await runner.submit(session.id,{id:randomUUID(),original:'hi',translated:'hi',sourceHash:'fixture',revision:1,bypass:true,demo:false});
      const until=Date.now()+60000;while(runner.busy(session.id)&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
      assert.equal(runner.busy(session.id),false);assert.equal(session.nativeTurnStatus,'completed',session.nativeError);
    }
    assert.equal(requests.filter(r=>r.runtime===runtime).length,2,'One upstream exchange per greeting');
    assert.equal(session.metrics.records.reduce((n,r)=>n+r.inputTokens,0),200,'Synthetic receipts counted once');
  }
  const report={scope:'Empty isolated profiles; native tools; synthetic upstream. Character counts are not token counts and do not reproduce private user context.',requests};
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await runner.dispose();await cli.dispose();await rm(home,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
