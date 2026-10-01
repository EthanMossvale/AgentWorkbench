import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import type { Session } from '../packages/contracts';
import { translationPlacement } from '../packages/translation/display';

const response=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'单条中文译文。'}}]}),{headers:{'content-type':'application/json'}});
async function fixture(fetcher:typeof fetch=async()=>response()){
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-child-translation-')),store=new StateStore(directory);await store.load();
  const secrets=new SecretStore(directory,{encrypt:value=>Buffer.from(value),decrypt:value=>value.toString()});await secrets.set('https://translator.example/v1','synthetic-only');
  const controller=new WorkbenchController(store,secrets,{translationFetcher:fetcher,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  const session=await controller.call('session/create',{runtime:'demo'}) as Session;
  await store.update(state=>{Object.assign(state.translation,{baseUrl:'https://translator.example/v1',protocol:'chat-completions',model:'fixture',consent:true});const parent=state.sessions[0]!;parent.nativeChildren=[{runtime:'claude',nativeChildId:'child',operation:'completed',status:'completed',updatedAt:'2026-09-27T12:00:00Z',task:'Review the public parser.',messages:[{id:'reply',role:'assistant',text:'The parser handles empty input.',at:'2026-09-27T12:00:00Z',updatedAt:'2026-09-27T12:00:00Z',complete:true}]}];});
  return {directory,store,controller,session,close:async()=>{await controller.dispose();await rm(directory,{recursive:true});}};
}
test('translation style defaults to the panel, moves inline for readers, and persists independently',async()=>{
  const f=await fixture();try{assert.equal(translationPlacement(undefined,false),'panel');assert.equal(translationPlacement('panel',true),'inline');assert.equal(translationPlacement('inline',false),'inline');assert.equal(translationPlacement('panel',false,true),'inline');await f.controller.call('translation/layout',{layout:'inline'});assert.equal((await new StateStore(f.directory).load()).translationLayout,'inline');await assert.rejects(f.controller.call('translation/layout',{layout:'other'}));}finally{await f.close();}
});
test('a child task and reply translate only on request without sending neighboring messages or changing sources',async()=>{
  const calls:string[]=[];const f=await fixture(async(_url,init)=>{calls.push(String(init?.body));return response();});try{
    assert.equal(calls.length,0);await f.controller.call('child-message/translate',{sessionId:f.session.id,childId:'child',messageId:'reply'});
    assert.equal(calls.length,1);assert.match(calls[0]!,/The parser handles empty input/);assert.doesNotMatch(calls[0]!,/Review the public parser/);
    let child=f.store.snapshot().sessions[0]!.nativeChildren![0]!;assert.equal(child.messages![0]!.translation,'单条中文译文。');assert.equal(child.taskTranslation,undefined);assert.equal(child.messages![0]!.text,'The parser handles empty input.');
    await f.controller.call('child-message/translate',{sessionId:f.session.id,childId:'child'});assert.equal(calls.length,2);assert.match(calls[1]!,/Review the public parser/);assert.doesNotMatch(calls[1]!,/The parser handles empty input/);
    assert.equal((await new StateStore(f.directory).load()).sessions[0]!.nativeChildren![0]!.taskTranslation!.translation,'单条中文译文。');
  }finally{await f.close();}
});
test('manual child translation rejects missing and streaming messages, and respects module disable',async()=>{
  const f=await fixture();try{await f.store.update(s=>{s.sessions[0]!.nativeChildren![0]!.messages![0]!.complete=false;});await assert.rejects(f.controller.call('child-message/translate',{sessionId:f.session.id,childId:'child',messageId:'reply'}),/完成/);await assert.rejects(f.controller.call('child-message/translate',{sessionId:f.session.id,childId:'absent'}),/不存在/);await f.controller.call('plugins/set-enabled',{id:'translation',enabled:false});await assert.rejects(f.controller.call('child-message/translate',{sessionId:f.session.id,childId:'child'}),/模块已关闭/);}finally{await f.close();}
});
test('duplicate clicks share a translation; changed source cannot receive a stale result',async()=>{
  let complete!:()=>void,started!:()=>void,calls=0;const ready=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>complete=r);
  const f=await fixture(async()=>{calls++;started();await gate;return response();});try{const payload={sessionId:f.session.id,childId:'child',messageId:'reply'},a=f.controller.call('child-message/translate',payload),b=f.controller.call('child-message/translate',payload);await ready;await f.store.update(state=>{const message=state.sessions[0]!.nativeChildren![0]!.messages![0]!;message.text='Changed source.';delete message.translationStatus;});complete();await Promise.all([a,b]);assert.equal(calls,1);assert.equal(f.store.snapshot().sessions[0]!.nativeChildren![0]!.messages![0]!.translation,undefined);}finally{complete();await f.close();}
});
test('cross-source child sessions skip automatic translation and allow manual task and reply translation',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return response();});try{await f.store.update(state=>{const session=state.sessions[0]!;session.agentParent={sessionId:'parent',operationId:'op',taskHash:'hash',authorizationQuote:'Start a child'};session.messages=[{id:'task',role:'user',original:'Parent task.',submitted:'Parent task.',timestamp:'2026-09-27T12:00:00Z',demo:false},{id:'answer',role:'assistant',original:'Child answer.',timestamp:'2026-09-27T12:00:00Z',demo:false}];});
    await (f.controller as any).translateMessage(f.session.id,f.store.snapshot().sessions[0]!.messages[1]);assert.equal(calls,0);
    for(const messageId of ['task','answer'])await f.controller.call('message/retranslate',{sessionId:f.session.id,messageId});assert.equal(calls,2);assert.ok(f.store.snapshot().sessions[0]!.messages.every(message=>message.translation==='单条中文译文。'));
  }finally{await f.close();}
});
