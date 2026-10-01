import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverWorkspaces, parseWorkspaceDiscovery } from '../services/host-control/index';
import { DISCOVERY_COMMAND, DISCOVERY_PYTHON } from '../services/host-control/discovery-script';
import type { SshHost } from '../packages/contracts/index';

const host: SshHost = { id: 'fixture-admin', name: 'fixture', hostname: 'fixture.invalid', port: 22, username: 'root', role: 'admin', identityFile: path.resolve('fixtures/no-key'), knownHostsFile: path.resolve('fixtures/no-known-hosts'), ownerId: 'fixture-owner', workspaceGeneration: '1' };
const observedAt = '2026-09-25T00:00:00Z';
const fingerprint = 'SHA256:abcdefghijklmnopqrstuvwxy01234567890';
const emptyRuntime = () => ({ installed: 'unknown', config: { status: 'unknown', values: {} }, account: { status: 'unknown' }, warnings: [] });
function fixture(count = 3) {
  const accounts = Array.from({ length: count }, (_, index) => ({ username: `owner-${index}`, uid: 1000 + index, home: `/home/owner-${index}`, shell: '/bin/bash' }));
  const workspaces = accounts.map(account => ({ id: account.username, name: account.username, username: account.username, uid: account.uid, home: account.home, root: `${account.home}/workspaces`, classification: 'known-device-workspace', sources: ['/etc/codex-devices/allowed-users.json', `${account.home}/.codex-device/device.json`], confidence: 'high', ssh: { authorizationStatus: 'present', privateKeyStatus: 'not-inspected', authorizedKeys: [{ fingerprint, algorithm: 'ssh-ed25519', comment: 'fixture device', source: `${account.home}/.ssh/authorized_keys` }] }, runtimes: { codex: emptyRuntime(), claude: emptyRuntime() }, warnings: [] }));
  return { protocol: 2, effectiveUid: 0, accounts, registry: 'recognized', publicKeyFingerprints: [fingerprint], workspaces, warnings: [] };
}
const parse = (value: unknown, timestamp = observedAt) => parseWorkspaceDiscovery(JSON.stringify(value), host, timestamp);

test('legacy workspace discovery uses registry evidence and does not fix the count at three', () => {
  for (const count of [1, 3, 5]) {
    const found = parse(fixture(count));
    assert.equal(found.workspaces.length, count);
    assert.equal(found.workspaces[0]?.ssh.privateKeyStatus, 'not-inspected');
    assert.equal(found.workspaces[0]?.ssh.authorizedKeys[0]?.fingerprint, fingerprint);
    assert.equal(found.registry, 'recognized');
  }
  const data = fixture(); data.workspaces = []; const candidates = parse(data);
  assert.equal(candidates.accounts.length, 3); assert.equal(candidates.workspaces.length, 0);
});

test('discovery revalidates every workspace against the SSH identity and passwd scope', () => {
  const otherUser = fixture(); otherUser.effectiveUid = 1000;
  assert.throws(() => parse(otherUser), /scope/);
  const mismatched = fixture(); mismatched.workspaces[0]!.uid = 9999;
  assert.throws(() => parse(mismatched), /scope/);
  const duplicate = fixture(); duplicate.workspaces.push(duplicate.workspaces[0]!);
  assert.throws(() => parse(duplicate), /Ambiguous workspace/);
  const missingSource = fixture(); missingSource.workspaces[0]!.sources = [];
  assert.equal(parse(missingSource).workspaces.length, 2);
});

test('only allowlisted config/account metadata survives the transport parser', () => {
  const data = fixture(1); const value: Record<string, unknown> = data.workspaces[0]!.runtimes.codex;
  value.installed = 'yes'; value.path = '/home/owner-0/.local/bin/codex'; value.version = 'codex-cli 0.155.1';
  value.config = { status: 'known', source: '/home/owner-0/.codex/config.toml', values: { model: 'fixture-model', approval_policy: 'on-request', apiKey: 'fixture-secret', env: { API_KEY: 'fixture-secret' }, access_token: 'fixture-secret', 'features.deferred_executor': true, model_provider: 'Bearer fixture-secret' } };
  value.account = { status: 'authenticated', source: 'codex-device-broker:list', selectedId: 'fixture-account', access_token: 'fixture-secret', details: { email: 'fixture@example.invalid', plan: 'fixture-plan', refresh_token: 'fixture-secret' }, catalog: [{ id: 'fixture-account', email: 'fixture@example.invalid', plan: 'fixture-plan', selected: false, token: 'fixture-secret' }, { id: 'unselected', selected: true }, { id: 'fixture-account', email: 'duplicate@example.invalid' }] };
  value.nativeAccount = { status: 'unauthenticated', source: 'codex login status', secret: 'fixture-secret' };
  const found = parse(data); const runtime = found.workspaces[0]!.runtimes.codex;
  assert.deepEqual(runtime.config.values, { model: 'fixture-model', approval_policy: 'on-request', 'features.deferred_executor': true });
  assert.equal(runtime.account.status, 'configured');
  assert.equal(runtime.nativeAccount?.status, 'unauthenticated');
  assert.equal(runtime.account.catalog?.length, 2);
  assert.deepEqual(runtime.account.catalog?.map(row => row.selected), [true, false]);
  assert.equal(runtime.account.details?.email, 'fixture@example.invalid');
  assert.ok(!JSON.stringify(found).includes('fixture-secret'));
});

