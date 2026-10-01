import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, SecretStore } from '../apps/desktop/host/store';
import { WorkbenchController } from '../apps/desktop/host/controller';
import type { WorkspaceManagementActions } from '../apps/desktop/host/workspace-management';
import type { SshHost } from '../packages/contracts';

const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'awb-studio-controller-'));
  const store = new StateStore(directory); await store.load();
  const calls: string[] = [];
  const catalogHosts: SshHost[] = [];
  let busy = false;
  const service: WorkspaceManagementActions = {
    list: async () => { calls.push('list'); return { authorityId: 'a', generation: 'g', revision: 1, workspaces: [], connection: { hostname: 'fixture.invalid', port: 22, hostPublicKeys: [] }, enrollmentUrl: '', availability: 'ready' }; },
    plan: async (_host, input) => { calls.push('plan'); return { planId: 'p', planHash: 'a'.repeat(64), operation: input.operation, expectedRevision: input.expectedRevision, expiresAt: new Date(Date.now() + 60000).toISOString(), effects: [], workspaceId: input.workspaceId }; },
    apply: async () => { calls.push('apply'); return { operationId: 'p', state: 'applied', revision: 2, effects: [] }; },
    operation: async () => { calls.push('operation'); return { operationId: 'p', state: 'uncertain', revision: 2, effects: [] }; },
    exportInvite: async () => ({ saved: false }), importPreview: async () => null,
    import: async () => { throw new Error('Unexpected import'); }, busy: () => busy,
    dispose: async () => { calls.push('dispose'); },
  };
  const accountCatalog = {
    list: async (host: SshHost) => {
      catalogHosts.push(structuredClone(host));
      return {
        authorityId: host.authorityId ?? 'a',
        generation: host.authorityGeneration ?? 'g',
        workspaceId: host.remoteWorkspaceId ?? 'workspace',
        revision: catalogHosts.length,
        selectionRevision: 0,
        accounts: [],
        availability: 'ready' as const,
        source: 'native-owner' as const,
      };
    },
    select: async () => { throw new Error('No account selection in fixture'); },
    start: async () => { throw new Error('No account login in fixture'); },
    status: async () => { throw new Error('No account login in fixture'); },
    cancel: async () => { throw new Error('No account login in fixture'); },
    dispose: async () => {},
  };
  const controller = new WorkbenchController(store, new SecretStore(directory, { encrypt: () => { throw new Error('No credential use'); }, decrypt: () => '' }), { workspaceManagement: service, accountCatalog, verifyWorkspaceMember: async host => ({ username: host.username, uid: 1000 }), pickDirectory: async () => null, openPath: async () => {}, copy: () => {}, nativeCapabilities: () => [] }, () => {});
  const host = async (id: string, role: SshHost['role'], username: string, hostname = 'fixture.invalid') => controller.call('host/save', { host: { id, name: id, role, username, hostname, port: 22, identityFile: path.join(directory, id), knownHostsFile: path.join(directory, 'known_hosts') } }) as Promise<SshHost>;
  const admin = await host('admin', 'admin', 'root'), member = await host('member', 'workspace', 'member');
  return { directory, store, controller, service, calls, catalogHosts, host, admin, member, setBusy: (v: boolean) => { busy = v; }, close: async () => { await controller.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test('administrators and mislabeled root identities cannot create native work sessions', async () => {
  const f = await fixture(); try {
    const root = await f.host('mislabeled', 'workspace', 'root');
    for (const runtime of ['codex', 'claude']) for (const host of [f.admin, root]) await assert.rejects(f.controller.call('session/create', { runtime, hostId: host.id }), /管理员/);
    assert.equal(f.store.snapshot().sessions.length, 0);
    const session = await f.controller.call('session/create', { runtime: 'claude', hostId: f.member.id }) as { binding: { hostId: string }; status: string };
    assert.equal(session.binding.hostId, f.member.id); assert.equal(session.status, 'blocked');
  } finally { await f.close(); }
});
test('members cannot invoke management and confirmation is required before remote mutation', async () => {
  const f = await fixture(); try {
    await assert.rejects(f.controller.call('studio/list', { id: f.member.id }), /管理员/);
    await assert.rejects(f.controller.call('studio/apply', { id: f.admin.id, planId: 'p', planHash: 'a'.repeat(64) }), /确认/);
    assert.deepEqual(f.calls, []);
    await f.controller.call('studio/list', { id: f.admin.id });
    await f.controller.call('studio/apply', { id: f.admin.id, planId: 'p', planHash: 'a'.repeat(64), confirm: true });
    assert.deepEqual(f.calls, ['list', 'apply']);
  } finally { await f.close(); }
});
test('late management reads cannot populate a different administrator connection', async () => {
  const f = await fixture(); try {
    const late = deferred<Awaited<ReturnType<WorkspaceManagementActions['list']>>>();
    f.service.list = () => late.promise;
    const request = f.controller.call('studio/list', { id: f.admin.id });
    await f.controller.call('host/save', { host: { ...f.admin, hostname: 'changed.invalid' } });
    late.resolve({ availability: 'unavailable', authorityId: '', generation: '', revision: 0, workspaces: [], connection: { hostname: 'fixture.invalid', port: 22, hostPublicKeys: [] }, enrollmentUrl: '' });
    await assert.rejects(request, /已变更/);
  } finally { await f.close(); }
});
test('pending management mutations lock identity while a label edit preserves its binding', async () => {
  const f = await fixture(); try {
    f.setBusy(true);
    await assert.rejects(f.controller.call('host/save', { host: { ...f.admin, username: 'other' } }), /等待远端/);
    const result = await f.controller.call('host/save', { host: { ...f.admin, name: 'Renamed VPS' } }) as SshHost;
    assert.equal(result.name, 'Renamed VPS'); assert.equal(result.username, 'root');
  } finally { await f.close(); }
});
test('import confirmation registers a verified member once and keeps remote binding on rename', async () => {
  const f = await fixture(); try {
    const imported = { ...f.member, id: 'imported', authorityId: 'authority', authorityGeneration: 'generation', remoteWorkspaceId: 'workspace', deviceId: 'device' };
    let imports = 0; f.service.import = async () => { imports++; return imported; };
    await assert.rejects(f.controller.call('studio/import', { previewId: 'preview' }), /确认/); assert.equal(imports, 0);
    for (let i = 0; i < 2; i++) await f.controller.call('studio/import', { previewId: 'preview', confirm: true });
    assert.equal(f.store.snapshot().hosts.filter(h => h.id === 'imported').length, 1);
    assert.equal(f.store.snapshot().activeWorkspaceId, 'imported');
    assert.equal(f.catalogHosts.length, 2);
    assert.deepEqual(f.store.snapshot().accountCatalogs?.imported, { authorityId: 'authority', generation: 'generation', workspaceId: 'workspace', revision: 2, selectionRevision: 0, accounts: [], availability: 'ready', source: 'native-owner' });
    assert.equal(f.catalogHosts.every(h => h.authorityId === 'authority' && h.authorityGeneration === 'generation' && h.remoteWorkspaceId === 'workspace'), true);
    const renamed = await f.controller.call('host/save', { host: { ...imported, name: 'Renamed member' } }) as SshHost;
    assert.equal(renamed.deviceId, 'device'); assert.equal(renamed.authorityId, 'authority');
    f.service.import = async () => ({ ...imported, role: 'admin' });
    await assert.rejects(f.controller.call('studio/import', { previewId: 'preview', confirm: true }), /管理员/);
  } finally { await f.close(); }
});

test('connecting an existing workspace refreshes the administrator-managed catalog and keeps its identity binding', async () => {
  const f = await fixture(); try {
    const workspace = { id: 'workspace', generation: 'generation', revision: 1, name: 'Member', uid: 1000, username: 'member', root: '/home/member', environment: { runtimes: [], defaultDirectory: '/home/member', env: {} }, allowedAccountIds: [], status: 'active' as const, devices: [], invites: [], nativeQuota: 'unknown' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    f.service.connect = async (_host, _workspaceId) => ({ ...f.member, remoteWorkspaceId: workspace.id, workspaceGeneration: workspace.generation, deviceId: f.member.deviceId });
    f.service.list = async () => ({ authorityId: 'authority', generation: 'generation', revision: 1, workspaces: [workspace], connection: { hostname: f.admin.hostname, port: f.admin.port, hostPublicKeys: [] }, enrollmentUrl: '', availability: 'ready' as const });
    await f.controller.call('studio/connect', { id: f.admin.id, workspaceId: workspace.id, confirm: true });
    assert.equal(f.store.snapshot().activeWorkspaceId, f.member.id);
    assert.equal(f.catalogHosts.length, 1);
    assert.deepEqual(f.store.snapshot().accountCatalogs?.member, { authorityId: 'a', generation: 'g', workspaceId: 'workspace', revision: 1, selectionRevision: 0, accounts: [], availability: 'ready', source: 'native-owner' });
    f.service.list = async () => ({ authorityId: 'authority', generation: 'generation', revision: 2, workspaces: [workspace], connection: { hostname: f.admin.hostname, port: f.admin.port, hostPublicKeys: [] }, enrollmentUrl: '', availability: 'ready' as const });
    await f.controller.call('studio/connect', { id: f.admin.id, workspaceId: workspace.id, confirm: true });
    assert.equal(f.catalogHosts.length, 2);
  } finally { await f.close(); }
});

test('import rejects a catalog from another authority before publishing model account state', async () => {
  const f = await fixture(); try {
    const imported = { ...f.member, id: 'imported', authorityId: 'authority', authorityGeneration: 'generation', remoteWorkspaceId: 'workspace', deviceId: 'device' };
    f.service.import = async () => imported;
    f.catalogHosts.length = 0;
    const catalog = f.controller.developmentServices()['accounts.catalog'] as { list: (host: SshHost) => Promise<unknown> };
    catalog.list = async () => ({ authorityId: 'other-authority', generation: 'other-generation', workspaceId: 'other-workspace', revision: 1, selectionRevision: 0, accounts: [], availability: 'ready', source: 'native-owner' });
    const receipt=await f.controller.call('studio/import', { previewId: 'preview', confirm: true }) as {preparation:{ready:boolean;reason:string}};
    assert.deepEqual(receipt.preparation,{ready:false,reason:'catalog'});
    assert.equal(f.store.snapshot().accountCatalogs?.imported, undefined);
  } finally { await f.close(); }
});
test('preparation is explicit, member-only and cannot report an empty administrator catalog as ready',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.controller.call('studio/prepare',{id:f.member.id}),/确认/);
  await assert.rejects(f.controller.call('studio/prepare',{id:f.admin.id,confirm:true}),/管理员/);
  const result:any=await f.controller.call('studio/prepare',{id:f.member.id,confirm:true});
  assert.deepEqual(result.preparation,{ready:false,reason:'account'});
  assert.equal(f.store.snapshot().sessions.length,0);
 }finally{await f.close();}
});
test('a repeated import cannot overwrite a changed saved connection or old session identity', async () => {
  const f = await fixture(); try {
    f.service.import = async () => ({ ...f.member, username: 'different_member' });
    await assert.rejects(f.controller.call('studio/import', { previewId: 'preview', confirm: true }), /不一致/);
    assert.equal(f.store.snapshot().hosts.find(h => h.id === f.member.id)?.username, 'member');
  } finally { await f.close(); }
});
test('quit fences new management calls and reuses one disposal promise', async () => {
  const f = await fixture(); try {
    const waiting = deferred<void>(); f.service.dispose = async () => { f.calls.push('dispose'); await waiting.promise; };
    const one = f.controller.dispose(), two = f.controller.dispose();
    assert.equal(one, two);
    await assert.rejects(f.controller.call('studio/list', { id: f.admin.id }), /退出/);
    waiting.resolve(); await one; assert.equal(f.calls.filter(c => c === 'dispose').length, 1);
  } finally { await f.close(); }
});


