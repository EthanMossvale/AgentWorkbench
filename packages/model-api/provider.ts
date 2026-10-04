import {apiEndpoints} from './endpoints';
import {ApiContextPlanning,summaryInstructions} from './context-planning';
import {availableReasoningEfforts} from './reasoning-info';
import { apiAttachmentContent, publicContextJson } from '../attachments/input';
import type { ModelConnection, ApiModel, ApiHistoryEntry, ApiToolDefinition, ApiTurn, ApiToolCall } from './types';
import { outputTokenLimit, parseModelDirectory } from './config';
import { assertIndependentTranslationKey } from '../translation/credentials';
import { modelProviders } from './providers';

type Json = Record<string, any>;
const object = (v: unknown): Json => v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
export class ModelRequestError extends Error { constructor(message: string, readonly uncertain = false) { super(message); } }
export function apiHeaders(connection: ModelConnection, key: string, request?: { model?: string; sessionId?: string }): Record<string, string> {
  if (connection.auth === 'key') { if (!key) throw new ModelRequestError('API 密钥尚未设置。'); assertIndependentTranslationKey(key); }
  return { ...modelProviders.headers(connection, request), 'content-type': 'application/json', ...(connection.protocol === 'anthropic-messages' ? { 'anthropic-version': '2023-06-01', ...(connection.auth === 'key' ? { 'x-api-key': key } : {}) } : connection.auth === 'key' ? { authorization: `Bearer ${key}` } : {}) };
}
function connectionFailure(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return signal.reason?.name === 'TimeoutError' ? '请求超时' : '请求已取消';
  // Only fixed, recognized codes reach the UI. Native messages can contain secrets or URLs.
  const reasons: unknown[] = [error]; const codes = new Set<string>();
  for (let i = 0; i < reasons.length && i < 8; i++) {
    const reason = object(reasons[i]);
    if (typeof reason.code === 'string') codes.add(reason.code);
    const chromium = typeof reason.message === 'string' ? /\bnet::(ERR_[A-Z_]+)\b/.exec(reason.message)?.[1] : undefined;
    if (chromium) codes.add(chromium);
    if (reason.cause) reasons.push(reason.cause);
    if (Array.isArray(reason.errors)) reasons.push(...reason.errors.slice(0, 4));
  }
  const has = (...values: string[]) => values.some(value => codes.has(value));
  if (has('ENOTFOUND', 'EAI_AGAIN', 'ERR_NAME_NOT_RESOLVED')) return '无法解析服务域名，请检查 API 地址与 DNS';
  if (has('CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_DATE_INVALID', 'ERR_CERT_COMMON_NAME_INVALID')) return 'TLS 证书校验失败，请检查服务证书与本机时间';
  if (has('ECONNRESET', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'UND_ERR_SOCKET')) return '连接在收到 HTTP 响应前被关闭或重置，请检查网络、代理或服务状态（尚未确认密钥是否有效）';
  if (has('ECONNREFUSED', 'ERR_CONNECTION_REFUSED')) return '服务拒绝连接，请检查地址、端口或本地服务是否启动';
  if (has('ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT')) return '连接超时，请检查网络、代理或服务状态';
  return '无法建立连接，请检查 API 地址、网络或服务状态';
}
async function response(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const directory = init.method === 'GET';
  if (signal.aborted) throw new ModelRequestError(connectionFailure(undefined, signal));
  let result: Response;
  try { result = await fetcher(url, { ...init, signal, redirect: 'manual' }); }
  catch (error) { throw new ModelRequestError(`${directory ? '模型目录读取失败' : '模型请求未完成'}：${connectionFailure(error, signal)}。${directory ? '可重新读取或手动添加模型。' : '结果待确认，没有自动重发。'}`, !directory); }
  if (!result.ok) {
    await result.body?.cancel().catch(() => {});
    const status = result.status;
    const guidance = status >= 300 && status < 400 ? '此地址发生跳转；请填写服务提供的最终 API 地址，密钥未转发至跳转目标。'
      : status === 401 || status === 403 ? '请检查 API 密钥与接口访问权限。'
      : directory && (status === 404 || status === 405) ? '服务未提供此地址的模型目录，可直接手动添加模型。'
      : status === 429 ? '上游限流或额度不足，请稍后手动重试。'
      : '请检查 API 地址、接口协议或服务状态。';
    throw new ModelRequestError(`${directory ? '模型目录' : '模型 API'}返回 HTTP ${status}。${guidance}`);
  }
  return result;
}
async function json(result: Response): Promise<Json> {
  const reader = result.body?.getReader(); if (!reader) throw new ModelRequestError('API 返回空响应。');
  const chunks: Uint8Array[] = [];
  try { for (;;) { const part = await reader.read(); if (part.done) break; chunks.push(part.value); } }
  catch (error) { throw error instanceof ModelRequestError ? error : new ModelRequestError('API 响应读取中断，请手动重试。'); }
  finally { await reader.cancel().catch(() => {}); }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { throw new ModelRequestError('API 未返回有效 JSON。'); }
}
export async function discoverModels(connection: ModelConnection, key: string, fetcher: typeof fetch = fetch): Promise<ApiModel[]> {
  const url = new URL(apiEndpoints.resolve({baseUrl:connection.modelsUrl||connection.baseUrl,resource:'models',defaultVersion:false})), headers = apiHeaders(connection, key);
  const signal = AbortSignal.timeout(Math.min(connection.timeoutMs, 30000)), all = new Map<string, ApiModel>(), cursors = new Set<string>();
  if (connection.protocol === 'anthropic-messages') url.searchParams.set('limit', '1000');
  for (let page = 0; page < 10; page++) {
    const data = await json(await response(fetcher, url.href, { method: 'GET', headers }, signal));
    for (const item of parseModelDirectory(data)) { all.set(item.id, item); if (all.size >= 2000) return [...all.values()]; }
    if (connection.protocol !== 'anthropic-messages' || data.has_more !== true) return [...all.values()];
    if (typeof data.last_id !== 'string' || !data.last_id || cursors.has(data.last_id) || !all.has(data.last_id)) throw new ModelRequestError('上游模型分页游标无效。');
    cursors.add(data.last_id); url.searchParams.set('after_id', data.last_id);
  }
  throw new ModelRequestError('上游模型目录超过分页限制。');
}
export interface ApiConversation { contextPlanning?:ApiContextPlanning; connection: ModelConnection; model: ApiModel; system: string; history: ApiHistoryEntry[]; tools: ApiToolDefinition[]; effort?: string; onUsage?:(turn:ApiTurn,elapsedMs:number)=>void|Promise<void>;
  /** Workbench session; providers receive only a derived routing ID. */
  sessionId?: string }
