import type { NativeFrame } from '../../services/remote-supervisor';
import type { RuntimeActivity, ActivityStatus } from './activity';
import { boundedDetails } from './activity-details';
import { claudeRetryNotice } from '../runtime-claude/retry';
import { claudeResultOutcome } from '../runtime-claude/result';
import { nativeEventSemantics } from '../native-events/semantics';

export type ActivityCategory = 'search' | 'read' | 'image' | 'image-generation' | 'compaction' | 'retry' | 'hook' | 'notice' | 'reasoning' | 'wait' | 'review' | 'usage';
const object=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const text=(v:unknown)=>typeof v==='string'?v:undefined;
/** A completed model item or a newly admitted native tool proves retry recovery. */
export function nativeResponseRecovered(runtime:'codex'|'claude',frame:NativeFrame):boolean{
  const v=frame.value,p=object(v.params),item=object(p.item);
  return runtime==='codex'?(v.method==='item/completed'&&item.type==='agentMessage'||v.method==='item/started'&&['commandExecution','fileChange','mcpToolCall','dynamicToolCall','collabAgentToolCall'].includes(item.type))
    :v.type==='assistant'&&v.isApiErrorMessage!==true&&Array.isArray(object(v.message).content)&&object(v.message).content.some((part:unknown)=>['text','tool_use'].includes(object(part).type));
}
const codexMethods=new Set(['thread/compacted','hook/started','hook/completed','model/rerouted','model/safetyBuffering/updated','item/mcpToolCall/progress','item/commandExecution/terminalInteraction','warning','guardianWarning','deprecationNotice','configWarning','mcpServer/startupStatus/updated','item/autoApprovalReview/started','item/autoApprovalReview/completed','autoApprovalReview/strictReviewRequired']);
const claudeSystems=new Set(['status','compact_boundary','hook_started','hook_progress','hook_response','informational','notification','permission_denied','local_command_output','plugin_install','control_request_progress','model_refusal_fallback','model_refusal_no_fallback','worker_shutting_down','background_tasks_changed','session_state_changed','commands_changed','files_persisted','elicitation_complete','mirror_error','code_change_published','vcs_state_changed','feedback_draft_queued','dev_intent','turn_preempted','peer_message_hold','per_turn_effort_changed']);
export function isRuntimeNotice(runtime:'codex'|'claude',frame:NativeFrame){
  const v=frame.value;
  return runtime==='codex'?codexMethods.has(String(v.method))||['error','remoteControl/status/changed'].includes(String(v.method)):
    ['tool_progress','tool_use_summary','rate_limit_event','command_lifecycle','conversation_reset'].includes(String(v.type))||v.type==='system'&&(claudeSystems.has(String(v.subtype))||v.subtype==='api_retry')||v.type==='stream_event'&&(object(v.event).type==='content_block_stop'||object(v.event).type==='content_block_start'&&['thinking','redacted_thinking'].includes(object(object(v.event).content_block).type));
}

