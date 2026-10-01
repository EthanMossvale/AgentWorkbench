import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {EXISTING_BROKER_CLIENT} from '../packages/remote-account-catalog/existing-broker';
const bootstrap=String.raw`
import sys,types,os,io,json,copy
from unittest.mock import patch
sys.modules['pwd']=types.SimpleNamespace(getpwuid=lambda uid:types.SimpleNamespace(pw_name='pc1' if uid else 'root'))
sys.modules['fcntl']=types.SimpleNamespace()
`;
function check(name:string,body:string){test(name,()=>{const result=spawnSync('python',['-B','-c',bootstrap+'\n'+EXISTING_BROKER_CLIENT+'\n'+String.raw`
os.geteuid=lambda:1000
raw={'revision':4,'selected':'one','accounts':[{'id':'one','email':'one@example.invalid','fingerprints':['a'*64],'devices':['pc1'],'access_token':'must-not-leak'},{'id':'two','email':'two@example.invalid','fingerprints':['b'*64],'devices':['pc2']}]}
queries=[]
def request_broker(query,target=None):
    queries.append(query)
    if query['method']=='select':raw['selected']=query['accountId'];raw['revision']+=1
    return copy.deepcopy(raw)
policy=lambda:{'revision':0,'workspaces':{}}
def error(code,fn):
    try:fn()
    except PublicError as e:assert str(e)==code,(str(e),code)
    else:raise AssertionError(code)
with patch('builtins.open',lambda *a,**kw:io.StringIO('ssh-ed25519 fixture-public-host-key')):
`+body.split('\n').map(line=>'    '+line).join('\n')],{encoding:'utf8',windowsHide:true,timeout:5000});assert.equal(result.status,0,result.stderr);});}
check('existing account catalog keeps the selected grant and returns only public metadata',String.raw`
value=existing_catalog({'protocol':1,'method':'catalog/list','params':{'uid':0,'username':'pc2'}})
assert value['workspaceId']=='pc1' and value['selectedAccountId']=='one'
assert [a['id'] for a in value['accounts']]==['one']
assert value['accounts'][0]['status']=='configured'
assert 'must-not-leak' not in json.dumps(value)
assert queries==[{'method':'list'}]
`);
check('retired catalog cannot change selection or workspace grants',String.raw`
for method in ['selection/set','existing/assign']:
    error('ACCOUNT_MIGRATION_REQUIRED',lambda:existing_catalog({'protocol':1,'method':method,'params':{}}))
assert all(q['method']=='list' for q in queries)
`);
check('existing compatibility never starts authorization or exposes broker token and quota methods',String.raw`
for method in ['tokens','limits','login/start','login/status','usage']:
    error('ACCOUNT_MIGRATION_REQUIRED',lambda:existing_catalog({'protocol':1,'method':method}))
assert all(q['method']=='list' for q in queries)
`);
