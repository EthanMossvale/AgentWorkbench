"""Host metrics and explicit maintenance preferences, without process-name kills."""
import json
import os
from pathlib import Path
import socket
import stat
import struct
import time
import uuid
import cli_guard

ROOT = Path('/var/lib/agent-workbench-cli-policies')
CONFIG = Path('/etc/agent-workbench/accounts.json')
SOCKET = '/run/agent-workbench-accounts/broker.sock'


def require(value, code='RESOURCE_REQUEST_INVALID'):
    if not value:
        raise RuntimeError(code)


def metrics(folder='/'):
    values = {}
    for line in Path('/proc/meminfo').read_text(encoding='ascii').splitlines():
        key, value = line.split(':', 1)
        values[key] = int(value.strip().split()[0]) * 1024
    total, available = values['MemTotal'], values['MemAvailable']
    disk = os.statvfs(folder)
    return dict(observedAt=time.time(), memory=dict(total=total, available=available, used=total-available,
                swapTotal=values.get('SwapTotal', 0), swapUsed=values.get('SwapTotal', 0)-values.get('SwapFree', 0)),
                storage=dict(path=folder, total=disk.f_blocks*disk.f_frsize,
                             available=disk.f_bavail*disk.f_frsize, used=(disk.f_blocks-disk.f_bfree)*disk.f_frsize))


def policy():
    if not ROOT.exists():
        return dict(revision=0, autoMemory=False)
    info = ROOT.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'RESOURCE_POLICY_INVALID')
    target = ROOT / 'resources.json'
    if not os.path.lexists(target):
        return dict(revision=0, autoMemory=False)
    with os.fdopen(os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'r') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o022 and info.st_size < 4096, 'RESOURCE_POLICY_INVALID')
        value = json.load(stream)
    require(set(value) == {'revision', 'autoMemory'} and type(value['revision']) is int and value['revision'] >= 0 and type(value['autoMemory']) is bool, 'RESOURCE_POLICY_INVALID')
    return value


def configure(revision, enabled):
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    require(type(revision) is int and type(enabled) is bool)
    with cli_guard.lease('configuration', exclusive=True):
        current = policy()
        require(revision == current['revision'], 'RESOURCE_POLICY_CHANGED')
        ROOT.mkdir(mode=0o755, exist_ok=True)
        os.chmod(ROOT, 0o755)
        value = dict(revision=revision+1, autoMemory=enabled)
        temporary = ROOT / ('.pending-' + uuid.uuid4().hex)
        try:
            with os.fdopen(os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644), 'w') as stream:
                os.fchmod(stream.fileno(), 0o644)
                json.dump(value, stream); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary, ROOT / 'resources.json')
            descriptor = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            temporary.unlink(missing_ok=True)
        require(policy() == value, 'RESOURCE_POLICY_UNCONFIRMED')
        return value


def broker_call(method, extra=None):
    # No account profiles, login material or native chat databases are read here.
    import setup
    if not os.path.lexists(CONFIG) or not os.path.lexists(SOCKET):
        return dict(available=False, closed=[], interrupted=[], protected=0)
    config = setup.public_json(CONFIG)
    parent = Path(SOCKET).parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == config['ownerUid'] and not parent.st_mode & 0o022, 'RESOURCE_BROKER_UNAVAILABLE')
    with socket.socket(socket.AF_UNIX) as channel:
        channel.settimeout(30)
        channel.connect(SOCKET)
        require(struct.unpack('3i', channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] == config['ownerUid'], 'RESOURCE_BROKER_UNAVAILABLE')
        params = dict(authorityId=config['authorityId'], generation=config['generation'], **(extra or {}))
        channel.sendall((json.dumps(dict(protocol=1, method=method, params=params)) + '\n').encode())
        response = json.loads(channel.makefile('rb').readline(4*1024*1024+1))
        require(response.get('ok') is True, response.get('error') if str(response.get('error', '')).startswith('STORAGE_') else 'RESOURCE_BROKER_UNAVAILABLE')
        return dict(available=True, **response['value'])


def pressure(value):
    memory = value['memory']
    # Headroom reserves do not reserve physical memory or guarantee against OOM.
    return memory['available'] < min(memory['total']*.25, max(256*1024*1024, memory['total']*.15))


def disk_headroom(folder='/', additional=0):
    volume = os.statvfs(folder)
    total, available = volume.f_blocks*volume.f_frsize, volume.f_bavail*volume.f_frsize
    return available-additional >= min(2*1024**3, total*.1)


def dispatch(request):
    try:
        require(os.geteuid() == 0, 'ADMIN_REQUIRED')
        method = request.get('method')
        if method == 'resources/read':
            try:
                runtime = broker_call('maintenance/resources')
            except Exception:
                runtime = dict(available=False, error='RESOURCE_BROKER_UNAVAILABLE')
            value = dict(metrics(), policy=policy(), runtime=runtime)
        elif method == 'resources/configure':
            value = configure(request.get('revision'), request.get('autoMemory'))
        elif method == 'resources/reclaim':
            value = dict(result=broker_call('maintenance/reclaim'), **metrics())
        else:
            raise RuntimeError('RESOURCE_REQUEST_INVALID')
        return dict(ok=True, value=value)
    except Exception as error:
        return dict(ok=False, error=str(error) if isinstance(error, RuntimeError) else 'RESOURCE_OPERATION_UNCONFIRMED')
