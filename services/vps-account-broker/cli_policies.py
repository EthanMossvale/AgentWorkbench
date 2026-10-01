"""Explicit per-runtime maintenance preferences. No settings are stored in CLI homes."""
import json
import os
from pathlib import Path
import stat
import time
import uuid
import cli_guard

ROOT = Path('/var/lib/agent-workbench-cli-policies')
PROVIDERS = ('codex', 'claude')


def require(value, code='CLI_POLICY_INVALID'):
    if not value:
        raise RuntimeError(code)


def safe_root(create=False):
    if create:
        ROOT.mkdir(mode=0o755, parents=False, exist_ok=True)
    if not ROOT.exists():
        return False
    info = ROOT.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
    return True


def read(provider):
    require(provider in PROVIDERS)
    result = dict(revision=0, autoUpdate=False, reclaimIdle=False, idleHours=24)
    if not safe_root() or not (ROOT / (provider + '.json')).exists():
        return result
    descriptor = os.open(ROOT / (provider + '.json'), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'r') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077 and info.st_size < 8192)
        value = json.load(stream)
    require(type(value.get('revision')) is int and value['revision'] >= 0 and all(type(value.get(k)) is bool for k in ('autoUpdate', 'reclaimIdle')) and type(value.get('idleHours')) is int and 1 <= value['idleHours'] <= 8760)
    require(set(value) <= {'revision', 'autoUpdate', 'reclaimIdle', 'idleHours', 'lastUpdateAttempt', 'lastUpdateError'})
    return value


def write(provider, value):
    safe_root(True)
    target = ROOT / (provider + '.json')
    temporary = ROOT / ('.pending-' + uuid.uuid4().hex)
    try:
        with open(os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600), 'w') as stream:
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        descriptor = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def configure(provider, revision, changes):
    require(provider in PROVIDERS and type(revision) is int and isinstance(changes, dict) and changes and set(changes) <= {'autoUpdate', 'reclaimIdle', 'idleHours'} and all(type(v) is int and 1 <= v <= 8760 if k == 'idleHours' else type(v) is bool for k, v in changes.items()))
    with cli_guard.lease('configuration', exclusive=True):
        current = read(provider)
        require(current['revision'] == revision, 'CLI_POLICY_CHANGED')
        value = dict(current, **changes)
        value['revision'] += 1
        write(provider, value)
        require(read(provider) == value, 'CLI_POLICY_UNCONFIRMED')
        return value


def claim_update(provider, now=None):
    now = time.time() if now is None else now
    with cli_guard.lease('configuration', exclusive=True):
        current = read(provider)
        if not current['autoUpdate'] or now - current.get('lastUpdateAttempt', 0) < 86400:
            return False
        current.update(lastUpdateAttempt=now)
        current.pop('lastUpdateError', None)
        write(provider, current)
        return True
