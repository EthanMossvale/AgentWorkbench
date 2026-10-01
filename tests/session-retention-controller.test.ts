import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {NativeSessionStorage} from '../packages/remote-account-catalog/session-storage';
import {NativeCodexRunner} from '../apps/desktop/host/native-codex';
import type {NativeCodexService} from '../services/codex-bridge';
import type {Session,SshHost,AppState,DraftPreview} from '../packages/contracts';

const host:SshHost={id:'admin',name:'Fixture',hostname:'retention.example.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'generation'};
const response=(value:unknown)=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:true,value}),stderr:''});
test('background archive does not take the CLI task-admission lock and disabling its policy cancels it',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-controller-')),store=new StateStore(directory);await store.load();
 await store.update(state=>{state.hosts=[host];state.sessions=[{id:'native',title:'Fixture',projectId:null,pinned:false,archived:false,group:'',createdAt:'2026-09-28T00:00:00Z',status:'idle',messages:[],binding:{runtime:'codex',provider:'openai',accountRef:'vps-account:a/g/codex/account/ag',hostId:'admin',executionId:'local-device',egress:'vps'}} as Session];});
 let entered!:()=>void,cancelled=false,configured=false;const started=new Promise<void>(resolve=>{entered=resolve;});
 const storage=new NativeSessionStorage(path.join(directory,'archives'),async(_h,_c,o)=>{const r=JSON.parse(Buffer.from(o!.stdin!.match(/b64decode\('([^']+)'\)/)![1]!,'base64').toString()).request;
  if(r.provider==='codex'){entered();await new Promise<void>((_resolve,reject)=>o!.signal!.addEventListener('abort',()=>{cancelled=true;reject(o!.signal!.reason);},{once:true}));}return response({candidates:[]});
 });
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),{sessionStorage:storage,remoteCliPolicies:{configure:async()=>{configured=true;return {revision:1,autoUpdate:false,reclaimIdle:false,idleHours:24};},autoUpdate:async()=>({status:'skipped'})},pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
 controller.remoteConfigurations.replace('workbench',{status:async()=>({installed:false,running:false,bundledVersion:'fixture',canInstall:true,canUpdate:false,canUninstall:false}),plan:async()=>{throw Error('Not used');},apply:async()=>{throw Error('Not used');}});
 try{const running=controller.maintainRemote();await started;
  // The ordinary native capability fence is reached; retention must not reject
  // unrelated work earlier with the provider-wide maintenance lock.
  await assert.rejects(controller.call('draft/prepare',{sessionId:'native',text:'synthetic task'}),/H 原生桥/);
  await controller.call('remote-cli/configure',{id:'admin',provider:'codex',revision:0,changes:{reclaimIdle:false}});
  await running;assert.equal(cancelled,true);assert.equal(configured,true);
 }finally{await controller.dispose();await rm(directory,{recursive:true,force:true});}
});

test('stopping native connection preparation aborts restoration before any model connection',async()=>{
 let entered!:()=>void,connected=0;const started=new Promise<void>(resolve=>{entered=resolve;});
 const session={id:'native',projectId:null,projectPath:tmpdir(),pinned:false,archived:false,group:'',title:'Fixture',createdAt:'2026-09-28T00:00:00Z',status:'idle',messages:[],binding:{runtime:'codex',provider:'openai',accountRef:'vps-account:a/g/codex/account/ag',hostId:'admin',executionId:'local-device',egress:'vps'}} as Session;
 const state={sessions:[session],hosts:[host]} as AppState;
 const service={supports:()=>true,connect:async()=>{connected++;throw Error('Must not connect');},close:async()=>{},dispose:async()=>{}} as unknown as NativeCodexService;
 const runner=new NativeCodexRunner(service,{snapshot:()=>state,update:async fn=>fn(state),context:async()=>({}),peers:()=>({}),observe:async()=>{},translate:()=>{},beforeConnect:async(_s,_h,signal)=>{entered();await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 try{const running=runner.submit('native',{id:'draft',original:'synthetic task',translated:'synthetic task'} as DraftPreview).catch(error=>error);await started;await runner.stop('native');assert.ok(await running instanceof Error);assert.equal(connected,0);assert.equal(runner.busy('native'),false);assert.equal(session.status,'idle');assert.equal(session.messages.length,0);}finally{await runner.dispose();}
});
