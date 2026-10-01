/**
 * Remove workbench control-plane identity from model-facing metadata.
 *
 * User-authored file and command output is intentionally not passed through
 * this helper. It is applied only to JSON envelopes created by workbench
 * resource adapters, so a file containing a field named `hostname` is not
 * rewritten as part of a normal Read result.
 */
const controlPlaneFields = new Set([
  'authorityId', 'authorityGeneration', 'deviceId', 'deviceName', 'fingerprint',
  'hostId', 'ownerId', 'remoteWorkspaceId', 'accountRef',
  'host', 'hostname', 'hostPublicKey', 'hostPublicKeys', 'identityFile',
  'knownHostsFile', 'sshPath', 'socketPath', 'workspaceId', 'workspaceGeneration', 'username',
  'userName', 'enrollmentUrl', 'connection', 'members', 'devices', 'ssh',
  'ip', 'ipAddress', 'sshIp', 'sshHost', 'sshPort', 'hostAddress',
  'publicIp', 'privateIp', 'localIp', 'deviceLabel', 'deviceFingerprint',
  'memberId', 'memberList', 'deviceList', 'tenantId', 'accountId', 'accountGeneration',
].map(key => key.replace(/[_-]/g, '').toLowerCase()));

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitize(value: unknown, depth: number, parents: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  // Never return an unexamined subtree at the traversal limit.
  if (depth > 32 || parents.has(value)) throw Error('LOCAL_CONTEXT_METADATA_INVALID');
  parents.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1, parents));
    if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('LOCAL_CONTEXT_METADATA_INVALID');
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (controlPlaneFields.has(key.replace(/[_-]/g, '').toLowerCase())) continue;
      if (typeof item === 'function') throw Error('LOCAL_CONTEXT_METADATA_INVALID');
      Object.defineProperty(result, key, {value:sanitize(item, depth + 1, parents),enumerable:true,configurable:true,writable:true});
    }
    return result;
  } finally { parents.delete(value); }
}

/** Sanitize a workbench-owned JSON envelope before it reaches the model. */
export function sanitizeWorkbenchMcpPayload<T>(value: T): T {
  return sanitize(value, 0, new Set()) as T;
}
