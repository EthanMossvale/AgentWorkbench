import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchController, type HostActions } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import type { AccountCatalog, SshHost } from '../packages/contracts';
import type { CodexAuthJob } from '../packages/remote-codex-auth';

function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;}); return {promise,resolve}; }

async function fixture(role:'admin'|'workspace'='admin') {
  const directory=await mkdtemp(path.join(os.tmpdir(),'aw-shared-auth-controller-'));
  const store=new StateStore(directory);await store.load();
  const opened:string[]=[];let starts=0;let lists=0;let disposed=false;let available=true;
  let job!:CodexAuthJob;
  const actions:HostActions={
    pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],openExternal:async url=>{opened.push(url);},
    accountCatalog:{
      list:async host=>{
        lists++;
        const catalog:AccountCatalog={authorityId:'fixture-vps',generation:'authority-1',revision:1,workspaceId:host.username,selectionRevision:0,accounts:[{id:'account-one',generation:'identity-1',provider:'codex',status:'authenticated',email:'fixture@example.invalid',observedAt:new Date().toISOString()}],availability:available?'ready':'unavailable'};
        if(host.role==='workspace')catalog.selectedAccountId='account-one';
        return catalog;
      },
      select:async()=>{throw new Error('Unexpected selection in authentication fixture');},
      start:async host=>{starts++;job={jobId:`00000000-0000-4000-8000-${String(starts).padStart(12,'0')}`,hostId:host.id,state:'awaiting-code',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),verificationUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-EFGH',cleanup:'pending'};return structuredClone(job);},
      status:async()=>structuredClone(job),
      cancel:async()=>{job={...job,state:'cancelled',cleanup:'confirmed',userCode:undefined,verificationUrl:undefined};return structuredClone(job);},
      dispose:async()=>{disposed=true;},
    },
  };
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials used');},decrypt:()=>''}),actions,()=>{});
  const host=await controller.call('host/save',{host:{id:role,name:'Synthetic '+role,hostname:'vps.example.test',port:22,username:role==='admin'?'root':'member',role,identityFile:path.join(directory,'identity-reference'),knownHostsFile:path.join(directory,'known-hosts-reference')}}) as SshHost;
  return {directory,store,controller,host,actions,opened,starts:()=>starts,lists:()=>lists,disposed:()=>disposed,setAvailable:(value:boolean)=>{available=value;},getJob:()=>structuredClone(job),setJob:(patch:Partial<CodexAuthJob>)=>{job={...job,...patch};},close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('shared Codex login allows saved administrators but rejects missing or mislabeled root identities',async()=>{
  const f=await fixture('workspace');try{
    await assert.rejects(f.controller.call('codex-auth/start',{id:'missing',host:f.host}),/不存在/);
    const root=await f.controller.call('host/save',{host:{...f.host,id:'root-workspace',username:'root'}}) as SshHost;
    await assert.rejects(f.controller.call('codex-auth/start',{id:root.id}),/管理员/);
    await assert.rejects(f.controller.call('accounts/list',{id:root.id}),/管理员/);
    await assert.rejects(f.controller.call('codex-auth/start',{id:f.host.id}),/管理员/);
    assert.equal(f.starts(),0);
    const admin=await f.controller.call('host/save',{host:{...f.host,id:'admin',role:'admin',username:'root'}}) as SshHost;
    const result=await f.controller.call('codex-auth/start',{id:admin.id}) as CodexAuthJob;
    assert.equal(result.hostId,admin.id);assert.equal(f.starts(),1);
    assert.equal(f.store.snapshot().accountCatalogs?.[admin.id]?.availability,'ready');
    assert.equal(JSON.stringify(f.store.snapshot()).includes('ABCD-EFGH'),false);
  }finally{await f.close();}
});

test('active Codex authorization freezes connection identity, can cancel, and never opens renderer URLs',async()=>{
  const f=await fixture();try{
    const job=await f.controller.call('codex-auth/start',{id:f.host.id}) as CodexAuthJob;
    await assert.rejects(f.controller.call('host/save',{host:{...f.host,hostname:'other.example.test'}}),/先取消/);
    await f.controller.call('host/save',{host:{...f.host,name:'Renamed workspace'}});
    await assert.rejects(f.controller.call('codex-auth/status',{id:f.host.id,jobId:'wrong-job'}),/不一致/);
    await f.controller.call('codex-auth/open',{id:f.host.id,jobId:job.jobId,url:'https://attacker.example.test'});
    assert.deepEqual(f.opened,['https://auth.openai.com/codex/device']);
    f.setJob({verificationUrl:'https://attacker.example.test' as CodexAuthJob['verificationUrl']});
    await assert.rejects(f.controller.call('codex-auth/open',{id:f.host.id,jobId:job.jobId}),/有效/);
    f.setJob({verificationUrl:'https://auth.openai.com/codex/device',expiresAt:new Date(0).toISOString()});
    await assert.rejects(f.controller.call('codex-auth/open',{id:f.host.id,jobId:job.jobId}),/有效/);
    f.setJob({state:'cancelled',cleanup:'unconfirmed'});
    await f.controller.call('codex-auth/status',{id:f.host.id,jobId:job.jobId});
    await assert.rejects(f.controller.call('host/save',{host:{...f.host,hostname:'other.example.test'}}),/先取消/);
    await f.controller.call('codex-auth/cancel',{id:f.host.id,jobId:job.jobId});
    await f.controller.call('host/save',{host:{...f.host,hostname:'other.example.test'}});
    await assert.rejects(f.controller.call('codex-auth/status',{id:f.host.id,jobId:job.jobId}),/不一致/);
  }finally{await f.close();}
});

test('login checks live shared service and never falls back when a cached catalog becomes unavailable',async()=>{
  const f=await fixture();try{
    await f.controller.call('accounts/list',{id:f.host.id});f.setAvailable(false);
    await assert.rejects(f.controller.call('codex-auth/start',{id:f.host.id}),/不可用/);
    assert.equal(f.lists(),2);assert.equal(f.starts(),0);
    assert.equal(f.store.snapshot().accountCatalogs?.[f.host.id]?.availability,'unavailable');
  }finally{await f.close();}
});

test('members cannot add accounts even during uncertain native sessions and disposal closes admission',async()=>{
  const f=await fixture('workspace');try{
    await f.controller.call('session/create',{runtime:'codex',hostId:f.host.id});
    await f.store.update(state=>{state.sessions[0]!.status='uncertain';});
    await assert.rejects(f.controller.call('codex-auth/start',{id:f.host.id}),/管理员/);
    assert.equal(f.starts(),0);
    await f.controller.dispose();assert.equal(f.disposed(),true);
    await assert.rejects(f.controller.call('accounts/list',{id:f.host.id}),/退出/);
  }finally{await f.close();}
});

test('authorization codes stay transient while public catalog metadata may persist',async()=>{
  const f=await fixture();try{
    const job=await f.controller.call('codex-auth/start',{id:f.host.id}) as CodexAuthJob;
    assert.equal(job.userCode,'ABCD-EFGH');
    for(const serialized of [JSON.stringify(await f.controller.call('state/get')),await readFile(path.join(f.directory,'state.json'),'utf8')]){
      assert.ok(!serialized.includes('ABCD-EFGH'));assert.ok(!serialized.includes(job.jobId));
      assert.ok(serialized.includes('fixture@example.invalid'));
    }
  }finally{await f.close();}
});

test('an asynchronous login start locks its saved identity until the service returns',async()=>{
  const f=await fixture();try{
    const entered=deferred<void>();const completion=deferred<void>();const start=f.actions.accountCatalog!.start;
    f.actions.accountCatalog!.start=async host=>{const value=await start(host);entered.resolve();await completion.promise;return value;};
    const request=f.controller.call('codex-auth/start',{id:f.host.id});await entered.promise;
    await assert.rejects(f.controller.call('host/save',{host:{...f.host,username:'different-user'}}),/先取消/);
    await assert.rejects(f.controller.call('codex-auth/start',{id:f.host.id}),/账号操作/);
    completion.resolve();await request;assert.equal(f.starts(),1);
  }finally{await f.close();}
});

test('a status response arriving after cancellation cannot revive the old authorization',async()=>{
  const f=await fixture();try{
    const job=await f.controller.call('codex-auth/start',{id:f.host.id}) as CodexAuthJob;
    const completion=deferred<CodexAuthJob>();const status=f.actions.accountCatalog!.status;let first=true;
    f.actions.accountCatalog!.status=async(host,id)=>{if(first){first=false;return completion.promise;}return status(host,id);};
    const late=f.controller.call('codex-auth/status',{id:f.host.id,jobId:job.jobId});
    const settled=late.then(value=>({value:value as CodexAuthJob}),error=>({error}));
    await f.controller.call('codex-auth/cancel',{id:f.host.id,jobId:job.jobId});completion.resolve(job);
    const result=await settled;
    assert.ok('error' in result||result.value.state==='cancelled','late awaiting-code status must not resurrect a confirmed cancellation');
    await f.controller.call('host/save',{host:{...f.host,hostname:'after-cleanup.example.test'}});
  }finally{await f.close();}
});

test('a status request started during cancellation cannot discard confirmed cleanup',async()=>{
  const f=await fixture();try{
    const job=await f.controller.call('codex-auth/start',{id:f.host.id}) as CodexAuthJob;
    const entered=deferred<void>();const completion=deferred<void>();const cancel=f.actions.accountCatalog!.cancel;
    f.actions.accountCatalog!.cancel=async(host,id)=>{entered.resolve();await completion.promise;return cancel(host,id);};
    const request=f.controller.call('codex-auth/cancel',{id:f.host.id,jobId:job.jobId});await entered.promise;
    await f.controller.call('codex-auth/status',{id:f.host.id,jobId:job.jobId}).catch(()=>undefined);
    completion.resolve();
    const result=await request as CodexAuthJob;
    assert.equal(result.state,'cancelled');assert.equal(result.cleanup,'confirmed');
    await f.controller.call('host/save',{host:{...f.host,hostname:'after-concurrent-cleanup.example.test'}});
  }finally{await f.close();}
});

test('current authorization restores only its saved connection from memory and returns a detached copy',async()=>{
  const f=await fixture();try{
    assert.equal(await f.controller.call('codex-auth/current',{id:f.host.id}),null);
    await assert.rejects(f.controller.call('codex-auth/current',{id:'missing'}),/不存在/);
    const job=await f.controller.call('codex-auth/start',{id:f.host.id}) as CodexAuthJob;
    const other=await f.controller.call('host/save',{host:{...f.host,id:'separate-connection',name:'Separate connection'}}) as SshHost;
    f.actions.accountCatalog!.status=async()=>{throw new Error('A memory read must not poll the VPS');};
    f.actions.accountCatalog!.list=async()=>{throw new Error('A memory read must not refresh accounts');};
    const restored=await f.controller.call('codex-auth/current',{id:f.host.id}) as CodexAuthJob;
    assert.deepEqual(restored,job);
    restored.state='failed';restored.userCode='MUTATED-COPY';
    assert.deepEqual(await f.controller.call('codex-auth/current',{id:f.host.id}),job);
    assert.equal(await f.controller.call('codex-auth/current',{id:other.id}),null);
    await f.controller.call('host/save',{host:{...f.host,name:'Renamed during authorization'}});
    assert.deepEqual(await f.controller.call('codex-auth/current',{id:f.host.id}),job);
    assert.equal(f.lists(),1);
  }finally{await f.close();}
});

test('current authorization restores uncertain cancellation without exposing a reusable code',async()=>{
  const f=await fixture();try{
    const job=await f.controller.call('codex-auth/start',{id:f.host.id}) as CodexAuthJob;
    const cancel=f.actions.accountCatalog!.cancel;
    f.actions.accountCatalog!.cancel=async()=>{throw new Error('Synthetic cancellation transport failure');};
    await assert.rejects(f.controller.call('codex-auth/cancel',{id:f.host.id,jobId:job.jobId}),/transport failure/);
    const restored=await f.controller.call('codex-auth/current',{id:f.host.id}) as CodexAuthJob;
    assert.equal(restored.jobId,job.jobId);assert.equal(restored.state,'cancelled');assert.equal(restored.cleanup,'unconfirmed');
    assert.equal(restored.userCode,undefined);assert.equal(restored.verificationUrl,undefined);
    const staleStatus=await f.controller.call('codex-auth/status',{id:f.host.id,jobId:job.jobId}) as CodexAuthJob;
    assert.equal(staleStatus.state,'cancelled');assert.equal(staleStatus.cleanup,'unconfirmed');assert.equal(staleStatus.userCode,undefined);
    await assert.rejects(f.controller.call('host/save',{host:{...f.host,username:'different-user'}}),/先取消/);
    await assert.rejects(f.controller.call('codex-auth/start',{id:f.host.id}),/账号操作|取消清理/);
    f.actions.accountCatalog!.cancel=cancel;
    const confirmed=await f.controller.call('codex-auth/cancel',{id:f.host.id,jobId:job.jobId}) as CodexAuthJob;
    assert.equal(confirmed.state,'cancelled');assert.equal(confirmed.cleanup,'confirmed');
    await f.controller.call('host/save',{host:{...f.host,username:'different-user'}});
    assert.equal(await f.controller.call('codex-auth/current',{id:f.host.id}),null);
  }finally{await f.close();}
});
