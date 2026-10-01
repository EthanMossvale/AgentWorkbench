import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { AttachmentStore } from '../apps/desktop/host/attachments';
import { WorkspaceGeneratedImages } from '../apps/desktop/host/generated-images';
import { attachNativeObservation } from '../apps/desktop/host/native-observation';
import { normalizeCodexEvent } from '../packages/runtime-codex';
import { decodeNativeFrame } from '../services/remote-supervisor';
import { ProcessSupervisor } from '../services/remote-supervisor';
import { CODEX_IMAGE_FRAME_BYTES } from '../packages/generated-images/types';
import { StateStore, SecretStore, initialState } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { HostServiceRegistry } from '../packages/plugins-core/services';
import { markObservationInterrupted } from '../packages/collaboration-core/activity';
import type { GeneratedImageInput } from '../packages/generated-images/types';
import type { Session } from '../packages/contracts';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const bytes=Buffer.from(png,'base64');
async function fixture(){
  const directory=await mkdtemp(path.join(tmpdir(),'awb-generated-')),projectPath=path.join(directory,'workspace');await mkdir(projectPath);
  const attachments=new AttachmentStore(path.join(directory,'attachments'),undefined,[],undefined,{nativePaths:true});
  const service=new WorkspaceGeneratedImages(attachments);
  const input:GeneratedImageInput={sessionId:'session',threadId:'thread',turnId:'turn',itemId:'image',projectPath,result:png};
  const state=initialState();state.hosts.push({id:'host',name:'Fixture',hostname:'fixture.example',port:22,username:'member',role:'workspace',identityFile:'fixture',knownHostsFile:'fixture',ownerId:'owner',workspaceGeneration:'one'});
  state.sessions.push({id:'session',title:'Fixture',projectId:null,projectPath,archived:false,pinned:false,group:'',createdAt:new Date().toISOString(),status:'running',messages:[],binding:{runtime:'codex',provider:'openai',accountRef:'fixture',executionId:'local-device',egress:'vps',hostId:'host',nativeSessionId:'thread'}} as Session);
  const source=new EventEmitter();
  const complete=(overrides:Record<string,unknown>={},threadId='thread')=>decodeNativeFrame(Buffer.from(JSON.stringify({method:'item/completed',params:{threadId,turnId:'turn',item:{type:'imageGeneration',id:'image',status:'completed',result:png,savedPath:'/untrusted/remote/image.png',...overrides}}})+'\n'));
  return {directory,projectPath,attachments,service,input,state,source,complete,close:()=>rm(directory,{recursive:true,force:true})};
}

