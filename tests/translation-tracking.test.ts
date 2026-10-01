import test from 'node:test';
import assert from 'node:assert/strict';
import { translationPlacement, translationTrackingEnabled } from '../packages/translation/display';

test('paired tracking requires an unoccupied visible panel with both panes displayed',()=>{
  for(const layout of [undefined,'panel','inline'] as const)
    for(const occupied of [false,true])
      for(const child of [false,true])
        for(const visible of [false,true])
          for(const compact of [false,true])
            assert.equal(translationTrackingEnabled(translationPlacement(layout,occupied,child),visible,compact),layout!=='inline'&&!occupied&&!child&&visible&&!compact);
});

test('tracking returns when the reader closes or the saved layout returns to the panel',()=>{
  assert.equal(translationTrackingEnabled(translationPlacement('panel',false),true),true);
  assert.equal(translationTrackingEnabled(translationPlacement('panel',true),true),false);
  assert.equal(translationTrackingEnabled(translationPlacement('panel',false),true),true);
  assert.equal(translationTrackingEnabled(translationPlacement('inline',false),true),false);
  assert.equal(translationTrackingEnabled(translationPlacement('panel',false),true),true);
});
