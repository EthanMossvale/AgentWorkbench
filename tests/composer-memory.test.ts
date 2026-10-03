import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {composerCommands,composerQuery,skillPrompt} from '../packages/composer-core';
import {composerSkills,resolveSkills,codexSkillInputs} from '../packages/native-skills/invocation';
import {NativeSkillsService,skillMetadata,type NativeSkill,type SkillScan} from '../packages/native-skills';
import {NativeMemoryService} from '../packages/native-memory';
import {InputGate} from '../packages/translation/gate';
import {preparedDraftAction} from '../apps/desktop/renderer/translation-flow';

test('slash queries honor caret and do not treat file paths or URLs as commands',()=>{
  assert.deepEqual(composerQuery('先写 /gui 后文',7),{start:3,end:7,query:'gui',skillsOnly:false});
  assert.equal(composerQuery('C:/folder',9),null);assert.equal(composerQuery('https://example.test',20),null);
  assert.equal(composerQuery('$draft',6)?.skillsOnly,true);
  assert.ok(composerCommands('claude').some(c=>c.action==='plan'));
  assert.ok(composerCommands('codex').some(c=>c.action==='plan'));
});
const skill=(provider:'codex'|'claude',extra:Partial<NativeSkill>={}):NativeSkill=>({id:provider,hash:'a'.repeat(64),name:'fixture',description:'A fixture',displayName:'测试技能',shortDescription:'A fixture',path:path.resolve('fixture/SKILL.md'),directory:path.resolve('fixture'),enabled:true,available:true,origins:[{provider,kind:'personal',root:path.resolve('skills'),nativeName:provider+'-fixture'}],conflicts:[],...extra});
test('menu discovery follows runtime, project scope, native disabled state and user-invocable metadata',()=>{
  const scan:SkillScan={skills:[skill('codex'),skill('claude'),skill('claude',{id:'hidden',userInvocable:false}),skill('claude',{id:'disabled',available:false}),skill('claude',{id:'project',origins:[{provider:'claude',kind:'project',root:path.resolve('project/.claude/skills')} ]})],roots:[],errors:[]};
  assert.deepEqual(composerSkills(scan,'claude',path.resolve('other')).map(s=>s.id),['claude']);
  assert.equal(composerSkills(scan,'claude',path.resolve('project/nested')).length,2);
  assert.deepEqual(composerSkills(scan,'api'),[]);
  const catalog=composerSkills(scan,'codex'),invocations=resolveSkills(catalog,[{id:'codex',hash:'a'.repeat(64)}]);
  assert.equal(skillPrompt('请写文档',invocations),'$codex-fixture 请写文档');assert.equal(codexSkillInputs(invocations)[0]?.path,scan.skills[0]?.path);
  assert.throws(()=>resolveSkills(catalog,[{id:'claude',hash:'a'.repeat(64)}]),/STALE/);
  assert.throws(()=>resolveSkills(catalog,[{id:'codex',hash:'b'.repeat(64)}]),/STALE/);
  assert.throws(()=>resolveSkills(catalog,[{id:'codex',hash:'a'.repeat(64),path:'untrusted'}]),/INVALID/);
  assert.equal(skillMetadata('---\nname: hidden\ndescription: Background\nuser-invocable: false\n---\nInstructions.','hidden').userInvocable,false);
});
test('native contexts skip all supplemental catalog scanning and cross-runtime injection',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'composer-catalog-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const service=new NativeSkillsService(root,{home:root});await service.initialize();let scans=0;service.scan=async()=>{scans++;throw Error('must not scan');};
  assert.equal((await service.createDiscoverySnapshot({sessionId:'claude',nativeRuntime:'claude'})).items.length,0);
  assert.equal((await service.createDiscoverySnapshot({sessionId:'codex',nativeRuntime:'codex'})).items.length,0);assert.equal(scans,0);
});
test('linked runtime availability and bundled invocation are independent from export availability',()=>{
  const shared=skill('claude',{id:'shared',runtimeAvailability:{claude:false,codex:true},origins:[{provider:'claude',kind:'personal',root:path.resolve('claude')},{provider:'codex',kind:'personal',root:path.resolve('codex')}]}),builtin=skill('claude',{id:'builtin',available:false,builtin:true,origins:[{provider:'claude',kind:'official',root:'builtin',nativeName:'bundled'}]}),scan:SkillScan={skills:[shared,builtin],roots:[],errors:[]};
  assert.deepEqual(composerSkills(scan,'claude').map(s=>s.id),['builtin']);
  assert.deepEqual(composerSkills(scan,'codex').map(s=>s.id),['shared']);
});
test('Codex selections have no workbench count limit and still reject duplicate identities',()=>{
  const skills=Array.from({length:12},(_,i)=>skill('codex',{id:'skill-'+i}));
  const catalog=composerSkills({skills,roots:[],errors:[]},'codex'),requested=catalog.map(({id,hash})=>({id,hash}));
  assert.equal(resolveSkills(catalog,requested).length,12);
  assert.throws(()=>resolveSkills(catalog,[...requested,requested[0]]),/INVALID/);
});

