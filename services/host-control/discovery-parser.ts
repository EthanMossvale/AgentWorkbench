import { createHash } from 'node:crypto';
import type { SshHost } from '../../packages/contracts/index';
import { CLAUDE_CONFIG_FIELDS, CODEX_CONFIG_FIELDS, type DiscoveredAccount, type DiscoveredPublicKey, type DiscoveredWorkspace, type RuntimeAccountCatalogEntry, type RuntimeAccountDetails, type RuntimeDiscovery, type WorkspaceDiscovery } from './discovery-types';

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_295;
const username = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(value);
const safeText = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) && !/-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]|sk-[A-Za-z0-9_-]{12,}/i.test(value);
const absolute = (value: unknown): value is string => safeText(value, 4096) && value.startsWith('/') && !value.split('/').includes('..');
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^(SHA256:[A-Za-z0-9+/=]{20,100}|MD5:[a-f0-9:]{47})$/.test(value);
const warnings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => safeText(item, 512)).slice(0, 32) : [];
const unknownRuntime = (): RuntimeDiscovery => ({ installed: 'unknown', config: { status: 'unknown', values: {} }, account: { status: 'unknown' }, warnings: [] });

function parseRuntime(value: unknown, runtime: 'codex' | 'claude'): RuntimeDiscovery {
  const result = unknownRuntime();
  if (!record(value)) return result;
  if (value.installed === 'yes' || value.installed === 'no') result.installed = value.installed;
  if (absolute(value.path)) result.path = value.path;
  if (safeText(value.version, 128)) result.version = value.version;
  result.warnings = warnings(value.warnings);
  if (record(value.config)) {
    if (value.config.status === 'known' || value.config.status === 'absent') result.config.status = value.config.status;
    if (absolute(value.config.source)) result.config.source = value.config.source;
    const fields: readonly string[] = runtime === 'codex' ? CODEX_CONFIG_FIELDS : CLAUDE_CONFIG_FIELDS;
    if (record(value.config.values)) for (const [key, entry] of Object.entries(value.config.values)) {
      if (!fields.includes(key)) continue;
      if (typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 1_000_000) || safeText(entry)) result.config.values[key] = entry;
    }
  }
  if (record(value.account)) {
    const input = value.account;
    if (input.status === 'authenticated' || input.status === 'unauthenticated' || input.status === 'configured') result.account.status = input.status;
    if (safeText(input.source)) result.account.source = input.source;
    if (safeText(input.selectedId) && input.selectedId) result.account.selectedId = input.selectedId;
    if (record(input.details)) {
      const details: RuntimeAccountDetails = {};
      for (const key of ['email', 'name', 'plan', 'authMethod', 'organization'] as const) if (safeText(input.details[key])) details[key] = input.details[key];
      result.account.details = details;
    }
    if (Array.isArray(input.catalog)) {
      const ids = new Set<string>(); const catalog: RuntimeAccountCatalogEntry[] = [];
      for (const row of input.catalog.slice(0, 128)) {
        if (!record(row) || !safeText(row.id) || !row.id || ids.has(row.id)) continue;
        ids.add(row.id); const item: RuntimeAccountCatalogEntry = { id: row.id, selected: row.id === result.account.selectedId };
        for (const key of ['email', 'name', 'plan'] as const) if (safeText(row[key])) item[key] = row[key];
        catalog.push(item);
      }
      result.account.catalog = catalog;
    }
    // A legacy catalog is a binding snapshot. It does not test/refresh authentication.
    if (result.account.source === 'codex-device-broker:list') result.account.status = result.account.catalog?.some(item => item.selected) ? 'configured' : 'unknown';
  }
  if (record(value.nativeAccount)) {
    // Parse through the same allowlist without accepting recursive/native nesting.
    result.nativeAccount = parseRuntime({ account: value.nativeAccount }, runtime).account;
  }
  return result;
}

function parseWorkspace(value: unknown, accounts: DiscoveredAccount[], observedAt: string): DiscoveredWorkspace | undefined {
  if (!record(value) || !safeText(value.id) || !value.id || !username(value.username) || !integer(value.uid) || !absolute(value.home) || !absolute(value.root)) return;
  const account = accounts.find(item => item.username === value.username && item.uid === value.uid && item.home === value.home);
  if (!account) throw new Error('Workspace discovery exceeded its verified account scope.');
  if (value.classification !== 'known-device-workspace' && value.classification !== 'registered-workspace') return;
  const sources = Array.isArray(value.sources) ? value.sources.filter((source): source is string => absolute(source)).slice(0, 8) : [];
  if (!sources.length) return;
  const keys: DiscoveredPublicKey[] = []; const seen = new Set<string>();
  let authorizationStatus: DiscoveredWorkspace['ssh']['authorizationStatus'] = 'unknown';
  if (record(value.ssh)) {
    if (value.ssh.authorizationStatus === 'absent') authorizationStatus = 'absent';
    if (Array.isArray(value.ssh.authorizedKeys)) for (const row of value.ssh.authorizedKeys.slice(0, 256)) {
      if (!record(row) || !fingerprint(row.fingerprint) || !safeText(row.algorithm, 128) || !absolute(row.source) || row.source !== `${account.home.replace(/\/$/, '')}/.ssh/authorized_keys` || seen.has(row.fingerprint)) continue;
      seen.add(row.fingerprint); const item: DiscoveredPublicKey = { fingerprint: row.fingerprint, algorithm: row.algorithm, source: row.source };
      if (safeText(row.comment)) item.comment = row.comment;
      keys.push(item);
    }
  }
  if (keys.length) authorizationStatus = 'present';
  const runtimes = record(value.runtimes) ? value.runtimes : {};
  return { id: value.id, name: safeText(value.name) && value.name ? value.name : value.id, username: account.username, uid: account.uid, home: account.home, root: value.root, classification: value.classification, sources, confidence: value.confidence === 'high' ? 'high' : 'conflict', observedAt, ssh: { authorizedKeys: keys, authorizationStatus, privateKeyStatus: 'not-inspected' }, runtimes: { codex: parseRuntime(runtimes.codex, 'codex'), claude: parseRuntime(runtimes.claude, 'claude') }, warnings: warnings(value.warnings) };
}

