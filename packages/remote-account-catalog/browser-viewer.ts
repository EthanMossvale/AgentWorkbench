import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import type {SshHost} from '../contracts';
import {SSH_EXECUTABLE,buildSshArgs,buildSshEnvironment} from '../ssh-transport';

export interface BrowserViewerConnection {url:string;close():Promise<void>}
export interface BrowserViewerOptions {webPort?:number}
export type BrowserViewerConnector=(host:SshHost,signal:AbortSignal,options?:BrowserViewerOptions)=>Promise<BrowserViewerConnection>;

/** An explicitly owned, loopback-only tunnel with no remote shell or expiry. */
export function browserViewerTunnelArgs(host:SshHost,port:number,webPort=6091){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid loopback port.');
 const args=buildSshArgs(host,'true').slice(0,-1).map(a=>a==='ClearAllForwardings=yes'?'ClearAllForwardings=no':a);
 args.splice(args.indexOf('--'),0,'-N','-o','ExitOnForwardFailure=yes','-L',`127.0.0.1:${port}:127.0.0.1:${webPort}`);
 return args;
}

const reservePort=()=>new Promise<number>((resolve,reject)=>{
 const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{
  const address=server.address();server.close(error=>error?reject(error):typeof address==='object'&&address?resolve(address.port):reject(Error('No loopback port.')));
 });
});

/** Confirm both the noVNC page and the remote display's RFB handshake. */
export async function probeBrowserViewer(port:number,signal:AbortSignal):Promise<boolean>{
 if(!Number.isInteger(port)||port<1024||port>65535)return false;
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(1500)]);
 try{
  const response=await fetch(`http://127.0.0.1:${port}/vnc.html`,{redirect:'error',signal:bounded});
  await response.body?.cancel();if(!response.ok)return false;
  return await new Promise<boolean>(resolve=>{
   const socket=new WebSocket(`ws://127.0.0.1:${port}/websockify`,['binary']);socket.binaryType='arraybuffer';
   let settled=false,banner='';
   const finish=(ready:boolean)=>{if(settled)return;settled=true;bounded.removeEventListener('abort',abort);socket.close();resolve(ready);};
   const abort=()=>finish(false);bounded.addEventListener('abort',abort,{once:true});
   socket.addEventListener('error',()=>finish(false));socket.addEventListener('close',()=>finish(false));
   socket.addEventListener('message',event=>{
    if(!(event.data instanceof ArrayBuffer))return finish(false);
    banner+=Buffer.from(event.data).toString('ascii');
    if(banner.length>=12)finish(/^RFB 003\.\d{3}\n$/.test(banner));
   });
   if(bounded.aborted)finish(false);
  });
 }catch{return false;}
}

interface ViewerDependencies {
 port():Promise<number>;
 launch(host:SshHost,port:number,webPort:number):ChildProcessWithoutNullStreams;
 probe(port:number,signal:AbortSignal):Promise<boolean>;
 pause(ms:number,signal:AbortSignal):Promise<unknown>;
}
const defaults:ViewerDependencies={
 port:reservePort,
 launch:(host,port,webPort)=>spawn(SSH_EXECUTABLE,browserViewerTunnelArgs(host,port,webPort),{stdio:'pipe',windowsHide:true,shell:false,env:buildSshEnvironment()}),
 probe:probeBrowserViewer,
 pause:(ms,signal)=>pause(ms,undefined,{signal}),
};

export async function connectBrowserViewer(host:SshHost,signal:AbortSignal,dependencies:Partial<ViewerDependencies>&BrowserViewerOptions={}):Promise<BrowserViewerConnection>{
 const io={...defaults,...dependencies},port=await io.port();signal.throwIfAborted();
 const child=io.launch(host,port,dependencies.webPort??6091);let ended=false,closing:Promise<void>|undefined;
 const exited=new Promise<void>(resolve=>{const end=()=>{ended=true;resolve();};child.once('error',end);child.once('close',end);});
 child.stdin.on('error',()=>{});child.stdin.end();child.stdout.resume();child.stderr.resume();
 const close=()=>closing??=(async()=>{
  signal.removeEventListener('abort',abort);
  if(ended)return;child.kill();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([exited,new Promise<void>(resolve=>{timer=setTimeout(resolve,3000);})]);}finally{clearTimeout(timer);}
  if(!ended)child.kill('SIGKILL');
 })();
 const abort=()=>{void close();};signal.addEventListener('abort',abort,{once:true});
 try{
  const deadline=Date.now()+30000;
  while(!ended&&Date.now()<deadline){
   signal.throwIfAborted();
   if(await io.probe(port,signal)){signal.throwIfAborted();if(ended)break;return {url:`http://127.0.0.1:${port}/vnc.html?autoconnect=1&resize=scale`,close};}
   await io.pause(250,signal);
  }
  throw Error('Browser viewer unavailable.');
 }catch(error){await close();throw error;}
}