test('public-key evidence cannot imply private-key possession or an automatic grant', () => {
  const data = fixture(1); const ssh: Record<string, unknown> = data.workspaces[0]!.ssh;
  ssh.privateKeyStatus = 'available'; ssh.privateKey = 'fixture-private-content';
  ssh.authorizedKeys = [{ fingerprint, algorithm: 'ssh-ed25519', source: '/home/other/.ssh/authorized_keys' }];
  const found = parse(data); const discovered = found.workspaces[0]!;
  assert.equal(discovered.ssh.privateKeyStatus, 'not-inspected');
  assert.equal(discovered.ssh.authorizedKeys.length, 0);
  assert.equal(discovered.ssh.authorizationStatus, 'unknown');
  assert.ok(!JSON.stringify(found).includes('fixture-private-content'));
});

test('scope and authentication metadata affect state binding, observation time does not', () => {
  const data = fixture(1); const first = parse(data);
  assert.equal(first.stateHash, parse(data, '2026-09-26T00:00:00Z').stateHash);
  data.workspaces[0]!.runtimes.claude.account.status = 'unauthenticated';
  assert.notEqual(first.stateHash, parse(data).stateHash);
});

test('unknown CLI/auth results stay unknown and malformed payloads never echo secrets', async () => {
  const data = fixture(1); const result = parse(data);
  assert.equal(result.workspaces[0]!.runtimes.claude.account.status, 'unknown');
  assert.throws(() => parseWorkspaceDiscovery('{"token":"fixture-secret"', host, observedAt), error => error instanceof Error && !error.message.includes('fixture-secret'));
  await assert.rejects(discoverWorkspaces(host, { runner: async () => ({ stdout: '', stderr: 'fixture-secret', exitCode: 2, signal: null }) }), error => error instanceof Error && !error.message.includes('fixture-secret'));
  assert.throws(() => parseWorkspaceDiscovery('x'.repeat(512 * 1024 + 1), host, observedAt), /output limit/);
});

test('missing broker metadata and a native logged-out status remain separate evidence', () => {
  const data = fixture(1); const runtime: Record<string, unknown> = data.workspaces[0]!.runtimes.codex;
  runtime.account = { status: 'unknown', source: 'codex-device-broker:list' };
  runtime.nativeAccount = { status: 'unauthenticated', source: 'codex login status' };
  runtime.warnings = ['Legacy account catalog socket is missing; account binding is unknown.'];
  const codex = parse(data).workspaces[0]!.runtimes.codex;
  assert.equal(codex.account.status, 'unknown');
  assert.equal(codex.account.source, 'codex-device-broker:list');
  assert.equal(codex.nativeAccount?.status, 'unauthenticated');
  assert.match(codex.warnings[0]!, /socket is missing/);
  assert.ok(DISCOVERY_PYTHON.includes("except FileNotFoundError: result['warnings'].append('Legacy account catalog socket is missing"));
});

test('remote probe executes bounded named status commands with no shell profiles or credential export', () => {
  for (const expected of ["['--version']", "'login', 'status'", "'auth', 'status', '--json'"]) {
    if (expected === "['--version']") assert.ok(DISCOVERY_PYTHON.includes("[executable, '--version']"));
    else assert.ok(DISCOVERY_PYTHON.includes(expected));
  }
  assert.ok(DISCOVERY_PYTHON.includes('os.setuid(account.pw_uid)'));
  assert.ok(DISCOVERY_PYTHON.includes('os.environ.clear()'));
  assert.ok(DISCOVERY_PYTHON.includes('"method":"list"'));
  for (const forbidden of [/auth\.json/, /credentials\.json/, /read_text\(/, /os\.walk\(/, /shell=True/, /useradd/, /userdel/, /shutil\.copy/, /["']\.bash_profile["']/]) assert.ok(!forbidden.test(DISCOVERY_COMMAND), String(forbidden));
});

test('remote config extraction keeps unsupported TOML tables and multiline values opaque', t => {
  // Run just the pure config functions from the actual remote source; no SSH, local config or credential reads.
  const harness = String.raw`
import ast, json, os, re, sys
payload = json.load(sys.stdin)
tree = ast.parse(payload['source'])
names = ('text', 'toml_statements', 'safe_config')
constants = ('CODEX_FIELDS', 'CLAUDE_FIELDS')
nodes = [node for node in tree.body if (isinstance(node, ast.FunctionDef) and node.name in names) or (isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in constants for target in node.targets))]
scope = {'json': json, 'os': os, 're': re}
exec(compile(ast.Module(body=nodes, type_ignores=[]), '<discovery-config-fixture>', 'exec'), scope)
results = []
for fixture in payload['fixtures']:
    scope['read_metadata'] = lambda path, uid, home: fixture
    results.append(scope['safe_config']('/fixture', 'codex', 1000)['values'])
print(json.dumps(results))
`;
  const fixtures = [
    'model = "top-level"\n[profiles."work"]\nmodel = "profile-only"\n[features]\ndeferred_executor = true\n',
    'model = "root-model"\n[[profiles.work]]\nmodel = "array-profile"\napproval_policy = "never"\n',
    'developer_instructions = """\nmodel = "embedded-model"\n[features]\ndeferred_executor = false\n"""\nmodel = "actual-model"\n[features]\ndeferred_executor = true\n',
    'ignored = [\n\'\'\'\nmodel = "embedded-model"\n\'\'\'\n]\nmodel = "actual-model"\n# [features] model = "comment"\n',
  ];
  const result = spawnSync('python', ['-c', harness], { encoding: 'utf8', input: JSON.stringify({ source: DISCOVERY_PYTHON, fixtures }), timeout: 5000, windowsHide: true, shell: false });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { t.skip('Python is not installed on this test host; the remote source regression requires Python.'); return; }
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { model: 'top-level', 'features.deferred_executor': true },
    { model: 'root-model' },
    { model: 'actual-model', 'features.deferred_executor': true },
    { model: 'actual-model' },
  ]);
});
