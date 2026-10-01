import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { coreShortcutActions, normalizeShortcut, resolveShortcuts, shortcutAccelerator, shortcutFromEvent, shortcutLabel, updateShortcuts, type ShortcutKeyEvent } from '../packages/shortcuts';
import { ShortcutRegistry } from '../apps/desktop/renderer/shortcuts';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';

const event=(key:string,extra:Partial<ShortcutKeyEvent>={}):ShortcutKeyEvent=>({key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...extra});
test('legacy shortcut settings preserve every existing action and use portable modifiers',()=>{
  assert.deepEqual(resolveShortcuts(),{version:1,revision:0,overrides:{}});
  assert.equal(new Set(coreShortcutActions.map(a=>a.id)).size,coreShortcutActions.length);
  assert.equal(shortcutLabel('Mod+ArrowLeft'), 'Ctrl + ←');
  assert.equal(shortcutLabel('Mod+N',true),'⌘ + N');
  assert.equal(shortcutAccelerator('Mod+Plus'),'CmdOrCtrl+Plus');
  assert.equal(shortcutAccelerator('Alt+ArrowLeft'),'Alt+Left');
});
test('recording handles punctuation, modifiers, macOS and physical plus without shift ambiguity',()=>{
  assert.equal(normalizeShortcut('Alt+Ctrl+a'),'Ctrl+Alt+A');
  assert.equal(shortcutFromEvent(event('N',{ctrlKey:true,shiftKey:true})),'Mod+Shift+N');
  assert.equal(shortcutFromEvent(event('+',{ctrlKey:true,shiftKey:true})),'Mod+Plus');
  assert.equal(shortcutFromEvent(event('=',{ctrlKey:true})),'Mod+=');
  assert.equal(shortcutFromEvent(event('?',{ctrlKey:true,shiftKey:true})),'Mod+Shift+/');
  assert.equal(normalizeShortcut('Mod+Shift+='),'Mod+Plus');
  assert.equal(shortcutFromEvent(event('n',{metaKey:true}),true),'Mod+N');
  assert.equal(shortcutFromEvent(event('n',{ctrlKey:true}),true),'Ctrl+N');
});
test('composition, AltGr, repeats, reserved editing keys and invalid chords are never recorded',()=>{
  for(const e of [event('Dead'),event('Shift'),event('n',{ctrlKey:true,isComposing:true}),event('n',{ctrlKey:true,keyCode:229}),event('n',{ctrlKey:true,repeat:true}),event('n',{ctrlKey:true,altKey:true,getModifierState:()=>true}),event('c',{ctrlKey:true}),event('F4',{altKey:true}),event('Escape'),event('Enter'),event('a')])assert.equal(shortcutFromEvent(e),null);
  for(const binding of ['Ctrl+Ctrl+N','Mod+Ctrl+N','Ctrl++','Ctrl+Escape','Ctrl+Tab','Ctrl+Alt+Shift+P','F12','Ctrl+Meta+N'])assert.throws(()=>normalizeShortcut(binding));
});
test('overrides distinguish deletion from defaults and reset only the requested action',()=>{
  let state=updateShortcuts(undefined,0,'new-session',[]);
  state=updateShortcuts(state,1,'search',['Mod+J','Alt+J']);
  assert.deepEqual(state.overrides,{'new-session':[],search:['Mod+J','Alt+J']});
  state=updateShortcuts(state,2,'new-session',undefined,true);
  assert.deepEqual(state.overrides,{search:['Mod+J','Alt+J']});
  assert.deepEqual(updateShortcuts(state,3,undefined,undefined,true),{version:1,revision:4,overrides:{}});
});
test('malformed settings, duplicate bindings, conflicts and stale writes are rejected atomically',()=>{
  const state=resolveShortcuts();
  for(const [id,bindings] of [['new-session',['Mod+K']],['new-session',['Ctrl+N','Mod+N']],['new-session',['Alt+J','Alt+J']],['new-session',['Shift+Enter']],['unknown',[]],['plugin:bad',[]],['search',new Array(9).fill('Alt+J')]] as [string,string[]][])assert.throws(()=>updateShortcuts(state,0,id,bindings));
  assert.throws(()=>updateShortcuts(state,1,'search',[]),/REVISION_CONFLICT/);
  assert.deepEqual(state,resolveShortcuts());
  assert.deepEqual(resolveShortcuts({version:1,revision:2,overrides:{search:['bad'],'new-session':[]}}).overrides,{'new-session':[]});
});
test('same registry drives matching and invocation, scoped actions and all aliases',async()=>{
  const registry=new ShortcutRegistry(),ran:string[]=[];
  registry.bind('global',id=>{ran.push(id);});registry.bind('composer',id=>{ran.push(id);});
  assert.equal(registry.match(event('Enter',{shiftKey:true})) ,undefined);
  assert.equal(registry.match(event('Enter',{shiftKey:true}),'composer'),'composer-newline');
  assert.equal(registry.match(event('+',{ctrlKey:true,shiftKey:true})),'zoom-in');
  assert.equal(registry.match(event('=',{ctrlKey:true})),'zoom-in');
  await registry.invoke('new-session');await registry.invoke('composer-newline');assert.deepEqual(ran,['new-session','composer-newline']);
  registry.receive(updateShortcuts(undefined,0,'new-session',['Alt+J']));
  assert.equal(registry.match(event('n',{ctrlKey:true})),undefined);assert.equal(registry.match(event('j',{altKey:true})),'new-session');
  registry.receive(undefined);assert.equal(registry.match(event('j',{altKey:true})),'new-session');
});
test('plugin actions use namespaced IDs and saved bindings survive unload and reenable',async()=>{
  const registry=new ShortcutRegistry();let runs=0,updates=0;const stop=registry.subscribe(()=>updates++);
  const register=()=>registry.register('qa.keys',{id:'action',label:'Action',defaultBindings:['Alt+J'],run(){runs++;}});
  const handle=register();registry.receive(updateShortcuts(undefined,0,handle.id,['Alt+U']));
  assert.equal(registry.match(event('u',{altKey:true})),handle.id);await registry.invoke(handle.id);assert.equal(runs,1);
  handle.dispose();handle.dispose();assert.equal(registry.match(event('u',{altKey:true})),undefined);
  await assert.rejects(registry.invoke(handle.id),/UNKNOWN_ACTION/);
  register();assert.equal(registry.match(event('u',{altKey:true})),handle.id);assert.ok(updates>=4);stop();
});
test('conflicting plugin defaults cannot steal a core binding or trigger twice',async()=>{
  const registry=new ShortcutRegistry();registry.register('qa.keys',{id:'action',label:'Action',defaultBindings:['Mod+N'],run(){throw Error('Must not run');}});
  assert.equal(registry.match(event('n',{ctrlKey:true})),'new-session');
  assert.deepEqual(registry.getSnapshot().find(item=>item.id==='plugin:qa.keys/action')!.conflicts,['new-session']);
  assert.throws(()=>registry.register('qa.keys',{id:'action',label:'Duplicate',run(){}}),/DUPLICATE_ACTION/);
  assert.throws(()=>registry.register('qa.keys',{id:'bad/id',label:'Bad',run(){}}),/INVALID_ACTION/);
});
test('replacement chains restore in either removal order and reject late delegation',async()=>{
  for(const earlierFirst of [true,false]){
    const registry=new ShortcutRegistry();const calls:string[]=[];registry.bind('global',()=>{calls.push('core');});
    const a=registry.override('a','search',async context=>{calls.push('a');await context.invokeDefault();});
    const b=registry.override('b','search',async context=>{calls.push('b');await context.invokeDefault();});
    await registry.invoke('search');assert.deepEqual(calls,['b','a','core']);calls.length=0;
    (earlierFirst?a:b).dispose();await registry.invoke('search');assert.deepEqual(calls,[earlierFirst?'b':'a','core']);
    (earlierFirst?b:a).dispose();calls.length=0;await registry.invoke('search');assert.deepEqual(calls,['core']);
    let release!:()=>void;const late=registry.override('late','search',async context=>{await new Promise<void>(resolve=>release=resolve);await context.invokeDefault();});
    const running=registry.invoke('search');late.dispose();release();await assert.rejects(running,/DISPOSED/);assert.deepEqual(calls,['core']);
  }
});
test('renderer API validates live plugin conflicts before writing and ignores stale responses',async()=>{
  const registry=new ShortcutRegistry();let state=resolveShortcuts(),writes=0;
  registry.configure(async<T>(_method:string,payload?:unknown)=>{const p=payload as any;writes++;state=updateShortcuts(state,p.revision,p.id,p.bindings,p.reset);return state as T;});
  const handle=registry.register('qa.keys',{id:'action',label:'Action',defaultBindings:['Alt+J'],run(){}});
  await assert.rejects(registry.save('new-session',['Alt+J'],0),/CONFLICT/);assert.equal(writes,0);
  await registry.save(handle.id,['Alt+U'],0);assert.equal(writes,1);assert.deepEqual(registry.getSettings().overrides[handle.id],['Alt+U']);
  await assert.rejects(registry.save('search',['Alt+S'],0),/REVISION_CONFLICT/);
});
test('controller persists broadcasts and reloads bindings with revision conflict protection',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-shortcuts-')),store=new StateStore(directory);await store.load();
  const events:unknown[]=[];const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[]},state=>events.push(state));
  try{
    await store.update(()=>{});
    const before=store.snapshot();assert.deepEqual(await controller.call('shortcuts/get'),resolveShortcuts());
    await controller.call('shortcuts/set',{revision:0,id:'new-session',bindings:['Alt+J']});
    await assert.rejects(controller.call('shortcuts/set',{revision:0,id:'search',bindings:[]}),/REVISION_CONFLICT/);
    await assert.rejects(controller.call('shortcuts/set',{revision:1,id:'search',bindings:['Alt+J']}),/CONFLICT/);
    await assert.rejects(controller.call('shortcuts/set',{revision:1,id:'search',reset:'true'}),/INVALID_PATCH/);
    assert.equal(events.length,1);
    await controller.call('shortcuts/set',{revision:1,id:'plugin:qa.keys/action',bindings:[]});
    const restarted=new StateStore(directory);await restarted.load();assert.deepEqual(restarted.snapshot().shortcuts,store.snapshot().shortcuts);
    const {shortcuts:_,...after}=store.snapshot();assert.deepEqual(after,before);
  }finally{await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
