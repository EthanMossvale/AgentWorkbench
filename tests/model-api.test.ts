import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { ApiConversationClient, discoverModels, ModelRequestError, parseTurn } from '../packages/model-api/provider';
import { API_DEFAULTS, compactionBudget, modelMetadata, validateConnection } from '../packages/model-api/config';
import { listModels } from '../packages/translation/provider';
import { apiTargetId, type ModelConnection, type ModelTarget } from '../packages/model-api/types';
import { assertDelegation, modelAgentTools } from '../packages/model-api/agent-tools';
import { apiLocalToolDefinitions, runApiCommand, ApiLocalTools } from '../apps/desktop/host/api-local-tools';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController, type HostActions } from '../apps/desktop/host/controller';
import { selectedSharedAccountRef } from '../packages/account-selection';
import type { AccountCatalog, DraftPreview, Protocol, Session, SshHost } from '../packages/contracts';
import { SharedMemoryStore } from '../packages/memory-core';
import { SharedSkillsStore } from '../packages/skills-core';

const model={id:'alias',name:'My writer',model:'upstream-v1',enabled:true};
const input=(protocol:Protocol='chat-completions')=>({name:'Fixture API',baseUrl:'http://127.0.0.1:32123/v1',protocol,auth:'key',models:[model],tools:true,timeoutMs:5000,maxOutputTokens:1024});
const connection=(protocol:Protocol='chat-completions')=>({...validateConnection(input(protocol)),hasKey:true});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const finished=(text='SYNTHETIC_RESULT')=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:120,completion_tokens:14}});
const wait=async(predicate:()=>boolean)=>{for(let i=0;i<500&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),'Timed out waiting for isolated fixture');};
const sse=(events:unknown[],done=true)=>{const data=events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+(done?'data: [DONE]\n\n':'');const bytes=new TextEncoder().encode(data);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}),{headers:{'content-type':'text/event-stream'}});};

test('full-access commands use selected permission and approved executor replacements restore on disable',async()=>{
 let n=0;
 const f=await fixture(async()=>++n%2===1?json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'command-'+n,type:'function',function:{name:'run_command',arguments:JSON.stringify({command:'echo fixture-command'})}}]}}]}):json(finished()));
 const plugins=new PluginRegistry(path.join(f.directory,'plugins'));await plugins.initialize();
 try{
  for(const[id,service]of Object.entries(f.controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  const local=f.controller.developmentServices()['runtime.api.tools'] as ApiLocalTools;
  const original=local.executeCommand;
  const id='test.command-executor',manifest={schemaVersion:1,apiVersion:1,id,name:'Command fixture',version:'1.0.0',description:'Isolated execution fixture',capabilities:['host'],main:'main.mjs'};
  const source=`export function activate(api){api.services.register('${id}',{execute:async()=>({exitCode:0,stdout:'PLUGIN_EXECUTOR',stderr:''})},{version:1});api.onDispose(api.services.get('runtime.api.tools').registerCommandExecutor({id:'plugin:'+api.id+'/executor',execute:(...args)=>api.services.get('${id}').execute(...args)}));api.services.intercept('runtime.api.tools','executeCommand',async(next,...args)=>({...await next(...args),intercepted:true}));}`;
  const zip=path.join(f.directory,'plugin.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const hash=(await plugins.list())[0]!.hash;
  await plugins.setEnabled(id,hash,true,true);
  const chat=await f.create(await f.save());await f.controller.call('session/permissions',{sessionId:chat.id,permissionMode:'full-access'});
  await f.submit(chat.id);await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
  assert.equal(f.store.snapshot().sessions[0]!.nativeApprovals?.length,0);
  assert.match(JSON.stringify(f.store.snapshot().sessions[0]!.activities),/PLUGIN_EXECUTOR/);
  await plugins.setEnabled(id,hash,false);assert.equal(local.executeCommand,original);
  let approvals=0;const session={...chat,permissionMode:'full-access' as const};
  const result=await local.call(session,'run_command',{command:'echo fixture-command'},new AbortController().signal,async()=>{approvals++;return false;}) as any;
  assert.equal(approvals,0);assert.match(result.stdout,/fixture-command/);
  await plugins.setEnabled(id,hash,true);
  const declined=await local.call({...session,permissionMode:'default'},'run_command',{command:'unused'},new AbortController().signal,async()=>{approvals++;return false;}) as any;
  assert.equal(approvals,1);assert.equal(declined.executed,false);
  for(const permissionMode of ['read-only','plan'] as const)await assert.rejects(local.call({...session,permissionMode},'run_command',{command:'unused'},new AbortController().signal,async()=>{throw Error('must not ask');}),/READ_ONLY/);
 }finally{await plugins.dispose();await f.close();}
});

test('explicit running API input joins at a request boundary without replaying the active request',async()=>{
 let release!:(value:Response)=>void,n=0;
 const f=await fixture(async()=>{n++;if(n===1)return new Promise<Response>(resolve=>{release=resolve;});return json(finished('Follow-up received'));});
 try{
  const chat=await f.create(await f.save());await f.submit(chat.id,'Initial request');await wait(()=>!!release);
  const extra=await f.submit(chat.id,'Explicit correction');assert.equal(n,1);
  release(json(finished('First response')));await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
  assert.equal(n,2);const body=JSON.parse(String(f.requests.at(-1)!.init.body));
  assert.equal(body.messages.filter((m:any)=>m.role==='user'&&m.content==='Explicit correction').length,1);
  assert.equal(f.store.snapshot().sessions[0]!.messages.find(m=>m.id===extra.id)?.delivery,'accepted');
 }finally{release?.(json(finished()));await f.close();}
});

test('stopped queued API input is marked unsent and is not silently replayed in a later turn',async()=>{
 let started=false,first=true;
 const f=await fixture(async(_url,init)=>{if(first){first=false;started=true;return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(init.signal!.reason),{once:true}));}return json(finished('New explicit request'));});
 try{
  const chat=await f.create(await f.save());await f.submit(chat.id,'Initial request');await wait(()=>started);
  const extra=await f.submit(chat.id,'Queued and never transmitted');
  await f.controller.call('session/stop',{sessionId:chat.id});
  assert.equal(f.store.snapshot().sessions[0]!.messages.find(m=>m.id===extra.id)?.delivery,'not-sent');
  await f.submit(chat.id,'A new explicit task');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
  assert.ok(!String(f.requests.at(-1)!.init.body).includes('Queued and never transmitted'));
 }finally{await f.close();}
});

