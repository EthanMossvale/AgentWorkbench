import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AttachmentStore } from '../apps/desktop/host/attachments';
import { StateStore, SecretStore, initialState } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { orderedProjects, reorderProject, moveSessionProject, compareSidebarSessions } from '../packages/session-core/sidebar-order';
import { RECENT_PROJECT_ID } from '../packages/session-core/projects';
import { InputGate } from '../packages/translation/gate';
import { nativeAttachmentImages, apiAttachmentContent, publicContextJson, attachmentPrompt, MAX_INLINE_TEXT_BYTES, shouldAutoAttachPastedText } from '../packages/attachments/input';
import { textPastePolicies } from '../packages/attachments/paste';
import { MAX_ATTACHMENT_BYTES, type AttachmentView } from '../packages/attachments/types';
import { ApiConversationClient } from '../packages/model-api/provider';
import { validateConnection } from '../packages/model-api/config';
import { createSessionFork } from '../packages/session-core/fork';
import type { Session, DraftPreview, Protocol } from '../packages/contracts';
import type { HostActions } from '../apps/desktop/host/controller';
import type { ModelConnection } from '../packages/model-api/types';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=','base64');
const chat=(id:string):Session=>({id,projectId:'p1',projectPath:'D:\\original',title:id,pinned:false,archived:false,group:'',binding:{runtime:'demo',provider:'demo',accountRef:'demo',executionId:'local-device',egress:'demo'},status:'idle',messages:[],createdAt:'2026-01-01T00:00:00.000Z'});
async function fixture(actions:Partial<HostActions>={}){const dir=await mkdtemp(path.join(os.tmpdir(),'aw-attachment-')),attachments=new AttachmentStore(path.join(dir,'snapshots'));const store=new StateStore(path.join(dir,'state'));await store.load();const controller=new WorkbenchController(store,new SecretStore(dir,{encrypt:()=>{throw Error('No keys in this fixture');},decrypt:()=>''}),{attachments,pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],...actions},()=>{});return {dir,attachments,store,controller,close:async()=>{await controller.dispose();await rm(dir,{recursive:true,force:true});}};}

