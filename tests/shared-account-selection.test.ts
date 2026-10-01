import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchController, type HostActions } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import type { AccountCatalog, Session, SshHost } from '../packages/contracts';
import { selectedSharedAccountRef } from '../packages/account-selection';

type CatalogService=NonNullable<HostActions['accountCatalog']>;
type SelectionInput=Parameters<CatalogService['select']>[1];
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

async function fixture(){
  const directory=await mkdtemp(path.join(os.tmpdir(),'aw-account-selection-'));
  const store=new StateStore(directory);await store.load();
  const catalogs=new Map<string,AccountCatalog>();
  const calls:{lists:string[];selections:Array<{host:SshHost;input:SelectionInput}>}={lists:[],selections:[]};
  const service:CatalogService={
    list:async host=>{calls.lists.push(host.id);return structuredClone(catalogs.get(host.id)!);},
    select:async(host,input)=>{
      calls.selections.push({host:structuredClone(host),input:structuredClone(input)});
      const old=catalogs.get(host.id)!;
      if(input.authorityId!==old.authorityId||input.generation!==old.generation)throw new Error('Authority generation conflict');
      if(input.expectedRevision!==old.selectionRevision)throw new Error('Selection revision conflict');
      const next={...old,selectedAccountId:input.accountId,selectionRevision:old.selectionRevision+1,revision:old.revision+1};
      catalogs.set(host.id,next);return structuredClone(next);
    },
    start:async()=>{throw new Error('Unexpected authentication in selection fixture');},
    status:async()=>{throw new Error('No authorization job');},cancel:async()=>{throw new Error('No authorization job');},dispose:async()=>{},
  };
  const actions:HostActions={pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],accountCatalog:service};
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw new Error('No credentials used');},decrypt:()=>''}),actions,()=>{});
  async function addHost(id:string,role:SshHost['role']='workspace'){
    const host=await controller.call('host/save',{host:{id,name:id,hostname:'same-vps.example.test',port:22,username:role==='admin'?'root':id,role,identityFile:path.join(directory,`${id}-key-reference`),knownHostsFile:path.join(directory,'known-hosts-reference')}}) as SshHost;
    catalogs.set(id,{authorityId:'same-vps-authority',generation:'server-generation-1',revision:3,workspaceId:host.username,selectionRevision:5,...(role==='workspace'?{selectedAccountId:'account-one'}:{}),accounts:[
      {id:'account-one',generation:'identity-one',provider:'codex',status:'authenticated',email:'one@example.invalid',observedAt:'2026-09-24T00:00:00Z'},
      {id:'account-two',generation:'identity-two',provider:'codex',status:'authenticated',email:'two@example.invalid',observedAt:'2026-09-24T00:00:00Z'},
    ],availability:'ready'});
    return host;
  }
  const a=await addHost('workspace-a');const b=await addHost('workspace-b');
  return {directory,store,controller,service,catalogs,calls,a,b,addHost,
    list:async(host:SshHost)=>await controller.call('accounts/list',{id:host.id}) as AccountCatalog,
    select:async(host:SshHost,accountId:string,expectedRevision:number)=>await controller.call('accounts/select',{id:host.id,accountId,expectedRevision}) as AccountCatalog,
    close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});},
  };
}

