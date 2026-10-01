import {sharedAccountRef} from '../../../packages/account-selection';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rm, readFile } from 'node:fs/promises';
import { AccountAccessRegistry } from '../../../packages/model-management/access-registry';
import { parseCodexCredentials, resolveCodexCredential } from '../../../packages/model-management/credentials';
import { noLinks, textFile, atomicWrite } from '../../../packages/native-resources/files';
import type { AppState, NativeModelSelection, Session } from '../../../packages/contracts';
import type { LocalCliService } from '../../../packages/native-runtime/cli';
import { accountEnvironment, OfficialAccountTransport, quotaCycle, type NativeAccountTransport, type LoginHandle } from '../../../packages/model-management/native';
import { localAccountRef, officialAccountBinding, type AccountLogin, type LocalModelAccount, type LoginMethod, type UsageScope } from '../../../packages/model-management/types';
import { modelUsageSummary, validatePrice } from '../../../packages/model-management/usage';
import { validateModelSelection } from '../../../packages/runtime-codex/models';
import type { ResetPlan, ResetReceipt, AccountUsage } from '../../../packages/account-usage/types';
import type { ModelTarget } from '../../../packages/model-api/types';

interface Hooks { snapshot(): AppState; update(fn: (state: AppState) => void): Promise<unknown>; busy(id: string): boolean; open(url: string): Promise<void> }
interface SavedReset { plan: ResetPlan; submitted: boolean; receipt?: ResetReceipt }
const terminal = (job: AccountLogin) => ['complete', 'cancelled', 'failed'].includes(job.status);
/** Public metadata service. Native credential contents never cross this boundary. */
export class LocalModelAccounts {
  readonly access = new AccountAccessRegistry();
  private jobs = new Map<string, LoginHandle>(); private operations = new Set<string>(); private stopped = false;
  private operationTasks = new Set<Promise<unknown>>();
  private drafts = new Map<string,LocalModelAccount>();
  private transport?: NativeAccountTransport;
  constructor(private directory: string, private cli: LocalCliService | undefined, private hooks: Hooks, transport?: NativeAccountTransport) {
    this.transport = transport ?? (cli ? new OfficialAccountTransport(directory, cli) : undefined);
    for (const [provider,id,label,description] of [
      ['codex','desktop','官方客户端','在独立的 Codex 桌面窗口中完成官方登录。'],
      ['codex','browser','OAuth 授权','在浏览器中授权；支持复制链接和手动粘贴回调地址。'],
      ['codex','device','设备码授权','在官方页面输入设备码；无需本机回调端口。'],
      ['claude','browser','Claude 订阅','使用 Claude 原生订阅登录。'],
      ['claude','sso','组织 SSO','使用 Claude 原生组织 SSO 登录。'],
      ['claude','console','Console 账号','使用 Claude Console 登录与 API 账单。'],
    ] as const) this.access.registerLogin('core',{id,provider,label,description,availability:async()=>id==='desktop'?{available:!!await this.transport?.desktopAvailable?.(),reason:'LOCAL_ACCOUNT_DESKTOP_MISSING'}:{available:!!this.transport,reason:this.transport?undefined:'LOCAL_ACCOUNT_RUNTIME_MISSING'},start:(account,changed)=>this.native().login(account,id,changed)});
    for(const [id,label] of [['auto','自动识别'],['auth-json','auth.json'],['agent-identity','Agent Identity'],['account-json','账号 JSON'],['sub2api','Sub2API JSON'],['cpa','CPA JSON'],['access-token','accessToken'],['personal-access-token','个人访问令牌 at-…'],['refresh-token','refresh_token']])this.access.registerImporter('core',{id:id!,label:label!,description:'导入到独立 Codex 原生账号目录；凭据不进入公开状态。',parse:contents=>parseCodexCredentials(contents,id)});
  }
  account(id: unknown) { const account = this.hooks.snapshot().localModelAccounts?.find(a => a.id === id) ?? (typeof id==='string'?this.drafts.get(id):undefined); if (!account) throw Error('LOCAL_ACCOUNT_NOT_FOUND'); return account; }
  private native() { if (this.stopped) throw Error('LOCAL_ACCOUNTS_DISPOSED'); if (!this.transport) throw Error('LOCAL_ACCOUNT_RUNTIME_MISSING'); return this.transport; }
  busy(id?: string) { return id ? this.operations.has(id) || [...this.jobs.values()].some(h => h.job.accountId === id && !terminal(h.job)) : !!this.operations.size || [...this.jobs.values()].some(h => !terminal(h.job)); }
  private authenticating(id:string){return [...this.jobs.values()].some(h=>h.job.accountId===id&&!terminal(h.job));}
  private assertIdle(id: string) { if (this.hooks.busy(id) || this.busy(id)) throw Error('LOCAL_ACCOUNT_BUSY'); }
  private async lock<T>(id: string, run: () => Promise<T>) { if (this.operations.has(id)) throw Error('LOCAL_ACCOUNT_BUSY'); this.operations.add(id); const task=Promise.resolve().then(run);this.operationTasks.add(task);try { return await task; } finally { this.operations.delete(id);this.operationTasks.delete(task); } }
  selection(id: string, value: unknown): NativeModelSelection { return validateModelSelection(value, this.account(id).models); }
  targets(): ModelTarget[] { return (this.hooks.snapshot().localModelAccounts ?? []).filter(a => a.enabled).flatMap(a => a.models.map(m => ({ id: `account/${a.id}/${encodeURIComponent(m.model)}`, name: m.name, description: a.name + ' · 官方账号', runtime: a.provider, ready: a.status === 'authenticated' && !this.busy(a.id), binding: { runtime: a.provider, provider: a.provider === 'codex' ? 'openai' : 'anthropic', accountRef: localAccountRef(a.id), localAccountId: a.id, executionId: 'local-device', egress: 'runtime-managed' }, selection: { model: m.model, ...(m.defaultEffort ? { effort: m.defaultEffort } : {}) }, contextWindow: m.contextWindow }))); }
  execution(session: Session) {
    if(!officialAccountBinding(session.binding))throw Error('LOCAL_ACCOUNT_UNAVAILABLE');
    const account = this.account(session.binding.localAccountId);
    if (!account.enabled || account.status !== 'authenticated' || account.provider !== session.binding.runtime || session.binding.accountRef !== localAccountRef(account.id) || session.binding.hostId || session.binding.modelConnectionId || session.binding.modelMappingId || session.binding.egress !== 'runtime-managed' || session.binding.provider !== (account.provider==='codex'?'openai':'anthropic') || this.authenticating(account.id)) throw Error('LOCAL_ACCOUNT_UNAVAILABLE');
    const selection = this.selection(account.id, session.modelSelection), model = account.models.find(m => m.model === selection.model)!;
    if (!this.cli || this.cli.isMaintaining()) throw Error('LOCAL_ACCOUNT_RUNTIME_BUSY');
    return { account, model: { id: model.id, model: model.model, name: model.name, enabled: true, efforts: model.efforts, defaultEffort: model.defaultEffort, contextWindow: model.contextWindow }, env: accountEnvironment(this.cli.env, this.directory, account).env };
  }
  async observeQuota(id: string, usage: AccountUsage) { await this.hooks.update(s => { const account = s.localModelAccounts?.find(a => a.id === id); if (!account || usage.accountId !== id || account.usage && account.usage.observedAt > usage.observedAt) return; account.cycle = quotaCycle(account, usage); account.usage = usage; }); }
  async refresh(id: string, assertCurrent: () => void = () => {}) {
    const account = this.account(id);
    return this.lock(id, async () => {
      const result = await this.native().inspect(account);
      if (this.stopped) throw Error('LOCAL_ACCOUNTS_DISPOSED');
      assertCurrent();
      if(this.drafts.has(id)){
        const draft=this.drafts.get(id)!;
        if(draft.revision!==account.revision)throw Error('LOCAL_ACCOUNT_CHANGED');
        Object.assign(draft,result,{observedAt:new Date().toISOString()});
        if(result.status!=='authenticated'||!result.models.length){draft.status='unknown';return {...draft};}
        if(!result.email){draft.status='unknown';throw Error('LOCAL_ACCOUNT_EMAIL_UNAVAILABLE');}
        const promoted={...draft,name:result.email,status:'authenticated' as const,revision:randomUUID()};
        await this.hooks.update(state=>{assertCurrent();if(!this.drafts.has(id)||this.stopped)throw Error('LOCAL_ACCOUNT_CHANGED');state.localModelAccounts??=[];if(state.localModelAccounts.length>=100)throw Error('LOCAL_ACCOUNT_LIMIT');state.localModelAccounts.push(promoted);});
        this.drafts.delete(id);return this.account(id);
      }
      if (account.email && result.email && account.email !== result.email) {
        await this.hooks.update(s => { const current = s.localModelAccounts?.find(a => a.id === id); if (current && current.revision === account.revision) { current.status = 'unknown'; current.models = []; } });
        throw Error('LOCAL_ACCOUNT_IDENTITY_CHANGED');
      }
      await this.hooks.update(s => { const current = s.localModelAccounts?.find(a => a.id === id); if (!current || current.revision !== account.revision) throw Error('LOCAL_ACCOUNT_CHANGED'); if (result.usage) current.cycle = quotaCycle(current, result.usage); Object.assign(current, result, { observedAt: new Date().toISOString() }); });
      return this.account(id);
    });
  }
  private async resetFile(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('LOCAL_ACCOUNT_ID_INVALID'); const folder = path.join(this.directory, 'account-resets'); await noLinks(folder); await mkdir(folder, { recursive: true, mode: 0o700 }); const file=path.join(folder, id + '.json');await noLinks(file);return file; }
  private async savedReset(id: string): Promise<SavedReset | undefined> { try { const raw=await textFile(await this.resetFile(id),16384);const v=JSON.parse(raw) as SavedReset;if(!v||typeof v.submitted!=='boolean'||v.plan?.accountId!==id||!/^[a-f0-9-]{36}$/.test(v.plan?.id??'')||!Number.isFinite(Date.parse(v.plan?.expiresAt))||v.receipt&&(v.receipt.id!==v.plan.id||v.receipt.accountId!==id||!['redeemed','denied','uncertain'].includes(v.receipt.state)))throw Error('LOCAL_ACCOUNT_RESET_INVALID');return v; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; } }
  private async saveReset(id: string, value: SavedReset) { await atomicWrite(await this.resetFile(id),JSON.stringify(value)); }
  private async importCredentials(account: LocalModelAccount, p: Record<string, any>) {
    this.assertIdle(account.id);
    if(account.provider!=='codex'||account.status==='authenticated')throw Error('LOCAL_ACCOUNT_IMPORT_TARGET_INVALID');
    if(account.revision!==p.revision)throw Error('LOCAL_ACCOUNT_CHANGED');
    if(typeof p.contents!=='string'||Buffer.byteLength(p.contents)>2*1024*1024)throw Error('LOCAL_ACCOUNT_IMPORT_SIZE');
    return this.lock(account.id,async()=>{
      const parsed=await this.access.parse(p.format??'auto',p.contents);
      if(!Array.isArray(parsed.records)||!parsed.records.length||parsed.records.length>100)throw Error('LOCAL_ACCOUNT_IMPORT_INVALID');
      if((this.hooks.snapshot().localModelAccounts?.length??0)+this.drafts.size+parsed.records.length-1>100)throw Error('LOCAL_ACCOUNT_LIMIT');
      // Validate the entire batch before any network or disk mutation.
      const records=parseCodexCredentials(JSON.stringify(parsed.records.map(row=>row.auth??{refresh_token:row.refreshToken})));
      const accounts=records.map((_,i)=>i===0?{...account}:({id:randomUUID(),revision:randomUUID(),provider:'codex',name:parsed.records[i]?.name??account.name+' · '+(i+1),enabled:true,status:'unknown',models:[]} as LocalModelAccount));
      const completed:LocalModelAccount[]=[];
      const wasDraft=this.drafts.has(account.id);
      let failure:string|undefined;
      try {
        for(let i=0;i<records.length;i++){
          parsed.assertActive();if(this.stopped)throw Error('LOCAL_ACCOUNTS_DISPOSED');
          const folder=accountEnvironment({},this.directory,accounts[i]!).env.CODEX_HOME!,file=path.join(folder,'auth.json');
          await noLinks(file);await mkdir(folder,{recursive:true,mode:0o700});
          let handle;try{handle=await open(file,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('LOCAL_ACCOUNT_IMPORT_EXISTS');throw Error('LOCAL_ACCOUNT_IMPORT_WRITE_FAILED');}
          let contents='';try{
            const auth=await resolveCodexCredential(records[i]!,fetch,parsed.signal);contents=JSON.stringify(auth);
            // A successful exchange can rotate its source token. Persist that result
            // even when disposal races the response; never roll it back with a batch.
            await handle.writeFile(contents);await handle.sync();
          }finally{await handle.close();if(!contents)try{if(await readFile(file,'utf8')==='')await rm(file);}catch{/* Only the exclusively created empty file is disposable. */}}
          if(await readFile(file,'utf8')!==contents)throw Error('LOCAL_ACCOUNT_IMPORT_WRITE_FAILED');
          accounts[i]!.status='unknown';accounts[i]!.models=[];
          completed.push(accounts[i]!);
        }
      } catch(error) {
        const message=(error as Error).message;failure=/^LOCAL_ACCOUNT[A-Z_]*$/.test(message)?message:'LOCAL_ACCOUNT_IMPORT_FAILED';
      }
      if(!completed.length)throw Error(failure??'LOCAL_ACCOUNT_IMPORT_FAILED');
      if(this.stopped)throw Error('LOCAL_ACCOUNTS_DISPOSED');
      if(wasDraft){if(!this.drafts.has(account.id))throw Error('LOCAL_ACCOUNT_CHANGED');for(const next of completed)this.drafts.set(next.id,next);}
      else {await this.hooks.update(state=>{const current=state.localModelAccounts?.find(a=>a.id===account.id);if(!current||current.revision!==p.revision||current.status==='authenticated')throw Error('LOCAL_ACCOUNT_CHANGED');Object.assign(current,{status:'unknown',models:[],revision:randomUUID()});});for(const next of completed.slice(1))this.drafts.set(next.id,next);}
      return {imported:completed.length,accounts:completed.map(a=>this.account(a.id)),verification:'pending' as const,...(failure?{failure,remaining:records.length-completed.length}:{})};
    });
  }
  async call(method: string, p: Record<string, any>): Promise<unknown> {
    if (this.stopped) throw Error('LOCAL_ACCOUNTS_DISPOSED');
    if (method === 'models/accounts/list') return this.hooks.snapshot().localModelAccounts ?? [];
    if (method === 'models/accounts/prepare') {
      if(!['codex','claude'].includes(p.provider))throw Error('LOCAL_ACCOUNT_INVALID');
      if(this.drafts.size+(this.hooks.snapshot().localModelAccounts?.length??0)>=100)throw Error('LOCAL_ACCOUNT_LIMIT');
      const draft:LocalModelAccount={id:randomUUID(),revision:randomUUID(),provider:p.provider,name:p.provider==='codex'?'Codex 新账号':'Claude 新账号',enabled:true,status:'signed-out',models:[]};this.drafts.set(draft.id,draft);return {...draft};
    }
    if (method === 'models/accounts/draft-discard') {
      if(typeof p.id!=='string'||!this.drafts.has(p.id))return {discarded:false};
      const draft=this.drafts.get(p.id)!;
      for(const handle of this.jobs.values())if(handle.job.accountId===p.id&&!terminal(handle.job))await handle.cancel();
      // Native credentials may already have been issued/rotated. Dropping a UI
      // draft must not destroy that native result; only the public card is absent.
      this.drafts.delete(draft.id);return {discarded:true};
    }
    if (method === 'models/usage') return modelUsageSummary(this.hooks.snapshot(), p.scope, p.period);
    if (method === 'models/pricing/save') {
      const scope = p.scope as UsageScope, price = validatePrice(p.price);
      if (!scope || !['api', 'account', 'translation'].includes(scope.kind) || scope.kind==='translation'&&scope.id!=='translation' || typeof scope.id !== 'string' || typeof p.model !== 'string' || !p.model || p.model.length > 256 || /[\x00-\x1f]/.test(p.model)) throw Error('MODEL_PRICE_INVALID');
      await this.hooks.update(s => { if (scope.kind === 'api' ? !s.modelConnections?.some(c => c.id === scope.id) : scope.kind==='account'&&!s.localModelAccounts?.some(a => a.id === scope.id)&&!Object.values(s.accountCatalogs??{}).some(c=>c.source==='native-owner'&&c.accounts.some(a=>sharedAccountRef(c,a)===scope.id))) throw Error('MODEL_SOURCE_NOT_FOUND'); s.modelPrices ??= []; const old = s.modelPrices.find(r => r.scope.kind === scope.kind && r.scope.id === scope.id && r.model === p.model); if (old?.revision !== p.revision) throw Error('MODEL_PRICE_CHANGED'); const value = { scope: {kind:scope.kind,id:scope.id}, model:p.model,price,revision:randomUUID(),updatedAt:new Date().toISOString() }; if (old) Object.assign(old,value); else s.modelPrices.push(value); });
      return this.hooks.snapshot().modelPrices?.find(r => r.scope.kind === scope.kind && r.scope.id === scope.id && r.model === p.model);
    }
    if (method === 'models/accounts/create') {
      if (!['codex', 'claude'].includes(p.provider) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || /[\x00-\x1f]/.test(p.name)) throw Error('LOCAL_ACCOUNT_INVALID');
      const account: LocalModelAccount = { id: randomUUID(), revision: randomUUID(), provider: p.provider, name: p.name.trim(), enabled: true, status: 'signed-out', models: [] };
      await this.hooks.update(s => { s.localModelAccounts ??= []; if (s.localModelAccounts.length >= 100) throw Error('LOCAL_ACCOUNT_LIMIT'); s.localModelAccounts.push(account); }); return account;
    }
    const account = this.account(p.id);
    if (method === 'models/accounts/rename') {
      if(this.drafts.has(account.id)||typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>100||/[\x00-\x1f]/.test(p.name))throw Error('LOCAL_ACCOUNT_NAME_INVALID');
      await this.hooks.update(state=>{const current=state.localModelAccounts?.find(a=>a.id===account.id);if(!current||current.revision!==p.revision)throw Error('LOCAL_ACCOUNT_CHANGED');current.name=p.name.trim();current.revision=randomUUID();});return this.account(account.id);
    }
    if (method === 'models/accounts/login-methods') return this.access.methods(account);
    if (method === 'models/accounts/import-formats') return account.provider==='codex'?this.access.formats():[];
    if (method === 'models/accounts/import') return this.importCredentials(account,p);
    if (method === 'models/accounts/refresh') { if ([...this.jobs.values()].some(j => j.job.accountId === account.id && j.job.status === 'waiting')) throw Error('LOCAL_ACCOUNT_LOGIN_PENDING'); return this.refresh(account.id); }
    if (method === 'models/accounts/set-enabled' || method === 'models/accounts/remove') {
      this.assertIdle(account.id); if (p.revision !== account.revision) throw Error('LOCAL_ACCOUNT_CHANGED');
      if (method.endsWith('/set-enabled') && typeof p.enabled !== 'boolean' || method.endsWith('/remove') && p.confirm !== true) throw Error('LOCAL_ACCOUNT_CONFIRM_REQUIRED');
      await this.hooks.update(s => { this.assertIdle(account.id); const current = s.localModelAccounts?.find(a => a.id === account.id); if (!current || current.revision !== p.revision) throw Error('LOCAL_ACCOUNT_CHANGED'); if (method.endsWith('/remove')) s.localModelAccounts = s.localModelAccounts!.filter(a => a.id !== account.id); else { current.enabled = p.enabled; current.revision = randomUUID(); } });
      // Removing the workbench entry never erases native credentials or history.
      return method.endsWith('/remove') ? { removed: account.id } : this.account(account.id);
    }
    if (method === 'models/accounts/login-start') {
      this.assertIdle(account.id); if (p.revision !== account.revision) throw Error('LOCAL_ACCOUNT_CHANGED');
      const wasDraft=this.drafts.has(account.id);
      if (account.status === 'authenticated') throw Error('LOCAL_ACCOUNT_ALREADY_AUTHENTICATED');
      for(const [id,handle]of this.jobs)if(terminal(handle.job)&&(Date.parse(handle.job.expiresAt)<Date.now()||this.jobs.size>=200))this.jobs.delete(id);
      if(this.jobs.size>=200)throw Error('LOCAL_ACCOUNT_LOGIN_LIMIT');
      return this.lock(account.id, async () => {
        const handle = await this.access.start(account,p.method as LoginMethod,job=>{const current=this.jobs.get(job.id);if(current)current.job=job;});
        if(this.stopped||wasDraft&&!this.drafts.has(account.id)){await handle.cancel();throw Error(this.stopped?'LOCAL_ACCOUNTS_DISPOSED':'LOCAL_ACCOUNT_CHANGED');}this.jobs.set(handle.job.id,handle);
        if(account.provider==='codex'&&handle.job.url&&handle.job.status==='waiting')try{await this.hooks.open(handle.job.url);}catch{handle.job.browserError='LOCAL_ACCOUNT_BROWSER_UNAVAILABLE';}
        return {...handle.job};
      });
    }
    if (method === 'models/accounts/login-status' || method === 'models/accounts/login-cancel' || method === 'models/accounts/login-open' || method === 'models/accounts/login-code' || method === 'models/accounts/login-callback') {
      const handle = this.jobs.get(p.jobId); if (!handle || handle.job.accountId !== account.id) throw Error('LOCAL_ACCOUNT_LOGIN_NOT_FOUND');
      if (!terminal(handle.job) && Date.parse(handle.job.expiresAt) <= Date.now()) { await handle.cancel(); handle.job.status = 'failed'; handle.job.error = 'LOCAL_ACCOUNT_LOGIN_EXPIRED'; }
      if (method.endsWith('/login-cancel')) { await handle.cancel(); return { ...handle.job }; }
      if (method.endsWith('/login-callback')) { if(terminal(handle.job)||!handle.submitCallback||!handle.job.callbackSupported)throw Error('LOCAL_ACCOUNT_CALLBACK_UNAVAILABLE');await handle.submitCallback(p.url);return {...handle.job}; }
      if(method.endsWith('/login-code')){if(account.provider!=='claude'||terminal(handle.job)||!handle.job.codeRequested||!handle.submitCode)throw Error('LOCAL_ACCOUNT_CODE_NOT_REQUESTED');await handle.submitCode(p.code);return {...handle.job};}
      if (method.endsWith('/login-open')) { if (terminal(handle.job) || !handle.job.url) throw Error('LOCAL_ACCOUNT_LOGIN_NOT_WAITING'); await this.hooks.open(handle.job.url); delete handle.job.browserError; return { opened: true }; }
      if (handle.job.status === 'verifying'&&!this.operations.has(account.id)) { try { const current = await this.refresh(account.id,()=>{if(handle.job.status!=='verifying')throw Error('LOCAL_ACCOUNT_LOGIN_CANCELLED');}); if (current.status !== 'authenticated'||!current.models.length) throw Error('LOCAL_ACCOUNT_LOGIN_UNVERIFIED'); if (handle.job.status === 'verifying') handle.job.status = 'complete'; } catch { if (handle.job.status === 'verifying') { handle.job.status = 'failed'; handle.job.error = 'LOCAL_ACCOUNT_LOGIN_UNVERIFIED'; } } delete handle.job.url; delete handle.job.userCode; }
      return { ...handle.job };
    }
    if (method === 'models/accounts/reset-preview') {
      this.assertIdle(account.id);
      return this.lock(account.id, async () => { const pending = await this.savedReset(account.id); if (pending?.submitted && (!pending.receipt || pending.receipt.state === 'uncertain')) throw Error('LOCAL_ACCOUNT_RESET_PENDING'); const usage = account.usage, card = usage?.cards.find(c => c.key === p.cardKey); if (account.provider !== 'codex' || !usage || Date.now() - Date.parse(usage.observedAt) > 120000 || !card?.available || card.expiresAt && card.expiresAt * 1000 <= Date.now()) throw Error('LOCAL_ACCOUNT_RESET_REFRESH_REQUIRED'); const plan: ResetPlan = { id: randomUUID(), accountId: account.id, cardType: card.type, creditId: card.creditId, remaining: usage.availableResetCount ?? card.count, title: card.title, expiresAt: new Date(Date.now() + 120000).toISOString() }; await this.saveReset(account.id, { plan, submitted: false }); return plan; });
    }
    if (method === 'models/accounts/reset-status') { const saved = await this.savedReset(account.id); return saved?.submitted ? saved.receipt ?? { id: saved.plan.id, accountId: account.id, cardType: saved.plan.cardType, state: 'uncertain', message: '兑换结果尚未确认，请使用原请求核对。' } : null; }
    if (method === 'models/accounts/reset-redeem') {
      this.assertIdle(account.id); if (p.confirm !== true) throw Error('LOCAL_ACCOUNT_CONFIRM_REQUIRED');
      const receipt=await this.lock(account.id, async () => { const saved = await this.savedReset(account.id); if (!saved || saved.plan.id !== p.planId || saved.plan.accountId !== account.id || account.provider !== 'codex') throw Error('LOCAL_ACCOUNT_RESET_INVALID'); if (saved.receipt && saved.receipt.state !== 'uncertain') return saved.receipt; if (!saved.submitted && Date.parse(saved.plan.expiresAt) <= Date.now()) throw Error('LOCAL_ACCOUNT_RESET_EXPIRED'); saved.submitted = true; await this.saveReset(account.id, saved); let outcome = 'uncertain'; try { outcome = await this.native().consume(account, saved.plan.id, saved.plan.creditId); } catch { /* Preserve the same durable idempotency key after an unknown result. */ } const successful = ['reset', 'alreadyRedeemed'].includes(outcome), denied = ['nothingToReset', 'noCredit'].includes(outcome); saved.receipt = { id: saved.plan.id, accountId: account.id, cardType: saved.plan.cardType, state: successful ? 'redeemed' : denied ? 'denied' : 'uncertain', message: successful ? '官方已确认兑换，未重复消费。' : outcome === 'nothingToReset' ? '当前没有需要重置的窗口，未消费卡片。' : outcome === 'noCredit' ? '当前没有可用重置卡。' : '兑换结果未知。请使用原请求核对，不要新建兑换。' }; await this.saveReset(account.id, saved); if (successful) await this.hooks.update(s => { const current = s.localModelAccounts?.find(a => a.id === account.id); if (current) { delete current.usage; delete current.cycle; } }); return saved.receipt; });
      if(receipt.state==='redeemed')await this.refresh(account.id).catch(()=>{});
      return receipt;
    }
    throw Error('LOCAL_ACCOUNT_OPERATION_UNKNOWN');
  }
  async dispose() { this.stopped = true; await this.access.dispose();await Promise.allSettled([...this.jobs.values()].filter(h => !terminal(h.job)).map(h => h.cancel()));await Promise.allSettled([...this.operationTasks]); await this.transport?.dispose();this.drafts.clear(); }
}
