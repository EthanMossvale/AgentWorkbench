import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { PluginStorageStore } from '../packages/plugins-core/storage';
import { PluginRegistry } from '../packages/plugins-core';
import type { PluginDataSnapshot } from '../packages/plugins-core/storage-types';
import { encodeZip, collectDirectory } from '../packages/native-resources/archive';

async function directory(t:test.TestContext) { const dir=await mkdtemp(path.join(os.tmpdir(),'awb-plugin-data-')); t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:5})); return dir; }

test('plugin data survives restart, stays isolated by id, and returns cloned snapshots',async t=>{
  const dir=await directory(t),store=new PluginStorageStore(dir),events:unknown[]=[];
  const first=store.scope('test.first',()=>{},value=>events.push(value));
  assert.deepEqual(await first.read(),{revision:null,values:{}});
  const next=await first.write(null,{theme:'blue',nested:{list:[null,1,true]}});
  next.values.theme='mutated';
  const fresh=await new PluginStorageStore(dir).scope('test.first',()=>{},()=>{}).read();
  assert.equal(fresh.values.theme,'blue');assert.equal(events.length,1);
  assert.deepEqual(await store.scope('test.other',()=>{},()=>{}).read(),{revision:null,values:{}});
  const removed=await first.write(fresh.revision,{});assert.deepEqual(removed.values,{});assert.notEqual(removed.revision,fresh.revision);
});

test('concurrent host and renderer writes use the same CAS queue and preserve the winner',async t=>{
  const store=new PluginStorageStore(await directory(t));
  const a=store.scope('test.shared',()=>{},()=>{}),b=store.scope('test.shared',()=>{},()=>{});
  const result=await Promise.allSettled([a.write(null,{count:1}),b.write(null,{count:2})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.match(String((result.find(r=>r.status==='rejected') as PromiseRejectedResult).reason),/CONFLICT/);
  assert.equal((await b.read()).values.count,1);
});

test('queued writes clone their input and recheck revocation before replacing disk content',async t=>{
  const store=new PluginStorageStore(await directory(t));let active=true,checks=0,gate:Promise<void>|undefined;
  const api=store.scope('test.fence',async()=>{if(!active)throw Error('REVOKED');checks++;if(gate)await gate;},()=>{});
  const initial=await api.write(null,{value:'initial'});
  let resume!:()=>void;gate=new Promise<void>(resolve=>resume=resolve);const values={value:'submitted'};
  const pending=api.write(initial.revision,values);values.value='mutated';resume();gate=undefined;
  assert.equal((await pending).values.value,'submitted');
  const current=await api.read();checks=0;
  const guarded=store.scope('test.fence',()=>{if(++checks===3)throw Error('REVOKED');},()=>{});
  await assert.rejects(guarded.write(current.revision,{value:'denied'}),/REVOKED/);
  assert.equal((await api.read()).values.value,'submitted');active=false;await assert.rejects(api.read(),/REVOKED/);
});

test('storage accepts large JSON and preserves invalid or corrupt data',async t=>{
  const dir=await directory(t),store=new PluginStorageStore(dir),api=store.scope('test.valid',()=>{},()=>{});
  for(const id of ['../escape','/outside','bad\\path'])assert.throws(()=>store.scope(id,()=>{},()=>{}),/INVALID_ID/);
  const cyclic:any={};cyclic.self=cyclic;
  for(const value of [{bad:undefined},{bad:NaN},{bad:new Date()},cyclic,{bad:new Array(2)}])assert.throws(()=>api.write(null,value),/INVALID/);
  const large=await api.write(null,{text:'x'.repeat(5*1024*1024)});assert.equal((await api.read()).revision,large.revision);
  const saved=await api.write(large.revision,{valid:true}),file=path.join(dir,'plugin-data/plugin-test.valid.json');
  await writeFile(file,'{"broken"');await assert.rejects(api.read());await assert.rejects(api.write(saved.revision,{}));assert.equal(await readFile(file,'utf8'),'{"broken"');
});

test('observer failures cannot turn a committed write into a reported failure',async t=>{
  const api=new PluginStorageStore(await directory(t)).scope('test.event',()=>{},()=>{throw Error('observer');});
  const saved=await api.write(null,{ok:true});assert.deepEqual(await api.read(),saved);
});

test('approved host and renderer share data; disable and changed packages revoke access; export excludes data',async t=>{
  const dir=await directory(t),registry=new PluginRegistry(dir);await registry.initialize();t.after(()=>registry.dispose());
  const id='test.data',main="export function activate(api) { api.registerCommand('read',()=>api.storage.read()); api.registerCommand('save',p=>api.storage.write(p.revision,p.values)); }";
  const manifest={schemaVersion:1,apiVersion:1,id,name:'Data',description:'Test',version:'1.0.0',capabilities:['host'],main:'main.mjs',renderer:'renderer.mjs'};
  const zip=path.join(dir,'fixture.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(main)},{name:'renderer.mjs',data:Buffer.from('export function activate() {}')} ]));
  await registry.importZip(zip);let record=(await registry.list())[0]!;
  await assert.rejects(registry.readStorage(id,record.hash),/UNAVAILABLE/);
  await registry.setEnabled(id,record.hash,true,true);
  const first=await registry.command(id,'save',{revision:null,values:{accent:'green'}}) as PluginDataSnapshot;
  assert.deepEqual(await registry.readStorage(id,record.hash),first);
  assert.deepEqual(await registry.command(id,'read',{}),first);
  assert.equal((await registry.list())[0]!.hash,record.hash);
  assert.equal((await collectDirectory(record.directory)).length,3);
  await registry.disableAll();await assert.rejects(registry.writeStorage(id,record.hash,first.revision,{}),/UNAVAILABLE/);
  await registry.setEnabled(id,record.hash,true);assert.deepEqual(await registry.readStorage(id,record.hash),first);
  await writeFile(path.join(record.directory,'renderer.mjs'),'export function activate() { /* updated */ }');
  await assert.rejects(registry.readStorage(id,record.hash),/UNAVAILABLE/);
  record=(await registry.list())[0]!;await registry.setEnabled(id,record.hash,true,true);assert.deepEqual(await registry.readStorage(id,record.hash),first);
});
