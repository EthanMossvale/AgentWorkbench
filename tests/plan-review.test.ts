import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,StateStore} from '../apps/desktop/host/store';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NativePlanFlow} from '../apps/desktop/host/plan-flow';
import {TranslationModule} from '../packages/translation/module';
import {approvalFields,claudeApprovalChoices,claudeApprovalResult,resolveApprovalChoice} from '../packages/native-approvals';
import {planBlocks,planDocument,pendingCodexPlan,parsePlanReference} from '../packages/session-core/plan-review';
import {markdownTokens} from '../packages/message-markdown';
import type {Session} from '../packages/contracts';

const ref={kind:'approval' as const,receipt:'plan-receipt'};
function fixture(enabled=true,wait?:(call:number,values:Record<string,string>)=>Promise<void>,source='## Plan\nInspect then add a test.'){
  const state=initialState();state.plugins={translation:{enabled}};state.translation={...state.translation,baseUrl:'http://127.0.0.1:1234',protocol:'chat-completions',model:'synthetic',consent:true};
  const request={tool_name:'ExitPlanMode',input:{plan:source}};
  const approval={id:'native-request',turnId:'turn',kind:'plan' as const,...approvalFields('claude',request,'plan',ref.receipt)};
  const session:Session={id:'s',projectId:null,title:'Fixture',binding:{runtime:'claude',provider:'fixture',accountRef:'fixture',executionId:'local',egress:'direct-api'},permissionMode:'plan',status:'running',pinned:false,archived:false,group:'',messages:[],nativeApprovals:[approval],createdAt:'fixture'};state.sessions=[session];
  let calls=0,failNext=false;const requests:Record<string,string>[]=[];
  let translate=(value:string,call:number)=>value.replaceAll('Plan','计划').replaceAll('Inspect then add a test.','检查后添加一个测试。').replaceAll('Inspect the file','检查文件').replaceAll('Run the test','运行测试').replaceAll('Action','操作').replaceAll('Result','结果').replaceAll('Check output','检查输出').replaceAll('Passed','通过');
  const module=new TranslationModule(()=>state,async()=> 'synthetic',async(_url,init)=>{const call=++calls,values=JSON.parse(JSON.parse(String(init!.body)).messages.at(-1).content) as Record<string,string>;requests.push(values);await wait?.(call,values);if(failNext){failNext=false;return new Response('{}',{status:500});}return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(Object.fromEntries(Object.entries(values).map(([id,value])=>[id,translate(value,call)])))}}]}),{headers:{'content-type':'application/json'}});});
  const flow=new NativePlanFlow(module,{snapshot:()=>structuredClone(state),update:async fn=>{fn(state);flow.observe(state);}});
  return {state,session,request,approval,module,flow,requests,calls:()=>calls,fail:()=>{failNext=true;},respond:(fn:typeof translate)=>{translate=fn;},close:()=>{flow.dispose();module.dispose();}};
}
test('Claude plan approval exposes explicit execution permissions without offering plan as execution',()=>{
  const f=fixture(false);try{const choices=claudeApprovalChoices(f.request);
    assert.deepEqual(choices.map(c=>c.id),['accept','plan-accept-edits','plan-full-access','decline','cancel']);
    for(const [id,mode] of [['plan-accept-edits','acceptEdits'],['plan-full-access','bypassPermissions']]){
      const choice=resolveApprovalChoice(f.approval,{optionId:id,receipt:ref.receipt},choices);
      assert.deepEqual(claudeApprovalResult(f.request,choice),{behavior:'allow',updatedInput:f.request.input,updatedPermissions:[{type:'setMode',destination:'session',mode}]});
    }
    assert.throws(()=>resolveApprovalChoice(f.approval,{optionId:'plan',receipt:ref.receipt},choices),/NOT_OFFERED/);
    assert.throws(()=>resolveApprovalChoice(f.approval,{optionId:'accept',receipt:'expired'},choices),/EXPIRED/);
  }finally{f.close();}
});
test('full plan translation is display-only, automatically deduplicated and does not answer approval',async()=>{
  const f=fixture();try{const original=f.approval.details;await f.flow.translate('s',ref);assert.equal(f.calls(),1);assert.equal(f.approval.details,original);assert.equal(f.session.permissionMode,'plan');assert.equal(f.session.nativeApprovals?.length,1);assert.match(f.flow.read('s',ref).translation!,/检查后/);}finally{f.close();}
});
test('disabled translation exposes the full original and makes no requests',async()=>{
  const f=fixture(false);try{f.flow.observe(f.state);await assert.rejects(f.flow.translate('s',ref),/关闭/);assert.equal(f.calls(),0);assert.equal(f.flow.read('s',ref).text,f.request.input.plan);}finally{f.close();}
});
test('lists and tables translate their prose while preserving structure, inline literals and a single standalone code block',async()=>{
  const source='## Plan\n\n- Inspect the file `src/main.ts`\n  - Run the test `npm test`\n\n```js\nconst value = "do not translate";\n```\n\n| Action | Result |\n| --- | --- |\n| Check output | Passed |';
  const f=fixture(true,undefined,source);try{await f.flow.translate('s',ref);const blocks=planBlocks(source),result=f.flow.read('s',ref),translated=result.planTranslationBlocks!;
    assert.equal(result.translationStatus,'complete');assert.equal(translated.length,blocks.length);
    const codeIndex=blocks.findIndex(b=>b.source.startsWith('```')),listIndex=blocks.findIndex(b=>b.source.startsWith('- ')),tableIndex=blocks.findIndex(b=>b.source.startsWith('|'));
    assert.ok(codeIndex>=0&&listIndex>=0&&tableIndex>=0);assert.equal(blocks[codeIndex]!.translatable,false);assert.equal(f.requests[0]!['b'+codeIndex],undefined);
    assert.equal(translated[codeIndex]!.translation,blocks[codeIndex]!.source);assert.match(translated[listIndex]!.translation!,/检查文件 `src\/main.ts`/);assert.match(translated[listIndex]!.translation!,/运行测试 `npm test`/);
    assert.equal(markdownTokens(translated[listIndex]!.translation!)[0]!.type,'list');assert.equal(markdownTokens(translated[tableIndex]!.translation!)[0]!.type,'table');assert.match(translated[tableIndex]!.translation!,/检查输出 \| 通过/);
    assert.equal(result.text,source);assert.equal(result.translation!.split('const value =').length,2);
    await assert.rejects(f.flow.translate('s',ref,codeIndex),/PLAN_BLOCK_NOT_TRANSLATABLE/);
    for(const invalid of [-1,blocks.length,0.5,'1',null])await assert.rejects(f.flow.translate('s',ref,invalid),/PLAN_BLOCK_INVALID/);
    assert.equal(f.calls(),1);
  }finally{f.close();}
});
test('single paragraph retry replaces only its own translation and keeps the previous text on failure',async()=>{
  const f=fixture();try{await f.flow.translate('s',ref);const before=structuredClone(f.flow.read('s',ref).planTranslationBlocks!);assert.equal(before.length,2);
    f.respond((value)=>value.replaceAll('Inspect then add a test.','检查完毕，再补上测试。'));await f.flow.translate('s',ref,1);
    assert.deepEqual(Object.keys(f.requests.at(-1)!),['b1']);assert.deepEqual(f.flow.read('s',ref).planTranslationBlocks![0],before[0]);assert.equal(f.flow.read('s',ref).planTranslationBlocks![1]!.translation,'检查完毕，再补上测试。');
    f.fail();await f.flow.translate('s',ref,1);const failed=f.flow.read('s',ref);assert.equal(failed.translationStatus,'failed');assert.equal(failed.planTranslationBlocks![1]!.translation,'检查完毕，再补上测试。');assert.deepEqual(failed.planTranslationBlocks![0],before[0]);
    await f.flow.translate('s',ref,1);assert.equal(f.flow.read('s',ref).translationStatus,'complete');assert.equal(f.calls(),4);
  }finally{f.close();}
});
for(const code of ['  ```ts\n  const label = "do not translate";\n  ```','      const label = "do not translate";'])test('code inside a list remains literal while surrounding list prose translates: '+(code.includes('```')?'fenced':'indented'),async()=>{
  const f=fixture(true,undefined,'- Inspect the file\n\n'+code+'\n\n  Run the test.');try{f.respond(value=>value.replaceAll('Inspect the file','检查文件').replaceAll('Run the test','运行测试').replaceAll('do not translate','错误翻译'));await f.flow.translate('s',ref);const result=f.flow.read('s',ref);assert.equal(result.translationStatus,'complete');assert.match(result.translation!,/检查文件/);assert.match(result.translation!,/运行测试/);assert.ok(result.translation!.includes(code));assert.ok(!result.translation!.includes('错误翻译'));}finally{f.close();}
});
test('independent paragraph retries merge safely; duplicate requests deduplicate and overlapping full retries are refused',async()=>{
  const releases=new Map<number,()=>void>();const f=fixture(true,async call=>{if(call>1)await new Promise<void>(r=>releases.set(call,r));});
  try{await f.flow.translate('s',ref);f.respond((value,call)=>value.trim()+' translated '+call);
    const a=f.flow.translate('s',ref,0),duplicate=f.flow.translate('s',ref,0),b=f.flow.translate('s',ref,1);
    for(let i=0;i<100&&releases.size<2;i++)await new Promise(r=>setTimeout(r,1));assert.equal(releases.size,2);assert.equal(f.calls(),3);
    await assert.rejects(f.flow.translate('s',ref),/PLAN_TRANSLATION_BUSY/);releases.get(3)!();await b;assert.equal(f.flow.read('s',ref).translationStatus,'pending');releases.get(2)!();await Promise.all([a,duplicate]);
    assert.equal(f.flow.read('s',ref).translationStatus,'complete');assert.match(f.flow.read('s',ref).planTranslationBlocks![0]!.translation!,/translated 2/);assert.match(f.flow.read('s',ref).planTranslationBlocks![1]!.translation!,/translated 3/);
  }finally{for(const release of releases.values())release();f.close();}
});
test('a code-only plan never calls the translator',async()=>{
  const f=fixture(true,undefined,'```sh\nnpm test\n```');try{await f.flow.translate('s',ref);assert.equal(f.calls(),0);assert.equal(f.flow.read('s',ref).translationStatus,'complete');assert.equal(f.flow.read('s',ref).translation,f.request.input.plan);}finally{f.close();}
});
test('reloading an interrupted paragraph translation enables retry and retains completed blocks',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-plan-reload-'));t.after(()=>rm(directory,{recursive:true,force:true}));const f=fixture(false);t.after(f.close);
  f.session.binding.runtime='codex';f.session.permissionMode='default';f.session.status='idle';f.session.messages=[{id:'m',role:'assistant',original:'Plan\n\nInspect then add a test.',planReview:{receipt:'r',status:'pending'},translationStatus:'pending',planTranslationBlocks:[{translationStatus:'complete',translation:'计划'},{translationStatus:'pending',translation:'旧译文'}],demo:false,timestamp:'fixture'}];
  await writeFile(path.join(directory,'state.json'),JSON.stringify(f.state));const message=(await new StateStore(directory).load()).sessions[0]!.messages[0]!;
  assert.equal(message.translationStatus,'failed');assert.deepEqual(message.planTranslationBlocks![0],{translationStatus:'complete',translation:'计划'});assert.equal(message.planTranslationBlocks![1]!.translationStatus,'failed');assert.equal(message.planTranslationBlocks![1]!.translation,'旧译文');
});
for(const action of ['stop','replace','source-change','disable','configuration','dispose'])test('late plan translation is discarded after '+action,async()=>{
  let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),hold=new Promise<void>(r=>release=r);
  const f=fixture(true,async()=>{started();await hold;});try{const pending=f.flow.translate('s',ref);await ready;
    if(action==='stop')f.session.nativeApprovals=[];
    if(action==='replace')f.approval.receipt='new-receipt';
    if(action==='source-change')f.approval.details=JSON.stringify({input:{plan:'A changed plan'}});
    if(action==='disable'||action==='configuration'){const end=f.module.beginConfigurationChange();if(action==='disable')f.state.plugins!.translation!.enabled=false;end();}
    if(action==='dispose')f.flow.dispose();f.flow.observe(f.state);release();await pending;
    assert.notEqual(f.session.nativeApprovals?.[0]?.planTranslation?.translationStatus,'complete');assert.equal(f.calls(),1);
  }finally{release();f.close();}
});
test('Codex proposals are native message items; old, interrupted and foreign-runtime plans cannot execute',()=>{
  const f=fixture(false);try{const s=f.session;s.binding.runtime='codex';s.status='idle';s.nativeTurnId='turn';s.nativeTurnStatus='completed';s.messages=[{id:'m',nativeTurnId:'turn',role:'assistant',original:'Full native plan',planReview:{receipt:'m-receipt',status:'pending'},demo:false,timestamp:'fixture'}];
    const reference={kind:'message' as const,receipt:'m-receipt'};assert.equal(pendingCodexPlan(s)?.id,'m');assert.equal(planDocument(s,reference)?.canRespond,true);
    s.nativeTurnStatus='interrupted';assert.equal(pendingCodexPlan(s),undefined);s.nativeTurnStatus='completed';s.binding.runtime='claude';assert.equal(planDocument(s,reference)?.canRespond,false);
    s.binding.runtime='codex';s.messages.push({id:'next',role:'user',original:'Revise it',demo:false,timestamp:'fixture'});assert.equal(pendingCodexPlan(s),undefined);assert.equal(planDocument(s,reference)?.text,'Full native plan');
    assert.throws(()=>parsePlanReference({kind:'other',receipt:'m-receipt'}),/INVALID/);
  }finally{f.close();}
});
