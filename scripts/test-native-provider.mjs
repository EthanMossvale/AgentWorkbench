import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { attachNativeObservation } from '../apps/desktop/host/native-observation.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';

const output=path.resolve(process.env.AWB_NATIVE_PROVIDER_QA??'build/qa/native-provider/live'),home=path.join(output,'home-'+Date.now());
await mkdir(path.join(home,'.codex'),{recursive:true});await mkdir(path.join(home,'.claude'),{recursive:true});
const codex=process.env.AWB_QA_CODEX,claude=process.env.AWB_QA_CLAUDE;
assert.ok(codex||claude,'Explicit QA executables required');
const nativeEvents=[],observations=[],childEvents=[];const requests=[],errors=[],checks=[];let nativeToolResults=0;
const fixtureFile=path.join(home,'fixture.txt');await writeFile(fixtureFile,'NATIVE_TOOL_FIXTURE');
const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;let body;try{body=JSON.parse(raw);}catch{res.writeHead(404).end();return;}requests.push({model:body.model,effort:body.reasoning_effort,tools:body.tools?.map(tool=>tool.function?.name)});res.setHeader('content-type','application/json');
 const last=body.messages.filter(message=>message.role!=='system').at(-1),task=body.messages.findLast(message=>message.role==='user');
 if(last.role!=='tool'&&JSON.stringify(last.content).includes('NATIVE_CHILD_FIXTURE_TASK')){await new Promise(resolve=>setTimeout(resolve,900));return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'NATIVE_CHILD_FIXTURE_REPLY'}}]}));}
 if(last.role!=='tool'&&JSON.stringify(task).includes('Run one native child'))return res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'native-agent-smoke-'+(JSON.stringify(task).includes('background')?'background':'foreground'),type:'function',function:{name:'Agent',arguments:JSON.stringify({description:'Synthetic native child',prompt:'NATIVE_CHILD_FIXTURE_TASK: reply once with no tools.',subagent_type:'general-purpose',...(JSON.stringify(task).includes('background')?{run_in_background:true}:{})})}}]}}]}));
 if(last.role==='tool'){requests.at(-1).toolResult=String(last.content).slice(0,2000);if(String(last.content).includes('NATIVE_TOOL_FIXTURE'))nativeToolResults++;}
 if(last.role!=='tool'&&JSON.stringify(task).includes('Run approved native edit'))return res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'native-edit-smoke',type:'function',function:{name:'Edit',arguments:JSON.stringify({file_path:fixtureFile,old_string:'NATIVE_TOOL_FIXTURE',new_string:'NATIVE_APPROVED_EDIT'})}}]}}]}));
 if(last.role!=='tool'&&JSON.stringify(task).includes('Run one native tool')){const codexTool=body.tools.find(tool=>tool.function.name==='exec_command');const name=codexTool?'exec_command':'Read',args=codexTool?{cmd:'Write-Output NATIVE_TOOL_FIXTURE',max_output_tokens:300}:{file_path:fixtureFile};return res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'native-tool-smoke',type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}));}
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Native provider fixture complete.'}}],usage:{prompt_tokens:50,completion_tokens:8}}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const model={id:'fixture',model:'upstream-fixture',name:'合成模型',enabled:true,efforts:['low','high'],defaultEffort:'low',contextWindow:128000};
const connection={id:'fixture',revision:'one',name:'合成来源',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],discoveredModels:[model],tools:true,timeoutMs:20000,maxOutputTokens:8192};
const cli=new LocalCliService(output,{home,isolated:true,executables:{codex,claude}});
await cli.initialize();
const state={hosts:[],modelConnections:[connection],sessions:[]};
const runner=new NativeProviderRunner({connection:()=>connection,key:async()=> 'synthetic-native-only'},cli,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('Unexpected peer tool');}}),observe:async(id,source)=>{source.on('childAgent',event=>childEvents.push(event));source.on('childEvent',event=>nativeEvents.push(event.frame.value));source.on('event',event=>{if(event.raw?.value?.tool_use_result)nativeEvents.push(event.raw.value);});observations.push(attachNativeObservation(id,source,()=>structuredClone(state),async change=>change(state)));},context:async()=>'',translate:()=>{},failure:error=>{errors.push(String(error));console.error(error);}});
try{
 for(const runtime of await runner.runtimes()){
  const id=randomUUID();state.sessions.push({id,projectId:null,projectPath:path.join(home,'project-'+runtime),title:'Synthetic',status:'idle',binding:{runtime,provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'},modelSelection:{model:model.model,effort:'high'},permissionMode:runtime==='claude'?'plan':'read-only',messages:[]});
  let approvals=0;
  const send=async(text,decision)=>{await runner.submit(id,{id:randomUUID(),original:text,translated:text,revisions:[],sourceHash:'fixture',bypass:true,demo:false});const end=Date.now()+90000;while(runner.busy(id)&&Date.now()<end){const request=state.sessions.find(session=>session.id===id).nativeApprovals?.[0];if(request&&decision){assert.match(request.details,/Edit/);await runner.approval(id,request.id,decision);approvals++;}await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(runner.busy(id),false,'Native turn completed before timeout');const session=state.sessions.find(session=>session.id===id);assert.equal(session.status,'idle',errors.join('\n'));assert.match(session.messages.at(-1)?.original??'',/Native provider fixture complete/);return session;};
  const first=await send('Reply briefly. Do not use tools.'),nativeId=first.binding.nativeSessionId;assert.ok(nativeId);await send('Reply briefly once more. Do not use tools.');assert.equal(first.binding.nativeSessionId,nativeId);checks.push(runtime+' native process and exact session resume');console.log('PASS '+checks.at(-1));
  first.permissionMode='full-access';const previous=nativeToolResults;await send('Run one native tool to read the synthetic fixture, then reply.');assert.equal(nativeToolResults,previous+1);checks.push(runtime+' executes its own native tool and receives the real result');console.log('PASS '+checks.at(-1));
  if(runtime==='claude'){
   for(const mode of ['foreground','background']){await send('Run one native child in '+mode+' to review the synthetic fixture.');await Promise.all(observations.map(observer=>observer.flush()));const child=state.sessions.find(session=>session.id===id).nativeChildren?.find(child=>child.toolCallId==='native-agent-smoke-'+mode);assert.equal(child?.operation,'completed',JSON.stringify(childEvents));assert.ok(child.messages?.some(message=>message.text.includes('NATIVE_CHILD_FIXTURE_REPLY')),'Native child public reply captured');checks.push('claude '+mode+' request preserves native Agent scheduling, conversation and lifecycle');console.log('PASS '+checks.at(-1));}
   first.permissionMode='default';await send('Run approved native edit on the synthetic fixture.','decline');assert.equal(await readFile(fixtureFile,'utf8'),'NATIVE_TOOL_FIXTURE');await send('Run approved native edit on the synthetic fixture.','accept');assert.equal(await readFile(fixtureFile,'utf8'),'NATIVE_APPROVED_EDIT');assert.equal(approvals,2);checks.push('claude native approvals deny and allow only the synthetic edit');console.log('PASS '+checks.at(-1));}
 }
 assert.ok(requests.length>=2);assert.ok(requests.every(request=>request.model===model.model&&request.effort==='high'));assert.deepEqual(errors,[]);
}finally{await runner.dispose();await cli.dispose();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,requests,childEvents,nativeEvents,scope:'Real installed CLIs with isolated native homes and synthetic loopback upstream only'},null,2));}
