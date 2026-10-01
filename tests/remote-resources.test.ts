import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {RemoteResourceService} from '../packages/remote-account-catalog/resources';
import {RemoteCliService} from '../packages/remote-account-catalog/cli';
import {NativeSessionStorage} from '../packages/remote-account-catalog/session-storage';
import type {SshHost,Session} from '../packages/contracts';
import type {SshRunner} from '../packages/ssh-transport';
const host:SshHost={id:'fixture',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'generation'};
const response=(value:any)=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:true,value}),stderr:''});
const request=(options:any)=>JSON.parse(Buffer.from(options.stdin.match(/b64decode\('([^']+)'\)/)[1],'base64').toString()).request;

test('remote resources and files enforce administrator scope and never remap local paths',async()=>{
 const calls:any[]=[];const service=new RemoteResourceService(async(h,c,o)=>{calls.push(request(o));return response({path:'/fixture',parent:'/',revision:'a'.repeat(64),kind:'text',content:'hello'});});
 await assert.rejects(service.read({...host,role:'workspace'}));assert.equal(calls.length,0);
 await assert.rejects(service.browse(host,'C:\\fixture'));await assert.rejects(service.browse(host,'/safe/../etc'));assert.equal(calls.length,0);
 assert.equal((await service.browse(host,'/fixture')).content,'hello');assert.equal(calls[0].method,'remote-files/browse');
 await assert.rejects(service.mutate(host,'remove',{path:'/fixture',revision:'a'.repeat(64)}));assert.equal(calls.length,1);
 await service.mutate(host,'write',{path:'/fixture',revision:'a'.repeat(64),content:'native path kept'});assert.equal(calls[1].path,'/fixture');
});

test('remote CLI settings persist separate switches using revision readback',async()=>{
 const rows:any={codex:{revision:0,autoUpdate:false,reclaimIdle:false,idleHours:24},claude:{revision:0,autoUpdate:false,reclaimIdle:false,idleHours:24}};let calls=0;
 const service=new RemoteCliService(async(_h,_c,o)=>{calls++;const r=request(o);assert.equal(r.method,'cli/configure');if(r.revision!==rows[r.provider].revision)return {...response(null),stdout:JSON.stringify({ok:false,error:'CLI_POLICY_CHANGED'})};return response(rows[r.provider]={...rows[r.provider],...r.changes,revision:r.revision+1});});
 const first=await service.configure(host,'codex',0,{reclaimIdle:true});assert.equal(first.reclaimIdle,true);assert.equal(rows.claude.reclaimIdle,false);await assert.rejects(service.configure(host,'codex',0,{autoUpdate:true}));assert.equal(rows.codex.autoUpdate,false);assert.equal(calls,2);
 await assert.rejects(service.configure(host,'claude',0,{unsupported:true} as any));assert.equal(calls,2);
});

for(const provider of ['codex','claude'] as const)test(`${provider} native history is locally verified before remote deletion and restored byte for byte`,async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-native-archive-'));const raw=Buffer.from('{"native":"fixture context and children"}\n'.repeat(15000));let deleted=false,restored=false;const uploads:Buffer[]=[];const methods:string[]=[];
 const entry={path:provider==='codex'?'sessions/2026/01/rollout-fixture.jsonl':'projects/fixture/session/subagents/agent-fixture.jsonl',sha256:createHash('sha256').update(raw).digest('hex'),size:raw.length,mode:384,mtime:1700000000,delete:true};
 const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);methods.push(r.method);
  if(r.method==='retention/candidates')return response({authorityId:'authority',generation:'generation',candidates:[{accountId:'account',accountGeneration:'ag',sessions:['session']}]});
  if(r.method==='retention/begin')return response({files:[entry]});
  if(r.method==='retention/read')return response({offset:r.offset,data:raw.subarray(r.offset,r.offset+256*1024).toString('base64')});
  if(r.method==='retention/commit'){const folder=path.join(directory,(await readdir(directory))[0]!);assert.deepEqual(await readFile(path.join(folder,'0')),raw);assert.equal(JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8')).status,'verified');deleted=true;return response({reclaimedBytes:raw.length});}
  if(r.method==='retention/write'){uploads.push(Buffer.from(r.data,'base64'));return response({complete:true});}
  if(r.method==='retention/restored'){assert.deepEqual(Buffer.concat(uploads),raw);restored=true;return response({});}
  if(r.method==='retention/release')return response({});throw Error('Unexpected method '+r.method);
 };
 try{const service=new NativeSessionStorage(directory,runner);await service.reclaim(host,provider);assert.ok(deleted);assert.equal((await service.status(host)).archives,1);
  const session={id:'session',binding:{accountRef:`vps-account:authority/generation/${provider}/account/ag`}} as Session;
  await assert.rejects(service.restoreFor(undefined,session),/管理员连接/);await service.restoreFor(host,session);assert.ok(restored);assert.equal((await service.status(host)).archives,0);assert.equal(methods.filter(m=>m==='retention/commit').length,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('failed native archive verification never asks the remote to delete originals',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-archive-failure-'));const methods:string[]=[];
 const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);methods.push(r.method);if(r.method==='retention/candidates')return response({authorityId:'a',generation:'g',candidates:[{accountId:'account',accountGeneration:'ag',sessions:['s']}]});if(r.method==='retention/begin')return response({files:[{path:'sessions/fixture.jsonl',sha256:'0'.repeat(64),size:3,mode:384,mtime:1700000000,delete:true}]});if(r.method==='retention/read')return response({offset:0,data:Buffer.from('bad').toString('base64')});return response({});};
 try{const service=new NativeSessionStorage(directory,runner);await assert.rejects(service.reclaim(host,'codex'),/校验/);assert.ok(!methods.includes('retention/commit'));assert.ok(methods.includes('retention/release'));assert.equal((await readdir(directory)).filter(name=>/^[a-f0-9]{32}$/.test(name)).length,1);}finally{await rm(directory,{recursive:true,force:true});}
});

test('a corrupted local archive blocks restore before any remote write',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-archive-corrupt-'));let writes=0;
 const runner:SshRunner=async(_h,_c,o)=>{const r=request(o);if(r.method==='retention/candidates')return response({authorityId:'a',generation:'g',candidates:[{accountId:'account',accountGeneration:'ag',sessions:['s']}]});if(r.method==='retention/begin')return response({files:[{path:'sessions/fixture.jsonl',sha256:createHash('sha256').update('ok').digest('hex'),size:2,mode:384,mtime:1700000000,delete:true}]});if(r.method==='retention/read')return response({offset:0,data:Buffer.from('ok').toString('base64')});if(r.method==='retention/commit')return response({reclaimedBytes:2});if(r.method==='retention/write')writes++;return response({});};
 try{const service=new NativeSessionStorage(directory,runner);await service.reclaim(host,'codex');await writeFile(path.join(directory,(await readdir(directory))[0]!,'0'),'no');await assert.rejects(service.restoreFor(host,{id:'s',binding:{accountRef:'vps-account:a/g/codex/account/ag'}} as Session),/校验/);assert.equal(writes,0);}finally{await rm(directory,{recursive:true,force:true});}
});
