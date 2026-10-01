import { visualizationPresentation } from '../visualizations/instructions';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { noLinks } from '../native-resources/files';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { detectCodexDesktop, startCodexDesktopLogin } from './codex-desktop';
import { ProcessSupervisor, type NativeFrame, type ProcessSpec } from '../../services/remote-supervisor';
import { CodexRpcClient, codexThreadPermissionParams } from '../runtime-codex';
import { parseModels } from '../runtime-codex/models';
import { parseClaudeModels } from '../runtime-claude/models';
import type { LocalCliService } from '../native-runtime/cli';
import type { NativeModelOption, Session } from '../contracts';
import type { AccountLogin, LocalModelAccount, LoginMethod } from './types';
import { parseAccountUsage } from '../account-usage';
import type { AccountUsage } from '../account-usage/types';
import { claudePermissionMode } from '../runtime-claude';

const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const text = (v: unknown) => typeof v === 'string' && v.length <= 256 && !/[\x00-\x1f]/.test(v) ? v : undefined;
export function accountEnvironment(base: NodeJS.ProcessEnv, directory: string, account: Pick<LocalModelAccount, 'id' | 'provider'>) {
  if (!/^[a-f0-9-]{36}$/.test(account.id)) throw Error('LOCAL_ACCOUNT_ID_INVALID');
  const env = { ...base };
  for (const key of Object.keys(env)) if (/^(OPENAI_|ANTHROPIC_|CLAUDE_CODE_|CODEX_|AWB_PROVIDER_TOKEN)/i.test(key)) delete env[key];
  // The runtime owns its credentials. Neither auth files nor keychain entries are read here.
  const profile = path.join(directory, 'native-accounts', account.id);
  env.CODEX_HOME = path.join(profile, 'codex'); env.CLAUDE_CONFIG_DIR = path.join(profile, 'claude');
  env.ANTHROPIC_CONFIG_DIR = path.join(profile, 'anthropic');
  return { env, profile };
}
export function officialLoginUrl(value: unknown, provider: LocalModelAccount['provider']) {
  if (typeof value !== 'string' || value.length > 8192) return;
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    if (provider === 'codex' && url.hostname === 'chatgpt.com' && url.pathname === '/codex/desktop-auth') { const nested = url.searchParams.get('authorize_url'); if (nested && officialLoginUrl(nested,'codex')?.startsWith('https://auth.openai.com/')) return url.href; return; }
    if (provider === 'codex' ? url.hostname === 'auth.openai.com' : ['claude.ai', 'platform.claude.com', 'console.anthropic.com'].includes(url.hostname)) return url.href;
  } catch { /* Native diagnostics are not a URL authority. */ }
}
export function codexCallbackUrl(authUrl: string, input: unknown) {
  try {
    let auth = new URL(authUrl); if (auth.hostname === 'chatgpt.com') auth = new URL(auth.searchParams.get('authorize_url')!);
    if (!officialLoginUrl(auth.href,'codex') || typeof input !== 'string' || input.length > 16384 || /[\x00-\x20]/.test(input)) throw 0;
    const redirect = new URL(auth.searchParams.get('redirect_uri')!), callback = new URL(input), state = auth.searchParams.get('state');
    if (redirect.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(redirect.hostname) || redirect.pathname !== '/auth/callback' || redirect.username || redirect.password || callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.username || callback.password || callback.hash || !state || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== state || callback.searchParams.getAll('code').length !== 1 || !callback.searchParams.get('code')) throw 0;
    return callback;
  } catch { throw Error('LOCAL_ACCOUNT_CALLBACK_INVALID'); }
}
export async function submitCodexCallback(url: URL) {
  // Direct loopback request, no proxy, DNS authority from input or redirect following.
  await new Promise<void>((resolve,reject)=>{
    const request = httpRequest({hostname:url.hostname==='[::1]'?'::1':'127.0.0.1',port:url.port||80,path:url.pathname+url.search,method:'GET',headers:{Host:url.host},timeout:15000}, response=>{
      response.resume(); if(response.statusCode && response.statusCode>=200 && response.statusCode<400)resolve();else reject(Error('LOCAL_ACCOUNT_CALLBACK_REJECTED'));
    });
    request.on('timeout',()=>request.destroy());request.on('error',()=>reject(Error('LOCAL_ACCOUNT_CALLBACK_UNREACHABLE')));request.end();
  });
}
/** Native login may cancel a pre-existing callback server when its default port
 * is occupied. Refuse before launching instead of interfering with that login. */
