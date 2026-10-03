import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import type { Project, Session } from '../packages/contracts';
import { RECENT_PROJECT_ID, recentProject } from '../packages/session-core/projects';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {safeError} from '../apps/desktop/host/controller';

async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'aw-sidebar-actions-'));const store=new StateStore(directory);await store.load();const copied:string[]=[];
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No test credentials');},decrypt:()=>''}),{pickDirectory:async()=>null,openPath:async()=>{},copy:text=>{copied.push(text);},nativeCapabilities:()=>[]},()=>{});
 const project=await controller.call('project/create',{name:'Synthetic project',paths:[directory]}) as Project;
 const session=await controller.call('session/create',{runtime:'demo',projectId:project.id}) as Session;
 return {directory,store,controller,copied,project,session,close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('approved project and diagnostic replacements reach production commands and restore on disable',async()=>{
 const f=await fixture(),plugins=new PluginRegistry(path.join(f.directory,'plugins'));await plugins.initialize();
 try{
  for(const[id,service]of Object.entries(f.controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  const id='test.sidebar-actions',manifest={schemaVersion:1,apiVersion:1,id,name:'Sidebar fixture',version:'1.0.0',description:'Synthetic lifecycle',capabilities:['host'],main:'main.mjs'};
  const source=`export function activate(api){api.services.intercept('sidebar.projects','remove',async(next,id)=>({...await next(id),fixture:true}));api.services.register('test.diagnostics',{format:error=>'PLUGIN: '+error.message},{version:1});api.services.override('diagnostics.errors',{format:error=>api.services.get('test.diagnostics').format(error)});}`;
  const zip=path.join(f.directory,'plugin.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const hash=(await plugins.list())[0]!.hash;
  await plugins.setEnabled(id,hash,true,true);assert.equal(safeError(Error('diagnostic')),'PLUGIN: diagnostic');
  const removed=await f.controller.call('project/remove',{id:f.project.id}) as any;assert.equal(removed.fixture,true);
  await f.controller.call('project/undo',{id:removed.sidebarUndoId});
  await plugins.setEnabled(id,hash,false);assert.equal(safeError(Error('diagnostic')),'diagnostic');
  const core=await f.controller.call('project/remove',{id:f.project.id}) as any;assert.equal(core.fixture,undefined);
  await f.controller.call('project/undo',{id:core.sidebarUndoId});await plugins.setEnabled(id,hash,true);assert.equal(safeError(Error('diagnostic')),'PLUGIN: diagnostic');
 }finally{await plugins.dispose();await f.close();}
});

test('undoing a project removal does not overwrite a conversation moved afterwards',async()=>{
 const f=await fixture();try{
  const removed=await f.controller.call('project/remove',{id:f.project.id}) as any;
  const other=await f.controller.call('project/create',{name:'Other',paths:[f.directory]}) as Project;
  await f.store.update(s=>{s.sessions[0]!.projectId=other.id;});
  await f.controller.call('project/undo',{id:removed.sidebarUndoId});
  assert.equal(f.store.snapshot().sessions[0]!.projectId,other.id);assert(f.store.snapshot().projects.some(p=>p.id===f.project.id));
 }finally{await f.close();}
});

test('project pin and session unread metadata persist without changing conversation identity',async()=>{
 const f=await fixture();try{
  await f.controller.call('project/update',{id:f.project.id,pinned:true});
  await f.controller.call('session/update',{id:f.session.id,unread:true});
  const reloaded=new StateStore(f.directory);await reloaded.load();
  assert.equal(reloaded.snapshot().projects[0]!.pinned,true);assert.equal(reloaded.snapshot().sessions[0]!.unread,true);
  assert.deepEqual(reloaded.snapshot().sessions[0]!.binding,JSON.parse(JSON.stringify(f.session.binding)));
  await assert.rejects(f.controller.call('project/update',{id:f.project.id,pinned:'yes'}));
  await assert.rejects(f.controller.call('session/update',{id:f.session.id,unread:'yes'}));
 }finally{await f.close();}
});

test('remove project is immediate and undo restores its identity without touching disk files',async()=>{
 const f=await fixture();try{
  const sentinel=path.join(f.directory,'project-file.txt');await writeFile(sentinel,'preserve disk contents');
  const removed=await f.controller.call('project/remove',{id:f.project.id}) as {sidebarUndoId:string};
  const state=f.store.snapshot();assert.equal(state.projects.length,0);assert.equal(state.sessions.length,1);
  assert.equal(state.sessions[0]!.projectId,null);assert.equal(state.sessions[0]!.projectPath,f.directory);
  assert.equal(await readFile(sentinel,'utf8'),'preserve disk contents');assert.deepEqual(state.sessions[0]!.binding,f.session.binding);
  await f.controller.call('project/undo',{id:removed.sidebarUndoId});
  assert.equal(f.store.snapshot().projects[0]!.id,f.project.id);assert.equal(f.store.snapshot().sessions[0]!.projectId,f.project.id);
  const restored=new StateStore(f.directory);await restored.load();assert.equal(restored.snapshot().projects[0]!.id,f.project.id);
 }finally{await f.close();}
});

test('project archive is atomic when one conversation is busy and retains the project',async()=>{
 const f=await fixture();try{
  const other=await f.controller.call('session/create',{runtime:'demo',projectId:f.project.id}) as Session;
  await f.store.update(state=>{state.sessions.find(session=>session.id===other.id)!.status='running';});
  await assert.rejects(f.controller.call('project/archive-sessions',{id:f.project.id,confirm:true}),/处理/);
  assert.equal(f.store.snapshot().sessions.some(session=>session.archived),false);
  await f.store.update(state=>{state.sessions.find(session=>session.id===other.id)!.status='idle';});
  const archived=await f.controller.call('project/archive-sessions',{id:f.project.id}) as {sidebarUndoId:string};
  assert.equal(f.store.snapshot().sessions.every(session=>session.archived),true);assert.equal(f.store.snapshot().projects.length,1);
  await f.controller.call('project/undo',{id:archived.sidebarUndoId});assert.equal(f.store.snapshot().sessions.some(s=>s.archived),false);
 }finally{await f.close();}
});

test('permanent deletion requires separate acknowledgement for an inactive uncertain result',async()=>{
 const f=await fixture();try{
  const sentinel=path.join(f.directory,'project-file.txt');await writeFile(sentinel,'preserve project files');
  await assert.rejects(f.controller.call('session/delete',{id:f.session.id}),/确认/);
  await f.store.update(state=>{state.sessions[0]!.status='uncertain';});
  await assert.rejects(f.controller.call('session/delete',{id:f.session.id,confirm:true}),/结果未知/);
  await assert.rejects(f.controller.call('session/delete',{id:f.session.id,discardUncertain:true}),/确认/);
  await assert.rejects(f.controller.call('session/delete',{id:f.session.id,confirm:true,discardUncertain:'true'}),/布尔/);
  await f.controller.call('session/delete',{id:f.session.id,confirm:true,discardUncertain:true});
  assert.equal(f.store.snapshot().sessions.length,0);assert.equal(f.store.snapshot().projects.length,1);
  assert.equal(await readFile(sentinel,'utf8'),'preserve project files');
  const reloaded=new StateStore(f.directory);await reloaded.load();assert.equal(reloaded.snapshot().sessions.length,0);
 }finally{await f.close();}
});

test('uncertain deletion acknowledgement never overrides actual runtime or preparation work',async(t)=>{
 const f=await fixture();try{
  const remove=()=>f.controller.call('session/delete',{id:f.session.id,confirm:true,discardUncertain:true});
  await f.store.update(state=>{state.sessions[0]!.status='running';});await assert.rejects(remove(),/仍在处理/);
  await f.store.update(state=>{state.sessions[0]!.status='uncertain';});
  for(const key of ['apiRunner','nativeProvider','pluginRuntimes','nativeCodex'] as const){
   const runner=(f.controller as any)[key];if(!runner)continue;
   const busy=t.mock.method(runner,'busy',()=>true);await assert.rejects(remove(),/仍在处理/);busy.mock.restore();
  }
  for(const key of ['forking','sessionOperations','activeTurns','permissionChanges','modelSwitching'] as const){
   const work=(f.controller as any)[key];work instanceof Set?work.add(f.session.id):work.set(f.session.id,1);
   await assert.rejects(remove(),/仍在处理/);work.delete(f.session.id);
  }
  const pending=t.mock.method((f.controller as any).gate,'hasPending',()=>true);await assert.rejects(remove(),/仍在处理/);pending.mock.restore();
  (f.controller as any).activeTranslations.set(f.session.id+':fixture',{});await assert.rejects(remove(),/仍在处理/);(f.controller as any).activeTranslations.clear();
  assert.equal(f.store.snapshot().sessions.length,1);
  await f.controller.call('session/delete',{id:f.session.id,confirm:true,discardUncertain:true});assert.equal(f.store.snapshot().sessions.length,0);
 }finally{await f.close();}
});

test('deletion rechecks execution state after asynchronous native close',async()=>{
 const f=await fixture();const internal=f.controller as any,previous=internal.nativeCodex;
 try{
  await f.store.update(state=>{state.sessions[0]!.status='uncertain';});
  internal.nativeCodex={busy:()=>false,close:async()=>{await f.store.update(state=>{state.sessions[0]!.status='running';});}};
  await assert.rejects(f.controller.call('session/delete',{id:f.session.id,confirm:true,discardUncertain:true}),/仍在处理/);
  assert.equal(f.store.snapshot().sessions.length,1);
 }finally{internal.nativeCodex=previous;await f.close();}
});

test('copy actions use frozen directory and preserve submitted, original and translated text in Markdown',async()=>{
 const f=await fixture();try{
  await f.store.update(state=>{state.sessions[0]!.messages.push({id:'synthetic-message',role:'user',original:'原始中文',submitted:'Submitted English',translation:'中文译文',demo:true,timestamp:new Date().toISOString()});});
  const directory=await f.controller.call('session/copy',{id:f.session.id,format:'directory'});assert.equal(directory,f.directory);
  const markdown=await f.controller.call('session/copy',{id:f.session.id,format:'markdown'}) as string;
  for(const text of ['Submitted English','原始中文','中文译文'])assert.ok(markdown.includes(text));
  assert.deepEqual(f.copied,[f.directory,markdown]);
  await assert.rejects(f.controller.call('session/copy',{id:f.session.id,format:'token'}));
 }finally{await f.close();}
});

test('recent project preferences persist while old unassigned session identity and directories stay frozen',async()=>{
 const f=await fixture();try{
  const old=await f.controller.call('session/create',{runtime:'demo'}) as Session;
  await f.controller.call('project/update',{id:RECENT_PROJECT_ID,name:'My recent chats',paths:[f.directory],pinned:true});
  const next=await f.controller.call('session/create',{runtime:'demo'}) as Session;
  assert.equal(next.projectId,null);assert.equal(next.projectPath,'');
  const fromSidebar=await f.controller.call('session/create',{runtime:'demo',projectPath:f.directory}) as Session;
  assert.equal(fromSidebar.projectId,null);assert.equal(fromSidebar.projectPath,f.directory);
  assert.equal(f.store.snapshot().sessions.find(session=>session.id===old.id)!.projectPath,'');
  assert.deepEqual(f.store.snapshot().sessions.find(session=>session.id===old.id)!.binding,old.binding);
  const reloaded=new StateStore(f.directory);await reloaded.load();
  assert.equal(recentProject(reloaded.snapshot()).name,'My recent chats');assert.equal(recentProject(reloaded.snapshot()).pinned,true);
  await f.controller.call('project/update',{id:RECENT_PROJECT_ID,paths:[]});
  await assert.rejects(f.controller.call('project/update',{id:RECENT_PROJECT_ID,hidden:'yes'}));
  await assert.rejects(f.controller.call('project/update',{id:RECENT_PROJECT_ID,paths:['relative/path']}));
 }finally{await f.close();}
});

test('recent bulk archive includes pinned and grouped unassigned chats and atomically rejects busy chats',async()=>{
 const f=await fixture();try{
  const first=await f.controller.call('session/create',{runtime:'demo'}) as Session;
  const second=await f.controller.call('session/create',{runtime:'demo'}) as Session;
  await f.controller.call('session/update',{id:first.id,pinned:true});await f.controller.call('session/update',{id:second.id,group:'Group'});
  await f.store.update(state=>{state.sessions.find(session=>session.id===second.id)!.status='running';});
  await assert.rejects(f.controller.call('project/archive-sessions',{id:RECENT_PROJECT_ID,confirm:true}));
  assert.equal(f.store.snapshot().sessions.some(session=>session.archived),false);
  await f.store.update(state=>{state.sessions.find(session=>session.id===second.id)!.status='idle';});
  await f.controller.call('project/archive-sessions',{id:RECENT_PROJECT_ID,confirm:true});
  assert.equal(f.store.snapshot().sessions.filter(session=>session.projectId===null).every(session=>session.archived),true);
  assert.equal(f.store.snapshot().sessions.find(session=>session.id===f.session.id)!.archived,false);
 }finally{await f.close();}
});

test('removing and restoring recent project only changes sidebar visibility',async()=>{
 const f=await fixture();try{
  await f.controller.call('session/create',{runtime:'demo'});const sessions=f.store.snapshot().sessions;
  await f.controller.call('project/remove',{id:RECENT_PROJECT_ID,confirm:true});assert.equal(f.store.snapshot().recentProject!.hidden,true);
  assert.deepEqual(f.store.snapshot().sessions,sessions);assert.equal(f.store.snapshot().projects.length,1);
  await f.controller.call('project/update',{id:RECENT_PROJECT_ID,hidden:false});assert.equal(f.store.snapshot().recentProject!.hidden,false);
  assert.deepEqual(f.store.snapshot().sessions,sessions);
 }finally{await f.close();}
});

test('recent project opens only its registered local folders',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.controller.call('path/open',{projectId:RECENT_PROJECT_ID}));
  await f.controller.call('project/update',{id:RECENT_PROJECT_ID,paths:[f.directory]});
  await f.controller.call('path/open',{projectId:RECENT_PROJECT_ID});
  await assert.rejects(f.controller.call('path/open',{projectId:RECENT_PROJECT_ID,path:os.tmpdir()}));
 }finally{await f.close();}
});
