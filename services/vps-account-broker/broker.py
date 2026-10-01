"""Shared public account catalog and native device authorization. Linux deployment is separate.

Credential owner profiles are private to this service identity. Neither member
profiles nor any existing Codex/Claude/broker installation are imported or changed.
Native runtime RPC is scoped to the caller's account, workspace and session.
There is no credential-distribution endpoint.
"""
import argparse
from collections import deque
import copy
import datetime
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import socket
import socketserver
import stat
import struct
import threading
import time
import uuid

from native_worker import NativeCodexLogin, DEVICE_URL, safe_text

ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
ACTIVE = ('preparing', 'awaiting-code', 'verifying')
MAX_POLICY_BYTES = 1048576


def trusted_path(value, *, owners, final_uid, kind, private=False, allow_symlinks=False):
    """Validate every Linux path component before using a deployment-owned path.

    Executable symlinks must themselves be root-owned. Their complete targets are
    walked, including intermediate directories, rather than checking only resolve().
    The service never creates a directory before these deployment checks succeed.
    """
    if not isinstance(value, str) or not value.startswith('/') or '\x00' in value:
        raise RuntimeError('Trusted absolute deployment path required')
    pending = deque(PurePosixPath(value).parts[1:])
    resolved = []
    links = 0
    root = os.lstat('/')
    if not stat.S_ISDIR(root.st_mode) or root.st_uid not in owners or root.st_mode & 0o022:
        raise RuntimeError('Trusted deployment path required')
    while pending:
        part = pending.popleft()
        if part == '.':
            continue
        if part == '..':
            if resolved:
                resolved.pop()
            continue
        current = '/' + '/'.join(resolved + [part])
        info = os.lstat(current)
        if stat.S_ISLNK(info.st_mode):
            if not allow_symlinks or info.st_uid != 0 or links >= 32:
                raise RuntimeError('Trusted deployment path required')
            links += 1
            target = PurePosixPath(os.readlink(current))
            if target.is_absolute():
                resolved = []
                parts = target.parts[1:]
            else:
                parts = target.parts
            pending.extendleft(reversed(parts))
            continue
        if info.st_uid not in owners or info.st_mode & 0o022:
            raise RuntimeError('Trusted deployment path required')
        if pending and not stat.S_ISDIR(info.st_mode):
            raise RuntimeError('Trusted deployment directory required')
        resolved.append(part)
    result = '/' + '/'.join(resolved)
    info = os.lstat(result)
    if info.st_uid != final_uid or (private and info.st_mode & 0o077):
        raise RuntimeError('Deployment path owner or mode mismatch')
    if kind == 'directory' and not stat.S_ISDIR(info.st_mode):
        raise RuntimeError('Deployment directory required')
    if kind == 'file' and not stat.S_ISREG(info.st_mode):
        raise RuntimeError('Deployment file required')
    if kind == 'executable' and (not stat.S_ISREG(info.st_mode) or not info.st_mode & 0o111):
        raise RuntimeError('Trusted executable required')
    return result


class BrokerError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def read_workspace_policy(value):
    """Read only an explicitly configured, root-controlled policy snapshot.

    The control service may replace this file atomically. Revalidate the complete
    path and opened descriptor for every request; never cache a formerly valid ACL
    when the administrator removes or pauses a workspace.
    """
    descriptor = None

    def unique_object(pairs):
        result = {}
        for key, item in pairs:
            if key in result:
                raise ValueError('Duplicate policy field')
            result[key] = item
        return result

    try:
        if not hasattr(os, 'O_NOFOLLOW'):
            raise RuntimeError('Trusted policy reads require Linux')
        filename = trusted_path(value, owners={0}, final_uid=0, kind='file')
        descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022 or metadata.st_size > MAX_POLICY_BYTES:
            raise RuntimeError('Root-controlled policy file required')
        with os.fdopen(descriptor, 'rb') as source:
            descriptor = None
            raw = source.read(MAX_POLICY_BYTES + 1)
        if len(raw) > MAX_POLICY_BYTES:
            raise ValueError('Policy exceeds the bound')
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object)
    except (OSError, ValueError, TypeError, RuntimeError, RecursionError):
        raise BrokerError('POLICY_UNAVAILABLE') from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def require_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise BrokerError('INVALID_REQUEST')
    return value


def iso(timestamp):
    return datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def public_metadata(value):
    if not isinstance(value, dict) or value.get('status') not in ('authenticated', 'unknown', 'unauthenticated'):
        raise BrokerError('INVALID_REQUEST')
    result = {'status': value['status']}
    for key in ('email', 'displayName', 'plan', 'authMethod'):
        if safe_text(value.get(key)):
            result[key] = value[key]
    return result


