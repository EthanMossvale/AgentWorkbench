import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../packages/contracts';
import { ClaudeContextUsageTracker, claudeContextCapacity } from '../packages/runtime-claude/context-usage';
import { currentProviderContext, displayedContext } from '../packages/model-api/native-context';
import { metricsSource, parseTokenCounts, recordSessionUsage } from '../packages/session-metrics';
import {nativeContextState} from '../packages/model-api/context-state';

const stream = (event: Record<string, unknown>) => ({ type: 'stream_event', event });
const start = (id: string, usage: unknown) => stream({ type: 'message_start', message: { id, usage } });
const delta = (usage: unknown) => stream({ type: 'message_delta', usage });
const assistant = (id: string, usage: unknown) => ({ type: 'assistant', message: { id, usage } });

test('Claude final usage delta corrects the earlier zero assistant snapshot', () => {
  const tracker = new ClaudeContextUsageTracker();
  assert.equal(tracker.observe(start('one', { input_tokens: 0, output_tokens: 0 })), undefined);
  assert.equal(tracker.observe(assistant('one', { input_tokens: 0, output_tokens: 0 })), undefined);
  assert.equal(tracker.observe(delta({ input_tokens: 2000, output_tokens: 100, cache_read_input_tokens: 78000 })), 80100);
  assert.equal(tracker.observe(assistant('one', { input_tokens: 2000, output_tokens: 20 })), undefined);
  assert.equal(tracker.observe({ type: 'result', usage: { input_tokens: 4000000, output_tokens: 500000 } }), undefined);
});

test('native Anthropic start input and partial output deltas merge per message without accumulation', () => {
  const tracker = new ClaudeContextUsageTracker();
  tracker.observe(start('one', { input_tokens: 300, output_tokens: 0, cache_read_input_tokens: 600, cache_creation_input_tokens: 100 }));
  assert.equal(tracker.observe(delta({ output_tokens: 20 })), 1020);
  assert.equal(tracker.observe(delta({ output_tokens: 40 })), 1040);
  assert.equal(tracker.observe(delta({ output_tokens: 40 })), 1040);
  assert.equal(tracker.observe(start('two', { input_tokens: 50, output_tokens: 0 })), undefined);
  assert.equal(tracker.observe(delta({ output_tokens: 5 })), 55);
});

test('missing, malformed, child and unbound deltas cannot invent or contaminate context', () => {
  const tracker = new ClaudeContextUsageTracker();
  assert.equal(tracker.observe(delta({ output_tokens: 10 })), undefined);
  tracker.observe(start('root', {}));
  assert.equal(tracker.observe(delta({ output_tokens: 10 })), undefined);
  tracker.observe(start('root', { input_tokens: 100, output_tokens: 0 }));
  assert.equal(tracker.observe({ ...start('child', { input_tokens: 9999, output_tokens: 0 }), parent_tool_use_id: 'child' }), undefined);
  assert.equal(tracker.observe(delta({ output_tokens: 10 })), 110);
  assert.equal(tracker.observe(delta({ output_tokens: -1 })), undefined);
  assert.equal(tracker.observe(assistant('other', { input_tokens: 1 })), undefined);
});

test('compaction and reset clear stream state, while valid zero and assistant-only reports remain usable', () => {
  const tracker = new ClaudeContextUsageTracker();
  assert.equal(tracker.observe(assistant('old-cli', { input_tokens: 100, output_tokens: 20 })), 120);
  assert.equal(tracker.observe(assistant('empty', { input_tokens: 0, output_tokens: 0 })), 0);
  tracker.observe(start('one', { input_tokens: 100, output_tokens: 0 }));
  assert.equal(tracker.observe({ type: 'system', subtype: 'compact_boundary', compact_metadata: { post_tokens: 0 } }), 0);
  assert.equal(tracker.observe(delta({ output_tokens: 10 })), undefined);
  tracker.observe(start('two', { input_tokens: 50, output_tokens: 0 }));
  tracker.observe({ type: 'conversation_reset' });
  assert.equal(tracker.observe(delta({ output_tokens: 10 })), undefined);
});

