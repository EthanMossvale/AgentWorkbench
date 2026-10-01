import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSidebarLayout, sidebarInitial, sidebarMaxWidth, sidebarWidth } from '../apps/desktop/renderer/sidebar-layout';

test('compact labels preserve one readable Unicode grapheme and uppercase Latin initials', () => {
  for (const [title, expected] of [
    ['  chapter two', 'C'], ['—— 春日来信', '春'], ['📚 Écriture', 'É'],
    ['e\u0301bauche', 'E\u0301'], ['𠮷野的札记', '𠮷'], ['ßeta', 'S'], ['2026 计划', '2'], [' ✨ ', '·'],
  ]) assert.equal(sidebarInitial(title!), expected);
});

test('sidebar preferences tolerate missing, damaged and incorrectly typed persisted values', () => {
  for (const value of [null, '{bad', 'null', '42', '[]', '{"compact":"true","width":"500"}']) {
    assert.deepEqual(parseSidebarLayout(value), { compact: false, width: 240 });
  }
  assert.deepEqual(parseSidebarLayout('{"compact":true,"width":382}'), { compact: true, width: 382 });
  assert.equal(parseSidebarLayout('{"width":-20}').width, 240);
  assert.equal(parseSidebarLayout('{"width":90000}').width, 600);
});

test('resizing preserves the original minimum and leaves a usable reading pane', () => {
  for (const viewport of [860, 1000, 1440, 2560]) {
    assert.equal(sidebarWidth(-1000, viewport), 240);
    assert.ok(sidebarWidth(10000, viewport) <= viewport - 520);
    assert.ok(sidebarWidth(10000, viewport) <= viewport / 2);
    assert.ok(sidebarMaxWidth(viewport) <= 600);
  }
  assert.equal(sidebarWidth(480, 860), 340);
  assert.equal(sidebarWidth(480, 1440), 480);
  assert.equal(sidebarWidth(Number.NaN, 1440), 240);
});
