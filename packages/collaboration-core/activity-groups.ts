import type { RuntimeActivity } from './activity';

export interface ActivityGroupingEntry { id:string; activity?:RuntimeActivity }
export interface ActivityChat { label:string; targetSessionId?:string }
export interface ActivityChatRule { id:string; present(activity:Readonly<RuntimeActivity>):ActivityChat|undefined }
export interface ActivityGroupingRule { id:string; classify(activity:Readonly<RuntimeActivity>):{key:string;label:string}|undefined }
export interface ActivityGroup<T extends ActivityGroupingEntry=ActivityGroupingEntry> { id:string; items:T[]; label:string; diagnostic:boolean; attention:number }
export interface ActivityGroupingApi {
  chat(activity:Readonly<RuntimeActivity>):ActivityChat|undefined;
  registerChat(rule:ActivityChatRule):{id:string;dispose():void};
  group<T extends ActivityGroupingEntry>(entries:readonly T[]):ActivityGroup<T>[];
  register(rule:ActivityGroupingRule):{id:string;dispose():void};
  subscribe(listener:()=>void):()=>void;
}
const diagnostic=(a:RuntimeActivity)=>!!a.protocol||a.presentation==='diagnostic';
// Lifecycle changes must update an existing batch, never move its records to a new parent.
const eligible=(a:RuntimeActivity)=>!a.protocol&&!a.presentation&&!a.imageDelivery&&(!a.category||['read','search'].includes(a.category))&&a.kind!=='message';
const needsAttention=(a:RuntimeActivity)=>['failed','cancelled','uncertain'].includes(a.status);
const action=(a:RuntimeActivity)=>a.category==='read'?'read':a.category==='search'?'search':a.kind;
const chatLabels:Record<string,[string,string,string]>={workbench_create_session:['正在创建聊天','已创建聊天','创建聊天'],workbench_list_sessions:['正在列出聊天','已列出聊天','列出聊天'],workbench_read_session:['正在查看聊天','已查看聊天','查看聊天'],workbench_send_message:['正在向聊天发送消息','消息已送入聊天收件箱','向聊天发送消息'],workbench_read_messages:['正在读取聊天消息','已读取聊天消息','读取聊天消息'],workbench_wait_messages:['正在等待聊天消息','聊天消息等待已结束','等待聊天消息']};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const parse=(value?:string)=>{try{return object(JSON.parse(value??''));}catch{return {};}};
const identifier=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value)?value:undefined;
function coreChat(a:Readonly<RuntimeActivity>):ActivityChat|undefined{
  const name=(a.toolName??'').split('__').at(-1)!,labels=chatLabels[name];if(!labels)return;
  const input=parse(a.input),output=parse(a.output);
  const target=name==='workbench_read_session'?input.sessionId:name==='workbench_send_message'?input.targetSessionId:name==='workbench_create_session'?output.sessionId:undefined;
  return {label:labels[a.status==='running'?0:a.status==='completed'?1:2],targetSessionId:identifier(target)};
}
function liveLabel(a:RuntimeActivity){
  const verb={command:'正在运行','file-edit':'正在编辑',read:'正在读取',search:'正在搜索',tool:'正在调用',message:'正在协作'}[action(a)];
  const title=(a.title??a.toolName??'').replace(/\s+/g,' ').trim().slice(0,300);
  return title?`${verb} ${title}`:verb+({command:'命令','file-edit':'文件',read:'内容',search:'内容',tool:'工具',message:''}[action(a)]);
}
function batchLabel(items:RuntimeActivity[]){
  const parts:string[]=[];
  const commands=items.filter(a=>action(a)==='command');
  const reads=items.filter(a=>action(a)==='read');
  const searches=items.filter(a=>action(a)==='search');
  const edits=items.filter(a=>action(a)==='file-edit');
  const tools=items.filter(a=>action(a)==='tool').length;
  if(commands.length)parts.push(commands.every(a=>a.status==='completed')?`运行了 ${commands.length} 个命令`:`尝试运行 ${commands.length} 个命令`);
  if(reads.length)parts.push(reads.every(a=>a.status==='completed')?`读取了 ${reads.length} 项内容`:`尝试读取 ${reads.length} 次`);
  if(searches.length)parts.push(searches.every(a=>a.status==='completed')?`搜索了 ${searches.length} 次`:`尝试搜索 ${searches.length} 次`);
  if(edits.length)parts.push(edits.some(a=>a.status==='completed')?'编辑了文件':'尝试编辑文件');
  if(tools)parts.push(`调用了 ${tools} 次工具`);
  return parts.length>1?parts.slice(0,-1).join('、')+'并'+parts.at(-1):parts[0]??'运行记录';
}
const isThinking=(a?:RuntimeActivity)=>!!a&&a.category==='reasoning'&&!diagnostic(a);
/**
 * Thinking between two pieces of visible output (a reply, user message or other
 * non-activity entry) is one segment shown as a single row at the position of its
 * first thinking record: "thinking" while any of it runs, otherwise the latest
 * state. The first item is that merged row; every original record stays in items.
 */
