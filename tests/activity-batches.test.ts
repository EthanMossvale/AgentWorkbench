import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityGroupingRegistry } from '../packages/collaboration-core/activity-groups';
import type { RuntimeActivity } from '../packages/collaboration-core/activity';

const at='2026-09-30T00:00:00.000Z';
const entry=(id:string,change:Partial<RuntimeActivity>={})=>({id,activity:{id,runtime:'codex' as const,kind:'command' as const,status:'running' as const,turnId:'turn',startedAt:at,updatedAt:at,...change}});

test('a batch exists from its first live event and keeps its identity through output, edits and settlement',()=>{
  for(const runtime of ['codex','claude'] as const){
    const registry=new ActivityGroupingRegistry(),one=entry('one',{runtime,title:'rg fixture'}),two=entry('two',{runtime,title:'npm test'}),edit=entry('edit',{runtime,kind:'file-edit',title:'fixture.ts'});
    const initial=registry.group([one])[0]!;assert.equal(initial.label,'正在运行 rg fixture');assert.equal(initial.id,'one');
    one.activity.output='partial output';one.activity.status='completed';
    const live=registry.group([one,two,edit]);assert.equal(live.length,1);assert.equal(live[0]!.id,initial.id);assert.equal(live[0]!.label,'正在编辑 fixture.ts');
    edit.activity.status='completed';assert.equal(registry.group([one,two,edit])[0]!.label,'正在运行 npm test');
    two.activity.status='completed';const done=registry.group([one,two,edit])[0]!;
    assert.equal(done.id,initial.id);assert.equal(done.label,'运行了 2 个命令并编辑了文件');assert.equal(done.attention,0);assert.deepEqual(done.items,[one,two,edit]);
  }
});

test('failures, cancellation and uncertainty stay in place with attention rather than successful edit claims',()=>{
  const registry=new ActivityGroupingRegistry();
  for(const status of ['failed','cancelled','uncertain'] as const){
    const item=entry('edit',{kind:'file-edit'}),before=registry.group([item])[0]!;item.activity.status=status;
    const after=registry.group([item])[0]!;assert.equal(after.id,before.id);assert.equal(after.attention,1);assert.equal(after.label,'尝试编辑文件');
  }
  const failures=['failed','cancelled','uncertain'].map((status,index)=>entry(String(index),{status:status as RuntimeActivity['status']}));
  assert.equal(registry.group(failures)[0]!.attention,3);assert.equal(registry.group(failures)[0]!.label,'尝试运行 3 个命令');
});

test('messages, interactions, notices, media and scope changes remain hard batch boundaries',()=>{
  const registry=new ActivityGroupingRegistry();
  const boundaries=[{id:'commentary'},{id:'approval'},{id:'peer'},entry('retry',{category:'retry'}),entry('image',{category:'image'}),entry('generated',{imageDelivery:{status:'completed'} as any}),entry('collaboration',{kind:'message'})];
  for(const boundary of boundaries){const entries=[entry('before'),boundary,entry('after')];assert.deepEqual(registry.group(entries).map(g=>g.items),entries.map(e=>[e]));}
  for(const change of [{turnId:'next'},{nativeChildId:'child'},{runtime:'claude' as const}])assert.equal(registry.group([entry('before'),entry('after',change)]).length,2);
});

test('diagnostics neither split a live batch nor consume its status or output',()=>{
  const registry=new ActivityGroupingRegistry(),one=entry('one',{title:'echo test'}),diagnostic=entry('metadata',{presentation:'diagnostic',status:'completed'}),two=entry('two',{status:'completed'});
  const groups=registry.group([one,diagnostic,two]);assert.equal(groups.length,2);assert.equal(groups[0]!.diagnostic,true);assert.deepEqual(groups[1]!.items,[one,two]);assert.equal(groups[1]!.label,'正在运行 echo test');
});

test('read, search and generic tools have bounded live labels and truthful mixed summaries',()=>{
  const registry=new ActivityGroupingRegistry(),items=[entry('read',{category:'read',title:'src/fixture.ts'}),entry('search',{category:'search',title:'synthetic query'}),entry('tool',{kind:'tool',toolName:'fixture',title:'line one\nline two'})];
  assert.equal(registry.group(items)[0]!.label,'正在调用 line one line two');
  assert.equal(registry.group([entry('long',{title:'x'.repeat(1000)})])[0]!.label,'正在运行 '+'x'.repeat(300));
  items.forEach(item=>item.activity.status='completed');assert.equal(registry.group(items)[0]!.label,'读取了 1 项内容、搜索了 1 次并调用了 1 次工具');
});

test('legacy classification, namespaced coexistence, invalid contributions and disposal reach the same registry',async()=>{
  const registry=new ActivityGroupingRegistry(),items=[entry('one'),entry('two',{kind:'file-edit',status:'completed'})];let changes=0;const unsubscribe=registry.subscribe(()=>changes++);
  const first=registry.register('plugin.one',{id:'batch',classify:()=>({key:'all',label:'扩展批次'})});
  const second=registry.register('plugin.two',{id:'batch',classify:a=>a.kind==='command'?{key:'commands',label:'命令扩展'}:undefined});
  assert.equal(registry.group(items).length,2);assert.match(registry.group(items)[0]!.label,/命令扩展 · 正在运行/);
  assert.throws(()=>registry.register('plugin.one',{id:'batch',classify:()=>undefined}),/DUPLICATE/);
  for(const classify of [()=>{throw Error('Bad rule');},()=>({key:'',label:'bad'}),()=>Promise.resolve({key:'late',label:'Not applied'})]){
    const invalid=registry.register('plugin.bad',{id:'bad',classify:classify as any});assert.match(registry.group(items)[0]!.label,/命令扩展/);invalid.dispose();
  }
  await Promise.resolve();second.dispose();assert.equal(registry.group(items).length,1);first.dispose();first.dispose();unsubscribe();assert.equal(changes,10);assert.match(registry.group(items)[0]!.label,/正在运行/);
});
