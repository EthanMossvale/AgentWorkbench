// Exercise production owner-launch arguments against isolated local native binaries.
// Only initialize and MCP status controls are sent. No user message or model turn.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {openOfficialClaudeTools,ClaudeToolMcpSession} from '../services/claude-bridge/tools.ts';
import {openNativeGateway} from '../packages/model-api/native-gateway.ts';
import {ProcessSupervisor} from '../services/remote-supervisor/index.ts';
const executable=process.env.AWB_QA_CLAUDE;
if(!executable||!path.isAbsolute(executable))throw Error('Set the explicit AWB_QA_CLAUDE executable.');
const root=path.resolve('build/qa/claude-mcp/native-metadata-'+Date.now());await mkdir(root,{recursive:true});
const env={...process.env,HOME:root,USERPROFILE:root,APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'localappdata'),CLAUDE_CONFIG_DIR:path.join(root,'owner-profile'),ANTHROPIC_CONFIG_DIR:root,ANTHROPIC_API_KEY:'synthetic-no-inference',ANTHROPIC_AUTH_TOKEN:'',ANTHROPIC_BASE_URL:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL:'1',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1',DISABLE_AUTOUPDATER:'1'};
delete env.CLAUDE_CODE_OAUTH_TOKEN;delete env.CLAUDECODE;
const report={scope:'Local isolated native metadata test of production owner-launch arguments; closed-loopback model endpoint; no SSH or user/model inputs',controls:[],success:false};
const abort=new AbortController();let tools,gateway,native;
try{
 tools=await openOfficialClaudeTools({executable,cwd:root,directory:path.join(root,'local-tools'),env,signal:abort.signal});
 gateway=await openNativeGateway({runtime:'claude',model:{id:'sonnet',model:'sonnet',name:'Synthetic',enabled:true},mcpOnly:true,credentials:async()=>{throw Error('Model requests forbidden');},mcp:()=>new ClaudeToolMcpSession(tools,()=> 'default',()=>{})});
 const python=String.raw`
import sys,json,types,contextlib
from pathlib import Path
try: import fcntl
except ImportError: sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
import claude_session,cli_guard,native_worker
cfg=json.loads(sys.stdin.read());root=Path(cfg['root']);profile=root/'owner-profile';profile.mkdir(exist_ok=True)
runtime=types.SimpleNamespace(environment=lambda _:({},str(profile)),executable=lambda _:cfg['executable'],broker=types.SimpleNamespace(owner_uid=2000))
cli_guard.lease=lambda *_:contextlib.nullcontext()
class Guard:
 def __init__(self,*_):pass
 def _read_identity(self,_):return 'fixture'
native_worker.NativeCodexLogin=Guard
captured=[]
claude_session.subprocess.Popen=lambda args,**kwargs:(captured.append({'args':args[1:],'cwd':str(kwargs['cwd'])}) or types.SimpleNamespace(pid=123))
claude_session.launch(runtime,{},cfg['params'],{'threadId':cfg['params']['sessionId']})
print(json.dumps(captured[0]))
`;
 const params={sessionId:randomUUID(),cwd:root,toolServerUrl:gateway.baseUrl+'/mcp',toolToken:gateway.token,selection:{model:'sonnet'},permissionMode:'default'};
 const plan=spawnSync('python',['-B','-c',python,path.resolve('services/vps-account-broker')],{input:JSON.stringify({root,executable,params}),encoding:'utf8',windowsHide:true});assert.equal(plan.status,0,plan.stderr);
 const spec=JSON.parse(plan.stdout);native=new ProcessSupervisor({executable,args:spec.args,cwd:spec.cwd,env});
 const pending=new Map();let stderr='';native.on('diagnostic',data=>{stderr=(stderr+data).slice(-2000);});
 native.on('frame',frame=>{const r=frame.value.response;if(frame.value.type==='control_response'&&pending.has(r?.request_id)){const p=pending.get(r.request_id);pending.delete(r.request_id);clearTimeout(p.timer);r.subtype==='success'?p.resolve(r.response):p.reject(Error('Native metadata rejected: '+JSON.stringify(r)));}});
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Metadata process disconnected: '+stderr));}pending.clear();};native.on('disconnect',fail);native.on('fault',fail);
 const request=subtype=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Metadata timed out: '+subtype+' '+stderr));},20000);pending.set(id,{resolve,reject,timer});report.controls.push(subtype);void native.write({type:'control_request',request_id:id,request:{subtype}}).catch(reject);});
 await native.start();const init=await request('initialize');report.initialized=!!init;let status;
 for(let i=0;i<30;i++){status=await request('mcp_status');if(status?.mcpServers?.some(s=>s.name==='local_device'&&s.status==='connected'))break;await delay(200);}
 const server=status?.mcpServers?.find(s=>s.name==='local_device');report.mcpStatus=status?.mcpServers?.map(({name,status,serverInfo,tools})=>({name,status,serverInfo,tools}));assert.equal(server?.status,'connected');
 assert.equal((await fetch(gateway.baseUrl+'/v1/messages',{method:'POST',headers:{Authorization:'Bearer '+gateway.token},body:'{}'})).status,404);
 report.success=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{await native?.stop('metadata-probe-finished');await gateway?.close();await tools?.close();await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(root,'report.json'),success:report.success,controls:report.controls,error:report.error}));}
