import DesktopUpdate from './DesktopUpdate';
import {shareState} from './state-sharing';
import {useUiPreference,UiPreferenceStatus} from './ui-preferences';
import { useAppearance } from './appearance';
import ImageViewerHost from './ImageViewerHost';
import { isPluginRuntime } from '../../../packages/runtime-extensions/types';
import type { ForkLocation } from '../../../packages/contracts';
import ForkDialog, { hasWorktreeChoice, type ForkOptions } from './ForkDialog';
import { rememberedPermission } from '../../../packages/session-core/permissions';
import { startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortcuts } from './shortcuts';
import type { AppState, NewSessionDraft, Project, Session } from '../../../packages/contracts';
import { Field, Icon, Mark, Modal, errorText } from './ui';
import SettingsLayout, { type SettingsTab } from './SettingsLayout';
import TitleBar from './TitleBar';
import SidebarFrame, { useSidebarLayout } from './SidebarFrame';
import { recentProject, RECENT_PROJECT_ID, projectSessionId } from '../../../packages/session-core/projects';
import Sidebar, { projectFolders } from './Sidebar';
import Workspace from './Workspace';
import ProjectDialog from './ProjectDialog';
import { selectedSharedAccountRef } from '../../../packages/account-selection';
import { PluginAppearanceLayer } from './PluginSettings';
import { pluginSettings } from './plugin-settings';
import type { PluginRepairDraft } from '../../../packages/plugins-core/repair-draft';