def secure_directory(path):
    path = Path(path)
    if path.is_symlink():
        raise BrokerError('INVALID_REQUEST')
    path.mkdir(mode=0o700, parents=False, exist_ok=True)
    if not path.is_dir() or path.is_symlink():
        raise BrokerError('INVALID_REQUEST')
    return path


class AccountRegistry:
    """One broker owns the file; revisions and selections are committed atomically."""
    def __init__(self, root, authority_id, generation, *, now=time.time):
        self.root = secure_directory(root)
        self.profiles = secure_directory(self.root / 'profiles')
        self.file = self.root / 'catalog.json'
        self.authority_id = require_id(authority_id)
        self.generation = require_id(generation)
        self.now = now
        self.lock = threading.RLock()
        self.state = {'authorityId': authority_id, 'generation': generation, 'revision': 0, 'accounts': {}, 'selections': {}}
        if self.file.exists() or self.file.is_symlink():
            if self.file.is_symlink() or self.file.stat().st_size > 1048576:
                raise BrokerError('INVALID_REQUEST')
            with self.file.open('r', encoding='utf-8') as source:
                loaded = json.load(source)
            if loaded.get('authorityId') != authority_id or loaded.get('generation') != generation:
                raise BrokerError('STALE_AUTHORITY')
            if not isinstance(loaded.get('accounts'), dict) or len(loaded['accounts']) > 128 or not isinstance(loaded.get('selections'), dict) or type(loaded.get('revision')) is not int or loaded['revision'] < 0:
                raise BrokerError('INVALID_REQUEST')
            # Revalidate and reconstruct only public metadata, even when reading our own state.
            accounts = {}
            for account_id, row in loaded['accounts'].items():
                require_id(account_id)
                if not isinstance(row, dict) or row.get('provider') not in ('codex', 'claude') or not safe_text(row.get('observedAt'), 64):
                    raise BrokerError('INVALID_REQUEST')
                accounts[account_id] = dict(public_metadata(row), id=account_id, generation=require_id(row.get('generation')), provider=row['provider'], observedAt=row['observedAt'])
                if type(row.get('enabled', True)) is not bool or type(row.get('accessRevision', 0)) is not int or row.get('accessRevision', 0) < 0:
                    raise BrokerError('INVALID_REQUEST')
                accounts[account_id].update(enabled=row.get('enabled', True), accessRevision=row.get('accessRevision', 0))
                if row.get('pendingLogin') is True:
                    accounts[account_id]['pendingLogin'] = True
            selections = {}
            for workspace, selection in loaded['selections'].items():
                require_id(workspace)
                if not isinstance(selection, dict) or type(selection.get('revision')) is not int or selection['revision'] < 0 or selection.get('accountId') is not None and (selection['accountId'] not in accounts or accounts[selection['accountId']]['provider'] != 'codex'):
                    raise BrokerError('INVALID_REQUEST')
                selections[workspace] = {'revision': selection['revision']}
                if selection.get('accountId'):
                    selections[workspace]['accountId'] = selection['accountId']
                access = selection.get('accountAccess', {})
                if not isinstance(access, dict) or len(access) > 128:
                    raise BrokerError('INVALID_REQUEST')
                for identity, item in access.items():
                    require_id(identity)
                    if not isinstance(item, dict) or type(item.get('enabled')) is not bool or type(item.get('revision')) is not int or item['revision'] < 0:
                        raise BrokerError('INVALID_REQUEST')
                selections[workspace]['accountAccess'] = copy.deepcopy(access)
                if 'claude' in selection:
                    claude = selection['claude']
                    if not isinstance(claude, dict) or type(claude.get('revision')) is not int or claude['revision'] < 0 or (claude.get('accountId') is not None and (claude['accountId'] not in accounts or accounts[claude['accountId']]['provider'] != 'claude')):
                        raise BrokerError('INVALID_REQUEST')
                    selections[workspace]['claude'] = copy.deepcopy(claude)
            self.state.update(revision=loaded['revision'], accounts=accounts, selections=selections)

    def _commit(self, candidate):
        temporary = self.root / ('.catalog-' + uuid.uuid4().hex + '.tmp')
        descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as target:
                json.dump(candidate, target, separators=(',', ':'))
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, self.file)
            self.state = candidate
        finally:
            if temporary.exists():
                temporary.unlink()

    def catalog(self, workspace_id):
        with self.lock:
            selection = self.state['selections'].get(workspace_id, {'revision': 0})
            value = {'authorityId': self.authority_id, 'generation': self.generation, 'revision': self.state['revision'],
                     'workspaceId': workspace_id, 'selectionRevision': selection['revision'],
                     'accounts': [a for a in copy.deepcopy(self.state['accounts']).values() if not a.get('pendingLogin')], 'availability': 'ready'}
            for account in value['accounts']:
                access = selection.get('accountAccess', {}).get(account['generation'], {})
                account.update(enabled=account.get('enabled', True), accessRevision=account.get('accessRevision', 0), workspaceEnabled=access.get('enabled', True), workspaceAccessRevision=access.get('revision', 0))
            if selection.get('accountId'):
                value['selectedAccountId'] = selection['accountId']
            value['claudeSelectionRevision'] = selection.get('claude', {}).get('revision', 0)
            if selection.get('claude', {}).get('accountId'):
                value['selectedClaudeAccountId'] = selection['claude']['accountId']
            return value

    def add(self, account_id, metadata, provider='codex', generation=None, pending=False):
        require_id(account_id)
        if provider not in ('codex', 'claude'):
            raise BrokerError('INVALID_REQUEST')
        with self.lock:
            if len(self.state['accounts']) >= 128 or account_id in self.state['accounts']:
                raise BrokerError('ACCOUNT_UNAVAILABLE')
            candidate = copy.deepcopy(self.state)
            candidate['accounts'][account_id] = dict(public_metadata(metadata), id=account_id, generation=require_id(generation) if generation is not None else uuid.uuid4().hex,
                                                      provider=provider, observedAt=iso(self.now()))
            candidate['revision'] += 1
            if pending:
                candidate['accounts'][account_id]['pendingLogin'] = True
            self._commit(candidate)
            return copy.deepcopy(candidate['accounts'][account_id])

    def select(self, workspace_id, account_id, expected_revision):
        with self.lock:
            account = self.state['accounts'].get(account_id)
            if not account or account['status'] != 'authenticated':
                raise BrokerError('ACCOUNT_UNAVAILABLE')
            selection = self.state['selections'].get(workspace_id, {'revision': 0})
            if account.get('enabled') is False or selection.get('accountAccess', {}).get(account['generation'], {}).get('enabled') is False:
                raise BrokerError('ACCOUNT_FORBIDDEN')
            current = selection.get('claude', {'revision': 0}) if account['provider'] == 'claude' else selection
            if type(expected_revision) is not int or expected_revision != current['revision']:
                raise BrokerError('STALE_SELECTION')
            candidate = copy.deepcopy(self.state)
            target = candidate['selections'].setdefault(workspace_id, {'revision': 0})
            if account['provider'] == 'claude':
                target['claude'] = {'accountId': account_id, 'revision': expected_revision + 1}
            else:
                target.update(accountId=account_id, revision=expected_revision + 1)
            candidate['revision'] += 1
            self._commit(candidate)
            return self.catalog(workspace_id)


