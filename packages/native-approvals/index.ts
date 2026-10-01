import type { NativeApproval } from '../contracts';

export type BasicApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';
export type CodexApprovalDecision = BasicApprovalDecision
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: { host: string; action: 'allow' | 'deny' } } };
export interface ApprovalOption {
  id: string; label: string; description: string; scope: 'once' | 'session' | 'saved' | 'deny' | 'cancel'; rules?: string[];
}
export interface ApprovalReply { decision?: BasicApprovalDecision; optionId?: string; receipt?: string }
interface Choice<T> extends ApprovalOption { value: T }
type PermissionDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session';
export type ClaudePermissionUpdate =
  | { type: 'setMode'; destination: 'session'; mode: 'default' | 'acceptEdits' | 'bypassPermissions' }
  | { type: 'addRules'; destination: PermissionDestination; behavior: 'allow'; rules: { toolName: string; ruleContent?: string | null }[] }
  | { type: 'addDirectories'; destination: PermissionDestination; directories: string[] };
type ClaudeDecision = BasicApprovalDecision | { updatedPermissions: ClaudePermissionUpdate[] };
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !value.includes('\0');
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(text);
const basic = ['accept', 'acceptForSession', 'decline', 'cancel'] as const;
export const isBasicApprovalDecision = (value: unknown): value is BasicApprovalDecision => basic.includes(value as BasicApprovalDecision);
const basicChoice = (value: BasicApprovalDecision): Choice<BasicApprovalDecision> => ({ id: value, value, ...({
  accept: { label: '允许本次', description: '仅批准当前请求。', scope: 'once' },
  acceptForSession: { label: '本会话允许', description: '由原生运行时在当前会话内记住这项批准。', scope: 'session' },
  decline: { label: '拒绝', description: '拒绝这项操作，交由运行时继续处理。', scope: 'deny' },
  cancel: { label: '取消', description: '取消请求并中断当前操作。', scope: 'cancel' },
} as const)[value] });

