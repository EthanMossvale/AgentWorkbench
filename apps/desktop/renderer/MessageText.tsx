import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fileMarkdownDestination, isShortFileReference, type FileReference, type LinkedText } from '../../../packages/navigation/file-links';
import type { FileResolutionResult } from '../../../packages/navigation/file-resolution';
import { api } from './App';
import { Icon } from './ui';
import type { FileActionInfo, FileOpenTarget } from '../host/file-actions';
import './Navigation.css';
import MarkdownContent from './MarkdownContent';

export interface LinkActions { sessionId?: string; openFile: (reference: FileReference) => void; report: (error: unknown) => void; notify: (message: string) => void }
export function LinkMenu({ item, x, y, actions, onClose, mode = 'all' }: { item: LinkedText; x: number; y: number; actions: LinkActions; onClose: () => void; mode?: 'all' | 'open' }) {
  const menu = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [info, setInfo] = useState<FileActionInfo | null>(null), [loadError, setLoadError] = useState('');
  const [choices,setChoices]=useState<string[]>([]);
  const [sub, setSub] = useState(false), [position, setPosition] = useState({ left: x, top: y });
  const [subPosition, setSubPosition] = useState({ left: x, top: y });
  const target = item.url ?? item.reference!.path;
  const resolvedTarget = info?.path ?? target;
  const requestPath = resolvedTarget + (item.reference?.line ? `:${item.reference.line}` : '');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) onClose(); };
    const resized = () => onClose();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resized);
    return () => { clearTimeout(timer.current); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resized); if(previous?.isConnected)previous.focus({preventScroll:true}); };
  }, []);
  useEffect(() => {
    if (item.url) return;
    setInfo(null);setLoadError('');setChoices([]);
    let alive = true;
    void (async()=>{
      let path=target;
      if(isShortFileReference(path)){
        const resolution=await api<FileResolutionResult>('files/resolve',{sessionId:actions.sessionId,path});
        if(!alive)return;
        if(resolution.status!=='resolved'){setChoices(resolution.candidates);setLoadError(resolution.message);return;}
        path=resolution.path;
      }
      const value=await api<FileActionInfo>('files/info',{sessionId:actions.sessionId,path});if(alive)setInfo(value);
    })().catch(error => { if(alive)setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [target, actions.sessionId]);
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect(); if(!box)return;
    setPosition({left:Math.max(8,Math.min(x,innerWidth-box.width-8)),top:Math.max(8,Math.min(y,innerHeight-box.height-8))});
  }, [x,y,info,loadError,choices,mode]);
  useLayoutEffect(() => {
    if(!sub)return;
    const root=menu.current?.getBoundingClientRect(), parent=trigger.current?.getBoundingClientRect(), box=submenu.current?.getBoundingClientRect();
    if(root&&parent&&box)setSubPosition({left:Math.max(8,root.right+box.width+4<innerWidth?root.right+4:root.left-box.width-4),top:Math.max(8,Math.min(parent.top-5,innerHeight-box.height-8))});
  }, [sub,position,info]);
  const run = (operation: () => void | Promise<unknown>) => { onClose(); Promise.resolve().then(operation).catch(actions.report); };
  const open = (id: FileOpenTarget) => run(() => api('files/open',{sessionId:actions.sessionId,path:requestPath,target:id}));
  const cancelClose=()=>clearTimeout(timer.current), delayClose=()=>{cancelClose();timer.current=setTimeout(()=>setSub(false),260);};
  const openSub=(focus=false)=>{cancelClose();setSub(true);if(focus)requestAnimationFrame(()=>submenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());};
  const options = info?.options ?? [];
  const targets = options.map(option=><button key={option.id} role="menuitem" disabled={!option.available} onClick={()=>open(option.id)} title={option.available?undefined:'未找到此应用'}><Icon name={['terminal','git-bash','wsl'].includes(option.id)?'terminal':option.id==='explorer'?'folder':'desktop'} size={15}/><span>{option.label}</span>{!option.available&&<small>未安装</small>}</button>);
  return createPortal(<div className={'link-menu'+(choices.length?' has-file-candidates':'')} data-workbench-file-menu={item.reference?'':undefined} ref={menu} role="menu" aria-label={mode==='open'?'打开方式':'链接操作'} onClick={e => e.stopPropagation()} style={position} onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); if(sub){setSub(false);trigger.current?.focus();}else onClose(); }
    if (e.key === 'Tab') { onClose(); }
    if (e.key === 'ArrowRight' && document.activeElement===trigger.current) {e.preventDefault();openSub(true);}
    if (e.key === 'ArrowLeft' && sub) {e.preventDefault();setSub(false);trigger.current?.focus();}
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const scope=(e.target as HTMLElement).closest('[role="menu"]')??menu.current!;
      const buttons = [...scope.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled), :scope > .link-submenu-trigger > button:not(:disabled), :scope > .file-link-menu-candidates > button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    {mode==='all'&&<><button role="menuitem" onClick={() => run(() => item.url ? api('links/open', { url: item.url }) : actions.openFile({...item.reference!,path:resolvedTarget}))}><Icon name={item.url?'globe':'document'} size={15}/><span>{item.url ? '在浏览器打开' : '在工作台预览'}</span></button>
    {!item.url&&<><button role="menuitem" disabled={!info} onClick={()=>open('default')}><Icon name="desktop" size={15}/><span>在默认应用中打开</span></button>
    <div className="link-submenu-trigger" onMouseEnter={()=>openSub()} onMouseLeave={delayClose}><button ref={trigger} role="menuitem" aria-haspopup="menu" aria-expanded={sub} disabled={!info} onClick={()=>openSub(true)}><Icon name="folder" size={15}/><span>打开方式</span><Icon name="chevron" size={12}/></button></div></>}
    </>}
    {mode==='open'&&targets}
    {!item.url&&<><div className="context-divider" role="separator"/>
    <button role="menuitem" disabled={!info||info.directory} onClick={()=>run(async()=>{if(await api<boolean>('files/save-as',{sessionId:actions.sessionId,path:resolvedTarget}))actions.notify('副本已保存');})}><Icon name="document" size={15}/><span>另存为…</span></button></>}
    <button role="menuitem" onClick={() => run(async () => { await api('clipboard/write', { text: info?.path??target }); actions.notify('已复制'); })}><Icon name="copy" size={15}/><span>{item.url ? '复制网址' : '复制路径'}</span></button>
    {!item.url&&item.reference?.line&&<button role="menuitem" onClick={()=>run(async()=>{await api('clipboard/write',{text:`${info?.path??target}:${item.reference!.line}`});actions.notify('已复制路径与行号');})}><Icon name="copy" size={15}/><span>复制路径与行号</span></button>}
    {!item.url&&<button role="menuitem" onClick={()=>run(async()=>{const destination=fileMarkdownDestination({...item.reference!,path:resolvedTarget}),label=item.text.replace(/[\\[\]]/g,'\\$&');await api('clipboard/write',{text:`[${label}](<${destination}>)`});actions.notify('已复制 Markdown 链接');})}><Icon name="link" size={15}/><span>复制 Markdown 链接</span></button>}
    {item.url?<button role="menuitem" onClick={()=>run(async()=>{await api('clipboard/write',{text:item.text});actions.notify('已复制链接文字');})}><Icon name="document" size={15}/><span>复制链接文字</span></button>:<>
    <button role="menuitem" disabled={!info||info.directory} onClick={()=>run(async()=>{await api('files/copy-content',{sessionId:actions.sessionId,path:resolvedTarget});actions.notify('已复制文件内容');})}><Icon name="copy" size={15}/><span>复制文件内容</span></button>
    <button role="menuitem" disabled={!info} onClick={()=>open('explorer')}><Icon name="folder" size={15}/><span>在资源管理器中显示</span></button></>}
    {!item.url&&!info&&<p className="link-menu-note" role="status">{loadError||'正在读取文件信息…'}</p>}
    {choices.length>0&&<div className="file-link-menu-candidates" data-workbench-file-candidates>{choices.map(candidate=><button type="button" role="menuitem" className="file-resolution-candidate" key={candidate} onClick={()=>run(()=>actions.openFile({...item.reference!,path:candidate}))}><Icon name="document" size={15}/><span>{candidate}</span></button>)}</div>}
    {sub&&mode==='all'&&info&&<div ref={submenu} className="link-menu link-open-submenu" role="menu" aria-label="打开方式" style={subPosition} onMouseEnter={cancelClose} onMouseLeave={delayClose}>{targets}</div>}
  </div>, document.body);
}
export default function MessageText({ text, ...actions }: { text: string } & LinkActions) {
  const [menu, setMenu] = useState<{ item: LinkedText; x: number; y: number } | null>(null);
  const current=useRef(actions);
  useLayoutEffect(()=>{current.current=actions;});
  const copy=useCallback((text:string)=>api('clipboard/write',{text}).then(()=>current.current.notify('已复制代码块内容')),[]);
  const report=useCallback((error:unknown)=>current.current.report(error),[]);
  const renderLink = useCallback((item: LinkedText, key: string, children?: React.ReactNode) => {
    const activate = () => { if (item.url) void api('links/open', { url: item.url }).catch(report); else current.current.openFile(item.reference!); };
    const events = {
      onClick: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); activate(); },
      onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setMenu({ item, x: e.clientX, y: e.clientY }); },
      onKeyDown: (e: React.KeyboardEvent) => { e.stopPropagation(); if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const box = e.currentTarget.getBoundingClientRect(); setMenu({ item, x: box.left, y: box.bottom }); } },
    };
    return item.url ? <a key={key} className="message-link" href={item.url} {...events} onAuxClick={e => { e.preventDefault(); e.stopPropagation(); if (e.button === 1) activate(); }}>{children ?? item.text}</a>
      : <button key={key} type="button" role="link" className="message-link" data-workbench-file-link data-file-path={item.reference!.path} data-file-line={item.reference!.line} {...events}>{children ?? item.text}</button>;
  },[report]);
  return <><MarkdownContent text={text} sessionId={actions.sessionId} renderLink={renderLink} onCopy={copy} onCopyError={report}/>{menu && <LinkMenu {...menu} actions={actions} onClose={() => setMenu(null)} />}</>;
}
