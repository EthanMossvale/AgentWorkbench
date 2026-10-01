import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { NativeEvent, SessionBinding, TranslationProfile } from '../packages/contracts';
import { assertIndependentTranslationKey } from '../packages/translation/credentials';
import { normalizeBaseUrl } from '../packages/translation/config';
import { listModels, Translator, type Fetcher } from '../packages/translation/provider';
import { SecretStore, StateStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { ClaudeStreamAdapter, buildClaudeArgs, normalizeClaudeEvent } from '../packages/runtime-claude';
import { claudeRetryNotice } from '../packages/runtime-claude/retry';
import { SessionLeaseRegistry, SubmissionLedger, missingBridgeChecks, type BridgeEvidence } from '../packages/session-core';
import { decodeNativeFrame, ProcessSupervisor } from '../services/remote-supervisor';

const syntheticKey = 'sk-ant-api03-SYNTHETIC-NOT-A-CREDENTIAL';
const forbidden = ['sk-ant-oat01-SYNTHETIC', 'sk-ant-ort01-SYNTHETIC', 'sk-ant-sid01-SYNTHETIC', 'sessionKey=SYNTHETIC', 'Cookie:sessionKey=SYNTHETIC', 'other=x;sessionKey=SYNTHETIC', 'CLAUDE_CODE_OAUTH_TOKEN=SYNTHETIC', '{"access_token":"SYNTHETIC"}'];
const profile: TranslationProfile = { id: 'safety-fixture', name: 'Fixture', baseUrl: 'https://translate.example/v1', protocol: 'anthropic-messages', model: 'fixture', verifiedEfforts: [], consent: true, maxCharacters: 1000, maxCalls: 10, timeoutMs: 1000 };

test('recognized subscription credentials never enter the translation vault or overwrite its prior key', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aw-credential-safety-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let encryptions = 0;
  const crypto = { encrypt: (text: string) => { encryptions++; return Buffer.from(text); }, decrypt: (data: Buffer) => data.toString() };
  const vault = new SecretStore(directory, crypto);
  await vault.set(profile.baseUrl, syntheticKey);
  const before = await readFile(join(directory, 'translation-key.bin'));
  for (const key of forbidden) await assert.rejects(vault.set(profile.baseUrl, key), error => error instanceof Error && !error.message.includes(key));
  assert.equal(encryptions, 1); assert.deepEqual(await readFile(join(directory, 'translation-key.bin')), before);
  const reopened = new SecretStore(directory, crypto);
  assert.equal(await reopened.get(profile.baseUrl), syntheticKey);
  const legacy = new SecretStore(directory, { ...crypto, decrypt: () => JSON.stringify({ scope: profile.baseUrl, key: forbidden[0] }) });
  await assert.rejects(legacy.get(profile.baseUrl), /登录令牌/);
  assert.deepEqual(await readFile(join(directory, 'translation-key.bin')), before);
  assert.equal(await legacy.get('https://other.example/v1'), '');
});

test('translation blocks browser endpoints and known subscription tokens before all network requests', async () => {
  let requests = 0;
  const fetcher: Fetcher = async () => { requests++; return Response.json({}); };
  for (const protocol of ['anthropic-messages', 'responses', 'chat-completions'] as const) {
    for (const key of forbidden) {
      await assert.rejects(listModels({ ...profile, protocol }, key, fetcher));
      await assert.rejects(new Translator(fetcher).translate('A bounded task.', 'input', { ...profile, protocol }, key));
    }
  }
  for (const baseUrl of ['https://claude.ai/api', 'https://api.claude.ai/v1', 'https://CLAUDE.AI./api', 'https://platform.claude.com/v1', 'https://console.anthropic.com/api']) {
    assert.throws(() => normalizeBaseUrl(baseUrl), /独立推理 API/);
    await assert.rejects(listModels({ ...profile, baseUrl }, syntheticKey, fetcher));
  }
  assert.equal(requests, 0);
  for (const key of [syntheticKey, 'independent-custom-gateway-key']) assert.doesNotThrow(() => assertIndependentTranslationKey(key));
  assert.equal(normalizeBaseUrl('https://api.anthropic.com'), 'https://api.anthropic.com/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');
});

