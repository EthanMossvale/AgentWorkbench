import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppState, DraftPreview } from '../packages/contracts';
import { preparedDraftAction, translationFlowPolicy } from '../apps/desktop/renderer/translation-flow';

const settings = (): Pick<AppState, 'translation' | 'translateInput' | 'plugins'> => ({
  translateInput: true,
  translation: { id: 'translator', name: 'Translator', baseUrl: '', protocol: 'chat-completions', model: '', verifiedEfforts: [], consent: false, maxCharacters: 10000, maxCalls: 1, timeoutMs: 10000 },
});
const preview = (extra: Partial<DraftPreview> = {}): DraftPreview => ({
  id: 'draft', revision: 1, original: '保留中文\n以及空格  ', translated: 'Keep the original.', sourceHash: 'source', demo: false, bypass: false, ...extra,
});
const decide = (requested: ReturnType<typeof translationFlowPolicy>, current = requested, item = preview(), autoSubmit = false, bypass = false) =>
  preparedDraftAction({ requested, current, preview: item, source: '保留中文\n以及空格  ', autoSubmit, bypass });

test('legacy settings enable translation; disabled module sends exact originals without translation auto-submit permission', () => {
  const config = settings(); const enabled = translationFlowPolicy(config);
  assert.equal(enabled.enabled, true); assert.equal(decide(enabled), 'review');
  assert.equal(decide(enabled, enabled, preview(), true), 'submit-translated');
  assert.equal(decide(enabled, enabled, preview({ bypass: true }), true, true), 'review');
  const disabled = translationFlowPolicy({ ...config, plugins: { translation: { enabled: false } } });
  const raw = preview({ moduleDisabled: true, bypass: true, translated: '保留中文\n以及空格  ' });
  assert.equal(disabled.enabled, false); assert.equal(decide(disabled, disabled, raw), 'submit-original');
  assert.equal(decide(disabled, disabled, raw, true), 'submit-original');
});

test('module toggles and changed provider settings discard an in-flight prepare', () => {
  const config = settings(); const enabled = translationFlowPolicy(config);
  const disabled = translationFlowPolicy({ ...config, plugins: { translation: { enabled: false } } });
  const raw = preview({ moduleDisabled: true, bypass: true, translated: '保留中文\n以及空格  ' });
  assert.equal(decide(enabled, disabled, preview(), true), 'discard');
  assert.equal(decide(disabled, enabled, raw), 'discard');
  for (const change of [{ model: 'another-model' }, { baseUrl: 'https://provider.invalid' }, { effort: 'high' }, { consent: true }]) {
    assert.equal(decide(enabled, translationFlowPolicy({ ...config, translation: { ...config.translation, ...change } }), preview(), true), 'discard');
  }
  assert.equal(decide(enabled, translationFlowPolicy({ ...config, translateInput: false }), preview(), true), 'discard');
});

test('disabled send rejects stale translated previews and mutated originals', () => {
  const enabled = translationFlowPolicy(settings());
  const disabled = translationFlowPolicy({ ...settings(), plugins: { translation: { enabled: false } } });
  const raw = preview({ moduleDisabled: true, bypass: true, translated: '保留中文\n以及空格  ' });
  assert.equal(decide(disabled, disabled, preview(), true), 'discard');
  assert.equal(decide(disabled, disabled, { ...raw, moduleDisabled: undefined }), 'discard');
  assert.equal(decide(disabled, disabled, { ...raw, bypass: false }), 'discard');
  assert.equal(decide(disabled, disabled, { ...raw, translated: raw.original.trim() }), 'discard');
  assert.equal(decide(disabled, disabled, { ...raw, original: 'different source' }), 'discard');
  assert.equal(decide(enabled, enabled, raw, true), 'discard');
});

test('quick pause uses raw submission and changing either quick setting discards stale previews', () => {
  const config = settings(), enabled = translationFlowPolicy(config);
  const paused = translationFlowPolicy({ ...config, translationQuickToggle: { show: true, paused: true } });
  const hidden = translationFlowPolicy({ ...config, translationQuickToggle: { show: false, paused: true } });
  const raw = preview({ moduleDisabled: true, bypass: true, translated: '保留中文\n以及空格  ' });
  assert.equal(decide(paused, paused, raw), 'submit-original');
  assert.equal(decide(enabled, paused, preview(), true), 'discard');
  assert.equal(decide(paused, hidden, raw), 'discard');
  assert.equal(decide(hidden), 'review');
  assert.equal(decide(hidden, paused, preview(), true), 'discard');
});

test('normal retry cannot silently accept an original-only preview',()=>{
 const policy=translationFlowPolicy(settings());
 assert.equal(decide(policy,policy,preview({bypass:true}),true,false),'discard');
 assert.equal(decide(policy,policy,preview({bypass:true}),false,true),'review');
});
