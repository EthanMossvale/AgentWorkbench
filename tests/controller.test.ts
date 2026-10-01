import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController,DEMO_INPUT,DEMO_TRANSLATED,type HostActions } from '../apps/desktop/host/controller';
import { SharedMemoryStore } from '../packages/memory-core/index';
import { SharedSkillsStore } from '../packages/skills-core/index';
import { StateStore,SecretStore } from '../apps/desktop/host/store';
import type { Session,DraftPreview,Project,EnvironmentProfile,SshHost } from '../packages/contracts/index';
async function fixture(actions:Partial<HostActions>={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'aw-controller-'));const store=new StateStore(dir);await store.load();
 const secrets=new SecretStore(dir,{encrypt:()=>{throw new Error('No credentials permitted in this test');},decrypt:()=>''});
 const shared={memory:new SharedMemoryStore(dir),skills:new SharedSkillsStore(dir)};
 const controller=new WorkbenchController(store,secrets,{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],...actions},()=>{},shared);
 return {dir,store,secrets,controller,shared,close:()=>rm(dir,{recursive:true})};
}
test('assembled offline pipeline preserves source, only submits once, retries translation without a new agent turn',async()=>{
 const f=await fixture();try{
 const session=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;
 const preview=await f.controller.call('draft/prepare',{sessionId:session.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
 assert.equal(preview.original,DEMO_INPUT);assert.equal(preview.translated,DEMO_TRANSLATED);
 assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
 await f.controller.call('draft/submit',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash});
 const messages=f.store.snapshot().sessions[0]!.messages;assert.equal(messages.length,2);assert.equal(messages[0]?.original,DEMO_INPUT);assert.equal(messages[0]?.submitted,DEMO_TRANSLATED);assert.equal(messages[1]?.translationStatus,'complete');
 await assert.rejects(f.controller.call('draft/submit',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash}));
 const original=messages[1]!.original;await f.controller.call('message/retranslate',{sessionId:session.id,messageId:messages[1]!.id});
 assert.equal(f.store.snapshot().sessions[0]!.messages.length,2);assert.equal(f.store.snapshot().sessions[0]!.messages[1]!.original,original);
 }finally{await f.close();}
});

