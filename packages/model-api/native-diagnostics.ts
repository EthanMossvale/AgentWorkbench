import { ModelRequestError } from './provider';
export interface NativeProviderDiagnostic { status: number; category: 'tool-sequence' | 'context-limit' | 'parameter' | 'authentication' | 'rate-limit' | 'upstream' | 'timeout' | 'transport' | 'protocol'; code?: string; param?: string; summary: string }
const conversionReasons:Record<string,{summary:string;label:string}>={
  NATIVE_STREAM_TOOL_CHANGED:{summary:'The upstream changed a streamed tool identity or its arguments.',label:'上游流中的工具标识或参数前后不一致'},
  NATIVE_STREAM_TEXT_CHANGED:{summary:'The completed upstream text differs from the streamed text.',label:'上游最终文本与已传输文本不一致'},
  NATIVE_STREAM_INVALID_TOOL:{summary:'The upstream tool call has an invalid parameter structure.',label:'上游工具参数结构无效'},
  NATIVE_STREAM_INVALID_TOOL_JSON:{summary:'The upstream tool arguments are not complete valid JSON.',label:'上游工具参数不是完整有效的 JSON'},
  NATIVE_STREAM_INVALID_JSON:{summary:'The upstream event is not valid JSON.',label:'上游事件不是有效 JSON'},
  NATIVE_STREAM_TOOL_ORDER:{summary:'The upstream sent tool arguments before declaring the tool.',label:'上游在声明工具前发送了工具参数'},
  NATIVE_STREAM_TOOL_LIMIT:{summary:'The upstream exceeded the supported tool call or argument size limit.',label:'上游工具数量或参数长度超过限制'},
  NATIVE_PROVIDER_CONTENT_UNSUPPORTED:{summary:'The native request contains content without a cross-protocol representation.',label:'请求内容包含当前跨协议转换不支持的类型'},
  NATIVE_PROVIDER_INPUT_UNSUPPORTED:{summary:'The native request contains an unsupported input item.',label:'请求包含当前跨协议转换不支持的输入项'},
  NATIVE_PROVIDER_TOOL_UNSUPPORTED:{summary:'The native request contains a tool without a cross-protocol representation.',label:'请求包含当前跨协议转换不支持的工具类型'},
};
/** Fixed classifications only: exception messages can contain URLs, keys and user text. */
export function nativeForwardingDiagnostic(error: unknown, signal?: AbortSignal): NativeProviderDiagnostic {
  const value = error as { name?: string; message?: string; code?: string; cause?: { code?: string } } | undefined;
  if (signal?.reason?.name === 'TimeoutError' || value?.name === 'TimeoutError') return { status: 504, category: 'timeout', code: 'NATIVE_UPSTREAM_TIMEOUT', summary: 'The upstream request exceeded its time limit.' };
  if (/^NATIVE_COMPLETION_(REQUIRED|MIXED|INVALID)$/.test(value?.message ?? '')) return { status: 422, category: 'protocol', code: value!.message, summary: 'The provider did not supply a valid explicit final answer or real tool calls. Progress text was not accepted as a completed native turn.' };
  if (value?.message === 'NATIVE_STREAM_INCOMPLETE') return { status: 502, category: 'protocol', code: 'NATIVE_STREAM_INCOMPLETE', summary: 'The upstream stream ended without its protocol completion receipt.' };
  const reason=value?.message?.split(':',1)[0]??'';
  if(Object.hasOwn(conversionReasons,reason))return {status:reason.startsWith('NATIVE_PROVIDER_')?422:502,category:'protocol',code:reason,summary:conversionReasons[reason]!.summary};
  if (value?.name === 'SyntaxError' || error instanceof ModelRequestError || /^(NATIVE_(PROVIDER|STREAM)_|JSON_INPUT_)/.test(value?.message ?? '')) return { status: 502, category: 'protocol', code: 'NATIVE_UPSTREAM_PROTOCOL', summary: 'The upstream response or protocol conversion was incomplete or invalid.' };
  const code = value?.code ?? value?.cause?.code;
  return { status: 502, category: 'transport', code: ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code ?? '') ? code : 'NATIVE_UPSTREAM_TRANSPORT', summary: 'The upstream transport failed before a valid completion receipt.' };
}
/** Read a bounded error envelope, never persist its raw body or echo model/user content. */
export async function nativeProviderDiagnostic(response: Response, secrets: string[] = []): Promise<NativeProviderDiagnostic> {
  let data: any = {}, size = 0, body = '';
  const reader = response.body?.getReader(), decoder = new TextDecoder();
  if (reader) try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16384) break; body += decoder.decode(part.value, { stream: true }); }
    if (size <= 16384) { try { data = JSON.parse(body + decoder.decode()); } catch { /* Non-JSON errors remain status-only. */ } }
  } catch { data = {}; } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const error = data?.error && typeof data.error === 'object' ? data.error : data;
  const message = typeof error?.message === 'string' ? error.message : '', rawCode = error?.code ?? error?.type, rawParam = error?.param;
  const safe = (value: unknown, pattern: RegExp) => typeof value === 'string' && pattern.test(value) && !secrets.filter(Boolean).some(secret => value.includes(secret)) ? value : undefined;
  const code = safe(rawCode, /^(?:invalid|unsupported|bad|context|model|rate|auth|permission|insufficient|server|upstream|too_many|request)[a-z0-9_.-]{0,70}$/i);
  const param = safe(rawParam, /^(?:messages|input|tools|tool_choice|model|max_tokens|max_output_tokens|reasoning|reasoning_effort|temperature|stream)(?:\[\d+\]|\.[a-z_]+)*$/i);
  const category: NativeProviderDiagnostic['category'] = /tool_calls?|tool_call_id|tool.?result|tool.?use|function_call/i.test(message) ? 'tool-sequence'
    : /context.{0,25}(?:length|limit|window)|too many tokens|max(?:imum)? context/i.test(message) ? 'context-limit'
    : response.status === 401 || response.status === 403 ? 'authentication' : response.status === 429 ? 'rate-limit'
    : /invalid|unsupported|unknown|not supported|must be|expected|required/i.test(message) || param ? 'parameter' : 'upstream';
  const summary = ({ 'tool-sequence': 'The upstream rejected the tool call/result structure.', 'context-limit': 'The request exceeded the upstream context limit.', parameter: 'The upstream rejected a request parameter or format.', authentication: 'The upstream rejected authentication or permissions.', 'rate-limit': 'The upstream rate or quota limit was reached.', upstream: 'The upstream rejected the request; no safe structured reason was available.' })[category];
  return { status: response.status, category, ...(code ? { code } : {}), ...(param ? { param } : {}), summary };
}
export function diagnosticMessage(value: NativeProviderDiagnostic): string {
  return `Native provider request failed (HTTP ${value.status}). ${value.summary}${value.code ? ` Code: ${value.code}.` : ''}${value.param ? ` Parameter: ${value.param}.` : ''}`;
}
export function diagnosticLabel(value: NativeProviderDiagnostic): string {
  if(value.code&&Object.hasOwn(conversionReasons,value.code))return `HTTP ${value.status}：${conversionReasons[value.code]!.label}（${value.code}）。`;
  if (value.code?.startsWith('NATIVE_COMPLETION_')) return '模型没有按约定提交最终答复或有效工具调用；本次输出未被视为任务完成（' + value.code + '）。';
  const reason = ({ 'tool-sequence': '上游拒绝了工具调用与结果的结构', 'context-limit': '请求超过了上游上下文长度限制', parameter: '上游拒绝了请求参数或格式', authentication: '上游拒绝了身份认证或权限', 'rate-limit': '上游触发限流或额度限制', upstream: '上游拒绝请求，未返回可安全展示的结构化原因', timeout: '上游请求超时，未收到完整完成回执', transport: '上游连接中断或无法建立，未确认请求完成', protocol: '上游响应或协议转换不完整／无效，未确认请求完成' })[value.category];
  return `HTTP ${value.status}：${reason}${value.code ? `（${value.code}）` : ''}${value.param ? `；参数 ${value.param}` : ''}。`;
}
