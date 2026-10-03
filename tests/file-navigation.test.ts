import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { FileNavigationService, fileResolutionContext } from '../apps/desktop/host/file-navigation';
import { FileActionService } from '../apps/desktop/host/file-actions';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { PluginRegistry } from '../packages/plugins-core';
import { encodeZip } from '../packages/native-resources/archive';
import type { Session } from '../packages/contracts';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'awb-file-resolution-'));
  const cwd = path.join(directory, 'workspace'); await mkdir(cwd);
  const file = async (relative: string, content = 'first\nsecond\n') => { const target = path.join(directory, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); return target; };
  return { directory, cwd, file, close: () => rm(directory, { recursive: true, force: true }) };
}

test('short references find a unique nested file, suffix, dotfile and directory without changing names', async () => {
  const f = await fixture(), service = new FileNavigationService();
  try {
    for (const name of ['README-部署说明.md', 'notes (v2) [中文] 100%.md', '.gitignore', 'literal%20space.md']) {
      const target = await f.file('workspace/project/sub/' + name);
      for (const requested of [name, 'sub/' + name]) assert.equal(await service.resolve({ cwd: f.cwd, requested }), target);
    }
    assert.equal(await service.resolve({ cwd: f.cwd, requested: 'project/sub' }), path.join(f.cwd, 'project/sub'));
  } finally { await f.close(); }
});

test('exact references win; explicit missing paths never redirect to an unrelated same-name file', async () => {
  const f = await fixture(), service = new FileNavigationService();
  try {
    const nested = await f.file('workspace/project/readme.md');
    await assert.rejects(service.resolve({ cwd: f.cwd, requested: './readme.md' }), { code: 'FILE_NOT_FOUND' });
    await assert.rejects(service.resolve({ cwd: f.cwd, requested: path.join(f.cwd, 'readme.md') }), { code: 'FILE_NOT_FOUND' });
    const direct = await f.file('workspace/readme.md');
    assert.equal(await service.resolve({ cwd: f.cwd, requested: 'readme.md', knownPaths: [nested] }), direct);
    await assert.rejects(service.resolve({ cwd: '', requested: 'readme.md' }), /工作目录/);
  } finally { await f.close(); }
});

test('duplicate descendants and multiple project roots fail with concrete candidate paths', async () => {
  const f = await fixture(), service = new FileNavigationService();
  try {
    const a = await f.file('workspace/a/README.md'), b = await f.file('workspace/b/README.md');
    await assert.rejects(service.resolve({ cwd: f.cwd, requested: 'README.md' }), error => {
      assert.equal((error as any).code, 'FILE_PATH_AMBIGUOUS'); assert.deepEqual(new Set((error as any).candidates), new Set([a,b])); return true;
    });
    const other = await f.file('secondary/guide.md');
    assert.equal(await service.resolve({ cwd: f.cwd, requested: 'guide.md', roots: [path.dirname(other)] }), other);
    const duplicate = await f.file('third/guide.md');
    await assert.rejects(service.resolve({ cwd: f.cwd, requested: 'guide.md', roots: [path.dirname(other), path.dirname(duplicate)] }), { code: 'FILE_PATH_AMBIGUOUS' });
  } finally { await f.close(); }
});

test('confirmed changes and structured tool paths resolve outside the root; shell text is never interpreted', async () => {
  const f = await fixture(), service = new FileNavigationService();
  try {
    const target = await f.file('outside/guide.md');
    const session = { projectPath: f.cwd, fileChangeRecords: [{ changes: [{ path: target, kind: 'modify' }, { path: 'deleted.md', kind: 'delete' }] }], activities: [
      { status: 'completed', input: JSON.stringify({ file_path: target }) },
      { status: 'completed', input: 'cd /untrusted; echo filename.md' },
    ] } as Session;
    const context = fileResolutionContext(session); assert.deepEqual(context.knownPaths, [target]);
    assert.equal(await service.resolve({ ...context, requested: 'guide.md' }), target);
    await rm(target); await assert.rejects(service.resolve({ ...context, requested: 'guide.md' }), { code: 'FILE_NOT_FOUND' });
  } finally { await f.close(); }
});