class AccountBroker:
    def __init__(self, config, *, worker_factory=NativeCodexLogin, now=time.time, policy_reader=read_workspace_policy):
        self.authority_id = require_id(config.get('authorityId'))
        self.generation = require_id(config.get('generation'))
        self.owner_uid = config.get('ownerUid')
        if type(self.owner_uid) is not int or self.owner_uid <= 0:
            raise BrokerError('INVALID_REQUEST')
        self.members = {}
        for member in config.get('members', []):
            if not isinstance(member, dict) or member.get('authorityId') != self.authority_id or member.get('generation') != self.generation:
                raise BrokerError('STALE_AUTHORITY')
            uid = member.get('uid')
            workspace = require_id(member.get('workspaceId'))
            if type(uid) is not int or uid <= 0 or uid == self.owner_uid or uid in self.members or workspace in self.members.values():
                raise BrokerError('INVALID_REQUEST')
            self.members[uid] = workspace
        self.policy_file = config.get('workspacePolicyFile')
        if self.policy_file is not None and (not isinstance(self.policy_file, str) or not self.policy_file.startswith('/') or len(self.policy_file) > 4096 or re.search(r'[\x00\r\n]', self.policy_file)):
            raise BrokerError('INVALID_REQUEST')
        self.policy_reader = policy_reader
        root = Path(config.get('root', ''))
        self.binary = config.get('codexExecutable', '')
        if not root.is_absolute() or self.binary and not os.path.isabs(self.binary):
            raise BrokerError('INVALID_REQUEST')
        self.registry = AccountRegistry(root, self.authority_id, self.generation, now=now)
        self.worker_factory = worker_factory
        self.now = now
        self.lock = threading.RLock()
        self.jobs = {}
        self.external_logins = {}
        self.closed = False
        self.config = config
        self.runtime = None
        self.migration = None

    def native_runtime(self):
        with self.lock:
            if self.runtime is None:
                from runtime import NativeAccountRuntime
                self.runtime = NativeAccountRuntime(self, self.config)
            return self.runtime

    def _identity(self, peer_uid):
        if type(peer_uid) is not int or peer_uid < 0 or peer_uid == self.owner_uid:
            raise BrokerError('UNAUTHORIZED')
        if peer_uid == 0:
            return 'administrator', None
        if self.policy_file is None:
            # Legacy members never implicitly gain every account. An administrator
            # must explicitly configure and publish the control service's policy.
            raise BrokerError('POLICY_UNAVAILABLE')
        try:
            policy = self.policy_reader(self.policy_file)
            if not isinstance(policy, dict) or type(policy.get('schemaVersion')) is not int or policy['schemaVersion'] != 1 or policy.get('authorityId') != self.authority_id or policy.get('generation') != self.generation:
                raise ValueError('Policy authority mismatch')
            revision = policy.get('revision')
            workspaces = policy.get('workspaces')
            if type(revision) is not int or revision < 0 or revision > 9007199254740991 or not isinstance(workspaces, list) or len(workspaces) > 1024:
                raise ValueError('Invalid policy envelope')
            members = {}
            identities = set()
            for row in workspaces:
                if not isinstance(row, dict):
                    raise ValueError('Invalid workspace policy')
                uid = row.get('uid')
                workspace_id = require_id(row.get('workspaceId'))
                enabled = row.get('enabled')
                account_ids = row.get('allowedAccountIds')
                if type(uid) is not int or uid <= 0 or uid > 4294967294 or uid == self.owner_uid or uid in members or workspace_id == 'administrator' or workspace_id in identities or type(enabled) is not bool or not isinstance(account_ids, list) or len(account_ids) > 128:
                    raise ValueError('Invalid workspace authority')
                allowed_accounts = {require_id(account_id) for account_id in account_ids}
                if len(allowed_accounts) != len(account_ids):
                    raise ValueError('Duplicate account permission')
                identities.add(workspace_id)
                members[uid] = (workspace_id, enabled, allowed_accounts)
        except (OSError, ValueError, TypeError, RuntimeError, BrokerError, RecursionError):
            raise BrokerError('POLICY_UNAVAILABLE') from None
        member = members.get(peer_uid)
        if member is None:
            raise BrokerError('UNAUTHORIZED')
        workspace_id, enabled, allowed_accounts = member
        if not enabled:
            raise BrokerError('WORKSPACE_DISABLED')
        return workspace_id, allowed_accounts

    def _catalog(self, workspace, allowed_accounts):
        value = self.registry.catalog(workspace)
        value['source'] = 'native-owner'
        if allowed_accounts is not None:
            value['accounts'] = [account for account in value['accounts'] if account['id'] in allowed_accounts]
            if value.get('selectedAccountId') not in allowed_accounts:
                value.pop('selectedAccountId', None)
            if value.get('selectedClaudeAccountId') not in allowed_accounts:
                value.pop('selectedClaudeAccountId', None)
        return value

    def _authority(self, params):
        if params.get('authorityId') != self.authority_id or params.get('generation') != self.generation:
            raise BrokerError('STALE_AUTHORITY')

    def _job(self, peer_uid, job_id):
        job = self.jobs.get(job_id)
        if not job or (peer_uid != 0 and peer_uid != job['peerUid']):
            raise BrokerError('JOB_UNAVAILABLE')
        return job

    def dispatch(self, peer_uid, request):
        workspace, allowed_accounts = self._identity(peer_uid)
        if not isinstance(request, dict) or request.get('protocol') != 1 or not isinstance(request.get('params'), dict):
            raise BrokerError('INVALID_REQUEST')
        method = request.get('method')
        params = request['params']
        if method == 'account/set-enabled':
            self._authority(params)
            if set(params) != {'authorityId', 'generation', 'accountId', 'accountGeneration', 'expectedRevision', 'enabled'} or type(params['enabled']) is not bool or type(params['expectedRevision']) is not int:
                raise BrokerError('INVALID_REQUEST')
            with self.registry.lock:
                account = self.registry.state['accounts'].get(require_id(params['accountId']))
                if not account or account.get('pendingLogin') or account['generation'] != params['accountGeneration'] or allowed_accounts is not None and account['id'] not in allowed_accounts:
                    raise BrokerError('ACCOUNT_FORBIDDEN')
                candidate = copy.deepcopy(self.registry.state)
                if peer_uid == 0:
                    row = candidate['accounts'][account['id']]
                    revision = row.get('accessRevision', 0)
                    if params['expectedRevision'] != revision:
                        raise BrokerError('STALE_SELECTION')
                    row.update(enabled=params['enabled'], accessRevision=revision+1)
                else:
                    selection = candidate['selections'].setdefault(workspace, {'revision': 0})
                    known = {a['generation'] for a in candidate['accounts'].values()}
                    selection['accountAccess'] = {k: v for k, v in selection.get('accountAccess', {}).items() if k in known}
                    access = selection['accountAccess']
                    revision = access.get(account['generation'], {}).get('revision', 0)
                    if params['expectedRevision'] != revision:
                        raise BrokerError('STALE_SELECTION')
                    access[account['generation']] = {'enabled': params['enabled'], 'revision': revision+1}
                candidate['revision'] += 1
                self.registry._commit(candidate)
                return self._catalog(workspace, allowed_accounts)
        if isinstance(method, str) and method.startswith('storage/'):

            self._authority(params)
            if peer_uid != 0:
                raise BrokerError('UNAUTHORIZED')
            try:
                return self.native_runtime().storage.dispatch(method, params)
            except RuntimeError as error:
                raise BrokerError(str(error)) from None
        if method in ('maintenance/resources', 'maintenance/reclaim'):
            self._authority(params)
            if peer_uid != 0 or set(params) - {'authorityId', 'generation', 'provider', 'idleSeconds'} or params.get('provider') not in (None, 'codex', 'claude') or type(params.get('idleSeconds', 0)) is not int or params.get('idleSeconds', 0) not in (0, 86400):
                raise BrokerError('UNAUTHORIZED')
            manager = self.native_runtime().maintenance
            return manager.snapshot() if method.endswith('resources') else manager.reclaim(params.get('provider'), params.get('idleSeconds', 0))
        if method in ('maintenance/check-cli', 'maintenance/reload-cli'):
            self._authority(params)
            expected = {'authorityId', 'generation', 'provider'} | ({'executable'} if method.endswith('reload-cli') else set())
            provider = params.get('provider')
            if peer_uid != 0 or set(params) != expected or provider not in ('codex', 'claude'):
                raise BrokerError('INVALID_REQUEST')
            runtime = self.native_runtime()
            runtime.maintenance.settle_orphans()
            with self.lock, runtime.lock, runtime.state.lock, self.registry.lock:
                ids = {k for k, a in self.registry.state['accounts'].items() if a['provider'] == provider}
                pending = list(runtime.active.values()) + list(runtime.state.state['sessions'].values())
                if any(v.get('accountId') in ids and (v.get('stop') or any(v.get(k) for k in ('active', 'uncertain', 'rootPending', 'forkUncertain', 'forkAwaitingInput'))) for v in pending):
                    raise BrokerError('CLI_BUSY')
                if provider == 'claude' and self.external_logins:
                    raise BrokerError('CLI_BUSY')
                if provider == 'codex' and any(j['value']['state'] in ACTIVE or j['value']['cleanup'] != 'confirmed' for j in self.jobs.values()):
                    raise BrokerError('CLI_BUSY')
                if method.endswith('check-cli'):
                    return {'provider': provider, 'idle': True}
                executable = params['executable']
                if not isinstance(executable, str):
                    raise BrokerError('INVALID_REQUEST')
                if executable:
                    executable = trusted_path(executable, owners={0}, final_uid=0, kind='executable', allow_symlinks=True)
                config_file = Path(trusted_path('/etc/agent-workbench/accounts.json', owners={0}, final_uid=0, kind='file'))
                if config_file.stat().st_size > 32768:
                    raise BrokerError('INVALID_REQUEST')
                current = json.loads(config_file.read_text(encoding='utf-8'))
                if current.get(provider + 'Executable') != executable or current.get('authorityId') != self.authority_id or current.get('generation') != self.generation or current.get('ownerUid') != self.owner_uid:
                    raise BrokerError('STALE_AUTHORITY')
                self.config[provider + 'Executable'] = executable
                if provider == 'codex':
                    self.binary = executable
                return {'provider': provider, 'executable': executable}
        if isinstance(method, str) and method.startswith('migration/'):
            from migration import LegacyMigration
            from runtime import RuntimeErrorCode
            try:
                with self.lock:
                    if self.migration is None:
                        self.migration = LegacyMigration(self)
                return self.migration.dispatch(peer_uid, method, params)
            except RuntimeErrorCode as error:
                raise BrokerError(str(error)) from None
        if isinstance(method, str) and method.startswith('runtime/'):
            self._authority(params)
            common = {'authorityId', 'generation'}
            if method == 'runtime/claude-prepare' and peer_uid == 0 and set(params) == common | {'requestId'}:
                account_id = 'draft-' + require_id(params['requestId'])
                with self.registry.lock:
                    existing = self.registry.state['accounts'].get(account_id)
                    if not existing:
                        secure_directory(self.registry.profiles / account_id)
                        existing = self.registry.add(account_id, {'status': 'unauthenticated'}, provider='claude', pending=True)
                    return existing
            if method == 'runtime/claude-discard' and peer_uid == 0 and set(params) == common | {'accountId', 'accountGeneration'}:
                with self.lock, self.registry.lock:
                    account_id = require_id(params['accountId'])
                    row = self.registry.state['accounts'].get(account_id)
                    if not row:
                        return {'discarded': True}
                    if row['generation'] != params['accountGeneration'] or not row.get('pendingLogin') or account_id in self.external_logins:
                        raise BrokerError('ACCOUNT_RUNTIME_BUSY')
                    candidate = copy.deepcopy(self.registry.state)
                    del candidate['accounts'][account_id]
                    candidate['revision'] += 1
                    self.registry._commit(candidate)
                    return {'discarded': True}
            if method in ('runtime/login-reserve', 'runtime/login-release', 'runtime/remove'):
                from account_admin import dispatch
                return dispatch(self, peer_uid, method, params)
            if method == 'runtime/legacy-enroll' and peer_uid == 0 and set(params) == common | {'accountRef', 'email', 'sameAccountConfirmed'}:
                from migration import LegacyMigration
                from runtime import RuntimeErrorCode
                try:
                    with self.lock:
                        if self.migration is None:
                            self.migration = LegacyMigration(self)
                    return self.migration.enroll({k: v for k, v in params.items() if k not in common})
                except RuntimeErrorCode as error:
                    raise BrokerError(str(error)) from None
            if method == 'runtime/usage':
                from runtime import RuntimeErrorCode
                try:
                    return self.native_runtime().usage(peer_uid, params)
                except RuntimeErrorCode as error:
                    raise BrokerError(str(error)) from None
            if method == 'runtime/models' and set(params) == common | {'accountId', 'accountGeneration'}:
                from runtime import RuntimeErrorCode
                try:
                    return self.native_runtime().models(peer_uid, require_id(params['accountId']), require_id(params['accountGeneration']))
                except RuntimeErrorCode as error:
                    raise BrokerError(str(error)) from None
            if method in ('runtime/status', 'runtime/review') and set(params) == common | {'accountId'}:
                from runtime import RuntimeErrorCode
                try:
                    result = self.native_runtime().status(peer_uid, require_id(params['accountId']), review=method == 'runtime/review')
                    return result
                except RuntimeErrorCode as error:
                    raise BrokerError(str(error)) from None
            if method == 'runtime/claude-create' and peer_uid == 0 and set(params) == common | {'requestId', 'expectedRevision'}:
                # The caller persists requestId before sending; duplicate recovery
                # resolves the same native profile without another account.
                request_id = require_id(params['requestId'])
                account_id = 'claude-' + request_id
                with self.registry.lock:
                    existing = self.registry.state['accounts'].get(account_id)
                    if not existing:
                        if params['expectedRevision'] != self.registry.state['revision']:
                            raise BrokerError('STALE_SELECTION')
                        secure_directory(self.registry.profiles / account_id)
                        existing = self.registry.add(account_id, {'status': 'unauthenticated'}, provider='claude')
                return existing
            if method == 'runtime/login-command' and peer_uid == 0 and set(params) == common | {'accountId'}:
                import pwd
                account_id = require_id(params['accountId'])
                account = self.registry.state['accounts'].get(account_id)
                if not account or account['provider'] not in ('claude', 'codex'):
                    raise BrokerError('ACCOUNT_UNAVAILABLE')
                import shlex
                user = pwd.getpwuid(self.owner_uid)
                owner = user.pw_name
                provider = account['provider']
                binary = self.config.get(provider + 'Executable')
                if not binary:
                    raise BrokerError('RUNTIME_NOT_INSTALLED')
                profile_variable = 'CODEX_HOME' if provider == 'codex' else 'CLAUDE_CONFIG_DIR'
                login_args = ['login'] if provider == 'codex' else ['auth', 'login']
                return {'command': ' '.join(shlex.quote(v) for v in ['sudo', '-u', owner, 'env', '-i', 'HOME=' + user.pw_dir, 'USER=' + owner, 'PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8', profile_variable + '=' + str(self.registry.profiles / account_id), binary] + login_args)}
            raise BrokerError('INVALID_REQUEST')
        allowed = {'catalog/list': set(), 'selection/set': {'authorityId', 'generation', 'accountId', 'expectedRevision'},
                   'login/start': {'authorityId', 'generation'}, 'login/status': {'authorityId', 'generation', 'jobId'},
                   'login/cancel': {'authorityId', 'generation', 'jobId'}}
        if method not in allowed or set(params) != allowed[method]:
            raise BrokerError('INVALID_REQUEST')
        if method == 'catalog/list':
            return self._catalog(workspace, allowed_accounts)
        self._authority(params)
        if method == 'selection/set':
            if peer_uid == 0:
                raise BrokerError('ADMIN_SELECTION_FORBIDDEN')
            account_id = require_id(params['accountId'])
            if account_id not in allowed_accounts:
                raise BrokerError('ACCOUNT_FORBIDDEN')
            self.registry.select(workspace, account_id, params['expectedRevision'])
            return self._catalog(workspace, allowed_accounts)
        if method == 'login/start':
            if peer_uid != 0:
                raise BrokerError('ADMIN_LOGIN_REQUIRED')
            return self._start(peer_uid)
        with self.lock:
            job = self._job(peer_uid, params['jobId'])
            if method == 'login/status':
                if job['value']['state'] in ACTIVE and self.now() >= job['expiresAt']:
                    job['value']['state'] = 'expired'
                    job['cancelRequested'] = True
                    self._clear_code(job['value'])
                elif job['value']['state'] in ACTIVE:
                    job['worker'].renew()
                    return copy.deepcopy(job['value'])
                else:
                    return copy.deepcopy(job['value'])
            if job['value']['state'] == 'authenticated' and job['value']['cleanup'] == 'confirmed':
                return copy.deepcopy(job['value'])
            job['cancelRequested'] = True
            if job['value']['state'] in ACTIVE:
                job['value']['state'] = 'cancelled'
            self._clear_code(job['value'])
        job['worker'].cancel()
        with self.lock:
            if job['value']['cleanup'] == 'pending':
                job['value']['cleanup'] = 'unconfirmed'
            return copy.deepcopy(job['value'])

    def _start(self, peer_uid):
        if peer_uid != 0:
            raise BrokerError('ADMIN_LOGIN_REQUIRED')
        if not self.binary:
            raise BrokerError('RUNTIME_NOT_INSTALLED')
        with self.lock:
            if self.closed or any(row['value']['state'] in ACTIVE or row['value']['cleanup'] != 'confirmed' for row in self.jobs.values()):
                raise BrokerError('LOGIN_BUSY')
            if len(self.jobs) >= 128:
                self.jobs.pop(next(iter(self.jobs)))
            job_id = str(uuid.uuid4())
            account_id = 'account-' + uuid.uuid4().hex
            profile = secure_directory(self.registry.profiles / account_id)
            now = self.now()
            value = {'jobId': job_id, 'hostId': self.authority_id, 'state': 'preparing', 'createdAt': iso(now),
                     'expiresAt': iso(now + 900), 'cleanup': 'pending'}
            worker = self.worker_factory(profile, self.binary, self.owner_uid, lambda update: self._update(job_id, update))
            self.jobs[job_id] = {'value': value, 'worker': worker, 'peerUid': peer_uid, 'accountId': account_id, 'cancelRequested': False, 'expiresAt': now + 900}
            initial = copy.deepcopy(value)
            worker.start()
            return initial

    @staticmethod
    def _clear_code(value):
        value.pop('verificationUrl', None)
        value.pop('userCode', None)

    def _update(self, job_id, update):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or not isinstance(update, dict):
                return
            value = job['value']
            state = update.get('state')
            if update.get('cleanup') in ('confirmed', 'unconfirmed'):
                value['cleanup'] = update['cleanup']
            if job['cancelRequested']:
                self._clear_code(value)
                return
            if value['state'] not in ACTIVE:
                return
            if state == 'awaiting-code':
                code = update.get('userCode')
                if update.get('verificationUrl') != DEVICE_URL or not isinstance(code, str) or not re.fullmatch(r'[A-Z0-9]{4,6}-[A-Z0-9]{4,6}', code):
                    value['state'] = 'failed'
                    value['error'] = 'NATIVE_AUTH_FAILED'
                    job['cancelRequested'] = True
                    self._clear_code(value)
                    job['worker'].cancel(wait_seconds=0)
                    return
                value.update(state=state, verificationUrl=DEVICE_URL, userCode=code)
            elif state == 'authenticated' and value['cleanup'] == 'confirmed':
                try:
                    metadata = public_metadata(update.get('account'))
                    if metadata['status'] != 'authenticated':
                        raise BrokerError('ACCOUNT_UNAVAILABLE')
                    self.registry.add(job['accountId'], metadata)
                    value.update(state='authenticated', account=metadata)
                except (OSError, ValueError, BrokerError):
                    value.update(state='failed', error='CATALOG_COMMIT_FAILED')
                self._clear_code(value)
            elif state in ('verifying', 'cancelled', 'expired', 'failed'):
                value['state'] = state
                self._clear_code(value)
                if state == 'failed':
                    value['error'] = 'NATIVE_AUTH_FAILED'

    def close(self):
        self.closed = True
        if self.runtime:
            self.runtime.close()
        with self.lock:
            jobs = list(self.jobs.values())
            for job in jobs:
                if job['value']['state'] in ACTIVE:
                    job['cancelRequested'] = True
                    job['value']['state'] = 'cancelled'
                    self._clear_code(job['value'])
        for job in jobs:
            if job['value']['cleanup'] != 'confirmed':
                job['worker'].cancel()


