import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {NativeQuotaAccounting} from '../apps/desktop/host/quota-accounting';
import {sharedAccountRef} from '../packages/account-selection';
import type {AccountCatalog, AppState, Session, SshHost} from '../packages/contracts';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'awb-quota-coordinator-'));
  const host: SshHost = {id:'member', name:'Member', hostname:'fixture.invalid', port:22, username:'member', role:'workspace', identityFile:'member-key-reference', knownHostsFile:'hosts-reference', ownerId:'owner', workspaceGeneration:'wg'};
  const account = {id:'account-one', generation:'ag', provider:'codex', status:'configured', displayName:'Account', observedAt:new Date().toISOString()} as const;
  const catalog = {source:'native-owner', availability:'ready', authorityId:'authority', generation:'generation', revision:1, selectionRevision:1, selectedAccountId:account.id, accounts:[account]} as AccountCatalog;
  const session = {id:'session', binding:{accountRuntime:'native-owner',runtime:'codex', provider:'openai', hostId:host.id, executionId:'local-device', egress:'vps', accountRef:sharedAccountRef(catalog,account)}} as Session;
  const state = {hosts:[host], accountCatalogs:{[host.id]:catalog}} as AppState;
  const requests: {host:SshHost; method:string; params:any}[] = [];
  let allowed = true, managed = true, failFinish = false;
  let stalled: Promise<void> | undefined;
  const member = {request:async(h:SshHost,method:string,params:any) => {
    requests.push({host:structuredClone(h),method,params:structuredClone(params)});
    await stalled;
    if (method === 'quota/context') return {managed,workspaceId:'space-one',allocation:{weeklyPercent:33,fiveHourPercent:33,allowOverage:true}};
    if (method === 'quota/check') return {allowed,reason:allowed?undefined:'QUOTA_ALLOCATION_EXHAUSTED'};
    if (failFinish && params.payload?.phase === 'finish') {failFinish=false;throw Error('Fixture transport disconnected');}
    return {accountId:account.id,mode:'estimated',coverage:'workbench-observed',windows:[]};
  }};
  const remote = {list:async()=>{throw Error('Member must not require an administrator key');},quota:async()=>{throw Error('Unexpected admin request');},dispose:async()=>{}};
  const make = () => new NativeQuotaAccounting(directory,()=>state,remote as any,member as any);
  const service = make(), handle = {threadId:'thread-one'} as any;
  return {directory,host,account,catalog,session,state,requests,service,handle,make,flush:()=>flush(service),stall:(p:Promise<void>)=>{stalled=p;},setAllowed:(v:boolean)=>{allowed=v;},setManaged:(v:boolean)=>{managed=v;},failNextFinish:()=>{failFinish=true;},close:async()=>{await service.dispose();await rm(directory,{recursive:true,force:true});}};
}
async function flush(service: NativeQuotaAccounting) {await (service as any).journal;await (service as any).queue;}

for (const runtime of ['codex','claude'] as const) test(runtime+' stalled ledger never delays submission or durable completion', async () => {
  const f = await fixture();let release!:()=>void;
  const blocked = new Promise<void>(resolve=>{release=resolve;});
  f.stall(blocked);f.session.binding.runtime=runtime;
  try {
    await f.service.begin(f.session,f.handle);
    f.service.observe(f.session.id,{total:{totalTokens:100},last:{totalTokens:100}});
    await f.service.finish(f.session.id,f.handle);
    const target=path.join(f.directory,'quota-outbox',(await readdir(path.join(f.directory,'quota-outbox')))[0]!);
    assert.equal(JSON.parse(await readFile(target,'utf8')).payload.lastTokens,100);
    await f.service.begin(f.session,f.handle);
    f.service.observe(f.session.id,{total:{totalTokens:150},last:{totalTokens:50}});
    await f.service.finish(f.session.id,f.handle);
    assert.equal(JSON.parse(await readFile(target,'utf8')).payload.lastTokens,150);
    release();await f.flush();
    assert.deepEqual(await readdir(path.dirname(target)),[]);
    assert.ok(f.requests.every(r=>r.method!=='quota/check'));
  } finally {release();await f.close();}
});

test('member-only accounting reports in the background without an admission check',async()=>{
  const f=await fixture();try {
    await f.service.begin(f.session,f.handle);
    await f.flush();
    assert.deepEqual(f.requests.map(r=>r.method),['quota/observe']);
    assert.ok(f.requests.every(r=>r.host.role==='workspace'&&r.host.identityFile===f.host.identityFile));
    assert.equal(f.requests[0]!.params.refresh,true);
    assert.equal(f.requests[0]!.params.payload.accountGeneration,'ag');
    assert.equal(f.requests[0]!.params.payload.phase,'begin');
    await f.service.finish(f.session.id,f.handle);
  } finally {await f.close();}
});

