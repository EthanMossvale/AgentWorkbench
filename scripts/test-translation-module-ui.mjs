import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

// Run after a normal build and only while holding the shared Electron QA slot.
// This launches an isolated application profile, uses an explicitly synthetic key,
// and calls only a loopback fixture server. No SSH, real provider, screenshot,
// user state, existing app process, or existing credential is involved.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.resolve(process.env.AGENT_WORKBENCH_TEST_APP ?? root);
const output = path.join(root, 'build/qa');
const dataDir = path.join(output, `translation-module-synthetic-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: dataDir, AGENT_WORKBENCH_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const fixtureKey = 'synthetic-translation-ui-fixture-not-a-real-credential';
const checks = [];
const errors = [];
const requests = [];
const deferred = [];
let holdNextTranslation = false;
let app;
let page;
let failure;
let electronVersion;

const respond = (response, status, value) => {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
const server = createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const chunk of request) { raw += chunk; if (raw.length > 200000) throw new Error('Fixture body too large'); }
    const body = raw ? JSON.parse(raw) : undefined;
    const authorized = request.headers.authorization === `Bearer ${fixtureKey}` || request.headers['x-api-key'] === fixtureKey;
    const observed = { method: request.method, path: request.url, authorized, body };
    requests.push(observed);
    if (!authorized) { respond(response, 401, { error: 'Synthetic fixture authentication failed' }); return; }
    if (request.method === 'GET' && request.url?.split('?')[0] === '/v1/models') {
      respond(response, 200, { data: [{ id: 'fixture-basic' }, { id: 'fixture-reasoning' }, { id: 'fixture-basic' }, { id: null }] });
      return;
    }
    if (request.method !== 'POST' || !['/v1/chat/completions', '/v1/responses', '/v1/messages'].includes(request.url)) {
      respond(response, 404, { error: 'Unknown synthetic fixture route' }); return;
    }
    const source = body.input ?? body.messages?.find(item => item.role === 'user')?.content;
    if (typeof source !== 'string') { respond(response, 400, { error: 'Missing synthetic input' }); return; }
    // Keep protected tokens and paragraph structure intact; this is protocol QA, not translation-quality evidence.
    const translated = `Synthetic translation: ${source}`;
    const result = request.url === '/v1/responses'
      ? { status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: translated }] }] }
      : request.url === '/v1/messages'
        ? { stop_reason: 'end_turn', content: [{ type: 'text', text: translated }] }
        : { choices: [{ finish_reason: 'stop', message: { content: translated } }] };
    if (holdNextTranslation) {
      holdNextTranslation = false;
      const held = { released: false, aborted: false, release: () => { held.released = true; respond(response, 200, result); } };
      response.once('close', () => { if (!held.released) held.aborted = true; });
      deferred.push(held);
    } else respond(response, 200, result);
  } catch {
    respond(response, 500, { error: 'Synthetic fixture failed' });
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
assert.ok(address && typeof address !== 'string');
const baseUrl = `http://127.0.0.1:${address.port}/v1`;

const check = async (name, run) => {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; }
};
const waitUntil = async (predicate, description) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(25); }
  throw new Error(`Timed out waiting for ${description}`);
};
const call = (method, payload = {}) => page.evaluate(({ method, payload }) => window.workbench.call(method, payload), { method, payload });
const state = () => call('state/get');
const posts = () => requests.filter(request => request.method === 'POST');
const launch = async (sessionId) => {
  app = await electron.launch({ executablePath: electronPath, args: [appRoot, ...(sessionId ? [`agent-workbench://threads/${sessionId}`] : [])], cwd: root, env, timeout: 45000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.workbench);
  await page.getByTestId('composer-input').waitFor();
  electronVersion = await app.evaluate(() => process.versions.electron);
};
const openSettings = async () => { await openWorkbenchSettings(page); await page.getByLabel('启用双语工作流',{exact:true}).waitFor(); };
const openAdvanced = async () => { const panel = page.getByTestId('translation-advanced'); if (!await panel.evaluate(element => element.open)) await panel.locator('summary').click(); };
const workspace = async () => { await navigateWorkbench(page,'workspace'); await page.getByTestId('composer-input').waitFor(); };
const toggleModule = async (enabled) => {
  await page.getByLabel('启用双语工作流',{exact:true}).setChecked(enabled);
  await waitUntil(async () => (await state()).plugins.translation.enabled === enabled, `translation module ${enabled ? 'enabled' : 'disabled'}`);
};
const saveSettings = async (predicate) => { await page.getByTestId('save-translation').click(); await waitUntil(async () => predicate(await state()), 'translation settings persisted'); };
const prepareFixture = async (source) => {
  await workspace();
  await page.getByTestId('composer-input').fill(source);
  await page.getByTestId('prepare-draft').click();
  await page.getByTestId('draft-preview').waitFor();
  assert.equal(await page.getByTestId('draft-chinese-preview').innerText(), source);
  assert.match(await page.getByTestId('draft-submission-preview').innerText(), /^Synthetic translation:/);
};
const closePreview = async () => { await page.getByTestId('draft-edit').click(); await page.getByTestId('draft-preview').waitFor({ state: 'hidden' }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };

try {
  await launch();
  const rawInput = '关闭翻译时保留原文、换行与末尾空格。\n第二行  ';
  let sessionId;
  let savedHistory;

  await check('translation defaults on and switching it off ignores an unfinished provider form', async () => {
    const initial = await state();
    assert.equal(initial.plugins.translation.enabled, true);
    assert.equal(initial.translation.model, '');
    assert.equal(initial.translation.hasKey, false);
    await page.getByTestId('composer-input').fill(rawInput);
    await openSettings();
    assert.equal(await page.getByLabel('启用双语工作流',{exact:true}).isChecked(), true);
    assert.equal(await page.getByTestId('translation-reasoning-mode').isVisible(), false);
    assert.equal(await page.locator('.translation-heading').count(), 0);
    await page.getByTestId('translation-endpoint').fill('');
    await toggleModule(false);
    assert.equal(await page.getByTestId('translation-load-models').isDisabled(), true);
    assert.equal(await page.getByTestId('translation-protocol-candidates').isDisabled(), true);
    assert.equal((await state()).translation.model, '');
    assert.equal(requests.length, 0);
  });

  await check('composer quick translation is independent and appears only with both settings enabled', async () => {
    await workspace(); const toggle = page.getByTestId('translation-quick-toggle');
    assert.equal(await toggle.count(), 0);
    await openSettings(); await toggleModule(true); await workspace();
    await toggle.click();
    await waitUntil(async () => (await state()).translationQuickToggle.paused && !(await toggle.isChecked()), 'global quick pause');
    assert.equal((await state()).plugins.translation.enabled, true);
    await openSettings(); assert.equal(await page.getByLabel('启用双语工作流', {exact:true}).isChecked(), true);
    await page.getByLabel('显示临时翻译开关', {exact:true}).click();
    await waitUntil(async () => !(await state()).translationQuickToggle.show, 'hide quick control');
    await workspace(); assert.equal(await toggle.count(), 0); assert.equal(await page.getByTestId('auto-submit-toggle').isVisible(), true);
    await openSettings(); await page.getByLabel('显示临时翻译开关', {exact:true}).click();
    await waitUntil(async () => (await state()).translationQuickToggle.show, 'show quick control');
    await workspace(); assert.equal(await toggle.isChecked(), false); await toggle.click();
    await waitUntil(async () => !(await state()).translationQuickToggle.paused && await toggle.isChecked(), 'resume quick translation');
    assert.equal(await toggle.locator('..').innerText(), '关闭翻译');
    await openSettings(); await toggleModule(false); assert.equal(requests.length, 0);
  });

  await check('disabled module preserves drafts across Settings and hides translation-only controls', async () => {
    await workspace();
    assert.equal(await page.getByTestId('composer-input').inputValue(), rawInput);
    assert.equal(await page.getByTestId('translation-quick-toggle').count(), 0);
    assert.equal(await page.getByTestId('auto-submit-toggle').count(), 0);
    assert.equal(await page.getByRole('button', { name: '本次原文', exact: true }).count(), 0);
    assert.equal(await page.getByTestId('translation-chinese').count(), 0);
    assert.equal(await page.getByTestId('prepare-draft').getAttribute('aria-label'), '发送原文');
    await page.getByTestId('composer-input').press('Shift+Enter');
    assert.equal((await state()).sessions.length, 0);
    await page.getByTestId('composer-input').fill(rawInput);
    await page.getByTestId('composer-input').evaluate(element => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    assert.equal((await state()).sessions.length, 0);
  });

  await check('raw Send submits once with exact text and no translation preview, key, or model call', async () => {
    await page.getByTestId('composer-input').evaluate(element => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await waitUntil(async () => { const current = await state(); return current.sessions.length === 1 && current.sessions[0].status === 'idle' && current.sessions[0].messages.length === 2; }, 'one completed raw demo turn');
    const current = await state(); sessionId = current.sessions[0].id;
    assert.equal(current.sessions[0].messages[0].original, rawInput);
    assert.equal(current.sessions[0].messages[0].submitted, rawInput);
    assert.equal(current.sessions[0].messages[1].translation, undefined);
    assert.equal(current.sessions[0].messages[1].translationStatus, 'off');
    assert.equal(await page.getByTestId('draft-preview').count(), 0);
    assert.equal(await page.getByTestId('composer-input').inputValue(), '');
    assert.equal((await call('translation/usage')).calls, 0);
    assert.equal(requests.length, 0);
    assert.equal(await page.getByTestId('toggle-translation-pane').count(), 0);
  });

  await check('re-enabling restores explicit preview and saved bilingual history', async () => {
    await openSettings(); await toggleModule(true); await workspace();
    await page.getByTestId('composer-input').fill('Synthetic preview after enabling translation.');
    await page.getByTestId('prepare-draft').click();
    await page.getByTestId('draft-preview').waitFor();
    assert.equal((await state()).sessions[0].messages.length, 2);
    await closePreview();
    // The welcome-only sample loader is absent once a conversation has history.
    // Seed fixed bilingual history through the same public draft gate instead.
    const sample = await call('demo.sample/get');
    const preview = await call('draft/prepare', {sessionId, text:sample.input, demo:true});
    await call('draft/submit', {sessionId, id:preview.id, sourceHash:preview.sourceHash});
    await waitUntil(async () => { const session = (await state()).sessions[0]; return session.status === 'idle' && session.messages.length === 4; }, 'offline translated history');
    savedHistory = JSON.parse(JSON.stringify((await state()).sessions[0].messages));
    assert.ok(savedHistory[3].translation);
    assert.equal(requests.length, 0);
  });

  await check('restart remembers the quick pause while the translation plugin remains enabled', async () => {
    await call('translation/quick-toggle', { paused: true });
    await app.close(); app = undefined; await launch(sessionId);
    assert.equal((await state()).plugins.translation.enabled, true);
    assert.deepEqual((await state()).sessions[0].messages, savedHistory);
    assert.deepEqual((await state()).translationQuickToggle, { show: true, paused: true });
    assert.equal(await page.getByTestId('translation-quick-toggle').isChecked(), false);
    const raw = await call('draft/prepare', { sessionId, text: 'Paused translation keeps this exact source.' });
    assert.equal(raw.moduleDisabled, true); assert.equal(raw.original, raw.translated); await call('draft/cancel', { id: raw.id });
    await page.getByTestId('translation-quick-toggle').click();
    await waitUntil(async () => !(await state()).translationQuickToggle.paused && await page.getByTestId('translation-quick-toggle').isChecked(), 'resume after restart');
    assert.equal(requests.length, 0);
  });

  await check('module changes invalidate an open preview while preserving the original draft', async () => {
    await page.getByTestId('composer-input').fill('Synthetic draft retained across translation changes.');
    await page.getByTestId('prepare-draft').click();
    await page.getByTestId('draft-preview').waitFor();
    const source = await page.getByTestId('draft-chinese-preview').innerText();
    assert.equal(await page.getByTestId('draft-preview').locator('textarea,input').count(), 0);
    await call('plugins/set-enabled', { id: 'translation', enabled: false });
    await page.getByTestId('draft-preview').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('composer-input').inputValue(), source);
    assert.deepEqual(JSON.parse(JSON.stringify((await state()).sessions[0].messages)), JSON.parse(JSON.stringify(savedHistory)));
    assert.equal(await page.getByTestId('translation-chinese').count(), 0);
  });

  await check('disabled history opens only explicitly and offers no retranslation network action', async () => {
    await page.getByTestId(`source-block-${savedHistory[0].id}-0`).click();
    assert.equal(await page.getByTestId('translation-chinese').count(), 0);
    await page.getByTestId('toggle-translation-pane').click();
    await page.getByTestId('translation-pane').waitFor();
    assert.ok((await page.getByTestId('translation-pane').innerText()).replace(/\s+/g,' ').includes(savedHistory[3].translation.replace(/\s+/g,' ')));
    const retries = page.getByTestId('translation-pane').getByRole('button', { name: '仅重译', exact: true });
    assert.ok(await retries.count());
    for (const retry of await retries.all()) assert.equal(await retry.isDisabled(), true);
    assert.equal(requests.length, 0);
  });

  await check('first setup saves and reads the catalog without requiring or granting text consent', async () => {
    await openSettings(); await toggleModule(true);
    await page.getByTestId('translation-endpoint').fill(`${baseUrl}/chat/completions`);
    await page.getByTestId('translation-protocol').selectOption('chat-completions');
    await page.getByTestId('translation-key').fill(fixtureKey);
    await page.getByTestId('translation-model').fill('');
    assert.equal(await page.getByTestId('translation-consent').isChecked(), false);
    assert.equal(await page.getByTestId('translation-load-models').isEnabled(), true);
    await page.getByTestId('translation-load-models').click();
    await page.getByTestId('translation-model-list').waitFor();
    assert.deepEqual(await page.getByTestId('translation-model-list').locator('option:not([disabled])').allTextContents(), ['fixture-basic', 'fixture-reasoning']);
    assert.equal((await state()).translation.baseUrl, baseUrl);
    assert.equal((await state()).translation.model, '');
    assert.equal((await state()).translation.hasKey, true);
    assert.equal((await state()).translation.consent, false);
    assert.equal(await page.getByTestId('translation-key').inputValue(), '');
    assert.equal(requests.length, 1); assert.equal(requests[0].method, 'GET'); assert.equal(requests[0].authorized, true);
    assert.equal(requests[0].body, undefined);
    assert.equal(posts().length, 0);
    await page.getByTestId('translation-model-search').fill('reasoning');
    assert.equal(await page.getByTestId('translation-model-list').locator('option:not([disabled])').count(), 1);
    await page.getByTestId('translation-model-list').selectOption('fixture-reasoning');
    assert.equal(await page.getByTestId('translation-model').inputValue(), 'fixture-reasoning');
  });

  await check('chosen model and confirmed Chat Completions effort reach the actual synthetic HTTP request', async () => {
    await page.getByTestId('translation-consent').check();
    assert.equal(await page.getByTestId('translation-model-list').isVisible(), true);
    await openAdvanced();
    await page.getByTestId('translation-reasoning-mode').selectOption('effort');
    await page.getByTestId('translation-reasoning-effort').selectOption('high');
    await page.getByTestId('translation-reasoning-confirm').check();
    await page.getByTestId('translation-max-output-tokens').fill('2048');
    await saveSettings(current => current.translation.model === 'fixture-reasoning' && current.translation.reasoning?.effort === 'high' && current.translation.maxOutputTokens === 2048);
    await prepareFixture('用于合成 Chat 协议检查，不执行任何操作。');
    const last = posts().at(-1); assert.equal(last.path, '/v1/chat/completions');
    assert.equal(last.body.model, 'fixture-reasoning'); assert.equal(last.body.reasoning_effort, 'high');
    assert.equal(last.body.max_completion_tokens, 2048); assert.equal(last.authorized, true);
    assert.equal((await state()).sessions[0].messages.length, 4);
    await closePreview();
  });

  await check('Responses reasoning uses the selected protocol and preserves provider-default reset semantics', async () => {
    await openSettings(); await page.getByTestId('translation-protocol').selectOption('responses');
    await openAdvanced();
    assert.equal(await page.getByTestId('translation-reasoning-mode').inputValue(), 'default');
    await page.getByTestId('translation-reasoning-mode').selectOption('effort');
    await page.getByTestId('translation-reasoning-effort').selectOption('low');
    await page.getByTestId('translation-reasoning-confirm').check();
    await saveSettings(current => current.translation.protocol === 'responses' && current.translation.reasoning?.effort === 'low');
    await prepareFixture('用于合成 Responses 协议检查。');
    const last = posts().at(-1); assert.equal(last.path, '/v1/responses');
    assert.deepEqual(last.body.reasoning, { effort: 'low' }); assert.equal(last.body.store, false);
    assert.equal(last.body.reasoning_effort, undefined); assert.equal(last.body.max_output_tokens, 2048);
    await closePreview();
  });

  await check('Anthropic budget control maps to the independent translation request', async () => {
    await openSettings(); await page.getByTestId('translation-protocol').selectOption('anthropic-messages');
    await openAdvanced();
    assert.equal(await page.getByTestId('translation-reasoning-mode').inputValue(), 'default');
    await page.getByTestId('translation-reasoning-mode').selectOption('budget');
    await page.getByTestId('translation-reasoning-budget').fill('1024');
    await page.getByTestId('translation-max-output-tokens').fill('3072');
    await page.getByTestId('translation-reasoning-confirm').check();
    await saveSettings(current => current.translation.protocol === 'anthropic-messages' && current.translation.reasoning?.budgetTokens === 1024 && current.translation.maxOutputTokens === 3072);
    await prepareFixture('用于合成 Anthropic 协议检查。');
    const last = posts().at(-1); assert.equal(last.path, '/v1/messages');
    assert.deepEqual(last.body.thinking, { type: 'enabled', budget_tokens: 1024 });
    assert.equal(last.body.max_tokens, 3072); assert.equal(last.authorized, true);
    await closePreview();
  });

  await check('temporary pause during an auto-submit preparation cancels the result without sending or losing the draft', async () => {
    await call('translation/auto-submit', { enabled: true });
    await waitUntil(async () => (await state()).autoSubmitTranslated===true, 'auto-submit reflected in composer');
    const cancelledSource = '被取消的合成上游响应不允许触发任务。';
    await page.getByTestId('composer-input').fill(cancelledSource);
    holdNextTranslation = true;
    await page.getByTestId('prepare-draft').click();
    await waitUntil(() => deferred.length === 1, 'held upstream translation');
    await page.getByTestId('translation-quick-toggle').click();
    await waitUntil(async () => (await state()).translationQuickToggle.paused, 'pause in-flight translation');
    assert.equal((await state()).plugins.translation.enabled, true);
    assert.equal(await page.getByTestId('composer-input').inputValue(), cancelledSource);
    await page.getByTestId('draft-stop').waitFor({ state: 'hidden' });
    deferred[0].release(); await pause(200);
    assert.deepEqual((await state()).sessions[0].messages, savedHistory);
    assert.equal(await page.getByTestId('draft-preview').count(), 0);
    await page.getByTestId('translation-quick-toggle').click();
    await waitUntil(async () => !(await state()).translationQuickToggle.paused && await page.getByTestId('translation-quick-toggle').isChecked(), 'resume cancelled translation');
    assert.deepEqual((await state()).sessions[0].messages, savedHistory);
    assert.equal(await page.getByTestId('composer-input').inputValue(), cancelledSource);
    assert.equal(await page.getByTestId('draft-preview').count(), 0);
    await openSettings(); await toggleModule(false);
  });

  await check('restart persists the disabled module, provider choice and history without echoing the fixture key', async () => {
    const prior = await state(); const countBeforeRestart = requests.length;
    await app.close(); app = undefined;
    const diskText = await readFile(path.join(dataDir, 'state.json'), 'utf8');
    assert.equal(diskText.includes(fixtureKey), false);
    const disk = JSON.parse(diskText); assert.equal(disk.plugins.translation.enabled, false);
    assert.equal(disk.translation.model, 'fixture-reasoning');
    await launch(sessionId);
    const restored = await state(); assert.equal(restored.plugins.translation.enabled, false);
    assert.deepEqual(restored.sessions[0].messages, JSON.parse(JSON.stringify(savedHistory)));
    assert.deepEqual(restored.translation.reasoning, prior.translation.reasoning);
    assert.equal(await page.getByTestId('translation-quick-toggle').count(), 0);
    // The earlier explicit history-pane choice is a persisted UI preference.
    await page.getByTestId('translation-chinese').waitFor();
    const anotherRaw = '重启后仍只发送这段原文。';
    await page.getByTestId('composer-input').fill(anotherRaw); await page.getByTestId('prepare-draft').click();
    await waitUntil(async () => { const session = (await state()).sessions[0]; return session.status === 'idle' && session.messages.length === 6; }, 'raw turn after restart');
    assert.equal((await state()).sessions[0].messages[4].submitted, anotherRaw);
    assert.equal(requests.length, countBeforeRestart);
    await openSettings(); assert.equal(await page.getByTestId('translation-key').inputValue(), '');
    assert.equal(await page.getByTestId('translation-model').inputValue(), 'fixture-reasoning');
  });

  await check('no renderer exceptions or unexpected fixture routes', async () => {
    assert.deepEqual(errors, []);
    assert.equal(requests.every(request => request.authorized), true);
    assert.equal(requests.every(request => ['/v1/models', '/v1/chat/completions', '/v1/responses', '/v1/messages'].includes(request.path?.split('?')[0])), true);
  });
} catch (error) {
  failure = error;
} finally {
  for (const held of deferred) held.release();
  if (app) await app.close().catch(error => { failure ??= error; });
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, 'translation-module-ui-report.json'), JSON.stringify({
    timestamp: new Date().toISOString(), electron: electronVersion, dataDir, screenshots: false,
    scope: 'Isolated Electron profile; synthetic loopback translation HTTP only; no SSH, real provider or existing credentials.',
    checks, errors, fixtureRequests: requests.map(({ method, path: route, authorized }) => ({ method, path: route, authorized })),
    cancelledResponseAborted: deferred.some(item => item.aborted), failure: failure?.message,
  }, null, 2));
}
if (failure) throw failure;
console.log(`Translation module UI QA: ${checks.length} checks passed; ${output}`);
