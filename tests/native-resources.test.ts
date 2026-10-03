import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, access } from 'node:fs/promises';
import { NativeMemoryService } from '../packages/native-memory';
import { BEGIN, END, PROJECTION, readNativeSources } from '../packages/native-memory/sources';
import { digest } from '../packages/native-resources/files';
import { NativeSkillsService } from '../packages/native-skills';
import { PluginRegistry, parseManifest } from '../packages/plugins-core';
import { collectDirectory, decodeZip, encodeZip, readArchive } from '../packages/native-resources/archive';
import { isFrameworkSnapshot } from '../packages/memory-core';
import { NativeResources } from '../apps/desktop/host/native-resources';
import { EventEmitter } from 'node:events';
import { CodexNativeAdapter, type CodexRpcClient } from '../packages/runtime-codex';
import { missingBridgeChecks, type BridgeEvidence } from '../packages/session-core';
import { createFrameworkSnapshot, sharedHash } from '../packages/memory-core';

const skill = (name: string, body = 'Read references/example.md when relevant.') => `---\nname: ${name}\ndescription: Test native skill\n---\n${body}\n`;
async function put(file: string, content: string | Buffer) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); }
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aw-native-resources-')); t.after(() => rm(root, { recursive: true, force: true }));
  return { root, data: path.join(root, 'data'), home: path.join(root, 'home'), codexHome: path.join(root, 'home', '.codex'), claudeHome: path.join(root, 'home', '.claude') };
}
test('native skills scan both personal and official locations, deduplicate links, resolve conflicts with persistent toggles', async t => {
  const candidates=[process.env.AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE,path.join(process.cwd(),'build/runtime/codex-0.155.1/codex.exe'),path.join(os.homedir(),'AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe')].filter((value):value is string=>!!value); let codexExecutable=candidates[0]; for(const candidate of candidates)try{await access(candidate);codexExecutable=candidate;break;}catch{} if(!codexExecutable)codexExecutable=path.join(os.tmpdir(),'agentworkbench-test-codex.exe');
  const f = { ...await fixture(t), codexExecutable }; await put(path.join(f.codexHome, 'skills', '.system', 'system-skill', 'SKILL.md'), skill('official-skill')); await put(path.join(f.codexHome, 'skills', 'first', 'SKILL.md'), skill('same-name')); await put(path.join(f.claudeHome, 'skills', 'second', 'SKILL.md'), skill('same-name'));
  await put(path.join(f.codexHome, 'plugins', 'cache', 'openai-bundled', 'example', '1.0.0', 'skills', 'one', 'SKILL.md'), skill('bundled'));
  await mkdir(path.join(f.home, '.agents', 'skills'), { recursive: true }); await symlink(path.join(f.codexHome, 'skills', 'first'), path.join(f.home, '.agents', 'skills', 'same-target'), 'junction');
  let service = new NativeSkillsService(f.data, f); await service.initialize(); let scan = await service.scan(); assert.equal(scan.skills.length, 4); assert.equal(scan.errors.length, 0); assert.equal(scan.skills.find(s => s.name === 'official-skill')!.origins[0]!.kind, 'official'); assert.equal(scan.skills.find(s => s.name === 'bundled')!.origins[0]!.kind, 'official');
  const duplicate = scan.skills.filter(s => s.name === 'same-name'); assert.equal(duplicate.length, 2); assert.ok(duplicate.every(s => !s.available));
  const snapshot = await service.createDiscoverySnapshot({ sessionId: 'session' }); await service.setEnabled(duplicate[0]!.id, false); assert.equal(isFrameworkSnapshot(snapshot), false);
  service = new NativeSkillsService(f.data, f); await service.initialize(); scan = await service.scan(); assert.equal(scan.skills.find(s => s.id === duplicate[1]!.id)!.available, true); assert.equal(scan.skills.find(s => s.id === duplicate[0]!.id)!.enabled, false);
  const original = scan.skills.find(s => s.id === duplicate[1]!.id)!; await put(original.path, skill('changed')); await assert.rejects(service.readMarkdown(original.id, original.hash), /changed/);
  await assert.rejects(readFile(path.join(f.data, 'shared', 'skills', 'catalog.json')));
});
test('skill ZIP roundtrip retains supporting resources and imports only into the selected native home', async t => {
  const f = await fixture(t), zip = path.join(f.root, 'skill.zip'); const source = [{ name: 'example/SKILL.md', data: Buffer.from(skill('zip-skill')) }, { name: 'example/references/example.md', data: Buffer.from('A supporting document.') }, { name: 'example/assets/test.bin', data: Buffer.from([0, 10, 200, 255]) }]; await put(zip, encodeZip(source));
  const service = new NativeSkillsService(f.data, f); await service.initialize(); const result = await service.importZip(zip, 'claude'); const imported = result.skills.find(s => s.name === 'zip-skill')!; assert.ok(imported.directory.startsWith(f.claudeHome));
  const output = path.join(f.root, 'export.zip'); await service.exportZip(imported.id, imported.hash, output); const files = await readArchive(output); assert.equal(files.length, 3); assert.deepEqual(files.find(f => f.name === 'assets/test.bin')!.data, Buffer.from([0, 10, 200, 255])); await assert.rejects(service.importZip(zip, 'claude'), /exists/);
});
test('Skill import requires a chosen provider and cancellation never installs anything', async t => {
  const f = await fixture(t); let opened = 0;
  const host = new NativeResources(f.data, { openZip: async () => { opened++; return null; }, saveZip: async () => null }, () => [], () => {}, f.home); await host.initialize(); t.after(() => host.dispose());
  for (const provider of [undefined, 'auto', 'other', ['codex'], {}]) await assert.rejects(host.call('native-skills/import', { provider }), /Select Codex or Claude Code/);
  assert.equal(opened, 0);
  for (const provider of ['codex', 'claude']) assert.equal(await host.call('native-skills/import', { provider }), null);
  assert.equal(opened, 2); assert.equal((await host.skills.scan()).skills.length, 0); await assert.rejects(readdir(path.join(f.home, '.agents', 'skills'))); await assert.rejects(readdir(path.join(f.claudeHome, 'skills')));
});

