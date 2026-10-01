import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {NativeSessionStorage} from '../packages/remote-account-catalog/session-storage';
import type {SshHost} from '../packages/contracts';
import type {SshRunner} from '../packages/ssh-transport';

const host:SshHost={id:'fixture-retention',name:'Fixture',hostname:'retention.example.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-identity'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'generation'};
const response=(value:unknown)=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:true,value}),stderr:''});
const request=(options:Parameters<SshRunner>[2])=>JSON.parse(Buffer.from(options!.stdin!.match(/b64decode\('([^']+)'\)/)![1]!,'base64').toString()).request;
const raw=Buffer.from('native fixture history\n');
const entry={path:'sessions/fixture.jsonl',sha256:createHash('sha256').update(raw).digest('hex'),size:raw.length,mode:384,mtime:1700000000,delete:true};
const candidate=(id:string)=>({accountId:id,accountGeneration:'ag',sessions:[id+'-session']});

test('a disconnected archive releases its lock and the same service can retry successfully',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-retry-'));let disconnected=true,commits=0,releases=0;
  const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);
    if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[candidate('account')]});
    if(r.method==='retention/begin')return response({files:[entry]});
    if(r.method==='retention/read'){if(disconnected)throw Error('Synthetic SSH disconnect');return response({offset:r.offset,data:raw.toString('base64')});}
    if(r.method==='retention/commit'){commits++;return response({reclaimedBytes:raw.length});}
    if(r.method==='retention/release'){releases++;return response({});}
    throw Error('Unexpected fixture method '+r.method);
  };
  try{const service=new NativeSessionStorage(directory,runner);await service.reclaim(host,'codex').catch(()=>{});assert.equal(commits,0);assert.equal(releases,1);disconnected=false;await service.reclaim(host,'codex');assert.equal(commits,1);assert.equal(releases,2);}finally{await rm(directory,{recursive:true,force:true});}
});

test('one failed archive does not prevent another expired account from reclaiming space',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-isolation-'));const commits:string[]=[];
  const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);
    if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[candidate('broken'),candidate('healthy')]});
    if(r.method==='retention/begin')return response({files:[entry]});
    if(r.method==='retention/read'){if(r.accountId==='broken')throw Error('Synthetic inaccessible history');return response({offset:r.offset,data:raw.toString('base64')});}
    if(r.method==='retention/commit'){commits.push(r.accountId);return response({reclaimedBytes:raw.length});}
    if(r.method==='retention/release')return response({});
    throw Error('Unexpected fixture method '+r.method);
  };
  try{const service=new NativeSessionStorage(directory,runner);await service.reclaim(host,'codex').catch(()=>{});assert.deepEqual(commits,['healthy'],'An independent expired account must not starve behind a failing archive.');}finally{await rm(directory,{recursive:true,force:true});}
});

test('a lost pre-delete acknowledgement remains recoverable after restarting the local service',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-unknown-'));let attempts=0;const identities:string[]=[];
  const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);
    if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[candidate('account')]});
    if(r.method==='retention/begin')return response({files:[entry]});
    if(r.method==='retention/read')return response({offset:r.offset,data:raw.toString('base64')});
    if(r.method==='retention/commit'){attempts++;identities.push(r.archiveId);if(attempts===1)throw Error('Synthetic disconnect before remote mutation');return response({reclaimedBytes:raw.length});}
    if(r.method==='retention/release')return response({});
    throw Error('Unexpected fixture method '+r.method);
  };
  try{await new NativeSessionStorage(directory,runner).reclaim(host,'codex').catch(()=>{});assert.equal(attempts,1);await new NativeSessionStorage(directory,runner).reclaim(host,'codex').catch(()=>{});assert.equal(attempts,2,'A verified local archive cannot permanently block reclamation after one lost receipt.');assert.equal(identities[0],identities[1],'Recovery must reuse the verified archive rather than duplicate its storage.');}finally{await rm(directory,{recursive:true,force:true});}
});

test('an interrupted large-file transfer resumes from the verified local prefix after restart',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-partial-')),chunk=256*1024,content=Buffer.alloc(3*chunk,71);
  const large={...entry,size:content.length,sha256:createHash('sha256').update(content).digest('hex')};let offline=true,commits=0;const reads:number[]=[];
  const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);
    if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[candidate('account')]});
    if(r.method==='retention/begin')return response({files:[large]});
    if(r.method==='retention/read'){reads.push(r.offset);if(offline&&r.offset===chunk)throw Error('Synthetic transfer interrupted');return response({offset:r.offset,data:content.subarray(r.offset,r.offset+chunk).toString('base64')});}
    if(r.method==='retention/commit'){commits++;return response({reclaimedBytes:content.length});}
    if(r.method==='retention/release')return response({});
    throw Error('Unexpected fixture method '+r.method);
  };
  try{await new NativeSessionStorage(directory,runner).reclaim(host,'codex').catch(()=>{});assert.equal(commits,0);const before=reads.length;offline=false;await new NativeSessionStorage(directory,runner).reclaim(host,'codex');assert.equal(reads[before],chunk,'Restart must continue the partial archive, not repeatedly redownload its beginning.');assert.equal(commits,1);}finally{await rm(directory,{recursive:true,force:true});}
});

