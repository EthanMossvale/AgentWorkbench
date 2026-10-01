/** Public interaction data only. Native request payloads stay with the live connection. */
export type RequestId = string | number;
export interface NativeQuestion {
  id: string; header: string; question: string; options: { label: string; description: string }[];
  multiple: boolean; other: boolean; secret: boolean;
}
export interface NativeFormField {
  id: string; title: string; description: string; type: 'string' | 'number' | 'integer' | 'boolean' | 'select' | 'multi';
  required: boolean; options?: { value: string; label: string }[];
  min?: number; max?: number; minLength?: number; maxLength?: number; format?: string; pattern?: string;
}
export interface NativeInteraction {
  /** Host receipt distinguishes reused native IDs across connections. */
  receipt?: string;
  deferred?: boolean;
  questionTranslation?: QuestionTranslation;
  answerRecord?: AnswerRecord[];
  id: RequestId; method: string; threadId: string; turnId?: string; itemId?: string;
  kind: 'questions' | 'form' | 'url' | 'permissions' | 'unsupported';
  status: 'pending' | 'answered' | 'declined' | 'cancelled' | 'expired' | 'uncertain' | 'unsupported';
  blocking: boolean; receivedAt: string; title: string; message?: string; questions?: NativeQuestion[];
  fields?: NativeFormField[]; url?: string; details?: string; unsupportedReason?: string;
}
export interface QuestionTranslation { status:'pending'|'complete'|'failed'|'off'; values?:Record<string,string>; error?:string }
export interface AnswerRecord { questionId:string; original:string[]; submitted:string[]; secret?:boolean }
export interface AnswerPreview { id:string; sourceHash:string; answers:AnswerRecord[]; review:boolean }
export function questionSegments(items:NativeQuestion[]):Record<string,string> {
  return Object.fromEntries(items.flatMap((q,i)=>[
    [`q${i}.header`,q.header],[`q${i}.question`,q.question],
    ...q.options.flatMap((o,j)=>[[`q${i}.option${j}.label`,o.label],[`q${i}.option${j}.description`,o.description]])
  ]).filter(([,value])=>value?.trim()));
}
export interface InteractionReply { action: 'submit' | 'decline' | 'cancel'; answers?: Record<string, string[]>; content?: Record<string, unknown> }
export interface NativePlan { threadId: string; turnId?: string; explanation?: string; steps: { step: string; status: 'pending' | 'inProgress' | 'completed' }[] }

const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const string = (v: unknown) => typeof v === 'string' ? v : '';
export const requestKey = (id: RequestId) => `${typeof id}:${id}`;
export const isRequestId = (v: unknown): v is RequestId => typeof v === 'string' && v.length > 0 && v.length <= 1024 || typeof v === 'number' && Number.isSafeInteger(v);
const fail = (message: string): never => { throw Error(message); };

export function questions(value: unknown, runtime: 'codex' | 'claude' | 'async'): NativeQuestion[] {
  if (!Array.isArray(value) || !value.length || value.length > 32) fail('Invalid native question list.');
  const result = (value as unknown[]).map((entry, index) => {
    const q = record(entry), raw = q.options;
    if (raw !== undefined && raw !== null && (!Array.isArray(raw) || raw.length > 128)) fail('Invalid native question options.');
    const options = (raw ?? []).map((entry: unknown) => runtime === 'async' ? { label: string(entry), description: '' } : { label: string(record(entry).label), description: string(record(entry).description) });
    if (options.some((o: { label: string }) => !o.label) || new Set(options.map((o: { label: string }) => o.label)).size !== options.length) fail('Invalid native option identity.');
    const question = string(runtime === 'async' ? q.title : q.question), id = runtime === 'codex' ? string(q.id) : String(index);
    if (!question || !id) fail('Invalid native question identity.');
    return { id, header: string(q.header), question, options, multiple: runtime === 'claude' && q.multiSelect === true, other: runtime !== 'codex' || q.isOther === true || !options.length, secret: q.isSecret === true };
  });
  if (new Set(result.map(q => q.id)).size !== result.length || runtime === 'claude' && new Set(result.map(q => q.question)).size !== result.length) fail('Duplicate native question identity.');
  return result;
}

