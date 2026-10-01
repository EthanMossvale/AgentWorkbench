import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {AccountUsageService,parseAccountUsage} from '../packages/account-usage';
import {USAGE_REMOTE} from '../packages/account-usage/remote';
import type {AccountCatalog,SshHost} from '../packages/contracts';
import type {SshRunner} from '../packages/ssh-transport';
const host:SshHost={id:'h',name:'admin',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-known'),ownerId:'owner',workspaceGeneration:'g'};
const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'authority',generation:'g',revision:0,selectionRevision:0,workspaceId:'administrator',accounts:[{id:'one',generation:'ag',provider:'codex',status:'authenticated',observedAt:new Date().toISOString()}]};
const usage=()=>({pools:{codex:{limitName:'Codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:1800000000},secondary:{usedPercent:53,windowDurationMins:10080,resetsAt:1800000001},credits:{unlimited:false,balance:'5.5'}}},resetCredits:{availableCount:2,credits:[{id:'card-one',resetType:'codexRateLimits',status:'available',title:'Reset credit',expiresAt:null}]}});
async function fixture(){const directory=await mkdtemp(path.join(os.tmpdir(),'usage-test-'));const calls:Record<string,any>[]=[];let mode='ok';const runner:SshRunner=async(_h,command,options)=>{assert.equal(command,'exec python3 -');const encoded=options!.stdin!.match(/base64\.b64decode\('([^']+)'\)/)![1]!;const cfg=JSON.parse(Buffer.from(encoded,'base64').toString());calls.push(cfg);if(mode==='timeout')throw Error('private upstream text');return {exitCode:0,signal:null,stderr:'',stdout:JSON.stringify(mode==='unsupported'?{ok:false,error:'UNSUPPORTED'}:{ok:true,value:cfg.action==='read'?usage():{outcome:mode.startsWith('receipt-')?mode.slice(8):'reset'}})};};const service=new AccountUsageService(directory,runner);return {directory,runner,calls,service,setMode:(m:string)=>mode=m,close:async()=>{await service.dispose();await rm(directory,{recursive:true,force:true});}};}
test('quota parser preserves native units and excludes unknown fields',()=>{
 const input=usage();const result=parseAccountUsage({...input,access_token:'secret'},'one');assert.equal(result.pools[0]?.primary?.usedPercent,25);assert.equal(result.pools[0]?.credits?.balance,'5.5');assert.equal(result.availableResetCount,2);assert.ok(!JSON.stringify(result).includes('secret'));
 assert.equal(parseAccountUsage({...input,pools:{bad:{primary:{usedPercent:-1}}}},'one').availability,'unsupported');assert.throws(()=>parseAccountUsage({pools:[],cards:[]},'one'));
});
test('reset credit counts do not invent missing details or make expired credits redeemable',()=>{
 const totals=parseAccountUsage({...usage(),resetCredits:{availableCount:3,credits:null}},'one');assert.equal(totals.resetDetailsKnown,false);assert.equal(totals.availableResetCount,3);assert.equal(totals.cards[0]?.creditId,undefined);assert.equal(totals.cards[0]?.count,3);
 const unavailable=parseAccountUsage({...usage(),resetCredits:null},'one');assert.equal(unavailable.cardsSupported,false);assert.equal(unavailable.availableResetCount,undefined);
 const expired=parseAccountUsage({...usage(),resetCredits:{availableCount:0,credits:[{id:'expired',resetType:'codexRateLimits',status:'available',expiresAt:1}]}},'one');assert.equal(expired.cards[0]?.available,false);
});
test('reading quota does not redeem; unsupported never becomes a zero balance',async()=>{const f=await fixture();try{const result=await f.service.read(host,catalog,'one');assert.equal(result.availability,'ready');assert.equal(f.calls.length,1);assert.equal(f.calls[0]?.action,'read');f.setMode('unsupported');const unsupported=await f.service.read(host,catalog,'one');assert.equal(unsupported.availability,'ready');assert.deepEqual(unsupported.pools,result.pools);assert.equal(unsupported.observedAt,result.observedAt);assert.match(unsupported.reason!,/保留/);await assert.rejects(f.service.prepare(host,catalog,'one','card-one'),/刷新额度/);}finally{await f.close();}});
test('reset confirmation needs fresh eligibility and administrator authority',async()=>{const f=await fixture();try{await assert.rejects(f.service.prepare(host,catalog,'one','card-one'),/刷新额度/);await f.service.read(host,catalog,'one');await assert.rejects(f.service.prepare({...host,role:'workspace',username:'member'},catalog,'one','card-one'),/管理员/);await assert.rejects(f.service.prepare(host,catalog,'one','wrong'),/刷新额度/);const plan=await f.service.prepare(host,catalog,'one','card-one');assert.equal(f.calls.length,1);const receipt=await f.service.redeem(host,catalog,plan.id);assert.equal(receipt.state,'redeemed');await f.service.redeem(host,catalog,plan.id);assert.equal(f.calls.length,2);}finally{await f.close();}});
test('uncertain reset survives restart and recovers using only the original request id',async()=>{const f=await fixture();try{await f.service.read(host,catalog,'one');const plan=await f.service.prepare(host,catalog,'one','card-one');f.setMode('timeout');assert.equal((await f.service.redeem(host,catalog,plan.id)).state,'uncertain');const resumed=new AccountUsageService(f.directory,f.runner);f.setMode('ok');const usage=await resumed.read(host,catalog,'one');assert.equal(usage.pendingReset?.id,plan.id);await assert.rejects(resumed.prepare(host,catalog,'one','card-one'),/原请求/);await assert.rejects(resumed.redeem({...host,workspaceGeneration:'changed'},catalog,plan.id),/连接已变化/);assert.equal((await resumed.redeem(host,catalog,plan.id)).state,'redeemed');const requests=f.calls.filter(c=>c.action==='redeem');assert.equal(requests.length,2);assert.deepEqual(requests.map(c=>c.requestId),[plan.id,plan.id]);await resumed.dispose();}finally{await f.close();}});
test('remote account adapter compiles and does not start model turns or select accounts',()=>{
 const result=spawnSync('python',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:USAGE_REMOTE,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.ok(!USAGE_REMOTE.includes("call('turn/start'"));assert.ok(!USAGE_REMOTE.includes("call('thread/start'"));assert.ok(!USAGE_REMOTE.slice(USAGE_REMOTE.indexOf('def account_rpc')).includes("{'method':'select'"));
});

test('native reset outcomes distinguish replay success and non-consumption',async()=>{for(const [outcome,state] of [['alreadyRedeemed','redeemed'],['nothingToReset','denied'],['noCredit','denied']] as const){const f=await fixture();try{await f.service.read(host,catalog,'one');const plan=await f.service.prepare(host,catalog,'one','card-one');f.setMode('receipt-'+outcome);const receipt=await f.service.redeem(host,catalog,plan.id);assert.equal(receipt.state,state);assert.equal(f.calls.filter(c=>c.action==='redeem').length,1);assert.equal(f.calls.at(-1)?.creditId,'card-one');}finally{await f.close();}}});

test('retired quota source is rejected before SSH rather than restoring credential mediation',async()=>{
 const f=await fixture();try{await assert.rejects(f.service.read(host,{...catalog,source:'existing-codex'},'one'),/原生账号接入/);assert.equal(f.calls.length,0);}finally{await f.close();}
});

test('an uncertain legacy reset keeps its native idempotency key and requires account alias verification',async()=>{
 const f=await fixture();try{
  await f.service.read(host,catalog,'one');const plan=await f.service.prepare(host,catalog,'one','card-one');f.setMode('timeout');await f.service.redeem(host,catalog,plan.id);
  const file=path.join(f.directory,'reset-receipts',plan.id+'.json'),saved=JSON.parse(await readFile(file,'utf8'));
  Object.assign(saved,{source:'existing-codex',authorityId:'old-authority',generation:'old-generation'});await writeFile(file,JSON.stringify(saved));
  const restored=new AccountUsageService(f.directory,f.runner);f.setMode('receipt-alreadyRedeemed');
  const usage=await restored.read(host,catalog,'one');assert.equal(usage.pendingReset?.id,plan.id);
  assert.equal((await restored.redeem(host,catalog,plan.id)).state,'redeemed');const last=f.calls.at(-1)!;
  assert.equal(last.requestId,plan.id);assert.equal(last.legacyAccountRef,'vps-account:old-authority/old-generation/codex/one/ag');assert.equal(last.source,'native-owner');await restored.dispose();
 }finally{await f.close();}
});

 test('quota survives service restart, cache reads avoid SSH and revisions refresh once',async()=>{
 const f=await fixture();try{const first=await f.service.read(host,catalog,'one',{refresh:false,revision:'a'});const restored=new AccountUsageService(f.directory,f.runner);
 assert.deepEqual((await restored.read(host,catalog,'one',{cacheOnly:true})).pools,first.pools);assert.equal(f.calls.length,1);
 await restored.read(host,catalog,'one',{refresh:false,revision:'a'});assert.equal(f.calls.length,1);
 await Promise.all([restored.read(host,catalog,'one',{refresh:false,revision:'b'}),restored.read(host,catalog,'one',{refresh:false,revision:'b'})]);assert.equal(f.calls.length,2);
 f.setMode('timeout');const failed=await restored.read(host,catalog,'one',{refresh:true});assert.equal(failed.availability,'ready');assert.match(failed.reason!,/保留/);
 const changed={...catalog,accounts:catalog.accounts.map(a=>({...a,generation:'new'}))};assert.equal((await restored.read(host,changed,'one',{cacheOnly:true})).pools.length,0);await restored.dispose();
 }finally{await f.close();}});
