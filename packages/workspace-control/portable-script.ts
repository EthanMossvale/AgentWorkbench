// A one-time SSH enrollment capability. It cannot open a shell or forward ports.
// The receiving device replaces it atomically with its independently generated key.
export const PORTABLE_ENROLL = String.raw`
import os,sys,json,stat,re,base64,hashlib,fcntl,tempfile,time,pwd

def require_enabled(username,uid,binding):
    path='/var/lib/agent-workbench-policy/workspaces.json'
    try:fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    except FileNotFoundError:
        if binding.get('workspaceId'):raise ValueError()
        return
    with os.fdopen(fd,'rb') as source:
        info=os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or info.st_size>4194304:raise ValueError()
        policy=json.load(source)
    rows=[row for row in policy['workspaces'] if row['username']==username or row['uid']==uid]
    if rows and (len(rows)!=1 or rows[0]['username']!=username or rows[0]['uid']!=uid or rows[0]['enabled'] is not True):raise ValueError()
    if binding.get('workspaceId') and (len(rows)!=1 or rows[0]['workspaceId']!=binding['workspaceId'] or policy['authorityId']!=binding['authorityId'] or policy['generation']!=binding['generation']):raise ValueError()
def key(value):
    if not isinstance(value,str) or not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]{68}',value): raise ValueError()
    blob=base64.b64decode(value.split()[1],validate=True)
    if len(blob)!=51 or blob[:19]!=b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20': raise ValueError()
    return value
def edit_keys(marker,newline,binding):
    user=pwd.getpwuid(os.geteuid());folder=user.pw_dir+'/.ssh'
    info=os.lstat(folder)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid!=user.pw_uid or info.st_mode&0o022: raise ValueError()
    directory=os.open(folder,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    lock=os.open('.aw-enroll.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600,dir_fd=directory)
    try:
        info=os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=user.pw_uid or info.st_nlink!=1 or info.st_mode&0o077: raise ValueError()
        fcntl.flock(lock,fcntl.LOCK_EX)
        require_enabled(user.pw_name,user.pw_uid,binding)
        if time.time()>=binding['expires']:raise ValueError()
        fd=os.open('authorized_keys',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
        with os.fdopen(fd,'rb') as source:
            info=os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=user.pw_uid or info.st_nlink!=1 or info.st_size>1048576 or info.st_mode&0o022: raise ValueError()
            content=source.read(1048577)
        lines=content.splitlines(keepends=True);matches=[i for i,line in enumerate(lines) if line.rstrip(b'\r\n').endswith((' '+marker).encode())]
        if len(matches)!=1: raise ValueError()
        old=lines[matches[0]];lines[matches[0]]=newline.encode()+b'\n'
        payload=b''.join(lines)
        name='.aw-keys-'+os.urandom(16).hex();fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600,dir_fd=directory)
        try:
            with os.fdopen(fd,'wb') as target:target.write(payload);target.flush();os.fsync(target.fileno())
            current=os.stat('authorized_keys',dir_fd=directory,follow_symlinks=False)
            if (current.st_ino,current.st_mtime_ns,current.st_size)!=(info.st_ino,info.st_mtime_ns,info.st_size):raise ValueError()
            os.rename(name,'authorized_keys',src_dir_fd=directory,dst_dir_fd=directory);os.fsync(directory)
        finally:
            try:os.unlink(name,dir_fd=directory)
            except FileNotFoundError:pass
    finally:os.close(lock);os.close(directory)
def enroll(binding):
    if os.geteuid()!=binding['uid'] or pwd.getpwuid(os.geteuid()).pw_name!=binding['username'] or time.time()>=binding['expires']:raise ValueError()
    raw=sys.stdin.buffer.readline(8193)
    if len(raw)>8192:raise ValueError()
    request=json.loads(raw);public=key(request['publicKey']);label=request.get('deviceLabel','Device')
    if not isinstance(label,str) or not label.strip() or len(label)>100 or re.search(r'[\x00-\x1f\x7f]',label):raise ValueError()
    label=base64.urlsafe_b64encode(label.strip().encode()).decode().rstrip('=')
    edit_keys('aw-enroll:'+binding['id'],public+' aw-device:'+binding['id']+':'+label+':'+str(int(time.time())),binding)
    print(json.dumps({'inviteId':binding['id'],'username':binding['username'],'uid':binding['uid'],'fingerprint':'SHA256:'+base64.b64encode(hashlib.sha256(base64.b64decode(public.split()[1])).digest()).decode().rstrip('=')}))
`;

