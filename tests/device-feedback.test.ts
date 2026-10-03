import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,open,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {AttachmentStore} from '../apps/desktop/host/attachments';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {fileReferenceRecognition,linkedText} from '../packages/navigation/file-links';
import {translationPlacement} from '../packages/translation/display';
import type {Session,DraftPreview} from '../packages/contracts';

async function fixture(){
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-device-feedback-')),store=new StateStore(directory);await store.load();
  const attachments=new AttachmentStore(path.join(directory,'attachments'),undefined,[directory]);
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:v=>Buffer.from(v),decrypt:v=>v.toString()}),{attachments,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],translationFetcher:async()=>{throw Error('Synthetic translator unavailable');}},()=>{});
  const session=await controller.call('session/create',{runtime:'demo'}) as Session;
  return {directory,store,controller,attachments,session,close:async()=>{await controller.dispose();await rm(directory,{recursive:true,force:true});}};
}

for(const runtime of ['claude','codex'] as const)test(`${runtime}: explicit recovery preserves unknown receipts through restart without dispatch`,async()=>{
  const f=await fixture();try{
    await f.store.update(s=>{const session=s.sessions[0]!;session.binding.runtime=runtime;session.binding.hostId='synthetic-host';session.binding.accountRuntime='native-owner';session.status='uncertain';session.nativeError='Unknown cleanup';session.turnTimings=[{id:'unknown',startedAt:'2026-10-01T00:00:00Z',status:'uncertain'}];session.messages=[{id:'pending',role:'user',original:'Keep this source',timestamp:'2026-10-01T00:00:00Z',demo:false,delivery:'uncertain'}];});
    await assert.rejects(f.controller.call('session/end-wait',{sessionId:f.session.id}),/CONFIRM_REQUIRED/);
    (f.controller as any).sessionOperations.set(f.session.id,1);
    await assert.rejects(f.controller.call('session/end-wait',{sessionId:f.session.id,confirm:true}),/RECOVERY_BUSY/);
    (f.controller as any).sessionOperations.delete(f.session.id);
    await f.controller.call('session/end-wait',{sessionId:f.session.id,confirm:true});
    const session=(await new StateStore(f.directory).load()).sessions[0]!;
    assert.equal(session.status,'idle');assert.equal(session.messages[0]!.delivery,'uncertain');assert.equal(session.messages.length,1);
    assert.equal(session.turnTimings![0]!.status,'uncertain');assert.equal(session.turnTimings![0]!.endedAt,undefined);
    assert.match(session.nativeError!,/未知/);
    await assert.rejects(f.controller.call('session/end-wait',{sessionId:f.session.id,confirm:true}),/CONFIRM_REQUIRED/);
  }finally{await f.close();}
});

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=','base64');
for(const runtime of ['claude','codex'])test(`${runtime}: Windows managed layout previews workspace pixels and verified attachment snapshots`,async()=>{
  const f=await fixture();try{
    const workspace=path.join(f.directory,'native-'+runtime,'workspaces','fixture'),file=path.join(workspace,'renders','result.png');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,png);
    const [view]=await f.attachments.importViewedImages([file],workspace);assert.ok(view!.preview);
    assert.equal((await f.attachments.importViewedImages([view!.path],workspace))[0]!.sha256,view!.sha256);
    assert.equal((await new AttachmentStore(path.join(f.directory,'attachments'),undefined,[f.directory]).views([view!.id]))[0]!.sha256,view!.sha256);
    for(const relative of ['secrets/key.png','workspace-devices/private.png','native-'+runtime+'/config.png','native-'+runtime+'/workspaces/other/result.png']){
      const secret=path.join(f.directory,relative);await mkdir(path.dirname(secret),{recursive:true});await writeFile(secret,png);
      assert.equal((await f.attachments.importViewedImages([secret],workspace))[0]!.sha256,view!.sha256);
    }
    const link=path.join(workspace,'escape');await symlink(path.join(f.directory,'secrets'),link,process.platform==='win32'?'junction':'dir');
    assert.equal((await f.attachments.importViewedImages([path.join(link,'key.png')],workspace))[0]!.sha256,view!.sha256);
    await writeFile(view!.path,'changed');await assert.rejects(f.attachments.views([view!.id]),/变化/);await assert.rejects(f.attachments.importViewedImages([view!.path],workspace),/SOURCE_UNAVAILABLE/);
    const large=path.join(os.tmpdir(),path.basename(f.directory)+'.blend'),handle=await open(large,'w');await handle.truncate(21*1024*1024);await handle.close();
    try{await assert.rejects(f.attachments.import([{filePath:large}]),/完整文件路径/);}finally{await rm(large);}
  }finally{await f.close();}
});

