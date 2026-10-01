import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';
import {NativeMemoryTaskExecutor} from '../apps/desktop/host/memory-background.ts';
import {NativeMemoryService} from '../packages/native-memory/index.ts';
import {ProcessSupervisor} from '../services/remote-supervisor/index.ts';

// Installed CLIs, disposable homes and loopback inference. No user accounts or real inference.
const output=path.resolve(process.env.AWB_MEMORY_QA??'build/qa/memory-receiver-20260930/native');
await mkdir(output,{recursive:true});
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit native executable paths required.');
const checks=[],errors=[],requests=[],diagnostics=[];
const final=text=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:100,completion_tokens:10}});
const call=(name,args)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
let mode='memory',runtime='codex',manifest,stage=0,nativeIndex='',topicFile='',expected='';
const server=createServer(async(req,res)=>{
  try{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),text=JSON.stringify(body.messages),tools=body.tools?.map(t=>t.function?.name)??[];
    assert.ok(requests.length<80,'Synthetic request budget exceeded');requests.push({mode,runtime,model:body.model,tools});res.setHeader('content-type','application/json');
    const toolText=body.messages.filter(m=>m.role==='tool').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
    if(mode==='memory'){
      assert.match(text,/agent-workbench-memory-consolidation/);assert.ok(text.includes(runtime==='codex'?'Receiving runtime: Codex.':'Receiving runtime: Claude Code.'));assert.equal(manifest.recipientRuntime,runtime);assert.ok(manifest.entries.every(e=>e.recipientRuntime===runtime&&e.sourceRuntime!==runtime));assert.ok(manifest.nativeMemories.every(m=>m.runtime===runtime));assert.doesNotMatch(text,/FRESH_CHAT_RECALL/);
      const read=tools.find(t=>t.endsWith('workbench_read_memory_handoff')),store=tools.find(t=>t.endsWith('workbench_store_memory_handoff'));
      assert.ok(read&&store,'Native consolidation tools must be discoverable');
      assert.ok(!tools.some(t=>/workbench_(send_message|start_model_agent|list_sessions)/.test(t)));
      if(stage++===0){res.end(JSON.stringify(call(read,{})));return;}
      if(stage===2){res.end(JSON.stringify(call(store,{entries:manifest.entries.map(e=>({archiveId:e.archiveId,topic:'native-slot-default',title:'Scoped native Slot convention',content:`${e.sourceRuntime==='codex'?'CODEX_FACT':'CLAUDE_FACT'}: Use native Slot by default for the fixture project; fuzzy mode requires an explicit request. Scope is unchanged.`}))})));return;}
      assert.match(toolText,/verified[^0-9]+1/);res.end(JSON.stringify(final('Native references verified in one background session.')));return;
    }
    assert.match(text,/FRESH_CHAT_RECALL/);assert.ok(!tools.some(t=>/workbench_(read|store|verify)_memory_handoff/.test(t)));
    if(stage===0){assert.match(text,/Imported memory references/,'Fresh unrelated cwd must load the native user entry point');stage++;}
    else if(stage===1){assert.match(toolText,/native-slot-default/);stage++;}
    else {assert.ok(toolText.includes(expected),'Native file tool must read the other runtime fact');res.end(JSON.stringify(final('FRESH_CHAT_RECALL_COMPLETE')));return;}
    const file=stage===1?nativeIndex:topicFile;
    if(tools.includes('Read')){res.end(JSON.stringify(call('Read',{file_path:file})));return;}
    const name=tools.includes('exec_command')?'exec_command':'shell_command';assert.ok(tools.includes(name));
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const command=`Get-Content -LiteralPath ${quote(file)} -Raw`;
    res.end(JSON.stringify(call(name,name==='exec_command'?{cmd:command,max_output_tokens:2000}:{command,timeout_ms:10000})));
  }catch(error){errors.push(String(error));res.writeHead(500).end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const model={id:'mapping',model:'fixture-model',name:'Fixture',enabled:true,contextWindow:128000};
const connection={id:'fixture',revision:'fixture',name:'Fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',enabled:true,auth:'key',hasKey:true,models:[model],tools:true,timeoutMs:20000,maxOutputTokens:8192};
const connections={connection:()=>connection,key:async()=>'synthetic'};
const wait=async predicate=>{const end=Date.now()+90000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,30));assert.ok(predicate(),'Native fixture timed out: '+JSON.stringify(errors));};
try{
  for(runtime of ['codex','claude']){
    const home=path.join(output,runtime+'-'+Date.now()),codex=path.join(home,'.codex'),claude=path.join(home,'.claude');
    const put=async(file,content)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);};
    await put(path.join(codex,'memories','source.md'),'CODEX_FACT: Native Slot is the explicit default.');
    await put(path.join(claude,'projects','source-project','memory','source.md'),'CLAUDE_FACT: Fuzzy Slot requires an explicit request.');
    const cli=new LocalCliService(path.join(home,'data'),{home,isolated:true,executables:{codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE}});await cli.initialize();
    const memory=new NativeMemoryService(path.join(home,'data'),{home,codexHome:codex,claudeHome:claude,intervalMs:3600000,machineIdentity:'fixture'});await memory.initialize();await memory.configure({enabled:true,initialSources:'both'});
    let runs=0;const executor=new NativeMemoryTaskExecutor(connections,cli,undefined,undefined,{processFactory:spec=>{
      const child=new ProcessSupervisor(spec);
      child.on('diagnostic',text=>diagnostics.push({runtime,event:'stderr',text}));
      child.on('fault',error=>diagnostics.push({runtime,event:'fault',text:String(error)}));
      child.on('frame',frame=>{if(frame.value.error)diagnostics.push({runtime,event:'rpc-error',error:frame.value.error});});
      child.on('disconnect',exit=>diagnostics.push({runtime,event:'exit',exit}));
      return child;
    }});
    memory.background.registerExecutor({mode:'consolidation',supports:t=>executor.supports(t),run:async task=>{runs++;manifest=await task.read({});return executor.run(task);}});
    const state={hosts:[],sessions:[],modelConnections:[connection]},runner=new NativeProviderRunner(connections,cli,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>'',translate:()=>{},observe:async()=>{},peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('Unexpected foreground tool');}})});
    try{
      const target={binding:{runtime,provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'mapping'},modelSelection:{model:model.model},permissionMode:'full-access'};
      mode='memory';stage=0;const before=JSON.stringify(state);
      assert.equal((await memory.background.start(target,randomUUID())).started,true);await wait(()=>!memory.background.busy());
      const task=memory.background.list().at(-1);assert.equal(task.state,'completed',JSON.stringify({task,errors}));assert.equal(task.processed,1);assert.equal(runs,1);assert.equal(JSON.stringify(state),before);
      checks.push(runtime+': receiving-native session stores only its own foreign backlog');console.log('PASS '+checks.at(-1));
      const status=await memory.status();assert.equal(runtime==='codex'?status.pendingClaude:status.pendingCodex,1,'Other receiver remains pending');await assert.rejects(readFile(path.join(runtime==='codex'?claude:codex,runtime==='codex'?'CLAUDE.md':'AGENTS.md')),'Must not write the other runtime entry point');
      nativeIndex=path.join(runtime==='codex'?codex:claude,runtime==='codex'?'memories':'memory','received','INDEX.md');
      const index=await readFile(nativeIndex,'utf8'),relative=index.match(/\]\(([a-f0-9]{32}\.md)\)/)?.[1];assert.ok(relative);topicFile=path.join(path.dirname(nativeIndex),relative);expected=runtime==='codex'?'CLAUDE_FACT':'CODEX_FACT';
      const session={id:randomUUID(),projectId:null,projectPath:path.join(home,'unrelated-new-project'),title:'Fresh recall fixture',status:'idle',messages:[],...target};state.sessions.push(session);
      mode='recall';stage=0;await runner.submit(session.id,{id:randomUUID(),original:'FRESH_CHAT_RECALL: Find the native Slot default in existing memories.',translated:'FRESH_CHAT_RECALL: Find the native Slot default in existing memories.',revision:1,sourceHash:'fixture',bypass:true,demo:false});await wait(()=>!runner.busy(session.id));
      assert.equal(session.nativeTurnStatus,'completed');assert.equal(stage,2);checks.push(runtime+': fresh unrelated project loads native pointer and reads received topic through real native file tools');console.log('PASS '+checks.at(-1));
    }finally{await runner.dispose();await memory.dispose();await cli.dispose();}
  }
  assert.deepEqual(errors,[]);
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,requests,diagnostics,scope:'Installed native CLIs and synthetic loopback inference; isolated homes. Proves protocol, storage and startup/file discovery, not real-model semantic recall or production backlog adoption.'},null,2));}
