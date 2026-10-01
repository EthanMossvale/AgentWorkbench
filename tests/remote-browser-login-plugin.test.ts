import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess,{type ChildProcessWithoutNullStreams} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {RemoteBrowserService,type BrowserLogin} from '../packages/remote-account-catalog/browser';
import type {SshHost} from '../packages/contracts';
import {SSH_EXECUTABLE} from '../packages/ssh-transport';

test('approved plugin starts the production SSH login and receives bounded preparation errors',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-browser-auth-plugin-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'fixture-admin',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',ownerId:'fixture',workspaceGeneration:'g',identityFile:path.join(directory,'unused-key'),knownHostsFile:path.join(directory,'unused-hosts')};
 const accountId='fixture-claude',profileKey='a'.repeat(32);
 await store.update(s=>{s.hosts=[host];s.accountCatalogs={[host.id]:{source:'native-owner',availability:'ready',authorityId:'fixture',generation:'g',workspaceId:'administrator',revision:1,selectionRevision:0,accounts:[{id:accountId,generation:'ag',provider:'claude',status:'unauthenticated',displayName:'Fixture',observedAt:new Date().toISOString()}]}};});
 const children:Array<EventEmitter&{stdin:PassThrough;stdout:PassThrough;stderr:PassThrough}>=[],payloads:any[]=[];
 const spawn=t.mock.method(childProcess,'spawn',((command:string,args:string[],options:any)=>{
  assert.equal(command,SSH_EXECUTABLE);assert.ok(args.includes(host.hostname));assert.equal(options.shell,false);
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
  child.stdin.once('data',data=>{payloads.push(JSON.parse(data.toString()));});children.push(child);
  return child as unknown as ChildProcessWithoutNullStreams;
 }) as typeof childProcess.spawn);syncBuiltinESMExports();
 const browser=new RemoteBrowserService(async()=>{throw Error('No real viewer in fixture');});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],remoteBrowser:browser},()=>{});
 const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();
 for(const [id,service] of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
 plugins.connectHost(request=>controller.call(request.method,request.payload));
 const manifest={schemaVersion:1,apiVersion:1,id:'test.auth-preparation',name:'Synthetic authorization preparation',version:'1.0.0',description:'Production SSH state consumer',capabilities:['host'],main:'main.mjs'};
 const zip=path.join(directory,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(`export function activate(api){api.registerCommand('start',p=>api.call('remote-browser/start',p));api.registerCommand('status',p=>api.call('remote-browser/status',p));}`)}]));
 try{
  await plugins.importZip(zip);const plugin=(await plugins.list()).find(p=>p.manifest.id===manifest.id)!;
  await assert.rejects(plugins.setEnabled(manifest.id,plugin.hash,true),/Explicit approval/);await plugins.setEnabled(manifest.id,plugin.hash,true,true);
  const failures=[['NATIVE_AUTH_URL_UNRECOGNIZED','未识别远端 CLI 的授权地址'],['NATIVE_AUTH_URL_TIMEOUT','等待远端 CLI 授权地址超时'],['BROWSER_START_TIMEOUT','远端浏览器启动超时']] as const;
  for(const [error,label] of failures){
   const job=await plugins.command(manifest.id,'start',{id:host.id,accountId,profileKey}) as BrowserLogin;
   assert.equal(job.viewerReady,false);const child=children.at(-1)!,payload=payloads.at(-1);
   assert.equal(payload.request.action,'login');assert.equal(payload.request.accountId,accountId);
   assert.match(payload.sources['remote_browser.py'],/\/cai\/oauth\/authorize/);
   assert.match(payload.sources['browser_api.py'],/AUTH_URL_TIMEOUT = 60/);
   assert.match(payload.sources['browser_api.py'],/BROWSER_OPEN_TIMEOUT = 70/);
   assert.match(payload.sources['browser_api.py'],/BROWSER='\/bin\/true', CLAUDE_CONFIG_DIR=profile/);
   child.stdout.write(JSON.stringify({state:'failed',viewerReady:false,codeRequested:false,cleanup:'confirmed',error})+'\n');child.emit('close',0);
   const status=await plugins.command(manifest.id,'status',{id:host.id,jobId:job.jobId}) as BrowserLogin;
   assert.equal(status.state,'failed');assert.equal(status.cleanup,'confirmed');assert.ok(status.error?.startsWith(label));assert.equal(browser.busy(host),false);
   await plugins.setEnabled(manifest.id,plugin.hash,false);await assert.rejects(plugins.command(manifest.id,'status',{}),/not found/);
   assert.deepEqual(await controller.call('remote-browser/status',{id:host.id,jobId:job.jobId}),status);
   await plugins.setEnabled(manifest.id,plugin.hash,true);
  }
 }finally{await plugins.dispose();await controller.dispose();spawn.mock.restore();syncBuiltinESMExports();await rm(directory,{recursive:true,force:true});}
});

