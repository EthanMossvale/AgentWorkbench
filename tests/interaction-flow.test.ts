import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeInteractionFlow } from '../apps/desktop/host/interaction-flow';
import { initialState } from '../apps/desktop/host/store';
import { TranslationModule } from '../packages/translation/module';
import { Translator } from '../packages/translation/provider';
import { codexInteraction, putInteraction, type InteractionReply } from '../packages/native-interactions';
import type { Session } from '../packages/contracts';

const response=(content:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}),{headers:{'content-type':'application/json'}});
function fixture(enabled=true,fetcher?:typeof fetch){
 const state=initialState();state.plugins={translation:{enabled}};state.translateInput=true;state.autoSubmitTranslated=false;
 state.translation={...state.translation,baseUrl:'http://127.0.0.1:1234',protocol:'chat-completions',model:'synthetic',consent:true};
 const session:Session={id:'s',projectId:null,title:'Fixture',binding:{runtime:'codex',provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'direct-api'},status:'running',pinned:false,archived:false,group:'',messages:[],createdAt:'fixture'};state.sessions=[session];
 const sent:InteractionReply[]=[],calls:string[]=[];
 const module=new TranslationModule(()=>structuredClone(state),async()=> 'synthetic-key',async(url,init)=>{calls.push(String(init?.body));if(fetcher)return fetcher(url,init);const body=JSON.parse(String(init!.body)),input=JSON.parse(body.messages.at(-1).content);return response(Object.fromEntries(Object.entries(input).map(([k,v])=>[k,String(v).replace('请保持简洁','Keep it concise').replace('Which style?','哪种风格？').replace('Short','简短').replace('A brief answer','简要回答')])));});
 const flow=new NativeInteractionFlow(module,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),send:async(_s,id,reply)=>{sent.push(structuredClone(reply));session.nativeInteractions!.find(i=>i.id===id)!.status='answered';}});
 const add=(secret=false)=>{const item=codexInteraction('item/tool/requestUserInput',{threadId:'native',turnId:'turn',questions:[{id:'style',header:'Style',question:'Which style?',isOther:true,isSecret:secret,options:[{label:'Short',description:'A brief answer'}]}]},'native-id',new Date().toISOString())!;putInteraction(session,item);return item;};
 const prepare=(receipt:string,values=['请保持简洁'])=>flow.prepare('s','native-id',receipt,{style:values},'client');
 return {state,session,sent,calls,module,flow,add,prepare,close:()=>{flow.dispose();module.dispose();}};
}
test('disabled translation performs no question or answer calls and sends original Chinese without a preview',async()=>{
 const f=fixture(false);try{const item=f.add();f.flow.observe(f.state);const preview=await f.prepare(item.receipt!);assert.equal(preview.review,false);assert.deepEqual(preview.answers[0]!.submitted,['请保持简洁']);await f.flow.submit('s',preview.id,preview.sourceHash,false);assert.deepEqual(f.sent[0]!.answers,{style:['请保持简洁']});assert.equal(f.calls.length,0);await assert.rejects(f.flow.translate('s',item.receipt),/关闭/);assert.equal(f.calls.length,0);}finally{f.close();}
});
test('question and option translations are separate display fields and cannot change native identity',async()=>{
 const f=fixture();try{const item=f.add();await f.flow.translate('s',item.receipt);assert.equal(item.questions![0]!.question,'Which style?');assert.equal(item.questions![0]!.options[0]!.label,'Short');assert.equal(item.questionTranslation!.values!['q0.question'],'哪种风格？');assert.equal(item.questionTranslation!.values!['q0.option0.label'],'简短');const preview=await f.prepare(item.receipt!,['Short']);assert.equal(preview.review,false);await f.flow.submit('s',preview.id,preview.sourceHash,false);assert.deepEqual(f.sent[0]!.answers,{style:['Short']});assert.equal(f.calls.length,1);}finally{f.close();}
});
test('Chinese free answers use the shared auto-send preference and persist the paired non-secret receipt',async()=>{
 const f=fixture();try{const item=f.add();const preview=await f.prepare(item.receipt!);assert.equal(preview.review,true);assert.deepEqual(preview.answers[0]!.submitted,['Keep it concise']);assert.equal(f.sent.length,0);await assert.rejects(f.flow.submit('s',preview.id,preview.sourceHash,true),/直接发送已关闭/);await f.flow.submit('s',preview.id,preview.sourceHash,false);assert.deepEqual(f.sent[0]!.answers,{style:['Keep it concise']});assert.deepEqual(item.answerRecord?.[0]?.original,['请保持简洁']);await assert.rejects(f.flow.submit('s',preview.id,preview.sourceHash,false));assert.equal(f.sent.length,1);}finally{f.close();}
});
test('enabled auto-send resumes the native question; toggling it off before dispatch prevents automatic send',async()=>{
 const f=fixture();try{const item=f.add();f.state.autoSubmitTranslated=true;const first=await f.prepare(item.receipt!);f.state.autoSubmitTranslated=false;await assert.rejects(f.flow.submit('s',first.id,first.sourceHash,true));f.state.autoSubmitTranslated=true;await f.flow.submit('s',first.id,first.sourceHash,true);assert.equal(f.sent.length,1);}finally{f.close();}
});
test('disabling the module during translation invalidates its result and never auto-submits or leaks another call',async()=>{
 let release!:()=>void;let called!:()=>void;const started=new Promise<void>(r=>called=r),wait=new Promise<void>(r=>release=r);
 const f=fixture(true,async()=>{called();await wait;return response({'a0.0':'Keep it concise'});});try{const item=f.add();const preparing=f.prepare(item.receipt!);await started;const end=f.module.beginConfigurationChange();f.state.plugins!.translation!.enabled=false;end();release();await assert.rejects(preparing);assert.equal(f.sent.length,0);const preview=await f.prepare(item.receipt!);assert.equal(preview.review,false);await f.flow.submit('s',preview.id,preview.sourceHash,false);assert.equal(f.calls.length,1);assert.deepEqual(f.sent[0]!.answers,{style:['请保持简洁']});}finally{release?.();f.close();}
});
test('configuration changes, edited answers and reused native IDs cannot submit stale previews',async()=>{
 const f=fixture();try{let item=f.add();const first=await f.prepare(item.receipt!);const second=await f.prepare(item.receipt!,['Changed answer']);await assert.rejects(f.flow.submit('s',first.id,first.sourceHash,false));f.flow.cancel(second.id);await assert.rejects(f.flow.submit('s',second.id,second.sourceHash,false));const third=await f.prepare(item.receipt!);const end=f.module.beginConfigurationChange();end();await assert.rejects(f.flow.submit('s',third.id,third.sourceHash,false));const old=item.receipt!;item.status='expired';item=f.add();assert.notEqual(item.receipt,old);await assert.rejects(f.prepare(old));assert.equal(f.sent.length,0);}finally{f.close();}
});
test('secret answers bypass translation and are absent from public previews and persisted answer records',async()=>{
 const f=fixture();try{const item=f.add(true),secret='只回传当前原生请求';const preview=await f.prepare(item.receipt!,[secret]);assert.equal(preview.review,false);assert.ok(!JSON.stringify(preview).includes(secret));assert.equal(f.calls.length,0);await f.flow.submit('s',preview.id,preview.sourceHash,false);assert.deepEqual(f.sent[0]!.answers,{style:[secret]});assert.ok(!JSON.stringify(item).includes(secret));}finally{f.close();}
});
test('missing question fields retain original text and expired questions never send an answer',async()=>{
 const f=fixture(true,async()=>response({wrong:'Unknown field'}));try{const item=f.add();await f.flow.translate('s',item.receipt);assert.equal(item.questionTranslation?.status,'complete');assert.match(item.questionTranslation!.values!['q0.question']!,/部分译文.*\nWhich style/);const preview=await f.prepare(item.receipt!);assert.equal(preview.incomplete,true);assert.deepEqual(preview.answers[0]!.submitted,['请保持简洁']);item.status='expired';await assert.rejects(f.prepare(item.receipt!));assert.equal(f.sent.length,0);}finally{f.close();}
});

