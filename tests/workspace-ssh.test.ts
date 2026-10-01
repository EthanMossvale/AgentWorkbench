import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {workspaceSshScript} from '../packages/workspace-control/ssh-control';
const bootstrap=String.raw`
import sys,os,types,json,io,struct,base64
from unittest.mock import patch
sys.dont_write_bytecode=True
sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
import ssh_entry
os.geteuid=lambda:0
key='ssh-ed25519 '+base64.b64encode(struct.pack('>I',11)+b'ssh-ed25519'+struct.pack('>I',32)+b'x'*32).decode()
request={'protocol':1,'method':'workspace/list','params':{}}
connection={'hostname':'fixture.invalid','port':2222}
`;
test('SSH-only control lists an uninitialized VPS without filesystem mutation',()=>{const result=spawnSync('python',['-B','-c',bootstrap+String.raw`
ssh_entry.trusted_root_path=lambda value,**kw:value
def forbidden(*args,**kwargs):raise AssertionError('Read path must not mutate')
with patch('os.path.lexists',lambda value:False),patch('builtins.open',lambda *a,**kw:io.StringIO(key)),patch('os.mkdir',forbidden):
    result=ssh_entry.dispatch(request,connection)
assert result['ok'] and result['value']['transport']=='ssh' and result['value']['workspaces']==[]
os.geteuid=lambda:1000
try:ssh_entry.dispatch(request,connection)
except ssh_entry.ControlError as e:assert e.code=='UNAUTHORIZED'
else:raise AssertionError('Non-root control allowed')
`,path.resolve('services/vps-workspace-control')],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);});
test('SSH script transports bounded source on stdin and preserves request as data',()=>{const script=workspaceSshScript({protocol:1,method:'workspace/list',params:{}},'fixture.invalid',22);assert.ok(script.length>32000);const result=spawnSync('python',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:script,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.ok(!script.includes('identityFile'));});
