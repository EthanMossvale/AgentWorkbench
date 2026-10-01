import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import type {AccountCatalog,SshHost} from '../packages/contracts';
import type {SshRunner} from '../packages/ssh-transport';
import {NativeRuntimeControl,type NativeRuntimeStatus} from '../packages/workspace-control/native-runtime';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {quotaNativeSource} from '../packages/workspace-control/quota-native-source';

const host:SshHost={id:'fixture',name:'Synthetic fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture/no-key'),knownHostsFile:path.resolve('fixture/no-hosts'),ownerId:'owner',workspaceGeneration:'g'};
const catalog=():AccountCatalog=>({source:'native-owner',authorityId:'authority',generation:'generation',revision:3,workspaceId:'administrator',selectionRevision:1,claudeSelectionRevision:1,selectedAccountId:'codex',selectedClaudeAccountId:'claude',availability:'ready',accounts:['codex','claude'].map(provider=>({id:provider,generation:'account-generation',provider:provider as 'codex'|'claude',status:'authenticated',observedAt:new Date().toISOString()}))});
const status:NativeRuntimeStatus={accountId:'claude',provider:'claude',installed:true,authenticated:true,versionMatched:true,execution:'local-tools-unverified',block:null};
const response=(value:unknown)=>({stdout:JSON.stringify({ok:true,value}),stderr:'',exitCode:0,signal:null});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

test('native status matches account provider and only returns public allowlisted fields',async()=>{
 let value:any={...status,access_token:'synthetic-secret',profilePath:'/private',block:{reason:'rate_limited',observedAt:100,secret:'synthetic-secret'}};
 const service=new NativeRuntimeControl('',async()=>response(value));
 const result=await service.status(host,catalog(),'claude');
 assert.equal(result.provider,'claude');assert.ok(!JSON.stringify(result).includes('synthetic-secret'));assert.ok(!JSON.stringify(result).includes('/private'));
 value={...status,provider:'codex'};await assert.rejects(service.status(host,catalog(),'claude'),/状态无效/);
 value={...status,accountId:'foreign'};await assert.rejects(service.status(host,catalog(),'claude'),/状态无效/);
});

