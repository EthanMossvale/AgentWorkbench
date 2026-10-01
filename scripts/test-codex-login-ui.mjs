import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';
import { revealControl } from './ui-control-helpers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

// Renderer acceptance against one synthetic shared account authority. No SSH,
// browser, native authentication, real credential, model call or screenshot.
// Run after the application build, serially with other desktop UI tests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build/qa');
const dataDir = path.join(output, `codex-login-synthetic-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const checks = [];
const errors = [];
let app;
let failure;
const check = async (name, run) => {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); throw error; }
};
const waitUntil = async (predicate, description) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(25); }
  throw new Error(`Timed out waiting for ${description}`);
};
const host = (id, role, username) => ({ id, name: `Synthetic ${id}`, hostname: 'fixture.example.invalid', port: 2222, username, role, identityFile: `C:\\synthetic-only\\${id}-identity`, knownHostsFile: 'C:\\synthetic-only\\known_hosts', ownerId: 'local-owner', workspaceGeneration: 'synthetic-generation' });
const account = (id, email) => ({ id, generation: `generation-${id}`, provider: 'codex', status: 'authenticated', email, plan: 'Synthetic plan', authMethod: 'ChatGPT', observedAt: '2026-09-24T12:00:00.000Z' });
const addedAccount = { ...account('account-three', 'shared-added@example.invalid'), unrelatedValue: 'SYNTHETIC_SHARED_METADATA_MUST_NOT_RENDER' };
const awaiting = { state: 'awaiting-code', userCode: 'TEST-1234', verificationUrl: 'https://auth.openai.com/codex/device' };

try {
  app = await electron.launch({ executablePath: electronPath, args: [root], cwd: root, env, timeout: 45000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.workbench);
  const state = await page.evaluate(() => window.workbench.call('state/get'));
  state.hosts = [host('admin', 'admin', 'root'), host('alpha', 'workspace', 'alpha'), host('beta', 'workspace', 'beta')];
  state.accountCatalogs = {};
  await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
    const harness = globalThis.__codexLoginHarness = {
      state: fixture.state, requests: [], unexpected: [], jobs: {}, pending: [],
      authority: { authorityId: 'synthetic-shared-vps-authority', generation: 'shared-generation-1', revision: 7, availability: 'ready', accounts: fixture.accounts },
      selections: { alpha: { selectionRevision: 4, selectedAccountId: 'account-one' }, beta: { selectionRevision: 9, selectedAccountId: 'account-one' } },
      nextCatalog: null, nextJob: null, nextId: 1, clipboard: '', opened: [], currentErrors: {},
      holdList: false, holdSelect: false, holdStart: false, holdStatus: false, cancelCleanup: 'confirmed',
    };
    const ok = value => ({ ok: true, value });
    const catalog = id => structuredClone({ ...harness.authority, workspaceId: id, selectionRevision: 0, ...harness.selections[id] });
    const complete = (method, id, value) => {
      if (method === 'accounts/list' || method === 'accounts/select') {
        harness.state.accountCatalogs ??= {};
        harness.state.accountCatalogs[id] = structuredClone(value);
        BrowserWindow.getAllWindows()[0].webContents.send('workbench:state', harness.state);
      }
      return ok(value);
    };
    const publish = entry => {
      if (entry.value.state !== 'authenticated' || !entry.publishAccount || entry.published) return;
      const index = harness.authority.accounts.findIndex(item => item.id === entry.publishAccount.id);
      if (index < 0) harness.authority.accounts.push(entry.publishAccount); else harness.authority.accounts[index] = entry.publishAccount;
      harness.authority.revision++;
      entry.published = true;
    };
    const delayed = (method, id, value, extra = {}) => new Promise(resolve => harness.pending.push({ method, id, ...extra, finish: () => resolve(complete(method, id, value)) }));
    ipcMain.removeHandler('workbench:call');
    ipcMain.handle('workbench:call', async (_event, method, payload = {}) => {
      harness.requests.push({ method, payload });
      if (method === 'state/get') return ok(harness.state);
      if (method === 'studio/list') return ok({availability:'unavailable',reason:'Synthetic management service not configured',authorityId:'',generation:'',revision:0,workspaces:[],connection:{hostname:'fixture.example.invalid',port:2222,hostPublicKeys:[]},enrollmentUrl:''});
      if (method === 'navigation/get') return ok({ sessionId: null });
      if (method === 'workspace/select') {
        const selected = harness.state.hosts.find(host => host.id === payload.id && host.role === 'workspace');
        if (!selected) return { ok: false, error: 'Member workspace required' };
        harness.state.activeWorkspaceId = selected.id;
        harness.state.accountCatalogs[selected.id] = catalog(selected.id);
        BrowserWindow.getAllWindows()[0].webContents.send('workbench:state', harness.state);
        return ok(harness.state);
      }
      if (method === 'studio/export-connection') {
        if (payload.id !== 'admin' || !['alpha', 'beta'].includes(payload.memberId)) return { ok: false, error: 'Wrong export target' };
        return ok({ saved: true, path: 'C:\\synthetic-only\\member.awworkspace' });
      }
      if (method === 'accounts/assign') {
        if (payload.id !== 'admin' || payload.expectedRevision !== harness.authority.policyRevision) return { ok: false, error: 'Synthetic grant revision conflict' };
        const row = harness.authority.assignments.find(row => row.username === payload.username);
        if (!row) return { ok: false, error: 'Unknown workspace' };
        row.accountIds = [...payload.accountIds]; harness.authority.policyRevision++;
        return complete('accounts/list', 'admin', catalog('admin'));
      }
      if (method === 'clipboard/write') { harness.clipboard = payload.text; return ok(null); }
      if (method === 'codex-auth/current') {
        if (harness.currentErrors[payload.id]) return { ok: false, error: harness.currentErrors[payload.id] };
        const entry = Object.values(harness.jobs).reverse().find(item => item.value.hostId === payload.id && (['preparing', 'awaiting-code', 'verifying'].includes(item.value.state) || item.value.cleanup !== 'confirmed'));
        return ok(entry ? structuredClone(entry.value) : null);
      }
      if (method === 'accounts/list') {
        const result = { ...catalog(payload.id), ...harness.nextCatalog };
        harness.nextCatalog = null;
        if (harness.holdList) { harness.holdList = false; return delayed(method, payload.id, result); }
        return complete(method, payload.id, result);
      }
      if (method === 'accounts/select') {
        const selection = harness.selections[payload.id];
        if (!selection) return { ok: false, error: 'An administrator cannot select a workspace default' };
        if (payload.expectedRevision !== selection.selectionRevision) return { ok: false, error: 'Synthetic selection revision conflict' };
        if (!harness.authority.accounts.some(item => item.id === payload.accountId && ['authenticated', 'configured'].includes(item.status))) return { ok: false, error: 'Synthetic account is not selectable' };
        selection.selectedAccountId = payload.accountId;
        selection.selectionRevision++;
        const result = catalog(payload.id);
        if (harness.holdSelect) { harness.holdSelect = false; return delayed(method, payload.id, result); }
        return complete(method, payload.id, result);
      }
      if (method === 'codex-auth/start') {
        if(payload.id!=='admin')return {ok:false,error:'Only an administrator may add accounts'};
        const next = harness.nextJob ?? {}; harness.nextJob = null;
        const now = Date.now();
        const job = { jobId: `synthetic-job-${harness.nextId++}`, hostId: payload.id, state: 'preparing', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + (next.durationMs ?? 60000)).toISOString(), cleanup: 'pending', authorityId: harness.authority.authorityId, generation: harness.authority.generation, profilePath: '/SYNTHETIC_PRIVATE_PROFILE_MUST_NOT_RENDER', ...next };
        // Deliberately injected legacy profile data must never be displayed.
        delete job.durationMs;
        const queue = job.queue ?? []; delete job.queue;
        const publishAccount = job.publishAccount; delete job.publishAccount;
        const entry = harness.jobs[job.jobId] = { value: job, queue, publishAccount, published: false };
        publish(entry);
        if (harness.holdStart) { harness.holdStart = false; return delayed(method, payload.id, structuredClone(job), { jobId: job.jobId }); }
        return ok(job);
      }
      if (method === 'codex-auth/status') {
        const entry = harness.jobs[payload.jobId];
        if (!entry || entry.value.hostId !== payload.id) return { ok: false, error: 'Synthetic job binding mismatch' };
        if (entry.queue.length) {
          const next = { ...entry.queue.shift() };
          if (next.publishAccount) { entry.publishAccount = next.publishAccount; delete next.publishAccount; }
          entry.value = { ...entry.value, ...next };
        }
        publish(entry);
        const snapshot = structuredClone(entry.value);
        if (harness.holdStatus) { harness.holdStatus = false; return delayed(method, payload.id, snapshot, { jobId: payload.jobId }); }
        return ok(snapshot);
      }
      if (method === 'codex-auth/cancel') {
        const entry = harness.jobs[payload.jobId];
        if (!entry || entry.value.hostId !== payload.id) return { ok: false, error: 'Synthetic cancel binding mismatch' };
        const active = ['preparing', 'awaiting-code', 'verifying'].includes(entry.value.state);
        entry.value = { ...entry.value, state: active ? 'cancelled' : entry.value.state, userCode: undefined, verificationUrl: undefined, cleanup: harness.cancelCleanup };
        harness.cancelCleanup = 'confirmed';
        return ok(entry.value);
      }
      if (method === 'codex-auth/open') { harness.opened.push(payload); return ok(null); }
      harness.unexpected.push({ method, payload });
      return { ok: false, error: `Unexpected synthetic request: ${method}` };
    });
    BrowserWindow.getAllWindows()[0].webContents.send('workbench:state', fixture.state);
  }, { state, accounts: [account('account-one', 'shared-one@example.invalid'), account('account-two', 'shared-two@example.invalid')] });

  const requests = () => app.evaluate(() => globalThis.__codexLoginHarness.requests);
  const count = async method => (await requests()).filter(request => request.method === method).length;
  const configure = value => app.evaluate((_electron, value) => { Object.assign(globalThis.__codexLoginHarness, value); }, value);
  const selections = () => app.evaluate(() => globalThis.__codexLoginHarness.selections);
  const latestRequest = async method => (await requests()).filter(request => request.method === method).at(-1);
  const pending = (method, id) => app.evaluate((_electron, { method, id }) => globalThis.__codexLoginHarness.pending.some(item => item.method === method && (!id || item.id === id)), { method, id });
  const release = (method, id) => app.evaluate((_electron, { method, id }) => {
    const harness = globalThis.__codexLoginHarness;
    const index = harness.pending.findIndex(item => item.method === method && (!id || item.id === id));
    if (index < 0) throw new Error(`No pending ${method} for ${id}`);
    harness.pending.splice(index, 1)[0].finish();
  }, { method, id });
  const queue = updates => app.evaluate((_electron, updates) => {
    const entry = Object.values(globalThis.__codexLoginHarness.jobs).at(-1);
    if (!entry) throw new Error('No synthetic auth job');
    entry.queue.push(...updates);
  }, updates);
  const navigate = async id => navigateWorkbench(page,id);
  const switchHost = async id => { await page.getByTestId(`host-${id}`).click(); await revealControl(page,'codex-login');await page.getByTestId('codex-login').waitFor(); };
  const option = id => page.getByTestId(`account-option-${id}`);
  const expectState = value => page.locator(`[data-testid="codex-auth-state"][data-state="${value}"]`).waitFor();
  const readCatalog = async id => {
    const before = await count('accounts/list');
    await page.getByTestId('accounts-refresh').click();
    await waitUntil(async () => await count('accounts/list') === before + 1, 'explicit catalog read');
    assert.deepEqual((await latestRequest('accounts/list')).payload, { id });
    await page.getByTestId('accounts-catalog').waitFor();
    await waitUntil(() => page.getByTestId('accounts-refresh').isEnabled(), 'catalog read completion');
    while (await page.locator('.codex-account-metadata:not([open]) > summary').count()) await page.locator('.codex-account-metadata:not([open]) > summary').first().click();
  };
  const expectChoice = async id => {
    await option(id).waitFor();
    assert.equal(await option(id).getAttribute('type'), 'radio');
    await waitUntil(() => option(id).isChecked(), `workspace default ${id}`);
  };
  const startAwaiting = async extra => {
    await configure({ nextJob: { ...awaiting, ...extra } });
    await waitUntil(() => page.getByTestId('codex-auth-start').isEnabled(), 'ready shared authority');
    await page.getByTestId('codex-auth-start').click();
    await expectState('awaiting-code');
  };

  await navigate('connections');
  await check('admin and workspace mounts make no catalog, authentication, or private-profile requests', async () => {
    await switchHost('admin');
    assert.equal(await page.getByTestId('accounts-refresh').count(), 1);
    assert.equal(await page.getByTestId('codex-auth-start').isDisabled(), true);
    assert.equal(await page.getByTestId('accounts-select').count(), 0);
    assert.equal(await page.getByTestId('codex-login').getByRole('radio').count(), 0);
    await switchHost('alpha');
    await pause(100);
    for (const method of ['accounts/list', 'accounts/select', 'codex-auth/start', 'codex-auth/account']) assert.equal(await count(method), 0);
    assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
    assert.equal(await page.getByRole('button', { name: /Claude.*登录|登录.*Claude/ }).count(), 0);
    assert.equal(await page.getByTestId('codex-read-account').count(), 0);
    assert.doesNotMatch(await page.getByTestId('codex-login').innerText(), /\.agent-workbench\/codex|独立 Profile/);
  });
  await check('explicit catalog read displays shared metadata and native workspace selection controls', async () => {
    await readCatalog('alpha');
    await expectChoice('account-one');
    assert.equal(await option('account-two').getAttribute('type'), 'radio');
    assert.equal(await page.getByTestId('accounts-catalog').getAttribute('data-availability'), 'ready');
    const text = await page.getByTestId('accounts-catalog').innerText();
    assert.match(text, /shared-one@example\.invalid/);
    assert.match(text, /shared-two@example\.invalid/);
    assert.match(text, /Synthetic plan/);
    assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
    assert.equal(await count('codex-auth/start'), 0);
    assert.equal(await count('accounts/select'), 0);
  });
  await check('saving Alpha default uses its selection revision without changing Beta', async () => {
    const before = await selections();
    await option('account-two').check();
    const saves = await count('accounts/select');
    await page.getByTestId('accounts-select').click();
    await waitUntil(async () => await count('accounts/select') === saves + 1, 'Alpha account selection');
    assert.deepEqual((await latestRequest('accounts/select')).payload, { id: 'alpha', accountId: 'account-two', expectedRevision: before.alpha.selectionRevision });
    assert.deepEqual((await selections()).beta, before.beta);
    assert.equal((await selections()).alpha.selectedAccountId, 'account-two');
    await switchHost('beta');
    await readCatalog('beta');
    await expectChoice('account-one');
    assert.equal(await option('account-two').isChecked(), false);
    await switchHost('alpha');
    await readCatalog('alpha');
    await expectChoice('account-two');
  });
  await check('administrator reads the same shared directory and adds accounts without workspace selectors', async () => {
    const reads = await count('accounts/list');
    await switchHost('admin');
    await pause(100);
    assert.equal(await count('accounts/list'), reads);
    assert.equal(await page.getByTestId('codex-auth-start').isDisabled(), true);
    await readCatalog('admin');
    const text = await page.getByTestId('accounts-catalog').innerText();
    assert.match(text, /shared-one@example\.invalid/);
    assert.match(text, /shared-two@example\.invalid/);
    assert.equal(await page.getByTestId('accounts-select').count(), 0);
    assert.equal(await page.getByTestId('codex-login').getByRole('radio').count(), 0);
    assert.equal(await page.getByTestId('codex-auth-start').isEnabled(), true);
  });
  await check('explicit administrator login polls its bound device job without opening a browser', async () => {
    await configure({ nextJob: { queue: [awaiting] } });
    await page.getByTestId('codex-auth-start').click();
    await expectState('preparing');
    await expectState('awaiting-code');
    assert.deepEqual((await latestRequest('codex-auth/start')).payload, { id: 'admin' });
    assert.equal(await page.getByTestId('accounts-refresh').isDisabled(), true);
    assert.equal(await page.getByTestId('codex-user-code').innerText(), 'TEST-1234');
    assert.equal(await page.getByTestId('codex-verification-url').innerText(), awaiting.verificationUrl);
    assert.equal(await count('codex-auth/open'), 0);
    assert.doesNotMatch(await page.getByTestId('codex-login').innerText(), /SYNTHETIC_PRIVATE_PROFILE_MUST_NOT_RENDER/);
  });
  await check('copy and open actions carry only the current code, official URL, or host-bound job', async () => {
    await page.getByTestId('codex-copy-code').click();
    assert.equal(await app.evaluate(() => globalThis.__codexLoginHarness.clipboard), 'TEST-1234');
    await page.getByTestId('codex-copy-url').click();
    assert.equal(await app.evaluate(() => globalThis.__codexLoginHarness.clipboard), awaiting.verificationUrl);
    await page.getByTestId('codex-open-auth').click();
    assert.deepEqual(await app.evaluate(() => globalThis.__codexLoginHarness.opened), [{ id: 'admin', jobId: 'synthetic-job-1' }]);
  });
  await check('successful admin login refreshes the common catalog and never selects the added account', async () => {
    await queue([{ state: 'verifying', userCode: undefined, verificationUrl: undefined }]);
    await expectState('verifying');
    assert.equal(await page.getByTestId('codex-device-code').count(), 0);
    assert.doesNotMatch(await page.getByTestId('accounts-catalog').innerText(), /shared-added@example\.invalid/);
    const before = await selections();
    const reads = await count('accounts/list');
    const saves = await count('accounts/select');
    await queue([{ state: 'authenticated', cleanup: 'confirmed', accountId: addedAccount.id, publishAccount: addedAccount, account: { email: 'PRIVATE_ACCOUNT_MUST_NOT_RENDER', source: 'legacy-private-profile' } }]);
    await expectState('authenticated');
    await waitUntil(async () => await count('accounts/list') > reads, 'automatic catalog refresh after authentication');
    await waitUntil(async () => (await page.getByTestId('accounts-catalog').innerText()).includes(addedAccount.email), 'new shared metadata');
    assert.deepEqual((await latestRequest('accounts/list')).payload, { id: 'admin' });
    assert.equal(await count('accounts/select'), saves);
    assert.deepEqual(await selections(), before);
    assert.equal(await page.getByTestId('codex-auth-account').count(), 0);
    assert.doesNotMatch(await page.getByTestId('codex-login').innerText(), /SYNTHETIC_SHARED_METADATA_MUST_NOT_RENDER|SYNTHETIC_PRIVATE_PROFILE_MUST_NOT_RENDER|PRIVATE_ACCOUNT_MUST_NOT_RENDER/);
  });
  await check('the admin-added account is visible in both workspaces without changing either default', async () => {
    const cancels = await count('codex-auth/cancel');
    const reads = await count('accounts/list');
    await switchHost('alpha');
    await pause(100);
    assert.equal(await count('accounts/list'), reads);
    assert.equal(await count('codex-auth/cancel'), cancels);
    await readCatalog('alpha');
    await expectChoice('account-two');
    assert.equal(await option('account-three').count(), 1);
    await switchHost('beta');
    await readCatalog('beta');
    await expectChoice('account-one');
    assert.equal(await option('account-three').count(), 1);
    assert.equal(await count('codex-auth/cancel'), cancels);
  });
  for (const reason of ['shared-catalog-missing', 'shared-service-unavailable']) {
    await check(`${reason} blocks authentication without a private-profile fallback`, async () => {
      await switchHost('alpha');
      await configure({ nextCatalog: { availability: 'unavailable', reason, accounts: [], selectedAccountId: undefined } });
      const starts = await count('codex-auth/start');
      await readCatalog('alpha');
      assert.equal(await page.getByTestId('accounts-catalog').getAttribute('data-availability'), 'unavailable');
      assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
      assert.equal(await page.getByTestId('codex-login').getByRole('radio').count(), 0);
      assert.equal(await count('codex-auth/start'), starts);
      assert.equal(await count('codex-auth/account'), 0);
      await readCatalog('alpha');
      await expectChoice('account-two');
      assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
    });
  }
  await check('a delayed Alpha catalog cannot replace Beta metadata or its selected account', async () => {
    await configure({ holdList: true, nextCatalog: { accounts: [account('late-alpha', 'late-alpha-directory@example.invalid')] } });
    await page.getByTestId('accounts-refresh').click();
    await waitUntil(() => pending('accounts/list', 'alpha'), 'held Alpha catalog');
    assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
    await switchHost('beta');
    await readCatalog('beta');
    await expectChoice('account-one');
    await release('accounts/list', 'alpha');
    await pause(100);
    assert.doesNotMatch(await page.locator('body').innerText(), /late-alpha-directory@example\.invalid/);
    await expectChoice('account-one');
    assert.equal(await option('account-three').count(), 1);
  });
  await check('a delayed Alpha selection cannot alter Beta while preserving the bound remote save', async () => {
    await switchHost('alpha');
    await readCatalog('alpha');
    const before = await selections();
    await option('account-three').check();
    await configure({ holdSelect: true });
    await page.getByTestId('accounts-select').click();
    await waitUntil(() => pending('accounts/select', 'alpha'), 'held Alpha selection');
    assert.deepEqual((await latestRequest('accounts/select')).payload, { id: 'alpha', accountId: 'account-three', expectedRevision: before.alpha.selectionRevision });
    assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
    await switchHost('beta');
    await readCatalog('beta');
    await expectChoice('account-one');
    await release('accounts/select', 'alpha');
    await pause(100);
    await expectChoice('account-one');
    assert.equal(await option('account-three').isChecked(), false);
    assert.deepEqual((await selections()).beta, before.beta);
    await switchHost('alpha');
    await readCatalog('alpha');
    await expectChoice('account-three');
  });
  await check('a selection revision conflict clears stale controls without retrying or overwriting the remote default', async () => {
    const before = await selections();
    const saves = await count('accounts/select');
    const reads = await count('accounts/list');
    await option('account-two').check();
    // Another client changes the remote selection generation after this UI's
    // explicit read. The stale expectedRevision must be rejected exactly once.
    await app.evaluate(() => { globalThis.__codexLoginHarness.selections.alpha.selectionRevision++; });
    await page.getByTestId('accounts-select').click();
    await page.getByTestId('codex-auth-error').waitFor();
    assert.match(await page.getByTestId('codex-auth-error').innerText(), /Synthetic selection revision conflict/);
    assert.deepEqual((await latestRequest('accounts/select')).payload, { id: 'alpha', accountId: 'account-two', expectedRevision: before.alpha.selectionRevision });
    assert.equal(await page.getByTestId('accounts-catalog').count(), 0);
    assert.equal(await page.getByTestId('accounts-select').count(), 0);
    assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
    await pause(150);
    assert.equal(await count('accounts/select'), saves + 1);
    assert.equal(await count('accounts/list'), reads);
    assert.equal((await selections()).alpha.selectedAccountId, before.alpha.selectedAccountId);
    assert.deepEqual((await selections()).beta, before.beta);
    await readCatalog('alpha');
    await expectChoice('account-three');
    assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
  });
  await check('unconfirmed cleanup blocks another login and offers a bound cleanup retry', async () => {
    await switchHost('admin');await readCatalog('admin');
    await configure({ nextJob: { state: 'failed', cleanup: 'unconfirmed', error: 'Synthetic failure with cleanup unconfirmed' } });
    await page.getByTestId('codex-auth-start').click();
    await expectState('failed');
    assert.equal(await page.getByTestId('codex-auth-start').isDisabled(), true);
    assert.match(await page.getByTestId('codex-auth-cleanup').innerText(), /尚未确认/);
    await page.getByTestId('codex-auth-retry-cleanup').click();
    await waitUntil(() => page.getByTestId('codex-auth-start').isEnabled(), 'confirmed retry cleanup');
    assert.match(await page.getByTestId('codex-auth-cleanup').innerText(), /清理已确认/);
  });
  await check('explicit cancellation clears the device code and waits for cleanup confirmation', async () => {
    await startAwaiting();
    await page.getByTestId('codex-auth-cancel').click();
    await expectState('cancelled');
    assert.equal(await page.getByTestId('codex-device-code').count(), 0);
    assert.match(await page.getByTestId('codex-auth-cleanup').innerText(), /清理已确认/);
  });
  await check('expiry removes code actions, requests cleanup, and rejects a delayed active status', async () => {
    await configure({ holdStatus: true });
    await startAwaiting({ durationMs: 900 });
    await waitUntil(() => pending('codex-auth/status', 'admin'), 'status held across expiry');
    await expectState('expired');
    assert.equal(await page.getByTestId('codex-device-code').count(), 0);
    await release('codex-auth/status', 'admin');
    await pause(100);
    assert.equal(await page.getByTestId('codex-auth-state').getAttribute('data-state'), 'expired');
  });
  await check('switching hosts cancels the original device job and ignores its delayed status', async () => {
    await configure({ holdStatus: true });
    await startAwaiting();
    await waitUntil(() => pending('codex-auth/status', 'admin'), 'status held before host switch');
    const cancels = await count('codex-auth/cancel');
    await switchHost('beta');
    await waitUntil(async () => await count('codex-auth/cancel') === cancels + 1, 'cancel after host switch');
    await release('codex-auth/status', 'admin');
    await pause(100);
    assert.equal(await page.getByTestId('codex-user-code').count(), 0);
    assert.equal(await page.getByTestId('codex-auth-state').count(), 0);
    assert.equal((await latestRequest('codex-auth/cancel')).payload.id, 'admin');
    await readCatalog('beta');
    await expectChoice('account-one');
  });
  await check('a start response arriving after a host switch is cancelled against its original host', async () => {
    await switchHost('admin');await readCatalog('admin');
    await configure({ holdStart: true, nextJob: awaiting });
    await page.getByTestId('codex-auth-start').click();
    await waitUntil(() => pending('codex-auth/start', 'admin'), 'held start before switch');
    const cancels = await count('codex-auth/cancel');
    await switchHost('alpha');
    await release('codex-auth/start', 'admin');
    await waitUntil(async () => await count('codex-auth/cancel') === cancels + 1, 'late start cleanup');
    assert.equal((await latestRequest('codex-auth/cancel')).payload.id, 'admin');
    assert.equal(await page.getByTestId('codex-user-code').count(), 0);
    await readCatalog('alpha');
    await expectChoice('account-three');
  });
  await check('shared controls fit 860px and leaving Connections cancels pending authorization', async () => {
    await switchHost('admin');await readCatalog('admin');
    await startAwaiting();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640));
    await waitUntil(() => page.evaluate(() => innerWidth === 860), 'minimum window width');
    const layout = await page.getByTestId('codex-login').evaluate(element => { const bounds = element.getBoundingClientRect(); return { left: bounds.left, right: bounds.right, scroll: element.scrollWidth, width: element.clientWidth }; });
    assert.ok(layout.left >= 0 && layout.right <= 860 && layout.scroll <= layout.width + 1, JSON.stringify(layout));
    const cancels = await count('codex-auth/cancel');
    await navigate('workspace');
    await waitUntil(async () => await count('codex-auth/cancel') === cancels + 1, 'cancel after leaving page');
  });
  await check('returning to Connections explicitly rereads the directory and restores workspace defaults', async () => {
    const reads = await count('accounts/list');
    await navigate('connections');
    await switchHost('alpha');
    await pause(100);
    assert.equal(await count('accounts/list'), reads);
    assert.equal(await page.getByTestId('codex-auth-start').count(), 0);
    await readCatalog('alpha');
    await expectChoice('account-three');
    assert.equal(await option('account-one').count(), 1);
    assert.equal(await option('account-two').count(), 1);
  });
  await check('returning to a host restores an unconfirmed cancellation and can retry that exact cleanup', async () => {
    await switchHost('admin');await readCatalog('admin');
    await startAwaiting();
    const activeJobId = await app.evaluate(() => Object.values(globalThis.__codexLoginHarness.jobs).at(-1).value.jobId);
    const starts = await count('codex-auth/start');
    const cancels = await count('codex-auth/cancel');
    await configure({ cancelCleanup: 'unconfirmed' });
    await switchHost('beta');
    await waitUntil(async () => await count('codex-auth/cancel') === cancels + 1, 'unconfirmed cleanup after leaving Alpha');
    await switchHost('admin');
    await page.getByTestId('codex-auth-retry-cleanup').waitFor();
    assert.deepEqual((await latestRequest('codex-auth/current')).payload, { id: 'admin' });
    assert.equal(await page.getByTestId('codex-auth-start').isDisabled(), true);
    assert.match(await page.getByTestId('codex-auth-cleanup').innerText(), /尚未确认/);
    await page.getByTestId('codex-auth-retry-cleanup').click();
    await waitUntil(async () => await count('codex-auth/cancel') === cancels + 2, 'restored job cleanup retry');
    assert.deepEqual((await latestRequest('codex-auth/cancel')).payload, { id: 'admin', jobId: activeJobId });
    await waitUntil(async () => (await page.getByTestId('codex-auth-cleanup').innerText()).includes('清理已确认'), 'restored cleanup confirmed');
    await readCatalog('admin');
    assert.equal(await page.getByTestId('codex-auth-start').isEnabled(), true);
    assert.equal(await count('codex-auth/start'), starts);
  });
  await check('failed in-memory job recovery blocks authentication until an explicit successful retry', async () => {
    await switchHost('beta');
    const reads = await count('accounts/list');
    const starts = await count('codex-auth/start');
    await configure({ currentErrors: { admin: 'Synthetic in-memory job recovery unavailable' } });
    await switchHost('admin');
    await page.getByTestId('codex-auth-recover').waitFor();
    assert.equal(await page.getByTestId('codex-auth-start').isDisabled(), true);
    assert.equal(await count('accounts/list'), reads);
    assert.equal(await count('codex-auth/start'), starts);
    await configure({ currentErrors: {} });
    const recoveries = await count('codex-auth/current');
    await page.getByTestId('codex-auth-recover').click();
    await waitUntil(async () => await count('codex-auth/current') === recoveries + 1, 'explicit recovery retry');
    await page.getByTestId('codex-auth-recover').waitFor({ state: 'hidden' });
    assert.equal(await count('accounts/list'), reads);
    assert.equal(await count('codex-auth/start'), starts);
    await readCatalog('admin');
    assert.equal(await page.getByTestId('codex-auth-start').isEnabled(), true);
  });
  await check('projectless composer refreshes shared accounts and changes only its workspace default', async () => {
    const before = await selections();
    const reads = await count('accounts/list');
    const saves = await count('accounts/select');
    const creates = await count('session/create');
    const sessionsBefore = await app.evaluate(() => globalThis.__codexLoginHarness.state.sessions.length);
    await switchHost('alpha');
    await page.getByTestId('workspace-activate').click();
    await page.getByTestId('workspace-active').waitFor();
    await navigate('workspace');
    await page.getByTestId('new-session').click();
    await page.getByTestId('composer-runtime').selectOption('codex');
    assert.equal(await page.getByTestId('composer-host').count(), 0);
    assert.equal(await page.getByTestId('composer-workspace-label').innerText(), 'Synthetic alpha');
    const picker = page.getByTestId('composer-account');
    await picker.waitFor();
    assert.equal(await picker.isEnabled(), true);
    assert.equal(await picker.inputValue(), 'account-three');
    assert.deepEqual(await picker.locator('option').evaluateAll(options => options.filter(option => option.value).map(option => option.value)), ['account-one', 'account-two', 'account-three']);
    assert.match(await picker.innerText(), /shared-added@example\.invalid/);
    assert.equal(await count('accounts/list'), reads);
    await page.getByTestId('composer-accounts-refresh').click();
    await waitUntil(async () => await count('accounts/list') === reads + 1, 'explicit composer account refresh');
    assert.deepEqual((await latestRequest('accounts/list')).payload, { id: 'alpha' });
    await waitUntil(() => picker.isEnabled(), 'composer catalog refresh completion');
    await picker.selectOption('account-two');
    await waitUntil(async () => await count('accounts/select') === saves + 1, 'composer account selection');
    assert.deepEqual((await latestRequest('accounts/select')).payload, { id: 'alpha', accountId: 'account-two', expectedRevision: before.alpha.selectionRevision });
    await waitUntil(async () => (await picker.inputValue()) === 'account-two' && await picker.isEnabled(), 'broadcast composer selection');
    assert.deepEqual((await selections()).beta, before.beta);
    assert.equal((await selections()).alpha.selectedAccountId, 'account-two');
    const cached = await app.evaluate(() => globalThis.__codexLoginHarness.state.accountCatalogs.alpha);
    assert.equal(cached.selectedAccountId, 'account-two');
    assert.equal(cached.selectionRevision, before.alpha.selectionRevision + 1);
    await navigate('connections'); await switchHost('beta');
    await page.getByTestId('workspace-activate').click(); await page.getByTestId('workspace-active').waitFor();
    await navigate('workspace'); await page.getByTestId('composer-runtime').selectOption('codex');
    await waitUntil(async () => (await picker.inputValue()) === 'account-one', 'Beta composer default remains unchanged');
    assert.equal(await count('session/create'), creates);
    assert.equal(await app.evaluate(() => globalThis.__codexLoginHarness.state.sessions.length), sessionsBefore);
    assert.equal((await requests()).filter(item => /^draft\//.test(item.method)).length, 0);
    await navigate('connections');
    await switchHost('alpha');
    await readCatalog('alpha');
    await expectChoice('account-two');
  });
  await check('existing broker catalog supports administrator grants and configured member choices without another login', async () => {
    const starts = await count('codex-auth/start');
    await app.evaluate(() => {
      const h = globalThis.__codexLoginHarness;
      h.authority.source = 'existing-codex'; h.authority.policyRevision = 2;
      h.authority.accounts.forEach(account => { account.status = 'configured'; });
      h.authority.assignments = [{ username: 'alpha', accountIds: ['account-two'] }, { username: 'beta', accountIds: ['account-one'] }];
    });
    await switchHost('admin'); await readCatalog('admin');
    await page.getByTestId('existing-account-grants').waitFor();
    assert.equal(await page.getByTestId('codex-auth-start').isDisabled(), true);
    const grants = page.getByTestId('existing-account-grants');
    await grants.getByRole('combobox').selectOption('beta');
    await grants.getByRole('checkbox', { name: 'shared-two@example.invalid', exact: true }).check();
    await page.getByTestId('existing-grants-save').click();
    await waitUntil(async () => await count('accounts/assign') === 1 && await page.getByTestId('existing-grants-save').isEnabled(), 'saved existing broker grants');
    assert.deepEqual((await latestRequest('accounts/assign')).payload, { id: 'admin', username: 'beta', accountIds: ['account-one', 'account-two'], expectedRevision: 2 });
    await switchHost('beta'); await readCatalog('beta');
    await option('account-two').check(); await page.getByTestId('accounts-select').click();
    await waitUntil(async () => (await selections()).beta.selectedAccountId === 'account-two', 'configured account saved');
    assert.equal(await count('codex-auth/start'), starts);
  });
  await check('workspace export is visible beside import and binds administrator plus selected member', async () => {
    await switchHost('beta');
    await page.getByTestId('workspace-export-open').click();
    assert.equal(await page.getByTestId('workspace-export-member').inputValue(), 'beta');
    await page.getByTestId('workspace-export-save').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual((await latestRequest('studio/export-connection')).payload, { id: 'admin', memberId: 'beta' });
  });
  await check('renderer has no errors, private fallback, unexpected IPC, or pending cross-host work', async () => {
    assert.deepEqual(errors, []);
    const audit = await app.evaluate(() => ({ unexpected: globalThis.__codexLoginHarness.unexpected, pending: globalThis.__codexLoginHarness.pending.length }));
    assert.deepEqual(audit, { unexpected: [], pending: 0 });
    assert.equal(await count('codex-auth/account'), 0);
    const log = await requests();
    assert.equal(log.filter(item => item.method === 'accounts/select' && item.payload.id === 'admin').length, 0);
    assert.equal(log.filter(item => /^(?:draft\/|host\/(?:probe|discover|save))/.test(item.method)).length, 0);
    assert.doesNotMatch(await page.getByTestId('codex-login').innerText(), /SYNTHETIC_PRIVATE_PROFILE_MUST_NOT_RENDER|PRIVATE_ACCOUNT_MUST_NOT_RENDER|SYNTHETIC_SHARED_METADATA_MUST_NOT_RENDER/);
  });
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  if (app) await app.close();
  await writeFile(path.join(output, 'codex-login-ui-report.json'), JSON.stringify({ observedAt: new Date().toISOString(), screenshots: false, syntheticOnly: true, sharedAccountAuthority: true, checks, errors, ...(failure ? { failure } : {}) }, null, 2));
}
console.log(`Shared Codex account UI: ${checks.length}/${checks.length} passed; screenshots=false; syntheticOnly=true`);
