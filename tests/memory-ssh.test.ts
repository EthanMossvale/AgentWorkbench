import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {ProcessSupervisor,decodeNativeFrame,type ProcessSpec} from '../services/remote-supervisor';
import {CodexRpcClient,CodexNativeAdapter} from '../packages/runtime-codex';
import {missingBridgeChecks} from '../packages/session-core';
import type {NativeCodexService} from '../services/codex-bridge';
import {ClaudeBridgeService} from '../services/claude-bridge';
import {NativeResources} from '../apps/desktop/host/native-resources';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {SharedMemoryStore} from '../packages/memory-core';
import {SharedSkillsStore} from '../packages/skills-core';
import {encodeZip} from '../packages/native-resources/archive';
import type {AccountCatalog,Session,SshHost} from '../packages/contracts';
import type {ModelTarget} from '../packages/model-api/types';

const wait=async(check:()=>boolean)=>{const end=Date.now()+20000;while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.ok(check(),'Synthetic memory SSH task did not settle');};
const put=async(file:string,text:string)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};
const expectedTools=['workbench_read_memory_handoff','workbench_store_memory_handoff','workbench_verify_memory_handoff'].sort();
type Mode='complete'|'wait'|'approval'|'fail';
class Wire extends ProcessSupervisor{
  writes:any[]=[];thread=randomUUID();failure?:unknown;mode:Mode='complete';
  onTurn?:()=>Promise<void>;
  replies=new Map<string,(value:any)=>void>();
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  async start(){this.state='running';}
  async write(v:any){
    this.writes.push(v);
    if(v.provider==='claude')this.frame({method:'workbench/bridgeReady',params:{provider:'claude',transport:'official-mcp-v1',sessionReceipt:{threadId:this.thread,cwd:v.cwd,environmentId:'local-device'}}});
    else if(v.type==='workbench_close'){this.frame({method:'workbench/bridgeClosed',params:{cleanupConfirmed:true}});queueMicrotask(()=>void this.stop());}
    else if(v.type==='user'){
      this.frame({type:'user',session_id:this.thread,uuid:v.uuid,message:v.message});
      setTimeout(()=>void this.onTurn?.().catch(e=>{this.failure=e;this.result('claude',true);}),0);
    }else if(v.method&&v.id!==undefined){
      this.frame({id:v.id,result:v.method==='thread/start'?{thread:{id:this.thread}}:v.method==='turn/start'?{turn:{id:'turn'}}:{}});
      if(v.method==='turn/start')setTimeout(()=>void this.onTurn?.().catch(e=>{this.failure=e;this.result('codex',true);}),0);
    }else if(v.id!==undefined){this.replies.get(String(v.id))?.(v);this.replies.delete(String(v.id));}
  }
  result(runtime:'codex'|'claude',failed=false){this.frame(runtime==='codex'?{method:'turn/completed',params:{threadId:this.thread,turn:{id:'turn',status:failed?'failed':'completed'}}}:{type:'result',session_id:this.thread,subtype:failed?'error_during_execution':'success',is_error:failed});}
  async tool(name:string,args:unknown={}){
    const id=randomUUID(),reply=new Promise<any>(resolve=>this.replies.set(id,resolve));
    this.frame({id,method:'item/tool/call',params:{threadId:this.thread,turnId:'turn',callId:id,tool:name,arguments:args}});
    const r=await reply;assert.equal(r.result?.success,true,JSON.stringify(r));return JSON.parse(r.result.contentItems[0].text);
  }
  async stop(reason='fixture'){if(this.state!=='closed'){this.state='closed';this.emit('disconnect',{code:0,signal:null,reason});}return {code:0,signal:null,reason};}
}

