// Production native translation runner with installed CLIs and loopback-only model fixtures.
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rm,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {NativeTranslationRunner} from '../packages/translation/native.ts';
import {ProcessSupervisor} from '../services/remote-supervisor/index.ts';
import {initialState} from '../apps/desktop/host/store.ts';
const root=path.resolve('build/qa/translation-native');await mkdir(root,{recursive:true});
const requests=[],checks=[];
const server=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  if(req.method!=='POST'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[]}));return;}
  requests.push({path:req.url,body});
  if(req.url.includes('responses')){
   const item={id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Synthetic translated text.',annotations:[]}]};
   const response={id:'resp_fixture',object:'response',status:'completed',model:'fixture-model',output:[item],usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:60}}};
   res.writeHead(200,{'content-type':'text/event-stream'});
   for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('data: '+JSON.stringify(event)+'\n\n');res.end();
  }else if(req.url.includes('messages')){
   const usage={input_tokens:40,output_tokens:20,cache_read_input_tokens:60,cache_creation_input_tokens:0};
   const message={id:'msg_fixture',type:'message',role:'assistant',model:'fixture-model',content:[{type:'text',text:'Synthetic translated text.'}],stop_reason:'end_turn',stop_sequence:null,usage};
   if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
   res.writeHead(200,{'content-type':'text/event-stream'});
   for(const event of [{type:'message_start',message:{...message,content:[],stop_reason:null,usage:{...usage,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Synthetic translated text.'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:20}},{type:'message_stop'}])res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');res.end();
  }else{res.writeHead(404);res.end();}
 }catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/v1`;
try{
 for(const runtime of ['codex','claude']){
  const executable=process.env[runtime==='codex'?'AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE':'AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE'];assert.ok(executable,'Explicit fixture CLI required: '+runtime);
  const directory=await mkdtemp(path.join(root,runtime+'-'));await mkdir(path.join(directory,'tmp'));await mkdir(path.join(directory,'codex'));await mkdir(path.join(directory,'claude'));
  const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','COMSPEC'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{HOME:directory,USERPROFILE:directory,APPDATA:path.join(directory,'appdata'),LOCALAPPDATA:path.join(directory,'local'),TEMP:path.join(directory,'tmp'),TMP:path.join(directory,'tmp'),CODEX_HOME:path.join(directory,'codex'),CLAUDE_CONFIG_DIR:path.join(directory,'claude'),OTEL_SDK_DISABLED:'true',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
  if(runtime==='claude')Object.assign(env,{ANTHROPIC_BASE_URL:base.replace(/\/v1$/,''),ANTHROPIC_API_KEY:'synthetic-loopback-key'});
  const runner=new NativeTranslationRunner(directory,spec=>{const child=new ProcessSupervisor({...spec,args:runtime==='codex'?['-c',`model_providers.translation_fixture={name="Fixture",base_url="${base}",wire_api="responses",requires_openai_auth=false}`,'-c','features.remote_models=false',...spec.args]:spec.args});const write=child.write.bind(child);child.write=message=>write(message.method==='thread/start'?{...message,params:{...message.params,modelProvider:'translation_fixture'}}:message);child.on('diagnostic',value=>console.error('SYNTHETIC DIAGNOSTIC',value));return child;});
  const before=requests.length;
  try{
   const result=await runner.run({runtime,executable,env,model:'fixture-model'},{instructions:'Translate the input only. No tools.',input:'Synthetic input.',profile:{...initialState().translation,model:'fixture-model'},signal:AbortSignal.timeout(30000)});
   assert.equal(result.text,'Synthetic translated text.');assert.equal(result.counts.inputTokens,100);assert.equal(result.counts.outputTokens,20);assert.equal(result.counts.cacheReadTokens,60);
   const sent=requests.slice(before);assert.equal(sent.length,1);const tools=sent[0].body.tools??[];assert.deepEqual(tools,[],'Translation must expose no upstream tools');
   assert.deepEqual(await readdir(path.join(directory,'translation-runs')),[]);checks.push({runtime,requests:sent.length,toolCount:tools.length,counts:result.counts});console.log('PASS '+runtime+' installed CLI, one loopback request, no tools, usage and cleanup');
  }finally{await runner.dispose();await rm(directory,{recursive:true,force:true});}
 }
 await writeFile(path.join(root,'report.json'),JSON.stringify({checks,realModelCalls:0},null,2));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
