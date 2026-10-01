import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSessionFork,forkUnavailable} from '../packages/session-core/fork';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController,DEMO_INPUT,type HostActions} from '../apps/desktop/host/controller';
import type {Session,DraftPreview} from '../packages/contracts';

const history=():Session=>({id:'parent',projectId:null,projectPath:'D:\\Fixture',title:'原聊天',group:'研究',pinned:true,archived:true,unread:true,createdAt:'2026-09-26T01:00:00Z',status:'idle',binding:{runtime:'demo',provider:'offline',accountRef:'none',executionId:'local-device',egress:'demo'},permissionMode:'read-only',modelSelection:{model:'fixture',effort:'high'},messages:[
  {id:'u1',role:'user',original:'第一问',submitted:'first input',demo:true,timestamp:'2026-09-26T01:01:00Z',nativeTurnId:'t1'},
  {id:'a1',role:'assistant',original:'first answer',translation:'第一答',translationStatus:'complete',demo:true,timestamp:'2026-09-26T01:02:00Z',nativeTurnId:'t1',nativeTurnEnd:true},
  {id:'u2',role:'user',original:'第二问',submitted:'second input',demo:true,timestamp:'2026-09-26T01:03:00Z',nativeTurnId:'t2'},
  {id:'a2',role:'assistant',original:'second answer',demo:true,timestamp:'2026-09-26T01:04:00Z',nativeTurnId:'t2',nativeTurnEnd:true},
],activities:[{id:'command1',runtime:'codex',kind:'command',status:'completed',startedAt:'2026-09-26T01:01:30Z',updatedAt:'2026-09-26T01:01:31Z',turnId:'t1'},{id:'command2',runtime:'codex',kind:'command',status:'completed',startedAt:'2026-09-26T01:03:30Z',updatedAt:'2026-09-26T01:03:31Z',turnId:'t2'}],fileChangeRecords:[{activityId:'command1',userMessageId:'u1',turnId:'t1',at:'2026-09-26T01:01:30Z',changes:[]},{activityId:'command2',userMessageId:'u2',turnId:'t2',at:'2026-09-26T01:03:30Z',changes:[]}],nativeApprovals:[{id:1,kind:'file',turnId:'t2',details:'approval',decisions:['accept']}],nativeContextUsage:{used:99,total:99,capacity:100,updatedAt:'now'},nativeTurnId:'t2',nativeTurnStatus:'completed',nativeChildren:[]});

test('whole fork is an independent editable snapshot with lineage and frozen identity choices',()=>{
  const original=history(),saved=structuredClone(original),fork=createSessionFork(original,'child','2026-09-26T02:00:00Z');
  assert.deepEqual(fork.messages,original.messages);assert.deepEqual(fork.binding,original.binding);assert.equal(fork.id,'child');
  assert.equal(fork.branch?.sourceSessionId,'parent');assert.equal(fork.branch?.sourceMessageId,'a2');assert.equal(fork.branch?.sourceTitle,'原聊天');assert.equal(fork.archived,false);assert.equal(fork.pinned,false);assert.equal(fork.unread,false);
  assert.equal(fork.permissionMode,'read-only');assert.deepEqual(fork.modelSelection,original.modelSelection);assert.equal(fork.group,'研究');assert.equal(fork.projectPath,original.projectPath);
  assert.equal(fork.nativeApprovals,undefined);assert.equal(fork.nativeChildren,undefined);assert.equal(fork.nativeContextUsage,undefined);assert.equal(fork.nativeTurnId,undefined);
  fork.messages[0]!.original='child only';fork.modelSelection!.effort='low';assert.deepEqual(original,saved);
});
test('message fork retains exact bilingual prefix and only matching tool/file history',()=>{
  const fork=createSessionFork(history(),'child','now','a1');
  assert.deepEqual(fork.messages.map(m=>m.id),['u1','a1']);assert.equal(fork.messages[0]!.submitted,'first input');assert.equal(fork.messages[1]!.translation,'第一答');
  assert.deepEqual(fork.activities?.map(a=>a.id),['command1']);assert.deepEqual(fork.fileChangeRecords?.map(a=>a.activityId),['command1']);
  assert.equal(JSON.stringify(fork).includes('second answer'),false);
});
test('user-message fork stops before the turn and restores original input as unsent draft',()=>{
  const fork=createSessionFork(history(),'child','now','u2');assert.deepEqual(fork.messages.map(m=>m.id),['u1','a1']);assert.equal(fork.forkDraft,'第二问');
  const first=createSessionFork(history(),'child','now','u1');assert.equal(first.messages.length,0);assert.equal(first.activities?.length,0);assert.equal(first.forkDraft,'第一问');
});
test('older display-only activity remains visible without using timestamps for the native fork boundary',()=>{
  const source=history();for(const message of source.messages)delete message.nativeTurnId;
  const fork=createSessionFork(source,'child','now','a1');assert.deepEqual(fork.activities?.map(a=>a.id),['command1']);
  assert.equal(fork.branch?.native,undefined);assert.deepEqual(fork.messages.map(m=>m.id),['u1','a1']);
});
test('fork rejects running, uncertain, missing, and incomplete native boundaries',()=>{
  for(const status of ['running','uncertain'] as const)assert.throws(()=>createSessionFork({...history(),status},'child','now'));
  assert.throws(()=>createSessionFork(history(),'child','now','absent'));
  const source=history();source.binding.runtime='codex';source.messages[1]!.nativeTurnEnd=false;assert.ok(forkUnavailable(source,'a1'));
  source.binding.runtime='claude';assert.ok(forkUnavailable(source));
});
test('fork snapshots effective native defaults and never leaves a copied translation waiting on the source job',()=>{
  const source=history();source.modelSelection=undefined;source.nativeEffectiveModel={model:'native-default',effort:'high'};source.messages[1]!.translationStatus='pending';
  const child=createSessionFork(source,'child','now');assert.deepEqual(child.modelSelection,source.nativeEffectiveModel);assert.equal(child.nativeEffectiveModel,undefined);
  assert.equal(child.messages[1]!.translationStatus,'failed');assert.equal(source.messages[1]!.translationStatus,'pending');
});

