import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const setup=String.raw`
import sys,os,json,tempfile,types,copy,io,threading,contextlib
try: import fcntl
except ImportError: sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
from broker import AccountBroker,BrokerError
from runtime import NativeAccountRuntime,RuntimeErrorCode
import claude_session as module
from claude_session import validate,ClaudeSessionFence,serve
with tempfile.TemporaryDirectory() as folder:
    policy={'schemaVersion':1,'authorityId':'a','generation':'g','revision':1,'workspaces':[{'workspaceId':'w','uid':1001,'enabled':True,'allowedAccountIds':['c'],'runtimes':['claude']}]}
    cfg={'authorityId':'a','generation':'g','ownerUid':2000,'root':folder,'workspacePolicyFile':'/fixture/policy'}
    broker=AccountBroker(cfg,policy_reader=lambda _:copy.deepcopy(policy))
    account=broker.registry.add('c',{'status':'authenticated'},provider='claude')
    runtime=NativeAccountRuntime(broker,cfg,probe=lambda _:dict(authenticated=True))
    runtime.maintenance.admit=lambda:None
    broker.runtime=runtime
    params={'authorityId':'a','generation':'g','accountId':'c','accountGeneration':account['generation'],'sessionId':'00000000-0000-4000-8000-000000000001','environmentId':'local-device','cwd':'C:\\fixture','toolServerUrl':'http://127.0.0.1:23456/'+'a'*48+'/mcp','toolToken':'a'*64,'selection':{'model':'sonnet','effort':'high'},'permissionMode':'default'}
    def error(code,fn):
        try:fn()
        except (RuntimeErrorCode,BrokerError) as e:assert str(e)==code,(str(e),code)
        else:raise AssertionError('Expected '+code)
    CASE
`;
function python(name:string,body:string){test(name,()=>{const run=spawnSync('python',['-B','-c',setup.replace('    CASE',body.split('\n').map(l=>'    '+l).join('\n')),path.resolve('services/vps-account-broker')],{windowsHide:true,encoding:'utf8',timeout:12000});assert.equal(run.status,0,run.stderr||run.stdout);});}
python('Claude owner validates strict local MCP, permission and model bindings before startup',String.raw`
validate(params)
for changed in [{'toolServerUrl':'https://external.invalid/mcp'},{'toolToken':'short'},{'environmentId':'remote'},{'cwd':'bad\npath'},{'extra':True}]:
    error('INVALID_RUNTIME_BINDING',lambda:validate(dict(params,**changed)))
error('CLAUDE_MODEL_SELECTION_INVALID',lambda:validate(dict(params,selection={'model':'--malicious argument'})))
error('CLAUDE_PERMISSION_MODE_INVALID',lambda:validate(dict(params,permissionMode='auto')))
error('INVALID_RUNTIME_BINDING',lambda:serve(runtime,0,params,None,None))
params['accountGeneration']='stale';error('ACCOUNT_FORBIDDEN',lambda:serve(runtime,1001,params,None,None))
assert not runtime.active
`);
python('Claude fence correlates approvals, permissions and input IDs without replay or unowned controls',String.raw`
receipt={'threadId':'root','sessionId':params['sessionId']};saved=[];admitted=[]
fence=ClaudeSessionFence(receipt,lambda:saved.append(copy.deepcopy(receipt)),lambda:admitted.append(True))
user={'type':'user','uuid':'00000000-0000-4000-8000-000000000002','session_id':'root','parent_tool_use_id':None,'message':{'role':'user','content':'Synthetic only'}}
fence.before(user);assert receipt['active']
error('CLAUDE_INPUT_DUPLICATE_OR_INVALID',lambda:fence.before(user))
error('CLAUDE_INPUT_BINDING_INVALID',lambda:fence.before(dict(user,session_id='other')))
fence.after({'type':'control_request','request_id':'approval','request':{'subtype':'can_use_tool','tool_name':'mcp__local_device__Write'}})
fence.before({'type':'control_response','response':{'subtype':'success','request_id':'approval','response':{'behavior':'deny','message':'No'}}})
error('CLAUDE_APPROVAL_NOT_PENDING',lambda:fence.before({'type':'control_response','response':{'subtype':'success','request_id':'approval'}}))
error('CLAUDE_CONTROL_FORBIDDEN',lambda:fence.before({'type':'control_request','request_id':'auth','request':{'subtype':'mcp_set_servers'}}))
fence.before({'type':'control_request','request_id':'mode','request':{'subtype':'set_permission_mode','mode':'plan'}})
fence.after({'type':'control_response','response':{'subtype':'success','request_id':'mode','response':{'mode':'plan'}}})
assert not fence.pending
fence.after(dict(user));fence.after({'type':'result','subtype':'success','session_id':'root'});assert not receipt['active']
error('CLAUDE_SESSION_MISMATCH',lambda:fence.after({'type':'result','subtype':'success','session_id':'other'}))
assert len(admitted)==5
`);
python('Claude fence retains outstanding explicit input and marks disconnected work unknown',String.raw`
receipt={'threadId':'root','sessionId':params['sessionId']};fence=ClaudeSessionFence(receipt,lambda:None,lambda:None)
user={'type':'user','uuid':'00000000-0000-4000-8000-000000000002','session_id':'root','parent_tool_use_id':None,'message':{'role':'user','content':'Synthetic only'}}
fence.before(user);fence.after({'type':'result','subtype':'success','session_id':'root'});assert receipt['active']
fence.disconnected();assert receipt['uncertain'] and not receipt['active']
error('CLAUDE_INPUT_DUPLICATE_OR_INVALID',lambda:ClaudeSessionFence(receipt,lambda:None,lambda:None).before(user))
`);
python('Claude owner startup uses only initialize and confirms both native ownership and cleanup',String.raw`
sent=[];stopped=[];responses=[]
class Pipe:
    def __init__(self,*args):pass
    def send(self,value):
        sent.append(value)
        responses.append({'type':'control_response','response':{'subtype':'success','request_id':value['request_id'],'response':{'mcpServers':[{'name':'local_device','status':'connected','config':{'secret':'must-not-escape'}}]} if value['request']['subtype']=='mcp_status' else {}}})
    def receive(self,*args):
        if responses:return responses.pop(0)
        if args[-1].wait(.02):raise EOFError()
        raise TimeoutError()
module.NativePipe=Pipe
runtime.claude_factory=lambda *_:object()
runtime.stop=lambda process:stopped.append(process)
out=io.BytesIO();serve(runtime,1001,params,io.BytesIO(b'{"type":"workbench_close"}\n'),out)
values=[json.loads(line) for line in out.getvalue().splitlines()]
assert values[0]['ok'] and values[0]['value']['credentialOwner']=='native' and values[0]['value']['transport']=='official-mcp-v1'
assert values[-1]['params']['cleanupConfirmed'] is True
assert [s['request']['subtype'] for s in sent]==['initialize','mcp_status'] and not any(v.get('type')=='user' for v in sent)
assert 'must-not-escape' not in out.getvalue().decode()
assert len(stopped)==1 and not runtime.active and not runtime.maintenance.handles
receipt=next(iter(runtime.state.state['sessions'].values()));assert receipt['cleanupConfirmed']
assert params['toolToken'] not in json.dumps(runtime.state.state) and params['toolToken'] not in out.getvalue().decode()
`);
python('Claude owner failed startup cleanup keeps the admission fence until maintenance confirms termination',String.raw`
sent=[];stops=[]
class Pipe:
    def __init__(self,*args):pass
    def send(self,v):sent.append(v)
    def receive(self,*args):raise EOFError()
module.NativePipe=Pipe;runtime.claude_factory=lambda *_:object()
def fail_stop(p):stops.append(p);raise RuntimeErrorCode('NATIVE_CLEANUP_UNCONFIRMED')
runtime.stop=fail_stop
error('NATIVE_CLEANUP_UNCONFIRMED',lambda:serve(runtime,1001,params,io.BytesIO(),io.BytesIO()))
assert len(runtime.active)==1 and len(runtime.maintenance.handles)==1
assert next(iter(runtime.maintenance.handles.values()))['cleanupNeeded']
runtime.stop=lambda _:None
import resources
resources.policy=lambda:{'autoMemory':False}
runtime.maintenance.tick();assert not runtime.active and not runtime.maintenance.handles
assert len(sent)==1
`);
python('Claude launch preserves native auth and agents while keeping local tool tokens out of argv',String.raw`
import cli_guard,native_worker
from pathlib import Path
profile=Path(folder)/'synthetic-profile';profile.mkdir()
runtime.environment=lambda _:({'HOME':folder,'CLAUDE_CONFIG_DIR':str(profile),'CLAUDE_CODE_DISABLE_AUTO_MEMORY':'1'},str(profile))
runtime.executable=lambda _:'/opt/official-claude'
cli_guard.lease=lambda *_:contextlib.nullcontext()
class Guard:
    def __init__(self,*_):pass
    def _read_identity(self,_):return 'fixture'
native_worker.NativeCodexLogin=Guard
captured=[]
def popen(args,**kwargs):captured.append((args,kwargs));return types.SimpleNamespace(pid=123)
module.subprocess.Popen=popen
process=module.launch(runtime,account,params,{'threadId':'00000000-0000-4000-8000-000000000003'})
args,options=captured[0]
assert args[0]=='/opt/official-claude' and '--strict-mcp-config' in args and '--session-id' in args
assert 'Agent' in args[args.index('--tools')+1].split(',') and 'Bash' not in args[args.index('--tools')+1].split(',')
assert 'Bash' in args[args.index('--disallowedTools')+1].split(',')
assert '--disable-slash-commands' not in args
instructions=args[args.index('--append-system-prompt')+1]
assert all(name in instructions for name in ['LocalContext','LoadLocalSkill','RunLocalSkillCommand','StartLocalCommand','LocalTaskOutput','StopLocalTask','native Agent','local Read'])
assert json.loads(args[args.index('--settings')+1])['autoMemoryEnabled'] is False
assert json.loads(args[args.index('--settings')+1])['fastMode'] is False
assert options['env']['CLAUDE_CONFIG_DIR']==str(profile) and not any(k.startswith('ANTHROPIC_') for k in options['env'])
assert params['toolToken'] not in str(args)
config=json.loads(process.claude_tool_config.read_text());assert config['mcpServers']['local_device']['url']==params['toolServerUrl']
process.claude_tool_config.unlink()
params['selection']={'model':'opus[1m]','effort':'high','serviceTier':'priority'}
module.validate(params)
process=module.launch(runtime,account,params,{'threadId':'00000000-0000-4000-8000-000000000003'})
args,_=captured[1]
assert args[args.index('--model')+1]=='opus[1m]' and json.loads(args[args.index('--settings')+1])['fastMode'] is True
process.claude_tool_config.unlink()
params['selection']['serviceTier']='invented'
error('CLAUDE_MODEL_SELECTION_INVALID',lambda:module.validate(params))
`);
python('VPS background agents remain active after root completion and may request local tool approval',String.raw`
receipt={'threadId':'root','sessionId':params['sessionId']};fence=ClaudeSessionFence(receipt,lambda:None,lambda:None)
user={'type':'user','uuid':'00000000-0000-4000-8000-000000000002','session_id':'root','parent_tool_use_id':None,'message':{'role':'user','content':'Synthetic only'}}
fence.before(user);fence.after(user)
fence.after({'type':'system','subtype':'task_started','task_id':'native-child','session_id':'root'})
fence.after({'type':'result','subtype':'success','session_id':'root'})
assert receipt['active'] and receipt['activeChildren']==['native-child']
fence.after({'type':'control_request','request_id':'child-approval','parent_tool_use_id':'agent-call','request':{'subtype':'can_use_tool','tool_name':'mcp__local_device__Read'}})
fence.before({'type':'control_response','response':{'subtype':'success','request_id':'child-approval','response':{'behavior':'allow','updatedInput':{}}}})
fence.after({'type':'system','subtype':'task_notification','task_id':'native-child','status':'completed','session_id':'root'})
assert not receipt['active'] and not receipt['activeChildren']
`);
python('terminal Claude failure forbids another prompt on the current transport',String.raw`
receipt={'threadId':'root','sessionId':params['sessionId']};fence=ClaudeSessionFence(receipt,lambda:None,lambda:None)
user={'type':'user','uuid':'00000000-0000-4000-8000-000000000002','session_id':'root','parent_tool_use_id':None,'message':{'role':'user','content':'Synthetic only'}}
fence.before(user);fence.after({'type':'result','subtype':'error_during_execution','session_id':'root'})
error('CLAUDE_TRANSPORT_TERMINAL',lambda:fence.before(dict(user,uuid='00000000-0000-4000-8000-000000000003')))
assert len(receipt['inputIds'])==1
`);

