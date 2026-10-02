import {USAGE_REMOTE} from '../account-usage/remote';

// The same audited native reader runs in a separate process under the member's
// UID. A member report never supplies the official percentage or reset clock.
export const quotaNativeSource = USAGE_REMOTE.slice(0, USAGE_REMOTE.lastIndexOf('\ntry:print')) + String.raw`
import math,time

def quota_windows(value,at):
    pool=value.get('pools',{}).get('codex')
    if pool is None and len(value.get('pools',{}))==1:pool=next(iter(value['pools'].values()))
    windows=[]
    for window in ((pool or {}).get('primary'),(pool or {}).get('secondary')):
        if not isinstance(window,dict) or window.get('windowDurationMins') not in (300,10080):continue
        used,reset=window.get('usedPercent'),window.get('resetsAt')
        # Idle native windows can omit the reset clock; preserve other valid windows.
        if type(used) not in (int,float) or not math.isfinite(used) or not 0<=used<=100:continue
        if type(reset) not in (int,float) or not math.isfinite(reset) or not at<reset<=1e12:continue
        windows.append({'window':'fiveHour' if window['windowDurationMins']==300 else 'weekly','usedPercent':used,'resetsAt':reset})
    return windows

def catalog_for_usage(data):
    if data.get('source')!='native-owner':raise ValueError('ACCOUNT_MIGRATION_REQUIRED')
    response=native_owner_request({'protocol':1,'method':'catalog/list','params':{}})
    if response.get('ok') is not True or response.get('value',{}).get('source')!='native-owner':raise ValueError()
    return response['value']

if __name__ == '__main__':
    try:
        data=json.loads(sys.stdin.buffer.readline(8193))
        uid=data['uid'];member=pwd.getpwuid(uid)
        if type(uid) is not int or uid<1000:raise ValueError()
        if os.geteuid()==0:
            os.initgroups(member.pw_name,member.pw_gid);os.setgid(member.pw_gid);os.setuid(uid)
        if os.geteuid()!=uid:raise ValueError()
        view=catalog_for_usage(data)
        if not any(a.get('id')==data['accountId'] and a.get('generation')==data['accountGeneration'] for a in view['accounts']):raise ValueError()
        cfg={'accountId':data['accountId'],'accountGeneration':data['accountGeneration'],'authorityId':view['authorityId'],'generation':view['generation'],'action':'read','source':'native-owner'}
        value=account_rpc(cfg)
        print(json.dumps({'ok':True,'windows':quota_windows(value,time.time())}))
    except Exception:print('{"ok":false}')
`;
