import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { SshHost } from '../contracts';
import { buildSshEnvironment, runSsh, type SshRunner } from '../ssh-transport';
import {restrictPrivatePath} from '../ssh-transport/private-files';
import type { WorkspaceEnrollment, WorkspaceImportPreview, WorkspaceInvite } from './types';
import { enrollment, identifier, invite, publicKey, publicKeyFingerprint, safeText } from './validation';

const execute = promisify(execFile);
const keygen = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe') : '/usr/bin/ssh-keygen';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface EnrollmentOptions {
  directory: string;
  fetcher?: typeof fetch;
  runner?: SshRunner;
  createKey?: (file: string) => Promise<void>;
  secureDirectory?: (directory: string) => Promise<void>;
}
async function readSmall(file: string, limit = 65536) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('文件类型或大小无效。');
  return readFile(file, 'utf8');
}
async function writeAtomic(file: string, value: string) { const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, value, { mode: 0o600, flag: 'wx' }); await rename(temp, file); }
async function writeJson(file: string, value: unknown) { await writeAtomic(file, JSON.stringify(value)); }
async function exists(file: string) { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
export async function privateDirectory(directory: string) {
  for (let current = directory; ; current = path.dirname(current)) {
    try { const info = await lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('设备密钥目录或其父目录不可用。'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('设备密钥目录不能是符号链接。');
  restrictPrivatePath(directory,'directory');
}
export class WorkspaceEnrollmentService {
  private previews = new Map<string, WorkspaceInvite>();
  private busy = new Set<string>();
  private stopped = false;
  private pending = new Set<Promise<unknown>>();
  constructor(private options: EnrollmentOptions) { if (!path.isAbsolute(options.directory)) throw new Error('设备配置必须使用明确的本机目录。'); }
  private assertOpen() { if (this.stopped) throw new Error('工作台正在退出，无法导入工作空间。'); }
  private async recoverable(descriptor: WorkspaceInvite): Promise<boolean> {
    const directory = path.join(this.options.directory, 'workspace-devices', digest([descriptor.authorityId, descriptor.generation, descriptor.inviteId]));
    try {
      const journal = JSON.parse(await readSmall(path.join(directory, 'enrollment.json')));
      if(journal.completedAt)throw new Error('WORKSPACE_FILE_CONSUMED');
      if (!journal || journal.binding !== digest(descriptor) || !identifier(journal.hostId)) return false;
      const info = await lstat(path.join(directory, 'device-key')); if (!info.isFile() || info.isSymbolicLink()) return false;
      const key = publicKey((await readSmall(path.join(directory, 'device-key.pub'), 16384)).trim(), true);
      return (journal.keyFingerprint ?? journal.receipt?.fingerprint) === publicKeyFingerprint(key);
    } catch(error) { if(error instanceof Error&&error.message==='WORKSPACE_FILE_CONSUMED')throw new Error('文件已失效，请向管理员重新获取。'); return false; }
  }
  async dispose() { this.stopped = true; await Promise.allSettled([...this.pending]); this.previews.clear(); }
  async preview(file: string): Promise<WorkspaceImportPreview> {
    this.assertOpen();
    if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.awworkspace') throw new Error('请选择管理员导出的 .awworkspace 邀请文件。');
    let value: unknown; try { value = JSON.parse(await readSmall(file)); } catch { throw new Error('工作空间邀请文件无法读取。'); }
    const descriptor = invite(value); this.assertOpen();
    const resumeExistingDevice = await this.recoverable(descriptor);
    this.assertOpen();
    if (this.previews.size >= 16) this.previews.clear();
    const previewId = randomUUID();
    const preview = { previewId, workspaceName: descriptor.workspaceName, username: descriptor.username, hostname: descriptor.connection.hostname, port: descriptor.connection.port, expiresAt: descriptor.expiresAt, authorityId: descriptor.authorityId, workspaceId: descriptor.workspaceId, enrollmentUrl: descriptor.enrollmentUrl };
    if (JSON.stringify(preview).includes(descriptor.token)) throw new Error('邀请的公开信息包含不应显示的授权内容，请管理员重新导出。');
    this.previews.set(previewId, descriptor); return { ...preview, resumeExistingDevice };
  }
  import(previewId: string, deviceLabel: string): Promise<SshHost> {
    this.assertOpen();
    const descriptor = this.previews.get(previewId);
    if (!descriptor) return Promise.reject(new Error('邀请预览不存在或已过期，请重新导入。'));
    if (!safeText(deviceLabel, 100) || !deviceLabel.trim()) return Promise.reject(new Error('请输入设备名称。'));
    const identity = digest([descriptor.authorityId, descriptor.generation, descriptor.inviteId]);
    if (this.busy.has(identity)) return Promise.reject(new Error('此工作空间正在配置当前设备，请等待结果。'));
    this.busy.add(identity);
    const operation = this.enroll(descriptor, identity, deviceLabel.trim());
    this.pending.add(operation);
    void operation.finally(() => { this.pending.delete(operation); this.busy.delete(identity); }).catch(() => {});
    return operation;
  }
  private async enroll(descriptor: WorkspaceInvite, identity: string, deviceLabel: string): Promise<SshHost> {
    const recoverable=await this.recoverable(descriptor);
    this.assertOpen();
    const directory = path.join(this.options.directory, 'workspace-devices', identity);
    await (this.options.secureDirectory ?? privateDirectory)(directory); this.assertOpen();
    const identityFile = path.join(directory, 'device-key');
    const knownHostsFile = path.join(directory, 'known_hosts');
    const journalFile = path.join(directory, 'enrollment.json');
    const binding = digest(descriptor);
    let journal: { binding: string; hostId: string; keyFingerprint?: string; receipt?: WorkspaceEnrollment; completedAt?: string };
    try {
      const saved: unknown = JSON.parse(await readSmall(journalFile));
      if (!saved || typeof saved !== 'object' || !('binding' in saved) || saved.binding !== binding || !('hostId' in saved) || !identifier(saved.hostId)) throw new Error('Stored enrollment mismatch');
      journal = saved as typeof journal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('已有设备导入记录与此邀请不一致，请检查原邀请。');
      if (await exists(identityFile) || await exists(identityFile + '.pub')) throw new Error('此目录已有未绑定到邀请的密钥，不能复用或覆盖。');
      journal = { binding, hostId: randomUUID() }; await writeJson(journalFile, journal);
    }
    this.assertOpen();
    try { const info = await lstat(identityFile); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid device key file'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('本机设备密钥文件不可用。');
      if (journal.receipt || journal.keyFingerprint || await exists(identityFile + '.pub')) throw new Error('已登记设备的原密钥缺失，不能重新生成后重复登记。');
      this.assertOpen();
      if (this.options.createKey) await this.options.createKey(identityFile);
      else await execute(keygen, ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', identityFile], { windowsHide: true, env: buildSshEnvironment(), timeout: 15_000 });
    }
    const keyInfo = await lstat(identityFile); if (!keyInfo.isFile() || keyInfo.isSymbolicLink()) throw new Error('本机设备密钥文件不可用。');
    restrictPrivatePath(identityFile,'file');
    const key = publicKey((await readSmall(identityFile + '.pub', 16384)).trim(), true);
    const keyFingerprint = publicKeyFingerprint(key);
    if (journal.keyFingerprint && journal.keyFingerprint !== keyFingerprint) throw new Error('本机设备公钥与原导入记录不一致，不能重新登记。');
    journal.keyFingerprint = keyFingerprint; await writeJson(journalFile, journal);
    let receipt: WorkspaceEnrollment;
    if (journal.receipt) receipt = enrollment(journal.receipt);
    else {
      this.assertOpen();
      try {
        const response = await (this.options.fetcher ?? fetch)(descriptor.enrollmentUrl, { method: 'POST', redirect: 'error', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: descriptor.token, publicKey: key, deviceLabel }), signal: AbortSignal.timeout(30000) });
        if (!response.ok || response.redirected || (response.url && response.url !== descriptor.enrollmentUrl) || Number(response.headers.get('content-length') ?? 0) > 65536) throw new Error('Enrollment failed');
        const reader = response.body?.getReader(); if (!reader) throw new Error('Empty enrollment response');
        const buffers: Uint8Array[] = []; let size = 0;
        try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) throw new Error('Enrollment response too large'); buffers.push(part.value); } }
        finally { await reader.cancel().catch(() => {}); }
        receipt = enrollment(JSON.parse(Buffer.concat(buffers).toString('utf8')));
      } catch { throw new Error('设备授权回执未确认。本机新密钥已保留；可重导同一邀请核实，或由管理员查看并撤销该设备。'); }
    }
    if (receipt.authorityId !== descriptor.authorityId || receipt.generation !== descriptor.generation || receipt.workspaceId !== descriptor.workspaceId || receipt.workspaceGeneration !== descriptor.workspaceGeneration || receipt.username !== descriptor.username || receipt.root !== descriptor.root || receipt.fingerprint !== keyFingerprint || digest(receipt.connection) !== digest(descriptor.connection)) throw new Error('设备授权回执与邀请或本机公钥不一致，未保存可用连接。');
    if (JSON.stringify(receipt).includes(descriptor.token)) throw new Error('设备回执包含不应公开的授权内容，未保存可用连接。');
    journal.receipt = receipt; await writeJson(journalFile, journal);
    const knownName = receipt.connection.port === 22 ? receipt.connection.hostname : `[${receipt.connection.hostname}]:${receipt.connection.port}`;
    await writeAtomic(knownHostsFile, receipt.connection.hostPublicKeys.map(k => `${knownName} ${k}`).join('\n') + '\n');
    const host: SshHost = { id: journal.hostId, name: receipt.workspaceName, hostname: receipt.connection.hostname, port: receipt.connection.port, username: receipt.username, role: 'workspace', identityFile, knownHostsFile, ownerId: 'local-owner', workspaceGeneration: receipt.workspaceGeneration, authorityId: receipt.authorityId, authorityGeneration: receipt.generation, remoteWorkspaceId: receipt.workspaceId, deviceId: receipt.deviceId };
    if (JSON.stringify(host).includes(descriptor.token)) throw new Error('设备回执包含不应公开的授权内容，未保存可用连接。');
    this.assertOpen();
    try {
      const observed = await (this.options.runner ?? runSsh)(host, 'id -un && id -u', { timeoutMs: 15000, maxOutputBytes: 1024 });
      const lines = observed.stdout.trim().split(/\r?\n/), [remoteUser, uid] = lines;
      if (observed.exitCode !== 0 || Buffer.byteLength(observed.stdout, 'utf8') > 1024 || lines.length !== 2 || remoteUser !== host.username || !/^[1-9]\d*$/.test(uid ?? '') || !Number.isSafeInteger(Number(uid)) || Number(uid) > 4294967294) throw new Error('Unconfirmed SSH identity');
    } catch { throw new Error('设备已登记，但尚未通过严格主机校验的成员 SSH 核实；可重导同一文件恢复连接配置。'); }
    this.assertOpen(); journal.completedAt=new Date().toISOString(); await writeJson(journalFile,journal); return host;
  }
}