test('managed native quota refresh preserves runtime source at begin and finish',async()=>{
 const f=await fixture();try{
  f.catalog.source='native-owner';f.session.binding.accountRuntime='native-owner';
  await f.service.begin(f.session,f.handle);await f.service.finish(f.session.id,f.handle);await f.flush();
  const refresh=f.requests.filter(r=>r.params.refresh);assert.equal(refresh.length,2);assert.ok(refresh.every(r=>r.params.accountRuntime==='native-owner'));
 }finally{await f.close();}
});

test('verified session migration preserves the legacy numeric deduplication scope',async()=>{
 const f=await fixture();try{
  const previous='vps-account:old-authority/old-generation/codex/account-one/ag';
  f.session.accountMigration={id:'a'.repeat(64),previousAccountRef:previous,migratedAt:new Date().toISOString()};
  await f.service.begin(f.session,f.handle);
  await f.flush();
  const begin=f.requests.find(r=>r.params.payload?.phase==='begin')!.params.payload;
  assert.equal(begin.scope,createHash('sha256').update(previous+'\0'+f.session.id+'\0'+f.handle.threadId).digest('hex'));
  assert.equal(begin.accountId,'account-one');assert.equal(begin.accountGeneration,'ag');
  await f.service.finish(f.session.id,f.handle);
 }finally{await f.close();}
});

test('quota coordinator accumulates numeric notifications and ignores duplicates, rewinds and late events',async()=>{
  const f=await fixture();try {
    await f.service.begin(f.session,f.handle);
    const observe=(totalTokens:number,lastTokens:number)=>f.service.observe(f.session.id,{total:{totalTokens},last:{totalTokens:lastTokens},privateText:'Never persist this'});
    observe(10000,100);observe(10150,150);observe(10150,150);observe(10050,50);observe(10200,50);
    f.service.observe(f.session.id,{total:{totalTokens:Infinity},last:{totalTokens:5}});
    await f.service.finish(f.session.id,{threadId:'other-thread'} as any);
    assert.equal(f.requests.filter(r=>r.params.payload?.phase==='finish').length,0);
    await f.service.finish(f.session.id,f.handle);observe(99999,100);
    await f.service.finish(f.session.id,f.handle);
    await f.flush();
    const finished=f.requests.filter(r=>r.params.payload?.phase==='finish');
    assert.equal(finished.length,1);assert.equal(finished[0]!.params.payload.totalTokens,10200);assert.equal(finished[0]!.params.payload.lastTokens,300);
    assert.ok(!JSON.stringify(finished).includes('privateText'));
    await f.service.begin(f.session,f.handle);observe(10300,100);await f.service.finish(f.session.id,f.handle);
    await f.flush();
    assert.equal(f.requests.at(-1)!.params.payload.lastTokens,100);
  } finally {await f.close();}
});

test('estimated ledger exhaustion cannot deny a native model turn',async()=>{
  const f=await fixture();try {
    f.setAllowed(false);await f.service.begin(f.session,f.handle);
    await f.service.finish(f.session.id,f.handle);
    await f.flush();
    assert.ok(f.requests.every(r=>r.method!=='quota/check'));
    assert.equal(f.requests.at(-1)!.params.payload.phase,'finish');
  } finally {await f.close();}
});

test('numeric outbox survives coordinator restart and retries the same scope without stale quota windows',async()=>{
  const f=await fixture();let resumed:NativeQuotaAccounting|undefined;try {
    await f.service.begin(f.session,f.handle);
    f.service.observe(f.session.id,{total:{totalTokens:9000},last:{totalTokens:500}});
    f.failNextFinish();await f.service.finish(f.session.id,f.handle);await f.flush();
    const folder=path.join(f.directory,'quota-outbox'),files=await readdir(folder);assert.equal(files.length,1);
    const persisted=JSON.parse(await readFile(path.join(folder,files[0]!),'utf8'));
    assert.deepEqual(Object.keys(persisted).sort(),['hostIdentity','payload']);
    await f.service.dispose();resumed=f.make();const start=f.requests.length;
    await resumed.begin(f.session,f.handle);
    await flush(resumed);
    const replay=f.requests.slice(start).find(r=>r.params.payload?.phase==='finish')!;
    assert.equal(replay.params.payload.scope,persisted.payload.scope);assert.equal(replay.params.payload.totalTokens,9000);
    assert.equal('windows' in replay.params.payload,false);assert.equal('refresh' in replay.params,false);
    assert.deepEqual(await readdir(folder),[]);
    assert.ok(f.requests.slice(start).findIndex(r=>r.params.payload?.phase==='finish')<f.requests.slice(start).findIndex(r=>r.params.payload?.phase==='begin'));
    await resumed.finish(f.session.id,f.handle);
  } finally {await resumed?.dispose();await f.close();}
});

test('unresolved accounting identity skips attribution without blocking native authorization',async()=>{
  const f=await fixture();try {
    f.session.binding.accountRef+='-stale';await f.service.begin(f.session,f.handle);
    delete f.state.accountCatalogs;await f.service.begin(f.session,f.handle);
    await f.service.finish(f.session.id,f.handle);
    assert.equal(f.requests.length,0);
  } finally {await f.close();}
});