async function fixture(t:TestContext){
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-memory-ssh-')),store=new StateStore(root);await store.load();
  const host:SshHost={id:'member',name:'Synthetic',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',workspaceGeneration:'wg',ownerId:'fixture',identityFile:path.join(root,'unused-key'),knownHostsFile:path.join(root,'unused-hosts')};
  const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'w',revision:1,selectionRevision:1,selectedAccountId:'x',selectedClaudeAccountId:'c',accounts:[{id:'x',generation:'xg',provider:'codex',status:'authenticated',observedAt:'now'},{id:'c',generation:'cg',provider:'claude',status:'authenticated',observedAt:'now'}]};
  await store.update(s=>{s.hosts=[host];s.accountCatalogs={[host.id]:catalog};s.permissionPreferences={projectless:{codex:'full-access',claude:'full-access'}};});
  const native=new NativeResources(root,{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},root,{cliOptions:{executables:{codex:process.execPath,claude:process.execPath}}});await native.initialize();
  t.mock.method(native.memoryControls,'canReceive',async()=>true);
  const wires:Wire[]=[],closed:string[]=[],seen:Session[]=[],inventories:string[][]=[];let mode:Mode='complete',globalDisposes=0,localClosed=0;
  const receive=async(runtime:'codex'|'claude',wire:Wire,call:(name:string,input?:unknown)=>Promise<any>)=>{
    if(mode==='wait')return;
    if(mode==='fail'){wire.result(runtime,true);return;}
    if(mode==='approval'){
      wire.frame(runtime==='codex'?{id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:wire.thread,turnId:'turn',itemId:'cmd',command:'fixture'}}:{type:'control_request',request_id:'approval',request:{subtype:'can_use_tool',tool_name:'Write',input:{file_path:'fixture',content:'fixture'}}});return;
    }
    const manifest=await call('workbench_read_memory_handoff');assert.equal(manifest.recipientRuntime,runtime);
    assert.ok(manifest.entries.every((e:any)=>e.sourceRuntime!==runtime));
    const entries=[];for(const e of manifest.entries){const r=await call('workbench_read_memory_handoff',{archiveId:e.archiveId});entries.push({archiveId:e.archiveId,title:'Scoped SSH reference',content:r.content,topic:'fixture'});}
    const saved=await call('workbench_store_memory_handoff',{entries});assert.ok(saved.entries.every((e:any)=>e.state==='verified'),JSON.stringify(saved));
    assert.equal((await call('workbench_verify_memory_handoff')).complete,true);wire.result(runtime);
  };
  const handles=new Map<string,any>();
  const model=(runtime:string)=>[{id:runtime+'-model',model:runtime+'-model',name:'Synthetic',isDefault:true,efforts:['low','high'],serviceTiers:[]}];
  const codex:NativeCodexService={supports:(_h,s)=>s.binding.runtime==='codex'&&s.binding.egress==='vps',defaultDirectory:id=>path.join(root,'sessions',id),models:async()=>model('codex'),
    connect:async(_h,s,o)=>{
      assert.equal(s.binding.nativeSessionId,undefined);assert.equal(s.binding.executionSessionId,undefined);seen.push(structuredClone(s));
      const wire=new Wire({executable:'unused',args:[]});wires.push(wire);const rpc=new CodexRpcClient(wire,s.id);await rpc.initialize();
      const evidence:any={runtime:'codex',runtimeVersion:'0.155.1',hostId:host.id,executionId:'local-device',accountRef:s.binding.accountRef,checks:Object.fromEntries(missingBridgeChecks('codex').map(k=>[k,'verified']))};
      const adapter=new CodexNativeAdapter(rpc,s.binding,{environmentId:'local-device',cwd:s.projectPath!},evidence,'0.155.1',o.context,s.permissionMode,undefined,o.peerTools);
      await adapter.registerEnvironment('ws://127.0.0.1:12345/'+'a'.repeat(64));await adapter.startThread(s.modelSelection?.model);
      inventories.push(wire.writes.find(v=>v.method==='thread/start').params.dynamicTools.map((v:any)=>v.name).sort());
      wire.onTurn=()=>receive('codex',wire,(n,a)=>wire.tool(n,a));
      const handle:any={adapter,threadId:wire.thread,connection:{rpc,interrupt:async()=>{wire.result('codex');await wire.stop();}}};handles.set(s.id,{handle,wire});return handle;
    },close:async id=>{closed.push(id);await handles.get(id)?.wire.stop();handles.delete(id);},dispose:async()=>{globalDisposes++;for(const {wire} of handles.values())await wire.stop();handles.clear();}};
  const claude=new ClaudeBridgeService(root,(spec:ProcessSpec)=>{
    const wire=new Wire(spec);wires.push(wire);
    wire.onTurn=async()=>{
      const boot=wire.writes[0],forward=spec.args.find(a=>/\.sock:127\.0\.0\.1:\d+$/.test(a))!,url='http://127.0.0.1:'+forward.split(':').at(-1)+boot.toolPath;
      let sid:string|undefined,id=0;
      const rpc=async(method:string,params?:unknown)=>{const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+boot.secret,'Content-Type':'application/json',...(sid?{'Mcp-Session-Id':sid}:{})},body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:++id}),method,params})});sid??=r.headers.get('Mcp-Session-Id')??undefined;return r.status===202?undefined:r.json();};
      await rpc('initialize');await rpc('notifications/initialized');inventories.push((await rpc('tools/list')).result.tools.filter((v:any)=>v.name.startsWith('workbench_')).map((v:any)=>v.name).sort());
      await receive('claude',wire,async(name,input={})=>{const r=(await rpc('tools/call',{name,arguments:input})).result;assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);});
    };return wire;
  });
  claude.openTools=async()=>({definitions:[],call:async()=>{throw Error('No general tools in this fixture');},close:async()=>{localClosed++;}});
  const create=claude.createTransport.bind(claude);claude.createTransport=o=>{seen.push(structuredClone(o.session));return create(o);};
  const forbidden=async():Promise<any>=>{throw Error('No live SSH, model calls or authentication permitted');};
  const controller=new WorkbenchController(store,new SecretStore(root,{encrypt:forbidden,decrypt:forbidden} as any),{nativeCodex:codex,nativeClaude:claude,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],modelFetcher:forbidden,nativeAccounts:{models:async()=>model('claude'),status:async()=>({accountId:'c',provider:'claude',installed:true,authenticated:true,versionMatched:true,execution:'local-mcp-required',block:null}),createClaude:forbidden,loginCommand:forbidden},accountCatalog:{list:async()=>structuredClone(catalog),select:forbidden,start:forbidden,status:forbidden,cancel:forbidden,dispose:async()=>{}}},()=>{},{native,memory:new SharedMemoryStore(root),skills:new SharedSkillsStore(root)});
  t.after(async()=>{await controller.dispose();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const registry=native.plugins;for(const [id,value] of Object.entries(controller.developmentServices()))if(value)registry.services.register(id,value,{version:1});registry.connectHost(r=>controller.call(r.method,r.payload));
  await put(path.join(root,'.codex','memories','source.md'),'Scoped Codex evidence.');await put(path.join(root,'.claude','projects','fixture','memory','source.md'),'Scoped Claude evidence.');await native.memory.configure({enabled:true,initialSources:'both'});
  const targets=await controller.call('model-targets/list',{refresh:true}) as ModelTarget[];
  for(const runtime of ['codex','claude'] as const){const target=targets.find(v=>v.runtime===runtime&&v.selection)!;assert.ok(target?.ready);await controller.call('runtime/select',{runtime,targetId:target.id,selection:{model:runtime+'-model',effort:'high'}});}
  const run=async(runtime?:string)=>{await controller.call('native-memory/process',runtime?{runtime}:{});await wait(()=>!native.memory.background.busy());for(const wire of wires)if(wire.failure)throw wire.failure;};
  return {root,native,controller,store,wires,seen,inventories,closed,registry,codex,run,setMode:(v:Mode)=>{mode=v;},get globalDisposes(){return globalDisposes;},get localClosed(){return localClosed;}};
}

test('both SSH defaults reach native transports and local verified storage without foreground sessions or global shutdown',async t=>{
  const f=await fixture(t);await f.run();
  assert.deepEqual(f.native.memory.background.list().map(v=>[v.runtime,v.state,v.processed]),[['codex','completed',1],['claude','completed',1]],JSON.stringify(f.native.memory.background.list()));
  assert.deepEqual(f.inventories,[expectedTools,expectedTools]);assert.equal(f.store.snapshot().sessions.length,0);assert.equal(f.globalDisposes,0);assert.equal(f.localClosed,1);
  assert.equal(f.seen.length,2);assert.ok(f.seen.every(s=>s.modelSelection?.effort==='high'&&s.binding.hostId==='member'&&s.permissionMode==='full-access'));
  assert.ok(f.closed.every(id=>id===f.seen[0]!.id));assert.ok(f.wires.every(w=>w.state==='closed'));
  for(const [folder,entry] of [['.codex','AGENTS.md'],['.claude','CLAUDE.md']])assert.match(await readFile(path.join(f.root,folder!,entry!),'utf8'),/Imported memory references/);
  const restored=await new StateStore(f.root).load();assert.ok(restored.nativeMemoryDefaults?.codex?.targetId.startsWith('ssh/'));assert.ok(restored.nativeMemoryDefaults?.claude?.targetId.startsWith('ssh/'));
});

for(const runtime of ['codex','claude'] as const)for(const mode of ['approval','fail','wait'] as const)test(`${runtime} SSH ${mode} stops the owned job without replay or foreground mutation`,async t=>{
  const f=await fixture(t);f.setMode(mode);
  await f.controller.call('native-memory/process',{runtime});await wait(()=>f.wires.some(w=>w.writes.some(v=>v.type==='user'||v.method==='turn/start')));
  assert.equal(f.native.memory.background.busy('member'),true);
  await assert.rejects(f.controller.call('host/remove',{id:'member',confirm:true}),/等待回执/);
  if(mode==='wait'){await f.native.memory.background.cancel(f.native.memory.background.list().at(-1)!.id);}
  await wait(()=>!f.native.memory.background.busy());
  const task=f.native.memory.background.list().at(-1)!;assert.equal(task.state,mode==='approval'?'blocked':mode==='fail'?'failed':'cancelled');
  if(mode==='approval')assert.equal(task.reason,'MEMORY_BACKGROUND_INTERACTION_REQUIRED');
  assert.equal(task.processed,0);assert.equal(f.wires.length,1);assert.equal(f.globalDisposes,0);assert.equal(f.store.snapshot().sessions.length,0);assert.ok(f.wires.every(w=>w.state==='closed'));
  assert.ok(f.wires.every(w=>!w.writes.some(v=>v.type==='control_response'||v.id==='approval')),'No automatic approval');
  if(mode!=='wait'){const before=f.wires.length;await f.native.memory.sync();await new Promise(r=>setTimeout(r,30));assert.equal(f.wires.length,before);}
});

for(const runtime of ['codex','claude'] as const)test(`${runtime} SSH rejects changed host identity before a memory tool can read or write`,async t=>{
  const f=await fixture(t);f.setMode('wait');await f.controller.call('native-memory/process',{runtime});
  await wait(()=>f.wires.some(w=>w.writes.some(v=>v.type==='user'||v.method==='turn/start')));
  await f.store.update(s=>{s.hosts[0]!.workspaceGeneration='changed';});
  f.setMode('complete');const wire=f.wires[0]!;
  await wire.onTurn!().catch(e=>{wire.failure=e;wire.result(runtime,true);});
  await wait(()=>!f.native.memory.background.busy());
  assert.ok(wire.failure);assert.equal(f.native.memory.background.list().at(-1)!.processed,0);
  assert.notEqual(f.native.memory.background.list().at(-1)!.state,'completed');assert.equal(f.globalDisposes,0);
});

test('SSH read-only and plan defaults never start transports or silently raise permission',async t=>{
  const f=await fixture(t);await f.store.update(s=>{s.permissionPreferences={projectless:{codex:'read-only',claude:'plan'}};});
  for(const runtime of ['codex','claude'])await f.run(runtime);
  assert.equal(f.wires.length,0);assert.equal(f.native.memory.background.list().length,2);assert.ok(f.native.memory.background.list().every(v=>v.state==='blocked'&&v.reason==='MEMORY_BACKGROUND_READ_ONLY'));
});

test('owned Codex SSH cleanup failure stays uncertain even after verified storage',async t=>{
  const f=await fixture(t),close=f.codex.close.bind(f.codex);
  t.mock.method(f.codex,'close',async(id:string)=>{await close(id);throw Error('Synthetic unconfirmed cleanup');});
  await f.run('codex');const task=f.native.memory.background.list().at(-1)!;
  assert.equal(task.processed,1);assert.equal(task.state,'uncertain');assert.equal(task.reason,'MEMORY_BACKGROUND_CLEANUP_UNCONFIRMED');assert.equal(f.globalDisposes,0);
});

test('approved executor registration replaces SSH dispatch and disable restores both production native routes',async t=>{
  const f=await fixture(t),id='test.memory-ssh',zip=path.join(f.root,'plugin.zip');
  const code=`export function activate(api){let calls=0;api.onDispose(api.services.get('native.memory-background').registerExecutor({mode:'consolidation',supports:t=>!!t.binding.hostId,run:async task=>{calls++;const m=await task.read({});await task.store({entries:m.entries.map(e=>({archiveId:e.archiveId,title:'Scoped plugin reference',content:'Synthetic registered receiver.'}))});return {state:'completed'};}}));api.registerCommand('process',()=>api.call('native-memory/process'));api.registerCommand('count',()=>calls);}`;
  await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic SSH receiver',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(code)}]));
  await f.registry.importZip(zip);const plugin=(await f.registry.list())[0]!;await assert.rejects(f.registry.setEnabled(id,plugin.hash,true),/approval/i);await f.registry.setEnabled(id,plugin.hash,true,true);
  await f.registry.command(id,'process',{});await wait(()=>!f.native.memory.background.busy());assert.equal(await f.registry.command(id,'count',{}),2);assert.equal(f.wires.length,0);
  await f.registry.setEnabled(id,plugin.hash,false);
  await put(path.join(f.root,'.codex','memories','later.md'),'Later Codex evidence.');await put(path.join(f.root,'.claude','projects','fixture','memory','later.md'),'Later Claude evidence.');await f.run();assert.equal(f.wires.length,2);assert.ok(f.native.memory.background.list().every(v=>v.state==='completed'));
  await f.registry.setEnabled(id,plugin.hash,true);await f.run();assert.equal(f.wires.length,2);await f.registry.setEnabled(id,plugin.hash,false);
});
