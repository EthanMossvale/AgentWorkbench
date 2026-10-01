import { createHash } from 'node:crypto';
import type { AccountCatalog, SharedAccount, SshHost } from '../contracts/index';
import type { CodexAuthJob } from '../remote-codex-auth/index';
import { runSsh, validateSshHost, type SshRunner } from '../ssh-transport/index';
import { EXISTING_BROKER_CLIENT } from './existing-broker';
import { NATIVE_OWNER_CLIENT } from './native-client';
export type { AccountCatalog, SharedAccount, CodexAuthJob };

export const ACCOUNT_BROKER_SOCKET = '/run/agent-workbench-accounts/broker.sock';
const URL = 'https://auth.openai.com/codex/device' as const;
const CLIENT = String.raw`import json,socket,sys,os
${EXISTING_BROKER_CLIENT}
${NATIVE_OWNER_CLIENT}
try:
    raw=sys.stdin.buffer.readline(8193)
    if len(raw)>8192: raise ValueError()
    request=json.loads(raw)
    source=request.pop('source',None)
    if source not in (None,'existing-codex','native-owner'):raise ValueError()
    if source=='existing-codex':
        try: print(json.dumps({'ok':True,'value':existing_catalog(request)},separators=(',',':')))
        except PublicError as error: print(json.dumps({'ok':False,'error':str(error)}))
        except (OSError,ValueError,KeyError,TypeError): print('{"ok":false,"error":"BROKER_UNAVAILABLE"}')
        sys.exit(0)
    value=native_owner_request(request)
    sys.stdout.write(json.dumps(value,separators=(',',':'))+'\n')
except (OSError,ValueError):
    print('{"ok":false,"error":"BROKER_UNAVAILABLE"}')
`;
export const REMOTE_CATALOG_COMMAND = `exec python3 -c "import base64;exec(base64.b64decode('${Buffer.from(CLIENT).toString('base64')}'))"`;
type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]|-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]|sk-[A-Za-z0-9_-]{12,}/i.test(value);
const id = (value: unknown): value is string => text(value, 128) && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => text(value, 64) && Number.isFinite(Date.parse(value));
const hostIdentity = (host: SshHost) => createHash('sha256').update(JSON.stringify([host.id, host.hostname, host.port, host.username, host.role, host.ownerId, host.workspaceGeneration, host.identityFile, host.knownHostsFile])).digest('hex');
const ERROR_MESSAGES: Record<string, string> = {
  POLICY_UNAVAILABLE: '管理员尚未配置可验证的工作空间账号策略，请联系管理员。',
  WORKSPACE_DISABLED: '此工作空间已停用，无法访问共享账号。',
  ACCOUNT_FORBIDDEN: '此账号未分配给当前工作空间。',
  ADMIN_LOGIN_REQUIRED: '新增账号由 VPS 管理员统一授权，请选择已分配的账号。',
  BROKER_UNAVAILABLE: '共享账号服务尚未部署或不可用；不会回退为单工作空间登录。',
  RUNTIME_NOT_INSTALLED: '统一服务尚未配置 Codex CLI，请先完善该运行时配置；Claude 账号管理不受影响。',
  ACCOUNT_MIGRATION_REQUIRED: '旧账号目录仅用于迁移核对；请由管理员完成原生账号接入。',
  EXISTING_LOGIN_UNSUPPORTED: '已接入现有 Codex 账号服务，请复用已登记账号；此兼容入口不重复发起登录。',
  UNAUTHORIZED: '此 SSH 身份未被共享账号服务授权。',
  ADMIN_SELECTION_FORBIDDEN: '管理员没有工作空间默认账号；请在对应工作空间选择。',
  STALE_AUTHORITY: '共享账号服务的身份或代际已变化，请刷新目录。',
  STALE_SELECTION: '此工作空间的账号选择已变化，请刷新后重试。',
  ACCOUNT_UNAVAILABLE: '该共享账号不可用，请刷新目录。',
  LOGIN_BUSY: '此 VPS 有账号授权正在进行，或上次授权的清理尚未确认；请等待完成或确认清理后重试。',
  AUTH_START_UNCONFIRMED: '未收到可验证的授权回执，无法确认远端任务是否已启动或已清理。失联任务会在 30 秒轮询租约到期后尝试退出；重新发起不代表上次清理已确认。',
  JOB_UNAVAILABLE: '此授权任务已过期或不属于当前 SSH 身份。',
  SERVICE_DISPOSED: '工作台正在退出，无法继续账号授权。',
  INVALID_REQUEST: '共享账号请求无效。',
  INTERNAL_ERROR: '共享账号服务未能完成请求。',
};
export interface SelectSharedAccount { accountId: string; expectedRevision: number; authorityId: string; generation: string }
export interface RemoteAccountCatalogOptions { runner?: SshRunner }
interface BoundJob { host: SshHost; hostIdentity: string; authorityId: string; generation: string; value: CodexAuthJob; epoch: number; cancelRequested: boolean }

