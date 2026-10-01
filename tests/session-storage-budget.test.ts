import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {NativeSessionStorage} from '../packages/remote-account-catalog/session-storage';
import type {SshHost,Session} from '../packages/contracts';
import type {SshRunner} from '../packages/ssh-transport';

const host:SshHost={id:'fixture',name:'Fixture',hostname:'retention.example.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'generation'};
const chunk=256*1024,response=(value:unknown)=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:true,value}),stderr:''});
const request=(options:Parameters<SshRunner>[2])=>JSON.parse(Buffer.from(options!.stdin!.match(/b64decode\('([^']+)'\)/)![1]!,'base64').toString()).request;
const candidate=(id:string)=>({accountId:id,accountGeneration:'ag',sessions:[id+'-session']});
const entry=(raw:Buffer)=>({path:'sessions/fixture.jsonl',size:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),mtime:1700000000,mode:384,delete:true});

test('bounded passes rotate candidates and a large native file makes durable progress across passes',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-budget-')),large=Buffer.alloc(3*chunk,71),small=Buffer.from('small native history');
 const commits:string[]=[],reads:{id:string;offset:number}[]=[],files={large,small};
 const runner:SshRunner=async(_h,_c,o)=>{const r=request(o),raw=files[r.accountId as keyof typeof files];
  if(r.method==='retention/candidates')return response({authorityId:'a',generation:'g',candidates:[candidate('large'),candidate('small')]});
  if(r.method==='retention/begin')return response({files:[entry(raw)]});
  if(r.method==='retention/read'){reads.push({id:r.accountId,offset:r.offset});return response({offset:r.offset,data:raw.subarray(r.offset,r.offset+chunk).toString('base64')});}
  if(r.method==='retention/commit'){commits.push(r.accountId);return response({reclaimedBytes:raw.length});}
  if(r.method==='retention/release')return response({});throw Error('Unexpected fixture method');
 };
 try{const service=new NativeSessionStorage(directory,runner);const first=await service.reclaim(host,'codex',{maxBytes:chunk});assert.equal(first?.transferredBytes,chunk);assert.equal(first?.deferred,true);assert.equal(commits.length,0);
  await service.reclaim(host,'codex',{maxBytes:chunk});assert.deepEqual([...commits],['small']);for(let i=0;i<3&&!commits.includes('large');i++)await service.reclaim(host,'codex',{maxBytes:chunk});assert.deepEqual([...commits],['small','large']);assert.deepEqual(reads.filter(r=>r.id==='large').map(r=>r.offset),[0,chunk,2*chunk]);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('a time-bounded hanging request yields, releases admission and can run again',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-deadline-'));let waiting=true,aborted=false;
 const runner:SshRunner=async(_h,_c,o)=>{if(waiting)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,1000);o!.signal!.addEventListener('abort',()=>{clearTimeout(timer);aborted=true;reject(o!.signal!.reason);},{once:true});});return response({candidates:[]});};
 try{const service=new NativeSessionStorage(directory,runner),start=Date.now();assert.equal((await service.reclaim(host,'codex',{maxDurationMs:40}))?.deferred,true);assert.ok(aborted);assert.ok(Date.now()-start<800);waiting=false;assert.equal((await service.reclaim(host,'codex'))?.deferred,false);}finally{await rm(directory,{recursive:true,force:true});}
});

test('invalid scheduler bounds perform no transport and acquire no lock',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-bounds-'));let calls=0;const runner:SshRunner=async()=>{calls++;return response({candidates:[]});};
 try{const service=new NativeSessionStorage(directory,runner);for(const options of [{maxBytes:0},{maxDurationMs:0},{maxDurationMs:Infinity},{maxCandidates:0},{maxCandidates:1.5}])await assert.rejects(service.reclaim(host,'codex',options),/SESSION_RETENTION_BUDGET_INVALID/);assert.equal(calls,0);await service.reclaim(host,'codex');assert.equal(calls,1);}finally{await rm(directory,{recursive:true,force:true});}
});

