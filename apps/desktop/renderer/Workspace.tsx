import {AnnotationCapsule,SelectionAnnotations,useContextAnnotations} from './ContextAnnotations';
import type {DraftRecovery} from '../../../packages/session-core/draft-recovery';
import {annotationsNeedInputTranslation} from '../../../packages/context-annotations';
import {annotationController} from './annotation-controller';
import {annotationPrompt,annotationBody,type ContextAnnotation} from '../../../packages/context-annotations';
import {FollowUpQueue} from './FollowUps';
import {coreFollowUpModes,followUpAction} from '../../../packages/session-core/follow-ups';
import {RememberedDetails,UiMemoryScope} from './UiMemory';
import {useUiPreference} from './ui-preferences';
import { shortcuts } from './shortcuts';
import LocalAccountSelector from './LocalAccountSelector';
import { localModelBinding } from '../../../packages/model-management/types';
import './PlanMode.css';
import { isPluginRuntime } from '../../../packages/runtime-extensions/types';
import PluginModelControls from './PluginModelControls';
import type { ForkLocation } from '../../../packages/contracts';
import BranchOrigin from './BranchOrigin';
import { useComposerMenu, SkillTokens } from './ComposerMenu';
import type { SkillInvocation } from '../../../packages/native-skills/invocation';
import { skillPrompt, skillBody } from '../../../packages/composer-core';
import ConversationReading, {type ConversationReadingHandle} from './ConversationReading';
import {flushSync} from 'react-dom';
import { rememberedPermission } from '../../../packages/session-core/permissions';
import { visibleReply, replyMemoryReferences } from '../../../packages/session-core/memory-citations';
import ReplyMemory from './ReplyMemory';
import {useComposerSize} from './useComposerSize';
import './SessionControls.css';
import './ComposerControls.css';
import SessionMetrics from './SessionMetrics';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppState, DraftPreview, Message, NewSessionDraft, PermissionMode, Session } from '../../../packages/contracts';
import { useAttachments, AttachmentList } from './Attachments';
import type { Attachment } from '../../../packages/attachments/types';
import { api } from './App';
import { sessionFolder, projectFolders } from './Sidebar';
import { Icon, Modal, errorText } from './ui';
import PreviewModal from './PreviewModal';
import MessageText from './MessageText';
import ProjectPicker from './ProjectPicker';
import SelectMenu from './SelectMenu';
import FileBrowser from './FileBrowser';
import ModelControls from './ModelControls';
import type { ModelTarget } from '../../../packages/model-api/types';
import type { FileReference } from '../../../packages/navigation/file-links';
import type { NativeModelSelection } from '../../../packages/contracts';
import PermissionSelector from './PermissionSelector';
import NativeApprovals from './NativeApprovals';
import PlanReader,{CodexPlanActions} from './PlanReader';
import type {PlanReference} from '../../../packages/session-core/plan-review';
import { markdownBlocks } from '../../../packages/message-markdown';
import AccountSelector from './AccountSelector';
import { selectedSharedAccountRef } from '../../../packages/account-selection';
import { preparedDraftAction, translationFlowPolicy } from './translation-flow';
import { translationModuleEnabled, translationQuickToggleVisible } from '../../../packages/translation/settings';
import { conversationTimeline } from '../../../packages/collaboration-core/timeline';
import RuntimeTimelineEntry from './RuntimeTimeline';
import { hasNativeBackground } from '../../../packages/native-events/semantics';
import NativeChildConversation from './NativeChildConversation';
import { BilingualMessageActions, TranslationAction } from './TranslationDisplay';
import { translationPlacement, translationTrackingEnabled } from '../../../packages/translation/display';
import { coreTranslationLayouts } from '../../../packages/translation/layouts';
import FileChangeCard from './FileChangeCard';
import FileChangeReview from './FileChangeReview';
import {readingTurns} from '../../../packages/collaboration-core/reading-turns';
import {mergeTurnFileChanges} from '../../../packages/collaboration-core/file-changes';
import {forkEligibility} from '../../../packages/session-core/fork';
import './SessionBranch.css';
import type { LocalCli } from '../../../packages/native-runtime/cli';
import QuestionInbox from './QuestionInbox';
import { asyncQuestionState } from '../../../packages/native-interactions/inbox';
import NativeInteractions, { NativePlanView, AsyncQuestions, NativeInteractionHistory } from './NativeInteractions';

interface Props { repairDraft?:{id:string;text:string};onRepairDraftApplied?:(id:string)=>void; onRememberModel?:(value:Pick<NewSessionDraft,'runtime'|'modelTargetId'|'modelSelection'|'hostId'>)=>void; onFork:(sessionId:string,messageId?:string,location?:ForkLocation)=>Promise<void>;forkingId:string;onOpenSource:(id:string,messageId?:string)=>void;focusMessageId?:string; state: AppState | null; session?: Session; active?: boolean; draft: NewSessionDraft; onDraftChange: React.Dispatch<React.SetStateAction<NewSessionDraft>>; onSwitchDraft: (draft: NewSessionDraft, rememberRuntime?: boolean) => void; onCreateProject: () => void; ensureSession: (draft: NewSessionDraft) => Promise<Session>; report: (error: unknown) => void; notify: (message: string) => void; refresh: () => Promise<AppState> }
const statuses: Record<string, string> = { idle: '就绪', running: '运行中', blocked: '未完成原生验收', uncertain: '回执待确认', stopped: '已停止', cancelled: '已取消' };
/** Paragraph delimiters remain in each chunk; copying always uses the immutable source. */
const paragraphs = markdownBlocks;
function pairBlocks(sourceText: string, chineseText?: string) {
  const source = paragraphs(sourceText); const translated = chineseText ? paragraphs(chineseText) : [];
  return translated.length && source.length === translated.length ? { source, translated, aligned: true } : { source: [sourceText], translated: [chineseText ?? ''], aligned: false };
}
const blockCache=new WeakMap<Message,ReturnType<typeof pairBlocks>>();
const blocks = (message: Message) => {
  let value=blockCache.get(message);
  if(!value){value=message.role==='user'?pairBlocks(annotationBody(skillBody(message.submitted??message.original,message.skills),message.annotations),message.original):pairBlocks(visibleReply(message.original),message.translation);blockCache.set(message,value);}
  return value;
};
const localDraftLabel = (text: string) => /\p{Script=Han}/u.test(text) ? '中文原稿 · 本地保存' : '用户原稿 · 本地保存';

