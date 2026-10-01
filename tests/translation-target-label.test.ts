import test from 'node:test';
import assert from 'node:assert/strict';
import { translationTargetLabel } from '../apps/desktop/renderer/translation-target-label';

test('translation labels show an already-described model only once', () => {
  for (const name of ['deepseek-flash', 'gpt-example', 'Model · Variant']) {
    assert.equal(translationTargetLabel({ description: `Provider · ${name}`, name }), `Provider · ${name}`);
  }
  assert.equal(translationTargetLabel({ description: ' model ', name: ' model ' }), 'model');
});

test('translation labels preserve distinct aliases, native account context and exact model identity', () => {
  for (const [description, name, expected] of [
    ['Provider · model-id', 'My alias', 'Provider · model-id · My alias'],
    ['Account · 官方账号', 'Model', 'Account · 官方账号 · Model'],
    ['Provider · prefix-model', 'model', 'Provider · prefix-model · model'],
    ['Provider · model-pro', 'model', 'Provider · model-pro · model'],
    ['Provider · Model', 'model', 'Provider · Model · model'],
    ['Provider · model · detail', 'model', 'Provider · model · detail · model'],
    ['', 'model', 'model'],
    ['Provider · model', '', 'Provider · model'],
  ]) assert.equal(translationTargetLabel({ description: description!, name: name! }), expected);
});