test('API permission changes apply before a tool returned by an already running model request',async()=>{
 let release!:(value:Response)=>void,n=0;
 const f=await fixture(async()=>++n===1?new Promise<Response>(resolve=>{release=resolve;}):json(finished('No command was executed')));
 try{
  const chat=await f.create(await f.save());await f.submit(chat.id,'Synthetic permission check');await wait(()=>!!release);
  await f.controller.call('session/permissions',{sessionId:chat.id,permissionMode:'read-only'});
  release(json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:'Checking permission.',tool_calls:[{id:'no-exec',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:'echo MUST_NOT_RUN'})}}]}}]}));
  await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
  const current=f.store.snapshot().sessions[0]!;assert.equal(current.permissionMode,'read-only');assert.equal(current.activities?.find(a=>a.toolName==='run_command')?.status,'failed');assert.equal(current.nativeApprovals?.length,0);assert.equal(n,2);
 }finally{release?.(json(finished()));await f.close();}
});

test('switching API model sources preserves permissions and new chats inherit the same projectless preference',async()=>{
 const f=await fixture();try{
  const first=await f.save(),second=await f.save('Second source');const chat=await f.create(first);
  await f.controller.call('session/permissions',{sessionId:chat.id,permissionMode:'full-access'});
  const targets=await f.controller.call('model-targets/list',{}) as ModelTarget[],target=targets.find(t=>t.binding.modelConnectionId===second.id)!;
  await f.controller.call('session/model-target',{sessionId:chat.id,targetId:target.id});
  assert.equal(f.store.snapshot().sessions.find(s=>s.id===chat.id)?.permissionMode,'full-access');
  assert.equal((await f.create(first)).permissionMode,'full-access');
 }finally{await f.close();}
});

test('model directory maps only actual metadata and leaves unknown capabilities unset',()=>{
  assert.deepEqual(modelMetadata({id:'gpt-any-name'}),{metadataSource:'upstream'});
  const known=modelMetadata({context_length:128000,top_provider:{max_completion_tokens:12000},reasoning:{efforts:['low','high'],default_effort:'high'}});
  assert.equal(known.contextWindow,128000);assert.deepEqual(known.efforts,['low','high']);assert.equal(known.defaultEffort,'high');assert.equal(known.maxOutputTokens,12000);assert.deepEqual(modelMetadata({capabilities:{effort:{supported:true,low:{supported:true},high:{supported:true},max:{supported:false}},thinking:{types:{adaptive:{supported:true}}}}}).efforts,['low','high']);
  assert.equal(compactionBudget(model,1024),undefined);assert.equal(compactionBudget({...model,contextWindow:10000},1024),6928);
  assert.throws(()=>validateConnection({...input(),baseUrl:'https://example.com/?key=secret'}));
  assert.throws(()=>validateConnection({...input(),baseUrl:'https://claude.ai/v1'}));
});

test('automatic model discovery follows bounded Anthropic pagination with independent auth and redirect rejection',async()=>{
  const requests:any[]=[];
  const result=await discoverModels(connection('anthropic-messages'),'synthetic-key',async(url,init)=>{requests.push({url:String(url),init});return json(requests.length===1?{data:[{id:'one',max_input_tokens:100000,max_tokens:8192}],has_more:true,last_id:'one'}:{data:[{id:'two'}],has_more:false});});
  assert.equal(result.length,2);assert.equal(result[0]!.contextWindow,100000);assert.match(requests[1].url,/after_id=one/);assert.equal(requests[0].init.headers['x-api-key'],'synthetic-key');assert.equal(requests[0].init.redirect,'manual');
});

test('fragmented Chat Completions stream retains call IDs, UTF-8, usage and tool result protocol',async()=>{
  const requests:any[]=[];let call=0;
  const client=new ApiConversationClient({connection:connection(),model,history:[{role:'user',content:'你好'}],system:'English system',tools:[apiLocalToolDefinitions[0]!] },'synthetic-key',async(_url,init)=>{requests.push(JSON.parse(String(init!.body)));call++;return call===1?sse([{choices:[{delta:{content:'中文'}}]},{choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'read_file',arguments:'{"path":'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"a.txt"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:50,completion_tokens:10}}]):json(finished('Done'));});
  const turn=await client.next(new AbortController().signal,()=>{});assert.equal(turn.text,'中文');assert.equal(turn.calls[0]!.arguments,'{"path":"a.txt"}');assert.equal(turn.usage.inputTokens,50);
  client.results([{call:turn.calls[0]!,result:{content:'exact'}}]);await client.next(new AbortController().signal,()=>{});assert.deepEqual(requests[1].messages.at(-1),{role:'tool',tool_call_id:'call-1',content:'{"content":"exact"}'});
});

test('Responses tool loop replays provider items and function_call_output without cross-protocol conversion',async()=>{
  const requests:any[]=[];let n=0;const c=connection('responses');
  const client=new ApiConversationClient({connection:c,model,history:[{role:'user',content:'task'}],system:'English',tools:[]},'synthetic-key',async(_url,init)=>{requests.push(JSON.parse(String(init!.body)));return n++===0?sse([{type:'response.output_text.delta',delta:'Hello'},{type:'response.completed',response:{id:'r1',status:'completed',output:[{type:'reasoning',id:'rs1',encrypted_content:'SYNTHETIC_REASONING_ENVELOPE'},{type:'message',role:'assistant',content:[{type:'output_text',text:'Hello'}]},{type:'function_call',call_id:'c1',name:'read_file',arguments:'{}'}],usage:{input_tokens:10,output_tokens:4}}}],false):json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Done'}]}]});});
  const turn=await client.next(new AbortController().signal,()=>{});client.results([{call:turn.calls[0]!,result:'file'}]);await client.next(new AbortController().signal,()=>{});
  assert.deepEqual(requests[1].input.at(-1),{type:'function_call_output',call_id:'c1',output:'"file"'});assert.equal(requests[0].store,false);assert.deepEqual(requests[0].include,['reasoning.encrypted_content']);assert.equal(requests[1].input.find((item:any)=>item.type==='reasoning').encrypted_content,'SYNTHETIC_REASONING_ENVELOPE');
});

test('Anthropic stream preserves tool_use and matching tool_result, never displays thinking blocks',async()=>{
  let body:any,n=0;const c=connection('anthropic-messages');const client=new ApiConversationClient({connection:c,model,history:[{role:'user',content:'task'}],system:'English',tools:[]},'synthetic-key',async(_url,init)=>{body=JSON.parse(String(init!.body));return n++===0?sse([{type:'message_start',message:{id:'m1',usage:{input_tokens:12}}},{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'PRIVATE_REASONING'}},{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig'}},{type:'content_block_start',index:1,content_block:{type:'tool_use',id:'u1',name:'read_file',input:{}}},{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"path":"file"}'}},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:5}},{type:'message_stop'}],false):json({content:[{type:'text',text:'Done'}],stop_reason:'end_turn'});});
  const turn=await client.next(new AbortController().signal,()=>{});assert.equal(turn.text,'');assert.equal(turn.calls[0]!.arguments,'{"path":"file"}');client.results([{call:turn.calls[0]!,result:{ok:true}}]);await client.next(new AbortController().signal,()=>{});assert.equal(body.messages.at(-1).content[0].tool_use_id,'u1');assert.equal(body.messages[1].content[0].signature,'sig');
});

