import {annotationPrompt,validateAnnotations,type ContextAnnotation} from '../context-annotations';
import { randomUUID } from 'node:crypto';
import { skillPrompt, type SkillInvocation } from '../native-skills/invocation';
import { hashText } from './protection';
import type { DraftPreview } from '../contracts/index';
export class InputGate {
  private entries=new Map<string,{sessionId:string; revision:number; original:string; annotations?:ContextAnnotation[]; annotationRevision?:number; skills?:SkillInvocation[]; attachments?:import('../attachments/types').Attachment[]; state:'draft'|'translating'|'ready'|'dispatching'|'sent'|'uncertain'|'cancelled'; preview?:DraftPreview; abort:AbortController}>();
  create(sessionId:string,original:string,attachments?:import('../attachments/types').Attachment[],skills?:SkillInvocation[],annotations?:ContextAnnotation[],annotationRevision?:number){
    for(const [id,v]of this.entries)if(v.sessionId===sessionId && !['sent','uncertain','dispatching'].includes(v.state)){v.abort.abort();this.entries.delete(id);}
    if(this.entries.size>2000)for(const [id,v]of this.entries)if(v.state==='sent'||v.state==='cancelled')this.entries.delete(id);
    const id=randomUUID();this.entries.set(id,{sessionId,revision:1,original,annotations:annotations===undefined?undefined:validateAnnotations(annotations),annotationRevision,skills:structuredClone(skills),attachments:structuredClone(attachments),state:'draft',abort:new AbortController()});return id;
  }
  cancel(id:string){const e=this.get(id);if(e.state==='dispatching'||e.state==='sent'||e.state==='uncertain')throw new Error('原生提交已经开始，不能以取消翻译代替中断回合。');e.abort.abort();e.state='cancelled';}
  invalidatePending(){for(const e of this.entries.values())if(!['dispatching','sent','uncertain','cancelled'].includes(e.state)){e.abort.abort();e.state='cancelled';}}
  hasPending(sessionId:string){return [...this.entries.values()].some(e=>e.sessionId===sessionId&&['translating','ready','dispatching'].includes(e.state));}
  async prepare(id:string,translate:(text:string,signal:AbortSignal)=>Promise<string|{text:string;annotations:ContextAnnotation[]}>,demo=false,bypass=false,moduleDisabled=false):Promise<DraftPreview>{
    const e=this.get(id);if(e.state!=='draft')throw new Error('输入已经处理，请创建新修订。');e.state='translating';
    try{const result=await translate(e.original,e.abort.signal);e.abort.signal.throwIfAborted();const translated=typeof result==='string'?result:result.text;if(typeof result!=='string')e.annotations=validateAnnotations(result.annotations);
      if(this.entries.get(id)!==e)throw new Error('输入修订已过期。');
      e.preview={id,revision:e.revision,original:e.original,translated:skillPrompt(annotationPrompt(translated,e.annotations),e.skills),skills:e.skills,annotations:e.annotations,annotationRevision:e.annotationRevision,sourceHash:hashText(e.original+(e.attachments?.length?JSON.stringify(e.attachments):'')+(e.skills?.length?JSON.stringify(e.skills):'')+(e.annotations?.length?JSON.stringify(e.annotations):'')),attachments:e.attachments,demo,bypass,...(moduleDisabled?{moduleDisabled:true}:{})};e.state='ready';return structuredClone(e.preview);
    }catch(error){if(e.state==='translating')e.state='draft';throw error;}
  }
  async submit<T>(id:string,sessionId:string,sourceHash:string,dispatch:(text:string,operationId:string)=>Promise<T>):Promise<T>{
    const e=this.get(id);if(e.sessionId!==sessionId||e.state!=='ready'||e.preview?.sourceHash!==sourceHash)throw new Error('输入已过期、重复提交或会话不匹配。');
    e.state='dispatching';try{const result=await dispatch(e.preview.translated,id);e.state='sent';return result;}catch(error){e.state='uncertain';throw error;}
  }
  getPreview(id:string,sessionId:string){const e=this.get(id);if(e.sessionId!==sessionId||e.state!=='ready'||!e.preview)throw new Error('预览不可提交。');return structuredClone(e.preview);}
  status(id:string){return this.get(id).state;}
  beginRevision(id:string,sessionId:string,sourceHash:string){const previous=this.getPreview(id,sessionId);if(previous.sourceHash!==sourceHash)throw new Error('待补充预览的源版本不匹配。');if((previous.revisions?.length??0)>=10)throw new Error('本次预览修订已达上限，请返回中文原稿继续编辑。');this.cancel(id);const nextId=this.create(sessionId,previous.original,previous.attachments,previous.skills,previous.annotations,previous.annotationRevision);return {id:nextId,previous};}
  async prepareRevision(id:string,previous:DraftPreview,instruction:string,refine:(source:string,signal:AbortSignal)=>Promise<{original:string;translated:string}>):Promise<DraftPreview>{
    const e=this.get(id);if(e.state!=='draft')throw new Error('修订已开始或过期。');e.state='translating';
    try{const result=await refine(e.original,e.abort.signal);e.abort.signal.throwIfAborted();if(this.entries.get(id)!==e)throw new Error('修订已被后续输入取代。');if(!result.original.trim()||!result.translated.trim())throw new Error('修订返回空内容。');e.original=result.original;e.revision=previous.revision+1;e.preview={id,revision:e.revision,original:result.original,translated:skillPrompt(annotationPrompt(result.translated,e.annotations),e.skills),skills:e.skills,annotations:e.annotations,annotationRevision:e.annotationRevision,sourceHash:hashText(result.original+(e.attachments?.length?JSON.stringify(e.attachments):'')+(e.skills?.length?JSON.stringify(e.skills):'')+(e.annotations?.length?JSON.stringify(e.annotations):'')),attachments:e.attachments,demo:false,bypass:false,revisions:[...(previous.revisions??[]),{source:previous.original,instruction}]};e.state='ready';return structuredClone(e.preview);}catch(error){e.state='cancelled';throw error;}
  }
  private get(id:string){const e=this.entries.get(id);if(!e)throw new Error('输入版本不存在或已过期。');return e;}
}
