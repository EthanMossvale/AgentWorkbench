import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatSessionTools } from '../apps/desktop/host/chat-session-tools';
import { assertChatCreation,chatSessionToolDefinitions } from '../packages/collaboration-core/session-tools';
import { initialState } from '../apps/desktop/host/store';
import type { Session } from '../packages/contracts';
import type { ModelTarget } from '../packages/model-api/types';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore,SecretStore } from '../apps/desktop/host/store';
import { HostServiceRegistry } from '../packages/plugins-core/services';
const text='Can you open a new session in the MOD project and send something random? This is a test.';
const args={projectId:'mod',task:'Say hello once.',operationId:'new-chat',authorizationQuote:text};
function fixture(){
  const state=initialState();let creates=0,sends=0,fail=false;
  const source:Session={id:'source',title:'Source',projectId:null,projectPath:process.cwd(),status:'running',pinned:false,archived:false,group:'',createdAt:'2026-09-28T00:00:00Z',permissionMode:'read-only',modelTargetId:'target',modelSelection:{model:'model',effort:'high'},binding:{runtime:'codex',provider:'p',accountRef:'p',executionId:'local-device',egress:'direct-api',modelConnectionId:'p',modelMappingId:'m'},messages:[{id:'direct',role:'user',original:text,timestamp:'2026-09-28T00:00:00Z',demo:false}]};state.sessions.push(source);
  state.projects.push({id:'mod',name:'MOD',path:process.cwd(),paths:[process.cwd()],authority:'local',group:''});
  const target:ModelTarget={id:'target',name:'Native fixture',description:'Synthetic',ready:true,runtime:'codex',binding:source.binding,selection:source.modelSelection};
  const targets=[target];
  const hooks={snapshot:()=>structuredClone(state),update:async(change:(s:typeof state)=>void)=>change(state),assertSource:()=>{},owner:(s:Pick<Session,'binding'>)=>s.binding.accountRef==='foreign'?'foreign':'same',targets:async()=>targets,validateSelection:(_target:ModelTarget,selection:NonNullable<Session['modelSelection']>)=>{if(selection.effort!==undefined&&!['low','medium','high'].includes(selection.effort))throw Error('CHAT_MODEL_SELECTION_INVALID');return selection;},create:async(input:Record<string,unknown>)=>{creates++;const selected=targets.find(t=>t.id===input.modelTargetId)!;const chat={...source,id:'created-'+creates,title:'New chat',status:'idle' as const,projectId:input.projectId as string,projectPath:input.projectPath as string,permissionMode:input.permissionMode as Session['permissionMode'],binding:selected.binding,modelTargetId:selected.id,modelSelection:input.modelSelection as Session['modelSelection']??selected.selection,messages:[]};state.sessions.push(chat);return chat;},submit:async(session:Session,preview:any)=>{sends++;if(fail)throw Error('Unknown result');session.messages.push({id:preview.id,role:'user',original:preview.original,timestamp:'2026-09-28T00:00:00Z',demo:false});session.status='running';}};
  return {state,source,target,targets,hooks,tools:new ChatSessionTools(hooks),counts:()=>({creates,sends}),fail:()=>{fail=true;}};
}
test('new-chat wording is accepted without authorizing subagents, while negation and invented quotations fail',()=>{
  for(const value of [text,'在 MOD 项目开个新会话并发一句话。','请创建一个独立聊天。'])assert.doesNotThrow(()=>assertChatCreation(value,value));
  for(const value of ['不要新建会话。','Do not open a new session.','List my chats.'])assert.throws(()=>assertChatCreation(value,value),/NOT_AUTHORIZED/);
  assert.throws(()=>assertChatCreation('List my chats.',text),/NOT_AUTHORIZED/);
});
test('empty projects are discoverable without creating chats or invoking a model',()=>{
  const f=fixture();assert.deepEqual(f.tools.listProjects('source',{query:'mod'}).projects,[{id:'mod',name:'MOD',paths:[process.cwd()]}]);assert.deepEqual(f.counts(),{creates:0,sends:0});
  assert.throws(()=>f.tools.listProjects('source',{cursor:'missing'}),/CURSOR/);assert.throws(()=>f.tools.listProjects('source',{limit:101}),/QUERY/);
});
test('concurrent creation is idempotent, keeps project/model/permission and creates an independent sidebar chat',async()=>{
  const f=fixture(),[a,b]=await Promise.all([f.tools.call('source','workbench_create_session',args),f.tools.call('source','workbench_create_session',args)]) as any[];
  assert.equal(a.sessionId,b.sessionId);assert.equal(a.state,'started');assert.deepEqual(f.counts(),{creates:1,sends:1});
  const chat=f.state.sessions[1]!;assert.equal(chat.projectId,'mod');assert.equal(chat.agentParent,undefined);assert.equal(chat.permissionMode,'read-only');assert.equal(chat.modelSelection?.effort,'high');assert.equal(chat.messages[0]!.original,args.task);
  const restarted=new ChatSessionTools(f.hooks);f.source.status='idle';assert.equal((await restarted.create('source',args) as any).reused,true);assert.deepEqual(f.counts(),{creates:1,sends:1});
  await assert.rejects(restarted.create('source',{...args,task:'different'}),/CONFLICT/);
});
test('generated first tasks and peer-only activity cannot create more sessions',async()=>{
  const f=fixture();await f.tools.create('source',{...args,task:text});
  await assert.rejects(f.tools.create('created-1',{...args,operationId:'recursive'}),/DIRECT_USER/);
  f.source.messages=[];await assert.rejects(f.tools.create('source',{...args,operationId:'peer'}),/DIRECT_USER/);
  assert.deepEqual(f.counts(),{creates:1,sends:1});
});

