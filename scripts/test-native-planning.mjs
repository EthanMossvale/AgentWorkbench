import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';

// Real native executables with disposable homes and a synthetic loopback provider.
const output=path.resolve(process.env.AWB_PLAN_QA??'build/qa/native-planning'),home=path.join(output,'home-'+Date.now());
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit QA executables required.');
for(const name of ['.claude','.codex'])await mkdir(path.join(home,name),{recursive:true});
const checks=[],errors=[],requests=[],modes=[],calls=[];let scenario='exit',held;
const finished=text=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:100,completion_tokens:10}});
const tool=(name,input)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'fixture-'+randomUUID(),type:'function',function:{name,arguments:JSON.stringify(input)}}]}}],usage:{prompt_tokens:100,completion_tokens:10}});
const server=createServer(async(req,res)=>{
  try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push({scenario,body});res.setHeader('content-type','application/json');
    if(requests.length>24)throw Error('Fixture request budget exceeded');
    if(scenario==='hold'){held=res;return;}
    const last=body.messages.filter(m=>m.role!=='system').at(-1);
    if(scenario==='exit'&&last.role!=='tool')res.end(JSON.stringify(tool('ExitPlanMode',{plan:'## Fixture plan\nInspect the fixture, then add a test.'})));
    else if(scenario==='read'&&last.role!=='tool')res.end(JSON.stringify(tool('mcp__workbench__workbench_list_sessions',{})));
    else res.end(JSON.stringify(finished('PLAN_FIXTURE_COMPLETE')));
  }catch(error){errors.push(String(error));res.writeHead(500).end('{}');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const model={id:'fixture',model:'fixture-model',name:'Fixture',enabled:true};
const connection={id:'fixture',revision:'fixture',name:'Fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],tools:true,timeoutMs:20000,maxOutputTokens:8192};
const cli=new LocalCliService(output,{home,isolated:true,executables:{codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
const state={hosts:[],sessions:[],modelConnections:[connection]};
const runner=new NativeProviderRunner({connection:()=>connection,key:async()=> 'synthetic'},cli,{
  snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>'',translate:()=>{},
  observe:async(id,source)=>{source.on('event',event=>{const value=event.raw?.value;if(value?.type==='system'&&value.permissionMode)modes.push({id,mode:value.permissionMode});});},
  peers:id=>({sourceSessionId:id,definitions:[{name:'workbench_list_sessions',description:'Read-only fixture list.',inputSchema:{type:'object',properties:{}}}],call:async name=>{calls.push(name);return [];}}),failure:e=>errors.push(String(e)),
});
const wait=async(fn,label)=>{const until=Date.now()+20000;while(!fn()&&Date.now()<until)await new Promise(r=>setTimeout(r,30));assert.ok(fn(),label+' '+JSON.stringify({errors,modes,requests:requests.map(r=>r.scenario)}));};
const make=runtime=>{const session={id:randomUUID(),projectId:null,projectPath:path.join(home,randomUUID()),title:'Planning fixture',status:'idle',binding:{runtime,provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'},modelSelection:{model:model.model},permissionMode:runtime==='claude'?'plan':'full-access',collaborationMode:runtime==='codex'?'plan':undefined,messages:[]};state.sessions.push(session);return session;};
const submit=async session=>runner.submit(session.id,{id:randomUUID(),original:'Run the isolated planning fixture.',translated:'Run the isolated planning fixture.',revision:1,sourceHash:'fixture',bypass:true,demo:false});
const mark=text=>{checks.push(text);console.log('PASS '+text);};
const currentMode=body=>{const content=body.messages.map(m=>typeof m.content==='string'?m.content:(m.content??[]).map(c=>c.text??'').join('\n')).join('\n');return [...content.matchAll(/<collaboration_mode>([\s\S]*?)<\/collaboration_mode>/g)].at(-1)?.[1]??'';};
try{
  for(const decision of ['accept','plan-accept-edits','plan-full-access','decline']){
    scenario='exit';const session=make('claude');await submit(session);await wait(()=>session.nativeApprovals?.length||!runner.busy(session.id),'plan approval');
    const approval=session.nativeApprovals?.[0];assert.equal(approval?.kind,'plan');assert.match(approval.details,/Fixture plan/);
    await runner.approval(session.id,approval.id,{optionId:decision,receipt:approval.receipt});await wait(()=>!runner.busy(session.id),'plan decision completion');
    assert.equal(session.permissionMode,({accept:'default','plan-accept-edits':'accept-edits','plan-full-access':'full-access',decline:'plan'})[decision]);assert.equal(session.status,'idle');
    mark('Claude '+decision+' preserves native planning decision and reads back permission mode');
  }
  scenario='read';const reader=make('claude');await submit(reader);await wait(()=>!runner.busy(reader.id)||reader.nativeApprovals?.length,'read-only planning tool');
  const readApproval=reader.nativeApprovals?.[0];assert.ok(readApproval,'Native first-use MCP permission remains user-controlled');
  await runner.approval(reader.id,readApproval.id,{optionId:'accept',receipt:readApproval.receipt});await wait(()=>!runner.busy(reader.id),'read-only approval completion');
  assert.deepEqual(calls,['workbench_list_sessions']);assert.equal(reader.status,'idle');
  mark('Claude plan retains native first-use MCP approval and completes read-only tools without a classifier');
  scenario='hold';held=undefined;const changing=make('claude');await submit(changing);await wait(()=>held,'active model request');
  await runner.permissions(changing.id,'default');assert.equal(changing.permissionMode,'default');
  await runner.permissions(changing.id,'plan');assert.equal(changing.permissionMode,'plan');
  held.end(JSON.stringify(finished('MODE_SWITCH_COMPLETE')));await wait(()=>!runner.busy(changing.id),'mode switch completion');
  mark('Claude changes native permission mode during an active request without process restart');
  scenario='complete';const codex=make('codex');await submit(codex);await wait(()=>!runner.busy(codex.id),'Codex plan completion');
  assert.equal(codex.status,'idle');assert.equal(codex.permissionMode,'full-access');
  assert.match(currentMode(requests.at(-1).body),/Plan Mode/);
  codex.collaborationMode='default';await submit(codex);await wait(()=>!runner.busy(codex.id),'Codex default completion');
  assert.match(currentMode(requests.at(-1).body),/Default/);
  mark('Codex native collaboration switches plan/default independently of full access on the same thread');
  for(const runtime of ['claude','codex']){
    scenario='hold';held=undefined;const session=make(runtime);await submit(session);await wait(()=>held,'held request before stop');const before=requests.length;
    await runner.stop(session.id);assert.equal(session.status,'idle');assert.equal(session.nativeTurnStatus,'interrupted');assert.equal(session.nativeError,undefined);assert.equal(session.nativeApprovals?.length??0,0);assert.equal(runner.busy(session.id),false);held.end(JSON.stringify(finished('LATE_RESPONSE')));
    await new Promise(r=>setTimeout(r,100));assert.equal(requests.length,before);assert.equal(session.messages.some(m=>m.original==='LATE_RESPONSE'),false);
    scenario='complete';await submit(session);await wait(()=>!runner.busy(session.id),'explicit message after stop');assert.equal(session.status,'idle');assert.match(session.messages.at(-1).original,/PLAN_FIXTURE_COMPLETE/);
    mark(runtime+' stop quietly returns to idle, ignores late output and accepts one explicit new message');
  }
  assert.deepEqual(errors,[]);
}finally{await runner.dispose();await cli.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,modes,requests,calls,scope:'Installed native CLIs; disposable homes; synthetic loopback responses only. No real model, account, existing client or remote deployment.'},null,2));}