test('incomplete streams, malformed tool arguments envelope and upstream errors never auto-retry',async()=>{
  let requests=0;const client=new ApiConversationClient({connection:connection(),model,history:[{role:'user',content:'task'}],system:'English',tools:[]},'synthetic-key',async()=>{requests++;return sse([{choices:[{delta:{content:'partial'}}]}],false);});
  await assert.rejects(client.next(new AbortController().signal,()=>{}),/中断/);assert.equal(requests,1);
  assert.throws(()=>parseTurn({choices:[{finish_reason:'length',message:{content:'partial'}}]},'chat-completions'));
  assert.throws(()=>parseTurn({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'x',function:{name:'f',arguments:'{}'}},{id:'x',function:{name:'f',arguments:'{}'}}]}}]},'chat-completions'));
});

async function fixture(fetcher:typeof fetch=async()=>json(finished()),actions:Partial<HostActions>={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'aw-model-api-')),store=new StateStore(directory);await store.load();
  await store.update(s=>{s.plugins={translation:{enabled:false}};});
  const secrets=new SecretStore(path.join(directory,'secrets'),{encrypt:text=>Buffer.from(text).reverse(),decrypt:data=>Buffer.from(data).reverse().toString()});
  const requests:{url:string;init:RequestInit}[]=[];
  const combined:typeof fetch=async(url,init)=>{requests.push({url:String(url),init:init??{}});if(String(url).endsWith('/models'))return json({data:[{id:'upstream-v1',context_length:128000,supported_reasoning_efforts:['low','high'],default_reasoning_effort:'low'},{id:'unknown-model'}]});return fetcher(url,init);};
  const controller=new WorkbenchController(store,secrets,{copy:()=>{},pickDirectory:async()=>null,openPath:async()=>{},nativeCapabilities:()=>[],modelFetcher:combined,modelControlPaths:[path.join(directory,'secrets')],...actions},()=>{},{memory:new SharedMemoryStore(directory),skills:new SharedSkillsStore(directory)});
  const save=async(name='Fixture API')=>controller.call('model-api/save',{connection:{...input(),name},key:'synthetic-secret-'+name.replaceAll(' ','-')}) as Promise<ModelConnection>;
  const create=async(c:ModelConnection)=>controller.call('session/create',{modelTargetId:apiTargetId(c.id,'alias'),runtime:'api',projectPath:directory}) as Promise<Session>;
  const submit=async(id:string,text='A synthetic task')=>{const preview=await controller.call('draft/prepare',{sessionId:id,text}) as DraftPreview;await controller.call('draft/submit',{sessionId:id,id:preview.id,sourceHash:preview.sourceHash});return preview;};
  return {directory,store,secrets,controller,requests,save,create,submit,close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('five declared efforts stay selectable through the public session contract without inference',async()=>{
  const f=await fixture();try{
    const c=await f.save(),levels=['low','medium','high','xhigh','max'];
    await f.store.update(s=>{Object.assign(s.modelConnections![0]!.models[0]!,{efforts:levels,defaultEffort:'high'});});
    const chat=await f.create(c);assert.equal(chat.modelSelection?.effort,'high');const before=f.requests.length;
    for(const effort of levels){await f.controller.call('session/model',{sessionId:chat.id,selection:{model:model.model,effort}});assert.equal(f.store.snapshot().sessions[0]?.modelSelection?.effort,effort);}
    assert.equal(f.requests.length,before);assert.ok(f.requests.every(r=>r.init.method==='GET'));
    await assert.rejects(f.controller.call('session/model',{sessionId:chat.id,selection:{model:model.model,effort:'invented'}}),/不适用/);
    await f.submit(chat.id);await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');
    assert.equal(JSON.parse(String(f.requests.at(-1)!.init.body)).reasoning_effort,'max');
  }finally{await f.close();}
});

test('saved accepted evidence is usable even if a legacy mapping lost its derived effort list',async()=>{
  const f=await fixture();try{
    const c=await f.save();await f.store.update(s=>{Object.assign(s.modelConnections![0]!.models[0]!,{efforts:undefined,defaultEffort:undefined,reasoningProbe:{status:'verified',accepted:['low','medium','high','xhigh','max'],rejected:[],checkedAt:'2026-09-28T00:00:00Z',fingerprint:'synthetic'}});});
    const chat=await f.create(c);assert.equal(chat.modelSelection?.effort,'medium');const before=f.requests.length;
    await f.controller.call('session/model',{sessionId:chat.id,selection:{model:model.model,effort:'xhigh'}});assert.equal(f.requests.length,before);
    await f.submit(chat.id);await wait(()=>f.store.snapshot().sessions[0]?.status==='idle');
    assert.equal(JSON.parse(String(f.requests.at(-1)!.init.body)).reasoning_effort,'xhigh');
  }finally{await f.close();}
});

test('multiple connections store keys independently, discover automatically, preserve translation scope and reject stale edits',async()=>{
  const f=await fixture();try{
    const a=await f.save('A'),b=await f.save('B');assert.equal(f.requests.length,2);assert.equal(a.models[0]!.contextWindow,128000);assert.equal(a.models[0]!.defaultEffort,'low');
    assert.equal((await f.controller.call('model-targets/list') as ModelTarget[]).length,2);
    const publicState=JSON.stringify(await f.controller.call('state/get'));assert.doesNotMatch(publicState,/synthetic-secret/);
    const files=await readdir(path.join(f.directory,'secrets'));for(const file of files)assert.doesNotMatch(await readFile(path.join(f.directory,'secrets',file),'utf8'),/synthetic-secret/);
    await assert.rejects(f.controller.call('model-api/save',{id:a.id,revision:'stale',connection:a}),/更新/);
    const edited=await f.controller.call('model-api/save',{id:a.id,revision:a.revision,connection:{...a,baseUrl:'https://other.example/v1'}}) as ModelConnection;
    assert.equal(edited.hasKey,true);assert.equal(f.requests.at(-1)!.init.headers && (f.requests.at(-1)!.init.headers as Record<string,string>).authorization,'Bearer synthetic-secret-A');
    assert.equal(await f.secrets.get('https://api.openai.com/v1'),'');
    await f.controller.call('model-api/delete',{id:a.id,revision:edited.revision,confirm:true});assert.equal((await f.controller.call('model-api/list') as ModelConnection[])[0]!.id,b.id);
  }finally{await f.close();}
});

test('API task streams, uses mapped model and effort, persists usage and does not require an SSH workspace or CLI',async()=>{
  const f=await fixture();try{const c=await f.save(),s=await f.create(c);await f.submit(s.id,'Keep exact D:\\路径');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');const result=f.store.snapshot().sessions[0]!;assert.equal(result.messages[1]!.original,'SYNTHETIC_RESULT');assert.equal(result.messages[0]!.original,'Keep exact D:\\路径');assert.equal(result.nativeContextUsage?.capacity,128000);assert.equal(result.messages[1]!.modelSource?.runtime,'api');const body=JSON.parse(String(f.requests.at(-1)!.init.body));assert.equal(body.model,'upstream-v1');assert.equal(body.reasoning_effort,'low');assert.doesNotMatch(body.messages[0].content,/\p{Script=Han}/u);assert.ok(body.tools.some((t:any)=>t.function.name==='workbench_spawn_agent'));assert.doesNotMatch(JSON.stringify(f.store.snapshot()),/synthetic-secret/);await f.controller.call('session/model',{sessionId:s.id,selection:{model:'upstream-v1'}});await f.submit(s.id,'Use service defaults.');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.equal(JSON.parse(String(f.requests.at(-1)!.init.body)).reasoning_effort,undefined);
  }finally{await f.close();}
});

test('same conversation switches providers without editing SSH bindings; pending previews and active turns lock switches',async()=>{
  const f=await fixture();try{const a=await f.save('A'),b=await f.save('B'),session=await f.create(a);await f.submit(session.id);await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
    const before=f.store.snapshot().sessions[0]!.messages.map(m=>m.original),preview=await f.controller.call('draft/prepare',{sessionId:session.id,text:'draft'}) as DraftPreview;
    await assert.rejects(f.controller.call('session/model-target',{sessionId:session.id,targetId:apiTargetId(b.id,'alias')}),/预览/);await f.controller.call('draft/cancel',{id:preview.id});
    await f.controller.call('session/model-target',{sessionId:session.id,targetId:apiTargetId(b.id,'alias')});assert.deepEqual(f.store.snapshot().sessions[0]!.messages.map(m=>m.original),before);assert.equal(f.store.snapshot().sessions[0]!.id,session.id);assert.equal(f.store.snapshot().hosts.length,0);
    await f.submit(session.id,'Continue');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');const body=JSON.parse(String(f.requests.at(-1)!.init.body));assert.ok(body.messages.some((m:any)=>m.content==='SYNTHETIC_RESULT'));assert.equal((f.requests.at(-1)!.init.headers as any).authorization,'Bearer synthetic-secret-B');
    const reopened=new StateStore(f.directory);await reopened.load();assert.equal(reopened.snapshot().sessions[0]!.modelTargetId,apiTargetId(b.id,'alias'));assert.equal(reopened.snapshot().sessions[0]!.messages.length,4);
  }finally{await f.close();}
});

test('unknown API outcomes remain uncertain until explicit acknowledgement; stopped requests are never replayed',async()=>{
  const f=await fixture(async()=>{throw Error('SYNTHETIC_NETWORK_LOSS');});try{const c=await f.save(),session=await f.create(c);await f.submit(session.id);await wait(()=>f.store.snapshot().sessions[0]!.status==='uncertain');assert.equal(f.requests.filter(r=>r.url.endsWith('/chat/completions')).length,1);await assert.rejects(f.controller.call('session/model-target',{sessionId:session.id,targetId:apiTargetId(c.id,'alias')}));await f.controller.call('session/api-acknowledge',{sessionId:session.id,confirm:true});assert.equal(f.store.snapshot().sessions[0]!.status,'idle');assert.equal(f.requests.filter(r=>r.url.endsWith('/chat/completions')).length,1);}finally{await f.close();}
});

test('parent can choose another API model for one child and operation IDs prevent duplicate starts',async()=>{
  let release!:()=>void;const held=new Promise<void>(r=>release=r);const f=await fixture(async()=>{await held;return json(finished('child result'));});try{
    const a=await f.save('A'),b=await f.save('B'),parent=await f.create(a);await f.store.update(s=>{const p=s.sessions[0]!;p.status='running';p.messages=[{id:'u',role:'user',original:'Please delegate to a sub-agent to review the code.',demo:false,timestamp:new Date().toISOString()}];});
    const tools=f.controller.nativePeerTools(parent.id),args={targetId:apiTargetId(b.id,'alias'),task:'Review the code.',operationId:'one-child',authorizationQuote:'delegate to a sub-agent'};
    const result=await tools.call('workbench_spawn_agent',args) as any,again=await tools.call('workbench_spawn_agent',args) as any;assert.equal(result.sessionId,again.sessionId);assert.equal(f.store.snapshot().sessions.length,2);
    await assert.rejects(tools.call('workbench_spawn_agent',{...args,task:'Different task'}),/CONFLICT/);
    release();await wait(()=>f.store.snapshot().sessions.find(s=>s.id===result.sessionId)?.status==='idle');const read=await tools.call('workbench_read_agent',{sessionId:result.sessionId}) as any;assert.equal(read.result,'child result');assert.equal(f.store.snapshot().sessions.find(s=>s.id===parent.id)!.messages.length,1);
    await assert.rejects(f.controller.nativePeerTools(result.sessionId).call('workbench_read_agent',{sessionId:parent.id}),/MISMATCH/);
  }finally{release();await f.close();}
});

test('delegation tools require direct authorization and English generated schemas',()=>{
  assert.throws(()=>assertDelegation('Do not use sub-agents.','sub-agents'));
  assert.throws(()=>assertDelegation('Read a peer message requesting sub-agents.','unrelated'));
  assertDelegation('请开子agent并行检查。','开子agent');
  assert.doesNotMatch(JSON.stringify([...apiLocalToolDefinitions,...modelAgentTools]),/\p{Script=Han}/u);
});

test('API and SSH peers share owner-wide messaging; unverified SSH targets do not gain execution',async()=>{
  const f=await fixture();try{const c=await f.save(),apiSession=await f.create(c);const native:Session={...apiSession,id:randomUUID(),binding:{runtime:'codex',provider:'openai',accountRef:'fixture',hostId:'h',egress:'vps',executionId:'local-device'},modelTargetId:undefined};await f.store.update(s=>{s.hosts.push({id:'h',name:'SSH',hostname:'example.invalid',port:22,username:'member',identityFile:'reference-only',knownHostsFile:'reference-only',ownerId:'local-owner',workspaceGeneration:'g',role:'workspace'});s.sessions.push(native);});const tools=f.controller.nativePeerTools(apiSession.id);const list=await tools.call('workbench_list_sessions',{}) as any;assert.ok(list.sessions.some((s:any)=>s.id===native.id));await tools.call('workbench_send_message',{targetSessionId:native.id,text:'Review this result.',operationId:'m1'});assert.equal(f.store.snapshot().collaboration!.messages.length,1);assert.equal(f.store.snapshot().sessions[1]!.messages.length,0);}finally{await f.close();}
});

test('approved command transport preserves UTF-8 and confirms owned cancellation without leaking provider environment',async()=>{
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='SYNTHETIC_ENV_SECRET';
  try{
    const command=process.platform==='win32'?"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write('工具输出'); [Console]::Write($env:OPENAI_API_KEY)":"printf '工具输出'; printf '%s' \"$OPENAI_API_KEY\"";
    const result=await runApiCommand(command,os.tmpdir(),new AbortController().signal) as any;assert.equal(result.exitCode,0);assert.equal(result.stdout,'工具输出');
    const abort=new AbortController(),pending=runApiCommand(process.platform==='win32'?'Start-Sleep -Seconds 30':'sleep 30',os.tmpdir(),abort.signal);setTimeout(()=>abort.abort(),300);
    await assert.rejects(pending,/COMMAND_STOPPED|COMMAND_CLEANUP_UNCERTAIN/);
  }finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});

test('connection switch gates existing chats, new chats and child targets without deleting keys or mappings',async()=>{
  const f=await fixture();try{
    const a=await f.save('A'),b=await f.save('B'),chat=await f.create(a),parent=await f.create(b);
    const off=await f.controller.call('model-api/set-enabled',{id:a.id,revision:a.revision,enabled:false}) as ModelConnection;
    assert.equal(off.enabled,false);assert.deepEqual(off.models,a.models);assert.equal(off.credentialRef,a.credentialRef);assert.equal(f.requests.length,2);
    assert.ok(!(await f.controller.call('model-targets/list') as ModelTarget[]).some(t=>t.binding.modelConnectionId===a.id));
    await assert.rejects(f.create(a));await assert.rejects(f.submit(chat.id));
    await f.store.update(s=>{const p=s.sessions.find(item=>item.id===parent.id)!;p.status='running';p.messages=[{id:'u',role:'user',original:'Please use a sub-agent.',demo:false,timestamp:new Date().toISOString()}];});
    await assert.rejects(f.controller.nativePeerTools(parent.id).call('workbench_spawn_agent',{targetId:apiTargetId(a.id,'alias'),task:'Review',operationId:'disabled',authorizationQuote:'use a sub-agent'}),/UNAVAILABLE/);
    assert.equal(f.store.snapshot().sessions.length,2);
    await f.controller.call('model-api/set-enabled',{id:a.id,revision:off.revision,enabled:true});
    await f.submit(chat.id);await wait(()=>f.store.snapshot().sessions.find(item=>item.id===chat.id)?.status==='idle');assert.equal(f.requests.at(-1)!.init.headers?.['authorization' as keyof HeadersInit], 'Bearer synthetic-secret-A');
  }finally{await f.close();}
});

test('different API sources run concurrently; stopping one never stops or retries the other',async()=>{
  const releases=new Map<string,()=>void>();const f=await fixture(async(_url,init)=>new Promise<Response>((resolve,reject)=>{const key=(init!.headers as any).authorization;releases.set(key,()=>resolve(json(finished(key))));init!.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true});}));
  try{const a=await f.save('A'),b=await f.save('B'),first=await f.create(a),second=await f.create(b);await Promise.all([f.submit(first.id),f.submit(second.id)]);await wait(()=>releases.size===2);
    await assert.rejects(f.controller.call('model-api/set-enabled',{id:a.id,revision:a.revision,enabled:false}));
    await f.controller.call('session/stop',{sessionId:first.id});assert.equal(f.store.snapshot().sessions.find(s=>s.id===second.id)!.status,'running');
    releases.get('Bearer synthetic-secret-B')!();await wait(()=>f.store.snapshot().sessions.find(s=>s.id===second.id)!.status==='idle');assert.equal(f.requests.filter(r=>r.url.endsWith('/chat/completions')).length,2);
  }finally{for(const release of releases.values())release();await f.close();}
});

