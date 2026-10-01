import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultAppearance, fontStack, normalizeFontCatalog, resolveAppearance, SYSTEM_FONT, updateAppearance, validateAppearancePatch } from '../packages/appearance';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';

test('legacy state resolves to separate UI, literary content and monospace defaults without mutating the source',()=>{
  assert.deepEqual(resolveAppearance(),defaultAppearance());
  assert.equal(defaultAppearance().contentFont,'claude');
  assert.match(fontStack('claude',SYSTEM_FONT),/Microsoft YaHei/);
  const legacy={version:1 as const,uiFont:'local:Arial' as const,codeSize:999,contentSize:18,revision:4};
  assert.equal(resolveAppearance(legacy).codeSize,13);assert.equal(resolveAppearance(legacy).contentSize,18);assert.equal(resolveAppearance(legacy).revision,4);assert.equal(legacy.codeSize,999);
});
test('font names support installed Unicode families and always quote local names',()=>{
  assert.equal(fontStack('local:思源宋体',SYSTEM_FONT),`"思源宋体", ${SYSTEM_FONT}`);
  assert.equal(fontStack('inherit',SYSTEM_FONT),SYSTEM_FONT);
  for(const uiFont of ['local:','local: Bad','local:Font; color:red','local:Font"','local:Font\n','inherit'])assert.throws(()=>validateAppearancePatch({uiFont}),/APPEARANCE_INVALID_FONT/);
  assert.deepEqual(validateAppearancePatch({contentFont:'inherit'}),{contentFont:'inherit'});
});
test('invalid sizes, colors, enum values and unknown keys are rejected rather than coerced',()=>{
  for(const patch of [{uiSize:10},{uiSize:19},{codeSize:NaN},{codeSize:12.5},{contentSize:'18'},{accent:'red'},{accent:'#fff'},{palette:{}},{uiSize:Infinity},{version:1},{revision:1},{constructor:'system'},{reducedMotion:true},null,[]])assert.throws(()=>validateAppearancePatch(patch),/APPEARANCE_INVALID/);
  assert.deepEqual(validateAppearancePatch({uiSize:18,contentSize:24,codeSize:22,accent:'#123aBC'}),{uiSize:18,contentSize:24,codeSize:22,accent:'#123aBC'});
});
test('font enumeration exposes unique family metadata and rejects malformed names',()=>{
  assert.deepEqual(normalizeFontCatalog(['Arial','Arial','思源宋体','bad;name',null]).families,['Arial','思源宋体'].sort((a,b)=>a.localeCompare(b)));
  assert.equal(normalizeFontCatalog({}).status,'unavailable');
});
test('reset increments the revision and stale writes cannot silently overwrite choices',()=>{
  const next=updateAppearance(undefined,0,{uiFont:'local:Arial',contentSize:18});
  assert.equal(next.revision,1);assert.throws(()=>updateAppearance(next,0,{uiSize:16}),/REVISION_CONFLICT/);
  assert.deepEqual(updateAppearance(next,1,{},true),{...defaultAppearance(),revision:2});
});
test('actual controller persists, broadcasts and reloads appearance without changing theme or native settings',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-appearance-')),store=new StateStore(directory);await store.load();
  const events:unknown[]=[];const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],listFonts:async()=>({status:'ready',families:['Arial','思源宋体']})},state=>events.push(state));
  try {
    const initial=store.snapshot();assert.deepEqual(await controller.call('appearance/get'),defaultAppearance());
    assert.deepEqual(await controller.call('appearance/fonts'),{status:'ready',families:['Arial','思源宋体']});
    assert.deepEqual(store.snapshot(),initial);
    await controller.call('appearance/set',{revision:0,patch:{uiFont:'local:Arial',contentFont:'inherit',uiSize:16,codeSize:17,accent:'#4477aa'}});
    assert.equal(events.length,1);assert.equal(store.snapshot().appearance?.revision,1);
    await assert.rejects(controller.call('appearance/set',{revision:0,patch:{uiSize:12}}),/REVISION_CONFLICT/);
    await assert.rejects(controller.call('appearance/set',{revision:1,patch:{uiSize:999}}),/INVALID_SIZE/);
    await assert.rejects(controller.call('appearance/set',{revision:1,reset:'true'}),/INVALID_PATCH/);
    assert.equal(events.length,1);
    const restarted=new StateStore(directory);await restarted.load();assert.deepEqual(restarted.snapshot().appearance,store.snapshot().appearance);
    assert.equal(restarted.snapshot().theme,initial.theme);assert.deepEqual(restarted.snapshot().sessions,initial.sessions);
    const writes=await Promise.allSettled([controller.call('appearance/set',{revision:1,patch:{uiSize:15}}),controller.call('appearance/set',{revision:1,patch:{uiSize:14}})]);
    assert.equal(writes.filter(result=>result.status==='fulfilled').length,1);assert.equal(store.snapshot().appearance?.revision,2);
    await controller.call('appearance/set',{revision:2,reset:true});assert.deepEqual(store.snapshot().appearance,{...defaultAppearance(),revision:3});
  } finally {await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
test('approved plugins call, subscribe to and replace appearance routes; disable restores core behavior',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-appearance-plugin-')),store=new StateStore(directory);await store.load();
  const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>{throw Error('No secrets');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],listFonts:async()=>({status:'ready',families:['Core font']})},state=>plugins.publish({type:'state',payload:state}));
  const core=(request:{method:string;payload:unknown})=>controller.call(request.method,request.payload);plugins.connectHost(core);
  try {
    const manifest={schemaVersion:1,apiVersion:1,id:'test.appearance',name:'Appearance test',version:'1.0.0',description:'Isolated appearance contract check',capabilities:['host'],main:'main.mjs'};
    const main=`export function activate(api){let revision=-1;api.onEvent(e=>{if(e.type==='state')revision=e.payload.appearance?.revision;});api.registerCommand('revision',()=>revision);api.registerCommand('save',async()=>{const current=await api.call('appearance/get');return api.call('appearance/set',{revision:current.revision,patch:{uiFont:'local:Arial'}});});api.registerMethod('appearance/fonts',()=>({status:'ready',families:['Plugin font']}));}`;
    const zip=path.join(directory,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)}]));await plugins.importZip(zip);const record=(await plugins.list())[0]!;
    await assert.rejects(plugins.setEnabled(record.manifest.id,record.hash,true),/Explicit approval/);await plugins.setEnabled(record.manifest.id,record.hash,true,true);
    await plugins.command(record.manifest.id,'save',null);await new Promise(resolve=>setImmediate(resolve));assert.equal(await plugins.command(record.manifest.id,'revision',null),1);assert.equal(store.snapshot().appearance?.uiFont,'local:Arial');
    assert.deepEqual(await plugins.dispatch({method:'appearance/fonts',payload:{}},core),{status:'ready',families:['Plugin font']});await plugins.disableAll();
    assert.deepEqual(await plugins.dispatch({method:'appearance/fonts',payload:{}},core),{status:'ready',families:['Core font']});assert.equal(store.snapshot().appearance?.uiFont,'local:Arial');
  } finally {await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
