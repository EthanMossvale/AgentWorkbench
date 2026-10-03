"""Native account-owner execution. No credential export or member login copies.

One native process per explicit session, shared binaries and native account home.
No workbench limit is imposed on native child agents or their model selection.
"""
import copy
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import select
import signal
import stat
import subprocess
import threading
import time
import uuid

MAX_FRAME = 8 * 1024 * 1024
VERSIONS = {'codex': '0.155.1', 'claude': '2.1.281'}


class RuntimeErrorCode(Exception):
    pass


class GeneratedImageReceipts:
    """Connection-scoped receipts; no bytes or paths supplied by the client are trusted.

    Native history remains native-owned. Only the exact completed PNG is retired
    after a durable local receipt. Disconnects leave unacknowledged files intact.
    """
    def __init__(self, profile, owner_uid):
        self.profile, self.owner_uid = Path(profile), owner_uid
        self.records = {}

    def observe(self, message):
        params = message.get('params', {})
        item = params.get('item', {}) if isinstance(params, dict) else {}
        if message.get('method') != 'item/completed' or not isinstance(item, dict) or item.get('type') != 'imageGeneration' or item.get('status') != 'completed':
            return
        ids = (params.get('threadId'), params.get('turnId'), item.get('id'))
        if any(not isinstance(v, str) or not v or len(v) > 512 for v in ids) or len(self.records) >= 256 and ids not in self.records:
            return
        encoded = item.get('result')
        if not isinstance(encoded, str) or not encoded or len(encoded) > ((20 * 1024 * 1024 + 2) // 3) * 4:
            return
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            return
        if len(data) > 20 * 1024 * 1024 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
            return
        # This spelling is the pinned official image extension's artifact rule.
        safe = lambda v: re.sub(r'[^A-Za-z0-9_-]', '_', v) or 'generated_image'
        relative = ('generated_images', safe(ids[0]), safe(ids[2]) + '.png')
        saved = item.get('savedPath')
        if saved is not None and saved != str(self.profile.joinpath(*relative)):
            return
        observed = {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data), 'relative': relative if saved else None, 'removed': False}
        previous = self.records.get(ids)
        if previous and any(previous[k] != observed[k] for k in ('sha256', 'size', 'relative')):
            return
        self.records.setdefault(ids, observed)

    def acknowledge(self, params):
        if not isinstance(params, dict) or set(params) != {'threadId', 'turnId', 'itemId', 'sha256', 'size'} or any(not isinstance(params[k], str) for k in ('threadId', 'turnId', 'itemId', 'sha256')) or type(params['size']) is not int:
            raise RuntimeErrorCode('IMAGE_RECEIPT_INVALID')
        record = self.records.get((params['threadId'], params['turnId'], params['itemId']))
        if not record or params['sha256'] != record['sha256'] or params['size'] != record['size']:
            raise RuntimeErrorCode('IMAGE_RECEIPT_NOT_OWNED')
        if record['removed']:
            return {'removed': True}
        if record['relative'] is not None:
            self._remove(record)
        record['removed'] = True
        return {'removed': True}

    def _remove(self, record):
        # Linux owner service only. Use directory descriptors throughout so a
        # symlink swap cannot redirect reads/deletion into a different profile.
        descriptors = []
        try:
            if not hasattr(os, 'O_NOFOLLOW') or not hasattr(os, 'O_DIRECTORY'):
                raise OSError('descriptor-relative cleanup unavailable')
            flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            descriptors.append(os.open(self.profile, flags))
            for name in record['relative'][:-1]:
                descriptors.append(os.open(name, flags, dir_fd=descriptors[-1]))
            name = record['relative'][-1]
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptors[-1])
            try:
                info = os.fstat(descriptor)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != self.owner_uid or info.st_size != record['size']:
                    raise OSError('image identity changed')
                digest = hashlib.sha256()
                remaining = record['size']
                while remaining:
                    data = os.read(descriptor, min(65536, remaining))
                    if not data:
                        raise OSError('image truncated')
                    remaining -= len(data)
                    digest.update(data)
                if digest.hexdigest() != record['sha256'] or os.read(descriptor, 1):
                    raise OSError('image content changed')
                after = os.stat(name, dir_fd=descriptors[-1], follow_symlinks=False)
                if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink) != (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, 1):
                    raise OSError('image identity changed')
                os.unlink(name, dir_fd=descriptors[-1])
            finally:
                os.close(descriptor)
        except OSError:
            raise RuntimeErrorCode('IMAGE_CLEANUP_UNCONFIRMED') from None
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)


