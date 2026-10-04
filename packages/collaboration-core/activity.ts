import type { NativeFrame } from '../../services/remote-supervisor';
import { claudeToolProgressTarget, hasClaudeChildMarker, type NativeChildEvent } from './events';
import { appendActivityOutput, boundedDetails, codexActivityDetails, claudeToolDetails, claudeResultText, type ActivityDetails } from './activity-details';
import { codexFileChanges, claudeFileChanges, claudeCompletedChanges, type NativeFileChange } from './file-changes';
import {claudeToolSemanticName} from '../runtime-claude/tool-names';
import { RuntimeNoticeTracker, type ActivityCategory } from './runtime-notices';
import { childSettings, mergeChildSettings } from './child-settings';

export type ActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export interface RuntimeActivity extends ActivityDetails {
  id: string; runtime: 'claude' | 'codex' | 'api'; kind: 'command' | 'file-edit' | 'tool' | 'message';
  status: ActivityStatus; startedAt: string; updatedAt: string;
  toolName?: string; fileCount?: number; turnId?: string; nativeChildId?: string;
  nativeOrder?: number;
  category?: ActivityCategory; attempt?:number; maxAttempts?:number;
  fileChanges?: NativeFileChange[]; fileChangesTruncated?: boolean;
  imageDelivery?: import('../generated-images/types').GeneratedImageDelivery;
  viewedAttachments?: import('../attachments/types').Attachment[];
  protocol?: import('../native-events').NativeEventNotice;
  /** Routine transport metadata is retained in a collapsed diagnostic group. */
  presentation?: 'diagnostic';
}
export interface NativeChildSnapshot extends NativeChildEvent { updatedAt: string; startedAt?: string; messages?:import('./child-conversation').NativeChildMessage[]; taskTranslation?:import('../translation/display').MessageTranslation; transcriptTruncated?:boolean }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined;
const kind = (name: string): RuntimeActivity['kind'] => ['Bash', 'PowerShell', 'shell', 'exec_command'].includes(name) ? 'command' : ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch'].includes(name) ? 'file-edit' : ['SendMessage', 'workbench_send_message'].includes(name) ? 'message' : 'tool';

