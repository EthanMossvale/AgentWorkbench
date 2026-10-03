import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {parseCodexCredentials,resolveCodexCredential} from '../packages/model-management/credentials';
import {AccountAccessRegistry} from '../packages/model-management/access-registry';
import {accountEnvironment,codexCallbackUrl,submitCodexCallback,assertCodexCallbackPortAvailable,type LoginHandle,type AccountInspection} from '../packages/model-management/native';
import {LocalModelAccounts} from '../apps/desktop/host/local-model-accounts';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {AccountNames} from '../apps/desktop/host/account-names';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import type {LocalModelAccount,AccountLogin} from '../packages/model-management/types';
import type {AccountCatalog} from '../packages/contracts';

const jwt=(payload:object)=>Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.synthetic';
const access=jwt({email:'full.address@example.com','https://api.openai.com/auth':{chatgpt_account_id:'synthetic-account'}});
const auth={tokens:{access_token:access,id_token:access,refresh_token:'rt-synthetic',account_id:'synthetic-account'}};
const model={id:'test-model',model:'test-model',name:'Synthetic',isDefault:true,efforts:[],serviceTiers:[]};
const a:LocalModelAccount={id:'11111111-1111-4111-a111-111111111111',revision:'r',provider:'codex',name:'Synthetic',status:'signed-out',enabled:true,models:[]};
const job=(account=a):AccountLogin=>({id:'job-'+account.id,accountId:account.id,method:'browser',status:'waiting',url:'https://auth.openai.com/authorize?state=fixture',expiresAt:new Date(Date.now()+60000).toISOString()});
const defer=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{resolve,promise};};

test('failed availability retains a redacted cause and can recover on explicit rediscovery',async()=>{
 const registry=new AccountAccessRegistry();let probes=0,starts=0;
 registry.registerLogin('test.probe',{id:'login',provider:'codex',label:'Probe',description:'Synthetic',availability:async()=>{if(++probes===1)throw Error('DNS probe failed; access_token=fixture-secret');return {available:true};},start:async()=>{starts++;return {job:job(),cancel:async()=>{}};}});
 const first=(await registry.methods(a))[0]!;assert.equal(first.available,false);assert.match(first.reason!,/DNS probe failed/);assert.doesNotMatch(first.reason!,/fixture-secret/);assert.equal(starts,0);
 assert.equal((await registry.methods(a))[0]!.available,true);assert.equal(starts,0);await registry.dispose();
});
async function fixture(t:test.TestContext){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-account-access-')),store=new StateStore(directory);await store.load();let changed:(job:AccountLogin)=>void=()=>{},opened=0,failOpen=false;
 const transport={inspect:async():Promise<AccountInspection>=>({status:'authenticated',email:'full.address@example.com',models:[model]}),login:async(account:LocalModelAccount,_method:string,cb:(job:AccountLogin)=>void)=>{changed=cb;const current=job(account);return{job:current,cancel:async()=>cb({...current,status:'cancelled'})};},consume:async()=>'',dispose:async()=>{}};
 const service=new LocalModelAccounts(directory,{} as any,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),busy:()=>false,open:async()=>{opened++;if(failOpen)throw Error('Synthetic browser failure');}},transport);
 t.after(async()=>{await service.dispose();await rm(directory,{recursive:true,force:true});});
 return{directory,store,service,transport,opened:()=>opened,failOpen:()=>{failOpen=true;},complete:(j:AccountLogin)=>changed({...j,status:'verifying'}),prepare:()=>service.call('models/accounts/prepare',{provider:'codex'}) as Promise<LocalModelAccount>};
}

