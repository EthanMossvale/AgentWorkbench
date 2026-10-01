import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {RemoteCliService} from '../packages/remote-account-catalog/cli';
import {RemoteBrowserService,browserTunnelArgs,browserPayload} from '../packages/remote-account-catalog/browser';
import type {SshHost} from '../packages/contracts';
const host:SshHost={id:'admin-fixture',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',ownerId:'fixture',workspaceGeneration:'g',identityFile:path.resolve('fixture-key'),knownHostsFile:path.resolve('fixture-hosts')};
const response=(value:unknown)=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:true,value}),stderr:''});
const row=(provider='codex')=>({provider,installed:false,executable:'',managed:false,canUninstall:false,busy:false,revision:'a'.repeat(64),latest:'9.8.7',installations:[],detected:[]});
const plan=(provider='codex')=>({planId:'b'.repeat(64),provider,operation:'install',version:'9.8.7',currentVersion:null,targets:[`/opt/agent-workbench/native/${provider}-9.8.7-x86_64/${provider}`],download:{size:1}});

test('release errors preserve safe stage and HTTP status without blaming general VPS connectivity',async()=>{
 const issue={stage:'installer',source:'claude.ai',httpStatus:403,body:'PRIVATE_MUST_NOT_LEAK'};
 const s=new RemoteCliService(async()=>response([row(),{...row('claude'),latest:undefined,error:'CLI_RELEASE_HTTP',releaseIssue:issue}]));
 const rows=await s.list(host);
 assert.equal(rows[1]?.errorCode,'CLI_RELEASE_HTTP');
 assert.deepEqual(rows[1]?.releaseIssue,{stage:'installer',source:'claude.ai',httpStatus:403});
 assert.match(rows[1]!.error!,/安装脚本.*HTTP 403/);assert.doesNotMatch(JSON.stringify(rows),/检查 VPS 出网|PRIVATE_MUST_NOT_LEAK/);
 const failed=new RemoteCliService(async()=>({exitCode:0,signal:null,stdout:JSON.stringify({ok:false,error:'CLI_RELEASE_HTTP',releaseIssue:issue}),stderr:''}));
 await assert.rejects(failed.plan(host,'claude','install'),/安装脚本.*HTTP 403/);
});

