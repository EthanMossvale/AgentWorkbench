import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const brokerDirectory = path.resolve('services/vps-account-broker');
const BOOTSTRAP = String.raw`
import sys,os,json,tempfile,pathlib,types,stat,copy,unittest.mock
sys.dont_write_bytecode=True
try: import fcntl
except ImportError:
    sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
from broker import AccountBroker,AccountRegistry,BrokerError,trusted_path
from native_worker import public_account,NativeCodexLogin
workers=[]
class FakeWorker:
    def __init__(self,profile,binary,owner_uid,notify):
        self.profile=pathlib.Path(profile);self.owner_uid=owner_uid;self.notify=notify;self.started=False;self.renewals=0;self.cancellations=0
        workers.append(self)
    def start(self): self.started=True
    def renew(self): self.renewals+=1
    def cancel(self,wait_seconds=3):
        self.cancellations+=1
        self.notify({'state':'cancelled','cleanup':'confirmed'})
def config(root):
    return {'authorityId':'fixture-authority','generation':'g1','ownerUid':2000,'root':str(root),'codexExecutable':os.path.abspath('/fixture/codex'),'workspacePolicyFile':'/fixture/workspaces.json','members':[{'uid':1000,'workspaceId':'one','authorityId':'fixture-authority','generation':'g1'},{'uid':1001,'workspaceId':'two','authorityId':'fixture-authority','generation':'g1'},{'uid':1002,'workspaceId':'three','authorityId':'fixture-authority','generation':'g1'}]}
identity={'authorityId':'fixture-authority','generation':'g1'}
policy={'schemaVersion':1,**identity,'revision':0,'workspaces':[{'uid':uid,'workspaceId':name,'enabled':True,'allowedAccountIds':[]} for uid,name in ((1000,'one'),(1001,'two'),(1002,'three'))]}
def read_policy(filename):
    assert filename=='/fixture/workspaces.json'
    return copy.deepcopy(policy)
def allow_accounts(*account_ids):
    for workspace in policy['workspaces']:workspace['allowedAccountIds']=list(account_ids)
    policy['revision']+=1
def request(method,**params): return {'protocol':1,'method':method,'params':params}
def error(expected,fn):
    try: fn()
    except BrokerError as e: assert e.code==expected,(e.code,expected)
    else: raise AssertionError('Expected '+expected)
with tempfile.TemporaryDirectory(prefix='workbench-broker-fixture-') as temporary:
    root=pathlib.Path(temporary)/'new-service'
    broker=AccountBroker(config(root),worker_factory=FakeWorker,now=lambda:1780000000,policy_reader=read_policy)
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

pythonCase('broker requires explicit member authority mapping and derives identity only from peer UID', String.raw`
error('UNAUTHORIZED',lambda:broker.dispatch(9999,request('catalog/list')))
error('INVALID_REQUEST',lambda:broker.dispatch(1000,request('catalog/list',uid=0,role='admin')))
assert broker.dispatch(0,request('catalog/list'))['workspaceId']=='administrator'
assert broker.dispatch(1000,request('catalog/list'))['workspaceId']=='one'
bad=config(pathlib.Path(temporary)/'bad');bad['members'][0]['generation']='other'
error('STALE_AUTHORITY',lambda:AccountBroker(bad,worker_factory=FakeWorker))
bad=config(pathlib.Path(temporary)/'bad');bad['ownerUid']=0
error('INVALID_REQUEST',lambda:AccountBroker(bad,worker_factory=FakeWorker))
`);

pythonCase('one administrator authorization exposes metadata only after explicit workspace permission', String.raw`
started=broker.dispatch(0,request('login/start',**identity))
assert started['state']=='preparing' and workers[0].owner_uid==2000
assert workers[0].profile.parent==root/'profiles'
workers[0].notify({'state':'authenticated','cleanup':'confirmed','account':{'status':'authenticated','email':'fixture@example.invalid','plan':'pro','access_token':'fixture-secret'}})
assert broker.dispatch(1000,request('catalog/list'))['accounts']==[]
allow_accounts(broker.dispatch(0,request('catalog/list'))['accounts'][0]['id'])
views=[broker.dispatch(uid,request('catalog/list')) for uid in (0,1000,1001,1002)]
assert all(len(view['accounts'])==1 for view in views)
assert len({view['accounts'][0]['id'] for view in views})==1
assert all('selectedAccountId' not in view for view in views)
assert 'fixture-secret' not in json.dumps(views)
assert 'fixture-secret' not in (root/'catalog.json').read_text()
assert not any(path.name=='auth.json' for path in root.rglob('*'))
`);

pythonCase('per-workspace selection uses independent persistent CAS revisions and authority fences', String.raw`
broker.registry.add('first',{'status':'authenticated','email':'first@example.invalid'})
broker.registry.add('second',{'status':'authenticated','email':'second@example.invalid'})
allow_accounts('first','second')
one=broker.dispatch(1000,request('selection/set',accountId='first',expectedRevision=0,**identity))
two=broker.dispatch(1001,request('selection/set',accountId='second',expectedRevision=0,**identity))
assert one['selectedAccountId']=='first' and two['selectedAccountId']=='second'
assert one['selectionRevision']==1 and two['selectionRevision']==1
assert 'selectedAccountId' not in broker.dispatch(1002,request('catalog/list'))
error('STALE_SELECTION',lambda:broker.dispatch(1000,request('selection/set',accountId='second',expectedRevision=0,**identity)))
error('STALE_AUTHORITY',lambda:broker.dispatch(1000,request('selection/set',accountId='second',expectedRevision=1,authorityId='other',generation='g1')))
error('ADMIN_SELECTION_FORBIDDEN',lambda:broker.dispatch(0,request('selection/set',accountId='first',expectedRevision=0,**identity)))
reopened=AccountBroker(config(root),worker_factory=FakeWorker,policy_reader=read_policy)
assert reopened.dispatch(1000,request('catalog/list'))['selectedAccountId']=='first'
assert reopened.dispatch(1001,request('catalog/list'))['selectedAccountId']=='second'
`);

pythonCase('administrator can initiate authorization but the native worker always belongs to the non-root owner', String.raw`
started=broker.dispatch(0,request('login/start',**identity))
assert workers[0].owner_uid==2000 and workers[0].started
error('JOB_UNAVAILABLE',lambda:broker.dispatch(1000,request('login/status',jobId=started['jobId'],**identity)))
error('ADMIN_LOGIN_REQUIRED',lambda:broker.dispatch(1001,request('login/start',**identity)))
assert broker.dispatch(0,request('login/cancel',jobId=started['jobId'],**identity))['state']=='cancelled'
assert workers[0].cancellations==1
`);

pythonCase('administrator cancellation clears its code and late completion cannot register an account', String.raw`
started=broker.dispatch(0,request('login/start',**identity))
workers[0].notify({'state':'awaiting-code','verificationUrl':'https://auth.openai.com/codex/device','userCode':'ABCD-12345'})
visible=broker.dispatch(0,request('login/status',jobId=started['jobId'],**identity))
assert visible['userCode']=='ABCD-12345' and workers[0].renewals==1
error('JOB_UNAVAILABLE',lambda:broker.dispatch(1001,request('login/cancel',jobId=started['jobId'],**identity)))
cancelled=broker.dispatch(0,request('login/cancel',jobId=started['jobId'],**identity))
assert cancelled['state']=='cancelled' and cancelled['cleanup']=='confirmed' and 'userCode' not in cancelled
workers[0].notify({'state':'authenticated','cleanup':'confirmed','account':{'status':'authenticated','email':'late@example.invalid'}})
assert broker.dispatch(1000,request('catalog/list'))['accounts']==[]
`);

pythonCase('authorization deadline expires even if polling continues and state recovery does not reset an authority', String.raw`
clock=[1780000000]
broker.now=lambda:clock[0]
started=broker.dispatch(0,request('login/start',**identity))
clock[0]+=901
expired=broker.dispatch(0,request('login/status',jobId=started['jobId'],**identity))
assert expired['state']=='expired' and expired['cleanup']=='confirmed' and workers[0].cancellations==1
broker.registry.add('first',{'status':'authenticated'})
changed=config(root);changed['generation']='g2'
for member in changed['members']:member['generation']='g2'
error('STALE_AUTHORITY',lambda:AccountBroker(changed,worker_factory=FakeWorker))
`);

pythonCase('failed atomic catalog writes cannot mutate the in-memory selection', String.raw`
broker.registry.add('first',{'status':'authenticated'})
allow_accounts('first')
with unittest.mock.patch('broker.os.replace',side_effect=OSError('fixture failure')):
    try:broker.dispatch(1000,request('selection/set',accountId='first',expectedRevision=0,**identity))
    except OSError:pass
    else:raise AssertionError('Expected failed commit')