export default function Workspace({ repairDraft,onRepairDraftApplied,onRememberModel, state, session, active = true, draft, onDraftChange, onSwitchDraft, onCreateProject, ensureSession, onFork, forkingId, onOpenSource, focusMessageId, report, notify, refresh }: Props) {
  const preparationKey=JSON.stringify([session?.id,session?.binding,session?.modelSelection,session?.permissionMode,session?.projectPath]);
  useEffect(()=>{if(active&&session&&!session.archived&&['idle','blocked'].includes(session.status)){const timer=setTimeout(()=>{void api('session/prepare-runtime',{sessionId:session.id}).catch(()=>{});},250);return()=>clearTimeout(timer);}},[active,preparationKey,session?.status]);
  const [activeQuestion,setActiveQuestion]=useState<string|null>(null);const activeQuestionRef=useRef<string|null>(null);
  const questionBusy=(id:string,value:boolean)=>{if(value){activeQuestionRef.current=id;setActiveQuestion(id);}else if(activeQuestionRef.current===id){activeQuestionRef.current=null;setActiveQuestion(null);}};
  const translationPolicy = translationFlowPolicy(state); const translationEnabled = translationPolicy.enabled;
  const translationModuleOn = !!state && translationModuleEnabled(state);
  const showTranslationQuickToggle = translationQuickToggleVisible(state);
  const translationPolicyRef = useRef(translationPolicy); translationPolicyRef.current = translationPolicy;
  const previousTranslationPolicy = useRef(state ? translationPolicy.key : null);
  const [text, setText] = useState(session?.forkDraft??(!session?repairDraft?.text:undefined)??''); const [preview, setPreview] = useState<DraftPreview | null>(null); const [busy, setBusy] = useState(false); const [submitting, setSubmitting] = useState(false); const [draftError, setDraftError] = useState(''); const [isDemoSample, setIsDemoSample] = useState(false);
  const [skills,setSkills]=useState<(SkillInvocation&{icon?:string})[]>(session?.forkSkills??[]);
  const [statusOpen,setStatusOpen]=useState(false);
  const skillScope=useRef(`${session?.binding.runtime??draft.runtime}:${session?.projectPath??draft.projectPath}`);
  useEffect(()=>{const next=`${session?.binding.runtime??draft.runtime}:${session?.projectPath??draft.projectPath}`;if(skillScope.current!==next){skillScope.current=next;setSkills([]);}},[session?.binding.runtime,draft.runtime,session?.projectPath,draft.projectPath]);
  const [revisionRequired, setRevisionRequired] = useState(false);
  const [choosingRuntime,setChoosingRuntime]=useState<NewSessionDraft['runtime']>();
  const runtimeChoice=useRef(0),runtimeChoosing=useRef(false);
  useEffect(()=>()=>{++runtimeChoice.current;runtimeChoosing.current=false;setChoosingRuntime(undefined);},[session?.id,draft.projectId,draft.projectPath,active]);
  const [localClis, setLocalClis] = useState<LocalCli[] | null>(null);
  useEffect(() => {
    let mounted = true, reading = false;
    const update = async () => { if (reading || !active) return; reading = true; try { const [local] = await Promise.allSettled([api<LocalCli[]>('local-cli/list'),api('runtime/catalog')]); if (mounted&&local.status==='fulfilled') setLocalClis(local.value); } catch { /* A failed discovery must not be treated as an uninstall. */ } finally { reading = false; } };
    void update(); const unsubscribe=window.workbench.onExtensions?.(update); const timer = setInterval(() => void update(), 10000); window.addEventListener('focus', update); window.addEventListener('local-cli-changed', update);
    return () => { mounted = false; unsubscribe?.(); clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('local-cli-changed', update); };
  }, [active]);
  const [intermediateSaving,setIntermediateSaving]=useState(false);
  const [preferredFilePaneWidth,setFilePaneWidth] = useUiPreference<number>('workspace.reader-width');
  const [filePaneMax,setFilePaneMax] = useState(555);
  const filePaneWidth=Math.min(filePaneMax,preferredFilePaneWidth);
  const contentRef = useRef<HTMLDivElement>(null);
  const [reader,setReader]=useState<{type:'file';reference:FileReference}|{type:'child';sessionId:string;childId?:string;toolCallId?:string}|{type:'plan';reference:PlanReference}|{type:'changes';turnId:string;path:string}>();
  const readerTrigger=useRef<HTMLElement|null>(null);
  const fileReference=reader?.type==='file'?reader.reference:null;
  const closeReader=()=>{setReader(undefined);requestAnimationFrame(()=>readerTrigger.current?.isConnected&&readerTrigger.current.focus());};
  const setFileReference=(reference:FileReference|null)=>{if(reference){readerTrigger.current=document.activeElement as HTMLElement;setReader({type:'file',reference});}else closeReader();};
  const openChild=(sessionId:string,childId?:string)=>{if(!reader)readerTrigger.current=document.activeElement as HTMLElement;setReader({type:'child',sessionId,childId,toolCallId:state?.sessions.find(item=>item.id===sessionId)?.nativeChildren?.find(item=>item.nativeChildId===childId)?.toolCallId});};
  const openPlan=(reference:PlanReference)=>{if(!reader)readerTrigger.current=document.activeElement as HTMLElement;setReader({type:'plan',reference});};
  const openChanges=(turnId:string,path:string)=>{if(!reader)readerTrigger.current=document.activeElement as HTMLElement;setReader({type:'changes',turnId,path});};
  const closeChanges=(turnId:string)=>setReader(current=>current?.type==='changes'&&current.turnId===turnId?undefined:current);
  useEffect(()=>{setReader(current=>current?.type==='plan'?undefined:current);},[session?.binding.runtime,session?.modelTargetId]);
  const beforeEdit = useRef<{ annotations:ContextAnnotation[]; attachments:Attachment[]; skills:SkillInvocation[]; text: string; isDemoSample: boolean; revisionRequired: boolean } | null>(null);
  const [modelSaving,setModelSaving]=useState(false); const modelSavingRef=useRef(false);

  const [translationSaving, setTranslationSaving] = useState(false);
  const translationSavingRef = useRef(false);
  const [reviewOpen, setReviewOpen] = useState(false); const [reviewSnapshot, setReviewSnapshot] = useState<DraftPreview | null>(null); const [autoSaving, setAutoSaving] = useState(false); const [stopping, setStopping] = useState(false); const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followOutput = useRef(true);
  const readingRef=useRef<ConversationReadingHandle>(null);
  const composing = useRef(false);
  const [showTranslation, setShowTranslation] = useState(translationEnabled && !!session?.messages.length && window.innerWidth >= 980); const [compact, setCompact] = useState(false); const [preferredLeftWidth, setLeftWidth] = useUiPreference<number>('workspace.split'); const [activeBlock, setActiveBlock] = useState<string | null>(null); const [retrying, setRetrying] = useState<Set<string>>(new Set()); const [progressIds,setProgressIds]=useUiPreference<string[]>('workspace.progress-expanded',session?.id??'draft'); const showProgress=new Set(progressIds);
  const [resizeBounds, setResizeBounds] = useState({ min: 300 / 900 * 100, max: 611 / 900 * 100 });
  const leftWidth=Math.max(resizeBounds.min,Math.min(resizeBounds.max,preferredLeftWidth));
  const [translationPreference,setTranslationPreference]=useUiPreference<boolean|null>('workspace.translation-visible');
  useEffect(()=>{if(translationPreference!==null){translationChoice.current=true;setShowTranslation(translationPreference);}},[translationPreference]);
  const [creating, setCreating] = useState(false); const [permissionSaving, setPermissionSaving] = useState(false); const permissionSavingRef = useRef(false);
  const activeSession = useRef(session); const preparingRef = useRef(false); const submittingRef = useRef(false); const translationChoice = useRef(false);
  if (session) activeSession.current = session;
  const generation = useRef(0); const pendingId = useRef<string | null>(null); const previewRef = useRef<DraftPreview | null>(null); const splitRef = useRef<HTMLDivElement>(null); const originalRef = useRef<HTMLDivElement>(null); const translationRef = useRef<HTMLDivElement>(null); const dragActive = useRef(false);
  const [activeProgressTarget, setActiveProgressTarget] = useState<HTMLDivElement | null>(null);
  const previewPolicyRef = useRef<string | null>(null);
  const projectId = session ? session.projectId : draft.projectId;
  const project = state?.projects.find(p=>p.id===projectId); const messages = session?.messages ?? [];
  const hasTranslationHistory = messages.some(message => !!message.translation || !!message.progressTranslation || (message.role === 'user' && !!message.submitted && message.submitted !== message.original));
  const runtime = session?.binding.runtime ?? draft.runtime;
  const runtimePlugin=state?.runtimeExtensions?.find(r=>r.id===runtime);
  const canSteer=['codex','api'].includes(runtime)||runtime==='claude'&&!!session&&localModelBinding(session.binding)||!!runtimePlugin?.capabilities.steer;
  const [followUpMode]=useUiPreference<string>('composer.follow-up');
  const followUp=followUpAction(state?.followUpModes??coreFollowUpModes,followUpMode,canSteer);
  const followUpLabel=followUp==='queue'?'加入队列':'引导当前任务';
  const pluginUnavailable=isPluginRuntime(runtime)&&(!runtimePlugin?.ready||!!session&&runtimePlugin.owner!==session.pluginRuntime?.owner);
  const providerSelected = !!session && localModelBinding(session.binding) || !session && /^(api|account)\//.test(draft.modelTargetId??'');
  const workspaceHostId = providerSelected || isPluginRuntime(runtime) ? undefined : session?.binding.hostId ?? draft.hostId ?? state?.activeWorkspaceId;
  // A new API-backed draft may still choose its workspace's native account.
  const accountHostId = isPluginRuntime(runtime) || !session && draft.modelTargetId?.startsWith('account/') ? undefined : session ? session.binding.hostId : draft.hostId ?? state?.activeWorkspaceId;
  const nativeReady = isPluginRuntime(runtime)?!!runtimePlugin?.ready&&!!runtimePlugin.capabilities.resume:runtime==='codex' && (session?.nativeReady ?? state?.nativeCodexBindings?.some(item=>item.hostId===workspaceHostId));

  const [reconciling,setReconciling]=useState(false);
  const layoutMode=(state?.translationLayouts??coreTranslationLayouts).find(item=>item.id===(state?.translationLayout??'panel'))?.mode??'panel';
  const placement=translationPlacement(layoutMode,!!reader,!!session?.agentParent);
  const translatedOnly=placement==='translated-only';
  const inlineTranslations=placement==='inline',translationVisible=showTranslation&&placement==='panel';
  const trackingEnabled=translationTrackingEnabled(placement,translationVisible,compact);
  const trackingCurrent=useRef(trackingEnabled);trackingCurrent.current=trackingEnabled;
  useLayoutEffect(()=>{if(!trackingEnabled)setActiveBlock(null);},[trackingEnabled]);
  const childReaderSession=reader?.type==='child'?state?.sessions.find(item=>item.id===reader.sessionId):undefined;
  const conversationEntries=useMemo(()=>session?conversationTimeline(session,state?.collaboration?.messages,state?.sessions):[],[session,state?.collaboration?.messages,state?.sessions]);
  const changeTurn=reader?.type==='changes'&&session?readingTurns(conversationEntries,session).find(turn=>turn.id===reader.turnId):undefined;
  const reviewChanges=changeTurn?mergeTurnFileChanges(changeTurn.answers.flatMap(item=>item.type==='changes'?[item.changes]:[]),changeTurn.id):undefined;
  const [migrating,setMigrating]=useState(false);
  const migrateNative=async()=>{if(!session||migrating)return;setMigrating(true);try{await api('session/migrate-native',{sessionId:session.id});notify('原账号与历史迁移回执已核实；执行仍使用独立的原生验收。');}catch(error){report(error);}finally{setMigrating(false);}};

  const reconcileNative=async()=>{if(!session||reconciling)return;setReconciling(true);try{await api('session/reconcile',{sessionId:session.id});notify('已读取原生回合结果，没有重发请求。');}catch(error){report(error);}finally{setReconciling(false);}};
  const [accountPending, setAccountPending] = useState(false);
  const accountPendingRef = useRef(false);
  useEffect(() => { accountPendingRef.current = false; setAccountPending(false); }, [workspaceHostId, runtime]);
  const workingFolder = session ? sessionFolder(session) ?? '' : draft.projectPath;
  const bindingLocked = !!choosingRuntime || !!activeQuestion || creating || submitting || permissionSaving || accountPending || modelSaving || busy || !!preview || session?.status==='running' || session?.status==='uncertain';
  const permissionLocked = !!activeQuestion || !state || creating || permissionSaving || submitting || busy || session?.status==='uncertain' || isPluginRuntime(runtime)&&session?.status==='running'&&!runtimePlugin?.capabilities.permissions;
  const autoSubmit = (state as (AppState & { autoSubmitTranslated?: boolean }) | null)?.autoSubmitTranslated ?? false;
  const autoSubmitRef = useRef(autoSubmit);
  autoSubmitRef.current = autoSubmit;
  useEffect(() => { const container=contentRef.current; if(!container)return; const observer=new ResizeObserver(()=>{const max=Math.max(260,container.clientWidth-345);setFilePaneMax(max);});observer.observe(container);return()=>observer.disconnect(); }, []);
  useEffect(() => { const container = splitRef.current; if (!container) return; const observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width ?? container.clientWidth; setCompact(width < 650); if (width >= 650) { const min = 300 / width * 100, max = (width - 289) / width * 100; setResizeBounds({ min, max }); } }); observer.observe(container); return () => observer.disconnect(); }, []);
  useEffect(() => { if (translationEnabled && messages.length && !translationChoice.current && window.innerWidth >= 980) setShowTranslation(true); }, [messages.length, translationEnabled]);
  useLayoutEffect(() => { splitRef.current?.style.setProperty('--original-width', `${leftWidth}%`); }, [leftWidth]);
  const cancel = () => { generation.current++; preparingRef.current = false; if (previewRef.current) api('draft/cancel', { id: previewRef.current.id }).catch(report); if (pendingId.current) api('draft/cancel', { requestId: pendingId.current }).catch(report); pendingId.current = null; previewRef.current = null; previewPolicyRef.current = null; setPreview(null); setBusy(false); };
  const newlineRef=useRef<()=>void>(()=>{});
  newlineRef.current=()=>{
    const input=composerRef.current;if(!active||!input||input.disabled||composing.current)throw Error('SHORTCUT_UNAVAILABLE');
    const start=input.selectionStart,end=input.selectionEnd;
    input.focus();
    // Native insertion retains the textarea undo stack and normal input handling.
    if(document.execCommand('insertText',false,'\n'))return;
    if(previewRef.current)setRevisionRequired(true);cancel();
    setText(input.value.slice(0,start)+'\n'+input.value.slice(end));setIsDemoSample(false);setDraftError('');
    requestAnimationFrame(()=>{if(composerRef.current===input){input.focus();input.setSelectionRange(start+1,start+1);}});
  };
  useEffect(()=>{if(active)return shortcuts.bind('composer',id=>{if(id==='composer-newline')newlineRef.current();});},[active]);
  useLayoutEffect(() => {
    if (!state) return;
    const previous = previousTranslationPolicy.current; previousTranslationPolicy.current = translationPolicy.key;
    if (!translationEnabled) setShowTranslation(false);
    if (previous === null || previous === translationPolicy.key) return;
    // Submission already handed to the host keeps its acknowledgement lifecycle; the host rechecks policy.
    if (submittingRef.current) return;
    const hadDraftWork = !!pendingId.current || !!previewRef.current || reviewOpen;
    cancel(); setReviewOpen(false); setReviewSnapshot(null); setRevisionRequired(false);
    if (hadDraftWork) setDraftError(translationEnabled ? '翻译设置已更新，草稿已保留，请重新发送。' : translationModuleOn ? '翻译已临时暂停，草稿已保留，请重新发送。' : '翻译模块已关闭，草稿已保留，请重新发送。');
  }, [translationPolicy.key]);
  useLayoutEffect(() => {
    if (active || submittingRef.current) return;
    cancel(); setReviewOpen(false); setReviewSnapshot(null);
  }, [active]);
  const appliedRepair=useRef('');
  useEffect(()=>{
    if(repairDraft&&!session&&appliedRepair.current!==repairDraft.id&&composerRef.current?.value===repairDraft.text){appliedRepair.current=repairDraft.id;onRepairDraftApplied?.(repairDraft.id);}
  },[repairDraft?.id,session?.id,text]);
  // App keys genuine navigation separately from lazy creation, so creation never clears a live draft.
  useEffect(() => { if (state && active) composerRef.current?.focus(); }, [!!state, active]);
  useEffect(() => () => { generation.current++; if (pendingId.current) api('draft/cancel', { requestId: pendingId.current }).catch(report); if (previewRef.current) api('draft/cancel', { id: previewRef.current.id }).catch(report); pendingId.current = null; }, []);
  useLayoutEffect(() => {
    const element = originalRef.current;
    if (!element || !followOutput.current) return;
    // Avoid a layout write when the pane is already at the bottom. This runs
    // for every streamed delta, so the guard matters during long responses.
    const bottom = element.scrollHeight - element.clientHeight;
    if (Math.abs(element.scrollTop - bottom) > 1) element.scrollTop = bottom;
  }, [session?.messages.length, session?.messages.at(-1)?.original, session?.activities?.length, session?.activities?.at(-1)?.updatedAt,session?.nativeInteractions?.length]);
  const updateFollowOutput = (element: HTMLDivElement) => {
    followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  };
  const handleOriginalWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // Capture upward intent before Chromium dispatches the follow-up scroll
    // event. A streamed delta can otherwise win the race and pull the pane
    // back to the bottom while the user is trying to read older output.
    if (event.deltaY < 0) followOutput.current = false;
  };
  useEffect(() => { if (translationRef.current) translationRef.current.scrollTop = translationRef.current.scrollHeight; }, [session?.messages.length]);
  const attachments=useAttachments(session?.forkAttachments??[],submitting||!active||!state,()=>{cancel();setReviewOpen(false);setReviewSnapshot(null);setDraftError('');},error=>setDraftError(errorText(error)));
  const annotations=useContextAnnotations(session,active,submitting||!state,()=>{cancel();setReviewOpen(false);setReviewSnapshot(null);},report,translationEnabled?translationPolicy.key:undefined);
  const recoverySeen=useRef(new Set<string>()),restoredRecovery=useRef<string|undefined>(undefined);
  const recoverDraft=(entry:DraftRecovery)=>{
    const original=entry.preview;
    cancel();setReviewOpen(false);setReviewSnapshot(null);
    setText(current=>current&&current!==original.original?current+'\n\n'+original.original:original.original);
    setSkills(current=>[...current,...(original.skills??[]).filter(item=>!current.some(existing=>existing.id===item.id))]);
    attachments.replace([...attachments.items,...(original.attachments??[]).filter(item=>!attachments.items.some(existing=>existing.id===item.id))]);
    if(original.annotations?.some(item=>!annotations.items.some(existing=>existing.id===item.id)))void annotations.write([...annotations.items,...original.annotations.filter(item=>!annotations.items.some(existing=>existing.id===item.id))]).catch(report);
    restoredRecovery.current=entry.id;recoverySeen.current.add(entry.id);
    setRevisionRequired(true);setIsDemoSample(false);setDraftError(entry.outcome==='not-sent'?'本次内容未发出，已恢复原稿，请编辑后重新发送。':'已恢复原稿。原请求可能已被处理，请先检查回执；不会自动重发。');
    requestAnimationFrame(()=>composerRef.current?.focus());
  };
  useEffect(()=>{
    if(!active||submitting||busy||annotations.busy||attachments.busy)return;
    for(const entry of session?.draftRecoveries??[]){
      if(entry.outcome==='pending'||recoverySeen.current.has(entry.id))continue;
      recoverySeen.current.add(entry.id);
      if((entry.outcome==='not-sent'||entry.outcome==='failed')&&!text&&!skills.length&&!attachments.items.length&&!annotations.items.length){recoverDraft(entry);break;}
    }
  },[active,submitting,busy,session?.draftRecoveries,annotations.busy,attachments.busy]);
  useComposerSize(composerRef,text,[active,attachments.items.length,skills.length,!!preview].join(':'));
  const prepare = async (bypass = false, invertFollowUp = false, confirmOriginal = false) => {
    if (runtimeChoosing.current || (!session && runtime==='demo') || activeQuestionRef.current || !active || !state || (!text.trim()&&!attachments.items.length&&!skills.length&&!annotations.items.length) || annotations.busy || attachments.pending.current || previewRef.current || preparingRef.current || submittingRef.current || permissionSavingRef.current || accountPendingRef.current || modelSavingRef.current || busy || submitting || stopping || (activeSession.current?.status === 'running' && !activeSession.current.nativeTurnId) || (bypass && revisionRequired && !confirmOriginal)) return;
    if (!activeSession.current && !isPluginRuntime(draft.runtime) && draft.runtime !== 'demo' && draft.runtime !== 'api' && !/^(api|account)\//.test(draft.modelTargetId??'') && !draft.hostId && !state?.activeWorkspaceId) { setDraftError('请先到 SSH 页面选择本机使用的成员工作空间。'); return; }
    const requestedPolicy = translationPolicyRef.current;
    preparingRef.current = true; const sequence = ++generation.current; const requestId = crypto.randomUUID(); pendingId.current = requestId; setBusy(true); setDraftError(''); setPreview(null);
    try {
      let target = activeSession.current;
      if (!target) { setCreating(true); try { target = await ensureSession(draft); activeSession.current = target; } finally { setCreating(false); } }
      if (sequence !== generation.current || requestedPolicy.key !== translationPolicyRef.current.key) return;
      const result = await api<DraftPreview>('draft/prepare', { sessionId: target.id, text, annotationRevision:session?annotations.revision:undefined, attachmentIds:attachments.items.map(a=>a.id), skills:skills.map(({id,hash})=>({id,hash})), followUpMode, invertFollowUp, demo: isDemoSample && !annotations.items.length && !bypass && requestedPolicy.enabled, bypass: bypass || !requestedPolicy.enabled, confirmOriginal, requestId });
      const action = preparedDraftAction({ requested: requestedPolicy, current: translationPolicyRef.current, preview: result, source: text, bypass, autoSubmit: autoSubmitRef.current });
      if (sequence !== generation.current || action === 'discard') { await api('draft/cancel', { id: result.id }); if (sequence === generation.current) setDraftError('发送设置已变化，草稿已保留，请重新发送。'); return; }
      previewRef.current = result; previewPolicyRef.current = requestedPolicy.key; setPreview(result); setRevisionRequired(false);
      if (action === 'submit-original') await submitDraft(result);
      else { setReviewSnapshot(result); if (action === 'submit-translated') await submitDraft(result, true); else setReviewOpen(true); }
    }
    catch (e) { if (sequence === generation.current) setDraftError(errorText(e)); }
    finally { if (sequence === generation.current) { preparingRef.current = false; setBusy(false); pendingId.current = null; } }
  };
  const submitDraft = async (item: DraftPreview, automatic = false) => {
    const target = activeSession.current; if (!target || submittingRef.current || previewRef.current?.id !== item.id) return;
    const currentPolicy = translationPolicyRef.current;
    const incompatiblePreview = currentPolicy.enabled ? !!item.moduleDisabled : !item.moduleDisabled || !item.bypass || skillPrompt(annotationPrompt(item.original,item.annotations),item.skills) !== item.translated;
    if (previewPolicyRef.current !== currentPolicy.key || incompatiblePreview) { cancel(); setReviewOpen(false); setReviewSnapshot(null); setDraftError('发送设置已变化，草稿已保留，请重新发送。'); return; }
    submittingRef.current = true; const sequence = generation.current; setSubmitting(true); setDraftError(''); setReviewOpen(false); setPreview(null); previewRef.current = null; previewPolicyRef.current = null;
    const recoveredId=restoredRecovery.current;
    const sent={text,skills,attachments:attachments.items,isDemoSample,editingMessageId,beforeEdit:beforeEdit.current};
    // The frozen preview owns this submission; native startup must not hold the editor contents.
    setText(''); setSkills([]); attachments.replace([]); setIsDemoSample(false); setRevisionRequired(false); setReviewSnapshot(null); setEditingMessageId(null); beforeEdit.current=null;
    let accepted=false;
    try { await api('draft/submit', { sessionId: target.id, id: item.id, sourceHash: item.sourceHash, automatic }); accepted=true; if(item.annotations?.length)await annotations.clearSubmitted(item.annotationRevision); if(recoveredId){await api('draft/recovery-dismiss',{sessionId:target.id,id:recoveredId}).catch(report);if(restoredRecovery.current===recoveredId)restoredRecovery.current=undefined;} await refresh(); }
    catch (e) { if (sequence === generation.current) { if(!accepted){setText(sent.text);setSkills(sent.skills);attachments.replace(sent.attachments);setIsDemoSample(sent.isDemoSample);setEditingMessageId(sent.editingMessageId);beforeEdit.current=sent.beforeEdit;} setDraftError(errorText(e)); setRevisionRequired(true); } } finally { submittingRef.current = false; setSubmitting(false); }
  };
  const submit = async () => { if (preview && !revisionRequired) await submitDraft(preview); };
  const editDraft = () => { if (submitting) return; const original = previewRef.current?.original ?? text; cancel(); setText(original); setReviewOpen(false); setReviewSnapshot(null); setIsDemoSample(false); setRevisionRequired(true); setDraftError(''); if (compact) setShowTranslation(false); requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(original.length, original.length); }); };
  const setAutoSubmit = async (enabled: boolean) => { if (!translationPolicyRef.current.enabled) return; setAutoSaving(true); try { await api('translation/auto-submit', { enabled }); await refresh(); } catch (e) { report(e); } finally { setAutoSaving(false); } };
  const setTranslationEnabled = async (enabled: boolean) => {
    if (translationSavingRef.current) return;
    translationSavingRef.current = true; setTranslationSaving(true);
    try { await api('translation/quick-toggle', { paused: !enabled }); await refresh(); }
    catch (error) { report(error); }
    finally { translationSavingRef.current = false; setTranslationSaving(false); }
  };
  const stopWork = async () => { if (stopping) return; const target = activeSession.current; const running = target?.status === 'running' || submitting; cancel(); if (!running || !target) { setDraftError(''); return; } setStopping(true); try { await api<{ stopped: boolean; reason?: string }>('session/stop', { sessionId: target.id }); setDraftError(''); await refresh(); } catch (e) { report(e); } finally { setStopping(false); } };
  const planMode = runtime === 'codex' && (session?.collaborationMode ?? draft.collaborationMode) === 'plan';
  const changeCollaboration = async () => {
    if (bindingLocked || permissionSavingRef.current) return;
    const mode = planMode ? 'default' : 'plan';
    permissionSavingRef.current = true; setPermissionSaving(true);
    try { cancel(); if (session) { await api('session/collaboration', {sessionId:session.id,mode}); await refresh(); } else onDraftChange(current=>({...current,collaborationMode:mode})); }
    catch(error) { report(error); }
    finally { permissionSavingRef.current = false; setPermissionSaving(false); }
  };
  const changePermission = async (permissionMode: PermissionMode) => {
    if (permissionLocked || permissionSavingRef.current) return;
    const target = activeSession.current;
    permissionSavingRef.current = true; setPermissionSaving(true);
    try { await api(target?'session/permissions':'permissions/remember',target?{sessionId:target.id,permissionMode}:{projectId:draft.projectId,runtime,permissionMode});await refresh();if(!target)onDraftChange(current=>({...current,permissionMode}));if(target?.status==='running'&&runtime==='api')notify('权限已更新，后续工具执行前会重新检查。'); }
    catch (error) { report(error); }
    finally { permissionSavingRef.current = false; setPermissionSaving(false); }
  };
  const editMessage = async (message: Message) => { if (annotations.busy || session?.status === 'running' || submitting) return; const originalDraft=beforeEdit.current??{ annotations:annotations.items, text, isDemoSample, revisionRequired,skills,attachments:attachments.items }; try{await annotations.write(message.annotations??[]);beforeEdit.current=originalDraft;}catch(error){report(error);return;} cancel(); attachments.replace(message.attachments??[]); setText(message.original); setSkills(message.skills??[]); setIsDemoSample(false); setRevisionRequired(true); setReviewOpen(false); setReviewSnapshot(null); setDraftError(''); setEditingMessageId(message.id); if (compact) setShowTranslation(false); requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(message.original.length, message.original.length); }); };
  const exitEditing = async () => {
    if (submitting || !editingMessageId) return;
    const saved = beforeEdit.current; try{await annotations.write(saved?.annotations??[]);}catch(error){report(error);return;} cancel(); attachments.replace(saved?.attachments??[]); setText(saved?.text ?? ''); setSkills(saved?.skills??[]); setIsDemoSample(saved?.isDemoSample ?? false); setRevisionRequired(saved?.revisionRequired ?? false);
    beforeEdit.current = null; setEditingMessageId(null); setReviewOpen(false); setReviewSnapshot(null); setDraftError(''); composerRef.current?.focus();
  };
  const switchIdentity = (nextRuntime: NewSessionDraft['runtime'], rememberRuntime = false, nextHostId = workspaceHostId) => {
    if (creating || submittingRef.current || permissionSavingRef.current || modelSavingRef.current) return;
    cancel(); setReviewOpen(false); setReviewSnapshot(null); setDraftError(''); setRevisionRequired(false); setEditingMessageId(null); beforeEdit.current = null;
    setFileReference(null); activeSession.current = undefined;
    onSwitchDraft({ projectId: session?.projectId ?? draft.projectId, projectPath: workingFolder, runtime: nextRuntime, hostId: nextRuntime === 'demo' || isPluginRuntime(nextRuntime) ? undefined : nextHostId, permissionMode: nextRuntime === runtime ? session?.permissionMode ?? draft.permissionMode : 'default' }, rememberRuntime);
    if (session) notify('已切换到新任务，草稿已保留。');
  };
  useEffect(() => {
    if (!session && localClis && !bindingLocked && !isPluginRuntime(draft.runtime) && draft.runtime !== 'demo' && draft.runtime !== 'api' && !localClis.some(item => item.installed && item.runtime === draft.runtime)) {
      switchIdentity(localClis.find(item => item.installed)?.runtime ?? 'demo');
    }
  }, [localClis, session?.id, draft.runtime, bindingLocked]);
  const switchTarget = async (target:ModelTarget, selection?:NativeModelSelection) => {
    if(bindingLocked || modelSavingRef.current)return;
    modelSavingRef.current=true;setModelSaving(true);
    try {
      if(session){await api('session/model-target',{sessionId:session.id,targetId:target.id,...(selection?{selection}:{})});const next=await refresh();activeSession.current=next.sessions.find(item=>item.id===session.id);onRememberModel?.({runtime:target.runtime,modelTargetId:target.id,hostId:target.binding.hostId,modelSelection:activeSession.current?.modelSelection??target.selection});notify('已切换模型，下一条消息沿用此会话历史');}
      else onSwitchDraft({projectId:draft.projectId,projectPath:workingFolder,runtime:target.runtime,hostId:target.binding.hostId,modelTargetId:target.id,modelSelection:selection??target.selection,permissionMode:rememberedPermission(state,draft.projectId,target.runtime)},true);
    }catch(error){report(error);}finally{modelSavingRef.current=false;setModelSaving(false);}
  };
  const changeModel = async (selection: NativeModelSelection) => {
    if (modelSavingRef.current) return;
    if (!session) { onDraftChange(current => ({ ...current, modelSelection: selection })); onRememberModel?.({...draft,modelSelection:selection}); return; }
    modelSavingRef.current = true; setModelSaving(true);
    try { await api('session/model', { sessionId: session.id, selection }); const next=await refresh(); const saved=next.sessions.find(item=>item.id===session.id)!;onRememberModel?.({runtime:saved.binding.runtime,modelTargetId:saved.modelTargetId,hostId:saved.binding.hostId,modelSelection:saved.modelSelection}); }
    finally { modelSavingRef.current = false; setModelSaving(false); }
  };
  const changeRuntime = async (next:NewSessionDraft['runtime']) => {
    if(bindingLocked||runtimeChoosing.current||modelSavingRef.current||next===runtime)return;
    const request=++runtimeChoice.current;
    runtimeChoosing.current=true;setChoosingRuntime(next);
    try{
      const choice=await api<{target:ModelTarget;selection?:NativeModelSelection}>('runtime/choice',{runtime:next,...(session?{sessionId:session.id}:{hostId:workspaceHostId})});
      if(request!==runtimeChoice.current)return;
      await switchTarget(choice.target,choice.selection);
    }catch(error){if(request===runtimeChoice.current){
      if(!session&&accountHostId&&(next==='claude'||next==='codex')&&errorText(error).includes('RUNTIME_MODEL_UNAVAILABLE'))switchIdentity(next,true,accountHostId);
      else report(error);
    }}
    finally{if(request===runtimeChoice.current){runtimeChoosing.current=false;setChoosingRuntime(undefined);}}
  };
  const linkActions = { sessionId: session?.id, openFile: setFileReference, report, notify };
  const copy = (value: string) => api('clipboard/write', { text: value }).then(() => notify('已复制')).catch(report);
  const retry = async (message: Message) => { if (!translationPolicyRef.current.enabled || !session || retrying.has(message.id)) return; setRetrying(previous => new Set(previous).add(message.id)); try { await api('message/retranslate', { sessionId: session.id, messageId: message.id }); await refresh(); } catch (e) { report(e); } finally { setRetrying(previous => { const next = new Set(previous); next.delete(message.id); return next; }); } };
  const toggleProgress = (id: string) => setProgressIds(previous => previous.includes(id)?previous.filter(value=>value!==id):[...previous,id]);
  const followBlock = (id: string, index: number, side: 'source' | 'translation') => {
    if (!trackingEnabled) return;
    const key = `${id}:${index}`; setActiveBlock(key);
    requestAnimationFrame(() => {
      if(!trackingCurrent.current)return;
      if(side==='translation')flushSync(()=>readingRef.current?.revealMessage(id));
      const target = side === 'source' ? translationRef.current : originalRef.current;
      const pane = target?.closest(side === 'source' ? '.translation-pane' : '.original-pane');
      const block = Array.from(pane?.querySelectorAll<HTMLElement>('[data-sync-key]') ?? []).find(element => element.dataset.syncKey === key);
      const folded=block?.closest<HTMLDetailsElement>('details.turn-process');if(folded)folded.open=true;
      if (target && block && target.contains(block)) target.scrollTo({ top: Math.max(0, target.scrollTop + block.getBoundingClientRect().top - target.getBoundingClientRect().top - 18), behavior: 'smooth' });
      else block?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };
  const blockProps = (message: Pick<Message, 'id'>, index: number, side: 'source' | 'translation') => {
    const key = `${message.id}:${index}`;
    return { 'data-sync-key': key, 'data-message-id': message.id, 'data-testid': `${side}-block-${message.id}-${index}`, tabIndex: trackingEnabled?0:-1, className: `mapped-block ${trackingEnabled&&activeBlock === key ? 'is-matched' : ''}`, ...(trackingEnabled?{onMouseEnter: () => setActiveBlock(key), onMouseLeave: () => setActiveBlock(current => current === key ? null : current), onFocus: () => setActiveBlock(key), onBlur: () => setActiveBlock(current => current === key ? null : current), onClick: () => followBlock(message.id, index, side), onKeyDown: (e: React.KeyboardEvent) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); followBlock(message.id, index, side); } }}:{}) };
  };
  const resize = (percent: number) => setLeftWidth(Math.min(resizeBounds.max, Math.max(resizeBounds.min, percent)));
  const locateOriginal = (id: string) => { if (compact) setShowTranslation(false); requestAnimationFrame(() => { flushSync(()=>readingRef.current?.revealMessage(id)); const block = originalRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`); const folded=block?.closest<HTMLDetailsElement>('details.turn-process');if(folded)folded.open=true;block?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveBlock(trackingCurrent.current?`${id}:0`:null); block?.focus({ preventScroll: true }); }); };
  useEffect(()=>{if(focusMessageId)locateOriginal(focusMessageId);},[focusMessageId]);
  const forkReason=useMemo(()=>session?forkEligibility(session):undefined,[session]);
  const forkButton=(message:Message)=>{if(message.role!=='assistant')return null;const reason=forkReason?.(message.id);return <button className="icon-button message-fork" data-testid={'fork-message-'+message.id} data-workbench-fork-action data-session-id={session?.id} data-message-id={message.id} aria-label="分支到新聊天" title={reason??'分支到新聊天'} disabled={!!reason||!!forkingId} onClick={()=>{if(session)void onFork(session.id,message.id);}}><Icon name="branch" size={15}/></button>;};
  const branchSource=session?.branch?state?.sessions.find(item=>item.id===session.branch!.sourceSessionId):undefined;
  const inheritedCount=session?.branch?.inheritedMessageCount??(session?.branch?(session.messages.findIndex(m=>m.id===session.branch?.sourceMessageId)+1):0);
  const branchBoundary=session?.messages[Math.max(0,inheritedCount)-1]?.id;
  const origin=()=>session?.branch?<BranchOrigin session={session} source={branchSource} onOpen={onOpenSource}/>:null;
  const resizeFilePane = (width: number) => setFilePaneWidth(Math.max(260, Math.min(width,filePaneMax)));
  const identityControls = (<div className="identity-controls" data-workbench-runtime-controls aria-label="会话运行时与账号">
      {state&&<SelectMenu label="运行时" testId="composer-runtime" icon="sparkle" value={choosingRuntime??runtime} placeholder="选择运行时" disabled={bindingLocked} options={[...(state.runtimeExtensions??[]).filter(r=>r.ready).map(r=>({value:r.id,label:r.name})),...(['codex','claude'] as const).filter(value=>localClis?.some(cli=>cli.runtime===value&&cli.installed)).map(value=>({value,label:value==='codex'?'Codex':'Claude Code'}))].map(option=>option.value===choosingRuntime?{...option,label:option.label+' · 切换中…'}:option)} onChange={value=>void changeRuntime(value as NewSessionDraft['runtime'])} footer={<button className="text-button" onClick={()=>window.dispatchEvent(new CustomEvent('workbench-settings',{detail:'runtimes'}))}>管理运行时</button>}/>}
      {state&&(session?.binding.localAccountId||draft.modelTargetId?.startsWith('account/'))&&<LocalAccountSelector state={state} runtime={runtime} accountId={session?.binding.localAccountId??draft.modelTargetId!.split('/')[1]!} selection={session?session.modelSelection:draft.modelSelection} locked={bindingLocked} onTarget={switchTarget}/>}
      {accountHostId && (runtime==='codex'||runtime==='claude') && <AccountSelector key={accountHostId+runtime} provider={runtime} hostId={accountHostId} catalog={state?.accountCatalogs?.[accountHostId]} accountRef={session?.binding.accountRef} locked={bindingLocked} onSelected={() => switchIdentity(runtime,true,accountHostId)} onPending={pending => { accountPendingRef.current = pending; setAccountPending(pending); }} />}
    </div>);
  const changeComposerText=(value:string)=>{cancel();setText(value);setIsDemoSample(false);setReviewOpen(false);setReviewSnapshot(null);setDraftError('');};
  const menu=useComposerMenu({runtime,sessionId:session?.id,directory:workingFolder,targetId:session?session.modelTargetId:draft.modelTargetId,revision:JSON.stringify([session?.status,session?.binding.nativeSessionId,session?.handoffFromMessage,session?.nativeTurnStatus,!!preview]),text,input:composerRef,disabled:submitting||busy||attachments.busy||!state,selected:skills,onText:changeComposerText,onSkill:skill=>{cancel();setReviewOpen(false);setReviewSnapshot(null);setSkills(previous=>runtime==='claude'?[skill]:previous.some(s=>s.id===skill.id)?previous:previous.length<6?[...previous,skill]:previous);},onAction:(command,scope)=>{
    if(command.action==='attachments')void attachments.pick();
    else if(command.action==='files')setFileReference({path:workingFolder});
    else if(command.action==='status')setStatusOpen(true);
    else if(command.action==='plan'){if(runtime==='codex')void changeCollaboration();else void changePermission('plan');}
    else if(command.action==='model'||command.action==='permissions'){
      const selector=command.action==='permissions'?'[data-testid=composer-permission]':isPluginRuntime(runtime)?'[data-testid=plugin-model-selector]':'[data-testid=model-selector]';
      requestAnimationFrame(()=>{const control=composerRef.current?.closest('.workspace')?.querySelector<HTMLButtonElement>(selector);if(control&&!control.disabled){control.focus();control.click();}});
    }
    else if(command.action==='native'&&session&&!bindingLocked){
      setSubmitting(true);submittingRef.current=true;
      void api('composer/execute',{sessionId:session.id,commandId:command.id,scope}).then(()=>refresh()).catch(report).finally(()=>{setSubmitting(false);submittingRef.current=false;});
    }
    else if(command.action==='settings')window.dispatchEvent(new CustomEvent('workbench-settings',{detail:command.target}));
  }});
  return <UiMemoryScope.Provider value={session?.id??'draft'}><div {...attachments.dropProps} className={`workspace split-workspace ${!messages.length ? 'workspace-empty' : ''}`}>
    <SelectionAnnotations root={splitRef} sessionId={session?.id} active={active} disabled={submitting||annotations.busy} report={report} onAdded={()=>composerRef.current?.focus()}/>
    <div className="attachment-drop-overlay" data-testid="attachment-drop-overlay" hidden={!attachments.dragging}><Icon name="document" size={34}/><span>松开即可添加附件</span><small>文件或图片 · 最多 10 个</small></div><div className={`workspace-content ${reader ? 'has-file-dock has-reader-dock' : ''}`} ref={contentRef} style={{'--file-pane-width':`${filePaneWidth}px`} as React.CSSProperties}>
    <div className="conversation-column">
    <header className="workspace-header"><div className="breadcrumb"><Icon name={project ? 'folder' : 'chat'} size={15} /><span>{project?.name ?? '工作台'}</span><Icon name="chevron" size={12} /><strong>{session?.title ?? '新会话'}</strong></div><div className="workspace-header-actions">{messages.length > 0 && identityControls}<button className="pane-toggle files-toggle" aria-label="浏览文件" data-testid="open-files" onClick={() => setFileReference({ path: workingFolder })}><Icon name="folder" size={16} /><span>文件</span></button>{session && session.status !== 'idle' && <span className={`status-pill ${session.status === 'blocked' ? 'warning' : ''}`}><i />{statuses[session.status]}</span>}{messages.length > 0 && placement==='panel' && !session?.agentParent && (translationEnabled || hasTranslationHistory) && <button data-testid="toggle-translation-pane" className={`pane-toggle ${translationVisible ? 'active' : ''}`} onClick={() => { translationChoice.current = true; setTranslationPreference(!translationVisible);setShowTranslation(!translationVisible); setReader(undefined); }} aria-pressed={translationVisible}><Icon name="split" size={17} />{compact && translationVisible ? '返回原文' : translationEnabled ? '中文译文' : '历史译文'}</button>}</div></header>
    <div data-testid="bilingual-result" data-translation-tracking={trackingEnabled?'enabled':'disabled'} ref={splitRef} className={`workspace-split ${translationVisible ? 'translation-visible' : 'translation-hidden'} ${compact ? 'compact-split' : ''}`}>
      <section className="original-pane" data-testid="translation-original" aria-label="原文会话">
        <div className="original-timeline" data-testid="original-pane" ref={originalRef} onWheel={handleOriginalWheel} onScroll={event=>updateFollowOutput(event.currentTarget)}>
          {session?.branch&&!branchBoundary&&origin()}
          {!session || (session.status!=='running'&&!session.messages.length&&!session.turnTimings?.length&&!state?.collaboration?.messages.some(peer=>peer.fromSessionId===session.id||peer.toSessionId===session.id)) ? <div className="quiet-welcome"><div className="quiet-greeting"><h1>今天想一起做些什么？</h1></div></div> : <div className="original-messages"><ConversationReading ref={readingRef} viewKey={JSON.stringify([session.id,trackingEnabled,inlineTranslations,translatedOnly])} session={session} activeProgressTarget={activeProgressTarget} boundaryMessageId={branchBoundary} renderBoundary={origin} entries={conversationEntries} render={(entry,completedReply,progress) => { if(entry.type==='interaction')return <NativeInteractionHistory key={entry.id} item={entry.item} session={session} state={state}/>; if(entry.type==='changes')return <FileChangeCard key={'changes:'+entry.id} changes={entry.changes} onReview={path=>openChanges(entry.changes.id,path)} onCloseReview={()=>closeChanges(entry.changes.id)} cwd={session.projectPath} roots={projectFolders(project)} running={progress?.active??false} dockTarget={progress?.active?progress.target:undefined} {...linkActions}/>; if (entry.type !== 'message') return <RuntimeTimelineEntry key={`${entry.type}:${entry.id}`} entry={entry} sessionId={session.id} activities={session.activities} onOpenNative={id=>openChild(session.id,id)} onOpenSession={id=>openChild(id)} onOpenPeer={id=>onOpenSource(id)}/>; const message = entry.message; return message.role === 'user' ? <article key={message.id} className="user-message" data-workbench-user-message data-message-id={message.id} data-testid={"user-source-" + message.id}><div className="message-kicker">你<span>{message.delivery==='pending'?'已提交，等待原生接收':message.delivery==='uncertain'?'插入回执待确认':message.delivery==='not-sent'?'未发送，可编辑后重发':translatedOnly?'你的输入':'实际提交文本'}</span></div><AnnotationCapsule items={message.annotations??[]} sessionId={(session?.id??'')+':message:'+message.id}/><AttachmentList items={message.attachments??[]}/><SkillTokens skills={message.skills??[]}/>{(translatedOnly?[message.original]:blocks(message).source).filter(part=>part.trim()).map((part, index) => <div key={message.id + ":" + index} {...blockProps(message, index, "source")}><MessageText text={part} {...linkActions} /></div>)}<BilingualMessageActions alignCopy className="user-message-actions" sourceCopy={<button className="icon-button" data-testid={"copy-message-" + message.id} aria-label="复制消息" title="复制消息文本" onClick={() => copy(skillBody(message.submitted ?? message.original, message.skills))}><Icon name="copy" size={15}/></button>} value={inlineTranslations?(session.agentParent?message:message.submitted&&message.submitted!==message.original?{translation:message.original}:undefined):undefined} label={session.agentParent?undefined:localDraftLabel(message.original)} copyLabel={session.agentParent?"复制译文":"复制原稿"} copyTestId={"copy-translation-"+message.id} actions={linkActions} onCopy={copy}><button className="icon-button" data-testid={"edit-message-" + message.id} aria-label="编辑并重发" title="编辑并重发" disabled={session.status === "running" || submitting} onClick={() => editMessage(message)}><Icon name="edit" size={15}/></button>{forkButton(message)}{session.agentParent&&<TranslationAction value={message} enabled={translationEnabled} onTranslate={()=>void retry(message)}/>}</BilingualMessageActions></article> : <article className={`native-message ${message.demo ? '' : 'native-entry'}`} key={message.id} data-reply-id={message.id} data-turn-reply={completedReply?'complete':'process'}><header><span>{translatedOnly?(message.translation?'中文译文':message.translationStatus==='pending'?'翻译中 · 暂显原文':message.translationStatus==='failed'?'翻译失败 · 原文': '原文 · 暂无译文'):message.demo ? '示例原文' : message.modelSource?.runtime==='api'?'模型原文':'原生原文'}</span>{message.demo && <span className="demo-badge">DEMO</span>}{message.modelSource&&<span className="model-source-caption">{message.modelSource.name}</span>}</header>{message.progress && <div className="inline-progress"><button onClick={() => toggleProgress(message.id)}><Icon name="chevron" size={12} />{message.demo ? '示例公开进度' : '运行时公开进度'}</button>{showProgress.has(message.id) && <MessageText text={translatedOnly?(message.progressTranslation??message.progress):message.progress} {...linkActions} />}</div>}{(translatedOnly&&message.translation?[message.translation]:blocks(message).source).map((part, index) => <div key={`${message.id}:${index}`} {...blockProps(message, index, 'source')}><MessageText text={part} {...linkActions} /></div>)}{message.planReview&&<CodexPlanActions session={session} reference={{kind:'message',receipt:message.planReview.receipt}} onOpen={()=>openPlan({kind:'message',receipt:message.planReview!.receipt})} onRevise={()=>{cancel();composerRef.current?.focus();}} disabled={busy||submitting||!!preview}/> }<BilingualMessageActions className="message-actions" showCopy={completedReply} sourceCopy={<button className="icon-button" data-testid={"copy-reply-"+message.id} aria-label="复制回复" title="复制原始 Markdown" onClick={()=>copy(visibleReply(message.original))}><Icon name="copy" size={15}/></button>} value={inlineTranslations?message:undefined} copyTestId={"copy-translation-"+message.id} actions={linkActions} onCopy={copy} afterTranslation={inlineTranslations&&message.progressTranslation?<RememberedDetails className="translated-progress" memoryId="workspace.translation-progress.inline" scope={message.id}><summary>公开进度旁注</summary><MessageText text={message.progressTranslation} {...linkActions}/></RememberedDetails>:undefined}>{(inlineTranslations||translatedOnly||session.agentParent)&&<TranslationAction value={message} enabled={translationEnabled} complete={!!message.original.trim()} onTranslate={()=>void retry(message)}/ >}{completedReply&&<>{forkButton(message)}<ReplyMemory references={replyMemoryReferences(session,message)}/><time>{new Date(message.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></>}</BilingualMessageActions></article>; }}/></div>}

          <NativePlanView plan={session?.nativePlan}/>
          {session&&<QuestionInbox session={session} refresh={refresh} disabled={busy||submitting||!!activeQuestion}/>}
          {session&&messages.filter(message=>['open','deferred'].includes(asyncQuestionState(session,message))).map(message=><AsyncQuestions key={message.id} items={message.questions!} session={session} messageId={message.id} state={state} active={active&&asyncQuestionState(session,message)==='open'} translation={translationEnabled?message.questionTranslation:undefined} onTranslate={translationEnabled?()=>api('interaction/translate',{sessionId:session.id,messageId:message.id}):undefined} disabled={!state||busy||submitting||!!preview||stopping||permissionSaving||modelSaving||!!activeQuestion&&activeQuestion!==message.id||session.status==='uncertain'||session.status==='running'&&(!canSteer||!session.nativeTurnId)} onBusyChange={value=>questionBusy(message.id,value)} onSent={refresh} onReturnToQuestion={()=>{if(compact)setShowTranslation(false);}}/>)}
          {session&&<NativeInteractions session={session} state={state} onReturnToQuestion={()=>{if(compact)setShowTranslation(false);}}/>}
        </div>
        <div className={`composer-area${translationModuleOn ? '' : ' translation-module-off'}`}>
          {session?.status==='running'&&<div className="turn-progress-dock" data-active-turn-progress data-session-id={session.id} ref={setActiveProgressTarget}/>}
          {session?.nativeInteractions?.some(i=>i.status==='pending')&&<button className="text-button native-attention-link" data-testid="pending-interaction-link" onClick={()=>{if(compact)setShowTranslation(false);requestAnimationFrame(()=>originalRef.current?.querySelector('[data-testid="native-interaction"]')?.scrollIntoView({behavior:'smooth',block:'center'}));}}>有 {session.nativeInteractions.filter(i=>i.status==='pending').length} 项等待你回应 ↑</button>}
          {!messages.length && <div className="new-session-context" data-testid="new-session-context">
            <ProjectPicker projects={state?.projects ?? []} projectId={draft.projectId} disabled={!state || !!session || bindingLocked} onChange={projectId => { cancel(); const selected=state?.projects.find(item=>item.id===projectId); onDraftChange(current => ({ ...current, projectId, projectPath:selected?.path??'',permissionMode:rememberedPermission(state,projectId,current.runtime) })); }} onCreate={onCreateProject} />
            {identityControls}
          </div>}
          {session&&localModelBinding(session.binding)&&session.status==='idle'&&session.nativeObservation==='observing'&&hasNativeBackground(session)&&<div className="native-background-status" data-testid="native-background-status"><span>后台任务尚未结束，可以继续发送消息</span><button className="text-button" disabled={stopping} onClick={async()=>{setStopping(true);try{await api('session/stop',{sessionId:session.id});await refresh();}catch(error){report(error);}finally{setStopping(false);}}}>停止后台任务</button></div>}
          {session?.agentParent&&<button className="model-child-link" onClick={()=>onOpenSource(session.agentParent!.sessionId)}>返回主会话 ↗</button>}
          {session&&session.status==='uncertain'&&<button className="text-button" data-workbench-session-recovery data-testid="api-end-wait" onClick={()=>{if(window.confirm('请先核对文件与原生任务，确认没有任务仍在执行。此前结果与进程清理仍可能未知；恢复发送不会重发旧请求，也不会将旧回合标记为成功。'))void api('session/end-wait',{sessionId:session.id,confirm:true}).then(refresh).catch(report);}}>已核对，结束等待并恢复发送</button>}
          {session?.nativeError && session.turnTimings?.at(-1)?.error !== session.nativeError && <div className="callout warning compact" role="status">{session.nativeError}</div>}
          {pluginUnavailable&&<div className="callout compact" data-testid="plugin-runtime-unavailable">运行时插件未启用或暂不可用。会话历史已保留，请启用原插件后继续。</div>}
          {session?.binding.runtime==='codex'&&session.binding.accountRuntime!=='native-owner'&&session.binding.accountRef.startsWith('vps-account:')&&<div className="callout compact" data-testid="legacy-account-migration"><p>此会话需要接入原生账号服务。管理员迁移后可继续原线程，历史和账号配给保留。</p><div className="row"><button className="button secondary" disabled={migrating||session.status==='running'} onClick={()=>api('session/migration-manifest',{sessionId:session.id}).then(()=>notify('已复制迁移资料，仅含账号与线程标识，不含消息或凭据。')).catch(report)}>复制迁移资料</button><button className="button secondary" data-testid="adopt-native-migration" disabled={migrating||session.status==='running'} onClick={migrateNative}>{migrating?'正在核对…':'核对迁移并接入'}</button></div></div>}
          {session?.status==='uncertain'&&nativeReady&&<button className="button secondary" data-testid="native-reconcile" disabled={reconciling} onClick={reconcileNative}>{reconciling?'正在读取原生记录…':'核对原生回合结果'}</button>}
          {session&&<NativeApprovals session={session} onOpenPlan={receipt=>openPlan({kind:'approval',receipt})}/> }
          {draftError && <div className="draft-error" role="alert"><strong>发送未完成</strong><span>{draftError}</span><small>原稿已保留；请按上方具体原因处理，并先检查发送回执，避免重复发送。</small>{translationEnabled&&session?.status!=='uncertain'&&session?.status!=='running'&&<button type="button" className="text-button" data-testid="draft-original-fallback" disabled={busy||submitting} onClick={()=>void prepare(true,false,true)}>改用原文，核对后发送</button>}</div>}
          {session?.worktree?.status==='archived'&&<div className="editing-history-note"><span>此工作树已清理，副本可恢复</span><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api('worktrees/restore',{id:session.worktree!.id});await refresh();}catch(e){setDraftError(errorText(e));}finally{setBusy(false);}}}>恢复工作树</button></div>}
          {editingMessageId && <div className="editing-history-note" role="status"><span>编辑并重发</span><button className="text-button" data-testid="cancel-edit-message" disabled={submitting} onClick={exitEditing}>取消编辑</button></div>}
          {!!session?.draftRecoveries?.some(entry=>entry.outcome!=='pending')&&<div data-workbench-draft-recovery data-session-id={session.id}>
            {session.draftRecoveries.filter(entry=>entry.outcome!=='pending').map(entry=><div className="editing-history-note" key={entry.id} role="status"><span>{entry.outcome==='not-sent'?'未发送的输入已保存':entry.outcome==='failed'?'失败请求的原稿已保存':'发送结果未知，原稿已保存'}</span><button type="button" className="text-button" disabled={submitting||busy||annotations.busy||attachments.busy} onClick={()=>recoverDraft(entry)}>恢复到编辑区</button><button type="button" className="text-button" disabled={submitting} onClick={()=>void api('draft/recovery-dismiss',{sessionId:session.id,id:entry.id}).then(refresh).catch(report)}>移除备份</button></div>)}
          </div>}
          {session&&<FollowUpQueue session={session} canSteer={canSteer} refresh={refresh} report={report}/>}
          <div className={`composer ${busy ? 'busy' : ''}`}>
            {menu.menu}<AnnotationCapsule items={annotations.items} sessionId={session?.id??'draft'} editable disabled={submitting||annotations.busy} onEdit={annotationController.update} onRemove={annotationController.remove} onClear={annotationController.clear}/>{annotations.reading&&<small className="annotation-reading" role="status">正在翻译注释…</small>}{annotations.readingError&&<small className="annotation-reading" title={annotations.readingError}>注释译文暂不可用 <button type="button" className="text-button" onClick={annotations.retryReading}>重试译文</button></small>}<SkillTokens skills={skills} disabled={submitting||busy} onRemove={id=>{cancel();setSkills(items=>items.filter(s=>s.id!==id));}}/><AttachmentList items={attachments.items} onRemove={attachments.remove} disabled={submitting||attachments.busy}/>{attachments.busy&&<p className="attachment-busy" role="status">正在添加附件…</p>}<textarea {...menu.inputProps} onPaste={attachments.paste} ref={composerRef} data-testid="composer-input" data-shortcut-scope="composer" aria-label="输入你的任务" placeholder="描述你的任务…" value={text} disabled={!state} onChange={e => { if (previewRef.current) setRevisionRequired(true); cancel(); setText(e.target.value); menu.detect(e.target.value,e.target.selectionStart); setIsDemoSample(false); setDraftError(''); }} onCompositionStart={e => { composing.current = true; e.currentTarget.dataset.shortcutComposing="true"; }} onCompositionEnd={e => { composing.current = false; delete e.currentTarget.dataset.shortcutComposing; }} onKeyDown={e => { if(menu.keyDown(e))return; if (e.key === 'Escape' && editingMessageId && !e.nativeEvent.isComposing) { e.preventDefault(); exitEditing(); return; } if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composing.current && e.keyCode !== 229) { e.preventDefault(); if(!e.repeat&&!e.shiftKey&&!e.altKey&&!e.metaKey)prepare(false,e.ctrlKey); } }} />
            <div className="composer-toolbar"><div className="composer-toolbar-start">{menu.button}<PermissionSelector runtime={runtime} extension={runtimePlugin??(session?.pluginRuntime?{name:session.pluginRuntime.name,permissions:session.pluginRuntime.permissions}:undefined)} value={session ? session.permissionMode ?? 'default' : draft.permissionMode ?? 'default'} disabled={!!choosingRuntime||(!session&&runtime==='demo')||permissionLocked||pluginUnavailable} pending={permissionSaving} onChange={permissionMode => void changePermission(permissionMode)} />{planMode&&<button type="button" className="composer-plan-mode" data-testid="composer-plan-mode" aria-label="退出计划模式" title="退出计划模式" disabled={bindingLocked||permissionSaving} onClick={()=>void changeCollaboration()}><Icon name="sparkle" size={13}/><span>计划</span><Icon name="close" size={11}/></button>}</div>
              <div className="composer-actions">{isPluginRuntime(runtime)?<PluginModelControls descriptor={runtimePlugin} value={session?session.modelSelection:draft.modelSelection} disabled={!!choosingRuntime||pluginUnavailable||!!session&&session.status==='running'||modelSaving||!!preview} onChange={changeModel}/>:<ModelControls state={state} targetId={session?.modelTargetId??draft.modelTargetId} bindingLocked={bindingLocked} onTarget={switchTarget} active={active} runtime={runtime} session={session} hostId={workspaceHostId} accountRef={session?.binding.accountRef ?? selectedSharedAccountRef(state?.accountCatalogs?.[workspaceHostId ?? ''],runtime==='claude'?'claude':'codex')} value={session ? session.modelSelection : draft.modelSelection} disabled={!!choosingRuntime || !state || creating || submitting || busy || !!preview} onChange={changeModel}/>} {stopping || submitting || busy || session?.status === 'running' && !text.trim() && !attachments.items.length && !skills.length && !annotations.items.length ? <button className="send-button stop-button" data-testid={session?.status === 'running' || submitting ? 'session-stop' : 'draft-stop'} aria-label={stopping ? '停止中' : session?.status === 'running' || submitting ? '停止' : creating || !translationEnabled ? '取消准备' : '停止翻译'} title={stopping ? '停止中…' : session?.status === 'running' || submitting ? '停止' : creating || !translationEnabled ? '取消准备' : '停止翻译'} aria-busy={stopping} disabled={stopping} onClick={stopWork}><Icon name="stop" size={24}/></button> : <button className="send-button" data-testid={session?.status === 'running' ? followUp==='queue'?'queue-draft':'insert-draft' : 'prepare-draft'} aria-label={session?.status === 'running' ? followUpLabel : !translationEnabled ? '发送原文' : autoSubmit&&!annotationsNeedInputTranslation(annotations.items) ? '翻译后发送' : '生成发送预览'} title={session?.status === 'running' ? followUpLabel+'；Ctrl+Enter 执行相反操作'+(runtime==='claude'?'（引导在原生接收节点处理）':'') : undefined} disabled={!!choosingRuntime || (!session&&runtime==='demo') || !!activeQuestion || !state || pluginUnavailable || (!text.trim()&&!attachments.items.length&&!skills.length&&!annotations.items.length) || attachments.busy || annotations.busy || !!preview || permissionSaving || modelSaving || session?.status === 'running' && !session.nativeTurnId} onClick={() => prepare()}><Icon name="arrow" size={18}/></button>}</div>
            </div>
          </div>
          <div className="composer-options">
            <SessionMetrics session={session}/>
            {translationModuleOn && <div className="composer-translation-controls">
              {showTranslationQuickToggle && <label className="auto-send-toggle" title="临时状态全局记忆，不改变插件启用状态"><input role="switch" data-testid="translation-quick-toggle" aria-label="临时翻译" type="checkbox" checked={translationEnabled} disabled={!state || translationSaving} onChange={event => void setTranslationEnabled(event.target.checked)}/><i aria-hidden="true"/><span>{translationEnabled ? '关闭翻译' : '恢复翻译'}</span></label>}
              {translationEnabled && <label className="auto-send-toggle" title={annotationsNeedInputTranslation(annotations.items)?'本次含中文注释，需要先确认发送预览':undefined}><input role="switch" data-testid="auto-submit-toggle" type="checkbox" checked={autoSubmit} disabled={!state || autoSaving || translationSaving} onChange={e => void setAutoSubmit(e.target.checked)} /><i aria-hidden="true" /><span>翻译后直接发送</span></label>}
              {translationEnabled&&!session?.agentParent&&(<label className="auto-send-toggle intermediate-toggle" data-workbench-translation-intermediate title="全局生效，关闭后保留已有译文"><input type="checkbox" role="switch" data-testid="translate-intermediate" checked={state?.translateIntermediate!==false} disabled={!translationEnabled||intermediateSaving} onChange={event=>{setIntermediateSaving(true);void api('translation/intermediate',{enabled:event.target.checked}).then(refresh).catch(report).finally(()=>setIntermediateSaving(false));}}/><i aria-hidden="true"/><span>翻译中途消息</span></label>)}
            </div>}
          </div>
        </div>
      </section>
      {translationVisible && !compact && <div role="separator" aria-label="调整原文和译文宽度" aria-orientation="vertical" aria-valuenow={leftWidth} aria-valuemin={resizeBounds.min} aria-valuemax={resizeBounds.max} tabIndex={0} data-testid="split-separator" className="split-separator" onPointerDown={e => { dragActive.current = true; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (dragActive.current && splitRef.current) { const rect = splitRef.current.getBoundingClientRect(); resize((e.clientX - rect.left) / rect.width * 100); } }} onPointerUp={e => { dragActive.current = false; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { dragActive.current = false; }} onDoubleClick={() => resize(53)} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); resize(leftWidth + (e.key === 'ArrowRight' ? 2 : -2)); } if (e.key === 'Home') { e.preventDefault(); resize(53); } }}><i /></div>}
      {translationVisible && <section className="translation-pane" data-testid="translation-chinese" aria-label="中文译文面板">
        <header className="translation-pane-header"><div><Icon name="globe" size={16} /><strong>{translationEnabled ? '中文译文与原稿' : '历史译文与原稿'}</strong></div></header>
        <div className="translation-timeline" data-testid="translation-pane" ref={translationRef}>
          {!messages.length && !preview ? <div className="translation-empty"><Icon name="globe" size={23} /><p>中文原稿与译文会显示在这里</p><small>你的原稿在本地保留，回复译文独立呈现。<br />悬停对应段落可查看两侧关联。</small></div> : messages.map((message, messageIndex) => message.role === 'user' ?
            <article className="translated-message user-chinese-message" key={message.id} data-testid={'user-chinese-' + message.id}>
              <header><span>你</span><small title="用户输入原稿，不是第三方服务的反向翻译">{localDraftLabel(message.original)}</small><button className="icon-button" aria-label="复制中文原稿" onClick={() => copy(message.original)}><Icon name="copy" size={15} /></button></header>
              <AnnotationCapsule items={message.annotations??[]} sessionId={(session?.id??'')+':message:'+message.id}/>{blocks(message).translated.map((part, index) => <div key={message.id + ':' + index} {...blockProps(message, index, 'translation')}><MessageText text={part} {...linkActions} /></div>)}
            </article> :
            <article className="translated-message" key={message.id}>
              <header><span>回复 {messages.slice(0, messageIndex + 1).filter(item => item.role === 'assistant').length}</span><button className="text-button" onClick={() => locateOriginal(message.id)}>定位原文</button>{message.translation && <button className="icon-button" aria-label="复制中文译文" onClick={() => copy(message.translation!)}><Icon name="copy" size={15} /></button>}</header>
              {message.progress && (state?.translateProgress || !translationEnabled) && message.progressTranslation && <RememberedDetails className="translated-progress" memoryId="workspace.translation-progress" scope={message.id}><summary>公开进度旁注</summary><MessageText text={message.progressTranslation} {...linkActions} /></RememberedDetails>}
              {translationEnabled && message.translation && message.translationStatus === 'pending' && <p className="translation-state">正在重译，暂时保留上一版本。</p>}
              {message.translation && message.translationStatus === 'failed' && <p className="translation-state failed">重译失败，保留上一版本。{message.translationError}</p>}
              <AnnotationCapsule items={message.annotations??[]} sessionId={(session?.id??'')+':message:'+message.id}/>{blocks(message).translated.map((part, index) => <div key={message.id + ':' + index} {...blockProps(message, index, 'translation')}>{part ? <MessageText text={part} {...linkActions} /> : <div className="pending-translation"><p>{!translationEnabled ? translationModuleOn ? '翻译已临时暂停' : '翻译模块已关闭' : message.translationStatus === 'pending' ? '翻译中…' : message.translationStatus === 'off' ? '此条译文已关闭' : '译文暂不可用'}</p>{message.translationError && <small>{message.translationError}</small>}</div>}</div>)}
              <footer><div><span title={(message.translationSource ?? '来源未确认') + '\n' + (blocks(message).aligned ? '同段数按段落对应' : '按整条消息对应') + ' · ' + message.id}>{message.translationSource || (translationEnabled && message.translationStatus === 'pending' ? '翻译处理中' : '尚无已完成译文来源')}</span></div><button className="text-button" title={translationEnabled ? undefined : translationModuleOn ? '请先恢复临时翻译' : '请先在设置中开启翻译模块'} disabled={!translationEnabled || retrying.has(message.id) || message.translationStatus === 'pending'} onClick={() => retry(message)}>{translationEnabled && retrying.has(message.id) ? '重译中…' : '仅重译'}</button></footer>
            </article>)}
        </div>
      </section>}
    </div>
    </div>
    {active && reader && <><div className="file-dock-separator" role="separator" aria-label={fileReference?"调整文件面板宽度":reader.type==='changes'?"调整文件审查面板宽度":reader.type==='plan'?"调整计划面板宽度":"调整子会话面板宽度"} aria-orientation="vertical" aria-valuemin={260} aria-valuemax={filePaneMax} aria-valuenow={filePaneWidth} tabIndex={0} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if(event.currentTarget.hasPointerCapture(event.pointerId) && contentRef.current) resizeFilePane(contentRef.current.getBoundingClientRect().right-event.clientX); }} onPointerUp={event => { if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={event => { if(['ArrowLeft','ArrowRight','Home'].includes(event.key)) { event.preventDefault(); resizeFilePane(event.key==='Home' ? 420 : filePaneWidth + (event.key==='ArrowLeft' ? 16 : -16)); } }} />{reader.type==='changes'&&reviewChanges?<FileChangeReview changes={reviewChanges} selectedPath={reader.path} onSelect={path=>setReader({...reader,path})} onClose={closeReader} onOpenFile={path=>setFileReference({path})} cwd={session?.projectPath} roots={projectFolders(project)} sessionId={session?.id} running={changeTurn?.active??false} actions={linkActions}/>:fileReference?<FileBrowser reference={fileReference} roots={projectFolders(project)} {...linkActions} onClose={closeReader}/>:childReaderSession&&reader.type==='child'?<NativeChildConversation session={childReaderSession} childId={childReaderSession.nativeChildren?.find(item=>item.nativeChildId===reader.childId||!!reader.toolCallId&&item.toolCallId===reader.toolCallId)?.nativeChildId??reader.childId} sessions={state?.sessions??[]} enabled={translationEnabled} onNavigate={openChild} onClose={closeReader} copy={value=>void copy(value)} actions={{...linkActions,sessionId:childReaderSession.id}}/>:reader.type==='plan'&&session?<PlanReader session={session} reference={reader.reference} enabled={translationEnabled} onClose={closeReader} actions={linkActions} copy={value=>void copy(value)}/>:null}</>}
    </div>

    {statusOpen&&<Modal title="会话状态" onClose={()=>setStatusOpen(false)} className="preview-modal preview-short"><dl className="composer-status"><dt>运行时</dt><dd>{runtimePlugin?.name??session?.pluginRuntime?.name??(runtime==='claude'?'Claude Code':runtime==='codex'?'Codex':runtime==='api'?'API 直连':isPluginRuntime(runtime)?runtime:'离线示例')}</dd><dt>状态</dt><dd>{session?statuses[session.status]:'尚未发送'}</dd><dt>模型</dt><dd>{session?.modelSelection?.model??draft.modelSelection?.model??'由当前模型配置决定'}</dd><dt>上下文</dt><dd>{session?.nativeContextUsage?.used??'未知'} / {session?.nativeContextUsage?.capacity??'未知'}</dd><dt>会话 ID</dt><dd>{session?.id??'发送后创建'}</dd></dl></Modal>}
    {translationEnabled && reviewOpen && reviewSnapshot && <PreviewModal id={reviewSnapshot.id} kind="draft" onConfirm={submit} confirmDisabled={!preview || revisionRequired || submitting} busy={submitting} className="draft-review-modal" title="发送前预览" subtitle={reviewSnapshot.followUp?.action==='queue'?'确认后加入队列；等待当前回合完成后发送。':reviewSnapshot.followUp?.action==='steer'?'确认后引导当前任务；由原生运行时决定接收节点。':'确认后发送；需要调整请返回修改。'} content={[reviewSnapshot.original,reviewSnapshot.translated]} onClose={editDraft} actions={<><button className="button secondary" data-testid="draft-edit" disabled={submitting} onClick={editDraft}>返回修改</button><button className="button primary" data-testid="submit-draft" data-autofocus disabled={!preview || revisionRequired || submitting} onClick={submit}>{submitting ? '发送中…' : reviewSnapshot.followUp?.action==='queue'?'确认排队':'确认发送'}</button></>}>
      <div data-testid="draft-preview" className="review-content">{annotationsNeedInputTranslation(reviewSnapshot.annotations)&&!reviewSnapshot.bypass&&<p className="review-status">中文注释已翻译。请核对下方实际发送内容，确认后发送；所选中文会保留在消息注释中。</p>}<AnnotationCapsule items={reviewSnapshot.annotations??[]} sessionId={session?.id+':preview'}/><AttachmentList items={reviewSnapshot.attachments??[]}/><SkillTokens skills={reviewSnapshot.skills??[]}/>
        <section><small>{/\p{Script=Han}/u.test(reviewSnapshot.original)?'中文原稿':'用户原稿'}</small><pre data-testid="draft-chinese-preview">{reviewSnapshot.original}</pre></section>
        <section><small>实际发送{reviewSnapshot.demo?' · 离线样例':reviewSnapshot.bypass?' · 原文':''}</small><pre data-testid="draft-submission-preview" className={preview?'review-submission':'review-submission stale-review'}>{reviewSnapshot.translated}</pre></section>
        {!preview && <p className="review-status">预览已失效，请返回修改后重新预览。</p>}
      </div>
    </PreviewModal>}
  </div></UiMemoryScope.Provider>;
}
