import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('native model-activity expiry excludes heartbeats and includes interrupted Codex and Claude sessions',()=>{
  const result=spawnSync('python',['scripts/test-session-idle.py'],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
});
