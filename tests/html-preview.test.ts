import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HtmlPreviewService} from '../apps/desktop/host/html-preview';
import {ApiLocalTools} from '../apps/desktop/host/api-local-tools';
import type {Session} from '../packages/contracts';

test('HTML preview serves sibling assets and refuses traversal and unknown tokens',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-html-'));
 try{
  await mkdir(path.join(dir,'assets'));await writeFile(path.join(dir,'page.html'),'<h1>Fixture</h1><script src="assets/site.js"></script>');await writeFile(path.join(dir,'assets/site.js'),'document.body.dataset.loaded="yes";');await writeFile(path.join(dir,'secret.json'),'synthetic-private');
  const service=new HtmlPreviewService(),page=await service.create(dir,'page.html');assert(service.owns(page.url));
  const response=await service.response(new Request(page.url));assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy')!,/default-src https: http:/);
  assert.equal((await service.response(new Request(page.url.replace('index.html','assets/site.js')))).status,200);
  assert.equal(await (await service.response(new Request(page.url.replace('index.html','secret.json')))).text(),'synthetic-private');
  for(const target of ['%2e%2e%2foutside.js','assets%5csite.js'])assert.equal((await service.response(new Request(page.url.replace('index.html',target)))).status,403);
  assert.equal((await service.response(new Request('awb-preview://unknown/index.html'))).status,404);
  assert.equal((await service.response(new Request(page.url,{method:'POST'}))).status,404);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('API permissions are checked again after a pending approval before any command starts',async()=>{
 const tools=new ApiLocalTools([]),session={id:'fixture',permissionMode:'default',projectPath:os.tmpdir()} as Session;
 await assert.rejects(tools.call(session,'run_command',{command:'echo must-not-run'},new AbortController().signal,async()=>{session.permissionMode='read-only';return true;},()=>session),/Permissions changed before command execution/);
});
