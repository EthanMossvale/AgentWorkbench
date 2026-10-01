import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import type { DraftPreview, Session } from '../packages/contracts';
import { asyncQuestionState, prepareAsyncQuestion, recordAsyncQuestions, questionContext } from '../packages/native-interactions/inbox';
import { codexInteraction, putInteraction, expireInteractions, interactionResult, claudeInteraction } from '../packages/native-interactions';

const questions = [{ id: 'source', question: 'Which source?', header: '', multiple: false, other: true, secret: false, options: [{ label: 'Native', description: '' }] }];
async function fixture(enabled = false, fetcher: typeof fetch = async () => { throw Error('Unexpected network'); }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'awb-question-inbox-')), store = new StateStore(dir); await store.load();
  const secrets = new SecretStore(dir, { encrypt: value => Buffer.from(value), decrypt: value => value.toString() });
  const controller = new WorkbenchController(store, secrets, { translationFetcher: fetcher, pickDirectory: async () => null, copy: () => {}, openPath: async () => {}, nativeCapabilities: () => [] }, () => {});
  await controller.call('plugins/set-enabled', { id: 'translation', enabled });
  const created = await controller.call('session/create', { runtime: 'demo' }) as Session;
  await store.update(state => { const session = state.sessions[0]!; session.messages.push({ id: 'question', role: 'assistant', demo: false, original: 'Optional follow-up', timestamp: '2026-09-29T00:00:00Z', questions: structuredClone(questions) }); });
  const session = () => store.snapshot().sessions.find(s => s.id === created.id)!;
  const presentation = (action: string) => controller.call('interaction/presentation', { sessionId: created.id, messageId: 'question', action });
  const prepare = (answer = '来自其它设备') => controller.call('draft/prepare', { sessionId: created.id, questionReply: { messageId: 'question', answers: { source: [answer] } } }) as Promise<DraftPreview>;
  const submit = (preview: DraftPreview, automatic = false) => controller.call('draft/submit', { sessionId: created.id, id: preview.id, sourceHash: preview.sourceHash, automatic });
  return { store, controller, session, presentation, prepare, submit, dir, close: async () => { await controller.dispose(); await rm(dir, { recursive: true, force: true }); } };
}

test('finished async questions default to the inbox; explicit show, defer and dismiss persist without sending', async () => {
  const f = await fixture(); try {
    assert.equal(asyncQuestionState(f.session(), f.session().messages[0]!), 'deferred');
    await assert.rejects(f.prepare(), /ASYNC_QUESTION_STALE/);
    await f.presentation('show'); assert.equal(asyncQuestionState(f.session(), f.session().messages[0]!), 'open');
    await f.presentation('defer'); assert.equal(asyncQuestionState(f.session(), f.session().messages[0]!), 'deferred');
    const reload = (await new StateStore(f.dir).load()).sessions[0]!;
    assert.equal(asyncQuestionState(reload, reload.messages[0]!), 'deferred');
    await f.store.update(state => { state.sessions[0]!.messages.push({ id: 'unrelated', role: 'user', demo: false, original: 'Another task', timestamp: 'fixture' }); });
    assert.equal(asyncQuestionState(f.session(), f.session().messages[0]!), 'deferred');
    await f.presentation('dismiss'); assert.equal(asyncQuestionState(f.session(), f.session().messages[0]!), 'dismissed');
    await assert.rejects(f.presentation('show'), /ASYNC_QUESTION_STALE/);
    await assert.rejects(f.prepare(), /ASYNC_QUESTION_STALE/);
    assert.equal(f.session().messages.length, 2);
  } finally { await f.close(); }
});

test('async answers use the ordinary submission gate once, preserve originals and mark only that question answered', async () => {
  const f = await fixture(); try {
    await f.presentation('show'); const preview = await f.prepare();
    assert.equal(preview.original, 'Which source?\n来自其它设备'); assert.equal(preview.translated, preview.original); assert.equal(preview.moduleDisabled, true);
    await f.submit(preview); await assert.rejects(f.submit(preview));
    const session = f.session(); assert.equal(session.messages.filter(m => m.role === 'user').length, 1);
    assert.equal(session.messages.find(m => m.role === 'user')!.submitted, preview.original);
    assert.equal(session.messages[0]!.questionPresentation?.state, 'answered');
  } finally { await f.close(); }
});

test('only custom answers enter translation; question text and selected option identities stay intact', async () => {
  const translatedInputs: unknown[] = [];
  const f = await fixture(true, async (_url, init) => {
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages.at(-1).content); translatedInputs.push(input);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value).replace('来自其它设备', 'From another device')]))) } }] });
  });
  try {
    const state = f.store.snapshot(); await f.controller.call('translation/settings', { profile: { ...state.translation, baseUrl: 'https://translator.example/v1', protocol: 'chat-completions', model: 'fixture', consent: true }, key: 'synthetic-key', translateInput: true, translateFinal: false, translateProgress: false });
    await f.presentation('show'); const preview = await f.prepare();
    assert.equal(preview.translated, 'Which source?\nFrom another device');
    assert.ok(translatedInputs.some(value => JSON.stringify(value) === JSON.stringify({ 'a0.0': '来自其它设备' })));
    await assert.rejects(f.submit(preview, true), /直接发送已关闭/);
    const count = translatedInputs.length, option = await f.prepare('Native'); assert.equal(option.translated, 'Which source?\nNative'); assert.equal(translatedInputs.length, count);
    await f.controller.call('draft/cancel', { id: option.id }); await assert.rejects(f.submit(option));
  } finally { await f.close(); }
});

