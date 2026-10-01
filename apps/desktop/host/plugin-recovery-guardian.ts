import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import {createServer} from 'node:net';
import {atomicWrite} from '../../../packages/native-resources/files';
import { PluginRecoveryStore, writeSafeMode, type RecoverySnapshot } from '../../../packages/plugins-core/recovery';
import { recoveryPanelHtml } from './plugin-recovery-panel';
import { ownedProcessTree, stopOwnedWorkbench } from './plugin-recovery-process';
import { buildPluginRepairPrompt, readRecoveryLanguage, recoveryDiagnostic, savePluginRepairDraft } from '../../../packages/plugins-core/repair-draft';

const marker='--awb-plugin-recovery-guardian';
export const isRecoveryGuardian=process.argv.includes(marker);
type Wire = {type:string; snapshot?:RecoverySnapshot; rendererAge?:number; rendererMonitoring?:boolean; request?:number; action?:string; result?:unknown; ok?:boolean};
const timeoutMs=()=>process.env.AGENT_WORKBENCH_TEST_DATA?Math.max(1500,Number(process.env.AGENT_WORKBENCH_TEST_GUARD_TIMEOUT)||15000):15000;
export interface RecoveryGuardian {
  monitorRenderer():void; rendererPulse():void; show():void; close():void;
}
/** An OS process is necessary: timers in Electron's main thread cannot detect its own infinite loop. */
export async function startRecoveryGuardian(store:PluginRecoveryStore, action:(action:string)=>Promise<unknown>):Promise<RecoveryGuardian>{
  const args=app.isPackaged?[marker]:[app.getAppPath(),marker];
  const child:ChildProcess=spawn(process.execPath,args,{env:{...process.env,AGENT_WORKBENCH_RECOVERY_DIRECTORY:store.directory},stdio:['ignore','ignore','ignore','ipc'],detached:true,windowsHide:true});
  let closed=false,monitoring=false,rendererAt=Date.now();
  const send=(message:Wire)=>{if(child.connected)child.send(message,()=>{});};
  const ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PLUGIN_GUARDIAN_UNAVAILABLE')),15000);child.once('error',()=>{clearTimeout(timer);reject(Error('PLUGIN_GUARDIAN_UNAVAILABLE'));});child.on('message',(value:Wire)=>{if(value?.type==='ready'){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('PLUGIN_GUARDIAN_UNAVAILABLE'));});});
  const unsubscribe=store.subscribe(snapshot=>send({type:'snapshot',snapshot}));
  const beat=()=>send({type:'heartbeat',rendererMonitoring:monitoring,rendererAge:Date.now()-rendererAt});
  const timer=setInterval(beat,500);timer.unref();
  const close=()=>{if(closed)return;closed=true;clearInterval(timer);unsubscribe();send({type:'stop'});};
  child.on('message',(value:Wire)=>{
    if(value?.type!=='action'||typeof value.request!=='number'||typeof value.action!=='string'||closed)return;
    void action(value.action).then(result=>send({type:'result',request:value.request,ok:true,result}),()=>send({type:'result',request:value.request,ok:false}));
  });
  try{await ready;}catch(error){close();child.kill();throw error;}
  child.on('exit',()=>{if(!closed){close();void store.safeMode(true);}});
  send({type:'snapshot',snapshot:store.snapshot()});beat();
  return {monitorRenderer(){monitoring=true;rendererAt=Date.now();},rendererPulse(){rendererAt=Date.now();},show(){send({type:'show'});},close};
}

