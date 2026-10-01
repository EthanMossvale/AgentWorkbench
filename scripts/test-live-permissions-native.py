"""Official repository CLI, isolated profile and loopback synthetic responses. No real model/login."""
import json, os, queue, subprocess, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
root=Path(__file__).resolve().parents[1]
out=root/'build/qa/session-controls';out.mkdir(parents=True,exist_ok=True)
change=os.environ.get('AWB_PROBE_UPDATE','1')=='1'
requests=[];first=threading.Event();release=threading.Event();received=queue.Queue();events=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  requests.append(body);number=len(requests)
  if number==1:first.set();release.wait(15)
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  if number<=2:
   item={'type':'function_call','id':'fc_fixture_'+str(number),'call_id':'call_fixture_'+str(number),'name':'exec_command','arguments':json.dumps({'cmd':'echo AWB_PERMISSION_FIXTURE','sandbox_permissions':'require_escalated','justification':'Synthetic permission boundary probe.'})}
  else:item={'type':'message','id':'msg_fixture','role':'assistant','status':'completed','content':[{'type':'output_text','text':'Synthetic probe complete.','annotations':[]}]}
  response={'id':'resp_'+str(number),'object':'response','status':'completed','model':'fixture','output':[item],'usage':{'input_tokens':20,'output_tokens':10,'total_tokens':30}}
  stream=[{'type':'response.created','response':dict(response,status='in_progress',output=[])},{'type':'response.output_item.added','output_index':0,'item':item},{'type':'response.output_item.done','output_index':0,'item':item},{'type':'response.completed','response':response}]
  for event in stream:self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode());self.wfile.flush()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
process=None
try:
 with tempfile.TemporaryDirectory(prefix='native-permissions-',dir=out,ignore_cleanup_errors=True) as temporary:
  base=Path(temporary);profile=base/'profile';profile.mkdir();(base/'tmp').mkdir()
  env={key:os.environ[key] for key in ('SystemRoot','WINDIR','COMSPEC','PATH') if key in os.environ}
  env.update(HOME=str(base),USERPROFILE=str(base),APPDATA=str(base/'appdata'),LOCALAPPDATA=str(base/'local'),CODEX_HOME=str(profile),TEMP=str(base/'tmp'),TMP=str(base/'tmp'),OTEL_SDK_DISABLED='true')
  args=[str(root/'build/runtime/codex-0.155.1/codex.exe'),'-c','check_for_update_on_startup=false','-c','model_provider="fixture"','-c','model="fixture"','-c','model_providers.fixture={name="Fixture",base_url="http://127.0.0.1:'+str(server.server_port)+'/v1",wire_api="responses",requires_openai_auth=false}','app-server','--listen','stdio://']
  process=subprocess.Popen(args,cwd=base,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
  threading.Thread(target=lambda:[None for _ in process.stderr],daemon=True).start()
  def reader():
   for line in process.stdout:
    try:received.put(json.loads(line))
    except ValueError:pass
  threading.Thread(target=reader,daemon=True).start()
  def send(method,params,i):process.stdin.write((json.dumps({'id':i,'method':method,'params':params})+'\n').encode());process.stdin.flush()
  def wait(predicate,seconds=20):
   deadline=time.time()+seconds
   while time.time()<deadline:
    value=received.get(timeout=max(.1,deadline-time.time()));events.append(value)
    if value.get('method') in ('item/commandExecution/requestApproval','item/fileChange/requestApproval'):
     process.stdin.write((json.dumps({'id':value['id'],'result':{'decision':'decline'}})+'\n').encode());process.stdin.flush()
    if predicate(value):return value
   raise TimeoutError('Native probe timed out')
  def rpc(method,params,i):
   send(method,params,i);r=wait(lambda v:v.get('id')==i)
   if 'error' in r:raise RuntimeError(str(r['error']))
   return r['result']
  rpc('initialize',{'clientInfo':{'name':'awb-isolated-probe','version':'1'},'capabilities':{'experimentalApi':True}},1)
  process.stdin.write(b'{"method":"initialized"}\n');process.stdin.flush()
  thread=rpc('thread/start',{'cwd':str(base),'model':'fixture','approvalPolicy':'on-request','sandbox':'read-only','ephemeral':True},2)['thread']['id']
  turn=rpc('turn/start',{'threadId':thread,'input':[{'type':'text','text':'Run the synthetic echo probe.'}],'approvalPolicy':'on-request','sandboxPolicy':{'type':'readOnly','networkAccess':False}},3)['turn']['id']
  assert first.wait(15),'No loopback request'
  update=rpc('thread/settings/update',{'threadId':thread,'approvalPolicy':'never','sandboxPolicy':{'type':'readOnly','networkAccess':False}},4) if change else None
  live_result=None
  if change:
   send('turn/settings/update',{'threadId':thread,'turnId':turn,'approvalPolicy':'never'},5)
   live_result=wait(lambda v:v.get('id')==5)
  release.set();wait(lambda v:v.get('method')=='turn/completed',30)
  outputs=[item for request in requests[1:] for item in request.get('input',[]) if item.get('type')=='function_call_output']
  assert len(requests)==3, 'Expected two consecutive tool steps and one final response'
  approvals=[e for e in events if e.get('method','').endswith('/requestApproval')]
  report={'changed':change,'approvalRequests':approvals,'version':'0.155.1','syntheticProviderOnly':True,'realModelCalls':0,'turnId':turn,'updateReceipt':update,'liveTurnUpdate':live_result,'requests':len(requests),'toolNames':[t.get('name') for t in requests[0].get('tools',[])],'toolOutputs':outputs,'settingsNotifications':[v for v in events if v.get('method')=='thread/settings/updated'],'livePermissionChangeObserved':change and len(approvals)==0}
  (out/('native-live-permission-probe.json' if change else 'native-live-permission-control.json')).write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=True))
finally:
 release.set();server.shutdown()
 if process and process.poll() is None:process.kill();process.wait(timeout=5)