/** Public tool lifecycle and bounded input/output; reasoning and signatures are excluded. */
export class NativeActivityTracker {
  private tools = new Map<string, RuntimeActivity>();
  private backgroundTasks = new Map<string, string>();
  private requestedBackground = new Set<string>();
  private notices:RuntimeNoticeTracker;
  constructor(readonly runtime: 'claude' | 'codex') {this.notices=new RuntimeNoticeTracker(runtime);}
  observe(frame: NativeFrame, nativeChildId?: string): RuntimeActivity[] {
    return [...this.notices.recover(frame,nativeChildId),...this.observeActivity(frame,nativeChildId)];
  }
  private observeActivity(frame:NativeFrame,nativeChildId?:string):RuntimeActivity[]{
    const msg = frame.value, at = frame.receivedAt;
    const scope = nativeChildId ?? 'root';
    const notices=this.notices.observe(frame,nativeChildId);if(notices.length)return notices;
    const base = { runtime: this.runtime, startedAt: at, updatedAt: at, nativeOrder: frame.sequence, ...(nativeChildId ? { nativeChildId } : {}) };
    if (this.runtime === 'codex') {
      const params = record(msg.params);
      if(msg.method==='item/fileChange/patchUpdated'){
        const id=`codex:${scope}:${text(params.turnId)??''}:${text(params.itemId)??''}`,previous=this.tools.get(id);
        if(!text(params.itemId)||!Array.isArray(params.changes))return [];
        const item={type:'fileChange',changes:params.changes},changes=codexFileChanges(item);
        const next:RuntimeActivity={...base,...previous,id,kind:'file-edit',status:previous?.status??'running',...codexActivityDetails(item),fileChanges:changes,fileCount:params.changes.length,updatedAt:at,...(text(params.turnId)?{turnId:text(params.turnId)}:{})};
        if(previous&&previous.updatedAt>at)return [];
        this.tools.set(id,next);return [next];
      }
      if(['item/mcpToolCall/progress','item/commandExecution/terminalInteraction'].includes(String(msg.method))){const id=`codex:${scope}:${text(params.turnId)??''}:${text(params.itemId)??''}`,previous=this.tools.get(id);if(!previous)return [];const delta=msg.method==='item/mcpToolCall/progress'?params.message:params.stdin;if(typeof delta!=='string')return [];const next={...previous,...appendActivityOutput(previous,'\n'+delta),updatedAt:at};this.tools.set(id,next);return [next];}
      if (['item/commandExecution/outputDelta', 'item/fileChange/outputDelta'].includes(String(msg.method))) {
        const id = `codex:${scope}:${text(params.turnId) ?? ''}:${text(params.itemId) ?? ''}`, previous = this.tools.get(id);
        if (!previous || typeof params.delta !== 'string') return [];
        const next = { ...previous, ...appendActivityOutput(previous, params.delta), updatedAt: at }; this.tools.set(id, next); return [next];
      }
      if (!['item/started', 'item/updated', 'item/completed'].includes(String(msg.method))) return [];
      const item = record(params.item), itemId = text(item.id);
      if (!itemId) return [];
      const type = String(item.type);
      if(type==='subAgentActivity')return []; // The correlated lifecycle pill owns this public status.
      if (!['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'webSearch', 'imageView', 'subAgentActivity','contextCompaction','imageGeneration','reasoning','sleep','enteredReviewMode','exitedReviewMode','hookPrompt','functionCallOutput'].includes(type)) return [];
      const nativeStatus = String(item.status);
      const status: ActivityStatus = item.status!==undefined&&!['inProgress','failed','errored','declined','cancelled','canceled','interrupted','completed','succeeded'].includes(nativeStatus)?'uncertain':['failed', 'errored'].includes(nativeStatus) || item.success === false || (type === 'commandExecution' && typeof item.exitCode === 'number' && item.exitCode !== 0) ? 'failed'
        : ['declined', 'cancelled', 'canceled', 'interrupted'].includes(nativeStatus) ? 'cancelled'
        : ['completed', 'succeeded'].includes(nativeStatus) || msg.method === 'item/completed' ? 'completed' : nativeStatus === 'inProgress' || msg.method === 'item/started' ? 'running' : 'uncertain';
      const toolName = text(item.tool)??(type==='functionCallOutput'?text(item.name):undefined);
      const id = `codex:${scope}:${text(params.turnId) ?? ''}:${itemId}`, previous = this.tools.get(id);
      const changes=codexFileChanges(item);
      const category:ActivityCategory|undefined=({webSearch:'search',imageView:'image',imageGeneration:'image-generation',contextCompaction:'compaction',reasoning:'reasoning',sleep:'wait',enteredReviewMode:'review',exitedReviewMode:'review',hookPrompt:'hook'} as Record<string,ActivityCategory>)[type]??(type==='commandExecution'&&Array.isArray(item.commandActions)&&item.commandActions.length&&item.commandActions.every(a=>['read','search','listFiles'].includes(String(record(a).type)))?'read':undefined);
      const next: RuntimeActivity = { ...base, ...previous, ...codexActivityDetails(item), ...(changes?{fileChanges:changes,fileChangesTruncated:Array.isArray(item.changes)&&item.changes.length>256}:{}), id, updatedAt: at, kind: type === 'commandExecution' ? 'command' : type === 'fileChange' ? 'file-edit' : type === 'collabAgentToolCall' ? 'message' : toolName ? kind(toolName) : 'tool', status,
        ...(category?{category}:{}),...(toolName ? { toolName } : {}), ...(type === 'fileChange' && Array.isArray(item.changes) ? { fileCount: item.changes.length } : {}), ...(text(params.turnId) ? { turnId: text(params.turnId) } : {}) };
      if (previous && (previous.updatedAt > at || previous.status !== 'running' && status === 'running')) return [];
      this.tools.set(id, next); this.prune(); return [next];
    }
    // Child frames must enter through the explicit child channel, never as parent activity.
    if (hasClaudeChildMarker({ value: msg } as NativeFrame) && !nativeChildId) return [];
    const progressTool=claudeToolProgressTarget(msg);
    if(progressTool){const key=`claude:${scope}:${progressTool}`,previous=this.tools.get(key);if(!previous||previous.status!=='running')return [];const seconds=msg.elapsed_time_seconds;const next={...previous,updatedAt:at,...(typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0?{durationMs:seconds*1000}:{})};this.tools.set(key,next);return [next];}
    if (msg.type === 'system') {
      const taskId = text(msg.task_id), toolId = text(msg.tool_use_id);
      if (msg.subtype === 'task_started' && msg.task_type === 'local_bash' && taskId && toolId) {
        const key = `claude:${scope}:${toolId}`; this.backgroundTasks.set(taskId, key);
        this.requestedBackground.add(key);
      }
      const key = taskId ? this.backgroundTasks.get(taskId) : undefined, previous = key ? this.tools.get(key) : undefined;
      const taskStatus=msg.subtype==='task_updated'?record(msg.patch).status:msg.status;
      if (previous && ['task_notification','task_updated'].includes(String(msg.subtype)) && ['completed', 'failed', 'stopped','killed'].includes(String(taskStatus))) {
        const activity: RuntimeActivity = { ...previous, status: taskStatus === 'completed' ? 'completed' : taskStatus === 'failed' ? 'failed' : 'cancelled', updatedAt: at };
        this.tools.set(activity.id, activity); this.backgroundTasks.delete(taskId!); this.requestedBackground.delete(activity.id); return [activity];
      }
      return [];
    }
    const content = record(msg.message).content;
    const blocks: unknown[] = Array.isArray(content) ? [...content] : [];
    const stream = record(msg.event);
    if (msg.type === 'stream_event' && stream.type === 'content_block_start') blocks.push(stream.content_block);
    const updates: RuntimeActivity[] = [];
    for (const value of blocks) {
      const block = record(value);
      if (block.type === 'tool_use' && ['assistant', 'stream_event'].includes(String(msg.type))) {
        const id = text(block.id), name = text(block.name); if (!id || !name) continue;
        const key = `claude:${scope}:${id}`;
        const previous = this.tools.get(key);
        if (previous && (block.input === undefined || previous.status !== 'running')) continue;
        const semanticName=claudeToolSemanticName(name),changes=claudeFileChanges(semanticName,block.input);
        const category:ActivityCategory|undefined=['WebSearch','WebFetch'].includes(semanticName)?'search':['Read','Glob','Grep'].includes(semanticName)?'read':undefined;
        const activity: RuntimeActivity = { ...base, ...previous, ...claudeToolDetails(name, block.input), ...(changes?{fileChanges:changes}:{}),...(category?{category}:{}), id: key, kind: kind(semanticName), toolName: name, status: previous?.status ?? 'running', updatedAt: at };
        if (record(block.input).run_in_background === true) this.requestedBackground.add(key);
        this.tools.set(key, activity); updates.push(activity);
      } else if (block.type === 'tool_result' && msg.type === 'user') {
        const id = text(block.tool_use_id); if (!id) continue;
        const previous = this.tools.get(`claude:${scope}:${id}`); if (!previous) continue;
        const taskId = text(record(msg.tool_use_result).backgroundTaskId);
        if (taskId) { this.backgroundTasks.set(taskId, previous.id); this.requestedBackground.add(previous.id); }
        const viewed=claudeToolSemanticName(previous.toolName??'')==='Read'&&block.is_error!==true&&Array.isArray(block.content)&&block.content.some(value=>record(value).type==='image');
        let imagePath:unknown;if(viewed)try{imagePath=record(JSON.parse(previous.input??'{}')).file_path;}catch{/* Incomplete native arguments do not create a preview source. */}
        const activity: RuntimeActivity = { ...previous, ...boundedDetails(undefined, claudeResultText(block.content)), ...(viewed?{category:'image' as const,...(typeof imagePath==='string'&&imagePath.length<=4096?{imagePaths:[imagePath]}:{})}:{}), fileChanges:claudeCompletedChanges(previous.fileChanges,msg.tool_use_result), status: block.is_error === true ? 'failed' : this.requestedBackground.has(previous.id) ? 'running' : 'completed', updatedAt: at };
        this.tools.set(activity.id, activity); updates.push(activity);
      }
    }
    this.prune();
    return updates;
  }
  private prune() { if (this.tools.size > 2048) for (const [id, item] of this.tools) { if (item.status !== 'running') this.tools.delete(id); if (this.tools.size <= 1024) break; } }
}

export function mergeActivity(items: RuntimeActivity[], next: RuntimeActivity): void {
  const index = items.findIndex(item => item.id === next.id);
  if (index >= 0) {
    const previous = items[index]!;
    if (previous.updatedAt > next.updatedAt || (previous.status !== 'running' && next.status === 'running')) return;
    items[index] = { ...previous, ...next, ...(next.imagePaths&&JSON.stringify(next.imagePaths)!==JSON.stringify(previous.imagePaths)?{viewedAttachments:undefined}:{}), startedAt: previous.startedAt, ...(previous.imageDelivery?.attachment ? {title:previous.imageDelivery.attachment.path} : {}) };
  } else items.push(next);
  if (items.length > 256) items.splice(0, items.length - 256);
}

export function mergeChild(items: NativeChildSnapshot[], event: NativeChildEvent, updatedAt: string): void {
  // Replace Claude's temporary parent-tool-use identity when task_started supplies the native task ID.
  const index = items.findIndex(item => item.nativeChildId === event.nativeChildId || (event.toolCallId && item.toolCallId === event.toolCallId && item.nativeChildId.startsWith('parent-tool-use:')));
  if (index >= 0) {
    const previous = items[index]!;
    if (previous.updatedAt > updatedAt) return;
    const settings=mergeChildSettings(previous.settings,mergeChildSettings(childSettings({model:event.model},'requested'),event.settings));
    if (['completed', 'failed', 'closed'].includes(previous.operation) && event.operation === 'progress') { previous.settings=settings;return; }
    items[index] = { ...previous, ...event, settings, updatedAt, ...(event.task!==undefined&&event.task!==previous.task?{taskTranslation:undefined}:{}) };
  } else items.push({ ...event, settings:mergeChildSettings(childSettings({model:event.model},'requested'),event.settings), updatedAt, startedAt: updatedAt });
  if (items.length > 128) items.splice(0, items.length - 128);
}

/** Earlier builds misread Claude tool heartbeats as child frames. Those phantoms carry no
 * request, task, title or message and their call ID is not an Agent/Task call. */
export function dropToolProgressPhantoms(session: { activities?: RuntimeActivity[]; nativeChildren?: NativeChildSnapshot[] }): void {
  if (!session.nativeChildren?.length) return;
  const agentCall = (id: string) => (session.activities ?? []).some(activity => activity.id.endsWith(':' + id) && ['Agent', 'Task'].includes(activity.toolName ?? ''));
  session.nativeChildren = session.nativeChildren.filter(child => !(child.runtime === 'claude' && child.toolCallId && child.nativeChildId === 'parent-tool-use:' + child.toolCallId && !child.title && !child.task && !child.model && !child.messages?.length && !agentCall(child.toolCallId)));
}

export function markObservationInterrupted(session: { activities?: RuntimeActivity[]; nativeChildren?: NativeChildSnapshot[]; nativeObservation?: string; nativeBackground?:import('../native-events/semantics').NativeBackgroundState }): void {
  session.nativeObservation = 'disconnected';
  if(session.nativeBackground)session.nativeBackground.observing=false;
  for (const item of session.activities ?? []) if (item.status === 'running') item.status = 'uncertain';
  for (const item of session.activities ?? []) { if (item.imageDelivery?.status === 'receiving') item.imageDelivery = {status:'failed',error:'GENERATED_IMAGE_DELIVERY_INTERRUPTED',remoteCopy:item.imageDelivery.remoteCopy==='not-applicable'?'not-applicable':'retained'}; else if (item.imageDelivery?.remoteCopy === 'pending') item.imageDelivery.remoteCopy = 'retained'; }
  for (const item of session.nativeChildren ?? []) if (['spawn', 'progress'].includes(item.operation)) item.status = 'uncertain';
}