test('deferring a native question revokes its preview without answering or losing its pending request',async()=>{
 const f=fixture(false);try{const item=f.add(),preview=await f.prepare(item.receipt!);item.deferred=true;f.flow.observe(f.state);await assert.rejects(f.flow.submit('s',preview.id,preview.sourceHash,false));await assert.rejects(f.prepare(item.receipt!));assert.equal(item.status,'pending');assert.equal(f.sent.length,0);item.deferred=false;const fresh=await f.prepare(item.receipt!);await f.flow.submit('s',fresh.id,fresh.sourceHash,false);assert.equal(f.sent.length,1);}finally{f.close();}
});
test('batched translation preserves each protected path and keeps source for mismatched segments',async()=>{
 const f=fixture();try{const values={question:'Read `src/main.ts`?',answer:'请保留 `src/test.ts`'};const translator=new Translator(async(_url,init)=>{const input=JSON.parse(JSON.parse(String(init!.body)).messages.at(-1).content);return response(input);});const result=await translator.translate(JSON.stringify(values),'output',f.state.translation,'synthetic-key',undefined,'segments');assert.deepEqual(JSON.parse(result.text),values);const swapped=new Translator(async(_url,init)=>{const input=JSON.parse(JSON.parse(String(init!.body)).messages.at(-1).content);return response({question:input.answer,answer:input.question});});const partial=await swapped.translate(JSON.stringify(values),'output',f.state.translation,'synthetic-key',undefined,'segments');assert.equal(partial.incomplete,true);assert.deepEqual(JSON.parse(partial.text),values);}finally{f.close();}
});

 test('partial free answers always use existing review; explicit confirmation sends once',async()=>{
 const f=fixture(true,async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{"a0.0":"Partial answer"'}}]}));try{f.state.autoSubmitTranslated=true;const item=f.add(),preview=await f.prepare(item.receipt!);assert.equal(preview.incomplete,true);assert.equal(preview.answers[0]!.submitted[0],'Partial answer');await assert.rejects(f.flow.submit('s',preview.id,preview.sourceHash,true),/完整/);assert.equal(f.sent.length,0);await f.flow.submit('s',preview.id,preview.sourceHash,false);assert.equal(f.sent.length,1);assert.equal(f.state.autoSubmitTranslated,true);}finally{f.close();}
 });
