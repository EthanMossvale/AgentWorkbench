"""Explicit, revision-bound management of shared CLI program files only."""
import fcntl
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import time
import uuid
import cli_guard
import native_install as native
import setup
import cli_policies


def require(value, code='CLI_INSTALL_CONFLICT'):
    if not value:
        raise native.InstallError(code)


def managed(provider):
    root = setup.trusted(native.INSTALL_ROOT, missing=True)
    rows = []
    if not root.exists():
        return rows
    for folder in sorted(root.iterdir()):
        if not re.fullmatch(provider + r'-\d+\.\d+\.\d+-(?:x86_64|aarch64|linux-(?:x64|arm64)(?:-musl)?)', folder.name):
            continue
        setup.trusted(folder)
        if not any(folder.iterdir()):
            continue
        require(set(p.name for p in folder.iterdir()) in ({provider, 'source.json'}, {provider, 'source.json', 'program'}))
        binary, receipt = setup.trusted(folder / provider), setup.public_json(folder / 'source.json')
        require(binary.stat().st_nlink == 1 and receipt.get('provider') == provider and re.fullmatch(r'\d+\.\d+\.\d+', str(receipt.get('version', ''))))
        require(receipt.get('binarySha256') == native.file_digest(binary))
        if (folder / 'program').exists():
            require(receipt.get('method') == 'official-native-installer' and native.program_manifest(setup.trusted(folder / 'program')) == receipt.get('programManifest'))
        rows.append(dict(path=str(binary), version=receipt['version'], sha256=receipt['binarySha256']))
    return rows


def configured():
    return setup.public_json(setup.CONFIG) if os.path.lexists(setup.CONFIG) else {}


def running(paths):
    targets = set(paths)
    for process in Path('/proc').glob('[0-9]*'):
        try:
            if any(os.readlink(process / 'exe').removesuffix(' (deleted)') == p or os.readlink(process / 'exe').startswith(str(Path(p).parent / 'program') + '/') for p in targets):
                return True
        except OSError:
            pass
    return False


def view(provider, check_latest=True):
    require(provider in ('codex', 'claude'), 'INVALID_REQUEST')
    rows = managed(provider)
    config = configured()
    selected = config.get(provider + 'Executable', '')
    detected = []
    try:
        candidate, detected = native.discover(provider)
    except native.InstallError as error:
        candidate, detected = '', error.detected
    executable = selected if selected and os.path.isfile(selected) else (candidate if not selected else '')
    installed = next((r for r in rows if r['path'] == executable), None)
    version = installed['version'] if installed else next((r.get('version') for r in detected if r['path'] == executable), None)
    result = dict(provider=provider, installed=bool(executable), executable=executable, version=version,
                  managed=bool(installed), installations=rows, detected=detected, canUninstall=bool(rows),
                  busy=running([r['path'] for r in rows]), revision=setup.digest([rows, selected, detected]), policy=cli_policies.read(provider))
    if check_latest:
        try:
            item = native.artifact(provider)
            result.update(latest=item['version'], size=item['size'], checkedAt=int(time.time()))
        except native.InstallError as error:
            result['error'] = str(error)
            if error.release_issue:
                result['releaseIssue'] = error.release_issue
    return result


def plan(provider, operation):
    require(operation in ('install', 'update', 'uninstall'), 'INVALID_REQUEST')
    row = view(provider, operation != 'uninstall')
    require(not row['busy'], 'CLI_BUSY')
    require(operation != 'uninstall' or row['canUninstall'], 'CLI_NOT_MANAGED')
    require(operation != 'update' or row['managed'], 'CLI_NOT_MANAGED')
    require(operation != 'install' or not row['installed'], 'CLI_ALREADY_INSTALLED')
    item = native.artifact(provider) if operation != 'uninstall' else None
    result = dict(provider=provider, operation=operation, revision=row['revision'],
                  currentVersion=row['version'], version=item['version'] if item else None,
                  targets=[r['path'] for r in row['installations']] if operation == 'uninstall' else [item['target']],
                  download=item, preserves=['account-profiles', 'configuration', 'memory', 'workspaces'])
    result['planId'] = setup.digest(result)
    return result


def runtime_request(provider, executable=None):
    if not os.path.lexists(setup.SOCKET):
        return
    # The dedicated native owner is the sole authority; never fall back to another broker.
    config = configured()
    parent = Path(setup.SOCKET).parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == config.get('ownerUid') and not parent.st_mode & 0o022, 'CLI_RUNTIME_RELOAD_FAILED')
    with socket.socket(socket.AF_UNIX) as channel:
        channel.settimeout(10)
        channel.connect(setup.SOCKET)
        require(struct.unpack('3i', channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] == config['ownerUid'], 'CLI_RUNTIME_RELOAD_FAILED')
        params = dict(authorityId=config['authorityId'], generation=config['generation'], provider=provider)
        if executable is not None:
            params['executable'] = executable
        request = dict(protocol=1, method='maintenance/reload-cli' if executable is not None else 'maintenance/check-cli', params=params)
        channel.sendall((json.dumps(request) + '\n').encode())
        response = json.loads(channel.makefile('rb').readline(65537))
        require(response.get('ok') is True, 'CLI_BUSY' if response.get('error') == 'CLI_BUSY' else 'CLI_RUNTIME_RELOAD_FAILED')
        require(response.get('value') == ({'provider': provider, 'executable': executable} if executable is not None else {'provider': provider, 'idle': True}), 'CLI_RUNTIME_RELOAD_FAILED')


