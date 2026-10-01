import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';

// Real native executables, disposable native homes, and synthetic loopback responses only.
const output=path.resolve(process.env.AWB_INTERACTION_QA??'build/qa/native-interactions/live');
const home=path.join(output,'home-'+Date.now());
await mkdir(path.join(home,'.codex'),{recursive:true});await mkdir(path.join(home,'.claude'),{recursive:true});
assert.ok(process.env.AWB_QA_CODEX||process.env.AWB_QA_CLAUDE,'Supply explicit QA executable paths.');
const checks=[],errors=[],requests=[],results=[];
const finished=text=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:100,completion_tokens:10}});
const tool=(name,args)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'question-fixture',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
const server=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),last=body.messages.filter(m=>m.role!=='system').at(-1);
  const tools=body.tools?.map(t=>t.function?.name)??[],questionTool=tools.includes('AskUserQuestion')?'AskUserQuestion':tools.includes('request_user_input')?'request_user_input':undefined;
  const questionDefinition=body.tools?.find(t=>t.function?.name===questionTool)?.function;
  requests.push({tools,role:last.role,questionTool,questionSchema:questionDefinition?.parameters,questionDescription:questionDefinition?.description});res.setHeader('content-type','application/json');
  assert.ok(questionTool,'The upstream must actually receive the native question tool.');
  assert.ok(questionDefinition.description?.length,'The native tool description must reach the upstream.');
  assert.ok(questionDefinition.parameters?.properties?.questions,'The native question schema must reach the upstream.');
  if(last.role==='tool'){results.push(String(last.content));res.end(JSON.stringify(finished('INTERACTION_COMPLETED')));return;}
  const claude=questionTool==='AskUserQuestion';
  res.end(JSON.stringify(claude?tool('AskUserQuestion',{questions:[{question:'Which format should the fixture use?',header:'Format',multiSelect:false,options:[{label:'Brief',description:'A paragraph'},{label:'Detailed',description:'Several paragraphs'}]},{question:'Which sections should it include?',header:'Sections',multiSelect:true,options:[{label:'Intro',description:'Opening'},{label:'Summary',description:'Closing'}]}]}):tool('request_user_input',{questions:[{id:'format',header:'Format',question:'Which format should the fixture use?',options:[{label:'Brief',description:'A paragraph'},{label:'Detailed',description:'Several paragraphs'}]}]})));
 }catch(e){errors.push(String(e));res.writeHead(500).end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const model={id:'fixture',model:process.env.AWB_QA_MODEL??'fixture-model',name:'Fixture',enabled:true,contextWindow:128000};
const connection={id:'fixture',revision:'fixture',name:'Fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],tools:true,timeoutMs:20000,maxOutputTokens:8192};
const cli=new LocalCliService(output,{home,isolated:true,executables:{codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
const runtimeVersions=(await cli.list()).filter(item=>item.installed).map(({runtime,version})=>({runtime,version}));
const state={hosts:[],sessions:[],modelConnections:[connection]},runner=new NativeProviderRunner({connection:()=>connection,key:async()=> 'synthetic'},cli,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>'',translate:()=>{},observe:async()=>{},peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('Unexpected tool.');}}),failure:e=>errors.push(String(e))});
const wait=async(predicate,label)=>{const until=Date.now()+45000;while(!predicate()&&Date.now()<until)await new Promise(r=>setTimeout(r,40));assert.ok(predicate(),label+' '+JSON.stringify({errors,results,requests}));};
try{
 for(const runtime of await runner.runtimes())for(const action of ['submit','decline']){
  const session={id:randomUUID(),projectId:null,projectPath:path.join(home,'project-'+runtime+'-'+action),title:'Interaction fixture',status:'idle',binding:{runtime,provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'},modelSelection:{model:model.model},permissionMode:'full-access',messages:[]};state.sessions.push(session);
  await runner.submit(session.id,{id:randomUUID(),original:'Ask the fixture question once, then finish.',translated:'Ask the fixture question once, then finish.',revisions:[],sourceHash:'fixture',bypass:true,demo:false});
  await wait(()=>session.nativeInteractions?.some(i=>i.status==='pending')||!runner.busy(session.id),'Native question arrival');
  const item=session.nativeInteractions?.find(i=>i.status==='pending');assert.ok(item,'Native CLI must emit a real user-input request. '+JSON.stringify({requests,results,errors}));
  assert.equal(session.nativeApprovals?.length,0,'Question is not a generic approval');
  const answers=runtime==='claude'?{'0':['Detailed'],'1':['Intro','Summary']}:{format:['Detailed']};
  await runner.interaction(session.id,item.id,{action,answers});
  await assert.rejects(runner.interaction(session.id,item.id,{action,answers}));
  await wait(()=>!runner.busy(session.id),'Native completion');assert.equal(session.status,'idle');assert.equal(session.messages.filter(m=>m.role==='user').length,1);assert.equal(item.status,action==='submit'?'answered':'declined');assert.match(session.messages.at(-1).original,/INTERACTION_COMPLETED/);
  if(action==='submit')assert.match(results.at(-1),/Detailed/);checks.push(runtime+' native '+action+' returns once to the same turn');console.log('PASS '+checks.at(-1));
 }
 assert.deepEqual(errors,[]);
}finally{await runner.dispose();await cli.dispose();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,runtimeVersions,model:model.model,requests,results,scope:'Real installed native CLIs, isolated homes, synthetic upstream only; no real account, SSH, or model usage. Tool discovery and reply transport do not prove real-model tool selection.'},null,2));}
