import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { FileActionService } from '../apps/desktop/host/file-actions';

test('file actions copy exact UTF-8 text and bytes, preserve source, and respect save cancellation',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-file-actions-'));
  try{
    const source=path.join(root,'原稿.txt'),destination=path.join(root,'副本.txt'),content='原文\r\n<script>not executed</script>\n';
    await writeFile(source,content);let saved:string|null=destination,copied='';
    const service=new FileActionService({openPath:async()=>{},reveal:()=>{},copy:text=>{copied=text;},pickSave:async()=>saved});
    await service.copyContent(root,'原稿.txt:2');assert.equal(copied,content);
    assert.equal(await service.saveAs(root,'原稿.txt'),true);assert.deepEqual(await readFile(source),await readFile(destination));
    saved=null;assert.equal(await service.saveAs(root,'原稿.txt'),false);
    saved=source;await assert.rejects(service.saveAs(root,'原稿.txt'),/其他保存位置/);assert.equal(await readFile(source,'utf8'),content);
    await mkdir(path.join(root,'folder'));await assert.rejects(service.saveAs(root,'./folder'),/请选择文件/);
    await writeFile(path.join(root,'binary.bin'),Buffer.from([1,0,2]));await assert.rejects(service.copyContent(root,'binary.bin'),/UTF-8/);
    saved=path.join(root,'binary-copy.bin');assert.equal(await service.saveAs(root,'binary.bin'),true);assert.deepEqual(await readFile(saved),Buffer.from([1,0,2]));
    await writeFile(path.join(root,'large.txt'),Buffer.alloc(1024*1024+1,65));await assert.rejects(service.copyContent(root,'large.txt'),/1 MB/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('open targets use a host-owned executable allowlist and literal arguments, never shell commands',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-file-open-'));
  try{
    const target=path.join(root,'notes & $(test).txt');await writeFile(target,'text');
    const launched:{exe:string;args:string[];cwd:string}[]=[],opened:string[]=[],revealed:string[]=[];
    const service=new FileActionService({platform:'win32',env:{LOCALAPPDATA:root,ProgramFiles:path.join(root,'Program Files'),SystemRoot:path.join(root,'Windows')},exists:async file=>/Code\.exe|wt\.exe|git-bash\.exe|wsl\.exe/.test(file),launch:async(exe,args,cwd)=>{launched.push({exe,args,cwd});},openPath:async path=>{opened.push(path);},reveal:path=>{revealed.push(path);},copy:()=>{},pickSave:async()=>null});
    const info=await service.info(root,target);assert.equal(info.directory,false);assert.equal(info.options.find(item=>item.id==='visual-studio')?.available,false);assert.equal(info.options.find(item=>item.id==='vscode')?.available,true);
    await service.open(root,target+':7','vscode');assert.deepEqual(launched[0]!.args,['--goto',target+':7']);assert.equal(launched[0]!.cwd,root);
    await service.open(root,target,'terminal');assert.deepEqual(launched[1]!.args,['-d',root]);
    await service.open(root,target,'git-bash');assert.deepEqual(launched[2]!.args,[`--cd=${root}`]);
    await service.open(root,target,'wsl');assert.deepEqual(launched[3]!.args,['--cd',root]);
    await service.open(root,target,'default');await service.open(root,target,'explorer');await service.open(root,root,'explorer');assert.deepEqual(opened,[target,root]);assert.deepEqual(revealed,[target]);
    await assert.rejects(service.open(root,target,'visual-studio'),/未找到/);await assert.rejects(service.open(root,target,'cmd.exe'),/不支持/);
    await assert.rejects(service.open(root,'https://example.com','default'));await assert.rejects(service.open(root,'\\\\host\\share','default'));
    assert.equal(launched.length,4);
  }finally{await rm(root,{recursive:true,force:true});}
});
