/** Read-only migration discovery of the retired broker's public metadata.
 * No token, login, quota, refresh, usage or credential-file access is available. */
export const EXISTING_BROKER_CLIENT = String.raw`
import os,pwd,stat,json,socket,hashlib,datetime,re
POLICY_DIR='/var/lib/agent-workbench-existing-accounts'
POLICY_FILE=POLICY_DIR+'/grants.json'
class PublicError(Exception): pass
def fail(code): raise PublicError(code)
def safe_id(value): return isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}',value)
def metadata(path,private=False):
    parts=path.split('/'); current=''
    for part in parts[1:]:
        current+='/'+part; item=os.lstat(current)
        if stat.S_ISLNK(item.st_mode) or item.st_uid!=0 or item.st_mode & 0o022: fail('POLICY_UNAVAILABLE')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        item=os.fstat(fd)
        if not stat.S_ISREG(item.st_mode) or item.st_size>1048576: fail('POLICY_UNAVAILABLE')
        with os.fdopen(fd,'r') as stream:
            fd=-1; return json.load(stream)
    finally:
        if fd>=0: os.close(fd)
def policy():
    try: value=metadata(POLICY_FILE)
    except FileNotFoundError: return {'revision':0,'workspaces':{}}
    if not isinstance(value,dict) or type(value.get('revision')) is not int or value['revision']<0 or not isinstance(value.get('workspaces'),dict): fail('POLICY_UNAVAILABLE')
    for name,ids in value['workspaces'].items():
        if not safe_id(name) or not isinstance(ids,list) or len(ids)>128 or any(not safe_id(i) for i in ids): fail('POLICY_UNAVAILABLE')
    return value

def managed_status(username):
    try: value=metadata('/var/lib/agent-workbench-policy/workspaces.json')
    except FileNotFoundError: return None
    if not isinstance(value,dict) or not isinstance(value.get('workspaces'),list):fail('POLICY_UNAVAILABLE')
    rows=[row for row in value['workspaces'] if row.get('username')==username]
    if not rows:return None
    # A suspended, removed, or recovery-fenced workspace cannot fall back to its
    # previous legacy selection. This policy is re-read on every account request.
    row=rows[-1]
    if type(row.get('enabled')) is not bool:fail('POLICY_UNAVAILABLE')
    return row['enabled']
def member_accounts():
    names=metadata('/etc/codex-devices/allowed-users.json')
    if not isinstance(names,list) or not names or len(names)>128 or any(not safe_id(n) for n in names): fail('UNAUTHORIZED')
    accounts=[pwd.getpwnam(n) for n in names]
    if any(a.pw_uid<1000 or a.pw_name=='root' for a in accounts): fail('UNAUTHORIZED')
    return accounts
def request_broker(query,target=None):
    if query != {'method':'list'}: fail('ACCOUNT_MIGRATION_REQUIRED')
    # Root reads public metadata as a registered peer; privileges are dropped in a child.
    if target is not None:
        reader,writer=os.pipe(); pid=os.fork()
        if pid==0:
            os.close(reader)
            try:
                os.initgroups(target.pw_name,target.pw_gid);os.setgid(target.pw_gid);os.setuid(target.pw_uid)
                value=request_broker(query)
                with os.fdopen(writer,'w') as output: json.dump(value,output)
                os._exit(0)
            except BaseException: os._exit(1)
        os.close(writer)
        with os.fdopen(reader,'r') as source: raw=source.read(262145)
        _,status=os.waitpid(pid,0)
        if status or len(raw)>262144: fail('BROKER_UNAVAILABLE')
        return json.loads(raw)
    with socket.socket(socket.AF_UNIX) as channel:
        channel.settimeout(10);channel.connect('/run/codex-device-auth/broker.sock')
        channel.sendall((json.dumps(query)+'\n').encode());raw=channel.makefile('rb').readline(262145)
    if len(raw)>262144: fail('INVALID_REQUEST')
    envelope=json.loads(raw)
    value=envelope.get('result')
    if not isinstance(value,dict): fail('STALE_SELECTION' if query['method']=='select' else 'BROKER_UNAVAILABLE')
    return value
def existing_catalog(request):
    if request.get('protocol')!=1: fail('INVALID_REQUEST')
    method=request.get('method');params=request.get('params',{})
    admin=os.geteuid()==0;members=member_accounts() if admin else []
    username=pwd.getpwuid(os.geteuid()).pw_name
    if not admin and managed_status(username) is False:fail('WORKSPACE_DISABLED')
    target=members[0] if admin else None
    raw=request_broker({'method':'list'},target)
    if not isinstance(raw.get('accounts'),list) or len(raw['accounts'])>128 or type(raw.get('revision')) is not int: fail('INVALID_REQUEST')
    # Use the public host key to distinguish independent authorities, without machine inventory.
    with open('/etc/ssh/ssh_host_ed25519_key.pub','r') as source: host_key=source.read(8192).split()[:2]
    if len(host_key)!=2: fail('BROKER_UNAVAILABLE')
    authority='existing-codex-'+hashlib.sha256(' '.join(host_key).encode()).hexdigest()[:32]
    generation='public-catalog-v1';grants=policy()
    all_ids=[row.get('id') for row in raw['accounts']]
    if any(not safe_id(i) for i in all_ids) or len(set(all_ids))!=len(all_ids): fail('INVALID_REQUEST')
    if method!='catalog/list': fail('ACCOUNT_MIGRATION_REQUIRED')
    allowed=grants['workspaces'].get(username,[raw.get('selected')] if raw.get('selected') in all_ids else [])
    observed=datetime.datetime.now(datetime.timezone.utc).isoformat()
    rows=[]
    for row in raw['accounts']:
        if not admin and row['id'] not in allowed: continue
        fingerprints=row.get('fingerprints')
        if not isinstance(fingerprints,list) or not fingerprints or any(not isinstance(v,str) or not re.fullmatch('[a-f0-9]{64}',v) for v in fingerprints): fail('INVALID_REQUEST')
        item={'id':row['id'],'generation':hashlib.sha256(json.dumps(sorted(fingerprints)).encode()).hexdigest(),'provider':'codex','status':'configured','observedAt':observed}
        for source,destination in [('email','email'),('name','displayName'),('plan','plan')]:
            value=row.get(source)
            if isinstance(value,str) and len(value)<=256 and not re.search(r'[\x00-\x1f\x7f]',value): item[destination]=value
        rows.append(item)
    result={'authorityId':authority,'generation':generation,'workspaceId':'administrator' if admin else username,'revision':raw['revision'],'selectionRevision':raw['revision'],'accounts':rows,'availability':'ready','source':'existing-codex','policyRevision':grants['revision']}
    if not admin and raw.get('selected') in allowed: result['selectedAccountId']=raw['selected']
    if admin:
        result['assignments']=[{'username':a.pw_name,'accountIds':grants['workspaces'].get(a.pw_name,[row['id'] for row in raw['accounts'] if a.pw_name in row.get('devices',[])])} for a in members]
    return result
`;
