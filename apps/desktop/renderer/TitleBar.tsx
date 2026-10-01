import { useShortcutTitle } from './shortcut-hints';
import { useEffect, useRef, useState } from 'react';
import { api } from './App';
import { Icon } from './ui';
import './TitleBar.css';
import { syncTitlebarAppearance } from './titlebar-appearance';

export default function TitleBar({ back, forward, onBack, onForward, sidebarCompact, sidebarAvailable, onToggleSidebar, report }: {
  back: boolean; forward: boolean; onBack: () => void; onForward: () => void; report: (e: unknown) => void;
  sidebarCompact: boolean; sidebarAvailable: boolean; onToggleSidebar: () => void;
}) {
  const shortcutTitle=useShortcutTitle();
  const [active, setActive] = useState('');
  const root=useRef<HTMLElement>(null),reportRef=useRef(report);reportRef.current=report;
  useEffect(()=>syncTitlebarAppearance(root.current!,value=>api('desktop/titlebar',value),error=>reportRef.current(error)),[]);
  const open = async (id: string, element: HTMLButtonElement) => {
    if (active) return;
    const bounds = element.getBoundingClientRect();
    setActive(id);
    try { await api('desktop/menu', { id, x: bounds.left, y: bounds.bottom + 6 }); }
    catch (e) { report(e); }
    finally { setActive(''); }
  };
  return <header ref={root} className="desktop-titlebar" data-testid="desktop-titlebar">
    <div className="titlebar-history">
      <button aria-label="后退" title={shortcutTitle('back','后退')} disabled={!back} onClick={onBack}><Icon name="chevron" size={16}/></button>
      <button aria-label="前进" title={shortcutTitle('forward','前进')} disabled={!forward} onClick={onForward}><Icon name="chevron" size={16}/></button>
    </div>
    <button className="titlebar-sidebar-toggle" data-testid="sidebar-toggle" aria-label={sidebarCompact ? '展开侧边栏' : '折叠侧边栏'}
      title={shortcutTitle('toggle-sidebar',`${sidebarCompact ? '展开' : '折叠'}侧边栏`)} aria-expanded={sidebarAvailable && !sidebarCompact} aria-controls="conversation-sidebar"
      disabled={!sidebarAvailable} onClick={onToggleSidebar}><Icon name="sidebar" size={17}/></button>
    <nav className="titlebar-menus" aria-label="应用菜单">{([['file','文件'],['edit','编辑'],['view','视图'],['help','帮助']] as const).map(([id,label]) =>
      <button key={id} data-testid={`desktop-menu-${id}`} aria-haspopup="menu" aria-expanded={active===id}
        onMouseDown={event=>event.preventDefault()} onClick={event=>void open(id,event.currentTarget)}
        onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();void open(id,event.currentTarget);}}}>{label}</button>)}</nav>
  </header>;
}