test('image sink writes one workspace PNG, verifies bytes, persists source metadata and replays without duplicates',async()=>{
  const f=await fixture();try{const a=await f.service.receive(f.input);assert.equal(a.storage,'source');assert.ok(a.path.startsWith(path.join(f.projectPath,'generated_images')+path.sep));assert.deepEqual(await readFile(a.path),bytes);
    const restart=new WorkspaceGeneratedImages(new AttachmentStore(path.join(f.directory,'attachments')));
    const again=await restart.receive(f.input);assert.equal(again.id,a.id);assert.equal((await readdir(path.dirname(a.path))).length,1);assert.equal((await readdir(path.join(f.directory,'attachments',a.id))).length,1);
    await f.attachments.cleanup([a.id],Date.now()+10*86400000);assert.equal((await f.attachments.payloads([a.id]))[0]!.data.length,bytes.length);
  }finally{await f.close();}
});
test('image sink rejects encoding, non-PNG, size and protected destinations without creating files',async()=>{
 const f=await fixture();try{for(const result of ['https://example.invalid/image.png','data:image/png;base64,'+png,'AAAA',png+'====','a'.repeat(28*1024*1024)])await assert.rejects(f.service.receive({...f.input,result}),/GENERATED_IMAGE_/);
  await assert.rejects(f.service.receive({...f.input,projectPath:path.join(f.projectPath,'.codex')}),/WORKSPACE_INVALID/);assert.deepEqual(await readdir(f.projectPath),[]);
 }finally{await f.close();}
});
test('image sink never overwrites changed files or follows output directory links',async()=>{
 const f=await fixture();try{const a=await f.service.receive(f.input);await writeFile(a.path,Buffer.alloc(bytes.length));await assert.rejects(f.service.receive(f.input),/FILE_CHANGED/);assert.deepEqual(await readFile(a.path),Buffer.alloc(bytes.length));
  const other=path.join(f.directory,'other');await mkdir(other);await rm(path.join(f.projectPath,'generated_images'),{recursive:true});await symlink(other,path.join(f.projectPath,'generated_images'),process.platform==='win32'?'junction':'dir');await assert.rejects(f.service.receive({...f.input,itemId:'new'}),/DIRECTORY_CHANGED/);assert.deepEqual(await readdir(other),[]);
 }finally{await f.close();}
});
test('image source hardlinks fail verification and arbitrary identifiers cannot escape the workspace',async()=>{
 const f=await fixture();try{const a=await f.service.receive({...f.input,itemId:'../../escaped'});assert.equal(path.dirname(a.path),path.join(f.projectPath,'generated_images'));await link(a.path,path.join(f.directory,'linked'));await assert.rejects(f.service.receive({...f.input,itemId:'../../escaped'}),/FILE_CHANGED/);
 }finally{await f.close();}
});
test('managed workspaces are explicitly authorized and generated records do not allow arbitrary protected reads',async()=>{
 const f=await fixture();try{const protectedStore=new AttachmentStore(path.join(f.directory,'controlled-attachments'),undefined,[f.directory]);const rejected=new WorkspaceGeneratedImages(protectedStore,[f.directory]);await assert.rejects(rejected.receive(f.input),/WORKSPACE_INVALID/);
  const allowed=new WorkspaceGeneratedImages(protectedStore,[f.directory],async(id,root)=>id===f.input.sessionId&&root===f.projectPath);const a=await allowed.receive(f.input);assert.equal((await protectedStore.payloads([a.id]))[0]!.data.length,bytes.length);
  const metadata=path.join(f.directory,'controlled-attachments',a.id,'metadata.json');await writeFile(metadata,JSON.stringify({...a,path:path.join(f.directory,'secret.json')}));await assert.rejects(protectedStore.payloads([a.id]),/SOURCE_INVALID/);
 }finally{await f.close();}
});
test('native image frames larger than the former 8 MiB limit arrive intact without logging payload bytes',async()=>{
 const process=new ProcessSupervisor({executable:globalThis.process.execPath,args:['-e',`process.stdout.write(JSON.stringify({method:'item/completed',params:{item:{type:'imageGeneration',result:'a'.repeat(9*1024*1024)}}})+'\\n')`],maxFrameBytes:CODEX_IMAGE_FRAME_BYTES});
 let length=0,fault='';process.on('frame',frame=>{length=frame.value.params.item.result.length;});process.on('fault',e=>fault=String(e));await process.start();await process.waitForExit();assert.equal(length,9*1024*1024);assert.equal(fault,'');
});
test('native completed event alone persists and verifies locally before acknowledgement, with no user prompt or extra model turn',async()=>{
 const f=await fixture();let acks=0;const store=new StateStore(path.join(f.directory,'state'));await store.load();await store.update(s=>Object.assign(s,f.state));
 const observer=attachNativeObservation('session',f.source,()=>store.snapshot(),fn=>store.update(fn),{service:f.service,acknowledge:async receipt=>{acks++;const persisted=JSON.parse(await readFile(path.join(f.directory,'state','state.json'),'utf8'));const delivery=persisted.sessions[0].activities[0].imageDelivery;assert.equal(delivery.status,'saved');assert.equal(delivery.attachment.sha256,receipt.sha256);assert.deepEqual(await readFile(delivery.attachment.path),bytes);return {removed:true};}});
 try{const frame=f.complete();f.source.emit('event',normalizeCodexEvent(frame,'session',1));await observer.flush();const activity=store.snapshot().sessions[0]!.activities![0]!;assert.equal(activity.imageDelivery!.remoteCopy,'removed');assert.equal(acks,1);assert.deepEqual(store.snapshot().sessions[0]!.messages,[]);assert.equal(JSON.stringify(store.snapshot()).includes(png),false);assert.equal(activity.title,activity.imageDelivery!.attachment!.path);
  f.source.emit('event',normalizeCodexEvent(frame,'session',2));await observer.flush();assert.equal(acks,1);const reloaded=new StateStore(path.join(f.directory,'state'));await reloaded.load();assert.equal(reloaded.snapshot().sessions[0]!.activities![0]!.imageDelivery!.attachment!.id,activity.imageDelivery!.attachment!.id);
 }finally{await observer.dispose();await f.close();}
});
test('child generation is attributed to its child and failed native generation does not save',async()=>{
 const f=await fixture();f.state.sessions[0]!.nativeChildren=[{runtime:'codex',nativeChildId:'child',operation:'spawn',status:'running',updatedAt:new Date().toISOString()}];const observer=attachNativeObservation('session',f.source,()=>structuredClone(f.state),async fn=>fn(f.state),{service:f.service});
 try{f.source.emit('childEvent',{nativeThreadId:'child',frame:f.complete({},'child')});f.source.emit('event',normalizeCodexEvent(f.complete({id:'failed',status:'failed',result:''}),'session',2));await observer.flush();assert.equal(f.state.sessions[0]!.activities![0]!.nativeChildId,'child');assert.equal(f.state.sessions[0]!.activities![0]!.imageDelivery!.status,'saved');assert.equal(f.state.sessions[0]!.activities![1]!.imageDelivery,undefined);
 }finally{await observer.dispose();await f.close();}
});
test('save failure, unowned thread and remote receipt failure remain visible without deleting or regenerating',async()=>{
 const f=await fixture();let acks=0;const observer=attachNativeObservation('session',f.source,()=>structuredClone(f.state),async fn=>fn(f.state),{service:f.service,acknowledge:async()=>{acks++;throw Error('old broker does not implement receipt');}});
 try{f.source.emit('event',normalizeCodexEvent(f.complete({result:'invalid'}),'session',1));await observer.flush();assert.equal(f.state.sessions[0]!.activities![0]!.imageDelivery!.status,'failed');assert.equal(acks,0);
  f.source.emit('event',normalizeCodexEvent(f.complete({id:'foreign'},'foreign'),'session',2));await observer.flush();assert.equal(f.state.sessions[0]!.activities![1]!.imageDelivery!.error,'GENERATED_IMAGE_THREAD_NOT_OWNED');
  f.source.emit('event',normalizeCodexEvent(f.complete({id:'good'}),'session',3));await observer.flush();assert.equal(acks,1);const d=f.state.sessions[0]!.activities![2]!.imageDelivery!;assert.equal(d.status,'saved');assert.equal(d.remoteCopy,'retained');assert.deepEqual(await readFile(d.attachment!.path),bytes);
 }finally{await observer.dispose();await f.close();}
});
test('failed durable state commit cannot trigger remote cleanup',async()=>{
 const f=await fixture();let acks=0;const observer=attachNativeObservation('session',f.source,()=>structuredClone(f.state),async fn=>{const next=structuredClone(f.state);fn(next);if(next.sessions[0]?.activities?.some(a=>a.imageDelivery?.status==='saved'))throw Error('disk full');Object.assign(f.state,next);},{service:f.service,acknowledge:async()=>{acks++;return {removed:true};}});
 try{f.source.emit('event',normalizeCodexEvent(f.complete(),'session',1));await assert.rejects(observer.flush(),/disk full/);assert.equal(acks,0);assert.equal((await readdir(path.join(f.projectPath,'generated_images'))).length,1);
 }finally{await observer.dispose().catch(()=>{});await f.close();}
});
test('disconnect drains already-received artifacts and does not claim unconfirmed cleanup',async()=>{
 const f=await fixture();const observer=attachNativeObservation('session',f.source,()=>structuredClone(f.state),async fn=>fn(f.state),{service:f.service,acknowledge:async()=>{throw Error('disconnected');}});
 try{f.source.emit('event',normalizeCodexEvent(f.complete(),'session',1));f.source.emit('disconnect');await observer.flush();const d=f.state.sessions[0]!.activities![0]!.imageDelivery!;assert.equal(d.status,'saved');assert.equal(d.remoteCopy,'retained');
 }finally{await observer.dispose();await f.close();}
});