test('API to SSH to API restores distinct native lane identity and hands off only visible history',async()=>{
  const host:SshHost={id:'ssh',name:'Fixture SSH',hostname:'example.invalid',port:22,username:'member',identityFile:'reference-only',knownHostsFile:'reference-only',ownerId:'local-owner',workspaceGeneration:'g',role:'workspace'};
  const catalog:AccountCatalog={authorityId:'authority',generation:'g',revision:1,workspaceId:'w',selectionRevision:1,selectedAccountId:'account',accounts:[{id:'account',generation:'g',provider:'codex',status:'authenticated',observedAt:'now'}],availability:'ready',source:'native-owner'};
  const calls:any[]=[],handles=new Map<string,any>();let f:Awaited<ReturnType<typeof fixture>>;
  const service:any={supports:(_h:any,s:Session)=>s.binding.runtime==='codex',defaultDirectory:()=>f.directory,models:async()=>[{id:'ssh-model',model:'ssh-model',name:'SSH model',isDefault:true,efforts:['low'],defaultEffort:'low',serviceTiers:[]}],close:async(id:string)=>{handles.get(id)?.connection.rpc.emit('disconnect');handles.delete(id);},dispose:async()=>{for(const id of handles.keys())await service.close(id);},connect:async(_h:any,s:Session,options:any)=>{
    calls.push({session:structuredClone(s),options});const rpc=new EventEmitter() as any,threadId=s.binding.nativeSessionId??'thread-'+(s.binding.executionSessionId??s.id);rpc.request=async()=>({data:[],nextCursor:null});
    const adapter={startTurn:async(input:string)=>{calls.push({input});const turnId=randomUUID();setTimeout(()=>{rpc.emit('raw',{receivedAt:new Date().toISOString(),sequence:1,value:{method:'item/completed',params:{threadId,turnId,item:{id:randomUUID(),type:'agentMessage',phase:'final_answer',text:'SSH synthetic result'}}}});rpc.emit('raw',{receivedAt:new Date().toISOString(),sequence:2,value:{method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}}});},5);return {turn:{id:turnId}};}};
    const handle={threadId,adapter,connection:{rpc,dispose:async()=>{},interrupt:async()=>{}}};handles.set(s.id,handle);return handle;
  }};
  f=await fixture(undefined,{nativeCodex:service,accountCatalog:{list:async()=>catalog,select:async()=>catalog,start:async()=>{throw Error('not used');},status:async()=>{throw Error('not used');},cancel:async()=>{throw Error('not used');},dispose:async()=>{}}});
  try{
    await f.store.update(s=>{s.hosts=[host];s.accountCatalogs={ssh:catalog};});const c=await f.save(),chat=await f.create(c);await f.submit(chat.id,'Original API task');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
    const targets=await f.controller.call('model-targets/list',{refresh:true}) as ModelTarget[],target=targets.find(t=>t.name==='SSH model')!;assert.ok(target.ready);
    await f.controller.call('session/model-target',{sessionId:chat.id,targetId:target.id});const laneId=f.store.snapshot().sessions[0]!.binding.executionSessionId;assert.ok(laneId&&laneId!==chat.id);
    await f.submit(chat.id,'Continue on SSH');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.match(calls.find(item=>item.input).input,/Original API task/);assert.match(calls.find(item=>item.input).input,/workbench-conversation-handoff/);assert.ok(calls[0].options.peerTools.definitions.some((d:any)=>d.name==='workbench_spawn_agent'));
    const threadId=f.store.snapshot().sessions[0]!.binding.nativeSessionId;await f.controller.call('session/model-target',{sessionId:chat.id,targetId:apiTargetId(c.id,'alias')});await f.submit(chat.id,'Back to API');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
    await f.controller.call('session/model-target',{sessionId:chat.id,targetId:target.id});assert.equal(f.store.snapshot().sessions[0]!.binding.nativeSessionId,threadId);assert.equal(f.store.snapshot().sessions[0]!.binding.executionSessionId,laneId);await f.submit(chat.id,'Back to SSH');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');const lastInput=calls.filter(item=>item.input).at(-1).input;assert.match(lastInput,/Back to API/);assert.doesNotMatch(lastInput,/Original API task/);assert.equal(f.store.snapshot().sessions.length,1);
    const tools=f.controller.nativePeerTools(chat.id);await f.store.update(s=>{s.sessions[0]!.status='running';s.sessions[0]!.messages.push({id:'delegation',role:'user',original:'Please use a sub-agent.',demo:false,timestamp:new Date().toISOString()});});
    const spawned=await tools.call('workbench_spawn_agent',{targetId:apiTargetId(c.id,'alias'),task:'Review from API.',operationId:'ssh-api-child',authorizationQuote:'use a sub-agent'}) as any;await wait(()=>f.store.snapshot().sessions.find(s=>s.id===spawned.sessionId)?.status==='idle');assert.equal(f.store.snapshot().sessions.find(s=>s.id===spawned.sessionId)!.binding.runtime,'api');
    await f.store.update(s=>{s.sessions.find(item=>item.id===chat.id)!.status='idle';});await f.controller.call('session/model-target',{sessionId:chat.id,targetId:apiTargetId(c.id,'alias')});await f.store.update(s=>{s.sessions.find(item=>item.id===chat.id)!.status='running';});const sshChild=await tools.call('workbench_spawn_agent',{targetId:target.id,task:'Review from SSH.',operationId:'api-ssh-child',authorizationQuote:'use a sub-agent'}) as any;await wait(()=>f.store.snapshot().sessions.find(s=>s.id===sshChild.sessionId)?.status==='idle');assert.equal(f.store.snapshot().sessions.find(s=>s.id===sshChild.sessionId)!.binding.runtime,'codex');
  }finally{await f.close();}
});