def replace_configuration(value):
    target = setup.trusted(setup.CONFIG)
    temporary = target.with_name('.cli-config-' + uuid.uuid4().hex)
    try:
        with open(os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644), 'w') as stream:
            json.dump(value, stream, sort_keys=True, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def bind(provider, executable):
    if not os.path.lexists(setup.CONFIG):
        return
    with cli_guard.lease('configuration', exclusive=True):
        before = configured()
        after = dict(before, **{provider + 'Executable': executable})
        replace_configuration(after)
        try:
            runtime_request(provider, executable)
        except Exception:
            # A lost reply cannot prove that the broker did not switch. Preserve
            # both program versions and require a new deliberate reconciliation.
            raise


def apply(provider, operation, expected):
    setup.trusted('/run')
    descriptor = os.open(setup.LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077)
        fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        return apply_locked(provider, operation, expected)
    finally:
        os.close(descriptor)


def apply_locked(provider, operation, expected):
    with cli_guard.lease(provider, exclusive=True):
        runtime_request(provider)
        reviewed = plan(provider, operation)
        require(reviewed['planId'] == expected, 'PLAN_CHANGED')
        if operation == 'uninstall':
            rows = managed(provider)
            require(not running([r['path'] for r in rows]), 'CLI_BUSY')
            current = configured().get(provider + 'Executable')
            if current in [r['path'] for r in rows]:
                bind(provider, '')
            # No recursive deletion. Only receipt-verified program files are removed.
            for row in rows:
                target = setup.trusted(row['path'])
                require(native.file_digest(target) == row['sha256'])
                program = target.parent / 'program'
                if program.exists():
                    receipt = setup.public_json(target.parent / 'source.json')
                    require(native.program_manifest(program) == receipt.get('programManifest'))
                    for entry in sorted(program.rglob('*'), key=lambda p: len(p.parts), reverse=True):
                        if entry.is_symlink() or entry.is_file():
                            entry.unlink()
                        else:
                            entry.rmdir()
                    program.rmdir()
                target.unlink()
                (target.parent / 'source.json').unlink()
                target.parent.rmdir()
        else:
            item = reviewed['download']
            ready = next((r for r in managed(provider) if r['path'] == item['target'] and r['version'] == item['version']), None)
            installed = ready['path'] if ready else native.install(item, setup.trusted, setup.ensure_directory, setup.write_new)
            bind(provider, installed)
        return view(provider, False)


def dispatch(request):
    try:
        require(os.geteuid() == 0, 'ADMIN_REQUIRED')
        method = request.get('method')
        if method == 'cli/list':
            value = [view(provider) for provider in ('codex', 'claude')]
        elif method == 'cli/plan':
            value = plan(request.get('provider'), request.get('operation'))
        elif method == 'cli/apply':
            value = apply(request.get('provider'), request.get('operation'), request.get('planId'))
        elif method == 'cli/configure':
            value = cli_policies.configure(request.get('provider'), request.get('revision'), request.get('changes'))
        elif method == 'cli/auto-update':
            provider = request.get('provider')
            preferences = cli_policies.read(provider)
            if not preferences['autoUpdate']:
                return dict(ok=True, value=dict(status='disabled'))
            if time.time()-preferences.get('lastUpdateAttempt', 0) < 86400:
                return dict(ok=True, value=dict(status='skipped'))
            from resources import broker_call
            broker_call('maintenance/reclaim', dict(provider=provider))
            row = view(provider, False)
            if not row['installed'] or not row['managed'] or row['busy'] or not cli_policies.read(provider)['autoUpdate']:
                value = dict(status='skipped')
            else:
                runtime_request(provider)
                if not cli_policies.claim_update(provider):
                    value = dict(status='skipped')
                else:
                    reviewed = plan(provider, 'update')
                    if reviewed['version'] == row['version']:
                        value = dict(status='current')
                    else:
                        value = dict(status='updated', cli=apply(provider, 'update', reviewed['planId']))
        else:
            raise native.InstallError('INVALID_REQUEST')
        return dict(ok=True, value=value)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, native.InstallError, setup.SetupError) as error:
        code = str(error)
        if request.get('method') == 'cli/auto-update' and request.get('provider') in ('codex', 'claude') and code != 'CLI_BUSY':
            with cli_guard.lease('configuration', exclusive=True):
                current = cli_policies.read(request['provider'])
                current.update(lastUpdateAttempt=time.time(), lastUpdateError=code if re.fullmatch(r'[A-Z][A-Z_]+', code) else 'CLI_OPERATION_UNCONFIRMED')
                cli_policies.write(request['provider'], current)
        result = dict(ok=False, error=code if re.fullmatch(r'[A-Z][A-Z_]+', code) else 'CLI_OPERATION_UNCONFIRMED')
        if isinstance(error, native.InstallError) and error.release_issue:
            result['releaseIssue'] = error.release_issue
        return result