test('plugin ZIP picker and dropped file share validation without executing imported code', async t => {
  const f=await fixture(t);let opened=0;
  const host=new NativeResources(f.data,{openZip:async()=>{opened++;return null;},saveZip:async()=>null},()=>[],()=>{},f.home);await host.initialize();t.after(()=>host.dispose());
  assert.equal(await host.call('extensions/import',{}),null);assert.equal(opened,1);
  for(const filePath of ['',null,[],'relative.zip',path.join(f.root,'file.txt')])await assert.rejects(host.call('extensions/import',{filePath}));
  const zip=path.join(f.root,'plugin.ZIP'),manifest={schemaVersion:1,apiVersion:1,id:'drop.test',name:'Drop test',description:'Fixture',version:'1.0.0',capabilities:['host'],main:'main.mjs'};
  await put(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from('throw Error("Import must not execute this module")')} ]));
  await host.call('extensions/import',{filePath:zip});const installed=(await host.plugins.list())[0]!;assert.equal(installed.enabled,false);assert.equal(installed.approved,false);assert.equal(installed.error,undefined);assert.equal(opened,1);
  await assert.rejects(host.call('extensions/import',{filePath:zip}),/exists/);assert.equal((await host.plugins.list()).length,1);
});

test('exported personal Skill installs into the recipient chosen personal provider with resources intact', async t => {
  const f = await fixture(t), root = path.join(f.codexHome, 'skills', 'shared-skill'), archive = path.join(f.root, 'shared-skill.zip');
  await put(path.join(root, 'SKILL.md'), skill('shared-skill')); await put(path.join(root, 'references', 'guide.md'), 'Shared reference');
  const host = new NativeResources(f.data, { openZip: async () => archive, saveZip: async () => archive }, () => [], () => {}, f.home); await host.initialize(); t.after(() => host.dispose());
  const original = (await host.skills.scan()).skills[0]!; assert.equal(original.origins[0]!.kind, 'personal'); await host.call('native-skills/export', { id: original.id, hash: original.hash });
  await host.call('native-skills/import', { provider: 'claude' }); assert.equal(await readFile(path.join(f.claudeHome, 'skills', 'shared-skill', 'references', 'guide.md'), 'utf8'), 'Shared reference'); await assert.rejects(readdir(path.join(f.home, '.agents', 'skills')));
  await host.call('native-skills/import', { provider: 'codex' }); assert.equal(await readFile(path.join(f.home, '.agents', 'skills', 'shared-skill', 'references', 'guide.md'), 'utf8'), 'Shared reference');
  const imported = (await host.skills.scan()).skills.filter(entry => entry.id !== original.id); assert.equal(imported.length, 2); assert.deepEqual(imported.map(entry => entry.origins[0]!.provider).sort(), ['claude', 'codex']); assert.ok(imported.every(entry => entry.origins[0]!.kind === 'personal'));
  await assert.rejects(host.call('native-skills/import', { provider: 'claude' }), /already exists/); assert.equal(await readFile(path.join(root, 'SKILL.md'), 'utf8'), skill('shared-skill'));
});

