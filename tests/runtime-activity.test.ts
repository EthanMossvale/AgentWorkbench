import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeActivityTracker, mergeActivity, mergeChild, markObservationInterrupted, type RuntimeActivity, type NativeChildSnapshot } from '../packages/collaboration-core/activity';
import { parseCodexNativeChildEvents, ClaudeNativeChildTracker } from '../packages/collaboration-core/events';
import { decodeNativeFrame } from '../services/remote-supervisor';
import { normalizeCodexEvent } from '../packages/runtime-codex';
import { sessionTimeline } from '../packages/collaboration-core/timeline';
import type { Session } from '../packages/contracts';
const frame = (value: unknown) => decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'), '2026-09-25T01:00:00.000Z');

test('Codex activity keeps public command content and excludes hidden reasoning and signatures', () => {
  const tracker = new NativeActivityTracker('codex'), items: RuntimeActivity[] = [];
  const wire = frame({ method: 'item/started', params: { turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', command: 'private command', status: 'inProgress', signature: 'opaque' } } });
  tracker.observe(wire).forEach(item => mergeActivity(items, item));
  assert.equal(items[0]!.status, 'running'); assert.equal(items[0]!.kind, 'command');
  const done = frame({ method: 'item/completed', params: { turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', status: 'completed', exitCode: 1 } } });
  tracker.observe(done).forEach(item => mergeActivity(items, item)); tracker.observe(wire).forEach(item => mergeActivity(items, item));
  assert.equal(items.length, 1); assert.equal(items[0]!.status, 'failed'); assert.equal(items[0]!.input, 'private command'); assert.doesNotMatch(JSON.stringify(items), /opaque/);
  assert.deepEqual(tracker.observe(frame({ method: 'item/reasoning/textDelta', params: { delta: 'secret thought' } })), []);
  assert.equal(tracker.observe(frame({ method: 'item/completed', params: { item: { id: 'edit', type: 'fileChange', status: 'declined', changes: [{ path: 'private/path', diff: 'private diff' }] } } }))[0]!.status, 'cancelled');
});

test('Claude partial and full tool use deduplicate and exact result completes only its own tool', () => {
  const tracker = new NativeActivityTracker('claude');
  const start = frame({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'one', name: 'Bash', input: { command: 'private' } } } });
  assert.equal(tracker.observe(start)[0]!.status, 'running');
  assert.deepEqual(tracker.observe(frame({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'one', name: 'Bash' }] } })), []);
  const result = frame({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'one', is_error: true, content: 'private output' }] } });
  assert.equal(tracker.observe(result)[0]!.status, 'failed');
  assert.deepEqual(tracker.observe(frame({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'unknown' }] } })), []);
  assert.equal(tracker.observe(start)[0], undefined);
});

test('child tool frames cannot turn into parent activity and observations become uncertain on disconnect', () => {
  const tracker = new NativeActivityTracker('claude');
  const child = frame({ type: 'assistant', parent_tool_use_id: 'parent', message: { content: [{ type: 'tool_use', id: 'one', name: 'Write' }] } });
  assert.deepEqual(tracker.observe(child), []);
  const activities = tracker.observe(child, 'child'); assert.equal(activities[0]!.nativeChildId, 'child');
  const snapshot = { activities, nativeChildren: [{ runtime: 'claude', nativeChildId: 'child', operation: 'spawn', status: 'started', updatedAt: 'now' }] as NativeChildSnapshot[] };
  markObservationInterrupted(snapshot); assert.equal(snapshot.activities[0]!.status, 'uncertain'); assert.equal(snapshot.nativeChildren[0]!.status, 'uncertain');
});

test('native child completion requires child state; completed wait/send and shell notifications do not count', () => {
  assert.deepEqual(parseCodexNativeChildEvents(frame({ method: 'item/completed', params: { item: { type: 'collabAgentToolCall', tool: 'wait', status: 'completed', receiverThreadIds: ['child'] } } })), []);
  const event = parseCodexNativeChildEvents(frame({ method: 'item/completed', params: { item: { type: 'collabAgentToolCall', tool: 'wait', senderThreadId: 'root', receiverThreadIds: ['child'], agentsStates: { child: { status: 'completed' } } } } }))[0]!;
  assert.equal(event.operation, 'completed');
  const tracker = new ClaudeNativeChildTracker();
  assert.deepEqual(tracker.observe(frame({ type: 'system', subtype: 'task_started', task_type: 'local_bash', task_id: 'shell' })).events, []);
  assert.deepEqual(tracker.observe(frame({ type: 'system', subtype: 'task_notification', status: 'completed', task_id: 'shell' })).events, []);
  tracker.observe(frame({ type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'child', tool_use_id: 'tool' }), 'parent');
  const completed = tracker.observe(frame({ type: 'system', subtype: 'task_notification', status: 'completed', task_id: 'child' }));
  assert.equal(completed.events[0]!.operation, 'completed'); assert.equal(completed.child, true);
});

