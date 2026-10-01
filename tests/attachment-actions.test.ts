import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {AttachmentStore} from '../apps/desktop/host/attachments';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {SecretStore,StateStore} from '../apps/desktop/host/store';
import {attachmentDraft} from '../apps/desktop/renderer/attachment-draft';
import {createAttachmentActions,type AttachmentActionContext,type AttachmentMenuAction} from '../apps/desktop/renderer/attachment-actions';
import type {Attachment} from '../packages/attachments/types';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=','base64');

test('copy image uses verified original bytes, rejects non-images and changed source files',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-attachment-actions-'));
  try{
    const copied:Uint8Array[]=[],store=new AttachmentStore(path.join(root,'files'),undefined,[],undefined,{nativePaths:true,temporaryDirectory:path.join(root,'temp'),copyImage:async data=>{copied.push(data);}});
    const source=path.join(root,'reference.png');await writeFile(source,png);
    const [image,file]=await store.import([{filePath:source},{name:'note.txt',bytes:Buffer.from('Notes')}]);
    assert.deepEqual(await store.copyImage(image!.id),{copied:true});assert.deepEqual(copied,[png]);
    await assert.rejects(store.copyImage(file!.id),/ATTACHMENT_IMAGE_INVALID/);
    await writeFile(source,'changed');await assert.rejects(store.copyImage(image!.id),/变化/);assert.equal(copied.length,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('attachment host commands remain usable while a session runs and await clipboard acknowledgement',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-attachment-host-'));
  let controller:WorkbenchController|undefined;
  try{
    const opened:string[]=[],store=new StateStore(path.join(root,'state'));await store.load();
    const attachments=new AttachmentStore(path.join(root,'files'),undefined,[],undefined,{temporaryDirectory:path.join(root,'temp'),copyImage:async()=>{throw Error('Synthetic clipboard rejection');}});
    const [image,file]=await attachments.import([{name:'reference.png',bytes:png},{name:'notes.txt',bytes:Buffer.from('Notes')}]);
    await store.update(state=>{state.sessions.push({id:'synthetic-running',projectId:null,projectPath:root,title:'Running fixture',status:'running',binding:{runtime:'demo',provider:'demo',accountRef:'demo',executionId:'local-device',egress:'demo'},createdAt:'2026-09-30T00:00:00Z',messages:[],pinned:false,archived:false,group:''});});
    controller=new WorkbenchController(store,new SecretStore(root,{encrypt:()=>{throw Error('No credentials in fixture');},decrypt:()=>''}),{attachments,pickDirectory:async()=>null,openPath:async target=>{opened.push(target);},copy:async()=>{throw Error('Synthetic text clipboard rejection');},nativeCapabilities:()=>[]},()=>{});
    assert.deepEqual(await controller.call('attachments/open',{id:file!.id}),{opened:true});assert.deepEqual(opened,[file!.path]);
    await assert.rejects(controller.call('attachments/copy-image',{id:image!.id}),/Synthetic clipboard rejection/);
    await assert.rejects(controller.call('clipboard/write',{text:'example'}),/Synthetic text clipboard rejection/);
    await writeFile(file!.path,'changed');await assert.rejects(controller.call('attachments/open',{id:file!.id}),/变化/);assert.equal(opened.length,1);
    assert.equal(store.snapshot().sessions[0]!.status,'running');assert.deepEqual(store.snapshot().sessions[0]!.messages,[]);
  }finally{await controller?.dispose();await rm(root,{recursive:true,force:true});}
});

test('draft API selects only the active owner, deduplicates IDs and never falls back to a retired composer',async()=>{
  let firstCalls=0,secondCalls=0;
  const first=attachmentDraft.register(async ids=>{firstCalls++;return{added:ids.length,duplicates:0};});
  const second=attachmentDraft.register(async ids=>{secondCalls++;return{added:ids.length,duplicates:0};});
  try{
    first();assert.deepEqual(await attachmentDraft.add(['one','one','two']),{added:2,duplicates:0});assert.equal(firstCalls,0);assert.equal(secondCalls,1);
    await assert.rejects(attachmentDraft.add([]),/IDS_INVALID/);await assert.rejects(attachmentDraft.add(Array(11).fill('one')),/IDS_INVALID/);
    second();await assert.rejects(attachmentDraft.add(['one']),/UNAVAILABLE/);
  }finally{first();second();}
});

const menuImage:Attachment={id:'image',name:'reference.png',size:100,mime:'image/png',path:'fixture/reference.png',sha256:'synthetic'};
test('plugin attachment actions filter real surfaces and copy registration data',async()=>{
  const registry=createAttachmentActions(),seen:AttachmentActionContext[]=[];
  const surfaces:('viewer'|'history')[]=['viewer'];
  const handle=registry.register('qa.media',{id:'inspect',label:'Inspect',surfaces,kind:'image',run:context=>{seen.push(context);}});
  surfaces.push('history');assert.equal(registry.resolve(menuImage,'history',[]).length,0);
  assert.equal(registry.resolve({...menuImage,mime:'text/plain'},'viewer',[]).length,0);
  const [action]=registry.resolve(menuImage,'viewer',[]);assert.equal(action!.id,'plugin:qa.media/inspect');await action!.run();
  assert.equal(seen[0]!.attachment.id,'image');assert.equal(Object.isFrozen(seen[0]!.attachment),true);assert.equal(Object.isFrozen(seen[0]),true);
  assert.equal(registry.resolve(menuImage,'viewer',[],true)[0]!.disabled,true);
  handle.dispose();assert.throws(()=>action!.run(),/UNAVAILABLE/);assert.equal(registry.resolve(menuImage,'viewer',[]).length,0);
});
test('plugin attachment replacements stack, delegate and restore across non-LIFO disposal',async()=>{
  const registry=createAttachmentActions();let calls=0,invoke:AttachmentActionContext['invokeDefault'];
  const base:AttachmentMenuAction[]=[{id:'copy-path',label:'Copy path',run:()=>{calls++;}}];
  const first=registry.register('qa.one',{id:'copy',label:'First',replaces:'copy-path',run:context=>context.invokeDefault?.()});
  const second=registry.register('qa.two',{id:'copy',label:'Second',replaces:'copy-path',run:context=>{invoke=context.invokeDefault;return context.invokeDefault?.();}});
  assert.equal(registry.resolve(menuImage,'draft',base)[0]!.label,'Second');await registry.resolve(menuImage,'draft',base)[0]!.run();assert.equal(calls,1);
  first.dispose();assert.equal(registry.resolve(menuImage,'draft',base)[0]!.label,'Second');second.dispose();second.dispose();
  assert.equal(registry.resolve(menuImage,'draft',base)[0]!.label,'Copy path');assert.throws(()=>invoke?.(),/UNAVAILABLE/);
  const disabled=registry.register('qa.one',{id:'copy',label:'Again',replaces:'copy-path',run:()=>{}});
  assert.equal(registry.resolve(menuImage,'viewer',[{...base[0]!,disabled:true}])[0]!.disabled,true);disabled.dispose();
});
test('invalid and duplicate action registration is rejected and notification failures roll back',()=>{
  const registry=createAttachmentActions(),definition={id:'inspect',label:'Inspect',run:()=>{}};
  assert.throws(()=>registry.register('qa',{...definition,id:'../bad'}),/INVALID/);
  const action=registry.register('qa',definition);assert.throws(()=>registry.register('qa',definition),/DUPLICATE/);action.dispose();
  let calls=0;const stop=registry.subscribe(()=>{if(++calls===1)throw Error('Synthetic listener rejection');});
  assert.throws(()=>registry.register('qa',definition),/Synthetic/);stop();assert.equal(registry.resolve(menuImage,'viewer',[]).length,0);
  registry.register('qa',definition).dispose();
});