test('dropped Skill ZIP uses the selected native provider without opening a file picker', async t => {
  const f = await fixture(t), archive = path.join(f.root, 'dropped-skill.ZIP'); let opened = 0;
  await put(archive, encodeZip([{ name: 'SKILL.md', data: Buffer.from(skill('dropped-skill')) }, { name: 'references/guide.md', data: Buffer.from('DROPPED_RESOURCE') }]));
  const host = new NativeResources(f.data, { openZip: async () => { opened++; return null; }, saveZip: async () => null }, () => [], () => {}, f.home); await host.initialize(); t.after(() => host.dispose());
  for (const filePath of ['', null, [], 'relative.zip', path.join(f.root, 'file.txt')]) await assert.rejects(host.call('native-skills/import', { provider: 'claude', filePath }));
  await assert.rejects(host.call('native-skills/import', { filePath: archive }), /Select Codex or Claude Code/);
  const invalid = path.join(f.root, 'invalid.zip'); await put(invalid, 'not an archive'); await assert.rejects(host.call('native-skills/import', { provider: 'claude', filePath: invalid }), /ZIP/);
  const missing = path.join(f.root, 'missing.zip'); await put(missing, encodeZip([{ name: 'README.md', data: Buffer.from('No skill') }])); await assert.rejects(host.call('native-skills/import', { provider: 'claude', filePath: missing }), /SKILL.md/);
  assert.equal((await host.skills.scan()).skills.length, 0);
  await host.call('native-skills/import', { provider: 'claude', filePath: archive });
  assert.equal(await readFile(path.join(f.claudeHome, 'skills', 'dropped-skill', 'references', 'guide.md'), 'utf8'), 'DROPPED_RESOURCE'); await assert.rejects(readdir(path.join(f.home, '.agents', 'skills')));
  await assert.rejects(host.call('native-skills/import', { provider: 'claude', filePath: archive }), /already exists/);
  await host.call('native-skills/import', { provider: 'codex', filePath: archive }); assert.equal(await readFile(path.join(f.home, '.agents', 'skills', 'dropped-skill', 'SKILL.md'), 'utf8'), skill('dropped-skill'));
  assert.equal(opened, 0);
});

