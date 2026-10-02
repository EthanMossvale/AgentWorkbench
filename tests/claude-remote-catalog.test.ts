import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {NativeRuntimeControl} from '../packages/workspace-control/native-runtime';
import {SshTransportError} from '../packages/ssh-transport';
import type {AccountCatalog,SshHost} from '../packages/contracts';
import {parseClaudeModels} from '../packages/runtime-claude/models';
import {officialAccountLaunch} from '../packages/model-management/native';
import {validateModelSelection} from '../packages/runtime-codex/models';
import type {Session} from '../packages/contracts';
test('SSH model discovery distinguishes transport failure from malformed service JSON without replay',async()=>{
 const host:SshHost={id:'w',name:'Fixture',hostname:'fixture.invalid',port:22,role:'workspace',username:'member',ownerId:'fixture',workspaceGeneration:'wg',identityFile:'unused',knownHostsFile:'unused'};
 const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'w',revision:1,selectionRevision:1,accounts:[{id:'c',generation:'cg',provider:'claude',status:'authenticated',observedAt:'now'}]};
 for(const [stderr,code] of [['Connection timed out during banner exchange','HANDSHAKE_TIMEOUT'],['UNPROTECTED PRIVATE KEY FILE!','LOCAL_KEY'],['Permission denied (publickey).','AUTH_REJECTED']]){
  let calls=0;const service=new NativeRuntimeControl('unused',async()=>{calls++;return {exitCode:255,signal:null,stdout:'',stderr:stderr+' PRIVATE_SENTINEL'};});await assert.rejects(service.models(host,catalog,'c'),error=>error instanceof Error&&error.message.includes('SSH_'+code)&&!error.message.includes('PRIVATE_SENTINEL')&&!error.message.includes('无效回执'));assert.equal(calls,1);
 }
 const timeout=new NativeRuntimeControl('unused',async()=>{throw new SshTransportError('TIMEOUT','PRIVATE_SENTINEL');});await assert.rejects(timeout.models(host,catalog,'c'),/SSH_TIMEOUT/);
 const malformed=new NativeRuntimeControl('unused',async()=>({exitCode:0,signal:null,stdout:'not json',stderr:''}));await assert.rejects(malformed.models(host,catalog,'c'),/无效回执/);
});

test('Claude catalog keeps native variants distinct and Fast follows capability metadata',()=>{
 const models=parseClaudeModels([{value:'opus',displayName:'Opus version',supportedEffortLevels:['low','high'],supportsFastMode:true},{value:'opus[1m]',displayName:'Opus version',supportsFastMode:true,supportedEffortLevels:['high'],defaultEffort:'high'},{value:'other',supportsFastMode:false,contextWindow:1000000}]);
 assert.deepEqual(models.map(m=>[m.model,m.name,m.contextWindow]),[['opus','Opus version',undefined],['opus[1m]','Opus version (1M)',1000000],['other','other',1000000]]);
 assert.equal(models[1]!.defaultEffort,'high');assert.equal(models[0]!.serviceTiers[0]!.id,'priority');assert.deepEqual(models[2]!.serviceTiers,[]);
 assert.throws(()=>validateModelSelection({model:'other',serviceTier:'priority'},models),/速度/);
 for(const fast of [true,false]){
  const selection=validateModelSelection({model:'opus[1m]',effort:'high',...(fast?{serviceTier:'priority'}:{})},models);
  const launch=officialAccountLaunch({binding:{runtime:'claude'},modelSelection:selection} as Session,{});
  assert.equal(launch.args[launch.args.indexOf('--model')+1],'opus[1m]');assert.equal(JSON.parse(launch.args[launch.args.indexOf('--settings')+1]!).fastMode,fast);
 }
 assert.deepEqual(parseClaudeModels([{value:'old'}])[0]!.serviceTiers,[]);
 assert.equal(parseClaudeModels([{value:'unbounded',contextWindow:1e20}])[0]!.contextWindow,undefined);
});

