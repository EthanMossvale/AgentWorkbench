import {runSsh, type SshRunner} from '../ssh-transport';
import type {SshHost} from '../contracts';

const source = String.raw`import json,socket,stat,os,sys
try:
    path='/var/lib/agent-workbench-policy/quota.sock'
    parent=os.lstat('/var/lib/agent-workbench-policy');info=os.lstat(path)
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=0 or parent.st_mode&0o022 or not stat.S_ISSOCK(info.st_mode) or info.st_uid!=0:raise ValueError()
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(85);connection.connect(path)
        connection.sendall((json.dumps(request,separators=(',',':'))+'\n').encode())
        raw=connection.makefile('rb').readline(2097153)
        if len(raw)>2097152:raise ValueError()
        print(json.dumps(json.loads(raw),separators=(',',':')))
except Exception:
    # Legacy unconfigured members stay usable. A configured quota never silently
    # becomes unlimited when the shared authority is down.
    unconfigured=False
    try:
        path='/var/lib/agent-workbench-policy/workspaces.json'
        if not os.path.exists(path):unconfigured=True
        else:
            info=os.lstat(path)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:raise ValueError()
            with open(path) as stream:policy=json.load(stream)
            row=next((w for w in policy.get('workspaces',[]) if w.get('uid')==os.geteuid()),None)
            account=request.get('params',{}).get('accountId')
            quota=(row or {}).get('accountQuotas',{}).get(account,{})
            unconfigured=row is None or row.get('enabled') is True and quota.get('weeklyPercent') is None and quota.get('fiveHourPercent') is None
    except Exception:pass
    if unconfigured and request.get('method')=='quota/context':print('{"ok":true,"value":{"managed":false}}')
    else:print('{"ok":false,"error":"QUOTA_UNAVAILABLE"}')
`;
export class MemberQuotaControl {
  constructor(private runner: SshRunner = runSsh) {}
  async request(host: SshHost, method: 'quota/context' | 'quota/observe' | 'quota/read' | 'quota/check', params: Record<string, unknown>): Promise<any> {
    if (host.role !== 'workspace' || host.username === 'root') throw Error('额度账本要求成员 SSH 身份。');
    const encoded = Buffer.from(JSON.stringify({method, params})).toString('base64');
    const result = await this.runner(host, 'exec python3 -', {stdin: `import json,base64\nrequest=json.loads(base64.b64decode('${encoded}'))\n${source}`, timeoutMs: 95000, maxOutputBytes: 2 * 1024 * 1024});
    const response = JSON.parse(result.stdout);
    if (result.exitCode !== 0 || response.ok !== true) throw Error(response.error === 'QUOTA_ACCOUNT_NOT_ALLOWED' ? '此空间未获得该账号使用权。' : response.error === 'WORKSPACE_UNAVAILABLE' ? '此空间尚未纳入管理或已停用。' : '共享额度账本暂不可用，请管理员刷新工作空间管理。');
    return response.value;
  }
}