test('an explicit effort overrides inherited effort without changing the model or parent',async()=>{
  const f=fixture();await f.tools.create('source',{...args,effort:'low'});
  assert.deepEqual(f.state.sessions[1]!.modelSelection,{model:'model',effort:'low'});assert.equal(f.source.modelSelection!.effort,'high');
  await assert.rejects(f.tools.create('source',{...args,effort:'medium'}),/CONFLICT/);
});

test('an explicit model target and effort win over parent and target defaults',async()=>{
  const f=fixture();f.targets.push({...f.target,id:'other',selection:{model:'another-model',effort:'medium'}});
  await f.tools.create('source',{...args,targetId:'other',effort:'low'});
  assert.equal(f.state.sessions[1]!.modelTargetId,'other');assert.deepEqual(f.state.sessions[1]!.modelSelection,{model:'another-model',effort:'low'});
  await f.tools.create('source',{...args,operationId:'target-only',targetId:'other'});
  assert.deepEqual(f.state.sessions[2]!.modelSelection,{model:'another-model',effort:'medium'});
});

test('unavailable explicit settings fail without falling back, creating or reserving a chat',async()=>{
  const f=fixture();await assert.rejects(f.tools.create('source',{...args,effort:'unsupported'}),/SELECTION_INVALID/);
  await assert.rejects(f.tools.create('source',{...args,targetId:'unavailable',effort:'high'}),/TARGET_UNAVAILABLE/);
  f.source.modelSelection=undefined;f.target.selection=undefined;
  await assert.rejects(f.tools.create('source',{...args,effort:'high'}),/SELECTION_REQUIRED/);
  assert.deepEqual(f.counts(),{creates:0,sends:0});assert.equal(f.state.chatCreations?.length??0,0);
});
test('failed or interrupted submission is retained and never automatically resubmitted after restart',async()=>{
  const f=fixture();f.fail();assert.equal((await f.tools.create('source',args) as any).state,'uncertain');
  const restarted=new ChatSessionTools(f.hooks);assert.equal((await restarted.create('source',args) as any).state,'uncertain');assert.deepEqual(f.counts(),{creates:1,sends:1});
  f.state.chatCreations![0]!.state='pending';assert.equal((await restarted.create('source',args) as any).state,'uncertain');assert.deepEqual(f.counts(),{creates:1,sends:1});
});
test('a new chat reuses the selected directory within a multi-directory source project',async()=>{
  const f=fixture();f.source.projectId='mod';f.source.projectPath=path.join(process.cwd(),'second-directory');f.state.projects[0]!.paths!.push(f.source.projectPath);
  const {projectId:_project,...input}=args;await f.tools.create('source',input);assert.equal(f.state.sessions[1]!.projectPath,f.source.projectPath);
  await assert.rejects(f.tools.create('source',{...input,projectId:null}),/CONFLICT/);
});
test('tightening source permissions while preparing the new chat prevents its initial submission',async()=>{
  const f=fixture();f.source.permissionMode='full-access';const create=f.hooks.create;f.hooks.create=async input=>{const session=await create(input);f.source.permissionMode='read-only';return session;};
  const result=await f.tools.create('source',args) as any;assert.equal(result.state,'failed');assert.equal(f.counts().sends,0);assert.equal(f.state.sessions[1]!.status,'blocked');
});
test('foreign owners, new execution locations, unregistered paths and caller spoofing are rejected before reservation',async()=>{
  for(const change of [(f:ReturnType<typeof fixture>)=>{f.target.binding={...f.target.binding,accountRef:'foreign'};},(f:ReturnType<typeof fixture>)=>{f.target.binding={...f.target.binding,executionId:'other'};}]){const f=fixture();change(f);await assert.rejects(f.tools.create('source',args),/OWNER|LOCATION/);assert.deepEqual(f.counts(),{creates:0,sends:0});}
  const f=fixture();for(const patch of [{projectId:'missing'},{projectPath:'unregistered'},{sourceSessionId:'spoof'}])await assert.rejects(f.tools.call('source','workbench_create_session',{...args,...patch}),/PROJECT|ARGUMENTS/);
  f.tools.dispose();await assert.rejects(f.tools.create('source',args),/DISPOSED/);
});
test('cancellation and a changed user request cannot submit the first task',async()=>{
  const f=fixture(),abort=new AbortController();const create=f.hooks.create;f.hooks.create=async input=>{const chat=await create(input);abort.abort();return chat;};
  const result=await f.tools.create('source',args,abort.signal) as any;assert.equal(result.state,'failed');assert.equal(f.counts().sends,0);
  const g=fixture();g.hooks.targets=async()=>{g.source.messages.push({...g.source.messages[0]!,id:'newer',original:'Stop.'});return [g.target];};await assert.rejects(g.tools.create('source',args),/SOURCE_CHANGED/);assert.deepEqual(g.counts(),{creates:0,sends:0});
  assert.equal(chatSessionToolDefinitions.length,2);
});

