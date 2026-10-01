import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkbenchController,type HostActions} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {NativeResources} from '../apps/desktop/host/native-resources';
import {SharedMemoryStore} from '../packages/memory-core';
import {SharedSkillsStore} from '../packages/skills-core';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {ClaudeBridgeService} from '../services/claude-bridge';
import {withClaudeLocalContext} from '../services/claude-bridge/local-context';
import {nativeMcpSessionPolicy} from '../packages/model-api/native-gateway';
import {nativeEventSemantics} from '../packages/native-events/semantics';
import {ProcessSupervisor,decodeNativeFrame,type ProcessSpec} from '../services/remote-supervisor';
import type {Session,SshHost,AccountCatalog,DraftPreview} from '../packages/contracts';
import type {ModelTarget} from '../packages/model-api/types';

const until=async(check:()=>boolean)=>{for(let i=0;i<500;i++){if(check())return;await delay(10);}assert.ok(check(),'Synthetic controller did not settle');};
class SshFixture extends ProcessSupervisor{
 writes:any[]=[];thread=randomUUID();autoResult=false;cleanup=true;
 frame(value:any){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
 async start(){this.state='running';}
 async write(value:any){this.writes.push(value);
  if(value.provider==='claude'){if(value.fork)this.thread=value.sessionId;this.frame({method:'workbench/bridgeReady',params:{provider:'claude',transport:'official-mcp-v1',sessionReceipt:{threadId:this.thread,cwd:value.cwd,environmentId:'local-device',...(value.fork?{fork:value.fork}:{})}}});}
  if(value.type==='user')setTimeout(()=>{this.frame({type:'system',subtype:'init',session_id:this.thread,permissionMode:'default'});this.frame({type:'user',uuid:value.uuid,session_id:this.thread,message:value.message});if(this.autoResult)this.result();},0);
  if(value.type==='control_request')this.frame({type:'control_response',response:{subtype:'success',request_id:value.request_id,response:{mode:value.request.mode}}});
  if(value.type==='workbench_close'){if(this.cleanup)this.frame({method:'workbench/bridgeClosed',params:{cleanupConfirmed:true}});queueMicrotask(()=>{void this.stop('closed');});}
 }
 result(){this.frame({type:'assistant',session_id:this.thread,uuid:randomUUID(),message:{content:[{type:'text',text:'Synthetic remote answer'}]}});this.frame({type:'result',session_id:this.thread,subtype:'success',is_error:false});}
 async stop(reason='fixture'){this.state='closed';const result={code:0,signal:null,reason};this.emit('disconnect',result);return result;}
}
async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-claude-controller-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'member',name:'Fixture',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',ownerId:'fixture',authorityId:'a',authorityGeneration:'g',remoteWorkspaceId:'w',workspaceGeneration:'wg',identityFile:path.join(directory,'unused-key'),knownHostsFile:path.join(directory,'unused-hosts')};
 const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'w',revision:1,selectionRevision:1,selectedClaudeAccountId:'c',accounts:[{id:'c',generation:'cg',provider:'claude',status:'authenticated',observedAt:'now'}]};
 await store.update(s=>{s.hosts=[host];s.accountCatalogs={[host.id]:catalog};s.activeWorkspaceId=host.id;s.plugins={translation:{enabled:false}};});
 const native=new NativeResources(directory,{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},directory,{cliOptions:{executables:{claude:process.execPath},isolated:true}});
 let ssh!:SshFixture,closed=0,opened=0;
 const bridge=new ClaudeBridgeService(directory,(spec:ProcessSpec)=>(ssh=new SshFixture(spec)));
 bridge.openTools=async options=>{opened++;return withClaudeLocalContext({definitions:[{name:'Read',inputSchema:{type:'object'}}],call:async()=>({content:[{type:'text',text:'Fixture local tool'}]}),close:async()=>{closed++;}},await bridge.openContext({...options,env:{HOME:directory,USERPROFILE:directory}}));};
 const forbidden=async()=>{throw Error('No model calls, account commands or actual SSH in this fixture');};
 let execution='local-mcp-required',imports=0;
 const actions:HostActions={pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],nativeClaude:bridge,nativeAccounts:{status:async()=>({accountId:'c',provider:'claude',installed:true,authenticated:true,versionMatched:true,execution:execution as any,block:null}),createClaude:forbidden,loginCommand:forbidden,models:async()=>[{id:'native',model:'native',name:'Native Claude',isDefault:true,efforts:['low','high'],serviceTiers:[]}]},accountCatalog:{list:async()=>structuredClone(catalog),select:forbidden,start:forbidden,status:forbidden,cancel:forbidden,dispose:async()=>{}},modelFetcher:forbidden,translationFetcher:forbidden};
 const plugins=new PluginRegistry(path.join(directory,'synthetic-plugins'));await plugins.initialize();actions.runtimeExtensions=plugins.runtimes;
 actions.workspaceManagement={import:async()=>{imports++;return structuredClone(host);},importPreview:async()=>null,list:forbidden,plan:forbidden,apply:forbidden,operation:forbidden,exportInvite:forbidden,busy:()=>false,dispose:async()=>{}};
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),actions,()=>{},{native,memory:new SharedMemoryStore(directory),skills:new SharedSkillsStore(directory)});
 for(const [id,value] of Object.entries(controller.developmentServices()))if(value)plugins.services.register(id,value,{version:1});plugins.connectHost(({method,payload})=>controller.call(method,payload));
 plugins.services.register('native.cli',native.cli,{version:1});
 const targets=(refresh=true)=>controller.call('model-targets/list',{refresh}) as Promise<ModelTarget[]>;
 const create=async()=>{const target=(await targets()).find(t=>t.selection?.model==='native')!;assert.ok(target.ready,target.unavailableReason);return controller.call('session/create',{modelTargetId:target.id,projectPath:directory,modelSelection:{model:'native',effort:'high'}}) as Promise<Session>;};
 const submit=async(s:Session)=>{const draft=await controller.call('draft/prepare',{sessionId:s.id,text:'Synthetic fixture only',bypass:true}) as DraftPreview;await controller.call('draft/submit',{sessionId:s.id,id:draft.id,sourceHash:draft.sourceHash});await until(()=>!!ssh?.writes.some(v=>v.type==='user'&&v.uuid===draft.id));};
 const install=async(id:string,source:string)=>{const file=path.join(directory,id+'.zip'),manifest={schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Isolated Claude SSH synthetic acceptance',capabilities:['host'],main:'main.mjs'};await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(file);return (await plugins.list()).find(p=>p.manifest.id===id)!;};
 return {controller,store,directory,plugins,install,targets,create,submit,bridge,native,host,actions,get imports(){return imports;},get ssh(){return ssh;},get closed(){return closed;},get opened(){return opened;},oldBroker(){execution='local-tools-unverified';},readyBroker(){execution='local-mcp-required';},async close(){await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('approved observation scheduling admits custom frames and releases its policy without losing audit',async()=>{
 const f=await fixture();try{
  const plugin=await f.install('test.observation-policy',`export function activate(api){let calls=0;api.services.register('test.observation',{accepts:frame=>frame.value.type==='stream_event',batchWindowMs:()=>1,auditWindowMs:()=>100},{version:1});const policy=api.services.get('test.observation');api.services.intercept('native.event-semantics','accepts',(next,frame)=>policy.accepts(frame)||next(frame));api.services.override('native.event-semantics',{batchWindowMs:policy.batchWindowMs,auditWindowMs:policy.auditWindowMs});api.services.intercept('native.event-semantics','apply',(next,s,frame)=>{if(frame.value.type==='stream_event')calls++;return next(s,frame);});api.registerCommand('counts',()=>calls);}`);
  await assert.rejects(f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true),/Explicit approval/);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  const s=await f.create();await f.submit(s);
  const emit=()=>f.ssh.frame({type:'stream_event',session_id:f.ssh.thread,event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'PRIVATE_FIXTURE'}}});
  emit();await until(()=>!!f.store.snapshot().sessions.find(x=>x.id===s.id)?.nativeEventAudit?.receipts.some(r=>r.key==='delta/thinking_delta'));
  assert.equal(await f.plugins.command(plugin.manifest.id,'counts',{}),1);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);
  assert.equal(nativeEventSemantics.batchWindowMs(),32);assert.equal(nativeEventSemantics.auditWindowMs(),1000);
  emit();await delay(60);assert.doesNotMatch(JSON.stringify(f.store.snapshot()),/PRIVATE_FIXTURE/);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);emit();await delay(60);assert.equal(await f.plugins.command(plugin.manifest.id,'counts',{}),1);
  await f.controller.call('session/stop',{sessionId:s.id});
 }finally{await f.close();}
});

