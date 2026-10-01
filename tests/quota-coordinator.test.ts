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
  const member = {request:async(h:SshHost,method:string,params:any) => {
    requests.push({host:structuredClone(h),method,params:structuredClone(params)});
    if (method === 'quota/context') return {managed,workspaceId:'space-one',allocation:{weeklyPercent:33,fiveHourPercent:33,allowOverage:true}};
    if (method === 'quota/check') return {allowed,reason:allowed?undefined:'QUOTA_ALLOCATION_EXHAUSTED'};
    if (failFinish && params.payload?.phase === 'finish') {failFinish=false;throw Error('Fixture transport disconnected');}
    return {accountId:account.id,mode:'estimated',coverage:'workbench-observed',windows:[]};
  }};
  const remote = {list:async()=>{throw Error('Member must not require an administrator key');},quota:async()=>{throw Error('Unexpected admin request');},dispose:async()=>{}};
  const make = () => new NativeQuotaAccounting(directory,()=>state,remote as any,member as any);
  const service = make(), handle = {threadId:'thread-one'} as any;
  return {directory,host,account,catalog,session,state,requests,service,handle,make,setAllowed:(v:boolean)=>{allowed=v;},setManaged:(v:boolean)=>{managed=v;},failNextFinish:()=>{failFinish=true;},close:async()=>{await service.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('member-only quota preflight checks the bound account before opening a producer',async()=>{
  const f=await fixture();try {
    await f.service.begin(f.session,f.handle);
    assert.deepEqual(f.requests.map(r=>r.method),['quota/context','quota/observe','quota/check','quota/observe']);
    assert.ok(f.requests.every(r=>r.host.role==='workspace'&&r.host.identityFile===f.host.identityFile));
    assert.equal(f.requests[1]!.params.refresh,true);
    assert.equal(f.requests[2]!.params.accountGeneration,'ag');
    assert.equal(f.requests[3]!.params.payload.phase,'begin');
    await f.service.finish(f.session.id,f.handle);
  } finally {await f.close();}
});

test('managed native quota refresh preserves runtime source at begin and finish',async()=>{
 const f=await fixture();try{
  f.catalog.source='native-owner';f.session.binding.accountRuntime='native-owner';
  await f.service.begin(f.session,f.handle);await f.service.finish(f.session.id,f.handle);
  const refresh=f.requests.filter(r=>r.params.refresh);assert.equal(refresh.length,2);assert.ok(refresh.every(r=>r.params.accountRuntime==='native-owner'));
 }finally{await f.close();}
});

test('verified session migration preserves the legacy numeric deduplication scope',async()=>{
 const f=await fixture();try{
  const previous='vps-account:old-authority/old-generation/codex/account-one/ag';
  f.session.accountMigration={id:'a'.repeat(64),previousAccountRef:previous,migratedAt:new Date().toISOString()};
  await f.service.begin(f.session,f.handle);
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
    const finished=f.requests.filter(r=>r.params.payload?.phase==='finish');
    assert.equal(finished.length,1);assert.equal(finished[0]!.params.payload.totalTokens,10200);assert.equal(finished[0]!.params.payload.lastTokens,300);
    assert.ok(!JSON.stringify(finished).includes('privateText'));
    await f.service.begin(f.session,f.handle);observe(10300,100);await f.service.finish(f.session.id,f.handle);
    assert.equal(f.requests.at(-1)!.params.payload.lastTokens,100);
  } finally {await f.close();}
});

test('denied preflight never opens a producer or emits a phantom finish record',async()=>{
  const f=await fixture();try {
    f.setAllowed(false);await assert.rejects(f.service.begin(f.session,f.handle),/配给与可借份额已用尽/);
    await f.service.finish(f.session.id,f.handle);
    assert.ok(f.requests.every(r=>!r.params.payload?.phase));
    assert.equal(f.requests.at(-1)!.method,'quota/check');
  } finally {await f.close();}
});

test('numeric outbox survives coordinator restart and retries the same scope without stale quota windows',async()=>{
  const f=await fixture();let resumed:NativeQuotaAccounting|undefined;try {
    await f.service.begin(f.session,f.handle);
    f.service.observe(f.session.id,{total:{totalTokens:9000},last:{totalTokens:500}});
    f.failNextFinish();await assert.rejects(f.service.finish(f.session.id,f.handle),/Fixture transport/);
    const folder=path.join(f.directory,'quota-outbox'),files=await readdir(folder);assert.equal(files.length,1);
    const persisted=JSON.parse(await readFile(path.join(folder,files[0]!),'utf8'));
    assert.deepEqual(Object.keys(persisted).sort(),['hostIdentity','payload']);
    await f.service.dispose();resumed=f.make();const start=f.requests.length;
    await resumed.begin(f.session,f.handle);
    const replay=f.requests.slice(start).find(r=>r.params.payload?.phase==='finish')!;
    assert.equal(replay.params.payload.scope,persisted.payload.scope);assert.equal(replay.params.payload.totalTokens,9000);
    assert.equal('windows' in replay.params.payload,false);assert.equal('refresh' in replay.params,false);
    assert.deepEqual(await readdir(folder),[]);
    assert.ok(f.requests.slice(start).findIndex(r=>r.params.payload?.phase==='finish')<f.requests.slice(start).findIndex(r=>r.method==='quota/check'));
    await resumed.finish(f.session.id,f.handle);
  } finally {await resumed?.dispose();await f.close();}
});

test('shared account generation mismatch and missing catalog fail closed before quota requests',async()=>{
  const f=await fixture();try {
    f.session.binding.accountRef+='-stale';await assert.rejects(f.service.begin(f.session,f.handle),/身份已变更/);
    delete f.state.accountCatalogs;await assert.rejects(f.service.begin(f.session,f.handle),/身份尚未核实/);
    assert.equal(f.requests.length,0);
  } finally {await f.close();}
});

test('unconfigured native workspace remains usable without creating a ledger producer',async()=>{
  const f=await fixture();try {
    f.setManaged(false);await f.service.begin(f.session,f.handle);await f.service.finish(f.session.id,f.handle);
    assert.deepEqual(f.requests.map(r=>r.method),['quota/context']);
  } finally {await f.close();}
});