test('SSH catalog control sends only account-bound metadata and rejects stale or secret-shaped replies',async()=>{
 const host:SshHost={id:'w',name:'Fixture',hostname:'fixture.invalid',port:22,role:'workspace',username:'member',ownerId:'fixture',workspaceGeneration:'wg',identityFile:'unused',knownHostsFile:'unused'};
 const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',workspaceId:'w',revision:1,selectionRevision:1,accounts:[{id:'c',generation:'cg',provider:'claude',status:'authenticated',observedAt:'now'}]};
 let calls=0,value:any={accountId:'c',accountGeneration:'cg',provider:'claude',models:[{id:'native',model:'native',name:'Native model',isDefault:true,efforts:['low'],serviceTiers:[],private:'must not escape'}],private:'must not escape'};
 const service=new NativeRuntimeControl('unused',async(_host,_command,options)=>{calls++;assert.deepEqual(JSON.parse(options!.stdin!),{protocol:1,method:'runtime/models',params:{authorityId:'a',generation:'g',accountId:'c',accountGeneration:'cg'}});return {exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({ok:true,value})};});
 const models=await service.models(host,catalog,'c');assert.equal(models[0]?.model,'native');assert.ok(!JSON.stringify(models).includes('private'));
 value.accountGeneration='stale';await assert.rejects(service.models(host,catalog,'c'),/回执无效/);value.accountGeneration='cg';value.models[0].name='Bearer synthetic-secret';await assert.rejects(service.models(host,catalog,'c'),/回执无效/);
 await assert.rejects(service.models({...host,role:'admin'},catalog,'c'),/工作空间/);assert.equal(calls,3);
 value.models=parseClaudeModels([{value:'opus[1m]',displayName:'Opus',supportsFastMode:true,supportedEffortLevels:['high'],defaultEffort:'high'}]);
 value.models[0].serviceTiers[0].private='never returned';
 assert.deepEqual(await service.models(host,catalog,'c'),parseClaudeModels([{value:'opus[1m]',displayName:'Opus',supportsFastMode:true,supportedEffortLevels:['high'],defaultEffort:'high'}]));
 for(const invalid of [{contextWindow:-1},{defaultEffort:'invented'},{serviceTiers:[{id:'invented',name:'Fast'}]},{serviceTiers:[{id:'priority',name:'Fast',description:'Bearer synthetic-secret'}]}]){const saved=value.models[0];value.models=[{...saved,...invalid}];await assert.rejects(service.models(host,catalog,'c'),/回执无效/);value.models=[saved];}
});

