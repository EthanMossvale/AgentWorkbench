import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { PeerInbox } from '../packages/collaboration-core/inbox';
import { NativePeerContextSession } from '../packages/collaboration-core/native-inbox';
import { initialCollaborationState, type CollaborationState } from '../packages/collaboration-core/types';
import { createPeerTools } from '../packages/collaboration-core/tools';
import { SessionLeaseRegistry, SubmissionLedger, missingBridgeChecks, type BridgeEvidence } from '../packages/session-core';
import { ClaudeStreamAdapter } from '../packages/runtime-claude';
import { CodexNativeAdapter, CodexRpcClient } from '../packages/runtime-codex';
import { decodeNativeFrame, type ProcessSupervisor } from '../services/remote-supervisor';
import type { Session, SessionBinding } from '../packages/contracts';

class SyntheticTransport extends EventEmitter {
  writes: Record<string, unknown>[] = []; stopped = false; rejectWrites = false;
  respond?: (value: Record<string, unknown>) => void;
  async write(value: Record<string, unknown>) { if (this.rejectWrites) throw Error('Synthetic write failure'); this.writes.push(value); queueMicrotask(() => this.respond?.(value)); }
  async stop() { this.stopped = true; this.emit('disconnect'); }
  frame(value: unknown) { this.emit('frame', decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'))); }
}
const bind = (runtime: 'claude' | 'codex'): SessionBinding => ({ runtime, provider: runtime, accountRef: 'fixture', hostId: 'host', executionId: 'exec', egress: 'vps' });
// Synthetic evidence only. No runtime/model/network assertion is made by these fixtures.
const proof = (runtime: 'claude' | 'codex'): BridgeEvidence => ({ runtime, runtimeVersion: runtime === 'claude' ? '2.1.281' : '0.155.1', hostId: 'host', accountRef: 'fixture', executionId: 'exec', checks: Object.fromEntries(missingBridgeChecks(runtime).map(id => [id, 'verified'])) });

test('memory hooks follow the bound Codex runtime on resumed turns even with a third-party provider', async () => {
  const transport = new SyntheticTransport(), rpc = new CodexRpcClient(transport as unknown as ProcessSupervisor, 'memory-session');
  let calls = 0, finishes = 0, turns = 0;
  transport.respond = value => { if(value.id !== undefined && value.method) transport.frame({id:value.id,result:value.method === 'turn/start' ? {turn:{id:'turn-'+(++turns)}} : {}}); };
  await rpc.initialize();
  const memoryHandoff = {runtime:'codex' as const,sessionId:'memory-session',prepare:async(task:string,_id:string,mode?:string)=>{calls++;assert.equal(mode,'default');return task+'\nENGLISH_HANDOFF_'+calls;},finish:async()=>{finishes++;throw Error('Synthetic receipt failure');}};
  const adapter = new CodexNativeAdapter(rpc,{...bind('codex'),provider:'third-party-url',nativeSessionId:'root'},{environmentId:'exec',cwd:'D:\\fixture'},proof('codex'),'0.155.1',{memoryHandoff});
  await adapter.registerEnvironment(`ws://127.0.0.1:41235/${'a'.repeat(64)}`);
  const leases=new SessionLeaseRegistry(),lease=leases.acquire('memory-session','host'),ledger=new SubmissionLedger(leases);
  await assert.rejects(adapter.startTurn('   ','empty',lease,ledger),/nonempty/);assert.equal(calls,0);
  await adapter.startTurn('First','first',lease,ledger,{model:'claude-compatible-model'});
  transport.frame({method:'turn/completed',params:{threadId:'child',turn:{id:'turn-1'}}});await tick();assert.equal(finishes,0);
  transport.frame({method:'turn/completed',params:{threadId:'root',turn:{id:'turn-1'}}});await tick();assert.equal(finishes,1);
  await adapter.startTurn('Second','second',lease,ledger,{model:'unrelated-model'});assert.equal(calls,2);
  const sent=transport.writes.filter(v=>v.method==='turn/start');assert.equal(sent.length,2);assert.match(JSON.stringify(sent[1]),/ENGLISH_HANDOFF_2/);
  await transport.stop();await tick();assert.equal(finishes,2);
});

test('Claude per-task memory hooks work on resumed third-party sessions and stop at native failure gates', async () => {
  const transport=new SyntheticTransport(),leases=new SessionLeaseRegistry(),lease=leases.acquire('memory-session','host'),ledger=new SubmissionLedger(leases);
  let calls=0,finishes=0;
  const memoryHandoff={runtime:'claude' as const,sessionId:'memory-session',prepare:async(task:string)=>{calls++;return task+'\nCLAUDE_FORMAT_ENGLISH_HANDOFF';},finish:async()=>{finishes++;}};
  const adapter=new ClaudeStreamAdapter(transport as unknown as ProcessSupervisor,'memory-session',{...bind('claude'),provider:'gpt-via-custom-url',nativeSessionId:'root'},proof('claude'),'2.1.281',{memoryHandoff});
  const one=randomUUID();await adapter.submitUser('First',one,lease,ledger);transport.frame({type:'user',uuid:one,session_id:'root'});transport.frame({type:'result',session_id:'root',is_error:false,result:'done'});await tick();await tick();assert.equal(finishes,1);
  const two=randomUUID();await adapter.submitUser('Second',two,lease,ledger);assert.equal(calls,2);assert.match(JSON.stringify(transport.writes[1]),/CLAUDE_FORMAT_ENGLISH_HANDOFF/);
  transport.frame({type:'user',uuid:two,session_id:'root'});transport.frame({type:'result',session_id:'root',is_error:true,result:'error'});await tick();await tick();
  await assert.rejects(adapter.submitUser('Third',randomUUID(),lease,ledger),/blocked/);assert.equal(calls,2);assert.equal(transport.writes.length,2);
  const closed=new ClaudeStreamAdapter(new SyntheticTransport() as unknown as ProcessSupervisor,'memory-session',bind('claude'),undefined,'2.1.281',{memoryHandoff});
  await assert.rejects(closed.submitUser('Task',randomUUID(),lease,ledger));assert.equal(calls,2);
  assert.throws(()=>new ClaudeStreamAdapter(transport as unknown as ProcessSupervisor,'different',bind('claude'),proof('claude'),'2.1.281',{memoryHandoff}),/another runtime or session/);
});
async function fixture(runtime: 'claude' | 'codex') {
  let state = initialCollaborationState(), queue = Promise.resolve();
  const session = (id: string): Session => ({ id, projectId: null, title: id, pinned: false, archived: false, group: '', status: 'idle', messages: [], binding: bind(runtime), createdAt: new Date().toISOString() });
  const sessions = [session('sender'), session('recipient')];
  const inbox = new PeerInbox({ snapshot: () => structuredClone(state), identity: id => { const value = sessions.find(s => s.id === id); return value ? { session: value, ownerId: 'owner' } : undefined; }, identities: () => sessions.map(session => ({ session, ownerId: 'owner' })), update: async change => { const job = queue.then(() => { const next = structuredClone(state); change(next); state = next; }); queue = job.catch(() => {}); await job; } });
  await inbox.send('sender', 'recipient', 'Peer context fixture.', 'send-one');
  const transport = new SyntheticTransport(), leases = new SessionLeaseRegistry(), lease = leases.acquire('recipient', 'host'), ledger = new SubmissionLedger(leases);
  const context = new NativePeerContextSession(inbox, 'recipient');
  return { inbox, context, transport, leases, lease, ledger, state: (): CollaborationState => structuredClone(state) };
}

test('Claude child UUID and child result cannot acknowledge or complete the parent peer delivery', async () => {
  const f = await fixture('claude'); try {
    const adapter = new ClaudeStreamAdapter(f.transport as unknown as ProcessSupervisor, 'recipient', bind('claude'), proof('claude'), '2.1.281', {}, f.context);
    const id = randomUUID(), completions: unknown[] = []; adapter.on('completed', value => completions.push(value));
    await adapter.submitUser('Root task.', id, f.lease, f.ledger);
    assert.equal(f.state().messages[0]!.status, 'claimed');
    f.transport.frame({ type: 'user', uuid: id, session_id: 'child', parent_tool_use_id: 'agent-call' });
    f.transport.frame({ type: 'result', session_id: 'child', parent_tool_use_id: 'agent-call', result: 'Child output' });
    await tick(); assert.equal(completions.length, 0); assert.equal(f.state().messages[0]!.status, 'claimed'); assert.equal(f.ledger.get(id).state, 'pending');
    const ack = once(adapter, 'acknowledged'); f.transport.frame({ type: 'user', uuid: id, session_id: 'root', parent_tool_use_id: null }); await ack;
    assert.equal(f.state().messages[0]!.status, 'delivered'); assert.equal(f.state().messages[0]!.nativeReceipt, id);
    const completed = once(adapter, 'completed'); f.transport.frame({ type: 'result', subtype: 'success', is_error: false, session_id: 'root', result: 'Root output' }); await completed;
    assert.equal(completions.length, 1); assert.equal(f.transport.stopped, false);
  } finally { f.inbox.dispose(); }
});

test('Claude result without native replay receipt and write errors remain uncertain without replay', async () => {
  const f = await fixture('claude'); try {
    const adapter = new ClaudeStreamAdapter(f.transport as unknown as ProcessSupervisor, 'recipient', bind('claude'), proof('claude'), '2.1.281', {}, f.context);
    const id = randomUUID(); await adapter.submitUser('Root.', id, f.lease, f.ledger);
    const completed = once(adapter, 'completed'); f.transport.frame({ type: 'result', subtype: 'success', is_error: false, session_id: 'root', result: 'No ACK' }); await completed;
    assert.equal(f.state().messages[0]!.status, 'uncertain');
    await assert.rejects(adapter.submitUser('Retry.', randomUUID(), f.lease, f.ledger), /uncertain/); assert.equal(f.transport.writes.length, 1);
  } finally { f.inbox.dispose(); }
  const g = await fixture('claude'); try {
    g.transport.rejectWrites = true;
    const adapter = new ClaudeStreamAdapter(g.transport as unknown as ProcessSupervisor, 'recipient', bind('claude'), proof('claude'), '2.1.281', {}, g.context);
    await assert.rejects(adapter.submitUser('Root.', randomUUID(), g.lease, g.ledger), /write failure/); assert.equal(g.state().messages[0]!.status, 'uncertain');
  } finally { g.inbox.dispose(); }
});

test('prewrite ledger rejection releases peer input, while an unrelated Claude session still fails closed', async () => {
  const f = await fixture('claude'); try {
    const adapter = new ClaudeStreamAdapter(f.transport as unknown as ProcessSupervisor, 'recipient', { ...bind('claude'), nativeSessionId: 'root' }, proof('claude'), '2.1.281', {}, f.context);
    const id = randomUUID(); f.ledger.begin(id, 'old', f.lease);
    await assert.rejects(adapter.submitUser('Root.', id, f.lease, f.ledger), /already exists/);
    assert.equal(f.state().messages[0]!.status, 'queued'); assert.equal(f.transport.writes.length, 0);
    const fault = once(adapter, 'fault'); f.transport.frame({ type: 'assistant', session_id: 'unrelated', message: { content: [] } }); await fault;
    assert.equal(f.transport.stopped, true);
  } finally { f.inbox.dispose(); }
});

test('Codex native turn receipt delivers inbox once and child final does not finish the parent turn', async () => {
  const f = await fixture('codex'); try {
    f.transport.respond = value => {
      if (value.id === undefined) return;
      const result = value.method === 'thread/start' ? { thread: { id: 'root' } } : value.method === 'turn/start' ? { turn: { id: 'turn' } } : {};
      f.transport.frame({ id: value.id, result });
    };
    const rpc = new CodexRpcClient(f.transport as unknown as ProcessSupervisor, 'recipient'); await rpc.initialize();
    const adapter = new CodexNativeAdapter(rpc, bind('codex'), { environmentId: 'exec', cwd: 'D:\\fixture' }, proof('codex'), '0.155.1', {}, 'default', f.context);
    await adapter.registerEnvironment(`ws://127.0.0.1:41235/${'a'.repeat(64)}`); await adapter.startThread();
    await adapter.startTurn('Root.', 'turn-one', f.lease, f.ledger); assert.equal(f.state().messages[0]!.status, 'delivered'); assert.equal(f.state().messages[0]!.nativeReceipt, 'turn');
    const sent = f.transport.writes.find(value => value.method === 'turn/start')!;
    assert.match(JSON.stringify(sent), /Peer context fixture/);
    f.transport.frame({ method: 'turn/completed', params: { threadId: 'child', turn: { id: 'turn', status: 'completed' } } });
    await assert.rejects(adapter.startTurn('Second.', 'two', f.lease, f.ledger), /active or uncertain/);
    f.transport.frame({ method: 'turn/completed', params: { threadId: 'root', turn: { id: 'turn', status: 'completed' } } });
    await adapter.startTurn('Second.', 'two', f.lease, f.ledger);
    const last = f.transport.writes.filter(value => value.method === 'turn/start').at(-1)!;
    assert.doesNotMatch(JSON.stringify(last), /Peer context fixture/);
  } finally { await f.transport.stop(); f.inbox.dispose(); }
});

test('Codex child replies to the parent never reclassify the parent as its own child', () => {
  const transport = new SyntheticTransport(), rpc = new CodexRpcClient(transport as unknown as ProcessSupervisor, 'recipient'); rpc.bindRootThread('root');
  const children: unknown[] = [], events: { public: boolean; text: string }[] = [], childFrames: unknown[] = [];
  rpc.on('childAgent', value => children.push(value)); rpc.on('event', value => events.push(value)); rpc.on('childEvent', value => childFrames.push(value));
  transport.frame({ method: 'item/completed', params: { threadId: 'root', item: { type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'root', receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } } } } });
  transport.frame({ method: 'item/completed', params: { threadId: 'child', item: { type: 'collabAgentToolCall', tool: 'sendInput', senderThreadId: 'child', receiverThreadIds: ['root'], agentsStates: { root: { status: 'running' } } } } });
  transport.frame({ method: 'item/completed', params: { threadId: 'unrelated', item: { type: 'agentMessage', phase: 'final_answer', text: 'Unrelated' } } });
  transport.frame({ method: 'item/completed', params: { threadId: 'root', item: { type: 'agentMessage', phase: 'final_answer', text: 'Parent final' } } });
  assert.equal(children.length, 1); assert.equal(events.at(-1)!.public, true); assert.equal(events.at(-1)!.text, 'Parent final'); assert.equal(childFrames.length, 1);
});

