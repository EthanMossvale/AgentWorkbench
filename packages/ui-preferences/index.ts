/** Device-local presentation preferences. Never store credentials or task bodies. */
export type UiValue = null | boolean | number | string | UiValue[] | { [key: string]: UiValue };
export interface UiPreferenceDefinition {
  id: string;
  type: 'boolean' | 'number' | 'string' | 'string-list' | 'boolean-map' | 'object';
  defaultValue: UiValue;
  min?: number;
  max?: number;
  choices?: readonly string[];
  nullable?: boolean;
}
export interface UiPreferenceEntry { revision: number; value?: UiValue }
export interface UiPreferenceSnapshot { schemaVersion: 1; revision: number; entries: Record<string, UiPreferenceEntry>; error?: string }
export interface UiPreferenceChange { id: string; scope?: string; revision: number; value?: UiValue; reset?: boolean }
export interface UiPreferenceRead { value: UiValue; revision: number; saved: boolean }
export interface UiPreferenceHandle { id: string; dispose(): void }
export interface UiPreferencesApi {
  list(): UiPreferenceDefinition[];
  get(id: string, scope?: string): UiPreferenceRead;
  set(id: string, value: UiValue, revision: number, scope?: string): Promise<UiPreferenceRead>;
  reset(id: string, revision: number, scope?: string): Promise<UiPreferenceRead>;
  register(definition: UiPreferenceDefinition): UiPreferenceHandle;
  override(id: string, resolve: (value: UiValue, scope?: string) => UiValue): UiPreferenceHandle;
  subscribe(listener: () => void): () => void;
}
const boolean = (id: string, value: boolean): UiPreferenceDefinition => ({id,type:'boolean',defaultValue:value});
const number = (id: string, value: number, min: number, max: number): UiPreferenceDefinition => ({id,type:'number',defaultValue:value,min,max});
const text = (id: string, value: string, choices?: readonly string[]): UiPreferenceDefinition => ({id,type:'string',defaultValue:value,choices});
const list = (id: string): UiPreferenceDefinition => ({id,type:'string-list',defaultValue:[]});
export const coreUiPreferences: readonly UiPreferenceDefinition[] = [
  text('composer.follow-up','steer'),boolean('composer.annotations-open',false),
  boolean('visualization.source',false),text('visualization.renderer','core.html'),
  {id:'visualization.state',type:'object',defaultValue:{modelContent:null,privateContent:null}},
  {id:'window.bounds',type:'object',defaultValue:{width:1440,height:940}},
  boolean('window.maximized',false),boolean('window.fullscreen',false),number('window.zoom',0,-3,4),
  number('sidebar.width',240,240,600),boolean('sidebar.compact',false),
  number('workspace.split',53,5,95),number('workspace.reader-width',420,260,2400),
  list('workspace.progress-expanded'),
  {id:'workspace.translation-visible',type:'boolean',defaultValue:null,nullable:true},
  {id:'connections.panes',type:'object',defaultValue:{navigationRatio:.22,navigation:180,details:380}},
  boolean('connections.files',true),{id:'connections.collapsed',type:'boolean-map',defaultValue:{}},
  boolean('connections.mask-address',false),text('connections.tab','accounts',['workspaces','accounts','cli','retention','browser','details']),
  text('navigation.view','workspace',['workspace','settings']),text('navigation.settings','general'),text('navigation.session',''),
  text('reader.diff-view','unified'),boolean('reader.wrap',true),boolean('reader.source-only',false),
  list('files.expanded'),
  text('settings.skills-tab','personal',['personal','official']),text('settings.plugins-tab','workbench',['workbench','runtime']),
  text('settings.native-plugins-tab','installed',['installed','available']),text('settings.memory-tab','codex',['codex','claude','workbench']),
  text('settings.accounts-tab','codex',['codex','claude']),text('settings.remote-provider','codex',['codex','claude']),
  text('settings.retention-provider','codex',['codex','claude']),text('settings.code-language','typescript',['typescript','python','json']),
  text('usage.period','7day',['1day','7day','cycle','month']),boolean('usage.expanded',false),
  list('models.expanded'),list('plugins.expanded'),boolean('disclosure.open',false),
  {id:'image.scale',type:'number',defaultValue:null,nullable:true,min:.01,max:8},
  number('editor.height',260,60,2000),
  boolean('notifications.sound',true),
];
export function preferenceKey(id: string, scope = '') {
  if(!/^(?:[a-z][a-z0-9.-]{0,99}|plugin:[a-z][a-z0-9.-]{1,79}\/[a-z][a-z0-9.-]{0,79})$/.test(id) || typeof scope!=='string')throw Error('UI_PREFERENCE_KEY_INVALID');
  return JSON.stringify([id,scope]);
}
export function assertUiValue(value: unknown, depth = 0): asserts value is UiValue {
  if(value===null || typeof value==='boolean' || typeof value==='string' || typeof value==='number' && Number.isFinite(value))return;
  if(Array.isArray(value)){for(const item of value)assertUiValue(item,depth+1);return;}
  if(value && typeof value==='object' && Object.getPrototypeOf(value)===Object.prototype){
    for(const [key,item] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw Error('UI_PREFERENCE_VALUE_INVALID');assertUiValue(item,depth+1);}return;
  }
  throw Error('UI_PREFERENCE_VALUE_INVALID');
}
export function validatePreference(definition: UiPreferenceDefinition, value: unknown): UiValue {
  assertUiValue(value);
  if(value===null && definition.nullable)return value;
  const valid=definition.type==='boolean'?typeof value==='boolean':definition.type==='number'?typeof value==='number' && value>=(definition.min??-Infinity) && value<=(definition.max??Infinity):definition.type==='string'?typeof value==='string' && (!definition.choices || definition.choices.includes(value)):definition.type==='string-list'?Array.isArray(value) && value.every(v=>typeof v==='string'):definition.type==='boolean-map'?!!value && !Array.isArray(value) && typeof value==='object' && Object.values(value).every(v=>typeof v==='boolean'):!!value && !Array.isArray(value) && typeof value==='object';
  if(!valid)throw Error('UI_PREFERENCE_VALUE_INVALID');
  if(definition.id==='visualization.state'&&Object.keys(value as object).some(key=>!['modelContent','privateContent'].includes(key)))throw Error('VISUALIZATION_STATE_INVALID');
  if(definition.id==='connections.panes'){
    const v=value as Record<string,UiValue>;
    if(typeof v.navigationRatio!=='number'||v.navigationRatio<.01||v.navigationRatio>.95||typeof v.navigation!=='number'||v.navigation<140||v.navigation>2000||typeof v.details!=='number'||v.details<300||v.details>3000)throw Error('UI_PREFERENCE_VALUE_INVALID');
  }
  if(definition.id==='window.bounds'){
    const v=value as Record<string,UiValue>;
    if(typeof v.width!=='number'||typeof v.height!=='number'||v.width<200||v.height<200||v.width>32768||v.height>32768||['x','y'].some(k=>v[k]!==undefined&&(typeof v[k]!=='number'||Math.abs(v[k] as number)>100000)))throw Error('UI_PREFERENCE_VALUE_INVALID');
  }
  return structuredClone(value);
}
export class UiPreferenceRegistry {
  private definitions = new Map(coreUiPreferences.map(d=>[d.id,d]));
  private layers = new Map<string, {owner:string;resolve:(value:UiValue,scope?:string)=>UiValue}[]>();
  private listeners = new Set<()=>void>();
  subscribe = (listener:()=>void) => {this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  changed() {for(const listener of this.listeners)try{listener();}catch{/* A subscriber cannot orphan a registration before its cleanup handle is returned. */}}
  list() {return [...this.definitions.values()].map(d=>structuredClone(d));}
  definition(id:string) {const definition=this.definitions.get(id);if(!definition)throw Error('UI_PREFERENCE_UNREGISTERED');return definition;}
  validate(id:string,value:unknown) {return validatePreference(this.definition(id),value);}
  resolve(id:string,value:UiValue|undefined,scope?:string) {
    const definition=this.definition(id);let result=structuredClone(definition.defaultValue);
    if(value!==undefined)try{result=this.validate(id,value);}catch{/* Retain an incompatible saved value for its original implementation. */}
    for(const layer of this.layers.get(id)??[])try{result=this.validate(id,layer.resolve(structuredClone(result),scope));}catch{/* A failed extension cannot invalidate core preferences. */}
    return result;
  }
  register(owner:string,definition:UiPreferenceDefinition):UiPreferenceHandle {
    const id=`plugin:${owner}/${definition?.id}`;preferenceKey(id);
    if(this.definitions.has(id))throw Error('UI_PREFERENCE_DUPLICATE');
    if(!['boolean','number','string','string-list','boolean-map','object'].includes(definition?.type))throw Error('UI_PREFERENCE_DEFINITION_INVALID');
    if([definition.min,definition.max].some(v=>v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)))||(definition.min??-Infinity)>(definition.max??Infinity)||definition.choices!==undefined&&(!Array.isArray(definition.choices)||definition.choices.length>100||definition.choices.some(v=>typeof v!=='string'||v.length>200)))throw Error('UI_PREFERENCE_DEFINITION_INVALID');
    const next=structuredClone({...definition,id});validatePreference(next,next.defaultValue);this.definitions.set(id,next);this.changed();
    let live=true;return {id,dispose:()=>{if(!live)return;live=false;this.definitions.delete(id);this.changed();}};
  }
  override(owner:string,id:string,resolve:(value:UiValue,scope?:string)=>UiValue):UiPreferenceHandle {
    this.definition(id);if(typeof resolve!=='function')throw Error('UI_PREFERENCE_DEFINITION_INVALID');
    const layer={owner,resolve},layers=this.layers.get(id)??[];layers.push(layer);this.layers.set(id,layers);this.changed();
    let live=true;return {id,dispose:()=>{if(!live)return;live=false;const index=layers.indexOf(layer);if(index>=0)layers.splice(index,1);this.changed();}};
  }
}
