import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {AccountCatalog,SharedAccount,SshHost} from '../packages/contracts';
import type {SshRunner} from '../packages/ssh-transport';
import {NativeRuntimeControl} from '../packages/workspace-control/native-runtime';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';

const host:SshHost={id:'fixture-admin',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'g'};
const reply=(value:unknown,ok=true)=>({exitCode:0,signal:null,stderr:'',stdout:JSON.stringify(ok?{ok,value}:{ok:false,error:value})});
async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-claude-recreate-')),accounts=new Map<string,SharedAccount>(),calls:any[]=[];
 let revision=3,override:undefined|SshRunner;
 const catalog=():AccountCatalog=>({source:'native-owner',availability:'ready',authorityId:'fixture',generation:'g',revision,workspaceId:'administrator',selectionRevision:0,accounts:[...accounts.values()]});
 const runner:SshRunner=async(h,c,o)=>{
  const request=JSON.parse(o!.stdin!);calls.push(request);
  if(override)return override(h,c,o);
  const p=request.params;
  if(request.method==='runtime/remove'){
   const account=accounts.get(p.accountId);assert.ok(account);assert.equal(p.accountGeneration,account.generation);assert.equal(p.expectedRevision,revision);assert.equal(p.confirm,true);
   accounts.delete(p.accountId);revision++;return reply({removed:p.accountId,accountGeneration:p.accountGeneration});
  }
  assert.equal(request.method,'runtime/claude-create');const id='claude-'+p.requestId,existing=accounts.get(id);
  if(existing)return reply(existing);
  if(p.expectedRevision!==revision)return reply('STALE_SELECTION',false);
  const account:SharedAccount={id,provider:'claude',generation:'generation-'+(++revision),status:'unauthenticated',observedAt:new Date().toISOString()};accounts.set(id,account);return reply(account);
 };
 const service=()=>new NativeRuntimeControl(directory,runner);
 const journal=async()=>{const folder=path.join(directory,'native-account-requests'),files=await readdir(folder);return files.filter(f=>f.endsWith('.json')).map(file=>path.join(folder,file));};
 return {directory,accounts,calls,catalog,runner,service,journal,setRevision:(n:number)=>{revision=n;},override:(next?:SshRunner)=>{override=next;},close:()=>rm(directory,{recursive:true,force:true})};
}

test('create, remove, restart and re-add retires the stale journal without restoring the deleted identity',async()=>{
 const f=await fixture();try{
  const first=await f.service().createClaude(host,f.catalog());const oldRequest=f.calls[0].params;
  await f.service().remove(host,f.catalog(),first.accountId);assert.equal(f.accounts.size,0);
  const second=await f.service().createClaude(host,f.catalog());
  assert.notEqual(second.accountId,first.accountId);assert.equal(f.accounts.size,1);
  assert.equal(f.calls.length,4);assert.deepEqual(f.calls[2].params,oldRequest);
  assert.equal(f.calls[3].params.expectedRevision,5);assert.notEqual(f.calls[3].params.requestId,oldRequest.requestId);
  assert.deepEqual(JSON.parse(await readFile((await f.journal())[0]!,'utf8')),{requestId:f.calls[3].params.requestId,expectedRevision:5});
 }finally{await f.close();}
});

test('a definitive stale first create does not loop and the next explicit refreshed create can proceed',async()=>{
 const f=await fixture();try{
  const stale=f.catalog();f.setRevision(4);
  await assert.rejects(f.service().createClaude(host,stale),/账号目录已变化/);assert.equal(f.calls.length,1);assert.equal(f.accounts.size,0);
  assert.deepEqual(await f.journal(),[]);
  await f.service().createClaude(host,f.catalog());assert.equal(f.accounts.size,1);assert.notEqual(f.calls[0].params.requestId,f.calls[1].params.requestId);
 }finally{await f.close();}
});

test('a second catalog race is bounded and leaves no poisoned create journal',async()=>{
 const f=await fixture();try{
  await f.service().createClaude(host,f.catalog());f.accounts.clear();f.setRevision(6);
  f.override(async()=>reply('STALE_SELECTION',false));
  await assert.rejects(f.service().createClaude(host,f.catalog()),/账号目录已变化/);
  assert.equal(f.calls.length,3);assert.deepEqual(await f.journal(),[]);
 }finally{await f.close();}
});

