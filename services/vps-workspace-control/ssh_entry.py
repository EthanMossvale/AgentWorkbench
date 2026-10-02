"""On-demand root control over an already verified SSH connection.

Reading an uninitialized host is read-only. The first explicit plan creates only
our journal. Apply is the only path to member or authorization changes.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import time
from control import WorkspaceControl, PolicyPublisher
from provisioner import LinuxProvisioner
from security import ControlError, trusted_root_path

ROOT = '/var/lib/agent-workbench-ssh-control'
POLICY_ROOT = '/var/lib/agent-workbench-policy'
POLICY = POLICY_ROOT + '/workspaces.json'
SOCKET = '/run/agent-workbench-control/control.sock'


def directory(path, mode):
    trusted_root_path(str(Path(path).parent), directory=True)
    try:
        os.mkdir(path, mode)
    except FileExistsError:
        pass
    trusted_root_path(path, directory=True, private=mode == 0o700)


def dispatch(request, connection, sources=None):
    if os.geteuid() != 0:
        raise ControlError('UNAUTHORIZED')
    if os.path.lexists(SOCKET):
        # Never mask failure of an installed authority with a second registry.
        trusted_root_path(str(Path(SOCKET).parent), directory=True, private=True)
        info = os.lstat(SOCKET)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise ControlError('UNSAFE_DEPLOYMENT')
        with socket.socket(socket.AF_UNIX) as channel:
            channel.settimeout(900 if request.get('method') == 'workspace/apply' else 75)
            channel.connect(SOCKET)
            channel.sendall((json.dumps(request)+'\n').encode())
            raw = channel.makefile('rb').readline(2097153)
            if len(raw) > 2097152:
                raise ControlError('INVALID_REQUEST')
            return json.loads(raw)
    key_path = trusted_root_path('/etc/ssh/ssh_host_ed25519_key.pub')
    with open(key_path) as source:
        key = ' '.join(source.read(8192).split()[:2])
    public_connection = dict(connection, hostPublicKeys=[key])
    config = {'authorityId': 'ssh-control-'+hashlib.sha256(key.encode()).hexdigest()[:32],
              'generation': 'ssh-control-v1', 'root': ROOT,
              'connection': public_connection, 'enrollmentUrl': ''}
    if not os.path.lexists(ROOT) and request == {'protocol': 1, 'method': 'workspace/list', 'params': {}}:
        return {'ok': True, 'value': dict(authorityId=config['authorityId'], generation=config['generation'],
                revision=0, workspaces=[], sshOnlyMembers=LinuxProvisioner().ssh_only_members(), connection=public_connection, enrollmentUrl='', transport='ssh')}
    if not os.path.lexists(ROOT) and request.get('method') != 'workspace/plan':
        raise ControlError('WORKSPACE_UNAVAILABLE')
    if request.get('method') in ('quota/read', 'quota/observe', 'quota/check'):
        # Both roles use the same loaded calculator and shared registry lock.
        trusted_root_path(ROOT, directory=True, private=True)
        trusted_root_path(POLICY_ROOT, directory=True)
        if sources:
            ensure_quota_service(config, sources)
        endpoint = POLICY_ROOT + '/quota-v2.sock'
        info = os.lstat(endpoint)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0:
            raise ControlError('UNSAFE_DEPLOYMENT')
        with socket.socket(socket.AF_UNIX) as channel:
            channel.settimeout(90)
            channel.connect(endpoint)
            channel.sendall((json.dumps({'method': request['method'], 'params': request['params']})+'\n').encode())
            raw = channel.makefile('rb').readline(2097153)
            if len(raw) > 2097152:
                raise ControlError('INVALID_REQUEST')
            return json.loads(raw)
    directory(ROOT, 0o700)
    directory(POLICY_ROOT, 0o755)
    descriptor = os.open(ROOT+'/control.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600)
    try:
        item = os.fstat(descriptor)
        if not stat.S_ISREG(item.st_mode) or item.st_uid != 0 or item.st_nlink != 1 or item.st_mode & 0o077:
            raise ControlError('UNSAFE_DEPLOYMENT')
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        if os.path.lexists(ROOT+'/state.json'):
            trusted_root_path(ROOT+'/state.json', private=True)
        control = WorkspaceControl(config, LinuxProvisioner(), publish_policy=PolicyPublisher(POLICY))
        value = control.dispatch(os.geteuid(), request)
        if request['method'] == 'workspace/list':
            value['transport'] = 'ssh'
        configured = any(w['status'] != 'deleted' and any(q.get('weeklyPercent') is not None or q.get('fiveHourPercent') is not None for q in w.get('accountQuotas', {}).values()) for w in control.state['workspaces'].values())
        if sources and configured and request['method'] in ('workspace/apply', 'workspace/list'):
            ensure_quota_service(config, sources)
        return {'ok': True, 'value': value}
    finally:
        os.close(descriptor)


def ensure_quota_service(config, sources):
    quota_socket = POLICY_ROOT + '/quota-v2.sock'
    if os.path.lexists(quota_socket):
        info = os.lstat(quota_socket)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0:
            raise ControlError('UNSAFE_DEPLOYMENT')
        try:
            with socket.socket(socket.AF_UNIX) as probe:
                probe.settimeout(1)
                probe.connect(quota_socket)
                return
        except OSError:
            pass
    runtime = ROOT + '/quota-runtime-v2'
    directory(runtime, 0o700)
    for name in ('security', 'destruction', 'provisioner', 'quota_accounting', 'control', 'quota_service', 'quota_native'):
        target = runtime + '/' + name + '.py'
        if os.path.lexists(target):
            trusted_root_path(target, private=True)
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(sources[name])
    from control import atomic_json
    atomic_json(ROOT + '/quota-service.json', config)
    with open(os.devnull, 'rb') as source, open(os.devnull, 'ab') as target:
        subprocess.Popen([sys.executable, '-B', runtime + '/quota_service.py'], stdin=source, stdout=target, stderr=target, start_new_session=True, close_fds=True)
    # Do not wait on the registry lock here: the worker opens it per request.
    for _ in range(30):
        try:
            with socket.socket(socket.AF_UNIX) as probe:
                probe.settimeout(.1)
                probe.connect(quota_socket)
                return
        except OSError:
            time.sleep(.05)
    raise ControlError('QUOTA_UNAVAILABLE')


def main(request, connection, sources=None):
    try:
        result = dispatch(request, connection, sources)
    except ControlError as error:
        result = {'ok': False, 'error': error.code}
    except Exception:
        result = {'ok': False, 'error': 'CONTROL_UNAVAILABLE'}
    print(json.dumps(result, separators=(',', ':')))
