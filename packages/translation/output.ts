import type {Protocol} from '../contracts';
export interface TranslationOutput {text:string;incomplete?:boolean}
export interface TranslationOutputReader {id:`plugin:${string}`;read(data:Record<string,unknown>,protocol:Protocol):TranslationOutput|undefined}
const object=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export class TranslationOutputs {
 private readers=new Map<string,TranslationOutputReader>();
 register(reader:TranslationOutputReader):()=>void{if(this.readers.has(reader.id))throw Error('TRANSLATION_OUTPUT_READER_DUPLICATE');const entry={...reader};this.readers.set(entry.id,entry);return()=>{if(this.readers.get(entry.id)===entry)this.readers.delete(entry.id);};}
 read(data:Record<string,unknown>,protocol:Protocol):TranslationOutput{
  for(const reader of [...this.readers.values()].reverse()){const result=reader.read(data,protocol);if(result!==undefined)return result;}
  let text='',incomplete=false;
  if(protocol==='responses'){
   incomplete=data.status!=='completed'||!!data.error||!!data.incomplete_details;
   for(const item of Array.isArray(data.output)?data.output:[]){
    if(!object(item)){incomplete=true;continue;}if(item.type==='reasoning')continue;
    if(item.type!=='message'||!Array.isArray(item.content)){incomplete=true;continue;}
    if(item.status&&item.status!=='completed')incomplete=true;
    for(const part of item.content){if(object(part)&&part.type==='output_text'&&typeof part.text==='string')text+=part.text;else incomplete=true;}
   }
   if(!text&&typeof data.output_text==='string')text=data.output_text;
  }else if(protocol==='anthropic-messages'){
   incomplete=!['end_turn','stop_sequence'].includes(String(data.stop_reason));
   for(const part of Array.isArray(data.content)?data.content:[]){if(object(part)&&part.type==='text'&&typeof part.text==='string')text+=part.text;else if(!object(part)||!['thinking','redacted_thinking'].includes(part.type))incomplete=true;}
  }else{
   const choice=Array.isArray(data.choices)?data.choices[0]:undefined,message=object(choice)&&object(choice.message)?choice.message:{};
   text=typeof message.content==='string'?message.content:'';incomplete=choice?.finish_reason!=='stop'||!!message.refusal||!!message.function_call||!!message.tool_calls?.length;
  }
  if(!text.trim())throw Error('上游未返回可用的翻译文本；原稿已保留。');
  return {text,...(incomplete?{incomplete:true}:{})};
 }
}