test('fresh member import uses managed accounts and the approved local installer backend before the first MCP session',async()=>{
 const f=await fixture();try{
  await f.store.update(s=>{s.hosts=[];s.accountCatalogs={};delete s.activeWorkspaceId;});
  const plugin=await f.install('test.member-tools',`export async function activate(api){
   const cli=api.services.get('native.cli'),locate=cli.locate.bind(cli),installed=await locate('claude');let available=false,installs=0;
   api.services.register('test.import-tool-backend',{locate:async runtime=>runtime==='claude'?(available?installed:undefined):locate(runtime),install:async(runtime,update,automatic,method)=>{if(runtime!=='claude'||update||automatic||method!=='native')throw Error('Unexpected installation');installs++;available=true;return []; }},{version:1});
   const backend=api.services.get('test.import-tool-backend');api.services.override('native.cli',{locate:backend.locate,install:backend.install});api.registerCommand('counts',()=>({installs}));
  }`);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  const imported:any=await f.controller.call('studio/import',{previewId:'synthetic',confirm:true});assert.deepEqual(imported.preparation,{ready:true});
  assert.equal(f.imports,1);assert.equal(f.store.snapshot().hosts.length,1);assert.equal(f.store.snapshot().localModelAccounts?.length??0,0);assert.equal(f.opened,0);
  assert.ok((await f.targets(false)).some(t=>t.selection?.model==='native'&&t.ready),'import primes the production selector without manual refresh');
  assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{installs:1});
  const session=await f.create();await f.submit(session);assert.equal(f.opened,1);await f.controller.call('session/stop',{sessionId:session.id});
  await f.controller.call('studio/prepare',{id:imported.id,confirm:true});assert.equal(f.imports,1);assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{installs:1});
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);assert.ok(await f.native.cli.locate('claude'));assert.deepEqual((await f.controller.call('studio/prepare',{id:imported.id,confirm:true}) as any).preparation,{ready:true});
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);await f.controller.call('studio/prepare',{id:imported.id,confirm:true});assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{installs:1});
 }finally{await f.close();}
});