test('an already cancelled background pass does no network or archive work',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-cancel-'));let calls=0;const abort=new AbortController();abort.abort();
  const runner:SshRunner=async()=>{calls++;return response({candidates:[]});};
  try{const service=new NativeSessionStorage(directory,runner);await service.reclaim(host,'codex',{signal:abort.signal}).catch(()=>{});assert.equal(calls,0,'Cancellation must be checked before network work and must not leave a retained lock.');await service.reclaim(host,'codex');assert.equal(calls,1);}finally{await rm(directory,{recursive:true,force:true});}
});

test('cancelling an in-flight chunk returns promptly, releases the lock and allows a later retry',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-inflight-'));let started!:()=>void,waiting=true,commits=0;
  const entered=new Promise<void>(resolve=>{started=resolve;}),abort=new AbortController();
  const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);
    if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[candidate('account')]});
    if(r.method==='retention/begin')return response({files:[entry]});
    if(r.method==='retention/read'){
      if(waiting){started();await new Promise<void>((_resolve,reject)=>{if(o?.signal?.aborted)reject(o.signal.reason);else o?.signal?.addEventListener('abort',()=>reject(o.signal!.reason),{once:true});});}
      return response({offset:r.offset,data:raw.toString('base64')});
    }
    if(r.method==='retention/commit'){commits++;return response({reclaimedBytes:raw.length});}
    if(r.method==='retention/release')return response({});
    throw Error('Unexpected fixture method '+r.method);
  };
  try{const service=new NativeSessionStorage(directory,runner),running=service.reclaim(host,'codex',{signal:abort.signal});await entered;abort.abort();await assert.rejects(running);assert.equal(commits,0);waiting=false;await service.reclaim(host,'codex');assert.equal(commits,1);}finally{await rm(directory,{recursive:true,force:true});}
});

test('disposing storage aborts an in-flight request without committing incomplete native data',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-dispose-'));let entered!:()=>void,commits=0;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);
    if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[candidate('account')]});
    if(r.method==='retention/begin')return response({files:[entry]});
    if(r.method==='retention/read'){entered();await new Promise<void>((_resolve,reject)=>o?.signal?.addEventListener('abort',()=>reject(o.signal!.reason),{once:true}));}
    if(r.method==='retention/commit')commits++;
    throw Error('Unexpected fixture method '+r.method);
  };
  try{const service=new NativeSessionStorage(directory,runner),running=service.reclaim(host,'codex');await started;service.dispose();await assert.rejects(running);assert.equal(commits,0);await assert.rejects(service.reclaim(host,'codex'));}finally{await rm(directory,{recursive:true,force:true});}
});

test('corrupt verified local bytes never authorize remote deletion on retry',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-integrity-'));let commits=0;
  const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);
    if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[candidate('account')]});
    if(r.method==='retention/begin')return response({files:[entry]});
    if(r.method==='retention/read')return response({offset:r.offset,data:raw.toString('base64')});
    if(r.method==='retention/commit'){commits++;throw Error('Synthetic disconnect before deletion');}
    if(r.method==='retention/release')return response({});
    throw Error('Unexpected fixture method '+r.method);
  };
  try{await new NativeSessionStorage(directory,runner).reclaim(host,'codex').catch(()=>{});assert.equal(commits,1);const archive=(await readdir(directory))[0]!;await writeFile(path.join(directory,archive,'0'),Buffer.alloc(raw.length,42));await assert.rejects(new NativeSessionStorage(directory,runner).reclaim(host,'codex'));assert.equal(commits,1,'A previous verified flag cannot bypass current integrity checks.');}finally{await rm(directory,{recursive:true,force:true});}
});

test('a damaged unrelated local manifest is retained without blocking healthy remote sessions',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-retention-damaged-')),broken=path.join(directory,'f'.repeat(32));let commits=0;
  await mkdir(broken);await writeFile(path.join(broken,'manifest.json'),'{damaged');
  const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);
    if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[candidate('healthy')]});
    if(r.method==='retention/begin')return response({files:[entry]});
    if(r.method==='retention/read')return response({offset:r.offset,data:raw.toString('base64')});
    if(r.method==='retention/commit'){commits++;return response({reclaimedBytes:raw.length});}
    if(r.method==='retention/release')return response({});
    throw Error('Unexpected fixture method '+r.method);
  };
  try{await new NativeSessionStorage(directory,runner).reclaim(host,'codex').catch(()=>{});assert.equal(commits,1,'A damaged unrelated archive must not block all future reclamation.');assert.equal(await readFile(path.join(broken,'manifest.json'),'utf8'),'{damaged');}finally{await rm(directory,{recursive:true,force:true});}
});