export function portablePrepareScript(enrollmentSource:string){return String.raw`
import os,sys,json,pwd,stat,re,base64,datetime,time,fcntl,zlib
def invitation_window(ttl):
    if type(ttl) is not int or ttl not in (3600,21600,43200,86400,604800):raise ValueError()
    issued=int(time.time())
    return issued,issued+ttl

def main():
    if os.geteuid()!=0:raise ValueError()
    request=json.loads(sys.stdin.buffer.readline(32769));name=request['username'];invite=request['inviteId'];public=request['publicKey'];ttl=request['ttlSeconds']
    if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}',name) or name=='root' or not re.fullmatch(r'[a-f0-9-]{36}',invite) or not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]{68}',public) or type(ttl) is not int or ttl not in (3600,21600,43200,86400,604800):raise ValueError()
    user=pwd.getpwnam(name)
    if user.pw_uid<1000 or not user.pw_dir.startswith('/home/'):raise ValueError()
    # Public host pins cross the connection; no private host or user key is read.
    with open('/etc/ssh/ssh_host_ed25519_key.pub') as source:hostkey=' '.join(source.read(8192).split()[:2])
    issued,expires=invitation_window(ttl)
    binding={'id':invite,'uid':user.pw_uid,'username':name,'expires':expires}
    if 'workspaceId' in request:
        for field in ('authorityId','generation','workspaceId'):
            if not isinstance(request.get(field),str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}',request[field]):raise ValueError()
            binding[field]=request[field]
    source=base64.b64decode('${Buffer.from(enrollmentSource).toString('base64')}').decode()
    policy_check={};exec(source,policy_check)
    source+='\ntry:enroll('+repr(binding)+')\nexcept BaseException:print(\'{"error":"ENROLLMENT_FAILED"}\');sys.exit(1)\n'
    code=base64.b64encode(zlib.compress(source.encode())).decode();command="/usr/bin/python3 -c \"import base64,zlib;exec(zlib.decompress(base64.b64decode('"+code+"')))\""
    timestamp=datetime.datetime.fromtimestamp(expires,datetime.timezone.utc).strftime('%Y%m%d%H%M%SZ')
    line='restrict,command="'+command.replace('\\','\\\\').replace('"','\\"')+'",expiry-time="'+timestamp+'" '+public+' aw-enroll:'+invite+'\n'
    if len(line.encode())>8192:raise ValueError()
    os.initgroups(name,user.pw_gid);os.setgid(user.pw_gid);os.setuid(user.pw_uid)
    home=os.open(user.pw_dir,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    item=os.fstat(home)
    if item.st_uid!=user.pw_uid or item.st_mode&0o022:raise ValueError('UNSAFE_HOME')
    try:os.mkdir('.ssh',0o700,dir_fd=home)
    except FileExistsError:pass
    folder=user.pw_dir+'/.ssh';item=os.stat('.ssh',dir_fd=home,follow_symlinks=False)
    if not stat.S_ISDIR(item.st_mode) or item.st_uid!=user.pw_uid or item.st_mode&0o022:raise ValueError()
    directory=os.open('.ssh',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=home);os.close(home)
    lock=os.open('.aw-enroll.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600,dir_fd=directory)
    try:
        item=os.fstat(lock)
        if not stat.S_ISREG(item.st_mode) or item.st_uid!=user.pw_uid or item.st_nlink!=1 or item.st_mode&0o077:raise ValueError()
        fcntl.flock(lock,fcntl.LOCK_EX)
        # Respect the root-owned workspace policy before publishing a capability.
        policy_check['require_enabled'](name,user.pw_uid,binding)
        fd=os.open('authorized_keys',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=directory)
        with os.fdopen(fd,'r+b') as output:
            item=os.fstat(output.fileno())
            if not stat.S_ISREG(item.st_mode) or item.st_uid!=user.pw_uid or item.st_nlink!=1 or item.st_size>1048576 or item.st_mode&0o022:raise ValueError()
            content=output.read(1048577)
            if ('aw-enroll:'+invite).encode() in content:raise ValueError()
            output.seek(0,2);output.write((b'' if not content or content.endswith(b'\n') else b'\n')+line.encode());output.flush();os.fsync(output.fileno())
    finally:os.close(lock);os.close(directory)
    print(json.dumps({'uid':user.pw_uid,'username':name,'root':user.pw_dir,'hostPublicKeys':[hostkey],'issuedAtEpoch':issued,'expiresAtEpoch':expires}))
try:main()
except BaseException:print('{"error":"EXPORT_FAILED"}');sys.exit(1)
`;}