test('uncertain transport, malformed receipts and nonzero exits never retire or replay the request',async()=>{
 for(const failure of ['transport','localized-error','nonzero','malformed','wrong-id','other-rejection']){
  const f=await fixture();try{
   f.override(async()=>{
    if(failure==='transport')throw Error('Fixture disconnected');
    if(failure==='localized-error')throw Error('账号目录已变化，请刷新后重新确认。');
    if(failure==='nonzero')return {...reply('STALE_SELECTION',false),exitCode:1};
    if(failure==='malformed')return {...reply(null),stdout:'not-json'};
    if(failure==='wrong-id')return reply({id:'claude-foreign',provider:'claude'});
    return reply('STALE_AUTHORITY',false);
   });
   await assert.rejects(f.service().createClaude(host,f.catalog()));assert.equal(f.calls.length,1);
   const saved=await readFile((await f.journal())[0]!,'utf8');f.setRevision(6);
   await assert.rejects(f.service().createClaude(host,f.catalog()));assert.equal(f.calls.length,2);
   assert.deepEqual(f.calls[0].params,f.calls[1].params);assert.equal(await readFile((await f.journal())[0]!,'utf8'),saved);
  }finally{await f.close();}
 }
});

test('an existing remote account recovers the old request despite a newer catalog revision',async()=>{
 const f=await fixture();try{
  f.override(async()=>{throw Error('Fixture lost reply');});await assert.rejects(f.service().createClaude(host,f.catalog()));
  const p=f.calls[0].params,id='claude-'+p.requestId;
  f.accounts.set(id,{id,provider:'claude',generation:'recovered',status:'unauthenticated',observedAt:new Date().toISOString()});f.setRevision(9);f.override();
  const result=await f.service().createClaude(host,{...f.catalog(),accounts:[]});
  assert.equal(result.accountId,id);assert.deepEqual(f.calls[0].params,f.calls[1].params);assert.equal(f.accounts.size,1);
 }finally{await f.close();}
});

test('corrupt recovery metadata stays untouched and never reaches the remote service',async()=>{
 const f=await fixture();try{
  f.override(async()=>{throw Error('Fixture loss');});await assert.rejects(f.service().createClaude(host,f.catalog()));
  const target=(await f.journal())[0]!;await writeFile(target,'{"requestId":"invalid"}');
  await assert.rejects(f.service().createClaude(host,f.catalog()),/恢复记录无效/);assert.equal(f.calls.length,1);assert.equal(await readFile(target,'utf8'),'{"requestId":"invalid"}');
 }finally{await f.close();}
});

test('a concurrent journal change is preserved after a definitive rejection',async()=>{
 const f=await fixture();try{
  f.override(async()=>{throw Error('Fixture loss');});await assert.rejects(f.service().createClaude(host,f.catalog()));
  const target=(await f.journal())[0]!,replacement=JSON.stringify({requestId:'11111111-1111-4111-8111-111111111111',expectedRevision:9});f.setRevision(9);
  f.override(async()=>{await writeFile(target,replacement);return reply('STALE_SELECTION',false);});
  await assert.rejects(f.service().createClaude(host,f.catalog()),/恢复记录已变化/);
  assert.equal(f.calls.length,2);assert.equal(await readFile(target,'utf8'),replacement);
 }finally{await f.close();}
});

