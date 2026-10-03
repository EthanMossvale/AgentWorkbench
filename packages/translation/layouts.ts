export type TranslationLayoutMode = 'panel'|'inline'|'translated-only';
export interface TranslationLayoutOption { id:string; label:string; mode:TranslationLayoutMode }
export interface TranslationLayoutsApi {
  list():TranslationLayoutOption[];
  subscribe(listener:()=>void):()=>void;
  register(option:TranslationLayoutOption & {id:`plugin:${string}`}):()=>void;
  resolve(id:string|undefined):TranslationLayoutMode;
}
export interface TranslationWorkflowApi { seamless():Promise<unknown> }
export const coreTranslationLayouts:readonly TranslationLayoutOption[] = [
  {id:'panel',label:'右侧对照',mode:'panel'},
  {id:'inline',label:'消息下方',mode:'inline'},
  {id:'translated-only',label:'只显示译文',mode:'translated-only'},
];
export const validTranslationLayoutId=(id:unknown):id is string=>typeof id==='string'&&(coreTranslationLayouts.some(item=>item.id===id)||/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(id));
export class TranslationLayouts implements TranslationLayoutsApi {
  private options=new Map<string,TranslationLayoutOption>();
  private listeners=new Set<()=>void>();
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private changed(){for(const listener of this.listeners)listener();}
  list(){return [...coreTranslationLayouts,...this.options.values()].map(item=>({...item}));}
  register(option:TranslationLayoutOption & {id:`plugin:${string}`}){
    if(!validTranslationLayoutId(option.id)||!option.id.startsWith('plugin:')||!option.label.trim()||option.label.length>80||!coreTranslationLayouts.some(item=>item.mode===option.mode))throw Error('TRANSLATION_LAYOUT_INVALID');
    if(this.options.has(option.id))throw Error('TRANSLATION_LAYOUT_DUPLICATE');
    const entry={...option};this.options.set(entry.id,entry);this.changed();
    return ()=>{if(this.options.get(entry.id)===entry){this.options.delete(entry.id);this.changed();}};
  }
  resolve(id:string|undefined){return this.list().find(item=>item.id===id)?.mode??'panel';}
}