test('bounded search never mistakes a partial result for a unique match and skips dependency trees', async () => {
  const f = await fixture();
  try {
    await f.file('workspace/a/result.md'); await f.file('workspace/b/result.md');
    await assert.rejects(new FileNavigationService({ entries: 1, directories: 10, milliseconds: 2000 }).resolve({ cwd: f.cwd, requested: 'result.md' }), { code: 'FILE_SEARCH_INCOMPLETE' });
    const partial = await new FileNavigationService({entries:100,directories:2,milliseconds:2000}).locate({cwd:f.cwd,requested:'result.md:2'});
    assert.equal(partial.status,'incomplete');assert.equal(partial.requested,'result.md:2');assert.equal(partial.candidates.length,1);assert.equal(path.basename(partial.candidates[0]!), 'result.md');
    await f.file('workspace/node_modules/private.md');
    await assert.rejects(new FileNavigationService().resolve({ cwd: f.cwd, requested: 'private.md' }), { code: 'FILE_NOT_FOUND' });
  } finally { await f.close(); }
});

test('discovery does not traverse junctions or accept foreign-platform paths', async () => {
  const f = await fixture(), service = new FileNavigationService();
  try {
    const target = await f.file('external/guide.md');
    await symlink(path.dirname(target), path.join(f.cwd, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(service.resolve({ cwd: f.cwd, requested: 'guide.md' }), { code: 'FILE_NOT_FOUND' });
    assert.equal(await service.resolve({ cwd: f.cwd, requested: './alias/guide.md' }), target);
    for (const requested of ['javascript:alert(1)', process.platform === 'win32' ? '/remote/file.md' : 'Z:/remote/file.md']) await assert.rejects(service.resolve({ cwd: f.cwd, requested }));
  } finally { await f.close(); }
});

test('candidate source registration handles duplicates, failure, multiple sources and late disabled results', async () => {
  const f = await fixture(), service = new FileNavigationService();
  try {
    const target = await f.file('outside/one.md'), other = await f.file('outside/two.md');
    assert.throws(() => service.registerSource({ id: 'bad' as any, candidates: () => [] }), /INVALID/);
    const off = service.registerSource({ id: 'plugin:test/a', candidates: () => [target] });
    assert.throws(() => service.registerSource({ id: 'plugin:test/a', candidates: () => [] }), /DUPLICATE/);
    assert.equal(await service.resolve({ cwd: f.cwd, requested: 'alias.md' }), target);
    const off2 = service.registerSource({ id: 'plugin:test/b', candidates: () => [other] });
    await assert.rejects(service.resolve({ cwd: f.cwd, requested: 'alias.md' }), { code: 'FILE_PATH_AMBIGUOUS' }); off2(); off();
    let finish!: (paths: string[]) => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const lateOff = service.registerSource({ id: 'plugin:test/late', candidates: () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
    const pending = service.resolve({ cwd: f.cwd, requested: 'alias.md' }); const rejected = assert.rejects(pending, { code: 'FILE_NOT_FOUND' }); await ready; lateOff(); finish([target]); await rejected;
    const failOff = service.registerSource({ id: 'plugin:test/fail', candidates: () => { throw Error('fixture'); } });
    await assert.rejects(service.resolve({ cwd: f.cwd, requested: 'alias.md' }), { code: 'FILE_SOURCE_FAILED' }); failOff();
  } finally { await f.close(); }
});

test('production controller shares resolution across preview, menu, reveal, copy and save with approved plugins', async () => {
  const f = await fixture(), store = new StateStore(path.join(f.directory, 'data')); await store.load();
  const target = await f.file('workspace/project/README-部署说明.md'), external = await f.file('external/plugin-file.md');
  const opened: string[] = [], revealed: string[] = [], copied: string[] = [], saved = path.join(f.directory, 'copy.md');
  const actions = new FileActionService({ openPath: async p => { opened.push(p); }, reveal: p => { revealed.push(p); }, copy: text => { copied.push(text); }, pickSave: async () => saved });
  const controller = new WorkbenchController(store, new SecretStore(store.directory, { encrypt: () => { throw Error('No credentials'); }, decrypt: () => { throw Error('No credentials'); } }), { pickDirectory: async () => null, openPath: async () => {}, copy: () => {}, nativeCapabilities: () => [], fileActions: actions, revealPath: p => { revealed.push(p); } }, () => {});
  const plugins = new PluginRegistry(path.join(f.directory, 'plugins')); await plugins.initialize();
  for (const [id, service] of Object.entries(controller.developmentServices())) if (service) plugins.services.register(id, service, { version: 1 });
  plugins.connectHost(request => controller.call(request.method, request.payload));
  const session = await controller.call('session/create', { runtime: 'demo' }) as Session;
  await store.update(state => { state.sessions.find(item => item.id === session.id)!.projectPath = f.cwd; });
  const call = (method: string, requested = 'README-部署说明.md:2', extra = {}) => controller.call(method, { sessionId: session.id, path: requested, ...extra }) as Promise<any>;
  try {
    const view = await call('files/browse'); assert.equal(view.path, target); assert.equal(view.line, 2); assert.equal(view.content, 'first\nsecond\n');
    assert.equal((await call('files/info')).path, target);
    assert.deepEqual(await call('files/resolve'),{status:'resolved',path:target,line:2});
    await call('files/reveal'); await call('files/open', undefined, { target: 'explorer' }); await call('files/open', undefined, { target: 'default' });
    assert.deepEqual(revealed, [target, target]); assert.deepEqual(opened, [target]);
    await call('files/copy-content'); assert.deepEqual(copied, [view.content]); await call('files/save-as'); assert.equal(await readFile(saved, 'utf8'), view.content);
    const id = 'test.file-resolution', manifest = { schemaVersion: 1, apiVersion: 1, id, name: id, version: '1.0.0', description: 'Synthetic file navigation', capabilities: ['host'], main: 'main.mjs' };
    const source = `export function activate(api){const nav=api.services.get('files.navigation');api.onDispose(nav.registerSource({id:'plugin:'+api.id+'/alias',candidates:request=>request.requested==='plugin-alias.md'?[${JSON.stringify(external)}]:[]}));api.registerCommand('read',payload=>api.call('files/browse',payload));api.registerCommand('pages',()=>{api.services.intercept('files.browser','browse',(next,cwd,path,options)=>next(cwd,path,{...options,pageSize:5}));api.onDispose(api.services.get('files.browser').registerReader({id:'plugin:'+api.id+'/reader',browse:async(cwd,path)=>path.endsWith('reader.txt')?{path,parent:cwd,kind:'text',content:'Registered reader'}:undefined}));});api.registerCommand('wrap',()=>{api.services.intercept('files.navigation','resolve',async(next,request)=>next({...request,requested:request.requested==='wrapped.md'?'plugin-alias.md':request.requested}));});}`;
    const zip = path.join(f.directory, 'plugin.zip'); await writeFile(zip, encodeZip([{ name: 'workbench.plugin.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'main.mjs', data: Buffer.from(source) }])); await plugins.importZip(zip);
    const plugin = (await plugins.list())[0]!;
    await assert.rejects(plugins.setEnabled(id, plugin.hash, true), /Explicit approval/); await plugins.setEnabled(id, plugin.hash, true, true);
    assert.equal((await plugins.command(id, 'read', { sessionId: session.id, path: 'plugin-alias.md' }) as any).path, external);
    await plugins.command(id,'pages',{});const page=await call('files/browse');assert.equal(page.content,'first');assert.equal((await call('files/browse',target,{cursor:page.next})).content,'\nseco');
    const reader=await f.file('workspace/reader.txt','Core bytes');assert.equal((await call('files/browse',reader)).content,'Registered reader');
    await plugins.command(id, 'wrap', {}); assert.equal((await call('files/info', 'wrapped.md')).path, external);
    await plugins.setEnabled(id, plugin.hash, false);assert.equal((await call('files/browse',reader)).content,'Core bytes');assert.equal((await call('files/browse')).content,'first\nsecond\n'); await assert.rejects(call('files/info', 'plugin-alias.md'), /FILE_NOT_FOUND/); await assert.rejects(call('files/info', 'wrapped.md'), /FILE_NOT_FOUND/);
    await plugins.setEnabled(id, plugin.hash, true); assert.equal((await call('files/info', 'plugin-alias.md')).path, external);
    assert.equal(plugin.directory, path.join(f.directory,'plugins','plugins',id)); await rm(plugin.directory,{recursive:true}); await plugins.refresh(); await assert.rejects(call('files/info', 'plugin-alias.md'), /FILE_NOT_FOUND/);
    assert.equal((await call('files/info')).path, target);
  } finally { await plugins.dispose(); await controller.dispose(); await f.close(); }
});