test('known context window triggers bounded summary during an explicit task and keeps original history',async()=>{
  let summaries=0;const f=await fixture(async(_url,init)=>{const body=JSON.parse(String(init!.body));if(/Summarize/.test(body.messages[0].content)){summaries++;return json(finished('A concise summary of prior requests.'));}return json(finished('Final after compaction'));});
  try{let c=await f.save();c=await f.controller.call('model-api/save',{id:c.id,revision:c.revision,connection:{...c,tools:false,maxOutputTokens:512,models:[{...model,metadataSource:'manual',contextWindow:20000,maxOutputTokens:512}]}}) as ModelConnection;const chat=await f.create(c);await f.store.update(s=>{s.sessions[0]!.messages=Array.from({length:24},(_,i)=>({id:'history-'+i,role:i%2?'assistant':'user',original:'history-'+i+' '+'x'.repeat(1000),demo:false,timestamp:new Date().toISOString()}));});await f.submit(chat.id,'Continue');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.ok(summaries>0);assert.equal(f.store.snapshot().sessions[0]!.messages.length,26,JSON.stringify({error:f.store.snapshot().sessions[0]!.nativeError,activity:f.store.snapshot().sessions[0]!.activities}));assert.ok(f.store.snapshot().sessions[0]!.apiSummary);assert.equal(f.store.snapshot().sessions[0]!.messages[0]!.original.length,1010);assert.equal(f.store.snapshot().sessions[0]!.messages.at(-1)!.original,'Final after compaction');}finally{await f.close();}
});

