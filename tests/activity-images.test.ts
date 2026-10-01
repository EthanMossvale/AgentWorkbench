import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ActivityImageReader} from '../apps/desktop/host/activity-images';
import {AttachmentStore} from '../apps/desktop/host/attachments';
import {NativeActivityTracker,mergeActivity} from '../packages/collaboration-core/activity';
import {decodeNativeFrame} from '../services/remote-supervisor';
import {initialState} from '../apps/desktop/host/store';
import {HostServiceRegistry} from '../packages/plugins-core/services';
import type {Session} from '../packages/contracts';
import type {ActivityImagesService} from '../packages/attachments/activity-images';

const frame=(value:unknown)=>decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=','base64');
test('native viewing is explicit, separate from generation, and never stores image payloads',()=>{
  const codex=new NativeActivityTracker('codex');
  const viewed=codex.observe(frame({method:'item/completed',params:{item:{id:'view',type:'imageView',path:'/workspace/reference.png'}}}))[0]!;
  assert.equal(viewed.category,'image');assert.deepEqual(viewed.imagePaths,['/workspace/reference.png']);
  const generated=codex.observe(frame({method:'item/completed',params:{item:{id:'generate',type:'imageGeneration',result:'PRIVATE_IMAGE_BYTES',savedPath:'/workspace/result.png'}}}))[0]!;
  assert.equal(generated.category,'image-generation');assert.equal(generated.imagePaths,undefined);assert.doesNotMatch(JSON.stringify(generated),/PRIVATE_IMAGE_BYTES/);
  const claude=new NativeActivityTracker('claude');
  const read=(id:string)=>claude.observe(frame({type:'assistant',message:{content:[{type:'tool_use',id,name:'Read',input:{file_path:'/workspace/reference.png'}}]}}))[0]!;
  assert.equal(read('read').category,'read');
  const result=claude.observe(frame({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read',content:[{type:'image',source:{type:'base64',data:'PRIVATE_IMAGE_BYTES'}}]}]}}))[0]!;
  assert.equal(result.category,'image');assert.deepEqual(result.imagePaths,['/workspace/reference.png']);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_IMAGE_BYTES/);
  read('text');assert.equal(claude.observe(frame({type:'user',message:{content:[{type:'tool_result',tool_use_id:'text',content:'Text only'}]}}))[0]!.category,'read');
  const items=[{...viewed,viewedAttachments:[{id:'old'}] as any}];mergeActivity(items,{...viewed,imagePaths:['/workspace/changed.png']});assert.equal(items[0]!.viewedAttachments,undefined);
});

test('native log preview reads only its bound local image and deduplicates simultaneous opens',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-viewed-'));
  try{
    const file=path.join(root,'source.png');await writeFile(file,png);const attachments=new AttachmentStore(path.join(root,'attachments'),undefined,[],undefined,{nativePaths:true});
    const state=initialState(),activity=new NativeActivityTracker('codex').observe(frame({method:'item/completed',params:{item:{id:'view',type:'imageView',path:file}}}))[0]!;
    state.sessions.push({id:'fixture',binding:{runtime:'codex',provider:'native',accountRef:'fixture',executionId:'local-device',egress:'runtime-managed'},activities:[activity],messages:[]} as unknown as Session);
    const reader=new ActivityImageReader(()=>state,async change=>{change(state);},attachments),input={sessionId:'fixture',activityId:activity.id};
    assert.equal(activity.viewedAttachments,undefined);const [first,second]=await Promise.all([reader.read(input),reader.read(input)]);assert.equal(first[0]!.id,second[0]!.id);
    const retained=state.sessions[0]!.activities![0]!.viewedAttachments!;
    assert.equal(first[0]!.path,file);assert.equal(retained[0]!.id,first[0]!.id);assert.equal('preview' in retained[0]!,false);
    assert.equal((await reader.read(input))[0]!.id,first[0]!.id);
    const services=new HostServiceRegistry();services.register('images.viewed',reader);const restore=services.override('images.viewed',{read:async()=>[]});assert.deepEqual(await services.get<ActivityImagesService>('images.viewed').read(input),[]);restore();assert.equal((await reader.read(input)).length,1);
    state.sessions[0]!.binding.hostId='remote-fixture';await assert.rejects(reader.read(input),/REMOTE_UNAVAILABLE/);delete state.sessions[0]!.binding.hostId;
    await writeFile(file,'changed');await assert.rejects(reader.read(input),/变化/);
    activity.category='image-generation';await assert.rejects(reader.read(input),/NOT_FOUND/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('late image preview does not write into a changed native activity',async()=>{
  const state=initialState(),activity={id:'view',runtime:'codex',category:'image',imagePaths:[path.resolve('fixture.png')]} as any;
  state.sessions.push({id:'fixture',binding:{runtime:'codex',egress:'runtime-managed'},activities:[activity]} as Session);
  let finish!:(value:any[])=>void;const attachments={import:()=>new Promise<any[]>(resolve=>finish=resolve)} as unknown as AttachmentStore;
  const reader=new ActivityImageReader(()=>state,async change=>{change(state);},attachments),pending=reader.read({sessionId:'fixture',activityId:'view'});
  activity.imagePaths=[path.resolve('different.png')];finish([{id:'fixture-image',mime:'image/png'}]);await assert.rejects(pending,/CHANGED/);assert.equal(activity.viewedAttachments,undefined);
});

test('SSH Claude local-device MCP images preview locally but remote native reads remain excluded',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-ssh-viewed-'));
 try{
  const file=path.join(root,'reference.png');await writeFile(file,png);
  const attachments=new AttachmentStore(path.join(root,'attachments'),undefined,[],undefined,{nativePaths:true});
  const tracker=new NativeActivityTracker('claude');tracker.observe(frame({type:'assistant',message:{content:[{type:'tool_use',id:'read',name:'mcp__local_device__Read',input:{file_path:file}}]}}));
  const activity=tracker.observe(frame({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read',content:[{type:'image',source:{type:'base64',data:'OMITTED'}}]}]}}))[0]!;
  const state=initialState();state.sessions.push({id:'fixture',binding:{runtime:'claude',hostId:'member',egress:'vps',executionId:'local-device',accountRuntime:'native-owner'},activities:[activity],messages:[]} as unknown as Session);
  const reader=new ActivityImageReader(()=>state,async change=>change(state),attachments),request={sessionId:'fixture',activityId:activity.id};
  assert.equal((await reader.read(request))[0]!.path,file);
  activity.toolName='Read';await assert.rejects(reader.read(request),/REMOTE_UNAVAILABLE/);
  activity.toolName='mcp__other_device__Read';await assert.rejects(reader.read(request),/REMOTE_UNAVAILABLE/);
  activity.toolName='mcp__local_device__Read';state.sessions[0]!.binding.executionId='remote';await assert.rejects(reader.read(request),/REMOTE_UNAVAILABLE/);
 }finally{await rm(root,{recursive:true,force:true});}
});
