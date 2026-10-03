import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initialState, StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { Translator } from '../packages/translation/provider';
import { TranslationModule } from '../packages/translation/module';
import { TranslationTargetRegistry } from '../packages/translation/targets';
import { recordTranslationUsage, validateTranslationUsage } from '../packages/translation/usage';
import { TranslationExecutionError, type TranslationUsageReceipt } from '../packages/translation/types';
import { modelUsageSummary } from '../packages/model-management/usage';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';

const counts={inputTokens:100,outputTokens:20,cacheReadTokens:60,cacheWriteTokens:0,totalTokens:120};
const profile=()=>({...initialState().translation,consent:true,model:'fixture',protocol:'responses' as const});
const response=(input:string,usage:unknown={input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:60},total_tokens:120})=>Response.json({status:'completed',model:'reported',output:[{type:'message',status:'completed',content:[{type:'output_text',text:input}]}],usage});
const receipt=(id:string,at:string):TranslationUsageReceipt=>({...counts,id,at,sourceId:'api/fixture/model',model:'fixture',runtime:'api',operation:'translation',direction:'input',status:'complete',reasoningTokens:null,elapsedMs:10});
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return{promise,resolve};};
async function fixture(fetcher:typeof fetch=async()=>{throw Error('Unexpected request');}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-translation-redesign-')),store=new StateStore(dir);await store.load();
 const secrets=new SecretStore(dir,{encrypt:v=>Buffer.from(v),decrypt:v=>v.toString()});
 const controller=new WorkbenchController(store,secrets,{translationFetcher:fetcher,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
 return{dir,store,secrets,controller,close:async()=>{await controller.dispose();await rm(dir,{recursive:true,force:true});}};
}

test('session budgets isolate chats, persist across restart and admit concurrent requests atomically',async()=>{
 let sent=0;const f=await fixture(async()=>{sent++;return response('Translated');});
 try{
  await f.secrets.set(f.store.snapshot().translation.baseUrl,'synthetic-key');
  await f.store.update(s=>{Object.assign(s.translation,{consent:true,model:'fixture',maxCalls:1});});
  const a=await f.controller.call('session/create',{runtime:'demo'}) as any,b=await f.controller.call('session/create',{runtime:'demo'}) as any;
  const prepare=(sessionId:string)=>f.controller.call('draft/prepare',{sessionId,text:'测试输入'});
  const results=await Promise.allSettled([prepare(a.id),prepare(a.id)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(sent,1);
  await prepare(b.id);assert.equal(sent,2);
  await assert.rejects(prepare(a.id),/本会话.*预算/);
  assert.equal((await f.controller.call('translation/usage',{sessionId:a.id}) as any).sessionCalls,1);
  await f.controller.call('plugins/set-enabled',{id:'translation',enabled:false});await f.controller.call('plugins/set-enabled',{id:'translation',enabled:true});
  await assert.rejects(prepare(a.id),/预算/);
  await f.controller.dispose();const restored=new StateStore(f.dir);await restored.load();
  const controller=new WorkbenchController(restored,f.secrets,{translationFetcher:async()=>{sent++;return response('Restored');},pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  try{await assert.rejects(controller.call('draft/prepare',{sessionId:a.id,text:'再试'}),/预算/);assert.equal(sent,2);
   const next=await controller.call('session/create',{runtime:'demo'}) as any;await controller.call('draft/prepare',{sessionId:next.id,text:'新会话'});assert.equal(sent,3);
   await controller.call('translation/settings',{profile:{...restored.snapshot().translation,maxCalls:0}});await controller.call('draft/prepare',{sessionId:a.id,text:'解除限制'});assert.equal(sent,4);
  }finally{await controller.dispose();}
  const disk=JSON.parse(await readFile(path.join(f.dir,'state.json'),'utf8'));disk.sessions[0].translationCalls=-1;await writeFile(path.join(f.dir,'state.json'),JSON.stringify(disk));await assert.rejects(new StateStore(f.dir).load(),/TRANSLATION_CALLS_INVALID/);
 }finally{await f.close();}
});

test('zero budgets allow long source and repeated calls; character cap counts Unicode before admission',async()=>{
 let calls=0;const t=new Translator(async(_url,init)=>{calls++;assert.ok(JSON.parse(String(init?.body)).input);return response('Translated input.');});
 const p=profile();for(let i=0;i<3;i++)await t.translate('文字'.repeat(9000),'input',p,'synthetic-key');
 assert.equal(calls,3);await t.translate('中😀','input',{...p,maxCharacters:2},'synthetic-key');
 await assert.rejects(t.translate('中😀文','input',{...p,maxCharacters:2},'synthetic-key'),/未发送/);assert.equal(calls,4);
 await assert.rejects(t.translate('test','input',{...p,maxCalls:4},'synthetic-key'),/预算/);assert.equal(calls,4);
});

test('usage includes cache and reasoning for every protocol, and retains counts on invalid completion',async()=>{
 for(const protocol of ['responses','chat-completions','anthropic-messages'] as const){
  const receipts:TranslationUsageReceipt[]=[];
  const t=new Translator(async()=>Response.json(protocol==='responses'?{status:'incomplete',usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:60},output_tokens_details:{reasoning_tokens:5},total_tokens:120}}:protocol==='chat-completions'?{choices:[{finish_reason:'length',message:{content:'partial'}}],usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:60},completion_tokens_details:{reasoning_tokens:5},total_tokens:120}}:{stop_reason:'max_tokens',content:[{type:'text',text:'partial'}],usage:{input_tokens:10,cache_read_input_tokens:60,cache_creation_input_tokens:30,output_tokens:20}}),async r=>{receipts.push(r);});
  if(protocol==='responses')await assert.rejects(t.translate('input','input',{...profile(),protocol},'synthetic-key'));else assert.equal((await t.translate('input','input',{...profile(),protocol},'synthetic-key')).incomplete,true);
  assert.equal(receipts.length,1);assert.equal(receipts[0]!.inputTokens,100);assert.equal(receipts[0]!.cacheReadTokens,60);assert.equal(receipts[0]!.outputTokens,20);assert.equal(receipts[0]!.status,'failed');
  assert.equal(receipts[0]!.reasoningTokens,protocol==='anthropic-messages'?null:5);
 }
});

test('usage persistence failure preserves translation and retries only receipts with deduplication',async()=>{
 let fail=true,calls=0;const receipts:TranslationUsageReceipt[]=[];
 const t=new Translator(async(_url,init)=>{calls++;return response(JSON.parse(String(init?.body)).input);},async r=>{if(fail)throw Error('disk');receipts.push(r);});
 assert.equal((await t.translate('first','input',profile(),'synthetic-key')).text,'first');assert.equal(t.usage(profile().id).pendingReceipts,1);
 fail=false;await t.translate('second','input',profile(),'synthetic-key');assert.equal(calls,2);assert.equal(receipts.length,2);assert.equal(t.usage(profile().id).pendingReceipts,0);
});

test('native failed turn usage survives through translator without fallback or resubmission',async()=>{
 const receipts:TranslationUsageReceipt[]=[];let calls=0;
 const t=new Translator(async()=>{throw Error('No API fallback');},async r=>{receipts.push(r);});
 await assert.rejects(t.translate('input','input',profile(),'',undefined,'translation',{profile:profile(),runtime:'codex',sourceId:'account/fixture/model',execute:async()=>{calls++;throw new TranslationExecutionError('TRANSLATION_NATIVE_FAILED',counts,'native',7);}}),/TRANSLATION_NATIVE_FAILED/);
 assert.equal(calls,1);assert.equal(receipts[0]!.cacheReadTokens,60);assert.equal(receipts[0]!.reasoningTokens,7);
});

test('translation ledger survives restart, filters day/week/month and cannot affect main account totals',async()=>{
 const f=await fixture();try{
  const now=Date.now(),scope={kind:'translation' as const,id:'translation'};
  let usage=recordTranslationUsage(undefined,receipt('recent',new Date(now-1000).toISOString()));
  usage=recordTranslationUsage(usage,receipt('older',new Date(now-3*86400000).toISOString()));
  usage=recordTranslationUsage(usage,receipt('recent',new Date(now-1000).toISOString()));
  await f.store.update(s=>{s.translationUsage=usage;});const state=await new StateStore(f.dir).load();
  assert.equal(state.translationUsage!.attempts.length,2);assert.equal(state.modelUsage,undefined);
  assert.equal(modelUsageSummary(state,scope,'1day',now).totalTokens,120);assert.equal(modelUsageSummary(state,scope,'7day',now).totalTokens,240);
  assert.equal(modelUsageSummary(state,{kind:'account',id:'fixture'},'7day',now).totalTokens,0);
  assert.throws(()=>modelUsageSummary(state,scope,'cycle',now),/QUERY_INVALID/);
  await f.controller.call('models/pricing/save',{scope,model:'fixture',price:{input:1,output:2}});
  assert.equal((await f.controller.call('models/usage',{scope,period:'7day'}) as any).estimatedUsd,.00028);
  const broken=structuredClone(state);broken.translationUsage!.records[0]!.inputTokens=-1;const raw=JSON.stringify(broken);await writeFile(path.join(f.dir,'state.json'),raw);
  await assert.rejects(new StateStore(f.dir).load(),/TRANSLATION_USAGE_STATE_INVALID/);assert.equal(await readFile(path.join(f.dir,'state.json'),'utf8'),raw);
 }finally{await f.close();}
});

test('legacy flags migrate to module semantics, numeric preferences survive, stale settings cannot overwrite',async()=>{
 const f=await fixture();try{
  const legacy=initialState();legacy.translateInput=false;legacy.translateFinal=false;delete legacy.translation.source;Object.assign(legacy.translation,{maxCalls:23,maxCharacters:16000,timeoutMs:90000});
  await writeFile(path.join(f.dir,'state.json'),JSON.stringify(legacy));const migrated=await new StateStore(f.dir).load();assert.equal(migrated.translateInput,true);assert.equal(migrated.translateFinal,true);assert.equal(migrated.translation.maxCalls,23);assert.deepEqual(migrated.translation.source,{kind:'custom'});
  const save=()=>f.controller.call('translation/settings',{profile:{...f.store.snapshot().translation,source:{kind:'model',targetId:'plugin:test.provider/missing'}},translateInput:false,translateFinal:false});
  await save();const old=f.store.snapshot().translation;await save();await assert.rejects(f.controller.call('translation/settings',{profile:old}),/TRANSLATION_SETTINGS_CHANGED/);
  assert.equal(f.store.snapshot().translateInput,true);assert.equal(f.store.snapshot().translateFinal,true);assert.equal(f.store.snapshot().translation.source!.targetId,'plugin:test.provider/missing');
 }finally{await f.close();}
});

test('selected enabled API uses existing endpoint/model/key, marks busy and records translation-only usage',async()=>{
 const held=deferred<Response>();let auth='',body:any,url='';
 const f=await fixture(async(u,init)=>{url=String(u);auth=new Headers(init?.headers).get('authorization')??'';body=JSON.parse(String(init?.body));return held.promise;});
 try{
  const id='11111111-1111-4111-a111-111111111111',credentialRef=await f.secrets.setModel(JSON.stringify([id,'https://fixture.invalid/v1','responses']),'synthetic-selected-key');
  await f.store.update(s=>{s.modelConnections=[{id,revision:'r1',name:'Fixture',baseUrl:'https://fixture.invalid/v1',protocol:'responses',enabled:true,auth:'key',hasKey:true,credentialRef,models:[{id:'mapping',model:'selected-model',name:'Selected',enabled:true,efforts:[],contextWindow:32000,metadataSource:'manual'}],discoveredModels:[],tools:false,timeoutMs:0,maxOutputTokens:8192}];s.translation.source={kind:'model',targetId:`api/${id}/mapping`};});
  f.secrets.get=async()=>{throw Error('Must not read custom translation key');};
  const module=f.controller.developmentServices().translation as TranslationModule;
  const pending=module.translate('Translate this','input','api-test','input');void pending.catch(()=>{});
  for(let i=0;!body&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(body);assert.equal(module.busy(id),true);
  await assert.rejects(f.controller.call('model-api/set-enabled',{id,revision:'r1',enabled:false}),/等待|任务/);
  held.resolve(response('Translated'));assert.equal((await pending).value.text,'Translated');
  assert.equal(url,'https://fixture.invalid/v1/responses');assert.equal(auth,'Bearer synthetic-selected-key');assert.equal(body.model,'selected-model');assert.equal(module.busy(),false);assert.equal(f.store.snapshot().translationUsage!.records.length,1);assert.equal(f.store.snapshot().sessions.length,0);assert.equal(f.store.snapshot().modelUsage,undefined);
 }finally{held.resolve(response('Translated'));await f.close();}
});

test('API no-auth does not invent a bearer header',async()=>{
 let headers:Headers|undefined;const p=profile();const t=new Translator(async(_url,init)=>{headers=new Headers(init?.headers);return response('Translated');});
 await t.translate('Input','input',p,'',undefined,'translation',{profile:p,auth:'none',sourceId:'api/none/model',runtime:'api'});assert.equal(headers!.has('authorization'),false);
});

test('provider namespaces, coexistence, invalid effort, unregister and late resolve are enforced',async()=>{
 const r=new TranslationTargetRegistry(),p=profile(),held=deferred<any>();
 const target=(id:string)=>({id,name:'Fixture',description:'Synthetic',model:'fixture',runtime:'api' as const,ready:true,efforts:['low']});
 const stop=r.register('test.one',{list:()=>[target('plugin:test.one/model')],resolve:()=>held.promise});
 const stop2=r.register('test.two',{list:()=>[target('plugin:test.two/model')],resolve:async()=>({profile:p,runtime:'api',sourceId:'test'})});
 assert.equal((await r.list()).length,2);assert.throws(()=>r.register('test.one',{} as any),/PROVIDER_INVALID/);
 await assert.rejects(r.resolve('plugin:test.one/model',p,'high'),/EFFORT_UNAVAILABLE/);
 const pending=r.resolve('plugin:test.one/model',p);await new Promise(resolve=>setImmediate(resolve));stop();held.resolve({profile:p,runtime:'api',sourceId:'test'});await assert.rejects(pending,/TARGET_UNAVAILABLE/);
 assert.equal((await r.list()).length,1);stop2();const stopBad=r.register('test.bad',{list:()=>[target('api/forged/model')],resolve:async()=>({profile:p,runtime:'api',sourceId:'test'})});await assert.rejects(r.list(),/CATALOG_INVALID/);stopBad();r.dispose();
});

test('approved ZIP registers real translation targets, overrides invocation, disables in flight, and restores saved selection',async()=>{
 const f=await fixture(),plugins=new PluginRegistry(path.join(f.dir,'plugins'));await plugins.initialize();
 for(const[id,service]of Object.entries(f.controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
 plugins.connectHost(request=>f.controller.call(request.method,request.payload));
 const id='test.translator',manifest={schemaVersion:1,apiVersion:1,id,name:'Translation fixture',version:'1.0.0',description:'Isolated lifecycle',capabilities:['host'],main:'main.mjs'};
 const source=`export function activate(api){
  const targets=api.services.get('translation.targets');
  const stop=targets.register('${id}',{list:()=>[{id:'plugin:${id}/fixture',name:'Fixture',description:'Synthetic',model:'fixture',runtime:'api',ready:true,efforts:[]}],resolve:async(id,profile)=>({sourceId:id,runtime:'api',profile:{...profile,model:'fixture',consent:true},execute:async request=>{if(request.input==='wait')await new Promise((yes,no)=>request.signal.addEventListener('abort',()=>no(Error('cancelled')),{once:true}));return {text:request.input,counts:${JSON.stringify(counts)}};}})});
  api.services.intercept('translation','usage',(next)=>({...next(),marker:'plugin'}));
  return stop;
 }`;
 try{
  const file=path.join(f.dir,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(file);const hash=(await plugins.list())[0]!.hash;
  await assert.rejects(plugins.setEnabled(id,hash,true),/approval/i);await plugins.setEnabled(id,hash,true,true);
  assert.ok((await f.controller.call('translation/targets') as any[]).some(t=>t.id===`plugin:${id}/fixture`));
  await f.controller.call('translation/settings',{profile:{...f.store.snapshot().translation,source:{kind:'model',targetId:`plugin:${id}/fixture`}}});
  const module=f.controller.developmentServices().translation as TranslationModule;
  for(const text of ['first','Use 中文名称 as the title.','api_key=example_example_example','Unclosed example\n```ts\nconst 中文 = 1;'])assert.equal((await module.translate(text,'input',text,'input')).value.text,text);assert.equal((await f.controller.call('translation/usage') as any).marker,'plugin');
  const budgetChat=await f.controller.call('session/create',{runtime:'demo'}) as any;
  await f.controller.call('translation/settings',{profile:{...f.store.snapshot().translation,maxCalls:1}});
  await module.translate('budget','output','budget','final',undefined,budgetChat.id);
  await assert.rejects(module.segments({value:'blocked'},'output','budget-blocked',undefined,budgetChat.id),/预算/);
  await plugins.setEnabled(id,hash,false);await plugins.setEnabled(id,hash,true);
  await assert.rejects(module.translate('still blocked','output','budget-again','final',undefined,budgetChat.id),/预算/);
  await f.controller.call('translation/settings',{profile:{...f.store.snapshot().translation,maxCalls:0}});
  const pending=module.translate('wait','input','wait','input');const rejected=assert.rejects(pending,/cancelled|UNAVAILABLE/);await new Promise(resolve=>setTimeout(resolve,30));
  await plugins.setEnabled(id,hash,false);await rejected;assert.equal((await f.controller.call('translation/usage') as any).marker,undefined);
  await assert.rejects(module.translate('missing','input','missing','input'),/TARGET_UNAVAILABLE/);assert.equal(f.store.snapshot().translation.source!.targetId,`plugin:${id}/fixture`);
  await plugins.setEnabled(id,hash,true);assert.equal((await module.translate('again','input','again','input')).value.text,'again');
  await plugins.setEnabled(id,hash,false);assert.equal((await f.controller.call('translation/targets') as any[]).length,0);
 }finally{await plugins.dispose();await f.close();}
});


test('module shutdown waits for admitted usage writes and discards cancelled delivery',async()=>{
 const state=initialState();state.translation={...profile(),source:{kind:'custom'}};const write=deferred<void>(),entered=deferred<void>();let saved=false;
 const module=new TranslationModule(()=>state,async()=> 'synthetic-key',async()=>response('Translated'),async()=>{entered.resolve();await write.promise;saved=true;});
 const pending=module.translate('Input','input','shutdown','input');const rejected=assert.rejects(pending);await entered.promise;
 let stopped=false;const closing=module.dispose().then(()=>{stopped=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);write.resolve();await closing;await rejected;assert.equal(saved,true);assert.equal(module.busy(),false);
});

test('switching to managed source does not validate or overwrite inactive custom drafts',async()=>{
 const f=await fixture();try{const before=f.store.snapshot().translation;await f.controller.call('translation/settings',{profile:{...before,baseUrl:'unfinished',name:'',source:{kind:'model',targetId:'plugin:test.provider/model'}}});assert.equal(f.store.snapshot().translation.baseUrl,before.baseUrl);assert.equal(f.store.snapshot().translation.name,before.name);}finally{await f.close();}
});