test('workspace defaults persist independently while old sessions retain their original account',async()=>{
  const f=await fixture();try{
    const a=await f.list(f.a);const b=await f.list(f.b);
    const first=await f.controller.call('session/create',{runtime:'codex',hostId:f.a.id,accountRef:selectedSharedAccountRef(a)}) as Session;
    const switched=await f.select(f.a,'account-two',a.selectionRevision);
    assert.deepEqual(f.store.snapshot().accountCatalogs?.[f.b.id],b);
    assert.equal(f.catalogs.get(f.b.id)?.selectedAccountId,'account-one');
    assert.equal(f.store.snapshot().sessions.find(session=>session.id===first.id)?.binding.accountRef,selectedSharedAccountRef(a));
    const second=await f.controller.call('session/create',{runtime:'codex',hostId:f.a.id}) as Session;
    const other=await f.controller.call('session/create',{runtime:'codex',hostId:f.b.id}) as Session;
    assert.equal(second.binding.accountRef,selectedSharedAccountRef(switched));assert.equal(other.binding.accountRef,selectedSharedAccountRef(b));
    assert.equal(first.status,'blocked');assert.equal(second.status,'blocked');
    await assert.rejects(f.controller.call('draft/prepare',{sessionId:second.id,text:'synthetic task'}),/H 原生桥/);
    const reloaded=new StateStore(f.directory);await reloaded.load();
    assert.equal(reloaded.snapshot().accountCatalogs?.[f.a.id]?.selectedAccountId,'account-two');
    assert.equal(reloaded.snapshot().accountCatalogs?.[f.b.id]?.selectedAccountId,'account-one');
    assert.equal(reloaded.snapshot().sessions.find(session=>session.id===first.id)?.binding.accountRef,first.binding.accountRef);
    assert.deepEqual(f.calls.selections[0]?.input,{accountId:'account-two',expectedRevision:5,authorityId:a.authorityId,generation:a.generation});
  }finally{await f.close();}
});

test('unverified or stale renderer account references cannot bind a new session',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.controller.call('session/create',{runtime:'codex',hostId:f.a.id,accountRef:'forged-account-ref'}),/核实/);
    const unverified=await f.controller.call('session/create',{runtime:'codex',hostId:f.a.id}) as Session;
    assert.equal(unverified.status,'blocked');assert.equal(unverified.binding.accountRef,'native-vps-profile-unverified');
    const before=await f.list(f.a);
    f.catalogs.set(f.a.id,{...f.catalogs.get(f.a.id)!,selectedAccountId:'account-two',selectionRevision:6});
    const count=f.store.snapshot().sessions.length;
    await assert.rejects(f.controller.call('session/create',{runtime:'codex',hostId:f.a.id,accountRef:selectedSharedAccountRef(before)}),/账号.*变更/);
    assert.equal(f.store.snapshot().sessions.length,count);
    assert.equal(f.store.snapshot().sessions.find(session=>session.id===unverified.id)?.binding.accountRef,'native-vps-profile-unverified');
    await assert.rejects(f.controller.call('session/create',{runtime:'claude',hostId:f.a.id,accountRef:selectedSharedAccountRef(before)}),/核实/);
  }finally{await f.close();}
});

test('server compare-and-swap conflicts never replay and require an explicit refresh',async()=>{
  const f=await fixture();try{
    const before=await f.list(f.a);
    f.catalogs.set(f.a.id,{...f.catalogs.get(f.a.id)!,selectionRevision:before.selectionRevision+1});
    await assert.rejects(f.select(f.a,'account-two',before.selectionRevision),/revision conflict/);
    assert.equal(f.calls.selections.length,1);
    assert.equal(f.store.snapshot().accountCatalogs?.[f.a.id]?.availability,'unavailable');
    assert.equal(f.store.snapshot().accountCatalogs?.[f.a.id]?.reason,'selection-unconfirmed');
    await assert.rejects(f.select(f.a,'account-two',before.selectionRevision+1),/读取可用/);assert.equal(f.calls.selections.length,1);
    const current=await f.list(f.a);await f.select(f.a,'account-two',current.selectionRevision);assert.equal(f.calls.selections.length,2);
  }finally{await f.close();}
});

test('administrators may inspect the catalog but cannot select a workspace default',async()=>{
  const f=await fixture();try{
    const admin=await f.addHost('admin','admin');const catalog=await f.list(admin);assert.equal(catalog.accounts.length,2);
    await assert.rejects(f.select(admin,'account-two',catalog.selectionRevision),/管理员/);assert.equal(f.calls.selections.length,0);
    const a=await f.list(f.a);
    await assert.rejects(f.select(f.a,'missing-account',a.selectionRevision),/不可用/);
    await assert.rejects(f.select(f.a,'account-two',a.selectionRevision-1),/版本/);assert.equal(f.calls.selections.length,0);
  }finally{await f.close();}
});