/** An explicit supported subset of MCP form schemas; unfamiliar constraints never become an unchecked form. */
export function formFields(value: unknown): NativeFormField[] {
  const schema = record(value);
  const rootKeys = new Set(['type', 'properties', 'required', 'title', 'description', '$schema', 'additionalProperties']);
  if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties) || Object.keys(schema).some(k => !rootKeys.has(k)) || schema.additionalProperties !== undefined && schema.additionalProperties !== false) fail('Unsupported native form schema.');
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((k: unknown) => typeof k !== 'string' || !Object.hasOwn(schema.properties, k)))) fail('Invalid native required fields.');
  const entries = Object.entries(schema.properties); if (entries.length > 64) fail('Native form is too large.');
  return entries.map(([id, raw]) => {
    const f = record(raw), allowed = ['type', 'title', 'description', 'default', 'enum', 'enumNames', 'oneOf', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'format', 'pattern'];
    if (Object.keys(f).some(k => !allowed.includes(k))) fail('Unsupported native field constraint.');
    const result: NativeFormField = { id, title: string(f.title) || id, description: string(f.description), required: schema.required?.includes(id) === true, type: f.type };
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(f.type)) fail('Unsupported native field type.');
    if (f.type === 'array' && (!f.items || Object.keys(f.items).some(k => !['type', 'enum', 'anyOf'].includes(k)) || f.items.type !== 'string' && f.items.type !== undefined)) fail('Unsupported native list schema.');
    const choices = f.type === 'array' ? f.items.enum ?? f.items.anyOf : f.enum ?? f.oneOf;
    if (choices !== undefined) {
      if (!Array.isArray(choices) || !choices.length || choices.length > 128) fail('Invalid native enumeration.');
      result.options = choices.map((v: unknown, i: number) => typeof v === 'string' ? { value: v, label: string(f.enumNames?.[i]) || v } : { value: string(record(v).const), label: string(record(v).title) || string(record(v).const) });
      if (result.options!.some(o => !o.value) || new Set(result.options!.map(o => o.value)).size !== result.options!.length) fail('Invalid native enumeration value.');
      result.type = f.type === 'array' ? 'multi' : 'select';
    } else if (f.type === 'array') fail('Only enumerated native lists are supported.');
    for (const [source, target] of [['minimum', 'min'], ['maximum', 'max'], ['minLength', 'minLength'], ['maxLength', 'maxLength'], ['minItems', 'min'], ['maxItems', 'max']] as const) {
      if (f[source] !== undefined) { if (!Number.isFinite(f[source])) fail('Invalid native field limit.'); result[target] = f[source]; }
    }
    if (f.pattern !== undefined) fail('Pattern-constrained native forms require a dedicated adapter.');
    if (f.format !== undefined) { if (!['email', 'uri', 'date', 'date-time'].includes(f.format)) fail('Unsupported native string format.'); result.format = f.format; }
    return result;
  });
}

export const CODEX_INTERACTION_METHODS = ['item/tool/requestUserInput', 'mcpServer/elicitation/request', 'item/permissions/requestApproval'] as const;
export function codexInteraction(method: string, params: unknown, id: RequestId, receivedAt: string): NativeInteraction | undefined {
  if (!(CODEX_INTERACTION_METHODS as readonly string[]).includes(method)) return;
  const p = record(params), item: NativeInteraction = { id, method, threadId: string(p.threadId), turnId: string(p.turnId) || undefined, itemId: string(p.itemId) || undefined, kind: 'unsupported', status: 'pending', blocking: p.isBlocking !== false, receivedAt, title: '' };
  try {
    if (method === 'item/tool/requestUserInput') { item.kind = 'questions'; item.questions = questions(p.questions, 'codex'); }
    else if (method === 'item/permissions/requestApproval') {
      item.kind = 'permissions'; item.message = string(p.reason); item.details = JSON.stringify({ cwd: p.cwd, environmentId: p.environmentId, permissions: p.permissions }, null, 2);
      permissionGrant(p.permissions);
    } else {
      item.title = string(p.serverName); item.message = string(p.message);
      if (p.mode === 'url') { item.kind = 'url'; item.url = safeInteractionUrl(p.url); }
      else if (p.mode === 'form') { item.kind = 'form'; item.fields = formFields(p.requestedSchema); }
      else fail('This native elicitation mode requires a dedicated adapter.');
    }
  } catch (error) { item.unsupportedReason = error instanceof Error ? error.message : 'Unsupported native interaction.'; }
  return item;
}