test('a corrupt partial prefix is replaced from the remote original instead of stalling forever',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-prefix-')),raw=Buffer.alloc(2*chunk,71);let commits=0;const reads:number[]=[];
 const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);if(r.method==='retention/candidates')return response({authorityId:'a',generation:'g',candidates:[candidate('account')]});if(r.method==='retention/begin')return response({files:[entry(raw)]});if(r.method==='retention/read'){reads.push(r.offset);return response({offset:r.offset,data:raw.subarray(r.offset,r.offset+chunk).toString('base64')});}if(r.method==='retention/commit'){commits++;return response({reclaimedBytes:raw.length});}return response({});};
 try{await new NativeSessionStorage(directory,runner).reclaim(host,'codex',{maxBytes:chunk});const folder=(await readdir(directory))[0]!;await writeFile(path.join(directory,folder,'0'),Buffer.alloc(chunk,1));await new NativeSessionStorage(directory,runner).reclaim(host,'codex');assert.deepEqual(reads,[0,0,chunk]);assert.equal(commits,1);}finally{await rm(directory,{recursive:true,force:true});}
});

test('bad downloaded bytes are discarded so a later healthy response can complete',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-chunk-')),raw=Buffer.from('native original');let bad=true,commits=0;
 const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);if(r.method==='retention/candidates')return response({authorityId:'a',generation:'g',candidates:[candidate('account')]});if(r.method==='retention/begin')return response({files:[entry(raw)]});if(r.method==='retention/read')return response({offset:r.offset,data:(bad?Buffer.alloc(raw.length,1):raw).toString('base64')});if(r.method==='retention/commit'){commits++;return response({reclaimedBytes:raw.length});}return response({});};
 try{const service=new NativeSessionStorage(directory,runner);await assert.rejects(service.reclaim(host,'codex'));assert.equal(commits,0);bad=false;await service.reclaim(host,'codex');assert.equal(commits,1);}finally{await rm(directory,{recursive:true,force:true});}
});

test('foreground native resume preempts only its own in-flight archive and releases the remote lease',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-preempt-')),raw=Buffer.from('native original');let entered!:()=>void,released=false;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);if(r.method==='retention/candidates')return response({authorityId:'a',generation:'g',candidates:[candidate('account')]});if(r.method==='retention/begin')return response({files:[entry(raw)]});if(r.method==='retention/read'){entered();await new Promise<void>((_resolve,reject)=>o!.signal!.addEventListener('abort',()=>reject(o!.signal!.reason),{once:true}));}if(r.method==='retention/release'){released=true;return response({});}throw Error('Unexpected fixture method');};
 try{const service=new NativeSessionStorage(directory,runner),running=service.reclaim(host,'codex').catch(error=>error);await started;
  const session={id:'account-session',binding:{accountRef:'vps-account:a/g/codex/account/ag'}} as Session;
  await service.restoreFor(host,session);assert.equal(released,true);assert.ok(await running instanceof Error);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('a completed archive is reverified when a remote restore was abandoned',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-restore-pending-')),raw=Buffer.from('native original');let pending=false,archiveId='',commits=0;
 const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);if(r.method==='retention/candidates')return response({authorityId:'a',generation:'g',candidates:[{...candidate('account'),restorePending:pending,...(archiveId?{archiveId}:{})}]});if(r.method==='retention/begin')return response({files:[entry(raw)]});if(r.method==='retention/read')return response({offset:r.offset,data:raw.toString('base64')});if(r.method==='retention/commit'){commits++;archiveId=r.archiveId;return response({reclaimedBytes:raw.length});}return response({});};
 try{const service=new NativeSessionStorage(directory,runner);await service.reclaim(host,'codex');await service.reclaim(host,'codex');assert.equal(commits,1);pending=true;await service.reclaim(host,'codex');assert.equal(commits,2);}finally{await rm(directory,{recursive:true,force:true});}
});
