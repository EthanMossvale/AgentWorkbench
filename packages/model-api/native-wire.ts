import { JsonInputStream } from './json-input-stream';
import type { ModelStreamDelta } from './stream-events';
import {availableReasoningEfforts} from './reasoning-info';
import { createHash, randomUUID } from 'node:crypto';
import type { Protocol } from '../contracts';
import type { ApiModel, ApiTurn } from './types';

type Json = Record<string, any>;
const array = (value: unknown): Json[] => Array.isArray(value) ? value : [];
/** Cross-protocol text fields are deliberately strings only. Never stringify an
 * arbitrary object: that turns a file/data envelope into model-facing prose and
 * can multiply token usage. Typed media must use a typed content block instead. */
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw Error('NATIVE_PROVIDER_CONTENT_UNSUPPORTED');
  return value;
};
const contentArray = (value: unknown): Json[] => {
  if (!Array.isArray(value)) throw Error('NATIVE_PROVIDER_CONTENT_UNSUPPORTED');
  return value.map(part => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) throw Error('NATIVE_PROVIDER_CONTENT_UNSUPPORTED');
    return part as Json;
  });
};
const inputItems = (value: unknown): Json[] => {
  if (!Array.isArray(value)) throw Error('NATIVE_PROVIDER_INPUT_UNSUPPORTED');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('NATIVE_PROVIDER_INPUT_UNSUPPORTED');
    return item as Json;
  });
};
function responseCacheUsage(counts?: import('../session-metrics').TokenCounts): Json {
  const details = {
    ...(counts?.cacheReadTokens != null ? { cached_tokens: counts.cacheReadTokens } : {}),
    ...(counts?.cacheWriteTokens != null ? { cache_write_tokens: counts.cacheWriteTokens } : {}),
  };
  return Object.keys(details).length ? { input_tokens_details: details } : {};
}
function responseTools(value: unknown, namespace?: string): Json[] {
  return array(value).flatMap(tool => tool.type === 'namespace' ? responseTools(tool.tools, tool.name) : [{ ...tool, namespace, alias: namespace ? 'awb_' + createHash('sha256').update(namespace + '/' + tool.name).digest('hex').slice(0, 24) : tool.name }]);
}
function responseContent(parts: Json[]): Json[] {
  return parts.map(part => part.type === 'image_url'
    ? { type: 'input_image', image_url: part.image_url.url, ...(part.image_url.detail ? { detail: part.image_url.detail } : {}) }
    : { type: 'input_text', text: part.text });
}
function anthropicContent(parts: Json[]): Json[] {
  return parts.map(part => {
    if (part.type !== 'image_url') return part;
    const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
    return { type: 'image', source: match ? { type: 'base64', media_type: match[1], data: match[2] } : { type: 'url', url: part.image_url.url } };
  });
}
/** Chat tool messages are text-only. Attach images after the complete tool-result batch. */
function chatMessages(messages: Json[]): Json[] {
  const result: Json[] = [], images: Json[] = [];
  const flush = () => { if (images.length) result.push({ role: 'user', content: images.splice(0) }); };
  for (const message of messages) {
    if (message.role !== 'tool') flush();
    const parts = Array.isArray(message.content) ? message.content.filter((part: Json) => !['thinking', 'redacted_thinking', 'reasoning'].includes(part.type)) : undefined;
    if (message.role !== 'tool' || !parts) {
      // Text-only messages use the common string representation. Some compatible
      // providers accept content arrays only for user media, not assistant text.
      const content = parts?.every((part: Json) => part.type === 'text') ? parts.map((part: Json) => part.text).join('') : parts;
      result.push({ ...message, ...(parts ? { content } : {}) }); continue;
    }
    const media = parts.filter((part: Json) => part.type === 'image_url');
    const textParts = parts.filter((part: Json) => part.type === 'text').map((part: Json) => part.text).join('\n');
    result.push({ ...message, content: textParts || (media.length ? 'Tool images are attached in the following user message.' : '') });
    if (media.length) images.push({ type: 'text', text: `Image output from tool call ${message.tool_call_id}:` }, ...media);
  }
  flush(); return result;
}
/** Translates wire formats only. The native CLI remains the sole agent/tool loop. */
export function nativeWireRequest(body: Json, from: 'responses' | 'anthropic-messages', to: Protocol, model: ApiModel, effort?: string): Json {
  const selectedEffort = effort && availableReasoningEfforts(model).includes(effort) ? effort : undefined;
  if (from === to) {
    const result: Json = { ...body, model: model.model };
    if (to === 'responses') {
      const { effort: _effort, ...reasoning } = result.reasoning ?? {};
      result.reasoning = { ...reasoning, ...(selectedEffort ? { effort: selectedEffort } : {}) };
      if (!Object.keys(result.reasoning).length) delete result.reasoning;
    } else {
      result.output_config = { ...result.output_config, ...(selectedEffort ? { effort: selectedEffort } : {}) };
      if (!selectedEffort) delete result.output_config.effort;
      if (!Object.keys(result.output_config).length) delete result.output_config;
    }
    return result;
  }
  const messages: Json[] = [], tools: Json[] = [];
  let system = '';
  const content = (parts: unknown, role: string): Json[] => {
    if (typeof parts === 'string') return [{ type: 'text', text: parts }];
    return contentArray(parts).map(part => {
      if (['text', 'input_text', 'output_text'].includes(part.type)) return { type: 'text', text: text(part.text) };
      if (part.type === 'input_image') return { type: 'image_url', image_url: { url: part.image_url, ...(part.detail ? { detail: part.detail } : {}) } };
      if (part.type === 'image' && part.source?.type === 'base64') return { type: 'image_url', image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` } };
      if (part.type === 'image' && part.source?.type === 'url') return { type: 'image_url', image_url: { url: part.source.url } };
      if (['thinking', 'redacted_thinking'].includes(part.type) && role === 'assistant') return { type: 'reasoning', ...part };
      throw Error('NATIVE_PROVIDER_CONTENT_UNSUPPORTED');
    });
  };
  if (from === 'responses') {
    system = body.instructions ?? '';
    for (const item of typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : inputItems(body.input)) {
      if (['function_call', 'custom_tool_call'].includes(item.type)) {
        const call = { id: item.call_id, type: 'function', function: { name: responseTools(body.tools).find(tool => tool.name === item.name && tool.namespace === item.namespace)?.alias ?? item.name, arguments: item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input }) : item.arguments } };
        // Chat requires one assistant tool_calls batch followed by all corresponding results.
        const previous = messages.at(-1);
        if (previous?.role === 'assistant') (previous.tool_calls ??= []).push(call);
        else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
      }
      else if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) messages.push({ role: 'tool', tool_call_id: item.call_id, content: Array.isArray(item.output) ? content(item.output, 'user') : text(item.output) });
      else if (item.type === 'reasoning') { /* Opaque Responses items have no cross-protocol representation. */ }
      else if (item.role === 'developer' || item.role === 'system') {
        const parts = content(item.content, item.role);
        if (parts.some(part => part.type !== 'text')) throw Error('NATIVE_PROVIDER_CONTENT_UNSUPPORTED');
        const instruction = parts.map(part => part.text).join('');
        system += (system && instruction ? '\n\n' : '') + instruction;
      }
      else if (item.role) messages.push({ role: item.role, content: content(item.content, item.role) });
      else throw Error('NATIVE_PROVIDER_INPUT_UNSUPPORTED');
    }
    for (const tool of responseTools(body.tools)) {
      if (tool.type === 'function') tools.push({ type: 'function', function: { name: tool.alias, description: tool.description, parameters: tool.parameters } });
      else if (tool.type === 'custom') tools.push({ type: 'function', function: { name: tool.alias, description: tool.description, parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false } } });
      else throw Error('NATIVE_PROVIDER_TOOL_UNSUPPORTED: '+String(tool.type));
    }
  } else {
    system = typeof body.system === 'string' ? body.system : array(body.system).map(part => part.text ?? '').join('\n');
    for (const item of inputItems(body.messages)) {
      const parts = typeof item.content === 'string' ? [{ type: 'text', text: item.content }] : array(item.content);
      const ordinary = parts.filter(part => !['tool_use', 'tool_result'].includes(part.type));
      const calls = parts.filter(part => part.type === 'tool_use').map(part => ({ id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input) } }));
      for (const part of parts.filter(part => part.type === 'tool_result')) messages.push({ role: 'tool', tool_call_id: part.tool_use_id, content: typeof part.content === 'string' ? text(part.content) : content(part.content, 'user') });
      if (ordinary.length || calls.length) messages.push({ role: item.role, content: ordinary.length ? content(ordinary, item.role) : null, ...(calls.length ? { tool_calls: calls } : {}) });
    }
    for (const tool of array(body.tools)) {
      if (tool.type && tool.type !== 'custom') throw Error('NATIVE_PROVIDER_TOOL_UNSUPPORTED: '+String(tool.type));
      tools.push({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } });
    }
  }
  const max = model.maxOutputTokens ?? body.max_output_tokens ?? body.max_tokens;
  const choice = from === 'responses' ? body.tool_choice : body.tool_choice?.type === 'any' ? 'required' : body.tool_choice?.type === 'tool' ? { type: 'function', name: body.tool_choice.name } : body.tool_choice?.type;
  const namedChoice = choice?.type === 'function' ? responseTools(body.tools).find(tool => tool.name === choice.name && tool.namespace === choice.namespace)?.alias ?? choice.name : undefined;
  const toolChoice = choice == null ? {} : { tool_choice: to === 'anthropic-messages' ? namedChoice ? { type: 'tool', name: namedChoice } : { type: choice === 'required' ? 'any' : choice }
    : namedChoice ? to === 'chat-completions' ? { type: 'function', function: { name: namedChoice } } : { type: 'function', name: namedChoice } : choice };
  if (to === 'chat-completions') return { model: model.model, messages: [{ role: 'system', content: system }, ...chatMessages(messages)], stream: true, stream_options: { include_usage: true }, ...(max ? { max_tokens: max } : {}), ...(tools.length ? { tools, ...toolChoice } : {}), ...(selectedEffort ? { reasoning_effort: selectedEffort } : {}) };
  if (to === 'responses') {
    const input: Json[] = [];
    for (const message of messages) {
      if (message.role === 'tool') input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: Array.isArray(message.content) ? responseContent(message.content) : message.content });
      else {
        if (message.content) input.push({ role: message.role, content: array(message.content).filter(part => !['thinking', 'redacted_thinking', 'reasoning'].includes(part.type)).map(part => part.type === 'image_url' ? { type: 'input_image', image_url: part.image_url.url } : { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text }) });
        for (const call of array(message.tool_calls)) input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
    }
    return { model: model.model, instructions: system, input, stream: true, store: false, ...(max ? { max_output_tokens: max } : {}), ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', ...tool.function })), ...toolChoice } : {}), ...(selectedEffort ? { reasoning: { effort: selectedEffort } } : {}) };
  }
  const anthropic: Json[] = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const parts = message.role === 'tool' ? [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: Array.isArray(message.content) ? anthropicContent(message.content) : message.content }] : [...anthropicContent(array(message.content).filter(part => !['thinking', 'redacted_thinking', 'reasoning'].includes(part.type))), ...array(message.tool_calls).map(call => ({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) }))];
    if (anthropic.at(-1)?.role === role) anthropic.at(-1)!.content.push(...parts); else anthropic.push({ role, content: parts });
  }
  return { model: model.model, system, messages: anthropic, stream: true, max_tokens: max ?? 8192, ...(tools.length ? { tools: tools.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })), ...toolChoice } : {}), ...(model.adaptiveThinking ? { thinking: { type: 'adaptive' } } : {}), ...(selectedEffort ? { output_config: { effort: selectedEffort } } : {}) };
}

export function nativeWireEvents(turn: ApiTurn, protocol: 'responses' | 'anthropic-messages', request: Json, counts?:import('../session-metrics').TokenCounts, id = 'msg_' + randomUUID().replaceAll('-', '')): Json[] {
  const usage = { input_tokens: counts?.inputTokens ?? turn.usage.inputTokens ?? 0, output_tokens: counts?.outputTokens ?? turn.usage.outputTokens ?? 0 };
  if (protocol === 'responses') {
    const output: Json[] = [], events: Json[] = [{ type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } }];
    if (turn.text) output.push({ type: 'message', id: id + '_text', role: 'assistant', phase: turn.calls.length ? 'commentary' : 'final_answer', status: 'completed', content: [{ type: 'output_text', text: turn.text, annotations: [] }] });
    for (const call of turn.calls) {
      const tool = responseTools(request.tools).find(tool => tool.alias === call.name), custom = tool?.type === 'custom';
      output.push({ type: custom ? 'custom_tool_call' : 'function_call', id: 'fc_' + call.id, call_id: call.id, name: tool?.name ?? call.name, ...(tool?.namespace ? { namespace: tool.namespace } : {}), ...(custom ? { input: JSON.parse(call.arguments).input } : { arguments: call.arguments }), status: 'completed' });
    }
    output.forEach((item, index) => {
      events.push({ type: 'response.output_item.added', output_index: index, item: { ...item, status: 'in_progress', ...(item.type === 'message' ? { content: [] } : {}) } });
      if (item.type === 'message') {
        events.push({ type: 'response.content_part.added', item_id: item.id, output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        events.push({ type: 'response.output_text.delta', item_id: item.id, output_index: index, content_index: 0, delta: turn.text });
        events.push({ type: 'response.output_text.done', item_id: item.id, output_index: index, content_index: 0, text: turn.text });
        events.push({ type: 'response.content_part.done', item_id: item.id, output_index: index, content_index: 0, part: item.content[0] });
      }
      events.push({ type: 'response.output_item.done', output_index: index, item });
    });
    events.push({ type: 'response.completed', response: { id, object: 'response', status: 'completed', output, usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens, ...responseCacheUsage(counts) } } });
    return events.map((event, sequence_number) => ({ ...event, sequence_number }));
  }
  const anthropicUsage={...usage,input_tokens:usage.input_tokens-(counts?.cacheReadTokens??0)-(counts?.cacheWriteTokens??0),...(counts?.cacheReadTokens!=null?{cache_read_input_tokens:counts.cacheReadTokens}:{}),...(counts?.cacheWriteTokens!=null?{cache_creation_input_tokens:counts.cacheWriteTokens}:{})};
  const events: Json[] = [{ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: request.model, content: [], stop_reason: null, stop_sequence: null, usage:anthropicUsage } }];
  const parts: Json[] = [...(turn.text ? [{ type: 'text', text: turn.text }] : []), ...turn.calls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: JSON.parse(call.arguments) }))];
  parts.forEach((part, index) => {
    events.push({ type: 'content_block_start', index, content_block: part.type === 'text' ? { type: 'text', text: '' } : { ...part, input: {} } });
    events.push({ type: 'content_block_delta', index, delta: part.type === 'text' ? { type: 'text_delta', text: part.text } : { type: 'input_json_delta', partial_json: JSON.stringify(part.input) } });
    events.push({ type: 'content_block_stop', index });
  });
  return [...events, { type: 'message_delta', delta: { stop_reason: turn.calls.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }, { type: 'message_stop' }];
}

/** Incremental text and tool arguments. Completion is withheld until validation succeeds. */
export function nativeWireStream(protocol: 'responses' | 'anthropic-messages', request: Json) {
  const id = 'msg_' + randomUUID().replaceAll('-', '');
  const declarations = responseTools(request.tools);
  type Draft = { id: string; name: string; args: string; index?: number; custom?: boolean; decoder?: JsonInputStream; sent: string };
  const drafts = new Map<number, Draft>();
  let sent = '', sequence = 0, started = false, finished = false, nextIndex = 0, textIndex: number | undefined;
  const number = (events: Json[]) => events.map(event => protocol === 'responses' ? { ...event, sequence_number: sequence++ } : event);
  const start = () => {
    if (finished) throw Error('NATIVE_STREAM_FINISHED');
    if (started) return [];
    started = true;
    return number([protocol === 'responses'
      ? { type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } }
      : { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: request.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }]);
  };
  const delta = (value: string) => {
    const events = start();
    if (!value) return events;
    if (textIndex === undefined) {
      textIndex = nextIndex++;
      events.push(...number(protocol === 'responses' ? [
        { type: 'response.output_item.added', output_index: textIndex, item: { id: id + '_text', type: 'message', role: 'assistant', status: 'in_progress', content: [] } },
        { type: 'response.content_part.added', item_id: id + '_text', output_index: textIndex, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
      ] : [{ type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } }]));
    }
    sent += value;
    events.push(...number([protocol === 'responses'
      ? { type: 'response.output_text.delta', item_id: id + '_text', output_index: textIndex, content_index: 0, delta: value }
      : { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: value } }]));
    return events;
  };
  const text = (value: string) => {
    if (finished) throw Error('NATIVE_STREAM_FINISHED');
    if (!value.startsWith(sent)) throw Error('NATIVE_STREAM_TEXT_CHANGED');
    return delta(value.slice(sent.length));
  };
  const itemFor = (draft: Draft, complete: boolean): Json => {
    const declaration = declarations.find(tool => tool.alias === draft.name);
    return { type: draft.custom ? 'custom_tool_call' : 'function_call', id: 'fc_' + draft.id, call_id: draft.id,
      name: declaration?.name ?? draft.name, ...(declaration?.namespace ? { namespace: declaration.namespace } : {}),
      ...(draft.custom ? { input: complete ? draft.sent : '' } : { arguments: complete ? draft.args : '' }), status: complete ? 'completed' : 'in_progress' };
  };
  const tool = (part: Extract<ModelStreamDelta, { type: 'tool' }>, release=false) => {
    const events = start();
    let draft = drafts.get(part.index);
    if (!draft) {
      draft = { id: part.id, name: part.name, args: '', sent: '' }; drafts.set(part.index, draft);
    }
    if (draft.index !== undefined && (part.id !== draft.id || part.name !== draft.name)) throw Error('NATIVE_STREAM_TOOL_CHANGED');
    draft.id = part.id; draft.name = part.name; draft.args += part.argumentsDelta;
    // Messages consumers require sequential blocks. Upstream parallel calls may
    // interleave, so release their blocks only after the entire turn validates.
    if(protocol==='anthropic-messages'&&!release)return events;
    // Names may arrive in fragments. Arguments mark the complete name boundary.
    if (!draft.id || !draft.name || !draft.args) return events;
    const rawDelta = draft.index === undefined ? draft.args : part.argumentsDelta;
    if (draft.index === undefined) {
      draft.index = nextIndex++;
      draft.custom = protocol === 'responses' && declarations.find(t => t.alias === draft!.name)?.type === 'custom';
      if (draft.custom) draft.decoder = new JsonInputStream();
      events.push(...number([protocol === 'responses'
        ? { type: 'response.output_item.added', output_index: draft.index, item: itemFor(draft, false) }
        : { type: 'content_block_start', index: draft.index, content_block: { type: 'tool_use', id: draft.id, name: draft.name, input: {} } }]));
    }
    const value = draft.custom ? draft.decoder!.push(rawDelta) : rawDelta;
    draft.sent = draft.custom ? draft.decoder!.value : draft.args;
    if (value) events.push(...number([protocol === 'responses'
      ? { type: draft.custom ? 'response.custom_tool_call_input.delta' : 'response.function_call_arguments.delta', item_id: 'fc_' + draft.id, output_index: draft.index, delta: value }
      : { type: 'content_block_delta', index: draft.index, delta: { type: 'input_json_delta', partial_json: value } }]));
    return events;
  };
  return {
    start, text, delta,
    push(part: ModelStreamDelta) { return part.type === 'text' ? delta(part.delta) : tool(part); },
    finish(turn: ApiTurn, counts?: import('../session-metrics').TokenCounts): Json[] {
      // Validate every final call before emitting any item/block completion.
      if (!turn.text.startsWith(sent)) throw Error('NATIVE_STREAM_TEXT_CHANGED');
      if (new Set([...drafts.values()].map(d => d.id)).size !== drafts.size) throw Error('NATIVE_STREAM_TOOL_CHANGED');
      for (const draft of drafts.values()) if (!turn.calls.some(call => call.id === draft.id && call.name === draft.name)) throw Error('NATIVE_STREAM_TOOL_CHANGED');
      const calls = turn.calls.map(call => {
        let parsed:Json;try{parsed=JSON.parse(call.arguments);}catch{throw Error('NATIVE_STREAM_INVALID_TOOL_JSON');}
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('NATIVE_STREAM_INVALID_TOOL');
        const entry = [...drafts.entries()].find(([, d]) => d.id === call.id);
        const draft = entry?.[1];
        let args = call.arguments;
        if (draft?.args && !args.startsWith(draft.args)) {
          if (JSON.stringify(JSON.parse(draft.args)) !== JSON.stringify(parsed)) throw Error('NATIVE_STREAM_TOOL_CHANGED');
          args = draft.args; // Preserve streamed whitespace when another protocol normalizes JSON.
        }
        if (protocol === 'responses' && declarations.find(t => t.alias === call.name)?.type === 'custom' && typeof parsed.input !== 'string') throw Error('NATIVE_STREAM_INVALID_TOOL');
        return { call, parsed, args, key: entry?.[0] ?? -(turn.calls.indexOf(call) + 1) };
      });
      const events = text(turn.text);
      if(protocol==='responses')for (const { call, args, key } of calls) events.push(...tool({ type: 'tool', index: key, id: call.id, name: call.name, argumentsDelta: args.slice(drafts.get(key)?.args.length ?? 0) }));
      const output: { index: number; item: Json }[] = [];
      if (textIndex !== undefined) {
        const part = { type: 'output_text', text: sent, annotations: [] };
        output.push({ index: textIndex, item: { type: 'message', id: id + '_text', role: 'assistant', phase: turn.calls.length ? 'commentary' : 'final_answer', status: 'completed', content: [part] } });
        events.push(...number(protocol === 'responses' ? [
          { type: 'response.output_text.done', item_id: id + '_text', output_index: textIndex, content_index: 0, text: sent },
          { type: 'response.content_part.done', item_id: id + '_text', output_index: textIndex, content_index: 0, part },
        ] : [{ type: 'content_block_stop', index: textIndex }]));
      }
      for (const { key, parsed, call, args } of calls) {
        if(protocol==='anthropic-messages')events.push(...tool({type:'tool',index:key,id:call.id,name:call.name,argumentsDelta:args.slice(drafts.get(key)?.args.length??0)},true));
        const draft = drafts.get(key)!;
        if (draft.custom && draft.sent !== parsed.input) throw Error('NATIVE_STREAM_TOOL_CHANGED');
        output.push({ index: draft.index!, item: itemFor(draft, true) });
        events.push(...number([protocol === 'responses'
          ? { type: draft.custom ? 'response.custom_tool_call_input.done' : 'response.function_call_arguments.done', item_id: 'fc_' + draft.id, output_index: draft.index, ...(draft.custom ? { input: draft.sent } : { arguments: draft.args }) }
          : { type: 'content_block_stop', index: draft.index }]));
      }
      output.sort((a, b) => a.index - b.index);
      const usage = { input_tokens: counts?.inputTokens ?? turn.usage.inputTokens ?? 0, output_tokens: counts?.outputTokens ?? turn.usage.outputTokens ?? 0 };
      if (protocol === 'responses') {
        for (const { index, item } of output) events.push(...number([{ type: 'response.output_item.done', output_index: index, item }]));
        events.push(...number([{ type: 'response.completed', response: { id, object: 'response', status: 'completed', output: output.map(o => o.item), usage: { ...usage, total_tokens: usage.input_tokens + usage.output_tokens, ...responseCacheUsage(counts) } } }]));
      } else {
        events.push({ type: 'message_delta', delta: { stop_reason: turn.calls.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { ...usage, input_tokens: usage.input_tokens - (counts?.cacheReadTokens ?? 0) - (counts?.cacheWriteTokens ?? 0), ...(counts?.cacheReadTokens != null ? { cache_read_input_tokens: counts.cacheReadTokens } : {}), ...(counts?.cacheWriteTokens != null ? { cache_creation_input_tokens: counts.cacheWriteTokens } : {}) } }, { type: 'message_stop' });
      }
      finished = true;
      return events;
    },
  };
}

/** Complete native JSON response for a request that did not ask for SSE. */
export function nativeWireResponse(turn:ApiTurn,protocol:'responses'|'anthropic-messages',request:Json,counts?:import('../session-metrics').TokenCounts):Json {
  const events=nativeWireEvents(turn,protocol,request,counts);
  if(protocol==='responses')return events.at(-1)!.response;
  return {...events[0]!.message,content:[...(turn.text?[{type:'text',text:turn.text}]:[]),...turn.calls.map(call=>({type:'tool_use',id:call.id,name:call.name,input:JSON.parse(call.arguments)}))],stop_reason:turn.calls.length?'tool_use':'end_turn'};
}
