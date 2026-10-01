import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { zstdDecompressSync, gunzipSync } from 'node:zlib';
import { ProcessSupervisor } from '../services/remote-supervisor/index.ts';
import { CodexRpcClient } from '../packages/runtime-codex/index.ts';
import { attachNativeObservation } from '../apps/desktop/host/native-observation.ts';
import { WorkspaceGeneratedImages } from '../apps/desktop/host/generated-images.ts';
import { AttachmentStore } from '../apps/desktop/host/attachments.ts';
import { initialState } from '../apps/desktop/host/store.ts';
import { CODEX_IMAGE_FRAME_BYTES } from '../packages/generated-images/types.ts';

const executable=process.env.AWB_QA_CODEX;
assert.ok(executable,'Supply an explicit installed Codex executable.');
const output=path.resolve(process.env.AWB_IMAGE_NATIVE_QA??'build/qa/generated-images/native');
const home=path.join(output,'native-'+Date.now()),workspace=path.join(output,'workspace-'+Date.now());
await mkdir(home,{recursive:true});await mkdir(workspace,{recursive:true});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const errors=[],requests=[],checks=[];let step=0,completed,done=false;
const sse=(res,events)=>{res.writeHead(200,{'content-type':'text/event-stream'});for(const event of events)res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);res.end();};
const server=createServer(async(req,res)=>{
 try{const chunks=[];for await(const chunk of req)chunks.push(chunk);let raw=Buffer.concat(chunks);if(req.headers['content-encoding']==='zstd')raw=zstdDecompressSync(raw);else if(req.headers['content-encoding']==='gzip')raw=gunzipSync(raw);const body=raw.length?JSON.parse(raw.toString()):{};requests.push({url:req.url,method:req.method});
  if(req.url?.endsWith('/images/generations')){res.setHeader('content-type','application/json');res.end(JSON.stringify({created:1,background:'opaque',data:[{b64_json:png}]}));return;}
  if(req.url?.includes('/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[]}));return;}
  if(req.url?.endsWith('/responses')){
   if(step++===0){assert.ok(JSON.stringify(body.tools).includes('imagegen'),'The real native request must expose image generation.');checks.push('actual native request exposes image generation');const item={type:'function_call',id:'call-image',call_id:'call-image',name:'imagegen',namespace:'image_gen',arguments:JSON.stringify({prompt:'A blue circle on white.'})};sse(res,[{type:'response.created',response:{id:'response-one'}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'response-one',status:'completed',output:[item],usage:{input_tokens:100,output_tokens:10,total_tokens:110}}}]);}
   else{assert.ok(JSON.stringify(body.input).includes(png),'Native image result remains in model history.');const item={type:'message',id:'done',role:'assistant',status:'completed',content:[{type:'output_text',text:'IMAGE_DELIVERY_COMPLETE'}]};sse(res,[{type:'response.created',response:{id:'response-two'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'response-two',status:'completed',output:[item],usage:{input_tokens:200,output_tokens:10,total_tokens:210}}}]);}return;
  }res.writeHead(404).end('{}');
 }catch(error){errors.push(String(error));res.writeHead(500).end('{}');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
await writeFile(path.join(home,'config.toml'),`model = "gpt-5.4"\nmodel_provider = "image-fixture"\ncli_auth_credentials_store = "file"\nchatgpt_base_url = "${url}"\ncheck_for_update_on_startup = false\n[features]\nmemories = false\n[model_providers.image-fixture]\nname = "OpenAI"\nbase_url = "${url}/api/codex"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\n`);
// Synthetic login only; never read the user's native home, token or chat history.
const token=Buffer.from(JSON.stringify({email:'fixture@example.invalid','https://api.openai.com/auth':{chatgpt_account_id:'fixture',chatgpt_plan_type:'plus'},exp:4102444800})).toString('base64url');
await writeFile(path.join(home,'auth.json'),JSON.stringify({auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{id_token:`e30.${token}.fixture`,access_token:'synthetic-access',refresh_token:'synthetic-refresh',account_id:'fixture'},last_refresh:new Date().toISOString()}));
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:home,TMP:home,HOME:home,USERPROFILE:home,CODEX_HOME:home,NO_PROXY:'127.0.0.1,localhost'};
const version=spawnSync(executable,['--version'],{env,encoding:'utf8',windowsHide:true}).stdout.trim();
const transport=new ProcessSupervisor({executable,args:['app-server','--listen','stdio://'],env,cwd:workspace,maxFrameBytes:CODEX_IMAGE_FRAME_BYTES,lifetimeMs:90000});
const rpc=new CodexRpcClient(transport,'image-session',30000);rpc.on('fault',e=>errors.push(String(e)));transport.on('diagnostic',()=>{});
const state=initialState();state.modelConnections=[];
state.sessions=[{id:'image-session',title:'Fixture',projectId:null,projectPath:workspace,status:'running',messages:[],binding:{runtime:'codex',provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'direct-api',modelConnectionId:'fixture',modelMappingId:'fixture'}}];
const attachments=new AttachmentStore(path.join(output,'attachments'),undefined,[],undefined,{nativePaths:true});
const observer=attachNativeObservation('image-session',rpc,()=>structuredClone(state),async fn=>fn(state),{service:new WorkspaceGeneratedImages(attachments)});
rpc.on('raw',frame=>{if(frame.value.method==='item/completed'&&frame.value.params?.item?.type==='imageGeneration')completed=frame.value.params.item;if(frame.value.method==='turn/completed')done=true;});
try{
 await transport.start();await rpc.initialize();const result=await rpc.request('thread/start',{cwd:workspace,model:'gpt-5.4',approvalPolicy:'never',sandbox:'danger-full-access'});state.sessions[0].binding.nativeSessionId=result.thread.id;rpc.bindRootThread(result.thread.id);
 await rpc.request('turn/start',{threadId:result.thread.id,input:[{type:'text',text:'Generate an image of a blue circle.'}]});
 const until=Date.now()+60000;while(!done&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,40));await observer.flush();assert.ok(done,JSON.stringify({requests,errors}));assert.equal(completed?.result,png,JSON.stringify(completed));
 const delivery=state.sessions[0].activities.find(a=>a.category==='image-generation')?.imageDelivery;assert.equal(delivery?.status,'saved',JSON.stringify(delivery));assert.deepEqual(await readFile(delivery.attachment.path),Buffer.from(png,'base64'));assert.equal((await attachments.views([delivery.attachment.id]))[0].mime,'image/png');
 checks.push('actual native completion automatically saves and previews local workspace PNG without transfer instructions');
 assert.ok(completed.savedPath.startsWith(home));assert.deepEqual(await readFile(completed.savedPath),Buffer.from(png,'base64'));checks.push('installed native app-server confirms its own PNG copy exists before completion; zero writes is not claimed');
 assert.equal(JSON.stringify(state).includes(png),false);assert.equal(step,2);assert.deepEqual(errors,[]);
 console.log(checks.map(v=>'PASS '+v).join('\n'));
}finally{await transport.stop('synthetic-image-test-complete');await observer.dispose().catch(e=>errors.push(String(e)));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'report.json'),JSON.stringify({version,checks,errors,requests,scope:'Real native CLI with synthetic ChatGPT login and loopback responses; no real account, commercial model, SSH or VPS task.'},null,2));}
