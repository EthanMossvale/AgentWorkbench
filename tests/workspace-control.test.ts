import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const serviceDirectory = path.resolve('services/vps-workspace-control');
const BOOTSTRAP = String.raw`
import sys,os,json,tempfile,pathlib,types,unittest.mock,base64,struct,threading,http.client,stat
sys.dont_write_bytecode=True
try: import fcntl
except ImportError:sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
from control import WorkspaceControl
from security import ControlError,public_key
from provisioner import LinuxProvisioner,edit_authorized_keys,portable_key_records
from server import enrollment_handler
from http.server import ThreadingHTTPServer
def key(byte):return 'ssh-ed25519 '+base64.b64encode(struct.pack('>I',11)+b'ssh-ed25519'+struct.pack('>I',32)+bytes([byte])*32).decode('ascii')
class FixtureProvisioner:
    def __init__(self,root):
        self.root=root;self.calls=[];self.users={name:{'uid':1000+i,'gid':1000+i,'username':name,'home':'/home/'+name} for i,name in enumerate(('one','two','three'))};self.original=b'# existing authorization\r\n'+key(90).encode('ascii')+b' old-device\n'
        for name in self.users:(root/(name+'.keys')).write_bytes(self.original)
    def observe(self,username,root):
        user=self.users.get(username)
        return {'user':user,'root':root,'directory':{'uid':user['uid'],'inode':user['uid'],'mode':0o700} if user else None}
    def create(self,username,root):
        assert username not in self.users
        self.calls.append(('create',username));user={'uid':1000+len(self.users),'gid':1000+len(self.users),'username':username,'home':root};self.users[username]=user;(self.root/(username+'.keys')).write_bytes(b'');return user
    def adopt(self,username,uid,root):
        assert self.users[username]['uid']==uid
        self.calls.append(('adopt',username));return self.users[username]
    def deletion_plan(self,workspace):
        user=self.users[workspace['username']]
        return dict(mode='destroy',username=user['username'],uid=user['uid'],gid=user['gid'],home=user['home'],root=workspace['root'],device=1,inode=user['uid'],storageBytes=4096)
    def ssh_only_members(self):return []
    def portable_devices(self,workspace):return portable_key_records((self.root/(workspace['username']+'.keys')).read_bytes(),0) if workspace['status']!='deleted' else []
    def destroy(self,workspace,expected,operation_id):
        assert expected==self.deletion_plan(workspace)
        self.calls.append(('destroy',workspace['username']));self.users.pop(workspace['username']);(self.root/(workspace['username']+'.keys')).unlink()
        return dict(kind='purged',home=expected['home'],storageBytes=expected['storageBytes'])
    def add_key(self,workspace,device):
        self.calls.append(('add',device['id']));file=self.root/(workspace['username']+'.keys');file.write_bytes(edit_authorized_keys(file.read_bytes(),LinuxProvisioner.key_line(workspace,device),device['publicKey'],add=True))
    def revoke_key(self,workspace,device):
        self.calls.append(('revoke',device['id']));file=self.root/(workspace['username']+'.keys');file.write_bytes(edit_authorized_keys(file.read_bytes(),LinuxProvisioner.key_line(workspace,device),device['publicKey'],add=False))
def req(method,**params):return {'protocol':1,'method':method,'params':params}
def fail(code,fn):
    try:fn()
    except ControlError as error:assert error.code==code,(error.code,code)
    else:raise AssertionError('Expected '+code)
with tempfile.TemporaryDirectory(prefix='workspace-control-fixture-') as temporary:
    root=pathlib.Path(temporary);clock=[1780000000];policies=[];provisioner=FixtureProvisioner(root)
    config={'authorityId':'authority-fixture','generation':'g1','root':str(root/'control'),'connection':{'hostname':'fixture.invalid','port':22,'hostPublicKeys':[key(80)]},'enrollmentUrl':'https://fixture.invalid/v1/enroll'}
    control=WorkspaceControl(config,provisioner,publish_policy=lambda value:policies.append(value),now=lambda:clock[0])
    identity={'authorityId':'authority-fixture','generation':'g1'}
    def values(name='one',adopt=True):
        value={'name':name,'username':name,'root':'/home/'+name,'environment':{'runtimes':['codex','claude'],'defaultDirectory':'/home/'+name,'env':{'LANG':'C.UTF-8'}},'allowedAccountIds':['account-one'],'budget':{'period':'month','limit':None,'unit':'usd','enforcement':'unavailable'}}
        if adopt:value['uid']=provisioner.users[name]['uid']
        return value
    def plan(operation,workspace=None,value=None):
        params=dict(identity,expectedRevision=control.state['revision'],operation=operation,values=value or {})
        if workspace:params['workspaceId']=workspace
        return control.dispatch(0,req('workspace/plan',**params))
    def apply(item):return control.dispatch(0,req('workspace/apply',**identity,planId=item['planId'],planHash=item['planHash']))
    def adopt(name='one'):return apply(plan('workspace/adopt',value=values(name)))['workspace']
    def invite(workspace,ttl=300):return apply(plan('invite/create',workspace,{'label':'new device','ttlSeconds':ttl}))['invite']
    def enroll(invitation,number=1):return control.enroll({'token':invitation['token'],'publicKey':key(number),'deviceLabel':'fixture device'})
    CASE
`;