function catalog(value: unknown): AccountCatalog {
  if (!record(value) || !id(value.authorityId) || !id(value.generation) || !id(value.workspaceId) || !revision(value.revision) || !revision(value.selectionRevision) || value.availability !== 'ready' || !Array.isArray(value.accounts) || value.accounts.length > 128) throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
  const accounts: SharedAccount[] = []; const ids = new Set<string>();
  for (const row of value.accounts) {
    if (!record(row) || !id(row.id) || !id(row.generation) || !['codex','claude'].includes(String(row.provider)) || !['authenticated', 'configured', 'unknown', 'unauthenticated'].includes(String(row.status)) || !date(row.observedAt) || ids.has(row.id)) throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
    ids.add(row.id); const item: SharedAccount = { id: row.id, generation: row.generation, provider: row.provider as SharedAccount['provider'], status: row.status as SharedAccount['status'], observedAt: row.observedAt };
    for (const field of ['email', 'displayName', 'plan', 'authMethod'] as const) if (text(row[field])) item[field] = row[field];
    for(const field of ['enabled','workspaceEnabled'] as const)if(row[field]!==undefined){if(typeof row[field]!=='boolean')throw Error(ERROR_MESSAGES.INVALID_REQUEST);item[field]=row[field];}
    for(const field of ['accessRevision','workspaceAccessRevision'] as const)if(row[field]!==undefined){if(!revision(row[field]))throw Error(ERROR_MESSAGES.INVALID_REQUEST);item[field]=row[field];}
    accounts.push(item);
  }
  if (value.selectedAccountId !== undefined && (!id(value.selectedAccountId) || !accounts.some(a=>a.id===value.selectedAccountId&&a.provider==='codex'))) throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
  const extra:Partial<AccountCatalog>={};
  if(value.claudeSelectionRevision!==undefined){if(!revision(value.claudeSelectionRevision))throw Error(ERROR_MESSAGES.INVALID_REQUEST);extra.claudeSelectionRevision=value.claudeSelectionRevision;}
  if(value.selectedClaudeAccountId!==undefined){if(!id(value.selectedClaudeAccountId)||!accounts.some(a=>a.id===value.selectedClaudeAccountId&&a.provider==='claude'))throw Error(ERROR_MESSAGES.INVALID_REQUEST);extra.selectedClaudeAccountId=value.selectedClaudeAccountId;}
  if(value.source==='native-owner')extra.source='native-owner';
  if(value.source==='existing-codex'){
    if(!revision(value.policyRevision))throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
    extra.source='existing-codex';extra.policyRevision=value.policyRevision;
    if(value.assignments!==undefined){if(!Array.isArray(value.assignments)||value.assignments.length>128)throw new Error(ERROR_MESSAGES.INVALID_REQUEST);extra.assignments=value.assignments.map(row=>{if(!record(row)||!id(row.username)||!Array.isArray(row.accountIds)||row.accountIds.some(a=>!id(a)))throw new Error(ERROR_MESSAGES.INVALID_REQUEST);return {username:row.username,accountIds:row.accountIds as string[]};});}
  }
  return { authorityId: value.authorityId, generation: value.generation, workspaceId: value.workspaceId, revision: value.revision, selectionRevision: value.selectionRevision, ...(typeof value.selectedAccountId === 'string' ? { selectedAccountId: value.selectedAccountId } : {}), accounts, availability: 'ready',...extra };
}
function authJob(value: unknown, hostId: string): CodexAuthJob {
  if (!record(value) || typeof value.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.jobId) || !['preparing', 'awaiting-code', 'verifying', 'authenticated', 'cancelled', 'expired', 'failed'].includes(String(value.state)) || !date(value.createdAt) || !date(value.expiresAt) || !['pending', 'confirmed', 'unconfirmed'].includes(String(value.cleanup))) throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
  const result: CodexAuthJob = { jobId: value.jobId, hostId, state: value.state as CodexAuthJob['state'], createdAt: value.createdAt, expiresAt: value.expiresAt, cleanup: value.cleanup as CodexAuthJob['cleanup'] };
  if (result.state === 'awaiting-code') {
    if (value.verificationUrl !== URL || typeof value.userCode !== 'string' || !/^[A-Z0-9]{4,6}-[A-Z0-9]{4,6}$/.test(value.userCode)) throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
    result.verificationUrl = URL; result.userCode = value.userCode;
  }
  if (record(value.account) && value.account.status === 'authenticated') {
    result.account = { status: 'authenticated', source: 'codex account/read:workbench-profile' };
    for (const key of ['email', 'plan'] as const) if (text(value.account[key])) result.account[key] = value.account[key];
    if (value.account.authMethod === 'ChatGPT' || value.account.authMethod === 'api-key') result.account.authMethod = value.account.authMethod;
  }
  // Central filesystem paths, exception text, tokens and unknown fields never enter desktop state.
  if (result.state === 'failed') result.error = '共享账号原生授权未成功；请查看服务状态后重试。';
  return result;
}

