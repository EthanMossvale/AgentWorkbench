"""Preview-bound lifecycle of public workbench service files, never credentials.

This module runs from the desktop bundle over explicit administrator SSH. It is
not a model tool. Native CLIs, accounts, profiles and workspace policies survive
removal. Public source backups and the operation journal are root owned.
"""
from contextlib import ExitStack
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import time
import uuid
import setup
import cli_guard
import cli_management
import native_install

STATE = '/var/lib/agent-workbench-configuration'
SERVICE = 'agent-workbench-accounts.service'
PRESERVES = ['native-cli-programs', 'accounts-and-login-profiles', 'workspaces', 'ssh-authorization', 'service-identity-and-settings']
RELEASE = None


def require(ok, code='CONFIG_FOREIGN'):
    if not ok:
        raise setup.SetupError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_file(name):
    target = setup.trusted(name, missing=True)
    if not target.exists():
        return None
    info = target.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size < 1048576)
    return target.read_bytes()


def systemctl(*args, check=True):
    return subprocess.run(['/usr/bin/systemctl', *args], capture_output=True, check=check, timeout=25)


def service_state():
    result = systemctl('show', SERVICE, '--property=LoadState,ActiveState,UnitFileState,FragmentPath,MainPID,ControlGroup,DropInPaths,NeedDaemonReload')
    values = dict(line.split('=', 1) for line in result.stdout.decode().splitlines() if '=' in line)
    require(values.get('LoadState') in ('loaded', 'not-found'), 'CONFIG_FOREIGN')
    require(values.get('ActiveState') in ('active', 'inactive', 'failed'), 'CONFIG_BUSY')
    require(values.get('UnitFileState', '') in ('', 'enabled', 'disabled'), 'CONFIG_FOREIGN')
    require(values.get('FragmentPath', '') in ('', setup.UNIT), 'CONFIG_FOREIGN')
    require(not values.get('DropInPaths') and values.get('NeedDaemonReload') == 'no', 'CONFIG_FOREIGN')
    return values


def validate_bundle(sources):
    require(set(sources) == set(setup.FILES + [SERVICE]))
    require(all(isinstance(v, str) and len(v) < 524288 and v.isascii() for v in sources.values()))
    files = {**{str(Path(setup.CODE) / n): v.replace('\r\n', '\n').encode() for n, v in sources.items() if n != SERVICE}, setup.UNIT: sources[SERVICE].replace('\r\n', '\n').encode()}
    require(isinstance(RELEASE, dict) and RELEASE.get('schemaVersion') == 1 and type(RELEASE.get('revision')) is int and RELEASE['revision'] > 0 and RELEASE.get('sha256') == setup.digest({Path(k).name: sha(v) for k, v in files.items()}), 'CONFIG_RELEASE_INVALID')
    return files


def policy():
    raw = read_file(str(Path(STATE) / 'policy.json'))
    try:
        value = json.loads(raw) if raw is not None else dict(schemaVersion=1, revision=0, autoUpdate=False)
    except (ValueError, UnicodeError):
        raise setup.SetupError('CONFIG_POLICY_INVALID') from None
    require(isinstance(value, dict) and value.get('schemaVersion') == 1 and type(value.get('revision')) is int and value['revision'] >= 0 and type(value.get('autoUpdate')) is bool, 'CONFIG_POLICY_INVALID')
    require(set(value) <= {'schemaVersion', 'revision', 'autoUpdate', 'lastAttemptTarget', 'lastAttemptAt', 'lastAttemptError'}, 'CONFIG_POLICY_INVALID')
    require('lastAttemptTarget' not in value or isinstance(value['lastAttemptTarget'], str) and re.fullmatch(r'wb-[a-f0-9]{12}', value['lastAttemptTarget']), 'CONFIG_POLICY_INVALID')
    require('lastAttemptAt' not in value or type(value['lastAttemptAt']) is int and value['lastAttemptAt'] >= 0, 'CONFIG_POLICY_INVALID')
    require('lastAttemptError' not in value or isinstance(value['lastAttemptError'], str) and re.fullmatch(r'[A-Z_]{1,80}', value['lastAttemptError']), 'CONFIG_POLICY_INVALID')
    return value


