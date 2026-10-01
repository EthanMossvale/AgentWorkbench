import { randomUUID } from 'node:crypto';
import type { AppState, AccountCatalog, SharedAccount } from '../../../packages/contracts';
import { sharedAccountRef } from '../../../packages/account-selection';

export interface AccountNameService {
  apply(catalog:AccountCatalog,state?:AppState):AccountCatalog;
  rename(hostId:unknown,accountId:unknown,generation:unknown,name:unknown,revision:unknown):Promise<SharedAccount>;
}
export class AccountNames implements AccountNameService {
  constructor(private snapshot:()=>AppState,private update:(change:(state:AppState)=>void)=>Promise<unknown>){}
  apply(catalog:AccountCatalog,state:AppState=this.snapshot()){
    if(catalog.availability!=='ready')return catalog;
    for(const account of catalog.accounts){const alias=state.accountAliases?.[sharedAccountRef(catalog,account)];if(alias){account.displayName=alias.name;account.nameRevision=alias.revision;}else{account.displayName=account.email??account.displayName;delete account.nameRevision;}}
    return catalog;
  }
  async rename(hostId:unknown,accountId:unknown,generation:unknown,name:unknown,revision:unknown):Promise<SharedAccount>{
    if(typeof hostId!=='string'||typeof name!=='string'||!name.trim()||name.trim().length>100||/[\x00-\x1f]/.test(name))throw Error('LOCAL_ACCOUNT_NAME_INVALID');
    await this.update(state=>{
      const host=state.hosts.find(h=>h.id===hostId),catalog=state.accountCatalogs?.[hostId],account=catalog?.accounts.find(a=>a.id===accountId&&a.generation===generation);
      if(!host||!catalog||catalog.availability!=='ready'||!account)throw Error('LOCAL_ACCOUNT_NOT_FOUND');
      const key=sharedAccountRef(catalog,account);if(state.accountAliases?.[key]?.revision!==revision)throw Error('LOCAL_ACCOUNT_CHANGED');
      state.accountAliases??={};state.accountAliases[key]={name:name.trim(),revision:randomUUID()};
      for(const cached of Object.values(state.accountCatalogs??{}))this.apply(cached,state);
    });return this.snapshot().accountCatalogs![hostId]!.accounts.find(a=>a.id===accountId)!;
  }
}
