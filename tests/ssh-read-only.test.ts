import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readOnlySsh} from '../packages/ssh-transport/read-only';
import {SshTransportError,type SshRunner} from '../packages/ssh-transport';
import {discoverWorkspaces} from '../services/host-control';
import {RemoteAccountCatalogService} from '../packages/remote-account-catalog';
import type {SshHost} from '../packages/contracts';
const host:SshHost={id:'fixture',name:'Fixture',hostname:'fixture.invalid',port:22,username:'member',role:'workspace',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts'),ownerId:'fixture',workspaceGeneration:'1'};
const failed=(stderr='Connection timed out during banner exchange access_token=PRIVATE_SENTINEL')=>({exitCode:255,stdout:'',stderr,signal:null});
const ok={exitCode:0,stdout:'ok',stderr:'',signal:null};

test('SSH details retain actionable causes while redacting identity and credential values',async()=>{
 await assert.rejects(readOnlySsh(host,'read',{},async()=>failed('Connection refused on '+host.hostname+' for '+host.username+'; access_token=fixture-secret; agent socket unavailable')),error=>{
  assert.ok(error instanceof Error);assert.match(error.message,/SSH_REFUSED/);assert.match(error.message,/agent socket unavailable/);assert.doesNotMatch(error.message,/fixture-secret|fixture\.invalid|\bmember\b/);return true;
 });
});
test('read-only handshake recovery is bounded, uses the same identity and preserves the original deadline',async()=>{
 let calls=0;const budgets:number[]=[];const runner:SshRunner=async(h,c,o)=>{assert.equal(h,host);assert.equal(c,'read');budgets.push(o!.timeoutMs!);return ++calls===1?failed():ok;};
 assert.equal((await readOnlySsh(host,'read',{timeoutMs:1000},runner)).stdout,'ok');assert.equal(calls,2);assert.ok(budgets[1]!<budgets[0]!);
 calls=0;await assert.rejects(readOnlySsh(host,'read',{timeoutMs:1000},async()=>{calls++;return failed();}),e=>e instanceof Error&&e.message.includes('SSH_HANDSHAKE_TIMEOUT')&&!e.message.includes('PRIVATE_SENTINEL'));assert.equal(calls,2);
});
test('authentication, unknown post-command failure, cancellation and exhausted budget are never retried',async()=>{
 for(const diagnostic of ['Permission denied','Connection reset by peer','access_token=PRIVATE_SENTINEL']){let calls=0;await assert.rejects(readOnlySsh(host,'read',{},async()=>{calls++;return failed(diagnostic);}));assert.equal(calls,1);}
 let calls=0;await assert.rejects(readOnlySsh(host,'read',{timeoutMs:250},async()=>{calls++;return failed();}));assert.equal(calls,1);
 const abort=new AbortController();calls=0;await assert.rejects(readOnlySsh(host,'read',{signal:abort.signal},async()=>{calls++;abort.abort();return failed();}),/SSH_CANCELLED/);assert.equal(calls,1);
 await assert.rejects(readOnlySsh(host,'read',{signal:abort.signal},async()=>{calls++;return ok;}),/SSH_CANCELLED/);assert.equal(calls,1);
 await assert.rejects(readOnlySsh(host,'read',{},async()=>{throw new SshTransportError('TIMEOUT','access_token=PRIVATE_SENTINEL');}),e=>e instanceof Error&&e.message.includes('SSH_TIMEOUT')&&!e.message.includes('PRIVATE_SENTINEL'));
});
test('discovery and both providers expose safe SSH errors instead of claiming the broker is missing',async()=>{
 await assert.rejects(discoverWorkspaces(host,{runner:async()=>failed('Permission denied access_token=PRIVATE_SENTINEL')}),/SSH_AUTH_REJECTED/);
 for(const provider of ['claude','codex']){let calls=0;const service=new RemoteAccountCatalogService({runner:async()=>{calls++;return failed();}});const result=await service.list(host,'native-owner');assert.equal(result.availability,'unavailable',provider);assert.match(result.reason!,/SSH_HANDSHAKE_TIMEOUT/);assert.ok(!result.reason!.includes('PRIVATE_SENTINEL'));assert.equal(calls,2);await service.dispose();}
});
test('login and selection mutations never use the read-only handshake retry',async()=>{
 let writes=0;const service=new RemoteAccountCatalogService({runner:async(_h,_c,o)=>{const input=JSON.parse(o!.stdin!);if(input.method==='catalog/list')return {...ok,stdout:JSON.stringify({ok:true,value:{authorityId:'authority',generation:'g',revision:1,workspaceId:'workspace',selectionRevision:0,availability:'ready',accounts:[]}})};writes++;return failed();}});
 await assert.rejects(service.start(host),/无法确认远端任务/);assert.equal(writes,1);
 await assert.rejects(service.select(host,{accountId:'one',expectedRevision:0,authorityId:'authority',generation:'g'}));assert.equal(writes,2);await service.dispose();
});