def inspect(sources, known):
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    require(Path('/run/systemd/system').is_dir(), 'CONFIG_SYSTEMD')
    files = validate_bundle(sources)
    bundle = 'wb-' + setup.digest({Path(k).name: sha(v) for k, v in files.items()})[:12]
    row = dict(installed=False, running=False, bundledVersion=bundle, bundledRevision=RELEASE['revision'], canInstall=False, canUpdate=False, canUninstall=False, policy=policy())
    for target in (setup.UNIT + '.d', '/run/systemd/system/' + SERVICE, '/run/systemd/system/' + SERVICE + '.d'):
        require(not os.path.lexists(target))
    journal = read_file(str(Path(STATE) / 'transaction.json'))
    if journal:
        data = json.loads(journal)
        require(data.get('schema') == 1 and data.get('state') in ('applying', 'complete', 'rolled-back'), 'CONFIG_PENDING')
        if data['state'] == 'applying':
            row['error'] = 'CONFIG_REVIEW_REQUIRED'
    receipt_raw = read_file(str(Path(STATE) / 'receipt.json'))
    receipt = json.loads(receipt_raw) if receipt_raw else None
    if receipt is not None:
        require(receipt.get('schema') == 1 and isinstance(receipt.get('files'), dict))
        require(set(receipt['files']).issubset({Path(p).name for p in files}))
        require(type(receipt.get('releaseRevision', 0)) is int and receipt.get('releaseRevision', 0) >= 0)
    row['installedRevision'] = receipt.get('releaseRevision', 0) if receipt else 0
    actual = {}
    for target, content in files.items():
        raw = read_file(target)
        actual[target] = raw
        if raw is not None:
            name = Path(target).name
            require(sha(raw) in known.get(name, []) or sha(raw.replace(b'\r\n', b'\n')) in known.get(name, []) or raw == content or receipt and receipt['files'].get(name) == sha(raw))
    if Path(setup.CODE).exists():
        # No recursive deletion or replacement of an unknown deployment.
        require(set(p.name for p in setup.trusted(setup.CODE).iterdir()).issubset(set(setup.FILES)))
    identity = setup.authority()
    entry = setup.owner()
    config_raw = read_file(setup.CONFIG)
    config = json.loads(config_raw) if config_raw else None
    if config:
        require(entry and config.get('ownerUid') == entry.pw_uid and config.get('root') == setup.ROOT and
                config.get('authorityId') == identity[0] and config.get('generation') == identity[1] and
                config.get('workspacePolicyFile') == identity[2] and config.get('socketAccess') == 'peer-policy', 'CONFIG_IDENTITY')
    else:
        require(config is None, 'CONFIG_IDENTITY')
    for target in [setup.ROOT, setup.ROOT + '/profiles']:
        if os.path.lexists(target):
            info = Path(target).lstat()
            require(entry and stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == entry.pw_uid and not info.st_mode & 0o077, 'CONFIG_IDENTITY')
    current = service_state()
    installed = any(v is not None for v in actual.values())
    row.update(installed=installed, running=current['ActiveState'] == 'active', canInstall=not installed,
               canUpdate=installed, canUninstall=installed)
    if installed:
        row['currentVersion'] = 'wb-' + setup.digest({Path(k).name: sha(v.replace(b'\r\n', b'\n')) for k, v in actual.items() if v is not None})[:12]
    if installed and row['installedRevision'] > RELEASE['revision']:
        row.update(canUpdate=False, error='CONFIG_NEWER_INSTALLED')
    require(not row['running'] or installed and config is not None, 'CONFIG_IDENTITY')
    revision = setup.digest([[(k, sha(v) if v is not None else None) for k, v in actual.items()], sha(config_raw) if config_raw else None,
                             identity, entry.pw_uid if entry else None, current, sha(receipt_raw) if receipt_raw else None,
                             sha(journal) if journal else None, row['policy'], RELEASE])
    return dict(row=row, files=files, actual=actual, identity=identity, owner=entry, config=config,
                service=current, revision=revision)


