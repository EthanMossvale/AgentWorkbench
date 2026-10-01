import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinThemes, contrastRatio, defaultPreset, ThemePresetRegistry, themeVariables } from '../packages/appearance/themes';
import { defaultAppearance, resolveAppearance, updateAppearance, validateAppearancePatch } from '../packages/appearance';
import { CodeSyntaxRegistry, highlightCode } from '../packages/appearance/syntax';

test('twelve original palettes have readable text and code colors in both mode families',()=>{
  for(const mode of ['light','dark'])assert.equal(builtinThemes.filter(p=>p.mode===mode).length,6);
  assert.equal(new Set(builtinThemes.map(p=>p.id)).size,12);
  for(const p of builtinThemes){assert.ok(contrastRatio(p.colors.text,p.colors.bg)>=7,p.id+' text');assert.ok(contrastRatio(p.colors.muted,p.colors.bg)>=4.5,p.id+' muted');for(const [key,color] of Object.entries(p.syntax))if(key!=='background')assert.ok(contrastRatio(color,p.syntax.background)>=4.5,p.id+' '+key);assert.ok(contrastRatio(themeVariables(p)['--accent-contrast']!,p.colors.accent)>=4.5,p.id+' accent');}
});
test('legacy warm and neutral preferences migrate without modifying input or losing explicit preset IDs',()=>{
  const legacy={version:1 as const,palette:'neutral' as const};assert.equal(resolveAppearance(legacy).lightPreset,'builtin.porcelain');assert.equal(resolveAppearance(legacy).darkPreset,'builtin.graphite');assert.deepEqual(legacy,{version:1,palette:'neutral'});
  const initial=updateAppearance(undefined,0,{lightPreset:'builtin.sea',darkPreset:'plugin:example.theme/night',codeFont:'local:Consolas'});assert.equal(resolveAppearance(initial).darkPreset,'plugin:example.theme/night');
  const oldClient=updateAppearance(initial,1,{palette:'warm'});assert.equal(oldClient.lightPreset,'builtin.paper');assert.equal(oldClient.codeFont,'local:Consolas');
  assert.deepEqual(updateAppearance(initial,1,{},true),{...defaultAppearance(),revision:2});
  for(const id of ['../../x','url(https://x)','plugin:bad/name;','builtin.x\n'])assert.throws(()=>validateAppearancePatch({lightPreset:id}),/INVALID_PRESET/);
});
test('registered themes are namespaced, immutable and reactive; cleanup preserves other owners and restores fallback',()=>{
  const registry=new ThemePresetRegistry();let events=0;const off=registry.subscribe(()=>events++);
  const definition={id:'night',label:'Custom night',mode:'dark' as const,base:'builtin.abyss' as const,colors:{accent:'#ddbb88'},syntax:{keyword:'#d0aaff'}};
  const a=registry.register('test.first',definition),b=registry.register('test.second',definition);definition.colors.accent='#ffffff';
  assert.equal(a.id,'plugin:test.first/night');assert.equal(registry.resolve(a.id,'dark').colors.accent,'#ddbb88');assert.equal(registry.resolve(a.id,'dark').syntax.keyword,'#d0aaff');assert.ok(Object.isFrozen(registry.getSnapshot()));
  assert.equal(registry.resolve(a.id,'light').id,'builtin.paper');a.dispose();a.dispose();assert.equal(registry.resolve(a.id,'dark').id,'builtin.charcoal');assert.equal(registry.resolve(b.id,'dark').id,b.id);
  b.dispose();assert.equal(registry.getSnapshot().length,12);assert.equal(events,4);off();
});
test('invalid theme metadata, CSS injection, unknown keys, wrong bases and duplicate IDs fail closed',()=>{
  const registry=new ThemePresetRegistry(),base={id:'test',label:'Test',mode:'light' as const};
  for(const invalid of [{...base,colors:{bg:'url(test)'}},{...base,colors:{unknown:'#ffffff'}},{...base,syntax:{keyword:'red'}},{...base,base:'builtin.abyss'},{...base,id:'../test'},{...base,label:[]},{...base,unknown:true}])assert.throws(()=>registry.register('test.plugin',invalid as any),/APPEARANCE_THEME_/);
  registry.register('test.plugin',base);assert.throws(()=>registry.register('test.plugin',base),/DUPLICATE/);assert.equal(registry.resolve('plugin:missing/night','dark').id,defaultPreset('dark').id);
});
test('language-specific highlighting keeps source byte-for-byte and distinguishes useful token categories',()=>{
  for(const [lang,text] of [['typescript','// note\nconst answer: number = 42;\nrender("<script>💡</script>");'],['python','# note\ndef run(x: int = 42):\n    return "hello"'],['json','{"name":"Sea", "size":42, "ready":true}'],['shell','# comment\necho "hello" 42']]){const tokens=highlightCode(text!,lang!);assert.equal(tokens.map(t=>t.text).join(''),text);assert.ok(tokens.some(t=>t.kind==='string'));assert.ok(tokens.some(t=>t.kind==='number'));assert.ok(new Set(tokens.map(t=>t.kind)).size>=4);}
  const text='\r\nconst x = `hello\nworld`; /* unfinished 💡';assert.equal(highlightCode(text,'ts').map(t=>t.text).join(''),text);
  for(const [language,source] of [['js','#'.repeat(120000)],['python','/'.repeat(120000)]])assert.equal(highlightCode(source!,language!).map(t=>t.text).join(''),source);
  assert.deepEqual(highlightCode('<script>alert(1)</script>','unknown'),[{text:'<script>alert(1)</script>',kind:'plain'}]);assert.equal(highlightCode('x'.repeat(131073),'js').length,1);
});
test('syntax extensions update subscribers, layer reversibly and cannot replace or inject displayed source',()=>{
  const registry=new CodeSyntaxRegistry();let changed=0;registry.subscribe(()=>changed++);
  const first=registry.register('typescript',text=>[{text,kind:'number'}]),second=registry.register('ts',text=>[{text,kind:'string'}]);assert.equal(registry.highlight('const x = 42;','ts')[0]!.kind,'string');
  first();assert.equal(registry.highlight('const x = 42;','ts')[0]!.kind,'string');second();assert.equal(registry.highlight('const x = 42;','ts')[0]!.kind,'keyword');assert.equal(changed,4);
  const bad=registry.register('js',()=>[{text:'<img onerror=bad()>',kind:'string'}]);assert.equal(registry.highlight('original','js').map(t=>t.text).join(''),'original');bad();
  const broken=registry.register('js',()=>{throw Error('broken');});assert.equal(registry.highlight('const x = 1;','js')[0]!.kind,'keyword');broken();
});
