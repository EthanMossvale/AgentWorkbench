import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {browseFile,FileBrowserService} from '../apps/desktop/host/file-browser';
import {FileNavigationService} from '../apps/desktop/host/file-navigation';
import type {FileView} from '../packages/navigation/file-browser';

test('text pages preserve split UTF-8, large contents, distant lines and changed-file feedback',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-pages-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=path.join(root,'large.txt'),content=('A中文🙂\n').repeat(110000);await writeFile(file,content);
 let view=await browseFile(root,file,{pageSize:1024*1024}),combined=view.content!;assert.equal(view.kind,'text');assert.ok(view.next);
 const cursor=view.next!;
 while(view.next){view=await browseFile(root,file,{cursor:view.next});combined+=view.content;}
 assert.equal(combined,content);
 view=await browseFile(root,file+':100000');assert.equal(view.startLine,99950);assert.equal(view.line,100000);assert.ok(view.content!.startsWith('A中文🙂\n'));
 await writeFile(file,'changed');await assert.rejects(browseFile(root,file,{cursor}),/已变化/);
 await writeFile(file,'中🙂文');view=await browseFile(root,file,{pageSize:1});combined=view.content!;
 while(view.next){view=await browseFile(root,file,{cursor:view.next,pageSize:1});combined+=view.content;}
 assert.equal(combined,'中🙂文');
});

test('directory pages reach every entry beyond 1000 and detect a changed directory',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-directory-pages-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(let start=0;start<1005;start+=100)await Promise.all(Array.from({length:Math.min(100,1005-start)},(_,i)=>writeFile(path.join(root,`file-${start+i}.txt`),'fixture')));
 let view=await browseFile(root),names=view.entries!.map(entry=>entry.name);assert.equal(names.length,1000);const cursor=view.next!;
 while(view.next){view=await browseFile(root,root,{cursor:view.next});names.push(...view.entries!.map(entry=>entry.name));}
 assert.equal(new Set(names).size,1005);await writeFile(path.join(root,'new.txt'),'new');await assert.rejects(browseFile(root,root,{cursor}),/已变化/);
});

test('search budgets expand without guessing uniqueness and candidate providers have no 256-item cap',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-search-pages-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const dir of ['one','two','three'])await mkdir(path.join(root,dir));
 const first=path.join(root,'one','result.md'),second=path.join(root,'two','result.md');await writeFile(first,'first');await writeFile(second,'second');
 const service=new FileNavigationService({entries:1,directories:1,milliseconds:2000});
 let result=await service.locate({cwd:root,requested:'result.md'});assert.equal(result.status,'incomplete');
 for(let n=0;n<8&&result.status==='incomplete';n++){assert.ok(result.nextBudget);result=await service.locate({cwd:root,requested:'result.md',budget:result.nextBudget});}
 assert.equal(result.status,'ambiguous');if(result.status==='ambiguous')assert.deepEqual(new Set(result.candidates),new Set([first,second]));
 const off=service.registerSource({id:'plugin:fixture/many',candidates:()=>Array.from({length:300},()=>first)});
 assert.equal(await service.resolve({cwd:root,requested:'alias.md'}),first);off();
 assert.equal((await service.locate({cwd:root,requested:'result.md',budget:{entries:0,directories:0,milliseconds:0}})).status,'ambiguous');
});

test('reader registration handles coexistence and ignores disabled late results',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'awb-reader-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=path.join(root,'file.txt');await writeFile(file,'core');
 const service=new FileBrowserService();let resolve!:(value:FileView)=>void;
 const off=service.registerReader({id:'plugin:fixture/reader',browse:()=>new Promise(done=>{resolve=done;})});
 assert.throws(()=>service.registerReader({id:'plugin:fixture/reader',browse:async()=>undefined}),/DUPLICATE/);
 const reading=service.browse(root,file);off();resolve({path:file,parent:root,kind:'text',content:'late'});assert.equal((await reading).content,'core');
 const first=service.registerReader({id:'plugin:fixture/one',browse:async()=>({path:file,parent:root,kind:'text',content:'one'})});
 const second=service.registerReader({id:'plugin:fixture/two',browse:async()=>undefined});assert.equal((await service.browse(root,file)).content,'one');second();first();assert.equal((await service.browse(root,file)).content,'core');
});