def status(sources, known):
    try:
        return inspect(sources, known)['row']
    except (setup.SetupError, ValueError, OSError, subprocess.SubprocessError) as error:
        files = validate_bundle(sources)
        return dict(installed=False, running=False, bundledVersion='wb-' + setup.digest({Path(k).name: sha(v) for k, v in files.items()})[:12],
                    canInstall=False, canUpdate=False, canUninstall=False,
                    error=str(error) if isinstance(error, setup.SetupError) else 'CONFIG_UNCONFIRMED')


def plan(sources, known, operation):
    require(operation in ('install', 'update', 'uninstall'), 'INVALID_REQUEST')
    state = inspect(sources, known)
    require(state['row']['can' + operation.capitalize()], 'CONFIG_CHANGED')
    targets = [p for p, raw in state['actual'].items() if raw is not None] if operation == 'uninstall' else list(state['files'])
    if operation != 'uninstall' and state['config'] is None:
        targets += [setup.CONFIG, setup.ROOT]
    result = dict(operation=operation, targets=targets, preserves=PRESERVES,
                  currentVersion=state['row'].get('currentVersion'), version=None if operation == 'uninstall' else state['row']['bundledVersion'])
    result = {k: v for k, v in result.items() if v is not None}
    result['token'] = setup.digest([result, state['revision']])
    return result


