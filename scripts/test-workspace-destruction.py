"""Real local Linux lifecycle acceptance using disposable users only."""
import grp
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tempfile
import uuid
import importlib.util
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/vps-workspace-control'))
import destruction
from provisioner import LinuxProvisioner
from security import ControlError

assert os.geteuid() == 0
name = 'awb-del-' + uuid.uuid4().hex[:10]
home = Path('/home') / name
assert not home.exists()
adapter = LinuxProvisioner()
checks = []


def rejected(code, action):
    try:
        action()
    except ControlError as error:
        assert error.code == code, (error.code, code)
    else:
        raise AssertionError('Expected ' + code)


try:
    user = adapter.create(name, str(home / 'workspaces'))
    workspace = dict(username=name, uid=user['uid'], root=str(home / 'workspaces'))
    with tempfile.TemporaryDirectory(prefix='awb-destroy-sentinel-', dir='/opt') as temporary:
        sentinel = Path(temporary) / 'keep.txt'
        sentinel.write_text('other workspace and shared runtime sentinel')
        (home / 'workspaces' / 'outside').symlink_to(temporary, target_is_directory=True)
        (home / 'workspaces' / 'payload').write_bytes(b'x' * 1048576)
        (home / '.ssh').mkdir(mode=0o700)
        (home / '.ssh' / 'authorized_keys').write_text('synthetic retired authorization\n')
        plan = adapter.deletion_plan(workspace)
        assert plan['home'] == str(home) and plan['storageBytes'] >= 1048576
        assert pwd.getpwnam(name).pw_uid == user['uid'] and sentinel.read_text().startswith('other workspace')
        checks.append('preview measures the full home without mutating it')
        rejected('UNSAFE_DELETION_TARGET', lambda: adapter.deletion_plan(dict(workspace, uid=0)))
        rejected('UNSAFE_DELETION_TARGET', lambda: adapter.deletion_plan(dict(workspace, root='/opt')))
        checks.append('changed UID and external deletion roots reject')
        with patch.object(destruction, 'reserved_members', lambda: [dict(username=name, uid=user['uid'], home=str(home))]):
            rejected('SSH_IDENTITY_RESERVED', lambda: adapter.deletion_plan(workspace))
            rejected('SSH_IDENTITY_RESERVED', lambda: adapter.adopt(name, user['uid'], workspace['root']))
        checks.append('SSH-only identities cannot be adopted or destroyed')
        with patch('builtins.open', side_effect=lambda *a, **k: __import__('io').StringIO('1 2 0:1 / ' + str(home / 'workspaces') + ' rw - tmpfs tmpfs rw\n')):
            rejected('WORKSPACE_MOUNT_PRESENT', lambda: destruction.no_mounts(str(home)))
        checks.append('same-device bind mount metadata rejects')
        wrong = dict(plan, inode=plan['inode'] + 1)
        rejected('DISCOVERY_CHANGED', lambda: adapter.destroy(workspace, wrong, uuid.uuid4().hex))
        assert pwd.getpwnam(name).pw_uid == user['uid']
        checks.append('changed home identity rejects before account expiry')
        rejected('INVALID_REQUEST', lambda: adapter.destroy(workspace, plan, '../../outside'))
        assert pwd.getpwnam(name).pw_uid == user['uid']
        checks.append('invalid holding-directory operation ID rejects before side effects')
        sleeper = subprocess.Popen(['/usr/sbin/runuser', '-u', name, '--', '/usr/bin/sleep', '120'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        import time
        time.sleep(.2)
        result = adapter.destroy(workspace, plan, uuid.uuid4().hex)
        sleeper.wait(timeout=10)
        assert result['kind'] == 'purged' and not home.exists()
        assert not destruction.processes(user['uid'])
        checks.append('actual deletion stops only the target user processes and removes the entire home')
        try:
            pwd.getpwnam(name)
            raise AssertionError('User still exists')
        except KeyError:
            pass
        checks.append('actual Unix user and its SSH authorization no longer exist')
        assert sentinel.read_text() == 'other workspace and shared runtime sentinel'
        checks.append('external symlink target and shared data remain unchanged')
        recreated = adapter.create(name, workspace['root'])
        assert (home / 'workspaces').is_dir() and not (home / '.ssh').exists()
        assert not (home / 'workspaces' / 'payload').exists()
        checks.append('same name recreation starts with empty data and no old SSH grants')
        workspace['uid'] = recreated['uid']
        adapter.destroy(workspace, adapter.deletion_plan(workspace), uuid.uuid4().hex)
        checks.append('a newly recreated workspace is also fully destroyed')
        spec = importlib.util.spec_from_file_location('legacy_retire', Path(__file__).with_name('retire-legacy-ssh-spaces.py'))
        retire = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(retire)
        legacy = adapter.create(name, workspace['root'])
        workspace['uid'] = legacy['uid']
        (home / '.ssh').mkdir(mode=0o700)
        keys = home / '.ssh/authorized_keys'
        keys.write_text('synthetic sing-box authorization\n')
        (home / '.cache').mkdir()
        (home / '.cache/data').write_bytes(b'old data' * 1000)
        (home / 'workspaces/outside').symlink_to(temporary, target_is_directory=True)
        protected = str(Path(temporary) / 'ssh-only-members.json')
        with patch.object(retire, 'SSH_ONLY', protected), patch.object(destruction, 'SSH_ONLY', protected):
            preview = retire.dispatch(dict(method='plan', users=[name]))
            before = keys.stat()
            result = retire.dispatch(dict(method='apply', plan=preview, confirmDestroyDataPreserveSsh=True))
            assert result['applied'] and result['spaces'][0]['workspaceRemoved']
            assert pwd.getpwnam(name).pw_uid == legacy['uid']
            assert keys.stat().st_ino == before.st_ino and keys.read_text() == 'synthetic sing-box authorization\n'
            assert not (home / '.cache').exists() and sentinel.exists()
            checks.append('legacy retirement actually frees data while preserving the user and exact SSH file')
            rejected('SSH_IDENTITY_RESERVED', lambda: adapter.observe(name, workspace['root']))
            checks.append('retired sing-box identity is reserved against new workspace operations')
        (home / 'workspaces').mkdir()
        os.chown(home / 'workspaces', legacy['uid'], legacy['gid'])
        adapter.destroy(workspace, adapter.deletion_plan(workspace), uuid.uuid4().hex)
    Path(sys.argv[1]).write_text(json.dumps(dict(localLinux=True, realUsers=True, remoteChanges=False, checks=checks, passed=len(checks)), indent=2))
    print(json.dumps(dict(passed=len(checks))))
finally:
    # Restrict failure cleanup to the exact disposable test identity and home.
    try:
        remaining = pwd.getpwnam(name)
    except KeyError:
        remaining = None
    if remaining:
        subprocess.run(['/usr/bin/pkill', '-KILL', '-u', str(remaining.pw_uid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['/usr/sbin/userdel', '--', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if home.is_dir() and not home.is_symlink():
        shutil.rmtree(home)
