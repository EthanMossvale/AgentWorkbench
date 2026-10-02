import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The executable probe is shared with standalone baseline/rollback verification.
import {probeRecoveryPresentation} from '../scripts/lib/recovery-presentation-probe.mjs';

test('production guardian presents once, respects dismissal, and permits explicit reopening',async()=>{
  const result=await probeRecoveryPresentation();
  for(const kind of ['host','renderer','startup'])assert.deepEqual(result[kind],{initial:1,dismissed:1,manual:2,continued:2,visible:false,windows:1},kind);
  assert.deepEqual(result.snapshots,{initial:1,dismissed:1,visible:false});
  assert.deepEqual(result.explicit,{automaticAfterExplicit:1,reopened:2,visible:true});
  assert.deepEqual(result.hidden,{shows:0,visible:false});
  assert.deepEqual(result.newProcess,{shows:1});
});
