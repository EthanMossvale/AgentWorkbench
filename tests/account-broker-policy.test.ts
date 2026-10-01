import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const brokerDirectory = path.resolve('services/vps-account-broker');
const BOOTSTRAP = String.raw`
import sys,os,json,tempfile,pathlib,types,stat,copy,io,unittest.mock
sys.dont_write_bytecode=True
try: import fcntl
except ImportError: sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
from broker import AccountBroker,BrokerError,read_workspace_policy,MAX_POLICY_BYTES
identity={'authorityId':'fixture-authority','generation':'g1'}
workers=[]
class FakeWorker:
    def __init__(self,profile,binary,owner_uid,notify):self.notify=notify;workers.append(self)
    def start(self):pass
    def renew(self):pass
    def cancel(self,wait_seconds=3):self.notify({'state':'cancelled','cleanup':'confirmed'})
def config(root):
    return {**identity,'ownerUid':2000,'root':str(root),'codexExecutable':os.path.abspath('/fixture/codex'),'workspacePolicyFile':'/fixture/workspaces.json','members':[{'uid':1000,'workspaceId':'legacy-static-name',**identity}]}
def request(method,**params):return {'protocol':1,'method':method,'params':params}
def error(expected,fn):
    try:fn()
    except BrokerError as e:assert e.code==expected,(e.code,expected)
    else:raise AssertionError('Expected '+expected)
policy={'schemaVersion':1,**identity,'revision':1,'workspaces':[
    {'workspaceId':'one','uid':1000,'enabled':True,'allowedAccountIds':['first']},
    {'workspaceId':'two','uid':1001,'enabled':True,'allowedAccountIds':['second']},
    {'workspaceId':'three','uid':1002,'enabled':True,'allowedAccountIds':[]}]}
reads=[]
def reader(filename):reads.append(filename);return copy.deepcopy(policy)
with tempfile.TemporaryDirectory(prefix='workbench-broker-policy-fixture-') as temporary:
    root=pathlib.Path(temporary)/'accounts'
    broker=AccountBroker(config(root),worker_factory=FakeWorker,policy_reader=reader)
    broker.registry.add('first',{'status':'authenticated','email':'first@example.invalid'})
    broker.registry.add('second',{'status':'authenticated','email':'second@example.invalid'})
    CASE
`;

