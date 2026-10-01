import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkbenchController } from '../apps/desktop/host/controller';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import type { SshHost } from '../packages/contracts';
import { parseWorkspaceDiscovery, type WorkspaceDiscovery } from '../services/host-control';

test('workspace discovery rejects late results after changing the saved SSH identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aw-discovery-binding-'));
  const store = new StateStore(directory); await store.load();
  let complete!: (value: WorkspaceDiscovery) => void;
  const pending = new Promise<WorkspaceDiscovery>(resolve => { complete = resolve; });
  const controller = new WorkbenchController(store, new SecretStore(directory, { encrypt: () => { throw Error('No secrets used'); }, decrypt: () => '' }), {
    pickDirectory: async () => null, copy: () => {}, openPath: async () => {}, nativeCapabilities: () => [], discoverWorkspaces: () => pending,
  }, () => {});
  try {
    const host = await controller.call('host/save', { host: { id: 'synthetic-admin', name: 'Synthetic admin', hostname: 'a.example.test', port: 22, username: 'root', role: 'admin', identityFile: path.join(directory, 'key-reference-only'), knownHostsFile: path.join(directory, 'hosts-reference-only') } }) as SshHost;
    const discovery = controller.call('host/discover', { id: host.id });
    const refused = assert.rejects(discovery, /身份已变更/);
    await controller.call('host/save', { host: { ...host, hostname: 'b.example.test' } });
    complete(parseWorkspaceDiscovery('identity\t0\naccount\troot\t0\t/root\t/bin/bash\nregistry\tabsent-or-inaccessible\n', host, new Date().toISOString()));
    await refused;
  } finally { await rm(directory, { recursive: true, force: true }); }
});
