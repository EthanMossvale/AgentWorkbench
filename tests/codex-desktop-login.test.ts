import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,access,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startCodexDesktopLogin,detectCodexDesktop} from '../packages/model-management/codex-desktop';
import type {LocalModelAccount} from '../packages/model-management/types';

const account:LocalModelAccount={id:'11111111-1111-4111-a111-111111111111',revision:'r',provider:'codex',name:'Synthetic',status:'signed-out',models:[],enabled:true};
test('desktop is unavailable without an official registered installation',async()=>{
 assert.equal(await detectCodexDesktop({},async()=>''),undefined);
 await assert.rejects(startCodexDesktopLogin(account,'unused',{},()=>{},{detect:async()=>undefined}),/DESKTOP_MISSING/);
});
test('desktop launch owns isolated paths, strips provider environment and cleans only its process',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-desktop-login-')),home=path.join(dir,'codex');await mkdir(home);t.after(()=>rm(dir,{recursive:true,force:true}));
 const commands:string[]=[],installation={executable:path.join(dir,'Codex.exe'),packageFamily:'OpenAI.Codex_synthetic',appId:'Codex'};
 const run=async(spec:any,opts:any)=>{const script=spec.args.at(-1) as string;commands.push(script);if(script.includes('Invoke-CommandInDesktopPackage')){assert.ok(script.includes('-PreventBreakaway'));const encoded=script.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)![1]!,inner=Buffer.from(encoded,'base64').toString('utf16le');assert.ok(inner.includes('$env:CODEX_HOME='));assert.ok(inner.includes('CODEX_ELECTRON_USER_DATA_PATH'));assert.ok(inner.includes('--user-data-dir='));assert.ok(inner.includes('Remove-Item'));await writeFile(path.join(opts.cwd,'owned-process.json'),JSON.stringify({pid:123456}));}return 'running';};
 const handle=await startCodexDesktopLogin(account,home,{},()=>{},{detect:async()=>installation,run,pollMs:60000});assert.equal(handle.job.status,'waiting');assert.equal((await readdir(dir)).filter(v=>v.startsWith('desktop-login-')).length,1);await handle.cancel();assert.equal(handle.job.status,'cancelled');assert.ok(commands.some(v=>v.includes('ExecutablePath')&&v.includes('CommandLine')&&v.includes('123456')));assert.equal((await readdir(dir)).filter(v=>v.startsWith('desktop-login-')).length,0);assert.ok((await access(path.join(home,'config.toml')))===undefined);
});
test('desktop refuses to claim cancellation if owned process cleanup cannot be confirmed',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-desktop-cleanup-')),home=path.join(dir,'codex');await mkdir(home);t.after(()=>rm(dir,{recursive:true,force:true}));
 const run=async(spec:any,opts:any)=>{const s=spec.args.at(-1) as string;if(s.includes('Invoke-CommandInDesktopPackage'))await writeFile(path.join(opts.cwd,'owned-process.json'),JSON.stringify({pid:123456}));if(s.includes('taskkill'))throw Error('synthetic ownership conflict');return '';};
 const handle=await startCodexDesktopLogin(account,home,{},()=>{},{detect:async()=>({executable:path.join(dir,'Codex.exe'),packageFamily:'OpenAI.Codex_synthetic',appId:'Codex'}),run,pollMs:60000});await assert.rejects(handle.cancel(),/CLEANUP_FAILED/);assert.equal(handle.job.status,'failed');
});