test('Codex registers pinned dynamic peer tools and accepts calls only from its bound active thread', async () => {
  const f = await fixture('codex'); try {
    f.transport.respond = value => { if (value.id !== undefined && value.method) f.transport.frame({ id: value.id, result: value.method === 'thread/start' ? { thread: { id: 'root' } } : value.method === 'turn/start' ? { turn: { id: 'turn' } } : {} }); };
    const rpc = new CodexRpcClient(f.transport as unknown as ProcessSupervisor, 'recipient'); await rpc.initialize();
    const adapter = new CodexNativeAdapter(rpc, bind('codex'), { environmentId: 'exec', cwd: 'D:\\fixture' }, proof('codex'), '0.155.1', {}, 'default', f.context, createPeerTools(f.inbox, 'recipient'));
    await adapter.registerEnvironment(`ws://127.0.0.1:41235/${'a'.repeat(64)}`); await adapter.startThread();
    const start = f.transport.writes.find(value => value.method === 'thread/start')!;
    assert.match(JSON.stringify(start), /"type":"function".*workbench_send_message/);
    await adapter.startTurn('Root.', 'first', f.lease, f.ledger);
    const params = { threadId: 'root', turnId: 'turn', callId: 'call-1', namespace: null, tool: 'workbench_send_message', arguments: { targetSessionId: 'sender', text: 'Native tool message.', operationId: 'native-send' } };
    f.transport.frame({ id: 'tool-one', method: 'item/tool/call', params }); await tick(); await tick();
    const reply = f.transport.writes.find(value => value.id === 'tool-one')!;
    assert.equal((reply.result as { success: boolean }).success, true); assert.equal(f.state().messages.at(-1)!.fromSessionId, 'recipient');
    f.transport.frame({ id: 'tool-two', method: 'item/tool/call', params: { ...params, threadId: 'foreign', callId: 'call-2' } }); await tick();
    assert.equal((f.transport.writes.find(value => value.id === 'tool-two')!.result as { success: boolean }).success, false);
    f.transport.frame({ id: 'tool-three', method: 'item/tool/call', params }); await tick();
    assert.equal((f.transport.writes.find(value => value.id === 'tool-three')!.result as { success: boolean }).success, false); assert.equal(f.state().messages.length, 2);
    f.transport.frame({method:'item/completed',params:{threadId:'root',item:{type:'collabAgentToolCall',tool:'spawnAgent',senderThreadId:'root',receiverThreadIds:['native-child'],agentsStates:{'native-child':{status:'running'}}}}});
    f.transport.frame({id:'child-tool',method:'item/tool/call',params:{...params,threadId:'native-child',turnId:'child-turn',callId:'child-call',arguments:{targetSessionId:'sender',text:'Child tool message.',operationId:'child-send'}}});await tick();await tick();
    assert.equal((f.transport.writes.find(value=>value.id==='child-tool')!.result as {success:boolean}).success,true);
    assert.equal(f.state().messages.at(-1)!.fromSessionId,'recipient');
  } finally { await f.transport.stop(); f.inbox.dispose(); }
});
