export type PluginFontId = `plugin:${string}/${string}`;
export interface FontPresetDefinition { id:string; label:string; family:string; fallback?:'system'|'serif'|'mono' }
export interface FontPreset { id:PluginFontId; owner:string; label:string; family:string; fallback:'system'|'serif'|'mono' }
export interface FontPresetHandle { id:PluginFontId; dispose():void }
export interface FontPluginApi {
  register(definition:FontPresetDefinition):FontPresetHandle;
  list():readonly FontPreset[];
  subscribe(listener:()=>void):()=>void;
}
export const validFontFamily = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && value.trim() === value && !/[\x00-\x1f\x7f<>;{}\\"']/u.test(value);
export const validPluginFontId=(value:unknown):value is PluginFontId=>typeof value==='string'&&value.length<=180&&/^plugin:[a-z][a-z\d.-]{0,79}\/[a-z][a-z\d-]{0,63}$/.test(value);

/** Choice metadata only. Font bytes remain owned by installed resources or plugin assets. */
export class FontPresetRegistry {
  private entries:readonly FontPreset[]=Object.freeze([]);
  private listeners=new Set<()=>void>();
  getSnapshot=()=>this.entries;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  resolve=(id:string)=>this.entries.find(entry=>entry.id===id);
  private publish(entries:FontPreset[]){this.entries=Object.freeze(entries);for(const listener of [...this.listeners])listener();}
  register(owner:string,input:FontPresetDefinition):FontPresetHandle {
    if(!/^[a-z][a-z\d.-]{0,79}$/.test(owner)||!input||Array.isArray(input)||typeof input.id!=='string'||!/^[a-z][a-z\d-]{0,63}$/.test(input.id)||typeof input.label!=='string'||!input.label.trim()||input.label.length>80||!validFontFamily(input.family)||input.fallback!==undefined&&!['system','serif','mono'].includes(input.fallback)||Object.keys(input).some(key=>!['id','label','family','fallback'].includes(key)))throw Error('APPEARANCE_FONT_INVALID');
    const id:PluginFontId=`plugin:${owner}/${input.id}`;
    if(this.resolve(id))throw Error('APPEARANCE_FONT_DUPLICATE');
    if(this.entries.filter(entry=>entry.owner===owner).length>=64)throw Error('APPEARANCE_FONT_LIMIT');
    const entry:FontPreset=Object.freeze({id,owner,label:input.label.trim(),family:input.family,fallback:input.fallback??'system'});
    this.publish([...this.entries,entry]);let live=true;
    return {id,dispose:()=>{if(!live)return;live=false;this.publish(this.entries.filter(item=>item!==entry));}};
  }
}
export const fontPresets=new FontPresetRegistry();
