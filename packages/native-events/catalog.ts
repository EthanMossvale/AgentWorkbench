import type { NativeEventCoverage, NativeEventDisposition, NativeEventRuntime } from './types';

// Audited discriminator facts, not vendor implementation code. See the dated audit.
const entries: NativeEventCoverage[] = [];
function group(runtime: NativeEventRuntime, prefix: string, disposition: NativeEventDisposition, route: string, names: string[]) {
  for (const name of names) entries.push({runtime,key:prefix+name,disposition,route});
}
group('codex','notification/','handled','session/message/activity/interaction',[
  'error','thread/started','thread/name/updated','thread/tokenUsage/updated','turn/started','turn/completed','turn/plan/updated',
  'hook/started','hook/completed','item/started','item/completed','item/agentMessage/delta','item/plan/delta',
  'item/commandExecution/outputDelta','item/commandExecution/terminalInteraction','item/fileChange/outputDelta',
  'item/fileChange/patchUpdated','serverRequest/resolved','item/mcpToolCall/progress','thread/compacted',
  'model/rerouted','model/safetyBuffering/updated','account/rateLimits/updated',
  'warning','guardianWarning','deprecationNotice','configWarning','mcpServer/startupStatus/updated',
  'item/autoApprovalReview/started','item/autoApprovalReview/completed','autoApprovalReview/strictReviewRequired','remoteControl/status/changed',
]);
group('codex','notification/','observed','metadata notice; native state is not an authorization or turn result',[
  'thread/status/changed','thread/archived','thread/deleted','thread/unarchived','thread/closed','thread/reverted',
  'skills/changed','thread/attachment/updated','thread/goal/updated','thread/goal/cleared',
  'thread/queue/changed','project/changed','thread/project/updated','thread/environment/connected',
  'thread/environment/disconnected','thread/settings/updated','turn/diff/updated','mcpServer/oauthLogin/completed',
  'mcpServer/event/stream/notification','account/updated','app/list/updated','modelProvider/authRecoveryStarted',
  'modelProvider/authRecoveryCompleted','windows/worldWritableWarning','windowsSandbox/setupCompleted','account/login/completed',
]);
group('codex','notification/','private','metadata only; hidden reasoning and verification payloads excluded',[
  'item/reasoning/summaryTextDelta','item/reasoning/summaryPartAdded','item/reasoning/textDelta',
  'model/verification','turn/moderationMetadata',
]);
group('codex','notification/','unsupported','capability not enabled by the workbench session launcher; receipt remains visible',[
  'command/exec/outputDelta','process/outputDelta','process/exited',
  'externalAgentConfig/import/progress','externalAgentConfig/import/completed','fs/changed',
  'fuzzyFileSearch/sessionUpdated','fuzzyFileSearch/sessionCompleted','thread/realtime/started',
  'thread/realtime/itemAdded','thread/realtime/item/started','thread/realtime/item/transcript/delta',
  'thread/realtime/item/completed','thread/realtime/transcript/delta','thread/realtime/transcript/done',
  'thread/realtime/outputAudio/delta','thread/realtime/sdp','thread/realtime/error','thread/realtime/closed',
]);
group('codex','notification/','handled','workbench bridge or compatible legacy item lifecycle',[
  'item/updated','workbench/bridgeReady',
]);
group('codex','request/','handled','bound request router; schema-specific validation; unsupported forms explicitly rejected',[
  'item/commandExecution/requestApproval','item/fileChange/requestApproval','item/tool/requestUserInput',
  'mcpServer/elicitation/request','item/permissions/requestApproval','item/tool/call','currentTime/read',
]);
group('codex','request/','unsupported','explicit JSON-RPC error; no external credential ownership or legacy approval',[
  'account/chatgptAuthTokens/refresh','attestation/generate','applyPatchApproval','execCommandApproval',
]);
group('codex','item/','handled','native messages, plan, activity or child lifecycle',[
  'userMessage','hookPrompt','agentMessage','functionCallOutput','plan','reasoning','commandExecution','fileChange',
  'mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity','webSearch','imageView','sleep',
  'imageGeneration','enteredReviewMode','exitedReviewMode','contextCompaction',
]);
group('codex','content/','handled','native input or public output text',['text','inputText','skill','mention']);
group('codex','content/','observed','structured or media content metadata; no opaque output dump',['image','localImage','inputImage','audio','localAudio','inputAudio','resource','resource_link']);
group('claude','message/','handled','stream, message, metrics or control router',[
  'assistant','user','result','stream_event','system','tool_progress','tool_use_summary','rate_limit_event',
  'control_response','control_cancel_request','control_request','keep_alive','command_lifecycle','conversation_reset',
]);
group('claude','message/','observed','native capability notice; no automatic prompt submission or authentication output',[
  'auth_status','prompt_suggestion','active_goal',
]);
group('claude','system/','handled','session, activity, child or public notice',[
  'init','status','compact_boundary','api_retry','hook_started','hook_progress','hook_response','informational',
  'task_started','task_progress','task_notification','task_updated','notification','permission_denied',
  'local_command_output','plugin_install','control_request_progress','model_refusal_fallback','model_refusal_no_fallback',
  'worker_shutting_down','background_tasks_changed','session_state_changed','commands_changed',
  'files_persisted','elicitation_complete','mirror_error','code_change_published','vcs_state_changed',
  'feedback_draft_queued','dev_intent','turn_preempted','peer_message_hold','per_turn_effort_changed',
]);
group('claude','system/','observed','metadata notice; no invented history, checkpoint, command or task result',[
  'thinking_tokens',
]);
group('claude','system/','unsupported','cloud worker transport is not launched; capability notice does not authorize a handoff',['cloud_session_delta','turn_handoff_available']);
group('claude','system/','private','native memory content is not copied into conversation state',['memory_recall']);
group('claude','stream/','handled','partial message or lifecycle bookkeeping',[
  'message_start','message_delta','message_stop','content_block_start','content_block_delta','content_block_stop','ping','error',
]);
group('claude','content/','handled','message or tool activity',['text','tool_use','tool_result']);
group('claude','content/','private','lifecycle only; no thinking body or signature',['thinking','redacted_thinking']);
group('claude','content/','observed','non-text content receipt; payload not serialized',[
  'image','document','search_result','server_tool_use','web_search_tool_result','web_fetch_tool_result',
  'code_execution_tool_result','bash_code_execution_tool_result','text_editor_code_execution_tool_result',
  'tool_search_tool_result','tool_reference','container_upload',
]);
group('claude','delta/','handled','text stream or deferred authoritative tool input',['text_delta','input_json_delta']);
group('claude','delta/','private','hidden thinking or signature',['thinking_delta','signature_delta']);
group('claude','delta/','observed','citation metadata; no arbitrary content promotion',['citations_delta']);
group('claude','result/','handled','known terminal outcome',['success','error_during_execution','error_max_turns','error_max_budget_usd','error_max_structured_output_retries']);
group('claude','system-status/','handled','request or compaction progress; not a turn result',['compacting','requesting']);
group('claude','control/','handled','bound native request; typed interaction or tool permission',['can_use_tool','elicitation']);
group('claude','control/','unsupported','not registered by this launcher; explicit control error',['hook_callback','mcp_message','request_user_dialog']);
group('codex','rpc/','handled','correlated pending RPC or late-response quarantine',['result','error']);