test('selection preserves sanitized display icons and Claude accepts only one native slash invocation',()=>{
  const first=skill('claude',{icon:'data:image/svg+xml;base64,fixture'}),second=skill('claude',{id:'second',origins:[{provider:'claude',kind:'personal',root:path.resolve('skills'),nativeName:'second'}]}),catalog=composerSkills({skills:[first,second],roots:[],errors:[]},'claude');
  assert.equal(resolveSkills(catalog,[{id:first.id,hash:first.hash}])[0]?.icon,first.icon);
  assert.throws(()=>resolveSkills(catalog,catalog.map(({id,hash})=>({id,hash}))),/SKILL_SELECTION_LIMIT/);
});
test('skill identities stay outside translation, survive revisions, and disabled translation sends original without preview',async()=>{
  const gate=new InputGate(),selected=resolveSkills(composerSkills({skills:[skill('claude')],roots:[],errors:[]},'claude'),[{id:'claude',hash:'a'.repeat(64)}]);
  const id=gate.create('session','原稿',[],selected),preview=await gate.prepare(id,async text=>{assert.equal(text,'原稿');return 'Original request';});
  assert.equal(preview.translated,'/claude-fixture Original request');assert.deepEqual(preview.skills,selected);
  const revision=gate.beginRevision(id,'session',preview.sourceHash);assert.throws(()=>gate.getPreview(id,'session'));
  const updated=await gate.prepareRevision(revision.id,revision.previous,'补充',async()=>({original:'新原稿',translated:'New request'}));assert.equal(updated.translated,'/claude-fixture New request');
  const direct=await gate.prepare(gate.create('off','中文',[],selected),async text=>text,false,true,true);
  assert.equal(preparedDraftAction({requested:{enabled:false,key:'off'},current:{enabled:false,key:'off'},preview:direct,source:'中文',bypass:true,autoSubmit:false}),'submit-original');
});
test('handoff reader exposes only the active runtime/session batch, checks hashes and closes on disable or finish',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'composer-memory-')),home=path.join(root,'home'),data=path.join(root,'data');const service=new NativeMemoryService(data,{home,codexHome:path.join(home,'.codex'),claudeHome:path.join(home,'.claude'),intervalMs:60000,machineIdentity:'fixture'});await service.initialize();t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true});});
  const source=path.join(home,'.codex','memories','MEMORY.md');await mkdir(path.dirname(source),{recursive:true});await writeFile(source,'Reference archive content.');await service.configure({enabled:true,initialSources:'codex'});
  const session=service.session('claude','bound');const input=await session.prepare('Explicit user task','submission');assert.match(input,/separate from any reference-context/);assert.match(input,/workbench_read_memory_handoff/);
  assert.equal((await service.status()).activeClaude,1);const batch=await service.readHandoff('claude','bound',{}) as any;const id=batch.entries[0].archiveId;
  await assert.rejects(service.readHandoff('claude','other',{}),/INACTIVE/);await assert.rejects(service.readHandoff('codex','bound',{}),/INACTIVE/);
  const page=await service.readHandoff('claude','bound',{archiveId:id,limit:9}) as any;assert.equal(page.content,'Reference');assert.equal(page.nextOffset,9);
  await assert.rejects(service.readHandoff('claude','bound',{archiveId:'0'.repeat(64)}),/NOT_ISSUED/);await assert.rejects(service.readHandoff('claude','bound',{archiveId:id,limit:24001}),/INVALID/);
  await service.configure({enabled:false});await assert.rejects(service.readHandoff('claude','bound',{}),/INACTIVE/);await session.finish();assert.equal((await service.status()).activeClaude,0);assert.equal((await service.status()).pendingClaude,1);assert.equal((await service.status()).lastSync,undefined);
});
