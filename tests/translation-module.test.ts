import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController, DEMO_INPUT } from '../apps/desktop/host/controller';
import { StateStore, SecretStore, initialState } from '../apps/desktop/host/store';
import { translationProfile } from '../apps/desktop/host/validation';
import type { AppState, DraftPreview, Session } from '../packages/contracts';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const settings = (state: AppState) => ({ profile: state.translation, translateInput: state.translateInput, translateProgress: state.translateProgress, translateFinal: state.translateFinal });
async function fixture(fetcher: typeof fetch = async () => { throw new Error('Unexpected network'); }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aw-translation-module-'));
  const store = new StateStore(dir); await store.load();
  const secrets = new SecretStore(dir, { encrypt: value => Buffer.from(value), decrypt: value => value.toString() });
  const controller = new WorkbenchController(store, secrets, { translationFetcher: fetcher, pickDirectory: async () => null, copy: () => {}, openPath: async () => {}, nativeCapabilities: () => [] }, () => {});
  const create = () => controller.call('session/create', { runtime: 'demo' }) as Promise<Session>;
  const toggle = (enabled: boolean) => controller.call('plugins/set-enabled', { id: 'translation', enabled });
  const configure = () => controller.call('translation/settings', { ...settings(store.snapshot()), profile: { ...store.snapshot().translation, baseUrl: 'https://translator.example/v1', protocol: 'chat-completions', consent: true, model: 'fixture-model' }, key: 'fixture-translation-key' });
  return { dir, store, secrets, controller, create, toggle, configure, close: async () => { await controller.dispose(); await rm(dir, { recursive: true }); } };
}

test('manual retranslation persists complete quoted prose without restoring hidden English or changing the original', async () => {
  const original = `I'm ready, but I can't confirm it. The note says "Review first". Use \`git status\`.`;
  const translated = '我准备好了，但还无法确认。备注写着“先审查”。使用 `git status`。';
  let sent = '', calls = 0;
  const f = await fixture(async (_url, init) => {
    calls++; sent = JSON.parse(String(init?.body)).messages.at(-1).content;
    const token = sent.match(/⟦AW_[^⟧]*⟧/)?.[0];
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: translated.replace('`git status`', token ?? '') } }] });
  });
  try {
    await f.configure(); const session = await f.create();
    await f.store.update(state => { state.sessions.find(item => item.id === session.id)!.messages.push({ id: 'prose', role: 'assistant', original, timestamp: '2026-09-28T00:00:00Z', demo: false }); });
    await f.controller.call('message/retranslate', { sessionId: session.id, messageId: 'prose' });
    const stored = (await new StateStore(f.dir).load()).sessions.find(item => item.id === session.id)!.messages[0]!;
    assert.equal(stored.original, original); assert.equal(stored.translation, translated); assert.equal(stored.translationStatus, 'complete');
    assert.match(sent, /I'm ready, but I can't confirm it/); assert.match(sent, /"Review first"/); assert.equal(calls, 1);
    assert.equal(f.store.snapshot().sessions.find(item => item.id === session.id)!.messages.length, 1);
  } finally { await f.close(); }
});

test('translation defaults on, migrates legacy state, and persists only its optional switch', async () => {
  const f = await fixture(); try {
    assert.equal(f.store.snapshot().plugins?.translation?.enabled, true);
    const legacy = initialState(); delete legacy.plugins; await writeFile(path.join(f.dir, 'state.json'), JSON.stringify(legacy));
    assert.equal((await new StateStore(f.dir).load()).plugins?.translation?.enabled, true);
    await f.toggle(false);
    assert.equal((await new StateStore(f.dir).load()).plugins?.translation?.enabled, false);
    await assert.rejects(f.controller.call('plugins/set-enabled', { id: 'ssh', enabled: false }), /基座/);
    await assert.rejects(f.controller.call('plugins/set-enabled', { id: 'translation', enabled: 'false' }), /布尔/);
  } finally { await f.close(); }
});

