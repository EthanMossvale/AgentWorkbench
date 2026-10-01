import { shortcuts } from './shortcuts';
import { useShortcutTitle } from './shortcut-hints';
import type { ForkLocation } from '../../../packages/contracts';
import { hasWorktreeChoice, useForkOptions } from './ForkDialog';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AppState, Project, Session } from '../../../packages/contracts';
import { Icon } from './ui';
import { api, type View } from './App';
import './Sidebar.css';
import {forkUnavailable} from '../../../packages/session-core/fork';
import { RECENT_PROJECT_ID, recentProject, projectSessionId } from '../../../packages/session-core/projects';
import { sidebarInitial } from './sidebar-layout';
import './SidebarRail.css';
import './SidebarInteractions.css';
import { useSidebarDrag } from './sidebar-drag';
import ProjectPreview from './ProjectPreview';
import SessionPreviewBody from './SessionPreviewBody';
import SessionPreviewTitle from './SessionPreviewTitle';
import { orderedProjects, sessionNeedsAttention } from '../../../packages/session-core/sidebar-order';
import { orderedSidebarSessions, sidebarSessionScope } from '../../../packages/session-core/sidebar-sessions';
import './SidebarSessionOrder.css';

export const projectFolders = (project?: Project): string[] => {
  const paths = (project as (Project & { paths?: string[] }) | undefined)?.paths;
  return paths?.length ? paths : project?.path ? [project.path] : [];
};
export const sessionFolder = (session?: Session) => (session as (Session & { projectPath?: string }) | undefined)?.projectPath;
interface Props {
  state: AppState | null; selectedId: string; view: View; archived: boolean;
  compact: boolean; onExpand: () => void;
  onSelect: (id: string) => void; onView: (view: View) => void; onArchive: () => void;
  onNew: (projectId?: string) => void; onProject: (project?: Project) => void;
  onRename: (session: Session) => void; onGroup: (session: Session) => void;
  onUpdate: (id: string, patch: Partial<Session>) => void;
  onUpdateProject: (id: string, patch: { pinned?: boolean }) => void;
  onArchiveProject: (project: Project) => void; onRemoveProject: (project: Project) => void;
  onDeleteSession: (session: Session) => void;
  onFork:(sessionId:string,messageId?:string,location?:ForkLocation)=>Promise<void>; forkingId:string;
  onTheme: () => void; report: (e: unknown) => void; notify: (message: string) => void;
}
type MenuTarget = { type: 'footer' | 'session' | 'project'; id: string; x: number; y: number };
type PreviewTarget = { id: string; x: number; y: number };
type QuickTip = { text: string; x: number; top: number; bottom: number };
const activity = (session: Session) => Math.max(Date.parse(session.messages.at(-1)?.timestamp??'')||0,Date.parse(session.createdAt)||0);
const relativeTime = (value: number) => {
  if (!value) return '未知';
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes}分` : minutes < 1440 ? `${Math.floor(minutes / 60)}小时` : minutes < 10080 ? `${Math.floor(minutes / 1440)}天` : new Date(value).toLocaleDateString('zh-CN');
};
const sessionStatus: Record<Session['status'], string> = { idle: '空闲', running: '运行中', blocked: '需要处理', uncertain: '状态待确认' };

export default function Sidebar({ state, selectedId, view, archived, compact, onExpand, onSelect, onView, onArchive, onNew, onProject, onRename, onGroup, onUpdate, onUpdateProject, onArchiveProject, onRemoveProject, onDeleteSession, onFork, forkingId, onTheme, report, notify }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [menuInput, setMenuInput] = useState<'pointer' | 'keyboard'>('pointer');
  const [submenu,setSubmenu]=useState<'copy'|'fork'|'move'|null>(null);
  const copyOpen=submenu==='copy';
  const forkOptions=useForkOptions(menu?.type==='session'?menu.id:undefined);
  const forkHasChoices=hasWorktreeChoice(forkOptions),forkOpen=submenu==='fork'&&forkHasChoices;
  const [projectPreview,setProjectPreview]=useState<PreviewTarget|null>(null);
  const projectPreviewTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const projectCloseTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const moveTriggerRef=useRef<HTMLButtonElement>(null);
  const hideProjectPreview=()=>{clearTimeout(projectPreviewTimer.current);clearTimeout(projectCloseTimer.current);setProjectPreview(null);};
  const keepProjectPreview=()=>{clearTimeout(projectCloseTimer.current);};
  const leaveProjectPreview=()=>{clearTimeout(projectPreviewTimer.current);clearTimeout(projectCloseTimer.current);projectCloseTimer.current=setTimeout(()=>setProjectPreview(null),180);};
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [previewExpanded,setPreviewExpanded]=useState(false);
  const previewCloseTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const quickTipTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const previewAnchor=useRef<HTMLElement|null>(null),skipPreviewFocus=useRef(false),focusPreview=useRef(false);
  const keepPreview=()=>{clearTimeout(previewCloseTimer.current);clearTimeout(quickTipTimer.current);};
  const previewHasFocus=()=>!!previewRef.current?.contains(document.activeElement);
  const leavePreview=()=>{clearTimeout(previewTimer.current);previewTimer.current=undefined;keepPreview();previewCloseTimer.current=setTimeout(()=>{
    if(previewHasFocus()||previewRef.current?.matches(':hover')||previewAnchor.current?.closest('.session-row')?.matches(':hover'))return;
    hidePreview();
  },180);};
  const [quickTip, setQuickTip] = useState<QuickTip | null>(null);
  const hideQuickTip=()=>{clearTimeout(quickTipTimer.current);setQuickTip(null);};
  const menuRef = useRef<HTMLDivElement>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);
  const copyTriggerRef = useRef<HTMLButtonElement>(null);
  const forkTriggerRef = useRef<HTMLButtonElement>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const footerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const focusCopy = useRef(false);
  const copyCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepCopyOpen = () => { clearTimeout(copyCloseTimer.current); copyCloseTimer.current = undefined; };
  const delayCopyClose = () => { keepCopyOpen(); copyCloseTimer.current = setTimeout(() => setSubmenu(null), 260); };
  const previewRef = useRef<HTMLDivElement>(null);
  const quickTipRef = useRef<HTMLDivElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedSession = menu?.type === 'session' ? state?.sessions.find(session => session.id === menu.id) : undefined;
  const selectedProject = menu?.type === 'project' ? state ? menu.id === RECENT_PROJECT_ID ? recentProject(state) : state.projects.find(project => project.id === menu.id) : undefined : undefined;
  const previewSession = preview ? state?.sessions.find(session => session.id === preview.id) : undefined;
  const previewProject = previewSession?.projectId ? state?.projects.find(project => project.id === previewSession.projectId) : state ? recentProject(state) : undefined;
  const previewActivity = previewSession ? activity(previewSession) : 0;
  const previewPath = sessionFolder(previewSession);
  const showPreviewPath = !!previewPath && (!previewProject || projectFolders(previewProject).length > 1 || previewPath !== projectFolders(previewProject)[0]);
  const hidePreview = () => { clearTimeout(previewTimer.current); previewTimer.current = undefined; focusPreview.current=false; keepPreview(); setPreview(null); setPreviewExpanded(false); };
  const drag=useSidebarDrag(state,()=>{hidePreview();hideProjectPreview();setQuickTip(null);closeMenu(false);},notify,report);
  const hoveredProject=projectPreview&&state?orderedProjects(state).find(p=>p.id===projectPreview.id):undefined;
  const showProjectPreview=(element:HTMLElement,project:Project)=>{if(drag.dragging||previewHasFocus())return;hidePreview();clearTimeout(projectPreviewTimer.current);keepProjectPreview();const rect=element.getBoundingClientRect(),sidebar=element.closest('.sidebar')?.getBoundingClientRect();projectPreviewTimer.current=setTimeout(()=>{if(element.isConnected)setProjectPreview({id:project.id,x:(sidebar?.right??rect.right)-3,y:rect.top-8});},300);};
  useEffect(()=>{setCollapsed(new Set(state?.sidebarCollapsedProjectIds??[]));setExpanded(new Set(state?.sidebarExpandedProjectIds??[]));},[JSON.stringify(state?.sidebarCollapsedProjectIds),JSON.stringify(state?.sidebarExpandedProjectIds)]);
  useEffect(()=>()=>{clearTimeout(projectPreviewTimer.current);clearTimeout(projectCloseTimer.current);},[]);
  const showQuickTip = (element: HTMLElement, text: string, pointer = false) => {
    if(previewHasFocus())return;
    clearTimeout(quickTipTimer.current);
    const show=()=>{if(!element.isConnected)return;hideProjectPreview();hidePreview();const bounds=element.getBoundingClientRect();setQuickTip({text,x:bounds.left+bounds.width/2,top:bounds.top,bottom:bounds.bottom});};
    // Crossing a quick action must not remove the card before the pointer reaches it.
    if(pointer&&previewRef.current)quickTipTimer.current=setTimeout(show,240);else show();
  };
  const showPreview = (element: HTMLElement, session: Session, focus = false) => {
    if(drag.dragging||!focus&&previewHasFocus())return;
    hideProjectPreview();keepPreview();setQuickTip(null);
    clearTimeout(previewTimer.current);previewTimer.current=undefined;
    if(preview?.id===session.id&&!focus)return;
    const open=()=>{
      if (!element.isConnected || menuRef.current) return;
      const bounds = element.getBoundingClientRect();
      const sidebar = element.closest('.sidebar')?.getBoundingClientRect();
      previewTimer.current=undefined;
      previewAnchor.current=element.querySelector<HTMLElement>('.session-select');
      focusPreview.current=focus;
      setPreviewExpanded(focus);
      setPreview({ id: session.id, x: (sidebar?.right ?? bounds.right) + (compact ? 6 : -15), y: bounds.top });
    };
    if(focus)open();else previewTimer.current=setTimeout(open,300);
  };
  const closeMenu = (restoreFocus = true) => {
    keepCopyOpen();
    setSubmenu(null); setMenu(null);
    if (restoreFocus && menuAnchor.current?.isConnected) menuAnchor.current.focus();
  };
  const openMenu = (element: HTMLElement, type: MenuTarget['type'], id = '', pointer?: { x: number; y: number }, input: 'pointer' | 'keyboard' = 'pointer') => {
    hideProjectPreview();hidePreview(); setQuickTip(null);
    setMenuInput(input);
    const rect = element.getBoundingClientRect();
    menuAnchor.current = element.tabIndex >= 0 ? element : element.querySelector<HTMLElement>('button');
    setSubmenu(null);
    setMenu({ type, id, x: pointer?.x ?? rect.left, y: pointer?.y ?? rect.bottom + 4 });
  };
  const showMenu = (event: ReactMouseEvent<HTMLElement>, type: MenuTarget['type'], id = '') => {
    event.preventDefault(); event.stopPropagation();
    openMenu(event.currentTarget, type, id, event.type === 'contextmenu' ? { x: event.clientX, y: event.clientY } : undefined, event.type === 'click' && event.detail === 0 ? 'keyboard' : 'pointer');
  };
  const shortcutTitle=useShortcutTitle();
  const menuShortcut=useRef<()=>void>(()=>{});
  menuShortcut.current=()=>{const target=document.activeElement instanceof HTMLElement?document.activeElement.closest<HTMLElement>('[data-shortcut-menu]'):null;if(!target||view!=='workspace')throw Error('SHORTCUT_UNAVAILABLE');const type=target.dataset.shortcutMenu;if(type==='project'||type==='session')openMenu(target,type,target.dataset.shortcutTarget,undefined,'keyboard');};
  useEffect(()=>shortcuts.bind('sidebar',id=>{if(id==='context-menu')menuShortcut.current();}),[]);
  const keyboardMenu = (event: ReactKeyboardEvent<HTMLElement>, type: MenuTarget['type'], id = '') => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // Do not let Chromium recreate a deleted Shift+F10 binding as contextmenu.
    if(event.shiftKey&&event.key==='F10')event.preventDefault();
    if (event.key === 'ContextMenu') {
      event.preventDefault(); openMenu(event.currentTarget, type, id, undefined, 'keyboard');
    }
  };
  const openCopyMenu = (keyboard: boolean) => { keepCopyOpen(); focusCopy.current = keyboard; setSubmenu('copy'); };
  const openForkMenu=(keyboard:boolean)=>{keepCopyOpen();focusCopy.current=keyboard;setSubmenu('fork');};
  const action = (fn: () => void) => { closeMenu(false); fn(); };
  const toggle = (setter: typeof setCollapsed, id: string) => {const value=!(setter===setCollapsed?collapsed:expanded).has(id);setter(previous=>{const next=new Set(previous);if(value)next.add(id);else next.delete(id);return next;});void api('sidebar/project-visibility',{id,[setter===setCollapsed?'collapsed':'expanded']:value}).catch(report);};

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const panel = menuRef.current;
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
    panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);
  useLayoutEffect(() => {
    if (!submenu || !copyMenuRef.current || !menuRef.current) return;
    const panel = copyMenuRef.current;
    const trigger=submenu==='move'?moveTriggerRef.current:forkOpen?forkTriggerRef.current:copyTriggerRef.current;if(!trigger)return;
    const anchor = trigger.getBoundingClientRect();
    const parent = menuRef.current.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const right = parent.right + 4;
    panel.style.left = `${Math.max(8, Math.min(right + bounds.width <= window.innerWidth - 8 ? right : parent.left - bounds.width - 4, window.innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(anchor.top - 4, window.innerHeight - bounds.height - 8))}px`;
    if (focusCopy.current) { panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); focusCopy.current = false; }
  }, [submenu, menu, forkOpen]);
  useLayoutEffect(() => {
    if (!preview || !previewRef.current) return;
    const panel = previewRef.current;
    let left=preview.x,top=preview.y;
    const place=()=>{const bounds=panel.getBoundingClientRect();left=Math.max(8,Math.min(left,window.innerWidth-bounds.width-8));top=Math.max(8,Math.min(top,window.innerHeight-bounds.height-8));panel.style.left=`${left}px`;panel.style.top=`${top}px`;};
    place();if(focusPreview.current){focusPreview.current=false;panel.focus({preventScroll:true});}const resize=new ResizeObserver(place);resize.observe(panel);return()=>resize.disconnect();
  }, [preview]);
  useLayoutEffect(() => {
    if (!quickTip || !quickTipRef.current) return;
    const panel = quickTipRef.current;
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(quickTip.x - bounds.width / 2, window.innerWidth - bounds.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(quickTip.top - bounds.height - 7 >= 8 ? quickTip.top - bounds.height - 7 : quickTip.bottom + 7, window.innerHeight - bounds.height - 8))}px`;
  }, [quickTip]);
  useEffect(() => {
    const dismiss = () => {hideProjectPreview();hidePreview();setQuickTip(null);};
    const scroll=(event:Event)=>{const target=event.target,sidebar=document.querySelector('.sidebar');if(target===window||target===document||target instanceof Element&&(!!target.closest('.sidebar')||!!sidebar&&target.contains(sidebar)))dismiss();};
    const outside=(event:PointerEvent)=>{const target=event.target as Node|null;if(!previewRef.current?.contains(target)&&!previewAnchor.current?.closest('.session-row')?.contains(target))hidePreview();};
    window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);window.addEventListener('scroll',scroll,true);window.addEventListener('pointerdown',outside);
    return () => {clearTimeout(previewCloseTimer.current);clearTimeout(previewTimer.current);clearTimeout(quickTipTimer.current);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);window.removeEventListener('scroll',scroll,true);window.removeEventListener('pointerdown',outside);};
  }, []);
  useEffect(() => { hidePreview(); setQuickTip(null); }, [query, archived]);
  useEffect(() => { if(preview&&preview.id!==selectedId)hidePreview();setQuickTip(null); }, [selectedId]);
  useEffect(() => {
    hidePreview(); setQuickTip(null); closeMenu(false);
    if (compact) { setSearchOpen(false); setQuery(''); }
  }, [compact]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !copyMenuRef.current?.contains(event.target as Node)) closeMenu(false); };
    const dismiss = () => closeMenu(false);
    const scroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && (menuRef.current?.contains(target) || copyMenuRef.current?.contains(target))) return;
      if (target === window || target === document || target instanceof Element && !!menuAnchor.current && target.contains(menuAnchor.current)) closeMenu(false);
    };
    window.addEventListener('pointerdown', outside); window.addEventListener('resize', dismiss); window.addEventListener('blur', dismiss); window.addEventListener('scroll', scroll, true);
    return () => { keepCopyOpen(); window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss); window.removeEventListener('scroll', scroll, true); };
  }, [menu]);
  useEffect(() => {
    if (menu?.type === 'session' && !selectedSession || menu?.type === 'project' && !selectedProject) closeMenu(false);
  }, [state, menu]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    const openSearch=()=>{setSearchOpen(true);requestAnimationFrame(()=>searchRef.current?.focus());};
    window.addEventListener('workbench-search',openSearch);return ()=>window.removeEventListener('workbench-search',openSearch);
  }, []);
  useEffect(() => {
    const session = state?.sessions.find(item => item.id === selectedId);
    if (session) {
      const sidebarProjectId=session.projectId??RECENT_PROJECT_ID;
      setCollapsed(previous => { const next = new Set(previous); next.delete(sidebarProjectId); return next; });
      const siblings = (state ? orderedSidebarSessions(state) : []).filter(item => item.projectId === session.projectId && !item.archived && !item.pinned && !item.group);
      if (siblings.findIndex(item => item.id === session.id) >= 5) setExpanded(previous => new Set([...previous, sidebarProjectId]));
    }
  }, [selectedId]);

  const search = query.trim().toLocaleLowerCase();
  const matchesProject = (project?: Project) => !!search && !!project && `${project.name} ${projectFolders(project).join(' ')}`.toLocaleLowerCase().includes(search);
  const sessions = (state ? orderedSidebarSessions(state) : []).filter(session => session.archived === archived && (!search || `${session.title} ${sessionFolder(session) ?? ''}`.toLocaleLowerCase().includes(search) || matchesProject(state ? session.projectId ? state.projects.find(project => project.id === session.projectId) : recentProject(state) : undefined)));
  const projects = (state?orderedProjects(state):[]).filter(project => !search || matchesProject(project) || sessions.some(session => session.projectId === projectSessionId(project.id))).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const menuKeys = (event: ReactKeyboardEvent<HTMLDivElement>, isSubmenu = false) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    setMenuInput('keyboard');
    if (event.key === 'Escape' || isSubmenu && event.key === 'ArrowLeft') {
      event.preventDefault(); event.stopPropagation();
      if (submenu) { setSubmenu(null); (submenu==='move'?moveTriggerRef:forkOpen?forkTriggerRef:copyTriggerRef).current?.focus(); } else closeMenu();
      return;
    }
    if (event.key === 'Tab') { closeMenu(); return; }
    if (!isSubmenu && event.key === 'ArrowRight') {if(document.activeElement===moveTriggerRef.current){event.preventDefault();keepCopyOpen();focusCopy.current=true;setSubmenu('move');requestAnimationFrame(()=>copyMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());return;}if(document.activeElement===copyTriggerRef.current){event.preventDefault();openCopyMenu(true);return;}if(document.activeElement===forkTriggerRef.current){event.preventDefault();openForkMenu(true);return;}}
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current + buttons.length - 1) % buttons.length;
    buttons[next]?.focus();
  };
  const copySession = (format: 'link' | 'directory' | 'markdown') => {
    if (!selectedSession) return;
    const target = selectedSession;
    action(() => { api(format === 'link' ? 'deep-link/copy' : 'session/copy', format === 'link' ? { sessionId: target.id } : { id: target.id, format }).then(() => notify(format === 'link' ? '会话深度链接已复制' : format === 'directory' ? '会话工作区路径已复制' : '会话 Markdown 已复制')).catch(report); });
  };
  const row = (session: Session) => <div data-session-id={session.id} data-testid={`sidebar-session-${session.id}`} key={session.id} className={`session-row ${selectedId === session.id && view === 'workspace' ? 'selected' : ''} ${session.unread ? 'unread' : ''} project-session-row ${drag.dragging?.type==='session'&&drag.dragging.id===session.id?'is-dragging':''} ${drag.target?.type==='session'&&drag.target.id===session.id?'session-drop-'+drag.target.edge:''}`} onDragOver={event=>drag.overSession(event,session)} onDrop={event=>void drag.dropSession(event,session)} onContextMenu={event => showMenu(event, 'session', session.id)} onMouseEnter={event => showPreview(event.currentTarget, session)} onMouseLeave={leavePreview} onFocusCapture={event => { if(skipPreviewFocus.current){skipPreviewFocus.current=false;return;} const element=event.currentTarget; requestAnimationFrame(()=>{if(element.querySelector('.session-select')===document.activeElement)showPreview(element,session);}); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)&&!previewRef.current?.contains(event.relatedTarget as Node|null)) leavePreview(); }}>
    <button className="session-select" onMouseEnter={event=>showPreview(event.currentTarget.closest<HTMLElement>('.session-row')!,session)} data-shortcut-menu="session" data-shortcut-target={session.id} draggable={!archived} onDragStart={event=>drag.start(event,'session',session.id)} onDragEnd={drag.finish} aria-label={session.title} aria-current={selectedId === session.id && view === 'workspace' ? 'page' : undefined} aria-describedby={preview?.id === session.id ? 'sidebar-session-preview' : undefined} aria-keyshortcuts="ArrowRight" onClick={() => onSelect(session.id)} onKeyDown={event => {
      if(event.key==='Escape'){event.preventDefault();hidePreview();return;}
      if(!event.nativeEvent.isComposing&&event.keyCode!==229&&event.key==='ArrowRight'&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){event.preventDefault();showPreview(event.currentTarget.closest<HTMLElement>('.session-row')!,session,true);return;}
      if(!archived&&!event.nativeEvent.isComposing&&event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){
        event.preventDefault();hidePreview();const scope=sidebarSessionScope(session),siblings=sessions.filter(item=>sidebarSessionScope(item)===scope),index=siblings.findIndex(item=>item.id===session.id),target=siblings[index+(event.key==='ArrowUp'?-1:1)];
        if(target)void drag.reorder({id:session.id,targetId:target.id,scope,edge:event.key==='ArrowUp'?'before':'after'});
      }else keyboardMenu(event,'session',session.id);
    }}><span className={compact ? 'session-rail-initial' : undefined} aria-hidden={compact || undefined}>{compact ? sidebarInitial(session.title) : session.title}</span>{session.nativeInteractions?.some(i=>i.status==='pending')||session.nativeApprovals?.length ? <span className="session-attention" role="img" aria-label="等待回应"><Icon name="alert" size={12}/></span> : session.status === 'running' ? <i className="session-running-ring" role="img" aria-label="运行中" /> : session.status === 'blocked' || session.status === 'uncertain' ? <span className="session-attention" role="img" aria-label={session.status === 'blocked' ? '需要处理' : '状态待确认'}><Icon name="alert" size={12} /></span> : session.unread ? <i className="unread-dot" role="img" aria-label="未读" /> : null}</button>
    {<div className="session-quick-actions"><button type="button" className="session-quick-action" data-testid={`quick-pin-${session.id}`} aria-label={`${session.pinned ? '取消置顶' : '置顶'}聊天 ${session.title}`} data-tooltip={session.pinned ? '取消置顶聊天' : '置顶聊天'} onMouseEnter={event => showQuickTip(event.currentTarget, session.pinned ? '取消置顶聊天' : '置顶聊天', true)} onMouseLeave={hideQuickTip} onFocus={event => showQuickTip(event.currentTarget, session.pinned ? '取消置顶聊天' : '置顶聊天')} onBlur={() => setQuickTip(null)} onClick={() => { hidePreview(); setQuickTip(null); onUpdate(session.id, { pinned: !session.pinned }); }}><Icon name="pin" size={13} /></button><button type="button" className="session-quick-action" data-testid={`quick-archive-${session.id}`} aria-label={`${session.archived ? '恢复' : '归档'}聊天 ${session.title}`} data-tooltip={session.archived ? '恢复聊天' : '归档聊天'} onMouseEnter={event => showQuickTip(event.currentTarget, session.archived ? '恢复聊天' : '归档聊天', true)} onMouseLeave={hideQuickTip} onFocus={event => showQuickTip(event.currentTarget, session.archived ? '恢复聊天' : '归档聊天')} onBlur={() => setQuickTip(null)} onClick={() => { hidePreview(); setQuickTip(null); onUpdate(session.id, { archived: !session.archived }); }}><Icon name="archive" size={13} /></button></div>}
  </div>;

  return <aside className={`sidebar codex-sidebar${compact ? ' is-compact' : ''}`} data-testid="sidebar" data-shortcut-scope="sidebar" aria-label="项目与会话">
    <div className="sidebar-top"><div className="sidebar-identity"><span className="sidebar-wordmark app-wordmark">Workbench</span></div><button className="icon-button sidebar-search-toggle" data-testid="sidebar-search-toggle" ref={searchButtonRef} aria-label={searchOpen ? '关闭会话搜索' : '搜索会话'} title={shortcutTitle('search','搜索会话')} aria-expanded={searchOpen} onClick={() => { if (searchOpen) { setSearchOpen(false); setQuery(''); } else { onExpand(); setSearchOpen(true); } }}><Icon name="search" size={17} /></button></div>
    <button className="new-session" data-testid="new-session" aria-label="新对话" title={compact ? shortcutTitle('new-session','新对话') : undefined} disabled={!state} onClick={() => onNew()}><Icon name="compose" size={17} /><span>新对话</span></button>
    {searchOpen && <div className="sidebar-search"><Icon name="search" size={15} /><input ref={searchRef} data-testid="session-search" aria-label="搜索会话" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索会话或项目" onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Escape') { event.preventDefault(); if (query) setQuery(''); else { setSearchOpen(false); searchButtonRef.current?.focus(); } } }} />{query && <button className="icon-button" aria-label="清除搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><Icon name="close" size={13} /></button>}</div>}
    <div className="sidebar-scroll">
      {archived ? <section className="sidebar-group sidebar-archive" data-testid="archived-sessions"><div className="section-label with-action"><span>已归档的会话</span><button className="sidebar-section-action" onClick={onArchive}>返回</button></div>{sessions.map(row)}{!sessions.length && <p className="sidebar-empty">{search ? '没有匹配的归档会话' : '没有归档会话'}</p>}</section> : <>
        {sessions.some(session => session.pinned) && <section className="sidebar-group" data-testid="pinned-sessions"><div className="section-label" title="置顶" aria-label="置顶">{compact ? <Icon name="pin" size={12}/> : '置顶'}</div>{sessions.filter(session => session.pinned).map(row)}</section>}
        {Array.from(new Set(sessions.filter(session => !session.pinned && session.group).map(session => session.group))).map(group => <section className="sidebar-group" key={group}><div className="section-label" title={`分组：${group}`} aria-label={`分组：${group}`}>{compact ? sidebarInitial(group) : group}</div>{sessions.filter(session => !session.pinned && session.group === group).map(row)}</section>)}

        <div className="section-label with-action project-section-label"><span>项目</span><div className="project-section-actions">{projects.length>1&&<button className="icon-button" data-testid="fold-all-projects" aria-label={projects.every(p=>collapsed.has(p.id))?'展开所有项目':'折叠所有项目'} onMouseEnter={event=>showQuickTip(event.currentTarget,projects.every(p=>collapsed.has(p.id))?'展开所有项目':'折叠所有项目')} onMouseLeave={()=>setQuickTip(null)} onClick={()=>{hideProjectPreview();setQuickTip(null);void api('sidebar/collapse-all',{collapsed:!projects.every(p=>collapsed.has(p.id))}).catch(report);}}><Icon name={projects.every(p=>collapsed.has(p.id))?'chevron':'chevron-down'} size={14}/></button>}<button className="icon-button" aria-label="新建项目" title="新建项目" data-testid="sidebar-new-project" onClick={() => onProject()} disabled={!state}><Icon name="plus" size={15} /></button></div></div>
        {projects.map(project => {
          const all = sessions.filter(session => session.projectId === projectSessionId(project.id) && !session.pinned && !session.group);
          const isCollapsed = !search && collapsed.has(project.id);
          const showAll = !!search || expanded.has(project.id);
          const visible = showAll ? all : all.slice(0, 5);
          return <section className={`project-group ${drag.dragging?.type==='project'&&drag.dragging.id===project.id?'is-dragging':''} ${drag.target?.type==='project'&&drag.target.id===project.id?'drop-'+drag.target.edge:''}`} onDragOver={event=>drag.over(event,project)} onDrop={event=>void drag.drop(event,project)} key={project.id} data-project-id={project.id} data-testid={project.id===RECENT_PROJECT_ID?'unassigned-sessions':undefined}>
            <div className="project-heading" onContextMenu={event => showMenu(event, 'project', project.id)}><button data-shortcut-menu="project" data-shortcut-target={project.id} className={`project-title ${isCollapsed ? 'collapsed' : ''}`} aria-label={`项目：${project.name}`} aria-expanded={!isCollapsed} aria-controls={`project-sessions-${project.id}`} draggable onDragStart={event=>drag.start(event,'project',project.id)} onDragEnd={drag.finish} onMouseEnter={event=>showProjectPreview(event.currentTarget,project)} onMouseLeave={leaveProjectPreview} onFocus={event=>showProjectPreview(event.currentTarget,project)} onBlur={event=>{if(!(event.relatedTarget instanceof Element)||!event.relatedTarget.closest('.sidebar-project-preview'))leaveProjectPreview();}} onClick={() => toggle(setCollapsed, project.id)} onKeyDown={event => {if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const same=projects.filter(p=>!!p.pinned===!!project.pinned),index=same.findIndex(p=>p.id===project.id),target=same[index+(event.key==='ArrowUp'?-1:1)];if(target)void api('project/reorder',{id:project.id,targetId:target.id,edge:event.key==='ArrowUp'?'before':'after'}).catch(report);}else if(event.key==='Escape')hideProjectPreview();else keyboardMenu(event, 'project', project.id);}}>{compact ? <><span className="project-rail-initial" aria-hidden="true">{sidebarInitial(project.name)}</span><span className="rail-disclosure"><Icon name="chevron" size={9}/></span></> : <><span className="project-folder-icon"><Icon name="folder" size={16} /><span className="project-collapse-indicator"><Icon name="chevron" size={13} /></span></span><span>{project.name}</span></>}{isCollapsed&&!compact&&all.length>0&&<span className={`project-collapsed-count ${all.some(sessionNeedsAttention)?'needs-attention':''}`}>{all.length}</span>}{project.pinned && <span className="project-pin-indicator" aria-label="已置顶"><Icon name="pin" size={11} /></span>}</button><div className="project-row-actions"><button className="row-menu-button" aria-label={`项目菜单 ${project.name}`} onMouseEnter={event=>showQuickTip(event.currentTarget,'项目菜单')} onMouseLeave={()=>setQuickTip(null)} onFocus={event=>showQuickTip(event.currentTarget,'项目菜单')} onBlur={()=>setQuickTip(null)} aria-haspopup="menu" onClick={event => showMenu(event, 'project', project.id)}><Icon name="more" size={16} /></button><button className="project-add" aria-label={`在 ${project.name} 新建会话`} onMouseEnter={event=>showQuickTip(event.currentTarget,'新建会话')} onMouseLeave={()=>setQuickTip(null)} onFocus={event=>showQuickTip(event.currentTarget,'新建会话')} onBlur={()=>setQuickTip(null)} data-testid={`project-new-session-${project.id}`} onClick={() => onNew(project.id)}><Icon name="compose" size={15} /></button></div></div>
            {!isCollapsed && <div id={`project-sessions-${project.id}`} className="project-sessions">{visible.map(row)}{!search && all.length > 5 && <button type="button" className="project-show-more" data-testid={`project-show-more-${project.id}`} aria-label={`${showAll ? '收起' : '展开显示'} ${project.name} 的会话`} title={showAll ? '收起会话' : '展开显示全部会话'} aria-expanded={showAll} onClick={() => toggle(setExpanded, project.id)}>{compact ? <Icon name={showAll ? 'chevron-down' : 'more'} size={15}/> : showAll ? '收起' : <><span>展开显示</span><span className="project-overflow-count">{all.length-5}</span></>}</button>}</div>}
          </section>;
        })}
        {search && !sessions.length && !projects.length && <p className="sidebar-empty">没有匹配的会话或项目</p>}
      </>}
    </div>
    <div className="sidebar-footer"><button className="footer-link sidebar-settings" ref={footerRef} data-testid="sidebar-footer-menu" aria-label="设置与外观" title={compact ? '设置与外观' : undefined} aria-haspopup="menu" aria-expanded={menu?.type==='footer'} onClick={event=>menu?.type==='footer'?closeMenu():showMenu(event,'footer')} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();openMenu(event.currentTarget,'footer','',undefined,'keyboard');}}}><Icon name="settings" size={17}/><span>设置与外观</span><Icon name="chevron-down" size={13}/></button></div>
    {projectPreview&&hoveredProject&&!menu&&!drag.dragging&&<ProjectPreview key={hoveredProject.id} onOpenFolder={folder=>api('path/open',{projectId:hoveredProject.id,path:folder})} project={hoveredProject} count={state!.sessions.filter(s=>s.projectId===projectSessionId(hoveredProject.id)&&!s.archived).length} attention={state!.sessions.filter(s=>s.projectId===projectSessionId(hoveredProject.id)&&!s.archived&&sessionNeedsAttention(s)).length} running={state!.sessions.filter(s=>s.projectId===projectSessionId(hoveredProject.id)&&!s.archived&&s.status==='running').length} x={projectPreview.x} y={projectPreview.y} onEnter={keepProjectPreview} onLeave={leaveProjectPreview} onClose={hideProjectPreview} onPin={()=>onUpdateProject(hoveredProject.id,{pinned:!hoveredProject.pinned})} onEdit={()=>{hideProjectPreview();onProject(hoveredProject);}}/>}
    {preview && previewSession && !menu && createPortal(<div className="sidebar-session-preview" ref={previewRef} tabIndex={0} onMouseEnter={()=>{keepPreview();setPreviewExpanded(true);}} onMouseLeave={leavePreview} onFocusCapture={()=>{keepPreview();setPreviewExpanded(true);}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)&&!event.currentTarget.matches(':hover'))leavePreview();else keepPreview();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(event.currentTarget.contains(document.activeElement)){skipPreviewFocus.current=true;previewAnchor.current?.focus();}hidePreview();}}} role="dialog" aria-label="会话预览" id="sidebar-session-preview" data-testid="sidebar-session-preview"><div data-workbench-session-preview data-session-id={previewSession.id}><div className="session-preview-heading"><SessionPreviewTitle key={previewSession.id} session={previewSession}/><span className="session-preview-meta" aria-label={sessionStatus[previewSession.status]}><Icon name={previewSession.binding.runtime === 'demo' ? 'desktop' : 'terminal'} size={13} /><time dateTime={previewActivity ? new Date(previewActivity).toISOString() : undefined} title={previewActivity ? `${previewSession.messages.length ? '最后消息' : '创建时间'}：${new Date(previewActivity).toLocaleString('zh-CN')}` : '时间未知'}>{relativeTime(previewActivity)}</time></span></div><div className="session-preview-project"><Icon name="folder" size={14} /><span>{previewProject?.name ?? '无项目会话'}</span>{previewSession.status !== 'idle' && <small className={`session-preview-status ${previewSession.status}`}>{sessionStatus[previewSession.status]}</small>}</div>{showPreviewPath && <p className="session-preview-path">{previewPath}</p>}<SessionPreviewBody key={previewSession.id} session={previewSession} expanded={previewExpanded}/></div></div>, document.body)}
    {quickTip && !menu && createPortal(<div ref={quickTipRef} className="sidebar-quick-tooltip" role="tooltip" data-testid="sidebar-quick-tooltip">{quickTip.text}</div>, document.body)}
    {menu && createPortal(<>
      <div className="native-context-menu sidebar-context-menu" ref={menuRef} role="menu" data-input={menuInput} onPointerMove={() => setMenuInput('pointer')} data-testid="sidebar-context-menu" aria-label={menu.type === 'footer' ? '设置与外观' : menu.type === 'project' ? '项目菜单' : '会话菜单'} onKeyDown={event => menuKeys(event)} onPointerOver={event => { const button=(event.target as Element).closest('button[role="menuitem"]'); if(button && button!==copyTriggerRef.current&&button!==forkTriggerRef.current&&button!==moveTriggerRef.current) delayCopyClose(); else if(button===copyTriggerRef.current||button===forkTriggerRef.current||button===moveTriggerRef.current) keepCopyOpen(); }} onPointerLeave={delayCopyClose}>
        {menu.type === 'footer' && <><button role="menuitem" data-testid="settings-open" onClick={() => action(() => onView('settings'))}><Icon name="settings" size={15}/><span>设置</span></button><button role="menuitem" data-testid="theme-toggle" onClick={() => action(onTheme)}><Icon name={document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'} size={15}/><span>{document.documentElement.dataset.theme === 'dark' ? '切换到浅色外观' : '切换到深色外观'}</span></button></>}
        {selectedSession && <><button role="menuitem" data-testid="session-rename" onClick={() => action(() => onRename(selectedSession))}><Icon name="compose" size={15} /><span>重命名会话</span></button><button role="menuitem" data-testid="session-pin" onClick={() => action(() => onUpdate(selectedSession.id, { pinned: !selectedSession.pinned }))}><Icon name="pin" size={15} /><span>{selectedSession.pinned ? '取消置顶' : '置顶会话'}</span></button><button role="menuitem" data-testid="session-unread" onClick={() => action(() => onUpdate(selectedSession.id, { unread: !selectedSession.unread }))}><Icon name={selectedSession.unread ? 'check' : 'unread'} size={15} /><span>{selectedSession.unread ? '标记为已读' : '标记为未读'}</span></button><button role="menuitem" data-testid="session-move-project" ref={moveTriggerRef} aria-haspopup="menu" aria-expanded={submenu==='move'} onMouseEnter={()=>{keepCopyOpen();setSubmenu('move');}} onClick={()=>{keepCopyOpen();focusCopy.current=true;setSubmenu('move');}}><Icon name="folder" size={15}/><span>移动到项目</span><Icon name="chevron" size={12}/></button><button role="menuitem" data-testid="session-group" onClick={() => action(() => onGroup(selectedSession))}><Icon name="folder" size={15} /><span>移动到分组</span></button><div className="context-divider" role="separator" /><button role="menuitem" data-testid="session-copy-submenu" ref={copyTriggerRef} aria-haspopup="menu" aria-expanded={copyOpen} onMouseEnter={() => openCopyMenu(false)} onClick={() => openCopyMenu(true)}><Icon name="copy" size={15} /><span>复制</span><Icon name="chevron" size={12} /></button><button role="menuitem" data-testid="session-fork-submenu" data-workbench-fork-action data-session-id={selectedSession.id} ref={forkTriggerRef} aria-haspopup={forkHasChoices?"menu":undefined} aria-expanded={forkHasChoices?forkOpen:undefined} disabled={!!forkingId||!forkOptions?.workspace.available} title={forkOptions?.workspace.reason??forkUnavailable(selectedSession)} onPointerEnter={()=>openForkMenu(false)} onClick={()=>forkHasChoices?openForkMenu(true):action(()=>{void onFork(selectedSession.id);})}><Icon name="branch" size={15}/><span>{!forkOptions?'正在检查…':'分支'}</span>{forkHasChoices&&<Icon name="chevron" size={12}/>}</button><button role="menuitem" data-testid="open-session-folder" disabled={!sessionFolder(selectedSession)} onClick={() => action(() => { api('session/open-workspace', { sessionId: selectedSession.id }).catch(report); })}><Icon name="folder" size={15} /><span>打开会话工作区</span></button><div className="context-divider" role="separator" /><button role="menuitem" data-testid="session-archive" onClick={() => action(() => onUpdate(selectedSession.id, { archived: !selectedSession.archived }))}><Icon name="archive" size={15} /><span>{selectedSession.archived ? '恢复会话' : '归档会话'}</span></button><button role="menuitem" data-testid="session-delete" className="danger" onClick={() => action(() => onDeleteSession(selectedSession))}><Icon name="trash" size={15} /><span>删除会话…</span></button></>}
        {selectedProject && <><button role="menuitem" data-testid="project-new-session" onClick={() => action(() => onNew(selectedProject.id))}><Icon name="compose" size={15} /><span>新建会话</span></button><button role="menuitem" data-testid="project-pin" onClick={() => action(() => onUpdateProject(selectedProject.id, { pinned: !selectedProject.pinned }))}><Icon name="pin" size={15} /><span>{selectedProject.pinned ? '取消置顶项目' : '置顶项目'}</span></button><div className="context-divider" role="separator" /><button role="menuitem" data-testid="project-manage-folders" onClick={() => action(() => onProject(selectedProject))}><Icon name="compose" size={15} /><span>编辑项目…</span></button><button role="menuitem" data-testid="project-open-folder" disabled={!projectFolders(selectedProject).length} onClick={() => action(() => { api('path/open', { projectId: selectedProject.id }).catch(report); })}><Icon name="folder" size={15} /><span>打开主文件夹</span></button><div className="context-divider" role="separator" /><button role="menuitem" data-testid="project-archive-chats" disabled={!state?.sessions.some(session => session.projectId === projectSessionId(selectedProject.id) && !session.archived)} onClick={() => action(() => onArchiveProject(selectedProject))}><Icon name="archive" size={15} /><span>归档聊天…</span></button><button role="menuitem" data-testid="project-remove" className="danger" onClick={() => action(() => onRemoveProject(selectedProject))}><Icon name="trash" size={15} /><span>移除项目…</span></button></>}
      </div>
      {copyOpen && selectedSession && <div className="native-context-menu sidebar-context-menu sidebar-copy-menu" ref={copyMenuRef} role="menu" data-input={menuInput} onPointerMove={() => setMenuInput('pointer')} aria-label="复制会话信息" data-testid="session-copy-menu" onPointerEnter={keepCopyOpen} onPointerLeave={delayCopyClose} onKeyDown={event => menuKeys(event, true)}><button role="menuitem" data-testid="copy-session-link" onClick={() => copySession('link')}><Icon name="link" size={15} /><span>复制深度链接</span></button><button role="menuitem" data-testid="copy-session-directory" disabled={!sessionFolder(selectedSession)} onClick={() => copySession('directory')}><Icon name="folder" size={15} /><span>复制工作区路径</span></button><button role="menuitem" data-testid="copy-session-markdown" onClick={() => copySession('markdown')}><Icon name="document" size={15} /><span>复制为 Markdown</span></button></div>}
      {submenu==='move'&&selectedSession&&state&&<div className="native-context-menu sidebar-context-menu sidebar-copy-menu sidebar-project-move-menu" ref={copyMenuRef} role="menu" aria-label="移动到项目" data-testid="session-project-menu" onPointerEnter={keepCopyOpen} onPointerLeave={delayCopyClose} onKeyDown={event=>menuKeys(event,true)}>{orderedProjects(state).map(p=><button role="menuitem" key={p.id} disabled={selectedSession.projectId===projectSessionId(p.id)&&!selectedSession.pinned&&!selectedSession.group} onClick={()=>action(()=>{void drag.move(selectedSession.id,p).catch(report);})}><Icon name="folder" size={15}/><span>{p.name}</span></button>)}</div>}
      {forkOpen&&selectedSession&&<div className="native-context-menu sidebar-context-menu sidebar-copy-menu" ref={copyMenuRef} role="menu" data-input={menuInput} aria-label="聊天分支" data-testid="session-fork-menu" data-workbench-fork-picker data-session-id={selectedSession.id} onPointerMove={()=>setMenuInput('pointer')} onPointerEnter={keepCopyOpen} onPointerLeave={delayCopyClose} onKeyDown={event=>menuKeys(event,true)}><button role="menuitem" data-testid="create-session-fork" disabled={!!forkingId||!!forkUnavailable(selectedSession)||forkOptions?.workspace.available===false} title={forkOptions?.workspace.reason??forkUnavailable(selectedSession)} onClick={()=>action(()=>{void onFork(selectedSession.id,undefined,'workspace');})}><Icon name="branch" size={15}/><span>{forkingId===selectedSession.id?'正在创建…':'创建聊天分支'}</span></button><button role="menuitem" data-testid="create-worktree-fork" disabled={!!forkingId||!forkOptions?.worktree.available} title={forkOptions?.worktree.reason} onClick={()=>action(()=>{void onFork(selectedSession.id,undefined,'worktree');})}><Icon name="branch" size={15}/><span>在新工作树中创建聊天分支</span></button></div>}
    </>, document.body)}
  </aside>;
}
