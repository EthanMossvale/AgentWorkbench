import type { NativeEvent, TranslationResult } from '../contracts/index';
import { hashText } from './protection';
export class OverlayStore {
  private sources=new Map<string,{event:NativeEvent;hash:string}>();
  private overlays=new Map<string,TranslationResult>();
  ingest(event:NativeEvent){const key=event.sessionId+':'+event.id;const old=this.sources.get(key);
    if(old && event.revision<=old.event.revision)return false;
    this.sources.set(key,{event:structuredClone(event),hash:hashText(event.text)});this.overlays.delete(key);return true;
  }
  async translate(sessionId:string,id:string,translator:(text:string)=>Promise<TranslationResult>){
    const key=sessionId+':'+id;const source=this.sources.get(key);
    if(!source||!source.event.public||!['progress','final'].includes(source.event.type))throw new Error('该原生事件不属于可翻译的公开文本。');
    const result=await translator(source.event.text);
    if(this.sources.get(key)!==source||result.sourceHash!==source.hash)return false;
    this.overlays.set(key,structuredClone(result));return true;
  }
  get(sessionId:string,id:string){const key=sessionId+':'+id;return structuredClone({source:this.sources.get(key)?.event,translation:this.overlays.get(key)});}
}