test('confirmed workspace deletion removes only matching local connections and preserves history',async()=>{
 const f=await fixture();try{
  const other=await f.host('other','workspace','member','other.invalid');
  await f.store.update(s=>{s.activeWorkspaceId=f.member.id;});
  const beforeSessions=structuredClone(f.store.snapshot().sessions);
  const workspace={id:'deleted-space',generation:'g',revision:1,name:'Member',uid:1000,username:'member',root:'/home/member',environment:{runtimes:[],defaultDirectory:'/home/member',env:{}},allowedAccountIds:[],status:'deleted',devices:[],invites:[],nativeQuota:'unknown',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} as const;
  f.service.apply=async()=>({operationId:'p',state:'uncertain',revision:2,effects:[],workspace:structuredClone(workspace) as any});
  await f.controller.call('studio/apply',{id:f.admin.id,planId:'p',planHash:'a'.repeat(64),confirm:true});
  assert.ok(f.store.snapshot().hosts.some(h=>h.id===f.member.id));
  f.service.apply=async()=>({operationId:'p',state:'applied',revision:2,effects:[],workspace:structuredClone(workspace) as any});
  await f.controller.call('studio/apply',{id:f.admin.id,planId:'p',planHash:'a'.repeat(64),confirm:true});
  assert.deepEqual(f.store.snapshot().hosts.map(h=>h.id),[f.admin.id,other.id]);
  assert.equal(f.store.snapshot().activeWorkspaceId,undefined);assert.deepEqual(f.store.snapshot().sessions,beforeSessions);
 }finally{await f.close();}
});


