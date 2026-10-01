import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';
import { revealControl } from './ui-control-helpers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

// All connection, account and SSH responses below are synthetic. This test never
// connects to a server, reads credentials, or captures a screenshot.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build/qa');
const dataDir = path.join(output, `ssh-discovery-synthetic-${Date.now()}`);
await mkdir(dataDir, { recursive: true });
const env = { ...process.env, AGENT_WORKBENCH_TEST_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const checks = [];
const errors = [];
let app;
const record = name => { checks.push({ name, passed: true }); console.log(`PASS ${name}`); };
const waitUntil = async (predicate, description) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await predicate()) return; await pause(25); }
  throw new Error(`Timed out waiting for ${description}`);
};
const observedAt = '2026-09-25T00:00:00.000Z';
const runtime = (name, username) => ({
  installed: 'yes', path: `/opt/${name}/bin/${name}`, version: `${name} synthetic 1.0`,
  config: { status: 'known', source: `/home/${username}/.${name}/${name === 'codex' ? 'config.toml' : 'settings.json'}`, values: name === 'codex' ? { model: 'synthetic-model', approval_policy: 'on-request' } : { model: 'synthetic-claude', 'permissions.defaultMode': 'default' } },
  account: name === 'codex' ? { status: 'configured', source: 'codex-device-broker:list', selectedId: 'account-a', catalog: [{ id: 'account-a', email: 'fixture@example.invalid', plan: 'synthetic-plan', selected: true }] } : { status: 'unknown', source: 'claude auth status --json' },
  ...(name === 'codex' ? { nativeAccount: { status: 'unauthenticated', source: 'codex login status' } } : {}), warnings: [],
});
const workspace = (id, username = id) => ({
  id, name: `Synthetic ${id}`, username, uid: 1001, home: `/home/${username}`, root: `/home/${username}/workspaces`, classification: 'known-device-workspace', sources: ['/etc/synthetic/workspaces.json'], confidence: 'high', observedAt,
  ssh: { authorizationStatus: 'present', privateKeyStatus: 'not-inspected', authorizedKeys: [{ fingerprint: `SHA256:synthetic-${id}-public-fingerprint`, algorithm: 'ssh-ed25519', comment: `fixture-${id}`, source: `/home/${username}/.ssh/authorized_keys` }] },
  runtimes: { codex: runtime('codex', username), claude: runtime('claude', username) }, warnings: [],
});
const discovery = {
  hostId: '', ownerId: 'local-owner', generation: 'synthetic-generation', observedAt, effectiveUid: 0, privilege: 'root', registry: 'recognized', publicKeyFingerprints: ['SHA256:synthetic-admin-public-fingerprint'],
  accounts: [{ username: 'root', uid: 0, home: '/root', shell: '/bin/bash', classification: 'ordinary-account-unmapped', source: 'ssh-passwd', observedAt }],
  workspaces: [workspace('alpha'), workspace('beta'), workspace('gamma'), workspace('delta')], warnings: ['Synthetic discovery evidence only.'], stateHash: 'synthetic-hash',
};
discovery.workspaces[2].runtimes.codex.account = { status: 'unknown', source: 'codex-device-broker:list' };
discovery.workspaces[2].runtimes.codex.warnings = ['Legacy account catalog socket is missing; account binding is unknown.'];
discovery.workspaces[3].confidence = 'conflict';

