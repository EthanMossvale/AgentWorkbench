import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DataDirectoryService} from '../packages/app-data/service';
import {readDataLocation} from '../packages/app-data/relocation';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';

test('migration fences concurrent calls, rechecks work after flush, persists before restart and retains failures',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-directory-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'source'),locator=path.join(root,'location.json'),target=path.join(root,'target');await mkdir(directory);
 let busy=false,restarted=0,release!:()=>void;
 const service=new DataDirectoryService({directory,defaultDirectory:directory,locator,testOverride:false,busy:()=>busy,pick:async()=>target,flush:()=>new Promise<void>(r=>release=r),restart:()=>{assert.equal(readDataLocation(locator)?.pending,target);restarted++;}});
 const first=service.migrate(target);assert.equal(service.isChanging(),true);await assert.rejects(service.migrate(target),/TASKS_ACTIVE/);busy=true;release();await assert.rejects(first,/TASKS_ACTIVE/);assert.equal(service.isChanging(),false);assert.equal(restarted,0);
 busy=false;const second=service.migrate(target);release();await second;assert.equal(restarted,1);assert.equal(service.get().preferred,target);
});

test('approved ZIP calls and replaces the production directory consumer, disabling restores and reactivation works',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-directory-plugin-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'data'),target=path.join(root,'target'),locator=path.join(root,'locator.json');await mkdir(directory);
 let restarted=0;
 const service=new DataDirectoryService({directory,defaultDirectory:directory,locator,testOverride:false,busy:()=>false,pick:async()=>null,flush:async()=>{},restart:()=>{restarted++;}});
 const plugins=new PluginRegistry(directory);t.after(()=>plugins.dispose());await plugins.initialize();plugins.services.register('desktop.data-directory',service,{version:1});
 plugins.connectHost(async request=>request.method==='desktop/data-directory'?service.get():request.method==='desktop/data-directory/choose'?service.choose():service.migrate((request.payload as {target:string}).target));
 const zip=path.join(root,'plugin.zip');
 await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id:'qa.directory',name:'Directory fixture',version:'1.0.0',description:'Synthetic directory consumer',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(`export function activate(api){api.services.override('desktop.data-directory',{choose:async()=>${JSON.stringify(target)}});api.registerCommand('read',()=>api.call('desktop/data-directory',{}));api.registerCommand('move',()=>api.call('desktop/data-directory/migrate',{target:${JSON.stringify(target)}}));}`)}]));
 await plugins.importZip(zip);const record=(await plugins.list())[0]!;
 await plugins.setEnabled(record.manifest.id,record.hash,true,true);
 assert.equal(await service.choose(),target);assert.equal((await plugins.command('qa.directory','read',{}) as {directory:string}).directory,directory);
 await plugins.setEnabled(record.manifest.id,record.hash,false);assert.equal(await service.choose(),null);
 await plugins.setEnabled(record.manifest.id,record.hash,true,true);assert.equal(await service.choose(),target);await plugins.command('qa.directory','move',{});assert.equal(restarted,1);assert.equal(readDataLocation(locator)?.pending,target);
 await plugins.setEnabled(record.manifest.id,record.hash,false);assert.equal(await service.choose(),null);
});