async function fixture(native=false){
  const dir=await mkdtemp(path.join(tmpdir(),'awb-fork-')),store=new StateStore(dir);await store.load();
  const source=history();source.archived=false;source.projectPath='';
  if(native){source.binding={runtime:'codex',provider:'openai',accountRef:'fixture',hostId:'fixture-host',executionId:'local-device',egress:'vps',accountRuntime:'native-owner',nativeSessionId:'native-source'};}
  await store.update(s=>{s.sessions=[source];if(native)s.hosts=[{id:'fixture-host',name:'Fixture',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',identityFile:'fixture-key',knownHostsFile:'fixture-hosts',ownerId:'owner',workspaceGeneration:'generation'}];});
  const nativeCodex:HostActions['nativeCodex']=native?{supports:()=>false,defaultDirectory:()=>dir,connect:async()=>{throw Error('No native connection may run in this snapshot test');},close:async()=>{},dispose:async()=>{}}:undefined;
  const controller=new WorkbenchController(store,new SecretStore(dir,{encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),{nativeCodex,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  return {dir,store,controller,close:async()=>{await controller.dispose();await rm(dir,{recursive:true,force:true});}};
}
test('host forks, continues independently, survives restart and source deletion',async()=>{
  const f=await fixture();try{
    const original=f.store.snapshot().sessions[0]!;
    const fork=await f.controller.call('session/fork',{sessionId:'parent',messageId:'a1'}) as Session;
    assert.equal(fork.messages.length,2);assert.deepEqual(f.store.snapshot().sessions.find(s=>s.id==='parent'),original);
    const preview=await f.controller.call('draft/prepare',{sessionId:fork.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
    await f.controller.call('draft/submit',{sessionId:fork.id,id:preview.id,sourceHash:preview.sourceHash});
    assert.equal(f.store.snapshot().sessions.find(s=>s.id===fork.id)!.messages.length,4);assert.deepEqual(f.store.snapshot().sessions.find(s=>s.id==='parent'),original);
    await f.controller.call('session/delete',{id:'parent',confirm:true});
    const restarted=new StateStore(f.dir);await restarted.load();const saved=restarted.snapshot().sessions[0]!;
    assert.equal(saved.id,fork.id);assert.equal(saved.branch?.sourceTitle,'原聊天');assert.equal(saved.messages.length,4);
    const nested=await f.controller.call('session/fork',{sessionId:fork.id}) as Session;assert.equal(nested.branch?.sourceSessionId,fork.id);
  }finally{await f.close();}
});
test('native snapshot pins exact boundaries without connecting, cloning thread identity, or replaying a request',async()=>{
  const f=await fixture(true);try{
    const fork=await f.controller.call('session/fork',{sessionId:'parent',messageId:'a1'}) as Session;
    assert.equal(fork.binding.nativeSessionId,undefined);assert.deepEqual(fork.branch?.native,{sourceSessionId:'parent',threadId:'native-source',lastTurnId:'t1'});
    const before=await f.controller.call('session/fork',{sessionId:'parent',messageId:'u1'}) as Session;
    assert.deepEqual(before.branch?.native,{sourceSessionId:'parent',threadId:'native-source',beforeTurnId:'t1'});assert.equal(before.messages.length,0);
    const nested=await f.controller.call('session/fork',{sessionId:before.id}) as Session;assert.deepEqual(nested.branch?.native,before.branch?.native);
    await assert.rejects(f.controller.call('draft/prepare',{sessionId:fork.id,text:'must stay gated'}),/H 原生桥/);
    assert.equal(f.store.snapshot().sessions.find(s=>s.id==='parent')!.binding.nativeSessionId,'native-source');
  }finally{await f.close();}
});
test('rapid duplicate host requests create at most one fork and reject unsettled source states',async()=>{
  const f=await fixture();try{
    const results=await Promise.allSettled([f.controller.call('session/fork',{sessionId:'parent'}),f.controller.call('session/fork',{sessionId:'parent'})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.store.snapshot().sessions.length,2);
    for(const status of ['running','uncertain'] as const){await f.store.update(s=>{s.sessions.find(x=>x.id==='parent')!.status=status;});await assert.rejects(f.controller.call('session/fork',{sessionId:'parent'}));assert.equal(f.store.snapshot().sessions.length,2);}
  }finally{await f.close();}
});
