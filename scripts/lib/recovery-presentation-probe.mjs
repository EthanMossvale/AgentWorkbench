import {build} from 'esbuild';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=path.join(root,'apps/desktop/host/plugin-recovery-guardian.ts');
const require=createRequire(import.meta.url);
const settle=()=>new Promise(resolve=>setImmediate(resolve));

/** Executes the production guardian with a synthetic clock and window adapter.
 * Counts OS presentation requests; this is not a visible desktop acceptance. */
export async function probeRecoveryPresentation(file=source){
  const built=await build({stdin:{contents:await readFile(file,'utf8'),sourcefile:file,resolveDir:path.dirname(source),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',external:['electron'],plugins:[{name:'isolated-process-owner',setup(build){
    build.onLoad({filter:/plugin-recovery-process\.ts$/},()=>({contents:'export async function ownedProcessTree(pid){return [{pid,started:"synthetic"}];} export async function stopOwnedWorkbench(){}',loader:'js'}));
  }}]});
  async function fixture(hidden=false){
    let now=1000;const windows=[],timers=[],handlers=new Map();
    const child=new EventEmitter();Object.assign(child,{argv:[],env:{AGENT_WORKBENCH_RECOVERY_DIRECTORY:path.join(root,'build/qa/synthetic-recovery-probe'),...(hidden?{AGENT_WORKBENCH_TEST_HIDDEN:'1'}:{})},ppid:101,pid:102,connected:true,execPath:process.execPath});
    child.send=(message,callback)=>{callback?.();if(message.type==='action')queueMicrotask(()=>child.emit('message',{type:'result',request:message.request,ok:true,result:{shown:true}}));};
    const app=new EventEmitter();Object.assign(app,{setName(){},setPath(){},getVersion:()=> '0.1.0',whenReady:async()=>{},quit(){app.emit('will-quit');},exit(){},commandLine:{appendSwitch(){}}});
    class Window extends EventEmitter{
      constructor(){super();this.shows=0;this.hides=0;this.visible=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.mainFrame={url:'data:text/html;charset=utf-8,synthetic'};windows.push(this);}
      isDestroyed(){return false;}
      async loadURL(){}
      show(){this.shows++;this.visible=true;}
      hide(){this.hides++;this.visible=false;}
      close(){this.emit('close',{preventDefault(){}});}
    }
    class Clock extends Date{static now(){return now;}}
    const module={exports:{}};runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='electron'?{app,BrowserWindow:Window,clipboard:{writeText(){}},ipcMain:{handle:(key,value)=>handlers.set(key,value)}}:require(id),process:child,Buffer,Date:Clock,__dirname:path.dirname(source),console,setTimeout,clearTimeout,setInterval:fn=>{timers.push(fn);return {unref(){}};},clearInterval(){}});
    await module.exports.runRecoveryGuardian();
    const snapshot={schemaVersion:1,hostVersion:'0.1.0',safeMode:false,boot:'ready',pending:[],incidents:[]};
    const send=async message=>{child.emit('message',message);await settle();};
    const tick=async()=>{for(const timer of timers)timer();await settle();};
    const update=async changes=>{Object.assign(snapshot,changes);await send({type:'snapshot',snapshot:{...snapshot}});};
    await update({});
    return {windows,send,tick,update,advance:ms=>{now+=ms;},call:async method=>{const win=windows[0];return handlers.get('workbench:call')({sender:win.webContents,senderFrame:win.webContents.mainFrame},method);}};
  }
  const result={};
  for(const kind of ['host','renderer','startup']){
    const f=await fixture();if(kind==='startup')await f.update({boot:'starting'});
    f.advance(31000);
    if(kind!=='host')await f.send({type:'heartbeat',rendererMonitoring:kind==='renderer',rendererAge:kind==='renderer'?20000:0});
    for(let i=0;i<8;i++)await f.tick();
    const window=f.windows[0],initial=window.shows;window.close();
    for(let i=0;i<8;i++)await f.tick();
    const dismissed=window.shows;
    await f.send({type:'show'});const manual=window.shows;
    await f.call('recovery/continue');for(let i=0;i<8;i++)await f.tick();
    result[kind]={initial,dismissed,manual,continued:window.shows,visible:window.visible,windows:f.windows.length};
  }
  const incidents=await fixture();
  for(let i=0;i<8;i++)await incidents.update({safeMode:true,incidents:[{key:String(i),id:'synthetic.plugin',code:'PLUGIN_HOST_ACTIVATION_FAILED'}]});
  const incidentWindow=incidents.windows[0],initial=incidentWindow.shows;incidentWindow.close();
  await incidents.update({incidents:[{key:'after-close',id:'synthetic.other',code:'PLUGIN_HOST_ACTIVATION_FAILED'}]});
  result.snapshots={initial,dismissed:incidentWindow.shows,visible:incidentWindow.visible};
  const explicit=await fixture();await explicit.send({type:'show'});explicit.advance(31000);for(let i=0;i<8;i++)await explicit.tick();
  const explicitWindow=explicit.windows[0],automaticAfterExplicit=explicitWindow.shows;explicitWindow.close();await explicit.send({type:'show'});
  result.explicit={automaticAfterExplicit,reopened:explicitWindow.shows,visible:explicitWindow.visible};
  const hidden=await fixture(true);hidden.advance(31000);for(let i=0;i<8;i++)await hidden.tick();await hidden.send({type:'show'});
  result.hidden={shows:hidden.windows[0].shows,visible:hidden.windows[0].visible};
  const restart=await fixture();restart.advance(31000);await restart.tick();result.newProcess={shows:restart.windows[0].shows};
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await probeRecoveryPresentation(process.argv[2]??source)));
}
