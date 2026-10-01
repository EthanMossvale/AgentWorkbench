import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeWireRequest } from '../packages/model-api/native-wire';
import { apiAttachmentContent, attachmentPrompt, publicContextJson } from '../packages/attachments/input';
import { visibleHandoff } from '../packages/model-api/targets';
import { UsageWireTap } from '../packages/session-metrics/wire';
import { parseTokenCounts, recordSessionUsage, sessionMetrics } from '../packages/session-metrics';
import { observeNativeMetrics } from '../packages/session-metrics/native';
import type { Session } from '../packages/contracts';

const session = (): Session => ({ id: 'fixture', projectId: null, title: 'Fixture', group: '', pinned: false, archived: false, status: 'idle', createdAt: '', messages: [], binding: { runtime: 'codex', provider: 'fixture', accountRef: 'fixture', executionId: 'local-device', egress: 'direct-api', modelConnectionId: 'fixture', nativeSessionId: 'fixture-thread' } });
test('repeated native and upstream stream snapshots do not multiply a long direct-provider session', () => {
  const s = session(); let cumulative = 0;
  for (let i = 0; i < 143; i++) {
    const input = 25000 + i * 4000, output = 200, cached = Math.max(0, input - 1000);
    const usage = { prompt_tokens: input, completion_tokens: output, total_tokens: input + output, prompt_cache_hit_tokens: cached, prompt_cache_miss_tokens: 1000 };
    const tap = new UsageWireTap('chat-completions', true);
    // Several progress snapshots carry the same request usage; only the final snapshot is a receipt.
    for (let frame = 0; frame < 6; frame++) tap.feed(Buffer.from('data: ' + JSON.stringify({ usage }) + '\n\n'));
    tap.feed(Buffer.from('data: [DONE]\n\n'));
    const counts = tap.finish().counts, at = new Date(1700000000000 + i * 1000).toISOString();
    const sample = { id: 'request-' + i, ...counts }; recordSessionUsage(s, sample, { source: 'gateway', turnId: 'turn', at });
    recordSessionUsage(s, sample, { source: 'gateway', turnId: 'turn', at });
    cumulative += input + output;
    const value = { method: 'thread/tokenUsage/updated', params: { threadId: 'fixture-thread', turnId: 'turn', tokenUsage: { total: { inputTokens: cumulative - (i + 1) * output, outputTokens: (i + 1) * output, totalTokens: cumulative }, last: { inputTokens: input, outputTokens: output, totalTokens: input + output } } } };
    for (let frame = 0; frame < 2; frame++) observeNativeMetrics(s, { value, receivedAt: at });
  }
  assert.equal(sessionMetrics(s).steps, 143); assert.equal(sessionMetrics(s).totalTokens, cumulative);
  assert.ok(sessionMetrics(s).totalTokens! > 40_000_000); assert.ok(s.metrics!.records.every(row => row.inputTokens! < 1_000_000));
  assert.equal(parseTokenCounts({ prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 }, 'chat-completions').totalTokens, 1010);
});

test('attachments and handoff metadata do not stringify binary image bytes as prose', () => {
  const bytes = Buffer.alloc(10000, 7), data = bytes.toString('base64');
  const attachment: any = { id: 'fixture', name: 'fixture.png', path: '/fixture/image.png', mime: 'image/png', size: bytes.length, sha256: '0'.repeat(64) };
  const files = [{ attachment, data: bytes }];
  assert.ok(!attachmentPrompt('Task', files).includes(data));
  for (const from of ['responses', 'anthropic-messages'] as const) {
    const content = apiAttachmentContent('Task', files, from);
    const input = from === 'responses' ? { input: [{ role: 'user', content }] } : { messages: [{ role: 'user', content }] };
    const mapped = nativeWireRequest(input, from, 'chat-completions', { id: 'fixture', name: 'Fixture', model: 'fixture', enabled: true });
    assert.equal(mapped.messages[1].content[1].image_url.url, 'data:image/png;base64,' + data);
    assert.ok(!mapped.messages[1].content[0].text.includes(data)); assert.ok(!publicContextJson(mapped).includes(data));
  }
  const s = session(); s.messages = [{ id: 'old', role: 'user', original: 'Old', timestamp: '', demo: false, attachments: [attachment] }, { id: 'new', role: 'user', original: 'New', timestamp: '', demo: false }];
  const handoff = visibleHandoff(s, 1); assert.ok(!handoff.includes('Old')); assert.ok(!handoff.includes(data));
  assert.equal(visibleHandoff(s, 2), '');
});
