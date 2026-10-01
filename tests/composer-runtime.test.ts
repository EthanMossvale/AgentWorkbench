import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { composerCommands, composerScopeKey } from '../packages/composer-core';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { RuntimeExtensionRegistry } from '../packages/runtime-extensions';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import type { Session } from '../packages/contracts';
import type { SkillScan } from '../packages/native-skills';

const scope=(s:Session)=>composerScopeKey({runtime:s.binding.runtime,sessionId:s.id,directory:s.projectPath,targetId:s.modelTargetId});
async function fixture(t:test.TestContext){
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-command-contract-')),store=new StateStore(dir);await store.load();
  const registry=new RuntimeExtensionRegistry();let scan:()=>Promise<SkillScan>=async()=>({skills:[],roots:[],errors:[]});
  const native={handles:()=>false,cli:{isMaintaining:()=>false,locate:async()=>undefined},skills:{scan:()=>scan()},dispose:async()=>{}};
  const controller=new WorkbenchController(store,new SecretStore(dir,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>''}),{runtimeExtensions:registry,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{},{native} as any);
  const session={id:'fixture',projectId:null,projectPath:dir,title:'Fixture',createdAt:new Date().toISOString(),status:'idle',pinned:false,archived:false,group:'',binding:{runtime:'codex',provider:'fixture',accountRef:'fixture',executionId:'fixture',egress:'direct-api'},messages:[]} as Session;
  await store.update(s=>s.sessions.push(session));
  t.after(async()=>{await controller.dispose();await rm(dir,{recursive:true,force:true,maxRetries:3});});
  return {store,controller,session,registry,setScan:(next:typeof scan)=>{scan=next;},get:()=>store.snapshot().sessions[0]!};
}
test('runtime commands distinguish native controls, workbench actions and unsupported transports',()=>{
  const codex=composerCommands('codex'),claude=composerCommands('claude',{compact:true});
  assert.equal(codex.find(c=>c.id==='permissions')?.aliases?.[0],'approvals');assert.ok(codex.some(c=>c.id==='plan'));
  assert.equal(claude.find(c=>c.id==='compact')?.disabledReason,undefined);assert.ok(codex.find(c=>c.id==='compact')?.disabledReason);
  assert.ok(claude.some(c=>c.id==='plan'&&c.runtime==='claude'));assert.equal(claude.find(c=>c.id==='settings')?.source,'workbench');
  assert.ok(composerCommands('demo').every(c=>c.source==='workbench'));
  assert.ok(composerCommands('plugin:fixture',{model:true,permissions:true}).some(c=>c.id==='model'));
});

test('Codex collaboration endpoint persists separately from permissions and refuses busy or foreign runtimes',async t=>{
  const f=await fixture(t);await f.store.update(s=>{s.sessions[0]!.permissionMode='full-access';});
  await f.controller.call('session/collaboration',{sessionId:f.session.id,mode:'plan'});
  assert.equal(f.get().collaborationMode,'plan');assert.equal(f.get().permissionMode,'full-access');assert.equal(f.get().messages.length,0);
  const reloaded=await new StateStore(f.session.projectPath!).load();assert.equal(reloaded.sessions[0]?.collaborationMode,'plan');
  await f.store.update(s=>{s.sessions[0]!.status='running';});
  await assert.rejects(f.controller.call('session/collaboration',{sessionId:f.session.id,mode:'default'}),/BUSY/);
  await f.store.update(s=>{s.sessions[0]!.status='idle';s.sessions[0]!.binding.runtime='claude';});
  await assert.rejects(f.controller.call('session/collaboration',{sessionId:f.session.id,mode:'plan'}),/INVALID/);
  await f.store.update(s=>{s.sessions[0]!.binding.runtime='codex';});
  await assert.rejects(f.controller.call('session/collaboration',{sessionId:f.session.id}),/INVALID/);
  await f.controller.call('session/collaboration',{sessionId:f.session.id,mode:'default'});assert.equal(f.get().permissionMode,'full-access');
});
test('catalog scope rejects stale runtime and same-runtime model targets',async t=>{
  const f=await fixture(t),before=scope(f.session);
  const catalog=await f.controller.call('composer/catalog',{sessionId:f.session.id,runtime:'codex',scope:before}) as any;
  assert.equal(catalog.scope,before);assert.equal(catalog.nativeDiscovery,true);
  assert.equal((await f.controller.call('composer/catalog',{sessionId:f.session.id,targetId:'untrusted-target',projectPath:'untrusted-path'}) as any).scope,before,'Caller fields must not fill gaps in an existing session binding');
  await f.store.update(s=>{s.sessions[0]!.binding.runtime='claude';});
  await assert.rejects(f.controller.call('composer/catalog',{sessionId:f.session.id,runtime:'codex',scope:before}),/COMPOSER_SCOPE_CHANGED/);
  const next=await f.controller.call('composer/catalog',{sessionId:f.session.id,runtime:'claude',scope:scope(f.get())}) as any;
  assert.ok(next.commands.some((c:any)=>c.id==='plan'));assert.ok(next.commands.filter((c:any)=>c.source==='runtime').every((c:any)=>c.runtime==='claude'));
  await f.store.update(s=>{s.sessions[0]!.modelTargetId='different-target';});
  await assert.rejects(f.controller.call('composer/catalog',{sessionId:f.session.id,scope:next.scope}),/COMPOSER_SCOPE_CHANGED/);
  await assert.rejects(f.controller.call('composer/execute',{sessionId:f.session.id,scope:next.scope,commandId:'compact'}),/COMPOSER_SCOPE_CHANGED/);
});

