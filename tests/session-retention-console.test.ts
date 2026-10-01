import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {NativeSessionStorage} from '../packages/remote-account-catalog/session-storage';
import {RetentionJournal} from '../packages/remote-account-catalog/retention-journal';
import {retentionCountdown,type RetentionSession} from '../packages/remote-account-catalog/retention-types';
import {retentionFailure,RetentionError} from '../packages/remote-account-catalog/retention-errors';
import {RemoteCliService} from '../packages/remote-account-catalog/cli';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import type {SshHost} from '../packages/contracts';
import type {SshRunner} from '../packages/ssh-transport';

const host:SshHost={id:'admin',name:'Fixture',hostname:'retention.example.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'generation'};
const policy={revision:0,autoUpdate:false,reclaimIdle:true,idleHours:24};
const row:RetentionSession={sessionId:'session',accountId:'account',accountGeneration:'ag',threadId:'native',lastModelActivity:1000,idleSeconds:90000,dueAt:87400,eligible:true,clockReason:'expired',active:false,interrupted:true,uncertain:false,remoteState:'present',operation:null};
const response=(value:unknown)=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:true,value}),stderr:''});
const decode=(options:Parameters<SshRunner>[2])=>JSON.parse(Buffer.from(options!.stdin!.match(/b64decode\('([^']+)'\)/)![1]!,'base64').toString()).request;
const inspection=()=>({available:true,observedAt:91000,policy,sessions:[row],total:1,nextCursor:null,loginBusy:false,authorityId:'a',generation:'g'});

test('inspection is a bounded read-only request and preserves actual idle metadata',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-inspect-')),requests:any[]=[];
 const service=new NativeSessionStorage(directory,async(_h,_c,o)=>{requests.push(decode(o));assert.ok(o!.signal);return response(inspection());});
 try{const value=await service.inspect(host,'codex');assert.equal(value.sessions[0]!.interrupted,true);assert.equal(value.sessions[0]!.dueAt,87400);assert.equal(value.policy.idleHours,24);assert.deepEqual(requests,[{method:'retention/inspect',provider:'codex',after:'',limit:50}]);await assert.rejects(service.inspect(host,'codex',{limit:101}));assert.equal(requests.length,1);await assert.rejects(service.inspect({...host,username:'member',role:'workspace'},'codex'),/管理员/);}finally{service.dispose();await rm(directory,{recursive:true,force:true});}
});

test('unavailable remote runtime still returns its independently stored policy',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-unavailable-'));
 const service=new NativeSessionStorage(directory,async()=>response({available:false,observedAt:1,policy:{...policy,reclaimIdle:false,idleHours:48}}));
 try{const result=await service.inspect(host,'claude');assert.equal(result.available,false);assert.equal(result.policy.idleHours,48);assert.match(result.issue!,/远端归档服务/);assert.deepEqual(result.sessions,[]);}finally{service.dispose();await rm(directory,{recursive:true,force:true});}
});

test('countdown uses actual model time and represents disabled, unknown and reclaimed states honestly',()=>{
 assert.equal(retentionCountdown(row,policy,87400).label,'待清理');
 assert.equal(retentionCountdown(row,{...policy,reclaimIdle:false},87000).label,'未开启');
 assert.equal(retentionCountdown(row,policy,87335).label,'1分 05秒');
 assert.equal(retentionCountdown({...row,dueAt:null,clockReason:'clock_ahead'},policy,0).label,'时间待核实');
 assert.match(retentionCountdown({...row,remoteState:'reclaimed'},policy,90000).reason,/保存归档的设备/);
 assert.equal(retentionCountdown({...row,operation:'archiving'},policy,90000).label,'正在归档');
});

test('configurable hours are validated before transport and saved with compare-and-swap revision',async()=>{
 let calls=0;const service=new RemoteCliService(async(_h,_c,o)=>{calls++;const r=decode(o);assert.equal(r.method,'cli/configure');assert.equal(r.revision,0);return response({...policy,...r.changes,revision:1});});
 assert.equal((await service.configure(host,'claude',0,{idleHours:72})).idleHours,72);
 for(const idleHours of [0,8761,1.5,NaN,Infinity])await assert.rejects(service.configure(host,'codex',0,{idleHours}),/整数小时/);
 assert.equal(calls,1);
});