def create_server(broker, socket_path):
    """The same peer-authenticated endpoint is exercised by isolated Linux tests."""
    slots = threading.BoundedSemaphore(32)

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            if not slots.acquire(blocking=False):
                return
            held = True
            try:
                try:
                    self.connection.settimeout(25)
                    _, uid, _ = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                    broker._identity(uid)
                    raw = self.rfile.readline(8193)
                    if len(raw) > 8192:
                        raise BrokerError('INVALID_REQUEST')
                    request = json.loads(raw)
                    if not isinstance(request, dict):
                        raise BrokerError('INVALID_REQUEST')
                    if request.get('protocol') == 1 and request.get('method') in ('runtime/open', 'runtime/open-claude'):
                        from runtime import RuntimeErrorCode
                        slots.release()
                        held = False
                        self.connection.settimeout(None)
                        try:
                            runtime = broker.native_runtime()
                            if request['method'] == 'runtime/open-claude':
                                from claude_session import serve
                                serve(runtime, uid, request.get('params'), self.rfile, self.wfile, lambda: self.connection.shutdown(socket.SHUT_RDWR))
                            else:
                                runtime.serve(uid, request.get('params'), self.rfile, self.wfile, lambda: self.connection.shutdown(socket.SHUT_RDWR))
                        except (RuntimeErrorCode, BrokerError) as error:
                            self.wfile.write((json.dumps({'ok': False, 'error': str(error)}) + '\n').encode())
                        return
                    response = {'ok': True, 'value': broker.dispatch(uid, request)}
                except BrokerError as error:
                    response = {'ok': False, 'error': error.code}
                except (OSError, ValueError, TypeError, EOFError):
                    response = {'ok': False, 'error': 'INTERNAL_ERROR'}
                self.wfile.write((json.dumps(response, separators=(',', ':')) + '\n').encode())
            except OSError:
                pass
            finally:
                if held:
                    slots.release()

    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True

    return Server(socket_path, Handler)