test('defer, ignore, turn completion, replaced questions and settings changes invalidate pending answers', async () => {
  const f = await fixture(); try {
    for (const action of ['defer', 'dismiss']) {
      await f.store.update(state => { delete state.sessions[0]!.messages[0]!.questionPresentation; });
      await f.presentation('show'); const preview = await f.prepare(); await f.presentation(action); await assert.rejects(f.submit(preview));
    }
    await f.store.update(state => { delete state.sessions[0]!.messages[0]!.questionPresentation; });
    await f.presentation('show'); const changed = await f.prepare();
    await f.store.update(state => { state.sessions[0]!.messages[0]!.questions![0]!.question = 'Replaced question'; });
    await assert.rejects(f.submit(changed), /ASYNC_QUESTION_STALE/);
    await f.presentation('show'); const policy = await f.prepare(); await f.controller.call('plugins/set-enabled', { id: 'translation', enabled: true }); await assert.rejects(f.submit(policy));
    assert.equal(f.session().messages.filter(m => m.role === 'user').length, 0);
  } finally { await f.close(); }
});

test('new native async messages collapse when their turn ends and repeated frames preserve dismissal', async () => {
  const f = await fixture(); try {
    const session = f.session(), message = session.messages[0]!; session.status = 'running'; session.nativeTurnId = 'turn'; delete message.questions;
    recordAsyncQuestions(session, message, structuredClone(questions)); assert.equal(asyncQuestionState(session, message), 'open');
    const reference = prepareAsyncQuestion(session, { messageId: message.id, answers: { source: ['Native'] } }).reference;
    session.status = 'idle'; assert.equal(asyncQuestionState(session, message), 'deferred'); assert.notEqual(reference.context, questionContext(session));
    message.questionPresentation = { state: 'dismissed', context: questionContext(session) }; recordAsyncQuestions(session, message, structuredClone(questions)); assert.equal(asyncQuestionState(session, message), 'dismissed');
    recordAsyncQuestions(session, message, [{ ...questions[0]!, question: 'A new question' }]); assert.equal(asyncQuestionState(session, message), 'open');
  } finally { await f.close(); }
});

test('presentation validates target identity and async secrets cannot be copied into ordinary chat history', async () => {
  const f = await fixture(); try {
    for (const payload of [{ action: 'unknown', messageId: 'question' }, { action: 'show', messageId: 'question', receipt: 'foreign' }, { action: 'show', messageId: 'missing' }, { action: 'defer', receipt: 'missing' }]) await assert.rejects(f.controller.call('interaction/presentation', { sessionId: f.session().id, ...payload }));
    await f.presentation('show');
    await assert.rejects(f.controller.call('draft/prepare', { sessionId: f.session().id, questionReply: { messageId: 'question', answers: { foreign: ['Native'] } } }));
    await f.store.update(state => { state.sessions[0]!.messages[0]!.questions![0]!.secret = true; }); await assert.rejects(f.prepare(), /ASYNC_SECRET_QUESTION_UNSUPPORTED/);
  } finally { await f.close(); }
});

test('native questions stay pending when deferred; ignore maps to Codex empty answers and Claude deny; completion expires', async () => {
  const f = await fixture(); try {
    const raw = { threadId: 'native', turnId: 'turn', questions: [{ id: 'q', question: 'Question?', options: [{ label: 'Yes' }] }] };
    const item = codexInteraction('item/tool/requestUserInput', raw, 'native-id', 'fixture')!;
    await f.store.update(state => { putInteraction(state.sessions[0]!, item); });
    await f.controller.call('interaction/presentation', { sessionId: f.session().id, receipt: item.receipt, action: 'defer' });
    assert.equal(f.session().nativeInteractions![0]!.status, 'pending'); assert.equal(f.session().nativeInteractions![0]!.deferred, true);
    assert.deepEqual(interactionResult(item, { action: 'decline' }, raw), { answers: {} });
    const claudeRaw = { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Question?', options: [{ label: 'Yes' }] }] } };
    const claude = claudeInteraction(claudeRaw, 'claude-id', 'native', 'turn', 'fixture')!;
    assert.equal((interactionResult(claude, { action: 'decline' }, claudeRaw) as { behavior: string }).behavior, 'deny');
    await f.store.update(state => { expireInteractions(state.sessions[0]!); });
    await assert.rejects(f.controller.call('interaction/presentation', { sessionId: f.session().id, receipt: item.receipt, action: 'show' }), /NATIVE_QUESTION_STALE/);
  } finally { await f.close(); }
});
