"""Explicit, previewed setup of the single native account owner.

Inspection is read-only. Apply never imports credentials, changes member users,
replaces native CLIs, touches another broker, or starts a model/login request.
Only absent or byte-identical workbench deployment files can be installed.
Interrupted installation can be inspected and resumed without overwriting data.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import struct
import subprocess
import time
import native_install
import cli_guard

OWNER = 'agent-workbench-accounts'
ROOT = '/var/lib/agent-workbench-accounts'
CODE = '/opt/agent-workbench/account-runtime'
CONFIG = '/etc/agent-workbench/accounts.json'
UNIT = '/etc/systemd/system/agent-workbench-accounts.service'
SOCKET = '/run/agent-workbench-accounts/broker.sock'
LOCK = '/run/agent-workbench-account-setup.lock'
POLICIES = ['/var/lib/agent-workbench-policy/workspaces.json', '/var/lib/agent-workbench-control-policy/workspaces.json']
FILES = ['broker.py', 'native_worker.py', 'runtime.py', 'claude_session.py', 'runtime_maintenance.py', 'resources.py', 'remote_files.py', 'session_storage.py', 'session_manifest.py', 'session_idle.py', 'usage.py', 'migration.py', 'migrate_legacy.py', 'native_install.py', 'cli_guard.py', 'cli_management.py', 'cli_policies.py', 'account_admin.py']


class SetupError(Exception):
    pass


def require(ok, code='UNSAFE_DEPLOYMENT'):
    if not ok:
        raise SetupError(code)


def trusted(path, owner=0, private=False, missing=False):
    """Walk every component without accepting a writable or symlink ancestor."""
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts)
    for item in [*reversed(path.parents), path]:
        try:
            info = item.lstat()
        except FileNotFoundError:
            require(missing)
            continue
        final = item == path
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid == (owner if final else 0) and not info.st_mode & 0o022)
        require(stat.S_ISDIR(info.st_mode) or final and stat.S_ISREG(info.st_mode))
        if final and private:
            require(not info.st_mode & 0o077)
    return path


def public_json(path):
    path = trusted(path)
    require(path.stat().st_size <= 1048576)
    with open(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'r') as source:
        return json.load(source)


def authority():
    policies = [(p, public_json(p)) for p in POLICIES if os.path.lexists(p)]
    if policies:
        pairs = {(v.get('authorityId'), v.get('generation')) for _, v in policies}
        require(len(pairs) == 1, 'POLICY_CONFLICT')
        pair = next(iter(pairs))
        require(all(isinstance(x, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', x) for x in pair))
        return pair[0], pair[1], policies[0][0]
    # A separately installed control authority must publish its own policy.
    require(not os.path.lexists('/run/agent-workbench-control/control.sock'), 'POLICY_REQUIRED')
    path = trusted('/etc/ssh/ssh_host_ed25519_key.pub')
    require(path.stat().st_size <= 8192)
    key = ' '.join(path.read_text().split()[:2])
    require(key.startswith('ssh-ed25519 '), 'HOST_KEY_REQUIRED')
    return 'ssh-control-' + hashlib.sha256(key.encode()).hexdigest()[:32], 'ssh-control-v1', POLICIES[0]


def native_catalog():
    if not os.path.lexists(SOCKET):
        return None
    parent = Path(SOCKET).parent.lstat()
    entry = Path(SOCKET).lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid > 0 and not parent.st_mode & 0o022)
    require(stat.S_ISSOCK(entry.st_mode) and entry.st_uid == parent.st_uid)
    with socket.socket(socket.AF_UNIX) as channel:
        channel.settimeout(3)
        channel.connect(SOCKET)
        require(struct.unpack('3i', channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] == parent.st_uid)
        channel.sendall(b'{"protocol":1,"method":"catalog/list","params":{}}\n')
        raw = channel.makefile('rb').readline(1048577)
        require(len(raw) <= 1048576)
        result = json.loads(raw)
        require(result.get('ok') is True and result.get('value', {}).get('source') == 'native-owner')
        return {k: result['value'][k] for k in ('authorityId', 'generation')}


def binary(provider, detected):
    candidate, observations = native_install.discover(provider)
    detected.extend(observations)
    return candidate


def owner():
    try:
        entry = pwd.getpwnam(OWNER)
    except KeyError:
        return None
    require(entry.pw_uid > 0 and entry.pw_dir == ROOT and entry.pw_shell in ('/usr/sbin/nologin', '/sbin/nologin', '/bin/false'), 'OWNER_CONFLICT')
    return entry


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def deployment(sources, entry, identity, binaries):
    require(set(sources) == set(FILES + ['agent-workbench-accounts.service']), 'INVALID_BUNDLE')
    require(all(isinstance(v, str) and len(v) < 524288 and v.isascii() for v in sources.values()), 'INVALID_BUNDLE')
    config = dict(authorityId=identity[0], generation=identity[1], ownerUid=entry.pw_uid if entry else None,
                  root=ROOT, workspacePolicyFile=identity[2], codexExecutable=binaries.get('codex', ''), socketAccess='peer-policy')
    if binaries.get('claude'):
        config['claudeExecutable'] = binaries['claude']
    return config, {**{CODE + '/' + name: sources[name] for name in FILES}, UNIT: sources['agent-workbench-accounts.service']}


def inspect(sources):
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    plan = dict(status='blocked', blockers=[], warnings=[], paths=[CODE, CONFIG, ROOT, UNIT], owner=OWNER, binaries={}, downloads=[], detected=[])
    try:
        active = native_catalog()
        if active:
            return dict(plan, status='ready', **active)
    except (OSError, ValueError, KeyError, TypeError, SetupError):
        # Never replace an existing socket/owner with another registry.
        return dict(plan, blockers=['EXISTING_SERVICE_UNAVAILABLE'])
    try:
        require(Path('/run/systemd/system').is_dir(), 'SYSTEMD_REQUIRED')
        identity = authority()
        entry = owner()
        require(not any(os.path.lexists(p) for p in [UNIT + '.d', '/run/systemd/system/agent-workbench-accounts.service', '/run/systemd/system/agent-workbench-accounts.service.d']), 'EXISTING_DEPLOYMENT_CHANGED')
        if entry:
            for policy_path in POLICIES:
                if os.path.lexists(policy_path):
                    require(all(row.get('uid') != entry.pw_uid for row in public_json(policy_path).get('workspaces', [])), 'OWNER_CONFLICT')
        for provider in ('codex', 'claude'):
            try:
                plan['binaries'][provider] = binary(provider, plan['detected'])
            except (OSError, RuntimeError, SetupError, native_install.InstallError, subprocess.SubprocessError) as error:
                plan['warnings'].append(str(error) if isinstance(error, (SetupError, native_install.InstallError)) else 'CLI_PROBE_FAILED_' + provider.upper())
                plan['detected'].extend(getattr(error, 'detected', []))
                item = native_install.artifact(provider)
                plan['downloads'].append(item)
                plan['binaries'][provider] = item['target']
                plan['paths'].append(str(Path(item['target']).parent))
        require(plan['binaries'], 'NATIVE_CLI_REQUIRED')
        config, files = deployment(sources, entry, identity, plan['binaries'])
        snapshot = [native_install.target_snapshot(item, trusted) for item in plan['downloads']]
        for target, content in files.items():
            path = trusted(target, missing=True)
            present = path.exists()
            if present:
                require(path.stat().st_nlink == 1 and path.stat().st_size == len(content.encode()) and path.read_bytes() == content.encode(), 'EXISTING_DEPLOYMENT_CHANGED')
            snapshot.append([target, present, digest(content)])
        path = trusted(CONFIG, missing=True)
        if path.exists():
            require(entry and public_json(CONFIG) == config, 'EXISTING_DEPLOYMENT_CHANGED')
        snapshot.append([CONFIG, path.exists(), config])
        # Only inspect metadata of private directories, never authentication files.
        for target in [ROOT, ROOT + '/profiles']:
            if os.path.lexists(target):
                require(entry is not None, 'OWNER_CONFLICT')
                # profiles has a private owner-controlled parent, unlike code/config.
                info = Path(target).lstat()
                require(stat.S_ISDIR(info.st_mode) and info.st_uid == entry.pw_uid and not info.st_mode & 0o077)
                require(not Path(target).is_symlink())
            snapshot.append([target, os.path.lexists(target)])
        trusted(Path(ROOT).parent)
        plan.update(status='installable', authorityId=identity[0], generation=identity[1], policyPath=identity[2],
                    createOwner=entry is None, planId=digest([snapshot, identity, plan['binaries'], plan['downloads'], entry.pw_uid if entry else None]))
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RuntimeError, SetupError, native_install.InstallError, subprocess.SubprocessError) as error:
        plan['blockers'].append(str(error) if isinstance(error, (SetupError, native_install.InstallError)) else 'PREFLIGHT_FAILED')
    return plan


def ensure_directory(path, mode=0o755):
    if not Path(path).exists():
        ensure_directory(str(Path(path).parent))
        os.mkdir(path, mode)
    trusted(path)


def write_new(path, content, mode=0o644):
    ensure_directory(str(Path(path).parent))
    if os.path.lexists(path):
        trusted(path)
        require(Path(path).read_bytes() == content.encode(), 'EXISTING_DEPLOYMENT_CHANGED')
        return
    temporary = path + '.setup-' + str(os.getpid())
    with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode), 'w') as target:
        target.write(content)
        target.flush()
        os.fsync(target.fileno())
    # Link is atomic and refuses to replace a concurrent or foreign target.
    try:
        os.link(temporary, path, follow_symlinks=False)
    finally:
        os.unlink(temporary)


def apply(sources, expected):
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    trusted('/run')
    descriptor = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        plan = inspect(sources)
        require(plan['status'] == 'installable' and plan.get('planId') == expected, 'PLAN_CHANGED')
        # Only this confirmed branch may download a pinned official artifact.
        # Failures preserve existing CLIs, login profiles and member identities.
        for item in plan['downloads']:
            with cli_guard.lease(item['provider'], exclusive=True):
                native_install.install(item, trusted, ensure_directory, write_new)
        for provider in plan['binaries']:
            with cli_guard.lease(provider, exclusive=True):
                pass
        if plan['createOwner']:
            subprocess.run(['/usr/sbin/useradd', '--system', '--user-group', '--home-dir', ROOT, '--shell', '/usr/sbin/nologin', '--no-create-home', OWNER], check=True, capture_output=True, timeout=15)
        entry = owner()
        require(entry is not None)
        for target in [ROOT, ROOT + '/profiles']:
            if not os.path.lexists(target):
                os.mkdir(target, 0o700)
                os.chown(target, entry.pw_uid, entry.pw_gid)
        config, files = deployment(sources, entry, (plan['authorityId'], plan['generation'], plan['policyPath']), plan['binaries'])
        for target, content in files.items():
            write_new(target, content)
        if os.path.lexists(CONFIG):
            require(public_json(CONFIG) == config, 'EXISTING_DEPLOYMENT_CHANGED')
        else:
            write_new(CONFIG, json.dumps(config, sort_keys=True, separators=(',', ':')) + '\n')
        # This exact managed unit is the only service changed by setup.
        subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True, capture_output=True, timeout=15)
        subprocess.run(['/usr/bin/systemctl', 'enable', '--now', 'agent-workbench-accounts.service'], check=True, capture_output=True, timeout=25)
        for _ in range(20):
            try:
                result = native_catalog()
                if result:
                    require(result == dict(authorityId=plan['authorityId'], generation=plan['generation']), 'AUTHORITY_CHANGED')
                    return dict(status='ready', **result)
            except (OSError, ValueError):
                pass
            time.sleep(.25)
        raise SetupError('START_UNCONFIRMED')
    finally:
        os.close(descriptor)


def dispatch(request, sources):
    try:
        require(isinstance(request, dict) and request.get('method') in ('plan', 'apply'), 'INVALID_REQUEST')
        result = inspect(sources) if request['method'] == 'plan' else apply(sources, request.get('planId'))
        return {'ok': True, 'value': result}
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RuntimeError, SetupError, native_install.InstallError, subprocess.SubprocessError) as error:
        return {'ok': False, 'error': str(error) if isinstance(error, (SetupError, native_install.InstallError)) else 'SETUP_UNCONFIRMED'}
