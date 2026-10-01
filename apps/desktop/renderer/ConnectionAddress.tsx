import {uiPreferences,useUiPreference} from './ui-preferences';
import { useSyncExternalStore } from 'react';

export function useConnectionAddressHidden(){return useUiPreference<boolean>('connections.mask-address')[0];}
export function ConnectionName({name,hostname}:{name:string;hostname:string}){
  const masked=useConnectionAddressHidden();
  return <>{masked&&hostname?name.replaceAll(hostname,'***.***.***.***'):name}</>;
}
export function ConnectionAddress({ hostname, port, username, control = true }: { hostname: string; port?: number; username?: string; control?: boolean }) {
  const masked = useConnectionAddressHidden();
  return <span className="connection-address"><span className="mono">{username ? username + '@' : ''}{masked ? '***.***.***.***' : hostname}{port ? ':' + port : ''}</span>{control && <button type="button" className="address-eye icon-button" aria-label={masked ? '显示 IP 地址' : '隐藏 IP 地址'} aria-pressed={masked} title={masked ? '显示 IP 地址' : '隐藏 IP 地址'} onClick={event => { event.stopPropagation(); uiPreferences.change('connections.mask-address',!masked); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{masked && <path d="m3 3 18 18"/>}</svg></button>}</span>;
}