test('failed import preparation preserves the member and explicit recovery does not enroll or submit again',async()=>{
 const f=await fixture();try{
  const locate=f.native.cli.locate.bind(f.native.cli);let installed=false,attempts=0;
  f.native.cli.locate=async runtime=>runtime==='claude'&&!installed?undefined:locate(runtime);
  f.native.cli.install=async()=>{attempts++;if(attempts===1)throw Error('private installation diagnostic');installed=true;return [];};
  const first:any=await f.controller.call('studio/import',{previewId:'synthetic',confirm:true});assert.deepEqual(first.preparation,{ready:false,reason:'runtime'});
  assert.equal(f.imports,1);assert.equal(f.store.snapshot().hosts.length,1);assert.equal(f.opened,0);
  const second:any=await f.controller.call('studio/prepare',{id:first.id,confirm:true});assert.deepEqual(second.preparation,{ready:true});assert.equal(f.imports,1);assert.equal(attempts,2);assert.equal(f.opened,0);
  f.oldBroker();const stale:any=await f.controller.call('studio/prepare',{id:first.id,confirm:true});assert.deepEqual(stale.preparation,{ready:false,reason:'bridge'});assert.equal(f.opened,0);
 }finally{await f.close();}
});

test('concurrent preparation coalesces installation and a changed connection rejects late readiness',async()=>{
 const f=await fixture();try{
  let release!:()=>void,attempts=0;const waiting=new Promise<void>(resolve=>{release=resolve;});
  f.native.cli.locate=async()=>undefined;f.native.cli.install=async()=>{attempts++;await waiting;return [];};
  const one=f.controller.call('studio/prepare',{id:f.host.id,confirm:true}),two=f.controller.call('studio/prepare',{id:f.host.id,confirm:true});
  await until(()=>attempts===1);await f.store.update(s=>{s.hosts[0]!.hostname='changed.invalid';});release();
  assert.deepEqual((await one as any).preparation,{ready:false,reason:'changed'});assert.deepEqual((await two as any).preparation,{ready:false,reason:'changed'});
  assert.equal(attempts,1);assert.equal(f.opened,0);
 }finally{await f.close();}
});

