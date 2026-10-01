import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ProcessSupervisor,decodeNativeFrame,type ProcessSpec} from '../services/remote-supervisor';
import {ClaudeBridgeService,ClaudeSshTransport,type NativeClaudeOptions} from '../services/claude-bridge';
import {openOfficialClaudeTools,ClaudeToolMcpSession,LOCAL_CLAUDE_TOOLS,type ClaudeToolServer} from '../services/claude-bridge/tools';
import {sanitizeWorkbenchMcpPayload} from '../services/claude-bridge/model-safety';
import type {PermissionMode,Session,SshHost} from '../packages/contracts';
import {NativeActivityTracker} from '../packages/collaboration-core/activity';

const host:SshHost={id:'member',name:'Fixture',hostname:'fixture.invalid',port:22,role:'workspace',username:'member',ownerId:'fixture',workspaceGeneration:'w',identityFile:path.resolve('build/qa/unused-key'),knownHostsFile:path.resolve('build/qa/unused-known-hosts')};
function session():Session{return {id:randomUUID(),projectId:null,title:'Fixture',pinned:false,archived:false,group:'',status:'idle',createdAt:'now',messages:[],permissionMode:'default',projectPath:'C:\\fixture',binding:{runtime:'claude',provider:'anthropic',accountRuntime:'native-owner',accountRef:'vps-account:a/g/claude/c/cg',hostId:host.id,executionId:'local-device',egress:'vps'},modelSelection:{model:'native',effort:'high'}};}
class SyntheticProcess extends ProcessSupervisor {
  writes:any[]=[];stops=0;answer:(value:any)=>void=()=>{};
  async start(){this.state='running';}
  async write(value:any){this.writes.push(value);this.answer(value);}
  frame(value:any){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  async stop(reason='fixture'){this.stops++;this.state='closed';const result={code:0,signal:null,reason};this.emit('disconnect',result);return result;}
}
const toolFixture=()=>{let calls:any[]=[],closed=0;const tools:ClaudeToolServer={definitions:LOCAL_CLAUDE_TOOLS.map(name=>({name,inputSchema:{type:'object'}})),async call(name,args,signal){signal?.throwIfAborted();calls.push({name,args});return {content:[{type:'text',text:'fixture result'}]};},async close(){closed++;}};return {tools,calls,get closed(){return closed;}};};

test('official tool adapter isolates credentials and forwards only native file/process tools',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-claude-tools-'));let native!:SyntheticProcess;
 try{
  const controller=new AbortController();
  const tools=await openOfficialClaudeTools({directory,executable:'synthetic',cwd:directory,env:{HOME:'real-local-home',PATH:'local-path',CLAUDE_CODE_GIT_BASH_PATH:'C:\\fixture\\bash.exe',CLAUDE_CODE_USE_POWERSHELL_TOOL:'1',ANTHROPIC_API_KEY:'must-not-pass',CLAUDE_CODE_OAUTH_TOKEN:'must-not-pass',CLAUDECODE:'1'},signal:controller.signal},spec=>{
   native=new SyntheticProcess(spec);native.answer=value=>{if(!value.id)return;native.frame({jsonrpc:'2.0',id:value.id,result:value.method==='tools/list'?{tools:[...LOCAL_CLAUDE_TOOLS,'Agent','WebFetch','Skill','ScheduleWakeup'].map(name=>({name,inputSchema:{type:'object'}}))}:value.method==='tools/call'?{content:[{type:'text',text:'official result'}]}:{protocolVersion:'2024-11-05'}});};return native;
  });
  assert.equal(native.spec.env!.HOME,'real-local-home');assert.equal(native.spec.env!.ANTHROPIC_BASE_URL,'http://127.0.0.1:1');assert.equal(native.spec.env!.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.equal(native.spec.env!.CLAUDECODE,undefined);assert.ok(!native.spec.args.includes('--print'));assert.deepEqual(native.spec.args.slice(-2),['mcp','serve']);
  assert.equal(native.spec.env!.CLAUDE_CODE_GIT_BASH_PATH,'C:\\fixture\\bash.exe');assert.equal(native.spec.env!.CLAUDE_CODE_USE_POWERSHELL_TOOL,'1');
  assert.equal(tools.definitions.length,LOCAL_CLAUDE_TOOLS.length);await assert.rejects(tools.call('Agent',{}),/FORBIDDEN/);await tools.call('Read',{file_path:'fixture'});
  native.frame({jsonrpc:'2.0',id:'roots',method:'roots/list'});assert.deepEqual(native.writes.at(-1),{jsonrpc:'2.0',id:'roots',result:{roots:[{uri:pathToFileURL(directory).href,name:'project'}]}});
  native.frame({jsonrpc:'2.0',id:'sampling',method:'sampling/create'});assert.equal(native.writes.at(-1)?.error?.code,-32601);
  assert.equal(native.writes.filter(v=>v.method==='tools/call').length,1);assert.ok(!native.writes.some(v=>v.type==='user'));
  await tools.close();assert.equal(native.stops,1);assert.deepEqual(await readdir(directory),[]);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('workbench MCP metadata redaction removes control-plane identity but preserves user data',()=>{
 const value={authorityId:'authority',authorityGeneration:'generation',deviceId:'device',deviceName:'laptop',fingerprint:'fingerprint',hostId:'host',ownerId:'owner',remoteWorkspaceId:'workspace',accountRef:'vps-account:secret',host:'fixture.invalid',hostname:'fixture.invalid',hostPublicKeys:['ssh-ed25519 AAAA'],identityFile:'C:\\Users\\A\\.ssh\\id',knownHostsFile:'C:\\Users\\A\\.ssh\\known_hosts',sshPath:'/tmp/ssh',socketPath:'/tmp/socket',workspaceId:'workspace',workspaceGeneration:'w',username:'member',connection:{hostname:'fixture.invalid'},members:[{username:'member'}],devices:[{deviceId:'device'}],ssh:{path:'/tmp/socket'},result:{hostname:'user-authored-value',keep:'yes'},body:'hostname: preserve inside user-authored text'};
 const safe:any=sanitizeWorkbenchMcpPayload(value);
 assert.deepEqual(safe,{result:{keep:'yes'},body:'hostname: preserve inside user-authored text'});
});

test('MCP privacy handles aliases, deep metadata and cycles without returning an unexamined subtree',()=>{
 assert.deepEqual(sanitizeWorkbenchMcpPayload({nested:[{SSH_IP:'private',device_name:'private',IP_ADDRESS:'private',keep:'public'}]}),{nested:[{keep:'public'}]});
 let deep:any={hostname:'private'};for(let i=0;i<34;i++)deep={nested:deep};
 assert.throws(()=>sanitizeWorkbenchMcpPayload(deep),/LOCAL_CONTEXT_METADATA_INVALID/);
 const cycle:any={};cycle.nested=cycle;assert.throws(()=>sanitizeWorkbenchMcpPayload(cycle),/LOCAL_CONTEXT_METADATA_INVALID/);
 assert.throws(()=>sanitizeWorkbenchMcpPayload({toJSON:()=>({hostname:'private'})}),/LOCAL_CONTEXT_METADATA_INVALID/);
});

test('local MCP mode gates mutations, rejects model tools and never synthesizes tool results',async()=>{
 const fixture=toolFixture();let mode:PermissionMode='plan',allowed=true;
 const mcp=new ClaudeToolMcpSession(fixture.tools,()=>mode,()=>{if(!allowed)throw Error('revoked');});
 const request=(id:number,method:string,params?:unknown)=>mcp.handle({jsonrpc:'2.0',id,method,params}) as Promise<any>;
 assert.ok((await request(1,'tools/list')).error);assert.equal((await request(2,'initialize',{protocolVersion:'2024-11-05'})).result.protocolVersion,'2024-11-05');await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 assert.equal((await request(3,'tools/call',{name:'Write'})).result.isError,true);assert.equal((await request(4,'tools/call',{name:'Read'})).result.content[0].text,'fixture result');
 assert.ok((await request(5,'tools/call',{name:'Agent'})).error);mode='full-access';await request(6,'tools/call',{name:'Write'});assert.equal(fixture.calls.length,2);
 assert.equal((await request(7,'tools/call',{name:'Bash',arguments:{run_in_background:true}})).result.isError,true);allowed=false;await assert.rejects(request(8,'tools/list'),/revoked/);mcp.dispose();assert.ok((await request(9,'tools/list')).error);
});

test('official MCP server requests cannot complete a client request with the same ID',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-mcp-peer-'));let native!:SyntheticProcess;
 try{
  const tools=await openOfficialClaudeTools({directory,executable:'synthetic',cwd:directory,env:{},signal:new AbortController().signal},spec=>{
   native=new SyntheticProcess(spec);native.answer=value=>{
    if(!value.method||!value.id)return;
    if(value.method==='initialize'){assert.deepEqual(value.params.capabilities,{roots:{listChanged:false}});native.frame({jsonrpc:'2.0',id:value.id,result:{protocolVersion:'2024-11-05'}});return;}
    native.frame({jsonrpc:'2.0',id:value.id,method:'roots/list'});
    native.frame({jsonrpc:'2.0',id:value.id,method:'ping'});
    native.frame({jsonrpc:'2.0',id:value.id,method:'sampling/createMessage'});
    queueMicrotask(()=>native.frame({jsonrpc:'2.0',id:value.id,result:value.method==='tools/list'?{tools:LOCAL_CLAUDE_TOOLS.map(name=>({name,inputSchema:{type:'object'}}))}:{content:[{type:'text',text:'confirmed native result'}]}}));
   };return native;
  });
  const result:any=await tools.call('Read',{});assert.equal(result.content[0].text,'confirmed native result');
  const call=native.writes.find(v=>v.method==='tools/call'),replies=native.writes.filter(v=>v.id===call.id&&!v.method);
  assert.equal(replies.length,3);assert.equal(replies[0].result.roots[0].uri,pathToFileURL(directory).href);assert.equal(replies[0].result.roots[0].name,'project');assert.deepEqual(replies[1].result,{});assert.equal(replies[2].error.code,-32601);
  await tools.close();assert.equal(native.stops,1);assert.deepEqual(await readdir(directory),[]);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('MCP version negotiation selects a supported version and rejects an incompatible official server',async()=>{
 for(const version of ['2024-11-05','2025-03-26','unknown']){
  const mcp=new ClaudeToolMcpSession(toolFixture().tools,()=> 'default',()=>{});
  const response:any=await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:version}});
  assert.equal(response.result.protocolVersion,version==='unknown'?'2025-03-26':version);assert.equal(response.result.capabilities.tools.listChanged,false);mcp.dispose();
 }
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-mcp-version-'));let native!:SyntheticProcess;
 try{
  await assert.rejects(openOfficialClaudeTools({directory,executable:'synthetic',cwd:directory,env:{},signal:new AbortController().signal},spec=>{
   native=new SyntheticProcess(spec);native.answer=value=>{if(value.method==='initialize')native.frame({jsonrpc:'2.0',id:value.id,result:{protocolVersion:'unsupported'}});};return native;
  }),/CLAUDE_LOCAL_MCP_VERSION_UNSUPPORTED/);
  assert.equal(native.stops,1);assert.deepEqual(await readdir(directory),[]);assert.ok(!native.writes.some(v=>v.method==='tools/list'));
 }finally{await rm(directory,{recursive:true,force:true});}
});

function sshFixture(options:Partial<NativeClaudeOptions>={},settings:{badReceipt?:boolean;cleanup?:boolean;early?:boolean;bootstrap?:()=>void;deferReady?:boolean}={}){
 const local=toolFixture(),abort=new AbortController(),s=session();let ssh!:SyntheticProcess,authorized=true;
 const o:NativeClaudeOptions={executable:'never-launch',directory:os.tmpdir(),cwd:s.projectPath!,env:{},session:s,host,signal:abort.signal,authorize(){if(!authorized)throw Error('revoked');},...options};
 const bridge=new ClaudeSshTransport(o,async()=>local.tools,spec=>{
  ssh=new SyntheticProcess(spec);ssh.answer=value=>{
   if(value.provider==='claude'){
    settings.bootstrap?.();if(settings.deferReady)return;
    if(settings.early){ssh.frame({ok:false,error:'unsupported'});return;}
    ssh.frame({method:'workbench/bridgeReady',params:{provider:'claude',transport:'official-mcp-v1',sessionReceipt:{threadId:randomUUID(),cwd:settings.badReceipt?'wrong':o.cwd,environmentId:'local-device'}}});
   }else if(value.type==='workbench_close'){if(settings.cleanup!==false)ssh.frame({method:'workbench/bridgeClosed',params:{cleanupConfirmed:true}});queueMicrotask(()=>{void ssh.stop('remote-clean');});}
  };return ssh;
 });
 return {bridge,o,local,abort,get ssh(){return ssh;},revoke(){authorized=false;}};
}
test('SSH native stream binds a loopback-only tool tunnel without model gateway or local login',async()=>{
 const f=sshFixture();try{
  await f.bridge.start();assert.equal(f.bridge.state,'running');assert.equal(f.ssh.spec.executable.toLowerCase().endsWith('ssh.exe')||f.ssh.spec.executable==='ssh',true);
  assert.ok(f.ssh.spec.args.includes('StreamLocalBindMask=0177'));assert.ok(f.ssh.spec.args.includes('ExitOnForwardFailure=yes'));assert.ok(f.ssh.spec.args.some(a=>/^\/tmp\/agent-workbench-.*\.sock:127\.0\.0\.1:\d+$/.test(a)));
  const cfg=f.ssh.writes[0];assert.equal(cfg.provider,'claude');assert.equal(cfg.permissionMode,'default');assert.equal(cfg.cwd,f.o.cwd);assert.equal(cfg.accountId,'c');assert.equal(cfg.toolToken,undefined);
  assert.equal(f.ssh.writes.length,1); // Startup does not send a model message.
  // Synthetic wire only: no native model runtime exists in this test.
  await f.bridge.write({type:'user',uuid:randomUUID(),session_id:'',parent_tool_use_id:null,message:{role:'user',content:'synthetic'}});assert.match(f.ssh.writes.at(-1).session_id,/^[a-f0-9-]{36}$/);
  f.revoke();await assert.rejects(f.bridge.write({type:'user'}),/revoked/);
 }finally{await f.bridge.stop();}assert.equal(f.local.closed,1);
});
test('old broker and wrong session receipts fail before any user input',async()=>{
 for(const config of [{early:true},{badReceipt:true}]){const f=sshFixture({},config);await assert.rejects(f.bridge.start(),/UNAVAILABLE|MISMATCH/);await assert.rejects(f.bridge.stop(),/CLEANUP_UNCONFIRMED/);assert.equal(f.local.closed,1);assert.ok(!f.ssh.writes.some(v=>v.type==='user'));}
});
test('missing remote cleanup receipt stays unconfirmed instead of claiming stop success',async()=>{
 const f=sshFixture({}, {cleanup:false});await f.bridge.start();await assert.rejects(f.bridge.stop(),/CLEANUP_UNCONFIRMED/);assert.equal(f.local.closed,1);
});
test('late official tool startup is cleaned when the user cancels preparation',async()=>{
 const local=toolFixture(),abort=new AbortController();let resolve!:(tools:ClaudeToolServer)=>void;const ready=new Promise<ClaudeToolServer>(r=>resolve=r),s=session();
 const bridge=new ClaudeSshTransport({host,session:s,cwd:s.projectPath!,directory:os.tmpdir(),executable:'unused',env:{},signal:abort.signal,authorize(){}},()=>ready,()=>{throw Error('SSH must not launch');});
 const starting=bridge.start();abort.abort();resolve(local.tools);await assert.rejects(starting);await bridge.stop();assert.equal(local.closed,1);
});
test('bridge rejects admin, mismatched provider and unowned runtime bindings',()=>{
 const service=new ClaudeBridgeService('fixture'),s=session();assert.equal(service.supports(host,s),true);for(const changed of [{runtime:'codex'},{egress:'direct-api'},{accountRuntime:'existing-codex'},{hostId:'other'}])assert.equal(service.supports(host,{...s,binding:{...s.binding,...changed}} as Session),false);assert.equal(service.supports({...host,role:'admin'},s),false);
});

test('slow owner metadata preparation is not mistaken for an unavailable bridge',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let bootstrapped!:()=>void;const bootstrap=new Promise<void>(resolve=>{bootstrapped=resolve;}),f=sshFixture({}, {bootstrap:bootstrapped,deferReady:true});
 const starting=f.bridge.start();let rejected=false;starting.catch(()=>{rejected=true;});
 try{
  await bootstrap;t.mock.timers.tick(31000);await Promise.resolve();assert.equal(rejected,false);assert.equal(f.bridge.state,'starting');
  f.ssh.frame({method:'workbench/bridgeReady',params:{provider:'claude',transport:'official-mcp-v1',sessionReceipt:{threadId:randomUUID(),cwd:f.o.cwd,environmentId:'local-device'}}});
  await starting;assert.equal(f.bridge.state,'running');
 }finally{await f.bridge.stop();t.mock.timers.reset();}
});

test('official MCP activity preserves native names while presenting local commands and edits',()=>{
 const tracker=new NativeActivityTracker('claude');
 for(const [suffix,input,expected] of [['PowerShell',{command:'Get-Location'},'command'],['Bash',{command:'pwd'},'command'],['Edit',{file_path:'C:\\fixture.txt',old_string:'old',new_string:'new'},'file-edit'],['Unknown',{},'tool']] as const){
  const name='mcp__local_device__'+suffix,wire=decodeNativeFrame(Buffer.from(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:suffix,name,input}]}})+'\n'));
  const item=tracker.observe(wire)[0]!;assert.equal(item.toolName,name);assert.equal(item.kind,expected);assert.equal((wire.value.message as any).content[0].name,name);
 }
});

test('remote Claude fork rejects a legacy receipt before any user message',async()=>{
 const s=session();s.branch={sourceSessionId:randomUUID(),sourceTitle:'Fixture',createdAt:'now',location:'workspace',inheritedMessageCount:1,native:{runtime:'claude',sourceSessionId:randomUUID(),threadId:randomUUID(),lastMessageId:randomUUID()}};
 const f=sshFixture({session:s});await assert.rejects(f.bridge.start(),/FORK_UNSUPPORTED_OR_MISMATCH/);await assert.rejects(f.bridge.stop(),/CLEANUP_UNCONFIRMED/);assert.deepEqual(f.ssh.writes[0].fork,s.branch.native);assert.ok(!f.ssh.writes.some(v=>v.type==='user'));
});