test('removing an administrator requires confirmation and preserves members keys and history',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.controller.call('host/remove',{id:f.admin.id}),/确认/);
  f.setBusy(true);await assert.rejects(f.controller.call('host/remove',{id:f.admin.id,confirm:true}),/等待回执/);f.setBusy(false);
  const sessions=structuredClone(f.store.snapshot().sessions);
  await f.controller.call('host/remove',{id:f.admin.id,confirm:true});
  assert.deepEqual(f.store.snapshot().hosts,[f.member]);assert.deepEqual(f.store.snapshot().sessions,sessions);assert.deepEqual(f.calls,[]);
 }finally{await f.close();}
});
test('removing a member blocks running tasks and retains idle task history',async()=>{
 const f=await fixture();try{
  const session=await f.controller.call('session/create',{runtime:'claude',hostId:f.member.id}) as {id:string};
  await f.store.update(s=>{s.sessions.find(item=>item.id===session.id)!.status='running';s.activeWorkspaceId=f.member.id;});
  await assert.rejects(f.controller.call('host/remove',{id:f.member.id,confirm:true}),/仍在处理/);
  await f.store.update(s=>{s.sessions.find(item=>item.id===session.id)!.status='idle';});
  await f.controller.call('host/remove',{id:f.member.id,confirm:true});
  assert.equal(f.store.snapshot().activeWorkspaceId,undefined);assert.equal(f.store.snapshot().sessions[0]?.id,session.id);
 }finally{await f.close();}
});