/** Only public account metadata crosses SSH; authentication happens in the remote credential owner. */
export class RemoteAccountCatalogService {
  private readonly runner: SshRunner;
  private readonly authorities = new Map<string, { authorityId: string; generation: string }>();
  private readonly jobs = new Map<string, BoundJob>();
  private readonly pendingStarts = new Set<Promise<void>>();
  private readonly listEpochs = new Map<string,number>();
  private disposed = false;
  private disposal?: Promise<void>;
  constructor(options: RemoteAccountCatalogOptions = {}) { this.runner = options.runner ?? runSsh; }
  async list(host: SshHost, source?: AccountCatalog['source']): Promise<AccountCatalog> {
    validateSshHost(host);
    const identity=hostIdentity(host), epoch=(this.listEpochs.get(identity)??0)+1;
    this.listEpochs.set(identity,epoch);
    let value:AccountCatalog;
    try {
      if (this.disposed) throw new Error(ERROR_MESSAGES.SERVICE_DISPOSED);
      value = catalog(await this.request(host, 'catalog/list', {}, source));
      if (this.disposed) throw new Error(ERROR_MESSAGES.SERVICE_DISPOSED);
      if(value.source&&value.source!==(source??'native-owner'))throw Error(ERROR_MESSAGES.INVALID_REQUEST);
      value.source=source??'native-owner';
    } catch (error) {
      value={ authorityId: '', generation: '', revision: 0, workspaceId: '', selectionRevision: 0, accounts: [], availability: 'unavailable', source:source??'native-owner', reason: error instanceof Error && Object.values(ERROR_MESSAGES).includes(error.message) ? error.message : ERROR_MESSAGES.BROKER_UNAVAILABLE };
    }
    if(source==='existing-codex')return value;
    // Discover public legacy metadata separately. It cannot make the native
    // service ready, grant access, start login or reactivate a retired runtime.
    if(!source&&!this.disposed){
      try{const old=catalog(await this.request(host,'catalog/list',{},'existing-codex'));
        if(old.source!=='existing-codex')throw Error(ERROR_MESSAGES.INVALID_REQUEST);
        value.legacy={authorityId:old.authorityId,generation:old.generation,revision:old.revision,accounts:old.accounts,availability:'ready'};
      }catch{value.legacy={authorityId:'',generation:'',revision:0,accounts:[],availability:'unavailable'};}
    }
    if(this.disposed)return {...value,availability:'unavailable',accounts:[],reason:ERROR_MESSAGES.SERVICE_DISPOSED};
    if(this.listEpochs.get(identity)===epoch){
      if(value.availability==='ready')this.authorities.set(identity,{authorityId:value.authorityId,generation:value.generation});
      else this.authorities.delete(identity);
    }
    return value;
  }
  async setEnabled(host:SshHost,input:{authorityId:string;generation:string;accountId:string;accountGeneration:string;expectedRevision:number;enabled:boolean}):Promise<AccountCatalog>{
    if(!id(input.accountId)||!id(input.accountGeneration)||!id(input.authorityId)||!id(input.generation)||!revision(input.expectedRevision)||typeof input.enabled!=='boolean')throw Error(ERROR_MESSAGES.INVALID_REQUEST);
    const value=catalog(await this.request(host,'account/set-enabled',input));
    if(value.authorityId!==input.authorityId||value.generation!==input.generation)throw Error(ERROR_MESSAGES.STALE_AUTHORITY);
    return value;
  }
  async select(host: SshHost, input: SelectSharedAccount): Promise<AccountCatalog> {
    if (host.role !== 'workspace' || host.username.toLowerCase() === 'root') throw new Error(ERROR_MESSAGES.ADMIN_SELECTION_FORBIDDEN);
    if (!id(input.accountId) || !revision(input.expectedRevision) || !id(input.authorityId) || !id(input.generation)) throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
    const value = catalog(await this.request(host, 'selection/set', input));
    if (value.authorityId !== input.authorityId || value.generation !== input.generation) throw new Error(ERROR_MESSAGES.STALE_AUTHORITY);
    this.authorities.set(hostIdentity(host), { authorityId: value.authorityId, generation: value.generation }); return value;
  }
  async start(host: SshHost): Promise<CodexAuthJob> {
    if (this.disposed) throw new Error(ERROR_MESSAGES.SERVICE_DISPOSED);
    host = structuredClone(host); validateSshHost(host);
    let settled!: () => void;
    const pending = new Promise<void>(resolve => { settled = resolve; });
    this.pendingStarts.add(pending);
    try {
      let authority = this.authorities.get(hostIdentity(host));
      if (!authority) { const state = await this.list(host,'native-owner'); if (this.disposed) throw new Error(ERROR_MESSAGES.SERVICE_DISPOSED); if (state.availability !== 'ready') throw new Error(state.reason ?? ERROR_MESSAGES.BROKER_UNAVAILABLE); authority = { authorityId: state.authorityId, generation: state.generation }; }
      if (this.disposed) throw new Error(ERROR_MESSAGES.SERVICE_DISPOSED);
      let value: CodexAuthJob;
      try { value = authJob(await this.request(host, 'login/start', authority), host.id); }
      catch (error) { if (error instanceof Error && [ERROR_MESSAGES.BROKER_UNAVAILABLE, ERROR_MESSAGES.INVALID_REQUEST].includes(error.message)) throw new Error(ERROR_MESSAGES.AUTH_START_UNCONFIRMED); throw error; }
      this.jobs.set(value.jobId, { host, hostIdentity: hostIdentity(host), ...authority, value, epoch: 0, cancelRequested: false });
      if (this.disposed) {
        // A late receipt is usable only for cleanup, never for returning its code.
        // Failed/unknown cleanup remains fenced locally and bounded by the remote lease.
        await this.cancel(host, value.jobId).catch(() => undefined);
        throw new Error(ERROR_MESSAGES.SERVICE_DISPOSED);
      }
      return structuredClone(value);
    } finally { this.pendingStarts.delete(pending); settled(); }
  }
  async status(host: SshHost, jobId: string): Promise<CodexAuthJob> {
    const job = this.bound(host, jobId);
    const epoch = job.epoch;
    const value = authJob(await this.request(host, 'login/status', { jobId, authorityId: job.authorityId, generation: job.generation }), host.id);
    if (value.jobId !== jobId) throw new Error(ERROR_MESSAGES.JOB_UNAVAILABLE);
    if (job.epoch !== epoch || job.cancelRequested) return structuredClone(job.value);
    job.value = value; return structuredClone(value);
  }
  async cancel(host: SshHost, jobId: string): Promise<CodexAuthJob> {
    const job = this.bound(host, jobId);
    job.epoch++; job.cancelRequested = true;
    if (['preparing', 'awaiting-code', 'verifying'].includes(job.value.state)) job.value = { ...job.value, state: 'cancelled', cleanup: 'unconfirmed' };
    delete job.value.userCode; delete job.value.verificationUrl;
    const value = authJob(await this.request(host, 'login/cancel', { jobId, authorityId: job.authorityId, generation: job.generation }), host.id);
    if (value.jobId !== jobId) throw new Error(ERROR_MESSAGES.JOB_UNAVAILABLE);
    if (['preparing', 'awaiting-code', 'verifying'].includes(value.state)) throw new Error(ERROR_MESSAGES.INTERNAL_ERROR);
    job.value = value; return structuredClone(value);
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.disposal = Promise.allSettled([
      ...this.pendingStarts,
      ...[...this.jobs.values()].filter(job => ['preparing', 'awaiting-code', 'verifying'].includes(job.value.state) || job.value.cleanup !== 'confirmed').map(job => this.cancel(job.host, job.value.jobId)),
    ]).then(() => undefined);
    return this.disposal;
  }
  private bound(host: SshHost, jobId: string): BoundJob {
    const job = this.jobs.get(jobId); if (!job || job.hostIdentity !== hostIdentity(host)) throw new Error(ERROR_MESSAGES.JOB_UNAVAILABLE); return job;
  }
  private async request(host: SshHost, method: string, params: unknown, source?: AccountCatalog['source']): Promise<unknown> {
    validateSshHost(host);
    let response: unknown;
    try { const result = await this.runner(host, REMOTE_CATALOG_COMMAND, { stdin: JSON.stringify({ protocol: 1, method, params, ...(source?{source}:{}) }) + '\n', timeoutMs: 25_000, maxOutputBytes: 256 * 1024 }); if (result.exitCode !== 0 || Buffer.byteLength(result.stdout, 'utf8') > 256 * 1024) throw new Error(); response = JSON.parse(result.stdout); }
    catch { throw new Error(ERROR_MESSAGES.BROKER_UNAVAILABLE); }
    if (!record(response) || response.ok !== true) throw new Error(record(response) && typeof response.error === 'string' ? ERROR_MESSAGES[response.error] ?? ERROR_MESSAGES.INTERNAL_ERROR : ERROR_MESSAGES.INTERNAL_ERROR);
    return response.value;
  }
}