test('unconfigured workspace does not require quota context for model use',async()=>{
  const f=await fixture();try {
    f.setManaged(false);await f.service.begin(f.session,f.handle);await f.service.finish(f.session.id,f.handle);
    await f.flush();
    assert.ok(f.requests.every(r=>r.method==='quota/observe'));
  } finally {await f.close();}
});

for(const runtime of ['codex','claude'] as const)test(runtime+' history restores only bound numeric receipts and member policy fills legacy cards',async()=>{
 const f=await fixture();try{
  const {quotaHistory}=await import('../apps/desktop/host/quota-history');
  f.session.binding.runtime=runtime;f.state.sessions=[f.session];
  const at=new Date().toISOString(),source=JSON.stringify([runtime,'member','thread']);
  f.state.modelUsage=[{key:JSON.stringify(['session',source,'turn','receipt']),scope:{kind:'account',id:f.session.binding.accountRef},id:'receipt',source,turnId:'turn',runtime,model:'fixture',steps:1,updatedAt:at,recordedAt:at,inputTokens:80,outputTokens:20,cacheReadTokens:0,cacheWriteTokens:0,totalTokens:100}];
  assert.equal(quotaHistory(f.state,f.host,f.session.binding.accountRef)[0]!.tokens,100);
  assert.deepEqual(quotaHistory(f.state,{...f.host,id:'other'},f.session.binding.accountRef),[]);
  assert.deepEqual(quotaHistory(f.state,f.host,'other-account'),[]);
  const view=await f.service.read(f.host,f.catalog,{accountId:f.account.id,availability:'ready',observedAt:at,pools:[],cards:[],cardsSupported:false});
  assert.equal(view!.currentWorkspaceId,'space-one');assert.equal(view!.allocations!['space-one']!.weeklyPercent,33);
 }finally{await f.close();}
});

test('history-capable member service receives replay batches on the production read path',async()=>{
 const f=await fixture();let service:NativeQuotaAccounting|undefined;try{
  const source=JSON.stringify(['codex','member','thread']),at=new Date().toISOString();f.state.sessions=[f.session];
  f.state.modelUsage=[{key:JSON.stringify(['session',source,'turn','receipt']),scope:{kind:'account',id:f.session.binding.accountRef},id:'receipt',source,turnId:'turn',runtime:'codex',model:'fixture',steps:1,updatedAt:at,recordedAt:at,inputTokens:80,outputTokens:20,cacheReadTokens:0,cacheWriteTokens:0,totalTokens:100}];
  const received:any[]=[];
  const member={request:async(_host:any,method:string,p:any)=>{if(method==='quota/context')return {managed:true,workspaceId:'space-one',allocation:{weeklyPercent:33}};if(p.payload?.history)received.push(p.payload);return {accountId:f.account.id,mode:'estimated',coverage:'workbench-observed',historyVersion:1,windows:[]};}};
  service=new NativeQuotaAccounting(f.directory,()=>f.state,{} as any,member as any);
  const usage={accountId:f.account.id,availability:'ready' as const,observedAt:at,pools:[],cards:[],cardsSupported:false};
  await service.read(f.host,f.catalog,usage,true);await service.read(f.host,f.catalog,usage,true);
  assert.equal(received.length,2);assert.deepEqual(received[0],received[1]);assert.equal(received[0].history[0].tokens,100);assert.equal(received[0].workspaceId,'space-one');
 }finally{await f.close();}
});

for(const runtime of ['codex','claude'] as const)test(runtime+' member cards retain other workspaces and reread remote changes without local activity',async()=>{
 const f=await fixture();let service:NativeQuotaAccounting|undefined;try{
  f.session.binding.runtime=runtime;
  let tokens=100;const member={request:async(_h:any,m:string)=>m==='quota/context'?{managed:true,workspaceId:'space-one',allocation:{weeklyPercent:33}}:{accountId:f.account.id,mode:'estimated',coverage:'workbench-observed',historyVersion:1,windows:[],allocations:{'space-one':{weeklyPercent:33,fiveHourPercent:null},'space-two':{weeklyPercent:33,fiveHourPercent:null}},tokenTotals:{'space-two':tokens},workspaceNames:{'space-one':'A','space-two':'B'}}};
  service=new NativeQuotaAccounting(f.directory,()=>f.state,{dispose:async()=>{}} as any,member as any);
  const usage={accountId:f.account.id,availability:'ready' as const,observedAt:new Date().toISOString(),pools:[],cards:[],cardsSupported:false};
  const before=await service.read(f.host,f.catalog,usage);assert.equal(before?.tokenTotals?.['space-two'],100);assert.equal(Object.keys(before!.allocations!).length,2);
  tokens=250;const after=await service.read(f.host,f.catalog,usage);assert.equal(after?.tokenTotals?.['space-two'],250);assert.equal(after?.currentWorkspaceId,'space-one');
 }finally{await service?.dispose();await f.close();}
});
