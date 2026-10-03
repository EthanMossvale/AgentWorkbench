import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {PORTABLE_ENROLL,portablePrepareScript} from '../packages/workspace-control/portable-script';
import {workspaceExportTtl} from '../packages/workspace-control/export-policy';

test('export policy accepts custom positive integer durations and defaults to one hour',()=>{
 assert.equal(workspaceExportTtl(),3600);
 for(const ttl of [3600,21600,43200,86400,604800,3601,604801])assert.equal(workspaceExportTtl(ttl),ttl);
 for(const value of [null,'3600',true,0,-1,1.5,Infinity,NaN])assert.throws(()=>workspaceExportTtl(value));
});

test('shipped Python computes all deadlines on the issuer clock and rejects redemption at the boundary',()=>{
 const program=String.raw`
import sys,json,types,io,base64,struct
sys.modules['fcntl']=types.SimpleNamespace()
sys.modules['pwd']=types.SimpleNamespace(getpwuid=lambda uid:types.SimpleNamespace(pw_name='member'))
payload=json.loads(sys.stdin.read());scope={}
exec(payload['prepare'].split('try:main()')[0],scope)
scope['time'].time=lambda:1700000000
for ttl in (3600,21600,43200,86400,604800,3599,604801):
    assert scope['invitation_window'](ttl)==(1700000000,1700000000+ttl)
for ttl in (True,0,-1,1.5,'3600'):
    try:scope['invitation_window'](ttl)
    except ValueError:pass
    else:raise AssertionError('Unsupported TTL accepted')
exec(payload['enroll'],scope)
scope['os'].geteuid=lambda:1001
scope['require_enabled']=lambda *args:None
calls=[]
scope['edit_keys']=lambda *args:calls.append(args)
key='ssh-ed25519 '+base64.b64encode(struct.pack('>I',11)+b'ssh-ed25519'+struct.pack('>I',32)+b'x'*32).decode()
binding={'id':'fixture','uid':1001,'username':'member','expires':1700003600}
for now,allowed in ((1700003599,True),(1700003600,False),(1700003601,False)):
    scope['time'].time=lambda:now
    scope['sys'].stdin=types.SimpleNamespace(buffer=io.BytesIO(json.dumps({'publicKey':key,'deviceLabel':'Fixture'}).encode()))
    before=len(calls)
    try:scope['enroll'](binding)
    except ValueError:assert not allowed
    else:assert allowed
    assert len(calls)==before+int(allowed)
`;
 const result=spawnSync('python',['-B','-c',program],{input:JSON.stringify({prepare:portablePrepareScript(PORTABLE_ENROLL),enroll:PORTABLE_ENROLL}),encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);
});
