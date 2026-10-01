import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rememberedPermission } from '../packages/session-core/permissions';
import { memoryCitations, visibleReply, replyMemoryReferences } from '../packages/session-core/memory-citations';

test('memory citations expose native labels and leave immutable source metadata separate',()=>{
 const source='Done.\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:4-8|note=[Build and review conventions]\n</citation_entries>\n<rollout_ids>fixture</rollout_ids>\n</oai-mem-citation>';
 assert.equal(visibleReply(source),'Done.');assert.deepEqual(memoryCitations(source),[{path:'MEMORY.md',title:'Build and review conventions',source:'native-citation'}]);
 assert.deepEqual(memoryCitations('I used memory.'),[]);
});

test('permission preferences persist per project and runtime, including projectless chats',async()=>{
 const f=await fixture();try{
  const project=await f.controller.call('project/create',{name:'Permission project',paths:[f.dir]}) as any;
  await f.controller.call('permissions/remember',{projectId:project.id,runtime:'codex',permissionMode:'full-access'});
  await f.controller.call('permissions/remember',{projectId:null,runtime:'codex',permissionMode:'read-only'});
  const saved=await new StateStore(f.dir).load();
  assert.equal(rememberedPermission(saved,project.id,'codex'),'full-access');assert.equal(rememberedPermission(saved,null,'codex'),'read-only');assert.equal(rememberedPermission(saved,project.id,'claude'),'default');
  await f.controller.call('permissions/remember',{projectId:null,runtime:'demo',permissionMode:'read-only'});
  assert.equal((await f.controller.call('session/create',{runtime:'demo'}) as Session).permissionMode,'read-only');
  await f.controller.call('translation/intermediate',{enabled:false});assert.equal((await new StateStore(f.dir).load()).translateIntermediate,false);
 }finally{await f.close();}
});

test('Claude memory indicators require successful native memory reads in the current response boundary',()=>{
 const answer={id:'a',role:'assistant' as const,original:'Reply.',demo:false,timestamp:'2026-09-27T10:00:10Z'};
 const activity={id:'read',runtime:'claude' as const,kind:'tool' as const,toolName:'Read',status:'completed' as const,startedAt:'2026-09-27T10:00:02Z',updatedAt:'2026-09-27T10:00:03Z',input:JSON.stringify({file_path:'C:/Users/fixture/.claude/projects/project/memory/conventions.md'}),output:'# Review conventions\nEvidence.'};
 const session={binding:{runtime:'claude'},messages:[{id:'u',role:'user',timestamp:'2026-09-27T10:00:00Z'},answer],activities:[activity]} as Session;
 assert.equal(replyMemoryReferences(session,answer)[0]?.title,'Review conventions');
 for(const changed of [{status:'failed'},{nativeChildId:'child'},{updatedAt:'2026-09-27T09:00:00Z'},{input:JSON.stringify({file_path:'D:/random/memory/notes.md'})},{output:''}])assert.deepEqual(replyMemoryReferences({...session,activities:[{...activity,...changed} as any]},answer),[]);
});
import type { AppState, DraftPreview, Session } from '../packages/contracts/index';
import { permissionModesForRuntime, resolvePermissionMode } from '../packages/session-core/permissions';
import { codexThreadPermissionParams, codexTurnPermissionParams } from '../packages/runtime-codex/index';
import { buildClaudeArgs, CLAUDE_RESEARCH_BASELINE } from '../packages/runtime-claude/index';
import { WorkbenchController, DEMO_INPUT, type HostActions } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';

async function fixture(actions:Partial<HostActions>={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'aw-permissions-'));const store=new StateStore(dir);await store.load();
  const secrets=new SecretStore(dir,{encrypt:()=>{throw new Error('No credentials in permission tests');},decrypt:()=>''});
  const controller=new WorkbenchController(store,secrets,{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[],...actions},()=>{});
  return {dir,store,secrets,controller,close:()=>rm(dir,{recursive:true,force:true})};
}

test('permission options are runtime-specific, immutable, and only absent legacy values use default',()=>{
  assert.deepEqual(permissionModesForRuntime('codex'),['default','read-only','full-access']);
  assert.deepEqual(permissionModesForRuntime('demo'),permissionModesForRuntime('codex'));
  assert.deepEqual(permissionModesForRuntime('claude'),['default','accept-edits','plan','full-access']);
  assert(Object.isFrozen(permissionModesForRuntime('claude')));
  for(const runtime of ['demo','claude','codex'] as const)assert.equal(resolvePermissionMode(runtime,undefined),'default');
  for(const value of ['',null,42,'danger-full-access','bypassPermissions'])assert.throws(()=>resolvePermissionMode('codex',value));
  assert.throws(()=>resolvePermissionMode('codex','accept-edits'));assert.throws(()=>resolvePermissionMode('claude','read-only'));
});