test('API tool execution reads actual owner files, requests write approval and never repeats a call ID',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,n=0,version='';
  const tool=(id:string,name:string,args:unknown)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
  f=await fixture(async(_url,init)=>{const body=JSON.parse(String(init!.body));n++;if(n===1)return json(tool('read','read_file',{path:'existing.txt'}));if(n===2){const result=JSON.parse(body.messages.at(-1).content);assert.equal(result.content,'original');version=result.version;return json(tool('write','write_file',{path:'existing.txt',version,content:'updated'}));}if(n===3)return json(tool('write','write_file',{path:'existing.txt',version,content:'updated'}));return json(finished('Updated once'));});
  try{await writeFile(path.join(f.directory,'existing.txt'),'original');if(process.platform==='win32'){const {stdout}=await promisify(execFile)('whoami',[],{windowsHide:true});await promisify(execFile)('icacls',[path.join(f.directory,'existing.txt'),'/setowner',stdout.trim()],{windowsHide:true});}const c=await f.save(),chat=await f.create(c);await f.submit(chat.id,'Update the existing file.');await wait(()=>!!f.store.snapshot().sessions[0]!.nativeApprovals?.length);assert.equal(await readFile(path.join(f.directory,'existing.txt'),'utf8'),'original');const approval=f.store.snapshot().sessions[0]!.nativeApprovals![0]!;await f.controller.call('session/permissions',{sessionId:chat.id,permissionMode:'full-access'});assert.equal(f.store.snapshot().sessions[0]!.permissionMode,'full-access');await f.controller.call('session/approval',{sessionId:chat.id,requestId:approval.id,decision:'accept'});await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.equal(await readFile(path.join(f.directory,'existing.txt'),'utf8'),'updated');assert.equal(f.store.snapshot().sessions[0]!.activities?.filter(item=>item.toolName==='write_file').length,1);assert.equal(n,4);await f.submit(chat.id,'What changed?');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');const followup=JSON.parse(String(f.requests.at(-1)!.init.body));assert.ok(followup.messages.some((m:any)=>typeof m.content==='string'&&m.content.includes('workbench-public-tool-records')&&m.content.includes('updated')));assert.equal(f.store.snapshot().sessions[0]!.activities?.filter(item=>item.toolName==='write_file').length,1);}finally{await f.close();}
});

test('translation and agent directories use identical normalized addresses and authentication for all protocols',async()=>{
  for(const protocol of ['chat-completions','responses','anthropic-messages'] as Protocol[]){
    const requests:{url:string;headers:unknown;method:unknown}[]=[];
    const fetcher:typeof fetch=async(url,init)=>{requests.push({url:String(url),headers:init?.headers,method:init?.method});return json({data:[{id:'upstream-v1'}]});};
    const baseUrl='https://gateway.example/custom/v1/chat/completions';
    await listModels({id:'translation',name:'Translation',baseUrl,protocol,model:'upstream-v1',verifiedEfforts:[],consent:false,hasKey:true,maxCharacters:16000,maxCalls:100,timeoutMs:30000},'synthetic-key',fetcher);
    await discoverModels(validateConnection({...input(protocol),baseUrl}),'synthetic-key',fetcher);
    assert.deepEqual(requests[0],requests[1]);
  }
});