def main():
    parser = argparse.ArgumentParser(description='Independent VPS account metadata and native-login broker')
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    if not hasattr(socket, 'SO_PEERCRED') or os.geteuid() == 0:
        raise RuntimeError('Dedicated non-root Linux credential owner required')
    config_file = Path(trusted_path(os.path.abspath(args.config), owners={0}, final_uid=0, kind='file'))
    info = config_file.lstat()
    if config_file.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 32768:
        raise RuntimeError('Root-owned explicit broker configuration required')
    with config_file.open('r', encoding='utf-8') as source:
        config = json.load(source)
    if config.get('ownerUid') != os.geteuid():
        raise RuntimeError('Credential owner UID does not match configuration')
    owner_uid = os.geteuid()
    config['root'] = trusted_path(config.get('root'), owners={0, owner_uid}, final_uid=owner_uid, kind='directory', private=True)
    trusted_path(config['root'] + '/profiles', owners={0, owner_uid}, final_uid=owner_uid, kind='directory', private=True)
    if os.path.lexists(config['root'] + '/catalog.json'):
        trusted_path(config['root'] + '/catalog.json', owners={0, owner_uid}, final_uid=owner_uid, kind='file', private=True)
    if config.get('codexExecutable'):
        config['codexExecutable'] = trusted_path(config['codexExecutable'], owners={0}, final_uid=0, kind='executable', allow_symlinks=True)
    if config.get('claudeExecutable'):
        config['claudeExecutable'] = trusted_path(config['claudeExecutable'], owners={0}, final_uid=0, kind='executable', allow_symlinks=True)
    socket_path = '/run/agent-workbench-accounts/broker.sock'
    socket_directory = Path(trusted_path(str(PurePosixPath(socket_path).parent), owners={0, owner_uid}, final_uid=owner_uid, kind='directory'))
    os.umask(0o077)
    broker = AccountBroker(config)
    descriptor = os.open(socket_directory / 'server.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner_uid or metadata.st_mode & 0o077:
        os.close(descriptor)
        raise RuntimeError('Private runtime lock required')
    lock = os.fdopen(descriptor, 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if os.path.lexists(socket_path):
        metadata = os.lstat(socket_path)
        if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != os.geteuid():
            raise RuntimeError('Unexpected existing socket path')
        os.unlink(socket_path)
    server = create_server(broker, socket_path)
    broker.native_runtime().maintenance.start()
    # The directory is never member-writable. UID policy authenticates callers
    # before reading requests; public-connect mode requires explicit deployment.
    if config.get('socketAccess', 'group') not in ('group', 'peer-policy'):
        raise RuntimeError('Invalid socket access mode')
    os.chmod(socket_path, 0o666 if config.get('socketAccess') == 'peer-policy' else 0o660)
    def stop(signum, frame):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=.2)
    finally:
        broker.close()
        server.server_close()
        os.unlink(socket_path)
        lock.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never print authentication contents, raw native output, paths or exceptions.
        raise SystemExit('Account broker could not start safely.') from None