after=broker.dispatch(1000,request('catalog/list'))
assert after['selectionRevision']==0 and 'selectedAccountId' not in after
assert not list(root.glob('.catalog-*.tmp'))
`);

pythonCase('native account allowlist drops tokens and worker lease cancellation is independent from wall-clock duration', String.raw`
safe=public_account({'type':'chatgpt','email':'fixture@example.invalid','planType':'pro','accessToken':'fixture-secret','refreshToken':'fixture-secret'})
assert safe=={'status':'authenticated','authMethod':'ChatGPT','email':'fixture@example.invalid','plan':'pro'}
clock=[0]
worker=NativeCodexLogin(root/'profiles'/'fixture','/fixture/codex',2000,lambda value:None,now=lambda:clock[0],lease_seconds=30)
clock[0]=29;assert worker._stop_reason() is None
worker.renew();clock[0]=58;assert worker._stop_reason() is None
clock[0]=60;assert worker._stop_reason()=='cancelled'
assert 'fixture-secret' not in json.dumps(safe)
`);

pythonCase('deployment paths reject writable or untrusted ancestors before private directories are used', String.raw`
def info(uid,mode):return types.SimpleNamespace(st_uid=uid,st_mode=mode)
paths={'/':info(0,stat.S_IFDIR|0o755),'/srv':info(0,stat.S_IFDIR|0o755),'/srv/accounts':info(2000,stat.S_IFDIR|0o700),'/srv/accounts/profiles':info(2000,stat.S_IFDIR|0o700),'/run':info(0,stat.S_IFDIR|0o755),'/run/accounts':info(2000,stat.S_IFDIR|0o750)}
def rejected(fn):
    try:fn()
    except RuntimeError:pass
    else:raise AssertionError('Untrusted deployment path accepted')
