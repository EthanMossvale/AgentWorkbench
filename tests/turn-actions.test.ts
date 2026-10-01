import test from 'node:test';
import assert from 'node:assert/strict';
import { completedReplyIds } from '../packages/session-core/turn-replies';
import { readingTurns } from '../packages/collaboration-core/reading-turns';
import { conversationTimeline } from '../packages/collaboration-core/timeline';
import { forkUnavailable, forkSourceKey } from '../packages/session-core/fork';
import { recordedNativeFork } from '../packages/session-core/native-fork';
import { memoryCitations, replyMemoryReferences, visibleReply } from '../packages/session-core/memory-citations';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider';
import type { Message, Session } from '../packages/contracts';

const message=(id:string,role:Message['role'],turn:string,extra:Partial<Message>={}):Message=>({id,role,nativeTurnId:turn,original:id,demo:false,timestamp:`2026-09-28T00:00:${id.replace(/\D/g,'').padStart(2,'0')||'00'}Z`,...extra});
const session=():Session=>({id:'source',title:'Fixture',projectId:null,pinned:false,archived:false,group:'',createdAt:'now',status:'running',binding:{runtime:'codex',provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'direct-api',nativeSessionId:'thread'},messages:[
  message('u1','user','one'),message('c2','assistant','one',{phase:'commentary',nativeTurnEnd:false}),message('a3','assistant','one',{phase:'final',nativeTurnEnd:true}),
  message('u4','user','two'),message('a5','assistant','two',{nativeTurnEnd:true}),
  message('u6','user','three'),message('c7','assistant','three',{phase:'commentary',nativeTurnEnd:false}),message('u8','user','three'),message('a9','assistant','three',{phase:'final',nativeTurnEnd:true}),
]});

test('only the last completed answer owns actions; steering and a provisional final never end the live turn',()=>{
  const source=session(),before=structuredClone(source);
  assert.deepEqual([...completedReplyIds(source)],['a3','a5']);
  const turns=readingTurns(conversationTimeline(source),source);
  assert.deepEqual(turns.map(t=>t.replyId),['a3','a5',undefined]);assert.deepEqual(turns.map(t=>t.completed),[true,true,false]);
  assert.equal(forkUnavailable(source,'a3'),undefined);
  for(const id of ['c2','c7','a9','u8',undefined])assert.ok(forkUnavailable(source,id));
  assert.deepEqual(source,before);
  source.status='idle';assert.deepEqual([...completedReplyIds(source)],['a3','a5','a9']);
  source.messages.at(-1)!.nativeTurnEnd=false;assert.deepEqual([...completedReplyIds(source)],['a3','a5']);
});

test('legacy ended turns and distinct native turns without user echoes still have a single terminal action row',()=>{
  const source=session();source.status='idle';source.messages=[message('a1','assistant','one'),message('a2','assistant','two')];
  assert.deepEqual(readingTurns(conversationTimeline(source),source).map(t=>t.replyId),['a1','a2']);
  source.messages=[message('u1','user','one'),message('a2','assistant','one'),message('a3','assistant','one')];
  for(const m of source.messages)delete m.nativeTurnId;
  assert.deepEqual([...completedReplyIds(source)],['a3']);
  assert.deepEqual(readingTurns(conversationTimeline(source),source)[0]!.answers.map(e=>e.id),['a3']);
});

test('historical native branching preserves runtime receipts and rejects missing or mismatched boundaries',()=>{
  const source=session();assert.deepEqual(recordedNativeFork(source,'a3'),{sourceSessionId:'source',threadId:'thread',lastTurnId:'one'});
  delete source.messages[2]!.nativeTurnId;assert.ok(forkUnavailable(source,'a3'));
  source.binding={...source.binding,runtime:'claude',modelConnectionId:'fixture',nativeSessionId:'10000000-0000-0000-0000-000000000001'};
  Object.assign(source.messages[2]!,{nativeTurnId:'one',nativeItemId:'20000000-0000-0000-0000-000000000002',modelSource:{runtime:'claude',name:'Fixture',targetId:'fixture'}});
  source.modelTargetId='fixture';assert.equal(forkUnavailable(source,'a3'),undefined);
  assert.equal(recordedNativeFork(source,'a3')?.lastMessageId,'20000000-0000-0000-0000-000000000002');
  source.modelTargetId='another';assert.ok(forkUnavailable(source,'a3'));
});

test('fork validation freezes selected history and identity while permitting later streaming and retranslation',()=>{
  const source=session(),key=forkSourceKey(source,'a3');
  source.messages.at(-1)!.original+='stream delta';source.messages.push(message('c10','assistant','three'));
  source.messages[2]!.translation='Updated translation';source.messages[2]!.translationSource='one';source.status='idle';
  assert.equal(forkSourceKey(source,'a3'),key);
  source.messages[2]!.original+='changed';assert.notEqual(forkSourceKey(source,'a3'),key);
  source.messages[2]!.original='a3';source.binding.nativeSessionId='another-thread';assert.notEqual(forkSourceKey(source,'a3'),key);
});

test('local provider preserves Codex citation text; empty cached references cannot hide later complete citations',async()=>{
  const source=session(),reply=source.messages[2]!;
  reply.nativeItemId='item';reply.memoryReferences=[];
  const raw='Answer.\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:4-8|note=[Export conventions]\n</citation_entries>\n<rollout_ids>synthetic</rollout_ids>\n</oai-mem-citation>';
  const runner:any=Object.create(NativeProviderRunner.prototype);
  runner.update=async(_id:string,change:(s:Session)=>void)=>change(source);
  runner.hooks={translate:()=>{}};
  await runner.message(source.id,'item',raw,true,'final');
  assert.equal(reply.original,raw);assert.equal(visibleReply(reply.original),'Answer.');
  assert.deepEqual(replyMemoryReferences(source,reply),memoryCitations(raw));
  await runner.message(source.id,'item','I checked memory and the current code.',true,'final');
  source.activities=[{id:'shell',runtime:'codex',kind:'command',category:'read',status:'completed',startedAt:source.messages[0]!.timestamp,updatedAt:reply.timestamp,input:'Get-Content MEMORY.md',output:'# A memory-looking title'}];
  assert.deepEqual(replyMemoryReferences(source,reply),[]);
  assert.equal(reply.original,'I checked memory and the current code.');
});