test('configuration update makes native SSH Claude selectable after fresh discovery without submitting a model request',async()=>{
 const f=await fixture();try{
  f.oldBroker();assert.ok((await f.targets()).filter(t=>t.runtime==='claude').every(t=>!t.ready));
  await f.store.update(s=>{s.hosts.push({...s.hosts[0]!,id:'admin',username:'root',role:'admin'});});
  const handle=f.controller.remoteConfigurations.replace('workbench',{
   status:async()=>({installed:true,running:true,bundledVersion:'fixture',canInstall:false,canUpdate:true,canUninstall:true}),
   plan:async(_host,operation)=>({token:'fixture',operation,targets:['/opt/fixture/runtime.py'],preserves:['account-profiles']}),
   apply:async()=>{f.readyBroker();return {installed:true,running:true,bundledVersion:'fixture',canInstall:false,canUpdate:true,canUninstall:true};}
  });
  const plan:any=await f.controller.call('remote-configuration/plan',{id:'admin',configurationId:'workbench',operation:'update'});
  await f.controller.call('remote-configuration/apply',{id:'admin',configurationId:'workbench',planId:plan.id,confirm:true});
  const models=(await f.targets()).filter(t=>t.runtime==='claude');assert.ok(models.some(t=>t.ready&&t.selection?.model==='native'));
  const session=await f.create();assert.equal(session.binding.runtime,'claude');assert.equal(session.binding.hostId,'member');assert.equal(f.opened,0);assert.equal(f.ssh,undefined);handle.dispose();
 }finally{await f.close();}
});
test('production controller routes SSH Claude selection, approval, permission and stop through the native runner',async()=>{
 const f=await fixture();try{
  const s=await f.create();assert.equal(s.binding.hostId,'member');assert.equal(s.binding.localAccountId,undefined);assert.equal(s.status,'idle');
  await f.controller.call('runtime/select',{runtime:'claude',targetId:s.modelTargetId,selection:{model:'native',effort:'low'}});
  await f.controller.call('session/model',{sessionId:s.id,selection:{model:'native',effort:'low'}});await f.submit(s);
  await until(()=>!!f.store.snapshot().sessions[0]!.binding.nativeSessionId);
  await f.controller.call('session/permissions',{sessionId:s.id,permissionMode:'plan'});assert.equal(f.store.snapshot().sessions[0]!.permissionMode,'plan');
  f.ssh.frame({type:'control_request',request_id:'approval',request:{subtype:'can_use_tool',tool_name:'mcp__local_device__Write',input:{file_path:'fixture.txt',content:'Synthetic'}}});
  await until(()=>!!f.store.snapshot().sessions[0]!.nativeApprovals?.length);assert.equal(f.store.snapshot().sessions[0]!.nativeApprovals![0]!.kind,'file');
  await f.controller.call('session/approval',{sessionId:s.id,requestId:'approval',decision:'decline'});assert.equal(f.ssh.writes.at(-1).response.response.behavior,'deny');
  await f.controller.call('session/stop',{sessionId:s.id});assert.equal(f.closed,1);assert.equal(f.store.snapshot().sessions[0]!.status,'idle');assert.equal(f.ssh.writes.filter(v=>v.type==='user').length,1);
  const restored=await new StateStore(f.directory).load();assert.equal(restored.sessions[0]!.binding.hostId,'member');assert.equal(restored.sessions[0]!.permissionMode,'plan');assert.equal(restored.lastModelSelection?.effort,'low');
 }finally{await f.close();}
});
test('remote disconnect without cleanup proof preserves unknown state and never resubmits',async()=>{
 const f=await fixture();try{const s=await f.create();await f.submit(s);f.ssh.cleanup=false;f.ssh.emit('disconnect',{code:255,signal:null,reason:'synthetic loss'});await until(()=>!f.controller.hasActiveSessionWork());assert.equal(f.store.snapshot().sessions[0]!.status,'uncertain');assert.equal(f.closed,1);assert.equal(f.ssh.writes.filter(v=>v.type==='user').length,1);}finally{await f.close();}
});
test('older broker remains disabled with saved selections preserved across restart',async()=>{
 const f=await fixture();try{const s=await f.create();await f.controller.call('runtime/select',{runtime:'claude',targetId:s.modelTargetId,selection:s.modelSelection});f.oldBroker();const rows=await f.targets();assert.ok(rows.filter(t=>t.runtime==='claude').every(t=>!t.ready));await assert.rejects(f.controller.call('draft/prepare',{sessionId:s.id,text:'Blocked'}),/尚未就绪/);const state=await new StateStore(f.directory).load();assert.equal(state.lastModelTargetId,s.modelTargetId);assert.equal(f.opened,0);}finally{await f.close();}
});
test('approved synthetic ZIP plugin registers, replaces and releases the real Claude tool-server entry',async()=>{
 const f=await fixture();try{
  const plugin=await f.install('test.claude-tools',`export function activate(api){
   const service=api.services.get('actions.native-claude'),original=service.openTools.bind(service);let opens=0,closes=0;
   api.services.register('test.claude-tool-backend',{open:async options=>{opens++;const tools=await original(options);return {...tools,close:async()=>{closes++;await tools.close();}};}},{version:1});
   api.services.override('actions.native-claude',{openTools:options=>api.services.get('test.claude-tool-backend').open(options)});
   api.registerCommand('counts',()=>({opens,closes}));
  }`);
  await assert.rejects(f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true),/Explicit approval/);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);const first=await f.create();await f.submit(first);await f.controller.call('session/stop',{sessionId:first.id});assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{opens:1,closes:1});
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);assert.throws(()=>f.plugins.services.get('test.claude-tool-backend'),/unavailable/);const second=await f.create();await f.submit(second);await f.controller.call('session/stop',{sessionId:second.id});assert.equal(f.opened,2);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);const third=await f.create();await f.submit(third);await f.controller.call('session/stop',{sessionId:third.id});assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{opens:1,closes:1});
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);
  const failed=await f.install('test.claude-failure',`export function activate(api){api.services.override('actions.native-claude',{supports:()=>false});throw Error('Synthetic activation failure');}`);await f.plugins.setEnabled(failed.manifest.id,failed.hash,true,true);assert.ok((await f.targets()).some(t=>t.selection&&t.ready));
 }finally{await f.close();}
});