export function claudeInteraction(request: unknown, id: RequestId, threadId: string, turnId: string, receivedAt: string): NativeInteraction | undefined {
  const p = record(request);
  if (p.subtype === 'can_use_tool' && p.tool_name === 'AskUserQuestion') {
    const item: NativeInteraction = { id, method: 'claude/AskUserQuestion', threadId, turnId, kind: 'questions', status: 'pending', blocking: true, receivedAt, title: '' };
    try { item.questions = questions(record(p.input).questions, 'claude'); } catch (error) { item.unsupportedReason = String(error); }
    return item;
  }
  if (p.subtype === 'elicitation') return codexInteraction('mcpServer/elicitation/request', { ...p, mode: p.mode ?? 'form', threadId, turnId, serverName: p.server_name, requestedSchema: p.requested_schema }, id, receivedAt);
}

export function validateAnswers(qs: NativeQuestion[], value: unknown): Record<string, string[]> {
  const answers = record(value);
  if (Object.keys(answers).some(id => !qs.some(q => q.id === id))) fail('Answer does not belong to this native request.');
  return Object.fromEntries(qs.map(q => {
    const answer = answers[q.id];
    if (!Array.isArray(answer) || !answer.length || answer.length > 128 || !q.multiple && answer.length !== 1 || answer.some(a => typeof a !== 'string' || !a.trim() || a.length > 32000) || new Set(answer).size !== answer.length) fail('Complete every native question before submitting.');
    if (!q.other && answer.some((a:string) => !q.options.some(o => o.label === a))) fail('The native question does not allow custom answers.');
    return [q.id, answer];
  }));
}
export function validateForm(fields: NativeFormField[], value: unknown): Record<string, unknown> {
  const content = record(value);
  if (Object.keys(content).some(id => !fields.some(f => f.id === id))) fail('Unknown native form field.');
  const result: [string, unknown][] = [];
  for (const f of fields) {
    const v = content[f.id];
    if (v === undefined || v === '') { if (f.required) fail('Complete every required native field.'); else continue; }
    if (f.type === 'boolean' ? typeof v !== 'boolean' : f.type === 'number' || f.type === 'integer' ? typeof v !== 'number' || !Number.isFinite(v) || f.type === 'integer' && !Number.isInteger(v) : f.type === 'multi' ? !Array.isArray(v) || v.some(x => typeof x !== 'string' || !f.options?.some(o => o.value === x)) || new Set(v).size !== v.length : typeof v !== 'string' || v.length > 32000 || f.type === 'select' && !f.options?.some(o => o.value === v)) fail('Invalid native form value.');
    const n = Array.isArray(v) ? v.length : typeof v === 'number' ? v : undefined;
    if (n !== undefined && (f.min !== undefined && n < f.min || f.max !== undefined && n > f.max)) fail('Native form value is outside its allowed range.');
    if (typeof v === 'string') {
      if (f.minLength !== undefined && v.length < f.minLength || f.maxLength !== undefined && v.length > f.maxLength) fail('Native form text length is outside its allowed range.');
      if (f.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || f.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))) || f.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v)))) fail('Invalid native field format.');
      if (f.format === 'uri') { try { new URL(v); } catch { fail('Invalid native URI.'); } }
    }
    result.push([f.id, v]);
  }
  return Object.fromEntries(result);
}
export function safeInteractionUrl(value: unknown): string {
  const url = new URL(string(value));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Unsupported native URL.');
  return string(value);
}
function permissionGrant(value: unknown) {
  const p = record(value);
  if (!Object.keys(p).length || Object.keys(p).some(k => !['network', 'fileSystem'].includes(k))) fail('Unsupported native permission profile.');
  if (p.network != null && (typeof p.network !== 'object' || Object.keys(p.network).some(k => k !== 'enabled') || p.network.enabled !== null && typeof p.network.enabled !== 'boolean')) fail('Unsupported native network permissions.');
  if (p.fileSystem != null) {
    const fs = record(p.fileSystem);
    // New entry/glob permission models need their own scoped review, never an opaque grant.
    if (!Object.keys(fs).length || Object.keys(fs).some(k => !['read', 'write'].includes(k)) || ['read', 'write'].some(k => fs[k] != null && (!Array.isArray(fs[k]) || fs[k].some((p: unknown) => typeof p !== 'string' || !p)))) fail('Unsupported native filesystem permissions.');
  }
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v != null));
}
export function interactionResult(item: NativeInteraction, reply: InteractionReply, nativeParams: unknown): unknown {
  if (item.status !== 'pending' || !reply || !['submit', 'decline', 'cancel'].includes(reply.action)) fail('Native interaction is no longer pending or the response is invalid.');
  const p = record(nativeParams);
  if (reply.action === 'submit' && item.unsupportedReason) fail('This native interaction cannot be accepted by this adapter.');
  if (item.kind === 'questions') {
    if (item.method === 'claude/AskUserQuestion') {
      if (reply.action !== 'submit') return { behavior: 'deny', message: 'The user declined to answer these questions.' };
      const answers = validateAnswers(item.questions ?? [], reply.answers);
      return { behavior: 'allow', updatedInput: { ...record(p.input), answers: Object.fromEntries(item.questions!.map(q => [q.question, answers[q.id]!.join(', ')])) } };
    }
    return { answers: reply.action === 'submit' ? Object.fromEntries(Object.entries(validateAnswers(item.questions ?? [], reply.answers)).map(([id, answers]) => [id, { answers }])) : {} };
  }
  if (item.kind === 'permissions') return { permissions: reply.action === 'submit' ? permissionGrant(p.permissions) : {}, scope: 'turn' };
  if (item.method === 'mcpServer/elicitation/request') return { action: reply.action === 'submit' ? 'accept' : reply.action, content: reply.action === 'submit' && item.kind === 'form' ? validateForm(item.fields ?? [], reply.content) : null, _meta: null };
  fail('Unsupported native response.');
}
export function expireInteractions(session: { nativeInteractions?: NativeInteraction[] }, status: 'expired' | 'uncertain' = 'expired', threadId?: string, turnId?: string) {
  for (const item of session.nativeInteractions ?? []) if (item.status === 'pending' && (!threadId || item.threadId === threadId) && (!turnId || !item.turnId || item.turnId === turnId)) item.status = status;
}
export function putInteraction(session: { nativeInteractions?: NativeInteraction[] }, item: NativeInteraction) {
  item.receipt ??= globalThis.crypto.randomUUID();
  session.nativeInteractions ??= [];
  const previous = session.nativeInteractions.find(i => requestKey(i.id) === requestKey(item.id) && i.status === 'pending');
  if (previous) fail('Duplicate pending native interaction.');
  // Native IDs may restart after reconnect; receipts preserve each historical request.
  session.nativeInteractions = [...session.nativeInteractions, item];
  while (session.nativeInteractions.length > 100) { const i = session.nativeInteractions.findIndex(i => i.status !== 'pending'); if (i < 0) fail('Too many pending native interactions.'); session.nativeInteractions.splice(i, 1); }
}
export function planUpdate(value: unknown): NativePlan | undefined {
  const p = record(value);
  if (!Array.isArray(p.plan) || p.plan.length > 128 || p.plan.some((s: any) => typeof s?.step !== 'string' || !['pending', 'inProgress', 'completed'].includes(s.status))) return;
  return { threadId: string(p.threadId), turnId: string(p.turnId) || undefined, explanation: typeof p.explanation === 'string' ? p.explanation : undefined, steps: p.plan.map((s: any) => ({ step: s.step, status: s.status })) };
}
