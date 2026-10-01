import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';
import {attachNativeObservation} from '../apps/desktop/host/native-observation.ts';
import {observeTurnTiming} from '../packages/session-core/turn-timing.ts';

const output=path.resolve('build/qa/runtime-reading/background'),home=path.join(output,'home-'+Date.now());
await mkdir(path.join(home,'.codex'),{recursive:true});await mkdir(path.join(home,'.claude'),{recursive:true});
const checks=[],errors=[],requests=[],observers=[];let release,childWaiting=false,childReplySent=false,expectedStop=false;
const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;let body;try{body=JSON.parse(raw);}catch{res.writeHead(404).end();return;}
  const task=JSON.stringify(body.messages.findLast(m=>m.role==='user')),last=body.messages.filter(m=>m.role!=='system').at(-1);
  const child=task.includes('HELD_CHILD_ONLY')&&!task.includes('SPAWN_BACKGROUND_FIXTURE');requests.push({child,lastRole:last?.role,tools:body.tools?.map(t=>({name:t.function.name,fields:Object.keys(t.function.parameters?.properties??{})}))});
  const reply=content=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content}}]}));};
  if(requests.length>60){res.writeHead(500).end();return;}
  if(!body.tools?.length){reply('Synthetic auxiliary result.');return;}
  if(child){childWaiting=true;await new Promise(resolve=>{release=resolve;});childReplySent=true;reply('HELD_CHILD_FINISHED');return;}
  if(last?.role!=='tool'&&task.includes('SPAWN_BACKGROUND_FIXTURE')){
    const tool=body.tools.find(t=>t.function.name==='Agent'||t.function.parameters?.properties?.fork_context||/Spawns an agent|Spawn a new agent/i.test(t.function.description??''));
    if(!tool){errors.push('Native spawn tool not found');reply('NO_SPAWN_TOOL');return;}
    const claude=tool.function.name==='Agent',args=claude?{description:'Held synthetic child',prompt:'HELD_CHILD_ONLY: reply without tools.',subagent_type:'general-purpose',run_in_background:true}:{message:'HELD_CHILD_ONLY: reply without tools.',fork_context:false};
    res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'hold-'+randomUUID(),type:'function',function:{name:tool.function.name,arguments:JSON.stringify(args)}}]}}]}));return;
  }
  reply(task.includes('SECOND_PARENT_FIXTURE')?'SECOND_PARENT_FINISHED':'FIRST_PARENT_FINISHED');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const model={id:'fixture',model:'fixture',name:'Fixture',enabled:true,efforts:['high'],contextWindow:128000};
const connection={id:'fixture',revision:'one',name:'Fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],tools:true,timeoutMs:60000,maxOutputTokens:8192};
const cli=new LocalCliService(output,{home,isolated:true,executables:{codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
const state={sessions:[],hosts:[],modelConnections:[connection]};
const update=async fn=>{const previous=structuredClone(state);fn(state);for(const session of state.sessions)observeTurnTiming(previous.sessions.find(s=>s.id===session.id),session,new Date().toISOString());};
const runner=new NativeProviderRunner({connection:()=>connection,key:async()=> 'synthetic-only'},cli,{snapshot:()=>structuredClone(state),update,peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('Unexpected peer call');}}),observe:async(id,source)=>observers.push(attachNativeObservation(id,source,()=>structuredClone(state),update)),context:async()=>'',translate:()=>{},failure:error=>{if(!expectedStop||!/NATIVE_TURN_CANCELLED|AbortError/.test(String(error)))errors.push(String(error));}});
const wait=async(fn,label)=>{const end=Date.now()+40000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout: '+label);};
const preview=text=>({id:randomUUID(),original:text,translated:text,revisions:[],sourceHash:'fixture',bypass:true,demo:false});
try{
  for(const runtime of await runner.runtimes()){
    childWaiting=false;childReplySent=false;release=undefined;
    const id=randomUUID(),session={id,projectId:null,projectPath:path.join(home,'project-'+runtime),title:'Synthetic',status:'idle',binding:{runtime,provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'},modelSelection:{model:'fixture',effort:'high'},permissionMode:runtime==='claude'?'full-access':'read-only',messages:[]};state.sessions.push(session);
    await runner.submit(id,preview('SPAWN_BACKGROUND_FIXTURE: start one child and reply immediately.'));
    await wait(()=>childWaiting&&session.status==='idle','parent idle while child is held');
    assert.equal(childReplySent,false);assert.equal(runner.busy(id),true,'Background work retains maintenance/settings exclusion');
    await assert.rejects(runner.close(id));
    const nativeId=session.binding.nativeSessionId,processCount=observers.length;
    await runner.submit(id,preview('SECOND_PARENT_FIXTURE: reply immediately without any tools.'));
    await wait(()=>session.status==='idle'&&session.messages.some(m=>m.original==='SECOND_PARENT_FINISHED'),'second explicit parent response before child');
    assert.equal(childReplySent,false);assert.equal(session.binding.nativeSessionId,nativeId);assert.equal(observers.length,processCount,'Same owned native process and observation');
    release();await wait(()=>!runner.busy(id),'child finishes and owned process closes');await Promise.all(observers.map(o=>o.flush()));
    assert.ok(session.nativeChildren?.some(c=>c.operation==='completed'));assert.equal(session.messages.filter(m=>m.role==='user').length,2);
    checks.push(`${runtime}: next parent turn on the same process/thread while child remains alive, then child completion`);console.log('PASS '+checks.at(-1));
    childWaiting=false;childReplySent=false;release=undefined;
    await runner.submit(id,preview('SPAWN_BACKGROUND_FIXTURE: start another child for explicit stop verification.'));
    await wait(()=>childWaiting&&session.status==='idle','background task before explicit stop');
    const rootStatus=session.nativeTurnStatus,timing=structuredClone(session.turnTimings.at(-1));
    expectedStop=true;const stopped=await runner.stop(id);release?.();await Promise.all(observers.map(o=>o.flush()));
    assert.equal(stopped.stopped,true);assert.equal(runner.busy(id),false);assert.equal(session.nativeObservation,'disconnected');assert.ok(session.nativeChildren?.some(child=>child.operation==='closed'&&child.status==='cancelled'));assert.equal(session.nativeTurnStatus,rootStatus);assert.deepEqual(session.turnTimings.at(-1),timing);expectedStop=false;
    checks.push(`${runtime}: explicit background stop retains the completed root outcome and timer`);console.log('PASS '+checks.at(-1));
  }
  assert.deepEqual(errors,[]);
}finally{release?.();await runner.dispose();await cli.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,requests,sessions:state.sessions,scope:'Installed CLI, isolated homes, synthetic loopback provider; no paid requests'},null,2));}
