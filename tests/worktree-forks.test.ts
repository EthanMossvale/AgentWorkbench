import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorktreeService } from '../packages/worktrees';
import { createSessionFork, nextForkTitle } from '../packages/session-core/fork';
import { recordedNativeFork } from '../packages/session-core/native-fork';
import { HostServiceRegistry } from '../packages/plugins-core/services';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import type { Session } from '../packages/contracts';
const execute=promisify(execFile);
const git=async(cwd:string,...args:string[]) => (await execute('git',args,{cwd,windowsHide:true})).stdout.trim();
const source=(projectPath=''):Session=>({id:'source',projectId:null,projectPath,title:'Example chat',pinned:false,archived:false,group:'',createdAt:'2026-09-28T00:00:00Z',binding:{runtime:'demo',provider:'offline',accountRef:'none',executionId:'local-device',egress:'demo'},status:'idle',messages:[{id:'u1',role:'user',original:'Question',timestamp:'2026-09-28T00:01:00Z',demo:true},{id:'a1',role:'assistant',original:'Answer',timestamp:'2026-09-28T00:02:00Z',demo:true}]});
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'awb-worktree-test-')),repo=path.join(root,'repo'),data=path.join(root,'data');await mkdir(repo);
  await git(repo,'init');await git(repo,'config','user.name','Fixture');await git(repo,'config','user.email','fixture@example.invalid');await git(repo,'config','core.autocrlf','false');
  await writeFile(path.join(repo,'tracked.txt'),'base\n');await writeFile(path.join(repo,'.gitignore'),'ignored.txt\n');await git(repo,'add','.');await git(repo,'commit','-m','fixture');
  const service=new WorktreeService(data);
  const close=()=>rm(root,{recursive:true,force:true});return {root,repo,data,service,close};
}
test('worktree creation preserves source branch, index, staged and unstaged changes, and nonignored files',async()=>{
  const f=await fixture();try{
    await writeFile(path.join(f.repo,'tracked.txt'),'staged\n');await git(f.repo,'add','tracked.txt');await writeFile(path.join(f.repo,'tracked.txt'),'staged\nunstaged\n');
    await writeFile(path.join(f.repo,'new.txt'),'untracked\n');await writeFile(path.join(f.repo,'ignored.txt'),'fixture ignored\n');
    const branch=await git(f.repo,'branch','--show-current'),head=await git(f.repo,'rev-parse','HEAD'),status=await git(f.repo,'status','--porcelain=v1');
    const record=await f.service.create(f.repo);assert.equal(record.status,'ready');assert.equal(record.copiedUntrackedFiles,1);assert.equal(record.copiedTrackedChanges,true);
    assert.equal(await git(record.path,'branch','--show-current'),'');assert.equal(await git(record.path,'rev-parse','HEAD'),head);
    assert.equal(await readFile(path.join(record.path,'tracked.txt'),'utf8'),'staged\nunstaged\n');assert.equal(await readFile(path.join(record.path,'new.txt'),'utf8'),'untracked\n');await assert.rejects(access(path.join(record.path,'ignored.txt')));
    assert.equal(await git(record.path,'diff','--cached'),await git(f.repo,'diff','--cached'));assert.equal(await git(record.path,'diff'),await git(f.repo,'diff'));
    assert.equal(await git(f.repo,'status','--porcelain=v1'),status);assert.equal(await git(f.repo,'branch','--show-current'),branch);
    assert.equal((await new WorktreeService(f.data).list()).records[0]!.id,record.id);
  }finally{await f.close();}
});
test('workspace subdirectories map into the independent checkout and root changes affect only new worktrees',async()=>{
  const f=await fixture();try{
    await mkdir(path.join(f.repo,'src'));await writeFile(path.join(f.repo,'src','x.txt'),'x');await git(f.repo,'add','src');await git(f.repo,'commit','-m','subdirectory');
    const record=await f.service.create(path.join(f.repo,'src'));assert.equal(record.cwd,path.join(record.path,'src'));
    const next=path.join(f.root,'custom');await f.service.configure(next);const other=await f.service.create(f.repo);assert.equal(path.dirname(other.path),next);await access(record.path);
    const info=await f.service.list();assert.equal(info.records.length,2);assert.equal(info.root,next);
  }finally{await f.close();}
});
test('non repositories, unborn repositories, invalid roots and conflicting states do not create worktrees',async()=>{
  const f=await fixture();try{
    const plain=await f.service.inspect(f.root);assert.equal(plain.available,false);assert.equal(plain.repositoryRoot,undefined);await assert.rejects(f.service.create(f.root));
    const empty=path.join(f.root,'empty');await mkdir(empty);await git(empty,'init');const unborn=await f.service.inspect(empty);assert.equal(unborn.available,false);assert.equal(unborn.repositoryRoot,empty);assert.match(unborn.reason!,/尚无提交/);
    await assert.rejects(f.service.configure(path.join(f.data,'unsafe')),/CONTROL_DIRECTORY/);
    await f.service.configure(path.join(f.repo,'nested'));await assert.rejects(f.service.create(f.repo),/OUTSIDE_REPOSITORY/);
    assert.equal((await f.service.list()).records.length,0);
  }finally{await f.close();}
});
test('failed session cleanup never deletes a copied dirty worktree',async()=>{
  const f=await fixture();try{
    await writeFile(path.join(f.repo,'tracked.txt'),'changed\n');const record=await f.service.create(f.repo);await f.service.abandon(record);
    assert.equal((await f.service.list()).records[0]!.status,'failed');assert.equal(await readFile(path.join(record.path,'tracked.txt'),'utf8'),'changed\n');
    await f.service.abandon({...record,id:'not-owned'});await access(record.path);
  }finally{await f.close();}
});
test('clean failed-session worktree is removed from Git and the managed list',async()=>{
  const f=await fixture();try{const record=await f.service.create(f.repo);await f.service.abandon(record);assert.equal((await f.service.list()).records.length,0);await assert.rejects(access(record.path));}finally{await f.close();}
});
test('a missing managed checkout is rejected and never silently recreated',async()=>{
  const f=await fixture();try{const record=await f.service.create(f.repo);await f.service.validate(record);await git(f.repo,'worktree','remove',record.path);await assert.rejects(f.service.validate(record),/WORKTREE_UNAVAILABLE/);await assert.rejects(access(record.path));assert.equal((await f.service.list()).records[0]!.status,'missing');}finally{await f.close();}
});
test('fork title numbering is sequential across nested siblings and preserved renamed snapshots',()=>{
  const original=source(),one=createSessionFork(original,'one','now');Object.assign(one.branch!,nextForkTitle(original,[original]));
  assert.equal(one.title,'Example chat (1)');const two=nextForkTitle(one,[original,one]);assert.equal(two.title,'Example chat (2)');
  one.title='Renamed';assert.equal(nextForkTitle(original,[original,one]).title,'Example chat (2)');
  const long={...original,title:'x'.repeat(150)};const first=createSessionFork(long,'long','now');assert.notEqual(nextForkTitle(long,[long,first]).title,first.title);
});
test('local native fork requires an exact recorded boundary and preserves the original thread as lineage',()=>{
  const session=source();session.binding.runtime='codex';session.binding.nativeSessionId='native-parent';
  assert.throws(()=>recordedNativeFork(session,'a1'),/BOUNDARY_UNVERIFIED/);
  session.messages[0]!.nativeTurnId='turn1';session.messages[1]!.nativeTurnId='turn1';session.messages[1]!.nativeTurnEnd=true;
  assert.deepEqual(recordedNativeFork(session,'a1'),{sourceSessionId:'source',threadId:'native-parent',lastTurnId:'turn1'});
  assert.deepEqual(recordedNativeFork(session,'u1'),{sourceSessionId:'source',threadId:'native-parent',beforeTurnId:'turn1'});
  const child=createSessionFork(session,'child','now','a1',recordedNativeFork(session,'a1'));
  assert.deepEqual(recordedNativeFork(child),child.branch?.native);assert.equal(child.binding.nativeSessionId,undefined);
});
test('host workspace/worktree fork routes preserve lineage, emit independent sessions and expose developer inspection',async()=>{
  const f=await fixture(),store=new StateStore(f.data);await store.load();await store.update(s=>{s.sessions=[source(f.repo)];});
  const controller=new WorkbenchController(store,new SecretStore(f.data,{encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),{worktrees:f.service,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  try{
    const registry=new HostServiceRegistry(),service=controller.developmentServices()['actions.worktrees'];assert.equal(service,f.service);registry.register('actions.worktrees',service!);
    const restore=registry.override('actions.worktrees',{inspect:async()=>({available:false,reason:'Extension policy'})});
    assert.equal((await controller.call('session/fork-options',{sessionId:'source'}) as any).worktree.reason,'Extension policy');restore();
    const options=await controller.call('session/fork-options',{sessionId:'source'}) as any;assert.equal(options.worktree.available,true);assert.equal(options.workspace.available,true);
    const original=store.snapshot().sessions[0]!;
    const local=await controller.call('session/fork',{sessionId:'source',messageId:'a1',location:'workspace'}) as Session;assert.equal(local.title,'Example chat (1)');assert.equal(local.projectPath,f.repo);
    const isolated=await controller.call('session/fork',{sessionId:'source',messageId:'a1',location:'worktree'}) as Session;assert.equal(isolated.title,'Example chat (2)');assert.notEqual(isolated.projectPath,f.repo);assert.equal(isolated.worktree?.cwd,isolated.projectPath);assert.equal(isolated.branch?.inheritedMessageCount,2);
    assert.deepEqual(store.snapshot().sessions.find(s=>s.id==='source'),original);
    await assert.rejects(controller.call('session/fork',{sessionId:'source',location:'unsupported'}),/FORK_LOCATION/);
    const list=await controller.call('worktrees/list') as any;assert.equal(list.records.length,1);
    await git(f.repo,'worktree','remove',isolated.worktree!.path);
    const unavailable=await controller.call('session/fork-options',{sessionId:isolated.id}) as any;assert.equal(unavailable.workspace.available,false);assert.equal(unavailable.worktree.available,false);
    await assert.rejects(controller.call('session/fork',{sessionId:isolated.id}),/WORKTREE_UNAVAILABLE/);
    await assert.rejects(controller.call('draft/prepare',{sessionId:isolated.id,text:'Continue'}),/WORKTREE_UNAVAILABLE/);await assert.rejects(access(isolated.projectPath!));
    const kept=await controller.call('session/fork',{sessionId:'source',location:'worktree'}) as Session;
    await controller.call('session/delete',{id:kept.id,confirm:true});await access(kept.projectPath!);
  }finally{await controller.dispose();await f.close();}
});


test('a busy native source can fork an earlier completed turn into a real worktree while later events keep arriving',async()=>{
  const f=await fixture(),store=new StateStore(f.data);await store.load();
  const parent=source(f.repo);parent.status='running';parent.binding={...parent.binding,runtime:'codex',nativeSessionId:'native-source'};
  parent.messages.forEach(message=>{message.nativeTurnId='finished';if(message.role==='assistant')message.nativeTurnEnd=true;});
  parent.messages.push({id:'u2',role:'user',original:'Continue',demo:false,nativeTurnId:'live',timestamp:'2026-09-28T00:03:00Z'},{id:'a2',role:'assistant',original:'Working',demo:false,nativeTurnId:'live',nativeTurnEnd:false,timestamp:'2026-09-28T00:04:00Z'});
  await store.update(s=>{s.sessions=[parent];});
  let connections=0;const nativeCodex={supports:()=>false,defaultDirectory:()=>f.repo,connect:async()=>{connections++;throw Error('Never reconnect the active source');},close:async()=>{},dispose:async()=>{}};
  const controller=new WorkbenchController(store,new SecretStore(f.data,{encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),{worktrees:f.service,nativeCodex,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  const runner=controller.developmentServices()['runtime.codex'] as {busy:(id:string)=>boolean};const originalBusy=runner.busy;runner.busy=()=>true;
  try{
    const options=await controller.call('session/fork-options',{sessionId:'source',messageId:'a1'}) as any;
    assert.equal(options.busy,false);assert.equal(options.workspace.available,true);assert.equal(options.worktree.available,true);
    const live=await controller.call('session/fork-options',{sessionId:'source',messageId:'a2'}) as any;assert.equal(live.workspace.available,false);
    await assert.rejects(controller.call('session/fork',{sessionId:'source',messageId:'a2'}));
    await assert.rejects(controller.call('session/fork',{sessionId:'source'}));
    const create=f.service.create.bind(f.service);
    f.service.create=async directory=>{await store.update(s=>{const current=s.sessions.find(s=>s.id==='source')!;current.messages[3]!.original+=' and streaming';current.messages.push({id:'live-tool-comment',role:'assistant',original:'More output',demo:false,nativeTurnId:'live',nativeTurnEnd:false,timestamp:'2026-09-28T00:04:01Z'});current.messages[1]!.translation='Retranslated';});return create(directory);};
    const fork=await controller.call('session/fork',{sessionId:'source',messageId:'a1',location:'worktree'}) as Session;
    assert.deepEqual(fork.messages.map(m=>m.id),['u1','a1']);assert.equal(fork.status,'idle');assert.equal(fork.binding.nativeSessionId,undefined);
    assert.deepEqual(fork.branch?.native,{sourceSessionId:'source',threadId:'native-source',lastTurnId:'finished'});
    assert.equal(await git(fork.projectPath!,'rev-parse','HEAD'),await git(f.repo,'rev-parse','HEAD'));
    assert.equal(await git(fork.projectPath!,'branch','--show-current'),'');assert.equal(connections,0);
    const current=store.snapshot().sessions.find(s=>s.id==='source')!;assert.equal(current.status,'running');assert.equal(current.messages.at(-1)!.id,'live-tool-comment');assert.equal(current.binding.nativeSessionId,'native-source');
    const workspace=await controller.call('session/fork',{sessionId:'source',messageId:'a1',location:'workspace'}) as Session;assert.equal(workspace.projectPath,f.repo);assert.equal(workspace.messages.length,2);
  }finally{runner.busy=originalBusy;await controller.dispose();await f.close();}
});

for(const drift of ['history','identity'] as const)test(`a concurrent ${drift} change rejects a historical fork and removes only its clean checkout`,async()=>{
  const f=await fixture(),store=new StateStore(f.data);await store.load();const parent=source(f.repo);parent.status='running';parent.messages.push({id:'u2',role:'user',original:'New turn',timestamp:'2026-09-28T00:03:00Z',demo:true});await store.update(s=>{s.sessions=[parent];});
  const create=f.service.create.bind(f.service);f.service.create=async directory=>{const record=await create(directory);await store.update(s=>{if(drift==='history')s.sessions[0]!.messages[1]!.original='Changed';else s.sessions[0]!.binding.accountRef='changed';});return record;};
  const controller=new WorkbenchController(store,new SecretStore(f.data,{encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),{worktrees:f.service,pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
  try{await assert.rejects(controller.call('session/fork',{sessionId:'source',messageId:'a1',location:'worktree'}),/起点或连接身份/);assert.equal(store.snapshot().sessions.length,1);assert.equal((await f.service.list()).records.length,0);assert.equal((await git(f.repo,'worktree','list','--porcelain')).split('worktree ').length-1,1);}finally{await controller.dispose();await f.close();}
});
