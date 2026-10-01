"""Explicit destruction of one verified workspace identity and its private home.

No credential contents are inspected. Shared runtimes and other homes are never
traversed. The SSH-only retirement exception is stored as protected public metadata.
"""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import time

from security import ControlError, trusted_root_path

SSH_ONLY = '/var/lib/agent-workbench-policy/ssh-only-members.json'


def reserved_members():
    if not os.path.lexists(SSH_ONLY):
        return []
    trusted_root_path(SSH_ONLY)
    info = os.stat(SSH_ONLY)
    if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
        raise ControlError('UNSAFE_DEPLOYMENT')
    with open(SSH_ONLY) as source:
        value = json.load(source)
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('members'), list):
        raise ControlError('UNSAFE_DEPLOYMENT')
    return value['members']


def require_workspace_identity(username):
    if any(row.get('username') == username for row in reserved_members()):
        raise ControlError('SSH_IDENTITY_RESERVED')


def no_mounts(home):
    # Device numbers alone do not catch bind mounts on the same filesystem.
    with open('/proc/self/mountinfo') as source:
        for line in source:
            mount = line.split()[4]
            for escaped, literal in (('\\040', ' '), ('\\011', '\t'), ('\\012', '\n'), ('\\134', '\\')):
                mount = mount.replace(escaped, literal)
            if mount == home or mount.startswith(home + '/'):
                raise ControlError('WORKSPACE_MOUNT_PRESENT')


def allocation(home):
    total, seen = 0, set()
    for directory, dirs, files in os.walk(home, followlinks=False):
        for name in [''] + dirs + files:
            try:
                info = os.lstat(os.path.join(directory, name) if name else directory)
            except FileNotFoundError:
                continue
            key = (info.st_dev, info.st_ino)
            if key not in seen:
                seen.add(key)
                total += info.st_blocks * 512
    return total


def inspect(provisioner, workspace):
    require_workspace_identity(workspace['username'])
    user = provisioner.user(workspace['username'])
    home = provisioner.home_parent + '/' + workspace['username']
    if not user or user['uid'] != workspace['uid'] or user['home'] != home or workspace['root'] not in (home, home + '/workspaces'):
        raise ControlError('UNSAFE_DELETION_TARGET')
    trusted_root_path(provisioner.home_parent, directory=True)
    info = os.lstat(home)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != user['uid'] or info.st_mode & 0o022:
        raise ControlError('UNSAFE_DELETION_TARGET')
    no_mounts(home)
    return dict(mode='destroy', username=user['username'], uid=user['uid'], gid=user['gid'], home=home,
                root=workspace['root'], device=info.st_dev, inode=info.st_ino, storageBytes=allocation(home))


def processes(uid):
    result = []
    for entry in Path('/proc').iterdir():
        if entry.name.isdigit():
            try:
                if entry.stat().st_uid == uid:
                    result.append(int(entry.name))
            except FileNotFoundError:
                pass
    return result


def signal_members(uid, sig):
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        if processes(uid):
            raise ControlError('WORKSPACE_PROCESS_CONTROL_UNAVAILABLE')
        return
    for pid in processes(uid):
        descriptor = None
        try:
            descriptor = os.pidfd_open(pid)
            if Path('/proc', str(pid)).stat().st_uid == uid:
                signal.pidfd_send_signal(descriptor, sig)
        except (ProcessLookupError, FileNotFoundError):
            pass
        finally:
            if descriptor is not None:
                os.close(descriptor)


def command(binary, args):
    binary = trusted_root_path(binary, executable=True, allow_symlinks=True)
    result = subprocess.run([binary, *args], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=30,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
    if result.returncode:
        raise ControlError('DESTRUCTION_UNCONFIRMED')


def destroy(provisioner, workspace, expected, operation_id):
    provisioner._root()
    if not isinstance(operation_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', operation_id):
        raise ControlError('INVALID_REQUEST')
    if not isinstance(expected, dict) or expected.get('mode') != 'destroy':
        raise ControlError('DELETION_PLAN_REQUIRED')
    current = inspect(provisioner, workspace)
    identity = ('mode', 'username', 'uid', 'gid', 'home', 'root', 'device', 'inode')
    if any(current[key] != expected.get(key) for key in identity):
        raise ControlError('DISCOVERY_CHANGED')
    if not shutil.rmtree.avoids_symlink_attacks:
        raise ControlError('UNSAFE_DELETION_TARGET')
    # Account expiry also blocks key-based new sessions. Lock alone is insufficient.
    command('/usr/sbin/usermod', ['--expiredate', '1970-01-02', '--lock', '--', current['username']])
    if Path('/run/systemd/system').exists() and Path('/usr/bin/loginctl').exists():
        command('/usr/bin/loginctl', ['disable-linger', current['username']])
        # This terminates only this workspace's user manager and sessions.
        subprocess.run(['/usr/bin/loginctl', 'terminate-user', str(current['uid'])], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
    signal_members(current['uid'], signal.SIGTERM)
    for _ in range(20):
        if not processes(current['uid']):
            break
        time.sleep(.1)
    signal_members(current['uid'], signal.SIGKILL)
    for _ in range(20):
        if not processes(current['uid']):
            break
        time.sleep(.1)
    if processes(current['uid']):
        raise ControlError('WORKSPACE_PROCESSES_REMAIN')
    # The guarded parent prevents the retired UID from replacing the removal root.
    current_again = inspect(provisioner, workspace)
    if any(current_again[key] != current[key] for key in identity):
        raise ControlError('DISCOVERY_CHANGED')
    holding = provisioner.home_parent + '/.awb-destroy-' + operation_id
    os.mkdir(holding, 0o700)
    target = holding + '/home'
    os.rename(current['home'], target)
    moved = os.lstat(target)
    if (moved.st_dev, moved.st_ino) != (current['device'], current['inode']):
        raise ControlError('DISCOVERY_CHANGED')
    # userdel performs identity bookkeeping only; recursive deletion is scoped here.
    command('/usr/sbin/userdel', ['--', current['username']])
    if provisioner.user(current['username']) is not None:
        raise ControlError('DESTRUCTION_UNCONFIRMED')
    no_mounts(target)
    shutil.rmtree(target)
    os.rmdir(holding)
    if os.path.lexists(current['home']):
        raise ControlError('DESTRUCTION_UNCONFIRMED')
    return {'kind': 'purged', 'home': current['home'], 'storageBytes': current_again['storageBytes']}