function pythonCase(name: string, body: string) {
  test(name, t => {
    const source = BOOTSTRAP.replace('    CASE', body.split('\n').map(line => '    ' + line).join('\n'));
    const result = spawnSync('python', ['-B', '-c', source, serviceDirectory], { encoding: 'utf8', timeout: 8000, windowsHide: true, shell: false, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { t.skip('Local Python is required for synthetic control-service fixtures.'); return; }
    assert.equal(result.status, 0, result.stderr || result.stdout); assert.equal(result.error, undefined);
  });
}

pythonCase('workspace control derives root authority from peer UID and rejects request-supplied roles', String.raw`
fail('ROOT_REQUIRED',lambda:control.dispatch(1000,req('workspace/list')))
fail('ROOT_REQUIRED',lambda:control.dispatch(1000,req('workspace/plan',**identity,expectedRevision=0,operation='workspace/create',values=values('four',False))))
fail('INVALID_REQUEST',lambda:control.dispatch(0,{'protocol':1,'method':'workspace/list','params':{},'uid':0}))
assert control.dispatch(0,req('workspace/list'))['workspaces']==[] and provisioner.calls==[]
`);

pythonCase('adoption reuses three discovered identities without creating users or changing existing keys', String.raw`
spaces=[adopt(name) for name in ('one','two','three')]
assert [row['uid'] for row in spaces]==[1000,1001,1002]
assert not any(call[0]=='create' for call in provisioner.calls)
assert all((root/(name+'.keys')).read_bytes()==provisioner.original for name in ('one','two','three'))
fail('WORKSPACE_EXISTS',lambda:plan('workspace/adopt',value=values('one')))
assert len(control.dispatch(0,req('workspace/list'))['workspaces'])==3
assert all(row['budget']['enforcement']=='unavailable' and row['nativeQuota']=='unknown' for row in spaces)
assert all(row['enabled'] for row in policies[-1]['workspaces'])
`);

pythonCase('plans bind authority revision hash expiry and external discovery with a durable one-execution fence', String.raw`
first=plan('workspace/adopt',value=values())
fail('PLAN_UNAVAILABLE',lambda:control.dispatch(0,req('workspace/apply',**identity,planId=first['planId'],planHash='wrong')))
fail('STALE_AUTHORITY',lambda:control.dispatch(0,req('workspace/apply',authorityId='other',generation='g1',planId=first['planId'],planHash=first['planHash'])))
provisioner.users['one']['uid']=9001
fail('DISCOVERY_CHANGED',lambda:apply(first))
provisioner.users['one']['uid']=1000
second=plan('workspace/adopt',value=values('two'))
result=apply(first);assert result['state']=='applied' and result['operationId']==first['planId']
fail('PLAN_ALREADY_USED',lambda:apply(first));fail('STALE_REVISION',lambda:apply(second))
third=plan('workspace/adopt',value=values('three'));clock[0]+=301
fail('PLAN_EXPIRED',lambda:apply(third))
assert [call for call in provisioner.calls if call[0]=='adopt']==[('adopt','one')]
`);

pythonCase('create remains explicit and rejects existing users instead of duplicating or overwriting them', String.raw`
fail('ADOPT_REQUIRED',lambda:plan('workspace/create',value=values('one',False)))
created=apply(plan('workspace/create',value=values('four',False)))
assert created['state']=='applied' and created['workspace']['username']=='four'
assert [call for call in provisioner.calls if call[0]=='create']==[('create','four')]
bad=values('unsafe',False);bad['username']='member;id'
fail('INVALID_REQUEST',lambda:plan('workspace/create',value=bad))
assert len(provisioner.users)==4
`);

pythonCase('environment and budget inputs cannot claim enforcement or add privileged runtime environment variables', String.raw`
workspace=adopt()
for budget in ({'period':'month','limit':10,'unit':'usd','enforcement':'enforced'},{'period':'month','limit':float('inf'),'unit':'usd','enforcement':'unavailable'}):
    fail('INVALID_REQUEST',lambda:plan('workspace/update',workspace['id'],{'budget':budget}))
bad=values()['environment'];bad['env']={'LD_PRELOAD':'/tmp/hostile.so'}
fail('INVALID_REQUEST',lambda:plan('workspace/update',workspace['id'],{'environment':bad}))
changed=apply(plan('workspace/update',workspace['id'],{'name':'Renamed','allowedAccountIds':['account-two'],'budget':{'period':'month','limit':15,'unit':'usd','enforcement':'unavailable'}}))
assert changed['workspace']['name']=='Renamed' and changed['workspace']['budget']['limit']==15
assert changed['workspace']['nativeQuota']=='unknown' and policies[-1]['workspaces'][0]['allowedAccountIds']==['account-two']
`);

pythonCase('invitation tokens are returned once while disk list and operation recovery contain only public metadata or hashes', String.raw`
workspace=adopt();prepared=plan('invite/create',workspace['id'],{'label':'Laptop','ttlSeconds':60});applied=apply(prepared);invitation=applied['invite']
assert invitation['enrollmentUrl'].startswith('https://') and 'privateKey' not in invitation
assert invitation['token'] not in control.file.read_text()
visible=control.dispatch(0,req('workspace/list'));serialized=json.dumps(visible)
assert invitation['token'] not in serialized and 'tokenHash' not in serialized
assert visible['workspaces'][0]['invites'][0]['status']=='active'
recovered=control.dispatch(0,req('workspace/operation',**identity,operationId=prepared['planId']))
assert recovered['state']=='applied' and 'invite' not in recovered
clock[0]+=61
fail('INVITE_UNAVAILABLE',lambda:enroll(invitation))
assert control.dispatch(0,req('workspace/list'))['workspaces'][0]['invites'][0]['status']=='expired'
`);

pythonCase('same invitation and key retries return the same device but cannot authorize a different key', String.raw`
workspace=adopt();invitation=invite(workspace['id']);first=enroll(invitation);second=enroll(invitation)
assert first==second and first['schema']=='agent-workbench-device'
assert len([call for call in provisioner.calls if call[0]=='add'])==1
fail('INVITE_UNAVAILABLE',lambda:enroll(invitation,2))
clock[0]+=1000
assert enroll(invitation)==first
assert control.dispatch(0,req('workspace/list'))['workspaces'][0]['invites'][0]['status']=='redeemed'
`);

pythonCase('device revocation preserves legacy keys and other devices while rejecting replayed enrollment', String.raw`
workspace=adopt();one=invite(workspace['id']);first=enroll(one,1);two=invite(workspace['id']);second=enroll(two,2)
before=(root/'one.keys').read_bytes();assert before.startswith(provisioner.original)
revoked=apply(plan('device/revoke',workspace['id'],{'deviceId':first['deviceId']}))
after=(root/'one.keys').read_bytes()
assert after.startswith(provisioner.original) and key(1).encode('ascii') not in after and key(2).encode('ascii') in after
assert next(row for row in revoked['workspace']['devices'] if row['id']==first['deviceId'])['status']=='revoked'
fail('INVITE_UNAVAILABLE',lambda:enroll(one,1));assert enroll(two,2)==second
assert (root/'two.keys').read_bytes()==provisioner.original
`);

pythonCase('suspension preserves grants and resume restores the same keys without reviving kicked devices', String.raw`
workspace=adopt();used=invite(workspace['id']);device=enroll(used);unused=invite(workspace['id'])
revoked_invite=invite(workspace['id']);revoked_device=enroll(revoked_invite,3)
apply(plan('device/revoke',workspace['id'],{'deviceId':revoked_device['deviceId']}))
suspended=apply(plan('workspace/suspend',workspace['id']))
assert suspended['workspace']['status']=='suspended' and not policies[-1]['workspaces'][0]['enabled']
assert (root/'one.keys').read_bytes()==provisioner.original
fail('WORKSPACE_DISABLED',lambda:enroll(used));fail('WORKSPACE_DISABLED',lambda:enroll(unused,2))
resumed=apply(plan('workspace/suspend',workspace['id'],{'suspended':False}))
assert resumed['workspace']['status']=='active' and resumed['workspace']['devices'][0]['status']=='active'
assert key(1).encode() in (root/'one.keys').read_bytes()
assert key(3).encode() not in (root/'one.keys').read_bytes()
assert enroll(used)==device
fail('INVITE_UNAVAILABLE',lambda:enroll(unused,2))
`);

pythonCase('portable devices remain named and authorized across suspend resume and can be permanently kicked', String.raw`
workspace=adopt();file=root/'one.keys'
line=key(4)+' aw-device:11111111-1111-1111-1111-111111111111:RGVza3RvcA:1780000000'
file.write_bytes(file.read_bytes()+line.encode()+b'\n')
device=control.dispatch(0,req('workspace/list'))['workspaces'][0]['devices'][0]
assert device['label']=='Desktop' and 'authorizationLine' not in device
suspended=apply(plan('workspace/suspend',workspace['id']))
assert suspended['workspace']['devices'][0]['status']=='active' and file.read_bytes()==provisioner.original
resumed=apply(plan('workspace/suspend',workspace['id'],{'suspended':False}))
assert file.read_bytes()==provisioner.original+line.encode()+b'\n'
assert resumed['workspace']['devices'][0]['id']==device['id']
apply(plan('device/revoke',workspace['id'],{'deviceId':device['id']}))
apply(plan('workspace/suspend',workspace['id']))
apply(plan('workspace/suspend',workspace['id'],{'suspended':False}))
assert file.read_bytes()==provisioner.original
assert control.dispatch(0,req('workspace/list'))['workspaces'][0]['devices'][0]['status']=='revoked'
`);

pythonCase('workspace deletion destroys the user and authorization and recreates a fresh identity', String.raw`
workspace=adopt();invitation=invite(workspace['id']);enroll(invitation);unused=invite(workspace['id'])
deleted=apply(plan('workspace/delete',workspace['id']))
assert deleted['workspace']['status']=='deleted' and 'one' not in provisioner.users
assert deleted['workspace']['deletion']['kind']=='purged' and not (root/'one.keys').exists()
assert len(policies[-1]['workspaces'])==1 and policies[-1]['workspaces'][0]['enabled'] is False
assert ('destroy','one') in provisioner.calls
assert all(row['status']=='revoked' for row in deleted['workspace']['devices'])
assert next(row for row in deleted['workspace']['invites'] if row['id']==unused['inviteId'])['status']=='revoked'
recreate=values('one',False);recreate['allowedAccountIds']=[];recreate['accountQuotas']={}
new=apply(plan('workspace/create',value=recreate))['workspace']
assert new['generation']!=workspace['generation'] and new['id']!=workspace['id']
assert new['root']==workspace['root'] and new['username']==workspace['username']
assert new['devices']==[] and new['invites']==[] and new['allowedAccountIds']==[] and new['accountQuotas']=={}
assert ('create','one') in provisioner.calls and (root/'one.keys').read_bytes()==b''
fail('WORKSPACE_UNAVAILABLE',lambda:enroll(invitation))
fail('WORKSPACE_UNAVAILABLE',lambda:enroll(unused,2))
`);

pythonCase('workspace display-name edits preserve identity while direct identity or root updates are rejected', String.raw`
workspace=adopt();before=dict(provisioner.users['one']);calls=list(provisioner.calls)
for patch in ({'username':'renamed'},{'root':'/home/renamed/workspaces'},{'uid':2000}):
    fail('INVALID_REQUEST',lambda:plan('workspace/update',workspace['id'],patch))
environment=dict(workspace['environment'],defaultDirectory='/home/one/writing')
updated=apply(plan('workspace/update',workspace['id'],{'name':'New display name','environment':environment}))['workspace']
assert updated['name']=='New display name' and updated['environment']['defaultDirectory']=='/home/one/writing'
assert updated['username']==workspace['username'] and updated['root']==workspace['root'] and updated['uid']==workspace['uid']
assert provisioner.users['one']==before and provisioner.calls==calls
`);

pythonCase('old deletion plans never mutate and failed destruction remains fenced across restart', String.raw`
workspace=adopt();prepared=plan('workspace/delete',workspace['id'])
control.state['plans'][prepared['planId']].pop('deletion')
before=list(provisioner.calls)
fail('DELETION_PLAN_REQUIRED',lambda:apply(prepared))
assert provisioner.calls==before and not control.state['plans'][prepared['planId']]['used']
prepared=plan('workspace/delete',workspace['id'])
attempts=[]
def fail_destroy(*args):
    attempts.append(True)
    raise ControlError('DESTRUCTION_UNCONFIRMED')
provisioner.destroy=fail_destroy
result=apply(prepared)
assert result['state']=='uncertain' and attempts==[True]
assert policies[-1]['workspaces'][0]['enabled'] is False
fail('PLAN_ALREADY_USED',lambda:apply(prepared))
reopened=WorkspaceControl(config,provisioner,publish_policy=lambda value:policies.append(value),now=lambda:clock[0]);reopened.reconcile()
assert reopened.dispatch(0,req('workspace/list'))['workspaces'][0]['controlState']=='recovery-required'
assert policies[-1]['workspaces'][0]['enabled'] is False
assert reopened.dispatch(0,req('workspace/operation',**identity,operationId=prepared['planId']))['state']=='uncertain'
assert attempts==[True]
`);

pythonCase('policy publication failures cannot falsely complete or replay a partially applied operation', String.raw`
workspace=adopt();prepared=plan('workspace/update',workspace['id'],{'allowedAccountIds':['account-two']})
published=[]
def publish(value):
    if published:raise OSError('fixture final publication failure')
    published.append(value)
control.publish_policy=publish
result=apply(prepared)
assert result['state']=='uncertain' and published[0]['workspaces'][0]['enabled'] is False
fail('PLAN_ALREADY_USED',lambda:apply(prepared))
assert control.dispatch(0,req('workspace/operation',**identity,operationId=prepared['planId']))['state']=='uncertain'
assert control.dispatch(0,req('workspace/list'))['workspaces'][0]['controlState']=='recovery-required'
reopened=WorkspaceControl(config,provisioner,publish_policy=lambda value:policies.append(value),now=lambda:clock[0]);reopened.reconcile()
assert policies[-1]['workspaces'][0]['enabled'] is False
assert reopened.dispatch(0,req('workspace/list'))['workspaces'][0]['controlState']=='recovery-required'
`);

pythonCase('interrupted enrollment consumes its token and recovers only the exact managed key', String.raw`
workspace=adopt();invitation=invite(workspace['id']);original_commit=control._commit
def interrupted(candidate):
    if any(device['status']=='active' for row in candidate['workspaces'].values() for device in row['devices'].values()):raise OSError('fixture interrupted persistence')
    original_commit(candidate)
control._commit=interrupted
fail('ENROLLMENT_UNCONFIRMED',lambda:enroll(invitation))
assert (root/'one.keys').read_bytes()==provisioner.original
reopened=WorkspaceControl(config,provisioner,publish_policy=lambda value:policies.append(value),now=lambda:clock[0]);reopened.reconcile()
assert reopened.state['pendingEnrollments']=={}
assert reopened.dispatch(0,req('workspace/list'))['workspaces'][0]['devices'][0]['status']=='revoked'
fail('INVITE_UNAVAILABLE',lambda:reopened.enroll({'token':invitation['token'],'publicKey':key(1),'deviceLabel':'retry'}))
`);

pythonCase('Linux provisioning uses only the fixed useradd argv and never a shell or deletion command', String.raw`
adapter=LinuxProvisioner();calls=[];user={'uid':1400,'gid':1400,'username':'new-member','home':'/home/new-member'}
adapter._root=lambda:None;adapter.user=lambda username:None;adapter.observe=lambda username,root:{'user':user,'directory':{'uid':1400}}
with unittest.mock.patch('provisioner.os.path.lexists',return_value=False),unittest.mock.patch('provisioner.trusted_root_path',side_effect=lambda value,**kwargs:value),unittest.mock.patch('provisioner.subprocess.run',side_effect=lambda args,**kwargs:(calls.append((args,kwargs)) or types.SimpleNamespace(returncode=0))):
    assert adapter.create('new-member','/home/new-member')==user
assert calls[0][0]==['/usr/sbin/useradd','--create-home','--home-dir','/home/new-member','--shell','/bin/bash','--user-group','--','new-member']
assert calls[0][1]['shell'] is False and calls[0][1]['timeout']==60
assert 'userdel' not in json.dumps(calls[0][0])
`);

pythonCase('Linux create supports a workspace subdirectory while retaining the conventional HOME and exact UID ownership', String.raw`
adapter=LinuxProvisioner();calls=[];directories=[];ownership=[];user={'uid':1400,'gid':1401,'username':'new-member','home':'/home/new-member'}
adapter._root=lambda:None;adapter.user=lambda username:None;adapter.observe=lambda username,root:{'user':user,'directory':{'uid':1400}}
with unittest.mock.patch('provisioner.os.path.lexists',return_value=False),unittest.mock.patch('provisioner.trusted_root_path',side_effect=lambda value,**kwargs:value),unittest.mock.patch('provisioner.subprocess.run',side_effect=lambda args,**kwargs:(calls.append(args) or types.SimpleNamespace(returncode=0))),unittest.mock.patch('provisioner.os.open',return_value=90),unittest.mock.patch('provisioner.os.close'),unittest.mock.patch('provisioner.os.fstat',return_value=types.SimpleNamespace(st_uid=1400,st_mode=stat.S_IFDIR|0o700)),unittest.mock.patch('provisioner.os.mkdir',side_effect=lambda name,mode,**kwargs:directories.append((name,mode,kwargs))),unittest.mock.patch('provisioner.os.fchown',side_effect=lambda fd,uid,gid:ownership.append((uid,gid)),create=True),unittest.mock.patch('provisioner.os.fchmod',create=True),unittest.mock.patch('provisioner.os.O_DIRECTORY',0,create=True),unittest.mock.patch('provisioner.os.O_NOFOLLOW',0,create=True),unittest.mock.patch('provisioner.os.O_CLOEXEC',0,create=True):
    assert adapter.create('new-member','/home/new-member/workspaces')==user
assert calls[0][calls[0].index('--home-dir')+1]=='/home/new-member'
assert directories==[('workspaces',0o700,{'dir_fd':90})] and ownership==[(1400,1401)]
`);

pythonCase('enrollment HTTP exposes only bounded token exchange and returns a raw public receipt', String.raw`
workspace=adopt();invitation=invite(workspace['id'])
server=ThreadingHTTPServer(('127.0.0.1',0),enrollment_handler(control));worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
try:
    connection=http.client.HTTPConnection('127.0.0.1',server.server_address[1],timeout=2)
    connection.request('POST','/v1/enroll',json.dumps({'token':invitation['token'],'publicKey':key(3),'deviceLabel':'HTTP fixture'}),{'Content-Type':'application/json'})
    response=connection.getresponse();value=json.loads(response.read());assert response.status==200 and value['schema']=='agent-workbench-device' and 'token' not in value
    connection.close();connection=http.client.HTTPConnection('127.0.0.1',server.server_address[1],timeout=2)
    connection.request('POST','/v1/enroll',json.dumps({'token':'bad','publicKey':key(4),'deviceLabel':'bad'}),{'Content-Type':'application/json'})
    response=connection.getresponse();assert response.status==403 and json.loads(response.read())=={'error':'INVITE_UNAVAILABLE'}
    connection.close()
finally:server.shutdown();server.server_close();worker.join(2)
`);

pythonCase('service refuses mismatched registry generations and insecure public enrollment URLs', String.raw`
adopt();changed=dict(config,generation='other')
fail('STALE_AUTHORITY',lambda:WorkspaceControl(changed,provisioner,publish_policy=lambda value:None))
changed=dict(config,enrollmentUrl='http://fixture.invalid/v1/enroll')
fail('HTTPS_ENROLLMENT_REQUIRED',lambda:WorkspaceControl(changed,provisioner,publish_policy=lambda value:None))
fail('INVALID_PUBLIC_KEY',lambda:public_key('-----BEGIN OPENSSH PRIVATE KEY-----'))
`);


pythonCase('account quota percentages are isolated, bounded, persistent and release only deleted reservations', String.raw`
spaces=[adopt(name) for name in ('one','two','three')]
for space in spaces:
    result=apply(plan('workspace/update',space['id'],{'accountQuotas':{'account-one':{'weeklyPercent':33,'fiveHourPercent':20}}}))
    assert result['workspace']['accountQuotas']['account-one']['allowOverage'] is True
assert sum(w['accountQuotas']['account-one']['weeklyPercent'] for w in control.state['workspaces'].values())==99
for percent in (34.01,-1,101,float('nan'),33.333):
    fail('INVALID_QUOTA_ALLOCATION' if percent!=34.01 else 'QUOTA_ALLOCATION_EXCEEDED',lambda:plan('workspace/update',spaces[0]['id'],{'accountQuotas':{'account-one':{'weeklyPercent':percent,'fiveHourPercent':None}}}))
fail('QUOTA_ACCOUNT_NOT_ALLOWED',lambda:plan('workspace/update',spaces[0]['id'],{'accountQuotas':{'account-two':{'weeklyPercent':10,'fiveHourPercent':None}}}))
apply(plan('workspace/suspend',spaces[1]['id']))
fail('QUOTA_ALLOCATION_EXCEEDED',lambda:plan('workspace/update',spaces[0]['id'],{'accountQuotas':{'account-one':{'weeklyPercent':40,'fiveHourPercent':None}}}))
apply(plan('workspace/delete',spaces[1]['id']))
result=apply(plan('workspace/update',spaces[0]['id'],{'accountQuotas':{'account-one':{'weeklyPercent':60,'fiveHourPercent':None,'allowOverage':False}}}))
assert result['workspace']['accountQuotas']['account-one']['allowOverage'] is False
apply(plan('workspace/update',spaces[0]['id'],{'allowedAccountIds':['account-one','account-two'],'accountQuotas':{'account-one':{'weeklyPercent':60,'fiveHourPercent':None},'account-two':{'weeklyPercent':100,'fiveHourPercent':100}}}))
assert policies[-1]['workspaces'][0]['accountQuotas']['account-two']['weeklyPercent']==100
`);

const QUOTA_SETUP=String.raw`
from quota_accounting import QuotaAccounting,FULL,SCALE
spaces=[adopt(name) for name in ('one','two','three')]
a,b,c=[w['id'] for w in spaces]
for w,percent in zip(spaces,(10,60,30)):
    apply(plan('workspace/update',w['id'],{'allowedAccountIds':['account-one','account-two'],'accountQuotas':{'account-one':{'weeklyPercent':percent,'fiveHourPercent':percent},'account-two':{'weeklyPercent':percent,'fiveHourPercent':percent}}}))
data={};ledger=QuotaAccounting(data,control.state['workspaces']);at=clock[0];end=at+10080*60

def report(member=None,total=0,last=0,used=None,key='weekly',account='account-one',reset=None,phase=None):
    payload={'accountId':account,'accountGeneration':'ag','windows':[] if used is None else [{'window':key,'usedPercent':used,'resetsAt':reset or end}]}
    if member:payload.update(workspaceId=member,scope=member+'-scope',totalTokens=total,lastTokens=last)
    if phase:payload['phase']=phase
    return ledger.observe(payload,at)

def view(account='account-one',key='weekly'):
    return next(w for w in ledger.summary(account,'ag')['windows'] if w['window']==key)
report(used=0)
`;

pythonCase('overage borrows from the largest remaining donor and repays that exact source on refresh', QUOTA_SETUP+String.raw`
report(a,2000,2000,20)
w=view();assert w['debts']==[{'borrower':a,'lender':b,'percent':10}]
assert w['balances']=={a:0,b:50,c:30}
assert w['estimatedTotalTokens']==10000
report(a,2000,2000,20);assert view()['debts']==w['debts']
at=end+1;report(used=0,reset=end+10080*60)
w=view();assert w['debts']==[] and w['balances']=={a:0,b:70,c:30}
assert any(e['kind']=='repay' and e['borrower']==a and e['lender']==b and e['percent']==10 for e in next(iter(data.values()))['windows']['weekly']['entries'])
`);

pythonCase('unpaid loans carry to later cycles without crossing accounts or five-hour windows', QUOTA_SETUP+String.raw`
report(a,5000,5000,50)
assert view()['debts'][0]['percent']==40
report(used=0,key='fiveHour',reset=at+18000)
report(used=0,account='account-two')
assert all(w['window']=='weekly' for w in ledger.summary('account-one','ag')['windows'])
assert view()['debts'][0]['percent']==40 and view('account-two')['debts']==[]
at=end+1;report(used=0,reset=end+10080*60)
assert view()['debts'][0]['percent']==30
at=end+10080*60+1;report(used=0,reset=end+2*10080*60)
assert view()['debts'][0]['percent']==20
`);

pythonCase('disabled overage does not authorize loans and next-turn checks block exhausted shares', QUOTA_SETUP+String.raw`
control.state['workspaces'][a]['accountQuotas']['account-one']['allowOverage']=False
report(a,2000,2000,20)
w=view();assert w['debts']==[] and w['overrunPercent']==10
assert w['balances'][b]==60 and w['balances'][c]==30
assert ledger.check('account-one','ag',a,at)['allowed'] is False
control.state['workspaces'][a]['accountQuotas']['account-one']['allowOverage']=True
assert ledger.check('account-one','ag',a,at)['allowed'] is True
`);

pythonCase('concurrent producers settle together, resets and incomplete coverage never fabricate a conversion', QUOTA_SETUP+String.raw`
report(a,phase='begin');report(b,phase='begin')
report(a,1000,1000,10,phase='finish')
assert view()['samples']==0 and view()['debts']==[]
report(b,1000,1000,20,phase='finish')
w=view();assert w['samples']==1 and w['estimatedTotalTokens']==10000
assert w['balances'][a]==0 and w['balances'][b]==50 and w['debts']==[]
report(used=21)
assert view()['unassignedPercent']==1
report(used=2,reset=end+1)
assert view()['estimatedTotalTokens'] is None
assert any(e['kind']=='uncertain-reset' for e in next(iter(data.values()))['windows']['weekly']['entries'])
`);

pythonCase('allocation edits wait until the next refresh and turning off overage preserves debt', QUOTA_SETUP+String.raw`
report(a,2000,2000,20)
control.state['workspaces'][a]['accountQuotas']['account-one']={'weeklyPercent':20,'fiveHourPercent':20,'allowOverage':False}
control.state['workspaces'][b]['accountQuotas']['account-one']['weeklyPercent']=50
assert view()['balances'][a]==0 and view()['debts'][0]['percent']==10
assert ledger.check('account-one','ag',a,at)['allowed'] is False
at=end+1;report(used=0,reset=end+10080*60)
assert view()['balances']=={a:10,b:60,c:30} and view()['debts']==[]
`);

pythonCase('shared quota IPC binds kernel UID and persists numeric records without a member admin key', String.raw`
from quota_service import member_request
spaces=[adopt(name) for name in ('one','two')];a,b=[w['id'] for w in spaces]
for w in spaces:apply(plan('workspace/update',w['id'],{'accountQuotas':{'account-one':{'weeklyPercent':50,'fiveHourPercent':None}}}))
context=member_request(control,1000,{'method':'quota/context','params':{'accountId':'account-one'}})
assert context['workspaceId']==a and context['allocation']['allowOverage'] is True
fail('UNAUTHORIZED',lambda:member_request(control,1000,{'method':'workspace/delete','params':{}}))
fail('UNAUTHORIZED',lambda:member_request(control,1000,{'method':'quota/observe','params':{'payload':{'accountId':'account-one','accountGeneration':'ag','workspaceId':b,'scope':'s','totalTokens':100,'lastTokens':100}}}))
fail('QUOTA_ACCOUNT_NOT_ALLOWED',lambda:member_request(control,1000,{'method':'quota/context','params':{'accountId':'other'}}))
member_request(control,1000,{'method':'quota/observe','params':{'payload':{'accountId':'account-one','accountGeneration':'ag','workspaceId':a,'scope':'s','totalTokens':100,'lastTokens':100,'windows':[{'window':'weekly','usedPercent':0,'resetsAt':clock[0]+604800}]}}})
restored=WorkspaceControl(config,provisioner,publish_policy=lambda value:None,now=lambda:clock[0])
assert restored.state['quotaLedger'] and 'messages' not in restored.state['quotaLedger']
assert member_request(restored,1000,{'method':'quota/read','params':{'accountId':'account-one','accountGeneration':'ag'}})['windows'][0]['balances'][a]==50
`);

pythonCase('rewound cumulative counters do not duplicate observations after recovery', QUOTA_SETUP+String.raw`
report(a,1000,1000,10)
report(a,500,500,10)
report(a,1100,100,11)
assert view()['sampleTokens']==1100
assert view()['samplePercent']==11
`);

pythonCase('discovered workspace destruction has an exact preview and never grants temporary access', String.raw`
raw={'name':'Existing one','username':'one','uid':1000,'root':'/home/one'}
before=(root/'one.keys').read_bytes()
preview=plan('workspace/delete',value=raw)
assert control.state['workspaces']=={} and provisioner.calls==[]
result=apply(preview)
assert result['state']=='applied',result
removed=result['workspace']
assert removed['status']=='deleted' and removed['allowedAccountIds']==[] and removed['devices']==[] and removed['invites']==[]
assert provisioner.calls==[('destroy','one')] and not (root/'one.keys').exists()
assert removed['deletion']['kind']=='purged' and 'one' not in provisioner.users
assert all(not row['enabled'] for policy in policies for row in policy['workspaces'] if row['uid']==1000)
fail('WORKSPACE_UNAVAILABLE',lambda:plan('workspace/delete',value=raw))
restored=apply(plan('workspace/create',value=values('one',False)))['workspace']
assert restored['id']!=removed['id'] and restored['generation']!=removed['generation']
assert (root/'one.keys').read_bytes()==b''
`);

pythonCase('discovered removal rejects system users changed identities and active managed duplicates', String.raw`
raw={'name':'Existing one','username':'one','uid':999,'root':'/home/one'}
fail('SYSTEM_IDENTITY_FORBIDDEN',lambda:plan('workspace/delete',value=raw))
raw['uid']=1001
fail('DISCOVERY_CHANGED',lambda:plan('workspace/delete',value=raw))
raw['uid']=1000
preview=plan('workspace/delete',value=raw)
provisioner.users['one']['uid']=1008
fail('DISCOVERY_CHANGED',lambda:apply(preview))
assert control.state['workspaces']=={} and provisioner.calls==[]
provisioner.users['one']['uid']=1000
active=adopt('one')
fail('WORKSPACE_EXISTS',lambda:plan('workspace/delete',value=raw))
fail('INVALID_REQUEST',lambda:plan('workspace/delete',active['id'],raw))
assert control.state['workspaces'][active['id']]['status']=='active'
`);

pythonCase('HTTP invitation expiry accepts all five desktop lifetimes and denies at the server boundary', String.raw`
workspace=adopt()
for ttl in (3600,21600,43200,86400,604800):
    invitation=invite(workspace['id'],ttl)
    record=control.state['invites'][invitation['inviteId']]
    assert record['expiresAtEpoch']==clock[0]+ttl
    clock[0]+=ttl
    fail('INVITE_UNAVAILABLE',lambda:enroll(invitation))
for ttl in (0,604801,True):
    fail('INVALID_REQUEST',lambda:plan('invite/create',workspace['id'],{'label':'invalid','ttlSeconds':ttl}))
`);

pythonCase('allocation deltas immediately preserve consumption and source-specific debts', QUOTA_SETUP+String.raw`
report(a,2000,2000,20)
control.state['workspaces'][a]['accountQuotas']['account-one']['weeklyPercent']=20
control.state['workspaces'][b]['accountQuotas']['account-one']['weeklyPercent']=50
ledger.reallocate()
w=view();assert w['balances'][a]==10 and w['balances'][b]==40
assert w['debts']==[{'borrower':a,'lender':b,'percent':10}]
ledger.reallocate();assert view()==w
control.state['workspaces'][a]['accountQuotas']['account-one']['weeklyPercent']=0
ledger.reallocate();assert view()['balances'][a]==-10
assert ledger.summary('account-one','ag')['allocations'][a]['weeklyPercent']==0
at=end+1;report(used=0,reset=end+10080*60)
assert view()['debts'][0]['lender']==b and view()['balances'][a]==0
`);

pythonCase('workspace update persists immediate quota reallocation without losing original debt', QUOTA_SETUP+String.raw`
report(a,2000,2000,20)
control.state['quotaLedger']=data
apply(plan('workspace/update',b,{'accountQuotas':{'account-one':{'weeklyPercent':50,'fiveHourPercent':60}}}))
apply(plan('workspace/update',a,{'accountQuotas':{'account-one':{'weeklyPercent':20,'fiveHourPercent':10}}}))
result=QuotaAccounting(control.state['quotaLedger'],control.state['workspaces']).summary('account-one','ag')
w=next(w for w in result['windows'] if w['window']=='weekly')
assert w['balances'][a]==10 and w['balances'][b]==40
assert w['debts']==[{'borrower':a,'lender':b,'percent':10}]
assert result['allocations'][a]['weeklyPercent']==20
`);

pythonCase('weekly reset restores consumed shares and clears reserve and overdraft attribution', QUOTA_SETUP+String.raw`
report(a,500,500,5)
assert view()['balances'][a]==5
at=end+1;report(used=0,reset=end+10080*60)
assert view()['balances']=={a:10,b:60,c:30}
assert view()['reserveUsed']=={} and view()['overdrafts']=={}
report(used=100,key='fiveHour',reset=at+18000)
assert view()['balances']=={a:10,b:60,c:30}
`);

pythonCase('mid-cycle baseline and unknown usage never charge unused workspaces', QUOTA_SETUP+String.raw`
data.clear();report(used=6)
assert view()['balances']=={a:10,b:60,c:30}
report(used=7)
assert view()['balances']=={a:10,b:60,c:30}
report(used=100)
assert ledger.check('account-one','ag',b,at)['allowed'] is False
`);

pythonCase('numeric history deduplicates live scope and calibrates only its original workspace', QUOTA_SETUP+String.raw`
data.clear();report(used=6)
row=dict(scope=a+'-scope',tokens=600,baselineTokens=600,resetsAt=end)
payload=dict(accountId='account-one',accountGeneration='ag',workspaceId=a,history=[row])
ledger.observe(payload,at);ledger.observe(payload,at)
assert ledger.summary('account-one','ag')['tokenTotals'][a]==600
assert view()['recoveredTokens']=={a:600} and view()['recoveredPercent']=={}
assert view()['balances'][b]==60
report(a,9000,200,8)
assert view()['recoveredPercent']=={a:6}
assert view()['balances'][a]==2 and view()['balances'][b]==60
ledger.observe(payload,at)
assert view()['balances'][a]==2
assert ledger.summary('account-one','ag')['tokenTotals'][a]==800
row['tokens']=800
ledger.observe(payload,at)
assert ledger.summary('account-one','ag')['tokenTotals'][a]==800
assert view()['sampleTokens']==200
at=end+1;report(used=0,reset=end+604800)
assert view()['recoveredTokens']=={} and view()['balances'][a]==10
`);

pythonCase('old proportional baseline is restored exactly once while debt is retained', QUOTA_SETUP+String.raw`
w=next(iter(data.values()))['windows']['weekly']
w.pop('attributionVersion');w['grantBase']=94*SCALE
w['balances']={a:9400000,b:56400000,c:28200000}
ledger=QuotaAccounting(data,control.state['workspaces'])
assert view()['balances']=={a:10,b:60,c:30}
ledger=QuotaAccounting(data,control.state['workspaces'])
assert view()['balances']=={a:10,b:60,c:30}
`);

pythonCase('member history uses the same authenticated namespace as live observations', String.raw`
from quota_service import member_request
spaces=[adopt(name) for name in ('one','two')];a,b=[w['id'] for w in spaces]
for w in spaces:apply(plan('workspace/update',w['id'],{'accountQuotas':{'account-one':{'weeklyPercent':50,'fiveHourPercent':None}}}))
payload=dict(accountId='account-one',accountGeneration='ag',history=[dict(scope='same',tokens=600,baselineTokens=600,resetsAt=clock[0]+604800)])
def send(uid,p):return member_request(control,uid,dict(method='quota/observe',params=dict(payload=p)))
send(1000,payload);send(1000,payload);send(1001,payload)
result=send(1000,dict(accountId='account-one',accountGeneration='ag',scope='same',totalTokens=9000,lastTokens=100))
assert result['tokenTotals']=={a:700,b:600}
fail('UNAUTHORIZED',lambda:send(1000,dict(payload,workspaceId=b)))
`);

pythonCase('account IDs and generations isolate member history, windows and balances', QUOTA_SETUP+String.raw`
from quota_service import member_request
control.state['quotaLedger']=data
report(a,1000,1000,10)
report(used=0,account='account-two')
assert view('account-two')['balances']=={a:10,b:60,c:30}
assert ledger.summary('account-two','ag')['tokenTotals']=={}
assert ledger.summary('account-one','new-generation')['windows']==[]
assert ledger.summary('account-one','new-generation')['tokenTotals']=={}
result=member_request(control,1001,dict(method='quota/read',params=dict(accountId='account-one',accountGeneration='ag')))
assert set(result['allocations'])=={a,b,c}
assert result['tokenTotals'][a]==1000 and result['currentWorkspaceId']==b
assert result['windows']==ledger.summary('account-one','ag')['windows']
`);
