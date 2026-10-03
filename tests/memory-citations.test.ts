import test from 'node:test';
import {AsyncLocalStorage} from 'node:async_hooks';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {memoryCitations,replyMemoryReferences,visibleReply} from '../packages/session-core/memory-citations';
import {NativeCodexRunner} from '../apps/desktop/host/native-codex';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider';
import {StateStore} from '../apps/desktop/host/store';
import type {Message,Session} from '../packages/contracts';

const citation={entries:[{path:'MEMORY.md',lineStart:4,lineEnd:8,note:'Export conventions'}],threadIds:[]};
const refs=[{path:'MEMORY.md',title:'Export conventions',source:'native-citation' as const}];
const legacy='<oai-mem-citation>\n<citation_entries>\nMEMORY.md:4-8|note=[Export conventions]\n</citation_entries>\n</oai-mem-citation>';
const session=():Session=>({id:'citation-session',projectId:null,title:'Synthetic',pinned:false,archived:false,group:'',createdAt:'2026-09-29T00:00:00Z',status:'running',nativeTurnId:'turn',binding:{runtime:'codex',provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'direct-api'},messages:[]});

test('structured app-server citations survive clean text and deduplicate legacy tags',()=>{
  assert.deepEqual(memoryCitations('Answer.',citation),refs);
  assert.deepEqual(memoryCitations('Answer.\n'+legacy,citation),refs);
  assert.deepEqual(memoryCitations('Answer.\n'+legacy,null),refs);
  assert.deepEqual(memoryCitations('Answer.\n'+legacy),refs);
  assert.equal(visibleReply('Answer.'),'Answer.');
  assert.equal(visibleReply('Answer.\n'+legacy),'Answer.');
});

test('malformed citations cannot fabricate sources or prevent valid siblings and legacy fallback',()=>{
  for(const value of [undefined,null,false,'MEMORY.md',[],{}, {entries:'not an array'},{entries:[null,42,{}, {path:'',note:'blank',lineStart:1,lineEnd:2}, {...citation.entries[0],lineStart:-1}, {...citation.entries[0],lineEnd:1}, {...citation.entries[0],lineStart:1.5}]}]){
    assert.deepEqual(memoryCitations('I used memory.',value),[]);
    assert.deepEqual(memoryCitations(legacy,value),refs);
  }
  assert.deepEqual(memoryCitations('',{entries:[null,...citation.entries]}),refs);
  assert.equal(memoryCitations('',{entries:[{...citation.entries[0],note:''}]})[0]?.title,'MEMORY.md');
  assert.equal(memoryCitations('',{entries:Array.from({length:75},(_,i)=>({...citation.entries[0],path:`topic-${i}.md`}))}).length,50);
});

test('local completed messages persist structured citations before translation and clear obsolete metadata',async()=>{
  const state=session(),translated:Message[]=[];
  const runner:any=Object.create(NativeProviderRunner.prototype);
  runner.update=async(_id:string,change:(value:Session)=>void)=>change(state);
  runner.hooks={snapshot:()=>({modelConnections:[],hosts:[]}),translate:(_id:string,value:Message)=>translated.push(value)};
  await runner.message(state.id,'item','Partial',false);
  assert.deepEqual(replyMemoryReferences(state,state.messages[0]!),[]);
  await runner.message(state.id,'item','Answer.',true,'final',undefined,undefined,false,citation);
  assert.equal(state.messages.length,1);assert.equal(state.messages[0]!.original,'Answer.');
  assert.deepEqual(state.messages[0]!.memoryReferences,refs);assert.deepEqual(translated[0]!.memoryReferences,refs);
  await runner.message(state.id,'item','Corrected answer.',true,'final',undefined,undefined,false,null);
  assert.deepEqual(state.messages[0]!.memoryReferences,[]);
});

test('SSH live frames and explicit reconciliation preserve structured metadata and exclude child threads',async()=>{
  const state=session(),translated:Message[]=[];
  const runner:any=Object.create(NativeCodexRunner.prototype);
  runner.attempt=new AsyncLocalStorage();
  runner.updateSession=async(_id:string,change:(value:Session)=>void)=>change(state);
  runner.hooks={snapshot:()=>({modelConnections:[],hosts:[]}),translate:(_id:string,value:Message)=>translated.push(value)};
  const item={id:'item',type:'agentMessage',text:'Answer.',phase:'final_answer',memoryCitation:citation};
  const t:any={queue:Promise.resolve(),items:new Map(),handle:{threadId:'root',connection:{rpc:{isBoundThread:()=>false,request:async()=>({data:[{id:'turn',status:'completed',items:[item]}]})}}}};
  const frame=(threadId:string)=>({value:{method:'item/completed',params:{threadId,turnId:'turn',item}},receivedAt:'2026-09-29T00:00:01Z',sequence:1});
  runner.observe(state.id,t,frame('child'));await t.queue;assert.equal(state.messages.length,0);
  runner.observe(state.id,t,frame('root'));await t.queue;
  assert.deepEqual(state.messages[0]!.memoryReferences,refs);assert.deepEqual(translated[0]!.memoryReferences,refs);
  state.status='uncertain';state.binding.nativeSessionId='root';state.messages[0]!.memoryReferences=[];
  runner.session=()=>state;runner.assertAllowed=()=>{};runner.connect=async()=>t;runner.host=()=>({});
  assert.deepEqual(await runner.reconcile(state.id),{confirmed:true,status:'completed'});
  assert.equal(state.messages.length,1);assert.equal(state.messages[0]!.nativeTurnEnd,true);
  assert.deepEqual(replyMemoryReferences(state,state.messages[0]!),refs);
});

test('structured sources survive state reload without leaking into the next reply or requiring legacy tags',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-citation-state-'));
  try{
    const store=new StateStore(dir);await store.load();
    const value=session();value.status='idle';value.messages=[{id:'first',role:'assistant',original:'Answer.',demo:false,timestamp:value.createdAt,memoryReferences:refs,nativeTurnEnd:true},{id:'second',role:'assistant',original:'No citation.',demo:false,timestamp:value.createdAt,nativeTurnEnd:true}];
    await store.update(state=>{state.sessions=[value];});
    const restored=(await new StateStore(dir).load()).sessions[0]!;
    assert.deepEqual(replyMemoryReferences(restored,restored.messages[0]!),refs);
    assert.deepEqual(replyMemoryReferences(restored,restored.messages[1]!),[]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