/** Parse only public discovery metadata. Unexpected fields (including tokens) are deliberately discarded. */
export function parseWorkspaceDiscovery(stdout: string, host: SshHost, observedAt: string): WorkspaceDiscovery {
  if (Buffer.byteLength(stdout, 'utf8') > 512 * 1024) throw new Error('Workspace discovery exceeded its output limit.');
  const accounts: DiscoveredAccount[] = []; const publicKeyFingerprints: string[] = []; let workspaces: DiscoveredWorkspace[] = [];
  let effectiveUid: number | undefined; let registry: WorkspaceDiscovery['registry'] = 'absent-or-inaccessible'; let remoteWarnings: string[] = [];
  if (stdout.trimStart().startsWith('{')) {
    let data: unknown; try { data = JSON.parse(stdout); } catch { throw new Error('Invalid workspace discovery metadata.'); }
    if (!record(data) || data.protocol !== 2 || !integer(data.effectiveUid)) throw new Error('Discovery did not prove a remote effective UID.');
    effectiveUid = data.effectiveUid;
    if (data.registry === 'recognized' || data.registry === 'present-unread') registry = data.registry;
    if (Array.isArray(data.accounts)) for (const row of data.accounts.slice(0, 256)) {
      if (!record(row) || !username(row.username) || !integer(row.uid) || !absolute(row.home) || !absolute(row.shell)) continue;
      if (accounts.some(account => account.username === row.username)) throw new Error('Ambiguous remote account evidence.');
      accounts.push({ username: row.username, uid: row.uid, home: row.home, shell: row.shell, classification: 'ordinary-account-unmapped', source: 'ssh-passwd', observedAt });
    }
    if (Array.isArray(data.publicKeyFingerprints)) publicKeyFingerprints.push(...data.publicKeyFingerprints.filter(fingerprint).slice(0, 256));
    if (Array.isArray(data.workspaces)) workspaces = data.workspaces.slice(0, 32).map(row => parseWorkspace(row, accounts, observedAt)).filter((row): row is DiscoveredWorkspace => Boolean(row));
    if (new Set(workspaces.map(row => row.id)).size !== workspaces.length || new Set(workspaces.map(row => row.username)).size !== workspaces.length) throw new Error('Ambiguous workspace mapping evidence.');
    remoteWarnings = warnings(data.warnings);
  } else {
    for (const line of stdout.split(/\r?\n/)) {
      if (line.length > 4096 || /[\x00-\x08\x0b-\x1f\x7f]/.test(line)) continue;
      const [type, a, b, c, d] = line.split('\t');
      if (type === 'identity' && a && /^\d{1,10}$/.test(a) && integer(Number(a))) { if (effectiveUid !== undefined) throw new Error('Ambiguous remote identity evidence.'); effectiveUid = Number(a); }
      if (type === 'account' && username(a) && b && /^\d{1,10}$/.test(b) && integer(Number(b)) && absolute(c) && absolute(d) && accounts.length < 256) accounts.push({ username: a, uid: Number(b), home: c, shell: d, classification: 'ordinary-account-unmapped', source: 'ssh-passwd', observedAt });
      if (type === 'registry' && a === 'present-unread') registry = a;
      if (type === 'fingerprint' && fingerprint(a) && publicKeyFingerprints.length < 256) publicKeyFingerprints.push(a);
    }
    remoteWarnings.push('Detailed workspace metadata was unavailable; account candidates were retained without inferring workspace ownership.');
  }
  if (effectiveUid === undefined) throw new Error('Discovery did not prove a remote effective UID.');
  if (effectiveUid !== 0 && accounts.some(account => account.uid !== effectiveUid)) throw new Error('Unprivileged discovery exceeded its identity scope.');
  const stableWorkspaces = workspaces.map(({ observedAt: _, ...workspace }) => workspace);
  const stateHash = createHash('sha256').update(JSON.stringify({ hostId: host.id, ownerId: host.ownerId, generation: host.workspaceGeneration, effectiveUid, accounts: accounts.map(({ observedAt: _, ...account }) => account), registry, publicKeyFingerprints, workspaces: stableWorkspaces })).digest('hex');
  return { hostId: host.id, ownerId: host.ownerId, generation: host.workspaceGeneration, observedAt, effectiveUid, privilege: effectiveUid === 0 ? 'root' : 'user', accounts, registry, publicKeyFingerprints, workspaces, stateHash, warnings: ['Account existence is not workspace ownership, native login or a device grant.', 'Discovery does not read or export private keys, native authentication contents or user sessions; native CLI tools own status inspection.', 'An absent/inaccessible registry is not proof that no workspaces exist.', 'Authorized public keys do not prove a matching local private key or permission to distribute it.', ...remoteWarnings] };
}