export const api = async <T,>(method: string, payload?: unknown): Promise<T> => {
  if (!window.workbench) throw new Error('桌面可信服务不可用。请从桌面应用启动；浏览器预览不会模拟原生服务。');
  return window.workbench.call<T>(method, payload);
};
export type View = 'workspace' | 'settings';
type Dialog = 'project' | 'project-edit' | 'rename' | 'group' | null;
type SidebarConfirmation = {kind:'session-delete';session:Session};
const blankSession = (runtime: NewSessionDraft['runtime'] = 'demo'): NewSessionDraft => ({ projectId: null, projectPath: '', runtime });

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  useAppearance(state?.appearance);
  const [view, setView] = useUiPreference<View>('navigation.view');
  const [settingsTab,setSettingsTab]=useUiPreference<SettingsTab>('navigation.settings');
  const {layout:sidebarLayout,setCompact:setSidebarCompact,setWidth:setSidebarWidth}=useSidebarLayout();
  const history=useRef<{view:View;tab:SettingsTab;sessionId:string}[]>([{view:'workspace',tab:'general',sessionId:''}]);
  const historyIndex=useRef(0), historyReplay=useRef(false);
  const [,setHistoryRevision]=useState(0);
  const commandRef=useRef<(command:string)=>void|Promise<void>>(()=>{});
  const [selectedId, setSelectedId] = useUiPreference<string>('navigation.session');
  const selectedIdRef = useRef(selectedId);selectedIdRef.current=selectedId;
  const [sidebarConfirmation,setSidebarConfirmation]=useState<SidebarConfirmation|null>(null);
  const [confirmingSidebar,setConfirmingSidebar]=useState(false);
  const [sidebarUndo,setSidebarUndo]=useState<{id:string;label:string}>();
  const [newDraft, setNewDraft] = useState<NewSessionDraft>(() => blankSession());
  const lastModelTarget = useRef<string | undefined>(undefined);
  const lastModelSelection = useRef<NewSessionDraft['modelSelection']>(undefined);
  const lastModelHost = useRef<string | undefined>(undefined);
  const lastSelectedRuntime = useRef<NewSessionDraft['runtime'] | null>(null);
  const runtimeSave = useRef<Promise<void>>(Promise.resolve());
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [repairDraft,setRepairDraft]=useState<PluginRepairDraft>();
  const deliveredRepair=useRef(''),openRepair=useRef<(draft:PluginRepairDraft)=>void>(()=>{});
  const [navigationReady,setNavigationReady]=useState(false);
  useEffect(()=>{if(state&&navigationReady)void window.workbench?.call('plugin-recovery/core-ready').catch(()=>{});},[!!state,navigationReady]);
  const workspaceEpoch = useRef(0);
  const pendingCreation = useRef<{ epoch: number; promise: Promise<Session> } | null>(null);
  const [error, setError] = useState('');
  const [forkingId,setForkingId]=useState('');const forkPending=useRef(false);
  const [forkRequest,setForkRequest]=useState<{sessionId:string;messageId?:string;options:ForkOptions}|null>(null),[forkError,setForkError]=useState('');
  const [messageLocation,setMessageLocation]=useState<{sessionId:string;messageId?:string}|null>(null);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const dialogEpoch = useRef(0);
  const savingDialogEpoch = useRef<number | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [menuId, setMenuId] = useState('');
  const [formName, setFormName] = useState('');
  const [formPaths, setFormPaths] = useState<string[]>([]);
  const [pickingFolders,setPickingFolders] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState('');
  const projectSelectionEpoch = useRef<number | null>(null);
  const [formGroup, setFormGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = state?.sessions.find(s => s.id === selectedId);
  useEffect(()=>{const open=(event:Event)=>{const tab=(event as CustomEvent).detail;if(pluginSettings.has(tab)){setSettingsTab(tab);setView('settings');}};window.addEventListener('workbench-settings',open);return()=>window.removeEventListener('workbench-settings',open);},[]);
  const receiveState = (next: AppState) => {
    shortcuts.receive(next.shortcuts);
    // Hydrate once; delayed state notifications must not undo a newer user choice.
    if (lastSelectedRuntime.current === null) {
      const runtime = next.lastSelectedRuntime ?? 'demo';
      lastSelectedRuntime.current = runtime;lastModelTarget.current=next.lastModelTargetId;lastModelSelection.current=next.lastModelSelection;lastModelHost.current=next.lastModelHostId;
      setNewDraft(previous => ({ ...previous, runtime,permissionMode:rememberedPermission(next,previous.projectId,runtime),modelTargetId:next.lastModelTargetId,modelSelection:next.lastModelSelection,hostId:next.lastModelHostId }));
    }
    startTransition(() => setState(previous=>previous?shareState(previous,next):next));
  };
  const refresh = async () => { const next = await api<AppState>('state/get'); receiveState(next); return next; };
  const report = (e: unknown) => setError(errorText(e));
  const notify = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 4000); };
  const closeDialog = () => { dialogEpoch.current++; setDialog(null); setSaving(false); setPickingFolders(false); };
  useEffect(()=>{if(state)void api('navigation/view',{sessionId:selectedId||null}).catch(()=>{});},[selectedId,!!state]);
  const selectSession = (id: string) => { if (id !== selectedId) { setWorkspaceKey(++workspaceEpoch.current); pendingCreation.current = null; } setSelectedId(id); setView('workspace');if(state?.sessions.find(session=>session.id===id)?.unread)void api('session/update',{id,unread:false}).then(refresh).catch(report); };
  const forkSession=async(sessionId:string,messageId?:string,location?:ForkLocation)=>{
    if(forkPending.current)return;forkPending.current=true;setForkingId(sessionId);
    const epoch=workspaceEpoch.current;
    try{
      if(!location){
        const options=await api<ForkOptions>('session/fork-options',{sessionId,messageId});
        if(workspaceEpoch.current!==epoch)return;
        if(options.busy||!options.workspace.available)throw Error(options.workspace.reason??'当前会话暂时无法创建分支。');
        if(hasWorktreeChoice(options)){setForkError('');setForkRequest({sessionId,messageId,options});return;}
        location='workspace';
      }
      const created=await api<Session>('session/fork',{sessionId,messageId,location});
      await refresh();
      if(workspaceEpoch.current===epoch){setWorkspaceKey(++workspaceEpoch.current);pendingCreation.current=null;setSelectedId(created.id);setShowArchive(false);setView('workspace');setMessageLocation(null);}
      setForkRequest(null);setForkError('');notify(location==='worktree'?'已在新工作树创建聊天分支':'已创建聊天分支');
    }catch(e){setForkError(errorText(e));report(e);}finally{forkPending.current=false;setForkingId('');}
  };
  const openBranchSource=(id:string,messageId?:string)=>{selectSession(id);setMessageLocation({sessionId:id,messageId});};
  const newSession = (projectId?: string, repair?:PluginRepairDraft) => {
    const project = state ? projectId === RECENT_PROJECT_ID ? recentProject(state) : state.projects.find(item => item.id === projectId) : undefined;
    setWorkspaceKey(++workspaceEpoch.current); pendingCreation.current = null;
    setRepairDraft(repair);
    setNewDraft({ ...blankSession(lastSelectedRuntime.current ?? 'demo'),modelTargetId:lastModelTarget.current,modelSelection:lastModelSelection.current,hostId:lastModelHost.current, projectId: project ? projectSessionId(project.id) : null, projectPath: projectFolders(project)[0] ?? '', permissionMode:rememberedPermission(state,project?projectSessionId(project.id):null,lastSelectedRuntime.current??'demo') });
    if(project?.id===RECENT_PROJECT_ID&&state?.recentProject?.hidden)void api('project/update',{id:RECENT_PROJECT_ID,hidden:false}).then(refresh).catch(report);
    setSelectedId(''); setView('workspace'); setShowArchive(false); closeDialog(); setMenuId(''); setError('');
  };
  openRepair.current=repair=>{newSession(undefined,repair);notify('修复提示已填入新会话草稿；请选择模型、检查内容后自行发送。');};
  useEffect(()=>{
    if(!navigationReady)return;
    let live=true,reading=false,failed=false;
    const poll=async()=>{
      if(reading||failed)return;reading=true;
      try{const draft=await api<PluginRepairDraft|null>('plugin-recovery/repair-draft');if(live&&draft&&draft.id!==deliveredRepair.current){deliveredRepair.current=draft.id;openRepair.current(draft);}}
      catch(error){if(live){failed=true;report(error);}}finally{reading=false;}
    };
    void poll();const timer=window.setInterval(poll,1000);return()=>{live=false;window.clearInterval(timer);};
  },[navigationReady]);
  const repairDraftApplied=(id:string)=>{setRepairDraft(current=>current?.id===id?undefined:current);void api('plugin-recovery/repair-draft/ack',{id}).catch(report);};
  const rememberModel = (next: Pick<NewSessionDraft,'runtime'|'modelTargetId'|'modelSelection'|'hostId'>) => {
    lastSelectedRuntime.current=next.runtime;lastModelTarget.current=next.modelTargetId;lastModelSelection.current=next.modelSelection;lastModelHost.current=next.hostId;
    runtimeSave.current=runtimeSave.current.then(()=>api('runtime/select',{runtime:next.runtime,targetId:next.modelTargetId,selection:next.modelSelection,hostId:next.hostId})).then(()=>undefined).catch(report);
  };
  const switchDraft = (next: NewSessionDraft, rememberRuntime = false) => {
    if (rememberRuntime) rememberModel(next);
    ++workspaceEpoch.current; pendingCreation.current = null; setSelectedId(''); setNewDraft({...next,permissionMode:rememberedPermission(state,next.projectId,next.runtime)}); setError('');
  };
  const ensureSession = (draft: NewSessionDraft): Promise<Session> => {
    if (selected) return Promise.resolve(selected);
    const epoch = workspaceEpoch.current;
    if (pendingCreation.current?.epoch === epoch) return pendingCreation.current.promise;
    const hostId=draft.runtime==='demo'||draft.runtime==='api'||isPluginRuntime(draft.runtime)?undefined:draft.hostId??state?.activeWorkspaceId;
    const accountRef=draft.runtime==='codex'&&hostId?selectedSharedAccountRef(state?.accountCatalogs?.[hostId]):undefined;
    const promise = api<Session>('session/create', { ...draft, accountRef, projectPath: draft.projectPath || undefined, hostId }).then(created => {
      // The first create belongs to this workspace: selecting it must not remount its live draft.
      setState(previous => previous ? { ...previous, sessions: previous.sessions.some(item => item.id === created.id) ? previous.sessions : [...previous.sessions, created] } : previous);
      if (workspaceEpoch.current === epoch) setSelectedId(created.id);
      return created;
    }).catch(error => { if (pendingCreation.current?.epoch === epoch) pendingCreation.current = null; throw error; });
    pendingCreation.current = { epoch, promise };
    return promise;
  };
  useEffect(() => {
    let live = true; let navigationEpoch = 0;
    const navigate = async (id: string) => {
      const epoch = ++navigationEpoch;
      try { const next = await api<AppState>('state/get'); if (!live || epoch !== navigationEpoch) return; receiveState(next); const destination = next.sessions.find(item => item.id === id); if (!destination) throw new Error('深度链接指向的会话不在此工作台中。'); setWorkspaceKey(++workspaceEpoch.current); pendingCreation.current = null; setSelectedId(destination.id); setShowArchive(destination.archived); setView('workspace');if(destination.unread)void api('session/update',{id:destination.id,unread:false}).then(refresh).catch(report); }
      catch (e) { if (live && epoch === navigationEpoch) report(e); }
    };
    const stopState = window.workbench?.onState(next => { if (live) receiveState(next); });
    const stopNavigation = window.workbench?.onNavigate?.(id => { void navigate(id); });
    const releaseShortcuts=shortcuts.configure(api);
    const releaseCommands=shortcuts.bind('global',id=>commandRef.current(id));
    const invoke=(id:string)=>{void shortcuts.invoke(id).catch(report);};
    const stopCommands = window.workbench?.onCommand?.(command=>shortcuts.getSnapshot().some(item=>item.id===command)?invoke(command):commandRef.current(command));
    const shortcut=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||document.querySelector('[role="dialog"]'))return;
      const target=event.target instanceof Element?event.target:null;
      if(target?.closest('[data-shortcut-composing="true"]'))return;
      const local=target?.closest('[data-shortcut-scope]')?.getAttribute('data-shortcut-scope');
      const command=shortcuts.match(event,local==='composer'||local==='sidebar'?local:'global');
      if(command){event.preventDefault();event.stopPropagation();invoke(command);}
    };
    window.addEventListener('keydown',shortcut,true);
    refresh().then(async () => { const initial = await api<{ sessionId: string | null }>('navigation/get'); if (live && navigationEpoch === 0 && initial.sessionId) await navigate(initial.sessionId); if(live)setNavigationReady(true); }).catch(e => { if (live) report(e); });
    return () => { live = false; releaseShortcuts(); releaseCommands(); stopState?.(); stopNavigation?.(); stopCommands?.(); window.removeEventListener('keydown',shortcut,true); };
  }, []);
  useLayoutEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = state?.theme === 'system' ? (mq.matches ? 'dark' : 'light') : state?.theme ?? 'light'; };
    apply(); mq.addEventListener('change', apply); return () => mq.removeEventListener('change', apply);
  }, [state?.theme]);
  const updateSession = async (id: string, patch: Partial<Session>) => { try { await api('session/update', { id, ...patch }); await refresh(); setMenuId(''); } catch (e) { report(e); } };
  const openDialog = (kind: Dialog, session?: Session) => { dialogEpoch.current++; setSaving(false); setPickingFolders(false); setDialog(kind); setFormName(session?.title ?? ''); setFormPaths([]); setFormGroup(session?.group ?? ''); if (session) setMenuId(session.id); };
  const openProject = (project?: Project, selectForDraft = false) => { projectSelectionEpoch.current = selectForDraft ? workspaceEpoch.current : null; openDialog(project ? 'project-edit' : 'project'); setEditingProjectId(project?.id ?? ''); setFormName(project?.name ?? ''); setFormGroup(project?.group ?? ''); setFormPaths(projectFolders(project)); };
  const addFolders = async () => { if(pickingFolders)return;const epoch=dialogEpoch.current;setPickingFolders(true);try { const paths = await api<string[]>('project/pick-many'); if(dialogEpoch.current===epoch)setFormPaths(previous => [...new Set([...previous, ...paths])]); } catch (e) { if(dialogEpoch.current===epoch)report(e); } finally { if(dialogEpoch.current===epoch)setPickingFolders(false); } };
  const saveDialog = async () => {
    const epoch = dialogEpoch.current;
    const selectionEpoch = projectSelectionEpoch.current;
    const draftEpoch = workspaceEpoch.current;
    if (savingDialogEpoch.current === epoch) return;
    savingDialogEpoch.current = epoch;
    setSaving(true); setError('');
    try {
      const paths = [...new Set(formPaths)];
      if (dialog === 'project') {
        const created = await api<Project>('project/create', { name: formName.trim(), path: paths[0] ?? '', paths, group: formGroup.trim() });
        if (dialogEpoch.current === epoch && selectionEpoch === workspaceEpoch.current) setNewDraft(previous => ({ ...previous, projectId: created.id, projectPath: projectFolders(created)[0] ?? '' }));
      }
      if (dialog === 'project-edit') { await api('project/update', { id: editingProjectId, name: formName.trim(), paths, group: formGroup.trim() }); if(workspaceEpoch.current===draftEpoch&&editingProjectId!==RECENT_PROJECT_ID)setNewDraft(previous=>previous.projectId===editingProjectId?{...previous,projectPath:paths[0]??''}:previous); }
      if (dialog === 'rename' || dialog === 'group') await api('session/update', { id: menuId, ...(dialog === 'rename' ? { title: formName.trim() } : { group: formGroup.trim() }) });
      await refresh(); if (dialogEpoch.current === epoch) { setDialog(null); setMenuId(''); }
    } catch (e) { if (dialogEpoch.current === epoch) report(e); } finally { if (savingDialogEpoch.current === epoch) savingDialogEpoch.current = null; if (dialogEpoch.current === epoch) setSaving(false); }
  };
  const theme = async () => { try { await api('theme/set', { theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }); await refresh(); } catch (e) { report(e); } };
  const updateProject = async (id:string,patch:{pinned?:boolean}) => {try{await api('project/update',{id,...patch});await refresh();}catch(e){report(e);}};
  const mutateProject=async(project:Project,remove:boolean)=>{
    try{
      const result=await api<{sidebarUndoId:string}>(remove?'project/remove':'project/archive-sessions',{id:project.id});
      if(remove&&project.id!==RECENT_PROJECT_ID)setNewDraft(previous=>previous.projectId===project.id?{...previous,projectId:null,projectPath:''}:previous);
      setSidebarUndo({id:result.sidebarUndoId,label:remove?'项目已从侧栏移除，文件和会话已保留。':'项目内会话已归档。'});
      await refresh();
    }catch(e){report(e);}
  };
  const undoProject=async()=>{if(!sidebarUndo)return;try{await api('project/undo',{id:sidebarUndo.id});setSidebarUndo(undefined);await refresh();notify('已撤销。');}catch(e){report(e);}};
  const confirmSidebar = async () => {
    const target=sidebarConfirmation;if(!target||confirmingSidebar)return;setConfirmingSidebar(true);
    try{
      await api('session/delete',{id:target.session.id,confirm:true,...(target.session.status==='uncertain'?{discardUncertain:true}:{})});
      if(selectedIdRef.current===target.session.id)newSession();notify('本机会话记录已删除。');
      await refresh();setSidebarConfirmation(null);
    }catch(e){report(e);}finally{setConfirmingSidebar(false);}
  };
  useEffect(()=>{
    if(historyReplay.current){historyReplay.current=false;return;}
    const location={view,tab:settingsTab,sessionId:selectedId};
    const previous=history.current[historyIndex.current];
    if(previous&&previous.view===location.view&&previous.tab===location.tab&&previous.sessionId===location.sessionId)return;
    history.current=[...history.current.slice(0,historyIndex.current+1),location];historyIndex.current=history.current.length-1;setHistoryRevision(value=>value+1);
  },[view,settingsTab,selectedId]);
  const moveHistory=(delta:number)=>{
    const index=historyIndex.current+delta,location=history.current[index];if(!location)return;
    if(location.sessionId&&!state?.sessions.some(session=>session.id===location.sessionId))return;
    historyReplay.current=true;historyIndex.current=index;
    if(location.sessionId!==selectedId){setWorkspaceKey(++workspaceEpoch.current);pendingCreation.current=null;}
    setSelectedId(location.sessionId);setView(location.view);setSettingsTab(location.tab);setHistoryRevision(value=>value+1);
  };
  const openSettings=(tab?:SettingsTab)=>{if(tab)setSettingsTab(tab);setView('settings');setShowArchive(false);};
  commandRef.current=command=>{
    if(document.querySelector('[role="dialog"]'))return;
    switch(command){
      case 'new-session':newSession();break;
      case 'new-project':openProject();break;
      case 'settings':openSettings();break;
      case 'shortcuts':case 'capabilities':case 'about':openSettings(command);break;
      case 'toggle-sidebar':if(view==='workspace')setSidebarCompact(!sidebarLayout.compact);break;
      case 'search':setView('workspace');setSidebarCompact(false);window.dispatchEvent(new Event('workbench-search'));break;
      case 'back':moveHistory(-1);break;
      case 'forward':moveHistory(1);break;
      case 'archive-session':if(selected)void updateSession(selected.id,{archived:true});break;
      case 'delete-session':if(selected)setSidebarConfirmation({kind:'session-delete',session:selected});break;
      case 'pin-session':if(selected)void updateSession(selected.id,{pinned:!selected.pinned});break;
      case 'unread-session':if(selected)void updateSession(selected.id,{unread:true});break;
      case 'focus-composer':setView('workspace');requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')?.focus());break;
      case 'zoom-in':case 'zoom-out':case 'zoom-reset':case 'fullscreen':case 'close-window':case 'quit-app':
      case 'menu-file':case 'menu-edit':case 'menu-view':case 'menu-help':return api<void>('desktop/action',{id:command});
    }
  };
  return <div className="desktop-frame"><DesktopUpdate/><UiPreferenceStatus/><PluginAppearanceLayer/><ImageViewerHost/><TitleBar back={historyIndex.current>0} forward={historyIndex.current<history.current.length-1} onBack={()=>moveHistory(-1)} onForward={()=>moveHistory(1)} sidebarCompact={sidebarLayout.compact} sidebarAvailable={view==='workspace'} onToggleSidebar={()=>commandRef.current('toggle-sidebar')} report={report}/><div className="app-shell">
    <SidebarFrame layout={sidebarLayout} onWidth={setSidebarWidth} hidden={view==='settings'}><Sidebar state={state} selectedId={selectedId} view={view} archived={false} compact={sidebarLayout.compact} onExpand={()=>setSidebarCompact(false)} onSelect={selectSession} onView={next => { if(next==='settings')openSettings();else setView(next); }} onArchive={() => openSettings('archive')} onNew={newSession} onProject={openProject} onRename={session => openDialog('rename', session)} onGroup={session => openDialog('group', session)} onUpdate={updateSession} onUpdateProject={updateProject} onArchiveProject={project=>void mutateProject(project,false)} onRemoveProject={project=>void mutateProject(project,true)} onDeleteSession={session=>setSidebarConfirmation({kind:'session-delete',session})} onFork={forkSession} forkingId={forkingId} onTheme={theme} report={report} notify={notify} /></SidebarFrame>
    <main className="main-panel">
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}
      <div hidden={view !== 'workspace'} style={{ display: view === 'workspace' ? 'contents' : 'none' }}><Workspace repairDraft={repairDraft} onRepairDraftApplied={repairDraftApplied} onRememberModel={rememberModel} key={workspaceKey} active={view === 'workspace'} state={state} session={selected} draft={newDraft} onDraftChange={setNewDraft} onSwitchDraft={switchDraft} onCreateProject={() => openProject(undefined, true)} ensureSession={ensureSession} onFork={forkSession} forkingId={forkingId} onOpenSource={openBranchSource} focusMessageId={messageLocation?.sessionId===selectedId?messageLocation.messageId:undefined} report={report} notify={notify} refresh={refresh} /></div>
      {view === 'settings' && state && <SettingsLayout state={state} refresh={refresh} report={report} notify={notify} tab={settingsTab} onTab={setSettingsTab} onBack={()=>setView('workspace')} onSelect={selectSession} onUpdate={updateSession} onDelete={session=>setSidebarConfirmation({kind:'session-delete',session})}/>}
      {!state && view !== 'workspace' && <div className="empty-state"><Mark /><h2>等待桌面服务</h2><p>请从桌面应用打开工作台。</p></div>}
    </main>
    {forkRequest&&state?.sessions.find(item=>item.id===forkRequest.sessionId)&&<ForkDialog session={state.sessions.find(item=>item.id===forkRequest.sessionId)!} messageId={forkRequest.messageId} initialOptions={forkRequest.options} busy={!!forkingId} error={forkError} onChoose={location=>void forkSession(forkRequest.sessionId,forkRequest.messageId,location)} onClose={()=>{if(!forkPending.current)setForkRequest(null);}}/>}
    {(notice||sidebarUndo)&&<div className="toast" role="status" data-workbench-sidebar-undo={sidebarUndo?'':undefined}><Icon name="check" size={16}/>{sidebarUndo?.label??notice}{sidebarUndo&&<><button className="text-button" data-testid="sidebar-undo" onClick={()=>void undoProject()}>撤销</button><button className="icon-button" aria-label="关闭撤销提示" onClick={()=>setSidebarUndo(undefined)}><Icon name="close" size={14}/></button></>}</div>}
    {sidebarConfirmation && <Modal title="永久删除会话" onClose={()=>{if(!confirmingSidebar)setSidebarConfirmation(null);}}><form onSubmit={event=>{event.preventDefault();void confirmSidebar();}}><p>{`永久删除「${sidebarConfirmation.session.title}」的本机会话、消息和译文？此操作不可撤销，不删除项目文件或远端原生历史。${sidebarConfirmation.session.status==='uncertain'?' 当前回合结果仍未知；确认删除将丢弃本地记录，不会重发旧请求，也不能撤销已经发生的原生操作。':''}`}</p><div className="modal-actions"><button type="button" className="button secondary" disabled={confirmingSidebar} onClick={()=>setSidebarConfirmation(null)}>取消</button><button data-testid="confirm-sidebar-action" className="button primary" disabled={confirmingSidebar}>{confirmingSidebar?'处理中…':'永久删除'}</button></div></form></Modal>}
    {(dialog==='project'||dialog==='project-edit')&&<ProjectDialog editing={dialog==='project-edit'} builtin={editingProjectId===RECENT_PROJECT_ID&&dialog==='project-edit'} name={formName} paths={formPaths} saving={saving} picking={pickingFolders} onName={setFormName} onPaths={setFormPaths} onAdd={()=>void addFolders()} onClose={closeDialog} onSave={()=>void saveDialog()} onRemove={()=>{const project=state?(editingProjectId===RECENT_PROJECT_ID?recentProject(state):state.projects.find(item=>item.id===editingProjectId)):undefined;if(project){closeDialog();void mutateProject(project,true);}}}/>}
    {(dialog==='rename'||dialog==='group') && <Modal title={dialog==='rename'?'重命名会话':'移动到分组'} onClose={closeDialog}><form onSubmit={e => { e.preventDefault(); saveDialog(); }}>
      {dialog === 'rename' && <Field label="会话标题"><input autoFocus required value={formName} onChange={e => setFormName(e.target.value)} /></Field>}
      {dialog === 'group' && <Field label="分组名称" hint="留空将会话移回所属项目或无项目会话区。"><input autoFocus value={formGroup} onChange={e => setFormGroup(e.target.value)} /></Field>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={closeDialog}>取消</button><button data-testid="save-dialog" className="button primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div>
    </form></Modal>}
  </div></div>;
}
