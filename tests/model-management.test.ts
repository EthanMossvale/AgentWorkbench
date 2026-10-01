import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initialState, StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { LocalModelAccounts } from '../apps/desktop/host/local-model-accounts';
import { accountEnvironment, officialLoginUrl, quotaCycle, codexUsage, claudeUsage, officialAccountLaunch, type NativeAccountTransport } from '../packages/model-management/native';
import { modelUsageSummary, estimateUsd, validatePrice, captureModelUsage, modelUsageRevision } from '../packages/model-management/usage';
import { localAccountRef, type LocalModelAccount, type LoginMethod, type AccountLogin } from '../packages/model-management/types';
import { recordSessionUsage, parseTokenCounts, metricsSource } from '../packages/session-metrics';
import type { Session, NativeModelOption } from '../packages/contracts';
import { openNativeGateway } from '../packages/model-api/native-gateway';

const accountId='11111111-1111-4111-a111-111111111111';
const model:NativeModelOption={id:'model-a',model:'model-a',name:'Model A',isDefault:true,efforts:['low','high'],defaultEffort:'low',serviceTiers:[]};
const account=():LocalModelAccount=>({id:accountId,revision:'revision',name:'Synthetic account',provider:'codex',enabled:true,status:'authenticated',models:[model]});
const session=(id='chat'):Session=>({id,projectId:null,title:'Synthetic',pinned:false,archived:false,group:'',status:'idle',messages:[],createdAt:'2026-09-28T00:00:00Z',modelTargetId:`account/${accountId}/model-a`,modelSelection:{model:'model-a'},binding:{runtime:'codex',provider:'openai',accountRef:localAccountRef(accountId),localAccountId:accountId,executionId:'local-device',egress:'runtime-managed'}});
const counts={inputTokens:1000,outputTokens:200,cacheReadTokens:800,cacheWriteTokens:0,totalTokens:1200};
const now=Date.parse('2026-09-29T12:00:00Z');
const scope={kind:'account' as const,id:accountId};
const usage=(usedPercent=0,at=now,resetsAt=(now+604800000)/1000)=>({accountId,availability:'ready' as const,observedAt:new Date(at).toISOString(),pools:[{id:'codex',name:'Codex',secondary:{usedPercent,windowMinutes:10080,resetsAt}}],cards:[],cardsSupported:false});
test('model usage shares the session token-weighted cache ratio for partial receipts',()=>{
  const s=session(),state=initialState();state.sessions=[s];
  for(const [id,inputTokens,cacheReadTokens] of [['paired',1000,800],['no-read',7000,null],['no-input',null,6000]] as const)
    recordSessionUsage(s,{id,model:'model-a',...counts,inputTokens,cacheReadTokens,cacheWriteTokens:null,totalTokens:null},{source:metricsSource(s),turnId:'t',at:new Date(now).toISOString()});
  const result=modelUsageSummary(state,scope,'1day',now).groups[0]!;
  assert.equal(result.cacheHitRate,.8);assert.equal(result.inputTokens,8000);assert.ok(result.incomplete.includes('cacheReadTokens'));
});
async function fixture(){
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-local-accounts-')),store=new StateStore(directory);await store.load();
  let busy=false,inspection=0,consumed=0,uncertain=true,loginCallback:((job:AccountLogin)=>void)|undefined;
  const keys:string[]=[],opened:string[]=[];
  const transport:NativeAccountTransport={inspect:async()=>{inspection++;return{status:'authenticated',email:'member@example.com',models:[model],usage:usage()};},login:async(a,method,changed)=>{loginCallback=changed;const job:AccountLogin={id:'job',accountId:a.id,method,status:'waiting',expiresAt:new Date(Date.now()+60000).toISOString(),url:'https://auth.openai.com/codex/device',userCode:'TEST-CODE'};return{job,cancel:async()=>changed({...job,status:'cancelled'})};},consume:async(_a,key)=>{consumed++;keys.push(key);if(uncertain)throw Error('Lost receipt');return 'alreadyRedeemed';},dispose:async()=>{}};
  const hooks={snapshot:()=>store.snapshot(),update:(fn:(s:ReturnType<typeof initialState>)=>void)=>store.update(fn),busy:()=>busy,open:async(url:string)=>{opened.push(url);}};
  const cli={env:{},isMaintaining:()=>false} as any;
  const service=new LocalModelAccounts(directory,cli,hooks,transport);
  return{directory,store,service,transport,hooks,cli,opened,keys,counts:()=>({inspection,consumed}),busy:(v:boolean)=>{busy=v;},confirmed:()=>{uncertain=false;},complete:(job:AccountLogin)=>loginCallback?.({...job,status:'verifying'}),close:async()=>{await service.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('account profiles isolate both native homes and strip ambient provider credentials',()=>{
  const base={PATH:'unchanged',CODEX_HOME:'/original',CLAUDE_CONFIG_DIR:'/original',OPENAI_API_KEY:'synthetic',ANTHROPIC_AUTH_TOKEN:'synthetic',CLAUDE_CODE_OAUTH_TOKEN:'synthetic',ANTHROPIC_BASE_URL:'http://unexpected.invalid'};
  const {env,profile}=accountEnvironment(base,path.resolve('synthetic-data'),account());
  assert.equal(env.PATH,'unchanged');assert.ok(env.CODEX_HOME!.startsWith(profile));assert.ok(env.CLAUDE_CONFIG_DIR!.startsWith(profile));assert.ok(env.ANTHROPIC_CONFIG_DIR!.startsWith(profile));assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.ANTHROPIC_AUTH_TOKEN,undefined);assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.equal(base.CODEX_HOME,'/original');
  assert.throws(()=>accountEnvironment(base,'data',{...account(),id:'../outside'}),/ID_INVALID/);
});
test('only exact official HTTPS login hosts may be opened',()=>{
  assert.ok(officialLoginUrl('https://auth.openai.com/authorize?state=fixture','codex'));assert.ok(officialLoginUrl('https://claude.ai/oauth/authorize?state=fixture','claude'));
  for(const url of ['https://auth.openai.com.evil.invalid','http://auth.openai.com/','https://user:pass@auth.openai.com/','file:///secret','https://claude.ai:4433/'])assert.equal(officialLoginUrl(url,'codex'),undefined);
});
test('official launches preserve native provider traffic and selected permission',()=>{
  const s=session(),env=accountEnvironment({OPENAI_API_KEY:'synthetic'},'data',account()).env;
  const launch=officialAccountLaunch(s,env);assert.ok(launch.args.includes('model_provider="openai"'));assert.equal(launch.thread?.modelProvider,'openai');assert.ok(!JSON.stringify(launch).includes('base_url'));
  s.binding.runtime='claude';s.binding.nativeSessionId='native-thread';s.permissionMode='plan';
  const claude=officialAccountLaunch(s,env,{baseUrl:'http://127.0.0.1/peers',token:'session-only'});assert.ok(claude.args.includes('--resume'));assert.equal(claude.env.ANTHROPIC_BASE_URL,undefined);assert.ok(claude.args.includes('--mcp-config'));
});
test('Codex quota hides absent 5h and distinguishes unknown cards from zero cards',()=>{
  const a=codexUsage({rateLimits:{secondary:{usedPercent:25,windowDurationMins:10080,resetsAt:now/1000+50}},rateLimitResetCredits:null},accountId);
  assert.equal(a.pools[0]!.primary,undefined);assert.equal(a.pools[0]!.secondary!.usedPercent,25);assert.equal(a.availableResetCount,undefined);
  const b=codexUsage({rateLimits:{primary:{usedPercent:0,windowDurationMins:300}},rateLimitResetCredits:{availableCount:0,credits:[]}},accountId);assert.equal(b.availableResetCount,0);assert.equal(b.cardsSupported,true);
});
test('Claude quota accepts native events without inventing other windows or reset cards',()=>{
  const v=claudeUsage({type:'rate_limit_event',rate_limit_info:{rateLimitType:'seven_day',utilization:.25,resetsAt:Date.now()/1000+500}},accountId)!;
  assert.equal(v.pools[0]!.primary,undefined);assert.equal(v.pools[0]!.secondary!.usedPercent,25);assert.equal(v.cardsSupported,false);
  assert.equal(claudeUsage({type:'rate_limit_event',rate_limit_info:{rateLimitType:'seven_day',utilization:500}},accountId),undefined);
});
test('cycle starts only at observed full reset or a confirmed window rollover',()=>{
  const a=account();assert.equal(quotaCycle(a,usage(20)),undefined);
  a.cycle=quotaCycle(a,usage());assert.equal(a.cycle!.start,new Date(now).toISOString());a.usage=usage();
  assert.deepEqual(quotaCycle(a,usage(30,now+10000)),a.cycle);
  const rolled=quotaCycle(a,usage(15,now+604800000+1000,(now+2*604800000)/1000));assert.equal(rolled!.start,a.cycle!.end);
  assert.equal(quotaCycle(a,usage(10,now+10000,(now+500000000)/1000)),undefined);
});
test('usage ledger survives deletion and deduplicates replacement receipts',async()=>{
  const f=await fixture();try{await f.store.update(s=>{const chat=session();recordSessionUsage(chat,{id:'request',...counts},{source:'native-source',turnId:'turn',at:new Date(now-1000).toISOString()});s.sessions=[chat];s.localModelAccounts=[account()];});
  await f.store.update(s=>{recordSessionUsage(s.sessions[0]!,{id:'request',...counts,outputTokens:300,totalTokens:1300},{source:'native-source',turnId:'turn',at:new Date(now).toISOString()});});
  assert.equal(f.store.snapshot().modelUsage?.length,1);assert.equal(f.store.snapshot().modelUsage?.[0]?.recordedAt,new Date(now-1000).toISOString());
  await f.store.update(s=>{s.sessions=[];});const summary=modelUsageSummary(f.store.snapshot(),scope,'1day',now);assert.equal(summary.totalTokens,1300);assert.equal(summary.groups[0]!.requests,1);
  const reopened=new StateStore(f.directory);await reopened.load();assert.equal(modelUsageSummary(reopened.snapshot(),scope,'7day',now).totalTokens,1300);
 }finally{await f.close();}
});
test('switching account and API preserves original attribution and independent costs',()=>{
  const s=initialState(),chat=session();recordSessionUsage(chat,{id:'a',...counts},{source:'original',turnId:'turn',at:new Date(now-100).toISOString()});chat.binding={...chat.binding,localAccountId:undefined,modelConnectionId:'api-b',egress:'direct-api'};recordSessionUsage(chat,{id:'b',...counts},{source:'new',turnId:'turn2',at:new Date(now).toISOString()});s.sessions=[chat];
  assert.equal(modelUsageSummary(s,scope,'1day',now).totalTokens,1200);assert.equal(modelUsageSummary(s,{kind:'api',id:'api-b'},'1day',now).totalTokens,1200);
});
test('pricing subtracts cache subsets and retains unknown usage instead of false zero',()=>{
  assert.equal(estimateUsd(counts,{input:10,output:20,cacheRead:1}),.0068);
  assert.equal(estimateUsd({...counts,cacheReadTokens:null},{input:10,output:20,cacheRead:1}),null);
  assert.equal(estimateUsd(counts),null);assert.throws(()=>validatePrice({input:-1,output:1}),/PRICE_INVALID/);assert.throws(()=>validatePrice({input:NaN,output:1}),/PRICE_INVALID/);assert.throws(()=>validatePrice({input:1}),/PRICE_INVALID/);
  const parsed=parseTokenCounts({input_tokens:100,output_tokens:10,cache_read_input_tokens:300,cache_creation_input_tokens:200},'anthropic-messages');assert.equal(parsed.inputTokens,600);assert.equal(parsed.totalTokens,610);
});
test('time ranges exclude out-of-range and future receipts, while unknown cycle is explicit',()=>{
  const s=initialState(),chat=session();for(const [i,age]of [1,4,9].entries())recordSessionUsage(chat,{id:String(i),...counts},{source:'source',turnId:String(i),at:new Date(now-age*86400000).toISOString()});s.sessions=[chat];
  assert.equal(modelUsageSummary(s,scope,'1day',now).totalTokens,1200);assert.equal(modelUsageSummary(s,scope,'7day',now).totalTokens,2400);assert.equal(modelUsageSummary(s,scope,'cycle',now).cycleUnavailable,true);assert.throws(()=>modelUsageSummary(s,scope,'bad' as any,now),/QUERY_INVALID/);
});
test('accounts are created without login and disabled accounts leave the selector',async()=>{const f=await fixture();try{const a=await f.service.call('models/accounts/create',{provider:'codex',name:'One'}) as LocalModelAccount;assert.equal(a.status,'signed-out');assert.equal(f.counts().inspection,0);await f.service.refresh(a.id);assert.equal(f.service.targets().length,1);await f.service.call('models/accounts/set-enabled',{id:a.id,revision:a.revision,enabled:false});assert.equal(f.service.targets().length,0);assert.throws(()=>f.service.execution({...session(),binding:{...session().binding,localAccountId:a.id,accountRef:localAccountRef(a.id)}}),/UNAVAILABLE/);}finally{await f.close();}});
test('account edits use revision compare and refuse active or pending work',async()=>{const f=await fixture();try{await f.store.update(s=>{s.localModelAccounts=[account()];});f.busy(true);await assert.rejects(f.service.call('models/accounts/set-enabled',{id:accountId,revision:'revision',enabled:false}),/BUSY/);f.busy(false);await assert.rejects(f.service.call('models/accounts/set-enabled',{id:accountId,revision:'stale',enabled:false}),/CHANGED/);}finally{await f.close();}});
test('native login requires deliberate start and can be cancelled without losing the account',async()=>{const f=await fixture();try{const a=await f.service.call('models/accounts/create',{provider:'codex',name:'Login'}) as LocalModelAccount;const j=await f.service.call('models/accounts/login-start',{id:a.id,revision:a.revision,method:'device'}) as AccountLogin;assert.equal(j.status,'waiting');assert.equal(f.opened.length,1);await f.service.call('models/accounts/login-open',{id:a.id,jobId:j.id});assert.equal(f.opened.length,2);await f.service.call('models/accounts/login-cancel',{id:a.id,jobId:j.id});assert.equal((await f.service.call('models/accounts/login-status',{id:a.id,jobId:j.id}) as AccountLogin).status,'cancelled');assert.equal(f.service.account(a.id).status,'signed-out');}finally{await f.close();}});
test('login only becomes complete after official public status and models are reread',async()=>{const f=await fixture();try{const a=await f.service.call('models/accounts/create',{provider:'claude',name:'Login'}) as LocalModelAccount;const j=await f.service.call('models/accounts/login-start',{id:a.id,revision:a.revision,method:'sso'}) as AccountLogin;f.complete(j);const verified=await f.service.call('models/accounts/login-status',{id:a.id,jobId:j.id}) as AccountLogin;assert.equal(verified.status,'complete');assert.equal(f.service.account(a.id).status,'authenticated');assert.equal(verified.url,undefined);assert.equal(f.service.account(a.id).models.length,1);}finally{await f.close();}});
test('reset redemption persists its idempotency key and specific card across a lost receipt and restart',async()=>{const f=await fixture();try{await f.store.update(s=>{s.localModelAccounts=[{...account(),usage:{...usage(),observedAt:new Date().toISOString(),cardsSupported:true,availableResetCount:1,cards:[{key:'card',creditId:'specific-card',count:1,type:'codexRateLimits',available:true,expiresAt:Date.now()/1000+1000}]}}];});const plan=await f.service.call('models/accounts/reset-preview',{id:accountId,cardKey:'card'}) as any;const receipt=await f.service.call('models/accounts/reset-redeem',{id:accountId,planId:plan.id,confirm:true}) as any;assert.equal(receipt.state,'uncertain');await assert.rejects(f.service.call('models/accounts/reset-preview',{id:accountId,cardKey:'card'}),/PENDING/);f.confirmed();const restored=new LocalModelAccounts(f.directory,f.cli,f.hooks,f.transport);const result=await restored.call('models/accounts/reset-redeem',{id:accountId,planId:plan.id,confirm:true}) as any;assert.equal(result.state,'redeemed');assert.deepEqual(f.keys,[plan.id,plan.id]);assert.equal(JSON.parse(await readFile(path.join(f.directory,'account-resets',accountId+'.json'),'utf8')).plan.creditId,'specific-card');await restored.call('models/accounts/reset-redeem',{id:accountId,planId:plan.id,confirm:true});assert.equal(f.keys.length,2);}finally{await f.close();}});
test('price revisions reject stale edits and persist exact model-specific rates',async()=>{const f=await fixture();try{await f.store.update(s=>{s.localModelAccounts=[account()];});const price=await f.service.call('models/pricing/save',{scope,model:'model-a',price:{input:1,output:2}}) as any;await assert.rejects(f.service.call('models/pricing/save',{scope,model:'model-a',price:{input:2,output:3}}),/PRICE_CHANGED/);await f.service.call('models/pricing/save',{scope,model:'model-a',revision:price.revision,price:{input:0,output:0}});assert.equal(f.store.snapshot().modelPrices?.[0]?.price.input,0);}finally{await f.close();}});
test('official peer gateway refuses model traffic and never asks for API credentials',async()=>{let credentials=0;const gateway=await openNativeGateway({runtime:'claude',model:{id:'m',name:'M',model:'m',enabled:true},mcpOnly:true,credentials:async()=>{credentials++;throw Error('Never');},mcp:()=>({handle:async()=>({jsonrpc:'2.0',id:1,result:{}}),dispose(){}})});try{const response=await fetch(gateway.baseUrl+'/v1/messages',{method:'POST',headers:{authorization:'Bearer '+gateway.token,'content-type':'application/json'},body:'{}'});assert.equal(response.status,404);assert.equal(credentials,0);}finally{await gateway.close();}});
test('controller exposes local account management and a replaceable live service',async()=>{const f=await fixture();const controller=new WorkbenchController(f.store,new SecretStore(f.directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>{throw Error('No secrets');}}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});try{const a=await controller.call('models/accounts/create',{provider:'codex',name:'From API'}) as LocalModelAccount;assert.equal((await controller.call('models/accounts/list') as LocalModelAccount[])[0]?.id,a.id);assert.equal(controller.developmentServices()['models.accounts'],controller.localAccounts);}finally{await controller.dispose();await f.close();}});

test('same-timestamp corrections refresh their source even when another source is the last row',()=>{
  const state=initialState(),s=session();state.sessions=[s];const at=new Date().toISOString();
  recordSessionUsage(s,{id:'correction',model:'native-model',inputTokens:100,outputTokens:10,cacheReadTokens:0,cacheWriteTokens:0,totalTokens:110},{source:metricsSource(s),turnId:'turn',at});captureModelUsage(state,state);
  const scope=state.modelUsage![0]!.scope,before=modelUsageRevision(state,scope);
  state.modelUsage!.push({...state.modelUsage![0]!,key:'unrelated',scope:{kind:'api',id:'other'}});
  recordSessionUsage(s,{id:'correction',model:'native-model',inputTokens:100,outputTokens:20,cacheReadTokens:0,cacheWriteTokens:0,totalTokens:120},{source:metricsSource(s),turnId:'turn',at});captureModelUsage(state,state);
  assert.equal(state.modelUsage![0]!.totalTokens,120);assert.notEqual(modelUsageRevision(state,scope),before);
});