test('manual commentary translation during a running turn releases stale pending state when the text changes',async()=>{
 const started=deferred<void>(),response=deferred<Response>();let calls=0;
 const f=await fixture(async()=>{calls++;if(calls===1){started.resolve();return response.promise;}return Response.json({choices:[{finish_reason:'stop',message:{content:'新的译文'}}]});});
 try{
  await f.configure();const session=await f.create();
  await f.store.update(s=>{const current=s.sessions.find(x=>x.id===session.id)!;current.status='running';current.messages.push({id:'live',role:'assistant',original:'Checking the first file.',phase:'commentary',timestamp:new Date().toISOString(),demo:false});});
  const pending=f.controller.call('message/retranslate',{sessionId:session.id,messageId:'live'});await started.promise;
  await f.store.update(s=>{s.sessions.find(x=>x.id===session.id)!.messages[0]!.original='Checking the second file.';});
  response.resolve(Response.json({choices:[{finish_reason:'stop',message:{content:'过期译文'}}]}));await pending;
  let message=f.store.snapshot().sessions.find(x=>x.id===session.id)!.messages[0]!;assert.equal(message.translationStatus,'off');assert.equal(message.translation,undefined);
  await f.controller.call('message/retranslate',{sessionId:session.id,messageId:'live'});
  message=f.store.snapshot().sessions.find(x=>x.id===session.id)!.messages[0]!;assert.equal(message.translationStatus,'complete');assert.equal(message.translation,'新的译文');assert.equal(calls,2);
 }finally{await f.close();}
});

test('disabled module sends exact original once without keys, models, preview translation or result translation', async () => {
  const f = await fixture(); try {
    let keyReads = 0; f.secrets.get = async () => { keyReads++; throw new Error('Do not read keys while disabled'); };
    await f.toggle(false); const session = await f.create(); const original = '请保留原文。\nDo not change `src/main.ts`.';
    const preview = await f.controller.call('draft/prepare', { sessionId: session.id, text: original, demo: true }) as DraftPreview;
    assert.equal(preview.translated, original); assert.equal(preview.moduleDisabled, true); assert.equal(preview.bypass, true); assert.equal(preview.demo, false);
    const submit = { sessionId: session.id, id: preview.id, sourceHash: preview.sourceHash };
    await f.controller.call('draft/submit', submit); await assert.rejects(f.controller.call('draft/submit', submit));
    const messages = f.store.snapshot().sessions[0]!.messages;
    assert.equal(messages.length, 2); assert.equal(messages[0]!.submitted, original); assert.equal(messages[1]!.translationStatus, 'off'); assert.equal(messages[1]!.translation, undefined); assert.equal(keyReads, 0);
    for (const method of ['translation/models', 'draft/refine', 'message/retranslate', 'translation/auto-submit']) await assert.rejects(f.controller.call(method, { sessionId: session.id, enabled: true }), /模块已关闭/);
  } finally { await f.close(); }
});

test('turning off revokes ready translated previews, and turning on revokes ready raw previews', async () => {
  const f = await fixture(); try {
    const session = await f.create(); const original = await f.controller.call('draft/prepare', { sessionId: session.id, text: DEMO_INPUT, demo: true }) as DraftPreview;
    await f.toggle(false); await assert.rejects(f.controller.call('draft/submit', { sessionId: session.id, id: original.id, sourceHash: original.sourceHash }));
    const raw = await f.controller.call('draft/prepare', { sessionId: session.id, text: '中文原稿' }) as DraftPreview;
    await f.toggle(true); await assert.rejects(f.controller.call('draft/submit', { sessionId: session.id, id: raw.id, sourceHash: raw.sourceHash }));
    assert.equal(f.store.snapshot().sessions[0]!.messages.length, 0);
  } finally { await f.close(); }
});