def atomic(target, raw, mode=0o644):
    setup.trusted(target, missing=True)
    setup.ensure_directory(str(Path(target).parent))
    temporary = str(target) + '.configuration-' + uuid.uuid4().hex
    try:
        with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode), 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        descriptor = os.open(str(Path(target).parent), os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def record(name, value):
    atomic(str(Path(STATE) / name), (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode(), 0o600)


def setup_lock():
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    setup.trusted(setup.LOCK, missing=True)
    descriptor = os.open(setup.LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return descriptor
    except Exception:
        os.close(descriptor)
        raise setup.SetupError('CONFIG_BUSY') from None


def configure(revision, enabled):
    require(type(revision) is int and revision >= 0 and type(enabled) is bool, 'CONFIG_POLICY_INVALID')
    descriptor = setup_lock()
    try:
        current = policy()
        require(current['revision'] == revision, 'CONFIG_POLICY_CHANGED')
        value = dict(current, revision=revision + 1, autoUpdate=enabled)
        record('policy.json', value)
        require(policy() == value, 'CONFIG_UNCONFIRMED')
        return value
    finally:
        os.close(descriptor)


def eligible(row):
    p = row.get('policy', {})
    return bool(row['installed'] and row['running'] and row['canUpdate'] and not row.get('error') and p.get('autoUpdate') and
                row['currentVersion'] != row['bundledVersion'] and row['bundledRevision'] > row['installedRevision'] and
                p.get('lastAttemptTarget') != row['bundledVersion'])


def finish_attempt(error=None):
    value = policy()
    value['revision'] += 1
    if error:
        value['lastAttemptError'] = error if re.fullmatch(r'[A-Z_]{1,80}', error) else 'CONFIG_UNCONFIRMED'
    else:
        value.pop('lastAttemptError', None)
    record('policy.json', value)


def assert_idle(state):
    for provider in ('codex', 'claude'):
        cli_management.runtime_request(provider)
    if state['row']['running']:
        group = state['service'].get('ControlGroup')
        require(group == '/system.slice/' + SERVICE, 'CONFIG_BUSY')
        # All descendants count, including unmanaged CLI processes. Never stop
        # a service whose idle native connection has not actually been closed.
        root = Path('/sys/fs/cgroup') / group.lstrip('/')
        pids = set()
        for file in root.rglob('cgroup.procs'):
            pids.update(file.read_text().split())
        require(pids == {state['service'].get('MainPID')}, 'CONFIG_BUSY')
        # Existing versions only fence managed binaries. Do not claim that a
        # live legacy service with external binaries is safe to restart.
        require(all(not state['config'].get(p + 'Executable') or state['config'][p + 'Executable'].startswith(cli_guard.INSTALL_ROOT + '/') for p in ('codex', 'claude')), 'CONFIG_BUSY')


def ready(identity):
    for _ in range(20):
        try:
            if setup.native_catalog() == dict(authorityId=identity[0], generation=identity[1]):
                return
        except (OSError, ValueError, setup.SetupError):
            pass
        time.sleep(.25)
    raise setup.SetupError('CONFIG_UNCONFIRMED')


def apply(sources, known, operation, expected, automatic=False):
    descriptor = setup_lock()
    attempted = False
    try:
        if automatic and not eligible(inspect(sources, known)['row']):
            return None
        require(plan(sources, known, operation)['token'] == expected, 'CONFIG_CHANGED')
        with ExitStack() as leases:
            for provider in ('codex', 'claude'):
                leases.enter_context(cli_guard.lease(provider, exclusive=True))
            state = inspect(sources, known)
            assert_idle(state)
            if automatic:
                # Claim exactly one attempt only after both runtime leases and
                # the idle check. A lost connection cannot replay this target.
                p = state['row']['policy']
                record('policy.json', dict(p, revision=p['revision'] + 1,
                                          lastAttemptTarget=state['row']['bundledVersion'],
                                          lastAttemptAt=int(time.time()), lastAttemptError='CONFIG_UNCONFIRMED'))
                attempted = True
            transaction = uuid.uuid4().hex
            backup = str(Path(STATE) / 'backups' / transaction)
            setup.ensure_directory(backup, 0o700)
            for target, raw in state['actual'].items():
                if raw is not None:
                    setup.write_new(str(Path(backup) / Path(target).name), raw.decode(), 0o600)
            journal = dict(schema=1, state='applying', operation=operation, backup=backup,
                           files={Path(p).name: sha(v) if v is not None else None for p, v in state['actual'].items()},
                           service=state['service'], target=state['row']['bundledVersion'])
            setup.write_new(str(Path(backup) / 'transaction.json'), json.dumps(journal, sort_keys=True) + '\n', 0o600)
            record('transaction.json', journal)
            old_receipt = read_file(str(Path(STATE) / 'receipt.json'))
            try:
                if state['row']['running']:
                    systemctl('stop', SERVICE)
                if operation == 'uninstall':
                    if state['actual'][setup.UNIT] is not None:
                        systemctl('disable', SERVICE)
                    for target, raw in state['actual'].items():
                        if raw is not None:
                            require(read_file(target) == raw, 'CONFIG_CHANGED')
                            os.unlink(target)
                else:
                    entry = state['owner']
                    if entry is None:
                        subprocess.run(['/usr/sbin/useradd', '--system', '--user-group', '--home-dir', setup.ROOT, '--shell', '/usr/sbin/nologin', '--no-create-home', setup.OWNER], check=True, capture_output=True, timeout=15)
                        entry = setup.owner()
                    require(entry is not None, 'CONFIG_IDENTITY')
                    for target in (setup.ROOT, setup.ROOT + '/profiles'):
                        if not os.path.lexists(target):
                            os.mkdir(target, 0o700)
                            os.chown(target, entry.pw_uid, entry.pw_gid)
                    if state['config'] is None:
                        binaries = {}
                        for provider in ('codex', 'claude'):
                            try:
                                binaries[provider] = setup.binary(provider, [])
                            except (native_install.InstallError, setup.SetupError):
                                pass
                        config, _ = setup.deployment(sources, entry, state['identity'], binaries)
                        setup.write_new(setup.CONFIG, json.dumps(config, sort_keys=True, separators=(',', ':')) + '\n')
                    for target, raw in state['files'].items():
                        require(read_file(target) == state['actual'][target], 'CONFIG_CHANGED')
                        atomic(target, raw)
                systemctl('daemon-reload')
                if operation != 'uninstall':
                    systemctl('enable', '--now', SERVICE)
                    ready(state['identity'])
                    require(all(read_file(p) == v for p, v in state['files'].items()), 'CONFIG_UNCONFIRMED')
                else:
                    require(service_state()['ActiveState'] != 'active', 'CONFIG_UNCONFIRMED')
                record('receipt.json', dict(schema=1, version=None if operation == 'uninstall' else state['row']['bundledVersion'],
                                           releaseRevision=0 if operation == 'uninstall' else RELEASE['revision'],
                                           files={} if operation == 'uninstall' else {Path(p).name: sha(v) for p, v in state['files'].items()}))
                record('transaction.json', dict(journal, state='complete'))
            except Exception:
                try:
                    if os.path.lexists(setup.UNIT):
                        systemctl('stop', SERVICE)
                        if state['service'].get('UnitFileState') != 'enabled':
                            systemctl('disable', SERVICE)
                    for target, before in state['actual'].items():
                        current = read_file(target)
                        require(current in (before, state['files'][target], None), 'CONFIG_CHANGED')
                        if before is not None:
                            atomic(target, before)
                        elif current is not None:
                            os.unlink(target)
                    receipt_path = str(Path(STATE) / 'receipt.json')
                    if old_receipt is not None:
                        atomic(receipt_path, old_receipt, 0o600)
                    elif os.path.lexists(receipt_path):
                        os.unlink(receipt_path)
                    systemctl('daemon-reload')
                    if state['service'].get('UnitFileState') == 'enabled':
                        systemctl('enable', SERVICE)
                    if state['row']['running']:
                        systemctl('start', SERVICE)
                        ready(state['identity'])
                    record('transaction.json', dict(journal, state='rolled-back'))
                except Exception:
                    raise setup.SetupError('CONFIG_ROLLBACK_FAILED') from None
                raise setup.SetupError('CONFIG_ROLLED_BACK') from None
        result = inspect(sources, known)['row']
        require(result['installed'] == (operation != 'uninstall') and result['running'] == (operation != 'uninstall'), 'CONFIG_UNCONFIRMED')
        if automatic or operation != 'uninstall' and result['policy'].get('lastAttemptError'):
            finish_attempt()
            result = inspect(sources, known)['row']
        return result
    except Exception as error:
        if attempted:
            finish_attempt(str(error))
        raise
    finally:
        os.close(descriptor)


def auto_update(sources, known):
    row = inspect(sources, known)['row']
    if not eligible(row):
        return None
    preview = plan(sources, known, 'update')
    try:
        return apply(sources, known, 'update', preview['token'], automatic=True)
    except (setup.SetupError, RuntimeError) as error:
        if str(error) in ('CONFIG_BUSY', 'CLI_BUSY', 'CONFIG_CHANGED'):
            return None
        raise


def dispatch(request, sources, known, release):
    global RELEASE
    RELEASE = release
    try:
        require(isinstance(request, dict) and request.get('method') in ('status', 'plan', 'apply', 'configure', 'auto-update'), 'INVALID_REQUEST')
        if request['method'] == 'status':
            value = status(sources, known)
        elif request['method'] == 'plan':
            value = plan(sources, known, request.get('operation'))
        elif request['method'] == 'configure':
            inspect(sources, known)
            configure(request.get('revision'), request.get('autoUpdate'))
            value = inspect(sources, known)['row']
        elif request['method'] == 'auto-update':
            value = auto_update(sources, known)
        else:
            value = apply(sources, known, request.get('operation'), request.get('token'))
        return dict(ok=True, value=value)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, setup.SetupError, native_install.InstallError, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, (setup.SetupError, native_install.InstallError, RuntimeError)) else 'CONFIG_UNCONFIRMED'
        return dict(ok=False, error='CONFIG_BUSY' if code == 'CLI_BUSY' else code)
