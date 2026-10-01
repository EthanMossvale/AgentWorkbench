import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { LocalCliService } from '../packages/native-runtime/cli.ts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider.ts';

// Disposable native homes and a synthetic provider; never paid-model acceptance.
const output=path.resolve(process.env.AWB_COMMANDS_QA??'build/qa/runtime-commands/native');
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit native QA executables required.');
await mkdir(output,{recursive:true});
const home=await mkdtemp(path.join(os.tmpdir(),'awb-native-commands-'));
for(const folder of ['project','.codex','.claude'])await mkdir(path.join(home,folder));
const checks=[],errors=[],observations=[];let current,passed=false,contextCalls=0;
const summary='NATIVE_MANUAL_SUMMARY: The fixture history is retained.';
const server=createServer(async(req,res)=>{try{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
  assert.equal(body.model,'command-fixture');
  const content=JSON.stringify(body.messages);
  current.requests.push({operation:current.operation,summary:content.includes(summary),messages:body.messages.length});
  if(current.requests.length>12)throw Error('Synthetic request guard exceeded');
  const text=current.operation==='compact'?summary:'Synthetic fixture details. '.repeat(300);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:6000,completion_tokens:2000}}));
}catch(error){errors.push(String(error));res.writeHead(400).end('{}');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const model={id:'fixture',model:'command-fixture',name:'Fixture',enabled:true,contextWindow:128000};
const connection={id:'fixture',revision:'fixture',name:'Fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],tools:true,timeoutMs:15000,maxOutputTokens:8192};
const cli=new LocalCliService(home,{home,isolated:true,executables:{codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
const state={hosts:[],sessions:[],modelConnections:[connection]};
const runner=new NativeProviderRunner({connection:()=>connection,key:async()=>'synthetic'},cli,{
  snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>{contextCalls++;return '';},translate:()=>{},failure:error=>errors.push(String(error)),
  peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('Unexpected peer tool.');}}),
  observe:async(_id,source)=>{
    source.on('event',event=>{const v=event.raw?.value;if(v?.type==='system'&&v.subtype==='compact_boundary')current.boundaries.push({trigger:v.compact_metadata?.trigger});});
    source.on('raw',frame=>{if(frame.value.method==='item/completed'&&frame.value.params?.item?.type==='contextCompaction')current.boundaries.push({trigger:'manual'});});
  },
});
const wait=async(fn,label)=>{const until=Date.now()+60000;while(!fn()&&Date.now()<until)await new Promise(r=>setTimeout(r,70));assert.ok(fn(),label);};
const mark=label=>{checks.push(label);console.log('PASS '+label);};
const submit=async session=>{await runner.submit(session.id,{id:randomUUID(),original:'Remember the synthetic fixture details.',translated:'Remember the synthetic fixture details.',revision:1,sourceHash:'fixture',demo:false,bypass:true});await wait(()=>!runner.busy(session.id),'native process cleanup');assert.equal(session.nativeTurnStatus,'completed');};
try{
  for(const runtime of ['codex','claude']){
    current={runtime,operation:'task',requests:[],boundaries:[]};observations.push(current);
    const session={id:randomUUID(),projectId:null,projectPath:path.join(home,'project'),title:'Commands fixture',status:'idle',binding:{runtime,provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'},modelSelection:{model:model.model},permissionMode:'default',messages:[]};state.sessions.push(session);
    await assert.rejects(runner.compact(session.id),/HISTORY_NOT_READY/);assert.equal(current.requests.length,0);
    await submit(session);await submit(session);const nativeId=session.binding.nativeSessionId;
    current.operation='compact';const beforeContext=contextCalls;
    await runner.compact(session.id);await assert.rejects(runner.compact(session.id),/BUSY/);
    await wait(()=>!runner.busy(session.id),'native compaction cleanup');
    assert.equal(session.status,'idle');assert.equal(session.nativeTurnStatus,'completed');assert.equal(session.binding.nativeSessionId,nativeId);
    assert.equal(contextCalls,beforeContext,'Commands must not be suffixed with workbench prompts');
    assert.equal(current.boundaries.length,1);assert.equal(current.boundaries[0].trigger,'manual');
    assert.equal(session.messages.filter(m=>m.original==='/compact').length,1);
    assert.ok(current.requests.some(r=>r.operation==='compact'));mark(runtime+': manual compaction uses the native command and same thread, with no prompt injection or duplicate execution');
    current.operation='continuation';await submit(session);assert.ok(current.requests.at(-1).summary);mark(runtime+': the next explicit user turn resumes the native summary');
    session.handoffFromMessage=0;await assert.rejects(runner.compact(session.id),/HISTORY_NOT_READY/);delete session.handoffFromMessage;
    session.status='uncertain';await assert.rejects(runner.compact(session.id),/BUSY/);session.status='idle';mark(runtime+': unstarted, busy, uncertain and unapplied handoff states reject compaction');
  }
  assert.deepEqual(errors,[]);passed=true;
}finally{
  await runner.dispose();await cli.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors,observations,scope:'Actual installed CLIs, disposable homes and synthetic loopback provider; no paid model, SSH, production build or user client.'},null,2));
  assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert.ok(path.basename(home).startsWith('awb-native-commands-'));await rm(home,{recursive:true,force:true,maxRetries:3});
}