test('Codex permissions use pinned 0.155.1 thread and turn spellings without adding cwd roots',()=>{
  assert.deepEqual(codexThreadPermissionParams(),{approvalPolicy:'on-request',sandbox:'read-only'});
  assert.deepEqual(codexTurnPermissionParams(),{approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly',networkAccess:false}});
  assert.deepEqual(codexThreadPermissionParams('read-only'),{approvalPolicy:'never',sandbox:'read-only'});
  assert.deepEqual(codexTurnPermissionParams('read-only'),{approvalPolicy:'never',sandboxPolicy:{type:'readOnly',networkAccess:false}});
  assert.deepEqual(codexThreadPermissionParams('full-access'),{approvalPolicy:'never',sandbox:'danger-full-access'});
  assert.deepEqual(codexTurnPermissionParams('full-access'),{approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}});
  assert.throws(()=>codexThreadPermissionParams('plan'));assert.throws(()=>codexTurnPermissionParams('accept-edits'));
});

test('Claude arguments explicitly carry supported native modes and keep unanswered approvals denied',()=>{
  const expected=[['default','default'],['accept-edits','acceptEdits'],['plan','plan'],['full-access','bypassPermissions']] as const;
  for(const [permissionMode,nativeMode]of expected){
    const args=buildClaudeArgs({version:CLAUDE_RESEARCH_BASELINE,permissionMode});
    assert.equal(args[args.indexOf('--permission-mode')+1],nativeMode);
    assert.equal(args[args.indexOf('--permission-prompts')+1],'none');
    assert(!args.includes('--dangerously-skip-permissions'));assert(!args.includes('--permission-prompt-tool'));
  }
  assert.equal(buildClaudeArgs({version:CLAUDE_RESEARCH_BASELINE}).at(-1),'default');
  assert.throws(()=>buildClaudeArgs({version:CLAUDE_RESEARCH_BASELINE,permissionMode:'read-only'}));
});

test('session permissions persist and reject invalid modes without granting unavailable native execution',async()=>{
  const f=await fixture();try{
    await f.store.update(state=>{state.hosts.push({id:'fixture-host',name:'Synthetic',hostname:'fixture.example',port:22,username:'workspace',role:'workspace',identityFile:path.join(f.dir,'unused-key'),knownHostsFile:path.join(f.dir,'unused-hosts'),ownerId:'local-owner',workspaceGeneration:'fixture'});});
    const cases=[['demo','read-only'],['codex','full-access'],['claude','accept-edits']] as const;
    for(const [runtime,permissionMode]of cases){
      const session=await f.controller.call('session/create',{runtime,permissionMode,...(runtime==='demo'?{}:{hostId:'fixture-host'})}) as Session;
      assert.equal(session.permissionMode,permissionMode);
      const changed=await f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'default'}) as AppState;
      assert.equal(changed.sessions.find(item=>item.id===session.id)?.permissionMode,'default');
      if(runtime!=='demo'){
        assert.equal(changed.sessions.find(item=>item.id===session.id)?.status,'blocked');
        await assert.rejects(f.controller.call('draft/prepare',{sessionId:session.id,text:DEMO_INPUT,demo:true}),runtime==='claude'?/Claude SSH 工具连接尚未就绪/:/H 原生桥/);
      }
    }
    const session=f.store.snapshot().sessions[0]!;
    await assert.rejects(f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'read-only'}));
    await assert.rejects(f.controller.call('session/permissions',{sessionId:session.id}));
    await assert.rejects(f.controller.call('session/create',{runtime:'demo',permissionMode:'bypassPermissions'}));
    const loaded=await new StateStore(f.dir).load();assert(loaded.sessions.every(item=>item.permissionMode==='default'));
  }finally{await f.close();}
});