test('approved context plugin reaches production MCP discovery and restores on disable and failed activation',async()=>{
 const f=await fixture();try{
  const plugin=await f.install('test.claude-context',`export function activate(api){
   const service=api.services.get('actions.native-claude'),original=service.openContext.bind(service);let opens=0,closes=0;
   api.services.register('test.context-backend',{open:async options=>{opens++;const context=await original(options);const skill={id:'fixture',hash:'hash',name:'fixture',description:'Fixture',path:'fixture/SKILL.md',directory:'fixture',kind:'skill',modelInvocable:true,userInvocable:true,shellExecution:false,deviceName:'CONTROL_PRIVATE'};return {discover:async dir=>({...await context.discover(dir),skills:[skill],deviceId:'CONTROL_PRIVATE',nested:{SSH_IP:'CONTROL_PRIVATE'},warnings:['Registered fixture context']}),loadSkill:async()=>({skill,instructions:'hostname: user-authored text',execution:{location:'vps',context:'inline'},commands:[],warnings:[],members:['CONTROL_PRIVATE']}),runSkillCommand:context.runSkillCommand.bind(context),close:async()=>{closes++;await context.close();}};}},{version:1});
   api.services.override('actions.native-claude',{openContext:options=>api.services.get('test.context-backend').open(options),normalizeToolResult:(name,value)=>name==='Fixture'?{fixture:true}:value});
   api.registerCommand('counts',()=>({opens,closes}));
  }`);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);const s=await f.create();await f.submit(s);
  // Exercise the actual session gateway opened by ClaudeSshTransport, not an isolated registry.
  const boot=f.ssh.writes[0],forward=f.ssh.spec.args.find(a=>/\.sock:127\.0\.0\.1:\d+$/.test(a))!,port=forward.split(':').at(-1),endpoint='http://127.0.0.1:'+port+boot.toolPath;let sid:string|undefined;
  const rpc=async(body:unknown)=>{const result=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+boot.secret,'Content-Type':'application/json',...(sid?{'Mcp-Session-Id':sid}:{})},body:JSON.stringify(body)});sid??=result.headers.get('Mcp-Session-Id')??undefined;return result.status===202?undefined:result.json();};
  const initialized=await rpc({jsonrpc:'2.0',id:1,method:'initialize'});assert.ok(initialized.result.capabilities.prompts);await rpc({jsonrpc:'2.0',method:'notifications/initialized'});
  const response=await rpc({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'LocalContext',arguments:{}}});assert.deepEqual(JSON.parse(response.result.content[0].text).warnings,['Registered fixture context']);assert.deepEqual(response.result.structuredContent,JSON.parse(response.result.content[0].text));
  assert.ok(!JSON.stringify(response).includes('CONTROL_PRIVATE'));
  const skill=await rpc({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'LoadLocalSkill',arguments:{id:'fixture',hash:'hash'}}});assert.ok(!JSON.stringify(skill).includes('CONTROL_PRIVATE'));assert.equal(skill.result.structuredContent.instructions,'hostname: user-authored text');
  const prompt=await rpc({jsonrpc:'2.0',id:4,method:'prompts/get',params:{name:'skill_fixture',arguments:{}}});assert.ok(!JSON.stringify(prompt).includes('CONTROL_PRIVATE'));assert.match(prompt.result.messages[0].content.text,/user-authored text/);
  assert.deepEqual(f.bridge.normalizeToolResult('Fixture',{}),{fixture:true});
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);assert.deepEqual(f.bridge.normalizeToolResult('Fixture',{}),{});await f.controller.call('session/stop',{sessionId:s.id});assert.throws(()=>f.plugins.services.get('test.context-backend'),/unavailable/);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);const second=await f.create();await f.submit(second);await f.controller.call('session/stop',{sessionId:second.id});assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{opens:1,closes:1});
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);const failed=await f.install('test.context-failure',`export function activate(api){api.services.override('actions.native-claude',{openContext:()=>{throw Error('broken')}});throw Error('activation failed');}`);await f.plugins.setEnabled(failed.manifest.id,failed.hash,true,true);
  const context=await f.bridge.openContext({directory:f.directory,cwd:f.directory,env:{HOME:f.directory,USERPROFILE:f.directory},executable:'unused',signal:new AbortController().signal});assert.ok(!(await context.discover()).warnings.includes('Registered fixture context'));await context.close();
 }finally{await f.close();}
});