const model = { id: 'mapping', model: 'fixture-model', name: 'Fixture', enabled: true, contextWindow: 1000000 };
const fixture = (): Session => {
  const session: Session = { id: 'session', title: 'Fixture', projectId: null, pinned: false, archived: false, group: '', createdAt: '2026-09-30T00:00:00Z', status: 'idle', messages: [], nativeTurnId: 'turn', binding: { runtime: 'claude', provider: 'source', executionId: 'local', accountRef: 'fixture', egress: 'direct-api', modelConnectionId: 'source', modelMappingId: model.id, nativeSessionId: 'thread' }, nativeContextUsage: { used: 0, total: 0, capacity: 1000000, runtimeCapacity: 900000, updatedAt: '2026-09-30T00:00:03Z' } };
  for (const [id, input, output, at] of [['first', 90000, 200, '01'], ['last', 80000, 100, '02']] as const)
    recordSessionUsage(session, { id, model: model.model, ...parseTokenCounts({ prompt_tokens: input, completion_tokens: output }, 'chat-completions') }, { source: metricsSource(session), turnId: 'turn', at: `2026-09-30T00:00:${at}Z` });
  return session;
};

test('legacy zero display recovers one exact request, preserves runtime budget and leaves the archive untouched', () => {
  const session = fixture(), before = structuredClone(session);
  const usage = currentProviderContext(session, model)!;
  assert.equal(usage.used, 80100); assert.equal(usage.runtimeCapacity, 900000);
  assert.equal(displayedContext(model, usage).percent, 8);
  assert.deepEqual(session, before);
});

test('recovery never crosses model, thread, runtime, turn, incomplete receipt or native compaction boundaries', () => {
  const checks: ((session: Session) => void)[] = [
    s => { s.binding.nativeSessionId = 'other'; }, s => { s.binding.runtime = 'codex'; },
    s => { s.nativeTurnId = 'other'; }, s => { s.metrics!.records.at(-1)!.model = 'other'; s.metrics!.records[0]!.model = 'other'; },
    s => { s.metrics!.records.at(-1)!.outputTokens = null; },
    s => { s.nativeContextUsage!.turnId = 'turn'; },
    s => { s.activities = [{ id: 'compact', runtime: 'claude', kind: 'message', category: 'compaction', status: 'completed', startedAt: '2026-09-30T00:00:02Z', updatedAt: '2026-09-30T00:00:03Z' }]; },
  ];
  for (const mutate of checks) { const session = fixture(); mutate(session); assert.equal(currentProviderContext(session, model), session.nativeContextUsage); }
  const session = fixture(); session.nativeContextUsage!.used = 100;
  assert.equal(currentProviderContext(session, model)?.used, 100);
  const reset = fixture(); reset.nativeProtocol = { resetAt: '2026-09-30T00:00:03Z' };
  assert.equal(currentProviderContext(reset, model), reset.nativeContextUsage);
  delete reset.nativeContextUsage;
  assert.equal(currentProviderContext(reset, model), undefined);
});

test('native capacity uses an exact root receipt or a single resolved alias only',()=>{
  const value={type:'result',modelUsage:{'claude-opus-5-5':{contextWindow:1000000}}};
  assert.equal(claudeContextCapacity(value,'opus'),1000000);
  assert.equal(claudeContextCapacity({...value,parent_tool_use_id:'child'},'opus'),undefined);
  const multiple={...value,modelUsage:{...value.modelUsage,other:{contextWindow:200000}}};
  assert.equal(claudeContextCapacity(multiple,'opus'),undefined);
  assert.equal(claudeContextCapacity(multiple,'claude-opus-5-5'),1000000);
  for(const contextWindow of [0,-1,1.5,'1000000',1e9])assert.equal(claudeContextCapacity({type:'result',modelUsage:{a:{contextWindow}}}),undefined);
});

