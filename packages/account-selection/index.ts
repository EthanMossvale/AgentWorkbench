import type { AccountCatalog, SharedAccount } from '../contracts';

/** The account identity survives token renewal, but not revocation or re-enrolment. */
export function sharedAccountRef(catalog: AccountCatalog, account: SharedAccount): string {
  if (catalog.availability !== 'ready' || !catalog.authorityId || !catalog.generation || !account.id || !account.generation) throw new Error('共享账号身份尚未核实。');
  return 'vps-account:' + [catalog.authorityId, catalog.generation, account.provider, account.id, account.generation].map(encodeURIComponent).join('/');
}

export function selectedSharedAccount(catalog?: AccountCatalog, provider: 'codex'|'claude' = 'codex'): SharedAccount | undefined {
  if (catalog?.availability !== 'ready') return;
  const selected=provider==='codex'?catalog.selectedAccountId:catalog.selectedClaudeAccountId;
  return catalog.accounts.find(account => account.id === selected && account.provider === provider && usableSharedAccount(account));
}
export function usableSharedAccount(account?:SharedAccount):boolean{return !!account&&account.enabled!==false&&account.workspaceEnabled!==false&&(account.status==='authenticated'||account.status==='configured');}

export function selectedSharedAccountRef(catalog?: AccountCatalog, provider: 'codex'|'claude' = 'codex'): string | undefined {
  const account = selectedSharedAccount(catalog,provider);
  return catalog && account ? sharedAccountRef(catalog, account) : undefined;
}
