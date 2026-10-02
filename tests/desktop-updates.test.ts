import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DesktopUpdates,desktopUpdatesEnabled,type DesktopUpdateBackend,type DesktopUpdateState} from '../packages/desktop-updates';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

test('only explicitly released Windows packages can consume the public update feed',async()=>{
 for(const distribution of [undefined,null,'local','release-typo',{},1]){
  const core=backend(),updates=new DesktopUpdates(()=>core.value,()=>false,desktopUpdatesEnabled({packaged:true,platform:'win32',testProfile:false,distribution}));
  updates.start();await updates.check();assert.equal(updates.snapshot().phase,'disabled');assert.equal(core.record.checks,0);await assert.rejects(updates.install(),/NOT_READY/);updates.dispose();
 }
 assert.equal(desktopUpdatesEnabled({packaged:true,platform:'win32',testProfile:false,distribution:'release'}),true);
 for(const override of [{packaged:false},{platform:'linux' as const},{testProfile:true}])assert.equal(desktopUpdatesEnabled({packaged:true,platform:'win32',testProfile:false,distribution:'release',...override}),false);
});

test('production updater observes cancelled downloads when disposal precedes the update response',async()=>{
 let updater!:EventEmitter,respond!:(value:unknown)=>void,rejectDownload!:(error:Error)=>void,cancelled=0;
 class NsisUpdater extends EventEmitter {
  constructor(){super();updater=this;}
  checkForUpdates(){return new Promise(resolve=>{respond=resolve;});}
 }
 const output=await build({entryPoints:['apps/desktop/host/desktop-updates.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['electron-updater']}),module={exports:{} as {createDesktopUpdateBackend:()=>DesktopUpdateBackend}};
 runInNewContext(output.outputFiles[0]!.text,{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'electron-updater');return {NsisUpdater};}});
 const backend=module.exports.createDesktopUpdateBackend(),events:DesktopUpdateState[]=[];backend.subscribe(value=>events.push(value));
 const pending=backend.check(),late=updater.listeners('download-progress')[0]!;backend.dispose();late({percent:90});
 const downloadPromise=new Promise<void>((_resolve,reject)=>{rejectDownload=reject;});
 respond({downloadPromise,cancellationToken:{cancel(){cancelled++;rejectDownload(Error('cancelled'));}}});
 await pending;await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);assert.deepEqual(events,[]);
});

