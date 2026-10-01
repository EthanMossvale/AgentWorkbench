export type ThemeMode = 'light' | 'dark';
export type ThemePresetId = `builtin.${string}` | `plugin:${string}/${string}`;
export interface ThemeColors { bg:string; side:string; surface:string; raised:string; text:string; muted:string; line:string; hover:string; tint:string; accent:string; danger:string; warning:string; selection:string }
export interface SyntaxColors { background:string; foreground:string; keyword:string; string:string; number:string; comment:string; function:string; type:string; punctuation:string }
export interface ThemePreset { id:ThemePresetId; label:string; description:string; mode:ThemeMode; owner?:string; colors:Readonly<ThemeColors>; syntax:Readonly<SyntaxColors> }
export interface ThemePresetDefinition { id:string; label:string; description?:string; mode:ThemeMode; base?:ThemePresetId; colors?:Partial<ThemeColors>; syntax?:Partial<SyntaxColors> }
export interface ThemePresetHandle { id:ThemePresetId; dispose():void }
export interface ThemePluginApi { register(definition:ThemePresetDefinition):ThemePresetHandle; list():readonly ThemePreset[]; subscribe(listener:()=>void):()=>void }
const colorKeys=['bg','side','surface','raised','text','muted','line','hover','tint','accent','danger','warning','selection'] as const;
const syntaxKeys=['background','foreground','keyword','string','number','comment','function','type','punctuation'] as const;
const hex=/^#[a-f\d]{6}$/i;
export const validPresetId=(value:unknown):value is ThemePresetId=>typeof value==='string'&&value.length<=180&&/^(?:builtin\.[a-z][a-z\d-]*|plugin:[a-z][a-z\d.-]*\/[a-z][a-z\d-]*)$/.test(value);
export function contrastRatio(a:string,b:string){
  const luminance=(color:string)=>{const c=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]!*.2126+c[1]!*.7152+c[2]!*.0722;};
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export const accentInk=(color:string)=>contrastRatio(color,'#161616')>=contrastRatio(color,'#ffffff')?'#161616':'#ffffff';
function preset(id:string,label:string,description:string,mode:ThemeMode,values:string[],syntax:string[]):ThemePreset {
  const colors=Object.fromEntries(colorKeys.map((key,i)=>[key,values[i]!])) as unknown as ThemeColors;
  const code=Object.fromEntries(syntaxKeys.map((key,i)=>[key,syntax[i]!])) as unknown as SyntaxColors;
  return Object.freeze({id:`builtin.${id}` as ThemePresetId,label,description,mode,colors:Object.freeze(colors),syntax:Object.freeze(code)});
}
/** Original palettes: calm reading surfaces, distinct accents and coordinated code colors. */
export const builtinThemes:readonly ThemePreset[]=Object.freeze([
  preset('paper','晨纸','暖纸白 · 陶土红','light',['#faf9f6','#efede8','#ffffff','#fffdf9','#302e2b','#6c665f','#e3dfd8','#ebe7e0','#f3eae2','#98543d','#a23e32','#866019','#ead5c7'],['#f3f0ea','#302e2b','#7e4191','#33613e','#9b482c','#70685f','#285f85','#806119','#605c56']),
  preset('porcelain','瓷白','清冷白 · 石墨蓝','light',['#fafafa','#f0f0f0','#ffffff','#ffffff','#292929','#666970','#dddddd','#eaeaea','#e9edf4','#3f5e88','#a83c48','#836015','#d9e3f2'],['#f1f3f5','#292d35','#75459b','#386344','#94511e','#636c78','#295f8f','#695088','#5e6470']),
  preset('sea','海盐','雾蓝白 · 海湾青','light',['#f3f8fa','#e5eef2','#ffffff','#f9fcfd','#20343f','#566d7b','#d4e1e8','#dfebf0','#e0eff2','#1b6977','#a13c45','#86601d','#c9e5ed'],['#eaf2f6','#20343f','#675095','#2e6655','#97502d','#586d7c','#196480','#825626','#506b78']),
  preset('garden','青苔','淡鼠尾草 · 森林绿','light',['#f5f8f2','#e9eee2','#ffffff','#fafcf7','#29362b','#616f59','#dce3d4','#e3eadb','#e5eddf','#476539','#a14638','#80601b','#d6e3c9'],['#edf2e7','#29362b','#795086','#3f663c','#945029','#65705b','#306276','#795b28','#5d6a55']),
  preset('lilac','鸢尾','淡紫雾 · 灰莓紫','light',['#f9f6fb','#eee8f2','#ffffff','#fdfaff','#362e3e','#726579','#e3dbe9','#e9e1ef','#eee4f2','#775187','#ab4057','#876020','#e4d6ed'],['#f1ebf5','#362e3e','#78428d','#406345','#a04e4a','#706177','#385f91','#856022','#695a73']),
  preset('linen','麦芽','亚麻米 · 琥珀棕','light',['#fcf7ef','#f1e7d7','#fffdf8','#fffaf2','#3c3022','#76674f','#e7dbc7','#eee2ce','#f4e7cf','#8b5b25','#a34133','#7e611e','#ead7b5'],['#f5ecdd','#3c3022','#805174','#4c653b','#a04c2b','#75664e','#38617b','#846023','#705f45']),
  preset('charcoal','炭墨','暖炭灰 · 赤陶光','dark',['#242424','#1e1e1e','#2c2b2a','#333130','#ece8e2','#aaa49e','#45413e','#353230','#3b302b','#d6a085','#e0a497','#ccaf7e','#604a3e'],['#282625','#ece8e2','#cba6e2','#a8c59a','#e8b48b','#a59d94','#91bed5','#d7c28c','#b8afa5']),
  preset('graphite','石墨','中性灰 · 冰川蓝','dark',['#242424','#1e1e1e','#2c2c2c','#303030','#ededed','#aaaaaa','#454545','#383838','#333333','#9ab8e5','#efa4ad','#d4b77d','#405477'],['#27292e','#e7eaf0','#c4a9ee','#a4cba1','#e0b38a','#a1a8b6','#95c7ef','#dbc08c','#afb8c8']),
  preset('abyss','深海','午夜蓝 · 潮汐青','dark',['#17242e','#121d26','#1d2d38','#243644','#dfeaf1','#97afbd','#344c5b','#283f4e','#203d4b','#83c6d1','#e4a0a3','#d8bd82','#315869'],['#182832','#dfeaf1','#baa9e8','#9bc8af','#e6b48c','#91aab8','#82cbdc','#d8c486','#a1b8c7']),
  preset('pine','松夜','深松绿 · 苔藓金','dark',['#1c2822','#162019','#233129','#2b3a30','#e0e9df','#a0b19e','#394d3d','#2f4335','#324634','#b3cb94','#e6a297','#d8bd82','#45613f'],['#202e25','#e0e9df','#c6b0d5','#b0cb91','#e6b38c','#9eaf98','#96c6c5','#dcc38a','#aec0a5']),
  preset('dusk','暮紫','墨紫灰 · 薰衣草','dark',['#292230','#211b27','#322a3b','#3c3246','#ebe3f1','#b2a3bf','#4e415b','#41354c','#443450','#c6a5dd','#efa4b7','#dfbd89','#654979'],['#2c2535','#ebe3f1','#d0abed','#afcca5','#edb0a2','#b0a0bf','#a0c3ec','#e3c28d','#bcabc9']),
  preset('ember','余烬','可可棕 · 蜜金光','dark',['#2b251f','#221e19','#352d24','#40362b','#eee6d8','#b5a58d','#514638','#43392c','#493a27','#dfb879','#e6a08a','#dac487','#6d5130'],['#30281f','#eee6d8','#d1afd0','#bccb94','#f0b791','#b3a28a','#9bc7d3','#e8c680','#c6b393']),
]);
export const defaultPreset=(mode:ThemeMode,neutral=false)=>builtinThemes.find(p=>p.id===`builtin.${mode==='light'?(neutral?'porcelain':'paper'):(neutral?'graphite':'charcoal')}`)!;
export function themeVariables(preset:ThemePreset):Record<string,string>{
  return {...Object.fromEntries(Object.entries(preset.colors).map(([key,value])=>[key==='selection'?'--selection-bg':`--${key}`,value])), '--accent-contrast':accentInk(preset.colors.accent), '--code-bg':preset.syntax.background,'--code-text':preset.syntax.foreground,...Object.fromEntries(Object.entries(preset.syntax).filter(([key])=>!['background','foreground'].includes(key)).map(([key,value])=>[`--syntax-${key}`,value]))};
}
function safeColors<T extends object>(input:unknown,keys:readonly string[],base:T):T {
  if(input===undefined)return {...base};
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('APPEARANCE_THEME_INVALID');
  for(const [key,value] of Object.entries(input))if(!keys.includes(key)||typeof value!=='string'||!hex.test(value))throw Error('APPEARANCE_THEME_INVALID');
  return {...base,...input};
}
export class ThemePresetRegistry {
  private entries:ThemePreset[]=[];
  private snapshot:readonly ThemePreset[]=builtinThemes;
  private listeners=new Set<()=>void>();
  getSnapshot=()=>this.snapshot;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  resolve(id:ThemePresetId,mode:ThemeMode){return this.snapshot.find(p=>p.id===id&&p.mode===mode)??defaultPreset(mode);}
  private publish(){this.snapshot=Object.freeze([...builtinThemes,...this.entries]);for(const listener of [...this.listeners])listener();}
  register(owner:string,input:ThemePresetDefinition):ThemePresetHandle {
    if(!/^[a-z][a-z\d.-]{0,79}$/.test(owner)||!input||!/^[a-z][a-z\d-]{0,63}$/.test(input.id)||typeof input.label!=='string'||!input.label.trim()||input.label.length>80||input.description!==undefined&&(typeof input.description!=='string'||input.description.length>200)||!['light','dark'].includes(input.mode)||Object.keys(input).some(key=>!['id','label','description','mode','base','colors','syntax'].includes(key)))throw Error('APPEARANCE_THEME_INVALID');
    const id:ThemePresetId=`plugin:${owner}/${input.id}`;
    if(this.entries.some(p=>p.id===id))throw Error('APPEARANCE_THEME_DUPLICATE');
    if(this.entries.filter(p=>p.owner===owner).length>=64)throw Error('APPEARANCE_THEME_LIMIT');
    const base=input.base?builtinThemes.find(p=>p.id===input.base&&p.mode===input.mode):defaultPreset(input.mode);if(!base)throw Error('APPEARANCE_THEME_BASE_UNAVAILABLE');
    const entry:ThemePreset=Object.freeze({id,owner,label:input.label.trim(),description:input.description??'',mode:input.mode,colors:Object.freeze(safeColors(input.colors,colorKeys,base.colors)),syntax:Object.freeze(safeColors(input.syntax,syntaxKeys,base.syntax))});
    this.entries.push(entry);this.publish();let live=true;
    return {id,dispose:()=>{if(!live)return;live=false;this.entries=this.entries.filter(p=>p!==entry);this.publish();}};
  }
}
export const themePresets=new ThemePresetRegistry();
