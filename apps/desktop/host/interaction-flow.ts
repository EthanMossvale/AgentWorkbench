import type { AppState, Session } from '../../../packages/contracts';
import { questionSegments, validateAnswers, type AnswerPreview, type AnswerRecord, type InteractionReply, type QuestionTranslation, type RequestId } from '../../../packages/native-interactions';
import { InputGate } from '../../../packages/translation/gate';
import { TranslationModule } from '../../../packages/translation/module';
import type { TranslationPolicyToken } from '../../../packages/translation/policy';
import { asyncQuestionState } from '../../../packages/native-interactions/inbox';

interface Hooks {
  snapshot():AppState;
  update(change:(state:AppState)=>void):Promise<unknown>;
  send(session:Session,id:RequestId,reply:InteractionReply):Promise<unknown>;
}
/** Translation is an optional overlay. Replies always resume the existing native request. */
export class NativeInteractionFlow {
  private gate=new InputGate();
  private previews=new Map<string,{sessionId:string;receipt:string;requestId:RequestId;policy:TranslationPolicyToken;record:AnswerRecord[];review:boolean}>();
  private requests=new Map<string,string>();
  private translating=new Map<string,Promise<void>>();
  private disposed=false;
  constructor(private module:TranslationModule,private hooks:Hooks){}
  dispose(){this.disposed=true;this.gate.invalidatePending();this.previews.clear();this.requests.clear();}
  current(sessionId:string,requestId:RequestId,receipt:string){
    const session=this.hooks.snapshot().sessions.find(s=>s.id===sessionId);
    const item=session?.nativeInteractions?.find(i=>i.id===requestId&&i.receipt===receipt&&i.status==='pending');
    if(!session||!item||item.deferred||!receipt||this.disposed)throw Error('这条提问已结束、已收起或已被新的请求取代，请检查当前会话。');
    return {session,item};
  }
  observe(state:AppState){
    if(this.disposed)return;
    for(const [id,p] of this.previews){
      const live=state.sessions.find(s=>s.id===p.sessionId)?.nativeInteractions?.some(i=>i.receipt===p.receipt&&i.status==='pending'&&!i.deferred);
      if(!live){try{this.gate.cancel(id);}catch{/* A dispatch already owns this answer. */}this.previews.delete(id);}
    }
    if(!this.module.enabled())return;
    for(const session of state.sessions){
      for(const item of session.nativeInteractions??[])if(item.status==='pending'&&item.questions?.length&&!item.unsupportedReason&&(!item.questionTranslation||item.questionTranslation.status==='off'))void this.translate(session.id,item.receipt!);
      for(const message of session.messages)if(message.questions?.length&&['open','deferred'].includes(asyncQuestionState(session,message))&&(!message.questionTranslation||message.questionTranslation.status==='off'))void this.translate(session.id,undefined,message.id);
    }
  }
  async translate(sessionId:string,receipt?:string,messageId?:string){
    this.module.assertEnabled();
    const key=JSON.stringify([sessionId,'questions',receipt,messageId]);
    const existing=this.translating.get(key);if(existing)return existing;
    const resolve=(state:AppState)=>{const s=state.sessions.find(s=>s.id===sessionId);return receipt?s?.nativeInteractions?.find(i=>i.receipt===receipt):s?.messages.find(m=>m.id===messageId);};
    const source=resolve(this.hooks.snapshot());if(!source?.questions?.length)return;
    const segments=questionSegments(source.questions),fingerprint=JSON.stringify(segments);
    const write=(overlay:QuestionTranslation)=>this.hooks.update(state=>{const target=resolve(state);if(target?.questions&&JSON.stringify(questionSegments(target.questions))===fingerprint)target.questionTranslation=overlay;});
    const operation=(async()=>{
      try{
        await write({status:'pending',values:source.questionTranslation?.values});
        const result=await this.module.segments(segments,'output',key,undefined,sessionId);
        await this.hooks.update(state=>{this.module.assertCurrent(result.policy);const target=resolve(state);if(target?.questions&&JSON.stringify(questionSegments(target.questions))===fingerprint)target.questionTranslation={status:'complete',values:result.value};});
      }catch(error){if(!this.disposed)await write({status:this.module.enabled()?'failed':'off',values:source.questionTranslation?.values,error:this.module.enabled()?(error instanceof Error?error.message:'译文暂不可用。'):undefined}).catch(()=>{});}
    })();this.translating.set(key,operation);try{await operation;}finally{this.translating.delete(key);}
  }
  async prepare(sessionId:string,requestId:RequestId,receipt:string,answers:unknown,clientRequest:string):Promise<AnswerPreview>{
    const {item}=this.current(sessionId,requestId,receipt);
    if(item.kind!=='questions'||item.unsupportedReason)throw Error('此请求不能准备问答预览。');
    const source=validateAnswers(item.questions??[],answers),policy=this.module.captureConfiguration(),enabled=this.module.enabled();
    const records:AnswerRecord[]=item.questions!.map(q=>({questionId:q.id,original:[...source[q.id]!],submitted:[...source[q.id]!],...(q.secret?{secret:true}:{})}));
    const custom=records.flatMap((a,i)=>a.secret?[]:a.original.flatMap((value,j)=>item.questions![i]!.options.some(o=>o.label===value)?[]:[{key:`a${i}.${j}`,i,j,value}]));
    const id=this.gate.create(JSON.stringify([sessionId,receipt]),JSON.stringify(source));
    const meta={sessionId,receipt,requestId,policy,record:records,review:enabled&&custom.length>0};
    for(const [oldId,entry]of this.previews)if(entry.sessionId===sessionId&&entry.receipt===receipt)this.previews.delete(oldId);
    this.previews.set(id,meta);this.requests.set(clientRequest,id);
    try{
      const preview=await this.gate.prepare(id,async(original,signal)=>{
        this.module.assertConfiguration(policy);
        let incomplete=false;
        const pending=enabled?custom.filter(a=>/\p{Script=Han}/u.test(a.value)):[];
        if(pending.length){
          const translated=await this.module.segments(Object.fromEntries(pending.map(a=>[a.key,a.value])),'input',id,signal,sessionId);
          incomplete=!!translated.incomplete;
          for(const a of pending)records[a.i]!.submitted[a.j]=translated.value[a.key]!;
        }
        this.current(sessionId,requestId,receipt);this.module.assertConfiguration(policy);
        return {text:JSON.stringify(Object.fromEntries(records.map(a=>[a.questionId,a.submitted]))),incomplete};
      },false,!enabled,!enabled);
      return {id,incomplete:preview.incomplete,sourceHash:preview.sourceHash,answers:records.map(a=>a.secret?{...a,original:[],submitted:[]}:structuredClone(a)),review:meta.review};
    }catch(error){this.previews.delete(id);throw error;}finally{this.requests.delete(clientRequest);}
  }
  cancel(id?:string,request?:string){const target=id??this.requests.get(request??'');if(target){this.gate.cancel(target);this.previews.delete(target);}return null;}
  async submit(sessionId:string,id:string,sourceHash:string,automatic:boolean){
    const meta=this.previews.get(id);if(!meta||meta.sessionId!==sessionId)throw Error('回答预览已失效，请重新发送。');
    const {session,item}=this.current(sessionId,meta.requestId,meta.receipt);
    this.module.assertConfiguration(meta.policy);
    if(automatic&&meta.review&&(!this.module.enabled()||!this.hooks.snapshot().autoSubmitTranslated))throw Error('直接发送已关闭，请检查回答预览后确认。');
    const preview=this.gate.getPreview(id,JSON.stringify([sessionId,meta.receipt]));
    if(automatic&&preview.incomplete)throw Error('译文尚未完整完成，请检查回答预览后确认发送。');
    const answers=validateAnswers(item.questions??[],JSON.parse(preview.translated));
    try{return await this.gate.submit(id,JSON.stringify([sessionId,meta.receipt]),sourceHash,async()=>{
      this.current(sessionId,meta.requestId,meta.receipt);this.module.assertConfiguration(meta.policy);
      const result=await this.hooks.send(session,meta.requestId,{action:'submit',answers});
      await this.hooks.update(state=>{const target=state.sessions.find(s=>s.id===sessionId)?.nativeInteractions?.find(i=>i.receipt===meta.receipt);if(target)target.answerRecord=meta.record.map(a=>a.secret?{...a,original:[],submitted:[]}:structuredClone(a));});
      return result;
    });}finally{this.previews.delete(id);}
  }
}
