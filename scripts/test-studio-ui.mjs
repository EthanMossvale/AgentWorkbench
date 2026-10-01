// HISTORICAL pre-U70 UI fixture: expects the retired budget/discovery layout.
// Current administration acceptance: node scripts/test-administration-ui.mjs.
// This script is retained as historical coverage, not current passing evidence.
import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';
import { revealControl } from './ui-control-helpers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

// Synthetic IPC only: no SSH, enrollment, key generation, native file dialog,
// real credentials, model requests, screenshots, or existing app interaction.
// Build first, then run serially with the other Electron UI checks.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build/qa');
const dataDir = path.join(output, `studio-synthetic-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.AGENT_WORKBENCH_TEST_TRAY_FAIL;
const checks = [], errors = [];
let app, ownedProcess, ownedPid, failure;
let forcedCleanup = false;
const bounded = (promise, description, timeout = 15000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeout); })]).finally(() => clearTimeout(timer));
};
const evaluate = (callback, argument) => bounded(app.evaluate(callback, argument), 'owned Electron main evaluation');
const check = async (name, run) => {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; }
};
const waitUntil = async (predicate, description) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await bounded(predicate(), description, Math.max(1, end - Date.now()))) return; await pause(25); }
  throw new Error(`Timed out waiting for ${description}`);
};
const host = (id, role, username) => ({ id, name: `Synthetic ${id}`, hostname: 'fixture.example.invalid', port: 2222, username, role, identityFile: `C:\\synthetic-only\\${id}-identity`, knownHostsFile: 'C:\\synthetic-only\\known_hosts', ownerId: 'local-owner', workspaceGeneration: 'synthetic-generation' });
const preview = (id, overrides = {}) => ({ previewId: id, workspaceName: `Synthetic workspace ${id}`, username: `member_${id}`, hostname: 'fixture.example.invalid', port: 2222, expiresAt: new Date(Date.now() + 300000).toISOString(), authorityId: 'synthetic-authority', workspaceId: `workspace-${id}`, enrollmentUrl: 'https://fixture.example.invalid:9443/workspaces/enroll', ...overrides });
const observedAt = new Date().toISOString();
const managed = (id, overrides = {}) => ({ id, generation: `generation-${id}`, revision: 1, name: `Managed ${id}`, uid: id === 'alpha' ? 1001 : 1002, username: `managed_${id}`, root: `/home/managed_${id}/workspaces`, environment: { runtimes: ['codex', 'claude'], defaultDirectory: `/home/managed_${id}/workspaces`, env: { LANG: 'en_US.UTF-8' } }, allowedAccountIds: ['account-one'], budget: { period: 'month', limit: 25, unit: 'usd', enforcement: 'unavailable' }, nativeQuota: 'unknown', status: 'active', devices: [], invites: [], createdAt: observedAt, updatedAt: observedAt, ...overrides });
const studioFixture = {
  authorityId: 'synthetic-authority', generation: 'synthetic-generation', revision: 7, availability: 'ready',
  connection: { hostname: 'fixture.example.invalid', port: 2222, hostPublicKeys: [] }, enrollmentUrl: 'https://fixture.example.invalid:9443/workspaces/enroll',
  workspaces: [managed('alpha', {
    devices: [
      { id: 'device-one', label: 'Alpha first device', fingerprint: 'SHA256:synthetic-first-device', publicKey: 'SYNTHETIC_PUBLIC_KEY_METADATA', createdAt: observedAt, status: 'active' },
      { id: 'device-two', label: 'Alpha second device', fingerprint: 'SHA256:synthetic-second-device', publicKey: 'SYNTHETIC_PUBLIC_KEY_METADATA', createdAt: observedAt, status: 'active' },
      { id: 'device-revoked', label: 'Alpha old device', fingerprint: 'SHA256:synthetic-revoked-device', publicKey: 'SYNTHETIC_PUBLIC_KEY_METADATA', createdAt: observedAt, status: 'revoked' },
    ],
    invites: [
      { id: 'invite-one', label: 'Alpha invitation', expiresAt: new Date(Date.now() + 3600000).toISOString(), status: 'active' },
      { id: 'invite-used', label: 'Already used invitation', expiresAt: new Date(Date.now() + 3600000).toISOString(), status: 'redeemed' },
    ],
  }), managed('beta'), managed('removed', { status: 'deleted' })],
};
const discovered = (id, username, uid, overrides = {}) => ({
  id, name: `Discovered ${id}`, username, uid, home: `/home/${username}`, root: `/home/${username}/workspaces`, classification: 'known-device-workspace', sources: ['/etc/synthetic/workspaces.json'], confidence: 'high', observedAt,
  ssh: { authorizationStatus: 'present', privateKeyStatus: 'not-inspected', authorizedKeys: [] },
  runtimes: Object.fromEntries(['codex', 'claude'].map(name => [name, { installed: 'unknown', config: { status: 'unknown', values: {} }, account: { status: 'unknown' }, warnings: [] }])), warnings: [], ...overrides,
});
const discoveryFixture = { hostId: 'admin', ownerId: 'local-owner', generation: 'synthetic-generation', observedAt, effectiveUid: 0, privilege: 'root', registry: 'recognized', publicKeyFingerprints: [], accounts: [], stateHash: 'synthetic-discovery-hash', warnings: [], workspaces: [discovered('candidate', 'discovered_member', 1357), discovered('managed', 'managed_alpha', 1001), discovered('conflict', 'ambiguous_member', 1999, { confidence: 'conflict' }), discovered('root', 'root', 0)] };

async function closeOwnedInstance() {
  if (!app) return;
  try { await bounded(app.close(), 'normal owned test-instance cleanup'); }
  catch (error) {
    errors.push(`Test cleanup: ${error.message}`);
    if (ownedProcess && Number.isSafeInteger(ownedPid) && ownedPid > 0 && ownedProcess.pid === ownedPid && ownedProcess.exitCode === null && ownedProcess.signalCode === null) {
      forcedCleanup = true;
      const exited = new Promise(resolve => ownedProcess.once('exit', resolve));
      try {
        if (process.platform === 'win32') {
          await bounded(new Promise((resolve, reject) => {
            const killer = spawn('taskkill.exe', ['/PID', String(ownedPid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
            killer.once('error', reject);
            killer.once('exit', code => code === 0 || ownedProcess.exitCode !== null || ownedProcess.signalCode !== null ? resolve() : reject(new Error(`Owned-process tree cleanup returned ${code}`)));
          }), 'owned Windows test process tree cleanup');
        } else ownedProcess.kill('SIGKILL');
        await bounded(exited, 'owned test process exit after cleanup');
      } catch (cleanupError) { errors.push(`Forced test cleanup: ${cleanupError.message}`); }
    }
    if (!failure) throw error;
  }
}

try {
  app = await electron.launch({ executablePath: electronPath, args: [root], cwd: root, env, timeout: 45000 });
  ownedProcess = app.process(); ownedPid = ownedProcess.pid;
  const page = await bounded(app.firstWindow(), 'owned renderer window');
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.workbench);
  const state = await bounded(page.evaluate(() => window.workbench.call('state/get')), 'initial synthetic state');
  state.hosts = [host('admin', 'admin', 'root'), { ...host('admin-b', 'admin', 'root'), hostname: 'second-fixture.example.invalid' }, host('existing-member', 'workspace', 'existing_member')];
  state.accountCatalogs = {};
  await evaluate(({ ipcMain, BrowserWindow }, fixture) => {
    const harness = globalThis.__studioUiHarness = {
      state: fixture.state, requests: [], unexpected: [], pending: [], previews: {}, previewQueue: [], importQueue: [], stateQueue: [],
      studio: fixture.studio, discovery: fixture.discovery, listQueue: [], planQueue: [], applyQueue: [], operationQueue: [], exportQueue: [], plans: {}, nextPlan: 1,
      otherStudio: { ...fixture.studio, authorityId: 'second-authority', revision: 41, workspaces: [{ ...fixture.studio.workspaces[1], id: 'remote-b', name: 'Only on administrator B' }], connection: { ...fixture.studio.connection, hostname: 'second-fixture.example.invalid' } },
    };
    const ok = value => ({ ok: true, value });
    const publish = () => BrowserWindow.getAllWindows()[0].webContents.send('workbench:state', harness.state);
    const respond = (method, queued, complete) => {
      if (queued.hold) return new Promise(resolve => harness.pending.push({ method, id: queued.value?.previewId ?? queued.previewId ?? '', finish: () => resolve(complete()) }));
      return complete();
    };
    const catalog = id => id === 'admin-b' ? harness.otherStudio : harness.studio;
    const applyMutation = saved => {
      const snapshot = catalog(saved.hostId), values = saved.input.values ?? {};
      let workspace = snapshot.workspaces.find(item => item.id === saved.input.workspaceId);
      if (saved.input.operation === 'workspace/create' || saved.input.operation === 'workspace/adopt') {
        workspace = { id: saved.plan.workspaceId, generation: `generation-${saved.plan.planId}`, revision: 1, uid: values.uid ?? 2000 + snapshot.workspaces.length, status: 'active', devices: [], invites: [], nativeQuota: 'unknown', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...structuredClone(values) };
        snapshot.workspaces.push(workspace);
      } else if (workspace) {
        if (saved.input.operation === 'workspace/update') Object.assign(workspace, structuredClone(values));
        if (saved.input.operation === 'workspace/suspend') workspace.status = values.suspended === false ? 'active' : 'suspended';
        if (saved.input.operation === 'workspace/delete') workspace.status = 'deleted';
        if (saved.input.operation === 'device/revoke') workspace.devices.find(item => item.id === values.deviceId).status = 'revoked';
        if (saved.input.operation === 'invite/revoke') workspace.invites.find(item => item.id === values.inviteId).status = 'revoked';
        if (saved.input.operation === 'invite/create') workspace.invites.push({ id: `new-${saved.plan.planId}`, label: values.label, expiresAt: new Date(Date.now() + values.ttlSeconds * 1000).toISOString(), status: 'active' });
        workspace.revision++;
      }
      snapshot.revision++;
      return workspace;
    };
    ipcMain.removeHandler('workbench:call');
    ipcMain.handle('workbench:call', async (_event, method, payload = {}) => {
      harness.requests.push({ method, payload });
      if (method === 'state/get') {
        const queued = harness.stateQueue.shift() ?? {};
        return respond(method, queued, () => queued.error ? { ok: false, error: queued.error } : ok(harness.state));
      }
      if (method === 'navigation/get') return ok({ sessionId: null });
      if (method === 'codex-auth/current') return ok(null);
      if (method === 'host/discover') return ok({ ...harness.discovery, hostId: payload.id });
      if (method === 'accounts/list') return ok({ authorityId: 'synthetic-authority', generation: 'synthetic-generation', revision: 3, workspaceId: payload.id, selectionRevision: 0, availability: 'ready', accounts: ['one', 'two'].map(number => ({ id: `account-${number}`, generation: `generation-${number}`, provider: 'codex', status: 'authenticated', email: `shared-${number}@example.invalid`, observedAt: new Date().toISOString() })) });
      if (['studio/list', 'studio/plan', 'studio/apply', 'studio/operation', 'studio/invite-export'].includes(method) && !harness.state.hosts.some(host => host.id === payload.id && host.role === 'admin')) {
        harness.unexpected.push({ method, payload }); return { ok: false, error: 'Synthetic administrator authority required' };
      }
      if (method === 'studio/list') {
        const queued = harness.listQueue.shift() ?? {};
        const value = structuredClone(queued.value ?? catalog(payload.id));
        return respond(method, queued, () => queued.error ? { ok: false, error: queued.error } : ok(value));
      }
      if (method === 'studio/plan') {
        const queued = harness.planQueue.shift() ?? {};
        if (queued.error) return respond(method, queued, () => ({ ok: false, error: queued.error }));
        if (payload.expectedRevision !== catalog(payload.id).revision) return { ok: false, error: 'SYNTHETIC_STALE_REVISION' };
        const number = harness.nextPlan++;
        const plan = { planId: `plan-${number}`, planHash: number.toString(16).padStart(64, '0'), operation: payload.operation, ...(['workspace/create', 'workspace/adopt'].includes(payload.operation) ? { workspaceId: 'created-plan-' + number } : payload.workspaceId ? { workspaceId: payload.workspaceId } : {}), expectedRevision: payload.expectedRevision, expiresAt: new Date(Date.now() + (queued.durationMs ?? 300000)).toISOString(), effects: [`SYNTHETIC_SERVER_EFFECT_${number}`, 'Only the reviewed policy and explicitly selected device or invitation change.'], ...queued.value };
        harness.plans[plan.planId] = { hostId: payload.id, input: structuredClone(payload), plan, consumed: false };
        return respond(method, queued, () => ok(plan));
      }
      if (method === 'studio/apply') {
        const saved = harness.plans[payload.planId];
        if (!saved || saved.hostId !== payload.id || saved.plan.planHash !== payload.planHash || payload.confirm !== true || saved.consumed || Date.parse(saved.plan.expiresAt) <= Date.now()) {
          harness.unexpected.push({ method, payload }); return { ok: false, error: 'Synthetic stale, duplicate, or unconfirmed plan application' };
        }
        saved.consumed = true;
        const queued = harness.applyQueue.shift() ?? {};
        return respond(method, queued, () => {
          if (queued.error) return { ok: false, error: queued.error };
          const state = queued.value?.state ?? 'applied';
          const workspace = state === 'applied' ? applyMutation(saved) : undefined;
          const result = { operationId: saved.plan.planId, state, revision: catalog(payload.id).revision, effects: [`SYNTHETIC_RECEIPT_${saved.plan.planId}`], ...(workspace ? { workspace: structuredClone(workspace) } : {}), ...(state === 'applied' && saved.input.operation === 'invite/create' ? { inviteExportId: `export-${saved.plan.planId}` } : {}), ...queued.value };
          saved.result = result; return ok(result);
        });
      }
      if (method === 'studio/operation') {
        const queued = harness.operationQueue.shift() ?? {};
        return respond(method, queued, () => queued.error ? { ok: false, error: queued.error } : ok({ operationId: payload.operationId, state: 'applied', revision: catalog(payload.id).revision, effects: ['SYNTHETIC_QUERIED_RECEIPT'], ...queued.value }));
      }
      if (method === 'studio/invite-export') {
        const queued = harness.exportQueue.shift() ?? {};
        return respond(method, queued, () => queued.error ? { ok: false, error: queued.error } : ok(queued.value ?? { saved: true, path: 'C:\\synthetic-only\\member-invite.awworkspace' }));
      }
      if (method === 'studio/import-preview') {
        const queued = harness.previewQueue.shift();
        if (!queued) { harness.unexpected.push({ method, payload }); return { ok: false, error: 'No synthetic preview was queued' }; }
        return respond(method, queued, () => {
          if (queued.error) return { ok: false, error: queued.error };
          if (queued.value) harness.previews[queued.value.previewId] = queued.value;
          return ok(queued.value ?? null);
        });
      }
      if (method === 'studio/import') {
        const source = harness.previews[payload.previewId];
        if (!source || payload.confirm !== true || typeof payload.deviceLabel !== 'string' || !payload.deviceLabel.trim()) {
          harness.unexpected.push({ method, payload }); return { ok: false, error: 'Unconfirmed synthetic import' };
        }
        const queued = harness.importQueue.shift() ?? {};
        const saved = queued.value ?? { id: `imported-${source.previewId}`, name: source.workspaceName, hostname: source.hostname, port: source.port, username: source.username, role: 'workspace', identityFile: `C:\\synthetic-only\\${source.previewId}-device-key`, knownHostsFile: 'C:\\synthetic-only\\known_hosts', ownerId: 'local-owner', workspaceGeneration: `generation-${source.workspaceId}`, authorityId: source.authorityId, remoteWorkspaceId: source.workspaceId };
        return respond(method, { ...queued, previewId: source.previewId }, () => {
          if (queued.error) return { ok: false, error: queued.error };
          if (queued.publish !== false) { harness.state.hosts = [...harness.state.hosts.filter(item => item.id !== saved.id), saved]; publish(); }
          return ok(saved);
        });
      }
      harness.unexpected.push({ method, payload });
      return { ok: false, error: `Unexpected synthetic studio request: ${method}` };
    });
    publish();
  }, { state, studio: studioFixture, discovery: discoveryFixture });

  const requests = () => evaluate(() => globalThis.__studioUiHarness.requests);
  const count = async method => (await requests()).filter(request => request.method === method).length;
  const queuePreview = (value, options = {}) => evaluate((_electron, value) => { globalThis.__studioUiHarness.previewQueue.push(value); }, { value, ...options });
  const queueImport = options => evaluate((_electron, value) => { globalThis.__studioUiHarness.importQueue.push(value); }, options);
  const release = method => evaluate((_electron, method) => {
    const harness = globalThis.__studioUiHarness;
    const index = harness.pending.findIndex(item => item.method === method);
    if (index < 0) throw new Error(`No pending ${method}`);
    harness.pending.splice(index, 1)[0].finish();
  }, method);
  const pending = method => evaluate((_electron, method) => globalThis.__studioUiHarness.pending.filter(item => item.method === method).length, method);
  const navigate = async (view, behindModal = false) => {
    if(behindModal) {
      if(view==='workspace')await page.getByTestId('nav-workspace').evaluate(element=>element.click());
      else {await page.getByTestId('sidebar-footer-menu').evaluate(element=>element.click());await page.getByTestId('settings-open').evaluate(element=>element.click());await page.getByTestId('nav-'+view).evaluate(element=>element.click());}
    } else await navigateWorkbench(page,view);
  };
  const openPreview = async value => {
    await queuePreview(value);
    await page.getByTestId('studio-import-open').click();
    await page.getByTestId('studio-import-preview').waitFor();
    assert.equal(await page.getByTestId('studio-import-workspace-id').innerText(), value.workspaceId);
  };
  const dismiss = async () => { await page.getByTestId('studio-import-cancel').click(); await page.getByTestId('studio-import-dialog').waitFor({ state: 'hidden' }); };

  await navigate('connections');
  await page.getByTestId('studio-import-open').waitFor();
  await check('connections mount does not open an invitation or enroll a device automatically', async () => {
    assert.equal(await count('studio/import-preview'), 0);
    assert.equal(await count('studio/import'), 0);
  });
  await check('cancelled native file selection closes the preview without any import request', async () => {
    await queuePreview(null);
    await page.getByTestId('studio-import-open').click();
    await waitUntil(async () => await count('studio/import-preview') === 1 && await page.getByTestId('studio-import-dialog').count() === 0, 'cancelled picker');
    assert.equal(await count('studio/import'), 0);
  });
  await check('invitation preview exposes only public target details and defaults the local device name', async () => {
    const value = preview('first', { unrelatedField: 'SYNTHETIC_UNRELATED_METADATA_MUST_NOT_RENDER' });
    await openPreview(value);
    assert.equal(await page.getByTestId('studio-import-target').innerText(), `${value.hostname}:${value.port}`);
    assert.equal(await page.getByTestId('studio-import-user').innerText(), value.username);
    assert.equal(await page.getByTestId('studio-import-authority').innerText(), value.authorityId);
    assert.equal(await page.getByTestId('studio-import-enrollment').innerText(), value.enrollmentUrl);
    assert.equal(await page.getByTestId('studio-import-expiry').getAttribute('datetime'), value.expiresAt);
    assert.equal(await page.getByTestId('studio-import-device-label').inputValue(), '本机设备');
    assert.equal(await page.getByTestId('studio-import-preview').locator('input,select,textarea,a').count(), 0);
    assert.doesNotMatch(await page.getByTestId('studio-import-dialog').innerText(), /SYNTHETIC_UNRELATED_METADATA_MUST_NOT_RENDER/);
    assert.equal(await count('studio/import'), 0);
  });
  await check('editing the device name or pressing Enter cannot enroll without the confirmation button', async () => {
    const label = page.getByTestId('studio-import-device-label');
    await label.fill('   ');
    assert.equal(await page.getByTestId('studio-import-confirm').isDisabled(), true);
    await label.fill('  台式工作设备  ');
    await label.press('Enter');
    assert.equal(await count('studio/import'), 0);
    assert.equal(await page.getByTestId('studio-import-confirm').isEnabled(), true);
  });
  await check('explicit confirmation sends one public preview binding and rejects same-tick duplicate clicks', async () => {
    await queueImport({ hold: true });
    await page.getByTestId('studio-import-confirm').evaluate(element => { element.click(); element.click(); });
    await waitUntil(async () => await pending('studio/import') === 1, 'held device import');
    assert.equal(await count('studio/import'), 1);
    assert.deepEqual((await requests()).filter(item => item.method === 'studio/import')[0].payload, { previewId: 'first', confirm: true, deviceLabel: '台式工作设备' });
    assert.equal(await page.getByTestId('studio-import-device-label').isDisabled(), true);
    assert.equal(await page.getByTestId('studio-import-confirm').isDisabled(), true);
    assert.equal(await page.getByTestId('studio-import-repick').isDisabled(), true);
    await release('studio/import');
    await page.getByTestId('studio-import-dialog').waitFor({ state: 'hidden' });
    await page.getByTestId('host-imported-first').waitFor();
    await waitUntil(async () => await page.getByTestId('host-imported-first').getAttribute('class') === 'host-card selected', 'imported member selection');
    assert.match(await page.locator('.toast').innerText(), /输入框下方选择该成员连接/);
  });
  await check('replacing an invitation discards its former target and never imports until separately confirmed', async () => {
    await openPreview(preview('replace_old'));
    await page.getByTestId('studio-import-device-label').fill('旧设备名称');
    const value = preview('replace_new');
    await queuePreview(value);
    await page.getByTestId('studio-import-repick').click();
    await waitUntil(async () => await page.getByTestId('studio-import-workspace-id').innerText() === value.workspaceId, 'replacement preview');
    assert.equal(await page.getByTestId('studio-import-device-label').inputValue(), '本机设备');
    assert.equal(await count('studio/import'), 1);
    await page.keyboard.press('Escape');
    await page.getByTestId('studio-import-dialog').waitFor({ state: 'hidden' });
    assert.equal(await count('studio/import'), 1);
  });
  await check('already expired invitations cannot be confirmed', async () => {
    await openPreview(preview('expired', { expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await page.getByTestId('studio-import-expired').waitFor();
    assert.equal(await page.getByTestId('studio-import-confirm').isDisabled(), true);
    assert.equal(await count('studio/import'), 1);
    await dismiss();
  });
  await check('an invitation expiring while open disables confirmation without starting enrollment', async () => {
    await openPreview(preview('expiring', { expiresAt: new Date(Date.now() + 3000).toISOString() }));
    assert.equal(await page.getByTestId('studio-import-confirm').isEnabled(), true);
    await page.getByTestId('studio-import-expired').waitFor();
    assert.equal(await page.getByTestId('studio-import-confirm').isDisabled(), true);
    assert.equal(await count('studio/import'), 1);
    await dismiss();
  });
  await check('invalid preview data and picker failures require another explicit file selection', async () => {
    const before = await count('studio/import-preview');
    await queuePreview(preview('invalid', { expiresAt: 'not-a-date' }));
    await page.getByTestId('studio-import-open').click();
    await page.getByTestId('studio-import-error').waitFor();
    assert.equal(await page.getByTestId('studio-import-preview').count(), 0);
    assert.equal(await page.getByTestId('studio-import-confirm').isDisabled(), true);
    await queuePreview(null, { error: 'SYNTHETIC_PICKER_FAILURE' });
    await page.getByTestId('studio-import-repick').click();
    await waitUntil(async () => (await page.getByTestId('studio-import-error').innerText()).includes('SYNTHETIC_PICKER_FAILURE'), 'explicit picker failure');
    assert.equal(await count('studio/import-preview'), before + 2);
    assert.equal(await count('studio/import'), 1);
    await dismiss();
  });
  await check('a late file preview cannot replace a newer dialog and duplicate open clicks start only one picker', async () => {
    const before = await count('studio/import-preview');
    await queuePreview(preview('late_preview'), { hold: true });
    await page.getByTestId('studio-import-open').evaluate(element => { element.click(); element.click(); });
    await waitUntil(async () => await pending('studio/import-preview') === 1, 'held file preview');
    assert.equal(await count('studio/import-preview'), before + 1);
    await dismiss();
    await openPreview(preview('newer_preview'));
    await release('studio/import-preview');
    await pause(100);
    assert.equal(await page.getByTestId('studio-import-workspace-id').innerText(), 'workspace-newer_preview');
    assert.equal(await count('studio/import'), 1);
    await dismiss();
  });
  await check('an import failure shows a recoverable error without automatic retries', async () => {
    await openPreview(preview('failed_import'));
    await queueImport({ error: 'SYNTHETIC_ENROLLMENT_UNCONFIRMED' });
    await page.getByTestId('studio-import-confirm').click();
    await page.getByTestId('studio-import-error').waitFor();
    assert.match(await page.getByTestId('studio-import-error').innerText(), /SYNTHETIC_ENROLLMENT_UNCONFIRMED/);
    assert.equal(await count('studio/import'), 2);
    assert.equal(await page.getByTestId('studio-import-confirm').isEnabled(), true);
    await dismiss();
  });
  await check('closed import results cannot select another member or dismiss a newer invitation', async () => {
    const selected = await page.locator('.host-card.selected').getAttribute('data-testid');
    await openPreview(preview('late_import'));
    await queueImport({ hold: true });
    await page.getByTestId('studio-import-confirm').click();
    await waitUntil(async () => await pending('studio/import') === 1, 'held import before close');
    await dismiss();
    await openPreview(preview('newer_import'));
    await release('studio/import');
    await page.getByTestId('host-imported-late_import').waitFor();
    assert.equal(await page.locator('.host-card.selected').getAttribute('data-testid'), selected);
    assert.equal(await page.getByTestId('studio-import-workspace-id').innerText(), 'workspace-newer_import');
    assert.equal(await page.getByTestId('studio-import-error').count(), 0);
    assert.equal(await count('studio/import'), 3);
    await dismiss();
  });
  await check('late import errors cannot interrupt a newer invitation preview', async () => {
    await openPreview(preview('late_failure'));
    await queueImport({ hold: true, error: 'SYNTHETIC_STALE_IMPORT_ERROR' });
    await page.getByTestId('studio-import-confirm').click();
    await waitUntil(async () => await pending('studio/import') === 1, 'held failed import');
    await dismiss();
    await openPreview(preview('after_failure'));
    await release('studio/import');
    await pause(100);
    assert.equal(await page.getByTestId('studio-import-error').count(), 0);
    assert.equal(await page.getByTestId('studio-import-workspace-id').innerText(), 'workspace-after_failure');
    assert.doesNotMatch(await page.locator('body').innerText(), /SYNTHETIC_STALE_IMPORT_ERROR/);
    await dismiss();
  });
  await check('unmounting ignores a pending preview without opening a dialog on the next visit', async () => {
    await queuePreview(preview('unmounted_preview'), { hold: true });
    await page.getByTestId('studio-import-open').click();
    await waitUntil(async () => await pending('studio/import-preview') === 1, 'preview before route change');
    await navigate('workspace', true);
    await page.getByTestId('studio-import-open').waitFor({ state: 'hidden' });
    await release('studio/import-preview');
    await navigate('connections');
    await page.getByTestId('studio-import-open').waitFor();
    assert.equal(await page.getByTestId('studio-import-dialog').count(), 0);
    assert.equal(await count('studio/import'), 4);
  });
  await check('unmounted import completion updates host state without selecting a late result or reopening UI', async () => {
    await openPreview(preview('unmounted_import'));
    await queueImport({ hold: true });
    await page.getByTestId('studio-import-confirm').click();
    await waitUntil(async () => await pending('studio/import') === 1, 'import before route change');
    await navigate('workspace', true);
    await page.getByTestId('studio-import-open').waitFor({ state: 'hidden' });
    await release('studio/import');
    await navigate('connections');
    await page.getByTestId('host-imported-unmounted_import').waitFor();
    assert.equal(await page.getByTestId('host-admin').getAttribute('class'), 'host-card selected');
    assert.equal(await page.getByTestId('studio-import-dialog').count(), 0);
    assert.equal(await count('studio/import'), 5);
  });
  await check('invitation details and actions fit the 860px window without horizontal overflow', async () => {
    await evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640));
    await waitUntil(() => page.evaluate(() => innerWidth === 860), 'narrow viewport');
    await openPreview(preview('narrow', { authorityId: 'synthetic-authority-with-a-deliberately-long-public-identifier', enrollmentUrl: 'https://fixture.example.invalid:9443/workspaces/enroll/long-public-endpoint-with-no-secret' }));
    const bounds = await page.getByRole('dialog', { name: '导入成员工作空间', exact: true }).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= 860);
    assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1);
    assert.equal(await page.getByTestId('studio-import-confirm').isEnabled(), true);
    await dismiss();
  });

  const queueStudio = (queue, value) => evaluate((_electron, { queue, value }) => { globalThis.__studioUiHarness[queue].push(value); }, { queue, value });
  const lastRequest = async method => JSON.parse(JSON.stringify((await requests()).filter(item => item.method === method).at(-1).payload));
  const studioState = () => evaluate(() => globalThis.__studioUiHarness.studio);
  const lastPlan = () => evaluate(() => Object.values(globalThis.__studioUiHarness.plans).at(-1).plan);
  const readStudio = async () => {
    const before = await count('studio/list');
    await revealControl(page, 'studio-refresh');
    await page.getByTestId('studio-refresh').click();
    await waitUntil(async () => await count('studio/list') === before + 1 && await page.getByTestId('studio-refresh').isEnabled(), 'explicit studio read');
    await page.getByTestId('studio-snapshot').waitFor();
  };
  const requestEditorPlan = async () => {
    await page.getByTestId('studio-plan-request').click();
    await page.getByTestId('studio-plan').waitFor();
    return lastPlan();
  };
  const applyReviewedPlan = async () => {
    const before = await count('studio/list');
    await page.getByTestId('studio-apply').click();
    await waitUntil(async () => await count('studio/list') === before + 1 && await page.getByTestId('studio-refresh').isEnabled(), 'successful application and fresh snapshot');
    assert.equal(await page.getByTestId('studio-result').getAttribute('data-state'), 'applied');
  };
  const selectManaged = async id => {
    await page.getByTestId(`studio-workspace-${id}`).click();
    assert.equal(await page.getByTestId(`studio-workspace-${id}`).getAttribute('aria-pressed'), 'true');
  };
  const assertPlanOnly = async (expected, applyCount) => {
    await page.getByTestId('studio-plan').waitFor();
    assert.deepEqual(await lastRequest('studio/plan'), expected);
    assert.equal(await count('studio/apply'), applyCount);
    const value = await lastPlan();
    for (const effect of value.effects) assert.ok((await page.getByTestId('studio-plan').innerText()).includes(effect));
    return value;
  };
  await check('an import receipt with a different authority is rejected even when its SSH target matches', async () => {
    const value = preview('wrong_authority');
    const selected = await page.locator('.host-card.selected').getAttribute('data-testid');
    await openPreview(value);
    await queueImport({ publish: false, value: { ...host('mismatched-receipt', 'workspace', value.username), name: value.workspaceName, authorityId: 'another-authority', remoteWorkspaceId: value.workspaceId } });
    await page.getByTestId('studio-import-confirm').click();
    await page.getByTestId('studio-import-error').waitFor();
    assert.match(await page.getByTestId('studio-import-error').innerText(), /导入结果与预览的成员连接不一致/);
    assert.equal(await page.locator('.host-card.selected').getAttribute('data-testid'), selected);
    assert.equal(await page.getByTestId('host-mismatched-receipt').count(), 0);
    assert.equal(await count('studio/import'), 6);
    await dismiss();
  });
  await check('a delayed post-import state refresh cannot override a newer connection selection', async () => {
    await openPreview(preview('refresh_race'));
    await queueStudio('stateQueue', { hold: true });
    await page.getByTestId('studio-import-confirm').click();
    await waitUntil(async () => await pending('state/get') === 1, 'post-import refresh');
    await page.getByTestId('studio-import-dialog').waitFor({ state: 'hidden' });
    await page.getByTestId('host-existing-member').click();
    await release('state/get');
    await pause(100);
    assert.equal(await page.getByTestId('host-existing-member').getAttribute('class'), 'host-card selected');
    assert.equal(await page.getByTestId('host-imported-refresh_race').getAttribute('class'), 'host-card ');
    assert.equal(await count('studio/import'), 7);
  });
  await evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940));
  await waitUntil(() => page.evaluate(() => innerWidth === 1440), 'full-size panel viewport');

  await check('Studio appears only for administrator connections and does not read or mutate on mount', async () => {
    assert.equal(await count('studio/list'), 0);
    await page.getByTestId('host-existing-member').click();
    assert.equal(await page.getByTestId('studio-panel').count(), 0);
    await page.getByTestId('host-admin').click();
    await page.getByTestId('studio-panel').waitFor();
    assert.equal(await count('studio/list'), 0);
    assert.equal(await count('studio/plan'), 0);
    assert.equal(await count('studio/apply'), 0);
    assert.equal(await page.getByTestId('studio-create').count(), 0);
  });
  await check('an unavailable management service exposes no writable controls or deployment fallback', async () => {
    await queueStudio('listQueue', { value: { ...studioFixture, availability: 'unavailable', workspaces: [], reason: 'SYNTHETIC_CONTROL_UNAVAILABLE' } });
    await readStudio();
    assert.deepEqual(await lastRequest('studio/list'), { id: 'admin' });
    assert.equal(await page.getByTestId('studio-snapshot').getAttribute('data-availability'), 'unavailable');
    assert.match(await page.getByTestId('studio-panel').innerText(), /SYNTHETIC_CONTROL_UNAVAILABLE/);
    for (const id of ['studio-create', 'studio-adopt', 'studio-edit', 'studio-invite-create', 'studio-apply']) assert.equal(await page.getByTestId(id).count(), 0);
    assert.equal(await count('studio/plan'), 0);
    assert.equal(await count('studio/apply'), 0);
    await readStudio();
    assert.equal(await page.getByTestId('studio-snapshot').getAttribute('data-availability'), 'ready');
  });
  await check('management metadata describes runtime and budget policy honestly and disables retired targets', async () => {
    assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
    assert.equal(await page.getByTestId('connection-tab-workspaces').getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByTestId('codex-login').isVisible(), false);
    assert.equal(await page.getByTestId('discover-workspaces').isVisible(), false);
    assert.equal(await page.getByTestId('studio-suspend').isVisible(), false);
    assert.equal(await page.getByTestId('studio-revoke-device-device-one').isVisible(), false);
    await page.locator('.studio-environment-summary > summary').click();
    assert.match(await page.getByTestId('studio-workspace-detail').innerText(), /不自动安装 CLI/);
    assert.match(await page.getByTestId('studio-workspace-detail').innerText(), /未接计量或执行/);
    assert.match(await page.getByTestId('studio-workspace-detail').innerText(), /原生额度\s*未知/);
    assert.equal(await page.getByTestId('studio-adopt').isDisabled(), true);
    assert.equal(await page.getByTestId('studio-revoke-device-device-revoked').isDisabled(), true);
    assert.equal(await page.getByTestId('studio-revoke-invite-invite-used').isDisabled(), true);
    await selectManaged('removed');
    for (const id of ['studio-edit', 'studio-suspend', 'studio-delete', 'studio-invite-create']) assert.equal(await page.getByTestId(id).isDisabled(), true);
    await selectManaged('alpha');
    assert.equal(await count('accounts/list'), 0);
  });
  let replacedPlan;
  await check('new workspace policy requires a server plan with exact environment, account ACL and budget values', async () => {
    await page.getByTestId('studio-create').click();
    await page.getByTestId('studio-name').fill('Policy member');
    await page.getByTestId('studio-username').fill('policy_member');
    assert.equal(await page.getByTestId('studio-root').inputValue(), '/home/policy_member/workspaces');
    await page.getByTestId('studio-root').fill('/home/policy_member/workspaces');
    await page.getByTestId('studio-default-directory').fill('/home/policy_member/workspaces/projects');
    await page.getByTestId('studio-runtime-codex').uncheck();
    await page.getByTestId('studio-editor').locator('.studio-environment-fields > summary').click();
    await page.getByTestId('studio-env-LANG').fill('zh_CN.UTF-8');
    await page.getByTestId('studio-env-TZ').fill('Asia/Tokyo');
    await revealControl(page, 'studio-allowed-accounts');
    await page.getByTestId('studio-allowed-accounts').fill('account-one, account-two， account-one');
    await page.getByTestId('studio-budget').fill('75.5');
    const revision = (await studioState()).revision;
    await requestEditorPlan();
    replacedPlan = await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'workspace/create', values: { name: 'Policy member', username: 'policy_member', root: '/home/policy_member/workspaces', environment: { runtimes: ['claude'], defaultDirectory: '/home/policy_member/workspaces/projects', env: { LANG: 'zh_CN.UTF-8', TZ: 'Asia/Tokyo' } }, allowedAccountIds: ['account-one', 'account-two'], budget: { period: 'month', limit: 75.5, unit: 'usd', enforcement: 'unavailable' } } }, 0);
  });
  await check('returning to edit invalidates the former plan and applies the revised plan only once', async () => {
    await page.getByTestId('studio-plan-back').click();
    await page.getByTestId('studio-editor').waitFor();
    assert.equal(await page.getByTestId('studio-apply').count(), 0);
    await page.getByTestId('studio-name').fill('Revised policy member');
    await page.getByTestId('studio-budget').fill('');
    const value = await requestEditorPlan();
    assert.notEqual(value.planId, replacedPlan.planId);
    const input = await lastRequest('studio/plan');
    assert.equal(input.values.name, 'Revised policy member');
    assert.deepEqual(input.values.budget, { period: 'month', limit: null, unit: 'usd', enforcement: 'unavailable' });
    assert.equal(await count('studio/apply'), 0);
    await queueStudio('applyQueue', { hold: true });
    const lists = await count('studio/list');
    await page.getByTestId('studio-apply').evaluate(element => { element.click(); element.click(); });
    await waitUntil(async () => await pending('studio/apply') === 1, 'one held application');
    assert.equal(await count('studio/apply'), 1);
    assert.deepEqual(await lastRequest('studio/apply'), { id: 'admin', planId: value.planId, planHash: value.planHash, confirm: true });
    assert.equal(await page.getByTestId('studio-apply').count(), 0);
    assert.equal(await page.getByTestId('studio-create').isDisabled(), true);
    await release('studio/apply');
    await waitUntil(async () => await count('studio/list') === lists + 1 && await page.getByTestId('studio-refresh').isEnabled(), 'new workspace and refreshed snapshot');
    const created = (await studioState()).workspaces.find(item => item.name === 'Revised policy member');
    assert.ok(created);
    await selectManaged(created.id);
    assert.match(await page.getByTestId('studio-workspace-detail').innerText(), /未设金额.*未接计量或执行/);
    assert.equal(await evaluate((_electron, id) => globalThis.__studioUiHarness.plans[id].consumed, replacedPlan.planId), false);
  });
  await check('editing policy preserves the member identity and reads account choices only on request', async () => {
    await selectManaged('alpha');
    await page.getByTestId('studio-edit').click();
    assert.equal(await page.getByTestId('studio-username').count(), 0);
    assert.equal(await page.getByTestId('studio-root').count(), 0);
    assert.equal(await count('accounts/list'), 0);
    await page.getByTestId('studio-accounts-refresh').click();
    await page.getByTestId('studio-account-account-two').waitFor();
    assert.deepEqual(await lastRequest('accounts/list'), { id: 'admin' });
    await page.getByTestId('studio-account-account-two').check();
    await page.getByTestId('studio-name').fill('Alpha revised policy');
    await page.getByTestId('studio-default-directory').fill('/srv/current-alpha');
    await page.getByTestId('studio-runtime-claude').uncheck();
    await page.getByTestId('studio-editor').locator('.studio-environment-fields > summary').click();
    await page.getByTestId('studio-env-LANG').fill('');
    await page.getByTestId('studio-env-TERM').fill('xterm-256color');
    await page.getByTestId('studio-budget').fill('42.5');
    const revision = (await studioState()).revision, applies = await count('studio/apply');
    await requestEditorPlan();
    await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'workspace/update', workspaceId: 'alpha', values: { name: 'Alpha revised policy', environment: { runtimes: ['codex'], defaultDirectory: '/srv/current-alpha', env: { TERM: 'xterm-256color' } }, allowedAccountIds: ['account-one', 'account-two'], budget: { period: 'month', limit: 42.5, unit: 'usd', enforcement: 'unavailable' } } }, applies);
    await applyReviewedPlan();
    const alpha = (await studioState()).workspaces.find(item => item.id === 'alpha');
    assert.equal(alpha.uid, 1001); assert.equal(alpha.username, 'managed_alpha'); assert.equal(alpha.root, '/home/managed_alpha/workspaces');
  });
  await check('adoption offers only fresh high-confidence unregistered members and preserves their observed UID', async () => {
    assert.equal(await page.getByTestId('studio-adopt').isDisabled(), true);
    await revealControl(page, 'discover-workspaces');
    await page.getByTestId('discover-workspaces').click();
    await page.getByTestId('workspace-discovery').waitFor();
    assert.deepEqual(await lastRequest('host/discover'), { id: 'admin' });
    await revealControl(page, 'studio-adopt');
    await page.getByTestId('studio-adopt').click();
    assert.deepEqual(await page.getByTestId('studio-adopt-candidate').locator('option').evaluateAll(elements => elements.map(element => element.value)), ['', 'discovered_member']);
    await page.getByTestId('studio-adopt-candidate').selectOption('discovered_member');
    assert.equal(await page.getByTestId('studio-username').inputValue(), 'discovered_member');
    assert.equal(await page.getByTestId('studio-username').isDisabled(), true);
    const revision = (await studioState()).revision, applies = await count('studio/apply');
    await requestEditorPlan();
    await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'workspace/adopt', values: { name: 'Discovered candidate', username: 'discovered_member', uid: 1357, root: '/home/discovered_member/workspaces', environment: { runtimes: ['codex', 'claude'], defaultDirectory: '/home/discovered_member/workspaces', env: {} }, allowedAccountIds: [], budget: { period: 'month', limit: null, unit: 'usd', enforcement: 'unavailable' } } }, applies);
    await applyReviewedPlan();
    const adopted = (await studioState()).workspaces.find(item => item.username === 'discovered_member');
    assert.equal(adopted.uid, 1357);
    assert.equal(await page.getByTestId('studio-adopt').isDisabled(), true);
  });
  await check('an expired server plan cannot be applied and returning removes that plan', async () => {
    await selectManaged('alpha');
    const applies = await count('studio/apply');
    await queueStudio('planQueue', { durationMs: -1000 });
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-plan').waitFor();
    await waitUntil(() => page.getByTestId('studio-apply').isDisabled(), 'already expired plan to be disabled');
    assert.equal(await page.getByTestId('studio-apply').isDisabled(), true);
    assert.match(await page.getByTestId('studio-plan').innerText(), /预览已过期/);
    assert.equal(await count('studio/apply'), applies);
    await page.getByTestId('studio-plan-back').click();
    await page.getByTestId('studio-plan').waitFor({ state: 'hidden' });
  });
  await check('a plan that expires during review is disabled without an application request', async () => {
    const applies = await count('studio/apply');
    await queueStudio('planQueue', { durationMs: 3000 });
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-plan').waitFor();
    assert.equal(await page.getByTestId('studio-apply').isEnabled(), true);
    await waitUntil(() => page.getByTestId('studio-apply').isDisabled(), 'plan expiry while open');
    assert.equal(await count('studio/apply'), applies);
    await page.getByTestId('studio-plan-back').click();
  });
  await check('device revocation binds the exact workspace and device and leaves its peer device active', async () => {
    const revision = (await studioState()).revision, applies = await count('studio/apply');
    await revealControl(page, 'studio-revoke-device-device-one');
    await page.getByTestId('studio-revoke-device-device-one').click();
    await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'device/revoke', workspaceId: 'alpha', values: { deviceId: 'device-one' } }, applies);
    assert.match(await page.getByTestId('studio-plan').innerText(), /不会终止已建立的 SSH 会话/);
    await applyReviewedPlan();
    assert.equal(await page.getByTestId('studio-revoke-device-device-one').isDisabled(), true);
    assert.equal(await page.getByTestId('studio-revoke-device-device-two').isEnabled(), true);
    assert.equal((await studioState()).workspaces.find(item => item.id === 'beta').status, 'active');
  });
  await check('invitation revocation binds only the selected invitation and preserves used invitation history', async () => {
    const revision = (await studioState()).revision, applies = await count('studio/apply');
    await revealControl(page, 'studio-revoke-invite-invite-one');
    await page.getByTestId('studio-revoke-invite-invite-one').click();
    await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'invite/revoke', workspaceId: 'alpha', values: { inviteId: 'invite-one' } }, applies);
    await applyReviewedPlan();
    assert.equal(await page.getByTestId('studio-revoke-invite-invite-one').isDisabled(), true);
    const invites = (await studioState()).workspaces.find(item => item.id === 'alpha').invites;
    assert.equal(invites.find(item => item.id === 'invite-one').status, 'revoked');
    assert.equal(invites.find(item => item.id === 'invite-used').status, 'redeemed');
  });
  await check('suspend and resume require separate plans and only describe workbench authorization changes', async () => {
    let revision = (await studioState()).revision;
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'workspace/suspend', workspaceId: 'alpha', values: {} }, await count('studio/apply'));
    assert.match(await page.getByTestId('studio-plan').innerText(), /不会删除系统用户、文件或旧授权/);
    await applyReviewedPlan();
    await revealControl(page, 'studio-suspend');
    assert.equal(await page.getByTestId('studio-suspend').innerText(), '恢复授权');
    assert.equal(await page.getByTestId('studio-invite-create').isDisabled(), true);
    revision = (await studioState()).revision;
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'workspace/suspend', workspaceId: 'alpha', values: { suspended: false } }, await count('studio/apply'));
    await applyReviewedPlan();
    assert.equal(await page.getByTestId('studio-invite-create').isEnabled(), true);
  });
  await check('removing management preserves the observed identity and presents no destructive system action', async () => {
    await selectManaged('beta');
    const before = (await studioState()).workspaces.find(item => item.id === 'beta');
    const revision = (await studioState()).revision, applies = await count('studio/apply');
    await revealControl(page, 'studio-delete');
    await page.getByTestId('studio-delete').click();
    await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'workspace/delete', workspaceId: 'beta', values: {} }, applies);
    await applyReviewedPlan();
    const after = (await studioState()).workspaces.find(item => item.id === 'beta');
    assert.equal(after.status, 'deleted'); assert.equal(after.uid, before.uid); assert.equal(after.root, before.root);
    for (const id of ['studio-edit', 'studio-delete', 'studio-invite-create']) assert.equal(await page.getByTestId(id).isDisabled(), true);
    await selectManaged('alpha');
  });
  await check('invitation creation converts minutes to seconds and exports only an opaque file handle', async () => {
    await page.getByTestId('studio-invite-create').click();
    await page.getByTestId('studio-invite-label').fill('Laptop invitation');
    await page.getByTestId('studio-invite-ttl').fill('15');
    const revision = (await studioState()).revision, applies = await count('studio/apply');
    await requestEditorPlan();
    const value = await assertPlanOnly({ id: 'admin', expectedRevision: revision, operation: 'invite/create', workspaceId: 'alpha', values: { label: 'Laptop invitation', ttlSeconds: 900 } }, applies);
    await queueStudio('exportQueue', { value: { saved: false } });
    await page.getByTestId('studio-apply').click();
    await waitUntil(async () => await count('studio/invite-export') === 1 && await page.getByTestId('studio-invite-export').isEnabled(), 'cancelled native invitation save');
    assert.deepEqual(await lastRequest('studio/invite-export'), { id: 'admin', inviteExportId: `export-${value.planId}` });
    assert.equal(await page.getByTestId('studio-invite-saved').count(), 0);
    assert.doesNotMatch(await page.getByTestId('studio-panel').innerText(), /-----BEGIN|"token"|SYNTHETIC_PUBLIC_KEY_METADATA/);
    const applyCount = await count('studio/apply');
    await queueStudio('exportQueue', { value: { saved: true, path: 'C:\\synthetic-only\\laptop.awworkspace' } });
    await page.getByTestId('studio-invite-export').click();
    await page.getByTestId('studio-invite-saved').waitFor();
    assert.match(await page.getByTestId('studio-invite-saved').innerText(), /laptop\.awworkspace/);
    assert.equal(await count('studio/invite-export'), 2);
    assert.equal(await count('studio/apply'), applyCount);
    assert.equal(await page.getByTestId('studio-invite-export').count(), 0);
  });
  await check('a failed operation receipt consumes its plan without retrying or claiming success', async () => {
    const lists = await count('studio/list'), applies = await count('studio/apply');
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-plan').waitFor();
    await queueStudio('applyQueue', { value: { state: 'failed', effects: ['SYNTHETIC_FAILED_NO_CHANGE'] } });
    await page.getByTestId('studio-apply').click();
    await waitUntil(async () => await page.getByTestId('studio-result').count() === 1 && await page.getByTestId('studio-result').getAttribute('data-state') === 'failed' && await page.getByTestId('studio-refresh').isEnabled(), 'failed receipt');
    assert.equal(await count('studio/apply'), applies + 1);
    assert.equal(await count('studio/list'), lists);
    assert.equal(await page.getByTestId('studio-operation-check').count(), 0);
    assert.equal(await page.getByTestId('studio-apply').count(), 0);
    assert.equal(await page.getByTestId('studio-create').isDisabled(), true);
    await readStudio();
  });
  await check('uncertain receipts query status after a fresh list and never replay the plan', async () => {
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-plan').waitFor();
    const plan = await lastPlan(), lists = await count('studio/list'), applies = await count('studio/apply');
    await queueStudio('applyQueue', { value: { state: 'uncertain', effects: ['SYNTHETIC_UNCERTAIN_RECEIPT'] } });
    await page.getByTestId('studio-apply').click();
    await waitUntil(async () => await page.getByTestId('studio-result').count() === 1 && await page.getByTestId('studio-result').getAttribute('data-state') === 'uncertain' && await page.getByTestId('studio-operation-check').isEnabled(), 'uncertain receipt');
    assert.equal(await count('studio/list'), lists);
    assert.equal(await page.getByTestId('studio-create').isDisabled(), true);
    await queueStudio('operationQueue', { value: { state: 'uncertain' } });
    const before = (await requests()).length;
    await page.getByTestId('studio-operation-check').click();
    await waitUntil(async () => await count('studio/operation') >= 1 && await page.getByTestId('studio-operation-check').isEnabled(), 'explicit uncertain status query');
    const queried = (await requests()).slice(before).filter(item => item.method.startsWith('studio/'));
    assert.deepEqual(queried, [{ method: 'studio/list', payload: { id: 'admin' } }, { method: 'studio/operation', payload: { id: 'admin', operationId: plan.planId } }]);
    assert.equal(await page.getByTestId('studio-stale').count(), 1);
    assert.equal(await count('studio/apply'), applies + 1);
    await queueStudio('operationQueue', { value: { state: 'applied' } });
    await page.getByTestId('studio-operation-check').click();
    await waitUntil(async () => await page.getByTestId('studio-result').getAttribute('data-state') === 'applied' && await page.getByTestId('studio-operation-check').count() === 0, 'confirmed operation query');
    assert.equal(await count('studio/apply'), applies + 1);
    assert.equal(await page.getByTestId('studio-stale').count(), 0);
  });
  await check('a lost apply response exposes a status query instead of a second application', async () => {
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-plan').waitFor();
    const plan = await lastPlan(), applies = await count('studio/apply');
    await queueStudio('applyQueue', { error: 'SYNTHETIC_LOST_APPLY_RESPONSE' });
    await page.getByTestId('studio-apply').click();
    await page.getByTestId('studio-error').waitFor();
    assert.match(await page.getByTestId('studio-error').innerText(), /不要重复提交/);
    assert.equal(await page.getByTestId('studio-apply').count(), 0);
    assert.equal(await count('studio/apply'), applies + 1);
    const before = (await requests()).length;
    await page.getByTestId('studio-operation-check').click();
    await waitUntil(async () => await page.getByTestId('studio-result').count() === 1 && await page.getByTestId('studio-result').getAttribute('data-state') === 'applied' && await page.getByTestId('studio-operation-check').count() === 0, 'lost response status recovery');
    assert.deepEqual((await requests()).slice(before).filter(item => item.method.startsWith('studio/')), [{ method: 'studio/list', payload: { id: 'admin' } }, { method: 'studio/operation', payload: { id: 'admin', operationId: plan.planId } }]);
    assert.equal(await count('studio/apply'), applies + 1);
  });
  await check('revision errors and mismatched plans block writes until an explicit refresh', async () => {
    await queueStudio('planQueue', { error: 'SYNTHETIC_STALE_REVISION' });
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-error').waitFor();
    assert.match(await page.getByTestId('studio-error').innerText(), /SYNTHETIC_STALE_REVISION/);
    assert.equal(await page.getByTestId('studio-apply').count(), 0);
    assert.equal(await page.getByTestId('studio-create').isDisabled(), true);
    await readStudio();
    await queueStudio('planQueue', { value: { workspaceId: 'wrong-workspace' } });
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-error').waitFor();
    assert.match(await page.getByTestId('studio-error').innerText(), /变更预览与当前请求不匹配/);
    assert.equal(await page.getByTestId('studio-plan').count(), 0);
    assert.equal(await page.getByTestId('studio-create').isDisabled(), true);
    await readStudio();
  });
  await check('a late administrator A snapshot cannot replace administrator B details', async () => {
    await queueStudio('listQueue', { hold: true });
    await revealControl(page, 'studio-refresh');
    await page.getByTestId('studio-refresh').click();
    await waitUntil(async () => await pending('studio/list') === 1, 'held administrator A snapshot');
    await page.getByTestId('host-admin-b').click();
    await readStudio();
    await page.getByTestId('studio-workspace-remote-b').waitFor();
    await release('studio/list');
    await pause(100);
    assert.equal(await page.getByTestId('host-admin-b').getAttribute('class'), 'host-card selected');
    assert.equal(await page.getByTestId('studio-workspace-alpha').count(), 0);
    assert.match(await page.getByTestId('studio-workspace-detail').innerText(), /Only on administrator B/);
    await page.getByTestId('host-admin').click();
    assert.equal(await page.getByTestId('studio-snapshot').count(), 0);
    await readStudio();
  });
  await check('a late plan from an unmounted administrator cannot open a modal on another connection', async () => {
    await selectManaged('alpha');
    await queueStudio('planQueue', { hold: true });
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await waitUntil(async () => await pending('studio/plan') === 1, 'held administrator A plan');
    await page.getByTestId('host-admin-b').evaluate(element => element.click());
    await readStudio();
    await release('studio/plan');
    await pause(100);
    assert.equal(await page.getByTestId('studio-plan').count(), 0);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByTestId('studio-error').count(), 0);
    assert.match(await page.getByTestId('studio-workspace-detail').innerText(), /Only on administrator B/);
    await page.getByTestId('host-admin').click();
    await readStudio();
  });
  await check('late apply completion cannot refresh or display a receipt on another administrator', async () => {
    await selectManaged('alpha');
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-plan').waitFor();
    await queueStudio('applyQueue', { hold: true });
    await page.getByTestId('studio-apply').click();
    await waitUntil(async () => await pending('studio/apply') === 1, 'held administrator A application');
    await page.getByTestId('host-admin-b').click();
    await readStudio();
    const requestsBeforeRelease = await requests();
    await release('studio/apply');
    await pause(100);
    assert.deepEqual(await requests(), requestsBeforeRelease);
    assert.equal(await page.getByTestId('studio-result').count(), 0);
    assert.equal(await page.getByTestId('studio-error').count(), 0);
    assert.match(await page.getByTestId('studio-workspace-detail').innerText(), /Only on administrator B/);
    await page.getByTestId('host-admin').click();
    await readStudio();
    await selectManaged('alpha');
    await revealControl(page, 'studio-suspend');
    assert.equal(await page.getByTestId('studio-suspend').innerText(), '恢复授权');
  });
  await check('Studio metadata and review controls fit the supported minimum window width', async () => {
    await evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640));
    await waitUntil(() => page.evaluate(() => innerWidth === 860), 'narrow Studio viewport');
    const boxes = await page.getByTestId('studio-panel').locator('.studio-workspace-detail,.studio-workspace-list,.studio-device-list').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    }));
    for (const box of boxes) { assert.ok(box.left >= 0 && box.right <= 860); assert.ok(box.scrollWidth <= box.clientWidth + 1); }
    await revealControl(page, 'studio-suspend');
    await page.getByTestId('studio-suspend').click();
    await page.getByTestId('studio-plan').waitFor();
    const box = await page.getByTestId('studio-plan').evaluate(element => {
      const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    assert.ok(box.left >= 0 && box.right <= 860); assert.ok(box.scrollWidth <= box.clientWidth + 1);
    await page.getByTestId('studio-plan-back').click();
  });
  await check('an expired invitation can recover the same device only when the trusted preview confirms a saved identity', async () => {
    await openPreview(preview('saved_device', { expiresAt: new Date(Date.now() - 1000).toISOString(), resumeExistingDevice: true }));
    await page.getByTestId('studio-import-recovery').waitFor();
    assert.equal(await page.getByTestId('studio-import-confirm').isEnabled(), true);
    assert.equal(await page.getByTestId('studio-import-confirm').innerText(), '恢复此设备连接');
    await page.getByTestId('studio-import-confirm').click();
    await page.getByTestId('studio-import-dialog').waitFor({ state: 'hidden' });
    await waitUntil(async () => await page.getByTestId('host-imported-saved_device').getAttribute('aria-pressed') === 'true', 'recovered device selection');
    assert.equal(await count('studio/import'), 8);
  });
  await check('renderer has no errors, unexpected IPC, pending work, credentials, or execution requests', async () => {
    const audit = await evaluate(() => {
      const harness = globalThis.__studioUiHarness;
      return { unexpected: harness.unexpected, pending: harness.pending.length, queued: ['previewQueue', 'importQueue', 'stateQueue', 'listQueue', 'planQueue', 'applyQueue', 'operationQueue', 'exportQueue'].map(key => [key, harness[key].length]) };
    });
    assert.deepEqual(audit.unexpected, []); assert.equal(audit.pending, 0);
    for (const [name, length] of audit.queued) assert.equal(length, 0, `${name} must be fully consumed`);
    assert.deepEqual(errors, []);
    const log = await requests();
    assert.equal(log.filter(item => /^(?:host\/(?:probe|save)|draft\/|session\/create|codex-auth\/(?:start|status|cancel))/.test(item.method)).length, 0);
    assert.equal(log.filter(item => item.method === 'host/discover').length, 1);
    assert.equal(log.filter(item => item.method === 'studio/import').length, 8);
    for (const item of log.filter(item => item.method === 'studio/import')) assert.deepEqual(Object.keys(item.payload).sort(), ['confirm', 'deviceLabel', 'previewId']);
    const applications = log.filter(item => item.method === 'studio/apply');
    assert.equal(new Set(applications.map(item => item.payload.planId)).size, applications.length);
    for (const item of applications) assert.deepEqual(Object.keys(item.payload).sort(), ['confirm', 'id', 'planHash', 'planId']);
    for (const item of log.filter(item => ['studio/list', 'studio/plan', 'studio/apply', 'studio/operation', 'studio/invite-export'].includes(item.method))) assert.ok(['admin', 'admin-b'].includes(item.payload.id));
    assert.doesNotMatch(JSON.stringify(log), /"(?:token|privateKey|publicKey|identityFile)"/);
  });
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  try { await closeOwnedInstance(); }
  finally { await writeFile(path.join(output, 'studio-ui-report.json'), JSON.stringify({ observedAt: new Date().toISOString(), screenshots: false, syntheticOnly: true, invitationImport: true, administratorPanel: true, checks, errors, ownedPid, forcedCleanup, ...(failure ? { failure } : {}) }, null, 2)); }
}
console.log(`Studio UI: ${checks.length}/${checks.length} passed; screenshots=false; syntheticOnly=true`);