test('native Skill display uses Codex interface metadata and icons without changing model discovery metadata', async t => {
  const f = await fixture(t), root = path.join(f.codexHome, 'skills', 'native-display');
  await put(path.join(root, 'SKILL.md'), skill('native-machine-name'));
  await put(path.join(root, 'agents', 'openai.yaml'), 'interface:\n  display_name: "原生显示标题"\n  short_description: >-\n    原生短描述\n    保持单行\n  icon_small: "./assets/icon.svg"\n');
  await put(path.join(root, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>');
  const service = new NativeSkillsService(f.data, f); await service.initialize(); let record = (await service.scan()).skills[0]!;
  assert.equal(record.name, 'native-machine-name'); assert.equal(record.displayName, '原生显示标题'); assert.equal(record.shortDescription, '原生短描述 保持单行'); assert.match(record.icon!, /^data:image\/svg\+xml;base64,/);
  const snapshot = await service.createDiscoverySnapshot({ sessionId: 'native-display' }); const entry = JSON.parse(snapshot.items[0]!.content).entries[0]; assert.equal(entry.name, 'native-machine-name'); assert.equal(entry.description, 'Test native skill'); assert.equal(entry.icon, undefined);
  await put(path.join(root, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/remote.png"/></svg>'); record = (await service.scan()).skills[0]!; assert.equal(record.icon, undefined); assert.equal(record.displayName, '原生显示标题');
});
test('Claude Skills without OpenAI metadata use their native description and shared links retain both origins', async t => {
  const f = await fixture(t), root = path.join(f.claudeHome, 'skills', 'claude-only'), markdown = '---\nname: claude-only\ndescription: |\n  Claude native description.\n  Additional invocation details.\n---\nKeep the original skill body.\n';
  await put(path.join(root, 'SKILL.md'), markdown); await mkdir(path.join(f.codexHome, 'skills'), { recursive: true }); await symlink(root, path.join(f.codexHome, 'skills', 'linked-from-claude'), 'junction');
  const service = new NativeSkillsService(f.data, f); await service.initialize(); const scan = await service.scan(); assert.equal(scan.skills.length, 1); const entry = scan.skills[0]!;
  assert.equal(entry.displayName, 'claude-only'); assert.equal(entry.shortDescription, 'Claude native description. Additional invocation details.'); assert.equal(entry.icon, undefined); assert.equal(entry.available, true); assert.deepEqual(entry.origins.map(origin => origin.provider).sort(), ['claude', 'codex']);
  const catalog = JSON.parse((await service.createDiscoverySnapshot({ sessionId: 'claude-fallback' })).items[0]!.content); assert.equal(catalog.entries[0].description, 'Claude native description.\nAdditional invocation details.'); assert.equal(await readFile(path.join(root, 'SKILL.md'), 'utf8'), markdown); await assert.rejects(readFile(path.join(root, 'agents', 'openai.yaml')));
});

test('archive rejects traversal, alternate streams, duplicate names and corrupt content while exporting linked bytes', async t => {
  for (const name of ['../evil', '/absolute', 'C:/secret', 'safe/../../evil', 'safe/file:stream', 'CON', 'file.']) assert.throws(() => encodeZip([{ name, data: Buffer.from('x') }]));
  assert.throws(() => encodeZip([{ name: 'a', data: Buffer.from('x') }, { name: 'A', data: Buffer.from('y') }]), /Duplicate/);
  const valid = encodeZip([{ name: 'safe.txt', data: Buffer.from('abc') }]), broken = Buffer.from(valid); broken[40] = broken[40]! ^ 1; assert.throws(() => decodeZip(broken));
  assert.deepEqual(decodeZip(valid)[0]!.data, Buffer.from('abc'));
  const f=await fixture(t),resource=path.join(f.root,'resource'),outside=path.join(f.root,'outside');await put(path.join(resource,'SKILL.md'),skill('archive'));await put(path.join(outside,'private.txt'),'Portable linked content');await symlink(outside,path.join(resource,'linked'),'junction');const entries=await collectDirectory(resource);assert.equal(entries.find(e=>e.name==='linked/private.txt')?.data.toString(),'Portable linked content');
});
const manifest = (id: string) => ({ schemaVersion: 1, id, name: 'Example plugin', description: 'An extensible test plugin', version: '1.0.0', apiVersion: 1, capabilities: ['context', 'theme'], contributes: { context: 'Prefer verified evidence.', theme: { variables: { '--accent': '#ab6753' } } } });
test('declarative plugin starts disabled, contributes real context and theme, exports the complete package', async t => {
  const f = await fixture(t), file = path.join(f.root, 'theme.zip'); await put(file, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(manifest('test.theme'))) }])); const service = new PluginRegistry(f.data); await service.initialize(); t.after(() => service.dispose()); await service.importZip(file);
  let record = (await service.list())[0]!; assert.equal(record.enabled, false); assert.deepEqual((await service.appearance()).variables, {}); await service.setEnabled(record.manifest.id, record.hash, true); assert.equal((await service.appearance()).variables['--accent'], '#ab6753'); assert.match((await service.context({ sessionId: 's', runtime: 'demo' }))[0]!.content, /verified/);
  await service.exportZip(record.manifest.id, record.hash, path.join(f.root, 'plugin-export.zip')); assert.equal((await readArchive(path.join(f.root, 'plugin-export.zip'))).length, 1);
  await service.setEnabled(record.manifest.id, record.hash, false); assert.equal((await service.context({ sessionId: 's', runtime: 'demo' })).length, 0);
});
test('host plugin requires exact package approval, intercepts host requests and unregisters when disabled', async t => {
  const f = await fixture(t), file = path.join(f.root, 'host.zip'); const m = { ...manifest('test.host'), main: 'main.mjs', capabilities: ['context', 'host'] }; delete (m.contributes as any).theme;
  await put(file, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(m)) }, { name: 'main.mjs', data: Buffer.from('export function activate(api) { api.onContext(() => "Host hook context"); api.registerCommand("ping", value => ({pong:value})); api.useHost(async (request,next) => request.method === "example" ? {replaced:true} : next()); }') }]));
  const service = new PluginRegistry(f.data); await service.initialize(); t.after(() => service.dispose()); await service.importZip(file); let record = (await service.list())[0]!;
  await assert.rejects(service.setEnabled(record.manifest.id, record.hash, true), /Explicit approval/); await service.setEnabled(record.manifest.id, record.hash, true, true);
  assert.deepEqual(await service.command('test.host', 'ping', 4), { pong: 4 }); assert.deepEqual(await service.dispatch({ method: 'example', payload: {} }, async () => ({ original: true })), { replaced: true }); assert.equal((await service.context({ sessionId: 's', runtime: 'demo' })).length, 2);
  await service.setEnabled(record.manifest.id, record.hash, false); assert.deepEqual(await service.dispatch({ method: 'example', payload: {} }, async () => ({ original: true })), { original: true }); await assert.rejects(service.command('test.host', 'ping', 4));
  await put(path.join(record.directory, 'main.mjs'), 'export function activate() {}'); record = (await service.list())[0]!; assert.equal(record.approved, false); await assert.rejects(service.setEnabled(record.manifest.id, record.hash, true), /Explicit approval/);
});
test('resource host exposes source-backed memory and native skill metadata in one revocable context', async t => {
  const f = await fixture(t); await put(path.join(f.codexHome, 'memories', 'memory_summary.md'), 'A native preference'); await put(path.join(f.codexHome, 'skills', 'one', 'SKILL.md'), skill('one', 'Read ${CLAUDE_SKILL_DIR}/references/example.md. 保留技能原文。'));
  const host = new NativeResources(f.data, { openZip: async () => null, saveZip: async () => null }, () => [], () => {}, f.home); await host.initialize(); t.after(() => host.dispose());
  await host.call('native-memory/configure', { enabled: true }); const snapshot = await host.context({ id: 'session', binding: { runtime: 'demo' } } as any); assert.deepEqual(snapshot.items.map(item => item.kind), ['skill-catalog']);
  const entry = JSON.parse(snapshot.items.find(item => item.kind === 'skill-catalog')!.content).entries[0]; assert.match(entry.warning, /^Contains Claude/); assert.doesNotMatch(entry.warning, /[\u4e00-\u9fff]/); assert.match((await host.skills.readMarkdown(entry.id, entry.hash)).markdown, /保留技能原文/);
  await host.call('native-memory/configure', { enabled: false }); assert.equal(isFrameworkSnapshot(snapshot), false);
  assert.throws(() => parseManifest({ ...manifest('unsafe'), contributes: { theme: { variables: { '--accent': 'url(https://x)' } } } }), /Invalid theme/);
});
test('native initial context attaches once to a proven empty central thread and rejects nonempty history', async () => {
  const binding={runtime:'codex' as const,provider:'openai',accountRef:'native-account',executionId:'local-test',egress:'vps' as const,hostId:'test-host'};
  const evidence={runtime:'codex',runtimeVersion:'0.155.1',hostId:'test-host',executionId:'local-test',accountRef:'native-account',checks:Object.fromEntries(missingBridgeChecks('codex').map(key=>[key,'verified']))} as BridgeEvidence;
  const rpc=new EventEmitter() as EventEmitter & {sessionId:string;request:(method:string,params?:unknown)=>Promise<unknown>;bindRootThread:(id:string)=>void};rpc.sessionId='test-session';rpc.bindRootThread=()=>{};let nonempty=false;
  rpc.request=async method=>method==='thread/start'?{thread:{id:'empty-thread'}}:method==='thread/turns/list'?{data:nonempty?[{id:'prior-turn'}]:[],nextCursor:null}:{};
  const adapter=new CodexNativeAdapter(rpc as unknown as CodexRpcClient,binding,{environmentId:'local-test',cwd:'D:\\fixture'},evidence);
  await adapter.registerEnvironment('ws://127.0.0.1:1234/'+'a'.repeat(64));await adapter.startThread();
  const content='Native context sentinel',snapshot=createFrameworkSnapshot([{id:'native-memory',kind:'memory',title:'Memory',content,sourceHash:sharedHash(content)}],{sessionId:'test-session',revision:1,memoryEnabled:true});
  nonempty=true;await assert.rejects(adapter.attachContextToEmptyThread({snapshot}),/not empty/);nonempty=false;await adapter.attachContextToEmptyThread({snapshot});assert.match(adapter.sharedContext.prepare('Task').input,/Native context sentinel/);await assert.rejects(adapter.attachContextToEmptyThread({snapshot}),/only attach once/);
});
