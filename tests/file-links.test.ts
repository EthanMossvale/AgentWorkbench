import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {fileReference,fileLinkDestination,fileMarkdownDestination,linkedText,webReference} from '../packages/navigation/file-links';
import {browseFile,normalizeBrowsePath} from '../apps/desktop/host/file-browser';

test('plain Unicode paths retain punctuation boundaries, and copied links preserve special filenames',()=>{
 const references=linkedText('读取 /tmp/中文.md 和 src/中文.ts:4。然后 C:/项目/资料.md，完成。').filter(item=>item.reference).map(item=>item.reference);
 assert.deepEqual(references,[{path:'/tmp/中文.md'},{path:'src/中文.ts',line:4},{path:'C:/项目/资料.md'}]);
 const source={path:'D:\\项目\\[review] literal%20name#section.md',line:9};
 assert.deepEqual(fileLinkDestination(fileMarkdownDestination(source)),{path:source.path.replaceAll('\\','/'),line:9});
 for(const raw of ['javascript:/tmp/file.md'])assert.ok(linkedText(raw).every(item=>!item.reference&&!item.url),raw);
});

test('literal filenames differ from URL destinations, and file URIs decode exactly once',()=>{
 assert.deepEqual(fileReference('notes (v2) [中文] 100%.md'),{path:'notes (v2) [中文] 100%.md'});
 assert.deepEqual(fileReference('literal%20space.md'),{path:'literal%20space.md'});
 assert.deepEqual(fileLinkDestination('literal%2520space.md'),{path:'literal%20space.md'});
 assert.deepEqual(fileLinkDestination('100%.md'),{path:'100%.md'});
 assert.deepEqual(fileLinkDestination('file:///D:/literal%2520space.md#L4-L8'),{path:'D:/literal%20space.md',line:4});
 assert.deepEqual(fileReference('src\\组件.ts:4:2-8:3'),{path:'src\\组件.ts',line:4});
 for(const value of ['.gitignore','src/components','src/components/','~/资料/guide.md'])assert.deepEqual(fileReference(value),{path:value});
 for(const value of ['file:///D:/x.md?download=yes','file:///D:/%00.md','C:relative.md','\\rooted.md','identifier'])assert.equal(fileReference(value),undefined);
});
test('file links handle Windows spaces, markdown, line anchors, POSIX and preserve surrounding punctuation',()=>{
 assert.deepEqual(fileReference('D:\\My Project\\hello.ts:12:3'),{path:'D:\\My Project\\hello.ts',line:12});
 assert.deepEqual(fileReference('file:///C:/My%20Project/a.ts#L8'),{path:'C:/My Project/a.ts',line:8});
 const linked=linkedText('Read [source](<D:/My%20Project/a.ts:4>) and `src/main.ts` then https://example.com/a_(b).');
 assert.equal(linked.find(p=>p.text==='source')?.reference?.line,4);
 assert.equal(linked.find(p=>p.text==='source')?.reference?.path,'D:/My Project/a.ts');
 assert.equal(linked.find(p=>p.text==='src/main.ts')?.reference?.path,'src/main.ts');
 assert.equal(linked.find(p=>p.url)?.url,'https://example.com/a_(b)');
 assert.equal(linked.at(-1)?.text,'.');
 assert.deepEqual(fileReference('/home/user/main.py:10'),{path:'/home/user/main.py',line:10});
});
test('links reject executable schemes, credentials, device paths and command code blocks',()=>{
 for(const target of ['javascript:alert(1)','data:text/html,x','https://user:pass@example.com','https://example.com\nextra','file://server/share'])assert.equal(webReference(target),undefined);
 for(const target of ['javascript:alert(1)','data:text/html,x','\\\\.\\device','//./device','C:\\a\u0000.txt'])assert.equal(fileReference(target),undefined);
 assert.ok(linkedText('```sh\ncat /home/x.ts\n\nhttps://example.com\n```').every(item=>!item.reference&&!item.url));
 assert.ok(linkedText('[attack](javascript:alert(1))').every(item=>!item.reference&&!item.url));
});

test('slash-prefixed Windows file destinations retain their drive, spaces and line anchors',()=>{
 for(const prefix of ['D:/','/D:/','file:///D:/']){
  assert.deepEqual(fileReference(prefix+'Example Project/tools/slot_component_ui.py:128'),{path:'D:/Example Project/tools/slot_component_ui.py',line:128});
 }
 assert.deepEqual(fileReference('</d:/Example Project/tools/slot_texture_export.py#L631C4>'),{path:'d:/Example Project/tools/slot_texture_export.py',line:631});
 assert.deepEqual(fileReference('/D:/Example Project/'),{path:'D:/Example Project/'});
 const link=linkedText('Read [source](</D:/Example Project/tools/slot_component_ui.py:128>).');
 assert.deepEqual(link.find(item=>item.text==='source')?.reference,{path:'D:/Example Project/tools/slot_component_ui.py',line:128});
 for(const value of ['//D:/folder/file.py','/javascript:alert(1)','/D:relative.py','/D:/file.py:stream'])assert.equal(fileReference(value),undefined);
});
test('explicit file browsing reads UTF8 lines and parent directories without evaluating content',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aw-file-'));
 try{await mkdir(path.join(root,'directory'));await writeFile(path.join(root,'a.txt'),'first\n<script>not executed</script>\n');await writeFile(path.join(root,'binary.bin'),Buffer.from([0,1,2]));await writeFile(path.join(root,'large.txt'),Buffer.alloc(1024*1024+1,65));
 const listing=await browseFile(root);assert.equal(listing.entries?.[0]?.directory,true);
 const result=await browseFile(root,'a.txt:2');assert.equal(result.kind,'text');assert.equal(result.line,2);assert.match(result.content!,/<script>/);
 if(process.platform==='win32'){const nativeLink=await browseFile(root,'/'+root.replaceAll('\\','/')+'/a.txt:2');assert.equal(nativeLink.path,result.path);assert.equal(nativeLink.line,2);assert.equal(nativeLink.content,result.content);}
 assert.equal((await browseFile(root,'binary.bin')).kind,'unsupported');assert.equal((await browseFile(root,'large.txt')).kind,'unsupported');
 await assert.rejects(browseFile(root,'missing.txt'));
 }finally{await rm(root,{recursive:true,force:true});}
});

// Pure mapping verifies UNC support without opening a network connection.
test('network-share references preserve full paths and line anchors',()=>{
 for(const value of [String.raw`\\server\share\file.md`,'//server/share/file.md']){
  assert.deepEqual(fileReference(value+':7'),{path:value,line:7});
  assert.deepEqual(linkedText(value+':7')[0]?.reference,{path:value,line:7});
  assert.deepEqual(fileLinkDestination(fileMarkdownDestination({path:value,line:7})),{path:value,line:7});
  if(process.platform==='win32')assert.equal(normalizeBrowsePath('C:/workspace',value),String.raw`\\server\share\file.md`);
 }
 assert.deepEqual(fileReference('file://server/share/file.md#L4'),{path:'//server/share/file.md',line:4});
 assert.deepEqual(linkedText('file://server/share/file.md')[0]?.reference,{path:'//server/share/file.md'});
});