test('legitimate independent API keys still reach the selected service once', async () => {
  let requests = 0;
  const translator = new Translator(async (_url, init) => {
    requests++; assert.equal(new Headers(init?.headers).get('x-api-key'), syntheticKey);
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Bounded task.' }] });
  });
  assert.equal((await translator.translate('明确任务。', 'input', profile, syntheticKey)).text, 'Bounded task.');
  assert.equal(requests, 1);
});

test('desktop settings reject subscription credentials without saving them or changing the active profile', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aw-settings-safety-'));
  const store = new StateStore(directory); await store.load();
  let encrypted = 0, requests = 0;
  const secrets = new SecretStore(directory, { encrypt: value => { encrypted++; return Buffer.from(value); }, decrypt: value => value.toString() });
  const controller = new WorkbenchController(store, secrets, { pickDirectory: async () => null, copy: () => {}, openPath: async () => {}, nativeCapabilities: () => [], translationFetcher: async () => { requests++; throw new Error('No network expected'); } }, () => {});
  t.after(async () => { await controller.dispose(); await rm(directory, { recursive: true, force: true }); });
  const previous = store.snapshot().translation;
  const settings = { profile, translateInput: true, translateProgress: false, translateFinal: true };
  await assert.rejects(controller.call('translation/settings', { ...settings, key: forbidden[0] }), /登录令牌/);
  assert.deepEqual(store.snapshot().translation, previous); assert.equal(encrypted, 0); assert.equal(requests, 0);
  await controller.call('translation/settings', { ...settings, key: syntheticKey });
  assert.equal(encrypted, 1); assert.equal(await secrets.get(profile.baseUrl), syntheticKey);
  assert.equal(store.snapshot().translation.hasKey, true); assert.equal(requests, 0);
});

test('native retry observations are structured, sanitized and distinct from assistant text', () => {
  const retry = { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3, retry_delay_ms: 2000, error_status: 429, error: 'rate_limit' };
  const frame = (value: unknown) => decodeNativeFrame(Buffer.from(JSON.stringify(value) + '\n'));
  assert.equal(claudeRetryNotice(retry)?.error, 'rate_limit');
  const event = normalizeClaudeEvent(frame(retry), 's', 1);
  assert.equal(event.public, true); assert.match(event.text, /Native Claude retry 1\/3/);
  assert.match(event.text, /has not added a retry/);
  assert.equal(claudeRetryNotice({ ...retry, type: 'assistant' }), undefined);
  assert.equal(claudeRetryNotice({ ...retry, retry_delay_ms: -1 }), undefined);
  assert.equal(normalizeClaudeEvent(frame({ ...retry, error: 'SYNTHETIC-PRIVATE-BODY' }), 's', 2).text.includes('SYNTHETIC-PRIVATE-BODY'), false);
  assert.equal(normalizeClaudeEvent(frame({ ...retry, parent_tool_use_id: 'child-tool' }), 's', 3).public, false);
});