export const nativeEventCatalog: readonly NativeEventCoverage[] = Object.freeze(entries.map(entry=>Object.freeze(entry)));
const lookup = new Map(entries.map(entry=>[entry.runtime+':'+entry.key,entry]));
export const record = (value: unknown): Record<string, unknown> => value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
/** Discriminator text is metadata, never a free-form payload or URL. */
export function discriminator(value: unknown): string {
  return typeof value==='string' && value.length<=160 && /^[A-Za-z][A-Za-z0-9_./-]*$/.test(value) && !value.split(/[./]/).some(part=>part.length>64) ? value : '[invalid]';
}
export function inspectNativeEvent(runtime: NativeEventRuntime, value: Readonly<Record<string,unknown>>): NativeEventCoverage[] {
  if(!['codex','claude'].includes(runtime))throw Error('NATIVE_EVENT_RUNTIME_INVALID');
  if(!value||typeof value!=='object'||Array.isArray(value))return [{runtime,key:'envelope/[invalid]',disposition:'malformed',route:'invalid native envelope; no processing inferred'}];
  const result:NativeEventCoverage[]=[],seen=new Set<string>();
  const add=(prefix:string,name:unknown)=>{
    const key=prefix+discriminator(name);if(seen.has(key))return;seen.add(key);
    result.push(lookup.get(runtime+':'+key)??{runtime,key,disposition:key.endsWith('[invalid]')?'malformed':'unknown',route:'bounded compatibility receipt; no execution or completion inferred'});
  };
  const enumValue=(prefix:string,value:unknown,allowed:unknown[])=>{if(value!==undefined&&!allowed.includes(value))add(prefix,value);};
  const invalidShape=(name:string)=>{result.push({runtime,key:'shape/'+name,disposition:'malformed',route:'Known native payload failed required-field validation; no state change inferred'});};
  const truncated=()=>{if(!seen.has('inspection/truncated')){seen.add('inspection/truncated');result.push({runtime,key:'inspection/truncated',disposition:'unsupported',route:'Nested discriminator inspection limit reached; additional content was not inspected or retained'});}};
  if(runtime==='codex'){
    if(typeof value.method!=='string') {add('rpc/',Object.hasOwn(value,'error')?'error':Object.hasOwn(value,'result')?'result':undefined);return result;}
    const request=Object.hasOwn(value,'id');add(request?'request/':'notification/',value.method);
    const p=record(value.params),item=record(p.item);
    if(['item/started','item/updated','item/completed'].includes(value.method))add('item/',item.type);
    const blocks=(values:unknown)=>{if(Array.isArray(values)){if(values.length>256)truncated();for(const raw of values.slice(0,256))add('content/',record(raw).type);}};
    if(item.type==='userMessage')blocks(item.content);
    if(item.type==='functionCallOutput')blocks(item.output);
    if(item.type==='dynamicToolCall')blocks(item.contentItems);
    if(item.type==='mcpToolCall')blocks(record(item.result).content);
    if(['turn/started','turn/completed'].includes(value.method))enumValue('turn-status/',record(p.turn).status,['inProgress','completed','failed','interrupted']);
    if(item.status!==undefined)enumValue('item-status/',item.status,['inProgress','completed','failed','interrupted','declined','cancelled','canceled','succeeded','errored']);
    if(item.type==='agentMessage')enumValue('agent-phase/',item.phase,[null,'commentary','final_answer']);
    if(item.type==='subAgentActivity')enumValue('child-kind/',item.kind,['started','interacted','interrupted','completed']);
    if(value.method==='mcpServer/startupStatus/updated')enumValue('mcp-startup-status/',p.status,['starting','ready','failed','cancelled']);
    if(value.method==='hook/started'||value.method==='hook/completed')enumValue('hook-status/',record(p.run).status,['running','completed','failed','blocked','stopped']);
    if(value.method==='item/autoApprovalReview/started'||value.method==='item/autoApprovalReview/completed')enumValue('review-status/',record(p.review).status,['inProgress','approved','denied','timedOut','aborted']);
  }else{
    add('message/',value.type);
    if(value.type==='system') {add('system/',value.subtype);if(value.subtype==='status'){enumValue('system-status/',value.status,[null,'compacting','requesting']);enumValue('compact-result/',value.compact_result,['success','failed']);}}
    if(value.type==='command_lifecycle')enumValue('command-state/',value.state,['queued','started','completed','cancelled','discarded','refused']);
    if(value.type==='command_lifecycle'&&(typeof value.command_uuid!=='string'||!value.command_uuid||value.state===undefined))invalidShape('command_lifecycle');
    if(value.type==='result'&&value.subtype!==undefined)add('result/',value.subtype);
    if(value.type==='result'&&typeof value.is_error!=='boolean')add('result-error-flag/',undefined);
    if(value.type==='control_request')add('control/',record(value.request).subtype);
    if(value.type==='system'){
      if(value.subtype==='plugin_install')enumValue('plugin-status/',value.status,['started','installed','failed','completed']);
      if(value.subtype==='hook_response')enumValue('hook-outcome/',value.outcome,['success','error','cancelled']);
      if(value.subtype==='control_request_progress')enumValue('control-progress-status/',value.status,['started','api_retry']);
      if(value.subtype==='task_updated')enumValue('task-status/',record(value.patch).status,['pending','running','completed','failed','killed','paused']);
      if(value.subtype==='task_notification')enumValue('task-status/',value.status,['completed','failed','stopped']);
      if(value.subtype==='session_state_changed')enumValue('session-state/',value.state,['idle','running','requires_action']);
      if(value.subtype==='session_state_changed'&&value.state===undefined)invalidShape('session_state_changed');
      if(value.subtype==='background_tasks_changed'){
        const tasks=value.tasks;
        if(!Array.isArray(tasks))invalidShape('background_tasks_changed');
        else if(tasks.length>2048)truncated();
        else if(tasks.some(raw=>{const t=record(raw);return typeof t.task_id!=='string'||!t.task_id||typeof t.task_type!=='string'||!t.task_type||t.ambient!==undefined&&typeof t.ambient!=='boolean';})||new Set(tasks.map(raw=>record(raw).task_id)).size!==tasks.length)invalidShape('background_tasks_changed');
      }
      if(value.subtype==='peer_message_hold')enumValue('peer-hold-state/',value.state,['held','released','dropped']);
    }
    if(value.type==='rate_limit_event')enumValue('rate-limit-status/',record(value.rate_limit_info).status,['allowed','allowed_warning','rejected']);
    let contentBudget=256;
    const content=(blocks:unknown,depth=0)=>{
      if(!Array.isArray(blocks))return;
      if(depth>2){if(blocks.length)truncated();return;}
      for(const raw of blocks){if(contentBudget--<=0){truncated();break;}const block=record(raw);add('content/',block.type);if(block.type==='tool_result')content(block.content,depth+1);}
    };
    if(['assistant','user'].includes(String(value.type))){const blocks=record(value.message).content;content(blocks);if(value.type==='assistant'&&!Array.isArray(blocks))add('content/',undefined);}
    if(value.type==='stream_event'){
      const e=record(value.event);add('stream/',e.type);
      if(e.type==='content_block_start')content([e.content_block]);
      if(e.type==='content_block_delta')add('delta/',record(e.delta).type);
      if(e.type==='message_start')content(record(e.message).content);
    }
  }
  return result.map(entry=>({...entry}));
}