test('all documented Codex token envelopes normalize without importing notes or alternate endpoints',()=>{
 const inputs=[auth,{type:'codex',...auth.tokens,account_password:'DO_NOT_COPY'}, {accessToken:access,refreshToken:'rt-synthetic'}, {accounts:[{platform:'openai',type:'oauth',credentials:auth.tokens,base_url:'https://untrusted.invalid'}]},[auth],access];
 for(const input of inputs){const rows=parseCodexCredentials(typeof input==='string'?input:JSON.stringify(input));assert.equal(rows.length,1);assert.equal((rows[0]!.auth!.tokens as any).access_token,access);assert.ok(!JSON.stringify(rows).includes('DO_NOT_COPY'));assert.ok(!JSON.stringify(rows).includes('untrusted'));}
 const external=parseCodexCredentials(access)[0]!.auth!;assert.equal(external.auth_mode,'chatgptAuthTokens');assert.equal((external.tokens as any).id_token,access);
 for(const input of ['at-synthetic',JSON.stringify({personal_access_token:'at-synthetic'})])assert.equal(parseCodexCredentials(input)[0]!.auth!.personal_access_token,'at-synthetic');
 assert.equal(parseCodexCredentials('rt-synthetic')[0]!.refreshToken,'rt-synthetic');assert.equal(parseCodexCredentials('opaque-synthetic','refresh-token')[0]!.refreshToken,'opaque-synthetic');
 const identity={agent_runtime_id:'runtime',agent_private_key:'synthetic-base64',account_id:'account',chatgpt_user_id:'user',email:'member@example.com',plan_type:'plus',chatgpt_account_is_fedramp:false};
 assert.deepEqual(parseCodexCredentials(JSON.stringify({agent_identity:identity}))[0]!.auth!.agent_identity,identity);assert.equal(parseCodexCredentials(jwt(identity))[0]!.auth!.auth_mode,'agentIdentity');
});
test('invalid, mixed, duplicate and oversized imports fail without revealing secrets',()=>{
 for(const input of ['{broken',JSON.stringify({OPENAI_API_KEY:'private-fixture'}),JSON.stringify([auth,{platform:'anthropic',credentials:auth.tokens}]),JSON.stringify([auth,auth]),JSON.stringify({agent_identity:{agent_runtime_id:'x'}}),jwt({sub:'missing-id'}),'x'.repeat(2*1024*1024+1)])assert.throws(()=>parseCodexCredentials(input),e=>e instanceof Error&&e.message.startsWith('LOCAL_ACCOUNT_IMPORT_')&&!e.message.includes('private-fixture'));
});
test('refresh-only import performs exactly one bounded official request and preserves rotation',async()=>{
 let calls=0;const fetcher=async(url:any,options:any)=>{calls++;assert.equal(url,'https://auth.openai.com/oauth/token');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).grant_type,'refresh_token');assert.ok(options.signal);return new Response(JSON.stringify({...auth.tokens,refresh_token:'rt-rotated'}));};
 const result=await resolveCodexCredential({refreshToken:'rt-original'},fetcher as any);assert.equal((result.tokens as any).refresh_token,'rt-rotated');assert.equal(calls,1);
 await assert.rejects(resolveCodexCredential({refreshToken:'rt-private'},async()=>{calls++;throw Error('rt-private');}),/^Error: LOCAL_ACCOUNT_IMPORT_REFRESH_FAILED$/);assert.equal(calls,2);
});
test('manual OAuth callback binds the original state and loopback origin and uses real HTTP forwarding',async t=>{
 let received='';const server=createServer((req,res)=>{received=req.url!;res.writeHead(302,{location:'https://never-follow.example.com'});res.end();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const port=(server.address() as any).port,redirect=`http://localhost:${port}/auth/callback`,url='https://auth.openai.com/authorize?'+new URLSearchParams({redirect_uri:redirect,state:'bound-state'});
 const callback=redirect+'?code=synthetic&state=bound-state';await submitCodexCallback(codexCallbackUrl(url,callback));assert.equal(received,'/auth/callback?code=synthetic&state=bound-state');
 for(const bad of [callback+'&state=bound-state',callback+'&code=other',callback.replace('bound-state','wrong'),callback.replace('localhost','example.com'),callback.replace('/auth/callback','/other'),callback+'#fragment'])assert.throws(()=>codexCallbackUrl(url,bad),/CALLBACK_INVALID/);
});
test('occupied callback ports are refused without sending a native cancellation request',async()=>{
 let requests=0;const server=createServer((_req,res)=>{requests++;res.end();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 try{await assert.rejects(assertCodexCallbackPortAvailable(port),/PORT_BUSY/);assert.equal(requests,0);}finally{await new Promise<void>(r=>server.close(()=>r()));}await assertCodexCallbackPortAvailable(port);
});
test('prepare stays transient; verified email names the card; rename never changes identity',async t=>{
 const f=await fixture(t),account=await f.prepare();assert.equal((await f.service.call('models/accounts/list',{} ) as any[]).length,0);assert.equal(f.opened(),0);
 const j=await f.service.call('models/accounts/login-start',{id:account.id,revision:account.revision,method:'browser'}) as AccountLogin;assert.equal(f.opened(),1);assert.equal(f.store.snapshot().localModelAccounts?.length??0,0);f.complete(j);
 assert.equal((await f.service.call('models/accounts/login-status',{id:account.id,jobId:j.id}) as AccountLogin).status,'complete');let saved=f.service.account(account.id);assert.equal(saved.name,'full.address@example.com');
 const renamed=await f.service.call('models/accounts/rename',{id:saved.id,revision:saved.revision,name:'Work'}) as LocalModelAccount;assert.equal(renamed.name,'Work');assert.equal(renamed.email,'full.address@example.com');await assert.rejects(f.service.call('models/accounts/rename',{id:saved.id,revision:saved.revision,name:'Stale'}),/CHANGED/);
 const restored=new StateStore(f.directory);await restored.load();assert.equal(restored.snapshot().localModelAccounts![0]!.name,'Work');assert.equal(f.service.targets()[0]!.description,'Work · 官方账号');
});
test('browser launch failure preserves link and allows retry; cancel never creates a card',async t=>{
 const f=await fixture(t),account=await f.prepare();f.failOpen();const j=await f.service.call('models/accounts/login-start',{id:account.id,revision:account.revision,method:'browser'}) as AccountLogin;assert.equal(j.browserError,'LOCAL_ACCOUNT_BROWSER_UNAVAILABLE');assert.ok(j.url);await f.service.call('models/accounts/login-cancel',{id:account.id,jobId:j.id});await f.service.call('models/accounts/draft-discard',{id:account.id});assert.equal(f.store.snapshot().localModelAccounts?.length??0,0);
});
test('cancellation during native verification prevents a late card promotion',async t=>{
 const f=await fixture(t),account=await f.prepare(),inspection=defer<AccountInspection>(),started=defer<void>();f.transport.inspect=async()=>{started.resolve();return inspection.promise;};
 const j=await f.service.call('models/accounts/login-start',{id:account.id,revision:account.revision,method:'browser'}) as AccountLogin;f.complete(j);const polling=f.service.call('models/accounts/login-status',{id:account.id,jobId:j.id});await started.promise;await f.service.call('models/accounts/login-cancel',{id:account.id,jobId:j.id});inspection.resolve({status:'authenticated',email:'late@example.com',models:[model]});assert.equal((await polling as AccountLogin).status,'cancelled');assert.equal(f.store.snapshot().localModelAccounts?.length??0,0);
});
test('discarding a draft during startup cancels the late native handle',async t=>{
 const f=await fixture(t),account=await f.prepare(),pending=defer<any>(),started=defer<void>();let cancelled=0;f.transport.login=async()=>{started.resolve();return pending.promise;};
 const start=f.service.call('models/accounts/login-start',{id:account.id,revision:account.revision,method:'browser'});await started.promise;await f.service.call('models/accounts/draft-discard',{id:account.id});pending.resolve({job:job(account),cancel:async()=>{cancelled++;}});await assert.rejects(start,/CHANGED/);assert.equal(cancelled,1);assert.equal(f.opened(),0);assert.equal(f.store.snapshot().localModelAccounts?.length??0,0);
});
test('missing native email or models does not produce a card',async t=>{
 const f=await fixture(t),account=await f.prepare();f.transport.inspect=async()=>({status:'authenticated',models:[model]});await assert.rejects(f.service.refresh(account.id),/EMAIL_UNAVAILABLE/);assert.equal(f.store.snapshot().localModelAccounts?.length??0,0);f.transport.inspect=async()=>({status:'authenticated',email:'test@example.com',models:[]});assert.equal((await f.service.refresh(account.id)).status,'unknown');
});
test('imports remain drafts and exclude secrets from metadata; existing native files are never overwritten',async t=>{
 const f=await fixture(t),account=await f.prepare();const result=await f.service.call('models/accounts/import',{id:account.id,revision:account.revision,format:'auth-json',contents:JSON.stringify(auth)}) as any;assert.equal(result.imported,1);assert.equal(f.store.snapshot().localModelAccounts?.length??0,0);assert.ok(!JSON.stringify(result).includes(access));const file=path.join(accountEnvironment({},f.directory,account).env.CODEX_HOME!,'auth.json'),before=await readFile(file,'utf8');
 await assert.rejects(f.service.call('models/accounts/import',{id:account.id,revision:account.revision,contents:JSON.stringify(auth)}),/EXISTS/);assert.equal(await readFile(file,'utf8'),before);await f.service.refresh(account.id);assert.equal(f.service.account(account.id).name,'full.address@example.com');
});
test('registry handles late starts, coexistence and unavailable choices without activating them',async()=>{
 const registry=new AccountAccessRegistry(),pending=defer<LoginHandle>();let cancelled=0,notifications=0;registry.subscribe(()=>notifications++);
 const first=registry.registerLogin('test.one',{id:'browser',label:'One',description:'One',provider:'codex',start:()=>pending.promise});const second=registry.registerLogin('test.two',{id:'browser',label:'Two',description:'Two',provider:'codex',start:async()=>({job:job(),cancel:async()=>{}})});
 assert.equal((await registry.methods(a)).length,2);assert.throws(()=>registry.registerLogin('test.one',{id:'browser',label:'Duplicate',description:'Duplicate',provider:'codex',start:async()=>({job:job(),cancel:async()=>{}})}),/DUPLICATE/);
 const start=registry.start(a,first.id,()=>{});await first.dispose();pending.resolve({job:job(),cancel:async()=>{cancelled++;}});await assert.rejects(start,/UNAVAILABLE/);assert.equal(cancelled,1);assert.equal((await registry.methods(a))[0]!.id,second.id);await registry.dispose();assert.ok(notifications>=4);
});
test('registry disposal aborts import use and cancels jobs once even if callbacks arrive late',async()=>{
 const registry=new AccountAccessRegistry();let cancelled=0;const entry=registry.registerLogin('test.one',{id:'login',provider:'codex',label:'Login',description:'Login',start:async()=>({job:job(),cancel:async()=>{cancelled++;}})});const h=await registry.start(a,entry.id,()=>{});await Promise.all([entry.dispose(),h.cancel()]);assert.equal(cancelled,1);assert.equal(h.job.status,'cancelled');
 const importer=registry.registerImporter('test.one',{id:'format',label:'Format',description:'Format',parse:()=>parseCodexCredentials(access)}),parsed=await registry.parse(importer.id,'x');await importer.dispose();assert.equal(parsed.signal.aborted,true);assert.throws(parsed.assertActive,/UNAVAILABLE/);await registry.dispose();
});
test('failed plugin cleanup is reported and late importer results are rejected',async()=>{
 const registry=new AccountAccessRegistry(),entry=registry.registerLogin('test.fail',{id:'login',label:'Login',description:'Synthetic',provider:'codex',start:async()=>({job:job(),cancel:async()=>{throw Error('private fixture');}})}),handle=await registry.start(a,entry.id,()=>{});await assert.rejects(entry.dispose(),/CLEANUP_FAILED/);assert.equal(handle.job.status,'failed');assert.equal(handle.job.error,'LOCAL_ACCOUNT_EXTENSION_CLEANUP_FAILED');
 const pending=defer<any>(),importer=registry.registerImporter('test.late',{id:'input',label:'Input',description:'Synthetic',parse:()=>pending.promise}),read=registry.parse(importer.id,'synthetic');await importer.dispose();pending.resolve(parseCodexCredentials(access));await assert.rejects(read,/FORMAT_UNAVAILABLE/);await registry.dispose();
});
test('SSH aliases persist across matching catalogs but not authority or identity generations',async t=>{
 const f=await fixture(t),catalog={availability:'ready',authorityId:'authority',generation:'catalog-generation',accounts:[{id:'remote',generation:'identity-generation',provider:'codex',status:'authenticated',email:'remote.full@example.com',displayName:'Native label',observedAt:new Date().toISOString()}]} as AccountCatalog;
 await f.store.update(s=>{s.hosts=[{id:'one'},{id:'two'},{id:'other'}] as any;s.accountCatalogs={one:structuredClone(catalog),two:structuredClone(catalog),other:{...structuredClone(catalog),authorityId:'other'}};});const names=new AccountNames(()=>f.store.snapshot(),fn=>f.store.update(fn));assert.equal(names.apply(structuredClone(catalog)).accounts[0]!.displayName,'remote.full@example.com');
 const renamed=await names.rename('one','remote','identity-generation','Shared work',undefined);assert.equal(renamed.email,'remote.full@example.com');assert.equal(f.store.snapshot().accountCatalogs!.two!.accounts[0]!.displayName,'Shared work');assert.equal(f.store.snapshot().accountCatalogs!.other!.accounts[0]!.displayName,'remote.full@example.com');await assert.rejects(names.rename('one','remote','identity-generation','Stale',undefined),/CHANGED/);
 const restored=new StateStore(f.directory);await restored.load();const after=new AccountNames(()=>restored.snapshot(),fn=>restored.update(fn));assert.equal(after.apply(structuredClone(catalog)).accounts[0]!.displayName,'Shared work');const changed=structuredClone(catalog);changed.accounts[0]!.generation='re-enrolled';assert.equal(after.apply(changed).accounts[0]!.displayName,'remote.full@example.com');
});
test('approved ZIP registration reaches production discovery, execution and import and restores on disable',async t=>{
 const f=await fixture(t),plugins=new PluginRegistry(path.join(f.directory,'plugins'));await plugins.initialize();const controller=new WorkbenchController(f.store,new SecretStore(f.directory,{encrypt:()=>{throw Error('Unused');},decrypt:()=>{throw Error('Unused');}}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});(controller as any).localAccounts=f.service;
 for(const [id,service] of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});plugins.connectHost(request=>controller.call(request.method,request.payload));
 const manifest={schemaVersion:1,apiVersion:1,id:'test.account-access',name:'Account access fixture',version:'1.0.0',description:'Synthetic lifecycle',capabilities:['host'],main:'main.mjs'};
 const source=`export function activate(api){const service=api.services.get('models.account-access');const login=service.registerLogin('test.account-access',{id:'login',provider:'codex',label:'Plugin login',description:'Synthetic',start:async(a,changed)=>{const job={id:'plugin-job',accountId:a.id,method:'test.account-access:login',status:'waiting',expiresAt:new Date(Date.now()+60000).toISOString()};return{job,cancel:async()=>changed({...job,status:'cancelled'})};}});api.onDispose(()=>login.dispose());const format=service.registerImporter('test.account-access',{id:'json',label:'Plugin format',description:'Synthetic',parse:()=>[{auth:${JSON.stringify(auth)}}]});api.onDispose(()=>format.dispose());}`;
 const zip=path.join(f.directory,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const record=(await plugins.list())[0]!;
 try{
 await assert.rejects(plugins.setEnabled(manifest.id,record.hash,true),/Explicit approval/);await plugins.setEnabled(manifest.id,record.hash,true,true);const account=await f.prepare();const methods=await controller.call('models/accounts/login-methods',{id:account.id}) as any[];assert.ok(methods.some(m=>m.id==='test.account-access:login'));
 const j=await controller.call('models/accounts/login-start',{id:account.id,revision:account.revision,method:'test.account-access:login'}) as AccountLogin;await plugins.setEnabled(manifest.id,record.hash,false);assert.equal((await controller.call('models/accounts/login-status',{id:account.id,jobId:j.id}) as AccountLogin).status,'cancelled');assert.ok(!(await controller.call('models/accounts/login-methods',{id:account.id}) as any[]).some(m=>m.id.startsWith('test.')));
 await plugins.setEnabled(manifest.id,record.hash,true);const result=await controller.call('models/accounts/import',{id:account.id,revision:account.revision,format:'test.account-access:json',contents:'synthetic'}) as any;assert.equal(result.imported,1);await plugins.setEnabled(manifest.id,record.hash,false);assert.ok(!(await controller.call('models/accounts/import-formats',{id:account.id}) as any[]).some(m=>m.id.startsWith('test.')));
 }finally{await plugins.dispose();await controller.dispose();}
});
