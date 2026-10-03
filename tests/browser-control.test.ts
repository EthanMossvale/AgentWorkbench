import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {RemoteBrowserService} from '../packages/remote-account-catalog/browser';
import {browserViewerTunnelArgs,connectBrowserViewer,probeBrowserViewer} from '../packages/remote-account-catalog/browser-viewer';
import type {SshHost} from '../packages/contracts';

const host:SshHost={id:'browser-fixture',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',ownerId:'fixture',workspaceGeneration:'g',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts')};
const profileKey='a'.repeat(32);
const reply=(value:unknown)=>({exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({ok:true,value})});
function fixture(){
 const calls:any[]=[],opened:string[]=[],closed:number[]=[];let failure='',openFailure=false,count=0;
 const service=new RemoteBrowserService(async url=>{if(openFailure)throw Error('No default browser');opened.push(url);},async(_host,_command,options)=>{
  const request=JSON.parse(options!.stdin!).request;calls.push(request);
  if(failure)return {exitCode:1,signal:null,stderr:'',stdout:JSON.stringify({ok:false,error:failure})};
  return reply({running:request.action!=='stop',profilesPreserved:true,...(request.action==='launch'?{profileKey:request.profileKey}:{})});
 },async()=>{const id=++count;return {url:`http://127.0.0.1:${16000+id}/vnc.html?autoconnect=1&resize=scale`,close:async()=>{closed.push(id);}};});
 return {service,calls,opened,closed,fail:(code:string)=>{failure=code;},failOpen:()=>{openFailure=true;}};
}

test('standalone browser launch opens the selected profile and reconnect only rebuilds its viewer',async()=>{
 const f=fixture();try{
  assert.deepEqual(await f.service.control(host,'launch',{profileKey}),{running:true,viewerReady:true,profilesPreserved:true,profileKey});
  assert.equal(f.opened.length,1);assert.deepEqual(f.calls,[{action:'launch',profileKey}]);
  await f.service.control(host,'reconnect');assert.equal(f.opened.length,2);assert.deepEqual(f.closed,[1]);assert.equal(f.calls[1]?.action,'reconnect');
  assert.deepEqual(await f.service.control(host,'stop',{confirm:true}),{running:false,viewerReady:false,profilesPreserved:true});
  assert.deepEqual(f.closed,[1,2]);assert.equal(f.calls.at(-1)?.action,'stop');
 }finally{await f.service.dispose();}
});

test('standalone browser operations require root, a valid profile and explicit shutdown confirmation',async()=>{
 const f=fixture();try{
  await assert.rejects(f.service.control({...host,role:'workspace'},'launch',{profileKey}));
  await assert.rejects(f.service.control(host,'launch',{profileKey:'../elsewhere'}));
  await assert.rejects(f.service.control(host,'stop'));assert.equal(f.calls.length,0);
  f.fail('BROWSER_ALREADY_RUNNING');await assert.rejects(f.service.control(host,'launch',{profileKey}),/先关闭当前浏览器/);
  assert.equal(f.calls.length,1);assert.equal(f.opened.length,0);
 }finally{await f.service.dispose();}
});

test('viewer failure and desktop disposal do not shut down or replay a manually opened remote browser',async()=>{
 const f=fixture();await f.service.control(host,'launch',{profileKey});await f.service.dispose();
 assert.deepEqual(f.closed,[1]);assert.deepEqual(f.calls.map(c=>c.action),['launch']);
 await assert.rejects(f.service.control(host,'reconnect'),/退出/);
 const failed=fixture();try{
  failed.failOpen();await assert.rejects(failed.service.control(host,'launch',{profileKey}),/恢复连接/);
  assert.deepEqual(failed.closed,[1]);assert.deepEqual(failed.calls.map(c=>c.action),['launch']);
 }finally{await failed.service.dispose();}
});

