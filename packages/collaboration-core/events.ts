import type { NativeFrame } from '../../services/remote-supervisor/index.js';
import { childSettings, nativeChildFrameSettings, type NativeChildSettings } from './child-settings';
import { nativeEventSemantics } from '../native-events/semantics';

export interface NativeChildEvent {
  runtime: 'claude' | 'codex';
  nativeParentId?: string;
  /** Claude may initially use parent-tool-use:<id> until a native task ID arrives. */
  nativeChildId: string;
  operation: 'spawn' | 'progress' | 'completed' | 'failed' | 'closed';
  status: string;
  /** Requested model metadata from a native call; not an effective-model receipt. */
  model?: string;
  settings?: NativeChildSettings;
  title?: string;
  task?: string;
  toolCallId?: string;
  usage?:{tokens?:number;toolUses?:number;durationMs?:number};
  lastTool?:string;
  /** Native level snapshot; false does not establish the result's success. */
  backgroundActive?:boolean;
  background?:boolean;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;
const operation = (status: string): NativeChildEvent['operation'] => status === 'completed' ? 'completed' : ['errored', 'failed'].includes(status) ? 'failed' : ['shutdown', 'stopped', 'killed', 'interrupted', 'notFound'].includes(status) ? 'closed' : 'progress';
const codexStatuses = new Set(['pendingInit', 'running', 'interrupted', 'completed', 'errored', 'shutdown', 'notFound']);

/** Pinned rust-v0.155.1 schema: tool completion is not child completion. */
export function parseCodexNativeChildEvents(frame: NativeFrame): NativeChildEvent[] {
  const params = record(frame.value.params), item = record(params.item);
  const method = text(frame.value.method);
  if(method==='thread/started'){
    const thread=record(params.thread),child=text(thread.id),parent=text(thread.parentThreadId);
    const settings=nativeChildFrameSettings('codex',frame);
    return child&&parent?[{runtime:'codex',nativeParentId:parent,nativeChildId:child,operation:'spawn',status:'started',...(Object.keys(settings).length?{settings}:{})}]:[];
  }
  if (!method || !['item/started', 'item/updated', 'item/completed'].includes(method)) return [];
  if (item.type === 'subAgentActivity') {
    const child = text(item.agentThreadId), kind = text(item.kind);
    if (!child || !kind || !['started', 'interacted', 'interrupted', 'completed'].includes(kind)) return [];
    return [{ runtime: 'codex', ...(text(params.threadId) ? { nativeParentId: text(params.threadId) } : {}), nativeChildId: child, operation: kind === 'started' ? 'spawn' : kind === 'completed' ? 'completed' : kind==='interrupted'?'closed':'progress', status: kind }];
  }
  if (item.type !== 'collabAgentToolCall') return [];
  const states = record(item.agentsStates), receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  const ids = new Set([...receivers, ...Object.keys(states)]);
  const events: NativeChildEvent[] = [];
  for (const child of ids) {
    const status = text(record(states[child]).status);
    // A successful wait/send/close call alone does not establish child lifecycle.
    if (!status || !codexStatuses.has(status)) continue;
    events.push({ runtime: 'codex', ...(text(item.senderThreadId) ? { nativeParentId: text(item.senderThreadId) } : {}), nativeChildId: child, operation: item.tool === 'spawnAgent' && ['pendingInit', 'running'].includes(status) ? 'spawn' : operation(status), status, ...(text(item.model) ? { model: text(item.model) } : {}), ...(item.tool==='spawnAgent'?{settings:childSettings(item,'requested')}:{}), ...(text(item.prompt) ? { task: String(item.prompt).slice(0,65536) } : {}), ...(text(item.id) ? { toolCallId: text(item.id) } : {}) });
  }
  return events;
}

export interface ClaudeChildObservation { child: boolean; events: NativeChildEvent[]; nativeChildId?: string }
interface ClaudeTask { nativeChildId: string; toolCallId?: string; nativeParentId?: string; title?:string; task?:string; model?:string; settings?:NativeChildSettings; background?:boolean }

/** Correlate only explicitly classified native agent tasks; shell/MCP tasks stay out. */
export class ClaudeNativeChildTracker {
  private readonly tasks = new Map<string, ClaudeTask>();
  private readonly tools = new Map<string, ClaudeTask>();
  private readonly requests = new Map<string,{title?:string;task?:string;model?:string;settings?:NativeChildSettings;background:boolean}>();
  private readonly stops = new Map<string,string>();
  private readonly terminal = new Set<string>();
  observe(frame: NativeFrame, parentId?: string): ClaudeChildObservation {
    const msg = frame.value, parentTool = text(msg.parent_tool_use_id), taskId = text(msg.task_id), toolId = text(msg.tool_use_id);
    const nativeParentId = (parentTool?this.tools.get(parentTool)?.nativeChildId:undefined) ?? parentId ?? (parentTool ? undefined : text(msg.session_id));
    const snapshot=nativeEventSemantics.background(msg);
    if(snapshot){
      const events:NativeChildEvent[]=[];
      for(const item of snapshot)if(nativeEventSemantics.taskKind(item.type)==='agent'&&!item.ambient&&!this.terminal.has(item.id)){
        const known=this.tasks.get(item.id),task:ClaudeTask={...known,nativeChildId:item.id,nativeParentId,background:true,...(item.description?{title:item.description}:{})};
        this.tasks.set(item.id,task);if(task.toolCallId)this.tools.set(task.toolCallId,task);
        if(!known)events.push({runtime:'claude',...task,operation:'spawn',status:'started',backgroundActive:true});
      }
      return {child:false,events};
    }
    const content=record(msg.message).content,stream=record(msg.event),blocks=msg.type==='assistant'&&Array.isArray(content)?content:msg.type==='stream_event'&&stream.type==='content_block_start'?[stream.content_block]:[];
    for(const value of blocks){const block=record(value),input=record(block.input),id=text(block.id);if(block.type==='tool_use'&&id){if(['Agent','Task'].includes(String(block.name)))this.requests.set(id,{title:text(input.description)?.slice(0,256),task:text(input.prompt)?.slice(0,65536),model:text(input.model),settings:childSettings(input,'requested'),background:input.run_in_background===true});else if(block.name==='TaskStop'&&text(input.task_id))this.stops.set(id,String(input.task_id));}}
    if(!parentTool&&msg.type==='user'&&Array.isArray(content)){
      const events:NativeChildEvent[]=[];
      for(const value of content){const block=record(value),id=text(block.tool_use_id),request=id?this.requests.get(id):undefined;if(block.type!=='tool_result'||!id)continue;
        const stopped=this.stops.get(id),stoppedTask=stopped?this.tasks.get(stopped):undefined;
        let stopResult=record(msg.tool_use_result);
        if(!stopResult.task_id&&typeof block.content==='string'){try{stopResult=record(JSON.parse(block.content));}catch{/* A text-only claim is not a typed stop receipt. */}}
        if(stoppedTask&&block.is_error!==true&&stopResult.task_id===stoppedTask.nativeChildId&&nativeEventSemantics.taskKind(String(stopResult.task_type))==='agent'){this.terminal.add(stoppedTask.nativeChildId);events.push({runtime:'claude',...stoppedTask,operation:'closed',status:'stopped'});this.stops.delete(id);}
        if(request&&!request.background){const existing=this.tools.get(id),result=record(msg.tool_use_result);if(existing?.background||result.isAsync===true)continue;const task:ClaudeTask={...request,...existing,nativeChildId:existing?.nativeChildId??text(result.agentId)??`parent-tool-use:${id}`,toolCallId:id,nativeParentId};this.tools.set(id,task);this.terminal.add(task.nativeChildId);events.push({runtime:'claude',...task,operation:block.is_error?'failed':'completed',status:block.is_error?'failed':'completed'});}}
      if(events.length)return {child:false,events};
    }
    if (msg.type === 'system' && msg.subtype === 'task_started' && taskId && nativeEventSemantics.taskKind(String(msg.task_type))==='agent') {
      const request=toolId?this.requests.get(toolId):undefined;
      const task: ClaudeTask = { ...(request?{title:request.title,task:request.task,model:request.model,settings:request.settings}:{}),...(text(msg.prompt)?{task:String(msg.prompt).slice(0,65536)}:{}),...(text(msg.description)?{title:String(msg.description).slice(0,256)}:{}), background:typeof msg.is_backgrounded==='boolean'?msg.is_backgrounded:request?.background,nativeChildId: taskId, ...(toolId ? { toolCallId: toolId } : {}), ...(nativeParentId ? { nativeParentId } : {}) };
      if(this.terminal.has(taskId))return {child:true,nativeChildId:taskId,events:[]};
      this.tasks.set(taskId, task); if (toolId) this.tools.set(toolId, task);
      return { child: true, nativeChildId: taskId, events: [{ runtime: 'claude', ...task, operation: 'spawn', status: 'started' }] };
    }
    if(taskId&&toolId&&!this.tasks.has(taskId)&&this.requests.has(toolId)){
      const request=this.requests.get(toolId)!;const task:ClaudeTask={...request,nativeChildId:taskId,toolCallId:toolId,nativeParentId};this.tasks.set(taskId,task);this.tools.set(toolId,task);
    }
    const task = (taskId ? this.tasks.get(taskId) : undefined) ?? (parentTool ? this.tools.get(parentTool) : undefined);
    if (msg.type === 'system' && task && ['task_progress', 'task_notification','task_updated'].includes(String(msg.subtype))) {
      const patch=record(msg.patch),status = msg.subtype === 'task_progress' ? 'running' : msg.subtype==='task_updated'?text(patch.status):text(msg.status),usage=record(msg.usage);
      const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:undefined;
      if(typeof patch.is_backgrounded==='boolean')task.background=patch.is_backgrounded;
      if(status&&['completed','failed','stopped','killed'].includes(status))this.terminal.add(task.nativeChildId);
      else if(this.terminal.has(task.nativeChildId))return {child:true,nativeChildId:task.nativeChildId,events:[]};
      if (status && ['pending','running','paused', 'completed', 'failed', 'stopped','killed'].includes(status)) return { child: true, nativeChildId: task.nativeChildId, events: [{ runtime: 'claude', ...task, operation: operation(status), status,...(Object.keys(usage).length?{usage:{tokens:number(usage.total_tokens),toolUses:number(usage.tool_uses),durationMs:number(usage.duration_ms)}}:{}),...(text(msg.last_tool_name)?{lastTool:text(msg.last_tool_name)}:{}) }] };
    }
    if (parentTool) {
      const request=this.requests.get(parentTool);
      const scoped = task ?? { ...(request?{title:request.title,task:request.task,model:request.model,settings:request.settings}:{}), nativeChildId: `parent-tool-use:${parentTool}`, toolCallId: parentTool, ...(nativeParentId ? { nativeParentId } : {}) };
      // SDKResultMessage does not promise a child result shape. A marked result is
      // defensively quarantined; normal completion comes from correlated task events.
      return { child: true, nativeChildId: scoped.nativeChildId, events: this.terminal.has(scoped.nativeChildId)?[]:[{ runtime: 'claude', ...scoped, operation: 'progress', status: task||request?'message':'uncertain' }] };
    }
    return { child: false, events: [] };
  }
}

/** Use a retained tracker for Claude task correlation. */
export function parseNativeChildEvents(frame: NativeFrame, tracker = new ClaudeNativeChildTracker()): NativeChildEvent[] {
  return typeof frame.value.method === 'string' ? parseCodexNativeChildEvents(frame) : tracker.observe(frame).events;
}

export function hasClaudeChildMarker(frame: NativeFrame): boolean { return !!text(frame.value.parent_tool_use_id); }
