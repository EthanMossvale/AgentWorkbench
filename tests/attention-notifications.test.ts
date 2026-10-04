import test from 'node:test';
import assert from 'node:assert/strict';
import { AttentionDetector } from '../packages/attention-notifications/index';
import type { AppState, Session } from '../packages/contracts';

const session = (patch: Partial<Session> = {}) => ({ id: 's1', title: 'Task', archived: false, status: 'idle', messages: [], ...patch }) as unknown as Session;
const state = (...sessions: Session[]) => ({ sessions }) as unknown as AppState;

test('the first observation is a baseline and never notifies restored work', () => {
  const detector = new AttentionDetector();
  assert.deepEqual(detector.observe(state(session({ status: 'running', nativeApprovals: [{ id: 1, kind: 'command', turnId: 't', details: '', decisions: [] }] }))), []);
});

test('running to idle notifies completion once; child agents and archived sessions do not', () => {
  const detector = new AttentionDetector();
  detector.observe(state(session({ status: 'running' }), session({ id: 'child', status: 'running', agentParent: { sessionId: 's1', operationId: 'o', authorizationQuote: '', taskHash: '' } }), session({ id: 'old', status: 'running', archived: true })));
  const done = state(session({ status: 'idle' }), session({ id: 'child', status: 'idle' , agentParent: { sessionId: 's1', operationId: 'o', authorizationQuote: '', taskHash: '' } }), session({ id: 'old', status: 'idle', archived: true }));
  const alerts = detector.observe(done);
  assert.deepEqual(alerts.map(alert => [alert.sessionId, alert.kind, alert.title]), [['s1', 'completed', 'Task']]);
  assert.deepEqual(detector.observe(done), []);
});

test('a failed, blocked or uncertain ending carries the error for the sidebar mark', () => {
  const detector = new AttentionDetector();
  detector.observe(state(session({ status: 'running' }), session({ id: 's2', status: 'running' }), session({ id: 's3', status: 'running' })));
  const alerts = detector.observe(state(session({ status: 'idle', nativeTurnStatus: 'failed', nativeError: 'boom' }), session({ id: 's2', status: 'blocked' }), session({ id: 's3', status: 'idle', nativeTurnStatus: 'completed' })));
  assert.deepEqual(alerts.map(alert => [alert.sessionId, alert.error, alert.body]), [['s1', 'boom', '任务出错停止'], ['s2', '', '任务出错停止'], ['s3', undefined, '任务已完成']]);
});

test('new approvals and pending interactions notify as permission or question', () => {
  const detector = new AttentionDetector();
  detector.observe(state(session({ status: 'running' })));
  const interaction = (id: string, kind: string, status = 'pending') => ({ id, receipt: 'r-' + id, method: 'm', threadId: 't', kind, status, blocking: true, receivedAt: '', title: '' });
  const next = state(session({ status: 'running', nativeApprovals: [{ id: 7, kind: 'file', turnId: 't', details: '', decisions: [] }], nativeInteractions: [interaction('q', 'questions'), interaction('p', 'permissions'), interaction('done', 'questions', 'answered')] as Session['nativeInteractions'] }));
  assert.deepEqual(detector.observe(next).map(alert => alert.kind).sort(), ['permission', 'permission', 'question']);
  assert.deepEqual(detector.observe(next), []);
});
