import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginSettingsRegistry, type PluginSettingsDefinition } from '../apps/desktop/renderer/plugin-settings';

const page=(id:string,extra:Partial<PluginSettingsDefinition>={}):PluginSettingsDefinition=>({id,label:id,render(){},...extra});
test('new settings pages are namespaced, sortable, subscribable and do not mutate definitions',()=>{
  const registry=new PluginSettingsRegistry();let changes=0;const stop=registry.subscribe(()=>changes++);
  const definition=page('page',{order:2}),a=registry.register('one',definition,()=>{});definition.label='changed';
  const b=registry.register('two',page('page',{order:1}),()=>{});
  assert.deepEqual(registry.getSnapshot().map(p=>p.id),['plugin:two/page','plugin:one/page']);
  assert.equal(registry.get(a.id)!.definition.label,'page');assert.equal(registry.has(a.id),true);
  assert.equal(registry.has('general'),true);assert.equal(registry.has('plugin:absent'),false);assert.equal(registry.has({}),false);
  stop();a.dispose();b.dispose();assert.equal(changes,2);assert.deepEqual(registry.getSnapshot(),[]);
});
test('built-in settings replacement layers restore in either removal order',()=>{
  for(const earlierFirst of [true,false]) {
    const registry=new PluginSettingsRegistry(),a=registry.register('one',page('a',{replaces:'appearance'}),()=>{}),b=registry.register('two',page('b',{replaces:'appearance'}),()=>{});
    assert.equal(registry.get('appearance')!.owner,'two');
    (earlierFirst?a:b).dispose();assert.equal(registry.get('appearance')!.owner,earlierFirst?'two':'one');
    (earlierFirst?b:a).dispose();assert.equal(registry.get('appearance'),undefined);assert.equal(registry.has('appearance'),true);
    a.dispose();b.dispose();
  }
});
test('invalid settings pages and duplicate per-plugin ids fail before changing the catalog',()=>{
  const registry=new PluginSettingsRegistry();registry.register('one',page('page'),()=>{});
  assert.throws(()=>registry.register('one',page('page'),()=>{}),/DUPLICATE/);
  for(const invalid of [page('../bad'),page('blank',{label:''}),page('order',{order:NaN}),page('unknown',{replaces:'missing' as any}),page('render',{render:null as any})])assert.throws(()=>registry.register('one',invalid,()=>{}),/INVALID/);
  assert.equal(registry.getSnapshot().length,1);
});
