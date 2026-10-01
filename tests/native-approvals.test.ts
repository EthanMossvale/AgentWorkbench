import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { approvalFields, approvalPresentation, assertCodexApprovalDecision, claudeApprovalChoices, claudeApprovalResult, codexApprovalChoices, parseApprovalReply, resolveApprovalChoice } from '../packages/native-approvals';
import { CodexRpcClient } from '../packages/runtime-codex';
import { decodeNativeFrame } from '../services/remote-supervisor';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider';
import type { NativeApproval } from '../packages/contracts';

const exec = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } } as const;
const proposal = () => structuredClone(exec) as any;
const suggested = () => [{ type: 'addRules', destination: 'localSettings', behavior: 'allow', rules: [{ toolName: 'Bash', ruleContent: 'git status *' }] }];
const approval = (runtime: 'codex' | 'claude', raw: any): NativeApproval => ({ id: 7, kind: 'command', turnId: 'turn', ...approvalFields(runtime, raw, 'command', 'receipt-one') });

test('Codex explicit decisions are authoritative; no invented session or remembered choice', () => {
  const raw = { availableDecisions: ['accept', 'cancel'], proposedExecpolicyAmendment: ['git', 'status'] };
  assert.deepEqual(codexApprovalChoices(raw, 'command').map(c => c.id), ['accept', 'cancel']);
  assert.deepEqual(codexApprovalChoices({ availableDecisions: [] }, 'command'), []);
  assert.throws(() => assertCodexApprovalDecision(raw, 'command', 'acceptForSession'), /not offered/);
  assert.throws(() => assertCodexApprovalDecision(raw, 'command', proposal()), /not offered/);
});
test('Codex legacy absent decision list supports native session and only proposed prefixes', () => {
  const raw = { proposedExecpolicyAmendment: ['git', 'status'] }, choices = codexApprovalChoices(raw, 'command');
  assert.ok(choices.some(c => c.id === 'acceptForSession'));
  assert.deepEqual(choices.find(c => c.scope === 'saved')?.value, proposal());
  assert.ok(!codexApprovalChoices({}, 'command').some(c => c.scope === 'saved'));
  assert.ok(!codexApprovalChoices(raw, 'file').some(c => c.scope === 'saved'));
});
test('Codex structured command and network choices require exact native fields', () => {
  const network = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'example.invalid', action: 'allow' as const } } };
  const raw = { availableDecisions: ['accept', proposal(), network, 'cancel'] };
  assert.equal(codexApprovalChoices(raw, 'command').length, 4);
  assertCodexApprovalDecision(raw, 'command', proposal()); assertCodexApprovalDecision(raw, 'command', structuredClone(network));
  assert.throws(() => assertCodexApprovalDecision(raw, 'command', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git'] } }), /not offered/);
  assert.throws(() => assertCodexApprovalDecision(raw, 'file', proposal()), /not offered/);
  assert.equal(codexApprovalChoices({ availableDecisions: [{ ...proposal(), extra: true }, { acceptWithExecpolicyAmendment: { execpolicy_amendment: [] } }, { unknown: true }] }, 'command').length, 0);
});
test('Claude forwards original suggested rules and destination, preserves exact tool input', () => {
  const request = { input: { command: 'git status --short' }, permission_suggestions: suggested() }, choices = claudeApprovalChoices(request);
  const choice = choices.find(c => c.id === 'remember')!;
  assert.equal(choice.scope, 'saved'); assert.match(choice.description, /项目本地设置/); assert.deepEqual(choice.rules, ['Bash(git status *)']);
  assert.deepEqual(claudeApprovalResult(request, choice.value), { behavior: 'allow', updatedInput: request.input, updatedPermissions: request.permission_suggestions });
  assert.deepEqual(claudeApprovalResult(request, 'accept'), { behavior: 'allow', updatedInput: request.input });
  assert.deepEqual(claudeApprovalResult(request, 'cancel'), { behavior: 'deny', message: 'The user declined this tool request.', interrupt: true });
});
test('Claude session suggestions stay session-only and unsupported batches never partially grant', () => {
  assert.equal(claudeApprovalChoices({ permission_suggestions: [{ ...suggested()[0], destination: 'session' }] }).find(c => c.id === 'remember')?.scope, 'session');
  for (const permission_suggestions of [undefined, [], [{ ...suggested()[0], destination: undefined }], [{ ...suggested()[0], behavior: 'deny' }], [...suggested(), { type: 'setMode', mode: 'bypassPermissions', destination: 'session' }], [{ ...suggested()[0], extra: true }]]) {
    assert.deepEqual(claudeApprovalChoices({ permission_suggestions }).map(c => c.id), ['accept', 'decline', 'cancel']);
  }
});
test('renderer choices are bound to a receipt and cannot submit arbitrary native changes', () => {
  const raw = { availableDecisions: ['accept', proposal(), 'cancel'] }, a = approval('codex', raw), choices = codexApprovalChoices(raw, 'command');
  assert.deepEqual(resolveApprovalChoice(a, { receipt: a.receipt, optionId: 'execpolicy-1' }, choices), proposal());
  assert.throws(() => resolveApprovalChoice(a, { receipt: 'older', optionId: 'execpolicy-1' }, choices), /RECEIPT_EXPIRED/);
  assert.throws(() => resolveApprovalChoice(a, { receipt: a.receipt, optionId: 'not-offered' }, choices), /NOT_OFFERED/);
  assert.throws(() => parseApprovalReply({ optionId: 'execpolicy-1' }), /INVALID/);
  assert.throws(() => parseApprovalReply({ optionId: 'accept', decision: 'accept', receipt: a.receipt }), /INVALID/);
  assert.throws(() => parseApprovalReply({ decision: proposal() }), /INVALID/);
  assert.equal(resolveApprovalChoice(a, 'accept', choices), 'accept');
});
test('command presentation removes JSON wrapping without changing shell quotes or paths', () => {
  const command = 'powershell.exe -Command "Write-Output \'hello\'"', raw = { command, cwd: 'C:\\fixture dir', reason: 'A synthetic permission request.' };
  assert.equal(approvalPresentation(approval('codex', raw)).command, command);
  assert.equal(approvalPresentation(approval('codex', raw)).cwd, raw.cwd);
  assert.equal(approvalPresentation(approval('claude', { tool_name: 'PowerShell', input: { command, description: 'Synthetic action' } })).command, command);
});
test('real Codex RPC client validates structured replies and consumes an ambiguous write once', async () => {
  const transport: any = new EventEmitter(), written: any[] = [];
  transport.write = async (value: any) => { written.push(value); if (value.method === 'initialize') transport.emit('frame', decodeNativeFrame(Buffer.from(JSON.stringify({ id: value.id, result: {} }) + '\n'))); };
  const rpc = new CodexRpcClient(transport, 'fixture'); await rpc.initialize();
  const emit = (id: number) => transport.emit('frame', decodeNativeFrame(Buffer.from(JSON.stringify({ id, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', availableDecisions: ['accept', proposal()] } }) + '\n')));
  emit(7); await assert.rejects(rpc.replyApproval(7, 'acceptForSession'), /not offered/); await rpc.replyApproval(7, proposal());
  assert.deepEqual(written.at(-1), { id: 7, result: { decision: proposal() } }); await assert.rejects(rpc.replyApproval(7, proposal()), /already resolved/);
  emit(8); transport.write = async () => { throw Error('Synthetic disconnect'); };
  await assert.rejects(rpc.replyApproval(8, proposal()), /disconnect/); await assert.rejects(rpc.replyApproval(8, proposal()), /already resolved/);
});
test('Claude runner routes one native control response and removes failed replies without replay', async () => {
  const request = { input: { command: 'git status' }, permission_suggestions: suggested() };
  const state: any = { sessions: [{ id: 'session', nativeApprovals: [approval('claude', request)] }] }, writes: any[] = [];
  const runner = new NativeProviderRunner({} as any, {} as any, { snapshot: () => structuredClone(state), update: async (fn: (state: any) => void) => fn(state) } as any);
  const active = { stopping: false, approvals: new Map([[7, request]]), process: { write: async (value: any) => writes.push(value) } };
  (runner as any).active.set('session', active);
  await assert.rejects(runner.approval('session', 7, { optionId: 'remember', receipt: 'old' }), /EXPIRED/); assert.equal(writes.length, 0);
  await runner.approval('session', 7, { optionId: 'remember', receipt: 'receipt-one' });
  assert.deepEqual(writes[0].response.response.updatedPermissions, suggested()); assert.equal(writes[0].response.request_id, 7);
  await assert.rejects(runner.approval('session', 7, 'accept'), /EXPIRED/);
  state.sessions[0].nativeApprovals = [approval('claude', request)]; active.approvals.set(7, request); active.process.write = async () => { throw Error('Synthetic write failure'); };
  await assert.rejects(runner.approval('session', 7, 'accept'), /write failure/); assert.equal(state.sessions[0].nativeApprovals.length, 0); assert.equal(active.approvals.size, 0);
});
