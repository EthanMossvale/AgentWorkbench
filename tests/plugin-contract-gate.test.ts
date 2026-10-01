import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('public plugin SDK and host method baseline require explicit compatibility review',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const result=spawnSync(process.execPath,['scripts/check-plugin-contracts.mjs'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stdout+result.stderr);
});