test('approved plugins call, extend and replace the actual create consumer across delete and reactivation',async()=>{
 const f=await fixture(),store=new StateStore(f.directory);await store.load();
 await store.update(state=>{state.hosts=[host,{...host,id:'fixture-member',role:'workspace',username:'member'}];state.accountCatalogs={[host.id]:f.catalog(),'fixture-member':f.catalog()};});
 const plugins=new PluginRegistry(path.join(f.directory,'plugins'));await plugins.initialize();
 const controller=new WorkbenchController(store,new SecretStore(f.directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{
  pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],nativeAccounts:f.service(),
  accountCatalog:{list:async()=>f.catalog(),select:async()=>{throw Error('No selection');},start:async()=>{throw Error('No login');},status:async()=>{throw Error('No login');},cancel:async()=>{throw Error('No login');},dispose:async()=>{}},
 },()=>{});
 for(const [id,service] of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
 plugins.connectHost(request=>controller.call(request.method,request.payload));
 const install=async(id:string,source:string)=>{
  const manifest={schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic native create recovery',capabilities:['host'],main:'main.mjs'};
  const file=path.join(f.directory,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
  await plugins.importZip(file);return (await plugins.list()).find(item=>item.manifest.id===id)!;
 };
 let finish:undefined|(()=>void);
 try{
  const observer=await install('test.create-observer',`export function activate(api){let hits=0;api.services.intercept('actions.native-accounts','createClaude',(next,...args)=>{hits++;return next(...args);});api.registerCommand('hits',()=>hits);}`);
  const workflow=await install('test.create-workflow',`export function activate(api){
   api.registerCommand('create',p=>api.call('native-accounts/create-claude',p));
   api.services.override('actions.native-accounts',{loginCommand:async()=>({command:'fixture auth login'})});
  }`);
  await assert.rejects(plugins.setEnabled(workflow.manifest.id,workflow.hash,true),/Explicit approval/);
  await plugins.setEnabled(observer.manifest.id,observer.hash,true,true);await plugins.setEnabled(workflow.manifest.id,workflow.hash,true,true);
  await assert.rejects(plugins.command(workflow.manifest.id,'create',{id:'fixture-member'}),/管理员/);assert.equal(f.calls.length,0);
  const first=await plugins.command(workflow.manifest.id,'create',{id:host.id}) as {accountId:string};
  assert.equal(store.snapshot().accountCatalogs![host.id]!.accounts[0]!.id,first.accountId);
  assert.deepEqual(await controller.call('native-accounts/login-command',{id:host.id,accountId:first.accountId}),{command:'fixture auth login'});
  await controller.call('native-accounts/remove',{id:host.id,accountId:first.accountId,confirm:true});
  assert.equal(store.snapshot().accountCatalogs![host.id]!.accounts.length,0);
  let entered!:()=>void;const inFlight=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{finish=r;});
  f.override(async(h,c,o)=>{entered();await hold;f.override();return f.runner(h,c,o);});
  const pending=plugins.command(workflow.manifest.id,'create',{id:host.id}) as Promise<{accountId:string}>;await inFlight;
  await assert.rejects(controller.call('native-accounts/create-claude',{id:host.id}),/正在创建/);
  await plugins.setEnabled(workflow.manifest.id,workflow.hash,false);finish!();const second=await pending;
  assert.notEqual(second.accountId,first.accountId);assert.equal(f.accounts.size,1);
  await assert.rejects(plugins.command(workflow.manifest.id,'create',{id:host.id}),/not found/);
  f.override(async()=>reply({command:'restored auth login'}));
  assert.deepEqual(await controller.call('native-accounts/login-command',{id:host.id,accountId:second.accountId}),{command:'restored auth login'});f.override();
  await plugins.setEnabled(workflow.manifest.id,workflow.hash,true);
  await controller.call('native-accounts/remove',{id:host.id,accountId:second.accountId,confirm:true});
  const third=await plugins.command(workflow.manifest.id,'create',{id:host.id}) as {accountId:string};assert.notEqual(third.accountId,second.accountId);
  assert.equal(await plugins.command(observer.manifest.id,'hits',{}),4);
  await plugins.setEnabled(observer.manifest.id,observer.hash,false);await plugins.setEnabled(workflow.manifest.id,workflow.hash,false);
  const broken=await install('test.create-failed',`export function activate(api){api.services.override('actions.native-accounts',{createClaude:()=>{throw Error('Must be removed');}});throw Error('Synthetic activation failure');}`);
  await plugins.setEnabled(broken.manifest.id,broken.hash,true,true);assert.equal((await plugins.list()).find(p=>p.manifest.id===broken.manifest.id)!.enabled,false);
  const fourth=await controller.call('native-accounts/create-claude',{id:host.id}) as {accountId:string};assert.notEqual(fourth.accountId,third.accountId);assert.equal(f.accounts.size,2);
 }finally{finish?.();await plugins.dispose();await controller.dispose();await f.close();}
});