with unittest.mock.patch('broker.os.lstat',side_effect=lambda value:paths[str(value)]):
    assert trusted_path('/srv/accounts/profiles',owners={0,2000},final_uid=2000,kind='directory',private=True)=='/srv/accounts/profiles'
    assert trusted_path('/run/accounts',owners={0,2000},final_uid=2000,kind='directory')=='/run/accounts'
    paths['/run/accounts']=info(2000,stat.S_IFDIR|0o770)
    rejected(lambda:trusted_path('/run/accounts',owners={0,2000},final_uid=2000,kind='directory'))
    paths['/srv']=info(1000,stat.S_IFDIR|0o755)
    rejected(lambda:trusted_path('/srv/accounts/profiles',owners={0,2000},final_uid=2000,kind='directory',private=True))
    paths['/srv']=info(0,stat.S_IFLNK|0o777)
    rejected(lambda:trusted_path('/srv/accounts/profiles',owners={0,2000},final_uid=2000,kind='directory',private=True))
`);

pythonCase('approved executable symlinks require root ownership through every target component', String.raw`
def info(uid,mode):return types.SimpleNamespace(st_uid=uid,st_mode=mode)
paths={'/':info(0,stat.S_IFDIR|0o755),'/usr':info(0,stat.S_IFDIR|0o755),'/usr/bin':info(0,stat.S_IFDIR|0o755),'/usr/bin/codex':info(0,stat.S_IFLNK|0o777),'/usr/lib':info(0,stat.S_IFDIR|0o755),'/usr/lib/codex':info(0,stat.S_IFREG|0o755),'/home':info(0,stat.S_IFDIR|0o755),'/home/member':info(1000,stat.S_IFDIR|0o755)}
target=['../lib/codex']
def approved():return trusted_path('/usr/bin/codex',owners={0},final_uid=0,kind='executable',allow_symlinks=True)
with unittest.mock.patch('broker.os.lstat',side_effect=lambda value:paths[str(value)]),unittest.mock.patch('broker.os.readlink',side_effect=lambda value:target[0]):
    assert approved()=='/usr/lib/codex'
    for bad in (info(1000,stat.S_IFREG|0o755),info(0,stat.S_IFREG|0o775)):
        paths['/usr/lib/codex']=bad
        try:approved()
        except RuntimeError:pass
        else:raise AssertionError('Member-changeable executable accepted')
    paths['/usr/lib/codex']=info(0,stat.S_IFREG|0o755)
    target[0]='/home/member/../../usr/lib/codex'
    try:approved()
    except RuntimeError:pass
    else:raise AssertionError('Untrusted intermediate target accepted')
`);

pythonCase('native cleanup refuses reused process identities and never signals an unanchored group', String.raw`
worker=NativeCodexLogin(root/'profiles'/'fixture','/fixture/codex',2000,lambda value:None)
waits=[];signals=[]
process=types.SimpleNamespace(pid=3456,returncode=None,stdin=None,stdout=None,wait=lambda timeout:waits.append(timeout))
worker.process=process;worker.process_identity=(12345,3456,3456)
worker._read_identity=lambda pid:(77777,3456,3456)
with unittest.mock.patch('native_worker.os.killpg',side_effect=lambda pid,sig:signals.append((pid,sig)),create=True),unittest.mock.patch('native_worker.signal.SIGKILL',9,create=True):
    assert worker._terminate() is False and signals==[] and waits==[]
    worker._read_identity=lambda pid:None;worker._group_alive=lambda:True
    assert worker._terminate() is False and signals==[] and waits==[]
    worker._read_identity=lambda pid:(12345,3456,3456);worker._group_alive=lambda:False;worker._exit_code=lambda:0
    assert worker._terminate() is True and len(signals)==2 and len(waits)==1
    assert worker.process is None and worker.process_identity is None
    assert worker._terminate() is True and len(signals)==2
`);

pythonCase('invalid device notifications clear earlier codes and trigger cancellation without registering late success', String.raw`
started=broker.dispatch(0,request('login/start',**identity))
workers[0].notify({'state':'awaiting-code','verificationUrl':'https://auth.openai.com/codex/device','userCode':'ABCD-12345'})
workers[0].notify({'state':'awaiting-code','verificationUrl':'https://attacker.invalid','userCode':'ABCD-12345'})
failed=broker.dispatch(0,request('login/status',jobId=started['jobId'],**identity))
assert failed['state']=='failed' and 'userCode' not in failed and workers[0].cancellations==1
workers[0].notify({'state':'authenticated','cleanup':'confirmed','account':{'status':'authenticated'}})
assert broker.dispatch(1000,request('catalog/list'))['accounts']==[]
`);
