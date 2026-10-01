import { createHash } from 'node:crypto';
import type { SshHost } from '../contracts';
import { runSsh, validateSshHost, type SshRunner } from '../ssh-transport';
import * as validate from './validation';
import type { StudioPlan, StudioPlanInput, StudioSnapshot, StudioWireApply } from './types';
import {runWorkspaceSsh} from './ssh-control';
export type * from './types';

export const WORKSPACE_CONTROL_SOCKET = '/run/agent-workbench-control/control.sock';
const client = String.raw`import json,socket,sys
try:
    raw=sys.stdin.buffer.readline(65537)
    if len(raw)>65536: raise ValueError()
    request=json.loads(raw)
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(900 if request.get('method') == 'workspace/apply' else 40)
        connection.connect('/run/agent-workbench-control/control.sock')
        connection.sendall((json.dumps(request,separators=(',',':'))+'\n').encode())
        response=connection.makefile('rb').readline(2097153)
        if len(response)>2097152: raise ValueError()
        print(json.dumps(json.loads(response),separators=(',',':')))
except (OSError,ValueError):
    print('{"ok":false,"error":"CONTROL_UNAVAILABLE"}')
`;
export const WORKSPACE_CONTROL_COMMAND = `exec python3 -c "import base64;exec(base64.b64decode('${Buffer.from(client).toString('base64')}'))"`;
export const workspaceHostIdentity = (host: SshHost) => createHash('sha256').update(JSON.stringify([host.id, host.hostname.toLowerCase(), host.port, host.username, host.role, host.ownerId, host.workspaceGeneration, host.identityFile, host.knownHostsFile])).digest('hex');
const errors: Record<string, string> = {
  SSH_IDENTITY_RESERVED: '此用户已专门保留给 SSH / sing-box 使用，不能作为工作空间创建、纳管或删除。请填写新的用户名。',
  UNSAFE_DELETION_TARGET: '删除目标不是已核实的独立用户目录，未执行。请核对目录与所有者。',
  WORKSPACE_MOUNT_PRESENT: '用户目录包含挂载点，须先处理挂载，未执行删除。',
  DELETION_PLAN_REQUIRED: '旧预览不包含彻底删除范围，请重新预览。',
  CONTROL_UNAVAILABLE: 'VPS 工作空间管理服务尚未部署或不可用；已有 SSH 连接和只读识别仍可使用。',
  UNAUTHORIZED: '远端未确认此 SSH 身份具有管理员权限。',
  INVALID_QUOTA_ALLOCATION: '配给比例须为 0–100%，最多两位小数；留空表示未配给。',
  QUOTA_ACCOUNT_NOT_ALLOWED: '只能为此空间的可用账号分配额度。',
  QUOTA_ALLOCATION_EXCEEDED: '同一账号的周额度或 5 小时额度分配总和不能超过 100%，请刷新并调整。',
  INVALID_REQUEST: '管理请求无效，请核对工作空间配置。',
  STALE_AUTHORITY: 'VPS 管理服务身份或部署版本已变化，请重新读取。',
  STALE_REVISION: '工作空间配置已被修改，请刷新后重新预览。',
  PLAN_EXPIRED: '变更预览已过期，请重新预览。',
  PLAN_UNAVAILABLE: '变更预览不存在或已经执行，请读取实际结果。',
  WORKSPACE_UNAVAILABLE: '此工作空间不存在或已停用。',
  ENROLLMENT_UNAVAILABLE: '工作空间导入服务尚未配置 HTTPS 入口，暂不能生成邀请。',
  INTERNAL_ERROR: '管理服务未能完成请求；请刷新核实实际状态。',
};
export class RemoteWorkspaceControl {
  private catalogs = new Map<string, StudioSnapshot>();
  private plans = new Map<string, { identity: string; plan: StudioPlan; snapshot: StudioSnapshot; authorityId: string; generation: string; consumed: boolean; discoveredTarget?:{username:string;uid:number;root:string} }>();
  private listEpochs = new Map<string, number>();
  private pending = new Set<Promise<unknown>>();
  private mutations = new Set<string>();
  private closed = false;
  constructor(private runner: SshRunner = runWorkspaceSsh) {}
  private assertOpen() { if (this.closed) throw new Error('工作台正在退出，无法继续管理操作。'); }
  private admin(host: SshHost) { this.assertOpen(); validateSshHost(host); if (host.role !== 'admin') throw new Error('请从 VPS 管理员入口管理工作空间。'); }
  busy(host: SshHost) { return this.mutations.has(workspaceHostIdentity(host)); }
  async dispose() { this.closed = true; await Promise.allSettled([...this.pending]); }
  private async request(host: SshHost, method: string, params: Record<string, unknown>): Promise<unknown> {
    this.admin(host);
    const stdin = JSON.stringify({ protocol: 1, method, params }) + '\n';
    if (Buffer.byteLength(stdin) > 65536) throw new Error('管理请求过大。');
    const requestHost = structuredClone(host);
    const operation = Promise.resolve().then(() => { this.assertOpen(); return this.runner(requestHost, WORKSPACE_CONTROL_COMMAND, { stdin, timeoutMs: method === 'workspace/apply' ? 915_000 : 45_000, maxOutputBytes: 2 * 1024 * 1024 }); }).then(response => {
      if (response.exitCode !== 0 || Buffer.byteLength(response.stdout, 'utf8') > 2 * 1024 * 1024) throw new Error(errors.CONTROL_UNAVAILABLE);
      let result: unknown; try { result = JSON.parse(response.stdout); } catch { throw new Error(errors.CONTROL_UNAVAILABLE); }
      if (!validate.row(result) || result.ok !== true) throw new Error(validate.row(result) && typeof result.error === 'string' ? errors[result.error] ?? errors.INTERNAL_ERROR : errors.INTERNAL_ERROR);
      return result.value;
    }).catch(error => { throw new Error(error instanceof Error && Object.values(errors).includes(error.message) ? error.message : errors.CONTROL_UNAVAILABLE); });
    this.pending.add(operation); try { return await operation; } finally { this.pending.delete(operation); }
  }
  async list(host: SshHost): Promise<StudioSnapshot> {
    this.admin(host); const identity = workspaceHostIdentity(host), epoch = (this.listEpochs.get(identity) ?? 0) + 1;
    this.listEpochs.set(identity, epoch);
    try {
      const value = validate.snapshot(await this.request(host, 'workspace/list', {})); this.assertOpen();
      if (workspaceHostIdentity(host) !== identity || this.listEpochs.get(identity) !== epoch) throw new Error(errors.STALE_REVISION);
      if (value.connection.hostname.toLowerCase() !== host.hostname.toLowerCase() || value.connection.port !== host.port) throw new Error('管理服务的公开 SSH 端点与当前连接不一致。');
      this.catalogs.set(identity, value); return structuredClone(value);
    } catch (error) {
      if (this.listEpochs.get(identity) === epoch) this.catalogs.delete(identity);
      return { authorityId: '', generation: '', revision: 0, workspaces: [], connection: { hostname: host.hostname, port: host.port, hostPublicKeys: [] }, enrollmentUrl: '', availability: 'unavailable', reason: error instanceof Error && (Object.values(errors).includes(error.message) || error.message.startsWith('管理服务的')) ? error.message : errors.CONTROL_UNAVAILABLE };
    }
  }
  async plan(host: SshHost, input: StudioPlanInput): Promise<StudioPlan> {
    this.admin(host); const identity = workspaceHostIdentity(host), current = this.catalogs.get(identity);
    if (!current || !validate.revision(input.expectedRevision) || input.expectedRevision !== current.revision) throw new Error('请先读取当前工作空间配置，再预览变更。');
    if (!validate.operations.includes(input.operation) || (input.workspaceId !== undefined && !validate.identifier(input.workspaceId)) || (input.values !== undefined && !validate.row(input.values))) throw new Error(errors.INVALID_REQUEST);
    let discoveredTarget:{username:string;uid:number;root:string}|undefined;
    if(input.operation==='workspace/delete'&&!input.workspaceId){
      const target=input.values;
      if(!target||typeof target.username!=='string'||! /^[a-z_][a-z0-9_-]{0,31}$/.test(target.username)||target.username==='root'||!validate.revision(target.uid)||target.uid<1000||!validate.safeText(target.root,4096)||!target.root.startsWith('/')||target.root.split('/').includes('..'))throw Error(errors.INVALID_REQUEST);
      discoveredTarget={username:target.username,uid:target.uid,root:target.root};
    }
    const params = { authorityId: current.authorityId, generation: current.generation, expectedRevision: input.expectedRevision, operation: input.operation, ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }), ...(input.values === undefined ? {} : { values: input.values }) };
    const value = validate.plan(await this.request(host, 'workspace/plan', params)); this.assertOpen();
    if (workspaceHostIdentity(host) !== identity || this.catalogs.get(identity) !== current) throw new Error(errors.STALE_REVISION);
    const creating=input.operation==='workspace/create'||input.operation==='workspace/adopt'||input.operation==='workspace/delete'&&!input.workspaceId;
    if (value.operation !== input.operation || (creating ? !value.workspaceId || current.workspaces.some(w=>w.id===value.workspaceId) : value.workspaceId !== input.workspaceId) || value.expectedRevision !== input.expectedRevision) validate.invalid();
    if(value.deletion){const target=discoveredTarget??current.workspaces.find(w=>w.id===input.workspaceId);if(!target||value.deletion.username!==target.username||value.deletion.uid!==target.uid||value.deletion.root!==target.root)validate.invalid();}
    this.plans.set(value.planId, { identity, plan: value, snapshot: structuredClone(current), authorityId: current.authorityId, generation: current.generation, consumed: false,discoveredTarget }); return structuredClone(value);
  }
  async apply(host: SshHost, planId: string, planHash: string): Promise<StudioWireApply> {
    this.admin(host); const identity = workspaceHostIdentity(host), saved = this.plans.get(planId);
    if (!saved || saved.identity !== identity || saved.plan.planHash !== planHash || saved.consumed || Date.parse(saved.plan.expiresAt) <= Date.now()) throw new Error('请确认此连接当前的变更预览；已提交或过期的操作不能重放。');
    const current = this.catalogs.get(identity);
    if (!current || JSON.stringify(current) !== JSON.stringify(saved.snapshot)) throw new Error('管理服务状态已变化，请重新读取并预览。');
    if (this.mutations.has(identity)) throw new Error('此 VPS 有管理操作正在等待回执。');
    saved.consumed = true; this.mutations.add(identity);
    try {
      const value = validate.applyResult(await this.request(host, 'workspace/apply', { authorityId: saved.authorityId, generation: saved.generation, planId, planHash }));
      this.assertOpen();
      if (value.operationId !== planId) validate.invalid();
      const workspace = saved.snapshot.workspaces.find(item => item.id === saved.plan.workspaceId);
      if(value.state==='applied'&&saved.plan.operation==='workspace/delete'&&(!value.workspace||value.workspace.status!=='deleted'||value.workspace.deletion?.kind!=='purged'||value.workspace.deletion.home!==saved.plan.deletion?.home))validate.invalid();
      if(value.workspace&&saved.discoveredTarget&&(value.workspace.username!==saved.discoveredTarget.username||value.workspace.uid!==saved.discoveredTarget.uid||value.workspace.root!==saved.discoveredTarget.root))validate.invalid();
      if (value.workspace && saved.plan.workspaceId && (value.workspace.id !== saved.plan.workspaceId || (workspace && value.workspace.generation !== workspace.generation))) validate.invalid();
      if (value.invite && (value.state !== 'applied' || saved.plan.operation !== 'invite/create' || !workspace || value.invite.authorityId !== saved.authorityId || value.invite.generation !== saved.generation || value.invite.workspaceId !== workspace.id || value.invite.workspaceGeneration !== workspace.generation || value.invite.workspaceName !== workspace.name || value.invite.username !== workspace.username || value.invite.root !== workspace.root || value.invite.enrollmentUrl !== saved.snapshot.enrollmentUrl || JSON.stringify(value.invite.connection) !== JSON.stringify(saved.snapshot.connection))) validate.invalid();
      return value;
    } catch { throw new Error(`管理操作回执未确认，请刷新并查询操作 ${planId}；不要重复执行。`); }
    finally { this.mutations.delete(identity); this.catalogs.delete(identity); }
  }
  /** Host-internal numeric metering; deliberately not a renderer write route. */
  async quota(host: SshHost, method: 'quota/observe' | 'quota/read' | 'quota/check', payload: Record<string, unknown>): Promise<unknown> {
    this.admin(host);
    const current = this.catalogs.get(workspaceHostIdentity(host));
    if (!current) throw Error('请先刷新工作空间管理。');
    return this.request(host, method, {authorityId: current.authorityId, generation: current.generation, ...payload});
  }
  async operation(host: SshHost, operationId: string): Promise<StudioWireApply> {
    this.admin(host); if (!validate.identifier(operationId)) validate.invalid();
    const current = this.catalogs.get(workspaceHostIdentity(host));
    if (!current) throw new Error('请先刷新管理服务状态。');
    const value = validate.applyResult(await this.request(host, 'workspace/operation', { authorityId: current.authorityId, generation: current.generation, operationId }));
    this.assertOpen();
    if (value.operationId !== operationId || value.invite) validate.invalid(); return value;
  }
}
