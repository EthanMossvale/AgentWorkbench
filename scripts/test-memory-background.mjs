import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';
import {NativeMemoryTaskExecutor} from '../apps/desktop/host/memory-background.ts';
import {NativeMemoryService} from '../packages/native-memory/index.ts';

// Installed CLIs, disposable homes, synthetic loopback inference. No active client or real account.
const output=path.resolve(process.env.AWB_MEMORY_QA??'build/qa/memory-background-20260928/native');
const home=path.join(output,'home-'+Date.now()),checks=[],requests=[],errors=[];
await mkdir(path.join(home,'.codex','memories'),{recursive:true});await mkdir(path.join(home,'.claude','projects','fixture','memory'),{recursive:true});
await writeFile(path.join(home,'.codex','memories','MEMORY.md'),'Synthetic Codex reference.');
await writeFile(path.join(home,'.claude','projects','fixture','memory','MEMORY.md'),'Synthetic Claude reference.');
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit native executable paths required.');
const final=text=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:100,completion_tokens:10}});
const call=(name,args)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
let mode='foreground',repairSteps=[],repairRuns=0;
const hash=text=>createHash('sha256').update(text).digest('hex');
function repairPlan(prompt){
  const m=JSON.parse(prompt.slice(prompt.lastIndexOf('\n{')+1,prompt.lastIndexOf('\n</agent-workbench-memory-handoff>')));
  const index=m.existingNativeIndexes[0].path,files=[],rows=[];let bare='# Native index\n',marked='# Native index\n';
  for(const [i,e] of m.entries.entries()){
    const file=path.join(path.dirname(index),`received-${i}.md`),content=e.startMarker+'\n'+e.scope+'\nSynthetic imported reference.\n'+e.endMarker;
    const link=`[Reference ${i}](received-${i}.md)`;files.push({path:file,content});bare+=link+'\n';marked+=e.startMarker+'\n'+link+'\n'+e.endMarker+'\n';
    rows.push({archiveId:e.archiveId,revision:e.revision,scope:e.scope,disposition:'stored',files:[{path:file,sha256:hash(content)}]});
  }
  const receipt=content=>({path:m.receiptFile,content:JSON.stringify({deliveryId:m.deliveryId,token:m.token,recipientRuntime:m.recipientRuntime,entries:rows.map(row=>({...row,index:{path:index,sha256:hash(content)}}))})});
  return [...files,{path:index,content:bare},receipt(bare),{verify:true},{expect:'MEMORY_RECEIPT_INDEX_PROVENANCE',path:index,content:marked},receipt(marked),{verify:true},{complete:true}];
}
const server=createServer(async(req,res)=>{
  try{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),text=JSON.stringify(body.messages),tools=body.tools?.map(t=>t.function?.name)??[];
    const identities=[...text.matchAll(/You are powered by the model [^\\<\n]+/g)].map(m=>m[0].slice(0,180));
    assert.ok(requests.length<100,'Synthetic request budget exceeded');requests.push({mode,model:body.model,tools,identities});res.setHeader('content-type','application/json');
    if(mode==='foreground'){
      assert.match(text,/FOREGROUND_SENTINEL/);assert.doesNotMatch(text,/agent-workbench-memory-handoff/);assert.ok(!tools.some(n=>/workbench_(read|verify)_memory_handoff/.test(n)));
      res.end(JSON.stringify(final('FOREGROUND_COMPLETE')));return;
    }
    assert.doesNotMatch(text,/FOREGROUND_SENTINEL/);assert.match(text,/agent-workbench-memory-handoff/);
    assert.ok(!tools.some(n=>/workbench_(list_sessions|send_message|start_model_agent)/.test(n)),'Background cannot see foreground collaboration tools');
    const verifier=tools.find(n=>n.endsWith('workbench_verify_memory_handoff'));assert.ok(verifier,'Native memory verifier must be discoverable');
    const results=body.messages.filter(m=>m.role==='tool').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
    if(mode==='repair'){
      const step=repairSteps.shift();assert.ok(step,'Repair plan must remain bounded');
      if(step.expect)assert.ok(results.includes(step.expect),'Native verifier must return the actual evidence failure');
      if(step.complete){assert.match(results,/complete[\\":\s]+true/);res.end(JSON.stringify(final('Verified receipt repaired in the same native task.')));return;}
      if(step.verify){res.end(JSON.stringify(call(verifier,{})));return;}
      if(tools.includes('Write')){res.end(JSON.stringify(call('Write',{file_path:step.path,content:step.content})));return;}
      const name=tools.includes('exec_command')?'exec_command':'shell_command';assert.ok(tools.includes(name),'Native file tool must be available');
      const quote=value=>"'"+value.replaceAll("'","''")+"'";
      const command=`$file=${quote(step.path)}; [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null; [IO.File]::WriteAllBytes($file,[Convert]::FromBase64String('${Buffer.from(step.content).toString('base64')}'))`;
      res.end(JSON.stringify(call(name,name==='exec_command'?{cmd:command,max_output_tokens:500}:{command,timeout_ms:10000})));return;
    }
    if(mode==='question'){
      const claude=tools.includes('AskUserQuestion'),name=claude?'AskUserQuestion':'request_user_input';assert.ok(tools.includes(name));
      res.end(JSON.stringify(call(name,{questions:[{...(claude?{multiSelect:false}:{id:'fixture'}),header:'Choice',question:'Select a fixture value.',options:[{label:'First',description:'First value'},{label:'Second',description:'Second value'}]}]})));return;
    }
    if(results.includes('MEMORY_RECEIPT_MISSING')){res.end(JSON.stringify(final('Memory batch read; fixture intentionally provides no receipt.')));return;}
    if(results.includes('Native file/index evidence is required')){res.end(JSON.stringify(call(verifier,{})));return;}
    const name=tools.find(n=>n.endsWith('workbench_read_memory_handoff'));assert.ok(name,'Native memory reader must be discoverable');res.end(JSON.stringify(call(name,{})));
  }catch(e){errors.push(String(e));res.writeHead(500).end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const model={id:'mapping',model:'deepseek-flash',name:'Fixture',enabled:true,contextWindow:128000};
const connection={id:'fixture',revision:'fixture',name:'Fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],tools:true,timeoutMs:20000,maxOutputTokens:8192};
const connections={connection:()=>connection,key:async()=>'synthetic'};
const cli=new LocalCliService(output,{home,isolated:true,executables:{codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
const memory=new NativeMemoryService(path.join(home,'data'),{home,codexHome:path.join(home,'.codex'),claudeHome:path.join(home,'.claude'),intervalMs:60000,machineIdentity:'fixture'});await memory.initialize();await memory.configure({enabled:true,initialSources:'both'});
const executor=new NativeMemoryTaskExecutor(connections,cli);
memory.background.registerExecutor({supports:target=>executor.supports(target),run:task=>{if(mode==='repair'){repairRuns++;repairSteps=repairPlan(task.prompt);}return executor.run(task);}});
const state={hosts:[],sessions:[],modelConnections:[connection]},runner=new NativeProviderRunner(connections,cli,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>'',translate:()=>{},observe:async()=>{},peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('Unexpected foreground tool');}})});
const wait=async(predicate)=>{const until=Date.now()+60000;while(!predicate()&&Date.now()<until)await new Promise(r=>setTimeout(r,30));assert.ok(predicate(),'Timed out: '+JSON.stringify({errors,tasks:memory.background.list()}));};
try{
  for(const runtime of ['codex','claude']){
    const session={id:randomUUID(),projectId:null,title:'Foreground fixture',status:'idle',messages:[],projectPath:path.join(home,'project-'+runtime),binding:{runtime,provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'mapping'},modelSelection:{model:model.model},permissionMode:'full-access'};
    state.sessions.push(session);mode='foreground';
    await runner.submit(session.id,{id:randomUUID(),original:'FOREGROUND_SENTINEL',translated:'FOREGROUND_SENTINEL',revision:1,sourceHash:'fixture',bypass:true,demo:false});await wait(()=>!runner.busy(session.id));
    assert.equal(session.nativeTurnStatus,'completed');const before=JSON.stringify(state);
    const target={binding:session.binding,projectPath:session.projectPath,modelSelection:session.modelSelection,permissionMode:session.permissionMode};
    mode='memory';assert.equal((await memory.background.start(target,randomUUID())).started,true);await wait(()=>!memory.background.busy());
    assert.equal(memory.background.list().at(-1).reason,'MEMORY_BACKGROUND_RECEIPT_UNVERIFIED');assert.equal(JSON.stringify(state),before,'Background changes cannot reach foreground store');
    assert.deepEqual(memory.background.list().at(-1).receiptIssues,['MEMORY_RECEIPT_MISSING']);
    mode='question';assert.equal((await memory.background.start(target,randomUUID())).started,true);await wait(()=>!memory.background.busy());
    assert.equal(memory.background.list().at(-1).reason,'MEMORY_BACKGROUND_INTERACTION_REQUIRED');assert.equal(JSON.stringify(state),before);
    checks.push(runtime+': foreground isolation, native memory tool discovery, receipt gate, hidden question cancellation');console.log('PASS '+checks.at(-1));
    mode='repair';const runs=repairRuns;assert.equal((await memory.background.start(target,randomUUID())).started,true);await wait(()=>!memory.background.busy());
    assert.equal(memory.background.list().at(-1).state,'completed');assert.equal(repairRuns,runs+1);assert.deepEqual(memory.background.list().at(-1).receiptIssues,[]);assert.equal(JSON.stringify(state),before);
    checks.push(runtime+': native file writes, typed receipt feedback and same-task repair complete without another executor run');console.log('PASS '+checks.at(-1));
  }
  assert.deepEqual(errors,[]);
}finally{
  await runner.dispose();await memory.dispose();const runtimes=(await cli.list()).filter(x=>x.installed).map(({runtime,version})=>({runtime,version}));await cli.dispose();await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,runtimes,requests,scope:'Real installed CLI transports with disposable native homes and synthetic inference; not a real-model memory ingestion or semantic-quality claim.'},null,2));
}
