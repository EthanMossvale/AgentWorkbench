import type { AccountImportFormat, AccountLoginMethod, LocalModelAccount, LoginMethod } from './types';
import type { LoginHandle } from './native';
import type { CodexCredential } from './credentials';
import {redactDiagnostic} from '../diagnostics';

export interface AccountLoginRegistration { id: string; provider: 'codex' | 'claude'; label: string; description: string; availability?(account: LocalModelAccount): Promise<{ available: boolean; reason?: string }>; start(account: LocalModelAccount, changed: (job: LoginHandle['job']) => void): Promise<LoginHandle> }
export interface AccountImporterRegistration extends AccountImportFormat { parse(contents: string): CodexCredential[] | Promise<CodexCredential[]> }
export interface AccountAccessHandle { id: string; dispose(): Promise<void> }
export interface ParsedAccountCredentials { records: CodexCredential[]; signal: AbortSignal; assertActive(): void }
export interface AccountAccessService {
  registerLogin(owner:string,definition:AccountLoginRegistration):AccountAccessHandle;
  registerImporter(owner:string,definition:AccountImporterRegistration):AccountAccessHandle;
  methods(account:LocalModelAccount):Promise<AccountLoginMethod[]>;
  formats():AccountImportFormat[];
  start(account:LocalModelAccount,method:string,changed:(job:LoginHandle['job'])=>void):Promise<LoginHandle>;
  parse(format:string,contents:string):Promise<ParsedAccountCredentials>;
  subscribe(listener:()=>void):()=>void;
  dispose():Promise<void>;
}
interface Entry<T> { value: T; live: boolean; handles: Set<LoginHandle>; abort: AbortController }
const label = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && !/[\x00-\x1f]/.test(v);
/** The same production directory powers discovery, execution and plugin disposal. */
export class AccountAccessRegistry implements AccountAccessService {
  private logins = new Map<string, Entry<AccountLoginRegistration>>();
  private importers = new Map<string, Entry<AccountImporterRegistration>>();
  private listeners = new Set<() => void>();
  private closed = false;
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  private add<T extends { id: string; label: string; description: string }>(map: Map<string, Entry<T>>, owner: string, input: T, prefix = ''): AccountAccessHandle {
    if (this.closed || !/^(core|[a-z][a-z0-9.-]{1,79})$/.test(owner) || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id) || !label(input.label,100) || !label(input.description,500)) throw Error('LOCAL_ACCOUNT_EXTENSION_INVALID');
    const id = owner === 'core' ? input.id : `${owner}:${input.id}`;
    const key = prefix + id;
    if (map.has(key)) throw Error('LOCAL_ACCOUNT_EXTENSION_DUPLICATE');
    const entry = { value: { ...input, id }, live: true, handles: new Set<LoginHandle>(), abort: new AbortController() };
    map.set(key, entry); this.changed();
    return { id, dispose: async () => { if (!entry.live) return; entry.live = false; entry.abort.abort(); map.delete(key); this.changed(); const results=await Promise.allSettled([...entry.handles].filter(h=>['waiting','verifying'].includes(h.job.status)).map(h => h.cancel())); entry.handles.clear();if(results.some(r=>r.status==='rejected'))throw Error('LOCAL_ACCOUNT_EXTENSION_CLEANUP_FAILED'); } };
  }
  registerLogin(owner: string, definition: AccountLoginRegistration) { if (!definition || !['codex','claude'].includes(definition.provider) || typeof definition.start !== 'function') throw Error('LOCAL_ACCOUNT_EXTENSION_INVALID'); return this.add(this.logins, owner, definition, definition.provider + '/'); }
  registerImporter(owner: string, definition: AccountImporterRegistration) { if (!definition || typeof definition.parse !== 'function') throw Error('LOCAL_ACCOUNT_EXTENSION_INVALID'); return this.add(this.importers, owner, definition); }
  async methods(account: LocalModelAccount): Promise<AccountLoginMethod[]> {
    return (await Promise.all([...this.logins.values()].filter(e => e.value.provider === account.provider).map(async e => {
      const d = e.value; let status = { available: true } as { available: boolean; reason?: string };
      try { status = await d.availability?.(account) ?? status; } catch(error) { status = { available: false, reason: redactDiagnostic(error instanceof Error?error.message:String(error)) }; }
      return e.live ? { id: d.id as LoginMethod, label: d.label, description: d.description, ...status } : undefined;
    }))).filter((v): v is AccountLoginMethod => !!v);
  }
  formats(): AccountImportFormat[] { return [...this.importers.values()].map(({value:{id,label,description}}) => ({id,label,description})); }
  async start(account: LocalModelAccount, method: string, changed: (job: LoginHandle['job']) => void) {
    const entry = this.logins.get(account.provider + '/' + method); if (!entry || !entry.live || entry.value.provider !== account.provider) throw Error('LOCAL_ACCOUNT_METHOD_UNAVAILABLE');
    if (entry.value.availability) {const status=await entry.value.availability(account);if(!status.available)throw Error(status.reason?redactDiagnostic(status.reason):'LOCAL_ACCOUNT_METHOD_UNAVAILABLE');}
    if (!entry.live) throw Error('LOCAL_ACCOUNT_METHOD_UNAVAILABLE');
    for(const existing of entry.handles)if(!['waiting','verifying'].includes(existing.job.status))entry.handles.delete(existing);
    let handle:LoginHandle|undefined;
    handle = await entry.value.start(account, job => { if(handle){handle.job=job;if(!['waiting','verifying'].includes(job.status))entry.handles.delete(handle);}if (entry.live) changed(job); });
    if (!entry.live) { await handle.cancel(); throw Error('LOCAL_ACCOUNT_METHOD_UNAVAILABLE'); }
    const current=handle,cancel = current.cancel.bind(current);let cancelling:Promise<void>|undefined;
    current.cancel = () => cancelling??=(async()=>{let failed=false;try { if(['waiting','verifying'].includes(current.job.status))await cancel(); } catch {failed=true;throw Error('LOCAL_ACCOUNT_EXTENSION_CLEANUP_FAILED');} finally { if(['waiting','verifying'].includes(current.job.status)){current.job={...current.job,status:failed?'failed':'cancelled',...(failed?{error:'LOCAL_ACCOUNT_EXTENSION_CLEANUP_FAILED'}:{})};delete current.job.url;delete current.job.userCode;delete current.job.callbackSupported;delete current.job.codeRequested;changed({...current.job});}entry.handles.delete(current); }})();
    if(['waiting','verifying'].includes(current.job.status))entry.handles.add(current); return current;
  }
  async parse(format: string, contents: string) {
    const entry = this.importers.get(format); if (!entry || !entry.live) throw Error('LOCAL_ACCOUNT_IMPORT_FORMAT_UNAVAILABLE');
    const records = await entry.value.parse(contents);
    if (!entry.live) throw Error('LOCAL_ACCOUNT_IMPORT_FORMAT_UNAVAILABLE');
    return { records, signal: entry.abort.signal, assertActive: () => { if (!entry.live) throw Error('LOCAL_ACCOUNT_IMPORT_FORMAT_UNAVAILABLE'); } };
  }
  async dispose() { this.closed = true; for (const entry of [...this.logins.values(),...this.importers.values()]) { entry.live = false; entry.abort.abort(); await Promise.allSettled([...entry.handles].map(h => h.cancel())); } this.logins.clear(); this.importers.clear(); this.changed(); this.listeners.clear(); }
}