test('real controller dispatch, Claude MCP, and plugin replacement share one service and restore on release',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-chat-creation-')),store=new StateStore(directory);await store.load();
  const f=fixture();await store.update(s=>{s.sessions=f.state.sessions;s.projects=f.state.projects;});
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>''}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{}),registry=new HostServiceRegistry();
  let release:(()=>void)|undefined;
  try{
    const service=controller.developmentServices()['sessions.agent-tools']!;registry.register('sessions.agent-tools',service);
    const direct=controller.nativePeerTools('source');assert.deepEqual((await direct.call('workbench_list_projects',{}) as any).projects.map((p:any)=>p.name),['MOD']);
    release=registry.override('sessions.agent-tools',{create:async(sourceId:string,input:Record<string,unknown>)=>({sourceId,operationId:input.operationId,replacement:true})});
    assert.equal((await direct.call('workbench_create_session',args) as any).replacement,true);
    const mcp=controller.nativePeerMcpSession('source');await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize'});await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
    const list=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/list'});assert.match(JSON.stringify(list),/workbench_create_session/);
    const reply=await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'workbench_create_session',arguments:args}});assert.match(JSON.stringify(reply),/replacement/);mcp.dispose();
    release();release=undefined;await assert.rejects(direct.call('workbench_create_session',args),/CHAT_MODEL_TARGET_UNAVAILABLE/);
    await controller.dispose();await assert.rejects(direct.call('workbench_list_projects',{}),/DISPOSED/);
  }finally{release?.();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});

test('saved submitted translation authorizes the same explicit user request only',()=>{
 assert.doesNotThrow(()=>assertChatCreation('请开一个独立会话。','Open a new independent session.','Open a new independent session.'));
 assert.throws(()=>assertChatCreation('不要开新会话。','Open a new session.','Open a new session.'),/NOT_AUTHORIZED/);
 assert.throws(()=>assertChatCreation('列出会话。','Open a new session.','Open a new session.'),/NOT_AUTHORIZED/);
 assert.throws(()=>assertChatCreation('请开一个会话。','Open a new session.','List sessions.'),/NOT_AUTHORIZED/);
});