test('journal persists locally across restart, isolates hosts/providers and coalesces empty checks',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-journal-'));let now=1000000;const journal=new RetentionJournal(directory,()=>now);
 try{journal.record('host-a',{provider:'codex',kind:'checked',message:'Checked',sessionIds:[]});now+=1000;journal.record('host-a',{provider:'codex',kind:'checked',message:'Checked',sessionIds:[]});journal.record('host-a',{provider:'claude',kind:'policy',message:'Changed',sessionIds:[]});
  const first=await journal.list('host-a','codex');assert.equal(first.entries.length,1);assert.equal(first.entries[0]!.repeat,2);assert.equal(first.issue,undefined);
  assert.equal((await new RetentionJournal(directory,()=>now).list('host-a','codex')).entries[0]!.repeat,2);
  assert.equal((await journal.list('host-b','codex')).entries.length,0);assert.equal((await journal.list('host-a','claude')).entries.length,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('journal bounds its local size and age and paginates without reading remote state',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-log-bounds-'));let now=1000000;const journal=new RetentionJournal(directory,()=>now);
 try{for(let i=0;i<2010;i++)journal.record('host',{provider:'codex',kind:'reclaimed',message:'Fixture',sessionIds:['s'+i]});const first=await journal.list('host','codex',{limit:100});assert.equal(first.entries.length,100);assert.ok(first.nextBefore);const next=await journal.list('host','codex',{before:first.nextBefore!,limit:100});assert.ok(!next.entries.some(e=>first.entries.some(f=>f.id===e.id)));
  const file=path.join(directory,(await readdir(directory)).find(name=>name.endsWith('.json'))!);assert.equal(JSON.parse(await readFile(file,'utf8')).entries.length,2000);
  now+=31*86400000;assert.equal((await journal.list('host','codex')).entries.length,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('remote connection failures leave explanatory logs available offline after service restart',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-log-offline-'));let calls=0;
 const runner:SshRunner=async()=>{calls++;return {exitCode:255,signal:null,stdout:'',stderr:'SENSITIVE FIXTURE TOKEN'};};
 try{await new NativeSessionStorage(directory,runner).reclaim(host,'codex').catch(()=>{});const page=await new NativeSessionStorage(directory,runner).logs(host,'codex');assert.equal(calls,1);assert.equal(page.entries[0]!.code,'SSH_FAILED');assert.match(page.entries[0]!.message,/网络/);assert.ok(!JSON.stringify(page).includes('SENSITIVE'));}finally{await rm(directory,{recursive:true,force:true});}
});

test('large metadata records remain within the journal byte limit and are readable after restart',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-log-bytes-'));const journal=new RetentionJournal(directory);
 try{for(let i=0;i<300;i++)journal.record('host',{provider:'claude',kind:'archiving',message:'Fixture',sessionIds:Array.from({length:100},(_,j)=>String(j).padStart(256,'x'))});await journal.list('host','claude');const data=await readFile(path.join(directory,(await readdir(directory)).find(name=>name.endsWith('.json'))!));assert.ok(data.length<=4*1024*1024);assert.equal((await new RetentionJournal(directory).list('host','claude')).issue,undefined);}finally{await rm(directory,{recursive:true,force:true});}
});

test('an unwritable journal reports the reason without blocking verified remote reclamation',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-log-failure-'));await writeFile(path.join(directory,'logs'),'directory conflict');const raw=Buffer.from('fixture');let commits=0;
 const service=new NativeSessionStorage(directory,async(_h,_c,o)=>{const r=decode(o);if(r.method==='retention/candidates')return response({authorityId:'a',generation:'g',candidates:[{accountId:'account',accountGeneration:'ag',sessions:['session']}]});if(r.method==='retention/begin')return response({files:[{path:'sessions/a.jsonl',sha256:createHash('sha256').update(raw).digest('hex'),size:raw.length,mode:384,mtime:1,delete:true}]});if(r.method==='retention/read')return response({offset:0,data:raw.toString('base64')});if(r.method==='retention/commit'){commits++;return response({reclaimedBytes:raw.length});}return response({});});
 try{await service.reclaim(host,'codex');assert.equal(commits,1);const logs=await service.logs(host,'codex');assert.match(logs.issue!,/本机.*日志/);assert.ok(logs.entries.some(e=>e.kind==='reclaimed'));assert.equal((await service.status(host)).providers.codex?.error,undefined);}finally{service.dispose();await rm(directory,{recursive:true,force:true});}
});

test('damaged existing journal is preserved and errors never expose raw diagnostics',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-log-corrupt-')),file=path.join(directory,createHash('sha256').update('host').digest('hex')+'.json');await writeFile(file,'broken fixture');
 try{const journal=new RetentionJournal(directory);journal.record('host',{provider:'codex',kind:'error',message:'Safe failure',sessionIds:[]});const result=await journal.list('host','codex');assert.match(result.issue!,/原文件保留/);assert.equal(await readFile(file,'utf8'),'broken fixture');assert.equal(result.entries.length,1);
  assert.match(retentionFailure(Object.assign(Error('private-path'),{code:'ENOSPC'})).message,/本机空间不足/);assert.ok(!retentionFailure(Error('secret')).message.includes('secret'));assert.match(new RetentionError('STORAGE_DEPENDENCY_MISSING').message,/依赖缺失/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('host dispatch provides inspection, local logs and policy persistence but rejects members',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-dispatch-')),store=new StateStore(directory);await store.load();const member={...host,id:'member',username:'member',role:'workspace'} as SshHost;await store.update(s=>{s.hosts=[host,member];});
 const storage=new NativeSessionStorage(path.join(directory,'archives'),async(_h,_c,o)=>{assert.equal(decode(o).method,'retention/inspect');return response(inspection());});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),{sessionStorage:storage,remoteCliPolicies:{configure:async(_h,_p,_r,changes)=>({...policy,...changes,revision:1}),autoUpdate:async()=>({status:'skipped'})},pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[]},()=>{});
 try{assert.equal((await controller.call('remote-storage/inspect',{id:'admin',provider:'codex'}) as any).total,1);await controller.call('remote-cli/configure',{id:'admin',provider:'codex',revision:0,changes:{idleHours:48}});const logs=await controller.call('remote-storage/logs',{id:'admin',provider:'codex'}) as any;assert.match(logs.entries[0].message,/48 小时/);
  for(const method of ['remote-storage/inspect','remote-storage/logs'])await assert.rejects(controller.call(method,{id:'member',provider:'codex'}),/管理员/);
 }finally{await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