test('Claude temporary child identity merges into native ID and late text cannot undo completion', () => {
  const children: NativeChildSnapshot[] = [];
  mergeChild(children, { runtime: 'claude', nativeChildId: 'parent-tool-use:t', toolCallId: 't', operation: 'progress', status: 'message' }, '1');
  mergeChild(children, { runtime: 'claude', nativeChildId: 'native', toolCallId: 't', operation: 'spawn', status: 'started' }, '2');
  mergeChild(children, { runtime: 'claude', nativeChildId: 'native', toolCallId: 't', operation: 'completed', status: 'completed' }, '3');
  mergeChild(children, { runtime: 'claude', nativeChildId: 'native', toolCallId: 't', operation: 'progress', status: 'message' }, '4');
  assert.equal(children.length, 1); assert.equal(children[0]!.nativeChildId, 'native'); assert.equal(children[0]!.operation, 'completed');
});

test('Claude background shell receipt remains running until its native task notification', () => {
  const tracker = new NativeActivityTracker('claude');
  tracker.observe(frame({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'shell', name: 'Bash', input: { run_in_background: true } }] } }));
  const receipt = tracker.observe(frame({ type: 'user', tool_use_result: { backgroundTaskId: 'background' }, message: { content: [{ type: 'tool_result', tool_use_id: 'shell' }] } }));
  assert.equal(receipt[0]!.status, 'running');
  const done = tracker.observe(frame({ type: 'system', subtype: 'task_notification', task_id: 'background', status: 'completed' }));
  assert.equal(done[0]!.status, 'completed'); assert.equal(done[0]!.kind, 'command');
});

test('command output streams into the same chronological row and completion does not move it',()=>{
 const tracker=new NativeActivityTracker('codex'),activities:RuntimeActivity[]=[];
 const start=frame({method:'item/started',params:{turnId:'turn',item:{id:'command',type:'commandExecution',command:'rg -n sample src',cwd:'D:\\fixture',status:'inProgress'}}});
 tracker.observe(start).forEach(item=>mergeActivity(activities,item));
 const delta=frame({method:'item/commandExecution/outputDelta',params:{turnId:'turn',itemId:'command',delta:'src/main.ts:3:sample\n'}});
 assert.equal(normalizeCodexEvent(delta,'root',1).public,true);
 tracker.observe(delta).forEach(item=>mergeActivity(activities,item));
 assert.match(activities[0]!.output!,/main.ts/);
 const completed=frame({method:'item/completed',params:{turnId:'turn',item:{id:'command',type:'commandExecution',status:'completed',exitCode:0,aggregatedOutput:'src/main.ts:3:sample\n'}}});
 tracker.observe(completed).forEach(item=>mergeActivity(activities,item));
 assert.equal(activities[0]!.nativeOrder,start.sequence);
 const session={id:'root',messages:[{id:'before',timestamp:start.receivedAt,nativeOrder:start.sequence!-1},{id:'after',timestamp:start.receivedAt,nativeOrder:start.sequence!+1}],activities} as Session;
 assert.deepEqual(sessionTimeline(session).map(entry=>entry.id),['before',activities[0]!.id,'after']);
});
test('tool details preserve MCP text, file diffs and failure while excluding opaque payloads',()=>{
 const tracker=new NativeActivityTracker('codex');
 const item=tracker.observe(frame({method:'item/completed',params:{item:{id:'mcp',type:'mcpToolCall',tool:'read_file',arguments:{path:'src/main.ts'},status:'failed',result:{content:[{type:'text',text:'Tool output'},{type:'image',data:'opaqueImage'}],_meta:{signature:'opaqueSignature'}},error:{message:'Read failed'}}}}))[0]!;
 assert.match(item.input!,/src/);assert.match(item.output!,/Tool output\nRead failed/);assert.equal(item.status,'failed');assert.doesNotMatch(JSON.stringify(item),/opaque/);
 const edit=tracker.observe(frame({method:'item/completed',params:{item:{id:'edit',type:'fileChange',status:'completed',changes:[{path:'src/file.ts',diff:'-old\n+new'}]}}}))[0]!;
 assert.match(edit.input!,/-old\n\+new/);
 const long=tracker.observe(frame({method:'item/started',params:{item:{id:'long',type:'commandExecution',command:'x'.repeat(70000)}}}))[0]!;
 assert.equal(long.input!.length,65536);assert.equal(long.inputTruncated,true);
});
