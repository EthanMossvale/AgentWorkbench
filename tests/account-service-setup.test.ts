import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {AccountServiceSetup,accountSetupScript} from '../packages/remote-account-catalog/setup';
import {spawnSync} from 'node:child_process';
import {RemoteAccountCatalogService} from '../packages/remote-account-catalog';
import {NativeRuntimeControl} from '../packages/workspace-control/native-runtime';
import type {AccountCatalog,SshHost} from '../packages/contracts';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';

const host:SshHost={id:'admin',name:'Fixture administrator',hostname:'fixture.invalid',port:22,username:'root',role:'admin',ownerId:'owner',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-known'),workspaceGeneration:'g'};

test('the actual desktop setup bundle installs the importable Claude session module',()=>{
 const encoded=accountSetupScript({method:'plan'}).match(/b64decode\('([^']+)'\)/)![1]!;
 const payload=JSON.parse(Buffer.from(encoded,'base64').toString());delete payload.sources['setup.py'];
 const result=spawnSync('python',['-B','-c',String.raw`
import sys,json,types
try: import fcntl
except ImportError: sys.modules['fcntl']=types.SimpleNamespace()
try: import pwd
except ImportError: sys.modules['pwd']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
import setup
sources=json.load(sys.stdin)
config,files=setup.deployment(sources,types.SimpleNamespace(pw_uid=2000),('fixture','g','/fixture/policy'),{'claude':'/fixture/claude'})
assert files[setup.CODE+'/claude_session.py']==sources['claude_session.py']
for name,content in files.items():
 if name.endswith('.py'):compile(content,name,'exec')
assert 'from claude_session import serve' in files[setup.CODE+'/broker.py']
`,path.resolve('services/vps-account-broker')],{input:JSON.stringify(payload.sources),encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
const response=(value:unknown)=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:true,value}),stderr:''});
const unavailable=()=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:false,error:'BROKER_UNAVAILABLE'}),stderr:''});
const account={id:'old-account',generation:'old-generation',provider:'codex' as const,status:'configured' as const,email:'old@example.invalid',observedAt:'2026-09-26T00:00:00Z'};
const native=():AccountCatalog=>({source:'native-owner',authorityId:'new',generation:'g',revision:1,workspaceId:'administrator',selectionRevision:0,availability:'ready',accounts:[]});
const legacy=():AccountCatalog=>({...native(),source:'existing-codex',authorityId:'old',generation:'old-g',policyRevision:2,accounts:[account]});
const plan=()=>({status:'installable',blockers:[],warnings:[],paths:['/opt/agent-workbench/account-runtime'],owner:'agent-workbench-accounts',binaries:{codex:'/usr/bin/codex'},authorityId:'new',generation:'g',policyPath:'/var/lib/agent-workbench-policy/workspaces.json',createOwner:true,planId:'a'.repeat(64)});
function setup(handler:(r:any)=>unknown,now?:()=>number){const calls:any[]=[];return {calls,service:new AccountServiceSetup(async(_h,_c,o)=>{const encoded=o!.stdin!.match(/b64decode\('([^']+)'\)/)![1]!;const payload=JSON.parse(Buffer.from(encoded,'base64').toString());calls.push(payload.request);assert.ok(payload.sources['broker.py']);return response(await handler(payload.request));},now)};}

test('native service unavailable preserves sanitized old metadata without making it usable',async()=>{
 const calls:any[]=[];const service=new RemoteAccountCatalogService({runner:async(_h,_c,o)=>{const r=JSON.parse(o!.stdin!);calls.push(r);return r.source==='existing-codex'?response({...legacy(),accounts:[{...account,access_token:'fixture-do-not-leak'}]}):unavailable();}});
 const value=await service.list(host);assert.equal(value.source,'native-owner');assert.equal(value.availability,'unavailable');assert.deepEqual(value.accounts,[]);assert.equal(value.legacy?.accounts[0]?.email,account.email);assert.ok(!JSON.stringify(value).includes('fixture-do-not-leak'));
 await assert.rejects(service.start(host),/不会回退/);assert.ok(calls.every(c=>c.method==='catalog/list'));
});

test('legacy public discovery never becomes an authentication authority or overwrites native selection',async()=>{
 const calls:any[]=[];const service=new RemoteAccountCatalogService({runner:async(_h,_c,o)=>{const r=JSON.parse(o!.stdin!);calls.push(r);return r.source==='existing-codex'?response(legacy()):r.method==='catalog/list'?response({...native(),accounts:[{...account,status:'authenticated'}],selectedAccountId:account.id}):unavailable();}});
 const value=await service.list(host);assert.equal(value.authorityId,'new');assert.equal(value.selectedAccountId,account.id);assert.equal(value.legacy?.authorityId,'old');
 await service.list(host,'existing-codex');await assert.rejects(service.start(host));assert.equal(calls.at(-1).method,'login/start');assert.equal(calls.at(-1).params.authorityId,'new');
});

test('missing legacy service does not hide a ready native account source',async()=>{
 const service=new RemoteAccountCatalogService({runner:async(_h,_c,o)=>JSON.parse(o!.stdin!).source==='existing-codex'?unavailable():response(native())});
 const value=await service.list(host);assert.equal(value.availability,'ready');assert.equal(value.legacy?.availability,'unavailable');
});

test('setup requires a current administrator preview bound to the complete SSH identity',async()=>{
 const f=setup(r=>r.method==='plan'?plan():{status:'ready',authorityId:'new',generation:'g'});
 await assert.rejects(f.service.plan({...host,role:'workspace'}),/root/);assert.equal(f.calls.length,0);
 const p=await f.service.plan(host);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'plan');
 await assert.rejects(f.service.apply({...host,identityFile:path.resolve('another-key')},p.id),/连接/);assert.equal(f.calls.length,1);
 assert.equal((await f.service.apply(host,p.id)).status,'ready');await assert.rejects(f.service.apply(host,p.id),/过期/);assert.equal(f.calls.length,2);
});

test('setup expires old previews and rejected responses cannot claim readiness',async()=>{
 let now=0;const f=setup(r=>r.method==='plan'?plan():{status:'ready',authorityId:'other',generation:'g'},()=>now);
 const p=await f.service.plan(host);now=300001;await assert.rejects(f.service.apply(host,p.id),/过期/);
 const fresh=await f.service.plan(host);await assert.rejects(f.service.apply(host,fresh.id),/未确认/);
});

test('blocked setup has no apply permission and an unknown apply receipt is not retried',async()=>{
 const blocked=setup(()=>({...plan(),status:'blocked',blockers:['OWNER_CONFLICT']}));const p=await blocked.service.plan(host);await assert.rejects(blocked.service.apply(host,p.id),/过期/);
 let applyCount=0;const f=setup(r=>{if(r.method==='plan')return plan();applyCount++;throw Error('lost fixture receipt');});const current=await f.service.plan(host);await assert.rejects(f.service.apply(host,current.id));await assert.rejects(f.service.apply(host,current.id));assert.equal(applyCount,1);
});

test('legacy enrollment sends public identity once to the native owner and preserves account generation',async()=>{
 const calls:any[]=[];const service=new NativeRuntimeControl('',async(_h,_c,o)=>{const r=JSON.parse(o!.stdin!);calls.push(r);return response({accountId:account.id,accountGeneration:account.generation,accountRef:'vps-account:new/g/codex/old-account/old-generation'});});
 await service.enrollLegacy(host,native(),legacy(),account.id);assert.deepEqual(calls[0],{protocol:1,method:'runtime/legacy-enroll',params:{authorityId:'new',generation:'g',accountRef:'vps-account:old/old-g/codex/old-account/old-generation',email:account.email,sameAccountConfirmed:true}});
 await assert.rejects(service.enrollLegacy({...host,role:'workspace'},native(),legacy(),account.id));assert.equal(calls.length,1);
});

test('both providers recover native login in the existing central profile',async()=>{
 const service=new NativeRuntimeControl('',async(_h,_c,o)=>{const r=JSON.parse(o!.stdin!);assert.equal(r.method,'runtime/login-command');return response({command:r.params.accountId==='claude'?'sudo -u fixture env CLAUDE_CONFIG_DIR=/fixture/claude /usr/bin/claude auth login':'sudo -u fixture env CODEX_HOME=/fixture/codex /usr/bin/codex login'});});
 const c={...native(),accounts:[account,{...account,id:'claude',provider:'claude' as const}]};
 assert.match((await service.loginCommand(host,c,account.id)).command,/CODEX_HOME=.* login$/);assert.match((await service.loginCommand(host,c,'claude')).command,/CLAUDE_CONFIG_DIR=.* auth login$/);
});

async function controllerFixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-central-source-')),store=new StateStore(directory);await store.load();
 const catalog={...native(),legacy:legacy()},old=legacy(),calls:string[]=[];
 await store.update(s=>{s.hosts=[host];s.accountCatalogs={[host.id]:structuredClone(catalog)};});
 const actions:HostActions={pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],
  accountCatalog:{list:async(_h,source)=>structuredClone(source==='existing-codex'?old:catalog),select:async()=>catalog,start:async()=>{throw Error('No login');},status:async()=>{throw Error('No login');},cancel:async()=>{throw Error('No login');},dispose:async()=>{}},
  accountSetup:{plan:async()=>{calls.push('plan');return {...plan(),id:'reviewed-plan'} as any;},apply:async()=>{calls.push('apply');return {status:'ready',authorityId:'new',generation:'g'};}},
  nativeAccounts:{status:async()=>{throw Error('No runtime');},createClaude:async()=>{throw Error('No runtime');},loginCommand:async()=>{throw Error('No login');},enrollLegacy:async(_h,_c,legacyCatalog,id)=>{calls.push('enroll');assert.equal(id,account.id);assert.equal(legacyCatalog.accounts[0]?.email,account.email);catalog.accounts.push({...account,status:'unauthenticated'});return {accountId:id};}}};
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>''}),actions,()=>{});
 return {controller,store,calls,old,close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('controller requires explicit confirmation for setup and never applies on preview',async()=>{
 const f=await controllerFixture();try{await f.controller.call('accounts/setup-plan',{id:host.id});assert.deepEqual(f.calls,['plan']);await assert.rejects(f.controller.call('accounts/setup-apply',{id:host.id,planId:'reviewed-plan'}),/确认/);assert.deepEqual(f.calls,['plan']);await f.controller.call('accounts/setup-apply',{id:host.id,planId:'reviewed-plan',confirm:true});assert.deepEqual(f.calls,['plan','apply']);}finally{await f.close();}
});

test('controller rechecks legacy identity and does not enroll a substituted or unconfirmed account',async()=>{
 const f=await controllerFixture();try{
  await assert.rejects(f.controller.call('accounts/enroll-legacy',{id:host.id,accountId:account.id}),/确认/);
  f.old.accounts[0]={...account,email:'different@example.invalid'};
  await assert.rejects(f.controller.call('accounts/enroll-legacy',{id:host.id,accountId:account.id,confirm:true}),/身份已变化/);assert.deepEqual(f.calls,[]);
  f.old.accounts[0]=account;await f.controller.call('accounts/enroll-legacy',{id:host.id,accountId:account.id,email:'ignored@example.invalid',confirm:true});assert.deepEqual(f.calls,['enroll']);assert.equal(f.store.snapshot().accountCatalogs![host.id]!.accounts[0]?.generation,account.generation);
 }finally{await f.close();}
});

test('workspace identities cannot prepare or enroll central authentication through IPC',async()=>{
 const f=await controllerFixture();try{
  await f.store.update(s=>{s.hosts[0]={...host,role:'workspace',username:'member'};});
  for(const method of ['accounts/setup-plan','accounts/setup-apply','accounts/enroll-legacy'])await assert.rejects(f.controller.call(method,{id:host.id,planId:'fixture',accountId:account.id,confirm:true}),/管理/);
  assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});


test('official CLI install preview exposes bounded public metadata and waits for explicit apply',async()=>{
 const download={provider:'codex',version:'0.155.1',url:'https://github.com/openai/codex/releases/download/rust-v0.155.1/codex-x86_64-unknown-linux-musl.tar.gz',sha256:'b'.repeat(64),size:101581479,target:'/opt/agent-workbench/native/codex-0.155.1-x86_64/codex'};
 const f=setup(r=>r.method==='plan'?{...plan(),downloads:[{...download,access_token:'fixture-secret'}],detected:[{provider:'codex',path:'/root/.local/bin/codex',status:'untrusted',extra:'fixture-secret'}]}:{status:'ready',authorityId:'new',generation:'g'});
 const p=await f.service.plan(host);assert.deepEqual(p.downloads,[download]);assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(p).includes('fixture-secret'));
 await f.service.apply(host,p.id);assert.equal(f.calls.length,2);assert.deepEqual(Object.keys(f.calls[1]).sort(),['method','planId']);
});

test('invalid install artifact metadata is rejected before a confirmation plan can be used',async()=>{
 for(const bad of [
  {provider:'codex',version:'0.155.1',url:'http://untrusted.invalid',sha256:'a'.repeat(64),size:1,target:'/opt/agent-workbench/native/codex'},
  {provider:'codex',version:'0.155.1',url:'https://github.com/openai/codex/releases/download/version/archive',sha256:'a'.repeat(64),size:1,target:'/opt/agent-workbench/native/../../../bin/codex'},
 ]){const f=setup(()=>({...plan(),downloads:[bad]}));await assert.rejects(f.service.plan(host),/CLI 配置回执无效/);assert.equal(f.calls.length,1);}
});
