import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import type { Project, Session, SshHost } from '../packages/contracts';
import type { NativeCodexService } from '../services/codex-bridge';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'awb-session-workspace-'));
  const store = new StateStore(directory); await store.load();
  const opened: string[] = [], copied: string[] = [];
  const host: SshHost = { id: 'synthetic-host', name: 'Synthetic only', hostname: 'localhost', port: 22, username: 'member', role: 'workspace', identityFile: path.join(directory, 'unused-key-reference'), knownHostsFile: path.join(directory, 'unused-hosts-reference'), ownerId: 'owner', workspaceGeneration: 'test-generation' };
  await store.update(s => { s.hosts = [host]; });
  const native: NativeCodexService = {
    supports: (_h, s) => s.binding.runtime === 'codex',
    defaultDirectory: id => path.join(directory, 'native-codex/workspaces', id),
    connect: async () => { throw Error('No native connection is allowed in workspace tests'); },
    close: async () => {}, dispose: async () => {},
  };
  const controller = new WorkbenchController(store, new SecretStore(directory, { encrypt: () => { throw Error('No test credentials'); }, decrypt: () => '' }), {
    nativeCodex: native, pickDirectory: async () => null, openPath: async target => { opened.push(target); }, copy: value => { copied.push(value); }, nativeCapabilities: () => [],
  }, () => {});
  return { directory, store, native, controller, opened, copied, host,
    close: async () => { await controller.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test('a new native session has a usable managed workspace before its first turn', async () => {
  const f = await fixture(); try {
    const session = await f.controller.call('session/create', { runtime: 'codex', hostId: f.host.id }) as Session;
    assert.equal(session.projectPath, f.native.defaultDirectory(session.id));
    assert.equal((await stat(session.projectPath!)).isDirectory(), true);
    await f.controller.call('session/open-workspace', { sessionId: session.id });
    assert.deepEqual(f.opened, [session.projectPath]); assert.equal(session.messages.length, 0);
  } finally { await f.close(); }
});

test('old unstarted managed directories initialize through open and file browsing without a model connection', async () => {
  const f = await fixture(); try {
    const session = await f.controller.call('session/create', { runtime: 'demo' }) as Session;
    const cwd = f.native.defaultDirectory(session.id);
    await f.store.update(s => { const item = s.sessions[0]!; item.projectPath = cwd; item.binding.runtime = 'codex'; });
    await f.controller.call('session/open-workspace', { sessionId: session.id });
    assert.deepEqual(f.opened, [cwd]); assert.equal((await stat(cwd)).isDirectory(), true);
    await rm(cwd, { recursive: true });
    await f.controller.call('files/browse', { sessionId: session.id, path: cwd });
    assert.equal((await stat(cwd)).isDirectory(), true);
    await f.controller.call('session/copy', { id: session.id, format: 'directory' }); assert.deepEqual(f.copied, [cwd]);
  } finally { await f.close(); }
});

test('session workspace uses its frozen secondary directory even after project folders change or project removal', async () => {
  const f = await fixture(); try {
    const primary = path.join(f.directory, 'primary'), secondary = path.join(f.directory, 'secondary'), other = path.join(f.directory, 'other');
    await Promise.all([primary, secondary, other].map(p => mkdir(p)));
    const project = await f.controller.call('project/create', { name: 'Two folders', paths: [primary, secondary] }) as Project;
    const session = await f.controller.call('session/create', { runtime: 'demo', projectId: project.id, projectPath: secondary }) as Session;
    await f.controller.call('project/update', { id: project.id, paths: [other] });
    await f.controller.call('session/open-workspace', { sessionId: session.id });
    await f.controller.call('path/open', { projectId: project.id });
    assert.deepEqual(f.opened, [secondary, other]);
    await assert.rejects(f.controller.call('session/open-workspace', { sessionId: session.id, path: other }), /不是该会话/);
    await assert.rejects(f.controller.call('path/open', { sessionId: session.id, projectId: project.id, path: other }), /不是该会话/);
    await f.controller.call('project/remove', { id: project.id, confirm: true });
    await f.controller.call('session/open-workspace', { sessionId: session.id });
    assert.equal(f.opened.at(-1), secondary);
  } finally { await f.close(); }
});

test('missing used or user-selected directories are reported without creating empty replacement workspaces', async () => {
  const f = await fixture(); try {
    const session = await f.controller.call('session/create', { runtime: 'demo' }) as Session;
    await assert.rejects(f.controller.call('session/open-workspace', { sessionId: session.id }), /尚未关联/);
    const missing = path.join(f.directory, 'removed-project');
    await f.store.update(s => { const item = s.sessions[0]!; item.projectPath = missing; item.binding.runtime = 'codex'; });
    await assert.rejects(f.controller.call('session/open-workspace', { sessionId: session.id }), /工作区已不存在/);
    await assert.rejects(stat(missing), { code: 'ENOENT' });
    const managed = f.native.defaultDirectory(session.id);
    await f.store.update(s => { const item = s.sessions[0]!; item.projectPath = managed; item.binding.nativeSessionId = 'previously-used'; });
    await assert.rejects(f.controller.call('session/open-workspace', { sessionId: session.id }), /工作区已不存在/);
    await assert.rejects(stat(managed), { code: 'ENOENT' });
    const file = path.join(f.directory, 'not-a-folder'); await writeFile(file, 'keep');
    await f.store.update(s => { s.sessions[0]!.projectPath = file; });
    await assert.rejects(f.controller.call('session/open-workspace', { sessionId: session.id }), /不是文件夹/);
    assert.deepEqual(f.opened, []);
  } finally { await f.close(); }
});