for(const runtime of ['claude','codex'] as const)test(`${runtime}: context survives model/effort roundtrips, new receipts and provider handoff`,()=>{
  const s=fixture();s.binding.runtime=runtime;s.modelSelection={model:'large',effort:'low'};
  nativeContextState.observe(s,{used:11715,total:11715,capacity:1000000,updatedAt:'2026-10-01',turnId:'turn'});
  nativeContextState.select(s,{model:'large',effort:'high'});assert.equal(s.nativeContextUsage?.estimated,false);
  nativeContextState.select(s,{model:'small'},200000);s.modelSelection={model:'small'};
  assert.equal(s.nativeContextUsage?.used,11715);assert.equal(s.nativeContextUsage?.capacity,200000);assert.equal(s.nativeContextUsage?.estimated,true);
  nativeContextState.observe(s,{used:12000,total:30000,capacity:200000,updatedAt:'2026-10-02',turnId:'next'});
  nativeContextState.select(s,{model:'large'});s.modelSelection={model:'large'};
  assert.equal(s.nativeContextUsage?.used,12000);assert.equal(s.nativeContextUsage?.capacity,1000000);
  assert.equal(displayedContext(undefined,s.nativeContextUsage).capacity,1000000);
  const carried=nativeContextState.handoff(s,undefined,128000)!;assert.equal(carried.used,12000);assert.equal(carried.capacity,128000);assert.equal(carried.estimated,true);assert.equal(carried.modelWindows,undefined);
  nativeContextState.observe(s,{used:0,total:0,capacity:1000000,updatedAt:'2026-10-03',turnId:'empty'});assert.equal(s.nativeContextUsage?.used,0);assert.equal(s.nativeContextUsage?.estimated,false);
});

test('old SSH Claude usage recovers only request evidence from the same thread, never final totals or post-reset history',()=>{
  const s=fixture();delete s.nativeContextUsage;s.binding.egress='vps';s.modelTargetId='ssh/host/changed/model';
  s.metrics!.records.push({...s.metrics!.records.at(-1)!,id:'result:turn',inputTokens:9999999,updatedAt:'2026-09-30T00:00:04Z'});
  assert.equal(nativeContextState.recover(s)?.used,80100);assert.equal(s.nativeContextUsage,undefined);
  s.nativeProtocol={resetAt:'2026-09-30T00:00:03Z'};assert.equal(nativeContextState.recover(s),undefined);
  delete s.nativeProtocol;s.binding.nativeSessionId='other';assert.equal(nativeContextState.recover(s),undefined);
});

test('missing capacities and malformed optional cache entries never fabricate a window',()=>{
  const s=fixture();s.modelSelection={model:'old'};s.nativeContextUsage!.modelWindows={bad:-1};
  nativeContextState.select(s,{model:'bad'});assert.equal(s.nativeContextUsage?.capacity,null);assert.equal(s.nativeContextUsage?.used,0);
  nativeContextState.select(s,{model:'constructor'});assert.equal(s.nativeContextUsage?.capacity,null);
});

test('later history estimates use the newest receipt when returning to an existing provider lane',()=>{
  const s=fixture();s.nativeContextUsage={used:60000,total:60000,capacity:128000,updatedAt:'2026-10-02'};
  const usage=nativeContextState.handoff(s,{used:5000,total:5000,capacity:1000000,updatedAt:'2026-10-01'})!;
  assert.equal(usage.used,60000);assert.equal(usage.capacity,1000000);assert.equal(usage.estimated,true);
});

test('Codex next-turn selection does not assign the active model receipt to the pending model',()=>{
  const s=fixture();s.binding.runtime='codex';s.status='running';s.nativeActiveSettings={permissionMode:'default',modelSelection:{model:'active'}};s.modelSelection={model:'next'};
  nativeContextState.observe(s,{used:12000,total:50000,capacity:1000000,updatedAt:'now',turnId:'turn'});
  assert.equal(s.nativeContextUsage?.capacity,null);assert.equal(s.nativeContextUsage?.modelWindows?.active,1000000);assert.equal(s.nativeContextUsage?.modelWindows?.next,undefined);assert.equal(s.nativeContextUsage?.estimated,true);
});