class NativePipe:
    """One reader with chunked buffering and explicit operation deadlines."""
    def __init__(self, process, stopped=None):
        self.process, self.buffer = process, bytearray()
        self.stopped = stopped
        self.write_lock = threading.Lock()

    def send(self, value):
        data = (json.dumps(value, separators=(',', ':')) + '\n').encode()
        with self.write_lock:
            descriptor = self.process.stdin.fileno()
            os.set_blocking(descriptor, False)
            deadline, offset = time.monotonic()+10, 0
            while offset < len(data):
                if time.monotonic() >= deadline or self.stopped and self.stopped.is_set():
                    raise TimeoutError('NATIVE_WRITE_TIMEOUT')
                if select.select([], [descriptor], [], .2)[1]:
                    try:
                        offset += os.write(descriptor, data[offset:offset+65536])
                    except BlockingIOError:
                        pass

    def receive(self, timeout=20, stopped=None):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if (stopped and stopped.is_set()) or (self.stopped and self.stopped.is_set()):
                raise EOFError()
            if b'\n' in self.buffer:
                raw, _, remaining = self.buffer.partition(b'\n')
                self.buffer = bytearray(remaining)
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise RuntimeErrorCode('INVALID_NATIVE_FRAME')
                return value
            if select.select([self.process.stdout], [], [], min(.2, max(0, deadline - time.monotonic())))[0]:
                chunk = os.read(self.process.stdout.fileno(), 65536)
                if not chunk:
                    raise EOFError()
                self.buffer.extend(chunk)
        raise TimeoutError()

    def call(self, method, params):
        request_id = 'owner-' + uuid.uuid4().hex
        self.send({'id': request_id, 'method': method, 'params': params})
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            value = self.receive(max(.01, deadline - time.monotonic()))
            if value.get('id') == request_id:
                if 'result' not in value:
                    raise RuntimeErrorCode('NATIVE_STATUS_UNAVAILABLE')
                return value['result']
            if value.get('id') is not None and value.get('method'):
                raise RuntimeErrorCode('NATIVE_AUTH_REVIEW_REQUIRED')
        raise RuntimeErrorCode('NATIVE_STATUS_UNAVAILABLE')

    def initialize(self):
        result = self.call('initialize', {'clientInfo': {'name': 'agent_workbench_owner', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
        self.send({'method': 'initialized', 'params': {}})
        return result


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', value):
        raise RuntimeErrorCode('INVALID_REQUEST')
    return value


def atomic(path, value):
    temporary = path.with_name('.runtime-' + uuid.uuid4().hex)
    try:
        with open(os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as stream:
            json.dump(value, stream, separators=(',', ':'), ensure_ascii=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def validate_fork(value):
    if not isinstance(value, dict) or set(value) not in ({'sourceSessionId', 'threadId', 'lastTurnId'}, {'sourceSessionId', 'threadId', 'beforeTurnId'}):
        raise RuntimeErrorCode('INVALID_FORK_BINDING')
    if not isinstance(value['sourceSessionId'], str) or not re.fullmatch(r'[a-f0-9-]{36}', value['sourceSessionId']):
        raise RuntimeErrorCode('INVALID_FORK_BINDING')
    if any(not isinstance(v, str) or not v or len(v) > 128 or re.search(r'[\x00-\x20\x7f]', v) for v in value.values()):
        raise RuntimeErrorCode('INVALID_FORK_BINDING')
    return value


class AccountRuntimeState:
    """Persist only public account blocks and opaque session ownership receipts."""
    def __init__(self, root, now=time.time):
        self.path = Path(root) / 'runtime-state.json'
        self.now = now
        self.lock = threading.RLock()
        self.state = {'blocks': {}, 'sessions': {}}
        if self.path.exists() or self.path.is_symlink():
            try:
                if self.path.is_symlink():
                    raise ValueError()
                descriptor = os.open(self.path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
                with os.fdopen(descriptor, 'r', encoding='utf-8') as stream:
                    info = os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FRAME:
                        raise ValueError()
                    if hasattr(os, 'geteuid') and (info.st_uid != os.geteuid() or info.st_mode & 0o077):
                        raise ValueError()
                    def unique(pairs):
                        result = {}
                        for key, value in pairs:
                            if key in result:
                                raise ValueError()
                            result[key] = value
                        return result
                    raw = stream.read(MAX_FRAME + 1)
                    if len(raw) > MAX_FRAME:
                        raise ValueError()
                    self.state = json.loads(raw, object_pairs_hook=unique)
                self.validate()
            except (OSError, ValueError, TypeError, AttributeError):
                raise RuntimeErrorCode('RUNTIME_STATE_INVALID') from None
            # A service restart cannot silently reopen an unfinished model turn.
            for receipt in self.state['sessions'].values():
                from session_idle import initialize_activity
                initialize_activity(receipt, self.now())
                if receipt.get('active'):
                    receipt.update(active=False, uncertain=True)
                # thread/start creates a container, never a model turn. If its
                # receipt was lost, allow a new empty container without replay.
                if receipt.get('rootPending'):
                    if receipt.get('fork') and not receipt.get('threadId'):
                        receipt['forkUncertain'] = True
                    receipt['rootPending'] = False
            self.save()

    def validate(self):
        if not isinstance(self.state, dict) or set(self.state) != {'blocks', 'sessions'} or not all(isinstance(v, dict) for v in self.state.values()):
            raise ValueError()
        for block in self.state['blocks'].values():
            if not isinstance(block, dict) or block.get('reason') not in ('rate_limited', 'authentication_required', 'billing_review'):
                raise ValueError()
            for key in ('observedAt', 'resetsAt'):
                if key == 'observedAt' or key in block:
                    if type(block.get(key)) not in (int, float) or not math.isfinite(block[key]) or block[key] < 0:
                        raise ValueError()
        for receipt in self.state['sessions'].values():
            if not isinstance(receipt, dict):
                raise ValueError()
            for key in ('active', 'uncertain', 'rootPending', 'forkUncertain', 'forkAwaitingInput'):
                if key in receipt and type(receipt[key]) is not bool:
                    raise ValueError()
            for key in ('threadId', 'turnId', 'accountId', 'accountGeneration', 'sessionId', 'environmentId', 'cwd'):
                if key in receipt and (not isinstance(receipt[key], str) or not receipt[key] or len(receipt[key]) > 2048):
                    raise ValueError()
            if 'uid' in receipt and (type(receipt['uid']) is not int or receipt['uid'] < 0):
                raise ValueError()
            if 'fork' in receipt:
                validate_fork(receipt['fork'])
            if 'childThreadIds' in receipt and (not isinstance(receipt['childThreadIds'], list) or any(not isinstance(v, str) or not 0 < len(v) <= 128 for v in receipt['childThreadIds'])):
                raise ValueError()
            if 'nativeStarted' in receipt and type(receipt['nativeStarted']) is not bool:
                raise ValueError()
            if 'inputIds' in receipt and (not isinstance(receipt['inputIds'], list) or len(receipt['inputIds']) > 8192 or any(not isinstance(v, str) or not re.fullmatch(r'[a-f0-9-]{36}', v) for v in receipt['inputIds'])):
                raise ValueError()

    def save(self):
        atomic(self.path, self.state)

    @staticmethod
    def account_key(account):
        return account['provider'] + ':' + account['id'] + ':' + account['generation']

    def verify_fork_source(self, account, workspace, binding, require_settled=True):
        fork = validate_fork(binding['fork'])
        if fork['sourceSessionId'] == binding['sessionId']:
            raise RuntimeErrorCode('FORK_SOURCE_NOT_OWNED')
        key = hashlib.sha256((self.account_key(account) + ':' + workspace + ':' + fork['sourceSessionId']).encode()).hexdigest()
        source = self.state['sessions'].get(key, {})
        if any(source.get(k) != binding[k] for k in ('uid', 'accountId', 'accountGeneration', 'environmentId', 'cwd')) or source.get('threadId') != fork['threadId']:
            raise RuntimeErrorCode('FORK_SOURCE_NOT_OWNED')
        if require_settled and (source.get('active') or source.get('uncertain') or source.get('rootPending')):
            raise RuntimeErrorCode('FORK_SOURCE_NOT_SETTLED')

    def check(self, account):
        with self.lock:
            value = self.state['blocks'].get(self.account_key(account))
            # Even an elapsed reset needs a fresh native read before admission.
            if value:
                raise RuntimeErrorCode('ACCOUNT_' + value['reason'].upper())

    def block(self, account, reason, reset_at=None):
        if reason not in ('rate_limited', 'authentication_required', 'billing_review'):
            return
        with self.lock:
            value = {'reason': reason, 'observedAt': self.now()}
            if type(reset_at) in (int, float) and self.now() < reset_at < self.now() + 32 * 86400:
                value['resetsAt'] = reset_at
            self.state['blocks'][self.account_key(account)] = value
            self.save()

    def clear_after_review(self, account, authenticated, quota_available):
        with self.lock:
            value = self.state['blocks'].get(self.account_key(account))
            if not authenticated or value and (value['reason'] == 'rate_limited' and not quota_available or value['reason'] == 'billing_review'):
                raise RuntimeErrorCode('ACCOUNT_REVIEW_REQUIRED')
            self.state['blocks'].pop(self.account_key(account), None)
            self.save()


class CodexSessionFence:
    """A connection owns one root thread; native children stay native-owned."""
    def __init__(self, binding, receipt, persist, admit, authorize=None):
        self.binding, self.receipt, self.persist, self.admit = binding, receipt, persist, admit
        self.authorize = authorize or admit
        self.pending = {}
        self.approvals = set()
        self.children = set(receipt.get('childThreadIds', []))
        self.child_active = set(receipt.get('activeChildren', []))
        self.initialized = False
        self.lock = threading.RLock()

    def before(self, message):
        if not isinstance(message, dict):
            raise RuntimeErrorCode('INVALID_FRAME')
        method, params = message.get('method'), message.get('params', {})
        request_id = message.get('id')
        if method is None:
            if request_id not in self.approvals or set(message) - {'id', 'result', 'error'}:
                raise RuntimeErrorCode('APPROVAL_NOT_OWNED')
            self.approvals.remove(request_id)
            return message
        if not isinstance(params, dict) or type(request_id) not in (str, int, type(None)):
            raise RuntimeErrorCode('INVALID_FRAME')
        if request_id in self.pending:
            raise RuntimeErrorCode('DUPLICATE_REQUEST')
        if method == 'initialized':
            if not self.initialized:
                raise RuntimeErrorCode('INITIALIZE_REQUIRED')
            return None
        if request_id is None:
            raise RuntimeErrorCode('REQUEST_ID_REQUIRED')
        if method == 'initialize':
            if self.initialized:
                raise RuntimeErrorCode('ALREADY_INITIALIZED')
            self.initialized = True
            self.pending[request_id] = method
            return message
        if not self.initialized:
            raise RuntimeErrorCode('INITIALIZE_REQUIRED')
        if method == 'config/read':
            message = dict(message, params={'includeLayers': False})
        elif method in ('account/read', 'model/list'):
            if method == 'account/read':
                message = dict(message, params={'refreshToken': False})
        elif method.startswith('environment/'):
            if method not in ('environment/add', 'environment/info', 'environment/status') or params.get('environmentId') != self.binding['environmentId']:
                raise RuntimeErrorCode('ENVIRONMENT_MISMATCH')
            if method == 'environment/add' and params != {'environmentId': self.binding['environmentId'], 'execServerUrl': self.binding['execServerUrl']}:
                raise RuntimeErrorCode('ENVIRONMENT_MISMATCH')
        elif method == 'thread/fork':
            self.authorize()
            fork = self.receipt.get('fork')
            if not fork:
                raise RuntimeErrorCode('FORK_NOT_BOUND')
            if self.receipt.get('threadId') or self.receipt.get('rootPending'):
                raise RuntimeErrorCode('THREAD_ALREADY_BOUND')
            if self.receipt.get('forkUncertain'):
                raise RuntimeErrorCode('FORK_RESULT_UNCERTAIN')
            expected = {k: v for k, v in fork.items() if k != 'sourceSessionId'}
            if any(params.get(k) != v for k, v in expected.items()) or set(params) - (set(expected) | {'approvalPolicy', 'sandbox', 'developerInstructions', 'excludeTurns', 'deferGoalContinuation'}) or params.get('deferGoalContinuation') is not True or params.get('excludeTurns') is not True:
                raise RuntimeErrorCode('FORK_BOUNDARY_MISMATCH')
            self.receipt['rootPending'] = True
            self.receipt['forkAwaitingInput'] = True
            self.persist()
        elif method in ('thread/start', 'thread/resume', 'turn/start'):
            (self.admit if method == 'turn/start' else self.authorize)()
            if params.get('environments') != [{'environmentId': self.binding['environmentId'], 'cwd': self.binding['cwd']}]:
                raise RuntimeErrorCode('ENVIRONMENT_MISMATCH')
            if any(key in params for key in ('config', 'modelProvider', 'experimentalRawEvents', 'path', 'history', 'cwd', 'runtimeWorkspaceRoots', 'permissions')):
                raise RuntimeErrorCode('MANAGED_CONFIGURATION')
            if method == 'thread/start':
                if self.receipt.get('fork'):
                    raise RuntimeErrorCode('FORK_REQUIRED')
                if self.receipt.get('threadId') or self.receipt.get('rootPending') or any(v == 'thread/start' for v in self.pending.values()):
                    raise RuntimeErrorCode('THREAD_ALREADY_BOUND')
                self.receipt['rootPending'] = True
                self.persist()
            elif params.get('threadId') != self.receipt.get('threadId') or not self.receipt.get('threadId'):
                raise RuntimeErrorCode('THREAD_NOT_OWNED')
            if method == 'thread/resume' and self.receipt.get('rolloutPath'):
                # Only a root-committed migration may supply this pinned-version
                # path. Clients cannot inject paths or reconstructed history.
                message = dict(message, params=dict(params, path=self.receipt['rolloutPath']))
            if method == 'turn/start':
                if self.receipt.get('active') or self.receipt.get('uncertain'):
                    raise RuntimeErrorCode('TURN_ACTIVE_OR_UNCERTAIN')
                self.receipt['active'] = True
                self.receipt.pop('interrupted', None)
                self.receipt.pop('closeReason', None)
                self.receipt['cleanupConfirmed'] = False
                self.receipt.pop('forkAwaitingInput', None)
                self.receipt.pop('turnId', None)
                self.persist()
        elif method in ('thread/settings/update', 'turn/steer'):
            self.authorize()
            if params.get('threadId') != self.receipt.get('threadId') or not self.receipt.get('threadId'):
                raise RuntimeErrorCode('THREAD_NOT_OWNED')
            if self.receipt.get('uncertain'):
                raise RuntimeErrorCode('TURN_ACTIVE_OR_UNCERTAIN')
            if method == 'turn/steer':
                if not self.receipt.get('active') or params.get('expectedTurnId') != self.receipt.get('turnId'):
                    raise RuntimeErrorCode('TURN_NOT_OWNED')
                if set(params) - {'threadId', 'expectedTurnId', 'clientUserMessageId', 'input'}:
                    raise RuntimeErrorCode('MANAGED_CONFIGURATION')
            elif set(params) - {'threadId', 'approvalPolicy', 'sandboxPolicy'}:
                raise RuntimeErrorCode('MANAGED_CONFIGURATION')
        elif method in ('thread/read', 'thread/turns/list', 'thread/items/list', 'thread/unsubscribe', 'turn/interrupt'):
            if params.get('threadId') != self.receipt.get('threadId') or not self.receipt.get('threadId'):
                raise RuntimeErrorCode('THREAD_NOT_OWNED')
            if method == 'turn/interrupt' and params.get('turnId') != self.receipt.get('turnId'):
                raise RuntimeErrorCode('TURN_NOT_OWNED')
        else:
            raise RuntimeErrorCode('UNSUPPORTED_RUNTIME_REQUEST')
        if request_id is not None:
            if request_id in self.pending:
                raise RuntimeErrorCode('DUPLICATE_REQUEST')
            self.pending[request_id] = method
        return message

    def after(self, message):
        method, params = message.get('method'), message.get('params', {})
        request_id = message.get('id')
        if method:
            if method.startswith(('account/login', 'account/chatgptAuthTokens')):
                raise RuntimeErrorCode('NATIVE_AUTH_REVIEW_REQUIRED')
            if method == 'thread/started':
                thread = params.get('thread', {})
                ident, parent = thread.get('id'), thread.get('parentThreadId')
                if isinstance(ident, str) and parent in ({self.receipt.get('threadId')} | self.children) and parent is not None:
                    self.children.add(ident)
                    self.child_active.add(ident)
                    self.receipt['activeChildren'] = sorted(self.child_active)
                elif isinstance(ident, str) and self.receipt.get('rootPending') and parent is None:
                    fork = self.receipt.get('fork')
                    if fork and (ident == fork['threadId'] or thread.get('forkedFromId') != fork['threadId']):
                        raise RuntimeErrorCode('FORK_IDENTITY_MISMATCH')
                    self.receipt['threadId'] = ident
                    self.persist()
                elif ident != self.receipt.get('threadId') and ident not in self.children:
                    raise RuntimeErrorCode('NATIVE_THREAD_NOT_OWNED')
            root = self.receipt.get('threadId')
            item = params.get('item', {})
            if isinstance(item, dict) and (params.get('threadId') or item.get('senderThreadId')) in ({root} | self.children):
                if item.get('type') == 'collabAgentToolCall' and item.get('tool') == 'spawnAgent':
                    self.children.update(v for v in item.get('receiverThreadIds', []) if isinstance(v, str))
                    states = item.get('agentsStates', {})
                    if isinstance(states, dict):
                        self.children.update(v for v in states if isinstance(v, str))
                        for child, state in states.items():
                            if isinstance(state, dict) and state.get('status') in ('completed', 'errored', 'shutdown', 'notFound'):
                                self.child_active.discard(child)
                            else:
                                self.child_active.add(child)
                elif item.get('type') == 'subAgentActivity' and item.get('kind') == 'started' and isinstance(item.get('agentThreadId'), str):
                    self.children.add(item['agentThreadId'])
                    self.child_active.add(item['agentThreadId'])
                if item.get('type') == 'subAgentActivity' and item.get('kind') in ('completed', 'closed', 'errored'):
                    self.child_active.discard(item.get('agentThreadId'))
                self.receipt['activeChildren'] = sorted(self.child_active)
            if params.get('threadId') and params['threadId'] not in ({root} | self.children):
                raise RuntimeErrorCode('NATIVE_THREAD_NOT_OWNED')
            if request_id is not None:
                if method not in ('item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/call', 'item/tool/requestUserInput'):
                    raise RuntimeErrorCode('UNSUPPORTED_NATIVE_REQUEST')
                self.approvals.add(request_id)
            # Only the owned root completion settles this connection's turn.
            if method == 'turn/started' and params.get('threadId') == self.receipt.get('threadId'):
                if self.receipt.get('forkAwaitingInput'):
                    raise RuntimeErrorCode('UNREQUESTED_FORK_TURN')
                self.receipt['turnId'] = params.get('turn', {}).get('id')
                self.persist()
            if method in ('turn/started', 'turn/completed') and params.get('threadId') in self.children:
                if method == 'turn/started':
                    self.child_active.add(params['threadId'])
                else:
                    self.child_active.discard(params['threadId'])
                self.receipt['activeChildren'] = sorted(self.child_active)
                self.persist()
            if method == 'turn/completed' and params.get('threadId') == self.receipt.get('threadId'):
                self.receipt.update(active=False, uncertain=False, turnId=params.get('turn', {}).get('id'))
                self.persist()
            if method == 'serverRequest/resolved':
                self.approvals.discard(params.get('requestId'))
            if self.children != set(self.receipt.get('childThreadIds', [])):
                self.receipt['childThreadIds'] = sorted(self.children)
                self.persist()
            return message
        issued = self.pending.pop(request_id, None)
        if not issued:
            raise RuntimeErrorCode('UNEXPECTED_NATIVE_RESPONSE')
        result = message.get('result', {})
        if issued == 'config/read' and 'result' in message:
            config = result.get('config', {})
            return dict(message, result={'config': {key: config.get(key) for key in ('model', 'model_reasoning_effort', 'service_tier')}})
        if issued in ('thread/start', 'thread/resume', 'thread/fork') and 'result' in message:
            thread = result.get('thread', {}).get('id')
            fork = self.receipt.get('fork')
            if issued == 'thread/fork' and (thread == fork['threadId'] or result.get('thread', {}).get('forkedFromId') != fork['threadId']):
                raise RuntimeErrorCode('FORK_IDENTITY_MISMATCH')
            if not isinstance(thread, str) or self.receipt.get('threadId', thread) != thread:
                raise RuntimeErrorCode('THREAD_NOT_OWNED')
            self.receipt['threadId'] = thread
            self.receipt['rootPending'] = False
            self.receipt.pop('forkUncertain', None)
            self.persist()
        if issued in ('thread/start', 'thread/fork') and 'error' in message:
            self.receipt['rootPending'] = False
            self.persist()
        if issued == 'turn/start':
            if 'error' in message:
                self.receipt.update(active=False, uncertain=False)
            else:
                self.receipt['turnId'] = result.get('turn', {}).get('id')
            self.persist()
        if issued in ('thread/read', 'thread/turns/list') and self.receipt.get('uncertain'):
            turns = result.get('data', []) if issued == 'thread/turns/list' else result.get('thread', {}).get('turns', [])
            current = next((t for t in turns if t.get('id') == self.receipt.get('turnId')), None)
            if current and current.get('status') in ('completed', 'interrupted', 'failed'):
                self.receipt.update(uncertain=False, active=False)
                self.persist()
        return message

    def disconnected(self):
        if self.receipt.get('active'):
            self.receipt.update(active=False, uncertain=True)
            self.persist()
        elif self.receipt.get('rootPending'):
            if self.receipt.get('fork') and not self.receipt.get('threadId'):
                self.receipt['forkUncertain'] = True
            self.receipt['rootPending'] = False
            self.persist()


class NativeAccountRuntime:
    def __init__(self, broker, config, *, probe=None, process_factory=None, catalog_factory=None):
        self.broker, self.config = broker, config
        self.state = AccountRuntimeState(broker.registry.root, broker.now)
        self.process_factory = process_factory or self.launch
        self.catalog_factory = catalog_factory or (lambda account: self.launch(account, inspection=True, catalog_only=True))
        self.probe = probe or self.inspect
        self.active = {}
        self.lock = threading.RLock()
        self.closed = False
        from runtime_maintenance import RuntimeMaintenance
        self.maintenance = RuntimeMaintenance(self)
        from session_storage import StorageLeases
        self.storage = StorageLeases(self)

    def executable(self, provider):
        from broker import trusted_path
        value = self.config.get(provider + 'Executable')
        return trusted_path(value, owners={0}, final_uid=0, kind='executable', allow_symlinks=True)

    def environment(self, account):
        import pwd
        if os.geteuid() != self.broker.owner_uid or os.geteuid() == 0:
            raise RuntimeErrorCode('NATIVE_OWNER_REQUIRED')
        from broker import trusted_path
        owner = pwd.getpwuid(self.broker.owner_uid)
        profile = trusted_path(str(self.broker.registry.profiles / account['id']), owners={0, self.broker.owner_uid}, final_uid=self.broker.owner_uid, kind='directory', private=True)
        env = {'HOME': owner.pw_dir, 'USER': owner.pw_name, 'LOGNAME': owner.pw_name, 'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'NO_COLOR': '1'}
        env['CODEX_HOME' if account['provider'] == 'codex' else 'CLAUDE_CONFIG_DIR'] = profile
        if account['provider'] == 'claude':
            env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'] = '1'
            env['DISABLE_AUTOUPDATER'] = '1'
        return env, profile

    def launch(self, account, inspection=False, catalog_only=False):
        from cli_guard import lease
        with lease(account['provider'], self.executable(account['provider'])):
            return self._launch(account, inspection, catalog_only)

    def _launch(self, account, inspection=False, catalog_only=False):
        env, profile = self.environment(account)
        binary = self.executable(account['provider'])
        version = subprocess.check_output([binary, '--version'], env=env, cwd=profile, timeout=10, stderr=subprocess.DEVNULL).decode('utf-8').strip()
        if not re.search(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', version):
            raise RuntimeErrorCode('RUNTIME_VERSION_MISMATCH')
        if account['provider'] != 'codex' and not catalog_only:
            raise RuntimeErrorCode('CLAUDE_LOCAL_EXECUTOR_UNVERIFIED')
        if catalog_only:
            if account['provider'] != 'claude':
                raise RuntimeErrorCode('UNSUPPORTED')
            args = [binary, '--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--setting-sources', '', '--settings', '{"autoMemoryEnabled":false}']
        else:
            args = [binary, '-c', 'cli_auth_credentials_store="file"', '-c', 'features.deferred_executor=true', '-c', 'features.default_mode_request_user_input=true', '-c', 'features.memories=false', '-c', 'memories.generate_memories=false', '-c', 'memories.use_memories=false', '-c', 'check_for_update_on_startup=false', 'app-server', '--listen', 'stdio://']
        from native_worker import NativeCodexLogin
        from cli_guard import lease
        cli_lease = lease(account['provider'], binary)
        cli_lease.__enter__()
        try:
            process = subprocess.Popen(args, cwd=profile, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        except Exception:
            cli_lease.__exit__(None, None, None)
            raise
        process.cli_lease = cli_lease
        guard = NativeCodexLogin(profile, binary, self.broker.owner_uid, lambda value: None)
        guard.process, guard.process_identity = process, guard._read_identity(process.pid)
        process.runtime_guard = guard
        return process

    @staticmethod
    def stop(process):
        guard = getattr(process, 'runtime_guard', None)
        if guard:
            if not guard._terminate():
                raise RuntimeErrorCode('NATIVE_CLEANUP_UNCONFIRMED')
            tool_config = getattr(process, 'claude_tool_config', None)
            if tool_config:
                tool_config.unlink(missing_ok=True)
            cli_lease = getattr(process, 'cli_lease', None)
            if cli_lease:
                cli_lease.__exit__(None, None, None)
                process.cli_lease = None
            return
        # Fixture processes have the same unreaped group anchor.
        try:
            os.killpg(process.pid, signal.SIGTERM)
            time.sleep(.02)
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=3)
        tool_config = getattr(process, 'claude_tool_config', None)
        if tool_config:
            tool_config.unlink(missing_ok=True)
        for stream in (process.stdin, process.stdout):
            if stream:
                stream.close()

    @staticmethod
    def quota_available(quota):
        pools = quota.get('rateLimitsByLimitId') or {}
        pool = pools.get('codex') or quota.get('rateLimits') or {}
        windows = [w for w in (pool.get('primary'), pool.get('secondary')) if isinstance(w, dict)]
        return bool(windows) and all(type(w.get('usedPercent')) in (int, float) and 0 <= w['usedPercent'] < 100 for w in windows)

    def observe_identity(self, account, metadata):
        """Observe public native identity, never parse a credential file."""
        with self.broker.registry.lock:
            current = self.broker.registry.state['accounts'].get(account['id'])
            if not current or current['generation'] != account['generation']:
                raise RuntimeErrorCode('ACCOUNT_IDENTITY_CHANGED')
            candidate = copy.deepcopy(self.broker.registry.state)
            row = candidate['accounts'][account['id']]
            changed = bool(metadata and current.get('email') and metadata.get('email') and current['email'] != metadata['email'])
            row['status'] = 'authenticated' if metadata else 'unauthenticated'
            if metadata:
                row.update(metadata)
            if changed:
                row['generation'] = uuid.uuid4().hex
            if row != current:
                candidate['revision'] += 1
                self.broker.registry._commit(candidate)
            if changed:
                raise RuntimeErrorCode('ACCOUNT_IDENTITY_CHANGED')

    def inspect(self, account):
        from cli_guard import lease
        with lease(account['provider'], self.executable(account['provider'])):
            return self._inspect(account)

    def _inspect(self, account):
        env, profile = self.environment(account)
        binary = self.executable(account['provider'])
        version = subprocess.check_output([binary, '--version'], env=env, cwd=profile, timeout=10, stderr=subprocess.DEVNULL).decode().strip()
        matched = bool(re.search(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', version))
        if not matched:
            return {'installed': True, 'versionMatched': False, 'version': version, 'authenticated': False, 'quotaAvailable': False, 'execution': 'unavailable'}
        if account['provider'] == 'claude':
            result = subprocess.run([binary, 'auth', 'status', '--json'], cwd=profile, env=env, capture_output=True, timeout=15)
            value = json.loads(result.stdout) if len(result.stdout) <= 65536 else {}
            from native_worker import safe_text
            authenticated = value.get('loggedIn') is True
            metadata = {'status': 'authenticated'} if authenticated else None
            if metadata and safe_text(value.get('email')):
                metadata['email'] = value['email']
            self.observe_identity(account, metadata)
            return {'installed': True, 'versionMatched': matched, 'version': version, 'authenticated': authenticated, 'quotaAvailable': False, 'execution': 'local-mcp-required'}
        process = self.launch(account, inspection=True)
        try:
            from native_worker import public_account
            pipe = NativePipe(process)
            pipe.initialize()
            account_view = pipe.call('account/read', {'refreshToken': False})
            self.observe_identity(account, public_account(account_view.get('account')))
            quota = pipe.call('account/rateLimits/read', {}) if account_view.get('account') else {}
            available = self.quota_available(quota)
            return {'installed': True, 'versionMatched': matched, 'version': version, 'authenticated': bool(account_view.get('account')), 'quotaAvailable': available, 'execution': 'local-executor-required', 'nativeQuota': quota}
        finally:
            self.stop(process)

    def authorize(self, uid, account_id, generation=None, *, allow_disabled=False):
        workspace, allowed = self.broker._identity(uid)
        account = self.broker.registry.state['accounts'].get(identifier(account_id))
        if not account or uid and account.get('pendingLogin') or generation is not None and account['generation'] != generation or allowed is not None and account_id not in allowed:
            raise RuntimeErrorCode('ACCOUNT_FORBIDDEN')
        if uid and not allow_disabled:
            access = self.broker.registry.state['selections'].get(workspace, {}).get('accountAccess', {}).get(account['generation'], {})
            if account.get('enabled') is False or access.get('enabled') is False:
                raise RuntimeErrorCode('ACCOUNT_FORBIDDEN')
        if uid:
            policy = self.broker.policy_reader(self.broker.policy_file)
            row = next((w for w in policy['workspaces'] if w['uid'] == uid), {})
            if not row.get('enabled') or account_id not in row.get('allowedAccountIds', []):
                raise RuntimeErrorCode('ACCOUNT_FORBIDDEN')
            if account['provider'] not in row.get('runtimes', []):
                raise RuntimeErrorCode('RUNTIME_NOT_ENABLED')
        return workspace, account

    def status(self, uid, account_id, *, review=False):
        _, account = self.authorize(uid, account_id)
        if review and uid != 0:
            raise RuntimeErrorCode('ADMIN_REVIEW_REQUIRED')
        try:
            value = self.probe(account)
        except (OSError, ValueError, EOFError, RuntimeError, subprocess.SubprocessError):
            raise RuntimeErrorCode('NATIVE_STATUS_UNAVAILABLE') from None
        self.authorize(uid, account_id, account['generation'])
        if review:
            self.state.clear_after_review(account, value.get('authenticated'), value.get('quotaAvailable'))
        else:
            with self.state.lock:
                blocked = self.state.state['blocks'].get(self.state.account_key(account))
                if blocked and value.get('authenticated') and (blocked['reason'] == 'authentication_required' or blocked['reason'] == 'rate_limited' and value.get('quotaAvailable')):
                    self.state.clear_after_review(account, True, value.get('quotaAvailable'))
        public = {k: v for k, v in value.items() if k in ('installed', 'versionMatched', 'version', 'authenticated', 'execution')}
        with self.state.lock:
            return dict(public, accountId=account_id, provider=account['provider'], block=copy.deepcopy(self.state.state['blocks'].get(self.state.account_key(account))))

    def models(self, uid, account_id, generation, *, quota=False):
        """Native metadata only: no prompt, tool, user frame or runtime admission."""
        _, account = self.authorize(uid, account_id, generation, allow_disabled=quota)
        if account['provider'] != 'claude':
            raise RuntimeErrorCode('UNSUPPORTED')
        if account.get('status') != 'authenticated':
            raise RuntimeErrorCode('ACCOUNT_AUTHENTICATION_REQUIRED')
        stopped, done = threading.Event(), threading.Event()
        key = ('quota:' if quota else 'catalog:') + hashlib.sha256(json.dumps([uid, account_id, generation]).encode()).hexdigest()
        process = None
        cleanup_lock = threading.Lock()
        def cleanup():
            with cleanup_lock:
                if process is not None:
                    self.stop(process)
                with self.lock:
                    if self.active.get(key) is entry:
                        self.active.pop(key, None)
        def cancel():
            stopped.set()
            if done.is_set():
                # A failed cleanup keeps maintenance fenced until confirmed.
                try:
                    cleanup()
                except Exception:
                    pass
        entry = {'accountId': account_id, 'accountGeneration': generation, 'stop': cancel, 'done': done}
        with self.lock:
            _, account = self.authorize(uid, account_id, generation, allow_disabled=quota)
            if account.get('status') != 'authenticated':
                raise RuntimeErrorCode('ACCOUNT_AUTHENTICATION_REQUIRED')
            if self.closed:
                raise RuntimeErrorCode('RUNTIME_CLOSING')
            if account_id in self.broker.external_logins or key in self.active:
                raise RuntimeErrorCode('ACCOUNT_RUNTIME_BUSY')
            self.active[key] = entry
        try:
            process = self.catalog_factory(account)
            if stopped.is_set():
                raise RuntimeErrorCode('RUNTIME_CLOSING')
            pipe, request_id = NativePipe(process, stopped), uuid.uuid4().hex
            pipe.send({'type': 'control_request', 'request_id': request_id, 'request': {'subtype': 'initialize'}})
            deadline = time.monotonic() + 20
            querying_quota = False
            while time.monotonic() < deadline:
                value = pipe.receive(max(.01, deadline - time.monotonic()), stopped)
                response = value.get('response', {}) if isinstance(value, dict) else {}
                if not isinstance(value, dict) or value.get('type') != 'control_response' or not isinstance(response, dict) or response.get('request_id') != request_id:
                    continue
                data = response.get('response', {})
                if quota:
                    if response.get('subtype') != 'success':
                        message = str(response.get('error', ''))[:1024]
                        unsupported = querying_quota and re.search(r'unknown|unsupported|not supported|unrecognized', message, re.I)
                        raise RuntimeErrorCode('CLAUDE_QUOTA_QUERY_UNSUPPORTED' if unsupported else 'CLAUDE_QUOTA_QUERY_FAILED')
                    if not querying_quota:
                        querying_quota = True
                        request_id = uuid.uuid4().hex
                        pipe.send({'type': 'control_request', 'request_id': request_id, 'request': {'subtype': 'get_usage', 'skip_behaviors': True}})
                        continue
                    _, current = self.authorize(uid, account_id, generation, allow_disabled=True)
                    if current.get('status') != 'authenticated':
                        raise RuntimeErrorCode('ACCOUNT_AUTHENTICATION_REQUIRED')
                    if stopped.is_set():
                        raise RuntimeErrorCode('RUNTIME_CLOSING')
                    from usage import project_claude_usage
                    return project_claude_usage(data, self.broker.now())
                raw = data.get('models') if isinstance(data, dict) else None
                if response.get('subtype') != 'success' or not isinstance(raw, list) or not 0 < len(raw) <= 100:
                    raise RuntimeErrorCode('NATIVE_MODELS_UNAVAILABLE')
                from native_worker import safe_text
                models, seen = [], set()
                for row in raw:
                    if not isinstance(row, dict) or not row.get('value') or not safe_text(row.get('value')) or row['value'] in seen:
                        raise RuntimeErrorCode('NATIVE_MODELS_UNAVAILABLE')
                    seen.add(row['value'])
                    efforts = row.get('supportedEffortLevels', [])
                    if not isinstance(efforts, list) or len(efforts) > 32 or any(not safe_text(e) for e in efforts):
                        raise RuntimeErrorCode('NATIVE_MODELS_UNAVAILABLE')
                    name = row['displayName'] if row.get('displayName') and safe_text(row['displayName']) else row['value']
                    extended = row['value'].lower().endswith('[1m]')
                    if extended and '1m' not in name.lower():
                        name += ' (1M)'
                    model = {'id': row['value'], 'model': row['value'], 'name': name, 'isDefault': not models, 'efforts': efforts, 'serviceTiers': []}
                    if row.get('supportsFastMode') is True:
                        model['serviceTiers'] = [{'id': 'priority', 'name': 'Fast', 'description': 'Native Claude fast mode; availability and additional usage charges are controlled by the native account.'}]
                    capacity = row.get('contextWindow')
                    if isinstance(capacity, int) and not isinstance(capacity, bool) and 0 < capacity <= 100000000:
                        model['contextWindow'] = capacity
                    elif extended:
                        model['contextWindow'] = 1000000
                    if row.get('defaultEffort') in efforts:
                        model['defaultEffort'] = row['defaultEffort']
                    models.append(model)
                _, current = self.authorize(uid, account_id, generation, allow_disabled=quota)
                if current.get('status') != 'authenticated':
                    raise RuntimeErrorCode('ACCOUNT_AUTHENTICATION_REQUIRED')
                if stopped.is_set():
                    raise RuntimeErrorCode('RUNTIME_CLOSING')
                return {'accountId': account_id, 'accountGeneration': generation, 'provider': 'claude', 'models': models}
            raise RuntimeErrorCode('NATIVE_MODELS_UNAVAILABLE')
        except (OSError, ValueError, EOFError, subprocess.SubprocessError):
            raise RuntimeErrorCode('RUNTIME_CLOSING' if stopped.is_set() else 'NATIVE_MODELS_UNAVAILABLE') from None
        finally:
            try:
                cleanup()
            finally:
                done.set()

    def native_failure(self, account, message):
        # Structured native errors only. Tool output and model prose are not signals.
        method, params = message.get('method'), message.get('params', {})
        if method == 'error' and params.get('willRetry') is True:
            return
        error = params.get('turn', {}).get('error') if method == 'turn/completed' else params.get('error') if method == 'error' else message.get('error') if not method else None
        if isinstance(error, dict):
            info = error.get('codexErrorInfo')
            kind = info if isinstance(info, str) else next(iter(info), '') if isinstance(info, dict) else ''
            reason = {'usageLimitExceeded': 'rate_limited', 'unauthorized': 'authentication_required'}.get(kind)
            if reason:
                self.state.block(account, reason)

    def usage(self, uid, params):
        common = {'authorityId', 'generation', 'accountId', 'accountGeneration', 'action'}
        action = params.get('action')
        if action not in ('read', 'redeem') or not common.issubset(params) or set(params) - (common | ({'requestId', 'creditId'} if action == 'redeem' else set())):
            raise RuntimeErrorCode('INVALID_REQUEST')
        if action == 'redeem' and uid != 0:
            raise RuntimeErrorCode('ADMIN_REVIEW_REQUIRED')
        _, account = self.authorize(uid, params['accountId'], params['accountGeneration'], allow_disabled=action == 'read')
        if account['provider'] == 'claude':
            if action != 'read':
                raise RuntimeErrorCode('UNSUPPORTED')
            return self.models(uid, account['id'], account['generation'], quota=True)
        if action == 'redeem':
            if not isinstance(params.get('requestId'), str) or not re.fullmatch(r'[a-f0-9-]{36}', params['requestId']):
                raise RuntimeErrorCode('INVALID_REQUEST')
            credit = params.get('creditId')
            if credit is not None and (not isinstance(credit, str) or not 0 < len(credit) <= 256 or re.search(r'[\x00-\x1f]', credit)):
                raise RuntimeErrorCode('INVALID_REQUEST')
        process = self.process_factory(account)
        try:
            from native_worker import public_account
            from usage import project_usage
            pipe = NativePipe(process)
            pipe.initialize()
            metadata = public_account(pipe.call('account/read', {'refreshToken': False}).get('account'))
            self.observe_identity(account, metadata)
            if not metadata:
                raise RuntimeErrorCode('ACCOUNT_AUTHENTICATION_REQUIRED')
            self.authorize(uid, account['id'], account['generation'], allow_disabled=action == 'read')
            if action == 'read':
                return project_usage(pipe.call('account/rateLimits/read', {'excludeResetCreditDetails': False}))
            # The caller durably saves this UUID before sending. Recovery reuses
            # the native idempotency key; no automatic card consumption occurs.
            request = {'idempotencyKey': params['requestId']}
            if params.get('creditId') is not None:
                request['creditId'] = params['creditId']
            result = pipe.call('account/rateLimitResetCredit/consume', request)
            if result.get('outcome') not in ('reset', 'alreadyRedeemed', 'nothingToReset', 'noCredit'):
                raise RuntimeErrorCode('NATIVE_STATUS_UNAVAILABLE')
            return {'outcome': result['outcome']}
        finally:
            self.stop(process)

    def serve(self, uid, params, reader, writer, disconnect=lambda: None):
        from broker import BrokerError
        expected = {'authorityId', 'generation', 'accountId', 'accountGeneration', 'sessionId', 'environmentId', 'cwd', 'execServerUrl'}
        if not isinstance(params, dict) or set(params) not in (expected, expected | {'fork'}) or uid == 0:
            raise RuntimeErrorCode('INVALID_RUNTIME_BINDING')
        self.broker._authority(params)
        workspace, account = self.authorize(uid, params['accountId'], params['accountGeneration'])
        if not isinstance(params['sessionId'], str) or not re.fullmatch(r'[a-f0-9-]{36}', params['sessionId']) or params['environmentId'] != 'local-device' or not isinstance(params['cwd'], str) or not params['cwd'] or len(params['cwd']) > 2048 or re.search(r'[\x00\r\n]', params['cwd']) or not isinstance(params['execServerUrl'], str) or not re.fullmatch(r'ws://127\.0\.0\.1:[0-9]{4,5}/[a-f0-9]{64}', params['execServerUrl']):
            raise RuntimeErrorCode('INVALID_RUNTIME_BINDING')
        port = int(params['execServerUrl'].split(':')[2].split('/')[0])
        if not 1024 < port <= 65535:
            raise RuntimeErrorCode('INVALID_RUNTIME_BINDING')
        key = hashlib.sha256((self.state.account_key(account) + ':' + workspace + ':' + params['sessionId']).encode()).hexdigest()
        binding = {k: params[k] for k in ('environmentId', 'cwd')}
        binding.update(uid=uid, accountId=account['id'], accountGeneration=account['generation'], sessionId=params['sessionId'])
        if 'fork' in params:
            binding['fork'] = copy.deepcopy(validate_fork(params['fork']))
        stopped, done = threading.Event(), threading.Event()
        def disconnect_safely():
            stopped.set()
            try:
                disconnect()
            except OSError:
                pass
        self.maintenance.settle_orphans()
        with self.lock, self.state.lock:
            self.authorize(uid, account['id'], account['generation'])
            if account['id'] in self.broker.external_logins:
                raise RuntimeErrorCode('ACCOUNT_RUNTIME_BUSY')
            if self.closed:
                raise RuntimeErrorCode('RUNTIME_CLOSING')
            self.maintenance.admit()
            try:
                self.storage.check_start(account['id'], params['sessionId'], params.get('fork', {}).get('sourceSessionId'))
            except RuntimeError as error:
                raise RuntimeErrorCode(str(error)) from None
            if key in self.active:
                raise RuntimeErrorCode('SESSION_ALREADY_CONNECTED')
            if 'fork' in binding:
                self.state.verify_fork_source(account, workspace, binding, require_settled=not self.state.state['sessions'].get(key, {}).get('threadId'))
            receipt = self.state.state['sessions'].setdefault(key, dict(binding))
            from session_idle import initialize_activity
            initialize_activity(receipt, self.broker.now())
            if any(receipt.get(k) != v for k, v in binding.items()) or receipt.get('fork') != binding.get('fork'):
                raise RuntimeErrorCode('SESSION_BINDING_CHANGED')
            self.active[key] = dict(binding, stop=disconnect_safely, done=done)
            self.state.save()
        process = None
        output_thread = None
        opened = False
        write_lock = threading.Lock()
        def emit(value):
            with write_lock:
                writer.write((json.dumps(value, separators=(',', ':')) + '\n').encode()); writer.flush()
        def persist():
            with self.state.lock:
                self.state.save()
        def admit():
            self.authorize(uid, account['id'], account['generation'])
            self.state.check(account)
            self.maintenance.admit()
        fence = CodexSessionFence(params, receipt, persist, admit, lambda: self.authorize(uid, account['id'], account['generation']))
        images = GeneratedImageReceipts(self.broker.registry.profiles / account['id'], self.broker.owner_uid)
        try:
            process = self.process_factory(account)
            pipe = NativePipe(process, stopped)
            initialized = pipe.initialize()
            from native_worker import public_account
            account_view = pipe.call('account/read', {'refreshToken': False})
            metadata = public_account(account_view.get('account'))
            self.observe_identity(account, metadata)
            if not metadata:
                self.state.block(account, 'authentication_required')
                raise RuntimeErrorCode('ACCOUNT_AUTHENTICATION_REQUIRED')
            # A deliberate new connection can verify recovery without rerunning
            # any model turn. Transient errors never create persistent blocks.
            with self.state.lock:
                block = copy.deepcopy(self.state.state['blocks'].get(self.state.account_key(account)))
            if block:
                quota = pipe.call('account/rateLimits/read', {}) if block['reason'] == 'rate_limited' else {}
                if block['reason'] == 'authentication_required' or self.quota_available(quota):
                    self.state.clear_after_review(account, True, self.quota_available(quota))
            recovery = {k: receipt[k] for k in ('threadId', 'turnId', 'uncertain', 'interrupted', 'cleanupConfirmed', 'cwd', 'environmentId') if k in receipt}
            emit({'ok': True, 'value': {'provider': account['provider'], 'credentialOwner': 'native', 'workspaceId': workspace, 'sessionReceipt': recovery}})
            opened = True
            self.maintenance.attach(key, fence, pipe, process, disconnect_safely, done)
            def output():
                try:
                    while not stopped.is_set():
                        try:
                            value = pipe.receive(1, stopped)
                        except TimeoutError:
                            continue
                        if self.maintenance.observe(key, value):
                            continue
                        self.native_failure(account, value)
                        with fence.lock:
                            observed = fence.after(value)
                            images.observe(observed)
                            from session_idle import record_model_activity
                            if record_model_activity(receipt, observed, self.broker.now(), account['provider']):
                                persist()
                        emit(observed)
                except EOFError:
                    pass
                except Exception:
                    if not stopped.is_set():
                        try:
                            emit({'method': 'error', 'params': {'error': {'message': 'Native runtime stream requires review.'}}})
                        except OSError:
                            pass
                finally:
                    disconnect_safely()
            output_thread = threading.Thread(target=output, daemon=True)
            output_thread.start()
            while not stopped.is_set():
                raw = reader.readline()
                if not raw:
                    break
                value = json.loads(raw)
                try:
                    with fence.lock:
                        if stopped.is_set():
                            break
                        if value.get('method') == 'workbench/generatedImage/acknowledge':
                            self.authorize(uid, account['id'], account['generation'])
                            image_params = value.get('params', {})
                            if not fence.initialized or type(value.get('id')) not in (str, int) or value['id'] in fence.pending or not isinstance(image_params, dict) or image_params.get('threadId') not in ({receipt.get('threadId')} | fence.children):
                                raise RuntimeErrorCode('IMAGE_RECEIPT_NOT_OWNED')
                            emit({'id': value['id'], 'result': images.acknowledge(image_params)})
                            continue
                        admitted = fence.before(value)
                        if admitted is not None:
                            if admitted.get('method') == 'initialize':
                                # Native initialization already completed above;
                                # expose that receipt, never initialize twice.
                                emit(fence.after({'id': admitted['id'], 'result': initialized}))
                            else:
                                pipe.send(admitted)
                except (RuntimeErrorCode, BrokerError) as error:
                    if isinstance(value, dict) and 'id' in value:
                        rejected = value.get('method') == 'turn/start' and not receipt.get('active') and not receipt.get('uncertain') and str(error) in ('REMOTE_STORAGE_PRESSURE', 'REMOTE_MEMORY_PRESSURE', 'ACCOUNT_RATE_LIMITED', 'ACCOUNT_AUTHENTICATION_REQUIRED', 'ACCOUNT_BILLING_REVIEW', 'ACCOUNT_FORBIDDEN', 'RUNTIME_NOT_ENABLED', 'WORKSPACE_DISABLED', 'POLICY_UNAVAILABLE', 'UNAUTHORIZED')
                        problem = {'code': -32071 if rejected else -32000, 'message': str(error)}
                        if rejected:
                            problem['data'] = {'errorSource': 'workbench-account-gate', 'notSubmitted': True}
                        emit({'id': value['id'], 'error': problem})
        except (RuntimeErrorCode, OSError, ValueError, EOFError) as error:
            if not opened:
                try:
                    emit({'ok': False, 'error': str(error) if isinstance(error, RuntimeErrorCode) else 'NATIVE_RUNTIME_UNAVAILABLE'})
                except OSError:
                    pass
        finally:
            stopped.set()
            cleaned = False
            try:
                if output_thread:
                    output_thread.join(2)
                if process:
                    self.stop(process)
                cleaned = True
            finally:
                with fence.lock:
                    fence.disconnected()
                    receipt['cleanupConfirmed'] = cleaned
                    if cleaned and (receipt.get('uncertain') or receipt.get('forkUncertain') or receipt.get('activeChildren') or receipt.get('closeReason') == 'native_unresponsive'):
                        receipt.update(active=False, uncertain=False, rootPending=False, forkUncertain=False, activeChildren=[], interrupted=True,
                                       closeReason=receipt.get('closeReason', 'native_disconnected'))
                    persist()
                disconnect_safely()
                if cleaned:
                    self.maintenance.detach(key)
                    with self.lock:
                        self.active.pop(key, None)
                    done.set()
                elif process:
                    # Startup can fail before registration; preserve its guard
                    # for bounded retries instead of leaving an orphaned lock.
                    if key not in self.maintenance.handles:
                        self.maintenance.attach(key, fence, pipe, process, disconnect_safely, done)
                    self.maintenance.quarantine(key)

    def close(self):
        self.maintenance.close()
        with self.lock:
            self.closed = True
            active = list(self.active.values())
        for entry in active:
            entry['stop']()
        deadline = time.monotonic() + 10
        for entry in active:
            entry['done'].wait(max(0, deadline - time.monotonic()))