test('CLI maintenance blocks task admission and pending session work prevents idle maintenance',async()=>{
 const f=await fixture();try{
  const session=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;
  const preview=await f.controller.call('draft/prepare',{sessionId:session.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
  let maintaining=true;(f.shared as any).native={handles:()=>false,cli:{isMaintaining:()=>maintaining}};
  await assert.rejects(f.controller.call('draft/submit',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash}),/CLI/);
  assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);assert.equal(f.controller.hasActiveSessionWork(),false);
  maintaining=false;const running=f.controller.call('draft/submit',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash});
  assert.equal(f.controller.hasActiveSessionWork(),true);await running;assert.equal(f.controller.hasActiveSessionWork(),false);
 }finally{await f.close();}
});
test('unconfigured translation blocks arbitrary Chinese instead of sending source',async()=>{const f=await fixture();try{
 const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;
 await assert.rejects(f.controller.call('draft/prepare',{sessionId:s.id,text:'不要删除整个目录'}));assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
 await assert.rejects(f.controller.call('draft/prepare',{sessionId:s.id,text:'不要删除整个目录',bypass:true}),/必须先完成英文/);assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
}finally{await f.close();}});
test('supplemented preview invalidates the old revision and preserves exact source whitespace',async()=>{const f=await fixture();try{
 const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;
 const old=await f.controller.call('draft/prepare',{sessionId:s.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
 const edited='  '+DEMO_INPUT+'\n\n补充：同时保留中文文件名。\n';
 await f.controller.call('plugins/set-enabled',{id:'translation',enabled:false});
 const next=await f.controller.call('draft/prepare',{sessionId:s.id,text:edited,bypass:true}) as DraftPreview;assert.equal(next.original,edited);assert.equal(next.translated,edited);
 await assert.rejects(f.controller.call('draft/submit',{sessionId:s.id,id:old.id,sourceHash:old.sourceHash}));assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
 await f.controller.call('draft/cancel',{id:next.id});
}finally{await f.close();}});
test('native sessions cannot silently fall back to demo or SDK',async()=>{const f=await fixture();try{
 await f.store.update(s=>{s.hosts.push({id:'h',name:'Fixture',hostname:'test.example',port:22,username:'workspace',role:'workspace',identityFile:path.join(f.dir,'key'),knownHostsFile:path.join(f.dir,'known_hosts'),ownerId:'local-owner',workspaceGeneration:'one'});});
 const s=await f.controller.call('session/create',{projectId:null,runtime:'claude',hostId:'h'}) as Session;assert.equal(s.status,'blocked');
 await assert.rejects(f.controller.call('draft/prepare',{sessionId:s.id,text:DEMO_INPUT,demo:true}),/Claude SSH 工具连接尚未就绪|H 原生桥/);assert.equal(f.store.snapshot().sessions[0]!.binding.runtime,'claude');
}finally{await f.close();}});
test('unknown IPC operations and injected runtime changes are rejected or ignored',async()=>{const f=await fixture();try{
 await assert.rejects(f.controller.call('exec',{command:'ignored'}));const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;
 await f.controller.call('session/update',{id:s.id,title:'renamed',binding:{runtime:'codex'}});assert.equal(f.store.snapshot().sessions[0]!.binding.runtime,'demo');
}finally{await f.close();}});
test('renderer cannot inject model credentials into persisted state',async()=>{const f=await fixture();try{
 const s=f.store.snapshot();await f.controller.call('translation/settings',{profile:{...s.translation,key:'MUST_NOT_PERSIST',apiKey:'MUST_NOT_PERSIST'},translateInput:true,translateProgress:false,translateFinal:true});
 assert.ok(!JSON.stringify(await f.controller.call('state/get')).includes('MUST_NOT_PERSIST'));
}finally{await f.close();}});
test('one project owns multiple folder references and existing sessions keep their chosen cwd',async()=>{let opened='';const f=await fixture({openPath:async p=>{opened=p;}});try{
 const a=path.join(f.dir,'first');const b=path.join(f.dir,'second');await mkdir(a);await mkdir(b);
 const p=await f.controller.call('project/create',{name:'Multi-folder',paths:[a,b,a]}) as Project;assert.deepEqual(p.paths,[a,b]);
 const session=await f.controller.call('session/create',{projectId:p.id,projectPath:b,runtime:'demo'}) as Session;assert.equal(session.projectPath,b);
 await f.controller.call('project/update',{id:p.id,paths:[a],name:'Renamed'});assert.equal(f.store.snapshot().sessions[0]!.projectPath,b);
 await f.controller.call('path/open',{projectId:p.id,path:b});assert.equal(opened,b);
 await assert.rejects(f.controller.call('session/create',{projectId:p.id,projectPath:f.dir,runtime:'demo'}));
}finally{await f.close();}});
test('deep-link copy uses stable ID and does not submit or mutate a session',async()=>{let copied='';const f=await fixture({copy:value=>{copied=value;}});try{const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;const link=await f.controller.call('deep-link/copy',{sessionId:s.id});assert.equal(link,`agent-workbench://threads/${s.id}`);assert.equal(copied,link);assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);}finally{await f.close();}});
test('removed environment probe is not exposed through IPC',async()=>{let called=false;const f=await fixture({probeEnvironment:async()=>{called=true;throw Error('Should not run');}});try{
 await assert.rejects(f.controller.call('host/probe',{id:'unused'}),/不允许的 IPC/);assert.equal(called,false);assert.equal(f.store.snapshot().profiles.length,0);
}finally{await f.close();}});

test('shared memory is opt-in at the assembled host boundary and remains provider independent',async()=>{const f=await fixture();try{
 const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;
 await f.controller.call('memory/save',{title:'Language preference',content:'Write requested documentation in Chinese.',summary:''});
 assert.equal((await f.controller.call('session/context',{sessionId:s.id}) as any).items.length,0);
 await f.controller.call('memory/settings',{enabled:true});const snapshot=await f.controller.call('session/context',{sessionId:s.id}) as any;assert.equal(snapshot.items[0].kind,'memory');assert.match(snapshot.items[0].content,/Chinese/);
 await f.controller.call('memory/settings',{enabled:false});assert.equal((await f.controller.call('session/context',{sessionId:s.id}) as any).items.length,0);
}finally{await f.close();}});
test('auto submit is disabled by default and rechecked at the host dispatch boundary',async()=>{const f=await fixture();try{
 assert.equal(f.store.snapshot().autoSubmitTranslated,false);const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;const preview=await f.controller.call('draft/prepare',{sessionId:s.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
 await f.controller.call('translation/auto-submit',{enabled:true});await f.controller.call('translation/auto-submit',{enabled:false});await assert.rejects(f.controller.call('draft/submit',{sessionId:s.id,id:preview.id,sourceHash:preview.sourceHash,automatic:true}),/直接发送已关闭/);assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
}finally{await f.close();}});
test('stop cancels the active demo turn but does not erase the request or claim rollback',async()=>{const f=await fixture();try{
 const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;const p=await f.controller.call('draft/prepare',{sessionId:s.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
 const running=f.controller.call('draft/submit',{sessionId:s.id,id:p.id,sourceHash:p.sourceHash});for(let n=0;n<100&&f.store.snapshot().sessions[0]!.status!=='running';n++)await new Promise(resolve=>setTimeout(resolve,5));
 const stopped=await f.controller.call('session/stop',{sessionId:s.id}) as {stopped:boolean};assert.equal(stopped.stopped,true);await running;const session=f.store.snapshot().sessions[0]!;assert.equal(session.messages[0]!.submitted,DEMO_TRANSLATED);assert.match(session.messages[1]!.original,/stopped/);assert.equal(session.status,'idle');
}finally{await f.close();}});
test('revoking consent blocks new translation admission during slow credential persistence',{timeout:3000},async()=>{let sent=0;const f=await fixture({translationFetcher:async()=>{sent++;return Response.json({choices:[{finish_reason:'stop',message:{content:'Should not send'}}]});}});let release!:(value:string)=>void;try{
 await f.store.update(s=>{s.translation.consent=true;s.translation.model='fixture';});const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;
 const blocked=new Promise<string>(resolve=>{release=resolve;});f.secrets.get=async()=>blocked;
 const old=f.store.snapshot();const saving=f.controller.call('translation/settings',{profile:{...old.translation,consent:false},translateInput:true,translateProgress:false,translateFinal:true});
 await assert.rejects(f.controller.call('draft/prepare',{sessionId:s.id,text:'这一条不能在撤销同意时发出去。'}),/正在保存/);assert.equal(sent,0);release('synthetic');await saving;assert.equal(f.store.snapshot().translation.consent,false);
}finally{release?.('synthetic');await f.close();}});
test('Stop during final persistence reports too late instead of falsely claiming cancellation',{timeout:3000},async()=>{const f=await fixture();let release!:()=>void;try{
 const s=await f.controller.call('session/create',{projectId:null,runtime:'demo'}) as Session;const preview=await f.controller.call('draft/prepare',{sessionId:s.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
 const save=f.store.update.bind(f.store);let entered!:()=>void;const atFinal=new Promise<void>(resolve=>{entered=resolve;});const blocked=new Promise<void>(resolve=>{release=resolve;});
 f.store.update=async mutate=>{const probe=f.store.snapshot();mutate(probe);if(probe.sessions[0]?.messages.length===2){entered();await blocked;}return save(mutate);};
 const running=f.controller.call('draft/submit',{sessionId:s.id,id:preview.id,sourceHash:preview.sourceHash});await atFinal;
 const stopped=await f.controller.call('session/stop',{sessionId:s.id}) as {stopped:boolean;reason:string};assert.equal(stopped.stopped,false);assert.match(stopped.reason,/完成阶段/);release();await running;assert.match(f.store.snapshot().sessions[0]!.messages[1]!.original,/offline workflow demonstration/);
}finally{release?.();await f.close();}});
test('projectless sessions need neither a project nor a working folder and survive restart',async()=>{let opened='';const f=await fixture({openPath:async p=>{opened=p;}});try{
 assert.deepEqual(f.store.snapshot().projects,[]);const unassigned=await f.controller.call('session/create',{runtime:'demo'}) as Session;assert.equal(unassigned.projectId,null);assert.equal(unassigned.projectPath,'');assert.equal(unassigned.skillIds,undefined);
 await assert.rejects(f.controller.call('path/open',{projectId:null,sessionId:unassigned.id}),/尚未关联/);
 const temporary=path.join(f.dir,'scratch');await mkdir(temporary);const s=await f.controller.call('session/create',{projectId:null,projectPath:temporary,runtime:'demo'}) as Session;
 await f.controller.call('path/open',{projectId:null,sessionId:s.id});assert.equal(opened,temporary);assert.equal(f.store.snapshot().projects.length,0);
 await assert.rejects(f.controller.call('path/open',{projectId:null,sessionId:s.id,path:f.dir}));await assert.rejects(f.controller.call('session/create',{projectId:'does-not-exist',runtime:'demo'}));
 const resumed=new StateStore(f.dir);const loaded=await resumed.load();assert.equal(loaded.sessions.find(item=>item.id===unassigned.id)?.projectId,null);assert.equal(loaded.sessions.find(item=>item.id===s.id)?.projectPath,temporary);
}finally{await f.close();}});
test('every new session discovers shared skill metadata without per-session selection, then loads only requested instructions',async()=>{const f=await fixture();try{
 const one=path.join(f.dir,'source-one');const two=path.join(f.dir,'source-two');await mkdir(one);await mkdir(two);
 const markdown='---\nname: shared-one\ndescription: Shared description\n---\nBODY_ONE_MUST_NOT_APPEAR_IN_DISCOVERY\n';await writeFile(path.join(one,'SKILL.md'),markdown);
 const skill=await f.shared.skills.importFile(path.join(one,'SKILL.md'));
 const a=await f.controller.call('session/create',{runtime:'demo'}) as Session;const b=await f.controller.call('session/create',{runtime:'demo'}) as Session;
 const ca=await f.controller.call('session/context',{sessionId:a.id}) as any;const cb=await f.controller.call('session/context',{sessionId:b.id}) as any;assert.equal(ca.sourceHash,cb.sourceHash);assert.equal(ca.items[0].kind,'skill-catalog');assert.ok(!JSON.stringify(ca).includes('BODY_ONE'));assert.ok(JSON.stringify(ca).includes(skill.id));
 const listing=await f.controller.call('skills/list') as any[];assert.equal(listing[0].body,undefined);assert.equal(listing[0].markdown,undefined);
 const full=await f.controller.call('session/skills/read',{sessionId:a.id,id:skill.id,expectedHash:skill.hash}) as any;assert.equal(full.markdown,markdown);
 await assert.rejects(f.controller.call('session/skills/read',{sessionId:a.id,id:skill.id,expectedHash:'0'.repeat(64)}));
 await writeFile(path.join(two,'SKILL.md'),'---\nname: shared-two\ndescription: Imported later\n---\nBODY_TWO\n');const later=await f.shared.skills.importFile(path.join(two,'SKILL.md'));
 await assert.rejects(f.controller.call('session/skills/read',{sessionId:a.id,id:later.id,expectedHash:later.hash}));
 const c=await f.controller.call('session/create',{runtime:'demo'}) as Session;assert.ok(JSON.stringify(await f.controller.call('session/context',{sessionId:c.id})).includes(later.id));
 await f.controller.call('skills/delete',{id:skill.id,expectedHash:skill.hash});await assert.rejects(f.controller.call('session/skills/read',{sessionId:a.id,id:skill.id,expectedHash:skill.hash}));
 const restored=await f.shared.skills.importFile(path.join(one,'SKILL.md'));assert.equal(restored.id,skill.id);assert.equal(restored.hash,skill.hash);await assert.rejects(f.controller.call('session/skills/read',{sessionId:a.id,id:skill.id,expectedHash:skill.hash}),/目录已失效/);
 await f.controller.call('session/context',{sessionId:a.id});assert.equal((await f.controller.call('session/skills/read',{sessionId:a.id,id:skill.id,expectedHash:skill.hash}) as any).markdown,markdown);
}finally{await f.close();}});
