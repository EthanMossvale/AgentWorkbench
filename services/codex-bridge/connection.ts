import net, {type Socket} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import type {Session,SshHost} from '../../packages/contracts';
import {buildSshArgs,buildSshEnvironment,redactSshDiagnostic,SSH_EXECUTABLE} from '../../packages/ssh-transport';
import {createNativeProcess,ProcessSupervisor} from '../remote-supervisor';
import {LocalExecutorSupervisor} from '../local-executor';
import {CodexRpcClient,environmentRegistration} from '../../packages/runtime-codex';
import {NATIVE_OWNER_REMOTE_BRIDGE} from './native-owner-remote';

const listen=(server:net.Server)=>new Promise<number>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve((server.address() as net.AddressInfo).port));});
const close=(server:net.Server)=>new Promise<void>(resolve=>server.close(()=>resolve()));
export function accountBinding(ref:string){
 if(!ref.startsWith('vps-account:'))throw Error('Select an assigned remote account before starting Codex.');
 const values=ref.slice(12).split('/').map(decodeURIComponent);
 if(values.length!==5||values[2]!=='codex'||values.some(v=>!v||/[\x00-\x1f]/.test(v)))throw Error('Invalid remote account binding.');
 return {authorityId:values[0],authorityGeneration:values[1],accountId:values[3],accountGeneration:values[4]};
}
export interface CodexConnectionOptions{host:SshHost;session:Session;executable:string;version?:string;directory:string;cwd:string;registerEnvironment?:boolean;}
export interface NativeOwnerReceipt{threadId:string;turnId?:string;uncertain:boolean;interrupted?:boolean;cleanupConfirmed?:boolean;environmentId:string;cwd:string;}
const ACCOUNT_MIGRATION_REQUIRED_MESSAGE='此旧会话需要核对原生账号迁移回执，原账号和历史不会自动替换。';
export class CodexBridgeConnection{
 readonly transport:ProcessSupervisor;readonly rpc:CodexRpcClient;
 private executor?:LocalExecutorSupervisor;private gate?:net.Server;private sockets=new Set<Socket>();private disposal?:Promise<void>;private remotePort?:number;
 private localPort=0;private secret=randomBytes(32).toString('hex');private socketNonce=randomBytes(8).toString('hex');private failure?:Error;private diagnostic='';
 ownerReceipt?:NativeOwnerReceipt;
 private constructor(readonly options:CodexConnectionOptions,gatePort:number){
  const {host,session}=options;
  const source=NATIVE_OWNER_REMOTE_BRIDGE;
  const command=`exec /usr/bin/python3 -u -c "import base64;exec(base64.b64decode('${Buffer.from(source).toString('base64')}'))"`;
  const args=buildSshArgs(host,command).map(value=>value==='ClearAllForwardings=yes'?'ClearAllForwardings=no':value);
  args.splice(args.indexOf('--'),0,'-o','ExitOnForwardFailure=yes','-o','StreamLocalBindMask=0177','-o','StreamLocalBindUnlink=no','-R',`${this.remoteSocket}:127.0.0.1:${gatePort}`);
  this.transport=createNativeProcess({executable:SSH_EXECUTABLE,args,env:buildSshEnvironment()});
  this.rpc=new CodexRpcClient(this.transport,session.id,30000);
  this.transport.on('frame',frame=>{if(frame.value.method==='workbench/bridgeReady'){const port=frame.value.params?.port;if(Number.isInteger(port)&&port>1024&&port<=65535)this.remotePort=port;const receipt=frame.value.params?.sessionReceipt;if(session.binding.accountRuntime==='native-owner'&&receipt&&typeof receipt.threadId==='string'&&receipt.threadId.length<256&&receipt.environmentId===session.binding.executionId&&receipt.cwd===options.cwd)this.ownerReceipt={threadId:receipt.threadId,environmentId:receipt.environmentId,cwd:receipt.cwd,uncertain:receipt.uncertain===true,interrupted:receipt.interrupted===true,cleanupConfirmed:receipt.cleanupConfirmed===true,...(typeof receipt.turnId==='string'&&receipt.turnId.length<256?{turnId:receipt.turnId}:{})};}});
  this.transport.on('diagnostic',(value:string)=>{this.diagnostic=(this.diagnostic+redactSshDiagnostic(value,host)).slice(-4096);const match=/Allocated port (\d+) for remote forward/.exec(this.diagnostic);if(match)this.remotePort=Number(match[1]);});
  this.transport.on('fault',(error:Error)=>{this.failure=error;});this.rpc.on('fault',(error:Error)=>{this.failure=error;});
  this.transport.on('disconnect',()=>{void this.dispose();});
 }
 static async open(options:CodexConnectionOptions){
  if(options.host.role!=='workspace'||options.host.username==='root'||options.session.binding.hostId!==options.host.id||options.session.binding.runtime!=='codex')throw Error('A bound member workspace is required.');
  if(options.session.binding.accountRuntime!=='native-owner')throw Error(ACCOUNT_MIGRATION_REQUIRED_MESSAGE);
  const reserved=net.createServer();const localPort=await listen(reserved);await close(reserved);
  const gate=net.createServer();const gatePort=await listen(gate);const connection=new CodexBridgeConnection(options,gatePort);connection.gate=gate;connection.localPort=localPort;
  gate.on('connection',client=>connection.accept(client));
  try{
   await mkdir(options.directory,{recursive:true});
   connection.executor=new LocalExecutorSupervisor({executable:options.executable,version:options.version??'0.155.1',cwd:options.cwd,isolatedCodexHome:path.join(options.directory,'executor-'+randomBytes(12).toString('hex')),port:localPort,authorized:true});
   await connection.executor.start();
   for(let i=0;i<100;i++){const ready=await new Promise<boolean>(resolve=>{const socket=net.connect(localPort,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});if(ready)break;if(i===99)throw Error('Local Codex executor did not become ready. '+connection.executor.diagnostic);await pause(50);}
   await connection.transport.start();
   await connection.transport.write({username:options.host.username,sessionId:options.session.binding.executionSessionId??options.session.id,environmentId:options.session.binding.executionId,cwd:options.cwd,socketPath:connection.remoteSocket,secret:connection.secret,...accountBinding(options.session.binding.accountRef),...(options.session.branch?.native?{fork:options.session.branch.native}:{})});
   for(let i=0;!connection.remotePort;i++){if(connection.failure||connection.transport.state!=='running'||i===300)throw Error('SSH executor tunnel did not become ready. '+connection.diagnostic);await pause(50);}
   await connection.rpc.initialize();
   let info:unknown;
   if(options.registerEnvironment!==false){await connection.rpc.request('environment/add',environmentRegistration(options.session.binding.executionId,connection.endpoint));info=await connection.rpc.request('environment/info',{environmentId:options.session.binding.executionId});}
   return {connection,info};
  }catch(error){await connection.dispose();throw connection.failure??error;}
 }
 get endpoint(){if(!this.remotePort)throw Error('Tunnel is not ready.');return `ws://127.0.0.1:${this.remotePort}/${this.secret}`;}
 private get remoteSocket(){return `/tmp/agent-workbench-${this.options.session.binding.executionSessionId??this.options.session.id}-${this.socketNonce}.sock`;}
 async interrupt(threadId:string,turnId:string){
  // The pinned runtime can acknowledge interruption while a deferred command is still alive.
  // Begin native interruption, and independently terminate this session's owned executor tree.
  const interrupted=this.rpc.request('turn/interrupt',{threadId,turnId}).then(()=>({ok:true as const}),error=>({ok:false as const,error}));
  let failure:unknown;
  try{await this.executor?.disconnect();const result=await interrupted;if(!result.ok)failure=result.error;}catch(error){failure=error;}
  finally{await this.dispose();}
  if(failure)throw failure;
 }
 private accept(client:Socket){
  this.sockets.add(client);client.on('error',()=>{});client.on('close',()=>this.sockets.delete(client));
  let header=Buffer.alloc(0);const timeout=setTimeout(()=>client.destroy(),5000);
  client.once('close',()=>clearTimeout(timeout));
  const receive=(bytes:Buffer)=>{
   header=Buffer.concat([header,bytes]);if(header.length>16384){client.destroy();return;}const end=header.indexOf('\r\n\r\n');if(end<0)return;
   const first=header.indexOf('\r\n');if(header.subarray(0,first).toString('ascii')!==`GET /${this.secret} HTTP/1.1`){client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');return;}
   clearTimeout(timeout);client.pause();client.off('data',receive);
   const upstream=net.connect(this.localPort,'127.0.0.1',()=>{upstream.write(Buffer.concat([Buffer.from('GET / HTTP/1.1'),header.subarray(first)]));client.pipe(upstream);upstream.pipe(client);client.resume();});
   this.sockets.add(upstream);upstream.on('close',()=>{this.sockets.delete(upstream);client.destroy();});upstream.on('error',()=>client.destroy());client.on('close',()=>upstream.destroy());
  };client.on('data',receive);
 }
 dispose(){return this.disposal??=(async()=>{for(const socket of this.sockets)socket.destroy();if(this.gate)await close(this.gate);await Promise.allSettled([this.transport.stop('bridge-dispose'),this.executor?.disconnect()]);})();}
}