test('unconfirmed remote shutdown closes the local viewer and never reports remote success',async()=>{
 const f=fixture();try{
  await f.service.control(host,'launch',{profileKey});f.fail('BROWSER_STOP_UNCONFIRMED');
  await assert.rejects(f.service.control(host,'stop',{confirm:true}),/关闭尚未确认/);
  assert.deepEqual(f.closed,[1]);assert.equal(f.calls.length,2);assert.equal(f.opened.length,1);
 }finally{await f.service.dispose();}
});

test('rejecting a second browser leaves the first viewer connected',async()=>{
 const f=fixture();try{
  await f.service.control(host,'launch',{profileKey});f.fail('BROWSER_ALREADY_RUNNING');
  await assert.rejects(f.service.control(host,'launch',{profileKey:'b'.repeat(32)}),/先关闭当前浏览器/);
  assert.deepEqual(f.closed,[]);assert.equal(f.opened.length,1);assert.equal(f.calls.length,2);
 }finally{await f.service.dispose();}
});

test('browser operation locks the endpoint, and shutdown cancels an in-flight viewer without remote cleanup',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let calls=0,opened=0,closed=0;
 const service=new RemoteBrowserService(async()=>{opened++;},async()=>{calls++;return reply({running:true,profilesPreserved:true,profileKey});},async()=>{await gate;return {url:'http://127.0.0.1:16091/vnc.html',close:async()=>{closed++;}};});
 const pending=service.control(host,'launch',{profileKey});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(service.busy(host),true);
 await assert.rejects(service.control({...host,id:'alias'},'reconnect'),/正在使用/);
 await assert.rejects(service.profiles(host,'create',{label:'Other'}),/正在使用/);
 await service.dispose();release();await assert.rejects(pending);assert.equal(calls,1);assert.equal(opened,0);assert.equal(closed,1);
});

test('persistent browser tunnel has no timed remote command and retains strict host identity',()=>{
 const args=browserViewerTunnelArgs(host,16321);assert.equal(args.at(-1),host.hostname);
 for(const required of ['-N','StrictHostKeyChecking=yes','IdentitiesOnly=yes','ExitOnForwardFailure=yes','127.0.0.1:16321:127.0.0.1:6091'])assert.ok(args.includes(required));
 assert.ok(!args.some(v=>v.includes('sleep')));assert.throws(()=>browserViewerTunnelArgs(host,80));
});

test('viewer probes require a real RFB websocket banner as well as an HTTP page',async()=>{
 let banner='RFB 003.008\n';const sockets=new Set<import('node:net').Socket>();
 const server=createServer((_request,response)=>response.end('fixture noVNC'));
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',(request,socket)=>{
  const accept=createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\nSec-WebSocket-Protocol: binary\r\n\r\n');
  socket.write(Buffer.concat([Buffer.from([0x82,banner.length]),Buffer.from(banner)]));socket.on('data',()=>socket.end());
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address();assert.ok(address&&typeof address==='object');assert.equal(await probeBrowserViewer(address.port,new AbortController().signal),true);banner='NOT A SCREEN';assert.equal(await probeBrowserViewer(address.port,new AbortController().signal),false);}
 finally{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('failed tunnel readiness terminates only its exact SSH child',async()=>{
 const child=new EventEmitter() as any;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();let kills=0;
 child.kill=()=>{kills++;child.emit('close',0);return true;};
 await assert.rejects(connectBrowserViewer(host,new AbortController().signal,{port:async()=>16321,launch:()=>child,probe:async()=>{child.emit('close',1);return false;},pause:async()=>{}}));
 assert.equal(kills,0);
 const active=new EventEmitter() as any;active.stdin=new PassThrough();active.stdout=new PassThrough();active.stderr=new PassThrough();active.kill=()=>{kills++;active.emit('close',0);return true;};
 await assert.rejects(connectBrowserViewer(host,new AbortController().signal,{port:async()=>16321,launch:()=>active,probe:async()=>{throw Error('fixture transport failed');}}));assert.equal(kills,1);
});
