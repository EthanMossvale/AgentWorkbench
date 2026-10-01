import {validateAnnotations,type AnnotationDraft,type ContextAnnotation} from '../../../packages/context-annotations';

export interface AnnotationSelection { text: string; source: NonNullable<ContextAnnotation['source']> }
export interface AnnotationTarget extends AnnotationDraft { sessionId: string; busy: boolean }
export interface AnnotationAction { id: string; label: string; run(selection: AnnotationSelection, signal: AbortSignal): string | Promise<string> }
export interface AnnotationHandle { id: string; dispose(): void }
export interface AnnotationsApi {
  get(): AnnotationTarget | null;
  add(selection: AnnotationSelection): Promise<AnnotationDraft>;
  update(id: string, text: string): Promise<AnnotationDraft>;
  remove(id: string): Promise<AnnotationDraft>;
  clear(): Promise<AnnotationDraft>;
  translate(): Promise<AnnotationDraft>;
  subscribe(listener: () => void): () => void;
  listActions(): {id: string; label: string}[];
  registerAction(action: AnnotationAction): AnnotationHandle;
  overrideAction(id: string, action: Omit<AnnotationAction,'id'>): AnnotationHandle;
}
interface Target { get(): AnnotationTarget; write(items:ContextAnnotation[]):Promise<AnnotationDraft>; translate?():Promise<AnnotationDraft> }
export class AnnotationController {
  private target?:Target;
  private listeners=new Set<()=>void>();
  private actions=new Map<string,{action:AnnotationAction;abort:AbortController}[]>([['core.add',[{action:{id:'core.add',label:'添加到对话',run:selection=>selection.text},abort:new AbortController()}]]]);
  private version=0;
  getVersion=()=>this.version;
  changed=()=>{this.version++;for(const listener of this.listeners)try{listener();}catch{/* A subscriber cannot interrupt cleanup. */}};
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  bind(target:Target){this.target=target;this.changed();return()=>{if(this.target===target){this.target=undefined;this.changed();}};}
  get=():AnnotationTarget|null=>this.target?structuredClone(this.target.get()):null;
  private current(){if(!this.target)throw Error('ANNOTATION_UNAVAILABLE');if(this.target.get().busy)throw Error('ANNOTATION_BUSY');return this.target;}
  private write(target:Target,items:ContextAnnotation[]){if(target!==this.target)throw Error('ANNOTATION_TARGET_CHANGED');return target.write(validateAnnotations(items));}
  add=(selection:AnnotationSelection)=>{const target=this.current();return this.write(target,[...target.get().items,{id:crypto.randomUUID(),text:selection.text,source:selection.source}]);};
  update=(id:string,text:string)=>{const target=this.current(),items=target.get().items;if(!items.some(item=>item.id===id))throw Error('ANNOTATION_MISSING');return this.write(target,items.map(item=>item.id===id?{id:item.id,text,source:item.source}:item));};
  remove=(id:string)=>{const target=this.current();return this.write(target,target.get().items.filter(item=>item.id!==id));};
  clear=()=>{const target=this.current();return this.write(target,[]);};
  translate=()=>{const target=this.current();if(!target.translate)throw Error('ANNOTATION_TRANSLATION_UNAVAILABLE');return target.translate();};
  listActions=()=>[...this.actions].flatMap(([id,layers])=>layers.length?[{id,label:layers.at(-1)!.action.label}]:[]);
  registerAction(owner:string,definition:AnnotationAction){return this.layer(`plugin:${owner}/${definition.id}`,definition,false);}
  overrideAction(id:string,definition:Omit<AnnotationAction,'id'>){return this.layer(id,{...definition,id},true);}
  private layer(id:string,definition:AnnotationAction,override:boolean):AnnotationHandle {
    if(!/^plugin:[a-z][a-z0-9.-]{1,79}\/[a-z][a-z0-9.-]{0,79}$/.test(id)&&!(override&&id==='core.add')||!definition.label?.trim()||definition.label.length>60||typeof definition.run!=='function')throw Error('ANNOTATION_ACTION_INVALID');
    const layers=this.actions.get(id)??[];
    if(override?!layers.length:!!layers.length)throw Error('ANNOTATION_ACTION_CONFLICT');
    const layer={action:{...definition,id},abort:new AbortController()};layers.push(layer);this.actions.set(id,layers);this.changed();
    return {id,dispose:()=>{layer.abort.abort();const index=layers.indexOf(layer);if(index>=0){layers.splice(index,1);if(!layers.length)this.actions.delete(id);this.changed();}}};
  }
  async invoke(id:string,selection:AnnotationSelection){
    const target=this.current(),sessionId=target.get().sessionId,layer=this.actions.get(id)?.at(-1);
    if(!layer)throw Error('ANNOTATION_ACTION_MISSING');
    const result=await layer.action.run(structuredClone(selection),layer.abort.signal);
    if(layer.abort.signal.aborted||this.actions.get(id)?.at(-1)!==layer)throw Error('ANNOTATION_ACTION_CANCELLED');
    if(target!==this.current()||target.get().sessionId!==sessionId)throw Error('ANNOTATION_TARGET_CHANGED');
    return this.write(target,[...target.get().items,{id:crypto.randomUUID(),text:result,source:selection.source}]);
  }
}
export const annotationController=new AnnotationController();
export function annotationError(error:unknown){const code=error instanceof Error?error.message:String(error);return ({ANNOTATION_LIMIT:'最多添加 20 条注释，每条不超过 16,000 字，总计不超过 64,000 字。',ANNOTATION_INVALID:'注释不能为空，请检查所选文本。',ANNOTATION_CONFLICT:'注释已在其他位置更新，请检查后重试。',ANNOTATION_BUSY:'注释正在保存或发送，请稍后再试。',ANNOTATION_TARGET_CHANGED:'会话已切换，未添加注释。',ANNOTATION_ACTION_CANCELLED:'注释操作已取消，原稿未改变。'} as Record<string,string>)[code]??code;}
