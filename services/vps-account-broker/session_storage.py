"""Verified native history working-copy reclamation; never stores login material."""
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time

CATEGORIES = {'codex': ('sessions', 'archived_sessions', 'generated_images'),
              'claude': ('projects', 'file-history', 'todos', 'tasks', 'session-env')}
CHUNK = 256*1024


def manifest_hash(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def require(value, code='STORAGE_INVALID'):
    if not value:
        raise RuntimeError(code)


class StorageLeases:
    def __init__(self, runtime):
        self.runtime = runtime
        self.leases = {}
        self.candidate_offsets = {}

    def check_start(self, account_id, session_id, source_session=None):
        lease = self.leases.get(account_id)
        ids = {session_id, source_session}
        require(not lease or lease['expires'] < time.monotonic() or not ids.intersection(lease['sessions']), 'STORAGE_BUSY')
        require(not any(r.get('accountId') == account_id and r.get('sessionId') in ids and r.get('storageArchive') for r in self.runtime.state.state['sessions'].values()), 'STORAGE_RESTORE_REQUIRED')

    def dispatch(self, method, params):
        from session_idle import idle_status
        runtime, broker = self.runtime, self.runtime.broker
        provider = params.get('provider')
        require(provider in CATEGORIES)
        idle_seconds = params.get('idleSeconds', 86400)
        require(type(idle_seconds) is int and 3600 <= idle_seconds <= 8760*3600 and idle_seconds % 3600 == 0)
        if method == 'storage/candidates':
            with runtime.state.lock:
                expired = [r['sessionId'] for r in runtime.state.state['sessions'].values()
                           if r.get('sessionId') and idle_status(r, broker.now(), idle_seconds)['eligible']
                           and broker.registry.state['accounts'].get(r.get('accountId'), {}).get('provider') == provider]
            runtime.maintenance.reclaim_expired(expired, idle_seconds)
        with runtime.lock, runtime.state.lock, broker.registry.lock:
            accounts = [a for a in broker.registry.state['accounts'].values() if a['provider'] == provider]
            receipts = runtime.state.state['sessions']
            login_busy = bool(broker.external_logins) if provider == 'claude' else any(j['value']['state'] in ('preparing', 'awaiting-code', 'verifying') or j['value']['cleanup'] != 'confirmed' for j in broker.jobs.values())
            if method == 'storage/sessions':
                # Metadata only: inspection never initializes clocks, stops a
                # process, scans native history or advances retention leases.
                after = params.get('after', '')
                limit = params.get('limit', 50)
                require(isinstance(after, str) and len(after) <= 256 and type(limit) is int and 1 <= limit <= 100)
                owned = {a['id']:a for a in accounts}
                rows = sorted((r for r in receipts.values() if r.get('sessionId') and r.get('accountId') in owned and r.get('accountGeneration') == owned[r['accountId']]['generation']), key=lambda r:r['sessionId'])
                page = [r for r in rows if r['sessionId'] > after][:limit+1]
                observed = broker.now()
                sessions = []
                for row in page[:limit]:
                    clock = idle_status(row, observed, idle_seconds)
                    active = any(e.get('sessionId') == row['sessionId'] for e in runtime.active.values())
                    lease = self.leases.get(row['accountId'])
                    operation = ('restoring' if lease['restore'] else 'archiving') if lease and lease['expires'] >= time.monotonic() and row['sessionId'] in lease['sessions'] else None
                    remote = 'restore_pending' if row.get('storageRestorePending') else 'reclaimed' if row.get('storageReclaimed') else 'marked' if row.get('storageArchive') else 'present'
                    sessions.append(dict(sessionId=row['sessionId'], accountId=row['accountId'], accountGeneration=row['accountGeneration'], threadId=row.get('threadId'),
                                         lastModelActivity=clock['lastModelActivity'], idleSeconds=clock['idleSeconds'], eligible=clock['eligible'], clockReason=clock['reason'],
                                         dueAt=clock['lastModelActivity']+idle_seconds if clock['reason'] not in ('activity_unknown', 'clock_ahead') else None,
                                         active=active, interrupted=bool(row.get('interrupted')), uncertain=bool(row.get('uncertain') or row.get('forkUncertain')),
                                         remoteState=remote, operation=operation, **({'archiveId':row['storageArchive']} if row.get('storageArchive') else {})))
                return dict(retentionVersion=2, idleSeconds=idle_seconds, sessions=sessions, total=len(rows), nextCursor=page[limit-1]['sessionId'] if len(page)>limit else None, observedAt=observed, loginBusy=login_busy, authorityId=broker.authority_id, generation=broker.generation)
            require(not login_busy, 'STORAGE_BUSY')
            if method == 'storage/candidates':
                candidates = []
                for account in accounts:
                    for row in receipts.values():
                        if row.get('accountId') == account['id'] and row.get('accountGeneration') == account['generation'] and row.get('threadId') and (not row.get('storageReclaimed') or row.get('storageRestorePending')) and idle_status(row, broker.now(), idle_seconds)['eligible'] and not any(e.get('sessionId') == row['sessionId'] for e in runtime.active.values()):
                            candidates.append(dict(accountId=account['id'], accountGeneration=account['generation'], sessions=[row['sessionId']], restorePending=bool(row.get('storageRestorePending')), reconcile=bool(row.get('storageArchive') and not row.get('storageReclaimed')), **({'archiveId':row['storageArchive']} if row.get('storageArchive') else {})))
                if len(candidates) > 1000:
                    offset = self.candidate_offsets.get(provider, 0) % len(candidates)
                    self.candidate_offsets[provider] = (offset+1000) % len(candidates)
                    candidates = (candidates[offset:]+candidates[:offset])[:1000]
                return dict(candidates=candidates, authorityId=broker.authority_id, generation=broker.generation)
            account = next((a for a in accounts if a['id'] == params.get('accountId') and a['generation'] == params.get('accountGeneration')), None)
            require(account, 'STORAGE_ACCOUNT_CHANGED')
            all_rows = [r for r in receipts.values() if r.get('accountId') == account['id'] and r.get('accountGeneration') == account['generation']]
            token = params.get('archiveId')
            require(isinstance(token, str) and re.fullmatch(r'[a-f0-9]{32}', token))
            lease = self.leases.get(account['id'])
            if method == 'storage/begin':
                selected = params.get('sessions')
                require(isinstance(selected, list) and selected and len(selected) <= 1000 and all(isinstance(v, str) for v in selected))
                rows = [r for r in all_rows if r.get('sessionId') in selected]
                require({r['sessionId'] for r in rows} == set(selected), 'STORAGE_SESSION_CHANGED')
                require(not any(e.get('sessionId') in selected for e in runtime.active.values()), 'STORAGE_BUSY')
                require(not lease or lease['expires'] < time.monotonic() or lease['archiveId'] == token, 'STORAGE_BUSY')
                restore = params.get('restore') is True
                if restore:
                    require(all(r.get('storageArchive') in (None, token) for r in rows), 'STORAGE_ARCHIVE_CHANGED')
                    require(re.fullmatch(r'[a-f0-9]{64}', str(params.get('manifestHash'))) and all(not r.get('storageArchive') or r.get('storageManifest') == params['manifestHash'] for r in rows), 'STORAGE_ARCHIVE_CHANGED')
                else:
                    require(all(idle_status(r, broker.now(), idle_seconds)['eligible'] and (not r.get('storageArchive') or r['storageArchive'] == token and r.get('storageManifest') == params.get('manifestHash')) for r in rows), 'STORAGE_BUSY')
                lease = dict(archiveId=token, expires=time.monotonic()+180, restore=restore, sessions=selected, marked=any(r.get('storageArchive') == token for r in rows), manifestHash=params.get('manifestHash'))
                self.leases[account['id']] = lease
                if restore:
                    for row in rows:
                        row['storageRestorePending'] = True
                    runtime.state.save()
            else:
                require(lease and lease['archiveId'] == token and lease['expires'] >= time.monotonic(), 'STORAGE_LEASE_EXPIRED')
                lease['expires'] = time.monotonic()+180
                rows = [r for r in all_rows if r['sessionId'] in lease['sessions']]
                if method == 'storage/mark':
                    require(not lease['restore'])
                    require(all(idle_status(row, broker.now(), idle_seconds)['eligible'] for row in rows), 'STORAGE_NOT_DUE')
                    require(re.fullmatch(r'[a-f0-9]{64}', str(params.get('manifestHash'))))
                    require(all(not row.get('storageArchive') or row.get('storageArchive') == token and row.get('storageManifest') == params['manifestHash'] for row in rows), 'STORAGE_ARCHIVE_CHANGED')
                    for row in rows:
                        row['storageArchive'] = token
                        row['storageManifest'] = params['manifestHash']
                        row['storageReclaimed'] = False
                    lease['marked'] = True
                    runtime.state.save()
                elif method == 'storage/restored':
                    require(lease['restore'] and lease['manifestHash'] == params.get('manifestHash'), 'STORAGE_ARCHIVE_CHANGED')
                    for row in rows:
                        row.pop('storageArchive', None)
                        row.pop('storageManifest', None)
                        row.pop('storageRestorePending', None)
                        row.pop('storageReclaimed', None)
                    runtime.state.save()
                    self.leases.pop(account['id'], None)
                elif method == 'storage/reclaimed':
                    require(not lease['restore'] and lease['marked'])
                    for row in rows:
                        row.pop('storageRestorePending', None)
                        row['storageReclaimed'] = True
                    runtime.state.save()
                elif method == 'storage/release':
                    self.leases.pop(account['id'], None)
                else:
                    require(method == 'storage/renew')
            public = [{k:r[k] for k in ('sessionId', 'threadId', 'childThreadIds', 'storageArchive') if k in r} for r in all_rows]
            return dict(accountId=account['id'], accountGeneration=account['generation'], archiveId=token,
                        sessions=lease['sessions'], receipts=public, marked=lease['marked'])


def root_for(request):
    import setup
    config = setup.public_json(setup.CONFIG)
    ident = request.get('accountId')
    require(isinstance(ident, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', ident))
    root = Path(config['root']) / 'profiles' / ident
    from broker import trusted_path
    trusted_path(str(root), owners={0, config['ownerUid']}, final_uid=config['ownerUid'], kind='directory', private=True)
    return root, config['ownerUid']


def relative(value, provider):
    require(isinstance(value, str) and not value.startswith('/') and len(value) < 4096 and '\\' not in value and not any(ord(c) < 32 for c in value))
    parts = value.split('/')
    require(len(parts) >= 2 and parts[0] in CATEGORIES[provider] and all(v and v not in ('.', '..') for v in parts))
    return parts


def regular(root, entry, owner, provider, missing=False):
    parts = relative(entry['path'], provider)
    target = root
    for part in parts[:-1]:
        target /= part
        if missing and not target.exists():
            target.mkdir(mode=0o700); os.chown(target, owner, -1)
        info = target.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == owner and not info.st_mode & 0o022, 'STORAGE_UNSAFE_FILE')
    target /= parts[-1]
    if target.exists() or target.is_symlink():
        info = target.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == owner and info.st_nlink == 1, 'STORAGE_UNSAFE_FILE')
    return target


@contextmanager
def parent_handle(root, entry, owner, provider, create=False):
    """Keep every path component pinned; refuse links during concurrent changes."""
    parts = relative(entry['path'], provider)
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            except FileNotFoundError:
                require(create, 'STORAGE_CHANGED')
                os.mkdir(part, 0o700, dir_fd=descriptor)
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                os.fchown(child, owner, -1)
            info = os.fstat(child)
            if info.st_uid != owner or info.st_mode & 0o022:
                os.close(child)
                raise RuntimeError('STORAGE_UNSAFE_FILE')
            os.close(descriptor)
            descriptor = child
        yield descriptor, parts[-1]
    finally:
        os.close(descriptor)


def file_info(parent, name, owner):
    try:
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return None
    require(stat.S_ISREG(info.st_mode) and info.st_uid == owner and info.st_nlink == 1, 'STORAGE_UNSAFE_FILE')
    return info


def digest(target, prefix=None, parent=None, owner=None):
    sha = hashlib.sha256()
    with os.fdopen(os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent), 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and (owner is None or before.st_uid == owner), 'STORAGE_UNSAFE_FILE')
        remaining = before.st_size if prefix is None else prefix
        require(before.st_size >= remaining, 'STORAGE_CHANGED')
        while remaining:
            chunk = stream.read(min(CHUNK, remaining))
            require(chunk, 'STORAGE_CHANGED'); remaining -= len(chunk); sha.update(chunk)
        after = os.fstat(stream.fileno())
        if prefix is None:
            require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'STORAGE_CHANGED')
    return sha.hexdigest(), before