test('bare code filenames remain text while explicit links and relative paths retain navigation',()=>{
  assert.equal(fileReferenceRecognition.code('output.blend'),undefined);
  assert.equal(fileReferenceRecognition.code('file.zip'),undefined);
  assert.equal(fileReferenceRecognition.code('renders/output.png')?.path,'renders/output.png');
  assert.equal(linkedText('`output.blend`').some(item=>item.reference),false);
  assert.equal(linkedText('[output](output.blend)').find(item=>item.reference)?.reference?.path,'output.blend');
  const release=fileReferenceRecognition.register({id:'plugin:qa/code',recognize:value=>value==='output.blend'?true:undefined});
  try{assert.equal(fileReferenceRecognition.code('output.blend')?.path,'output.blend');assert.equal(fileReferenceRecognition.code('javascript:bad'),undefined);}finally{release();}
  assert.equal(fileReferenceRecognition.code('output.blend'),undefined);
});

test('seamless preset persists, explicit original fallback requires review and never auto-submits',async()=>{
  const f=await fixture();try{
    await f.controller.call('translation/seamless');
    let state=await new StateStore(f.directory).load();assert.equal(state.translationLayout,'translated-only');assert.equal(state.autoSubmitTranslated,true);
    assert.equal(translationPlacement('translated-only',true,true),'translated-only');
    await assert.rejects(f.controller.call('draft/prepare',{sessionId:f.session.id,text:'保留原稿',bypass:true}),/翻译/);
    const preview=await f.controller.call('draft/prepare',{sessionId:f.session.id,text:'保留原稿',bypass:true,confirmOriginal:true}) as DraftPreview;
    assert.equal(preview.translated,'保留原稿');assert.equal(preview.bypass,true);
    await assert.rejects(f.controller.call('draft/submit',{sessionId:f.session.id,id:preview.id,sourceHash:preview.sourceHash,automatic:true}),/核对预览/);
    assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);await f.controller.call('draft/cancel',{id:preview.id});
    await f.store.update(s=>{s.translationLayout='future-layout';});state=await new StateStore(f.directory).load();assert.equal(state.translationLayout,'future-layout');
    assert.equal(f.controller.translationLayouts.resolve(state.translationLayout),'panel');
    const raw=JSON.parse(await readFile(path.join(f.directory,'state.json'),'utf8'));raw.translationLayout=123;await writeFile(path.join(f.directory,'state.json'),JSON.stringify(raw));
    await assert.rejects(new StateStore(f.directory).load(),/TRANSLATION_LAYOUT_INVALID/);assert.equal(JSON.parse(await readFile(path.join(f.directory,'state.json'),'utf8')).translationLayout,123);
  }finally{await f.close();}
});

test('approved plugin registration reaches layout consumer, recovery and image services with lifecycle cleanup',async()=>{
  const f=await fixture(),plugins=new PluginRegistry(path.join(f.directory,'plugins'));await plugins.initialize();
  for(const [id,service]of Object.entries(f.controller.developmentServices()))if(service)plugins.services.register(id,service,{version:1});
  const id='qa.device-feedback';
  try{
    const manifest={schemaVersion:1,apiVersion:1,id,name:'Feedback fixture',version:'1.0.0',description:'Synthetic lifecycle verification',capabilities:['host'],main:'main.mjs'};
    const source=`export function activate(api){api.onDispose(api.services.get('translation.layouts').register({id:'plugin:'+api.id+'/reading',label:'Fixture reading',mode:'translated-only'}));api.services.intercept('sessions.recovery','endWait',()=>Promise.reject(Error('FIXTURE_RECOVERY')));api.services.intercept('actions.attachments','importViewedImages',()=>Promise.reject(Error('FIXTURE_IMAGES')));}`;
    const zip=path.join(f.directory,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const record=(await plugins.list())[0]!;
    await assert.rejects(plugins.setEnabled(id,record.hash,true),/Explicit approval/);
    for(let cycle=0;cycle<2;cycle++){
      await plugins.setEnabled(id,record.hash,true,true);
      await f.controller.call('translation/layout',{layout:'plugin:'+id+'/reading'});
      assert.equal((await f.controller.call('state/get') as any).translationLayouts.find((item:any)=>item.id==='plugin:'+id+'/reading').mode,'translated-only');
      assert.equal((await new StateStore(f.directory).load()).translationLayout,'plugin:'+id+'/reading');
      assert.equal(f.controller.translationLayouts.resolve('plugin:'+id+'/reading'),'translated-only');
      await assert.rejects(f.controller.call('session/end-wait',{sessionId:f.session.id,confirm:true}),/FIXTURE_RECOVERY/);
      await assert.rejects(f.attachments.importViewedImages([],''),/FIXTURE_IMAGES/);
      await plugins.setEnabled(id,record.hash,false);
      const image=path.join(f.directory,'clipboard-temp','fixture.png');await mkdir(path.dirname(image),{recursive:true});await writeFile(image,png);
      assert.ok((await f.attachments.importViewedImages([image],''))[0]!.preview);
      assert.equal(f.controller.translationLayouts.resolve('plugin:'+id+'/reading'),'panel');
      assert.equal(f.store.snapshot().translationLayout,'plugin:'+id+'/reading');
      await assert.rejects(f.controller.call('session/end-wait',{sessionId:f.session.id,confirm:true}),/CONFIRM_REQUIRED/);
    }
  }finally{await plugins.dispose();await f.close();}
});
