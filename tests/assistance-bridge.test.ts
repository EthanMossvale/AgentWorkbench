import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CODEX_REMOTE_BRIDGE } from '../services/codex-bridge/remote';

test('remote native bridge is valid Python and projects only model controls through config/read',()=>{
  const python=String.raw`
import ast,json,sys
ast.parse(sys.stdin.read())
sys.path.insert(0,'services/vps-account-broker')
from runtime import CodexSessionFence
fence=CodexSessionFence({}, {}, lambda:None, lambda:None)
fence.before({'id':0,'method':'initialize'})
fence.after({'id':0,'result':{}})
fence.before({'id':1,'method':'config/read','params':{'includeLayers':True}})
result=fence.after({'id':1,'result':{'config':{'model':'native-model','model_reasoning_effort':'high','service_tier':'priority','developer_instructions':'hidden','api_key':'hidden'},'layers':['hidden']}})
assert result=={'id':1,'result':{'config':{'model':'native-model','model_reasoning_effort':'high','service_tier':'priority'}}}
print('remote config projection and native capacity inheritance verified')
`;
  const result=spawnSync('python',['-c',python],{input:CODEX_REMOTE_BRIDGE,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||String(result.error));
  assert.match(result.stdout,/verified/);
});