test('approved login plugins call and replace the production dispatcher and restore it after disable',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-browser-login-plugin-'));
 const store=new StateStore(directory);await store.load();
 const host:SshHost={id:'fixture-admin',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',ownerId:'fixture',workspaceGeneration:'g',identityFile:path.join(directory,'unused-key'),knownHostsFile:path.join(directory,'unused-hosts')};
 const profileKey='a'.repeat(32),accountId='fixture-claude';
 await store.update(state=>{
  state.hosts=[host,{...host,id:'fixture-member',role:'workspace',username:'member'}];
  state.accountCatalogs={[host.id]:{source:'native-owner',availability:'ready',authorityId:'fixture',generation:'g',workspaceId:'administrator',revision:1,selectionRevision:0,accounts:[{id:accountId,generation:'ag',provider:'claude',status:'unauthenticated',displayName:'Fixture',observedAt:new Date().toISOString()}]}};
 });
 let job:BrowserLogin|undefined,started=0,viewed=0,finish:undefined|(()=>void),entered:undefined|(()=>void);
 let hold:Promise<void>|undefined;
 const remoteBrowser:NonNullable<HostActions['remoteBrowser']>={
  busy:()=>false,dispose:async()=>{},profiles:async()=>({installed:true,missing:[],profiles:[{key:profileKey,label:'Fixture',available:true}]}),
  setup:async()=>{throw Error('No installation in this fixture');},
  start:async(selected,catalog,account,profile)=>{
   assert.equal(selected.id,host.id);assert.equal(catalog.authorityId,'fixture');assert.equal(account,accountId);assert.equal(profile,profileKey);
   job={jobId:'fixture-job-'+(++started),accountId,state:'preparing',viewerReady:false,codeRequested:false,cleanup:'pending'};
   entered?.();await hold;job={...job,state:'awaiting-browser',viewerReady:true};return structuredClone(job);
  },
  status:(_host,id)=>{assert.equal(id,job?.jobId);return structuredClone(job!);},
  openViewer:async()=>{if(!job?.viewerReady)throw Error('Fixture viewer is not ready');viewed++;},
  code:()=>{throw Error('No authorization code in this fixture');},
  cancel:async(_host,id)=>{assert.equal(id,job?.jobId);job={...job!,state:'cancelled',viewerReady:false,cleanup:'confirmed'};return structuredClone(job);},
 };
 const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],remoteBrowser},()=>{});
 for(const [id,service] of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
 plugins.connectHost(request=>controller.call(request.method,request.payload));
 const install=async(id:string,source:string)=>{
  const manifest={schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic remote login lifecycle',capabilities:['host'],main:'main.mjs'};
  const file=path.join(directory,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));
  await plugins.importZip(file);return (await plugins.list()).find(item=>item.manifest.id===id)!;
 };
 try{
  const observer=await install('test.login-observer',`export function activate(api){let hits=0;api.services.intercept('actions.remote-browser','start',(next,...args)=>{hits++;return next(...args);});api.registerCommand('hits',()=>hits);}`);
  const extension=await install('test.login-workflow',`export function activate(api){
   const service=api.services.get('actions.remote-browser'),status=service.status.bind(service);
   api.services.override('actions.remote-browser',{status:(...args)=>({...status(...args),codeRequested:true})});
   api.registerCommand('start',p=>api.call('remote-browser/start',p));
  }`);
  await assert.rejects(plugins.setEnabled(extension.manifest.id,extension.hash,true),/Explicit approval/);
  await plugins.setEnabled(observer.manifest.id,observer.hash,true,true);
  await plugins.setEnabled(extension.manifest.id,extension.hash,true,true);
  const request={id:host.id,accountId,profileKey};
  await assert.rejects(plugins.command(extension.manifest.id,'start',{...request,id:'fixture-member'}),/管理员/);
  assert.equal(started,0);
  hold=new Promise<void>(resolve=>{finish=resolve;});const inFlight=new Promise<void>(resolve=>{entered=resolve;});
  const pending=plugins.command(extension.manifest.id,'start',request) as Promise<BrowserLogin>;
  await inFlight;assert.equal(await plugins.command(observer.manifest.id,'hits',{}),1);
  assert.equal((await controller.call('remote-browser/status',{id:host.id,jobId:job!.jobId}) as BrowserLogin).viewerReady,false);
  await assert.rejects(controller.call('remote-browser/open',{id:host.id,jobId:job!.jobId}),/not ready/);assert.equal(viewed,0);
  assert.equal((await controller.call('remote-browser/status',{id:host.id,jobId:job!.jobId}) as BrowserLogin).codeRequested,true);
  await plugins.setEnabled(extension.manifest.id,extension.hash,false);
  assert.equal((await controller.call('remote-browser/status',{id:host.id,jobId:job!.jobId}) as BrowserLogin).codeRequested,false);
  finish!();const value=await pending;assert.equal(value.jobId,job!.jobId);assert.equal(started,1);
  await controller.call('remote-browser/open',{id:host.id,jobId:value.jobId});assert.equal(viewed,1);
  await controller.call('remote-browser/cancel',{id:host.id,jobId:value.jobId});
  assert.equal(job!.cleanup,'confirmed');
  await assert.rejects(plugins.command(extension.manifest.id,'start',request),/not found/);
  await plugins.setEnabled(extension.manifest.id,extension.hash,true);
  const later=await plugins.command(extension.manifest.id,'start',request) as BrowserLogin;
  assert.equal(await plugins.command(observer.manifest.id,'hits',{}),2);
  assert.equal((await controller.call('remote-browser/status',{id:host.id,jobId:later.jobId}) as BrowserLogin).codeRequested,true);
  await plugins.setEnabled(extension.manifest.id,extension.hash,false);
  await plugins.setEnabled(observer.manifest.id,observer.hash,false);
  assert.equal((await controller.call('remote-browser/status',{id:host.id,jobId:later.jobId}) as BrowserLogin).codeRequested,false);
  await controller.call('remote-browser/cancel',{id:host.id,jobId:later.jobId});
  const broken=await install('test.login-failed',`export function activate(api){api.services.override('actions.remote-browser',{status:()=>{throw Error('Must be removed');}});throw Error('Synthetic activation failure');}`);
  await plugins.setEnabled(broken.manifest.id,broken.hash,true,true);
  assert.equal((await plugins.list()).find(item=>item.manifest.id===broken.manifest.id)!.enabled,false);
  assert.equal((await controller.call('remote-browser/status',{id:host.id,jobId:later.jobId}) as BrowserLogin).cleanup,'confirmed');
  assert.equal(started,2);
 }finally{finish?.();await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});