test('Codex plan review marks revision without dispatch and rejects an already answered receipt',async t=>{
  const f=await fixture(t);await f.store.update(s=>{const current=s.sessions[0]!;current.nativeTurnId='turn';current.nativeTurnStatus='completed';current.collaborationMode='plan';current.messages=[{id:'proposal',nativeTurnId:'turn',role:'assistant',original:'Native proposed plan',demo:false,timestamp:'fixture',planReview:{receipt:'receipt',status:'pending'}}];});
  const reference={kind:'message',receipt:'receipt'};const doc=await f.controller.call('session/plan',{sessionId:f.session.id,reference}) as any;assert.equal(doc.canRespond,true);
  assert.deepEqual(await f.controller.call('session/plan/respond',{sessionId:f.session.id,reference,action:'revise'}),{action:'revise'});
  assert.equal(f.get().messages[0]?.planReview?.status,'revise');assert.equal(f.get().messages.length,1);assert.equal(f.get().collaborationMode,'plan');
  await assert.rejects(f.controller.call('session/plan/respond',{sessionId:f.session.id,reference,action:'implement'}),/EXPIRED/);
});
test('a native skill scan finishing after a runtime switch cannot return an old catalog',async t=>{
  const f=await fixture(t);let finish!:(scan:SkillScan)=>void,started!:()=>void;const ready=new Promise<void>(r=>{started=r;});
  f.setScan(()=>{started();return new Promise(r=>{finish=r;});});
  const pending=f.controller.call('composer/catalog',{sessionId:f.session.id,scope:scope(f.session)});
  const rejected=assert.rejects(pending,/COMPOSER_SCOPE_CHANGED/);await ready;
  await f.store.update(s=>{s.sessions[0]!.binding.runtime='claude';});finish({skills:[],roots:[],errors:[]});await rejected;
});
test('command execution refuses unavailable transports and unregistered command IDs',async t=>{
  const f=await fixture(t),p={sessionId:f.session.id,scope:scope(f.session)};
  await assert.rejects(f.controller.call('composer/execute',{...p,commandId:'compact'}),/UNAVAILABLE/);
  await assert.rejects(f.controller.call('composer/execute',{...p,commandId:'shell'}),/UNSUPPORTED/);
  assert.equal(f.get().messages.length,0);assert.equal(f.get().status,'idle');
});
test('registered runtimes get only their declared controls and no foreign native skills',async t=>{
  const f=await fixture(t);let scans=0;f.setScan(async()=>{scans++;throw Error('Foreign skill scan');});
  const remove=f.registry.register('fixture-owner',{apiVersion:1,id:'plugin:fixture',name:'Fixture',description:'Synthetic',permissions:[{value:'default',label:'Default',description:'Synthetic'}],models:[{id:'test',model:'test',name:'Test',isDefault:true,efforts:[],serviceTiers:[]}]},{run:async()=>{},stop:async()=>{}});
  const catalog=await f.controller.call('composer/catalog',{runtime:'plugin:fixture'}) as any;
  assert.ok(catalog.commands.some((c:any)=>c.id==='model'));assert.ok(!catalog.commands.some((c:any)=>c.id==='compact'||c.id==='plan'));assert.deepEqual(catalog.skills,[]);assert.equal(scans,0);
  await remove();await assert.rejects(f.controller.call('composer/catalog',{runtime:'plugin:fixture'}),/RUNTIME_/);
});
test('approved plugins extend catalog and execution with scope checks; disabling restores core',async t=>{
  const f=await fixture(t),plugins=new PluginRegistry(path.join(f.session.projectPath!,'plugins'));await plugins.initialize();
  plugins.connectHost(request=>f.controller.call(request.method,request.payload));t.after(()=>plugins.dispose());
  const manifest={schemaVersion:1,apiVersion:1,id:'test.composer',name:'Composer fixture',version:'1.0.0',description:'Synthetic',capabilities:['host'],main:'main.mjs'};
  const main=`export function activate(api){api.useHost(async(request,next)=>{
    if(request.method==='composer/catalog'){const catalog=await next();return {...catalog,commands:[...catalog.commands,{id:'test.fixture',action:'native',source:'runtime',runtime:catalog.runtime,label:'Fixture',description:'Synthetic action',icon:'document'}]};}
    if(request.method==='composer/execute'&&request.payload.commandId==='test.fixture'){await api.call('composer/catalog',{sessionId:request.payload.sessionId,scope:request.payload.scope});return {fixture:true};}
    return next();
  });}`;
  const file=path.join(f.session.projectPath!,'composer.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)}]));
  await plugins.importZip(file);const record=(await plugins.list())[0]!;await plugins.setEnabled(record.manifest.id,record.hash,true,true);
  const dispatch=(method:string,payload:unknown)=>plugins.dispatch({method,payload},request=>f.controller.call(request.method,request.payload));
  const catalog=await dispatch('composer/catalog',{sessionId:f.session.id}) as any;assert.ok(catalog.commands.some((c:any)=>c.id==='test.fixture'));
  assert.deepEqual(await dispatch('composer/execute',{sessionId:f.session.id,commandId:'test.fixture',scope:catalog.scope}),{fixture:true});
  await assert.rejects(dispatch('composer/execute',{sessionId:f.session.id,commandId:'test.fixture',scope:'stale'}),/SCOPE_CHANGED/);
  await plugins.disableAll();assert.ok(!(await dispatch('composer/catalog',{sessionId:f.session.id}) as any).commands.some((c:any)=>c.id==='test.fixture'));
  await assert.rejects(dispatch('composer/execute',{sessionId:f.session.id,commandId:'test.fixture',scope:catalog.scope}),/COMMAND_UNSUPPORTED/);
});
