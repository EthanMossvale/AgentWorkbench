import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,writeFile,readFile,mkdir,rm,access} from 'node:fs/promises';
import {ZipWriter,Uint8ArrayWriter,Uint8ArrayReader,SplitDataWriter} from '@zip.js/zip.js';
import {encodeZip,decodeZip,readArchive,installArchive} from '../packages/native-resources/archive';
import {archiveReaders} from '../packages/native-resources/archive-reader';
import {NativeResources} from '../apps/desktop/host/native-resources';
const skill=Buffer.from('---\nname: archive-fixture\ndescription: Fixture\n---\nRead this exact source.');
async function root(t:{after:(fn:()=>Promise<void>)=>void}){const directory=await mkdtemp(path.join(os.tmpdir(),'awb-archive-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
async function zip(files:{name:string;data:Uint8Array;link?:boolean}[],options:Record<string,unknown>={}){const writer=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false,useCompressionStream:true,...options});for(const file of files)await writer.add(file.name,new Uint8ArrayReader(file.data),file.link?{unixMode:0o120777}:{});return Buffer.from(await writer.close());}
test('large resource bodies and ZIP64 file counts retain complete bytes',async t=>{
 const directory=await root(t),large=Buffer.alloc(67*1024*1024,0x63),file=path.join(directory,'large.zip');
 await writeFile(file,encodeZip([{name:'SKILL.md',data:skill},{name:'large.bin',data:large}]));assert.deepEqual((await readArchive(file))[1]!.data,large);
 const entries=Array.from({length:65536},(_,index)=>({name:'r/'+index,data:Buffer.from(String(index))})),archive=encodeZip(entries);
 assert.equal(decodeZip(archive).length,entries.length);await writeFile(file,archive);const decoded=await readArchive(file);assert.equal(decoded.length,65536);assert.equal(decoded[65535]!.data.toString(),'65535');
});
test('forced ZIP64 and compressed data decode through both resource APIs',async t=>{
 const directory=await root(t),file=path.join(directory,'zip64.zip'),data=await zip([{name:'SKILL.md',data:skill}],{zip64:true});await writeFile(file,data);
 assert.deepEqual(decodeZip(data)[0]!.data,skill);assert.deepEqual((await readArchive(file))[0]!.data,skill);
});
test('AES and ZipCrypto password requests cause no installation until the exact password is supplied',async t=>{
 const directory=await root(t),home=path.join(directory,'home'),host=new NativeResources(path.join(directory,'data'),{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},home);host.cli.locate=async()=>undefined;await host.initialize();
 try{for(const [provider,zipCrypto] of [['codex',false],['claude',true]] as const){const file=path.join(directory,provider+'.zip');await writeFile(file,await zip([{name:'SKILL.md',data:skill}],{password:'fixture-password',zipCrypto}));
  assert.deepEqual(await host.call('native-skills/import',{provider,filePath:file}),{kind:'archive-password',filePath:file,incorrect:false});
  assert.deepEqual(await host.call('native-skills/import',{provider,filePath:file,password:'wrong'}),{kind:'archive-password',filePath:file,incorrect:true});
  assert.equal((await host.skills.scan()).skills.filter(s=>s.origins.some(o=>o.provider===provider)).length,0);
  await host.call('native-skills/import',{provider,filePath:file,password:'fixture-password'});const actual=path.join(home,provider==='claude'?'.claude':'.agents','skills','archive-fixture','SKILL.md');assert.deepEqual(await readFile(actual),skill);
 }}finally{await host.dispose();}
});
test('split ZIP and numbered byte volumes load from the chosen package',async t=>{
 const directory=await root(t),writers:Uint8ArrayWriter[]=[];
 async function* disks():AsyncGenerator<Uint8ArrayWriter,boolean>{for(;;){const writer=new Uint8ArrayWriter();writers.push(writer);yield writer;}return true;}
 const split=new ZipWriter(new SplitDataWriter(disks(),1024),{useWebWorkers:false,useCompressionStream:true,level:0});await split.add('data.txt',new Uint8ArrayReader(Buffer.alloc(5000,0x61)));await split.close();assert.ok(writers.length>1);
 for(let i=0;i<writers.length;i++)await writeFile(path.join(directory,'split.'+(i===writers.length-1?'zip':'z'+String(i+1).padStart(2,'0'))),await writers[i]!.getData());
 assert.equal((await readArchive(path.join(directory,'split.zip')))[0]!.data.length,5000);
 assert.equal((await readArchive(path.join(directory,'split.z01')))[0]!.data.length,5000);
 await rm(path.join(directory,'split.z02'));await assert.rejects(readArchive(path.join(directory,'split.zip')),/ENOENT/);
 const packed=encodeZip([{name:'SKILL.md',data:skill}]);for(let offset=0,index=1;offset<packed.length;offset+=60,index++)await writeFile(path.join(directory,'bytes.zip.'+String(index).padStart(3,'0')),packed.subarray(offset,offset+60));
 assert.deepEqual((await readArchive(path.join(directory,'bytes.zip.001')))[0]!.data,skill);
});
test('internal linked resources become portable copies while incomplete paths and corrupt CRC remain errors',async t=>{
 const directory=await root(t),file=path.join(directory,'links.zip');await writeFile(file,await zip([{name:'SKILL.md',data:skill},{name:'assets/body.txt',data:Buffer.from('same bytes')},{name:'copy',data:Buffer.from('assets'),link:true},{name:'alias.txt',data:Buffer.from('assets/body.txt'),link:true}]));
 const files=await readArchive(file);assert.equal(files.find(f=>f.name==='copy/body.txt')!.data.toString(),'same bytes');assert.equal(files.find(f=>f.name==='alias.txt')!.data.toString(),'same bytes');await installArchive(path.join(directory,'installed'),files);assert.equal(await readFile(path.join(directory,'installed/copy/body.txt'),'utf8'),'same bytes');
 for(const target of ['../outside','/absolute','missing','alias'])assert.throws(()=>decodeZip(encodeZip([{name:'alias',data:Buffer.from(target),link:true}])),/path|package|missing|cycle/i);
 const broken=encodeZip([{name:'data.txt',data:Buffer.from('content')}]);broken[38]=broken[38]!^1;await writeFile(file,broken);await assert.rejects(readArchive(file),/CRC|signature/i);
});
test('approved archive reader participates in actual imports and restores on disable',async t=>{
 const directory=await root(t),host=new NativeResources(path.join(directory,'data'),{openZip:async()=>null,saveZip:async()=>null},()=>[],()=>{},path.join(directory,'home'));host.cli.locate=async()=>undefined;await host.initialize();host.plugins.services.register('native.archives',archiveReaders,{version:1});
 const id='qa.archive-reader',file=path.join(directory,'plugin.zip'),main="export function activate(api){api.onDispose(api.services.get('native.archives').register({id:'plugin:'+api.id+'/fixture',read:(file)=>file.endsWith('custom.zip')?Promise.resolve([{name:'SKILL.md',data:Buffer.from('---\\nname: custom\\ndescription: Custom reader\\n---\\nExact body')} ]):undefined}));}";
 try{await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:'Archive fixture',description:'Synthetic',version:'1.0.0',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(main)}]));await host.plugins.importZip(file);const hash=(await host.plugins.list())[0]!.hash;await host.plugins.setEnabled(id,hash,true,true);
  const custom=path.join(directory,'custom.zip');await host.call('native-skills/import',{provider:'claude',filePath:custom});assert.equal((await host.skills.scan()).skills[0]!.name,'custom');
  await host.plugins.setEnabled(id,hash,false);await assert.rejects(readArchive(custom),/ENOENT/);await host.plugins.setEnabled(id,hash,true);assert.ok((await readArchive(custom))[0]!.data.includes(Buffer.from('Exact body')));
 }finally{await host.dispose();}
});
