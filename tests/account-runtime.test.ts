import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {NATIVE_OWNER_REMOTE_BRIDGE} from '../services/codex-bridge/native-owner-remote';
import {CODEX_REMOTE_BRIDGE} from '../services/codex-bridge/remote';
import {assertSameBinding} from '../packages/session-core';
import type {SessionBinding} from '../packages/contracts';
import {parseCodexNativeChildEvents} from '../packages/collaboration-core/events';
import {decodeNativeFrame} from '../services/remote-supervisor';

const setup=String.raw`
import sys,os,json,tempfile,pathlib,types,copy
try: import fcntl
except ImportError: sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
from broker import AccountBroker, BrokerError
from runtime import AccountRuntimeState, CodexSessionFence, NativeAccountRuntime, RuntimeErrorCode
with tempfile.TemporaryDirectory() as temporary:
    identity={'authorityId':'fixture','generation':'generation'}
    policy={'schemaVersion':1,**identity,'revision':1,'workspaces':[{'workspaceId':name,'uid':uid,'enabled':True,'allowedAccountIds':['account'],'runtimes':['codex','claude']} for name,uid in [('one',1001),('two',1002)]]}
    cfg={**identity,'ownerUid':2000,'root':temporary,'codexExecutable':os.path.abspath('/fixture/codex'),'workspacePolicyFile':'/fixture/policy'}
    broker=AccountBroker(cfg,policy_reader=lambda _:copy.deepcopy(policy))
    account=broker.registry.add('account',{'status':'authenticated','email':'fixture@example.invalid'})
    runtime=NativeAccountRuntime(broker,cfg,probe=lambda _:dict(installed=True,authenticated=True,versionMatched=True,quotaAvailable=True,execution='local-executor-required'))
    binding={'environmentId':'local-device','cwd':'C:\\Fixture','execServerUrl':'ws://127.0.0.1:12345/'+'a'*64}
    receipt={}
    fence=CodexSessionFence(binding,receipt,lambda:None,lambda:runtime.authorize(1001,'account',account['generation']))
    def error(code,fn):
        try:fn()
        except (RuntimeErrorCode,BrokerError) as e:assert str(e)==code,(str(e),code)
        else:raise AssertionError('Expected '+code)
    def req(method,params=None,i=1):return fence.before({'id':i,'method':method,'params':params or {}})
    def response(i,result):return fence.after({'id':i,'result':result})
    req('initialize',i=0);response(0,{})
    def root():
        req('thread/start',{'environments':[{'environmentId':'local-device','cwd':binding['cwd']}]})
        response(1,{'thread':{'id':'root'}})
    CASE
`;
function python(name:string,body:string){test(name,()=>{const result=spawnSync('python',['-B','-c',setup.replace('    CASE',body.split('\n').map(l=>'    '+l).join('\n')),path.resolve('services/vps-account-broker')],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(result.status,0,result.stderr||result.stdout);});}

python('native steering is fenced to the running owned turn and settings cannot mutate execution identity',String.raw`
root()
assert req('thread/settings/update',{'threadId':'root','approvalPolicy':'never','sandboxPolicy':{'type':'readOnly','networkAccess':False}},2)
response(2,{})
error('MANAGED_CONFIGURATION',lambda:req('thread/settings/update',{'threadId':'root','cwd':'/other'},3))
error('THREAD_NOT_OWNED',lambda:req('thread/settings/update',{'threadId':'foreign'},4))
error('TURN_NOT_OWNED',lambda:req('turn/steer',{'threadId':'root','expectedTurnId':'turn'},5))
receipt.update(active=True,turnId='turn')
assert req('turn/steer',{'threadId':'root','expectedTurnId':'turn','clientUserMessageId':'fixture','input':[{'type':'text','text':'Explicit correction'}]},6)
error('TURN_NOT_OWNED',lambda:req('turn/steer',{'threadId':'root','expectedTurnId':'old'},7))
error('MANAGED_CONFIGURATION',lambda:req('turn/steer',{'threadId':'root','expectedTurnId':'turn','permissions':'all'},8))
`);

python('native runtime uses live grants and runtime authorization for existing and new sessions',String.raw`
assert runtime.authorize(1001,'account')[0]=='one'
policy['workspaces'][0]['runtimes']=[]
error('RUNTIME_NOT_ENABLED',lambda:runtime.authorize(1001,'account'))
assert runtime.authorize(0,'account')[0]=='administrator'
policy['workspaces'][0]['runtimes']=['codex']
policy['workspaces'][0]['allowedAccountIds']=[]
error('ACCOUNT_FORBIDDEN',lambda:runtime.authorize(1001,'account'))
assert runtime.authorize(1002,'account')[0]=='two'
`);
python('native account status works during a healthy session without serializing the account',String.raw`
runtime.active['other-session']={'accountId':'account'}
assert runtime.status(1001,'account')['authenticated']
assert runtime.status(1001,'account')['block'] is None
`);

python('member status clears only a natively verified recovered limit without administrator unlock',String.raw`
runtime.state.block(account,'rate_limited')
runtime.probe=lambda _:dict(installed=True,authenticated=True,versionMatched=True,quotaAvailable=False,execution='local-executor-required')
assert runtime.status(1001,'account')['block']['reason']=='rate_limited'
runtime.probe=lambda _:dict(installed=True,authenticated=True,versionMatched=True,quotaAvailable=True,execution='local-executor-required')
assert runtime.status(1001,'account')['block'] is None
runtime.state.check(account)
runtime.state.block(account,'billing_review')
assert runtime.status(1001,'account')['block']['reason']=='billing_review'
`);
python('provider selections remain independent including Claude-first restart',String.raw`
claude=broker.registry.add('claude-account',{'status':'authenticated'},provider='claude')
for row in policy['workspaces']:row['allowedAccountIds'].append('claude-account')
broker.registry.select('one','claude-account',0)
reopened=AccountBroker(cfg,policy_reader=lambda _:copy.deepcopy(policy))
assert reopened.registry.catalog('one')['selectedClaudeAccountId']=='claude-account'
assert 'selectedAccountId' not in reopened.registry.catalog('one')
reopened.registry.select('one','account',0)
view=reopened.registry.catalog('one')
assert view['selectedAccountId']=='account' and view['selectedClaudeAccountId']=='claude-account'
assert view['selectionRevision']==view['claudeSelectionRevision']==1
`);
python('old owned thread can resume and continue without replaying prior text',String.raw`
receipt.update(threadId='old-root',turnId='finished-turn',active=False)
req('thread/read',{'threadId':'old-root','includeTurns':False},1)
response(1,{'thread':{'id':'old-root'}})
req('thread/resume',{'threadId':'old-root','environments':[{'environmentId':'local-device','cwd':binding['cwd']}]},2)
response(2,{'thread':{'id':'old-root'}})
message=req('turn/start',{'threadId':'old-root','input':[{'type':'text','text':'Only the next message'}],'environments':[{'environmentId':'local-device','cwd':binding['cwd']}]},3)
assert message['params']['input'][0]['text']=='Only the next message'
assert receipt['threadId']=='old-root' and receipt['active']
`);
python('a changed default does not rebind an old owned native session',String.raw`
root()
broker.registry.add('second',{'status':'authenticated'})
policy['workspaces'][0]['allowedAccountIds'].append('second')
broker.registry.select('one','second',0)
assert req('turn/start',{'threadId':'root','environments':[{'environmentId':'local-device','cwd':binding['cwd']}]},2)
assert receipt['threadId']=='root'
`);
python('session cannot read resume interrupt or approve another session',String.raw`
root()
error('THREAD_NOT_OWNED',lambda:req('thread/read',{'threadId':'foreign'},2))
error('THREAD_NOT_OWNED',lambda:req('thread/resume',{'threadId':'foreign','environments':[{'environmentId':'local-device','cwd':binding['cwd']}]},3))
error('TURN_NOT_OWNED',lambda:req('turn/interrupt',{'threadId':'root','turnId':'foreign'},4))
error('APPROVAL_NOT_OWNED',lambda:fence.before({'id':99,'result':{'decision':'accept'}}))
`);
python('fence preserves explicit model and permission options and fixed real device',String.raw`
params={'environments':[{'environmentId':'local-device','cwd':binding['cwd']}],'model':'native-selected','approvalPolicy':'never','sandbox':'danger-full-access'}
assert req('thread/start',params)['params']==params
response(1,{'thread':{'id':'root'}})
error('ENVIRONMENT_MISMATCH',lambda:req('turn/start',{'threadId':'root','environments':[{'environmentId':'remote','cwd':'/root'}]},2))
error('UNSUPPORTED_RUNTIME_REQUEST',lambda:req('account/login/start',{'type':'apiKey'},3))
assert not receipt.get('active')
`);
python('native child tools retain capacity and approvals without an outer agent limit',String.raw`
root()
for i in range(100):
    child='child-'+str(i)
    fence.after({'method':'item/completed','params':{'threadId':'root','item':{'type':'collabAgentToolCall','tool':'spawnAgent','receiverThreadIds':[child]}}})
    fence.after({'id':1000+i,'method':'item/tool/call','params':{'threadId':child,'turnId':'child-turn','tool':'peer_read'}})
    assert fence.before({'id':1000+i,'result':{'success':True}})
assert len(fence.children)==100
error('NATIVE_THREAD_NOT_OWNED',lambda:fence.after({'id':3000,'method':'item/tool/call','params':{'threadId':'foreign'}}))
`);

python('native thread parent receipt admits early nested child tools before spawn completion',String.raw`
root()
fence.after({'method':'thread/started','params':{'thread':{'id':'child','parentThreadId':'root'}}})
fence.after({'method':'thread/started','params':{'thread':{'id':'nested','parentThreadId':'child'}}})
assert fence.after({'id':80,'method':'item/tool/call','params':{'threadId':'nested','tool':'peer_read'}})
assert fence.before({'id':80,'result':{'success':True}})
error('NATIVE_THREAD_NOT_OWNED',lambda:fence.after({'method':'thread/started','params':{'thread':{'id':'foreign','parentThreadId':'someone-else'}}}))
`);

test('desktop recognizes pinned native parent-thread metadata before child tool events',()=>{
 const frame=decodeNativeFrame(Buffer.from(JSON.stringify({method:'thread/started',params:{thread:{id:'child',parentThreadId:'parent'}}})+'\n'));
 assert.deepEqual(parseCodexNativeChildEvents(frame),[{runtime:'codex',nativeParentId:'parent',nativeChildId:'child',operation:'spawn',status:'started'}]);
});
python('fast native completion before turn receipt leaves next turn usable',String.raw`
root()
params={'threadId':'root','environments':[{'environmentId':'local-device','cwd':binding['cwd']}]}
req('turn/start',params,2)
fence.after({'method':'turn/completed','params':{'threadId':'root','turn':{'id':'turn','status':'completed'}}})
response(2,{'turn':{'id':'turn'}})
assert receipt['active'] is False
req('turn/start',params,3)
error('DUPLICATE_REQUEST',lambda:req('turn/start',params,3))
`);
python('uncertain disconnect and service restart never replay an active turn',String.raw`
root()
params={'threadId':'root','environments':[{'environmentId':'local-device','cwd':binding['cwd']}]}
req('turn/start',params,2);response(2,{'turn':{'id':'pending'}})
runtime.state.state['sessions']['receipt']=receipt
runtime.state.save()
restored=AccountRuntimeState(temporary)
assert restored.state['sessions']['receipt']['uncertain']
fence.disconnected()
error('TURN_ACTIVE_OR_UNCERTAIN',lambda:req('turn/start',params,3))
req('thread/read',{'threadId':'root','includeTurns':True},4)
response(4,{'thread':{'id':'root','turns':[{'id':'pending','status':'completed'}]}})
assert req('turn/start',params,5)
`);
python('native retries and ordinary network failures do not permanently disable an account',String.raw`
for kind in ['rateLimitExceeded','serverOverloaded',{'responseStreamConnectionFailed':{'httpStatusCode':503}},'contextWindowExceeded']:
    runtime.native_failure(account,{'method':'error','params':{'error':{'codexErrorInfo':kind},'willRetry':False}})
    runtime.state.check(account)
runtime.native_failure(account,{'method':'error','params':{'error':{'codexErrorInfo':'usageLimitExceeded'},'willRetry':True}})
runtime.state.check(account)
runtime.native_failure(account,{'method':'item/completed','params':{'item':{'text':'usageLimitExceeded'}}})
runtime.state.check(account)
`);

python('an older completed turn cannot settle a new submission whose receipt was lost',String.raw`
receipt.update(threadId='root',turnId='previous-turn',active=False)
req('turn/start',{'threadId':'root','environments':[{'environmentId':'local-device','cwd':binding['cwd']}]},2)
assert 'turnId' not in receipt
fence.disconnected()
req('thread/turns/list',{'threadId':'root'},3)
response(3,{'data':[{'id':'previous-turn','status':'completed'}]})
assert receipt['uncertain']
error('TURN_ACTIVE_OR_UNCERTAIN',lambda:req('turn/start',{'threadId':'root','environments':[{'environmentId':'local-device','cwd':binding['cwd']}]},4))
`);

python('lost empty thread creation does not permanently block a session that submitted no turn',String.raw`
req('thread/start',{'environments':[{'environmentId':'local-device','cwd':binding['cwd']}]},2)
fence.disconnected()
assert not receipt.get('uncertain') and not receipt['rootPending']
restored=CodexSessionFence(binding,receipt,lambda:None,lambda:None)
restored.before({'id':0,'method':'initialize'})
assert restored.before({'id':1,'method':'thread/start','params':{'environments':[{'environmentId':'local-device','cwd':binding['cwd']}]}})
assert receipt['rootPending']
runtime.state.state['sessions']['pending']=receipt
runtime.state.save()
reopened=AccountRuntimeState(temporary)
assert not reopened.state['sessions']['pending']['rootPending']
assert not reopened.state['sessions']['pending'].get('uncertain')
`);

python('corrupt nested runtime receipts and duplicate state keys fail closed',String.raw`
target=pathlib.Path(temporary)/'runtime-state.json'
for raw in ['{"blocks":{},"blocks":{},"sessions":{}}','{"blocks":{},"sessions":{"x":[]}}','{"blocks":{"x":{"reason":"unknown","observedAt":1}},"sessions":{}}','{"blocks":{},"sessions":{"x":{"active":"false"}}}']:
    target.write_text(raw)
    error('RUNTIME_STATE_INVALID',lambda:AccountRuntimeState(temporary))
`);
python('confirmed native quota block is shared persists restart and clears only on verified recovery',String.raw`
runtime.native_failure(account,{'method':'turn/completed','params':{'turn':{'error':{'codexErrorInfo':'usageLimitExceeded'}}}})
error('ACCOUNT_RATE_LIMITED',lambda:runtime.state.check(account))
restored=AccountRuntimeState(temporary)
error('ACCOUNT_RATE_LIMITED',lambda:restored.check(account))
error('ACCOUNT_REVIEW_REQUIRED',lambda:restored.clear_after_review(account,True,False))
restored.clear_after_review(account,True,True)
restored.check(account)
assert NativeAccountRuntime.quota_available({'rateLimitsByLimitId':None,'rateLimits':{'primary':{'usedPercent':0}}})
assert not NativeAccountRuntime.quota_available({'rateLimits':{'primary':{'usedPercent':100}}})
`);
python('changed native identity rotates generation instead of reusing old sessions',String.raw`
error('ACCOUNT_IDENTITY_CHANGED',lambda:runtime.observe_identity(account,{'status':'authenticated','email':'different@example.invalid'}))
assert broker.registry.state['accounts']['account']['generation']!=account['generation']
error('ACCOUNT_FORBIDDEN',lambda:runtime.authorize(1001,'account',account['generation']))
`);

test('managed bridge has no credential RPC or legacy fallback and both Python sources parse',()=>{
 const result=spawnSync('python',['-B','-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:NATIVE_OWNER_REMOTE_BRIDGE,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
 assert.match(NATIVE_OWNER_REMOTE_BRIDGE,/runtime\/open/);
 for(const forbidden of ['chatgptAuthTokens','CODEX_HOME',"'tokens'",'/run/codex-device-auth',"subprocess.Popen"])assert.ok(!NATIVE_OWNER_REMOTE_BRIDGE.includes(forbidden),forbidden);
 assert.equal(CODEX_REMOTE_BRIDGE,NATIVE_OWNER_REMOTE_BRIDGE); // Old import name has no alternate implementation.
});
test('old saved bindings cannot be silently migrated to native-owner',()=>{
 const old:SessionBinding={runtime:'codex',provider:'openai',accountRef:'original',executionId:'local-device',egress:'vps',hostId:'h',nativeSessionId:'old-thread'};
 assert.doesNotThrow(()=>assertSameBinding(old,{...old}));
 assert.throws(()=>assertSameBinding(old,{...old,accountRuntime:'native-owner'}),/immutable/);
 assert.throws(()=>assertSameBinding(old,{...old,nativeSessionId:'new-thread'}),/immutable/);
});

python('verified native child ownership survives disconnection and migration receipts',String.raw`
root()
fence.after({'method':'thread/started','params':{'thread':{'id':'restored-child','parentThreadId':'root'}}})
assert receipt['childThreadIds']==['restored-child']
restored=CodexSessionFence(binding,receipt,lambda:None,lambda:None)
message={'id':'approval','method':'item/commandExecution/requestApproval','params':{'threadId':'restored-child'}}
assert restored.after(message)==message
error('NATIVE_THREAD_NOT_OWNED',lambda:restored.after({'id':'foreign','method':'item/commandExecution/requestApproval','params':{'threadId':'foreign-child'}}))
`);

python('native fork binds one exact source boundary and keeps the target independent',String.raw`
receipt['fork']={'sourceSessionId':'11111111-1111-1111-1111-111111111111','threadId':'source','lastTurnId':'turn-one'}
params={'threadId':'source','lastTurnId':'turn-one','excludeTurns':True,'deferGoalContinuation':True}
error('FORK_REQUIRED',lambda:req('thread/start',{'environments':[{'environmentId':'local-device','cwd':binding['cwd']}]},1))
error('FORK_BOUNDARY_MISMATCH',lambda:req('thread/fork',dict(params,lastTurnId='later'),2))
error('FORK_BOUNDARY_MISMATCH',lambda:req('thread/fork',dict(params,path='/unowned/history'),2))
error('FORK_BOUNDARY_MISMATCH',lambda:req('thread/fork',dict(params,deferGoalContinuation=False),2))
assert req('thread/fork',params,2)['params']==params
fence.after({'method':'thread/started','params':{'thread':{'id':'child','parentThreadId':None,'forkedFromId':'source'}}})
response(2,{'thread':{'id':'child','forkedFromId':'source'}})
assert receipt['threadId']=='child' and not receipt['rootPending']
error('THREAD_NOT_OWNED',lambda:req('thread/read',{'threadId':'source'},3))
error('THREAD_ALREADY_BOUND',lambda:req('thread/fork',params,3))
req('turn/start',{'threadId':'child','environments':[{'environmentId':'local-device','cwd':binding['cwd']}],'input':[{'type':'text','text':'new explicit input'}]},3)
response(3,{'turn':{'id':'new-turn'}})
assert receipt['turnId']=='new-turn'
assert not receipt.get('forkAwaitingInput')
fence.after({'method':'turn/completed','params':{'threadId':'child','turn':{'id':'new-turn','status':'completed'}}})
fence.after({'method':'turn/started','params':{'threadId':'child','turn':{'id':'native-goal-continuation'}}})
assert receipt['turnId']=='native-goal-continuation'
`);
python('native fork rejects unknown source and unrequested automatic continuations',String.raw`
error('FORK_NOT_BOUND',lambda:req('thread/fork',{'threadId':'other'},1))
receipt['fork']={'sourceSessionId':'11111111-1111-1111-1111-111111111111','threadId':'source','beforeTurnId':'turn-two'}
req('thread/fork',{'threadId':'source','beforeTurnId':'turn-two','excludeTurns':True,'deferGoalContinuation':True},1)
error('FORK_IDENTITY_MISMATCH',lambda:fence.after({'method':'thread/started','params':{'thread':{'id':'source','parentThreadId':None,'forkedFromId':'source'}}}))
fence.after({'method':'thread/started','params':{'thread':{'id':'child','parentThreadId':None,'forkedFromId':'source'}}})
error('UNREQUESTED_FORK_TURN',lambda:fence.after({'method':'turn/started','params':{'threadId':'child','turn':{'id':'automatic'}}}))
`);
python('lost fork acknowledgement is fenced and never silently replayed',String.raw`
receipt['fork']={'sourceSessionId':'11111111-1111-1111-1111-111111111111','threadId':'source','lastTurnId':'turn-one'}
params={'threadId':'source','lastTurnId':'turn-one','excludeTurns':True,'deferGoalContinuation':True}
req('thread/fork',params,1)
fence.disconnected()
assert receipt['forkUncertain'] and not receipt['rootPending']
error('FORK_RESULT_UNCERTAIN',lambda:req('thread/fork',params,2))
assert 'threadId' not in receipt
`);
python('fork ownership checks the source workspace, account, identity, directory and settled state',String.raw`
import hashlib
source_id='11111111-1111-1111-1111-111111111111'
bound={'uid':1001,'accountId':account['id'],'accountGeneration':account['generation'],'sessionId':'22222222-2222-2222-2222-222222222222','environmentId':'local-device','cwd':binding['cwd'],'fork':{'sourceSessionId':source_id,'threadId':'source','lastTurnId':'one'}}
source={k:v for k,v in bound.items() if k!='fork'};source.update(sessionId=source_id,threadId='source')
key=hashlib.sha256((runtime.state.account_key(account)+':one:'+source_id).encode()).hexdigest()
runtime.state.state['sessions'][key]=source
runtime.state.verify_fork_source(account,'one',bound)
error('FORK_SOURCE_NOT_OWNED',lambda:runtime.state.verify_fork_source(account,'two',bound))
for field,value in [('uid',1002),('accountGeneration','other'),('cwd','C:/Other'),('environmentId','other')]:
    error('FORK_SOURCE_NOT_OWNED',lambda:runtime.state.verify_fork_source(account,'one',dict(bound,**{field:value})))
source['active']=True
error('FORK_SOURCE_NOT_SETTLED',lambda:runtime.state.verify_fork_source(account,'one',bound))
runtime.state.verify_fork_source(account,'one',bound,require_settled=False)
source['active']=False
source['uncertain']=True
error('FORK_SOURCE_NOT_SETTLED',lambda:runtime.state.verify_fork_source(account,'one',bound))
`);
python('restart preserves an uncertain fork without inventing a new native thread',String.raw`
fork={'sourceSessionId':'11111111-1111-1111-1111-111111111111','threadId':'source','lastTurnId':'turn-one'}
runtime.state.state['sessions']['pending-fork']={'fork':fork,'rootPending':True}
runtime.state.state['sessions']['observed-fork']={'fork':fork,'rootPending':True,'threadId':'child'}
runtime.state.save()
reloaded=AccountRuntimeState(temporary)
assert reloaded.state['sessions']['pending-fork']['forkUncertain']
assert not reloaded.state['sessions']['observed-fork'].get('forkUncertain')
assert reloaded.state['sessions']['observed-fork']['threadId']=='child'
`);