test('approved MCP policy/result plugins reach production consumers, unwind independently and retain owned cleanup',async()=>{
 const f=await fixture();const toolsToClose:any[]=[];
 try{
  f.bridge.openTools=ClaudeBridgeService.prototype.openTools.bind(f.bridge);
  f.bridge.openToolProcess=async()=>({definitions:[{name:'Read',inputSchema:{type:'object'}}],call:async()=>({content:[{type:'text',text:'fixture '.repeat(80)}]}),close:async()=>{}});
  const opts={directory:f.directory,cwd:f.directory,executable:'unused',env:{HOME:f.directory,USERPROFILE:f.directory},signal:new AbortController().signal};
  const first=await f.bridge.openTools(opts);toolsToClose.push(first);
  const plugin=await f.install('test.mcp-hardening',`export function activate(api){
   const core=api.services.get('actions.native-claude'),policy=core.toolPolicy.bind(core),open=core.openResultStore.bind(core);let stored=0,closed=0;
   api.services.register('test.mcp-output',{open:async options=>{const store=await open(options);return {inlineBytes:store.inlineBytes,maxResultBytes:store.maxResultBytes,put:async value=>{stored++;return store.put(value);},read:store.read.bind(store),close:async()=>{closed++;await store.close();}};}},{version:1});
   api.services.override('actions.native-claude',{toolPolicy:options=>({...policy(options),inlineBytes:128}),openResultStore:options=>api.services.get('test.mcp-output').open(options)});
   api.services.override('runtime.mcp-sessions',{limits:()=>({maxSessions:1,idleMs:60000})});
   api.registerCommand('counts',()=>({stored,closed}));
  }`);
  await assert.rejects(f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true),/Explicit approval/);await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  const s=await f.create();await f.submit(s);
  const boot=f.ssh.writes[0],forward=f.ssh.spec.args.find(a=>/\.sock:127\.0\.0\.1:\d+$/.test(a))!,endpoint='http://127.0.0.1:'+forward.split(':').at(-1)+boot.toolPath;let sid:string|undefined;
  const rpc=async(method:string,params?:unknown,newSession=false)=>{const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+boot.secret,...(!newSession&&sid?{'Mcp-Session-Id':sid}:{})},body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:1}),method,params})});if(!newSession)sid??=response.headers.get('Mcp-Session-Id')??undefined;return {status:response.status,body:response.status===202?undefined:await response.json()};};
  await rpc('initialize');await rpc('notifications/initialized');assert.equal((await rpc('initialize',undefined,true)).status,429);
  const read=(await rpc('tools/call',{name:'Read',arguments:{}})).body.result,ref=read.structuredContent.output;assert.ok(ref);
  assert.match((await rpc('tools/call',{name:'ReadLocalToolResult',arguments:{id:ref.id}})).body.result.structuredContent.text,/fixture/);
  assert.equal((await first.call('Read',{}) as any).structuredContent,undefined,'Existing connections retain their captured policy');
  const two=await f.install('test.mcp-layer',`export function activate(api){api.services.intercept('runtime.mcp-sessions','limits',(next)=>({...next(),maxSessions:2}));}`);await f.plugins.setEnabled(two.manifest.id,two.hash,true,true);assert.equal(nativeMcpSessionPolicy.limits().maxSessions,2);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);assert.equal(nativeMcpSessionPolicy.limits().maxSessions,2);assert.throws(()=>f.plugins.services.get('test.mcp-output'),/unavailable/);
  assert.match((await rpc('tools/call',{name:'ReadLocalToolResult',arguments:{id:ref.id}})).body.result.structuredContent.text,/fixture/,'Owned handles remain valid until connection cleanup');
  await f.controller.call('session/stop',{sessionId:s.id});await f.plugins.setEnabled(two.manifest.id,two.hash,false);assert.equal(nativeMcpSessionPolicy.limits().maxSessions,32);
  const later=await f.bridge.openTools(opts);toolsToClose.push(later);assert.equal((await later.call('Read',{}) as any).structuredContent,undefined);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);const again=await f.bridge.openTools(opts);toolsToClose.push(again);assert.ok((await again.call('Read',{}) as any).structuredContent.output);await again.close();assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{stored:1,closed:1});
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);
  const failed=await f.install('test.mcp-failed',`export function activate(api){api.services.override('runtime.mcp-sessions',{limits:()=>({maxSessions:0,idleMs:1})});throw Error('Synthetic failure');}`);await f.plugins.setEnabled(failed.manifest.id,failed.hash,true,true);assert.equal(nativeMcpSessionPolicy.limits().maxSessions,32);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);await rm(plugin.directory,{recursive:true,force:true});await f.plugins.refresh();assert.equal(nativeMcpSessionPolicy.limits().maxSessions,32);
 }finally{for(const tools of toolsToClose)await tools.close();await f.close();}
});

