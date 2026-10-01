import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Session } from '../packages/contracts';
import { observeTurnTiming, turnElapsedMs, formatTurnDuration } from '../packages/session-core/turn-timing';
import { readingTurns } from '../packages/collaboration-core/reading-turns';
import { conversationTimeline } from '../packages/collaboration-core/timeline';
import { StateStore } from '../apps/desktop/host/store';

const at = '2026-09-28T00:00:00.000Z';
const session = (): Session => ({ id: 'fixture', title: 'Timing', status: 'idle', projectId: null, pinned: false, archived: false, group: '', createdAt: at, messages: [], binding: { runtime: 'codex', provider: 'fixture', accountRef: 'fixture', executionId: 'local', egress: 'direct-api' } });
function change(s: Session, at: string, fn: (s: Session) => void) { const previous = structuredClone(s); fn(s); observeTurnTiming(previous, s, at); }
const user = (id: string, nativeTurnId = 'turn') => ({ id, nativeTurnId, role: 'user' as const, original: 'Synthetic task', demo: false, timestamp: at });

test('admission starts a visible timer before CLI output or even the submitted message', () => {
  const s = session(); change(s, at, s => { s.status = 'running'; });
  const waiting = readingTurns([], s); assert.equal(waiting.length, 1); assert.equal(waiting[0]?.active, true);
  assert.equal(turnElapsedMs(waiting[0]!.timing!, Date.parse(at) + 10000), 10000);
  change(s, '2026-09-28T00:00:05.000Z', s => { s.messages.push(user('u1')); });
  assert.equal(s.turnTimings?.length, 1); assert.equal(s.turnTimings?.[0]?.userMessageId, 'u1');
  assert.equal(readingTurns(conversationTimeline(s), s)[0]?.timing?.startedAt, at);
});
test('steering, state changes and source changes do not reset the running clock', () => {
  const s = session(); change(s, at, s => { s.status = 'running'; s.messages.push(user('u1')); });
  change(s, '2026-09-28T00:00:12.000Z', s => { s.messages.push(user('u2')); s.title = 'Renamed'; });
  assert.equal(s.turnTimings?.length, 1); assert.equal(s.turnTimings?.[0]?.userMessageId, 'u1');
  assert.equal(readingTurns(conversationTimeline(s), s).length, 1);
  change(s, '2026-09-28T00:00:20.000Z', s => { s.status = 'idle'; s.nativeTurnStatus = 'completed'; });
  const timing = structuredClone(s.turnTimings![0]!); assert.equal(turnElapsedMs(timing, Date.parse(at) + 999999), 20000);
  change(s, '2026-09-28T00:01:00.000Z', s => { s.binding.runtime = 'claude'; }); assert.deepEqual(s.turnTimings![0], timing);
  change(s, '2026-09-28T00:02:00.000Z', s => { s.status = 'running'; s.messages.push(user('u3', 'turn2')); });
  assert.equal(s.turnTimings?.length, 2); assert.equal(s.turnTimings?.[1]?.userMessageId, 'u3');
});
test('known stops and failures keep durations; unknown outcomes have no fabricated finish time', () => {
  for (const [status, native, outcome] of [['idle', 'interrupted', 'stopped'], ['idle', 'failed', 'failed'], ['uncertain', undefined, 'uncertain']] as const) {
    const s = session(); change(s, at, s => { s.status = 'running'; s.messages.push(user('u')); });
    change(s, '2026-09-28T00:00:30.000Z', s => { s.status = status; s.nativeTurnStatus = native; });
    assert.equal(s.turnTimings?.[0]?.status, outcome);
    assert.equal(turnElapsedMs(s.turnTimings![0]!), outcome === 'uncertain' ? null : 30000);
  }
});
test('completed timing persists and recovery does not count application downtime', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'awb-turn-time-'));
  try {
    const store = new StateStore(dir); await store.load(); await store.update(state => { state.sessions = [session()]; });
    await store.update(state => { state.sessions[0]!.status = 'running'; state.sessions[0]!.messages.push(user('u1')); });
    await store.update(state => { state.sessions[0]!.status = 'idle'; });
    const first = structuredClone(store.snapshot().sessions[0]!.turnTimings![0]);
    await store.update(state => { state.sessions[0]!.status = 'running'; state.sessions[0]!.messages.push(user('u2', 'turn2')); });
    const loaded = await new StateStore(dir).load();
    assert.deepEqual(loaded.sessions[0]!.turnTimings![0], first);
    assert.equal(loaded.sessions[0]!.turnTimings![1]!.status, 'uncertain');
    assert.equal(loaded.sessions[0]!.turnTimings![1]!.endedAt, undefined);
    assert.equal(turnElapsedMs(loaded.sessions[0]!.turnTimings![1]!), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('legacy history remains untimed, and duration labels handle seconds minutes and hours', () => {
  const s = session(); s.messages.push(user('old')); observeTurnTiming(structuredClone(s), s, at);
  assert.equal(s.turnTimings, undefined);
  assert.equal(formatTurnDuration(0), '0 秒'); assert.equal(formatTurnDuration(109000), '1 分 49 秒');
  assert.equal(formatTurnDuration(1998000), '33 分 18 秒'); assert.equal(formatTurnDuration(3661000), '1 小时 1 分 1 秒');
});

test('explicit resume binds the same native turn without moving its original clock', () => {
  const s = session(); s.messages.push(user('existing')); s.nativeTurnId = 'turn'; s.status = 'uncertain';
  change(s, at, s => { s.status = 'running'; });
  assert.equal(s.turnTimings?.[0]?.nativeTurnId, 'turn');
  const turns = readingTurns(conversationTimeline(s), s); assert.equal(turns.length, 1); assert.equal(turns[0]?.timing?.startedAt, at);
});

for (const outcome of ['interrupted','failed','uncertain'] as const) test(`${outcome} retains its own history and a new send starts a distinct clock`, () => {
  const s=session();change(s,at,s=>{s.status='running';s.messages.push(user('u1','first'));s.nativeTurnId='first';});
  s.messages.push({id:'partial',role:'assistant',original:'Public partial output',demo:false,timestamp:at,nativeTurnId:'first',nativeTurnEnd:true,phase:'commentary'});
  const failure='Synthetic upstream interruption.';
  change(s,'2026-09-28T00:05:00.000Z',s=>{s.status=outcome==='uncertain'?'uncertain':'idle';s.nativeTurnStatus=outcome;if(outcome!=='interrupted')s.nativeError=failure;});
  const previousTiming=structuredClone(s.turnTimings![0]!);
  assert.equal(readingTurns(conversationTimeline(s),s)[0]!.completed,false);
  if(outcome!=='interrupted')assert.equal(previousTiming.error,failure);
  const start='2026-09-28T00:06:00.000Z';
  change(s,start,s=>{s.status='running';s.nativeTurnId=undefined;s.nativeError=undefined;s.nativeTurnStatus=undefined;});
  let turns=readingTurns(conversationTimeline(s),s);assert.equal(turns.filter(t=>t.active).length,1);
  assert.equal(turns.at(-1)?.timing?.startedAt,start);assert.equal(turnElapsedMs(turns.at(-1)!.timing!,Date.parse(start)),0);
  change(s,'2026-09-28T00:06:01.000Z',s=>{s.messages.push({...user('u2','second'),timestamp:start});s.nativeTurnId='second';});
  turns=readingTurns(conversationTimeline(s),s);assert.equal(turns.filter(t=>t.active).length,1);assert.equal(turns.at(-1)?.timing?.startedAt,start);
  assert.deepEqual(s.turnTimings![0],previousTiming);assert.equal(turns[0]?.completed,false);
  assert.equal(s.messages.find(m=>m.id==='partial')?.original,'Public partial output');
});

test('late terminal error details attach to that turn and survive state reload', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-turn-error-'));
  try{
    const store=new StateStore(dir);await store.load();const s=session();await store.update(state=>state.sessions.push(s));
    await store.update(state=>{const current=state.sessions[0]!;current.status='running';current.nativeTurnId='first';current.messages.push(user('u','first'));});
    await store.update(state=>{const current=state.sessions[0]!;current.status='idle';current.nativeTurnStatus='failed';});
    await store.update(state=>{state.sessions[0]!.nativeError='Synthetic terminal details';});
    const reloaded=new StateStore(dir);await reloaded.load();assert.equal(reloaded.snapshot().sessions[0]!.turnTimings![0]!.error,'Synthetic terminal details');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('failure before the user echo retains a readable terminal timing and error',()=>{
  const s=session();change(s,at,s=>{s.status='running';});
  change(s,'2026-09-28T00:00:03.000Z',s=>{s.status='idle';s.nativeError='Synthetic preparation failure';});
  const turns=readingTurns([],s);assert.equal(turns.length,1);assert.equal(turns[0]?.active,false);assert.equal(turns[0]?.timing?.error,s.nativeError);
  assert.equal(turnElapsedMs(turns[0]!.timing!),3000);
});
