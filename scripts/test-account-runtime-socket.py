"""Local Linux peer-UID acceptance using a synthetic native executable only."""
import json
import os
import pwd
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import uuid

assert os.geteuid() == 0, 'Use an isolated local Linux runtime.'
source = Path(__file__).resolve().parents[1] / 'services' / 'vps-account-broker'
report = Path(sys.argv[1])
checks = []
process = None
fake = r'''#!/usr/bin/python3
import json,os,sys,uuid,subprocess
from pathlib import Path
if '--version' in sys.argv:
 print('codex-cli 0.155.1');sys.exit(0)
root=Path(os.environ['CODEX_HOME']);history=root/'fixture-history.json'
def emit(v):print(json.dumps(v),flush=True)
for raw in sys.stdin:
 m=json.loads(raw);method=m.get('method');p=m.get('params',{});result={}
 with (root/'fixture-methods.log').open('a') as log:log.write(str(method)+'\n')
 if method=='initialized':continue
 if method=='initialize':result={'userAgent':'synthetic-native-fixture'}
 elif method=='account/read':result={'account':{'type':'chatgpt','email':'fixture@example.invalid','planType':'pro'}}
 elif method=='account/rateLimits/read':result={'rateLimits':{'primary':{'usedPercent':10,'windowDurationMins':300,'resetsAt':2000000000},'secondary':{'usedPercent':20,'windowDurationMins':10080,'resetsAt':2000500000}},'rateLimitsByLimitId':None}
 elif method=='config/read':result={'config':{'model':'fixture-model','privateFixture':'must-not-escape'}}
 elif method=='thread/start':
  saved=json.loads(history.read_text()) if history.exists() else {}
  ident='thread-'+uuid.uuid4().hex;saved[ident]={'id':ident,'turns':[],'environments':p['environments']};history.write_text(json.dumps(saved));result={'thread':saved[ident]}
 elif method=='thread/fork':
  saved=json.loads(history.read_text());source=saved[p['threadId']]
  boundary=p.get('lastTurnId') or p['beforeTurnId'];index=next(i for i,t in enumerate(source['turns']) if t['id']==boundary)
  ident='fork-'+uuid.uuid4().hex
  child=dict(source,id=ident,forkedFromId=p['threadId'],turns=source['turns'][:index+(1 if p.get('lastTurnId') else 0)])
  saved[ident]=child;history.write_text(json.dumps(saved));result={'thread':child}
  emit({'method':'thread/started','params':{'thread':child}})
 elif method in ('thread/read','thread/resume','thread/turns/list'):
  saved=json.loads(history.read_text()) if history.exists() else {}
  if method=='thread/resume' and p.get('path'):
   records=[json.loads(v) for v in Path(p['path']).read_text().splitlines()]
   ident=records[0]['payload']['id'];saved[ident]={'id':ident,'turns':[{'id':'original-turn','status':'completed','items':[{'id':'original-answer','type':'agentMessage','text':'Preserved original history.'}]}]};history.write_text(json.dumps(saved))
  thread=saved.get(p['threadId'])
  if not thread:emit({'id':m['id'],'error':{'code':-1,'message':'no thread'}});continue
  result={'data':thread['turns']} if method=='thread/turns/list' else {'thread':thread}
 elif method=='turn/start':
  text=p.get('input',[{}])[0].get('text','')
  if text=='exit-native-with-child':
   subprocess.Popen([sys.executable,'-c',"import time;from pathlib import Path;time.sleep(2);Path("+repr(str(root/'escaped-descendant'))+").write_text('escaped')"],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   sys.exit(0)
  if text=='exit-native':sys.exit(0)
  saved=json.loads(history.read_text());turn={'id':'turn-'+uuid.uuid4().hex,'status':'completed','items':[]}
  if text=='exhaust-quota':turn.update(status='failed',error={'codexErrorInfo':'usageLimitExceeded'})
  saved[p['threadId']]['turns'].append(turn);history.write_text(json.dumps(saved))
  emit({'id':m['id'],'result':{'turn':turn}})
  emit({'method':'turn/started','params':{'threadId':p['threadId'],'turn':turn}})
  if text!='disconnect-pending':emit({'method':'turn/completed','params':{'threadId':p['threadId'],'turn':turn}})
  continue
 elif method=='account/rateLimitResetCredit/consume':result={'outcome':'nothingToReset'}
 emit({'id':m['id'],'result':result})
'''
launcher = r'''
import json,os,signal,sys,threading
sys.path.insert(0,sys.argv[1])
from broker import AccountBroker,create_server
config=json.loads(open(sys.argv[2]).read())
broker=AccountBroker(config)
if 'account' not in broker.registry.state['accounts']:broker.registry.add('account',{'status':'authenticated','email':'fixture@example.invalid'})
server=create_server(broker,sys.argv[3]);os.chmod(sys.argv[3],0o666)
def stop(*_):threading.Thread(target=server.shutdown,daemon=True).start()
signal.signal(signal.SIGTERM,stop)
print(json.dumps(broker.registry.catalog('fixture')),flush=True)
try:server.serve_forever(poll_interval=.05)
finally:broker.close();server.server_close();os.unlink(sys.argv[3])
'''
client = r'''
import json,socket,sys
cfg=json.loads(sys.argv[2]);channel=socket.socket(socket.AF_UNIX);channel.settimeout(6);channel.connect(sys.argv[1]);reader=channel.makefile('rb');events=[]
def send(v):channel.sendall((json.dumps(v)+'\n').encode())
def read():
 raw=reader.readline()
 if not raw:raise EOFError()
 return json.loads(raw)
def rpc(method,params=None,i=1):
 send({'id':i,'method':method,'params':params or {}})
 while True:
  value=read()
  if value.get('id')==i:return value
  events.append(value)
send(cfg['open']);opened=read()
exec(cfg['script'])
channel.close()
'''
with tempfile.TemporaryDirectory(prefix='awb-account-runtime-fixture-', dir='/run') as folder:
    base = Path(folder);base.chmod(0o755)
    home, run = base / 'private', base / 'socket'
    for directory, mode in ((home,0o700),(run,0o755)):
        directory.mkdir(mode=mode);os.chown(directory,65534,65534)
    profiles=home/'profiles';profiles.mkdir(mode=0o700);os.chown(profiles,65534,65534)
    profile=profiles/'account';profile.mkdir(mode=0o700);os.chown(profile,65534,65534)
    executable=base/'synthetic-codex';executable.write_text(fake);executable.chmod(0o755)
    claude_executable=base/'synthetic-claude'
    claude_executable.write_text('''#!/usr/bin/python3
import json,os,sys
from pathlib import Path
if '--version' in sys.argv:
 print('2.1.281 (Claude Code)');sys.exit(0)
assert sys.argv[1:]==['auth','status','--json']
profile=Path(os.environ['CLAUDE_CONFIG_DIR'])
assert profile==Path.cwd()
with (profile/'fixture-profile-observations.log').open('a') as log:log.write(str(profile)+'\\n')
print(json.dumps({'loggedIn':True,'email':'claude-fixture@example.invalid'}))
''')
    claude_executable.chmod(0o755)
    policy_file=base/'policy.json'
    identity={'authorityId':'fixture','generation':'g'}
    policy={'schemaVersion':1,**identity,'revision':1,'workspaces':[{'workspaceId':name,'uid':uid,'enabled':True,'allowedAccountIds':['account'],'runtimes':['codex']} for name,uid in [('alpha',65533),('beta',65532),('gamma',65530)]]}
    def publish():
        temp=base/'next-policy.json';temp.write_text(json.dumps(policy));temp.chmod(0o644);os.replace(temp,policy_file)
    publish()
    config_file=base/'config.json';config_file.write_text(json.dumps({**identity,'ownerUid':65534,'root':str(home),'codexExecutable':str(executable),'claudeExecutable':str(claude_executable),'workspacePolicyFile':str(policy_file)}));config_file.chmod(0o644)
    endpoint=str(run/'broker.sock')
    def start():
        server=subprocess.Popen([sys.executable,'-B','-c',launcher,str(source),str(config_file),endpoint],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,user=65534,group=65534,start_new_session=True)
        row=json.loads(server.stdout.readline())['accounts'][0]
        return server,row['generation']
    def stop():
        if process and process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:process.wait(timeout=12)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait();raise
        if process:
            errors=process.stderr.read()
            assert not errors,errors
    def invoke(opening,script,uid=65533):
        result=subprocess.run([sys.executable,'-B','-c',client,endpoint,json.dumps({'open':opening,'script':script})],text=True,capture_output=True,timeout=12,user=uid,group=65534)
        assert result.returncode==0,result.stderr
        return json.loads(result.stdout)
    def management(method,params=None,uid=65533):
        return invoke({'protocol':1,'method':method,'params':params or {}},'print(json.dumps(opened))',uid)
    def session(sid=None,cwd='C:\\Fixture'):
        return {'protocol':1,'method':'runtime/open','params':{**identity,'accountId':'account','accountGeneration':generation,'sessionId':sid or str(uuid.uuid4()),'environmentId':'local-device','cwd':cwd,'execServerUrl':'ws://127.0.0.1:12345/'+'a'*64}}
    try:
        process,generation=start()
        first=session();environment=[{'environmentId':'local-device','cwd':first['params']['cwd']}]
        prepare="assert opened['ok'],opened\nassert rpc('initialize')['result']['userAgent']=='synthetic-native-fixture'\nsend({'method':'initialized'})\n"
        result=invoke(first,prepare+"config=rpc('config/read',{},2)\nassert 'privateFixture' not in json.dumps(config)\nthread=rpc('thread/start',{'environments':"+repr(environment)+"},3)['result']['thread']['id']\nprint(json.dumps({'thread':thread,'owner':opened['value']['credentialOwner']}))")
        thread=result['thread'];assert result['owner']=='native'
        time.sleep(.3)
        result=invoke(session(),prepare+"result=rpc('thread/read',{'threadId':"+repr(thread)+"},2)\nassert result['error']['message']=='THREAD_NOT_OWNED'\nprint(json.dumps({'isolated':True}))",uid=65532)
        checks.append('real peer UIDs isolate native threads sharing one native account profile')
        result=invoke(session(),prepare+"result=rpc('thread/read',{'threadId':"+repr(thread)+"},2)\nassert result['error']['message']=='THREAD_NOT_OWNED'\nprint(json.dumps({'isolated':True}))",uid=65530)
        for uid in (65533,65532,65530):
            rows=management('catalog/list',uid=uid)['value']['accounts']
            assert len(rows)==1 and rows[0]['id']=='account' and rows[0]['generation']==generation
            denied=subprocess.run([sys.executable,'-c','from pathlib import Path;Path('+repr(str(profile/'fixture-history.json'))+').read_text()'],capture_output=True,user=uid,group=65534)
            assert denied.returncode!=0 and b'PermissionError' in denied.stderr
        assert [p.name for p in profiles.iterdir()]==['account']
        checks.append('three kernel UIDs share one authentication profile while private files remain unreadable')
        claude_request={**identity,'requestId':str(uuid.uuid4()),'expectedRevision':management('catalog/list',uid=0)['value']['revision']}
        claude_account=management('runtime/claude-create',claude_request,uid=0)
        assert claude_account['ok'],claude_account
        assert management('runtime/claude-create',claude_request,uid=0)==claude_account
        claude_id=claude_account['value']['id']
        for workspace in policy['workspaces']:
            workspace['allowedAccountIds'].append(claude_id)
            workspace['runtimes'].append('claude')
        publish()
        claude_profile=profiles/claude_id
        command=management('runtime/login-command',{**identity,'accountId':claude_id},uid=0)
        assert command['ok'] and 'CLAUDE_CONFIG_DIR='+str(claude_profile) in command['value']['command']
        for uid in (65533,65532,65530):
            assert management('runtime/login-command',{**identity,'accountId':claude_id},uid=uid)['error']=='INVALID_REQUEST'
            status=management('runtime/status',{**identity,'accountId':claude_id},uid=uid)
            assert status['ok'] and status['value']['authenticated'] and status['value']['execution']=='local-tools-unverified',status
            public=management('catalog/list',uid=uid)
            assert any(row['id']==claude_id and row['status']=='authenticated' for row in public['value']['accounts'])
            assert str(claude_profile) not in json.dumps(public)
        assert set((claude_profile/'fixture-profile-observations.log').read_text().splitlines())=={str(claude_profile)}
        assert len(list(profiles.iterdir()))==2
        checks.append('three workspace UIDs observe the same central Claude profile without separate login permissions')
        checks.append('Claude creation retries reuse the same profile and status does not claim local tool execution')
        assert management('catalog/list',uid=65531)['error']=='UNAUTHORIZED'
        checks.append('unregistered kernel peer UID cannot access the account catalog')
        time.sleep(.3)
        result=invoke(first,prepare+"assert rpc('thread/resume',{'threadId':"+repr(thread)+",'environments':"+repr(environment)+"},2)['result']['thread']['id']=="+repr(thread)+"\nturn=rpc('turn/start',{'threadId':"+repr(thread)+",'environments':"+repr(environment)+",'input':[{'type':'text','text':'continue-old'}]},3)\nwhile not any(v.get('method')=='turn/completed' for v in events):events.append(read())\nprint(json.dumps({'continued':True,'turnId':turn['result']['turn']['id']}))")
        checks.append('disconnected old session resumes original thread and completes the next turn')
        time.sleep(.3)
        forked=session();forked['params']['fork']={'sourceSessionId':first['params']['sessionId'],'threadId':thread,'lastTurnId':result['turnId']}
        assert invoke(forked,'print(json.dumps(opened))',uid=65532)['error']=='FORK_SOURCE_NOT_OWNED'
        changed=json.loads(json.dumps(forked));changed['params']['cwd']='C:\\Wrong'
        assert invoke(changed,'print(json.dumps(opened))')['error']=='FORK_SOURCE_NOT_OWNED'
        checks.append('real socket fork rejects another workspace UID and a changed source directory')
        fork_params={k:v for k,v in forked['params']['fork'].items() if k!='sourceSessionId'}
        fork_params.update(excludeTurns=True,deferGoalContinuation=True)
        child_result=invoke(forked,prepare+"child=rpc('thread/fork',"+repr(fork_params)+",2)['result']['thread']\nassert len(child['turns'])==1\nassert child['id']!="+repr(thread)+"\nrpc('turn/start',{'threadId':child['id'],'environments':"+repr(environment)+",'input':[{'type':'text','text':'branch-only'}]},3)\nwhile not any(v.get('method')=='turn/completed' for v in events):events.append(read())\nprint(json.dumps({'thread':child['id']}))")
        child_id=child_result['thread'];time.sleep(.3)
        unchanged=invoke(first,prepare+"history=rpc('thread/turns/list',{'threadId':"+repr(thread)+"},2)\nprint(json.dumps({'turnCount':len(history['result']['data'])}))")
        assert unchanged['turnCount']==1
        checks.append('socket native fork and continuation write to a new child while preserving parent turns')

        time.sleep(.3)
        pending=invoke(first,prepare+"rpc('thread/resume',{'threadId':"+repr(thread)+",'environments':"+repr(environment)+"},2)\nturn=rpc('turn/start',{'threadId':"+repr(thread)+",'environments':"+repr(environment)+",'input':[{'type':'text','text':'disconnect-pending'}]},3)\nprint(json.dumps({'turn':turn['result']['turn']['id']}))")
        time.sleep(.3);stop();process,generation=start()
        recovered=invoke(first,"assert opened['ok'],opened\nprint(json.dumps(opened['value']['sessionReceipt']))")
        assert recovered['threadId']==thread and recovered['turnId']==pending['turn'] and not recovered['uncertain'] and recovered['interrupted'] and recovered['cleanupConfirmed']
        assert recovered['cwd']==first['params']['cwd'] and recovered['environmentId']=='local-device'
        time.sleep(.3)
        mismatch=session(first['params']['sessionId'],cwd='C:\\Wrong');denied=invoke(mismatch,'print(json.dumps(opened))')
        assert denied['error']=='SESSION_BINDING_CHANGED',denied
        checks.append('owner recovery receipt preserves thread turn and device directory after restart')
        time.sleep(.3)
        child_recovery=invoke(forked,prepare+"assert opened['value']['sessionReceipt']['threadId']=="+repr(child_id)+"\nassert rpc('thread/resume',{'threadId':"+repr(child_id)+",'environments':"+repr(environment)+"},2)['result']['thread']['id']=="+repr(child_id)+"\nprint(json.dumps({'recovered':True}))")
        assert child_recovery['recovered']
        checks.append('child receipt resumes across broker restart after an interrupted parent turn')

        result=invoke(first,prepare+"rpc('thread/resume',{'threadId':"+repr(thread)+",'environments':"+repr(environment)+"},2)\naccepted=rpc('turn/start',{'threadId':"+repr(thread)+",'environments':"+repr(environment)+"},5)\nassert 'result' in accepted\nwhile not any(v.get('method')=='turn/completed' for v in events):events.append(read())\nprint(json.dumps({'continued':True}))")
        checks.append('confirmed owned-process cleanup interrupts the lost turn without permanently blocking a deliberate new turn')
        policy['workspaces'][0]['runtimes']=[];publish()
        denied=invoke(session(),'print(json.dumps(opened))');assert denied['error']=='RUNTIME_NOT_ENABLED',denied
        policy['workspaces'][0]['runtimes']=['codex'];publish()
        checks.append('runtime authorization changes apply on the next session without service restart')
        checked=invoke(session(),prepare+"thread=rpc('thread/start',{'environments':"+repr(environment)+"},2)['result']['thread']['id']\nturn=rpc('turn/start',{'threadId':thread,'environments':"+repr(environment)+",'input':[{'type':'text','text':'exhaust-quota'}]},3)\nwhile not any(v.get('method')=='turn/completed' for v in events):events.append(read())\nblocked=rpc('turn/start',{'threadId':thread,'environments':"+repr(environment)+"},4)\nassert blocked['error']['code']==-32071 and blocked['error']['data']['notSubmitted']\nwith socket.socket(socket.AF_UNIX) as status:\n status.settimeout(6);status.connect(sys.argv[1]);status.sendall((json.dumps({'protocol':1,'method':'runtime/status','params':"+repr(dict(identity,accountId='account'))+"})+'\\n').encode());observed=json.loads(status.makefile('rb').readline());assert observed['ok'] and observed['value']['block'] is None,observed\nevents.clear()\nassert 'result' in rpc('turn/start',{'threadId':thread,'environments':"+repr(environment)+"},5)\nwhile not any(v.get('method')=='turn/completed' for v in events):events.append(read())\nprint(json.dumps({'recovered':True}))")
        assert checked['recovered']
        checks.append('explicit pre-model denial and member status recovery preserve a usable native session')
        for _ in range(36):
            invoke(session(),prepare+"print(json.dumps({'connected':True}))")
        assert management('catalog/list')['ok']
        checks.append('more than 32 completed sessions do not leak management slots or cap native sessions')
        opening=session()
        result=invoke(opening,prepare+"thread=rpc('thread/start',{'environments':"+repr(environment)+"},2)['result']['thread']['id']\ntry:rpc('turn/start',{'threadId':thread,'environments':"+repr(environment)+",'input':[{'type':'text','text':'exit-native'}]},3)\nexcept EOFError:print(json.dumps({'disconnected':True}))")
        assert result['disconnected']
        checks.append('native process exit wakes blocked member input and closes its session')
        result=invoke(session(),prepare+"thread=rpc('thread/start',{'environments':"+repr(environment)+"},2)['result']['thread']['id']\ntry:rpc('turn/start',{'threadId':thread,'environments':"+repr(environment)+",'input':[{'type':'text','text':'exit-native-with-child'}]},3)\nexcept EOFError:print(json.dumps({'disconnected':True}))")
        assert result['disconnected']
        time.sleep(2.3)
        assert not (profile/'escaped-descendant').exists()
        checks.append('native exit cleanup terminates the owned descendant process before delayed writes')
        usage=management('runtime/usage',{**identity,'accountId':'account','accountGeneration':generation,'action':'read'},uid=0)
        assert usage['ok'] and usage['value']['pools']['codex']['secondary']['usedPercent']==20,usage
        denied=management('runtime/usage',{**identity,'accountId':'account','accountGeneration':generation,'action':'redeem','requestId':str(uuid.uuid4())})
        assert denied['error']=='ADMIN_REVIEW_REQUIRED'
        checks.append('native quota reads use the owner profile and member reset-card redemption is denied')
        methods=(profile/'fixture-methods.log').read_text()
        assert 'account/login/start' not in methods and 'tokens' not in methods
        assert not list(base.rglob('auth.json'))
        checks.append('managed path requests no credential export injection or copied login file')
        # Migration exercises the production socket and fixed owner UID. All
        # histories are synthetic; no real member HOME or chat data is inspected.
        legacy_ref='vps-account:old-authority/old-generation/codex/legacy-account/'+'a'*64
        enroll={'accountRef':legacy_ref,'email':'fixture@example.invalid','sameAccountConfirmed':True}
        assert management('migration/enroll',enroll)['error']=='ADMIN_REVIEW_REQUIRED'
        assert management('runtime/legacy-enroll',{**identity,**enroll})['error']=='INVALID_REQUEST'
        assert management('runtime/legacy-enroll',{**identity,**enroll,'generation':'wrong'},uid=0)['error']=='STALE_AUTHORITY'
        enrolled=management('runtime/legacy-enroll',{**identity,**enroll},uid=0)
        assert enrolled['ok'],enrolled
        assert management('migration/enroll',enroll,uid=0)==enrolled
        assert management('migration/enroll',dict(enroll,email='changed@example.invalid'),uid=0)['error']=='MIGRATION_ACCOUNT_CHANGED'
        checks.append('only root enrolls legacy public identities and retries preserve quota account generations')
        login=management('runtime/login-command',{**identity,'accountId':'legacy-account'},uid=0)
        assert login['ok'] and login['value']['command'].endswith(' login') and 'CODEX_HOME=' in login['value']['command']
        member=pwd.getpwnam('daemon')
        policy['workspaces'].append({'workspaceId':'legacy-space','uid':member.pw_uid,'enabled':True,'allowedAccountIds':['legacy-account'],'runtimes':['codex']});publish()
        sid,root_thread,child_thread=str(uuid.uuid4()),str(uuid.uuid4()),str(uuid.uuid4())
        manifest={'version':1,'sessionId':sid,'username':member.pw_name,'accountRef':legacy_ref,'threadId':root_thread,'turnId':'original-turn','uncertain':True,'environmentId':'local-device','cwd':'C:\\Original'}
        staged=management('migration/stage',{'manifest':manifest},uid=0)
        assert staged['ok'],staged
        staged=staged['value'];folder=Path(staged['stagingPath'])
        assert folder.parent==home/'migration-staging'
        rows=folder/'sessions';rows.mkdir(mode=0o755);os.chown(rows,65534,65534)
        originals={}
        for ident,parent in [(root_thread,None),(child_thread,root_thread)]:
            meta={'id':ident,'model_provider':'openai','parent_thread_id':parent,'source':'cli'}
            raw=json.dumps({'type':'session_meta','payload':meta})+'\n'+json.dumps({'type':'response_item','payload':{'fixture':'Preserved original history.'}})+'\n'
            filename='rollout-fixture-'+ident+'.jsonl';file=rows/filename;file.write_text(raw);file.chmod(0o600);os.chown(file,65534,65534);originals['sessions/'+filename]=raw
        # This is a decoy, not a credential. It must never be read or copied.
        decoy=folder/'auth.json';decoy.write_text('NOT A CREDENTIAL');decoy.chmod(0o000)
        commit={'migrationId':staged['migrationId'],'sameAccountConfirmed':True,'sourceStopped':True}
        rootfile=rows/('rollout-fixture-'+root_thread+'.jsonl')
        linked=rows/'rollout-link.jsonl';linked.symlink_to(rootfile)
        denied=management('migration/commit',commit,uid=0)
        assert denied.get('error')=='MIGRATION_UNSAFE_FILE',denied
        linked.unlink()
        foreign=rows/('rollout-foreign-'+str(uuid.uuid4())+'.jsonl');foreign.write_text(json.dumps({'type':'session_meta','payload':{'id':str(uuid.uuid4())}})+'\n');foreign.chmod(0o600);os.chown(foreign,65534,65534)
        assert management('migration/commit',commit,uid=0)['error']=='MIGRATION_FOREIGN_THREAD'
        foreign.unlink()
        checks.append('migration rejects linked files and unrelated root histories before import')
        prefix_id=str(uuid.uuid4())
        prefix_raw=json.dumps({'type':'session_meta','payload':{'id':root_thread,'model_provider':'openai'}})+'\n'
        root_rows=[json.loads(line) for line in rootfile.read_text().splitlines()]
        root_rows[0]['payload']['history_base']={'thread_id':prefix_id,'end_ordinal_exclusive':1,'end_byte_offset':len(prefix_raw.encode())}
        root_raw=''.join(json.dumps(row)+'\n' for row in root_rows)
        rootfile.write_text(root_raw);originals['sessions/'+rootfile.name]=root_raw
        denied=management('migration/commit',commit,uid=0)
        assert denied.get('error')=='MIGRATION_HISTORY_DEPENDENCY_MISSING',denied
        archive=folder/'archived_sessions';archive.mkdir(mode=0o700);os.chown(archive,65534,65534)
        prefix_file=archive/('rollout-prefix-'+prefix_id+'.jsonl');prefix_file.write_text(prefix_raw);prefix_file.chmod(0o600);os.chown(prefix_file,65534,65534)
        originals['archived_sessions/'+prefix_file.name]=prefix_raw
        assert management('migration/commit',commit,uid=0)['error']=='MIGRATION_ROOT_ROLLOUT_REQUIRED'
        commit['rootRollout']='sessions/'+rootfile.name
        checks.append('reverted thread versions require an explicit root and complete paginated history dependencies')
        imported=management('migration/commit',commit,uid=0)
        assert imported['ok'],imported
        assert management('migration/commit',commit,uid=0)==imported
        destination=profiles/'legacy-account'
        assert not (destination/'auth.json').exists()
        for filename,raw in originals.items():assert (destination/filename).read_text()==raw
        assert management('migration/commit',dict(commit,rootRollout='archived_sessions/'+prefix_file.name),uid=0)['error']=='MIGRATION_ROLLOUT_CHANGED'
        resolve={'sessionId':sid,'accountRef':legacy_ref}
        assert management('migration/resolve',resolve,uid=65533)['error']=='MIGRATION_NOT_READY'
        receipt=management('migration/resolve',resolve,uid=member.pw_uid)
        assert receipt['value']['uncertain'] and receipt['value']['threadId']==root_thread and receipt['value']['turnId']=='original-turn'
        checks.append('adoption copies only exact native root and child rollouts and isolates receipts by peer UID')
        opening={'protocol':1,'method':'runtime/open','params':{**identity,'accountId':'legacy-account','accountGeneration':'a'*64,'sessionId':sid,'environmentId':'local-device','cwd':'C:\\Original','execServerUrl':'ws://127.0.0.1:12345/'+'a'*64}}
        envs=[{'environmentId':'local-device','cwd':'C:\\Original'}]
        recovered=invoke(opening,prepare+"assert opened['value']['sessionReceipt']['uncertain']\nresumed=rpc('thread/resume',{'threadId':"+repr(root_thread)+",'environments':"+repr(envs)+"},2)\nassert resumed['result']['thread']['id']=="+repr(root_thread)+"\nassert resumed['result']['thread']['turns'][0]['items'][0]['text']=='Preserved original history.'\nblocked=rpc('turn/start',{'threadId':"+repr(root_thread)+",'environments':"+repr(envs)+"},3)\nassert blocked['error']['message']=='TURN_ACTIVE_OR_UNCERTAIN'\nrpc('thread/turns/list',{'threadId':"+repr(root_thread)+"},4)\nprint(json.dumps({'resumed':True}))",uid=member.pw_uid)
        assert recovered['resumed']
        time.sleep(.3)
        methods=(destination/'fixture-methods.log').read_text()
        assert 'thread/start' not in methods and 'turn/start' not in methods and 'account/login/start' not in methods
        checks.append('old thread resumes through owner-injected path with original history and no replayed model turn')
        stop();process,generation=start()
        assert management('migration/resolve',resolve,uid=member.pw_uid)==receipt
        assert management('migration/commit',commit,uid=0)==imported
        mapping=management('migration/account-resolve',{'accountRef':legacy_ref},uid=0)
        assert mapping['value']['accountRef']==receipt['value']['accountRef']
        checks.append('committed migration and account aliases recover idempotently across service restart')
        policy['workspaces'][-1]['allowedAccountIds']=[];publish()
        assert management('migration/resolve',resolve,uid=member.pw_uid)['error']=='ACCOUNT_FORBIDDEN'
        checks.append('migration receipts honor current workspace grants instead of reviving revoked access')
        unit=base/'agent-workbench-accounts.service';unit.write_text((source/'agent-workbench-accounts.service').read_text());unit.chmod(0o644)
        checked=subprocess.run(['systemd-analyze','verify',str(unit)],text=True,capture_output=True,timeout=15)
        assert checked.returncode==0,checked.stderr
        checks.append('packaged systemd unit passes local Linux syntax verification without installation')
        stop();process=None
    finally:
        stop()
report.parent.mkdir(parents=True,exist_ok=True)
report.write_text(json.dumps({'syntheticNativeOnly':True,'realLinuxPeerUids':True,'checks':checks,'passed':len(checks)},indent=2))
print(json.dumps({'passed':len(checks),'report':str(report)}))