test('uncertain Claude profile creation reuses durable operation identity after restart',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-native-create-'));const requests:any[]=[];
 const runner:SshRunner=async(_h,_c,options)=>{const request=JSON.parse(options!.stdin!);requests.push(request.params);if(requests.length===1)throw Error('Synthetic lost response');return response({id:'claude-'+request.params.requestId,provider:'claude'});};
 try{
  await assert.rejects(new NativeRuntimeControl(directory,runner).createClaude(host,catalog()),/lost response/);
  const service=new NativeRuntimeControl(directory,runner),created=await service.createClaude(host,{...catalog(),revision:4});
  assert.deepEqual(requests[0],requests[1]);assert.equal(created.accountId,'claude-'+requests[0].requestId);
  await service.createClaude(host,{...catalog(),revision:4});assert.deepEqual(requests[1],requests[2]);
  await service.createClaude(host,{...catalog(),revision:5,accounts:[...catalog().accounts,{...catalog().accounts[1]!,id:created.accountId}]});assert.notEqual(requests[2].requestId,requests[3].requestId);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('parallel create is rejected without issuing a second profile operation',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-native-create-')),entered=deferred<void>(),finish=deferred<void>();let count=0;
 const service=new NativeRuntimeControl(directory,async(_h,_c,options)=>{count++;entered.resolve();await finish.promise;return response({id:'claude-'+JSON.parse(options!.stdin!).params.requestId,provider:'claude'});});
 try{const pending=service.createClaude(host,catalog());await entered.promise;await assert.rejects(service.createClaude(host,catalog()),/正在创建/);assert.equal(count,1);finish.resolve();await pending;}
 finally{finish.resolve();await rm(directory,{recursive:true,force:true});}
});

test('native account mutations require administrator and do not accept legacy catalogs',async()=>{
 let calls=0;const service=new NativeRuntimeControl('',async()=>{calls++;return response(status);}),member={...host,role:'workspace' as const,username:'member'};
 await assert.rejects(service.createClaude(member,catalog()),/管理员/);
 await assert.rejects(service.loginCommand(member,catalog(),'claude'),/管理员/);
 await assert.rejects(service.status(member,catalog(),'claude',true),/管理员/);
 await assert.rejects(service.status(host,{...catalog(),source:'existing-codex'},'claude'),/统一运行/);
 assert.equal(calls,0);
});

async function controllerFixture(role:'admin'|'workspace'='admin'){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-native-management-')),store=new StateStore(directory);await store.load();
 const member={...host,role,username:role==='admin'?'root':'member'};let remote=catalog(),operation:(...args:any[])=>Promise<any>=async()=>status;
 const actions:HostActions={pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],nativeAccounts:{status:(...args)=>operation(...args),createClaude:(...args)=>operation(...args),loginCommand:(...args)=>operation(...args)},accountCatalog:{list:async()=>structuredClone(remote),select:async(_host,p)=>{const provider=remote.accounts.find(a=>a.id===p.accountId)!.provider;if(provider==='claude'){remote.selectedClaudeAccountId=p.accountId;remote.claudeSelectionRevision!++;}else{remote.selectedAccountId=p.accountId;remote.selectionRevision++;}return structuredClone(remote);},start:async()=>{throw Error('No login in fixture');},status:async()=>{throw Error('No login in fixture');},cancel:async()=>{throw Error('No login in fixture');},dispose:async()=>{}}};
 await store.update(s=>{s.hosts=[member];s.accountCatalogs={[member.id]:structuredClone(remote)};});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets used');},decrypt:()=>''}),actions,()=>{});
 return {store,controller,host:member,remote,operation:(fn:typeof operation)=>{operation=fn;},close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('management rejects late responses after host source or account identity changes',async()=>{
 for(const change of ['host','source','account'] as const){const f=await controllerFixture(),entered=deferred<void>(),finish=deferred<void>();try{
  f.operation(async()=>{entered.resolve();await finish.promise;return status;});
  const pending=f.controller.call('native-accounts/status',{id:f.host.id,accountId:'claude'});await entered.promise;
  await f.store.update(s=>{if(change==='host')s.hosts[0]!.hostname='changed.invalid';else if(change==='source')s.accountCatalogs![f.host.id]!.source='existing-codex';else s.accountCatalogs![f.host.id]!.accounts[1]!.generation='changed';});
  finish.resolve();await assert.rejects(pending,/身份已变化/);
 }finally{finish.resolve();await f.close();}}
});

test('fresh catalog revocation invalidates native status before it reaches the renderer',async()=>{
 const f=await controllerFixture();try{f.operation(async()=>{f.remote.accounts=[];return status;});await assert.rejects(f.controller.call('native-accounts/status',{id:f.host.id,accountId:'claude'}),/身份已变化/);}finally{await f.close();}
});

test('provider defaults remain independent while old managed session identity stays fixed',async()=>{
 const f=await controllerFixture('workspace');try{
  let calls=0;f.operation(async()=>{calls++;return status;});await assert.rejects(f.controller.call('native-accounts/create-claude',{id:f.host.id}),/管理员/);assert.equal(calls,0);
  const session:any=await f.controller.call('session/create',{runtime:'codex',hostId:f.host.id});
  const original=structuredClone(f.store.snapshot().sessions[0]!.binding);assert.equal(original.accountRuntime,'native-owner');
  f.remote.accounts.push({...f.remote.accounts[0]!,id:'second'});await f.controller.call('accounts/list',{id:f.host.id});
  await f.store.update(s=>{s.sessions[0]!.status='running';});
  await f.controller.call('accounts/select',{id:f.host.id,accountId:'second',expectedRevision:1,provider:'codex'});
  assert.deepEqual(f.store.snapshot().sessions[0]!.binding,original);assert.equal(f.store.snapshot().accountCatalogs![f.host.id]!.selectedClaudeAccountId,'claude');
  await f.store.update(s=>{s.sessions[0]!.status='idle';});
  await f.controller.call('session/create',{runtime:'claude',hostId:f.host.id});
  assert.match(f.store.snapshot().sessions.find(s=>s.binding.runtime==='claude')!.binding.accountRef,/\/claude\/claude\//);
 }finally{await f.close();}
});

test('native quota lookup cannot downgrade to legacy after service failure or missing account',()=>{
 const body=String.raw`
import sys,types
for name in ('pwd','fcntl'):
    try:__import__(name)
    except ImportError:sys.modules[name]=types.SimpleNamespace()
scope={'__name__':'fixture'}
exec(sys.stdin.read(),scope)
legacy=[]
scope['existing_catalog']=lambda request:legacy.append(request) or {'source':'existing-codex'}
scope['native_owner_request']=lambda request:{'ok':False}
try:scope['catalog_for_usage']({'source':'native-owner'})
except ValueError:pass
else:raise AssertionError('Missing native service must fail')
scope['native_owner_request']=lambda request:{'ok':True,'value':{'source':'native-owner','accounts':[]}}
assert scope['catalog_for_usage']({'source':'native-owner'})['accounts']==[]
assert not legacy
try:scope['catalog_for_usage']({'source':'existing-codex'})
except ValueError:pass
else:raise AssertionError('Retired source must fail without a call')
assert not legacy
`;
 const result=spawnSync('python',['-B','-c',body],{input:quotaNativeSource,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
});