test('legacy permission absence migrates safely and corrupt stored modes are rejected without overwriting the file',async()=>{
  const f=await fixture();try{
    const session=await f.controller.call('session/create',{runtime:'demo'}) as Session;
    const saved=f.store.snapshot();delete saved.sessions[0]!.permissionMode;
    const file=path.join(f.dir,'state.json');await writeFile(file,JSON.stringify(saved));
    assert.equal((await new StateStore(f.dir).load()).sessions.find(item=>item.id===session.id)?.permissionMode,'default');
    saved.sessions[0]!.permissionMode='accept-edits';const corrupt=JSON.stringify(saved);await writeFile(file,corrupt);
    await assert.rejects(new StateStore(f.dir).load(),/权限模式/);assert.equal(await readFile(file,'utf8'),corrupt);
  }finally{await f.close();}
});

test('permission saves block draft entry and overlapping saves while their state write is pending',async()=>{
  const f=await fixture();try{
    const session=await f.controller.call('session/create',{runtime:'demo'}) as Session;
    const preview=await f.controller.call('draft/prepare',{sessionId:session.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
    const originalUpdate=f.store.update.bind(f.store);let release!:()=>void;let entered!:()=>void;
    const waiting=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
    f.store.update=async mutator=>{entered();await waiting;return originalUpdate(mutator);};
    const saving=f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'full-access'});await started;
    await assert.rejects(f.controller.call('draft/prepare',{sessionId:session.id,text:DEMO_INPUT,demo:true}),/正在保存/);
    await assert.rejects(f.controller.call('draft/refine',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash,instruction:'添加合成要求'}),/正在保存/);
    await assert.rejects(f.controller.call('draft/submit',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash}),/正在保存/);
    await assert.rejects(f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'read-only'}),/正在保存/);
    release();await saving;f.store.update=originalUpdate;
    assert.equal(f.store.snapshot().sessions[0]!.permissionMode,'full-access');
  }finally{await f.close();}
});

test('permission changes are saved during refinement without submitting its preview',{timeout:5000},async()=>{
  let markStarted!:()=>void;const started=new Promise<void>(resolve=>{markStarted=resolve;});
  const fetcher:typeof fetch=async(_input,init)=>{markStarted();return new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});});};
  const f=await fixture({translationFetcher:fetcher});try{
    f.secrets.get=async()=>'synthetic-fixture-only';
    await f.store.update(state=>{state.translation={...state.translation,baseUrl:'https://fixture.example/v1',model:'fixture',consent:true};});
    const session=await f.controller.call('session/create',{runtime:'demo'}) as Session;
    const preview=await f.controller.call('draft/prepare',{sessionId:session.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
    const refining=f.controller.call('draft/refine',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash,instruction:'增加合成要求',requestId:'permission-refinement'});
    const rejected=assert.rejects(refining);await started;
    await f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'full-access'});
    await f.controller.call('draft/cancel',{requestId:'permission-refinement'});await rejected;
    await f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'read-only'});
    assert.equal(f.store.snapshot().sessions[0]!.messages.length,0);
    assert.equal(f.store.snapshot().sessions[0]!.permissionMode,'read-only');
  }finally{await f.close();}
});

test('requested permissions remain editable during translation submission and uncertain results',{timeout:5000},async()=>{
  let translationStarted!:()=>void;const started=new Promise<void>(resolve=>{translationStarted=resolve;});
  const fetcher:typeof fetch=async(_input,init)=>{translationStarted();return new Promise<Response>((_resolve,reject)=>{const signal=init?.signal;signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});};
  const f=await fixture({translationFetcher:fetcher});try{
    f.secrets.get=async()=>'synthetic-fixture-only';
    await f.store.update(state=>{state.translation={...state.translation,baseUrl:'https://fixture.example/v1',model:'fixture',consent:true};});
    const session=await f.controller.call('session/create',{runtime:'demo'}) as Session;
    const preparing=f.controller.call('draft/prepare',{sessionId:session.id,text:'仅用于合成翻译并发测试',requestId:'pending-permission-translation'});
    const rejected=assert.rejects(preparing);await started;
    await f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'full-access'});
    await f.controller.call('draft/cancel',{requestId:'pending-permission-translation'});await rejected;
    await f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'read-only'});
    const preview=await f.controller.call('draft/prepare',{sessionId:session.id,text:DEMO_INPUT,demo:true}) as DraftPreview;
    const submission=f.controller.call('draft/submit',{sessionId:session.id,id:preview.id,sourceHash:preview.sourceHash});
    await f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'full-access'});
    await submission;
    await f.store.update(state=>{state.sessions[0]!.status='uncertain';});
    await f.controller.call('session/permissions',{sessionId:session.id,permissionMode:'default'});
    assert.equal(f.store.snapshot().sessions[0]!.permissionMode,'default');
  }finally{await f.close();}
});