test('settings edits revoke ready previews even when no network request is running', async () => {
  const f = await fixture(); try {
    const session = await f.create(); const preview = await f.controller.call('draft/prepare', { sessionId: session.id, text: DEMO_INPUT, demo: true }) as DraftPreview;
    const state = f.store.snapshot(); await f.controller.call('translation/settings', { ...settings(state), translateFinal: false });
    await assert.rejects(f.controller.call('draft/submit', { sessionId: session.id, id: preview.id, sourceHash: preview.sourceHash }));
  } finally { await f.close(); }
});

test('saved setup can discover models without granting text upload consent', async () => {
  let calls = 0;
  const f = await fixture(async (url, init) => {
    calls++; assert.equal(String(url), 'https://translator.example/v1/models');
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    return Response.json({ data: [{ id: 'fixture-model' }] });
  });
  try {
    await f.configure();
    const state = f.store.snapshot();
    await f.controller.call('translation/settings', { ...settings(state), profile: { ...state.translation, consent: false, model: '' } });
    assert.deepEqual(await f.controller.call('translation/models'), { models: ['fixture-model'], source: 'https://translator.example/v1' });
    const saved = f.store.snapshot();
    assert.equal(saved.translation.consent, false);
    await f.controller.call('translation/settings', { ...settings(saved), profile: { ...saved.translation, model: 'fixture-model' } });
    const session = await f.create();
    await assert.rejects(f.controller.call('draft/prepare', { sessionId: session.id, text: '不应外发的正文' }), /外发/);
    assert.equal(calls, 1); assert.equal(f.store.snapshot().sessions[0]!.messages.length, 0);
  } finally { await f.close(); }
});

test('model discovery uses the injected adapter and rejects late results after disabling', async () => {
  const arrived = deferred<void>(), response = deferred<Response>(); let abort: AbortSignal | undefined, calls = 0;
  const f = await fixture(async (url, init) => { calls++; assert.equal(String(url), 'https://translator.example/v1/models'); abort = init?.signal ?? undefined; arrived.resolve(); return response.promise; });
  try {
    await f.configure(); const pending = f.controller.call('translation/models'); const rejected = assert.rejects(pending); await arrived.promise;
    await f.toggle(false); assert.equal(abort?.aborted, true); response.resolve(Response.json({ data: [{ id: 'late-model' }] })); await rejected; assert.equal(calls, 1);
  } finally { response.resolve(Response.json({ data: [] })); await f.close(); }
});