function thinkingSegments<T extends ActivityGroupingEntry>(entries:readonly T[]){
  const segments=new Map<T,{first:T;items:T[]}>();let current:T[]=[];
  const close=()=>{
    if(!current.length)return;
    const activities=current.map(entry=>entry.activity!),first=current[0]!,base=first.activity!;
    const status=activities.some(a=>a.status==='running')?'running':activities.at(-1)!.status;
    const updatedAt=activities.map(a=>a.updatedAt).sort().at(-1)??base.updatedAt;
    const row=status===base.status&&updatedAt===base.updatedAt?first:{...first,activity:{...base,status,updatedAt}};
    const segment={first,items:[row,...current.slice(1)]};
    for(const entry of current)segments.set(entry,segment);
    current=[];
  };
  for(const entry of entries){
    if(!entry.activity){close();continue;}
    if(isThinking(entry.activity))current.push(entry);
  }
  close();
  return segments;
}
/** Presentation only: no entry is removed, and boundaries never cross non-tool content. */
export class ActivityGroupingRegistry {
  private chatRules=new Map<string,ActivityChatRule>();
  chat=(activity:Readonly<RuntimeActivity>):ActivityChat|undefined=>{
    for(const rule of [...this.chatRules.values()].reverse())try{
      const value=rule.present(Object.freeze(structuredClone(activity)));
      if(value&&typeof value==='object'&&'then' in value){void Promise.resolve(value).catch(()=>{});continue;}
      if(value&&typeof value.label==='string'&&value.label.trim()&&value.label.length<=100&&(value.targetSessionId===undefined||identifier(value.targetSessionId)))return {...value};
    }catch{/* Invalid extensions fall back without losing records. */}
    return coreChat(activity);
  };
  registerChat(owner:string,rule:ActivityChatRule){
    if(!rule||!/^[a-z][a-z0-9.-]{0,79}$/.test(rule.id)||typeof rule.present!=='function')throw Error('ACTIVITY_CHAT_RULE_INVALID');
    const id=owner+'/'+rule.id;if(this.chatRules.has(id))throw Error('ACTIVITY_CHAT_RULE_DUPLICATE');
    this.chatRules.set(id,{...rule});this.changed();return {id,dispose:()=>{if(this.chatRules.delete(id))this.changed();}};
  }
  private rules=new Map<string,ActivityGroupingRule>();
  private listeners=new Set<()=>void>();
  private revision=0;
  getRevision=()=>this.revision;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private changed(){this.revision++;for(const listener of this.listeners)try{listener();}catch{/* Isolate presentation listeners. */}}
  register(owner:string,rule:ActivityGroupingRule){
    if(!rule||!/^[a-z][a-z0-9.-]{0,79}$/.test(rule.id)||typeof rule.classify!=='function')throw Error('ACTIVITY_GROUP_RULE_INVALID');
    const id=owner+'/'+rule.id;if(this.rules.has(id))throw Error('ACTIVITY_GROUP_RULE_DUPLICATE');
    this.rules.set(id,{...rule});this.changed();
    return {id,dispose:()=>{if(this.rules.delete(id))this.changed();}};
  }
  private classify(activity:RuntimeActivity){
    for(const [id,rule]of [...this.rules].reverse())try{
      const result=rule.classify(Object.freeze(structuredClone(activity)));
      if(result&&typeof result==='object'&&'then'in result){void Promise.resolve(result).catch(()=>{});continue;}
      if(result&&typeof result.key==='string'&&result.key.length>0&&result.key.length<=100&&typeof result.label==='string'&&result.label.trim()&&result.label.length<=100)return {key:id+':'+result.key,label:result.label};
    }catch{/* A failed extension cannot lose or conceal native records. */}
    return {key:'work',label:''};
  }
  group=<T extends ActivityGroupingEntry>(entries:readonly T[]):ActivityGroup<T>[]=>{
    const output:ActivityGroup<T>[]=[],metadata:ActivityGroup<T>={id:'diagnostics',items:[],label:'运行记录',diagnostic:true,attention:0};
    for(const entry of entries)if(entry.activity&&diagnostic(entry.activity)){
      if(!metadata.items.length)metadata.id='diagnostics:'+entry.id;
      metadata.items.push(entry);if(needsAttention(entry.activity))metadata.attention++;
    }
    if(metadata.items.length)output.push(metadata);
    const thinking=thinkingSegments(entries);
    let previousKey:string|undefined;
    for(const entry of entries){
      const a=entry.activity;
      if(a&&diagnostic(a))continue;
      // Later thinking in a segment is shown by the segment's first thinking row.
      const segment=thinking.get(entry);
      if(segment&&segment.first!==entry)continue;
      if(segment){output.push({id:entry.id,items:segment.items,label:'',diagnostic:false,attention:0});previousKey=undefined;continue;}
      const chat=a&&this.chat(a);
      const info=chat?{key:'chat',label:''}:a&&eligible(a)?this.classify(a):undefined;
      const key=info&&JSON.stringify([a!.runtime,a!.nativeChildId??'',a!.turnId??'',info.key]);
      const last=output.at(-1);
      if(key&&key===previousKey&&last&&!last.diagnostic){last.items.push(entry);}
      else output.push({id:entry.id,items:[entry],label:info?.label??'',diagnostic:false,attention:0});
      previousKey=key;
    }
    for(const group of output){
      if(!group.diagnostic&&group.items[0]?.activity&&this.chat(group.items[0].activity)){group.attention=group.items.filter(item=>item.activity&&needsAttention(item.activity)).length;group.label=group.items.length>1?`${group.items.length} 次聊天交互`:'';continue;}
      if(group.diagnostic||!group.items[0]?.activity||!eligible(group.items[0].activity))continue;
      const activities=group.items.map(item=>item.activity!);
      const live=activities.findLast(a=>a.status==='running');
      group.attention=activities.filter(needsAttention).length;
      group.label=group.label?(live?`${group.label} · ${liveLabel(live)}`:group.label):live?liveLabel(live):batchLabel(activities);
    }
    return output;
  };
}
export const activityGrouping=new ActivityGroupingRegistry();
