import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BrandingRegistry,validateBrandingPng} from '../packages/branding';
import {defaultBranding} from '../packages/branding/default';
import generated from '../packages/branding/generated.json';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';

const definition=(id='identity')=>({id,label:'Synthetic identity',app:defaultBranding.app,tray:{...defaultBranding.tray}});
test('approved SVG, PNG resolutions and ICO remain one connected-W source',async()=>{
  const source=await readFile('packages/branding/connected-w.svg','utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),generated.sourceSha256);
  for(const color of ['#30201A','#FF9676','#FFDAAB'])assert.ok(source.includes(color));
  for(const [size,data]of Object.entries(generated.images))assert.equal(validateBrandingPng(data),Number(size));
  const ico=await readFile('packages/branding/connected-w.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
  for(let i=0;i<7;i++){const at=6+i*16,size=ico[at]||256,length=ico.readUInt32LE(at+8),offset=ico.readUInt32LE(at+12);assert.equal(validateBrandingPng('data:image/png;base64,'+ico.subarray(offset,offset+length).toString('base64')),size);}
});
test('registration reaches current identity, copies inputs, and unwinds non-LIFO layers',()=>{
  const brands=new BrandingRegistry(),seen:string[]=[];const off=brands.subscribe(value=>seen.push(value.id));
  const first=definition(),a=brands.register('qa.first',first);first.label='Mutated input';
  assert.equal(brands.get().label,'Synthetic identity');const copy=brands.get();copy.label='Mutated output';assert.equal(brands.get().label,'Synthetic identity');
  const b=brands.register('qa.second',definition());assert.equal(brands.list().length,3);assert.equal(brands.get().id,b.id);
  a.dispose();assert.equal(brands.get().id,b.id);b.dispose();b.dispose();assert.equal(brands.get().id,defaultBranding.id);assert.equal(brands.get().revision,4);off();assert.equal(seen.length,4);
});
test('invalid or duplicate artwork fails without changing active branding',()=>{
  const brands=new BrandingRegistry();const handle=brands.register('qa.first',definition());const before=brands.get();
  assert.throws(()=>brands.register('qa.first',definition()),/BRANDING_DUPLICATE_ID/);
  assert.throws(()=>brands.register('qa.bad',{...definition(),app:'https://example.invalid/icon.png'}),/BRANDING_IMAGE_INVALID/);
  const broken=Buffer.from(defaultBranding.app.slice(22),'base64');broken[broken.length-1]=broken[broken.length-1]!^1;
  assert.throws(()=>brands.register('qa.bad',{...definition(),app:'data:image/png;base64,'+broken.toString('base64')}),/BRANDING_IMAGE_INVALID/);
  assert.throws(()=>brands.register('qa.bad',{...definition(),tray:{'16':defaultBranding.app}}),/BRANDING_IMAGE_INVALID/);
  assert.throws(()=>brands.register('qa.bad',{...definition(),id:'../escape'}),/BRANDING_DEFINITION_INVALID/);assert.deepEqual(brands.get(),before);handle.dispose();
});
test('approved ZIP owns branding, clears failed activation, and rejects late code after disable',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-brand-plugin-')),plugins=new PluginRegistry(path.join(directory,'profile'));
  await plugins.initialize();
  const fixture=async(id:string,source:string)=>{const file=path.join(directory,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Isolated branding acceptance',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(file);return (await plugins.list()).find(p=>p.manifest.id===id)!;};
  try{
    const record=await fixture('qa.brand',`export function activate(api){globalThis.__brandFixtureApi=api;const original=api.branding.get();api.branding.register({...original,id:'new',label:'Fixture'});api.branding.subscribe(()=>{});}`);
    await assert.rejects(plugins.setEnabled(record.manifest.id,record.hash,true),/Explicit approval/);
    await plugins.setEnabled(record.manifest.id,record.hash,true,true);assert.equal(plugins.branding.get().id,'plugin:qa.brand/new');
    await plugins.setEnabled(record.manifest.id,record.hash,false);assert.equal(plugins.branding.get().id,defaultBranding.id);
    const stale=(globalThis as any).__brandFixtureApi;await Promise.resolve();assert.throws(()=>stale.branding.register(definition()),/no longer active/);assert.throws(()=>stale.branding.get(),/no longer active/);
    await plugins.setEnabled(record.manifest.id,record.hash,true);assert.equal(plugins.branding.get().label,'Fixture');await plugins.disableAll();
    const failed=await fixture('qa.failure',`export function activate(api){api.branding.register({...api.branding.get(),id:'failed'});throw Error('Synthetic activation failure');}`);
    await plugins.setEnabled(failed.manifest.id,failed.hash,true,true);assert.equal(plugins.branding.get().id,defaultBranding.id);assert.equal((await plugins.list()).find(p=>p.manifest.id==='qa.failure')!.enabled,false);
  }finally{delete (globalThis as any).__brandFixtureApi;await plugins.dispose();await rm(directory,{recursive:true,force:true});}
});