test('queued translations cannot start after disable and in-flight input cannot become a preview', async () => {
  const arrived = deferred<void>(), response = deferred<Response>(); let calls = 0;
  const f = await fixture(async () => { calls++; if (calls === 2) arrived.resolve(); return response.promise; });
  try {
    await f.configure(); const sessions = await Promise.all([f.create(), f.create(), f.create()]);
    const pending = sessions.map(session => assert.rejects(f.controller.call('draft/prepare', { sessionId: session.id, text: '等待翻译' })));
    await arrived.promise; await f.toggle(false); response.resolve(Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Translated' } }] }));
    await Promise.all(pending); assert.equal(calls, 2); assert.ok(f.store.snapshot().sessions.every(session => session.messages.length === 0));
  } finally { response.resolve(Response.json({})); await f.close(); }
});

test('disabling an output retry preserves history and prevents late overwrites', async () => {
  const arrived = deferred<void>(), response = deferred<Response>(); const f = await fixture(async () => { arrived.resolve(); return response.promise; });
  try {
    await f.configure(); const session = await f.create();
    await f.store.update(state => state.sessions[0]!.messages.push({ id: 'answer', role: 'assistant', original: 'Original output.', translation: '之前的中文译文', translationSource: 'previous service', translationStatus: 'complete', demo: false, timestamp: 'fixture' }));
    const pending = f.controller.call('message/retranslate', { sessionId: session.id, messageId: 'answer' }); await arrived.promise; await f.toggle(false);
    response.resolve(Response.json({ choices: [{ finish_reason: 'stop', message: { content: '迟到译文' } }] })); await pending;
    const answer = f.store.snapshot().sessions[0]!.messages[0]!; assert.equal(answer.original, 'Original output.'); assert.equal(answer.translation, '之前的中文译文'); assert.equal(answer.translationStatus, 'off'); assert.equal(answer.translationError, undefined);
  } finally { response.resolve(Response.json({})); await f.close(); }
});

test('disable is independent of invalid setup and leaves profile, preferences and ciphertext intact', async () => {
  const f = await fixture(); try {
    await f.configure(); const before = f.store.snapshot(); const bytes = await readFile(path.join(f.dir, 'translation-key.bin'));
    await f.toggle(false); const disabled = f.store.snapshot(); assert.deepEqual(disabled.translation, before.translation); assert.equal(disabled.translateInput, before.translateInput); assert.deepEqual(await readFile(path.join(f.dir, 'translation-key.bin')), bytes);
    await f.store.update(state => { state.translation.model = ''; }); await f.toggle(true); assert.equal(f.store.snapshot().plugins?.translation?.enabled, true);
  } finally { await f.close(); }
});

test('save reasoning is requested configuration; legacy verification and malformed model IDs remain rejected', () => {
  const base = initialState().translation;
  const profile = translationProfile({ ...base, baseUrl: 'https://translator.example/v1/responses', model: 'fixture', reasoning: { mode: 'effort', effort: 'high', confirmed: true }, verifiedEfforts: ['ultra'], key: 'never-persist' });
  assert.equal(profile.baseUrl, 'https://translator.example/v1'); assert.equal(profile.reasoning?.effort, 'high'); assert.deepEqual(profile.verifiedEfforts, []); assert.ok(!JSON.stringify(profile).includes('never-persist'));
  assert.throws(() => translationProfile({ ...base, model: 'invalid model name' }), /模型 ID/);
  assert.throws(() => translationProfile({ ...base, model: 'fixture', reasoning: { mode: 'effort', effort: 'high' } }), /确认/);
});

test('native execution gate still applies when translation is disabled', async () => {
  const f = await fixture(); try {
    await f.toggle(false); await f.store.update(state => state.hosts.push({ id: 'h', name: 'Fixture', hostname: 'fixture.example', port: 22, username: 'member', role: 'workspace', identityFile: path.join(f.dir, 'unused-key'), knownHostsFile: path.join(f.dir, 'known_hosts'), ownerId: 'local-owner', workspaceGeneration: 'fixture' }));
    const session = await f.controller.call('session/create', { runtime: 'claude', hostId: 'h' }) as Session;
    await assert.rejects(f.controller.call('draft/prepare', { sessionId: session.id, text: 'Do not bypass native verification.' }), /Claude SSH 工具连接尚未就绪|H 原生桥/);
  } finally { await f.close(); }
});

test('partial input previews retain the source, reject automatic send and dispatch once on explicit confirmation',async()=>{
 const f=await fixture(async()=>Response.json({choices:[{finish_reason:'length',message:{content:'Partial translation'}}]}));
 try{await f.configure();await f.controller.call('translation/auto-submit',{enabled:true});const session=await f.create();const preview=await f.controller.call('draft/prepare',{sessionId:session.id,text:'完整原稿'}) as DraftPreview;
 assert.equal(preview.incomplete,true);assert.equal(preview.original,'完整原稿');assert.equal(preview.translated,'Partial translation');const payload={sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash};await assert.rejects(f.controller.call('draft/submit',{...payload,automatic:true}),/部分译文/);assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);await f.controller.call('draft/submit',{...payload,automatic:false});await assert.rejects(f.controller.call('draft/submit',{...payload,automatic:false}));assert.equal(f.store.snapshot().sessions[0]!.messages.filter(m=>m.role==='user').length,1);assert.equal(f.store.snapshot().autoSubmitTranslated,true);
 }finally{await f.close();}
});
