import test from 'node:test';
import assert from 'node:assert/strict';
import { FontPresetRegistry, fontPresets } from '../packages/appearance/fonts';
import { defaultAppearance, fontStack, MONO_FONT, resolveAppearance, SYSTEM_FONT, updateAppearance, validateAppearancePatch } from '../packages/appearance';

test('font contributions are namespaced immutable snapshots with independent cleanup and limits',()=>{
  const registry=new FontPresetRegistry();let changes=0;const unsubscribe=registry.subscribe(()=>changes++);
  const a=registry.register('test.alpha',{id:'reading',label:'Reading',family:'Example Serif',fallback:'serif'}),b=registry.register('test.beta',{id:'reading',label:'Second',family:'Example Mono',fallback:'mono'});
  assert.notEqual(a.id,b.id);const before=registry.getSnapshot();assert.equal(before.length,2);assert.equal(Object.isFrozen(before),true);assert.equal(Object.isFrozen(before[0]),true);
  assert.throws(()=>registry.register('test.alpha',{id:'reading',label:'Collision',family:'Arial'}),/DUPLICATE/);
  a.dispose();a.dispose();assert.equal(before.length,2);assert.equal(registry.getSnapshot().length,1);assert.equal(changes,3);unsubscribe();b.dispose();assert.equal(changes,3);
  for(let n=0;n<64;n++)registry.register('test.limit',{id:`font-${n}`,label:'Font',family:'Arial'});
  assert.throws(()=>registry.register('test.limit',{id:'overflow',label:'Font',family:'Arial'}),/LIMIT/);
});
test('font metadata rejects CSS, invalid identities and undocumented fields',()=>{
  const registry=new FontPresetRegistry();
  for(const input of [{id:'../escape',label:'X',family:'Arial'},{id:'x',label:'',family:'Arial'},{id:'x',label:'X',family:'Arial; color:red'},{id:'x',label:'X',family:'Arial"'},{id:'x',label:'X',family:'Arial',url:'https://example.com/font'},{id:'x',label:'X',family:'Arial',fallback:'unknown'}])assert.throws(()=>registry.register('test.fonts',input as any),/INVALID/);
  for(const choice of ['plugin:bad/id/extra','plugin:bad/../escape','plugin:/font','plugin:owner/'])assert.throws(()=>validateAppearancePatch({uiFont:choice}),/INVALID_FONT/);
});
test('saved plugin choices survive absence and registration restores typography without changing settings',()=>{
  const id='plugin:test.fonts/editor' as const;const saved=updateAppearance(undefined,0,{uiFont:id,contentFont:id,codeFont:id});
  assert.deepEqual(resolveAppearance(saved),saved);assert.equal(fontStack(id,MONO_FONT),MONO_FONT);
  const handle=fontPresets.register('test.fonts',{id:'editor',label:'Editor',family:'Example Mono',fallback:'mono'});
  try{assert.equal(fontStack(id,SYSTEM_FONT),`"Example Mono", ${MONO_FONT}`);assert.equal(saved.revision,1);assert.equal(defaultAppearance().codeFont,'mono');}finally{handle.dispose();}
  assert.equal(fontStack(id,MONO_FONT),MONO_FONT);assert.equal(resolveAppearance(saved).codeFont,id);
});