test('late catalogs cannot attach after SSH identity changes or supersede a newer read',async()=>{
  const f=await fixture();try{
    const old=structuredClone(f.catalogs.get(f.a.id)!);const first=deferred<AccountCatalog>();f.service.list=async()=>first.promise;
    const request=f.controller.call('accounts/list',{id:f.a.id});const refused=assert.rejects(request,/身份已变更/);
    await f.controller.call('host/save',{host:{...f.a,hostname:'different-vps.example.test'}});first.resolve(old);await refused;
    assert.equal(f.store.snapshot().accountCatalogs?.[f.a.id],undefined);
    const slow=deferred<AccountCatalog>();const latest={...old,selectedAccountId:'account-two',selectionRevision:6};let calls=0;
    f.service.list=async()=>++calls===1?slow.promise:latest;
    const stale=f.controller.call('accounts/list',{id:f.a.id});const outdated=assert.rejects(stale,/更新请求|最新/);
    await f.controller.call('accounts/list',{id:f.a.id});slow.resolve(old);await outdated;
    assert.equal(f.store.snapshot().accountCatalogs?.[f.a.id]?.selectedAccountId,'account-two');
  }finally{await f.close();}
});

test('pending selection locks same-workspace operations without blocking another workspace',async()=>{
  const f=await fixture();try{
    const a=await f.list(f.a);await f.list(f.b);
    const entered=deferred<void>();const release=deferred<void>();const select=f.service.select;
    f.service.select=async(host,input)=>{entered.resolve();await release.promise;return select(host,input);};
    const pending=f.select(f.a,'account-two',a.selectionRevision);await entered.promise;
    await assert.rejects(f.controller.call('accounts/list',{id:f.a.id}),/账号操作|操作|选择/);
    await assert.rejects(f.select(f.a,'account-one',a.selectionRevision),/账号操作|操作|选择/);
    await assert.rejects(f.controller.call('codex-auth/start',{id:f.a.id}),/账号操作/);
    await assert.rejects(f.controller.call('session/create',{runtime:'codex',hostId:f.a.id}),/账号操作/);
    await assert.rejects(f.controller.call('host/save',{host:{...f.a,hostname:'other.example.test'}}),/先取消/);
    assert.equal((await f.list(f.b)).selectedAccountId,'account-one');release.resolve();await pending;
    assert.equal(f.calls.selections.length,1);assert.equal(f.store.snapshot().accountCatalogs?.[f.a.id]?.selectedAccountId,'account-two');
  }finally{await f.close();}
});

test('mismatched selection receipts are rejected rather than trusted or replayed',async()=>{
  const f=await fixture();try{
    const original=await f.list(f.a);
    for(const altered of [{authorityId:'another-vps'},{generation:'another-generation'},{workspaceId:f.b.username},{selectedAccountId:'account-one'}]){
      await f.list(f.a);let calls=0;
      f.service.select=async()=>{calls++;return {...original,selectedAccountId:'account-two',selectionRevision:original.selectionRevision+1,...altered};};
      await assert.rejects(f.select(f.a,'account-two',original.selectionRevision),/回执.*不一致/);
      assert.equal(calls,1);assert.equal(f.store.snapshot().accountCatalogs?.[f.a.id]?.availability,'unavailable');
    }
  }finally{await f.close();}
});

test('retired sessions do not lock the independent native default or change their original account',async()=>{
  const f=await fixture();try{
    const a=await f.list(f.a);const session=await f.controller.call('session/create',{runtime:'codex',hostId:f.a.id}) as Session;
    for(const status of ['running','uncertain'] as const){
      await f.store.update(state=>{state.sessions.find(item=>item.id===session.id)!.status=status;});
      const current=await f.list(f.a);await f.select(f.a,status==='running'?'account-two':'account-one',current.selectionRevision);
      assert.equal(f.store.snapshot().sessions.find(item=>item.id===session.id)!.binding.accountRef,session.binding.accountRef);
    }
    assert.equal(f.calls.selections.length,2);
  }finally{await f.close();}
});
