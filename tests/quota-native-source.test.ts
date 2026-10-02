import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {quotaNativeSource} from '../packages/workspace-control/quota-native-source';

function fixture(body:string) {
  const code=String.raw`
import sys,types,base64
sys.modules.setdefault('pwd',types.ModuleType('pwd'))
namespace={'__name__':'quota_fixture'}
exec(compile(base64.b64decode(sys.argv[1]),'quota_native.py','exec'),namespace)
windows=namespace['quota_windows']
sys.path.insert(0,sys.argv[2])
from quota_accounting import QuotaAccounting
at=1800000000
weekly={'windowDurationMins':10080,'usedPercent':6,'resetsAt':at+604800}
`+body;
  const result=spawnSync('python',['-B','-c',code,Buffer.from(quotaNativeSource).toString('base64'),path.resolve('services/vps-workspace-control')],{encoding:'utf8',timeout:8000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);
}

test('idle Claude five-hour quota without a reset does not reject weekly calibration or completion',()=>fixture(String.raw`
members={'one':{'id':'one','name':'One','status':'active','allowedAccountIds':['account'],'accountQuotas':{'account':{'weeklyPercent':100}}}}
ledger=QuotaAccounting({},members)
params={'accountId':'account','accountGeneration':'g'}
value={'pools':{'claude':{'primary':{'windowDurationMins':300,'usedPercent':0},'secondary':weekly}}}
observed=windows(value,at)
assert len(observed)==1 and observed[0]['window']=='weekly'
ledger.observe(dict(params,windows=observed),at)
ledger.observe(dict(params,workspaceId='one',scope='turn',phase='begin'),at)
weekly['usedPercent']=7
view=ledger.observe(dict(params,workspaceId='one',scope='turn',phase='finish',totalTokens=1000,lastTokens=1000,windows=windows(value,at+1)),at+1)
assert view['windows'][0]['estimatedTotalTokens']==100000
assert view['tokenTotals']['one']==1000
assert not next(iter(ledger.state.values()))['active']
`));

test('native quota normalization preserves Codex windows and excludes unknown or invalid clocks',()=>fixture(String.raw`
primary={'windowDurationMins':300,'usedPercent':10,'resetsAt':at+18000}
value={'pools':{'codex':{'primary':primary,'secondary':weekly}}}
assert [w['window'] for w in windows(value,at)]==['fiveHour','weekly']
for invalid in (None,True,'1800001000',float('nan'),float('inf'),at,at-1,1e13):
    primary['resetsAt']=invalid
    assert len(windows(value,at))==1
primary['resetsAt']=at+18000
for invalid in (None,True,'0',-1,101,float('nan'),float('inf')):
    primary['usedPercent']=invalid
    assert len(windows(value,at))==1
assert windows({'pools':{}},at)==[]
`));