test('directory transport diagnostics classify fixed error codes without leaking messages or claiming an uncertain turn',async()=>{
  for(const [code,label] of [['ECONNRESET','尚未确认密钥'],['ENOTFOUND','域名'],['CERT_HAS_EXPIRED','证书'],['ECONNREFUSED','拒绝连接'],['UND_ERR_CONNECT_TIMEOUT','超时']]){
    let calls=0;
    await assert.rejects(discoverModels(connection(),'synthetic-key',async()=>{calls++;throw new TypeError('secret-in-message https://user:password@example.com',{cause:Object.assign(Error('private details'),{code})});}),error=>{
      assert.ok(error instanceof ModelRequestError);assert.equal(error.uncertain,false);assert.match(error.message,new RegExp(label!));assert.doesNotMatch(error.message,/secret|password|private|结果待确认/);return true;
    });assert.equal(calls,1);
  }
  await assert.rejects(discoverModels(connection(),'synthetic-key',async()=>{throw Error('net::ERR_CONNECTION_CLOSED private');}),/尚未确认密钥/);
  await assert.rejects(discoverModels(connection(),'synthetic-key',async()=>new Response(new ReadableStream({start(c){c.error(Error('private stream secret'));}}))),error=>error instanceof ModelRequestError&&!error.uncertain&&!error.message.includes('secret'));
});

test('directory HTTP failures distinguish credentials, missing catalog and redirects without following or exposing response bodies',async()=>{
  for(const [status,label] of [[401,'密钥'],[403,'权限'],[404,'手动添加'],[405,'手动添加'],[429,'限流'],[302,'密钥未转发']] as const){
    let calls=0;await assert.rejects(discoverModels(connection(),'synthetic-key',async(_url,init)=>{calls++;assert.equal(init?.redirect,'manual');return new Response('private-upstream-body',{status,headers:{location:'https://different.example/?key=private'}});}),error=>{
      assert.ok(error instanceof ModelRequestError);assert.equal(error.uncertain,false);assert.match(error.message,new RegExp(label));assert.match(error.message,new RegExp(String(status)));assert.doesNotMatch(error.message,/private|different\.example/);return true;
    });assert.equal(calls,1);
  }
});

test('execution defaults retire legacy switches and budgets while output limits follow reported model capability',async()=>{
  const c=validateConnection({...input(),tools:false,timeoutMs:1,maxOutputTokens:256});
  assert.equal(c.tools,true);assert.equal(c.timeoutMs,API_DEFAULTS.timeoutMs);assert.equal(c.maxOutputTokens,API_DEFAULTS.maxOutputTokens);
  for(const protocol of ['chat-completions','responses','anthropic-messages'] as Protocol[]){
    let body:any;
    const reply=protocol==='responses'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'done'}]}]}:protocol==='anthropic-messages'?{content:[{type:'text',text:'done'}],stop_reason:'end_turn'}:finished();
    const client=new ApiConversationClient({connection:{...c,protocol,maxOutputTokens:256},model:{...model,maxOutputTokens:32768},system:'English',history:[{role:'user',content:'task'}],tools:[]},'synthetic-key',async(_url,init)=>{body=JSON.parse(String(init?.body));return json(reply);});
    await client.next(new AbortController().signal,()=>{});assert.equal(body.max_output_tokens??body.max_tokens,32768);
  }
});

test('empty keys work directly; untouched saved keys persist and explicit clearing removes credentials',async()=>{
  const f=await fixture();try{
    let c=await f.controller.call('model-api/save',{connection:input(),key:''}) as ModelConnection;
    assert.equal(c.auth,'none');assert.equal(c.hasKey,false);assert.equal((f.requests.at(-1)!.init.headers as any).authorization,undefined);
    c=await f.controller.call('model-api/save',{id:c.id,revision:c.revision,connection:c,key:'synthetic-new-key'}) as ModelConnection;
    const ref=c.credentialRef;assert.equal(c.hasKey,true);
    c=await f.controller.call('model-api/save',{id:c.id,revision:c.revision,connection:{...c,name:'Renamed'}}) as ModelConnection;
    assert.equal(c.credentialRef,ref);assert.equal((f.requests.at(-1)!.init.headers as any).authorization,'Bearer synthetic-new-key');
    c=await f.controller.call('model-api/save',{id:c.id,revision:c.revision,connection:c,key:''}) as ModelConnection;
    assert.equal(c.hasKey,false);assert.equal(c.auth,'none');assert.equal(c.credentialRef,undefined);assert.equal((f.requests.at(-1)!.init.headers as any).authorization,undefined);assert.equal((await readdir(path.join(f.directory,'secrets'))).length,0);
    const session=await f.create(c);await f.submit(session.id);await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.equal(f.store.snapshot().sessions[0]!.messages.at(-1)!.original,'SYNTHETIC_RESULT');
  }finally{await f.close();}
});

test('old tool-off profiles migrate on restart and expose tools for an explicit task',async()=>{
  const f=await fixture();try{
    const c=await f.save();await f.store.update(s=>{Object.assign(s.modelConnections![0]!,{tools:false,timeoutMs:5000,maxOutputTokens:256});});
    const reopened=new StateStore(f.directory);await reopened.load();const updated=reopened.snapshot().modelConnections![0]!;
    assert.equal(updated.tools,true);assert.equal(updated.timeoutMs,120000);assert.equal(updated.maxOutputTokens,8192);assert.equal(updated.credentialRef,c.credentialRef);
    const session=await f.create(c);await f.submit(session.id);await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
    const body=JSON.parse(String(f.requests.at(-1)!.init.body));assert.ok(body.tools.some((t:any)=>t.function.name==='read_file'));assert.ok(body.tools.some((t:any)=>t.function.name==='workbench_spawn_agent'));
  }finally{await f.close();}
});

test('a missing model directory does not prevent manual mappings and inference, and a changed source drops stale capabilities',async()=>{
  const requests:any[]=[];const f=await fixture(undefined,{modelFetcher:async(url,init)=>{requests.push({url:String(url),init});return String(url).endsWith('/models')?json({error:'private upstream detail'},404):json(finished('Manual model works'));}});
  try{
    let c=await f.save();assert.match(c.discoveryError!,/404/);assert.equal(requests.length,1);const session=await f.create(c);await f.submit(session.id);await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.equal(f.store.snapshot().sessions[0]!.messages.at(-1)!.original,'Manual model works');
    c=await f.controller.call('model-api/save',{id:c.id,revision:c.revision,connection:{...c,baseUrl:'https://other.example/v1',models:[{...model,contextWindow:128000,efforts:['high'],adaptiveThinking:true}]},key:'new-synthetic-key'}) as ModelConnection;
    assert.equal(c.models[0]!.contextWindow,undefined);assert.equal(c.models[0]!.adaptiveThinking,undefined);assert.deepEqual(c.discoveredModels,[]);assert.equal(c.discoveredAt,undefined);
  }finally{await f.close();}
});