test('release diagnostics validate their shape and retain legacy error compatibility',async()=>{
 for(const issue of [{stage:'installer',source:'evil.invalid',httpStatus:403},{stage:'private',source:'claude.ai',httpStatus:403},{stage:'installer',source:'claude.ai',httpStatus:'403'}]){
  const s=new RemoteCliService(async()=>response([{...row(),error:'CLI_RELEASE_HTTP',releaseIssue:issue},row('claude')]));
  const value=(await s.list(host))[0]!;assert.equal(value.releaseIssue,undefined);assert.doesNotMatch(value.error!,/evil|private|出网/);
 }
 const s=new RemoteCliService(async()=>response([{...row(),error:'CLI_RELEASE_UNAVAILABLE'},row('claude')]));
 assert.match((await s.list(host))[0]!.error!,/暂未核实/);
});
test('remote CLI plans require root, complete SSH identity, runtime match and one deliberate apply',async()=>{
 const calls:any[]=[];const s=new RemoteCliService(async(_h,_c,o)=>{const raw=o!.stdin!.match(/b64decode\('([^']+)'\)/)![1]!;const p=JSON.parse(Buffer.from(raw,'base64').toString());calls.push(p.request);assert.ok(p.sources['account_admin.py']);return response(p.request.method==='cli/plan'?plan():row());});
 await assert.rejects(s.plan({...host,role:'workspace'},'codex','install'));assert.equal(calls.length,0);
 const p=await s.plan(host,'codex','install');assert.equal(calls.length,1);
 await assert.rejects(s.apply({...host,identityFile:path.resolve('other')},p.id));await assert.rejects(s.apply(host,p.id,'claude'));assert.equal(calls.length,1);
 assert.equal((await s.apply(host,p.id,'codex')).provider,'codex');await assert.rejects(s.apply(host,p.id));assert.equal(calls.length,2);
});
test('failed maintenance consumes preview and never silently retries a write',async()=>{
 let writes=0;const s=new RemoteCliService(async(_h,_c,o)=>{const req=JSON.parse(Buffer.from(o!.stdin!.match(/b64decode\('([^']+)'\)/)![1]!,'base64').toString()).request;if(req.method==='cli/plan')return response(plan());writes++;throw Error('fixture lost response');});const p=await s.plan(host,'codex','install');await assert.rejects(s.apply(host,p.id));await assert.rejects(s.apply(host,p.id));assert.equal(writes,1);
});
test('profile operations validate identities and project only public labels',async()=>{
 const calls:any[]=[];const key='a'.repeat(32);const s=new RemoteBrowserService(async()=>{throw Error('Real browser forbidden in fixture');},async(_h,_c,o)=>{calls.push(JSON.parse(o!.stdin!).request);return response({installed:true,missing:[],profiles:[{key,label:'Fixture profile',available:true,cookies:'MUST_NOT_LEAK'}]});});
 await assert.rejects(s.profiles({...host,role:'workspace'}));await assert.rejects(s.profiles(host,'delete',{key}));await assert.rejects(s.profiles(host,'rename',{key:'../escape',label:'hello'}));assert.equal(calls.length,0);
 const v=await s.profiles(host,'create',{label:'Fixture profile'});assert.deepEqual(v.profiles,[{key,label:'Fixture profile',available:true}]);assert.ok(!JSON.stringify(v).includes('MUST_NOT_LEAK'));await s.profiles(host,'delete',{key,confirm:true});assert.equal(calls.length,2);
});
test('remote browser SSH tunnel is restricted to the known loopback viewer and strict SSH identity',()=>{
 const a=browserTunnelArgs(host,16422);assert.ok(a.includes('127.0.0.1:16422:127.0.0.1:6091'));assert.ok(a.includes('StrictHostKeyChecking=yes'));assert.ok(a.includes('IdentityAgent=none'));assert.ok(a.includes('ExitOnForwardFailure=yes'));assert.ok(!a.includes('ClearAllForwardings=yes'));assert.ok(a.includes('ClearAllForwardings=no'));assert.throws(()=>browserTunnelArgs(host,0));assert.equal(a.at(-1),'exec sleep 900');
});
test('browser payload keeps request data separate from executable source and includes setup dependencies',()=>{
 const r={action:'rename',key:'a'.repeat(32),label:'$(do-not-run)'};const p=JSON.parse(browserPayload(r));assert.deepEqual(p.request,r);assert.ok(p.sources['browser_setup.py']);assert.ok(p.sources['browser_api.py']);assert.ok(!p.sources['browser_api.py'].includes(r.label));
});
test('browser provisioning requires reviewed scope and rejects stale or foreign confirmations',async()=>{
 let calls=0;const s=new RemoteBrowserService(async()=>{},async(_h,_c,o)=>{calls++;const r=JSON.parse(o!.stdin!).request;return response(r.action==='setup-plan'?{planId:'c'.repeat(64),chromeVersion:'154.0.0.1',installChrome:true,archives:[{name:'noVNC-1.6.0',license:'MPL-2.0'}],packageTransaction:'fixture preview only'}:{configured:true});});
 const p=await s.setup(host);assert.ok('id' in p);if(!('id' in p))return;assert.equal(calls,1);await assert.rejects(s.setup({...host,port:23},p.id));assert.equal(calls,1);assert.deepEqual(await s.setup(host,p.id),{configured:true});await assert.rejects(s.setup(host,p.id));assert.equal(calls,2);
});

test('browser setup blocks parallel profile writes and login on the same endpoint',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let calls=0;
 const s=new RemoteBrowserService(async()=>{throw Error('Real browser forbidden');},async()=>{calls++;await gate;return response({planId:'c'.repeat(64),installChrome:false,archives:[],packageTransaction:'fixture'});});
 const pending=s.setup(host);assert.equal(s.busy(host),true);
 await assert.rejects(s.setup({...host,id:'another-record'}));
 await assert.rejects(s.profiles(host,'create',{label:'fixture'}));
 await assert.rejects(s.start(host,{} as any,'fixture','a'.repeat(32)));
 assert.equal(calls,1);release();await pending;assert.equal(s.busy(host),false);
});