function pythonCase(name: string, body: string) {
  test(name, t => {
    const program = BOOTSTRAP.replace('    CASE', body.split('\n').map(line => '    ' + line).join('\n'));
    const result = spawnSync('python', ['-B', '-c', program, brokerDirectory], { encoding: 'utf8', timeout: 5000, windowsHide: true, shell: false, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { t.skip('Broker fixtures require a local Python runtime.'); return; }
    assert.equal(result.status, 0, result.stderr || result.stdout); assert.equal(result.error, undefined);
  });
}

pythonCase('workspace catalogs and selection receipts expose only explicitly permitted public accounts', String.raw`
one=broker.dispatch(1000,request('catalog/list'))
two=broker.dispatch(1001,request('catalog/list'))
three=broker.dispatch(1002,request('catalog/list'))
assert [row['id'] for row in one['accounts']]==['first'] and one['workspaceId']=='one'
assert [row['id'] for row in two['accounts']]==['second'] and three['accounts']==[]
assert len(broker.dispatch(0,request('catalog/list'))['accounts'])==2
chosen=broker.dispatch(1000,request('selection/set',accountId='first',expectedRevision=0,**identity))
assert chosen['selectedAccountId']=='first' and [row['id'] for row in chosen['accounts']]==['first']
assert 'second@example.invalid' not in json.dumps(chosen)
error('ACCOUNT_FORBIDDEN',lambda:broker.dispatch(1000,request('selection/set',accountId='second',expectedRevision=1,**identity)))
error('ACCOUNT_FORBIDDEN',lambda:broker.dispatch(1002,request('selection/set',accountId='first',expectedRevision=0,**identity)))
assert broker.registry.catalog('one')['selectionRevision']==1
assert all(filename=='/fixture/workspaces.json' for filename in reads)
`);

pythonCase('policy revocation hides the old default without rewriting account identity or existing selection', String.raw`
selected=broker.dispatch(1000,request('selection/set',accountId='first',expectedRevision=0,**identity))
original=copy.deepcopy(broker.registry.state)
policy['revision']+=1;policy['workspaces'][0]['allowedAccountIds']=['second']
current=broker.dispatch(1000,request('catalog/list'))
assert current['selectionRevision']==selected['selectionRevision'] and 'selectedAccountId' not in current
assert [row['id'] for row in current['accounts']]==['second']
assert broker.registry.state==original
error('ACCOUNT_FORBIDDEN',lambda:broker.dispatch(1000,request('selection/set',accountId='first',expectedRevision=1,**identity)))
replacement=broker.dispatch(1000,request('selection/set',accountId='second',expectedRevision=1,**identity))
assert replacement['selectedAccountId']=='second'
assert broker.registry.state['accounts']==original['accounts']
`);

pythonCase('root-controlled policy supplies dynamic peer UID mapping without renderer workspace overrides', String.raw`
policy['workspaces'].append({'workspaceId':'new-space','uid':1003,'enabled':True,'allowedAccountIds':['first']})
assert broker.dispatch(1003,request('catalog/list'))['workspaceId']=='new-space'
error('INVALID_REQUEST',lambda:broker.dispatch(1000,request('catalog/list',workspaceId='two')))
error('INVALID_REQUEST',lambda:broker.dispatch(1000,request('selection/set',workspaceId='two',accountId='first',expectedRevision=0,**identity)))
policy['workspaces']=[row for row in policy['workspaces'] if row['uid']!=1000]
error('UNAUTHORIZED',lambda:broker.dispatch(1000,request('catalog/list')))
error('UNAUTHORIZED',lambda:broker.dispatch(2000,request('catalog/list')))
`);

pythonCase('disabled and unavailable policies fail closed on the next member request while root can recover', String.raw`
broker.dispatch(1000,request('catalog/list'))
policy['workspaces'][0]['enabled']=False
error('WORKSPACE_DISABLED',lambda:broker.dispatch(1000,request('catalog/list')))
error('WORKSPACE_DISABLED',lambda:broker.dispatch(1000,request('selection/set',accountId='first',expectedRevision=0,**identity)))
assert broker.dispatch(1001,request('catalog/list'))['workspaceId']=='two'
assert len(broker.dispatch(0,request('catalog/list'))['accounts'])==2
policy['workspaces'][0]['enabled']=True
assert broker.dispatch(1000,request('catalog/list'))['workspaceId']=='one'
def missing(filename):raise FileNotFoundError('Synthetic missing policy')
broker.policy_reader=missing
error('POLICY_UNAVAILABLE',lambda:broker.dispatch(1000,request('catalog/list')))
assert broker.dispatch(0,request('login/start',**identity))['state']=='preparing'
`);

pythonCase('legacy static members gain no implicit account visibility when policy configuration is absent', String.raw`
legacy_config=config(root);legacy_config.pop('workspacePolicyFile')
legacy=AccountBroker(legacy_config,worker_factory=FakeWorker,policy_reader=lambda filename:(_ for _ in ()).throw(AssertionError('Missing path must not be guessed')))
error('POLICY_UNAVAILABLE',lambda:legacy.dispatch(1000,request('catalog/list')))
error('POLICY_UNAVAILABLE',lambda:legacy.dispatch(1000,request('selection/set',accountId='first',expectedRevision=0,**identity)))
error('POLICY_UNAVAILABLE',lambda:legacy.dispatch(1000,request('login/start',**identity)))
assert len(legacy.dispatch(0,request('catalog/list'))['accounts'])==2
assert legacy.dispatch(0,request('login/start',**identity))['state']=='preparing'
`);

pythonCase('members cannot initiate native authorization or request credentials despite catalog permission', String.raw`
for uid in (1000,1001,1002):
    error('ADMIN_LOGIN_REQUIRED',lambda:broker.dispatch(uid,request('login/start',**identity)))
assert workers==[]
error('INVALID_REQUEST',lambda:broker.dispatch(1000,request('credentials/read')))
error('INVALID_REQUEST',lambda:broker.dispatch(0,request('credentials/export')))
started=broker.dispatch(0,request('login/start',**identity))
error('JOB_UNAVAILABLE',lambda:broker.dispatch(1000,request('login/status',jobId=started['jobId'],**identity)))
error('JOB_UNAVAILABLE',lambda:broker.dispatch(1000,request('login/cancel',jobId=started['jobId'],**identity)))
assert len(workers)==1
`);

pythonCase('malformed policy schema authority mapping and account ACL never fall back to cached grants', String.raw`
valid=copy.deepcopy(policy)
invalid=[]
for patch in ({'schemaVersion':True},{'schemaVersion':2},{'authorityId':'other'},{'generation':'other'},{'revision':-1},{'revision':True},{'revision':9007199254740992},{'workspaces':{}}):
    invalid.append({**copy.deepcopy(valid),**patch})
for patch in ({'uid':0},{'uid':2000},{'uid':True},{'uid':4294967295},{'workspaceId':'administrator'},{'enabled':'true'},{'allowedAccountIds':['first','first']},{'allowedAccountIds':['../first']},{'allowedAccountIds':None}):
    bad=copy.deepcopy(valid);bad['workspaces'][0].update(patch);invalid.append(bad)
bad=copy.deepcopy(valid);bad['workspaces'][1]['uid']=1000;invalid.append(bad)
bad=copy.deepcopy(valid);bad['workspaces'][1]['workspaceId']='one';invalid.append(bad)
for bad in invalid:
    policy.clear();policy.update(copy.deepcopy(valid))
    assert broker.dispatch(1000,request('catalog/list'))['accounts'][0]['id']=='first'
    policy.clear();policy.update(bad)
    error('POLICY_UNAVAILABLE',lambda:broker.dispatch(1000,request('catalog/list')))
    error('POLICY_UNAVAILABLE',lambda:broker.dispatch(1000,request('selection/set',accountId='first',expectedRevision=0,**identity)))
    assert len(broker.dispatch(0,request('catalog/list'))['accounts'])==2
`);

pythonCase('trusted policy reads reject unsafe ancestors and symbolic links before opening the file', String.raw`
def info(uid,mode):return types.SimpleNamespace(st_uid=uid,st_mode=mode)
paths={'/':info(0,stat.S_IFDIR|0o755),'/policy':info(0,stat.S_IFDIR|0o755),'/policy/workspaces.json':info(0,stat.S_IFREG|0o644)}
with unittest.mock.patch('broker.os.lstat',side_effect=lambda value:paths[str(value)]),unittest.mock.patch('broker.os.open') as opened,unittest.mock.patch('broker.os.O_NOFOLLOW',0x20000,create=True):
    for key,bad in (('/policy',info(1000,stat.S_IFDIR|0o755)),('/policy',info(0,stat.S_IFDIR|0o775)),('/policy',info(0,stat.S_IFLNK|0o777)),('/policy/workspaces.json',info(0,stat.S_IFLNK|0o777)),('/policy/workspaces.json',info(1000,stat.S_IFREG|0o644))):
        previous=paths[key];paths[key]=bad
        error('POLICY_UNAVAILABLE',lambda:read_workspace_policy('/policy/workspaces.json'))
        paths[key]=previous
    opened.assert_not_called()
`);

pythonCase('opened policy descriptors must still be root-owned regular bounded and non-writable by members', String.raw`
def info(uid,mode,size=16):return types.SimpleNamespace(st_uid=uid,st_mode=mode,st_size=size)
with unittest.mock.patch('broker.trusted_path',return_value='/policy/workspaces.json') as trust,unittest.mock.patch('broker.os.open',return_value=90) as opened,unittest.mock.patch('broker.os.close') as closed,unittest.mock.patch('broker.os.O_NOFOLLOW',0x20000,create=True),unittest.mock.patch('broker.os.O_CLOEXEC',0x80000,create=True),unittest.mock.patch('broker.os.O_NONBLOCK',0x800,create=True):
    for bad in (info(1000,stat.S_IFREG|0o644),info(0,stat.S_IFREG|0o664),info(0,stat.S_IFIFO|0o600),info(0,stat.S_IFREG|0o644,MAX_POLICY_BYTES+1)):
        with unittest.mock.patch('broker.os.fstat',return_value=bad):
            error('POLICY_UNAVAILABLE',lambda:read_workspace_policy('/policy/workspaces.json'))
    assert closed.call_count==4
    trust.assert_called_with('/policy/workspaces.json',owners={0},final_uid=0,kind='file')
    assert opened.call_args.args[1] & 0x20000
`);

pythonCase('policy JSON reads are bounded reject duplicate keys and read a fresh snapshot every time', String.raw`
metadata=types.SimpleNamespace(st_uid=0,st_mode=stat.S_IFREG|0o644,st_size=16)
current=[json.dumps(policy).encode()]
with unittest.mock.patch('broker.trusted_path',return_value='/policy/workspaces.json'),unittest.mock.patch('broker.os.open',return_value=90),unittest.mock.patch('broker.os.fstat',return_value=metadata),unittest.mock.patch('broker.os.fdopen',side_effect=lambda fd,mode:io.BytesIO(current[0])),unittest.mock.patch('broker.os.O_NOFOLLOW',0x20000,create=True),unittest.mock.patch('broker.os.O_CLOEXEC',0x80000,create=True),unittest.mock.patch('broker.os.O_NONBLOCK',0x800,create=True):
    assert read_workspace_policy('/policy/workspaces.json')['revision']==1
    current[0]=json.dumps({**policy,'revision':2}).encode()
    assert read_workspace_policy('/policy/workspaces.json')['revision']==2
    for raw in (b'{"enabled":true,"enabled":false}',b'\xff',b'{',b' '* (MAX_POLICY_BYTES+1)):
        current[0]=raw
        error('POLICY_UNAVAILABLE',lambda:read_workspace_policy('/policy/workspaces.json'))
`);
