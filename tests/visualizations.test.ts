import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { markdownTokens, markdownBlocks } from '../packages/message-markdown';
import { parseVisualization, visualizationState, VisualizationRegistry } from '../packages/visualizations';
import { visualizationDocument } from '../packages/visualizations/document';
import { visualizationInstructions } from '../packages/visualizations/instructions';
import { protect, restore } from '../packages/translation/protection';
import { HtmlPreviewService } from '../apps/desktop/host/html-preview';
import { UiPreferenceStore } from '../packages/ui-preferences/store';
import { nativeProviderLaunch } from '../packages/model-api/native-launch';
import { officialAccountLaunch } from '../packages/model-management/native';
import type { ApiModel } from '../packages/model-api/types';
import type { Session } from '../packages/contracts';
const marker=(value:unknown)=>'\uE200visualize\uE202'+JSON.stringify(value)+'\uE201';
const reference={path:'./comparison.html',title:'方案比较'},document={path:'/fixture/comparison.html',html:'<p>original</p>',digest:'fixture'};
test('complete standalone markers tokenize without altering message copies or bilingual blocks',()=>{
  const raw=marker(reference),source='Before\n\n'+raw+'\n\nAfter';
  assert.deepEqual(parseVisualization(raw),reference);assert.equal(markdownTokens(source).filter(t=>t.type==='visualization').length,1);assert.equal(markdownBlocks(source).join(''),source);
  for(const literal of ['```html\n'+raw+'\n```','`'+raw+'`','Example '+raw,raw.slice(0,-1),marker({path:'https://example.com/a.html'}),marker({path:'x.html',evil:1})])assert.equal(markdownTokens(literal).filter(t=>t.type==='visualization').length,0,literal);
});
test('invalid and ambiguous reference inputs are rejected while long titles remain usable',()=>{
  for(const value of [null,[],{path:'\\\\server\\x.html'},{path:'//server/x.html'},{path:'file:///x.html'},{path:'x.js'},{path:'x\n.html'},{path:'x.html',mode:'fullscreen'},{path:'x.html',renderer:'private'}])assert.equal(parseVisualization(marker(value)),undefined);
  assert.equal(parseVisualization(marker({path:'x.html',title:'a'.repeat(161)}))?.title?.length,161);
  assert.equal(parseVisualization('x'.repeat(9000)),undefined);
});
test('translation protects the complete directive and retains JSON escaping and Unicode',()=>{
  const raw=marker({path:'./方案.html',title:'比较'}),source='Compare\n\n'+raw,protectedText=protect(source);
  assert.ok(protectedText.spans.some(span=>span.original===raw));assert.equal(restore(protectedText.text.replace('Compare','比较'),protectedText),'比较\n\n'+raw);
});
test('state is bounded JSON and envelope escapes closing scripts',()=>{
  assert.deepEqual(visualizationState({privateContent:{page:2}}),{modelContent:null,privateContent:{page:2}});
  for(const state of [[],null,{bad:1},{privateContent:NaN},{privateContent:{constructor:2}}])assert.throws(()=>visualizationState(state));
  assert.equal((visualizationState({privateContent:['x'.repeat(20000)]}).privateContent as string[])[0]!.length,20000);
  const html=visualizationDocument({html:'<p>fixture</p>',channel:'synthetic-channel-123',state:{privateContent:'</script><script>bad()</script>'},dark:false});assert.match(html,/\\u003c\/script>/);assert.match(html,/event.source!==parent/);assert.match(html,/setWidgetState/);
});
test('production renderer directory supports selected contributions, layered replacement and non-LIFO cleanup',async()=>{
  const registry=new VisualizationRegistry(),signal=new AbortController().signal;
  const a=registry.register('qa.first',{id:'view',label:'First',replaces:'core.html',render:()=>'<p>A</p>'});
  const b=registry.register('qa.second',{id:'view',label:'Second',replaces:'core.html',render:()=>'<p>B</p>'});
  assert.equal((await registry.render(document,reference,'core.html',signal)).html,'<p>B</p>');a.dispose();assert.equal((await registry.render(document,reference,b.id,signal)).html,'<p>B</p>');b.dispose();assert.equal((await registry.render(document,reference,'core.html',signal)).html,document.html);
  assert.equal((await registry.render(document,reference,b.id,signal)).fallback,true);assert.equal(registry.listRenderers().length,1);
});
test('renderer failure, invalid registration and late results cannot replace current content',async()=>{
  const registry=new VisualizationRegistry(),controller=new AbortController();let resolve!:(value:string)=>void;
  assert.throws(()=>registry.register('qa.test',{id:'bad/id',label:'Bad',render:()=>''}));
  const handle=registry.register('qa.test',{id:'slow',label:'Slow',render:()=>new Promise<string>(done=>{resolve=done;})});
  const pending=registry.render(document,reference,handle.id,controller.signal);await Promise.resolve();handle.dispose();resolve('<p>late</p>');assert.equal((await pending).fallback,true);
  const broken=registry.register('qa.test',{id:'broken',label:'Broken',render:()=>{throw Error('fixture');}});assert.equal((await registry.render(document,reference,broken.id,controller.signal)).html,document.html);
  controller.abort();await assert.rejects(registry.render(document,reference,'core.html',controller.signal));
});
test('inline pages release explicitly and cannot read neighboring assets or bypass their CSP',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-viz-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,'page.html'),'<h1>fixture</h1>');await writeFile(path.join(directory,'secret.js'),'private');const service=new HtmlPreviewService();
  const source=await service.readVisualization(directory,'page.html');assert.equal(source.digest.length,64);assert.equal(source.html,'<h1>fixture</h1>');
  const page=service.createVisualization({html:source.html,channel:'synthetic-channel-123',state:{},dark:false});const response=await service.response(new Request(page.url));assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy')!,/default-src https: http:/);assert.match(response.headers.get('Content-Security-Policy')!,/'unsafe-inline' 'unsafe-eval'/);
  assert.equal((await service.response(new Request(page.url.replace('index.html','secret.js')))).status,403);service.releaseVisualization(page.url);assert.equal(service.owns(page.url),false);assert.equal((await service.response(new Request(page.url))).status,404);
  await assert.rejects(service.readVisualization(directory,'secret.js'));await writeFile(path.join(directory,'large.html'),'x'.repeat(1024*1024+1));assert.equal((await service.readVisualization(directory,'large.html')).html.length,1024*1024+1);
});
test('widget choices restore from user profile and stale writes do not overwrite newer choices',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-viz-state-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new UiPreferenceStore(directory);await store.load();const scope=JSON.stringify(['fixture','comparison.html']);
  await store.set('visualization.state',{modelContent:null,privateContent:{page:3}},scope);await store.set('visualization.renderer','plugin:qa.test/view',scope);await store.set('visualization.source',true,scope);
  const restart=new UiPreferenceStore(directory);await restart.load();assert.deepEqual(restart.get('visualization.state',scope).value,{modelContent:null,privateContent:{page:3}});assert.equal(restart.get('visualization.source',scope).value,true);assert.equal(restart.get('visualization.source','other').value,false);
  await assert.rejects(restart.update({id:'visualization.state',scope,revision:0,value:{privateContent:{page:0}}}),/CONFLICT/);assert.equal(restart.get('visualization.renderer',scope).value,'plugin:qa.test/view');
});
test('both native providers and official task launches receive the same presentation contract',()=>{
  const model={id:'fixture',model:'fixture',name:'Fixture'} as ApiModel,gateway={baseUrl:'http://127.0.0.1:1',token:'synthetic'};
  for(const runtime of ['codex','claude'] as const){
    const launch=nativeProviderLaunch(runtime,model,gateway,'default',undefined,{});
    if(runtime==='codex')assert.equal(launch.thread?.developerInstructions,visualizationInstructions);else assert.equal(launch.args[launch.args.indexOf('--append-system-prompt')+1],visualizationInstructions);
    const official=officialAccountLaunch({id:'fixture',binding:{runtime},modelSelection:{model:'fixture'},permissionMode:'default'} as Session,{},gateway);
    if(runtime==='codex')assert.equal(official.thread?.developerInstructions,visualizationInstructions);else assert.equal(official.args[official.args.indexOf('--append-system-prompt')+1],visualizationInstructions);
  }
});