/** Metadata/public notices only. Never retain thinking text, signatures, auth or opaque payloads. */
export class RuntimeNoticeTracker {
  private items=new Map<string,RuntimeActivity>();
  private sequence=0;
  private thinking=new Map<string,string>();
  private retries=new Map<string,string>();
  constructor(private runtime:'codex'|'claude'){}
  recover(frame:NativeFrame,childId?:string):RuntimeActivity[]{
    if(!nativeResponseRecovered(this.runtime,frame))return [];
    const turnId=object(frame.value.params).turnId,result:RuntimeActivity[]=[];
    for(const [id,item]of this.items)if(item.category==='retry'&&item.status==='running'&&item.nativeChildId===childId&&(!item.turnId||item.turnId===turnId)){
      const next={...item,status:'completed' as const,updatedAt:frame.receivedAt};this.items.set(id,next);result.push(next);
    }
    if(result.length)this.retries.delete(childId??'root');return result;
  }
  observe(frame:NativeFrame,childId?:string):RuntimeActivity[]{
    const v=frame.value,p=object(v.params),scope=childId??'root',at=frame.receivedAt;
    const save=(key:string,category:ActivityCategory,status:ActivityStatus,details:Partial<RuntimeActivity>={})=>{
      const id=`${this.runtime}:${scope}:notice:${key}`,old=this.items.get(id);
      const next:RuntimeActivity={runtime:this.runtime,kind:'tool',id,startedAt:old?.startedAt??at,nativeOrder:frame.sequence,...(childId?{nativeChildId:childId}:{}),...(text(p.turnId)?{turnId:p.turnId}:{}),...old,...details,category,status,updatedAt:at};
      this.items.set(id,next);if(this.items.size>256)for(const [id,item]of this.items){if(item.status!=='running')this.items.delete(id);if(this.items.size<=128)break;}return next;
    };
    const finished=this.runtime==='codex'?v.method==='turn/completed':v.type==='result';
    if(finished){
      const result:RuntimeActivity[]=[];
      const knownOutcome=this.runtime==='claude'?claudeResultOutcome(v):['completed','failed','interrupted'].includes(object(p.turn).status);
      this.retries.delete(scope);
      for(const [id,item]of this.items)if(item.nativeChildId===childId&&item.status==='running'){const next={...item,status:(!knownOutcome?'uncertain':knownOutcome==='failed'||object(p.turn).status==='failed'?'failed':object(p.turn).status==='interrupted'?'cancelled':['retry','wait'].includes(item.category??'')?'completed':'uncertain') as ActivityStatus,updatedAt:at};this.items.set(id,next);result.push(next);}
      if(this.runtime==='claude'){
        const usage=object(v.usage),metrics=Object.fromEntries(Object.entries({durationMs:v.duration_ms,apiDurationMs:v.duration_api_ms,turns:v.num_turns,inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,cacheReadTokens:usage.cache_read_input_tokens,cacheCreationTokens:usage.cache_creation_input_tokens}).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)&&v>=0));
        if(Object.keys(metrics).length)result.push(save('usage:'+(v.uuid??++this.sequence),'usage','completed',boundedDetails(undefined,JSON.stringify(metrics,null,2))));
      }
      return result;
    }
    if(this.runtime==='codex'){
      if(['warning','guardianWarning','deprecationNotice','configWarning'].includes(String(v.method)))return [save('warning:'+String(v.method),'notice','uncertain',{presentation:'diagnostic',...boundedDetails(undefined,[text(p.message)??text(p.summary),text(p.details)].filter(Boolean).join('\n'))})];
      if(v.method==='mcpServer/startupStatus/updated')return [save('mcp:'+String(p.name),'notice',p.status==='starting'?'running':p.status==='failed'?'failed':p.status==='cancelled'?'cancelled':p.status==='ready'?'completed':'uncertain',{title:'MCP 初始化 · '+String(p.name??''),presentation:'diagnostic',...boundedDetails(undefined,[text(p.status),text(p.error)].filter(Boolean).join('\n'))})];
      if(v.method==='remoteControl/status/changed')return [save('remote-control','notice','completed',{title:'远程控制连接状态',presentation:'diagnostic',...boundedDetails(undefined,text(p.status)??text(object(p.status).type))})];
      if(v.method==='item/autoApprovalReview/started'||v.method==='item/autoApprovalReview/completed'){const status=object(p.review).status;return [save('approval-review:'+String(p.reviewId),'review',status==='inProgress'&&v.method.endsWith('/started')?'running':status==='approved'?'completed':status==='denied'?'failed':status==='aborted'?'cancelled':'uncertain',boundedDetails(undefined,text(status)))];}
      if(v.method==='autoApprovalReview/strictReviewRequired')return [save('strict-review:'+String(p.turnId),'notice','uncertain',{title:'autoApprovalReview/strictReviewRequired'})];
      if(v.method==='error')return [save(`retry:${p.turnId??''}`,p.willRetry===true?'retry':'notice',p.willRetry===true?'running':'failed',boundedDetails(undefined,text(object(p.error).message)))];
      if(v.method==='thread/compacted')return [save(`compact:${p.turnId??''}`,'compaction','completed')];
      if(v.method==='hook/started'||v.method==='hook/completed'){const run=object(p.run);if(!text(run.id))return [];return [save(`hook:${run.id}`,'hook',v.method==='hook/started'&&(run.status===undefined||run.status==='running')?'running':['failed','blocked','errored'].includes(run.status)?'failed':run.status==='stopped'?'cancelled':run.status==='completed'?'completed':'uncertain',{title:text(run.eventName),...boundedDetails(undefined,text(run.statusMessage)),...(typeof run.durationMs==='number'?{durationMs:run.durationMs}:{})})];}
      if(v.method==='model/rerouted')return [save(`model:${p.turnId??''}`,'notice','completed',{title:'Model rerouted',...boundedDetails(undefined,[text(p.fromModel),text(p.toModel),text(p.reason)].filter(Boolean).join(' → '))})];
      if(v.method==='model/safetyBuffering/updated')return [save(`buffer:${p.turnId??''}`,'wait',p.showBufferingUi?'running':'completed')];
      return [];
    }
    if(v.type==='command_lifecycle'){
      const command=nativeEventSemantics.command(v);if(!command)return [];
      const labels={queued:'消息已排队',started:'消息已开始处理',completed:'消息消费回合已结束',cancelled:'消息处理已取消',discarded:'消息未被接收',refused:'消息被原生运行时拒绝'};
      return [save('command:'+command.id,'notice',command.state==='refused'?'failed':['cancelled','discarded'].includes(command.state)?'cancelled':'completed',{title:labels[command.state],presentation:'diagnostic',...boundedDetails(undefined,'Command: '+command.id+'\nState: '+command.state+'\nThis receipt does not establish the turn result.')})];
    }
    if(v.type==='conversation_reset')return [save('reset:'+String(v.uuid??++this.sequence),'notice','completed',{title:'原生上下文已重置',...boundedDetails(undefined,'Workbench history remains available. '+(text(v.trigger)??''))})];
    if(v.type==='stream_event'){
      const event=object(v.event),key=scope+':'+String(event.index);
      if(event.type==='content_block_start'&&['thinking','redacted_thinking'].includes(object(event.content_block).type)){const id='thinking:'+ ++this.sequence;this.thinking.set(key,id);return [save(id,'reasoning','running')];}
      if(event.type==='content_block_stop'){const id=this.thinking.get(key);if(id){this.thinking.delete(key);return [save(id,'reasoning','completed')];}}
    }
    if(v.type==='system'){
      if(v.subtype==='background_tasks_changed'){
        const tasks=nativeEventSemantics.background(v);if(!tasks)return [];
        return [save('background','notice','completed',{title:`后台任务快照 · ${tasks.filter(t=>!t.ambient).length} 项`,presentation:'diagnostic',...boundedDetails(undefined,tasks.map(t=>`${t.type}: ${t.description}${t.ambient?' (ambient)':''}`).join('\n')||'No active background tasks. Results are tracked separately.')})];
      }
      if(v.subtype==='session_state_changed')return [save('session-state','notice','completed',{title:({idle:'原生回合已排空',running:'原生会话处理中',requires_action:'原生会话等待操作'} as Record<string,string>)[String(v.state)]??'原生会话状态未识别',presentation:'diagnostic'})];
      if(v.subtype==='commands_changed')return [save('commands','notice','completed',{title:'原生命令目录已更新',presentation:'diagnostic',...boundedDetails(undefined,Array.isArray(v.commands)?v.commands.map(c=>text(object(c).name)).filter(Boolean).join('\n'):undefined)})];
      if(v.subtype==='files_persisted'){const failed=Array.isArray(v.failed)?v.failed:[],files=Array.isArray(v.files)?v.files:[];return [save('files:'+String(v.uuid??++this.sequence),'notice',failed.length?'failed':'completed',{title:`原生文件保存 · ${files.length} 成功 / ${failed.length} 失败`,presentation:'diagnostic',...boundedDetails(undefined,[...files.map(f=>text(object(f).filename)),...failed.map(f=>[text(object(f).filename),text(object(f).error)].filter(Boolean).join(': '))].filter(Boolean).join('\n'))})];}
      if(v.subtype==='peer_message_hold')return [save('peer:'+String(v.message_uuid??v.uuid??++this.sequence),'notice',v.state==='dropped'?'cancelled':'completed',{title:({held:'协作消息被原生策略暂存',released:'协作消息已释放',dropped:'协作消息已丢弃'} as Record<string,string>)[String(v.state)]??'协作消息状态未识别',presentation:'diagnostic',...boundedDetails(undefined,[text(v.lane),text(v.from_name),text(v.cause),text(v.outcome)].filter(Boolean).join('\n'))})];
      const metadata:Record<string,{title:string;fields:string[];failed?:boolean}>={
        worker_shutting_down:{title:'原生工作进程关闭通知',fields:['reason']},
        elicitation_complete:{title:'MCP 信息收集已结束',fields:['server_name','elicitation_id']},
        mirror_error:{title:'原生会话镜像异常',fields:['error','message'],failed:true},
        code_change_published:{title:'原生代码评审关联提示（尚未核验）',fields:['provider','repo','identifier','action','branch','url']},
        vcs_state_changed:{title:'原生仓库变更提示（需重新读取仓库）',fields:['kind','cwd','branch']},
        feedback_draft_queued:{title:'反馈草稿已生成（未发送）',fields:['title','details_preview']},
        dev_intent:{title:'原生开发类型提示',fields:['kind','trigger']},
        turn_preempted:{title:'原生回合已被后续消息接替',fields:['reason']},
        per_turn_effort_changed:{title:'原生思考档位传输方式已变更',fields:[]},
      };
      const meta=metadata[String(v.subtype)];if(meta)return [save(String(v.subtype)+':'+String(v.uuid??++this.sequence),'notice',meta.failed?'failed':'completed',{title:meta.title,presentation:'diagnostic',...boundedDetails(undefined,meta.fields.map(key=>text(v[key])?key+': '+text(v[key]):undefined).filter(Boolean).join('\n'))})];
      if(v.subtype==='notification')return [save('notification:'+String(v.key??v.uuid??++this.sequence),'notice',['high','immediate'].includes(String(v.priority))?'uncertain':'completed',boundedDetails(undefined,text(v.text)))];
      if(v.subtype==='permission_denied')return [save('denied:'+String(v.tool_use_id??v.uuid??++this.sequence),'notice','failed',{title:text(v.tool_name),...boundedDetails(undefined,text(v.message))})];
      if(v.subtype==='local_command_output')return [save('local-command:'+String(v.uuid??++this.sequence),'notice','completed',boundedDetails(undefined,text(v.content)))];
      if(v.subtype==='plugin_install')return [save('plugin-install:'+String(v.name??'all'),'notice',v.status==='started'?'running':v.status==='failed'?'failed':['installed','completed'].includes(String(v.status))?'completed':'uncertain',{title:text(v.name),...boundedDetails(undefined,text(v.error)??text(v.status))})];
      if(v.subtype==='control_request_progress')return [save('control:'+String(v.request_id),'notice','running',boundedDetails(undefined,text(v.status)))];
      if(v.subtype==='model_refusal_fallback'||v.subtype==='model_refusal_no_fallback')return [save('model-refusal:'+String(v.uuid??++this.sequence),'notice',v.subtype==='model_refusal_no_fallback'?'failed':'uncertain',boundedDetails(undefined,[text(v.original_model),text(v.fallback_model),text(v.content),text(v.api_refusal_explanation)].filter(Boolean).join('\n')))];
      if(v.subtype==='status'&&v.status==='requesting')return [save('requesting','wait','running',{title:'正在请求模型',presentation:'diagnostic'})];
      if(v.subtype==='status'&&v.status===null){const result:RuntimeActivity[]=[];for(const pending of this.items.values())if(pending.status==='running'&&pending.nativeChildId===childId&&['compaction','wait'].includes(pending.category??''))result.push(save(pending.id.split(':notice:')[1]!,pending.category!,pending.category==='compaction'?v.compact_result==='success'?'completed':v.compact_result==='failed'?'failed':'uncertain':'completed',boundedDetails(undefined,text(v.compact_error))));return result;}
      if(v.subtype==='api_retry'){const retry=claudeRetryNotice(v);if(!retry)return [];const key=this.retries.get(scope)??'retry:'+ ++this.sequence;this.retries.set(scope,key);return [save(key,'retry','running',{attempt:retry.attempt,maxAttempts:retry.maxRetries,...boundedDetails(undefined,`Native delay: ${retry.delayMs} ms; ${retry.error}${retry.status?`; HTTP ${retry.status}`:''}`)})];}
      if(v.subtype==='status'&&v.status==='compacting')return [save('compact:'+ ++this.sequence,'compaction','running')];
      if(v.subtype==='compact_boundary'){const pending=[...this.items.values()].findLast(i=>i.category==='compaction'&&i.status==='running'&&i.nativeChildId===childId);const key=pending?.id.split(':notice:')[1]??'compact:'+ ++this.sequence;return [save(key,'compaction','completed',{...boundedDetails(undefined,JSON.stringify({trigger:object(v.compact_metadata).trigger,preTokens:object(v.compact_metadata).pre_tokens}))})];}
      if(['hook_started','hook_progress','hook_response'].includes(String(v.subtype))&&text(v.hook_id))return [save('hook:'+v.hook_id,'hook',v.subtype!=='hook_response'?'running':v.outcome==='error'?'failed':v.outcome==='cancelled'?'cancelled':v.outcome==='success'?'completed':'uncertain',{title:[text(v.hook_name),text(v.hook_event)].filter(Boolean).join(' · '),...boundedDetails(undefined,text(v.output)??[text(v.stdout),text(v.stderr)].filter(Boolean).join('\n'))})];
      if(v.subtype==='informational'&&text(v.content))return [save('info:'+(v.uuid??++this.sequence),'notice',v.level==='warning'?'uncertain':'completed',boundedDetails(undefined,text(v.content)))];
    }
    if(v.type==='tool_use_summary'&&text(v.summary))return [save('summary:'+(v.uuid??++this.sequence),'notice','completed',boundedDetails(undefined,text(v.summary)))];
    if(v.type==='rate_limit_event'){const info=object(v.rate_limit_info);if(!['allowed_warning','rejected'].includes(info.status))return [];return [save('rate-limit','notice',info.status==='rejected'?'failed':'uncertain',{title:'Native usage limit',...boundedDetails(undefined,JSON.stringify({status:info.status,resetsAt:info.resetsAt,utilization:info.utilization}))})];}
    return [];
  }
}
