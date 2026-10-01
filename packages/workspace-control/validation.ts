import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { localizeControlEffect } from './effect-labels';
import { validateAccountQuotas } from './quotas';
import type { ManagedWorkspace, StudioPlan, StudioSnapshot, StudioWireApply, WorkspaceConnection, WorkspaceEnrollment, WorkspaceInvite } from './types';

type Row = Record<string, unknown>;
export const row = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
export const safeText = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length <= max && !/[\x00-\x1f\x7f]|-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]/i.test(v);
export const identifier = (v: unknown): v is string => safeText(v, 128) && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
export const revision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => safeText(v, 64) && Number.isFinite(Date.parse(v));
export function invalid(): never { throw new Error('工作空间服务返回了无效数据，请刷新核实。'); }
const strings = (v: unknown, max: number, validate = (s: unknown) => safeText(s)): string[] => { if (!Array.isArray(v) || v.length > max || !v.every(validate)) invalid(); return [...v] as string[]; };
const text = (v: unknown, max = 256) => { if (!safeText(v, max)) invalid(); return v; };
const id = (v: unknown) => { if (!identifier(v)) invalid(); return v; };
const number = (v: unknown) => { if (!revision(v)) invalid(); return v; };
const timestamp = (v: unknown) => { if (!date(v)) invalid(); return v; };
const username = (v: unknown) => { if (!safeText(v, 64) || !/^[a-z_][a-z0-9_-]{0,31}$/.test(v) || v === 'root') invalid(); return v; };
const directory = (v: unknown) => { if (!safeText(v, 4096) || !v.startsWith('/') || v.split('/').includes('..')) invalid(); return v; };