/** This branch never constructs NativeResources, the controller or the plugin registry. */
export async function runRecoveryGuardian(){
  const directory=process.env.AGENT_WORKBENCH_RECOVERY_DIRECTORY;
  if(!directory||!path.isAbsolute(directory)||!process.send){app.exit(1);return;}
  const parentPid=process.ppid;
  app.setName('AgentWorkbench Recovery');app.setPath('userData',path.join(directory,'plugin-recovery-ui'));
  const qaPort=process.env.AGENT_WORKBENCH_TEST_DATA&&process.env.AGENT_WORKBENCH_TEST_GUARD_PORT;
  if(qaPort&&/^\d{4,5}$/.test(qaPort))app.commandLine.appendSwitch('remote-debugging-port',qaPort);
  const parentStarted=(await ownedProcessTree(parentPid,process.pid)).find(p=>p.pid===parentPid)?.started;
  if(!parentStarted){app.exit(1);return;}
  await app.whenReady();
  let window:BrowserWindow|undefined,snapshot:RecoverySnapshot={schemaVersion:1,hostVersion:app.getVersion(),safeMode:false,boot:'starting',pending:[],incidents:[]};
  const startupAt=Date.now();
  let heartbeat=Date.now(),rendererAge=0,rendererMonitoring=false,hung=false,disconnected=false,stopping=false,requestId=0,restarting=false;
  const replies=new Map<number,{resolve:(value:unknown)=>void;reject:()=>void;timer:ReturnType<typeof setTimeout>}>();
  const locallyObserved=new Map<string,RecoverySnapshot['incidents'][number]>();
  const seenIncidents=new Set<string>();let safeModeShown=false;
  const observed=()=>({...snapshot,incidents:[...snapshot.incidents,...locallyObserved.values()].slice(-50)});
  const show=async()=>{
    if(stopping)return;
    if(window&&!window.isDestroyed()){if(!process.env.AGENT_WORKBENCH_TEST_HIDDEN)window.show();return;}
    window=new BrowserWindow({width:780,height:730,minWidth:440,minHeight:420,show:false,title:'插件恢复 · AgentWorkbench',autoHideMenuBar:true,backgroundColor:'#faf9f6',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,offscreen:!!process.env.AGENT_WORKBENCH_TEST_HIDDEN}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(recoveryPanelHtml));if(!process.env.AGENT_WORKBENCH_TEST_HIDDEN)window.show();
    window.on('close',event=>{if(!stopping){event.preventDefault();window?.hide();}});
  };
  const record=(code:string,phase:'host'|'renderer'|'startup')=>{
    const candidates=snapshot.pending.filter(p=>phase==='startup'||p.phase===phase||phase==='host'&&p.phase==='cleanup');
    for(const candidate of candidates.length?candidates:[{id:'workbench.unknown',phase}]){
      const key=code+':'+candidate.id;if(locallyObserved.has(key))continue;
      locallyObserved.set(key,{...candidate,key,code,phase,certainty:candidates.length?'suspected':'unknown',at:new Date().toISOString(),hostVersion:snapshot.hostVersion,repairable:false});
    }
    void show();
  };
  const sendAction=(action:string)=>new Promise<unknown>((resolve,reject)=>{
    if(disconnected||!process.connected){reject(Error('PLUGIN_PARENT_UNAVAILABLE'));return;}
    // A batch can contain 50 separately bounded activations. The independent
    // panel keeps safe restart available while waiting for this result.
    const request=++requestId,timer=setTimeout(()=>{replies.delete(request);reject(Error('PLUGIN_RECOVERY_ACTION_TIMEOUT'));},action==='repair'?10*60*1000:10000);
    replies.set(request,{resolve,reject:()=>reject(Error('PLUGIN_RECOVERY_ACTION_FAILED')),timer});process.send?.({type:'action',action,request},error=>{if(error){clearTimeout(timer);replies.delete(request);reject(Error('PLUGIN_PARENT_UNAVAILABLE'));}});
  });
  const restart=async(safe:boolean)=>{
    if(restarting)throw Error('PLUGIN_RESTART_PENDING');
    // Persist before terminating. No plugin cleanup or middleware runs on this emergency path.
    await writeSafeMode(directory,safe);restarting=true;
    try{await stopOwnedWorkbench(parentPid,process.pid,parentStarted);}catch(error){if(process.env.AGENT_WORKBENCH_TEST_DATA)await atomicWrite(path.join(directory,'plugin-recovery-test-stop-error.txt'),String(error));restarting=false;throw Error('PLUGIN_PARENT_STOP_UNCONFIRMED');}
    for(let i=0;i<100&&process.connected;i++)await new Promise(resolve=>setTimeout(resolve,50));
    if(process.connected){restarting=false;throw Error('PLUGIN_PARENT_STOP_UNCONFIRMED');}
    const env={...process.env};delete env.AGENT_WORKBENCH_RECOVERY_DIRECTORY;
    if(env.AGENT_WORKBENCH_TEST_DATA&&env.AGENT_WORKBENCH_TEST_APP_PORT&&env.AGENT_WORKBENCH_TEST_GUARD_PORT){
      // Chromium debugging sockets can outlive the killed browser on Windows.
      // Only synthetic QA enables debugging; allocate new ports for each real restart.
      const servers=[createServer(),createServer()];for(const server of servers)await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
      const ports=servers.map(server=>(server.address() as {port:number}).port);for(const server of servers)await new Promise<void>(resolve=>server.close(()=>resolve()));
      env.AGENT_WORKBENCH_TEST_APP_PORT=String(ports[0]);env.AGENT_WORKBENCH_TEST_GUARD_PORT=String(ports[1]);
      await atomicWrite(path.join(directory,'plugin-recovery-test-ports.json'),JSON.stringify({main:ports[0],guardian:ports[1]}));
    }
    const args=app.isPackaged?[]:[app.getAppPath()];
    const child=spawn(process.execPath,args,{env,detached:true,stdio:'ignore',windowsHide:true});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();stopping=true;app.quit();
    return {restarted:true};
  };
  ipcMain.handle('workbench:call',async(event,method:unknown)=>{
    try{
      if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!event.senderFrame.url.startsWith('data:text/html;charset=utf-8,'))throw Error('PLUGIN_RECOVERY_SOURCE_INVALID');
      switch(method){
        case 'recovery/status':return {ok:true,value:{snapshot:observed(),hung,disconnected}};
        case 'recovery/copy':clipboard.writeText(JSON.stringify(recoveryDiagnostic(observed(),{hung,disconnected}),null,2));return {ok:true,value:{message:'诊断信息已复制，不包含聊天正文、路径或凭据。'}};
        case 'recovery/copy-repair':{
          const language=await readRecoveryLanguage(directory),text=buildPluginRepairPrompt(observed(),language,{hung,disconnected});
          await savePluginRepairDraft(directory,text,language);clipboard.writeText(text);
          if(snapshot.safeMode&&!hung&&!disconnected)await sendAction('show').catch(()=>{});
          return {ok:true,value:{message:snapshot.safeMode?'已复制修复提示，将填入新会话草稿。请选择模型，检查内容后自行发送。':'已复制修复提示；进入安全模式后会填入新会话草稿，不会自动发送或选择模型。'}};
        }
        case 'recovery/safe':return {ok:true,value:await restart(true)};
        case 'recovery/normal':return {ok:true,value:await restart(false)};
        case 'recovery/continue':await sendAction('show');window.hide();return {ok:true,value:{}};
        case 'recovery/repair':return {ok:true,value:await sendAction('repair')};
        case 'recovery/quit':stopping=true;await stopOwnedWorkbench(parentPid,process.pid,parentStarted);app.quit();return {ok:true,value:{}};
        default:throw Error('PLUGIN_RECOVERY_ACTION_INVALID');
      }
    }catch{return {ok:false,error:'PLUGIN_RECOVERY_ACTION_FAILED'};}
  });
  process.on('message',(value:Wire)=>{
    if(value?.type==='snapshot'&&value.snapshot){snapshot=value.snapshot;const fresh=snapshot.incidents.some(i=>!seenIncidents.has(i.key));for(const incident of snapshot.incidents)seenIncidents.add(incident.key);if(fresh||snapshot.safeMode&&!safeModeShown)void show();if(snapshot.safeMode)safeModeShown=true;}
    if(value?.type==='heartbeat'){heartbeat=Date.now();rendererAge=value.rendererAge??0;rendererMonitoring=!!value.rendererMonitoring;if(hung&&rendererAge<timeoutMs())hung=false;}
    if(value?.type==='show')void show();
    if(value?.type==='stop'){stopping=true;app.quit();}
    if(value?.type==='result'&&typeof value.request==='number'){const reply=replies.get(value.request);if(reply){clearTimeout(reply.timer);replies.delete(value.request);if(value.ok)reply.resolve(value.result);else reply.reject();}}
  });
  process.on('disconnect',()=>{disconnected=true;if(!stopping&&!restarting)record('PLUGIN_PROCESS_EXITED','startup');});
  const timer=setInterval(()=>{
    if(stopping||disconnected||restarting)return;
    if(Date.now()-heartbeat>timeoutMs()){hung=true;record('PLUGIN_PROCESS_UNRESPONSIVE','host');}
    else if(rendererMonitoring&&rendererAge>timeoutMs()){hung=true;record('PLUGIN_RENDERER_UNRESPONSIVE','renderer');}
    else if(snapshot.boot==='starting'&&Date.now()-startupAt>Math.max(2*timeoutMs(),5000)){record('WORKBENCH_STARTUP_INCOMPLETE','startup');}
  },500);
  app.on('will-quit',()=>{clearInterval(timer);for(const reply of replies.values()){clearTimeout(reply.timer);reply.reject();}});
  if(process.connected)process.send({type:'ready'},()=>{});
}
