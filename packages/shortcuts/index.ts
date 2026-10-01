export type ShortcutScope = 'global' | 'composer' | 'sidebar';
export interface ShortcutSettings { version: 1; revision: number; overrides: Record<string, string[]> }
export interface ShortcutAction { id: string; label: string; description: string; scope: ShortcutScope; defaultBindings: readonly string[] }
export interface ShortcutKeyEvent { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; keyCode?: number; repeat?: boolean; getModifierState?(key: string): boolean }

const action = (id: string, label: string, description: string, defaultBindings: string[] = [], scope: ShortcutScope = 'global'): ShortcutAction => Object.freeze({id,label,description,scope,defaultBindings:Object.freeze(defaultBindings)});
export const coreShortcutActions: readonly ShortcutAction[] = Object.freeze([
  action('new-session','新建会话','开始新的会话',['Mod+N']),
  action('new-project','新建项目','选择文件夹并创建项目',['Mod+Shift+N']),
  action('settings','打开设置','打开工作台设置',['Mod+,']),
  action('shortcuts','键盘快捷键','打开快捷键设置'),
  action('search','搜索会话','搜索会话或项目',['Mod+K']),
  action('toggle-sidebar','展开 / 折叠侧边栏','调整工作台侧边栏',['Mod+B']),
  action('back','后退','返回上一个工作台位置',['Alt+ArrowLeft']),
  action('forward','前进','前往下一个工作台位置',['Alt+ArrowRight']),
  action('archive-session','归档会话','归档当前会话'),
  action('delete-session','删除会话','确认后删除当前会话'),
  action('pin-session','切换置顶状态','置顶或取消置顶当前会话'),
  action('unread-session','标记为未读','将当前会话标记为未读'),
  action('focus-composer','聚焦聊天输入框','将焦点移至主聊天输入框'),
  action('zoom-in','放大','放大工作台界面',['Mod+Plus','Mod+=']),
  action('zoom-out','缩小','缩小工作台界面',['Mod+-']),
  action('zoom-reset','实际大小','恢复默认缩放比例',['Mod+0']),
  action('fullscreen','切换全屏','进入或退出全屏',['F11']),
  action('menu-file','打开文件菜单','显示文件菜单',['Alt+F']),
  action('menu-edit','打开编辑菜单','显示编辑菜单',['Alt+E']),
  action('menu-view','打开视图菜单','显示视图菜单',['Alt+V']),
  action('menu-help','打开帮助菜单','显示帮助菜单',['Alt+H']),
  action('context-menu','打开项目或会话菜单','在聚焦的项目或会话上打开菜单',['Shift+F10'],'sidebar'),
  action('composer-newline','输入框换行','在聊天输入框光标处插入换行',['Shift+Enter'],'composer'),
  action('close-window','关闭窗口','关闭窗口并继续在托盘运行',['Mod+W']),
  action('quit-app','退出工作台','退出 Agent Workbench',['Mod+Q']),
]);
const modifiers = ['Mod','Ctrl','Meta','Alt','Shift'];
const namedKeys = ['Plus','Enter','Space','Backspace','Delete','Insert','Home','End','PageUp','PageDown','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
export function normalizeShortcut(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80) throw Error('SHORTCUT_INVALID_BINDING');
  const parts = value.split('+');let key = parts.pop()!;
  if(key==='='&&parts.includes('Shift'))key='Plus';
  if (!key || !( /^[A-Za-z0-9,.;/\[\]\\'`=\-]$/.test(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key) || namedKeys.includes(key))) throw Error('SHORTCUT_INVALID_BINDING');
  if (parts.some(part=>!modifiers.includes(part)) || new Set(parts).size !== parts.length || parts.includes('Mod') && (parts.includes('Ctrl') || parts.includes('Meta'))) throw Error('SHORTCUT_INVALID_BINDING');
  const ordered = modifiers.filter(modifier=>parts.includes(modifier) && !(key==='Plus' && modifier==='Shift'));
  const normalized = [...ordered,key.length===1?key.toUpperCase():key].join('+');
  if (!ordered.some(part=>['Mod','Ctrl','Meta','Alt'].includes(part)) && !/^F\d+$/.test(key) && normalized !== 'Shift+Enter') throw Error('SHORTCUT_NEEDS_MODIFIER');
  const portable = normalized.replace(/^(Ctrl|Meta)\+/, 'Mod+');
  if (['Mod+C','Mod+V','Mod+X','Mod+A','Mod+Z','Mod+Y','Mod+Shift+Z','Mod+Shift+V','Mod+R','Mod+Shift+R','Alt+F4','Ctrl+Alt+Delete','Mod+Alt+Delete','Mod+Alt+Shift+P'].includes(portable) || normalized==='F12' || normalized==='F5' || ordered.includes('Ctrl')&&ordered.includes('Meta')) throw Error('SHORTCUT_RESERVED');
  return normalized;
}
export function shortcutFromEvent(event: ShortcutKeyEvent, mac = false): string | null {
  if (event.isComposing || event.keyCode===229 || event.repeat || event.getModifierState?.('AltGraph')) return null;
  const shifted:Record<string,string> = {'~':'`','!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0','_':'-',':':';','"':"'",'<':',','>':'.','?':'/','{':'[','}':']','|':'\\'};
  const key = event.key==='+'?'Plus':event.key===' '?'Space':event.shiftKey?(shifted[event.key]??event.key):event.key;
  if (['Control','Meta','Alt','Shift','AltGraph','Dead','Process','Unidentified'].includes(key)) return null;
  const parts = [mac?event.metaKey&&'Mod':event.ctrlKey&&'Mod',mac?event.ctrlKey&&'Ctrl':event.metaKey&&'Meta',event.altKey&&'Alt',event.shiftKey&&'Shift',key].filter(Boolean);
  try { return normalizeShortcut(parts.join('+')); } catch { return null; }
}
export function shortcutIdentity(binding: string, mac = false): string { return binding.replace(/^Mod\+/,mac?'Meta+':'Ctrl+'); }
export function shortcutLabel(binding: string, mac = false): string {
  return binding.split('+').map(key=>({Mod:mac?'⌘':'Ctrl',Meta:mac?'⌘':'Win',Alt:mac?'⌥':'Alt',Shift:'Shift',Plus:'+',ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',Space:'空格'}[key]??key)).join(' + ');
}
export function shortcutAccelerator(binding: string): string {
  return binding.split('+').map(key=>({Mod:'CmdOrCtrl',Meta:'Super',ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down'}[key]??key)).join('+');
}
export function validShortcutId(id: unknown): id is string { return typeof id==='string' && (coreShortcutActions.some(action=>action.id===id) || /^plugin:[a-z][a-z0-9.-]{0,79}\/[a-z][a-z0-9.-]{0,79}$/.test(id)); }
export function resolveShortcuts(value?: ShortcutSettings): ShortcutSettings {
  const overrides: Record<string,string[]> = {};
  if(value?.version===1 && value.overrides && typeof value.overrides==='object') for(const [id,bindings] of Object.entries(value.overrides)) {
    try { if(validShortcutId(id))overrides[id]=validateBindings(bindings,id); } catch { /* Invalid disk entries inherit the current defaults. */ }
  }
  return {version:1,revision:Number.isSafeInteger(value?.revision)&&value!.revision>=0?value!.revision:0,overrides};
}
export function validateBindings(value: unknown, id?: string): string[] {
  if(!Array.isArray(value)||value.length>8)throw Error('SHORTCUT_INVALID_BINDINGS');
  const bindings = value.map(normalizeShortcut);
  if(new Set(bindings).size!==bindings.length)throw Error('SHORTCUT_DUPLICATE_BINDING');
  if(id && id!=='composer-newline' && bindings.includes('Shift+Enter'))throw Error('SHORTCUT_RESERVED');
  return bindings;
}
export function effectiveBindings(action: ShortcutAction, settings: ShortcutSettings): readonly string[] { return settings.overrides[action.id]??action.defaultBindings; }
export function shortcutConflicts(actions: readonly ShortcutAction[], settings: ShortcutSettings, mac = false): {id: string; other: string; binding: string}[] {
  const seen = new Map<string,string>(), conflicts: {id:string;other:string;binding:string}[] = [];
  for(const action of actions)for(const binding of effectiveBindings(action,settings)) {
    const key=shortcutIdentity(binding,mac),other=seen.get(key);
    if(other)conflicts.push({id:action.id,other,binding});else seen.set(key,action.id);
  }
  return conflicts;
}
export function updateShortcuts(current: ShortcutSettings | undefined, revision: unknown, id: unknown, bindings: unknown, reset = false, mac = false): ShortcutSettings {
  const next=resolveShortcuts(current);
  if(revision!==next.revision)throw Error('SHORTCUT_REVISION_CONFLICT');
  if(reset && id===undefined)next.overrides={};
  else {
    if(!validShortcutId(id))throw Error('SHORTCUT_UNKNOWN_ACTION');
    if(reset)delete next.overrides[id];else next.overrides[id]=validateBindings(bindings,id);
  }
  if(shortcutConflicts(coreShortcutActions,next,mac).length)throw Error('SHORTCUT_CONFLICT');
  next.revision++;return next;
}