test('approved file-reader extension runs through actual API tool calls and restores core large/binary pages',async()=>{
 let step=0;const f=await fixture(async()=>++step%2===1?json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'read-'+step,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'binary.dat',encoding:'base64',offset:65530,limit:70000})}}]}}]}):json(finished()));
 const plugins=new PluginRegistry(path.join(f.directory,'plugins'));await plugins.initialize();
 try{
  const file=path.join(f.directory,'binary.dat'),bytes=Buffer.alloc(2*1024*1024,255);await writeFile(file,bytes);if(process.platform==='win32'){const {stdout}=await promisify(execFile)('whoami',[],{windowsHide:true});await promisify(execFile)('icacls',[file,'/setowner',stdout.trim()],{windowsHide:true});}
  for(const[id,service]of Object.entries(f.controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  const id='test.file-reader',manifest={schemaVersion:1,apiVersion:1,id,name:'File reader fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs'};
  const source=`export function activate(api){api.onDispose(api.services.get('runtime.api.tools').registerFileReader({id:'plugin:'+api.id+'/format',read:async(path,options,next)=>({...await next(),content:'PLUGIN_PAGE'})}));}`;
  const zip=path.join(f.directory,'reader.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const hash=(await plugins.list())[0]!.hash;await plugins.setEnabled(id,hash,true,true);
  const connection=await f.save();await f.store.update(s=>{Object.assign(s.modelConnections![0]!.models[0]!,{contextWindow:1000000,metadataSource:'manual'});});const chat=await f.create(connection);
  for(const enabled of [true,false,true]){
   await plugins.setEnabled(id,hash,enabled);await f.submit(chat.id,'Read the synthetic binary page.');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
   const request=JSON.parse(String(f.requests.at(-1)!.init.body)),result=JSON.parse(request.messages.at(-1).content);assert.ok(result.content,JSON.stringify({result,error:f.store.snapshot().sessions[0]!.nativeError}));assert.equal(result.content,enabled?'PLUGIN_PAGE':bytes.subarray(65530,135530).toString('base64'));assert.equal(result.nextOffset,135530);assert.equal(result.bytes,bytes.length);
  }
 }finally{await plugins.dispose();await f.close();}
});


test('API turns exceed 64 calls by default and explicit budgets pause after known results without replay',async()=>{
 let calls=0,finishAfter=65;const f=await fixture(async()=>{calls++;return calls>finishAfter?json(finished('Finished explicitly')):json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'list-'+calls,type:'function',function:{name:'workbench_list_sessions',arguments:'{}'}}]}}]});});
 try{
  const connection=await f.save();await f.store.update(s=>{s.modelConnections![0]!.models[0]!.contextWindow=1000000;});const chat=await f.create(connection);
  await f.submit(chat.id);for(let i=0;i<2000&&f.store.snapshot().sessions[0]!.status==='running';i++)await new Promise(r=>setTimeout(r,5));assert.equal(calls,66);assert.equal(f.store.snapshot().sessions[0]!.nativeTurnStatus,'completed');
  await f.controller.call('session/api-budget',{sessionId:chat.id,limit:2,expected:0});await assert.rejects(f.controller.call('session/api-budget',{sessionId:chat.id,limit:3,expected:0}),/CHANGED/);
  calls=0;finishAfter=3;await f.submit(chat.id,'Continue within my budget.');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');const paused=f.store.snapshot().sessions[0]!;assert.equal(calls,2);assert.equal(paused.nativeError,undefined);assert.equal(paused.nativeTurnStatus,'budget-exhausted');assert.equal(paused.apiBudgetPause?.calls,2);assert.equal(paused.turnTimings?.at(-1)?.status,'stopped');
  const restarted=new StateStore(f.directory);await restarted.load();assert.equal(restarted.snapshot().sessions[0]!.apiCallBudget,2);assert.equal(restarted.snapshot().sessions[0]!.apiBudgetPause?.calls,2);assert.equal(restarted.snapshot().sessions[0]!.status,'idle');
  await f.submit(chat.id,'Continue with a new explicit instruction.');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.equal(calls,4);assert.equal(f.store.snapshot().sessions[0]!.apiBudgetPause,undefined);
 }finally{await f.close();}
});
test('approved budget policies drive production API calls and restore the saved budget on disable',async()=>{
 let calls=0;const f=await fixture(async()=>++calls%3===0?json(finished()):json({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'list-'+calls,type:'function',function:{name:'workbench_list_sessions',arguments:'{}'}}]}}]}));const plugins=new PluginRegistry(path.join(f.directory,'plugins'));await plugins.initialize();
 try{
  for(const[id,service]of Object.entries(f.controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  const id='test.api-budget',manifest={schemaVersion:1,apiVersion:1,id,name:'Budget fixture',version:'1.0.0',description:'Synthetic budget',capabilities:['host'],main:'main.mjs'},source=`export function activate(api){api.onDispose(api.services.get('runtime.api.budgets').register({id:'plugin:'+api.id+'/budget',limit:()=>1}));}`;
  const zip=path.join(f.directory,'budget.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const hash=(await plugins.list())[0]!.hash;await plugins.setEnabled(id,hash,true,true);const chat=await f.create(await f.save());
  for(const enabled of [true,false,true]){calls=0;await plugins.setEnabled(id,hash,enabled);await f.submit(chat.id,'List synthetic peers.');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.equal(calls,enabled?1:3);assert.equal(f.store.snapshot().sessions[0]!.apiCallBudget??0,0);}
 }finally{await plugins.dispose();await f.close();}
});

test('API budget is frozen for the active turn and pending steering remains unsent at its boundary',async()=>{
 let release!:(value:Response)=>void,calls=0;
 const f=await fixture(async()=>{calls++;if(calls===1)return new Promise<Response>(r=>{release=r;});return json(finished());});
 try{
  const chat=await f.create(await f.save());await f.controller.call('session/api-budget',{sessionId:chat.id,limit:1,expected:0});await f.submit(chat.id);await wait(()=>!!release);
  await f.controller.call('session/api-budget',{sessionId:chat.id,limit:0,expected:1});const extra=await f.submit(chat.id,'Unsent steering at boundary');release(json(finished('Known result')));await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');
  const s=f.store.snapshot().sessions[0]!;assert.equal(calls,1);assert.equal(s.apiCallBudget,0);assert.equal(s.apiBudgetPause?.limit,1);assert.equal(s.messages.find(m=>m.id===extra.id)?.delivery,'not-sent');
  await f.submit(chat.id,'Explicit new task');await wait(()=>f.store.snapshot().sessions[0]!.status==='idle');assert.equal(calls,2);assert.ok(!String(f.requests.at(-1)!.init.body).includes('Unsent steering at boundary'));
 }finally{release?.(json(finished()));await f.close();}
});
