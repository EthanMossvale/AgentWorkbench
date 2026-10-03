/** Member-side transport only. The official account-owner runtime owns login. */
export const NATIVE_OWNER_REMOTE_BRIDGE = String.raw`
import json,os,pwd,re,select,signal,socket,stat,struct,sys,threading
closing=threading.Event();wire_lock=threading.Lock();listener=None;channel=None;socket_identity=None
peers=set();peers_lock=threading.Lock()
def emit(value):
    with wire_lock:
        sys.stdout.write(json.dumps(value,separators=(',',':'))+'\n');sys.stdout.flush()
def relay(client):
    upstream=socket.socket(socket.AF_UNIX)
    try:
        with peers_lock:peers.update((client,upstream))
        upstream.connect(cfg['socketPath'])
        while not closing.is_set():
            for source in select.select([client,upstream],[],[],.5)[0]:
                data=source.recv(65536)
                if not data:return
                (upstream if source is client else client).sendall(data)
    except OSError:pass
    finally:
        with peers_lock:peers.discard(client);peers.discard(upstream)
        client.close();upstream.close()
def accept_tunnel():
    while not closing.is_set():
        try:client,_=listener.accept();threading.Thread(target=relay,args=(client,),daemon=True).start()
        except OSError:return
def trusted_socket():
    parent='/run/agent-workbench-accounts';endpoint=parent+'/broker.sock'
    base=os.lstat('/run');directory=os.lstat(parent);entry=os.lstat(endpoint)
    if not stat.S_ISDIR(base.st_mode) or base.st_uid!=0 or base.st_mode&0o022:raise ValueError()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_mode&0o022 or directory.st_uid in (0,os.geteuid()):raise ValueError()
    if not stat.S_ISSOCK(entry.st_mode) or entry.st_uid!=directory.st_uid:raise ValueError()
    connection=socket.socket(socket.AF_UNIX);connection.settimeout(90);connection.connect(endpoint)
    if struct.unpack('3i',connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))[1]!=directory.st_uid:
        connection.close();raise ValueError()
    return connection
def downstream(reader):
    try:
        while not closing.is_set():
            raw=reader.readline()
            if not raw:break
            with wire_lock:sys.stdout.buffer.write(raw);sys.stdout.flush()
    except OSError:pass
    finally:
        if not closing.is_set():os.kill(os.getpid(),signal.SIGTERM)
def interrupted(signum,frame):raise SystemExit(128+signum)
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGHUP,interrupted)
try:
    cfg=json.loads(sys.stdin.buffer.readline(32769))
    if os.geteuid()<1000 or pwd.getpwuid(os.geteuid()).pw_name!=cfg['username'] or not re.fullmatch('[a-f0-9-]{36}',cfg['sessionId']):raise ValueError()
    if not re.fullmatch('[a-f0-9]{64}',cfg['secret']) or cfg['environmentId']!='local-device' or not re.fullmatch('/tmp/agent-workbench-'+re.escape(cfg['sessionId'])+r'-[a-f0-9]{16}\.sock',cfg['socketPath']):raise ValueError()
    socket_identity=os.lstat(cfg['socketPath'])
    if not stat.S_ISSOCK(socket_identity.st_mode) or socket_identity.st_uid!=os.geteuid() or socket_identity.st_mode&0o077:raise ValueError()
    listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
    port=listener.getsockname()[1]
    threading.Thread(target=accept_tunnel,daemon=True).start()
    channel=trusted_socket();reader=channel.makefile('rb')
    binding={k:cfg[k] for k in ('authorityId','accountId','accountGeneration','sessionId','environmentId','cwd')}
    binding.update(generation=cfg['authorityGeneration'])
    claude=cfg.get('provider')=='claude'
    if claude:
        if not re.fullmatch(r'/[a-f0-9]{48}/mcp',cfg.get('toolPath','')):raise ValueError()
        binding.update(toolServerUrl='http://127.0.0.1:'+str(port)+cfg['toolPath'],toolToken=cfg['secret'],selection=cfg['selection'],permissionMode=cfg['permissionMode'])
    else:
        binding['execServerUrl']='ws://127.0.0.1:'+str(port)+'/'+cfg['secret']
    if 'fork' in cfg:binding['fork']=cfg['fork']
    channel.sendall((json.dumps({'protocol':1,'method':'runtime/open-claude' if claude else 'runtime/open','params':binding})+'\n').encode())
    response=json.loads(reader.readline(65537))
    if response.get('ok') is not True or response.get('value',{}).get('credentialOwner')!='native':raise ValueError()
    channel.settimeout(None)
    emit({'method':'workbench/bridgeReady','params':{'port':port,'accountRuntime':'native-owner','sessionReceipt':response['value'].get('sessionReceipt'),'provider':response['value'].get('provider'),'transport':response['value'].get('transport')}})
    threading.Thread(target=downstream,args=(reader,),daemon=True).start()
    while not closing.is_set():
        raw=sys.stdin.buffer.readline()
        if not raw:break
        channel.sendall(raw)
except Exception:
    emit({'method':'error','params':{'error':{'message':'Native account session is unavailable. Check its authorization and native runtime status. No legacy fallback was attempted.'}}})
finally:
    closing.set()
    if listener:listener.close()
    if channel:
        try:channel.shutdown(socket.SHUT_RDWR)
        except OSError:pass
        channel.close()
    with peers_lock:
        for peer in peers:
            try:peer.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            peer.close()
    if socket_identity:
        try:
            current=os.lstat(cfg['socketPath'])
            if current.st_ino==socket_identity.st_ino and current.st_uid==os.geteuid():os.unlink(cfg['socketPath'])
        except FileNotFoundError:pass
`;