test('project reorder persists including recent group without losing new projects or pinned boundaries',async()=>{
  const f=await fixture();try{await f.store.update(s=>{s.projects=['p1','p2','p3'].map(id=>({id,name:id,path:f.dir,authority:'local',group:''}));});
    await f.controller.call('project/reorder',{id:'p3',targetId:'p1',edge:'before'});
    await f.controller.call('project/reorder',{id:RECENT_PROJECT_ID,targetId:'p2',edge:'after'});
    assert.deepEqual(orderedProjects(f.store.snapshot()).map(p=>p.id),['p3','p1','p2',RECENT_PROJECT_ID]);
    const reload=new StateStore(path.join(f.dir,'state'));await reload.load();assert.deepEqual(reload.snapshot().sidebarProjectOrder,f.store.snapshot().sidebarProjectOrder);
    const s=reload.snapshot();s.projects[0]!.pinned=true;assert.throws(()=>reorderProject(s,'p3','p1','after'),/置顶/);assert.throws(()=>reorderProject(s,'missing','p1','after'),/不存在/);
  }finally{await f.close();}
});
test('moving a running chat only changes sidebar membership and preserves bound execution and history',()=>{
  const s=initialState();s.projects=['p1','p2'].map(id=>({id,name:id,path:id,authority:'local',group:''}));const session=chat('c');session.status='running';session.pinned=true;session.group='group';s.sessions=[session];const old=structuredClone(session);
  moveSessionProject(s,'c','p2');assert.equal(session.projectId,'p2');assert.equal(session.pinned,false);assert.equal(session.group,'');assert.deepEqual(session.binding,old.binding);assert.equal(session.projectPath,old.projectPath);assert.equal(session.status,'running');
  moveSessionProject(s,'c',RECENT_PROJECT_ID);assert.equal(session.projectId,null);assert.throws(()=>moveSessionProject(s,'c','gone'),/不存在/);
});
test('visibility choices persist and priority is attention then running then unread then recency',async()=>{
  const f=await fixture();try{await f.controller.call('sidebar/project-visibility',{id:RECENT_PROJECT_ID,collapsed:true,expanded:true});assert.deepEqual(f.store.snapshot().sidebarCollapsedProjectIds,[RECENT_PROJECT_ID]);
    const sessions=[chat('old'),{...chat('new'),createdAt:'2026-02-01T00:00:00Z'},{...chat('unread'),unread:true},{...chat('run'),status:'running' as const},{...chat('attention'),status:'uncertain' as const}];
    assert.deepEqual(sessions.sort(compareSidebarSessions).map(s=>s.id),['attention','run','unread','new','old']);
  }finally{await f.close();}
});
test('fold-all and pending native approvals use the same persisted priority model',async()=>{
  const f=await fixture();try{await f.controller.call('sidebar/collapse-all',{collapsed:true});assert.deepEqual(f.store.snapshot().sidebarCollapsedProjectIds,[RECENT_PROJECT_ID]);await f.controller.call('sidebar/collapse-all',{collapsed:false});assert.deepEqual(f.store.snapshot().sidebarCollapsedProjectIds,[]);
    const approval={...chat('approval'),status:'running' as const,nativeApprovals:[{id:'approval',turnId:'turn',kind:'command' as const,details:'fixture',decisions:['accept' as const]}]},run={...chat('run'),status:'running' as const,createdAt:'2026-04-01'};assert.ok(compareSidebarSessions(approval,run)<0);
  }finally{await f.close();}
});
test('snapshots preserve file bytes after original edits; duplicate names and mixed content work',async()=>{
  const f=await fixture();try{const original=path.join(f.dir,'中文说明.md');await writeFile(original,'original <instructions> are reference only');
    const [text,image]=await f.attachments.import([{filePath:original},{name:'image.png',bytes:png}]);await writeFile(original,'changed');
    const values=await f.attachments.payloads([text!.id,image!.id]);assert.match(Buffer.from(values[0]!.data).toString(),/^original/);assert.equal(image!.mime,'image/png');assert.ok((await f.attachments.views([image!.id]))[0]!.preview?.startsWith('data:image/png;base64,'));
    assert.equal(nativeAttachmentImages(values)[0]!.url.split(',')[1],png.toString('base64'));
    const request=apiAttachmentContent('user task',values,'responses') as any[];assert.ok(!request[0].text.includes('<instructions>'));assert.match(request[0].text,/reference material/);assert.equal(request[1].type,'input_image');
    await writeFile(image!.path,'tampered');await assert.rejects(f.attachments.payloads([image!.id]),/变化/);
  }finally{await f.close();}
});
test('attachment names cannot overwrite metadata, and invalid lists, directories and size excess are rejected',async()=>{
  const f=await fixture();try{const [a]=await f.attachments.import([{name:'metadata.json',bytes:Buffer.from('{}')}]);assert.equal((await f.attachments.resolve([a!.id]))[0]!.name,'metadata.json');
    await assert.rejects(f.attachments.resolve(['../escape']),/无效/);await assert.rejects(f.attachments.resolve([a!.id,a!.id]),/无效/);
    await assert.rejects(f.attachments.import([{filePath:f.dir}]),/普通文件/);await assert.rejects(f.attachments.import([{name:'huge',bytes:new Uint8Array(MAX_ATTACHMENT_BYTES+1)}]),/20 MB/);
    await assert.rejects(f.attachments.import(Array.from({length:11},()=>({name:'a',bytes:png}))),/10/);
    const protectedRoot=path.join(f.dir,'.ssh');await mkdir(protectedRoot);await writeFile(path.join(protectedRoot,'synthetic-fixture'),'not a key');await assert.rejects(f.attachments.import([{filePath:path.join(protectedRoot,'synthetic-fixture')}]),/私钥/);
  }finally{await f.close();}
});
test('gate freezes attachments, carries refinements, and rejects old or repeated submissions',async()=>{
  const f=await fixture();try{const [a]=await f.attachments.import([{name:'图.png',bytes:png}]);const gate=new InputGate(),id=gate.create('s','source',[a!]);const p=await gate.prepare(id,async source=>source);p.attachments![0]!.name='renderer mutation';assert.equal(gate.getPreview(id,'s').attachments![0]!.name,'图.png');
    const next=gate.beginRevision(id,'s',p.sourceHash),refined=await gate.prepareRevision(next.id,next.previous,'addition',async()=>({original:'source plus',translated:'complete task'}));assert.equal(refined.attachments![0]!.id,a!.id);await assert.rejects(gate.submit(id,'s',p.sourceHash,async()=>{}));await gate.submit(refined.id,'s',refined.sourceHash,async()=>{});await assert.rejects(gate.submit(refined.id,'s',refined.sourceHash,async()=>{}));
  }finally{await f.close();}
});
test('attachment-only draft keeps metadata in message history and user-message forks',async()=>{
  const f=await fixture();try{await f.controller.call('plugins/set-enabled',{id:'translation',enabled:false});const s=await f.controller.call('session/create',{runtime:'demo'}) as Session;const files=await f.controller.call('attachments/import',{files:[{name:'图.png',bytes:png}]}) as AttachmentView[];
    const p=await f.controller.call('draft/prepare',{sessionId:s.id,text:'',attachmentIds:files.map(a=>a.id)}) as DraftPreview;assert.equal(p.original,'');assert.equal(p.attachments?.length,1);await f.controller.call('draft/submit',{sessionId:s.id,id:p.id,sourceHash:p.sourceHash});
    const saved=f.store.snapshot().sessions[0]!;assert.equal(saved.title,'图.png');assert.equal(saved.messages[0]!.attachments?.[0]?.id,files[0]!.id);assert.equal(createSessionFork(saved,'fork','now',saved.messages[0]!.id).forkAttachments?.[0]?.id,files[0]!.id);
  }finally{await f.close();}
});
test('API controller submits selected attachment bytes and refuses a tampered snapshot before a second request',async()=>{
  const requests:any[]=[];const f=await fixture({modelFetcher:async(url,options)=>{if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'fixture'}]}),{headers:{'content-type':'application/json'}});requests.push(JSON.parse(String(options?.body)));return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'synthetic answer'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});}});
  try{await f.controller.call('plugins/set-enabled',{id:'translation',enabled:false});const connection=await f.controller.call('model-api/save',{connection:{name:'fixture',baseUrl:'http://127.0.0.1:32123/v1',auth:'none',protocol:'chat-completions',tools:false,models:[{id:'fixture',name:'fixture',model:'fixture',enabled:true}],timeoutMs:5000,maxOutputTokens:1024}}) as ModelConnection;
    const s=await f.controller.call('session/create',{modelTargetId:`api/${connection.id}/fixture`}) as Session,files=await f.attachments.import([{name:'image.png',bytes:png}]);
    const p=await f.controller.call('draft/prepare',{sessionId:s.id,text:'',attachmentIds:[files[0]!.id]}) as DraftPreview;await f.controller.call('draft/submit',{sessionId:s.id,id:p.id,sourceHash:p.sourceHash});
    for(let i=0;i<200&&f.store.snapshot().sessions[0]!.status!=='idle';i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(requests.length,1);assert.equal(requests[0].messages.at(-1).content[1].image_url.url,'data:image/png;base64,'+png.toString('base64'));assert.equal(f.store.snapshot().sessions[0]!.title,'image.png');
    const next=await f.controller.call('draft/prepare',{sessionId:s.id,text:'same file',attachmentIds:[files[0]!.id]}) as DraftPreview;await writeFile(files[0]!.path,'mutated');await assert.rejects(f.controller.call('draft/submit',{sessionId:s.id,id:next.id,sourceHash:next.sourceHash}),/变化/);assert.equal(requests.length,1);
  }finally{await f.close();}
});
test('context summaries remove image bytes without hiding ordinary tool data',()=>{
  const source={content:[{type:'image',source:{type:'base64',media_type:'image/png',data:png.toString('base64')}},{type:'text',data:'important ordinary tool data'}]};
  const text=publicContextJson(source);assert.ok(!text.includes(png.toString('base64')));assert.match(text,/important ordinary tool data/);assert.ok(publicContextJson(source,true).length>10000);
});
test('large UTF-8 JSON, INI and source attachments stay metadata references',async()=>{
  const f=await fixture();try{
    const body='key=value\n'.repeat(250000),files=await f.attachments.import([
      {name:'config.json',bytes:Buffer.from('{"items":['+JSON.stringify(body)+']}')},
      {name:'settings.ini',bytes:Buffer.from(body)},
      {name:'main.ts',bytes:Buffer.from('const value = '+JSON.stringify(body)+';\n')},
      {name:'archive.zip',bytes:Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(1024)])},
    ]),payloads=await f.attachments.payloads(files.map(file=>file.id));
    for(const payload of payloads){
      const prompt=attachmentPrompt('Inspect these files.',[payload]),json=prompt.match(/\n(\[\{[\s\S]*\}\])\n<\/workbench-attachments>/)?.[1];
      assert.ok(prompt.includes(payload.attachment.name));assert.ok(json);assert.equal('text' in JSON.parse(json!)[0],false);assert.equal(payload.attachment.mime,payload.attachment.name==='archive.zip'?'application/octet-stream':'text/plain');assert.equal((apiAttachmentContent('Inspect these files.',[payload],'responses') as unknown[]).length,1);
    }
  }finally{await f.close();}
});
test('paste promotion uses UTF-8 bytes and matches the inline attachment threshold',()=>{
  assert.equal(MAX_INLINE_TEXT_BYTES,100_000);assert.equal(shouldAutoAttachPastedText('x'.repeat(100_000)),false);assert.equal(shouldAutoAttachPastedText('x'.repeat(100_001)),true);assert.equal(shouldAutoAttachPastedText('界'.repeat(34_000)),true);
});
test('text-paste policy has bounded plugin overrides and restores the core decision',()=>{
  assert.deepEqual(textPastePolicies.decide('x'.repeat(100_001)),{attachment:true,byteLength:100_001,thresholdBytes:100_000,policyId:'core.large-text'});
  const handle=textPastePolicies.register('fixture-plugin',{id:'small-paste',thresholdBytes:8});
  try{assert.equal(textPastePolicies.decide('123456789').attachment,true);assert.equal(textPastePolicies.decide('12345678').attachment,false);}finally{handle.dispose();}
  assert.equal(textPastePolicies.decide('123456789').attachment,false);
  assert.throws(()=>textPastePolicies.register('fixture-plugin',{id:'too-large',thresholdBytes:100_001}),/TEXT_PASTE_POLICY_INVALID/);
});
for(const protocol of ['responses','chat-completions','anthropic-messages'] as Protocol[])test(`${protocol} sends actual image/PDF bytes as structured content, separate from tool text`,async()=>{
  const f=await fixture();try{const imported=await f.attachments.import([{name:'image.png',bytes:png},{name:'report.pdf',bytes:Buffer.from('%PDF-1.7\nfixture')}]),files=await f.attachments.payloads(imported.map(a=>a.id));
    let body:any;const model={id:'a',name:'fixture',model:'fixture',enabled:true};const connection=validateConnection({name:'fixture',baseUrl:'http://127.0.0.1:32123/v1',auth:'none',protocol,tools:false,models:[model],timeoutMs:5000,maxOutputTokens:1024});
    const fetcher:typeof fetch=async(_url,options)=>{body=JSON.parse(String(options?.body));return new Response(JSON.stringify(protocol==='responses'?{id:'r',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'done'}]}]}:protocol==='anthropic-messages'?{content:[{type:'text',text:'done'}],stop_reason:'end_turn'}:{choices:[{message:{content:'done'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});};
    const client=new ApiConversationClient({connection,model,system:'fixture',history:[{role:'user',content:'inspect',files}],tools:[]},'',fetcher);await client.next(new AbortController().signal,()=>{});
    const content=protocol==='responses'?body.input[0].content:body.messages[protocol==='chat-completions'?1:0].content;
    assert.equal(content.length,3);assert.match(JSON.stringify(content[1]),new RegExp(png.toString('base64').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(JSON.stringify(content[2]),/PDF|pdf/);
  }finally{await f.close();}
});