function execDecision(value: unknown): value is Extract<CodexApprovalDecision, { acceptWithExecpolicyAmendment: unknown }> {
  const v = object(value), inner = object(v.acceptWithExecpolicyAmendment);
  return keys(v, ['acceptWithExecpolicyAmendment']) && keys(inner, ['execpolicy_amendment']) && strings(inner.execpolicy_amendment);
}
function networkDecision(value: unknown): value is Extract<CodexApprovalDecision, { applyNetworkPolicyAmendment: unknown }> {
  const v = object(value), inner = object(v.applyNetworkPolicyAmendment), policy = object(inner.network_policy_amendment);
  return keys(v, ['applyNetworkPolicyAmendment']) && keys(inner, ['network_policy_amendment']) && keys(policy, ['host', 'action']) && text(policy.host) && ['allow', 'deny'].includes(policy.action);
}
/** Explicit availableDecisions is authoritative, including an empty list. */
export function codexApprovalChoices(params: Record<string, any>, kind: 'command' | 'file'): Choice<CodexApprovalDecision>[] {
  const fallback: unknown[] = [...basic];
  if (kind === 'command') {
    if (strings(params.proposedExecpolicyAmendment)) fallback.push({ acceptWithExecpolicyAmendment: { execpolicy_amendment: params.proposedExecpolicyAmendment } });
    if (Array.isArray(params.proposedNetworkPolicyAmendments)) for (const policy of params.proposedNetworkPolicyAmendments) fallback.push({ applyNetworkPolicyAmendment: { network_policy_amendment: policy } });
  }
  const offered = Array.isArray(params.availableDecisions) ? params.availableDecisions : fallback;
  return offered.flatMap((value: unknown, index: number): Choice<CodexApprovalDecision>[] => {
    if (isBasicApprovalDecision(value)) return [basicChoice(value)];
    if (kind !== 'command') return [];
    if (execDecision(value)) return [{ id: `execpolicy-${index}`, value, label: '今后允许此类命令', description: '保存到 Codex 原生命令规则；后续匹配此前缀的命令可免于询问。', scope: 'saved', rules: [JSON.stringify(value.acceptWithExecpolicyAmendment.execpolicy_amendment)] }];
    if (networkDecision(value)) {
      const policy = value.applyNetworkPolicyAmendment.network_policy_amendment;
      return [{ id: `network-${index}`, value, label: policy.action === 'allow' ? '今后允许此目标' : '拒绝并记住目标', description: '保存到 Codex 原生网络策略，仅匹配下列目标。', scope: policy.action === 'allow' ? 'saved' : 'deny', rules: [policy.host] }];
    }
    return [];
  });
}
const destinations: Record<PermissionDestination, string> = { userSettings: '用户设置（跨项目）', projectSettings: '项目设置（可共享）', localSettings: '项目本地设置', session: '当前会话' };
function permissionUpdate(value: unknown): value is ClaudePermissionUpdate {
  const v = object(value);
  if (!Object.hasOwn(destinations, v.destination)) return false;
  if (v.type === 'addDirectories') return keys(v, ['type', 'destination', 'directories']) && strings(v.directories);
  return v.type === 'addRules' && keys(v, ['type', 'destination', 'behavior', 'rules']) && v.behavior === 'allow' && Array.isArray(v.rules) && v.rules.length > 0 && v.rules.every((r: unknown) => {
    const rule = object(r); return keys(rule, ['toolName', 'ruleContent']) && text(rule.toolName) && (rule.ruleContent == null || text(rule.ruleContent));
  });
}
/** Suggestions remain one native update batch; never invent a prefix, destination or mode. */
export function claudeApprovalChoices(request: Record<string, any>): Choice<ClaudeDecision>[] {
  const choices: Choice<ClaudeDecision>[] = ['accept', 'decline', 'cancel'].map(value => basicChoice(value as BasicApprovalDecision));
  if (request.tool_name === 'ExitPlanMode') {
    choices[0] = { ...choices[0]!, label: '手动批准编辑', description: '退出计划模式，后续操作按原生默认权限审批。' };
    choices[1] = { ...choices[1]!, label: '继续规划', description: '保留计划模式，让 Claude 继续完善计划。' };
    choices.splice(1, 0,
      { id: 'plan-accept-edits', value: { updatedPermissions: [{type:'setMode',destination:'session',mode:'acceptEdits'}] }, label:'自动接受编辑', description:'退出计划模式，允许原生工作目录内的文件编辑；其他操作仍按原生权限审批。', scope:'session' },
      { id: 'plan-full-access', value: { updatedPermissions: [{type:'setMode',destination:'session',mode:'bypassPermissions'}] }, label:'完整访问', description:'退出计划模式，在当前会话中绕过原生工具权限询问。仅在你明确选择并批准后生效。', scope:'session' });
    return choices;
  }
  const updates: unknown = request.permission_suggestions;
  if (!Array.isArray(updates) || !updates.length || !updates.every(permissionUpdate)) return choices;
  const session = updates.every(u => u.destination === 'session');
  choices.splice(1, 0, { id: 'remember', value: { updatedPermissions: updates }, label: session ? '本会话允许此类操作' : '今后允许此类操作', scope: session ? 'session' : 'saved',
    description: `保存位置：${[...new Set(updates.map(u => destinations[u.destination]))].join('、')}。由 Claude Code 应用原生建议。`,
    rules: updates.flatMap(u => u.type === 'addRules' ? u.rules.map(r => r.ruleContent ? `${r.toolName}(${r.ruleContent})` : `${r.toolName}（所有调用）`) : u.type === 'addDirectories' ? u.directories.map(directory => `工作目录：${directory}`) : []),
  });
  return choices;
}
export function approvalFields(runtime: 'codex' | 'claude', request: Record<string, any>, kind: NativeApproval['kind'], receipt: string): Pick<NativeApproval, 'receipt' | 'options' | 'decisions' | 'details'> {
  const choices = runtime === 'codex' ? codexApprovalChoices(request, kind === 'file' ? 'file' : 'command') : claudeApprovalChoices(request);
  return { receipt, options: choices.map(({ value: _value, ...option }) => option), decisions: choices.flatMap(c => isBasicApprovalDecision(c.value) ? [c.value] : []),
    details: JSON.stringify(runtime === 'claude' ? { tool: request.tool_name, input: request.input, reason: request.decision_reason, description: request.description, cwd: request.cwd, blockedPath: request.blocked_path, permissionSuggestions: request.permission_suggestions } : { command: request.command, cwd: request.cwd, reason: request.reason, grantRoot: request.grantRoot, changes: request.changes, network: request.networkApprovalContext, additionalPermissions: request.additionalPermissions }, null, 2) };
}
export function parseApprovalReply(value: unknown): ApprovalReply {
  const p = object(value);
  if ((p.decision === undefined) === (p.optionId === undefined) || (p.decision !== undefined && !isBasicApprovalDecision(p.decision)) || (p.optionId !== undefined && (!text(p.optionId) || !text(p.receipt))) || (p.receipt !== undefined && !text(p.receipt))) throw Error('APPROVAL_REPLY_INVALID');
  return { decision: p.decision, optionId: p.optionId, receipt: p.receipt };
}
export function resolveApprovalChoice<T>(approval: NativeApproval, input: BasicApprovalDecision | ApprovalReply, choices: Choice<T>[]): T {
  const reply = parseApprovalReply(typeof input === 'string' ? { decision: input } : input);
  if (reply.receipt !== undefined && reply.receipt !== approval.receipt) throw Error('APPROVAL_RECEIPT_EXPIRED');
  const choice = reply.optionId !== undefined ? choices.find(c => c.id === reply.optionId) : choices.find(c => c.value === reply.decision);
  if (!choice) throw Error('APPROVAL_OPTION_NOT_OFFERED');
  return choice.value;
}
const canonical = (value: any): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
export function assertCodexApprovalDecision(params: Record<string, any>, kind: 'command' | 'file', decision: CodexApprovalDecision): void {
  if (!codexApprovalChoices(params, kind).some(c => canonical(c.value) === canonical(decision))) throw Error('Decision is not offered by the native runtime');
}
export function claudeApprovalResult(request: Record<string, any>, decision: ClaudeDecision): Record<string, unknown> {
  if(request.tool_name==='ExitPlanMode'&&decision==='accept')return {behavior:'allow',updatedInput:request.input,updatedPermissions:[{type:'setMode',destination:'session',mode:'default'}]};
  if (decision === 'accept' || typeof decision === 'object') return { behavior: 'allow', updatedInput: request.input, ...(typeof decision === 'object' ? { updatedPermissions: decision.updatedPermissions } : {}) };
  return { behavior: 'deny', message: 'The user declined this tool request.', ...(decision === 'cancel' ? { interrupt: true } : {}) };
}
export function approvalOptions(approval: NativeApproval): ApprovalOption[] { return approval.options ?? approval.decisions.map(basicChoice); }
export function approvalPresentation(approval: NativeApproval) {
  let data: Record<string, any> = {}; try { data = object(JSON.parse(approval.details)); } catch { /* Legacy plain text remains inspectable. */ }
  const input = object(data.input), string = (value: unknown) => typeof value === 'string' ? value : '';
  return { plan: approval.kind === 'plan' ? string(input.plan) : '', command: string(data.command) || string(input.command), reason: string(data.reason) || string(data.description) || string(input.description), cwd: string(data.cwd) || string(input.cwd),
    tool: string(data.tool), path: string(data.grantRoot) || string(data.blockedPath) || string(input.file_path),
    network: data.network ? JSON.stringify(data.network, null, 2) : '', permissions: data.additionalPermissions ? JSON.stringify(data.additionalPermissions, null, 2) : '',
  };
}