try {
  app = await electron.launch({ executablePath: electronPath, args: [root], cwd: root, env, timeout: 45000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.workbench);
  const initialState = await page.evaluate(() => window.workbench.call('state/get'));
  await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => {
    const harness = globalThis.__sshUiHarness = { state: fixture.initialState, discovery: fixture.discovery, requests: [], pending: [], clipboard: '', holdDiscover: false, holdSave: false, nextId: 1 };
    const publish = () => BrowserWindow.getAllWindows()[0].webContents.send('workbench:state', harness.state);
    ipcMain.removeHandler('workbench:call');
    ipcMain.handle('workbench:call', async (_event, method, payload = {}) => {
      harness.requests.push({ method, payload });
      if (method === 'state/get') return { ok: true, value: harness.state };
      if (method === 'codex-auth/current') return { ok: true, value: null };
      if (method === 'navigation/get') return { ok: true, value: { sessionId: null } };
      if (method === 'clipboard/write') { harness.clipboard = payload.text; return { ok: true, value: null }; }
      if (method === 'host/save') {
        const saved = { ...payload.host, id: payload.host.id || `synthetic-host-${harness.nextId++}`, workspaceGeneration: 'synthetic-generation' };
        const complete = () => { harness.state.hosts = [...harness.state.hosts.filter(host => host.id !== saved.id), saved]; publish(); return { ok: true, value: saved }; };
        if (harness.holdSave) { harness.holdSave = false; return await new Promise(resolve => harness.pending.push({ method, id: saved.id, finish: () => resolve(complete()) })); }
        return complete();
      }
      if (method === 'host/discover') {
        const result = { ...harness.discovery, hostId: payload.id };
        if (harness.holdDiscover) { harness.holdDiscover = false; return await new Promise(resolve => harness.pending.push({ method, id: payload.id, finish: failure => resolve(failure ? { ok: false, error: failure } : { ok: true, value: result }) })); }
        return { ok: true, value: result };
      }
      return { ok: false, error: `Unexpected synthetic test request: ${method}` };
    });
  }, { initialState, discovery });
  const requests = () => app.evaluate(() => globalThis.__sshUiHarness.requests);
  const discoveryCount = async () => (await requests()).filter(request => request.method === 'host/discover').length;
  const hostId = async name => app.evaluate((_electron, name) => globalThis.__sshUiHarness.state.hosts.find(host => host.name === name)?.id, name);
  const release = async (method, failure = '') => app.evaluate((_electron, { method, failure }) => {
    const harness = globalThis.__sshUiHarness;
    const index = harness.pending.findIndex(item => item.method === method);
    if (index < 0) throw new Error(`No pending ${method}`);
    harness.pending.splice(index, 1)[0].finish(failure);
  }, { method, failure });
  const fillHost = async ({ name, username, role = 'workspace' }) => {
    await page.getByTestId('new-host').click();
    await page.getByTestId('host-name').fill(name);
    await page.getByTestId('hostname').fill('fixture.example.invalid');
    await page.getByTestId('port').fill('2222');
    await page.getByTestId('username').fill(username);
    await page.getByTestId('role').selectOption(role);
    await page.getByTestId('identity').fill(`C:\\synthetic-only\\${username}-identity`);
    await page.getByTestId('known-hosts').fill('C:\\synthetic-only\\known_hosts');
  };

  await navigateWorkbench(page,'connections');
  await fillHost({ name: 'Alpha local identity', username: 'alpha' });
  assert.equal(await page.getByTestId('save-host').innerText(), '保存连接描述');
  await page.getByTestId('save-host').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await discoveryCount(), 0);
  record('workspace connection save remains offline');
  const alphaId = await hostId('Alpha local identity');
  await page.getByTestId('host-standalone-members').getByTestId(`host-${alphaId}`).waitFor();
  assert.equal(await page.locator('[data-testid^="host-family-"]').count(), 0);
  assert.equal(await page.getByTestId(`host-${alphaId}`).count(), 1);
  record('a workspace without a matching administrator appears once in standalone members');

  await fillHost({ name: 'Synthetic administrator', username: 'root', role: 'admin' });
  assert.equal(await page.getByTestId('save-host').innerText(), '保存并只读识别');
  await page.getByTestId('save-host').click();
  await page.getByTestId('workspace-discovery').waitFor();
  assert.equal(await discoveryCount(), 1);
  assert.equal(await page.locator('.workspace-discovery-card').count(), 4);
  assert.match(await page.getByTestId('workspace-discovery').innerText(), /已识别 4 个工作空间/);
  record('administrator save automatically discovers a dynamic workspace count');
  const adminId = await hostId('Synthetic administrator');
  const family = page.getByTestId(`host-family-${adminId}`);
  const children = page.getByTestId(`host-children-${adminId}`);
  await children.getByTestId(`host-${alphaId}`).waitFor();
  assert.equal(await family.getByTestId(`host-${adminId}`).count(), 1);
  assert.equal(await children.getByTestId(`host-${adminId}`).count(), 0);
  assert.equal(await page.getByTestId('host-standalone-members').getByTestId(`host-${alphaId}`).count(), 0);
  assert.equal(await page.getByTestId(`host-${alphaId}`).count(), 1);
  assert.equal(await discoveryCount(), 1);
  record('saving the matching administrator moves the existing workspace into its child group without duplication');

  const alpha = page.getByTestId('workspace-alpha');
  assert.match(await alpha.innerText(), /\/home\/alpha\/workspaces/);
  assert.match(await alpha.innerText(), /\/etc\/synthetic\/workspaces\.json/);
  assert.match(await page.getByTestId('workspace-key-alpha').innerText(), /本机已关联工作空间私钥路径 · Alpha local identity/);
  assert.match(await page.getByTestId('workspace-key-beta').innerText(), /尚未关联/);
  assert.match(await alpha.getByTestId('runtime-codex').innerText(), /\/opt\/codex\/bin\/codex/);
  assert.match(await alpha.getByTestId('runtime-codex').innerText(), /synthetic-model/);
  record('workspace source, paths, runtime config and existing local identity are shown');

  const codex = alpha.getByTestId('runtime-codex');
  assert.match(await codex.getByTestId('native-account').innerText(), /未登录 · 原生状态返回/);
  assert.match(await codex.getByTestId('native-account').innerText(), /codex login status/);
  assert.match(await codex.getByTestId('broker-account').innerText(), /已配置 · 有效性未验证/);
  assert.match(await codex.getByTestId('broker-account').innerText(), /fixture@example\.invalid/);
  assert.match(await codex.getByTestId('broker-account').innerText(), /codex-device-broker:list/);
  assert.doesNotMatch(await codex.getByTestId('broker-account').innerText(), /已登录 · 原生状态返回/);
  assert.match(await alpha.getByTestId('runtime-claude').getByTestId('native-account').innerText(), /登录状态未知/);
  assert.match(await page.getByTestId('workspace-gamma').getByTestId('runtime-codex').getByTestId('broker-account').innerText(), /账号目录状态未知/);
  assert.match(await page.getByTestId('workspace-gamma').getByTestId('runtime-codex').getByTestId('broker-account').innerText(), /不代表已有账号丢失/);
  record('native login evidence and broker catalog remain separate, with honest unknown states');

  await page.getByTestId('copy-workspace-alpha').click();
  const clipboard = await app.evaluate(() => globalThis.__sshUiHarness.clipboard);
  assert.match(clipboard, /alpha@fixture\.example\.invalid/);
  assert.match(clipboard, /2222/);
  assert.match(clipboard, /SHA256:synthetic-alpha-public-fingerprint/);
  assert.doesNotMatch(clipboard, /C:\\|synthetic-only|root-identity|account-a|fixture@example/);
  record('copy shares only connection and public-key metadata');

  const treeIds = {
    secondAdmin: 'synthetic-tree-second-admin', normalizedMember: 'synthetic-tree-normalized-member',
    otherOwner: 'synthetic-tree-other-owner', otherPort: 'synthetic-tree-other-port', otherHost: 'synthetic-tree-other-host',
  };
  const beforeTreeRequests = await requests();
  await app.evaluate(({ BrowserWindow }, { adminId, alphaId, ids }) => {
    const harness = globalThis.__sshUiHarness;
    const admin = harness.state.hosts.find(host => host.id === adminId);
    const member = harness.state.hosts.find(host => host.id === alphaId);
    if (!admin || !member) throw new Error('The saved hierarchy fixtures are missing.');
    harness.state.hosts.push(
      { ...admin, id: ids.secondAdmin, name: 'Second administrator for the same endpoint', username: 'second-root', hostname: `  ${admin.hostname.toUpperCase()}  ` },
      { ...member, id: ids.normalizedMember, name: 'Member with normalized hostname', username: 'normalized-member', hostname: `  ${admin.hostname.toUpperCase()}  ` },
      { ...member, id: ids.otherOwner, name: 'Same endpoint, different owner', username: 'other-owner-member', ownerId: `${admin.ownerId}-different` },
      { ...member, id: ids.otherPort, name: 'Same hostname, different SSH port', username: 'other-port-member', port: admin.port + 1 },
      { ...member, id: ids.otherHost, name: 'Different SSH hostname', username: 'other-host-member', hostname: 'different-fixture.example.invalid' },
    );
    BrowserWindow.getAllWindows()[0].webContents.send('workbench:state', harness.state);
  }, { adminId, alphaId, ids: treeIds });
  await children.getByTestId(`host-${treeIds.normalizedMember}`).waitFor();
  const childIds = await children.locator('.host-card').evaluateAll(elements => elements.map(element => element.dataset.testid).sort());
  assert.deepEqual(childIds, [`host-${alphaId}`, `host-${treeIds.normalizedMember}`].sort());
  const standalone = page.getByTestId('host-standalone-members');
  const standaloneIds = await standalone.locator('.host-card').evaluateAll(elements => elements.map(element => element.dataset.testid).sort());
  assert.deepEqual(standaloneIds, [treeIds.otherOwner, treeIds.otherPort, treeIds.otherHost].map(id => `host-${id}`).sort());
  for (const id of [treeIds.otherOwner, treeIds.otherPort, treeIds.otherHost]) {
    assert.equal(await family.getByTestId(`host-${id}`).count(), 0);
    assert.equal(await page.getByTestId(`host-${id}`).count(), 1);
  }
  record('connection families normalize hostname case and whitespace while keeping other owners, ports and hostnames standalone');
  assert.equal(await page.locator('[data-testid^="host-family-"]').count(), 1);
  assert.equal(await page.getByTestId(`host-family-${treeIds.secondAdmin}`).count(), 0);
  assert.equal(await family.getByTestId(`host-${treeIds.secondAdmin}`).count(), 1);
  assert.equal(await children.getByTestId(`host-${treeIds.secondAdmin}`).count(), 0);
  assert.equal(await page.getByTestId(`host-${alphaId}`).count(), 1);
  assert.equal(await page.getByTestId(`host-${treeIds.normalizedMember}`).count(), 1);
  await pause(100);
  assert.deepEqual(await requests(), beforeTreeRequests);
  record('multiple administrators share one family and one member list without issuing additional requests');

  await children.getByTestId(`host-${alphaId}`).click();
  await page.locator('.host-detail').getByRole('heading', { name: 'Alpha local identity', exact: true }).waitFor();
  assert.equal(await page.getByTestId(`host-${alphaId}`).getAttribute('class'), 'host-card selected');
  await page.getByTestId('connection-tab-details').click();
  assert.match(await page.locator('.host-detail .detail-list').innerText(), /工作空间用户/);
  await page.locator('.host-detail').getByRole('button', { name: '编辑描述', exact: true }).click();
  assert.equal(await page.getByTestId('host-name').inputValue(), 'Alpha local identity');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await family.getByTestId(`host-${treeIds.secondAdmin}`).click();
  await page.locator('.host-detail').getByRole('heading', { name: 'Second administrator for the same endpoint', exact: true }).waitFor();
  assert.equal(await page.getByTestId(`host-${treeIds.secondAdmin}`).getAttribute('class'), 'host-card selected');
  await family.getByTestId(`host-${adminId}`).click();
  await page.locator('.host-detail').getByRole('heading', { name: 'Synthetic administrator', exact: true }).waitFor();
  assert.equal(await discoveryCount(), 1);
  record('grouped workspace and administrator buttons still select the correct details and preserve workspace editing');

  await app.evaluate(() => { globalThis.__sshUiHarness.holdDiscover = true; });
  await revealControl(page,'discover-workspaces');await page.getByTestId('discover-workspaces').click();
  await waitUntil(() => app.evaluate(() => globalThis.__sshUiHarness.pending.some(item => item.method === 'host/discover')), 'pending discovery');
  await page.getByTestId(`host-${alphaId}`).click();
  await release('host/discover');
  await pause(100);
  assert.equal(await page.getByTestId('workspace-discovery').count(), 0);
  assert.equal(await page.getByTestId(`host-${alphaId}`).getAttribute('class'), 'host-card selected');
  record('late discovery results cannot cross into another selected host');

  await page.getByTestId(`host-${adminId}`).click();
  await app.evaluate(() => { globalThis.__sshUiHarness.holdDiscover = true; });
  await revealControl(page,'discover-workspaces');await page.getByTestId('discover-workspaces').click();
  await waitUntil(() => app.evaluate(() => globalThis.__sshUiHarness.pending.some(item => item.method === 'host/discover')), 'pending failure');
  await page.getByTestId(`host-${alphaId}`).click();
  await release('host/discover', 'SYNTHETIC_STALE_ERROR');
  await pause(100);
  assert.doesNotMatch(await page.locator('body').innerText(), /SYNTHETIC_STALE_ERROR/);
  record('late discovery errors cannot interrupt another selected host');

  await page.getByTestId(`host-${adminId}`).click();
  await app.evaluate(() => { globalThis.__sshUiHarness.holdDiscover = true; });
  await revealControl(page,'discover-workspaces');await page.getByTestId('discover-workspaces').click();
  await waitUntil(() => app.evaluate(() => globalThis.__sshUiHarness.pending.some(item => item.method === 'host/discover')), 'discovery before unmount');
  await navigateWorkbench(page,'workspace');
  await release('host/discover');
  await navigateWorkbench(page,'connections');
  assert.equal(await page.getByTestId('workspace-discovery').count(), 0);
  record('unmounted connection view ignores late discovery');

  const beforeCancelled = await discoveryCount();
  await fillHost({ name: 'Cancelled stale save', username: 'root', role: 'admin' });
  await app.evaluate(() => { globalThis.__sshUiHarness.holdSave = true; });
  await page.getByTestId('save-host').click();
  await waitUntil(() => app.evaluate(() => globalThis.__sshUiHarness.pending.some(item => item.method === 'host/save')), 'pending save');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await fillHost({ name: 'Newer draft', username: 'beta' });
  await release('host/save');
  await pause(100);
  assert.equal(await page.getByTestId('host-name').inputValue(), 'Newer draft');
  assert.equal(await discoveryCount(), beforeCancelled);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  record('cancelled save cannot close a newer draft or start stale discovery');

  await page.getByTestId(`host-${adminId}`).click();
  await revealControl(page,'discover-workspaces');await page.getByTestId('discover-workspaces').click();
  await page.getByTestId('workspace-discovery').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640));
  await waitUntil(() => page.evaluate(() => innerWidth === 860), 'narrow viewport');
  const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('.workspace-discovery-card')).map(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  }));
  for (const box of overflow) { assert.ok(box.left >= 0 && box.right <= 860); assert.ok(box.scrollWidth <= box.clientWidth + 1); }
  record('workspace cards fit the minimum supported window width without horizontal overflow');
  const treeOverflow = await page.locator('.host-list .host-card').evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  }));
  assert.ok(treeOverflow.length >= 7);
  for (const box of treeOverflow) { assert.ok(box.left >= 0 && box.right <= 860); assert.ok(box.scrollWidth <= box.clientWidth + 1); }
  record('administrator families and standalone members fit the minimum supported window width');

  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__sshUiHarness.state.hosts = [];
    BrowserWindow.getAllWindows()[0].webContents.send('workbench:state', globalThis.__sshUiHarness.state);
  });
  await page.locator('.connection-empty').waitFor();
  const beforeFirstAdmin = await discoveryCount();
  await fillHost({ name: 'First administrator in empty state', username: 'root', role: 'admin' });
  await page.getByTestId('save-host').click();
  await page.getByTestId('workspace-discovery').waitFor();
  assert.equal(await discoveryCount(), beforeFirstAdmin + 1);
  assert.match(await page.locator('.host-card.selected').innerText(), /First administrator in empty state/);
  record('first administrator save survives the empty-list refresh and auto-discovers');
  assert.deepEqual(errors, []);
  record('renderer reports no errors');
} finally {
  if (app) await app.close();
  await writeFile(path.join(output, 'ssh-discovery-ui-report.json'), JSON.stringify({ observedAt: new Date().toISOString(), screenshots: false, syntheticOnly: true, checks, errors }, null, 2));
}
console.log(`SSH discovery UI: ${checks.length}/${checks.length} passed; screenshots=false; syntheticOnly=true`);
