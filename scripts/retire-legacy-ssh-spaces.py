"""Explicit one-time data retirement while preserving existing SSH identities.

Plan/apply input is supplied by the operator. Only metadata is returned; login
files and key contents are never read. No SSH daemon or account setting changes.
"""
import copy
import json
import os
from pathlib import Path
import pwd
import shutil
import signal
import stat
import sys
import time
import uuid

if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/vps-workspace-control'))
from control import atomic_json
from destruction import SSH_ONLY, allocation, no_mounts, reserved_members
from security import ControlError, USERNAME, trusted_root_path

KEEP = {'.ssh', '.bashrc', '.bash_profile', '.bash_logout', '.profile'}


def fingerprint(path):
    item = os.lstat(path)
    return [item.st_dev, item.st_ino, item.st_uid, item.st_gid, stat.S_IFMT(item.st_mode)]


def plan(names):
    if os.geteuid() != 0 or not isinstance(names, list) or not 1 <= len(names) <= 32 or len(set(names)) != len(names):
        raise ControlError('INVALID_REQUEST')
    trusted_root_path('/home', directory=True)
    spaces = []
    for name in names:
        if not isinstance(name, str) or not USERNAME.fullmatch(name):
            raise ControlError('INVALID_REQUEST')
        user = pwd.getpwnam(name)
        home = '/home/' + name
        if user.pw_uid < 1000 or user.pw_dir != home or os.path.islink(home) or os.stat(home).st_uid != user.pw_uid:
            raise ControlError('UNSAFE_DELETION_TARGET')
        no_mounts(home)
        ssh = home + '/.ssh'
        key = ssh + '/authorized_keys'
        if os.path.islink(ssh) or not stat.S_ISDIR(os.lstat(ssh).st_mode) or not stat.S_ISREG(os.lstat(key).st_mode):
            raise ControlError('UNSAFE_AUTHORIZED_KEYS')
        authorization = fingerprint(key) + [os.lstat(key).st_size, os.lstat(key).st_mtime_ns]
        entries = {p.name: fingerprint(p) for p in sorted(Path(home).iterdir()) if p.name not in KEEP}
        spaces.append(dict(username=name, uid=user.pw_uid, gid=user.pw_gid, home=home, shell=user.pw_shell,
                           identity=fingerprint(home), sshIdentity=fingerprint(ssh), authorization=authorization,
                           entries=entries, storageBytes=allocation(home)))
    return dict(version=1, spaces=spaces)


def retired_processes(spaces):
    found = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            uid = entry.stat().st_uid
            exe, cwd = os.readlink(entry / 'exe'), os.readlink(entry / 'cwd')
            comm = (entry / 'comm').read_text().strip()
            for space in spaces:
                inside = exe.startswith(space['home'] + '/') or any(cwd == space['home'] + '/' + name or cwd.startswith(space['home'] + '/' + name + '/') for name in space['entries'])
                browser = uid == space['uid'] and (comm == 'Xvnc' or comm.startswith('chrome') or comm.startswith('python') and cwd == '/opt/codex-remote-login/noVNC-1.6.0')
                if inside or browser:
                    if uid != space['uid']:
                        raise ControlError('EXTERNAL_PROCESS_DEPENDENCY')
                    found.append((int(entry.name), uid))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return found


def stop_retired(spaces):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid, uid in retired_processes(spaces):
            descriptor = None
            try:
                descriptor = os.pidfd_open(pid)
                if Path('/proc', str(pid)).stat().st_uid == uid:
                    signal.pidfd_send_signal(descriptor, sig)
            except (FileNotFoundError, ProcessLookupError):
                pass
            finally:
                if descriptor is not None:
                    os.close(descriptor)
        for _ in range(20):
            if not retired_processes(spaces):
                return
            time.sleep(.1)
    raise ControlError('LEGACY_PROCESSES_REMAIN')


def apply(expected):
    current = plan([row['username'] for row in expected['spaces']])
    def binding(value):
        result = copy.deepcopy(value)
        for row in result['spaces']:
            row.pop('storageBytes', None)
        return result
    if binding(current) != binding(expected):
        raise ControlError('DISCOVERY_CHANGED')
    if not shutil.rmtree.avoids_symlink_attacks:
        raise ControlError('UNSAFE_DELETION_TARGET')
    retired_processes(current['spaces'])  # all cross-user dependencies checked before writes
    previous = reserved_members()
    names = {row['username'] for row in current['spaces']}
    retained = [row for row in previous if row['username'] not in names]
    reserved = [dict(username=row['username'], uid=row['uid'], home=row['home'], purpose='ssh-only') for row in current['spaces']]
    parent = str(Path(SSH_ONLY).parent)
    trusted_root_path(str(Path(parent).parent), directory=True)
    if not os.path.lexists(parent):
        os.mkdir(parent, 0o755)
    trusted_root_path(parent, directory=True)
    if os.path.lexists(SSH_ONLY):
        trusted_root_path(SSH_ONLY)
    atomic_json(SSH_ONLY, dict(version=1, members=retained + reserved), mode=0o644)
    stop_retired(current['spaces'])
    results = []
    holding = '/home/.awb-retire-' + uuid.uuid4().hex
    os.mkdir(holding, 0o700)
    for row in current['spaces']:
        home = row['home']
        if fingerprint(home) != row['identity'] or pwd.getpwnam(row['username']).pw_uid != row['uid']:
            raise ControlError('DISCOVERY_CHANGED')
        no_mounts(home)
        destination = holding + '/' + row['username']
        os.mkdir(destination, 0o700)
        for name, identity in row['entries'].items():
            source = home + '/' + name
            if fingerprint(source) != identity:
                raise ControlError('DISCOVERY_CHANGED')
            os.rename(source, destination + '/' + name)
            if fingerprint(destination + '/' + name) != identity:
                raise ControlError('DISCOVERY_CHANGED')
        no_mounts(destination)
        shutil.rmtree(destination)
        key = home + '/.ssh/authorized_keys'
        after = fingerprint(key) + [os.lstat(key).st_size, os.lstat(key).st_mtime_ns]
        if after != row['authorization'] or fingerprint(home + '/.ssh') != row['sshIdentity']:
            raise ControlError('SSH_PRESERVATION_UNCONFIRMED')
        if any(p.name not in KEEP for p in Path(home).iterdir()):
            raise ControlError('LEGACY_DATA_RECREATED')
        user = pwd.getpwnam(row['username'])
        if (user.pw_uid, user.pw_gid, user.pw_dir, user.pw_shell) != (row['uid'], row['gid'], home, row['shell']):
            raise ControlError('SSH_PRESERVATION_UNCONFIRMED')
        results.append(dict(username=row['username'], beforeBytes=row['storageBytes'], afterBytes=allocation(home),
                            sshMetadataUnchanged=True, userUnchanged=True, workspaceRemoved=not os.path.lexists(home + '/workspaces')))
    os.rmdir(holding)
    return dict(applied=True, spaces=results, sshOnlyRegistry=SSH_ONLY)


def dispatch(request):
    if request.get('method') == 'plan':
        return plan(request['users'])
    if request.get('method') == 'apply' and request.get('confirmDestroyDataPreserveSsh') is True:
        return apply(request['plan'])
    raise ControlError('INVALID_REQUEST')


if __name__ == '__main__':
    print(json.dumps(dispatch(json.load(sys.stdin)), separators=(',', ':')))
