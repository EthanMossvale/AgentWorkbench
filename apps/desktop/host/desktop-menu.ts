import { app, Menu, nativeTheme, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { coreShortcutActions, effectiveBindings, resolveShortcuts, shortcutAccelerator, type ShortcutSettings } from '../../../packages/shortcuts';
import type { Theme } from '../../../packages/contracts';
import { validateTitlebarAppearance, type TitlebarAppearance } from '../../../packages/appearance';

export const TITLEBAR_HEIGHT = 46;
export function titlebarColors(dark: boolean) {
  return { color: dark ? '#1e1e1e' : '#efede8', symbolColor: dark ? '#eee9e4' : '#302e2b', height: TITLEBAR_HEIGHT };
}

export function installDesktopMenu(window: BrowserWindow, theme: () => Theme, setTheme: (value: Theme) => Promise<unknown>, recoverPlugins?: () => Promise<void>, bindings: () => ShortcutSettings | undefined = () => undefined, onZoom: () => void = () => {}) {
  const command = (value: string) => () => { if (!window.isDestroyed()) window.webContents.send('workbench:command', value); };
  const zoom=(delta:number|null)=>{window.webContents.setZoomLevel(delta===null?0:Math.max(-3,Math.min(4,window.webContents.getZoomLevel()+delta)));appearance();onZoom();};
  // Renderer shortcuts share the same command handler and also work in focused web controls.
  const item = (id: string, label: string): MenuItemConstructorOptions => {
    const action=coreShortcutActions.find(action=>action.id===id),binding=action&&effectiveBindings(action,resolveShortcuts(bindings()))[0];
    return {id,label,accelerator:binding?shortcutAccelerator(binding):undefined,registerAccelerator:false,click:command(id)};
  };
  const build = () => {
    const template: MenuItemConstructorOptions[] = [
      { id: 'file', label: '文件', submenu: [
        item('new-session', '新建会话'), item('new-project', '新建项目…'),
        { type: 'separator' }, item('settings', '设置…'),
        { type: 'separator' }, item('close-window','关闭窗口'),
        item('quit-app','退出 Agent Workbench'),
      ] },
      { id: 'edit', label: '编辑', submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }, { type: 'separator' }, item('search', '搜索会话…'),
      ] },
      { id: 'view', label: '视图', submenu: [
        item('back', '后退'), item('forward', '前进'), { type: 'separator' },
        item('toggle-sidebar', '展开 / 折叠侧边栏'),
        { label: '外观', submenu: (['light', 'dark', 'system'] as const).map((value, index) => ({
          id: `theme-${value}`, label: ['浅色', '深色', '跟随系统'][index], type: 'radio', checked: theme() === value,
          click: () => { void setTheme(value).catch(() => {}); },
        })) },
        { type: 'separator' }, item('zoom-reset','实际大小'),
        item('zoom-in','放大'),
        item('zoom-out','缩小'), { type: 'separator' }, item('fullscreen','切换全屏'),
      ] },
      { id: 'help', label: '帮助', submenu: [item('shortcuts', '键盘快捷键'), item('capabilities', '能力与验收'), ...(recoverPlugins ? [{id:'recover-plugins',label:'插件诊断与安全模式',click:()=>{void recoverPlugins().catch(()=>{});}}] : []), { type: 'separator' }, item('about', '关于 Agent Workbench')] },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    window.setMenuBarVisibility(false);
    return menu;
  };
  let menu = build();
  let colors:TitlebarAppearance|undefined;
  const overlay=()=>({...titlebarColors(nativeTheme.shouldUseDarkColors),...colors,height:Math.round(TITLEBAR_HEIGHT*window.webContents.getZoomFactor())});
  const appearance = () => {
    if (window.isDestroyed()) return;
    if (process.platform === 'win32') window.setTitleBarOverlay(overlay());
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#242424' : '#faf9f6');
  };
  nativeTheme.on('updated', appearance);
  window.on('closed', () => nativeTheme.removeListener('updated', appearance));
  // The visible menu strip belongs to the custom title bar, including Alt access.
  window.webContents.on('before-input-event', (event, input) => {
    if (recoverPlugins && input.type === 'keyDown' && input.control && input.alt && input.shift && input.key.toLowerCase() === 'p') { event.preventDefault(); void recoverPlugins().catch(() => {}); return; }
    if (input.key === 'Alt') event.preventDefault();

  });
  return {
    refresh() { menu = build(); appearance(); },
    execute(id: unknown) {
      if(window.isDestroyed())throw Error('SHORTCUT_UNAVAILABLE');
      if(id==='zoom-in')zoom(1);
      else if(id==='zoom-out')zoom(-1);
      else if(id==='zoom-reset')zoom(null);
      else if(id==='fullscreen')window.setFullScreen(!window.isFullScreen());
      else if(id==='close-window')window.close();
      else if(id==='quit-app')app.quit();
      else if(typeof id==='string' && ['menu-file','menu-edit','menu-view','menu-help'].includes(id)){
        const index=['menu-file','menu-edit','menu-view','menu-help'].indexOf(id),scale=window.webContents.getZoomFactor();
        menu.items[index]?.submenu?.popup({window,x:Math.round((78+index*46)*scale),y:Math.round(TITLEBAR_HEIGHT*scale)});
      }else throw Error('SHORTCUT_UNKNOWN_ACTION');
    },
    setAppearance(payload:unknown) {
      const next=validateTitlebarAppearance(payload);
      if(window.isDestroyed())throw Error('DESKTOP_WINDOW_CLOSED');
      colors=next;appearance();return overlay();
    },
    popup(payload: Record<string, unknown>) {
      if (!['file', 'edit', 'view', 'help'].includes(String(payload.id))) throw new Error('Unknown desktop menu.');
      if (typeof payload.x !== 'number' || !Number.isFinite(payload.x) || typeof payload.y !== 'number' || !Number.isFinite(payload.y)) throw new Error('Invalid menu position.');
      const [width = 860, height = 640] = window.getContentSize();
      const scale=window.webContents.getZoomFactor();
      return new Promise<void>(resolve => menu.getMenuItemById(String(payload.id))!.submenu!.popup({ window,
        x: Math.round(Math.max(0, Math.min((payload.x as number)*scale, width))), y: Math.round(Math.max(0, Math.min((payload.y as number)*scale, height))), callback: resolve }));
    },
  };
}
