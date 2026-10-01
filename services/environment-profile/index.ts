import { createHash } from 'node:crypto';
import type { EnvironmentField, EnvironmentProfile, SshHost } from '../../packages/contracts/index';
import { runSsh, validateSshHost, type SshRunner } from '../../packages/ssh-transport/index';

export const PROFILE_FIELDS = ['os', 'distribution', 'architecture', 'shell', 'pathSemantics', 'locale', 'timezone', 'claudeVersion', 'codexVersion'] as const;
export const ENVIRONMENT_PROBE_COMMAND = `
printf 'os\\t%s\\n' "$(uname -s 2>/dev/null | head -c 256)"
printf 'distribution\\t%s\\n' "$(awk -F= '/^PRETTY_NAME=/{gsub(/^"|"$/, "", $2); print $2; exit}' /etc/os-release 2>/dev/null | head -c 256)"
printf 'architecture\\t%s\\n' "$(uname -m 2>/dev/null | head -c 256)"
printf 'shell\\t%s\\n' "$(printf '%s' "$SHELL" | head -c 256)"
printf 'pathSemantics\\tposix\\n'
printf 'locale\\t%s\\n' "$(locale charmap 2>/dev/null | head -c 256)"
printf 'timezone\\t%s\\n' "$(date +%Z 2>/dev/null | head -c 256)"
printf 'claudeVersion\\t%s\\n' "$(claude --version 2>/dev/null | head -c 256)"
printf 'codexVersion\\t%s\\n' "$(codex --version 2>/dev/null | head -c 256)"`;

export interface ProbeOptions { runner?: SshRunner; now?: Date; ttlMs?: number; signal?: AbortSignal }
export function unknownProfile(host: SshHost, now = new Date()): EnvironmentProfile {
  validateSshHost(host);
  const observedAt = now.toISOString();
  return { id: createHash('sha256').update(`${host.id}:${host.ownerId}:${host.workspaceGeneration}:${observedAt}`).digest('hex'), version: 1, hostId: host.id, ownerId: host.ownerId, observedAt, validUntil: observedAt, guarantee: 'projected', fields: Object.fromEntries(PROFILE_FIELDS.map(key => [key, { value: null, status: 'unknown', source: 'ssh-allowlist' } satisfies EnvironmentField])) };
}
export async function probeEnvironment(host: SshHost, options: ProbeOptions = {}): Promise<EnvironmentProfile> {
  const now = options.now ?? new Date();
  const ttl = options.ttlMs ?? 60 * 60 * 1000;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 24 * 60 * 60 * 1000) throw new RangeError('Profile lifetime must be between 1ms and 24 hours.');
  const profile = unknownProfile(host, now);
  const result = await (options.runner ?? runSsh)(host, ENVIRONMENT_PROBE_COMMAND, { timeoutMs: 25_000, maxOutputBytes: 16_384, signal: options.signal });
  if (result.exitCode !== 0) throw new Error(`Remote environment probe failed (SSH exit ${result.exitCode}). ${result.stderr}`);
  const seen = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const [key, ...parts] = line.split('\t');
    if (!key || !PROFILE_FIELDS.includes(key as typeof PROFILE_FIELDS[number])) continue;
    if (seen.has(key)) { profile.fields[key] = { value: null, status: 'unknown', source: 'ssh-allowlist' }; continue; }
    seen.add(key);
    const value = parts.join('\t');
    if (value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) continue;
    profile.fields[key] = { value: value || null, status: value ? 'known' : 'unknown', source: 'ssh-allowlist' };
  }
  profile.validUntil = new Date(now.getTime() + ttl).toISOString();
  return profile;
}

export interface ProjectedEnvironment extends EnvironmentProfile { source: 'remote-profile'; freshness: 'current' | 'stale'; limitations: string[] }
/** Pure projection: never queries or falls back to host inventory. */
export function projectEnvironment(profile: EnvironmentProfile, binding: { hostId: string; ownerId: string; profileId?: string; now?: Date }): ProjectedEnvironment {
  if (profile.hostId !== binding.hostId || profile.ownerId !== binding.ownerId || (binding.profileId && profile.id !== binding.profileId)) throw new Error('Environment profile binding mismatch.');
  const now = (binding.now ?? new Date()).getTime();
  const expiry = Date.parse(profile.validUntil);
  const stale = !Number.isFinite(expiry) || now >= expiry;
  return { ...profile, fields: Object.fromEntries(PROFILE_FIELDS.map(name => {const field=profile.fields[name]??{value:null,status:'unknown' as const,source:'ssh-allowlist' as const};return [name, { ...field, status: stale && field.status === 'known' ? 'stale' : field.status }];})), source: 'remote-profile', freshness: stale ? 'stale' : 'current', limitations: ['Projection is not a local system measurement or an isolation boundary.', 'Local tools retain their real execution environment. No host inventory is collected to fill missing remote fields.'] };
}