const setup=String.raw`
import sys,os,json,tempfile,types,copy
try: import fcntl
except ImportError: sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
from broker import AccountBroker,BrokerError
import runtime as module
from runtime import NativeAccountRuntime,RuntimeErrorCode
with tempfile.TemporaryDirectory() as folder:
    policy={'schemaVersion':1,'authorityId':'a','generation':'g','revision':1,'workspaces':[{'workspaceId':'w','uid':1001,'enabled':True,'allowedAccountIds':['c'],'runtimes':['claude']}]}
    cfg={'authorityId':'a','generation':'g','ownerUid':2000,'root':folder,'workspacePolicyFile':'/fixture/policy'}
    broker=AccountBroker(cfg,policy_reader=lambda _:copy.deepcopy(policy))
    account=broker.registry.add('c',{'status':'authenticated'},provider='claude')
    sent=[];stopped=[];model_rows=[{'value':'native','displayName':'Native model','supportedEffortLevels':['low','high']}]
    response_hook=lambda:None
    class Pipe:
        def __init__(self,*args):pass
        def send(self,message):
            assert message['type']=='control_request' and message['request']=={'subtype':'initialize'}
            sent.append(message)
        def receive(self,*args):
            response_hook()
            return {'type':'control_response','response':{'request_id':sent[-1]['request_id'],'subtype':'success','response':{'models':model_rows,'account':{'private':'never returned'}}}}
    module.NativePipe=Pipe
    runtime=NativeAccountRuntime(broker,cfg,catalog_factory=lambda _:object())
    runtime.stop=lambda process:stopped.append(process)
    broker.runtime=runtime
    params={'authorityId':'a','generation':'g','accountId':'c','accountGeneration':account['generation']}
    def invoke():return broker.dispatch(1001,{'protocol':1,'method':'runtime/models','params':params})
    def error(code,fn):
        try:fn()
        except (RuntimeErrorCode,BrokerError) as e:assert str(e)==code,(str(e),code)
        else:raise AssertionError('Expected '+code)
    CASE
`;
function python(name:string,body:string){test(name,()=>{const result=spawnSync('python',['-B','-c',setup.replace('    CASE',body.split('\n').map(l=>'    '+l).join('\n')),path.resolve('services/vps-account-broker')],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(result.status,0,result.stderr||result.stdout);});}
python('broker returns projected native models after only initialize and cleans its process',String.raw`
value=invoke()
assert value=={'accountId':'c','accountGeneration':account['generation'],'provider':'claude','models':[{'id':'native','model':'native','name':'Native model','isDefault':True,'efforts':['low','high'],'serviceTiers':[]}]},value
assert len(sent)==1 and len(stopped)==1 and not runtime.active
assert not runtime.state.state['sessions']
`);
python('broker preserves 1M variant values, public capacity and native Fast capability without invented rows',String.raw`
model_rows=[{'value':'opus','displayName':'Opus version','supportsFastMode':True},{'value':'opus[1m]','displayName':'Opus version','supportsFastMode':True,'supportedEffortLevels':['high'],'defaultEffort':'high'},{'value':'other','supportsFastMode':False,'contextWindow':1000000}]
models=invoke()['models']
assert len(models)==3 and 'contextWindow' not in models[0]
assert models[1]['model']=='opus[1m]' and models[1]['name']=='Opus version (1M)' and models[1]['contextWindow']==1000000
assert models[1]['defaultEffort']=='high' and models[1]['serviceTiers'][0]['id']=='priority'
assert models[2]['contextWindow']==1000000 and models[2]['serviceTiers']==[]
assert len(sent)==1 and len(stopped)==1
`);
python('catalog rechecks account authorization after native response and refuses revoked access',String.raw`
def revoke():policy['workspaces'][0]['allowedAccountIds']=[]
response_hook=revoke
error('ACCOUNT_FORBIDDEN',invoke)
assert len(stopped)==1 and not runtime.active
`);
python('catalog rejects wrong account generations and unavailable credentials before spawning',String.raw`
params['accountGeneration']='old'
error('ACCOUNT_FORBIDDEN',invoke)
assert not sent and not stopped
params['accountGeneration']=account['generation'];broker.registry.state['accounts']['c']['status']='unauthenticated'
error('ACCOUNT_AUTHENTICATION_REQUIRED',invoke)
assert not sent
`);
python('catalog validates native models without exposing arbitrary initialization metadata',String.raw`
for invalid in [[],[{'value':''}],[{'value':'duplicate'},{'value':'duplicate'}],[{'value':'Bearer synthetic-secret'}],[{'value':'native','supportedEffortLevels':['bad\nvalue']}]]:
    model_rows=invalid
    error('NATIVE_MODELS_UNAVAILABLE',invoke)
assert len(stopped)==5 and not runtime.active
`);
python('catalog shutdown and initialization timeout preserve cleanup without restarting',String.raw`
def failed(*_):raise TimeoutError('fixture')
Pipe.receive=failed
error('NATIVE_MODELS_UNAVAILABLE',invoke)
assert len(sent)==1 and len(stopped)==1 and not runtime.active
runtime.closed=True
error('RUNTIME_CLOSING',invoke)
assert len(sent)==1
`);
python('catalog admission blocks concurrent login, account deletion and CLI maintenance',String.raw`
job='00000000-0000-4000-8000-000000000001'
def admin(method,extra):return broker.dispatch(0,{'protocol':1,'method':method,'params':{**params,**extra}})
def cli():return broker.dispatch(0,{'protocol':1,'method':'maintenance/check-cli','params':{'authorityId':'a','generation':'g','provider':'claude'}})
def during_catalog():
    error('ACCOUNT_RUNTIME_BUSY',lambda:admin('runtime/login-reserve',{'jobId':job}))
    error('ACCOUNT_RUNTIME_BUSY',lambda:admin('runtime/remove',{'expectedRevision':broker.registry.state['revision'],'confirm':True}))
    error('ACCOUNT_RUNTIME_BUSY',invoke)
    error('CLI_BUSY',cli)
response_hook=during_catalog
invoke()
assert cli()=={'provider':'claude','idle':True}
assert admin('runtime/login-reserve',{'jobId':job})=={'reserved':True}
error('ACCOUNT_RUNTIME_BUSY',invoke)
assert len(sent)==1 and len(stopped)==1 and not runtime.active
assert admin('runtime/login-release',{'jobId':job})=={'released':True}
`);
python('a catalog cleanup failure keeps maintenance fenced and shutdown retries only cleanup',String.raw`
attempts=[]
def fail_stop(process):
    attempts.append(process)
    raise RuntimeErrorCode('NATIVE_CLEANUP_UNCONFIRMED')
runtime.stop=fail_stop
error('NATIVE_CLEANUP_UNCONFIRMED',invoke)
assert len(runtime.active)==1 and len(attempts)==1
error('ACCOUNT_RUNTIME_BUSY',invoke)
error('CLI_BUSY',lambda:broker.dispatch(0,{'protocol':1,'method':'maintenance/check-cli','params':{'authorityId':'a','generation':'g','provider':'claude'}}))
runtime.stop=lambda process:stopped.append(process)
runtime.close()
assert len(sent)==1 and len(stopped)==1 and not runtime.active
`);
python('catalog discards metadata when account authentication changes during initialization',String.raw`
def unauthenticate():broker.registry.state['accounts']['c']['status']='unauthenticated'
response_hook=unauthenticate
error('ACCOUNT_AUTHENTICATION_REQUIRED',invoke)
assert len(sent)==1 and len(stopped)==1 and not runtime.active
`);
python('runtime shutdown cancels an in-flight catalog and waits for owned cleanup',String.raw`
import threading
started=threading.Event();errors=[]
class WaitingPipe:
    def __init__(self,process,stop):self.stop=stop
    def send(self,message):sent.append(message)
    def receive(self,*args):
        started.set()
        assert self.stop.wait(3)
        raise EOFError()
module.NativePipe=WaitingPipe
def run():
    try:invoke()
    except BrokerError as failure:errors.append(str(failure))
worker=threading.Thread(target=run);worker.start()
assert started.wait(3)
runtime.close();worker.join(3)
assert not worker.is_alive() and errors==['RUNTIME_CLOSING']
assert len(sent)==1 and len(stopped)==1 and not runtime.active
`);
python('catalog-only launch accepts the observed modern CLI while task execution remains fenced',String.raw`
import contextlib
import cli_guard,native_worker
runtime.environment=lambda _:({'CLAUDE_CONFIG_DIR':'/fixture/remote-account'},'/fixture/remote-account')
runtime.executable=lambda _:'/fixture/claude'
module.subprocess.check_output=lambda *args,**kwargs:b'2.1.284 (Claude Code)'
cli_guard.lease=lambda *args:contextlib.nullcontext()
class Guard:
    def __init__(self,*args):pass
    def _read_identity(self,_):return 'fixture'
native_worker.NativeCodexLogin=Guard
launched=[]
def popen(args,**kwargs):
    launched.append((args,kwargs))
    return types.SimpleNamespace(pid=123)
module.subprocess.Popen=popen
error('CLAUDE_LOCAL_EXECUTOR_UNVERIFIED',lambda:runtime._launch(account,inspection=True))
assert not launched
runtime._launch(account,inspection=True,catalog_only=True)
args,options=launched[0]
assert args[0]=='/fixture/claude' and '--print' in args and args[args.index('--tools')+1]==''
assert '--strict-mcp-config' in args and args[args.index('--setting-sources')+1]==''
assert options['env']=={'CLAUDE_CONFIG_DIR':'/fixture/remote-account'} and options['cwd']=='/fixture/remote-account'
assert options['start_new_session'] is True
`);

python('quota actively requests native usage without prompt, bypasses disabled execution and rechecks revoked access',String.raw`
response={'rate_limits_available':True,'rate_limits':{'five_hour':{'utilization':12.5,'resets_at':'2026-10-02T00:00:00Z'},'seven_day':{'utilization':40,'resets_at':None}},'behaviors':{'private':'never returned'}}
def send(self,message):
    assert message['type']=='control_request'
    sent.append(message)
def receive(self,*args):
    data={} if sent[-1]['request']['subtype']=='initialize' else response
    response_hook()
    return {'type':'control_response','response':{'request_id':sent[-1]['request_id'],'subtype':'success','response':data}}
Pipe.send=send;Pipe.receive=receive
params['action']='read'
def invoke_usage():return broker.dispatch(1001,{'protocol':1,'method':'runtime/usage','params':params})
account['enabled']=False
result=invoke_usage()
assert result['pools']['claude']['primary']['usedPercent']==12.5
assert result['pools']['claude']['secondary']['usedPercent']==40
assert result['pools']['claude']['primary']['resetsAt']==1790899200
assert [x['request'] for x in sent]==[{'subtype':'initialize'},{'subtype':'get_usage','skip_behaviors':True}]
assert 'private' not in json.dumps(result) and len(stopped)==1 and not runtime.active
response['rate_limits']['five_hour']['utilization']=101
error('CLAUDE_QUOTA_RESPONSE_INVALID',invoke_usage)
response={'rate_limits_available':True,'rate_limits':None}
error('CLAUDE_QUOTA_QUERY_FAILED',invoke_usage)
response={'rate_limits_available':False,'rate_limits':None}
assert invoke_usage()['pools']=={}
def revoke():policy['workspaces'][0]['allowedAccountIds']=[]
response_hook=revoke
error('ACCOUNT_FORBIDDEN',invoke_usage)
assert not runtime.active
`);
python('quota reports unsupported native control and still confirms cleanup',String.raw`
def send(self,message):sent.append(message)
def receive(self,*args):
    return {'type':'control_response','response':{'request_id':sent[-1]['request_id'],'subtype':'success' if len(sent)==1 else 'error','error':'Unknown control request: get_usage','response':{}}}
Pipe.send=send;Pipe.receive=receive
params['action']='read'
error('CLAUDE_QUOTA_QUERY_UNSUPPORTED',lambda:broker.dispatch(1001,{'protocol':1,'method':'runtime/usage','params':params}))
assert len(stopped)==1 and not runtime.active
`);