test('local provider delivery and interrupted recovery never claim a remote copy or send cleanup',async()=>{
 const f=await fixture();const session=f.state.sessions[0]!;session.binding={...session.binding,egress:'direct-api',hostId:undefined,modelConnectionId:'connection',modelMappingId:'model'};let acks=0;
 const observer=attachNativeObservation('session',f.source,()=>structuredClone(f.state),async fn=>fn(f.state),{service:{receive:async input=>{assert.equal(session.activities?.find(a=>a.imageDelivery?.status==='receiving')?.imageDelivery?.remoteCopy,'not-applicable');return f.service.receive(input);}},acknowledge:async()=>{acks++;return {removed:true};}});
 try{f.source.emit('event',normalizeCodexEvent(f.complete({result:'invalid'}),'session',1));await observer.flush();assert.equal(session.activities![0]!.imageDelivery!.remoteCopy,'not-applicable');
  f.source.emit('event',normalizeCodexEvent(f.complete({id:'local'}),'session',2));await observer.flush();assert.equal(acks,0);assert.equal(session.activities![1]!.imageDelivery!.status,'saved');assert.equal(session.activities![1]!.imageDelivery!.remoteCopy,'not-applicable');
  session.activities![1]!.imageDelivery={status:'receiving',remoteCopy:'not-applicable'};markObservationInterrupted(session);assert.equal(session.activities![1]!.imageDelivery!.remoteCopy,'not-applicable');assert.equal(session.activities![1]!.imageDelivery!.status,'failed');
 }finally{await observer.dispose();await f.close();}
});
test('host plugin service intercepts the actual native path and release restores core implementation',async()=>{
 const f=await fixture();const store=new StateStore(path.join(f.directory,'state'));await store.load();await store.update(s=>Object.assign(s,f.state));const controller=new WorkbenchController(store,new SecretStore(f.directory,{encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),{attachments:f.attachments,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
 const registry=new HostServiceRegistry();registry.register('images.generated',controller.developmentServices()['images.generated']!);let called=0;const release=registry.intercept('images.generated','receive',async(next,...args)=>{called++;return next(...args);});
 try{const observation=await controller.observeNativeSession('session',f.source);f.source.emit('event',normalizeCodexEvent(f.complete(),'session',1));await observation.flush();assert.equal(called,1);release();f.source.emit('event',normalizeCodexEvent(f.complete({id:'second'}),'session',2));await observation.flush();assert.equal(called,1);assert.ok(store.snapshot().sessions[0]!.activities!.every(a=>a.imageDelivery?.status==='saved'));
  await assert.rejects(controller.call('workbench/generatedImage/acknowledge',{}));
 }finally{release();await controller.dispose();await f.close();}
});
test('broker image receipts validate native ownership and fail closed on platforms without secure deletion',()=>{
 const result=spawnSync('python',['scripts/test-generated-image-receipts.py'],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stdout+result.stderr);
});