test('approved launch workflow reaches the production browser service and its packaged first-page manager',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-browser-launch-plugin-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'fixture-admin',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',ownerId:'fixture',workspaceGeneration:'g',identityFile:path.join(directory,'unused-key'),knownHostsFile:path.join(directory,'unused-hosts')};
 await store.update(state=>{state.hosts=[host];});
 const calls:unknown[]=[],viewed:string[]=[];let closed=0;
 const browser=new RemoteBrowserService(async url=>{viewed.push(url);},async(_host,_command,options)=>{
  const payload=JSON.parse(options!.stdin!);calls.push(payload.request);
  assert.match(payload.sources['remote_browser.py'],/chrome:\/\/newtab\//);
  assert.match(payload.sources['remote_browser.py'],/start\(profile_key, url\)/);
  assert.match(payload.sources['browser_api.py'],/viewer_ready = False/);
  return {exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({ok:true,value:{running:true,profilesPreserved:true,profileKey:payload.request.profileKey}})};
 },async()=>({url:'http://127.0.0.1:16091/vnc.html',close:async()=>{closed++;}}));
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],remoteBrowser:browser},()=>{});
 const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();
 for(const [id,service] of Object.entries(controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
 plugins.connectHost(request=>controller.call(request.method,request.payload));
 const manifest={schemaVersion:1,apiVersion:1,id:'test.browser-first-page',name:'Synthetic first page',version:'1.0.0',description:'Production browser service workflow',capabilities:['host'],main:'main.mjs'};
 const zip=path.join(directory,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(`export function activate(api){let hits=0;api.services.intercept('actions.remote-browser','control',(next,...args)=>{hits++;return next(...args);});api.registerCommand('launch',p=>api.call('remote-browser/launch',p));api.registerCommand('hits',()=>hits);}`)}]));
 try{
  await plugins.importZip(zip);const plugin=(await plugins.list()).find(p=>p.manifest.id===manifest.id)!;
  await assert.rejects(plugins.setEnabled(manifest.id,plugin.hash,true),/Explicit approval/);
  await plugins.setEnabled(manifest.id,plugin.hash,true,true);
  const request={id:host.id,profileKey:'a'.repeat(32)};
  assert.deepEqual(await plugins.command(manifest.id,'launch',request),{running:true,viewerReady:true,profilesPreserved:true,profileKey:request.profileKey});
  assert.deepEqual(calls,[{action:'launch',profileKey:request.profileKey}]);assert.equal(viewed.length,1);assert.equal(await plugins.command(manifest.id,'hits',{}),1);
  await plugins.setEnabled(manifest.id,plugin.hash,false);await assert.rejects(plugins.command(manifest.id,'launch',request),/not found/);
  await controller.call('remote-browser/launch',request);assert.equal(viewed.length,2);assert.equal(closed,1);
  await plugins.setEnabled(manifest.id,plugin.hash,true);await plugins.command(manifest.id,'launch',request);assert.equal(await plugins.command(manifest.id,'hits',{}),1);
 }finally{await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
