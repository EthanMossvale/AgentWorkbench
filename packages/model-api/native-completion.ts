import { JsonInputStream } from './json-input-stream';
import type { Protocol } from '../contracts';
import type { ApiTurn } from './types';
import type { ModelStreamDelta } from './stream-events';

type Json = Record<string, any>;
export type NativeCompletionOutcome = 'completed' | 'needs_input' | 'blocked';
export interface NativeCompletionReceipt {
  protocol: Protocol;
  finishReason: 'stop' | 'tool_calls' | 'end_turn' | 'tool_use' | 'stop_sequence' | 'completed' | 'unknown';
  toolCalls: number; textChars: number;
  boundary: 'tools' | 'explicit' | 'unmarked';
  outcome?: NativeCompletionOutcome;
}
/** A per-request wire codec, not an agent loop or an executable model tool. */
export interface NativeCompletionBoundary {
  request: Json;
  push(delta: ModelStreamDelta): ModelStreamDelta[];
  finish(turn: ApiTurn): ApiTurn;
  dispose?(): void;
}
export interface NativeCompletionCodec {
  prepare(request: Json, protocol: Protocol): NativeCompletionBoundary | undefined;
}

const baseName = 'awb_complete_turn';
const outcomes = ['completed', 'needs_input', 'blocked'] as const;
const validOutcome = (value: unknown): value is NativeCompletionOutcome => outcomes.includes(value as NativeCompletionOutcome);
const choiceName = (tool: Json) => tool.function?.name ?? tool.name;

/** Preserve protocol completion; the optional envelope adds a declared outcome, not proof of task success. */
export const nativeCompletionCodec: NativeCompletionCodec = {
  prepare(request, protocol) {
    if (!request.tools?.length || request.tool_choice === 'none' || request.tool_choice?.type === 'none') return;
    // A native forced-tool request already has an explicit boundary. Do not weaken it.
    if (typeof request.tool_choice === 'object' && !['auto', 'any'].includes(request.tool_choice.type)) return;
    const names = new Set(request.tools.map(choiceName));
    let name = baseName; for (let suffix = 1; names.has(name); suffix++) name = baseName + '_' + suffix;
    const parameters = { type: 'object', properties: {
      outcome: { type: 'string', enum: [...outcomes], description: 'completed: the authorized task is finished; needs_input: a user answer is required; blocked: a concrete blocker prevents further authorized work.' },
      message: { type: 'string', description: 'The final user-facing answer, necessary question, or concrete blocker. Never a progress update or a promise to keep working.' },
    }, required: ['outcome', 'message'], additionalProperties: false };
    const description = 'End this native turn and send the final answer to the user. Call only when finished, awaiting necessary user input, or blocked. If work remains, call a real tool instead. This is a wire completion envelope; it executes no action. Do not combine it with other tools.';
    const declaration = protocol === 'chat-completions' ? { type: 'function', function: { name, description, parameters } }
      : protocol === 'responses' ? { type: 'function', name, description, parameters }
      : { name, description, input_schema: parameters };
    const instruction = `Provider completion contract: To continue working, include actual tool calls with any progress text. A normal text answer with the protocol's successful stop ends this turn. Optionally call ${name} to declare a completed, needs_input, or blocked outcome instead of repeating the answer in text. Do not use the envelope for a progress update, invent tool calls, ask for unnecessary permission, or claim unperformed work.`;
    // Adding the completion envelope must not force a provider's tool policy.
    // Thinking-mode providers may reject required/any even for valid tools.
    // An explicit required/any policy remains binding; auto allows plain text.
    const requiresTool = request.tool_choice === 'required' || request.tool_choice?.type === 'any';
    const mapped: Json = { ...request, tools: [...request.tools, declaration],
      tool_choice: request.tool_choice ?? (protocol === 'anthropic-messages' ? { type: 'auto' } : 'auto') };
    if (protocol === 'chat-completions') mapped.messages = request.messages[0]?.role === 'system'
      ? [{ ...request.messages[0], content: request.messages[0].content + '\n\n' + instruction }, ...request.messages.slice(1)]
      : [{ role: 'system', content: instruction }, ...request.messages];
    else if (protocol === 'responses') mapped.instructions = (request.instructions ?? '') + '\n\n' + instruction;
    else mapped.system = (request.system ?? '') + '\n\n' + instruction;
    const drafts = new Map<number, { id: string; name: string; args: string; started: boolean }>();
    const decoder = new JsonInputStream('message');
    let prefix = '', decoded = '', finalStarted = false;
    return {
      request: mapped,
      push(delta) {
        if (delta.type === 'text') { if (finalStarted) throw Error('NATIVE_COMPLETION_MIXED'); prefix += delta.delta; return [delta]; }
        const draft = drafts.get(delta.index) ?? { id: delta.id, name: delta.name, args: '', started: false };
        draft.id = delta.id; draft.name = delta.name; draft.args += delta.argumentsDelta; drafts.set(delta.index, draft);
        // Tool names may arrive in fragments. Arguments delimit the complete name.
        if (!draft.args) return [];
        const argumentsDelta = draft.started ? delta.argumentsDelta : draft.args; draft.started = true;
        if (draft.name !== name) return [{ ...delta, argumentsDelta }];
        const text = decoder.push(argumentsDelta);
        if (!text) return [];
        finalStarted = true; decoded += text;
        // A provider may repeat its already-streamed answer in the envelope.
        // Hold only that envelope until finish can compare complete messages.
        return prefix ? [] : [{ type: 'text', delta: text }];
      },
      finish(turn) {
        const complete = turn.calls.filter(call => call.name === name);
        if (!complete.length) {
          if (!turn.calls.length && requiresTool) throw Error('NATIVE_COMPLETION_REQUIRED');
          return turn;
        }
        if (complete.length !== 1 || turn.calls.length !== 1) throw Error('NATIVE_COMPLETION_MIXED');
        let value: Json; try { value = JSON.parse(complete[0]!.arguments); } catch { throw Error('NATIVE_COMPLETION_INVALID'); }
        if (!value || !validOutcome(value.outcome) || typeof value.message !== 'string' || !value.message.trim() || Object.keys(value).some(key => !['outcome', 'message'].includes(key))) throw Error('NATIVE_COMPLETION_INVALID');
        if (!value.message.startsWith(decoded)) throw Error('NATIVE_COMPLETION_INVALID');
        const text = turn.text.trim() === value.message.trim() ? turn.text : turn.text + (turn.text ? '\n\n' : '') + value.message;
        return { ...turn, text, calls: [], completionOutcome: value.outcome };
      },
    };
  },
};

/** Only fixed protocol fields and counts are retained, never text, arguments or IDs. */
export function nativeCompletionReceipt(turn: ApiTurn, protocol: Protocol, completed?: ApiTurn): NativeCompletionReceipt {
  const raw = turn.raw as Json;
  const reason = protocol === 'chat-completions' ? raw?.choices?.[0]?.finish_reason : protocol === 'responses' ? raw?.status : raw?.stop_reason;
  return { protocol, finishReason: ['stop', 'tool_calls', 'end_turn', 'tool_use', 'stop_sequence', 'completed'].includes(reason) ? reason : 'unknown',
    toolCalls: turn.calls.length, textChars: turn.text.length,
    boundary: completed?.completionOutcome ? 'explicit' : completed?.calls.length ? 'tools' : 'unmarked',
    ...(validOutcome(completed?.completionOutcome) ? { outcome: completed.completionOutcome } : {}) };
}
