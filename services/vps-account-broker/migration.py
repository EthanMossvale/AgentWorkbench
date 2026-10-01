"""Explicit, credential-free adoption of retired Codex sessions.

Only root stages history. Members can read their own committed receipt. Public
account IDs/generations stay unchanged, preserving the existing quota ledger.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import threading
from urllib.parse import quote, unquote

from runtime import RuntimeErrorCode, atomic

MAX_HISTORY_FILE = 128 * 1024 * 1024
UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'


def require(condition, code='MIGRATION_INVALID'):
    if not condition:
        raise RuntimeErrorCode(code)


def reference(value):
    require(isinstance(value, str) and value.startswith('vps-account:'))
    parts = [unquote(v) for v in value[12:].split('/')]
    require(len(parts) == 5 and parts[2] == 'codex' and all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', v) for v in parts))
    return parts


def native_reference(broker, account):
    return 'vps-account:' + '/'.join(quote(v, safe='') for v in (broker.authority_id, broker.generation, 'codex', account['id'], account['generation']))


def regular(path, owner, limit, dir_fd=None):
    """Read one exact regular file; never follow links or accept racing writes."""
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0), dir_fd=dir_fd)
    except OSError:
        raise RuntimeErrorCode('MIGRATION_UNSAFE_FILE') from None
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == owner and before.st_size <= limit, 'MIGRATION_UNSAFE_FILE')
        value = source.read(limit + 1)
        after = os.fstat(source.fileno())
        require(len(value) <= limit and (before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'MIGRATION_SOURCE_CHANGED')
        return value


def directory(path, owner, private=True):
    info = os.lstat(path)
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == owner and not info.st_mode & (0o077 if private else 0o022), 'MIGRATION_UNSAFE_DIRECTORY')


def histories(root, owner):
    """Only official rollout files; no auth, configuration, SQLite or shell data."""
    result = {}
    for category in ('sessions', 'archived_sessions'):
        folder = root / category
        if not folder.exists() and not folder.is_symlink():
            continue
        for parent, dirs, files, parent_fd in os.fwalk(folder, follow_symlinks=False):
            info = os.fstat(parent_fd)
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == owner and not info.st_mode & 0o022, 'MIGRATION_UNSAFE_DIRECTORY')
            for name in dirs:
                info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                require(stat.S_ISDIR(info.st_mode) and info.st_uid == owner and not info.st_mode & 0o022, 'MIGRATION_UNSAFE_DIRECTORY')
            for name in files:
                require(name.startswith('rollout-') and name.endswith('.jsonl'), 'MIGRATION_UNEXPECTED_HISTORY_FILE')
                path = Path(parent) / name
                raw = regular(name, owner, MAX_HISTORY_FILE, dir_fd=parent_fd)
                try:
                    first = json.loads(raw.split(b'\n', 1)[0])
                    meta = first['payload']
                    ident = meta['id']
                    require(first['type'] == 'session_meta' and re.fullmatch(UUID, ident))
                    require(meta.get('model_provider') in (None, 'openai'), 'MIGRATION_PROVIDER_MISMATCH')
                    # Validate all JSONL records without changing native content.
                    for line in raw.splitlines():
                        require(isinstance(json.loads(line), dict))
                except (ValueError, KeyError, TypeError):
                    raise RuntimeErrorCode('MIGRATION_INVALID_ROLLOUT') from None
                suffix = re.search('(' + UUID + r')\.jsonl$', name)
                require(suffix, 'MIGRATION_INVALID_ROLLOUT_NAME')
                rollout_id = suffix.group(1)
                require(rollout_id not in result, 'MIGRATION_DUPLICATE_ROLLOUT')
                source = meta.get('source')
                parent_id = meta.get('parent_thread_id')
                if isinstance(source, dict):
                    agent = source.get('subagent', source.get('subAgent', {}))
                    if isinstance(agent, dict) and isinstance(agent.get('thread_spawn'), dict):
                        source_parent = agent['thread_spawn'].get('parent_thread_id')
                        require(parent_id is None or parent_id == source_parent, 'MIGRATION_PARENT_MISMATCH')
                        parent_id = source_parent
                require(parent_id is None or isinstance(parent_id, str) and re.fullmatch(UUID, parent_id))
                history_base = meta.get('history_base')
                if history_base is not None:
                    require(isinstance(history_base, dict) and re.fullmatch(UUID, str(history_base.get('thread_id'))) and all(type(history_base.get(k)) is int and history_base[k] >= 0 for k in ('end_ordinal_exclusive', 'end_byte_offset')), 'MIGRATION_INVALID_HISTORY_BASE')
                result[rollout_id] = {'relative': path.relative_to(root), 'raw': raw, 'threadId': ident, 'parentId': parent_id, 'historyBase': history_base}
    return result


class LegacyMigration:
    def __init__(self, broker):
        self.broker = broker
        self.path = broker.registry.root / 'migration-state.json'
        self.staging = broker.registry.root / 'migration-staging'
        self.staging.mkdir(mode=0o700, exist_ok=True)
        directory(self.staging, os.geteuid())
        self.lock = threading.RLock()
        self.state = {'accounts': {}, 'sessions': {}}
        if self.path.exists() or self.path.is_symlink():
            self.state = json.loads(regular(self.path, os.geteuid(), 8 * 1024 * 1024))
            require(isinstance(self.state, dict) and set(self.state) == {'accounts', 'sessions'} and all(isinstance(v, dict) for v in self.state.values()))

    def save(self):
        atomic(self.path, self.state)

    def enroll(self, params):
        require(set(params) == {'accountRef', 'email', 'sameAccountConfirmed'})
        require(params['sameAccountConfirmed'] is True, 'MIGRATION_ACCOUNT_CONFIRMATION_REQUIRED')
        parts = reference(params['accountRef'])
        email = params['email']
        from broker import safe_text
        require(safe_text(email) and 0 < len(email) <= 256 and '@' in email and not re.search(r'[\x00-\x1f]', email))
        ident, generation = parts[3:]
        with self.lock, self.broker.registry.lock:
            existing = self.state['accounts'].get(params['accountRef'])
            candidate = {'id': ident, 'generation': generation, 'email': email}
            require(not existing or existing == candidate, 'MIGRATION_ACCOUNT_CHANGED')
            account = self.broker.registry.state['accounts'].get(ident)
            require(not account or existing and account['generation'] == generation and account['provider'] == 'codex', 'MIGRATION_ACCOUNT_COLLISION')
            # Journal before creating the account: recovery can finish enrollment.
            self.state['accounts'][params['accountRef']] = candidate
            self.save()
            if not account:
                profile = self.broker.registry.profiles / ident
                if profile.exists():
                    directory(profile, os.geteuid())
                    require(not any(profile.iterdir()), 'MIGRATION_PROFILE_COLLISION')
                else:
                    profile.mkdir(mode=0o700)
                account = self.broker.registry.add(ident, {'status': 'unauthenticated', 'email': email}, generation=generation)
            return {'accountId': ident, 'accountGeneration': generation, 'accountRef': native_reference(self.broker, account)}

    def manifest(self, value):
        fields = {'version', 'sessionId', 'username', 'accountRef', 'threadId', 'turnId', 'uncertain', 'environmentId', 'cwd'}
        require(isinstance(value, dict) and set(value) == fields and value['version'] == 1)
        reference(value['accountRef'])
        require(re.fullmatch(UUID, str(value['sessionId'])) and (value['threadId'] is None or re.fullmatch(UUID, str(value['threadId']))))
        require(value['turnId'] is None or isinstance(value['turnId'], str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value['turnId']))
        require(type(value['uncertain']) is bool and value['environmentId'] == 'local-device' and isinstance(value['cwd'], str) and 0 < len(value['cwd']) <= 2048 and not re.search(r'[\x00\r\n]', value['cwd']))
        require(isinstance(value['username'], str) and re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', value['username']))
        import pwd
        uid = pwd.getpwnam(value['username']).pw_uid
        require(uid > 0 and uid != self.broker.owner_uid)
        enrolled = self.state['accounts'].get(value['accountRef'])
        require(enrolled is not None, 'MIGRATION_ENROLL_REQUIRED')
        workspace, account = self.broker.native_runtime().authorize(uid, enrolled['id'], enrolled['generation'])
        token = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        return uid, workspace, account, token

    def stage(self, value):
        with self.lock:
            _, _, _, token = self.manifest(value)
            folder = self.staging / token
            folder.mkdir(mode=0o700, exist_ok=True)
            directory(folder, os.geteuid())
            manifest = folder / 'manifest.json'
            if manifest.exists():
                require(json.loads(regular(manifest, os.geteuid(), 16384)) == value)
            else:
                atomic(manifest, value)
            return {'migrationId': token, 'stagingPath': str(folder), 'ownerUid': self.broker.owner_uid}

    def commit(self, params):
        require({'migrationId', 'sameAccountConfirmed', 'sourceStopped'} <= set(params) and set(params) <= {'migrationId', 'sameAccountConfirmed', 'sourceStopped', 'rootRollout'})
        require(params['sameAccountConfirmed'] is True and params['sourceStopped'] is True, 'MIGRATION_CONFIRMATION_REQUIRED')
        token = params['migrationId']
        require(isinstance(token, str) and re.fullmatch('[a-f0-9]{64}', token))
        with self.lock:
            folder = self.staging / token
            directory(folder, os.geteuid())
            manifest = json.loads(regular(folder / 'manifest.json', os.geteuid(), 16384))
            uid, workspace, account, expected = self.manifest(manifest)
            require(token == expected)
            key = str(uid) + ':' + manifest['sessionId']
            saved = self.state['sessions'].get(key)
            require(not saved or saved['migrationId'] == token, 'MIGRATION_SESSION_COLLISION')
            runtime = self.broker.native_runtime()
            runtime_key = hashlib.sha256((runtime.state.account_key(account) + ':' + workspace + ':' + manifest['sessionId']).encode()).hexdigest()
            with runtime.lock, runtime.state.lock:
                require(runtime_key not in runtime.active, 'MIGRATION_SESSION_ACTIVE')
                if saved:
                    require(params.get('rootRollout') is None or params['rootRollout'] == saved.get('rootRollout'), 'MIGRATION_ROLLOUT_CHANGED')
                    return self.resolve(uid, {'sessionId': manifest['sessionId'], 'accountRef': manifest['accountRef']})
                require(runtime_key not in runtime.state.state['sessions'], 'MIGRATION_SESSION_COLLISION')
                require(not manifest['threadId'] or not any(r.get('accountId') == account['id'] and r.get('threadId') == manifest['threadId'] for r in runtime.state.state['sessions'].values()), 'MIGRATION_THREAD_ALREADY_OWNED')
                # Only native account/read verifies login; explicit operator review
                # also confirms account identity because this schema has no account ID.
                from native_worker import public_account
                from runtime import NativePipe
                process = runtime.process_factory(account)
                try:
                    pipe = NativePipe(process)
                    pipe.initialize()
                    metadata = public_account(pipe.call('account/read', {'refreshToken': False}).get('account'))
                    enrolled = self.state['accounts'][manifest['accountRef']]
                    require(metadata and metadata.get('email') == enrolled['email'], 'MIGRATION_ACCOUNT_LOGIN_MISMATCH')
                    runtime.observe_identity(account, metadata)
                finally:
                    runtime.stop(process)
                files = histories(folder, os.geteuid())
                root = manifest['threadId']
                roots = [f for f in files.values() if f['threadId'] == root]
                require(bool(roots) if root else not files, 'MIGRATION_HISTORY_MISSING')
                selected = params.get('rootRollout')
                if root and len(roots) != 1 and selected is None:
                    raise RuntimeErrorCode('MIGRATION_ROOT_ROLLOUT_REQUIRED')
                if selected is not None:
                    roots = [f for f in roots if f['relative'].as_posix() == selected]
                    require(len(roots) == 1, 'MIGRATION_ROOT_ROLLOUT_MISMATCH')
                root_file = roots[0] if root else None
                owned_threads = {root} if root else set()
                while True:
                    expanded = owned_threads | {f['threadId'] for f in files.values() if f['parentId'] in owned_threads}
                    if expanded == owned_threads:
                        break
                    owned_threads = expanded
                owned = {key for key, f in files.items() if f['threadId'] in owned_threads}
                visiting, complete = set(), set()
                def dependency(key):
                    require(key not in visiting, 'MIGRATION_HISTORY_CYCLE')
                    if key in complete:
                        return
                    require(key in files, 'MIGRATION_HISTORY_DEPENDENCY_MISSING')
                    visiting.add(key)
                    base = files[key]['historyBase']
                    if base:
                        parent = base['thread_id']
                        require(parent in files, 'MIGRATION_HISTORY_DEPENDENCY_MISSING')
                        offset = base['end_byte_offset']
                        data = files[parent]['raw']
                        require(offset <= len(data) and (offset == 0 or data[offset-1:offset] == b'\n'), 'MIGRATION_HISTORY_PREFIX_INVALID')
                        dependency(parent)
                        owned.add(parent)
                    visiting.remove(key); complete.add(key)
                for key in list(owned):
                    dependency(key)
                require(set(files) == owned, 'MIGRATION_FOREIGN_THREAD')
                profile = self.broker.registry.profiles / account['id']
                directory(profile, os.geteuid())
                for entry in files.values():
                    relative, raw = entry['relative'], entry['raw']
                    target = profile / relative
                    current = profile
                    for part in relative.parts[:-1]:
                        current = current / part
                        current.mkdir(mode=0o700, exist_ok=True)
                        directory(current, os.geteuid())
                    if target.exists() or target.is_symlink():
                        require(regular(target, os.geteuid(), MAX_HISTORY_FILE) == raw, 'MIGRATION_HISTORY_COLLISION')
                    else:
                        # Stage, fsync, then atomic rename; an interrupted copy can
                        # never be mistaken for a completed native rollout.
                        import uuid
                        temporary = target.with_name('.migration-' + uuid.uuid4().hex)
                        with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
                            output.write(raw); output.flush(); os.fsync(output.fileno())
                        os.replace(temporary, target)
                receipt = {'migrationId': token, 'sessionId': manifest['sessionId'], 'previousAccountRef': manifest['accountRef'], 'accountRef': native_reference(self.broker, account), 'threadId': root, 'turnId': manifest['turnId'], 'uncertain': manifest['uncertain'], 'environmentId': manifest['environmentId'], 'cwd': manifest['cwd']}
                binding = {'uid': uid, 'accountId': account['id'], 'accountGeneration': account['generation'], 'sessionId': manifest['sessionId'], 'environmentId': manifest['environmentId'], 'cwd': manifest['cwd'], 'uncertain': manifest['uncertain']}
                if root:
                    binding.update(threadId=root, rolloutPath=str(profile / root_file['relative']))
                    binding['childThreadIds'] = sorted(owned_threads - {root})
                if manifest['turnId']:
                    binding['turnId'] = manifest['turnId']
                # One persisted adoption record is the recovery authority. Seeding
                # runtime state is repeated safely if the service stops in between.
                self.state['sessions'][str(uid) + ':' + manifest['sessionId']] = {'migrationId': token, 'receipt': receipt, 'runtimeKey': runtime_key, 'binding': binding, 'rootRollout': root_file['relative'].as_posix() if root_file else None}
                self.save()
                runtime.state.state['sessions'][runtime_key] = binding
                runtime.state.save()
                return copy.deepcopy(receipt)

    def resolve(self, uid, params):
        require(set(params) == {'sessionId', 'accountRef'} and uid > 0)
        reference(params['accountRef'])
        with self.lock:
            saved = self.state['sessions'].get(str(uid) + ':' + str(params['sessionId']))
            require(saved and saved['receipt']['previousAccountRef'] == params['accountRef'], 'MIGRATION_NOT_READY')
            binding = saved['binding']
            runtime = self.broker.native_runtime()
            runtime.authorize(uid, binding['accountId'], binding['accountGeneration'])
            with runtime.state.lock:
                if saved['runtimeKey'] not in runtime.state.state['sessions']:
                    runtime.state.state['sessions'][saved['runtimeKey']] = copy.deepcopy(binding)
                    runtime.state.save()
            return copy.deepcopy(saved['receipt'])

    def dispatch(self, uid, method, params):
        if method == 'migration/account-resolve':
            require(set(params) == {'accountRef'})
            enrolled = self.state['accounts'].get(params['accountRef'])
            require(enrolled, 'MIGRATION_NOT_READY')
            _, account = self.broker.native_runtime().authorize(uid, enrolled['id'], enrolled['generation'])
            require(account.get('status') == 'authenticated' and account.get('email') == enrolled['email'], 'MIGRATION_ACCOUNT_LOGIN_MISMATCH')
            return {'previousAccountRef': params['accountRef'], 'accountRef': native_reference(self.broker, account)}
        if method == 'migration/resolve':
            return self.resolve(uid, params)
        require(uid == 0, 'ADMIN_REVIEW_REQUIRED')
        if method == 'migration/enroll':
            return self.enroll(params)
        if method == 'migration/stage' and set(params) == {'manifest'}:
            return self.stage(params['manifest'])
        if method == 'migration/commit':
            return self.commit(params)
        raise RuntimeErrorCode('INVALID_REQUEST')