export async function assertCodexCallbackPortAvailable(port = 1455) {
  await new Promise<void>((resolve,reject)=>{
    const server=createServer();server.once('error',()=>reject(Error('LOCAL_ACCOUNT_CALLBACK_PORT_BUSY')));
    server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(error=>error?reject(Error('LOCAL_ACCOUNT_CALLBACK_PORT_BUSY')):resolve()));
  });
}
export function codexUsage(value: unknown, id: string) {
  const v = obj(value);
  return parseAccountUsage({ pools: v.rateLimitsByLimitId ?? { codex: v.rateLimits }, resetCredits: v.rateLimitResetCredits }, id);
}
export function claudeUsage(value: unknown, id: string, previous?: AccountUsage): AccountUsage | undefined {
  const v = obj(value), limits = obj(v.rate_limits), info = obj(v.rate_limit_info ?? v.rateLimitInfo);
  const windows = new Map<number, { usedPercent: number; windowMinutes: number; resetsAt?: number }>();
  for (const [key, duration] of [['five_hour', 300], ['seven_day', 10080]] as const) {
    const row = {...obj(limits[key])};
    if(v.rate_limits_available===true){
      row.used_percentage=row.utilization;
      if(row.resets_at!=null&&(typeof row.resets_at!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(row.resets_at)||!Number.isFinite(Date.parse(row.resets_at))||Date.parse(row.resets_at)<0))return;
      if(row.utilization!=null&&(typeof row.utilization!=='number'||!Number.isFinite(row.utilization)||row.utilization<0||row.utilization>100))return;
      row.resets_at=typeof row.resets_at==='string'?Date.parse(row.resets_at)/1000:undefined;
    }
    if (typeof row.used_percentage === 'number' && row.used_percentage >= 0 && row.used_percentage <= 100) windows.set(duration, { usedPercent: row.used_percentage, windowMinutes: duration, ...(Number.isFinite(row.resets_at) ? { resetsAt: row.resets_at } : {}) });
  }
  if (v.type === 'rate_limit_event' && ['five_hour', 'seven_day'].includes(info.rateLimitType) && typeof info.utilization === 'number' && info.utilization >= 0 && info.utilization <= 1) {
    for (const pool of previous?.pools ?? []) for (const window of [pool.primary, pool.secondary]) if (window?.windowMinutes && (!window.resetsAt || window.resetsAt > Date.now() / 1000)) windows.set(window.windowMinutes, window as any);
    const duration = info.rateLimitType === 'five_hour' ? 300 : 10080;
    windows.set(duration, { usedPercent: info.utilization * 100, windowMinutes: duration, ...(Number.isFinite(info.resetsAt) ? { resetsAt: info.resetsAt } : {}) });
  }
  if (!windows.size) return;
  return { accountId: id, availability: 'ready', observedAt: new Date().toISOString(), pools: [{ id: 'claude', name: 'Claude', primary: windows.get(300), secondary: windows.get(10080) }], cards: [], cardsSupported: false };
}
export function quotaCycle(account: LocalModelAccount, usage: AccountUsage) {
  const windows = usage.pools.flatMap(p => [p.primary, p.secondary]).filter(w => w?.resetsAt && [300, 10080].includes(w.windowMinutes ?? 0));
  const current = windows.find(w => w?.windowMinutes === 10080) ?? windows[0];
  if (!current?.resetsAt) return account.cycle;
  const end = new Date(current.resetsAt * 1000).toISOString(), at = Date.parse(usage.observedAt);
  if (current.resetsAt * 1000 <= at) return account.cycle;
  if (account.cycle?.end === end) return account.cycle;
  const previous = account.usage?.pools.flatMap(p => [p.primary, p.secondary]).find(w => w?.windowMinutes === current.windowMinutes);
  const start = previous?.resetsAt && previous.resetsAt * 1000 <= at && previous.resetsAt < current.resetsAt ? previous.resetsAt * 1000 : current.usedPercent === 0 ? at : undefined;
  return start === undefined ? undefined : { start: new Date(start).toISOString(), end, windowMinutes: current.windowMinutes! };
}
export interface AccountInspection { status: LocalModelAccount['status']; email?: string; plan?: string; models: NativeModelOption[]; usage?: AccountUsage }
export interface LoginHandle { job: AccountLogin; cancel(): Promise<void>; submitCode?(code: string): Promise<void>; submitCallback?(url: string): Promise<void> }
export interface NativeAccountTransport {
  inspect(account: LocalModelAccount): Promise<AccountInspection>;
  login(account: LocalModelAccount, method: LoginMethod, changed: (job: AccountLogin) => void): Promise<LoginHandle>;
  consume(account: LocalModelAccount, key: string, creditId?: string): Promise<string>;
  dispose(): Promise<void>;
  desktopAvailable?(): Promise<boolean>;
}
/** Official CLI protocols only; no subscription token scraping or web API calls. */
export class OfficialAccountTransport implements NativeAccountTransport {
  private processes = new Set<ProcessSupervisor>();
  private desktops = new Set<LoginHandle>();
  private oauthOwner?: string;
  constructor(private directory: string, private cli: LocalCliService, private processFactory: (spec: ProcessSpec) => ProcessSupervisor = spec => new ProcessSupervisor(spec)) {}
  async desktopAvailable() { return !this.cli.options?.isolated && !!await detectCodexDesktop(this.cli.env); }
  async launchData(account: LocalModelAccount) {
    if (this.cli.isMaintaining()) throw Error('LOCAL_ACCOUNT_RUNTIME_BUSY');
    const cli = await this.cli.locate(account.provider); if (!cli) throw Error('LOCAL_ACCOUNT_RUNTIME_MISSING');
    const location = accountEnvironment(this.cli.env, this.directory, account);
    await noLinks(account.provider === 'codex' ? location.env.CODEX_HOME! : location.env.CLAUDE_CONFIG_DIR!);
    await mkdir(account.provider === 'codex' ? location.env.CODEX_HOME! : location.env.CLAUDE_CONFIG_DIR!, { recursive: true, mode: 0o700 });
    if(account.provider==='claude'){await noLinks(location.env.ANTHROPIC_CONFIG_DIR!);await mkdir(location.env.ANTHROPIC_CONFIG_DIR!,{recursive:true,mode:0o700});}
    return { ...location, executable: cli.executable };
  }
  private async codex<T>(account: LocalModelAccount, action: (rpc: CodexRpcClient) => Promise<T>) {
    const launch = await this.launchData(account), process = this.processFactory({ executable: launch.executable, args: ['-c', 'check_for_update_on_startup=false', '-c', 'cli_auth_credentials_store="file"', 'app-server', '--listen', 'stdio://'], env: launch.env, cwd: launch.profile, lifetimeMs: 60000, maxOutputBytes: 4 * 1024 * 1024 });
    this.processes.add(process); const rpc = new CodexRpcClient(process, account.id); rpc.on('fault', () => {});
    try { await process.start(); await rpc.initialize(); return await action(rpc); }
    finally { await process.stop('account-read-finished'); this.processes.delete(process); }
  }
  async inspect(account: LocalModelAccount): Promise<AccountInspection> {
    if (account.provider === 'codex') return this.codex(account, async rpc => {
      const info = obj(await rpc.request('account/read', { refreshToken: false })), auth = obj(info.account);
      if (auth.type !== 'chatgpt') return { status: 'signed-out', models: [] };
      const models = parseModels(await rpc.request('model/list', { limit: 100, includeHidden: false }));
      let usage: AccountUsage | undefined;
      try { usage = codexUsage(await rpc.request('account/rateLimits/read'), account.id); } catch { /* Login success does not imply quota capability. */ }
      return { status: 'authenticated', email: text(auth.email), plan: text(auth.planType), models, usage };
    });
    const launch = await this.launchData(account);
    const value = await this.claudeStatus(launch);
    if (value.loggedIn !== true) return { status: 'signed-out', models: [] };
    let usage: AccountUsage = {accountId:account.id, observedAt:new Date().toISOString(), availability:'unavailable', pools:[], cards:[], cardsSupported:false, reason:'Claude 原生额度查询失败，请检查 CLI 版本或稍后刷新。'};
    const models = await this.claudeModels(launch, data => {
      const v=obj(data);
      if(typeof v.rate_limits_available!=='boolean')return;
      usage=claudeUsage(v,account.id)??{...usage,availability:v.rate_limits_available?'unavailable':'unsupported',reason:v.rate_limits_available?'原生额度查询未返回可用窗口。':'当前原生登录未提供订阅额度。'};
    });
    return { status: 'authenticated', email: text(value.email), plan: text(value.subscriptionType ?? value.authMethod), models, usage };
  }
  private async claudeStatus(launch: { executable: string; env: NodeJS.ProcessEnv; profile: string }) {
    const process=this.processFactory({executable:launch.executable,args:['auth','status'],env:launch.env,cwd:launch.profile,outputMode:'opaque',lifetimeMs:20000,maxOutputBytes:1024*1024});
    this.processes.add(process);let output='';
    try{return await new Promise<Record<string,any>>((resolve,reject)=>{
      process.on('stdout',chunk=>{output+=chunk.toString();});
      process.on('fault',()=>reject(Error('LOCAL_ACCOUNT_STATUS_UNAVAILABLE')));
      process.on('disconnect',exit=>{try{const value=obj(JSON.parse(output));if(exit.code===0&&value.loggedIn===true||exit.code===1&&value.loggedIn===false||exit.code===0&&value.loggedIn===false)resolve(value);else reject(Error('LOCAL_ACCOUNT_STATUS_UNAVAILABLE'));}catch{reject(Error('LOCAL_ACCOUNT_STATUS_UNAVAILABLE'));}});
      void process.start().catch(()=>reject(Error('LOCAL_ACCOUNT_STATUS_UNAVAILABLE')));
    });}finally{await process.stop('account-status-finished');this.processes.delete(process);}
  }
  private async claudeModels(launch: { executable: string; env: NodeJS.ProcessEnv; profile: string }, receiveUsage?: (data: unknown) => void): Promise<NativeModelOption[]> {
    const process = this.processFactory({ executable: launch.executable, args: ['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--setting-sources', ''], env: launch.env, cwd: launch.profile, lifetimeMs: 25000, maxOutputBytes: 2 * 1024 * 1024 });
    this.processes.add(process); let id = randomUUID(); let catalog: NativeModelOption[] | undefined;
    try {
      return await new Promise<NativeModelOption[]>((resolve, reject) => {
        const timer = setTimeout(() => { if(catalog)resolve(catalog);else reject(Error('LOCAL_ACCOUNT_MODELS_UNAVAILABLE')); }, 20000);
        const fail = () => { clearTimeout(timer); if(catalog)resolve(catalog);else reject(Error('LOCAL_ACCOUNT_MODELS_UNAVAILABLE')); };
        process.on('fault', fail); process.on('disconnect', fail);
        process.on('frame', (frame: NativeFrame) => {
          const v = obj(frame.value), response = obj(v.response);
          if (v.type !== 'control_response' || response.request_id !== id) return;
          const data = obj(response.response), models = data.models;
          if(catalog){clearTimeout(timer);if(response.subtype==='success')receiveUsage?.(data);return resolve(catalog);}
          if (response.subtype !== 'success' || !Array.isArray(models) || !models.some((m:any)=>text(m.value))) {clearTimeout(timer);return reject(Error('LOCAL_ACCOUNT_MODELS_UNAVAILABLE'));}
          try{
            catalog=parseClaudeModels(models);
            if(receiveUsage){id=randomUUID();void process.write({type:'control_request',request_id:id,request:{subtype:'get_usage',skip_behaviors:true}}).catch(fail);}
            else {clearTimeout(timer);resolve(catalog);}
          }catch{clearTimeout(timer);reject(Error('LOCAL_ACCOUNT_MODELS_UNAVAILABLE'));}
        });
        void process.start().then(() => process.write({ type: 'control_request', request_id: id, request: { subtype: 'initialize' } })).catch(fail);
      });
    } finally { await process.stop('account-models-finished'); this.processes.delete(process); }
  }
  async login(account: LocalModelAccount, method: LoginMethod, changed: (job: AccountLogin) => void): Promise<LoginHandle> {
    if(account.provider!=='codex'||!['browser','desktop'].includes(method))return this.startLogin(account,method,changed);
    if(this.oauthOwner)throw Error('LOCAL_ACCOUNT_CALLBACK_PORT_BUSY');
    this.oauthOwner=account.id;const release=()=>{if(this.oauthOwner===account.id)this.oauthOwner=undefined;};
    try{
      await assertCodexCallbackPortAvailable();
      const handle=await this.startLogin(account,method,job=>{if(job.status!=='waiting')release();changed(job);});
      const cancel=handle.cancel;handle.cancel=async()=>{try{await cancel();}finally{release();}};
      if(handle.job.status!=='waiting')release();return handle;
    }catch(error){release();throw error;}
  }
  private async startLogin(account: LocalModelAccount, method: LoginMethod, changed: (job: AccountLogin) => void): Promise<LoginHandle> {
    if (account.provider === 'codex' && method === 'desktop') { const launch=await this.launchData(account);const handle=await startCodexDesktopLogin(account,launch.env.CODEX_HOME!,launch.env,changed);this.desktops.add(handle);const cancel=handle.cancel;handle.cancel=async()=>{try{await cancel();}finally{this.desktops.delete(handle);}};return handle; }
    if (!(account.provider === 'codex' ? ['browser', 'device'] : ['browser', 'sso', 'console']).includes(method)) throw Error('LOCAL_ACCOUNT_LOGIN_METHOD_INVALID');
    const launch = await this.launchData(account), job: AccountLogin = { id: randomUUID(), accountId: account.id, method, status: 'waiting', expiresAt: new Date(Date.now() + 10 * 60000).toISOString() };
    const process = this.processFactory({ executable: launch.executable, args: account.provider === 'codex' ? ['-c', 'check_for_update_on_startup=false', '-c', 'cli_auth_credentials_store="file"', 'app-server', '--listen', 'stdio://'] : ['auth', 'login', ...(method === 'sso' ? ['--sso'] : method === 'console' ? ['--console'] : [])], env: launch.env, cwd: launch.profile, outputMode: account.provider === 'claude' ? 'opaque' : 'jsonl', lifetimeMs: 10 * 60000, maxOutputBytes: 2 * 1024 * 1024 });
    this.processes.add(process); let loginId: string | undefined, earlyCompletion: {loginId: string; success: boolean} | undefined, rpc: CodexRpcClient | undefined, ended = false, diagnostic = '',codeSent=false;
    const update = (status: AccountLogin['status'], error?: string) => { if (ended) return; job.status = status; job.error = error; if (status !== 'waiting') { delete job.codeRequested; delete job.callbackSupported; } if (['complete', 'cancelled', 'failed'].includes(status)) { ended = true; delete job.url; delete job.userCode; } changed({ ...job }); };
    process.on('fault', () => update('failed', 'LOCAL_ACCOUNT_LOGIN_FAILED'));
    process.on('disconnect', exit => { if (!ended && job.status !== 'verifying') update(account.provider === 'claude' && exit.code === 0 ? 'verifying' : 'failed', exit.code === 0 ? undefined : 'LOCAL_ACCOUNT_LOGIN_INTERRUPTED'); this.processes.delete(process); });
    try {
      if (account.provider === 'codex') {
        rpc = new CodexRpcClient(process, account.id); rpc.on('fault', () => {});
        rpc.on('raw', (frame: NativeFrame) => { const p = obj(frame.value.params); if (frame.value.method !== 'account/login/completed')return;if(!loginId&&text(p.loginId)){earlyCompletion={loginId:p.loginId,success:p.success===true};return;}if(p.loginId===loginId) { update(p.success === true ? 'verifying' : 'failed', p.success === true ? undefined : 'LOCAL_ACCOUNT_LOGIN_REJECTED'); void process.stop('account-login-completed'); } });
        await process.start(); await rpc.initialize();
        const result = obj(await rpc.request('account/login/start', { type: method === 'device' ? 'chatgptDeviceCode' : 'chatgpt' }));
        loginId = text(result.loginId); job.url = officialLoginUrl(result.authUrl ?? result.verificationUrl, 'codex'); job.userCode = method === 'device' ? text(result.userCode) : undefined;
        if (!loginId || !job.url) throw Error('LOCAL_ACCOUNT_LOGIN_RESPONSE_INVALID');
        job.callbackSupported = method === 'browser';
        if(earlyCompletion?.loginId===loginId){update(earlyCompletion.success?'verifying':'failed',earlyCompletion.success?undefined:'LOCAL_ACCOUNT_LOGIN_REJECTED');void process.stop('account-login-completed');}
      } else {
        const output = (chunk: Buffer | string) => { if(ended)return;diagnostic = (diagnostic + chunk.toString()).slice(-16384); const candidates = diagnostic.match(/https:\/\/[^\s<>"\x1b]+/g) ?? []; for (const value of candidates) { const url = officialLoginUrl(value, 'claude'); if (url) job.url = url; } if(!codeSent&&/paste\s+(?:the\s+)?code\s+here/i.test(diagnostic))job.codeRequested=true;changed({ ...job }); };
        process.on('stdout', output); process.on('diagnostic', output); await process.start();
      }
      return { job, ...(account.provider==='codex'&&method==='browser'?{submitCallback:async(input:string)=>{if(ended||job.status!=='waiting'||!job.url)throw Error('LOCAL_ACCOUNT_LOGIN_NOT_WAITING');await submitCodexCallback(codexCallbackUrl(job.url,input));}}:{}), ...(account.provider==='claude'?{submitCode:async(code:string)=>{if(ended||job.status!=='waiting'||!job.codeRequested||codeSent)throw Error('LOCAL_ACCOUNT_CODE_NOT_REQUESTED');if(typeof code!=='string'||!code||code.length>4096||/\s/.test(code))throw Error('LOCAL_ACCOUNT_CODE_INVALID');codeSent=true;delete job.codeRequested;changed({...job});await process.writeLoginCode(code);}}:{}), cancel: async () => { const wasWaiting=!ended&&job.status==='waiting';update('cancelled'); try { if (wasWaiting && process.state==='running' && rpc && loginId) await rpc.request('account/login/cancel', { loginId }); } finally { await process.stop('account-login-cancelled'); this.processes.delete(process); } } };
    } catch { update('failed', 'LOCAL_ACCOUNT_LOGIN_FAILED'); await process.stop('account-login-failed'); this.processes.delete(process); throw Error('LOCAL_ACCOUNT_LOGIN_FAILED'); }
  }
  async consume(account: LocalModelAccount, key: string, creditId?: string) {
    if (account.provider !== 'codex') throw Error('LOCAL_ACCOUNT_RESET_UNSUPPORTED');
    return this.codex(account, async rpc => { const response = obj(await rpc.request('account/rateLimitResetCredit/consume', { idempotencyKey: key, ...(creditId ? { creditId } : {}) })); return String(response.outcome); });
  }
  async dispose() { await Promise.allSettled([...this.desktops].map(h=>h.cancel()));this.desktops.clear();await Promise.allSettled([...this.processes].map(p => p.stop('accounts-disposed'))); this.processes.clear(); }
}

export function officialAccountLaunch(session: Session, env: NodeJS.ProcessEnv, mcp?: { baseUrl: string; token: string }) {
  const model = session.modelSelection?.model;
  if (!model) throw Error('LOCAL_ACCOUNT_MODEL_REQUIRED');
  if (session.binding.runtime === 'codex') return { env, args: ['-c', 'check_for_update_on_startup=false', '-c', 'cli_auth_credentials_store="file"', '-c', 'model_provider="openai"', '-c', 'features.default_mode_request_user_input=true', 'app-server', '--listen', 'stdio://'], thread: {developerInstructions:visualizationPresentation.instructions(session.binding.runtime), ...codexThreadPermissionParams(session.permissionMode ?? 'default'), model, modelProvider: 'openai' }, runtimeModel: model };
  const args = ['--append-system-prompt',visualizationPresentation.instructions(session.binding.runtime),'--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--allow-dangerously-skip-permissions', '--model', model, '--permission-mode', claudePermissionMode(session.permissionMode ?? 'default')];
  if (session.binding.nativeSessionId) args.push('--resume', session.binding.nativeSessionId);
  else if(session.branch?.native){
    const fork=session.branch.native,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(fork.runtime!=='claude'||!uuid.test(fork.threadId)||!uuid.test(fork.lastMessageId??'')||!uuid.test(session.id)||session.id===fork.threadId)throw Error('NATIVE_FORK_BOUNDARY_UNVERIFIED');
    args.push('--resume',fork.threadId,'--fork-session','--resume-session-at',fork.lastMessageId!,'--session-id',session.id);
  }
  if (session.modelSelection?.effort) args.push('--effort', session.modelSelection.effort);
  args.push('--settings',JSON.stringify({fastMode:session.modelSelection?.serviceTier==='priority'}));
  if (mcp) args.push('--mcp-config', JSON.stringify({ mcpServers: { workbench: { type: 'http', url: mcp.baseUrl + '/mcp', headers: { Authorization: `Bearer ${mcp.token}` } } } }));
  return { env, args, thread: undefined, runtimeModel: model };
}
