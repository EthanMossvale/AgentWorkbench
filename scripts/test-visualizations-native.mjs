import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';
import {PluginRegistry} from '../packages/plugins-core/index.ts';
import {encodeZip} from '../packages/native-resources/archive.ts';
import {visualizationPresentation} from '../packages/visualizations/instructions.ts';
import {markdownTokens} from '../packages/message-markdown/index.ts';

const output=path.resolve(process.env.AWB_VISUALIZATION_NATIVE_QA??'build/qa/visualizations-native');await mkdir(output,{recursive:true});
const home=await mkdtemp(path.join(os.tmpdir(),'awb-visualizations-'));
const executables={codex:process.env.AWB_QA_CODEX,claude:process.env.AWB_QA_CLAUDE};assert.ok(executables.codex&&executables.claude,'Explicit isolated QA executables are required.');
for(const directory of ['.codex','.claude','project'])await mkdir(path.join(home,directory));
const file=path.join(home,'project','fixture.html');await writeFile(file,'<button>Fixture</button>');
const content='\uE200visualize\uE202'+JSON.stringify({path:file,title:'Synthetic visualization'})+'\uE201';
const cli=new LocalCliService(home,{home,isolated:true,executables});await cli.initialize();
const model={id:'fixture',model:'visualization-fixture',name:'Fixture',enabled:true,contextWindow:1000000};
const connection={id:'fixture',revision:'one',name:'Fixture',baseUrl:'https://fixture.invalid/v1',protocol:'chat-completions',enabled:true,auth:'none',hasKey:false,models:[model],timeoutMs:10000};
const state={hosts:[],sessions:[],modelConnections:[connection]},observations=[],errors=[];let current;
const runner=new NativeProviderRunner({connection:()=>connection,key:async()=>''},cli,{
  snapshot:()=>structuredClone(state),update:async change=>change(state),context:async()=>'',translate:()=>{},
  peers:id=>({sourceSessionId:id,definitions:[],call:async()=>{throw Error('No fixture tools expected');}}),
  failure:error=>errors.push(String(error)),observe:async()=>{},
},async(_url,init)=>{
  current.requests++;assert.equal(current.requests,1,'No inference replay is permitted.');
  const request=JSON.parse(String(init.body)),system=JSON.stringify(request.messages.filter(item=>item.role==='system'||item.role==='developer'));
  current.instructionsReceived=system.includes('widgetState')&&system.includes('visualize');current.policyReceived=system.includes('POLICY_VISUALIZATION_PROBE');
  const completion=request.tools?.map(tool=>tool.function??tool).find(tool=>tool.name==='awb_complete_turn');assert.ok(completion,'The production cross-protocol completion contract is present.');
  return new Response(JSON.stringify({id:'synthetic-response',choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'synthetic-completion',type:'function',function:{name:completion.name,arguments:JSON.stringify({outcome:'completed',message:content})}}]}}],usage:{prompt_tokens:120,completion_tokens:40}}),{headers:{'content-type':'application/json'}});
});
const plugins=new PluginRegistry(path.join(home,'plugins'));await plugins.initialize();plugins.services.register('visualizations.presentation',visualizationPresentation,{version:1});
const manifest={schemaVersion:1,apiVersion:1,id:'qa.visualization-policy',name:'Synthetic visualization policy',version:'1.0.0',description:'Isolated native presentation lifecycle test',capabilities:['host'],main:'main.mjs'};
try{
  const zip=path.join(home,'policy.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from("export function activate(api){api.services.intercept('visualizations.presentation','instructions',(next,runtime)=>next(runtime)+' POLICY_VISUALIZATION_PROBE');}")} ]));
  await plugins.importZip(zip);const plugin=(await plugins.list())[0];await assert.rejects(plugins.setEnabled(manifest.id,plugin.hash,true),/Explicit approval/);
  for(const phase of ['core','enabled','disabled','reenabled']){
    if(phase==='enabled'||phase==='reenabled')await plugins.setEnabled(manifest.id,plugin.hash,true,phase==='enabled');else if(phase==='disabled')await plugins.setEnabled(manifest.id,plugin.hash,false);
    for(const runtime of ['codex','claude']){
      current={runtime,phase,requests:0};observations.push(current);
      const session={id:randomUUID(),projectId:null,projectPath:path.join(home,'project'),title:'Synthetic visualization',status:'idle',binding:{runtime,provider:'fixture',accountRef:'model-api:fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'},modelSelection:{model:model.model},permissionMode:runtime==='claude'?'plan':'read-only',messages:[]};state.sessions.push(session);
      await runner.submit(session.id,{id:randomUUID(),original:'Return the provided fixture reply once. Do not use tools.',translated:'Return the provided fixture reply once. Do not use tools.',revisions:[],sourceHash:'fixture',bypass:true,demo:false});
      const deadline=Date.now()+45000;while(runner.busy(session.id)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
      assert.equal(runner.busy(session.id),false);assert.equal(session.nativeTurnStatus,'completed');assert.equal(current.instructionsReceived,true);assert.equal(current.policyReceived,phase==='enabled'||phase==='reenabled');
      const answer=session.messages.findLast(message=>message.role==='assistant');assert.equal(answer?.original,content);assert.equal(markdownTokens(answer.original)[0].type,'visualization');
      console.log(`PASS ${runtime} ${phase}: instructions, exact native reply, production tokenizer`);
    }
  }
  assert.deepEqual(errors,[]);
}finally{
  await plugins.dispose();await runner.dispose();await cli.dispose();
  await writeFile(path.join(output,'report.json'),JSON.stringify({observations,errors,scope:'Installed native CLI processes; temporary homes and synthetic upstream; no user credentials, paid inference or deployment.'},null,2));
  assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert.ok(path.basename(home).startsWith('awb-visualizations-'));await rm(home,{recursive:true,force:true,maxRetries:3});
}