python('Claude fork validates owner source, UUID boundary and independent resume identity',String.raw`
import hashlib
fork={'runtime':'claude','sourceSessionId':'00000000-0000-4000-8000-000000000002','threadId':'00000000-0000-4000-8000-000000000003','lastMessageId':'00000000-0000-4000-8000-000000000004'}
params['fork']=fork;validate(params)
workspace,_=runtime.authorize(1001,account['id'],account['generation'])
key=hashlib.sha256((runtime.state.account_key(account)+':'+workspace+':'+fork['sourceSessionId']).encode()).hexdigest()
error('NATIVE_FORK_SOURCE_UNVERIFIED',lambda:module.fork_receipt(runtime,account,workspace,1001,params))
source={'threadId':fork['threadId'],'uid':1001,'transport':'official-mcp-v1','environmentId':'local-device','nativeStarted':True}
runtime.state.state['sessions'][key]=source.copy()
receipt=dict(threadId=params['sessionId'],**module.fork_receipt(runtime,account,workspace,1001,params))
assert module.session_args(receipt)==['--resume',fork['threadId'],'--fork-session','--resume-session-at',fork['lastMessageId'],'--session-id',params['sessionId']]
receipt['nativeStarted']=True;assert module.session_args(receipt)==['--resume',params['sessionId']]
assert runtime.state.state['sessions'][key]==source
for changed in [{'uid':1002},{'threadId':'foreign'},{'uncertain':True},{'nativeStarted':False}]:
    runtime.state.state['sessions'][key]=dict(source,**changed)
    error('NATIVE_FORK_SOURCE_UNVERIFIED',lambda:module.fork_receipt(runtime,account,workspace,1001,params))
for changed in [{'lastMessageId':'bad'},{'runtime':'codex'},{'threadId':params['sessionId']},{'extra':True}]:
    error('NATIVE_FORK_BOUNDARY_UNVERIFIED',lambda:validate(dict(params,fork=dict(fork,**changed))))
`);