export function publicKey(value: unknown, device = false): string {
  if (!safeText(value, 16384)) invalid();
  const parts = value.trim().split(/\s+/);
  const algorithm = parts[0]!, encoded = parts[1]!;
  if (parts.length !== 2 || !(device ? algorithm === 'ssh-ed25519' : ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'].includes(algorithm)) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded ?? '')) invalid();
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 12 || bytes.length > 8192 || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '') || bytes.readUInt32BE(0) !== algorithm.length || bytes.subarray(4, 4 + algorithm.length).toString('ascii') !== algorithm) invalid();
  if (algorithm === 'ssh-ed25519' && (bytes.length !== 51 || bytes.readUInt32BE(15) !== 32)) invalid();
  return `${algorithm} ${encoded}`;
}
export const publicKeyFingerprint = (key: string) => 'SHA256:' + createHash('sha256').update(Buffer.from(key.split(' ')[1]!, 'base64')).digest('base64').replace(/=+$/, '');
export function connection(value: unknown): WorkspaceConnection {
  if (!row(value) || !safeText(value.hostname, 253) || (!isIP(value.hostname) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value.hostname)) || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535 || !Array.isArray(value.hostPublicKeys) || !value.hostPublicKeys.length || value.hostPublicKeys.length > 16) invalid();
  return { hostname: value.hostname, port: value.port as number, hostPublicKeys: value.hostPublicKeys.map(v => publicKey(v)) };
}
export function enrollmentUrl(value: unknown): string {
  const url = new URL(text(value, 2048));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) invalid();
  return url.href;
}
export function workspace(value: unknown): ManagedWorkspace {
  if(row(value)&&value.deletion!==undefined&&(!row(value.deletion)||!['purged','ssh-retained'].includes(String(value.deletion.kind))||value.status!=='deleted'))invalid();
  if(row(value)&&value.controlState!==undefined&&!['ready','recovery-required'].includes(String(value.controlState)))invalid();
  if (!row(value) || !row(value.environment) || !row(value.environment.env) || !['active', 'suspended', 'deleted'].includes(String(value.status)) || !Array.isArray(value.devices) || value.devices.length > 256 || !Array.isArray(value.invites) || value.invites.length > 1024 || value.nativeQuota !== 'unknown') invalid();
  const runtimes = strings(value.environment.runtimes, 2, v => v === 'codex' || v === 'claude') as ('codex' | 'claude')[];
  const env: Record<string, string> = {};
  for (const [key, v] of Object.entries(value.environment.env)) { if (!['LANG', 'LC_ALL', 'TZ', 'TERM', 'COLORTERM'].includes(key)) invalid(); env[key] = text(v, 256); }
  const devices = value.devices.map(v => { if (!row(v) || !['active', 'revoked'].includes(String(v.status))) invalid(); const key = publicKey(v.publicKey, true); if (v.fingerprint !== publicKeyFingerprint(key)) invalid(); return { id: id(v.id), label: text(v.label), fingerprint: v.fingerprint, publicKey: key, createdAt: timestamp(v.createdAt), status: v.status as 'active' | 'revoked' }; });
  const invites = value.invites.map(v => { if (!row(v) || !['active', 'redeemed', 'revoked', 'expired'].includes(String(v.status))) invalid(); return { id: id(v.id), label: text(v.label), expiresAt: timestamp(v.expiresAt), status: v.status as ManagedWorkspace['invites'][number]['status'] }; });
  if (!revision(value.uid) || value.uid === 0 || value.uid > 4294967294 || new Set(devices.map(v => v.id)).size !== devices.length || new Set(invites.map(v => v.id)).size !== invites.length) invalid();
  return { id: id(value.id), generation: id(value.generation), revision: number(value.revision), name: text(value.name), uid: value.uid, username: username(value.username), root: directory(value.root), environment: { runtimes, defaultDirectory: directory(value.environment.defaultDirectory), env }, allowedAccountIds: strings(value.allowedAccountIds, 128, identifier), accountQuotas: validateAccountQuotas(value.accountQuotas ?? {}, strings(value.allowedAccountIds, 128, identifier)), nativeQuota: 'unknown', status: value.status as ManagedWorkspace['status'], devices, invites, createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt),...(value.controlState?{controlState:value.controlState as ManagedWorkspace['controlState']}:{}),...(row(value.deletion)?{deletion:{kind:value.deletion.kind as 'purged'|'ssh-retained',home:directory(value.deletion.home),storageBytes:number(value.deletion.storageBytes)}}:{}) };
}
export function snapshot(value: unknown): StudioSnapshot {
  if (!row(value) || !Array.isArray(value.workspaces) || value.workspaces.length > 512) invalid();
  const workspaces = value.workspaces.map(workspace);
  if (new Set(workspaces.map(w => w.id)).size !== workspaces.length || workspaces.some(w => w.uid === 0)) invalid();
  if(value.sshOnlyMembers!==undefined&&(!Array.isArray(value.sshOnlyMembers)||value.sshOnlyMembers.length>256))invalid();
  const sshOnlyMembers=(value.sshOnlyMembers??[] as unknown[]) as unknown[];
  const reserved=sshOnlyMembers.map(item=>{if(!row(item))invalid();const name=username(item.username),uid=number(item.uid),home=directory(item.home);if(uid<1000||home!=='/home/'+name)invalid();return {username:name,uid,home};});
  if(new Set(reserved.map(item=>item.username)).size!==reserved.length)invalid();
  return { authorityId: id(value.authorityId), generation: id(value.generation), revision: number(value.revision), workspaces, connection: connection(value.connection), enrollmentUrl: value.enrollmentUrl === '' ? '' : enrollmentUrl(value.enrollmentUrl), availability: 'ready', ...(value.transport==='ssh'?{transport:'ssh' as const}:{}),sshOnlyMembers:reserved };
}
export const operations = ['workspace/adopt', 'workspace/create', 'workspace/update', 'workspace/suspend', 'workspace/delete', 'device/revoke', 'invite/create', 'invite/revoke'] as const;
export function plan(value: unknown): StudioPlan {
  if (!row(value) || !operations.includes(value.operation as typeof operations[number]) || !safeText(value.planHash, 64) || !/^[a-f0-9]{64}$/.test(value.planHash)) invalid();
  let deletion:StudioPlan['deletion'];
  if(value.operation==='workspace/delete'){
    const d=value.deletion;
    if(!row(d)||d.mode!=='destroy')throw Error('远端仍使用旧版记录删除，请更新工作空间控制服务后重新预览。');
    deletion={mode:'destroy',username:username(d.username),uid:number(d.uid),home:directory(d.home),root:directory(d.root),storageBytes:number(d.storageBytes)};
    if(deletion.uid<1000||deletion.home!=='/home/'+deletion.username||![deletion.home,deletion.home+'/workspaces'].includes(deletion.root))invalid();
  }else if(value.deletion!==undefined)invalid();
  return { planId: id(value.planId), planHash: value.planHash, operation: value.operation as StudioPlan['operation'], ...(value.workspaceId === undefined ? {} : { workspaceId: id(value.workspaceId) }), expectedRevision: number(value.expectedRevision), expiresAt: timestamp(value.expiresAt), effects: strings(value.effects, 512, s => safeText(s, 2048)).map(localizeControlEffect),...(deletion?{deletion}:{}) };
}
export function invite(value: unknown): WorkspaceInvite {
  if (!row(value) || value.schema !== 'agent-workbench-invite' || value.version !== 1 || typeof value.token !== 'string' || !/^[A-Za-z0-9._~:-]{32,512}$/.test(value.token)) invalid();
  return { schema: value.schema, version: 1, inviteId: id(value.inviteId), token: value.token, expiresAt: timestamp(value.expiresAt), authorityId: id(value.authorityId), generation: id(value.generation), workspaceId: id(value.workspaceId), workspaceGeneration: id(value.workspaceGeneration), workspaceName: text(value.workspaceName), username: username(value.username), root: directory(value.root), connection: connection(value.connection), enrollmentUrl: enrollmentUrl(value.enrollmentUrl) };
}
export function enrollment(value: unknown): WorkspaceEnrollment {
  if (!row(value) || value.schema !== 'agent-workbench-device' || value.version !== 1) invalid();
  return { schema: value.schema, version: 1, authorityId: id(value.authorityId), generation: id(value.generation), workspaceId: id(value.workspaceId), workspaceGeneration: id(value.workspaceGeneration), workspaceName: text(value.workspaceName), username: username(value.username), root: directory(value.root), deviceId: id(value.deviceId), fingerprint: text(value.fingerprint), connection: connection(value.connection) };
}
export function applyResult(value: unknown): StudioWireApply {
  if (!row(value) || !['applied', 'failed', 'uncertain'].includes(String(value.state))) invalid();
  return { operationId: id(value.operationId), state: value.state as StudioWireApply['state'], revision: number(value.revision), effects: strings(value.effects, 512, s => safeText(s, 2048)).map(localizeControlEffect), ...(value.workspace === undefined ? {} : { workspace: workspace(value.workspace) }), ...(value.invite === undefined ? {} : { invite: invite(value.invite) }) };
}