const fixtureScript = String.raw`
const readline = require('node:readline');
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const send = value => process.stdout.write(JSON.stringify({session_id: session, ...value})+'\n');
readline.createInterface({input: process.stdin}).on('line', line => {
  const input = JSON.parse(line), mode = input.message.content;
  send({type:'user',uuid:input.uuid,parent_tool_use_id:null,message:input.message});
  if(mode !== 'ordinary') send({type:'system',subtype:'api_retry',attempt:1,max_retries:2,retry_delay_ms:5,error_status:mode==='authentication_failed'?401:429,error:mode==='authentication_failed'?'authentication_failed':'rate_limit',...(mode==='child'?{parent_tool_use_id:'child-tool'}:{})});
  if(mode==='child') send({type:'result',is_error:true,parent_tool_use_id:'child-tool'});
  send({type:'result',is_error:mode==='rate_limit'||mode==='authentication_failed',result:'Synthetic terminal result',parent_tool_use_id:null});
});
`;
async function nativeFixture(t: test.TestContext) {
  const transport = new ProcessSupervisor({ executable: process.execPath, args: ['-e', fixtureScript] });
  t.after(() => transport.stop());
  const binding: SessionBinding = { runtime: 'claude', provider: 'anthropic', accountRef: 'synthetic-own-profile', executionId: 'fixture-executor', hostId: 'fixture-host', egress: 'vps' };
  const evidence: BridgeEvidence = { runtime: 'claude', runtimeVersion: '2.1.281', hostId: binding.hostId!, executionId: binding.executionId, accountRef: binding.accountRef, checks: Object.fromEntries(missingBridgeChecks('claude').map(key => [key, 'verified'])) };
  const adapter = new ClaudeStreamAdapter(transport, 'fixture-session', binding, evidence);
  const leases = new SessionLeaseRegistry(), lease = leases.acquire('fixture-session', 'writer'), ledger = new SubmissionLedger(leases);
  let writes = 0; const originalWrite = transport.write.bind(transport);
  transport.write = async value => { writes++; return originalWrite(value); };
  await transport.start();
  return { transport, adapter, lease, ledger, writes: () => writes };
}

for (const reason of ['rate_limit', 'authentication_failed']) test(`Claude terminal ${reason} cannot silently start another submission`, async t => {
  const f = await nativeFixture(t), events: NativeEvent[] = [];
  f.adapter.on('event', event => events.push(event));
  const completed = once(f.adapter, 'completed');
  await f.adapter.submitUser(reason, randomUUID(), f.lease, f.ledger); await completed;
  assert.equal(f.adapter.submissionBlock?.reason, reason);
  assert.equal(f.transport.state, 'running'); // No hidden kill/restart or override of native retries.
  await assert.rejects(f.adapter.submitUser('ordinary', randomUUID(), f.lease, f.ledger), /further submissions.*blocked/);
  assert.equal(f.writes(), 1); assert.equal(events.filter(event => /Native Claude retry/.test(event.text)).length, 1);
  assert.equal(f.adapter.binding.accountRef, 'synthetic-own-profile');
});

for (const mode of ['recovered', 'child']) test(`Claude ${mode} native work stays available without framework concurrency overrides`, async t => {
  const f = await nativeFixture(t);
  let completed = once(f.adapter, 'completed'); await f.adapter.submitUser(mode, randomUUID(), f.lease, f.ledger); await completed;
  assert.equal(f.adapter.submissionBlock, undefined);
  completed = once(f.adapter, 'completed'); await f.adapter.submitUser('ordinary', randomUUID(), f.lease, f.ledger); await completed;
  assert.equal(f.writes(), 2);
  assert.doesNotMatch(buildClaudeArgs({ version: '2.1.281' }).join(' '), /max-turns|max-budget|max-concurrent|--agents|--bare|oauth|api-key/);
});

test('empty tasks cannot turn a peer inbox into an autonomous submission source', async t => {
  const f = await nativeFixture(t);
  await assert.rejects(f.adapter.submitUser(' \n ', randomUUID(), f.lease, f.ledger), /explicit nonempty task/);
  assert.equal(f.writes(), 0);
});

test('already received terminal failures are drained before admitting another Claude task', async t => {
  const f = await nativeFixture(t);
  const done = once(f.adapter, 'completed'); await f.adapter.submitUser('ordinary', randomUUID(), f.lease, f.ledger); await done;
  f.transport.emit('frame', decodeNativeFrame(Buffer.from(JSON.stringify({ type: 'result', session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', is_error: true, result: 'Synthetic late terminal error' }) + '\n')));
  await assert.rejects(f.adapter.submitUser('ordinary', randomUUID(), f.lease, f.ledger), /further submissions.*blocked/);
  assert.equal(f.writes(), 1); assert.equal(f.adapter.submissionBlock?.reason, 'native_error');
});
