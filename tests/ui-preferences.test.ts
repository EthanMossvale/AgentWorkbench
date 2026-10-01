import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {UiPreferenceStore} from '../packages/ui-preferences/store';
import {UiPreferenceRegistry,preferenceKey,coreUiPreferences,type UiPreferenceSnapshot,type UiPreferenceChange} from '../packages/ui-preferences';
import {fitWindow} from '../packages/ui-preferences/window';
import {UiPreferenceClient} from '../apps/desktop/renderer/ui-preferences';
import type {WorkbenchApi} from '../packages/contracts';

async function fixture(t:test.TestContext){const directory=await mkdtemp(path.join(os.tmpdir(),'awb-ui-prefs-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new UiPreferenceStore(directory);await store.load();return {store,directory};}
test('fresh profile uses product defaults and restart restores only explicit local choices',async t=>{
  const {store,directory}=await fixture(t);assert.equal(store.get('sidebar.width').value,240);assert.deepEqual(store.get('window.bounds').value,{width:1440,height:940});assert.equal(store.snapshot().revision,0);
  await store.set('sidebar.width',338);await store.set('workspace.split',62);const reopened=new UiPreferenceStore(directory);await reopened.load();assert.equal(reopened.get('sidebar.width').value,338);assert.equal(reopened.get('workspace.split').value,62);
  const clean=new UiPreferenceRegistry();assert.equal(clean.resolve('sidebar.width',undefined),240);assert.equal(clean.resolve('workspace.split',undefined),53);
});
test('per-key revisions reject stale writes without conflicting across independent controls',async t=>{
  const {store}=await fixture(t);await store.update({id:'sidebar.width',value:300,revision:0});await store.update({id:'workspace.split',value:65,revision:0});
  await assert.rejects(store.update({id:'sidebar.width',value:310,revision:0}),/CONFLICT/);assert.equal(store.get('sidebar.width').value,300);
  const revision=store.get('sidebar.width').revision;await store.update({id:'sidebar.width',revision,reset:true});assert.equal(store.get('sidebar.width').value,240);assert.equal(store.get('sidebar.width').saved,false);
  await assert.rejects(store.update({id:'sidebar.width',value:320,revision}),/CONFLICT/);
});
test('corrupt and future preference files remain byte-for-byte intact and writes fail visibly',async t=>{
  const {store,directory}=await fixture(t);for(const contents of ['{broken',JSON.stringify({schemaVersion:2,revision:1,entries:{}})]){
    await writeFile(path.join(directory,'ui-preferences.json'),contents);assert.equal((await store.load()).error,'UI_PREFERENCE_READ_FAILED');await assert.rejects(store.set('sidebar.width',320),/READ_FAILED/);assert.equal(await readFile(path.join(directory,'ui-preferences.json'),'utf8'),contents);
  }
});
test('invalid persisted values fall back without erasing recoverable raw data',async t=>{
  const {store,directory}=await fixture(t);const value:UiPreferenceSnapshot={schemaVersion:1,revision:1,entries:{[preferenceKey('workspace.split')]:{revision:1,value:'old-shape'}}};
  await writeFile(path.join(directory,'ui-preferences.json'),JSON.stringify(value));await store.load();assert.equal(store.get('workspace.split').value,53);assert.equal(store.snapshot().entries[preferenceKey('workspace.split')]?.value,'old-shape');
});
test('scope identities remain independent and hostile keys or out-of-range geometry are rejected',async t=>{
  const {store}=await fixture(t);await store.set('disclosure.open',true,'session-one');assert.equal(store.get('disclosure.open','session-two').value,false);
  for(const change of [{id:'sidebar.width',value:NaN},{id:'sidebar.width',value:900},{id:'window.bounds',value:{width:-1,height:900}},{id:'connections.panes',value:{navigationRatio:'x'}}] as UiPreferenceChange[])await assert.rejects(store.update({...change,revision:0}));
  assert.throws(()=>preferenceKey('__proto__'));await assert.rejects(store.update({id:'unknown.key',value:3,revision:0}),/UNREGISTERED/);
});
test('plugin registrations, ordered replacement, non-LIFO cleanup and missing plugins preserve raw choices',async t=>{
  const {store,directory}=await fixture(t),registry=new UiPreferenceRegistry();const handle=registry.register('qa.preferences',{id:'density',type:'number',defaultValue:2,min:1,max:8});
  await store.set(handle.id,5);assert.equal(registry.resolve(handle.id,5),5);const first=registry.override('qa.first','workspace.split',value=>(value as number)+2),second=registry.override('qa.second','workspace.split',value=>(value as number)+3);
  assert.equal(registry.resolve('workspace.split',53),58);first.dispose();assert.equal(registry.resolve('workspace.split',53),56);second.dispose();assert.equal(registry.resolve('workspace.split',53),53);
  handle.dispose();assert.throws(()=>registry.definition(handle.id),/UNREGISTERED/);const reopened=new UiPreferenceStore(directory);await reopened.load();assert.equal(reopened.snapshot().entries[preferenceKey(handle.id)]?.value,5);
  registry.register('qa.preferences',{id:'density',type:'number',defaultValue:2});assert.equal(registry.resolve(handle.id,5),5);
  assert.throws(()=>registry.register('qa.preferences',{id:'density',type:'number',defaultValue:2}),/DUPLICATE/);
  assert.throws(()=>registry.register('qa.preferences',{id:'bad',type:'number',defaultValue:2,min:10,max:1}),/INVALID/);
});
test('failed override values fall back and never rewrite user data',()=>{
  const registry=new UiPreferenceRegistry();const a=registry.override('qa.bad','workspace.split',()=>999);assert.equal(registry.resolve('workspace.split',60),60);a.dispose();
  const b=registry.override('qa.throw','workspace.split',()=>{throw Error('fixture');});assert.equal(registry.resolve('workspace.split',60),60);b.dispose();
});
test('effective fitting survives missing monitors and small work areas without mutating preferences',()=>{
  const preferred={x:2500,y:100,width:1440,height:940},copy=structuredClone(preferred);
  assert.deepEqual(fitWindow(preferred,[{x:0,y:0,width:800,height:600}]),{x:0,y:0,width:800,height:600});assert.deepEqual(preferred,copy);
  assert.deepEqual(fitWindow(preferred,[{x:0,y:0,width:1920,height:1080},{x:1920,y:0,width:2560,height:1440}]),preferred);
  const negative=fitWindow({x:-1600,y:20,width:1000,height:800},[{x:-1920,y:0,width:1920,height:1080}]);assert.equal(negative.x,-1600);
});
test('renderer client hydrates, coalesces drag changes, broadcasts and flushes before shutdown',async t=>{
  const {store,directory}=await fixture(t);let listener:(event:unknown)=>void=()=>{},writes=0;
  store.subscribe(snapshot=>listener({type:'plugin',id:'workbench.ui-preferences',topic:'changed',payload:snapshot}));
  const bridge={onPluginEvent:(fn:typeof listener)=>{listener=fn;return()=>{};},call:async(method:string,payload:unknown)=>{if(method==='ui-preferences/get')return store.snapshot();if(method==='ui-preferences/update'){writes++;return store.update(payload as never);}return null;}} as unknown as WorkbenchApi;
  const client=new UiPreferenceClient();await client.initialize(bridge);for(let value=300;value<=380;value++)client.change('sidebar.width',value);await client.flush();assert.equal(client.get('sidebar.width').value,380);assert.ok(writes<5);
  const reopened=new UiPreferenceStore(directory);await reopened.load();assert.equal(reopened.get('sidebar.width').value,380);
  await assert.rejects(client.set('sidebar.width',330,0),/CONFLICT/);assert.equal(client.get('sidebar.width').value,380);assert.equal(client.error,'UI_PREFERENCE_CONFLICT');
});
test('public core catalog defaults are all valid and names are unique',()=>{
  const registry=new UiPreferenceRegistry();assert.equal(new Set(coreUiPreferences.map(d=>d.id)).size,coreUiPreferences.length);for(const definition of coreUiPreferences)assert.deepEqual(registry.validate(definition.id,definition.defaultValue),definition.defaultValue);
});
test('a queued old core adjustment cannot rebase over a newer external preference',async t=>{
  const {store}=await fixture(t);let listener:(event:unknown)=>void=()=>{},release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});let first=true;
  store.subscribe(snapshot=>listener({type:'plugin',id:'workbench.ui-preferences',topic:'changed',payload:snapshot}));
  const bridge={onPluginEvent:(fn:typeof listener)=>{listener=fn;return()=>{};},call:async(method:string,payload:unknown)=>{if(method==='ui-preferences/get')return store.snapshot();if(first){first=false;await gate;}return store.update(payload as never);}} as unknown as WorkbenchApi;
  const client=new UiPreferenceClient();await client.initialize(bridge);client.change('sidebar.compact',true);await new Promise(resolve=>setTimeout(resolve,0));client.change('workspace.split',61);
  await store.set('workspace.split',72);release();await client.flush();assert.equal(client.get('workspace.split').value,72);assert.equal(client.error,'UI_PREFERENCE_CONFLICT');
});
