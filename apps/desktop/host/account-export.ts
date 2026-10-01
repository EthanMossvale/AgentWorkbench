import path from 'node:path';
import { noLinks, textFile, atomicWrite } from '../../../packages/native-resources/files';
import { coreAccountExportFormats, redactAccountExport } from '../../../packages/model-management/account-export-formats';
import type { LocalModelAccount } from '../../../packages/model-management/types';
import type { AccountExportDefinition, AccountExportFormatId, AccountExportRequest, AccountExportPreview, AccountExportResult, AccountExportService } from '../../../packages/model-management/account-export-types';

export interface AccountExportHooks {
  account(id: string): LocalModelAccount;
  copy(content: string): void | Promise<void>;
  pickSave?(fileName: string): Promise<string | null>;
}
interface Entry { definition: AccountExportDefinition; abort: AbortController; generation: number }
/** Single-account, local-only export. Never reads global native homes or keychains. */
export class LocalAccountExport implements AccountExportService {
  private entries = new Map<AccountExportFormatId, Entry[]>();
  private listeners = new Set<() => void>();
  private stopped = false;
  private generation = 0;
  constructor(private directory: string, private hooks: AccountExportHooks) {
    for (const definition of coreAccountExportFormats) this.entries.set(definition.id, [{ definition, abort: new AbortController(), generation: ++this.generation }]);
  }
  private active() { if (this.stopped) throw Error('ACCOUNT_EXPORT_DISPOSED'); }
  formats() { this.active(); return [...this.entries.values()].map(stack => { const entry = stack.at(-1)!, { id, label, description } = entry.definition; return { id, label, description, generation: entry.generation }; }); }
  subscribe(listener: () => void) { this.active(); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) { try { listener(); } catch { /* Observers do not own registry operations. */ } } }
  private validate(definition: AccountExportDefinition) {
    if (!definition || typeof definition.id !== 'string' || typeof definition.label !== 'string' || !definition.label.trim() || definition.label.length > 80 || typeof definition.description !== 'string' || definition.description.length > 400 || typeof definition.serialize !== 'function') throw Error('ACCOUNT_EXPORT_FORMAT_INVALID');
  }
  private install(definition: AccountExportDefinition) {
    const entry = { definition: { ...definition }, abort: new AbortController(), generation: ++this.generation }, stack = this.entries.get(definition.id) ?? [];
    stack.push(entry); this.entries.set(definition.id, stack); this.changed();
    return () => { const index = stack.indexOf(entry); if (index < 0) return; entry.abort.abort(); stack.splice(index, 1); if (!stack.length) this.entries.delete(definition.id); this.changed(); };
  }
  registerFormat(definition: AccountExportDefinition) {
    this.active(); this.validate(definition);
    if (!/^[a-z][a-z0-9.-]{1,79}:[a-z][a-z0-9.-]{0,59}$/.test(definition.id)) throw Error('ACCOUNT_EXPORT_FORMAT_ID_INVALID');
    if (this.entries.has(definition.id)) throw Error('ACCOUNT_EXPORT_FORMAT_DUPLICATE');
    return this.install(definition);
  }
  overrideFormat(id: AccountExportFormatId, definition: Omit<AccountExportDefinition, 'id'>) {
    this.active(); if (!this.entries.has(id)) throw Error('ACCOUNT_EXPORT_FORMAT_UNAVAILABLE');
    this.validate({ ...definition, id }); return this.install({ ...definition, id });
  }
  private account(request: AccountExportRequest) {
    this.active();
    if (!request || !/^[a-f0-9-]{36}$/.test(request.id) || typeof request.revision !== 'string') throw Error('ACCOUNT_EXPORT_REQUEST_INVALID');
    const account = this.hooks.account(request.id);
    if (account.revision !== request.revision) throw Error('LOCAL_ACCOUNT_CHANGED');
    return structuredClone(account);
  }
  private async document(request: AccountExportRequest) {
    const account = this.account(request), formatId = request.formatId ?? 'official', entry = this.entries.get(formatId)?.at(-1);
    if (!entry) throw Error('ACCOUNT_EXPORT_FORMAT_UNAVAILABLE');
    const assertCurrent = () => { this.account(request); if (entry.abort.signal.aborted || this.entries.get(formatId)?.at(-1) !== entry) throw Error('ACCOUNT_EXPORT_FORMAT_UNAVAILABLE'); };
    const file = path.join(this.directory, 'native-accounts', account.id, account.provider === 'codex' ? 'codex' : 'claude', account.provider === 'codex' ? 'auth.json' : '.credentials.json');
    let credentials: Record<string, unknown>;
    try { await noLinks(file); credentials = JSON.parse((await textFile(file, 1024 * 1024)).replace(/^\uFEFF/, '')); }
    catch (error) { throw Error((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'ACCOUNT_EXPORT_CREDENTIALS_MISSING' : 'ACCOUNT_EXPORT_CREDENTIALS_INVALID'); }
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw Error('ACCOUNT_EXPORT_CREDENTIALS_INVALID');
    assertCurrent();
    let result;
    try {
      result = await new Promise<Awaited<ReturnType<AccountExportDefinition['serialize']>>>((resolve, reject) => {
        const task = new AbortController(); let settled = false;
        const aborted = () => finish(Error('ACCOUNT_EXPORT_FORMAT_UNAVAILABLE'));
        const timer = setTimeout(() => finish(Error('ACCOUNT_EXPORT_TIMEOUT')), 30000);
        const finish = (error?: unknown, value?: Awaited<ReturnType<AccountExportDefinition['serialize']>>) => {
          if (settled) return; settled = true; clearTimeout(timer); entry.abort.signal.removeEventListener('abort', aborted);
          if (error !== undefined) { task.abort(); reject(error); } else resolve(value!);
        };
        entry.abort.signal.addEventListener('abort', aborted, { once: true });
        Promise.resolve().then(() => { assertCurrent(); return entry.definition.serialize({ account, credentials, now: new Date().toISOString(), signal: task.signal }); }).then(value => finish(undefined, value), error => finish(error ?? Error('ACCOUNT_EXPORT_SERIALIZER_FAILED')));
      });
    }
    catch (error) { if (error instanceof Error && /^ACCOUNT_EXPORT_(FORMAT_UNSUPPORTED|FORMAT_UNAVAILABLE|CREDENTIALS_INVALID|TIMEOUT)$/.test(error.message)) throw error; throw Error('ACCOUNT_EXPORT_SERIALIZER_FAILED'); }
    assertCurrent();
    if (!result || typeof result.fileName !== 'string' || !/^(?!\.{2})(?!.*[. ]$)[\p{L}\p{N}\p{M}_.@+ -]{1,200}\.json$/u.test(result.fileName) || Buffer.byteLength(result.fileName) > 240 || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:[ .]|$)/i.test(result.fileName) || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) throw Error('ACCOUNT_EXPORT_DOCUMENT_INVALID');
    let content: string;
    try { content = JSON.stringify(result.value, null, 2) + '\n'; if (Buffer.byteLength(content) > 1024 * 1024) throw Error(); }
    catch { throw Error('ACCOUNT_EXPORT_DOCUMENT_INVALID'); }
    return { formatId, fileName: result.fileName, value: JSON.parse(content) as Record<string, unknown>, content, assertCurrent };
  }
  async preview(request: AccountExportRequest & { reveal?: boolean }): Promise<AccountExportPreview> {
    const doc = await this.document(request);
    return { formatId: doc.formatId, fileName: doc.fileName, content: request.reveal === true ? doc.content : JSON.stringify(redactAccountExport(doc.value), null, 2) + '\n', redacted: request.reveal !== true };
  }
  async copy(request: AccountExportRequest): Promise<AccountExportResult> {
    const doc = await this.document(request); doc.assertCurrent();
    try { await this.hooks.copy(doc.content); } catch { throw Error('ACCOUNT_EXPORT_COPY_FAILED'); }
    return { status: 'copied' };
  }
  async save(request: AccountExportRequest): Promise<AccountExportResult> {
    if (!this.hooks.pickSave) throw Error('ACCOUNT_EXPORT_SAVE_UNAVAILABLE');
    const doc = await this.document(request);
    let target: string | null;
    try { target = await this.hooks.pickSave(doc.fileName); } catch { throw Error('ACCOUNT_EXPORT_SAVE_FAILED'); }
    if (!target) return { status: 'cancelled' };
    doc.assertCurrent();
    // The picker is the only path authority; do not allow replacing native account data.
    const relative = path.relative(path.resolve(this.directory), path.resolve(target));
    if (!relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw Error('ACCOUNT_EXPORT_DESTINATION_PROTECTED');
    try { await atomicWrite(target, doc.content, async () => doc.assertCurrent()); }
    catch (error) { if (/^(ACCOUNT_EXPORT_(DISPOSED|FORMAT_UNAVAILABLE)|LOCAL_ACCOUNT_)/.test((error as Error).message)) throw error; throw Error('ACCOUNT_EXPORT_SAVE_FAILED'); }
    return { status: 'saved' };
  }
  async call(method: string, payload: Record<string, any>) {
    if (method === 'models/accounts/export-formats') { this.account(payload as AccountExportRequest); return this.formats(); }
    if (method === 'models/accounts/export-preview') return this.preview(payload as AccountExportRequest);
    if (method === 'models/accounts/export-copy') return this.copy(payload as AccountExportRequest);
    if (method === 'models/accounts/export-save') return this.save(payload as AccountExportRequest);
    throw Error('ACCOUNT_EXPORT_METHOD_UNKNOWN');
  }
  dispose() { this.stopped = true; for (const stack of this.entries.values()) for (const entry of stack) entry.abort.abort(); this.entries.clear(); this.listeners.clear(); }
}