test('SSH MCP exposes the complete workbench tool inventory and creates an independent sidebar chat',async()=>{
 const f=await fixture();try{
  const plugin=await f.install('test.workbench-audit',`export function activate(api){const core=api.services.get('workbench.controller');api.services.intercept('workbench.controller','nativePeerTools',(next,id)=>{const tools=next(id);return {...tools,definitions:[...tools.definitions,{name:'workbench_fixture',description:'Synthetic registered workbench tool',inputSchema:{type:'object'}}],call:(name,args,signal)=>name==='workbench_fixture'?Promise.resolve({registered:true}):tools.call(name,args,signal)};});}`);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  const source=await f.create();await f.submit(source);
  await f.store.update(s=>{const chat=s.sessions.find(c=>c.id===source.id)!;chat.messages.at(-1)!.original='请开一个独立会话并发送测试词';chat.messages.at(-1)!.submitted='Open a new independent session and send a test word.';});
  const expected=f.controller.nativePeerTools(source.id).definitions.map(t=>t.name).sort();
  const boot=f.ssh.writes[0],forward=f.ssh.spec.args.find(a=>/\.sock:127\.0\.0\.1:\d+$/.test(a))!,endpoint='http://127.0.0.1:'+forward.split(':').at(-1)+boot.toolPath;let sid:string|undefined,id=0;
  const rpc=async(method:string,params?:unknown)=>{const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+boot.secret,'Content-Type':'application/json',...(sid?{'Mcp-Session-Id':sid}:{})},body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:++id}),method,params})});sid??=response.headers.get('Mcp-Session-Id')??undefined;return response.status===202?undefined:response.json();};
  await rpc('initialize');await rpc('notifications/initialized');
  const tools=await rpc('tools/list');assert.deepEqual(tools.result.tools.filter((t:any)=>t.name.startsWith('workbench_')).map((t:any)=>t.name).sort(),expected);
  const invoke=async(name:string,args:unknown={})=>(await rpc('tools/call',{name,arguments:args})).result;
  assert.deepEqual(JSON.parse((await invoke('workbench_fixture')).content[0].text),{registered:true});
  const list=await invoke('workbench_list_sessions',{includeCurrent:true});assert.ok(!list.isError);assert.match(list.content[0].text,new RegExp(source.id));
  const args={task:'Reply with ping-fixture.',operationId:'create-fixture',authorizationQuote:'Open a new independent session and send a test word.'};
  const created=await invoke('workbench_create_session',args);assert.ok(!created.isError,JSON.stringify(created));const receipt=JSON.parse(created.content[0].text);
  assert.equal(receipt.state,'started');const chat=f.store.snapshot().sessions.find(c=>c.id===receipt.sessionId)!;assert.ok(chat);assert.equal(chat.agentParent,undefined);assert.equal(chat.binding.runtime,'claude');
  const again=JSON.parse((await invoke('workbench_create_session',args)).content[0].text);assert.equal(again.sessionId,receipt.sessionId);assert.equal(f.store.snapshot().sessions.length,2);
  const read=await invoke('workbench_read_session',{sessionId:receipt.sessionId});assert.ok(!read.isError);
  const invalid=await invoke('workbench_create_session',{...args,operationId:'unauthorized',authorizationQuote:'Invented authority'});assert.equal(invalid.isError,true);assert.equal(f.store.snapshot().sessions.length,2);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);assert.ok(!f.controller.nativePeerTools(source.id).definitions.some(t=>t.name==='workbench_fixture'));assert.ok(!(await rpc('tools/list')).result.tools.some((t:any)=>t.name==='workbench_fixture'));assert.ok((await rpc('tools/call',{name:'workbench_fixture',arguments:{}})).error);await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);assert.ok((await rpc('tools/list')).result.tools.some((t:any)=>t.name==='workbench_fixture'));await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);
  await f.controller.call('session/stop',{sessionId:receipt.sessionId});await f.controller.call('session/stop',{sessionId:source.id});
  await assert.rejects(rpc('tools/list'));
 }finally{await f.close();}
});

test('approved context service registration and layered replacement reach selection and native receipts with cleanup',async()=>{
 const f=await fixture();try{
  const plugin=await f.install('test.context-state',`export function activate(api){let observations=0,selections=0;const core=api.services.get('models.context-state'),select=core.select.bind(core);api.services.register('test.context-policy',{select:(...args)=>{selections++;return select(...args);}},{version:1});api.services.override('models.context-state',{select:api.services.get('test.context-policy').select});api.services.intercept('models.context-state','observe',(next,...args)=>{observations++;return next(...args);});api.registerCommand('counts',()=>({observations,selections}));api.registerCommand('recover',s=>core.recover(s));}`);
  await assert.rejects(f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true),/approval/i);await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  const s=await f.create();await f.controller.call('session/model',{sessionId:s.id,selection:{model:'native',effort:'low'}});await f.submit(s);await until(()=>!!f.store.snapshot().sessions[0]?.binding.nativeSessionId);
  f.ssh.frame({type:'assistant',session_id:f.ssh.thread,message:{id:'usage',content:[],usage:{input_tokens:100,output_tokens:1}}});f.ssh.frame({type:'result',session_id:f.ssh.thread,subtype:'success',is_error:false,modelUsage:{native:{contextWindow:1000000}}});await until(()=>!f.controller.hasActiveSessionWork());
  assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{observations:1,selections:1});assert.equal((await f.plugins.command(plugin.manifest.id,'recover',f.store.snapshot().sessions[0]) as {used:number}).used,101);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);await f.controller.call('session/model',{sessionId:s.id,selection:{model:'native',effort:'high'}});assert.equal(f.store.snapshot().sessions[0]!.nativeContextUsage?.capacity,1000000);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);await f.controller.call('session/model',{sessionId:s.id,selection:{model:'native',effort:'low'}});assert.deepEqual(await f.plugins.command(plugin.manifest.id,'counts',{}),{observations:0,selections:1});
 }finally{await f.close();}
});

