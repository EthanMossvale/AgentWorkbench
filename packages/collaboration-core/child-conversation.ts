import type { NativeFrame } from '../../services/remote-supervisor';
import type { NativeChildSnapshot } from './activity';
import type { NativeChildEvent } from './events';
import { clearTranslation, type MessageTranslation } from '../translation/display';
import { nativeEventSemantics } from '../native-events/semantics';

/** Track admitted native children independently of bounded display history. */
export class NativeChildLifecycle {
  private children=new Map<string,NativeChildEvent>();
  private background:ReturnType<typeof nativeEventSemantics.background>;
  private idle=false;
  observeFrame(frame:NativeFrame){
    const snapshot=nativeEventSemantics.background(frame.value);if(snapshot)this.background=snapshot;
    if(frame.value.type==='system'&&frame.value.subtype==='session_state_changed')this.idle=frame.value.state==='idle';
  }
  observe(event:NativeChildEvent){
    if(event.toolCallId)for(const [id,child] of this.children)if(id.startsWith('parent-tool-use:')&&child.toolCallId===event.toolCallId&&id!==event.nativeChildId)this.children.delete(id);
    const previous=this.children.get(event.nativeChildId);
    if(previous&&['completed','failed','closed'].includes(previous.operation)&&event.operation==='progress')return;
    this.children.set(event.nativeChildId,event);
  }
  get pending(){
    if(this.background?.some(task=>!task.ambient))return true;
    // Empty snapshots can precede task_notification. Drain only at native idle,
    // or when every admitted child has supplied an explicit terminal edge.
    if(this.background&&this.idle)return false;
    return [...this.children.values()].some(child=>['spawn','progress'].includes(child.operation)&&child.status!=='uncertain');
  }
}

export interface NativeChildMessage extends MessageTranslation { id:string; role:'user'|'assistant'; text:string; at:string; updatedAt:string; complete:boolean; truncated?:boolean; order?:number }
const object=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const plain=(content:unknown):string=>typeof content==='string'?content:Array.isArray(content)?content.filter(part=>['text','input_text','output_text'].includes(part?.type)&&typeof part.text==='string').map(part=>part.text).join('\n'):'';
/** Only public message text enters the child viewer; opaque reasoning and signatures never do. */
export class NativeChildConversationTracker {
  private streams=new Map<string,string>();
  observe(runtime:'codex'|'claude',id:string,frame:NativeFrame):({id:string;role:'user'|'assistant';text:string;append:boolean;complete:boolean})|undefined {
    const value=object(frame.value),p=object(value.params),item=object(p.item);
    if(runtime==='codex'){
      if(value.method==='item/agentMessage/delta'&&typeof p.itemId==='string'&&typeof p.delta==='string')return {id:p.itemId,role:'assistant',text:p.delta,append:true,complete:false};
      if(['item/started','item/completed'].includes(value.method)&&typeof item.id==='string'){
        if(item.type==='agentMessage'&&typeof item.text==='string')return {id:item.id,role:'assistant',text:item.text,append:false,complete:value.method==='item/completed'};
        if(item.type==='userMessage')return {id:item.id,role:'user',text:plain(item.content),append:false,complete:true};
      }
      return;
    }
    const event=object(value.event),message=object(value.message);
    if(value.type==='system'&&value.subtype==='task_notification'&&typeof value.summary==='string')return {id:id+':result',role:'assistant',text:value.summary,append:false,complete:true};
    if(value.type==='stream_event'){
      if(event.type==='message_start'&&typeof event.message?.id==='string')this.streams.set(id,event.message.id);
      const messageId=this.streams.get(id);
      if(messageId&&event.type==='content_block_delta'&&event.delta?.type==='text_delta'&&typeof event.delta.text==='string')return {id:messageId,role:'assistant',text:event.delta.text,append:true,complete:false};
    }
    if(['assistant','user'].includes(value.type)&&typeof (message.id??value.uuid)==='string')return {id:message.id??value.uuid,role:value.type,text:plain(message.content),append:false,complete:true};
  }
}

export function recordChildMessage(child:NativeChildSnapshot,update:NonNullable<ReturnType<NativeChildConversationTracker['observe']>>,frame:NativeFrame){
  if(!update.text)return;
  const messages=child.messages??=[];let message=messages.find(message=>message.id===update.id);
  if(message?.complete&&update.append)return;
  if(!message){message={id:update.id,role:update.role,text:'',at:frame.receivedAt,updatedAt:frame.receivedAt,complete:false,order:frame.sequence};messages.push(message);}
  if(message.updatedAt>frame.receivedAt)return;
  const text=update.append?message.text+update.text:update.text;if(message.text!==text.slice(0,65536))clearTranslation(message);message.text=text.slice(0,65536);message.truncated=text.length>65536||update.append&&message.truncated;message.updatedAt=frame.receivedAt;message.complete=update.complete;
  let size=messages.reduce((total,item)=>total+item.text.length,0);
  while(messages.length>200||size>1024*1024){size-=messages.shift()!.text.length;child.transcriptTruncated=true;}
}