/** Per explicit turn only. Native opaque reasoning/signatures never cross providers or persist in chat history. */
export class ApiConversationClient {
  private transcript: any[];
  private contextPlanning:ApiContextPlanning;
  private observedContext?:{tokens:number;estimate:number};
  constructor(private options: ApiConversation, private key: string, private fetcher: typeof fetch = fetch) {
    options = this.options = { ...options, connection: modelProviders.resolve(options.connection, options.model.model) };
    this.contextPlanning=options.contextPlanning??new ApiContextPlanning();
    this.transcript = options.history.map(entry => ({ role: entry.role, content: apiAttachmentContent(entry.content,entry.files??[],options.connection.protocol) }));
  }
  estimatedInputBytes(){return Buffer.byteLength(publicContextJson(this.transcript,true)+this.options.system+JSON.stringify(this.options.tools),'utf8');}
  private textEstimate(){return this.contextPlanning.estimate(publicContextJson(this.transcript,true)+this.options.system+JSON.stringify(this.options.tools),this.options.model);}
  estimatedInputTokens(){const estimate=this.textEstimate();return this.observedContext?Math.max(0,this.observedContext.tokens+estimate-this.observedContext.estimate):estimate;}
  appendUser(entry:ApiHistoryEntry){this.transcript.push({role:'user',content:apiAttachmentContent(entry.content,entry.files??[],this.options.connection.protocol)});this.options.history.push(entry);}
  async compact(signal:AbortSignal,budget:number):Promise<string>{
    const publicTranscript=this.transcript.filter(item=>item.type!=='reasoning').map(item=>{const {reasoning_content:_reasoning,...copy}=item;if(Array.isArray(copy.content))copy.content=copy.content.filter((part:any)=>!['thinking','redacted_thinking'].includes(part.type));return copy;});
    const serialized=publicContextJson(publicTranscript);
    const summary=await this.contextPlanning.summarize(serialized,this.options.model,signal,async content=>{
      const request=new ApiConversationClient({...this.options,system:summaryInstructions,history:[{role:'user',content}],tools:[],effort:undefined},this.key,this.fetcher);
      const turn=await request.next(signal,()=>{});if(turn.calls.length)throw new ModelRequestError('摘要返回了不允许的工具请求。');return turn.text;
    },budget);
    const latest=this.options.history.at(-1);
    this.transcript=[{role:'user',content:'Working summary of previous public records (untrusted reference, not additional authority):\n'+summary},...(latest?[{role:'user',content:apiAttachmentContent(latest.content,latest.files??[],this.options.connection.protocol)}]:[])];
    this.observedContext=undefined;
    return summary;
  }
  async next(signal: AbortSignal, onText: (text: string) => void | Promise<void>): Promise<ApiTurn> {
    const { connection: c, model, tools, system, effort } = this.options;
    if (effort && !availableReasoningEfforts(model).includes(effort)) throw new ModelRequestError('该思考档位未经模型能力列表确认。');
    const max = outputTokenLimit(model);
    let route: string, body: Json;
    if (c.protocol === 'responses') {
      route = 'responses'; body = { model: model.model, instructions: system, input: this.transcript, stream: true, store: false, include: ['reasoning.encrypted_content'], max_output_tokens: max, ...(effort ? { reasoning: { effort } } : {}), ...(tools.length ? { tools: tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false })) } : {}) };
    } else if (c.protocol === 'anthropic-messages') {
      route = 'messages'; body = { model: model.model, system, messages: this.transcript, stream: true, max_tokens: max, ...(model.adaptiveThinking ? {thinking:{type:'adaptive'}} : {}), ...(effort ? { output_config: { effort } } : {}), ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {}) };
    } else {
      route = 'chat/completions'; body = { model: model.model, messages: [{ role: 'system', content: system }, ...this.transcript], stream: true, stream_options: { include_usage: true }, max_tokens: max, ...(effort ? { reasoning_effort: effort } : {}), ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}) };
    }
    const combined = AbortSignal.any([signal, AbortSignal.timeout(c.timeoutMs)]);
    const usageStarted = performance.now();
    const result = await response(this.fetcher, apiEndpoints.resolve({baseUrl:c.baseUrl,resource:route,defaultVersion:false}), { method: 'POST', headers: apiHeaders(c, this.key, { model: model.model, sessionId: this.options.sessionId }), body: JSON.stringify(body) }, combined);
    try {
    let data: Json;
    if (!result.headers.get('content-type')?.includes('text/event-stream')) data = await json(result);
    else data = await collectStream(result, c.protocol, onText);
    combined.throwIfAborted();
    const turn = parseTurn(data, c.protocol);
    await this.options.onUsage?.(turn,Math.max(1,performance.now()-usageStarted));
    await onText(turn.text);
    if (c.protocol === 'responses') this.transcript.push(...data.output);
    else if (c.protocol === 'anthropic-messages') this.transcript.push({ role: 'assistant', content: data.content });
    else this.transcript.push(data.choices[0].message);
    if(turn.usage.inputTokens!==null)this.observedContext={tokens:turn.usage.inputTokens+(turn.usage.outputTokens??0),estimate:this.textEstimate()};
    return turn;
    } catch(error) { if(error instanceof ModelRequestError && error.uncertain)throw error;throw new ModelRequestError('模型响应未完整接收，结果待确认；没有自动重发。',true); }
  }
  results(results: { call: ApiToolCall; result: unknown; error?: boolean }[]) {
    const protocol = this.options.connection.protocol;
    if (protocol === 'anthropic-messages') this.transcript.push({ role: 'user', content: results.map(r => ({ type: 'tool_result', tool_use_id: r.call.id, content: JSON.stringify(r.result), ...(r.error ? { is_error: true } : {}) })) });
    else for (const r of results) this.transcript.push(protocol === 'responses' ? { type: 'function_call_output', call_id: r.call.id, output: JSON.stringify(r.result) } : { role: 'tool', tool_call_id: r.call.id, content: JSON.stringify(r.result) });
  }
}
export function parseTurn(data: Json, protocol: ModelConnection['protocol']): ApiTurn {
  const calls: ApiToolCall[] = []; let text = '';
  const fail = () => { throw new ModelRequestError('模型回复未完整结束或协议格式不受支持；没有继续执行工具。', true); };
  if (data.error) fail();
  if (protocol === 'responses') {
    if (data.status !== 'completed' || !Array.isArray(data.output)) fail();
    for (const item of data.output) {
      if (!item || item.status && item.status !== 'completed') fail();
      if (item.type === 'function_call') calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
      else if (item.type === 'message') for (const part of item.content ?? []) { if (part.type === 'output_text') text += part.text; else if (part.type === 'refusal') text += part.refusal; }
      else if (item.type !== 'reasoning') fail();
    }
  } else if (protocol === 'anthropic-messages') {
    if (!['end_turn', 'tool_use', 'stop_sequence'].includes(data.stop_reason) || !Array.isArray(data.content)) fail();
    for (const part of data.content) {
      if (part.type === 'text') text += part.text;
      else if (part.type === 'tool_use') calls.push({ id: part.id, name: part.name, arguments: JSON.stringify(part.input) });
      else if (!['thinking','redacted_thinking'].includes(part.type)) fail();
    }
    if (data.stop_reason === 'tool_use' && !calls.length) fail();
  } else {
    const choice = data.choices?.[0]; if (!choice || !['stop', 'tool_calls'].includes(choice.finish_reason)) fail();
    if (choice.message?.function_call) fail(); // Legacy calls lack the required modern tool identity.
    text = choice.message?.content ?? choice.message?.refusal ?? '';
    for (const call of choice.message?.tool_calls ?? []) calls.push({ id: call.id, name: call.function?.name, arguments: call.function?.arguments });
    if (choice.finish_reason === 'tool_calls' && !calls.length) fail();
  }
  if (typeof text !== 'string' || (!text && !calls.length) || new Set(calls.map(c => c.id)).size !== calls.length || calls.some(c => !c.id || typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.arguments !== 'string')) fail();
  return { text, calls, usage: { inputTokens: count(data.usage?.input_tokens ?? data.usage?.prompt_tokens), outputTokens: count(data.usage?.output_tokens ?? data.usage?.completion_tokens) }, raw: data, requestId: typeof data.id === 'string' ? data.id : undefined };
}
export async function collectStream(result: Response, protocol: ModelConnection['protocol'], onText?: (text: string) => void | Promise<void>, options: import('./stream-events').StreamReadOptions = {}): Promise<Json> {
  const reader = result.body?.getReader(); if (!reader) throw new ModelRequestError('API 返回空流。', true);
  const decoder = new TextDecoder(); let buffer = '', text = '', completed = false, final: Json | undefined;
  const calls = new Map<number, any>(), blocks = new Map<number, any>(); let usage: Json = {}, finish: string | null = null, reasoning = '', messageId: string | undefined;
  const appendText = async (delta: string) => {
    if (typeof delta !== 'string') throw Error('NATIVE_STREAM_INVALID_TEXT');
    text += delta;
    if (delta) await options.onDelta?.({ type: 'text', delta });
    await onText?.(text);
  };
  const toolDelta = async (index: number, id: string, name: string, argumentsDelta: string) => {
    if (!Number.isSafeInteger(index) || index < 0 || typeof argumentsDelta !== 'string') throw Error('NATIVE_STREAM_INVALID_TOOL');
    await options.onDelta?.({ type: 'tool', index, id, name, argumentsDelta });
  };
  const cancel = () => { void reader.cancel(options.signal?.reason).catch(() => {}); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  const event = async (data: string) => {
    if (data === '[DONE]') { if (protocol !== 'chat-completions' || !finish) throw new ModelRequestError('模型缺少协议完成回执。', true); completed = true; return; }
    let v: Json; try { v = object(JSON.parse(data)); } catch { throw new ModelRequestError('API 流包含无效 JSON。', true); }
    if (v.error || v.type === 'error' || v.type === 'response.failed' || v.type === 'response.incomplete') throw new ModelRequestError('模型流未成功完成；没有自动重试。', true);
    if (protocol === 'responses') {
      if (v.type === 'response.output_text.delta' || v.type === 'response.refusal.delta') await appendText(v.delta);
      if (v.type === 'response.output_item.added' && v.item?.type === 'function_call') {
        calls.set(v.output_index, { id: v.item.call_id, name: v.item.name, arguments: v.item.arguments ?? '' });
        await toolDelta(v.output_index, v.item.call_id, v.item.name, v.item.arguments ?? '');
      }
      if (v.type === 'response.function_call_arguments.delta') {
        const call = calls.get(v.output_index); if (!call) throw Error('NATIVE_STREAM_TOOL_ORDER');
        call.arguments += v.delta;
        await toolDelta(v.output_index, call.id, call.name, v.delta);
      }
      if (v.type === 'response.completed') { final = v.response; completed = true; }
    } else if (protocol === 'anthropic-messages') {
      if (v.type === 'message_start') { messageId = v.message?.id; usage = v.message?.usage ?? {}; }
      if (v.type === 'content_block_start') {
        if (blocks.has(v.index)) throw Error('NATIVE_STREAM_BLOCK_REUSED');
        blocks.set(v.index, { ...v.content_block });
        if (v.content_block?.type === 'text' && v.content_block.text) await appendText(v.content_block.text);
        if (v.content_block?.type === 'tool_use') await toolDelta(v.index, v.content_block.id, v.content_block.name, '');
      }
      if (v.type === 'content_block_delta') {
        const b = blocks.get(v.index); if (!b) throw new ModelRequestError('模型流区块顺序无效。', true);
        if (v.delta?.type === 'text_delta') { b.text = (b.text ?? '') + v.delta.text; await appendText(v.delta.text); }
        if (v.delta?.type === 'input_json_delta') { b._json = (b._json ?? '') + v.delta.partial_json; await toolDelta(v.index, b.id, b.name, v.delta.partial_json); }
        if (v.delta?.type === 'thinking_delta') b.thinking = (b.thinking ?? '') + v.delta.thinking;
        if (v.delta?.type === 'signature_delta') b.signature = (b.signature ?? '') + v.delta.signature;
      }
      if (v.type === 'message_delta') { finish = v.delta?.stop_reason; usage = { ...usage, ...v.usage }; }
      if (v.type === 'message_stop') completed = true;
    } else {
      const choice = v.choices?.[0]; if (v.usage) usage = v.usage;
      if (choice?.delta?.content) await appendText(choice.delta.content);
      if (choice?.delta?.refusal) await appendText(choice.delta.refusal);
      if (choice?.delta?.reasoning_content) reasoning += choice.delta.reasoning_content;
      for (const part of choice?.delta?.tool_calls ?? []) {
        const call = calls.get(part.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (part.id) { if (call.id && call.id !== part.id) throw Error('NATIVE_STREAM_TOOL_CHANGED'); call.id = part.id; }
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        calls.set(part.index, call);
        await toolDelta(part.index, call.id, call.function.name, part.function?.arguments ?? '');
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  };
  try {
    options.signal?.throwIfAborted();
    for (;;) { const part = await reader.read(); options.signal?.throwIfAborted(); if (part.done) { buffer += decoder.decode(); break; } buffer += decoder.decode(part.value, { stream: true });
      let end: RegExpExecArray | null; while (!completed && (end = /\r?\n\r?\n/.exec(buffer))) { const frame = buffer.slice(0, end.index); buffer = buffer.slice(end.index + end[0].length); const payload = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (payload) await event(payload); }
      // The protocol receipt is the boundary; a server may keep the socket alive.
      if (completed) break;
    }
    if (!completed && buffer.trim()) { const payload = buffer.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (payload) await event(payload); }
    if (!completed) throw new ModelRequestError('模型流中断，结果待确认；没有自动续投。', true);
    if (protocol === 'responses') { if (!final) throw new ModelRequestError('模型缺少完成回执。', true); return final; }
    if (protocol === 'anthropic-messages') return { id: messageId, content: [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => { if (b._json !== undefined) { try { b.input = JSON.parse(b._json); } catch { throw new ModelRequestError('工具参数 JSON 未完整结束。', true); } delete b._json; } return b; }), stop_reason: finish, usage };
    return { choices: [{ finish_reason: finish, message: { role: 'assistant', content: text || null, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(calls.size ? { tool_calls: [...calls.values()] } : {}) } }], usage };
  } finally { options.signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
