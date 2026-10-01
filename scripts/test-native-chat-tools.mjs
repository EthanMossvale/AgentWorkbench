import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';
import {attachNativeObservation} from '../apps/desktop/host/native-observation.ts';
import {PeerInbox} from '../packages/collaboration-core/inbox.ts';
import {createPeerTools} from '../packages/collaboration-core/tools.ts';

const output=path.resolve('build/qa/chat-tools/native'),home=path.join(output,'home-'+Date.now());
await mkdir(path.join(home,'.codex'),{recursive:true});await mkdir(path.join(home,'.claude'),{recursive:true});
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit isolated CLI executables required');
const checks=[],errors=[],calls=[],observers=[];let stage=0,sourceId='',runtime='';
const targetId='synthetic-target';
const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;let body;try{body=JSON.parse(raw);}catch{res.writeHead(404).end();return;}
  const reply=content=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content}}]}));};
  if(!body.tools?.length){reply('Synthetic auxiliary result.');return;}
  try{
    const last=body.messages.filter(m=>m.role!=='system').at(-1);
    if(stage>0){assert.equal(last?.role,'tool');const text=String(last.content);assert.doesNotMatch(text,/PRIVATE_ACCOUNT/);
      if(stage===1)assert.match(text,/Known fixture chat/);
      if(stage===2)assert.match(text,/SYNTHETIC_PUBLIC_HISTORY/);
      if(stage===3)assert.match(text,/fromTitle/);
      if(stage===4)assert.match(text,/AUTHORIZED_FIXTURE_HANDOFF/);
    }
    const actions=[['workbench_list_sessions',{query:'Known fixture chat'}],['workbench_read_session',{sessionId:targetId}],['workbench_send_message',{targetSessionId:targetId,text:'AUTHORIZED_FIXTURE_HANDOFF',operationId:'native-'+runtime}],['workbench_read_messages',{}],['workbench_wait_messages',{afterRevision:0,timeoutMs:0}]];
    if(stage===actions.length){reply('CHAT_TOOLS_COMPLETE');return;}
    const [name,args]=actions[stage],tool=body.tools.find(t=>t.function.name===name||t.function.name.endsWith('__'+name));
    assert.ok(tool,'Native runtime advertised '+name);stage++;
    calls.push({runtime,name});res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'chat-'+randomUUID(),type:'function',function:{name:tool.function.name,arguments:JSON.stringify(args)}}]}}]}));
  }catch(error){errors.push(String(error));reply('CHAT_TOOLS_FIXTURE_FAILED');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const model={id:'fixture',model:'fixture',name:'Fixture',enabled:true,contextWindow:128000};
const connection={id:'fixture',revision:'one',name:'Fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],tools:true,timeoutMs:30000,maxOutputTokens:8192};
const cli=new LocalCliService(output,{home,isolated:true,executables:{codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
const state={sessions:[{id:targetId,title:'Known fixture chat',projectId:null,archived:false,pinned:false,group:'',createdAt:new Date().toISOString(),status:'idle',binding:{runtime:'claude',provider:'fixture',accountRef:'PRIVATE_ACCOUNT',executionId:'local-device',egress:'direct-api'},messages:[{id:'fixture-message',role:'assistant',original:'SYNTHETIC_PUBLIC_HISTORY',timestamp:new Date().toISOString(),demo:false}]}],hosts:[],modelConnections:[connection],collaboration:{version:1,revision:0,messages:[]}};
const identity=session=>({session,ownerId:'fixture-owner'});
const inbox=new PeerInbox({snapshot:()=>structuredClone(state.collaboration),update:async fn=>fn(state.collaboration),identity:id=>{const session=state.sessions.find(s=>s.id===id);return session?identity(session):undefined;},identities:()=>state.sessions.map(identity)});
const runner=new NativeProviderRunner({connection:()=>connection,key:async()=> 'synthetic-only'},cli,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),peers:id=>createPeerTools(inbox,id),observe:async(id,source)=>observers.push(attachNativeObservation(id,source,()=>structuredClone(state),async fn=>fn(state))),context:async()=>'',translate:()=>{},failure:error=>errors.push(String(error))});
try{
  for(runtime of ['codex','claude']){
    stage=0;sourceId=randomUUID();const session={id:sourceId,title:'Native '+runtime+' source',projectId:null,projectPath:path.join(home,runtime+'-project'),archived:false,pinned:false,group:'',createdAt:new Date().toISOString(),status:'idle',binding:{runtime,provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'},permissionMode:'full-access',messages:[]};state.sessions.push(session);
    session.modelSelection={model:model.model};
    await runner.submit(sourceId,{id:randomUUID(),original:'Use the workbench chat catalog to read the known fixture chat. You may send exactly one authorized fixture handoff, then read and check your inbox without starting another task.',translated:'Use the workbench chat catalog to read the known fixture chat. You may send exactly one authorized fixture handoff, then read and check your inbox without starting another task.',sourceHash:'fixture',demo:false,bypass:true,revisions:[]});
    const until=Date.now()+60000;while(runner.busy(sourceId)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(runner.busy(sourceId),false);assert.equal(session.status,'idle',errors.join('\n'));assert.equal(session.messages.at(-1)?.original,'CHAT_TOOLS_COMPLETE',errors.join('\n'));await Promise.all(observers.map(o=>o.flush()));
    const sent=state.collaboration.messages.filter(m=>m.fromSessionId===sourceId);assert.equal(sent.length,1);assert.equal(sent[0].fromTitle,session.title);assert.equal(sent[0].fromRuntime,runtime);assert.equal(state.sessions[0].messages.length,1,'Peer target did not start another turn');
    assert.ok(session.activities.some(a=>a.toolName?.endsWith('workbench_list_sessions')));assert.ok(session.activities.some(a=>a.toolName?.endsWith('workbench_read_session')));
    checks.push(runtime+': advertises and calls list/history tools with exact public results',runtime+': stamps source and queues one message without starting recipient',runtime+': read/wait inbox and public activity observations round-trip');console.log('PASS '+runtime+' native chat tools');
  }
  assert.deepEqual(errors,[]);
}finally{await runner.dispose();inbox.dispose();await cli.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,calls,scope:'Actual installed CLIs, disposable native homes and synthetic loopback upstream only'},null,2));}