def manifest(root, owner, provider, receipts, sessions):
    from session_manifest import select_paths
    result, total = [], 0
    for entry in select_paths(root, owner, provider, receipts, sessions):
        with parent_handle(root, entry, owner, provider) as (parent, name):
            sha, info = digest(name, parent=parent, owner=owner)
        result.append(dict(entry, sha256=sha, size=info.st_size, mode=stat.S_IMODE(info.st_mode), mtime=info.st_mtime))
        total += info.st_size
        require(len(result) <= 10000 and total <= 8*1024**3, 'STORAGE_ARCHIVE_TOO_LARGE')
    return result


def dispatch(request):
    from resources import broker_call
    import cli_policies
    try:
        require(os.geteuid() == 0, 'ADMIN_REQUIRED')
        method, provider = request.get('method'), request.get('provider')
        require(provider in CATEGORIES)
        binding = {k:request[k] for k in ('provider', 'accountId', 'accountGeneration', 'archiveId', 'sessions') if k in request}
        preferences = cli_policies.read(provider)
        binding['idleSeconds'] = preferences.get('idleHours', 24)*3600
        def verify_interval(seconds):
            # A new desktop can execute this helper against an older daemon.
            # Never let that daemon silently apply its old fixed 24-hour rule.
            if seconds == 86400:
                return
            try:
                capability = broker_call('storage/sessions', dict(provider=provider, idleSeconds=seconds, limit=1))
            except RuntimeError:
                raise RuntimeError('STORAGE_POLICY_UNSUPPORTED') from None
            require(capability.get('available') and capability.get('retentionVersion') == 2 and capability.get('idleSeconds') == seconds, 'STORAGE_POLICY_UNSUPPORTED')
        if preferences['reclaimIdle'] and (method in ('retention/candidates', 'retention/commit') or method == 'retention/begin' and not request.get('restore')):
            verify_interval(binding['idleSeconds'])
        if method == 'retention/inspect':
            try:
                value = broker_call('storage/sessions', dict(binding, after=request.get('after', ''), limit=request.get('limit', 50)))
            except RuntimeError as error:
                if str(error) == 'STORAGE_ACCOUNT_CHANGED':
                    raise RuntimeError('STORAGE_UNAVAILABLE') from None
                raise
            value.update(policy=preferences, observedAt=value.get('observedAt', time.time()))
        elif method == 'retention/candidates':
            if cli_policies.read(provider)['reclaimIdle']:
                value = broker_call('storage/candidates', binding)
            else:
                value = dict(candidates=[])
        elif method == 'retention/begin':
            if not request.get('restore'):
                require(cli_policies.read(provider)['reclaimIdle'], 'STORAGE_DISABLED')
            value = broker_call('storage/begin', dict(binding, restore=request.get('restore') is True, **({'manifestHash':manifest_hash(request['files'])} if request.get('files') is not None else {})))
            require(value.get('available'), 'STORAGE_UNAVAILABLE')
            if request.get('restore'):
                root, owner = root_for(request)
                from resources import disk_headroom
                additional = 0
                for entry in request.get('files', []):
                    with parent_handle(root, entry, owner, provider, True) as (parent, name):
                        if file_info(parent, name, owner) is None:
                            additional += entry['size']
                require(disk_headroom(str(root), additional), 'STORAGE_DISK_PRESSURE')
            if not request.get('restore'):
                root, owner = root_for(request)
                value['files'] = request['files'] if value['marked'] and request.get('resume') is True else manifest(root, owner, provider, value['receipts'], value['sessions'])
        elif method == 'retention/release':
            value = broker_call('storage/release', binding)
        else:
            lease = broker_call('storage/renew', binding)
            require(lease.get('available'), 'STORAGE_UNAVAILABLE')
            root, owner = root_for(request)
            if method == 'retention/read':
                entry = request['entry']
                with parent_handle(root, entry, owner, provider) as (parent, name):
                    with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent), 'rb') as stream:
                        info = os.fstat(stream.fileno())
                        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == owner, 'STORAGE_UNSAFE_FILE')
                        require(info.st_size >= entry['size'] and (not entry['delete'] or info.st_size == entry['size'] and info.st_mtime == entry['mtime']), 'STORAGE_CHANGED')
                        offset = request['offset']; require(type(offset) is int and 0 <= offset <= entry['size'])
                        stream.seek(offset); data = stream.read(min(CHUNK, entry['size']-offset))
                value = dict(offset=offset, data=base64.b64encode(data).decode())
            elif method == 'retention/commit':
                require(cli_policies.read(provider)['reclaimIdle'], 'STORAGE_DISABLED')
                from session_manifest import select_paths
                expected = request['files']
                if not lease.get('marked'):
                    require(select_paths(root, owner, provider, lease['receipts'], lease['sessions']) == [dict(path=e['path'], delete=e['delete']) for e in expected], 'STORAGE_CHANGED')
                for entry in expected:
                    with parent_handle(root, entry, owner, provider) as (parent, name):
                        if lease.get('marked') and entry['delete'] and file_info(parent, name, owner) is None:
                            continue
                        require(digest(name, None if entry['delete'] else entry['size'], parent, owner)[0] == entry['sha256'], 'STORAGE_CHANGED')
                # Durable local receipt precedes this request. Block native resume
                # before any deletion, including an interrupted partial deletion.
                latest = cli_policies.read(provider)
                require(latest['reclaimIdle'], 'STORAGE_DISABLED')
                verify_interval(latest.get('idleHours', 24)*3600)
                broker_call('storage/mark', dict(binding, idleSeconds=latest.get('idleHours', 24)*3600, manifestHash=manifest_hash(expected)))
                for entry in request['files']:
                    with parent_handle(root, entry, owner, provider) as (parent, name):
                        if lease.get('marked') and entry['delete'] and file_info(parent, name, owner) is None:
                            continue
                        sha, info = digest(name, None if entry['delete'] else entry['size'], parent, owner)
                        require(sha == entry['sha256'], 'STORAGE_CHANGED')
                        if entry['delete']:
                            current = file_info(parent, name, owner)
                            require(current is not None and (current.st_ino, current.st_dev, current.st_size, current.st_mtime_ns, current.st_ctime_ns) == (info.st_ino, info.st_dev, info.st_size, info.st_mtime_ns, info.st_ctime_ns), 'STORAGE_CHANGED')
                            os.unlink(name, dir_fd=parent)
                            os.fsync(parent)
                # Prune only this archive's unpublished restore chunks, after
                # the desktop reverified its complete immutable local archive.
                for entry in request['files']:
                    with parent_handle(root, entry, owner, provider) as (parent, name):
                        partial = name+'.awb-'+binding['archiveId']
                        if file_info(parent, partial, owner) is not None:
                            os.unlink(partial, dir_fd=parent)
                            os.fsync(parent)
                broker_call('storage/reclaimed', binding)
                value = dict(reclaimedBytes=sum(e['size'] for e in request['files'] if e['delete']))
            elif method == 'retention/write':
                entry = request['entry']
                require(type(entry.get('size')) is int and 0 <= entry['size'] <= 8*1024**3 and re.fullmatch(r'[a-f0-9]{64}', str(entry.get('sha256'))))
                with parent_handle(root, entry, owner, provider, True) as (parent, name):
                    if file_info(parent, name, owner) is not None:
                        require(digest(name, None if entry['delete'] else entry['size'], parent, owner)[0] == entry['sha256'], 'STORAGE_RESTORE_CONFLICT')
                        value = dict(complete=True)
                    else:
                        from resources import disk_headroom
                        require(disk_headroom(str(root), CHUNK), 'STORAGE_DISK_PRESSURE')
                        partial = name+'.awb-'+binding['archiveId']
                        data = base64.b64decode(request['data'], validate=True); offset = request['offset']
                        require(len(data) <= CHUNK and type(offset) is int and 0 <= offset and offset+len(data) <= entry['size'])
                        descriptor = os.open(partial, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=parent)
                        with os.fdopen(descriptor, 'r+b') as stream:
                            info = os.fstat(stream.fileno())
                            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid in (0, owner), 'STORAGE_UNSAFE_FILE')
                            require(info.st_size >= offset, 'STORAGE_OFFSET')
                            if info.st_size > offset:
                                stream.seek(offset); require(stream.read(len(data)) == data, 'STORAGE_RESTORE_CONFLICT')
                            else:
                                stream.seek(offset); stream.write(data); stream.flush(); os.fsync(stream.fileno())
                            os.fchown(stream.fileno(), owner, -1)
                            os.fchmod(stream.fileno(), entry.get('mode', 0o600) & 0o777)
                        complete = offset+len(data) == entry['size']
                        if complete:
                            require(digest(partial, parent=parent, owner=owner)[0] == entry['sha256'], 'STORAGE_RESTORE_CONFLICT')
                            # Publication refuses an existing native/user file.
                            os.link(partial, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
                            os.unlink(partial, dir_fd=parent)
                            os.fsync(parent)
                        value = dict(complete=complete)
            elif method == 'retention/restored':
                for entry in request['files']:
                    with parent_handle(root, entry, owner, provider) as (parent, name):
                        require(digest(name, None if entry['delete'] else entry['size'], parent, owner)[0] == entry['sha256'], 'STORAGE_RESTORE_CONFLICT')
                value = broker_call('storage/restored', dict(binding, manifestHash=manifest_hash(request['files'])))
            else:
                raise RuntimeError('STORAGE_INVALID')
        return dict(ok=True, value=value)
    except Exception as error:
        return dict(ok=False, error=str(error) if isinstance(error, RuntimeError) else 'STORAGE_OPERATION_UNCONFIRMED')
