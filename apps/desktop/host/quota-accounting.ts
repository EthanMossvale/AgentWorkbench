import {mkdir, readFile, writeFile, rename, readdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import type {AccountCatalog, AppState, Session, SshHost} from '../../../packages/contracts';
import type {NativeCodexHandle} from '../../../services/codex-bridge';
import type {AccountUsage} from '../../../packages/account-usage/types';
import {parseQuotaLedger, type QuotaLedgerView} from '../../../packages/account-usage/ledger';
import {sharedAccountRef} from '../../../packages/account-selection';
import {MemberQuotaControl} from '../../../packages/workspace-control/member-quota';
import {RemoteWorkspaceControl, workspaceHostIdentity} from '../../../packages/workspace-control';
import {quotaHistory, quotaScope} from './quota-history';

interface Bound {host: SshHost; workspaceId?: string; accountId: string; accountGeneration: string; accountRuntime: 'existing-codex'|'native-owner'; scope: string; threadId: string; active: boolean; turnTokens?: number; observed?: {totalTokens: number; lastTokens: number}}
interface Observation {window: 'weekly' | 'fiveHour'; usedPercent: number; resetsAt: number}
const record = (v: any): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
export function nativeQuotaWindows(value: unknown): Observation[] {
  const raw = record(value), pool = record(record(raw.rateLimitsByLimitId).codex ?? raw.rateLimits);
  return [pool.primary, pool.secondary].flatMap(w => {
    if (!w || ![300,10080].includes(w.windowDurationMins) || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100 || typeof w.resetsAt !== 'number' || !Number.isFinite(w.resetsAt)) return [];
    return [{window: w.windowDurationMins === 300 ? 'fiveHour' : 'weekly', usedPercent: w.usedPercent, resetsAt: w.resetsAt} as Observation];
  });
}
/** Numeric telemetry comes only from the already authenticated native runner.
 * There is no renderer API for observations or loans. Durable retries preserve
 * the same cumulative scope; the remote shared ledger performs deduplication. */
export class NativeQuotaAccounting {
  private bindings = new Map<string, Bound>();
  private queue: Promise<unknown> = Promise.resolve();
  private journal: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private state: () => AppState, private remote = new RemoteWorkspaceControl(), private member = new MemberQuotaControl()) {}
  private identity(session: Session) {
    const state = this.state(), hostId = session.binding.hostId;
    if (!hostId) return;
    const member = state.hosts.find(h => h.id === hostId);
    const catalog = state.accountCatalogs?.[hostId];
    // A newly available central directory must not silently migrate old sessions
    // or replace the account used by their quota journal.
    const source = session.binding.accountRuntime ?? 'existing-codex';
    if(source!=='native-owner'||!member||!catalog||(catalog.source??'existing-codex')!==source)return;
    const account = catalog.accounts.find(a => sharedAccountRef(catalog, a) === session.binding.accountRef);
    const admin = state.hosts.find(h => h.role === 'admin' && h.ownerId === member.ownerId && h.hostname.toLowerCase() === member.hostname.toLowerCase() && h.port === member.port && h.knownHostsFile === member.knownHostsFile);
    return account && {member, account, admin};
  }
  private send(host: SshHost, method: 'quota/observe' | 'quota/read' | 'quota/check', params: Record<string, unknown>, source:'existing-codex'|'native-owner'='existing-codex') {
    return host.role === 'workspace' ? this.member.request(host, method, method === 'quota/observe' && Object.hasOwn(record(params.payload), 'windows') ? {...params, refresh: true, accountRuntime:source} : params) : this.remote.quota(host, method, params);
  }
  private journalJob<T>(run: () => Promise<T>): Promise<T> {
    const job = this.journal.then(run);
    this.journal = job.catch(() => {});
    return job;
  }
  private acknowledge(target: string, content: string) {
    return this.journalJob(async () => {
      try {if (await readFile(target, 'utf8') === content) await unlink(target);}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    });
  }
  private async retry(host: SshHost) {
    const folder = path.join(this.directory, 'quota-outbox');
    let files: string[]; try {files = await readdir(folder);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error;}
    for (const file of files.filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      const target = path.join(folder, file);
      const content = await this.journalJob(() => readFile(target, 'utf8'));
      const saved = JSON.parse(content);
      if (saved.hostIdentity !== workspaceHostIdentity(host)) continue;
      // Recovered token totals are safe to deduplicate; stale official windows
      // must be reread, not replayed as fresh quota observations.
      const {windows: _windows, ...payload} = saved.payload;
      await this.send(host, 'quota/observe', {payload});
      await this.acknowledge(target, content);
    }
  }
  async begin(session: Session, handle: Pick<NativeCodexHandle,'threadId'>) {
    const identity = this.identity(session);
    if (!identity) {this.bindings.delete(session.id);return;}
    const bound: Bound = {host: structuredClone(identity.member), accountId: identity.account.id, accountGeneration: identity.account.generation, accountRuntime:session.binding.accountRuntime??'existing-codex', threadId: handle.threadId, active: true, scope: quotaScope(session,handle.threadId)};
    const previous = this.bindings.get(session.id);
    if (previous?.scope === bound.scope) bound.observed = previous.observed;
    this.bindings.set(session.id, bound);
    // Accounting is advisory. Native execution owns authorization and provider
    // limits; neither a stalled ledger nor its estimates may gate a model turn.
    this.queue = this.queue.then(async () => {
      if (identity.admin) await this.remote.list(identity.admin);
      await this.retry(bound.host);
      await this.send(bound.host, 'quota/observe', {payload: {accountId: bound.accountId, accountGeneration: bound.accountGeneration, scope: bound.scope, phase: 'begin', windows: []}}, bound.accountRuntime);
    }).catch(() => {});
  }
  observe(sessionId: string, usage: unknown) {
    const bound = this.bindings.get(sessionId), value = record(usage), total = record(value.total).totalTokens, last = record(value.last).totalTokens;
    if (bound?.active && Number.isSafeInteger(total) && Number.isSafeInteger(last) && last >= 0 && total >= last) {
      const delta = bound.observed ? Math.max(0, total - bound.observed.totalTokens) : last;
      const turnTokens: number = (bound.turnTokens ?? 0) + delta;
      bound.turnTokens = turnTokens;
      bound.observed = {totalTokens: Math.max(total, bound.observed?.totalTokens ?? 0), lastTokens: Math.min(total, turnTokens)};
    }
  }
  finish(sessionId: string, handle: Pick<NativeCodexHandle,'threadId'>) {
    const bound = this.bindings.get(sessionId);
    if (!bound?.active || bound.threadId !== handle.threadId) return Promise.resolve();
    bound.active = false;
    const value = structuredClone(bound);
    const job = this.journalJob(async () => {
      const windows: Observation[] = [];
      const payload = {accountId: value.accountId, accountGeneration: value.accountGeneration, workspaceId: value.workspaceId, scope: value.scope, phase: 'finish', ...value.observed, windows};
      const folder = path.join(this.directory, 'quota-outbox'), target = path.join(folder, value.scope + '.json');
      await mkdir(folder, {recursive: true});
      try {
        const prior = JSON.parse(await readFile(target, 'utf8')).payload;
        if (Number.isSafeInteger(prior.totalTokens) && Number.isSafeInteger(prior.lastTokens)) {
          payload.totalTokens = Math.max(payload.totalTokens ?? 0, prior.totalTokens);
          payload.lastTokens = prior.lastTokens + payload.totalTokens - prior.totalTokens;
        }
      } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
      const content = JSON.stringify({hostIdentity: workspaceHostIdentity(value.host), payload});
      await writeFile(target + '.tmp', content, {mode: 0o600}); await rename(target + '.tmp', target);
      this.queue = this.queue.then(async () => {
        await this.send(value.host, 'quota/observe', {payload},value.accountRuntime);
        await this.acknowledge(target, content);
      }).catch(() => {});
    });
    return job;
  }
  async read(host: SshHost, catalog: AccountCatalog, usage: AccountUsage, refresh=false): Promise<QuotaLedgerView | undefined> {
    // Other devices may report without changing this desktop's usage revision.
    return structuredClone(await this.readView(host,catalog,usage));
  }
  private async readView(host: SshHost, catalog: AccountCatalog, usage: AccountUsage): Promise<QuotaLedgerView | undefined> {
    if (usage.availability !== 'ready') return;
    if(host.role==='workspace'){
      const account=catalog.accounts.find(a=>a.id===usage.accountId);if(!account)return;
      const admin=this.state().hosts.find(h=>h.role==='admin'&&h.ownerId===host.ownerId&&h.hostname.toLowerCase()===host.hostname.toLowerCase()&&h.port===host.port&&h.knownHostsFile===host.knownHostsFile);
      if(admin)await this.remote.list(admin);
      const context=await this.member.request(host,'quota/context',{accountId:account.id});
      if(context.managed!==true)return;
      await this.queue;await this.retry(host);
      let raw=await this.member.request(host,'quota/read',{accountId:account.id,accountGeneration:account.generation});
      if(raw.historyVersion===1)raw=await this.send(host,'quota/observe',{payload:{accountId:account.id,accountGeneration:account.generation,windows:[]}},'native-owner');
      const history=quotaHistory(this.state(),host,sharedAccountRef(catalog,account),raw.windows?.find((w:any)=>w.window==='weekly'));
      if(raw.historyVersion===1)for(let offset=0;offset<history.length;offset+=100)raw=await this.member.request(host,'quota/observe',{payload:{accountId:account.id,accountGeneration:account.generation,workspaceId:context.workspaceId,history:history.slice(offset,offset+100)}});
      const view=parseQuotaLedger(raw,account.id);
      // Account catalogs use login names; the quota authority owns workspace IDs.
      view.currentWorkspaceId=context.workspaceId;
      if(context.allocation&&typeof context.workspaceId==='string'){
        view.allocations??={};view.allocations[context.workspaceId]={weeklyPercent:context.allocation.weeklyPercent??null,fiveHourPercent:context.allocation.fiveHourPercent??null};
        view.workspaceNames??={};view.workspaceNames[context.workspaceId]??=host.name;
      }
      return view;
    }
    const snapshot = await this.remote.list(host), account = catalog.accounts.find(a => a.id === usage.accountId);
    if (!account || snapshot.availability !== 'ready' || !snapshot.workspaces.some(w => w.status !== 'deleted' && w.accountQuotas?.[account.id])) return;
    await this.queue;
    await this.retry(host);
    for(const member of this.state().hosts.filter(h=>h.role==='workspace'&&h.ownerId===host.ownerId&&h.hostname.toLowerCase()===host.hostname.toLowerCase()&&h.port===host.port&&h.knownHostsFile===host.knownHostsFile)){
      const memberCatalog=this.state().accountCatalogs?.[member.id];
      if(memberCatalog?.authorityId!==catalog.authorityId||memberCatalog.generation!==catalog.generation||!memberCatalog.accounts.some(a=>a.id===account.id&&a.generation===account.generation))continue;
      await this.readView(member,memberCatalog,usage);
    }
    if(Date.now()-Date.parse(usage.observedAt)>60000)return parseQuotaLedger(await this.remote.quota(host,'quota/read',{accountId:account.id,accountGeneration:account.generation}),account.id);
    const pool = usage.pools.find(p => p.id === 'codex') ?? (usage.pools.length === 1 ? usage.pools[0] : undefined);
    const windows = nativeQuotaWindows({rateLimits: {primary: pool?.primary && {...pool.primary, windowDurationMins: pool.primary.windowMinutes}, secondary: pool?.secondary && {...pool.secondary, windowDurationMins: pool.secondary.windowMinutes}}});
    return parseQuotaLedger(await this.remote.quota(host, 'quota/observe', {payload: {accountId: account.id, accountGeneration: account.generation, windows}}), account.id);
  }
  async dispose() {await this.journal; await this.queue; await this.remote.dispose();}
}
