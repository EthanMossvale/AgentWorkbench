import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { codexInteraction, claudeInteraction, interactionResult, questions, formFields, validateForm, validateAnswers, expireInteractions, putInteraction, safeInteractionUrl, planUpdate } from '../packages/native-interactions';
import { CodexRpcClient } from '../packages/runtime-codex';
import { decodeNativeFrame } from '../services/remote-supervisor';
import { sessionNeedsAttention } from '../packages/session-core/sidebar-order';

const params={threadId:'thread',turnId:'turn',itemId:'tool',isBlocking:true,questions:[{id:'choice',header:'Format',question:'Choose a format.',isOther:true,isSecret:false,options:[{label:'Short',description:'One paragraph'},{label:'Long',description:'More detail'}]}]};
const now='2026-09-27T00:00:00Z';
test('Codex questions retain native identities, free text, secrets and nonblocking semantics',()=>{
  const item=codexInteraction('item/tool/requestUserInput',{...params,isBlocking:false},7,now)!;
  assert.equal(item.blocking,false);assert.equal(item.questions![0]!.id,'choice');
  assert.deepEqual(interactionResult(item,{action:'submit',answers:{choice:['Custom 中文 answer']}},params),{answers:{choice:{answers:['Custom 中文 answer']}}});
  assert.deepEqual(interactionResult(item,{action:'decline'},params),{answers:{}});
  assert.throws(()=>interactionResult(item,{action:'submit',answers:{foreign:['Long']}},params));
  assert.throws(()=>interactionResult(item,{action:'submit',answers:{choice:['Short','Long']}},params));
  const secret=questions([{...params.questions[0],isSecret:true,options:null}],'codex')[0]!;assert.equal(secret.secret,true);
  assert.throws(()=>validateAnswers([{...secret,other:false,options:[{label:'A',description:''}]}],{choice:['B']}));
});
test('Claude answers map by original question text and preserve original tool inputs',()=>{
  const raw={subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{question:'Which sections?',header:'Sections',multiSelect:true,options:[{label:'Intro',description:''},{label:'End',description:''}]}],metadata:{source:'native'}}};
  const item=claudeInteraction(raw,'q','thread','turn',now)!;
  const result:any=interactionResult(item,{action:'submit',answers:{'0':['Intro','End']}},raw);
  assert.equal(result.behavior,'allow');assert.equal(result.updatedInput.answers['Which sections?'],'Intro, End');
  assert.deepEqual(result.updatedInput.questions,raw.input.questions);assert.deepEqual(result.updatedInput.metadata,raw.input.metadata);
  assert.equal((interactionResult(item,{action:'cancel'},raw) as any).behavior,'deny');
  assert.equal(claudeInteraction({subtype:'can_use_tool',tool_name:'Edit'},'q','thread','turn',now),undefined);
});
test('malformed question lists remain declineable but cannot be accepted',()=>{
  const item=codexInteraction('item/tool/requestUserInput',{...params,questions:[params.questions[0],params.questions[0]]},7,now)!;
  assert.ok(item.unsupportedReason);assert.throws(()=>interactionResult(item,{action:'submit',answers:{}},params));
  assert.deepEqual(interactionResult(item,{action:'cancel'},params),{answers:{}});
});
test('MCP forms validate required fields, enum values, numeric ranges and unknown fields',()=>{
  const raw={threadId:'thread',turnId:null,serverName:'Fixture',mode:'form',message:'Fill form',requestedSchema:{type:'object',properties:{name:{type:'string',minLength:2},count:{type:'integer',minimum:1,maximum:5},ok:{type:'boolean'},color:{type:'string',enum:['red','blue']},tags:{type:'array',items:{type:'string',enum:['a','b']},minItems:1,maxItems:2}},required:['name','count','ok','color','tags']}};
  const item=codexInteraction('mcpServer/elicitation/request',raw,'mcp',now)!;assert.equal(item.unsupportedReason,undefined);
  const content={name:'Test',count:3,ok:false,color:'blue',tags:['a']};assert.deepEqual(interactionResult(item,{action:'submit',content},raw),{action:'accept',content,_meta:null});
  for(const invalid of [{...content,count:6},{...content,count:2.5},{...content,color:'orange'},{...content,tags:[]},{...content,ok:undefined},{...content,injected:true}])assert.throws(()=>validateForm(item.fields!,invalid));
  assert.deepEqual(interactionResult(item,{action:'decline'},raw),{action:'decline',content:null,_meta:null});
  assert.throws(()=>formFields({type:'object',properties:{nested:{type:'object'}}}));
  assert.throws(()=>formFields({type:'object',properties:{text:{type:'string',pattern:'.*'}}}));
});
test('unrecognized MCP modes and constraints fail closed; URL schemes are restricted',()=>{
  const item=codexInteraction('mcpServer/elicitation/request',{threadId:'thread',mode:'openai/userVerification'},'mcp',now)!;
  assert.ok(item.unsupportedReason);assert.throws(()=>interactionResult(item,{action:'submit'},{}));
  assert.deepEqual(interactionResult(item,{action:'cancel'},{}),{action:'cancel',content:null,_meta:null});
  for(const url of ['file:///C:/secret','javascript:alert(1)','https://user:password@example.com'])assert.throws(()=>safeInteractionUrl(url));
  assert.equal(safeInteractionUrl('https://example.com/confirm?code=fixture'),'https://example.com/confirm?code=fixture');
});
test('permission grants are the exact requested subset and turn scoped, with safe denial for newer profiles',()=>{
  const raw={threadId:'thread',turnId:'turn',permissions:{network:{enabled:true},fileSystem:{read:['/owner/read'],write:['/owner/write']}}};
  const item=codexInteraction('item/permissions/requestApproval',raw,'p',now)!;
  assert.deepEqual(interactionResult(item,{action:'submit',content:{network:'arbitrary'}},raw),{permissions:raw.permissions,scope:'turn'});
  assert.deepEqual(interactionResult(item,{action:'decline'},raw),{permissions:{},scope:'turn'});
  const newer=codexInteraction('item/permissions/requestApproval',{...raw,permissions:{fileSystem:{entries:[{path:'/owner',access:'write'}]}}},'new',now)!;
  assert.ok(newer.unsupportedReason);assert.throws(()=>interactionResult(newer,{action:'submit'},{}));
});
test('pending questions drive attention, expire by scope, retain no submitted answers and cannot replay',()=>{
  const session:any={status:'running'},item=codexInteraction('item/tool/requestUserInput',params,'q',now)!;
  putInteraction(session,item);assert.equal(sessionNeedsAttention(session),true);assert.throws(()=>putInteraction(session,item));
  expireInteractions(session,'expired','unrelated','turn');assert.equal(item.status,'pending');
  expireInteractions(session,'uncertain');assert.equal(item.status,'uncertain');assert.equal(sessionNeedsAttention(session),false);
  assert.throws(()=>interactionResult(item,{action:'submit',answers:{choice:['Short']}},params));
  assert.equal(JSON.stringify(session).includes('answers'),false);
});
test('native plan steps and asynchronous questions preserve public content without adding a model turn',()=>{
  assert.equal(planUpdate({threadId:'t',plan:[{step:'Review',status:'inProgress'}]})?.steps[0]?.step,'Review');
  assert.equal(planUpdate({plan:[{step:'Review',status:'invented'}]}),undefined);
  assert.deepEqual(questions([{title:'Choose later',options:['One','Two']}],'async')[0]?.options.map(o=>o.label),['One','Two']);
});
function rpcFixture(){
  const transport:any=new EventEmitter(),writes:any[]=[];transport.write=async(v:any)=>{writes.push(v);};transport.stop=async()=>{};
  const rpc=new CodexRpcClient(transport,'session');rpc.bindRootThread('thread');
  const emit=(method:string,p:any,id?:string|number)=>transport.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify({method,params:p,...(id===undefined?{}:{id})})+'\n')));
  return {rpc,emit,writes,transport};
}
test('native question replies are single-use and duplicate clicks never write twice',async()=>{
  const f=rpcFixture();f.emit('item/tool/requestUserInput',params,7);
  const result=await Promise.allSettled([f.rpc.replyInteraction(7,{action:'submit',answers:{choice:['Short']}}),f.rpc.replyInteraction(7,{action:'submit',answers:{choice:['Short']}})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.writes.length,1);assert.equal(f.writes[0].id,7);
});
test('resolved, completed and disconnected requests reject stale responses',async()=>{
  for(const end of ['serverRequest/resolved','turn/completed','disconnect']){
    const f=rpcFixture();f.emit('item/tool/requestUserInput',params,'q');
    if(end==='disconnect')f.transport.emit('disconnect');else f.emit(end,end==='turn/completed'?{threadId:'thread',turn:{id:'turn'}}:{threadId:'thread',requestId:'q'});
    await assert.rejects(f.rpc.replyInteraction('q',{action:'submit',answers:{choice:['Short']}}));assert.equal(f.writes.length,0);
  }
});
test('unbound request cannot be answered; unknown methods receive one explicit protocol error',async()=>{
  const f=rpcFixture();f.emit('item/tool/requestUserInput',{...params,threadId:'unrelated'},'foreign');
  await assert.rejects(f.rpc.replyInteraction('foreign',{action:'submit',answers:{choice:['Short']}}));
  f.emit('future/newInteractiveTool',{threadId:'thread'},'future');await f.rpc.rejectServerRequest('future');
  assert.deepEqual(f.writes[0],{id:'future',error:{code:-32601,message:'This native client request is not supported by Agent Workbench.'}});
});
test('ambiguous writes consume the response slot and never replay',async()=>{
  const f=rpcFixture();f.emit('item/tool/requestUserInput',params,'q');let n=0;f.transport.write=async()=>{n++;throw Error('Transport failed after write.');};
  await assert.rejects(f.rpc.replyInteraction('q',{action:'submit',answers:{choice:['Short']}}));
  await assert.rejects(f.rpc.replyInteraction('q',{action:'submit',answers:{choice:['Short']}}));assert.equal(n,1);
});
