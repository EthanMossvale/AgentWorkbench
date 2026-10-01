import {NATIVE_OWNER_CLIENT} from '../remote-account-catalog/native-client';

/** The native owner reads quotas and redeems explicitly confirmed reset cards. */
export const USAGE_REMOTE=NATIVE_OWNER_CLIENT+String.raw`
import sys,pwd

class NativeFailure(Exception):
    def __init__(self,code):self.code=code

def account_rpc(cfg):
    if cfg.get('source')!='native-owner':raise NativeFailure('ACCOUNT_MIGRATION_REQUIRED')
    if cfg.get('legacyAccountRef'):
        from urllib.parse import quote
        resolved=native_owner_request({'protocol':1,'method':'migration/account-resolve','params':{'accountRef':cfg['legacyAccountRef']}})
        expected='vps-account:'+'/'.join(quote(v,safe='') for v in (cfg['authorityId'],cfg['generation'],'codex',cfg['accountId'],cfg['accountGeneration']))
        if resolved.get('ok') is not True or resolved.get('value',{}).get('accountRef')!=expected or resolved['value'].get('previousAccountRef')!=cfg['legacyAccountRef']:raise NativeFailure('MIGRATION_NOT_READY')
    params={k:v for k,v in cfg.items() if k not in ('source','legacyAccountRef')}
    response=native_owner_request({'protocol':1,'method':'runtime/usage','params':params})
    if response.get('ok') is not True:raise NativeFailure(response.get('error','UNAVAILABLE'))
    return response['value']

try:print(json.dumps({'ok':True,'value':account_rpc(cfg)},separators=(',',':')))
except NativeFailure as error:print(json.dumps({'ok':False,'error':error.code}))
except Exception:print('{"ok":false,"error":"UNAVAILABLE"}')
`;