function backend(){let listener=(state:DesktopUpdateState)=>{};const record={checks:0,installs:0,disposed:0};const value:DesktopUpdateBackend={async check(){record.checks++;listener({phase:'ready',version:'0.1.2',percent:100});},async install(){record.installs++;},subscribe(fn){listener=fn;return()=>{listener=()=>{};};},dispose(){record.disposed++;}};return {record,value,emit:(state:DesktopUpdateState)=>listener(state)};}
test('failed backend subscription preserves the running checker and disposes the failed replacement',async()=>{
 const core=backend(),bad=backend(),updates=new DesktopUpdates(()=>core.value,()=>false,true);updates.start();await updates.check();
 bad.value.subscribe=()=>{throw Error('subscription failure');};
 assert.throws(()=>updates.register({id:'plugin:qa.bad/source',create:()=>bad.value}),/subscription failure/);
 assert.equal(core.record.disposed,0);assert.equal(bad.record.disposed,1);core.emit({phase:'idle'});await updates.check();assert.equal(core.record.checks,2);assert.equal(updates.snapshot().phase,'ready');updates.dispose();
});
test('pre-start registration participates in auto-check and replacement is not blocked by a stale request',async()=>{
 const core=backend(),first=backend(),next=backend(),updates=new DesktopUpdates(()=>core.value,()=>false,true);let resolve!:()=>void;first.value.check=()=>new Promise<void>(r=>{resolve=r;});updates.register({id:'plugin:qa.first/source',create:()=>first.value});updates.start();updates.register({id:'plugin:qa.next/source',create:()=>next.value});await updates.check();assert.equal(next.record.checks,1);resolve();await Promise.resolve();assert.equal(updates.snapshot().phase,'ready');updates.dispose();
});
test('development builds never check or install; packaged updates wait for explicit install and idle tasks',async()=>{
 const dev=backend(),disabled=new DesktopUpdates(()=>dev.value,()=>false,false);disabled.start();await disabled.check();assert.equal(dev.record.checks,0);await assert.rejects(disabled.install(),/NOT_READY/);disabled.dispose();
 const real=backend();let busy=true;const updates=new DesktopUpdates(()=>real.value,()=>busy,true);updates.start();await updates.check();assert.equal(updates.snapshot().phase,'ready');assert.equal(real.record.installs,0);await assert.rejects(updates.install(),/SESSION_BUSY/);busy=false;await updates.install();assert.equal(real.record.installs,1);await assert.rejects(updates.install(),/NOT_READY/);updates.dispose();
});
test('registered backends drive actual checks, restore on non-LIFO disposal and ignore obsolete events',async()=>{
 const core=backend(),a=backend(),b=backend(),updates=new DesktopUpdates(()=>core.value,()=>false,true);updates.start();await updates.check();const offA=updates.register({id:'plugin:qa.a/source',create:()=>a.value});await updates.check();assert.equal(a.record.checks,1);
 const offB=updates.register({id:'plugin:qa.b/source',create:()=>b.value});offA();await updates.check();assert.equal(b.record.checks,1);a.emit({phase:'error'});assert.equal(updates.snapshot().phase,'ready');offB();assert.equal(updates.snapshot().phase,'idle');await updates.check();assert.equal(core.record.checks,2);
 assert.throws(()=>updates.register({id:'plugin:qa.bad/source',create:()=>{throw Error('factory failure');}}),/factory failure/);assert.equal(updates.snapshot().phase,'ready');updates.dispose();assert.throws(()=>updates.register({id:'plugin:qa.c/source',create:()=>a.value}),/REGISTRATION_INVALID/);
});
test('approved ZIP registration reaches checker and installer; disable, reenable and failed activation restore core',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'awb-updates-')),plugins=new PluginRegistry(path.join(directory,'profile')),core=backend(),updates=new DesktopUpdates(()=>core.value,()=>false,true);
 plugins.services.register('desktop.updates',updates,{version:1});plugins.connectHost(async request=>{if(request.method==='desktop-updates/status')return updates.snapshot();if(request.method==='desktop-updates/check')return updates.check();throw Error('unsupported');});await plugins.initialize();updates.start();await updates.check();
 const fixture=async(id:string,fail=false)=>{const file=path.join(directory,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Synthetic update backend',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(`export function activate(api){const service=api.services.get('desktop.updates');api.onDispose(service.register({id:'plugin:'+api.id+'/source',create(){let emit=()=>{};return {subscribe(fn){emit=fn;return()=>{emit=()=>{}}},async check(){emit({phase:'ready',version:'9.0.0'})},async install(){emit({phase:'idle'})},dispose(){}}}}));${fail?"throw Error('Synthetic failure');":''}}`)}]));await plugins.importZip(file);return (await plugins.list()).find(p=>p.manifest.id===id)!;};
 try{const entry=await fixture('qa.updates');await assert.rejects(plugins.setEnabled(entry.manifest.id,entry.hash,true),/Explicit approval/);await plugins.setEnabled(entry.manifest.id,entry.hash,true,true);await updates.check();assert.equal(updates.snapshot().version,'9.0.0');await updates.install();assert.equal(updates.snapshot().phase,'idle');await plugins.setEnabled(entry.manifest.id,entry.hash,false);assert.equal(updates.snapshot().phase,'idle');await updates.check();assert.equal(updates.snapshot().version,'0.1.2');await plugins.setEnabled(entry.manifest.id,entry.hash,true);await updates.check();assert.equal(updates.snapshot().version,'9.0.0');await plugins.disableAll();const failed=await fixture('qa.failed',true);await plugins.setEnabled(failed.manifest.id,failed.hash,true,true);await updates.check();assert.equal(updates.snapshot().version,'0.1.2');}finally{updates.dispose();await plugins.dispose();await rm(directory,{recursive:true,force:true});}
});