test('SSH Claude model changes preserve used context and restore each known capacity',async()=>{
 const f=await fixture();try{
  const session=await f.create();await f.submit(session);await until(()=>!!f.store.snapshot().sessions[0]?.binding.nativeSessionId);
  f.ssh.frame({type:'assistant',session_id:f.ssh.thread,message:{id:'reply',model:'native',content:[{type:'text',text:'Fixture'}],usage:{input_tokens:13500,output_tokens:47}}});
  f.ssh.frame({type:'result',session_id:f.ssh.thread,subtype:'success',is_error:false,modelUsage:{native:{contextWindow:1000000}}});
  await until(()=>!f.controller.hasActiveSessionWork());
  const current=f.store.snapshot().sessions[0]!;assert.equal(current.nativeContextUsage?.capacity,1000000);assert.equal(current.nativeContextUsage?.used,13547);
  const reloaded=await new StateStore(f.directory).load();assert.equal(reloaded.sessions[0]!.nativeContextUsage?.capacity,1000000);
  await f.controller.call('session/model',{sessionId:session.id,selection:{model:'native',effort:'low'}});assert.equal(f.store.snapshot().sessions[0]!.nativeContextUsage?.capacity,1000000);
  f.actions.nativeAccounts!.models=async()=>['native','other'].map(model=>({id:model,model,name:model,isDefault:true,efforts:[],serviceTiers:[]}));await f.controller.call('runtime/models',{sessionId:session.id,refresh:true});await f.controller.call('session/model',{sessionId:session.id,selection:{model:'other'}});
  const switched=f.store.snapshot().sessions[0]!;assert.equal(switched.nativeContextUsage?.used,13547);assert.equal(switched.nativeContextUsage?.capacity,null);assert.equal(switched.nativeContextUsage?.estimated,true);assert.equal(switched.binding.nativeSessionId,current.binding.nativeSessionId);
  await f.controller.call('session/model',{sessionId:session.id,selection:{model:'native'}});assert.equal(f.store.snapshot().sessions[0]!.nativeContextUsage?.capacity,1000000);
  assert.equal((await new StateStore(f.directory).load()).sessions[0]!.nativeContextUsage?.modelWindows?.native,1000000);
 }finally{await f.close();}
});

test('approved fork plugin calls real SSH Claude branching, continues independently and restores on disable',async()=>{
 const f=await fixture();try{
  const source=await f.create();await f.submit(source);await until(()=>!!f.store.snapshot().sessions.find(s=>s.id===source.id)?.binding.nativeSessionId);f.ssh.result();await until(()=>f.ssh.state==='closed');
  const saved=f.store.snapshot().sessions.find(s=>s.id===source.id)!,answer=saved.messages.at(-1)!;
  assert.equal(answer.nativeTurnEnd,true,JSON.stringify(saved));assert.ok(answer.nativeItemId);
  const plugin=await f.install('fixture.claude-fork',`export function activate(api){api.registerCommand('fork',async p=>{const options=await api.call('session/fork-options',p);if(!options.workspace.available)throw Error(options.workspace.reason);return api.call('session/fork',{...p,location:'workspace'});});}`);
  await assert.rejects(f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true),/approval/i);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
  const child=await f.plugins.command(plugin.manifest.id,'fork',{sessionId:source.id,messageId:answer.id}) as Session;
  assert.equal(child.branch?.native?.threadId,saved.binding.nativeSessionId);assert.equal(child.branch?.native?.lastMessageId,answer.nativeItemId);assert.equal(child.binding.nativeSessionId,undefined);
  await f.submit(child);await delay(20);const bootstrap=f.ssh.writes.find(v=>v.provider==='claude');assert.deepEqual(bootstrap.fork,child.branch?.native);assert.equal(f.ssh.thread,child.id);
  f.ssh.result();await until(()=>f.ssh.state==='closed');assert.equal(f.store.snapshot().sessions.find(s=>s.id===child.id)?.binding.nativeSessionId,child.id);
  assert.deepEqual(f.store.snapshot().sessions.find(s=>s.id===source.id)?.messages,saved.messages);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,false);await assert.rejects(f.plugins.command(plugin.manifest.id,'fork',{}));
  assert.equal((await f.controller.call('session/fork-options',{sessionId:child.id}) as any).workspace.available,true);
  await f.plugins.setEnabled(plugin.manifest.id,plugin.hash,true);const nested=await f.plugins.command(plugin.manifest.id,'fork',{sessionId:child.id}) as Session;assert.equal(nested.branch?.native?.threadId,child.id);
 }finally{await f.close();}
});

test('first ordinary Claude model listing is ready and transient refresh preserves it',async()=>{const f=await fixture();try{
 assert.ok((await f.targets(false)).some(t=>t.selection?.model==='native'&&t.ready));
 f.actions.nativeAccounts!.models=async()=>{throw Error('transient');};assert.ok((await f.targets(true)).some(t=>t.selection?.model==='native'&&t.ready));
 }finally{await f.close();}});

test('Claude native submission checks and reports quota using only native numeric receipts',async()=>{const f=await fixture();try{
 const events:any[]=[];const runner=(f.controller as any).nativeProvider;
 runner.hooks.quota={begin:async(s:any,h:any)=>events.push(['begin',s.id,h.threadId]),observe:(id:any,u:any)=>events.push(['observe',id,u]),finish:async(id:any,h:any)=>events.push(['finish',id,h.threadId])};
 const s=await f.create();await f.submit(s);assert.equal(events[0][0],'begin');
 f.ssh.frame({type:'result',session_id:f.ssh.thread,subtype:'success',is_error:false,usage:{input_tokens:20,output_tokens:5,cache_read_input_tokens:10}});await until(()=>!f.controller.hasActiveSessionWork());
 assert.equal(events.find(e=>e[0]==='observe')[2].total.totalTokens,35);assert.equal(events.at(-1)[0],'finish');assert.equal(events.at(-1)[2],events[0][2]);
 }finally{await f.close();}});
