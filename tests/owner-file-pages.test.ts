import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {OwnerFileService,type FileContext} from '../services/owner-file-service';
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'awb-file-pages-'));const service=await OwnerFileService.create({ownerId:'o',deviceId:'d',generation:'g',controlPaths:[],verifyOwner:async()=>true});const grant=service.issueGrant({operations:['read','write'],expiresAt:new Date(Date.now()+60000).toISOString()});const context:FileContext={grantId:grant.id,ownerId:'o',deviceId:'d',generation:'g',sessionId:'s',workspaceId:'w',operationId:'op',os:process.platform};return {root,service,context,close:()=>rm(root,{recursive:true,force:true})};}
test('large UTF-8 pages preserve characters, full byte versions, continuation and unlimited requested page length',async()=>{
 const f=await fixture();try{const file=path.join(f.root,'large.txt'),text='漢🙂x'.repeat(450000);await writeFile(file,text);
  const first=await f.service.readRange(f.context,file,{limit:70000});assert.equal(first.content,text.slice(0,70000));assert.equal(first.version,createHash('sha256').update(text).digest('hex'));assert.equal(first.totalCharacters,text.length);assert.equal(first.nextOffset,70000);
  const second=await f.service.readRange(f.context,file,{offset:first.nextOffset,limit:90000,version:first.version});assert.equal(second.content,text.slice(70000,160000));
  const end=await f.service.readRange(f.context,file,{offset:text.length-10});assert.equal(end.content,text.slice(-10));assert.equal(end.nextOffset,undefined);
  await writeFile(file,text+'changed');await assert.rejects(f.service.readRange(f.context,file,{version:first.version,limit:10}),/source changed/);
  const stopped=new AbortController();stopped.abort();await assert.rejects(f.service.readRange(f.context,file,{limit:1,signal:stopped.signal}),/abort/i);
 }finally{await f.close();}
});
test('binary reads/writes preserve bytes and approval, stale-version and duplicate-write behavior',async()=>{
 const f=await fixture();try{const file=path.join(f.root,'bytes.bin'),bytes=Buffer.alloc(3*1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;await writeFile(file,bytes);
  await assert.rejects(f.service.read(f.context,file),/base64/);const first=await f.service.readRange(f.context,file,{encoding:'base64',offset:65530,limit:70000});assert.deepEqual(Buffer.from(first.content,'base64'),bytes.subarray(65530,135530));
  const replacement=Buffer.from([0,255,128,13,10]);const preview=await f.service.prepareWrite(f.context,file,first.version,replacement.toString('base64'),'base64');await assert.rejects(f.service.write(f.context,preview.id,preview.bindingHash),/approval/i);f.service.confirmWrite(preview.id,preview.bindingHash);const result=await f.service.write(f.context,preview.id,preview.bindingHash);assert.equal(result.content,replacement.toString('base64'));assert.deepEqual(await readFile(file),replacement);assert.deepEqual(await f.service.write(f.context,preview.id,preview.bindingHash),result);
  await assert.rejects(f.service.prepareWrite(f.context,file,first.version,'AA==','base64'),/changed/);await assert.rejects(f.service.prepareWrite(f.context,file,result.version,'invalid base64','base64'),/canonical/);
 }finally{await f.close();}
});
test('directory pages expose remaining entries beyond one thousand',async()=>{
 const f=await fixture();try{const dir=path.join(f.root,'entries');await mkdir(dir);await Promise.all(Array.from({length:1003},(_,i)=>writeFile(path.join(dir,String(i).padStart(4,'0')),'')));const first=await f.service.list(f.context,dir),second=await f.service.list(f.context,dir,{offset:first.nextOffset});assert.equal(first.entries.length,1000);assert.equal(second.entries.length,3);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.name)).size,1003);assert.equal(second.nextOffset,undefined);
 }finally{await f.close();}
});
