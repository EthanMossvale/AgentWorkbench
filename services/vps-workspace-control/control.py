"""Root-authorized workspace registry, one-execution plans and device invitations.

This module is independent of existing plugins, SSH configuration and credentials.
Its Linux adapter is invoked only by explicit apply/enrollment, never by discovery.
"""
import copy
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlsplit
import uuid
from quota_accounting import QuotaAccounting

from security import (ControlError, USERNAME, absolute_directory, account_ids, digest,
                      normalized_budget, normalized_account_quotas, normalized_environment, public_key, public_text,
                      require_id, trusted_root_path)

OPERATIONS = {'workspace/create', 'workspace/adopt', 'workspace/update', 'workspace/suspend', 'workspace/delete', 'device/revoke', 'invite/create', 'invite/revoke'}


def iso(timestamp):
    return datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')


def atomic_json(path, value, mode=0o600):
    path = Path(path)
    encoded = json.dumps(value, separators=(',', ':'), ensure_ascii=True)
    if len(encoded.encode('ascii')) > 4194304:
        raise ControlError('REGISTRY_FULL')
    temporary = path.parent / ('.awb-' + secrets.token_hex(16))
    descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        if os.name == 'posix':
            os.fchmod(descriptor, mode)  # policy must stay readable despite service umask 077
        with os.fdopen(descriptor, 'w', encoding='utf-8') as target:
            target.write(encoded)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        if os.name == 'posix':
            directory = os.open(str(path.parent), os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


class PolicyPublisher:
    def __init__(self, path):
        self.path = Path(path)

    def __call__(self, value):
        trusted_root_path(str(self.path.parent), directory=True)
        if self.path.exists() or self.path.is_symlink():
            trusted_root_path(str(self.path))
        atomic_json(self.path, value, mode=0o644)


class WorkspaceControl:
    def __init__(self, config, provisioner, *, publish_policy, now=time.time):
        self.authority_id = require_id(config.get('authorityId'))
        self.generation = require_id(config.get('generation'))
        self.now = now
        self.provisioner = provisioner
        self.publish_policy = publish_policy
        self.lock = threading.RLock()
        self.root = Path(config['root'])
        if self.root.is_symlink():
            raise ControlError('UNSAFE_DEPLOYMENT')
        self.root.mkdir(mode=0o700, exist_ok=True)
        self.file = self.root / 'state.json'
        connection = config.get('connection')
        if not isinstance(connection, dict) or set(connection) != {'hostname', 'port', 'hostPublicKeys'}:
            raise ControlError('INVALID_REQUEST')
        hostname = connection['hostname']
        if not isinstance(hostname, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.:-]{0,252}', hostname) or type(connection['port']) is not int or not 1 <= connection['port'] <= 65535:
            raise ControlError('INVALID_REQUEST')
        keys = connection['hostPublicKeys']
        if not isinstance(keys, list) or not 1 <= len(keys) <= 16:
            raise ControlError('INVALID_REQUEST')
        self.connection = {'hostname': hostname, 'port': connection['port'], 'hostPublicKeys': [public_key(key, device=False)[0] for key in keys]}
        self.enrollment_url = config.get('enrollmentUrl')
        if not isinstance(self.enrollment_url, str) or len(self.enrollment_url) > 2048:
            raise ControlError('INVALID_REQUEST')
        parsed = urlsplit(self.enrollment_url)
        if self.enrollment_url and (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path != '/v1/enroll'):
            raise ControlError('HTTPS_ENROLLMENT_REQUIRED')
        self.state = {'schemaVersion': 1, 'authorityId': self.authority_id, 'generation': self.generation, 'revision': 0,
                      'workspaces': {}, 'plans': {}, 'operations': {}, 'invites': {}, 'pendingEnrollments': {}, 'policyFences': {}}
        if self.file.exists() or self.file.is_symlink():
            if self.file.is_symlink() or not self.file.is_file() or self.file.stat().st_size > 4194304:
                raise ControlError('UNSAFE_DEPLOYMENT')
            with self.file.open('r', encoding='utf-8') as source:
                loaded = json.load(source)
            if loaded.get('schemaVersion') != 1 or loaded.get('authorityId') != self.authority_id or loaded.get('generation') != self.generation:
                raise ControlError('STALE_AUTHORITY')
            if type(loaded.get('revision')) is not int or loaded['revision'] < 0 or any(not isinstance(loaded.get(key), dict) for key in ('workspaces', 'plans', 'operations', 'invites', 'pendingEnrollments', 'policyFences')):
                raise ControlError('INVALID_REGISTRY')
            self.state = loaded
        self.state.setdefault('quotaLedger', {})

    def _commit(self, candidate):
        atomic_json(self.file, candidate)
        self.state = candidate

    def _policy(self, disabled=None, release=None):
        current = {}
        for row in self.state['workspaces'].values():
            if row['uid'] not in current or row['status'] != 'deleted':
                current[row['uid']] = row
        return {'schemaVersion': 1, 'authorityId': self.authority_id, 'generation': self.generation, 'revision': self.state['revision'],
                'workspaces': [{'workspaceId': row['id'], 'uid': row['uid'], 'username': row['username'], 'enabled': row['status'] == 'active' and row['id'] != disabled and (row['id'] not in self.state['policyFences'] or row['id'] == release),
                                'allowedAccountIds': row['allowedAccountIds'], 'runtimes': list(row['environment']['runtimes']), 'accountQuotas': copy.deepcopy(row.get('accountQuotas', {}))} for row in current.values()]}

    def reconcile(self):
        """Explicit startup recovery removes only our interrupted enrollment keys."""
        with self.lock:
            candidate = copy.deepcopy(self.state)
            for device_id, pending in candidate['pendingEnrollments'].items():
                workspace = candidate['workspaces'][pending['workspaceId']]
                self.provisioner.revoke_key(workspace, pending['device'])
                workspace['devices'][device_id]['status'] = 'revoked'
            candidate['pendingEnrollments'] = {}
            if candidate != self.state:
                candidate['revision'] += 1
                self._commit(candidate)
            self.publish_policy(self._policy())

    def _workspace(self, workspace_id, *, deleted=False):
        row = self.state['workspaces'].get(require_id(workspace_id))
        if not row or row['status'] == 'deleted' and not deleted:
            raise ControlError('WORKSPACE_UNAVAILABLE')
        return row

    def _devices(self, workspace):
        devices = copy.deepcopy(workspace['devices'])
        for device in getattr(self.provisioner, 'portable_devices', lambda _: [])(workspace):
            devices[device['id']] = device
        return devices

    def _public_workspace(self, workspace):
        result = {key: copy.deepcopy(workspace[key]) for key in ('id', 'generation', 'revision', 'name', 'uid', 'username', 'root', 'environment', 'allowedAccountIds', 'status', 'createdAt', 'updatedAt')}
        result['accountQuotas'] = copy.deepcopy(workspace.get('accountQuotas', {}))
        if 'deletion' in workspace:
            result['deletion'] = copy.deepcopy(workspace['deletion'])
        if 'budget' in workspace:
            result['budget'] = copy.deepcopy(workspace['budget'])  # historical metadata only
        result['nativeQuota'] = 'unknown'
        result['controlState'] = 'recovery-required' if workspace['id'] in self.state['policyFences'] else 'ready'
        result['devices'] = [{key: value for key, value in device.items() if key != 'authorizationLine'} for device in self._devices(workspace).values()]
        result['invites'] = []
        for invite in self.state['invites'].values():
            if invite['workspaceId'] != workspace['id']:
                continue
            status = invite['status']
            if status == 'active' and self.now() >= invite['expiresAtEpoch']:
                status = 'expired'
            result['invites'].append({'id': invite['id'], 'label': invite['label'], 'expiresAt': iso(invite['expiresAtEpoch']), 'status': status})
        return result

    def _authority(self, params):
        if params.get('authorityId') != self.authority_id or params.get('generation') != self.generation:
            raise ControlError('STALE_AUTHORITY')

    def dispatch(self, peer_uid, request):
        if type(peer_uid) is not int or peer_uid != 0:
            raise ControlError('ROOT_REQUIRED')
        if not isinstance(request, dict) or set(request) != {'protocol', 'method', 'params'} or request['protocol'] != 1 or not isinstance(request['params'], dict):
            raise ControlError('INVALID_REQUEST')
        method, params = request['method'], request['params']
        with self.lock:
            if method == 'workspace/list' and not params:
                return {'authorityId': self.authority_id, 'generation': self.generation, 'revision': self.state['revision'],
                        'workspaces': [self._public_workspace(row) for row in self.state['workspaces'].values()],
                        'sshOnlyMembers': self.provisioner.ssh_only_members(),
                        'connection': copy.deepcopy(self.connection), 'enrollmentUrl': self.enrollment_url}
            self._authority(params)
            if method in ('quota/observe', 'quota/read', 'quota/check'):
                allowed = {'authorityId', 'generation', 'payload'} if method == 'quota/observe' else {'authorityId', 'generation', 'accountId', 'accountGeneration'} | ({'workspaceId'} if method == 'quota/check' else set())
                if set(params) != allowed:
                    raise ControlError('INVALID_REQUEST')
                candidate = copy.deepcopy(self.state)
                accounting = QuotaAccounting(candidate.setdefault('quotaLedger', {}), candidate['workspaces'])
                if method == 'quota/observe':
                    value = accounting.observe(params['payload'], self.now())
                    self._commit(candidate)
                    return value
                account, account_generation = require_id(params['accountId']), require_id(params['accountGeneration'])
                if method == 'quota/check':
                    return accounting.check(account, account_generation, require_id(params['workspaceId']), self.now())
                return accounting.summary(account, account_generation)
            if method == 'workspace/plan':
                return self._plan(params)
            if method == 'workspace/apply' and set(params) == {'authorityId', 'generation', 'planId', 'planHash'}:
                return self._apply(params)
            if method == 'workspace/operation' and set(params) == {'authorityId', 'generation', 'operationId'}:
                result = self.state['operations'].get(require_id(params['operationId']))
                if not result:
                    raise ControlError('OPERATION_UNAVAILABLE')
                return copy.deepcopy(result)
            raise ControlError('INVALID_REQUEST')

    def _values(self, operation, values):
        if not isinstance(values, dict):
            raise ControlError('INVALID_REQUEST')
        if operation in ('workspace/create', 'workspace/adopt'):
            keys = {'name', 'username', 'root', 'environment', 'allowedAccountIds'} | ({'uid'} if operation == 'workspace/adopt' else set())
            if not keys.issubset(values) or not set(values).issubset(keys | {'accountQuotas', 'budget'}) or not isinstance(values['username'], str) or not USERNAME.fullmatch(values['username']):
                raise ControlError('INVALID_REQUEST')
            if operation == 'workspace/adopt' and (type(values['uid']) is not int or values['uid'] < 1000):
                raise ControlError('SYSTEM_IDENTITY_FORBIDDEN')
            result = {'name': public_text(values['name'], 80), 'username': values['username'], 'root': absolute_directory(values['root']),
                      'environment': normalized_environment(values['environment']), 'allowedAccountIds': account_ids(values['allowedAccountIds']), 'accountQuotas': normalized_account_quotas(values.get('accountQuotas', {}))}
            if 'budget' in values:
                result['budget'] = normalized_budget(values['budget'])
            if operation == 'workspace/adopt':
                result['uid'] = values['uid']
            return result
        if operation == 'workspace/update':
            if not values or not set(values).issubset({'name', 'environment', 'allowedAccountIds', 'accountQuotas', 'budget'}):
                raise ControlError('INVALID_REQUEST')
            functions = {'name': lambda value: public_text(value, 80), 'environment': normalized_environment, 'allowedAccountIds': account_ids, 'accountQuotas': normalized_account_quotas, 'budget': normalized_budget}
            return {key: functions[key](value) for key, value in values.items()}
        if operation == 'workspace/suspend':
            if set(values) not in (set(), {'suspended'}) or type(values.get('suspended', True)) is not bool:
                raise ControlError('INVALID_REQUEST')
            return {'suspended': values.get('suspended', True)}
        if operation == 'workspace/delete' and not values:
            return {}
        if operation == 'workspace/delete':
            if set(values) != {'name', 'username', 'uid', 'root'} or not isinstance(values['username'], str) or not USERNAME.fullmatch(values['username']):
                raise ControlError('INVALID_REQUEST')
            if type(values['uid']) is not int or values['uid'] < 1000:
                raise ControlError('SYSTEM_IDENTITY_FORBIDDEN')
            root = absolute_directory(values['root'])
            return dict(name=public_text(values['name'], 80), username=values['username'], uid=values['uid'], root=root,
                        environment={'runtimes': [], 'defaultDirectory': root, 'env': {}}, allowedAccountIds=[], accountQuotas={})
        if operation in ('device/revoke', 'invite/revoke'):
            field = 'deviceId' if operation == 'device/revoke' else 'inviteId'
            if set(values) != {field}:
                raise ControlError('INVALID_REQUEST')
            return {field: require_id(values[field])}
        if operation == 'invite/create':
            if not self.enrollment_url:
                raise ControlError('ENROLLMENT_UNAVAILABLE')
            if set(values) != {'label', 'ttlSeconds'} or type(values['ttlSeconds']) is not int or not 60 <= values['ttlSeconds'] <= 604800:
                raise ControlError('INVALID_REQUEST')
            return {'label': public_text(values['label'], 80), 'ttlSeconds': values['ttlSeconds']}
        raise ControlError('INVALID_REQUEST')

    def _allocation_values(self, operation, values, workspace_id):
        if operation not in ('workspace/create', 'workspace/adopt', 'workspace/update'):
            return values
        values = copy.deepcopy(values)
        previous = self.state['workspaces'].get(workspace_id, {})
        allowed = values.get('allowedAccountIds', previous.get('allowedAccountIds', []))
        quotas = values.get('accountQuotas', previous.get('accountQuotas', {}))
        if 'accountQuotas' in values and not set(quotas).issubset(allowed):
            raise ControlError('QUOTA_ACCOUNT_NOT_ALLOWED')
        quotas = {account_id: copy.deepcopy(quotas.get(account_id, {'weeklyPercent': None, 'fiveHourPercent': None, 'allowOverage': True})) for account_id in allowed}
        values['accountQuotas'] = normalized_account_quotas(quotas)
        # Paused/fenced spaces retain their reservation; deleted spaces release it.
        for account_id, allocation in quotas.items():
            for window in ('weeklyPercent', 'fiveHourPercent'):
                total = round((allocation[window] or 0) * 100)
                for other in self.state['workspaces'].values():
                    if other['id'] != workspace_id and other['status'] != 'deleted':
                        total += round((other.get('accountQuotas', {}).get(account_id, {}).get(window) or 0) * 100)
                if total > 10000:
                    raise ControlError('QUOTA_ALLOCATION_EXCEEDED')
        return values

    def _plan(self, params):
        if not {'authorityId', 'generation', 'expectedRevision', 'operation'}.issubset(params) or not set(params).issubset({'authorityId', 'generation', 'expectedRevision', 'operation', 'workspaceId', 'values'}):
            raise ControlError('INVALID_REQUEST')
        if type(params['expectedRevision']) is not int or params['expectedRevision'] != self.state['revision']:
            raise ControlError('STALE_REVISION')
        operation = params['operation']
        if operation not in OPERATIONS:
            raise ControlError('INVALID_REQUEST')
        values = self._values(operation, params.get('values', {}))
        discovered_delete = operation == 'workspace/delete' and 'workspaceId' not in params and bool(values)
        if operation == 'workspace/delete' and not discovered_delete and values:
            raise ControlError('INVALID_REQUEST')
        creating = operation in ('workspace/create', 'workspace/adopt') or discovered_delete
        if creating:
            if 'workspaceId' in params:
                raise ControlError('INVALID_REQUEST')
            if len(self.state['workspaces']) >= 256:
                raise ControlError('REGISTRY_FULL')
            if any(row['status'] != 'deleted' and row['username'] == values['username'] for row in self.state['workspaces'].values()):
                raise ControlError('WORKSPACE_EXISTS')
            if discovered_delete and any(row['username'] == values['username'] and row['uid'] == values['uid'] and row['root'] == values['root'] for row in self.state['workspaces'].values()):
                raise ControlError('WORKSPACE_UNAVAILABLE')
            workspace_id = 'workspace-' + uuid.uuid4().hex
            observed = self.provisioner.observe(values['username'], values['root'])
            if operation == 'workspace/create' and observed['user'] is not None:
                raise ControlError('ADOPT_REQUIRED')
            if operation == 'workspace/create' and observed['directory'] is not None:
                raise ControlError('UNSAFE_WORKSPACE_PATH')
            if (operation == 'workspace/adopt' or discovered_delete) and (not observed['user'] or not observed['directory'] or observed['user']['uid'] != values['uid']):
                raise ControlError('DISCOVERY_CHANGED')
            if observed['user'] and any(row['status'] != 'deleted' and row['uid'] == observed['user']['uid'] for row in self.state['workspaces'].values()):
                raise ControlError('WORKSPACE_EXISTS')
        else:
            row = self._workspace(params.get('workspaceId'))
            workspace_id = row['id']
            observed = self.provisioner.observe(row['username'], row['root'])
            if not observed['user'] or observed['user']['uid'] != row['uid'] or not observed['directory']:
                raise ControlError('DISCOVERY_CHANGED')
            if operation == 'invite/create' and (row['status'] != 'active' or workspace_id in self.state['policyFences']):
                raise ControlError('WORKSPACE_DISABLED')
            if operation == 'device/revoke':
                device = self._devices(row).get(values['deviceId'])
                if not device or device['status'] != 'active':
                    raise ControlError('DEVICE_UNAVAILABLE')
                observed['device'] = device
            if operation == 'invite/revoke' and self.state['invites'].get(values['inviteId'], {}).get('workspaceId') != workspace_id:
                raise ControlError('INVITE_UNAVAILABLE')
        values = self._allocation_values(operation, values, workspace_id)
        effects = self._effects(operation, values)
        deletion = None
        if operation == 'workspace/delete':
            deletion = self.provisioner.deletion_plan(values if discovered_delete else row)
            effects.append('awb-effect:' + json.dumps(dict(code='workspace.destroy', home=deletion['home'], storageBytes=deletion['storageBytes']), separators=(',', ':')))
        plan = {'planId': str(uuid.uuid4()), 'operation': operation, 'workspaceId': workspace_id, 'expectedRevision': self.state['revision'],
                'expiresAt': iso(self.now() + 300), 'expiresAtEpoch': self.now() + 300, 'values': values, 'observedHash': digest(observed), 'effects': effects, 'used': False}
        if deletion is not None:
            plan['deletion'] = deletion
        plan['planHash'] = digest({**plan, 'authorityId': self.authority_id, 'generation': self.generation})
        candidate = copy.deepcopy(self.state)
        # Bound the private plan journal; used plans remain represented by operations.
        if len(candidate['plans']) >= 512:
            expired = [key for key, value in candidate['plans'].items() if value['used'] or value['expiresAtEpoch'] <= self.now()]
            if not expired:
                raise ControlError('REGISTRY_FULL')
            candidate['plans'].pop(expired[0])
        candidate['plans'][plan['planId']] = plan
        self._commit(candidate)
        return {key: copy.deepcopy(plan[key]) for key in ('planId', 'planHash', 'operation', 'workspaceId', 'expectedRevision', 'expiresAt', 'effects', 'deletion') if key in plan}

    @staticmethod
    def _effects(operation, values):
        # Machine-readable, ASCII-only effect descriptors. Desktop localizes
        # these after validation; the exact server plan hash remains unchanged.
        effects = []
        def effect(code, **arguments):
            effects.append('awb-effect:' + json.dumps(dict(code=code, **arguments), ensure_ascii=True, separators=(',', ':')))
        effect(operation.replace('/', '.'), suspended=values.get('suspended', True))
        if 'name' in values:
            effect('workspace.name', name=values['name'])
        if 'username' in values:
            effect('workspace.member', username=values['username'], root=values['root'])
        if 'accountQuotas' in values:
            for account_id, allocation in values['accountQuotas'].items():
                effect('quota.allocate', accountId=account_id, **allocation)
            effect('quota.timing')
            if any(q['weeklyPercent'] is not None or q['fiveHourPercent'] is not None for q in values['accountQuotas'].values()):
                effect('quota.service')
        if 'allowedAccountIds' in values:
            if not values['allowedAccountIds']:
                effect('account.none')
            for account_id in values['allowedAccountIds']:
                effect('account.allow', accountId=account_id)
        return effects

    def _apply(self, params):
        plan_id = require_id(params['planId'])
        plan = self.state['plans'].get(plan_id)
        if not plan or not isinstance(params['planHash'], str) or not hmac.compare_digest(plan['planHash'], params['planHash']):
            raise ControlError('PLAN_UNAVAILABLE')
        if plan['used']:
            raise ControlError('PLAN_ALREADY_USED')
        if self.now() >= plan['expiresAtEpoch']:
            raise ControlError('PLAN_EXPIRED')
        if plan['expectedRevision'] != self.state['revision']:
            raise ControlError('STALE_REVISION')
        values, operation, workspace_id = plan['values'], plan['operation'], plan['workspaceId']
        if operation == 'workspace/delete' and plan.get('deletion', {}).get('mode') != 'destroy':
            raise ControlError('DELETION_PLAN_REQUIRED')
        values = self._allocation_values(operation, values, workspace_id)
        discovered_delete = operation == 'workspace/delete' and 'username' in values
        source = values if operation in ('workspace/create', 'workspace/adopt') or discovered_delete else self._workspace(workspace_id)
        observed = self.provisioner.observe(source['username'], source['root'])
        if operation == 'device/revoke':
            observed['device'] = self._devices(source).get(values['deviceId'])
        if digest(observed) != plan['observedHash']:
            raise ControlError('DISCOVERY_CHANGED')
        candidate = copy.deepcopy(self.state)
        candidate['plans'][plan_id]['used'] = True
        candidate['policyFences'][workspace_id] = plan_id
        result = {'operationId': plan_id, 'state': 'uncertain', 'revision': self.state['revision'], 'effects': plan['effects']}
        candidate['operations'][plan_id] = result
        self._commit(candidate)  # durable one-execution fence before any system effect
        external_started = False
        invite_descriptor = None
        try:
            self.publish_policy(self._policy(disabled=workspace_id))
            external_started = True
            candidate = copy.deepcopy(self.state)
            now = iso(self.now())
            if operation in ('workspace/create', 'workspace/adopt') or discovered_delete:
                # Destruction never temporarily adopts or grants access.
                if discovered_delete:
                    observation = self.provisioner.observe(values['username'], values['root'])
                    if digest(observation) != plan['observedHash']:
                        raise ControlError('DISCOVERY_CHANGED')
                    user = observation['user']
                    deletion = self.provisioner.destroy(values, plan['deletion'], plan_id)
                else:
                    user = self.provisioner.create(values['username'], values['root']) if operation == 'workspace/create' else self.provisioner.adopt(values['username'], values['uid'], values['root'])
                workspace = {key: copy.deepcopy(values[key]) for key in ('name', 'username', 'root', 'environment', 'allowedAccountIds', 'accountQuotas')}
                if 'budget' in values:
                    workspace['budget'] = copy.deepcopy(values['budget'])
                workspace.update(id=workspace_id, generation=uuid.uuid4().hex, revision=1, uid=user['uid'], status='deleted' if discovered_delete else 'active', devices={}, createdAt=now, updatedAt=now)
                if discovered_delete:
                    workspace['deletion'] = deletion
                candidate['workspaces'][workspace_id] = workspace
            else:
                workspace = candidate['workspaces'][workspace_id]
                if operation == 'workspace/suspend' and values['suspended']:
                    getattr(self.provisioner, 'revoke_exports', lambda _: None)(workspace)
                if operation in ('device/revoke', 'workspace/suspend'):
                    workspace['devices'] = self._devices(workspace)
                workspace['revision'] += 1
                workspace['updatedAt'] = now
                if operation == 'workspace/update':
                    workspace.update(copy.deepcopy(values))
                    QuotaAccounting(candidate.setdefault('quotaLedger', {}), candidate['workspaces']).reallocate()
                elif operation in ('workspace/suspend', 'workspace/delete'):
                    suspended = operation == 'workspace/delete' or values['suspended']
                    if operation == 'workspace/delete':
                        workspace['deletion'] = self.provisioner.destroy(workspace, plan['deletion'], plan_id)
                        workspace['allowedAccountIds'] = []
                        workspace['accountQuotas'] = {}
                    workspace['status'] = 'deleted' if operation == 'workspace/delete' else 'suspended' if suspended else 'active'
                    if suspended:
                        for device in workspace['devices'].values():
                            if device['status'] == 'active':
                                if operation != 'workspace/delete':
                                    self.provisioner.revoke_key(workspace, device)
                                if operation == 'workspace/delete':
                                    device['status'] = 'revoked'
                        for invite in candidate['invites'].values():
                            if invite['workspaceId'] == workspace_id and invite['status'] == 'active':
                                invite['status'] = 'revoked'
                    elif operation == 'workspace/suspend':
                        # Resume the same grants and keys; revoked devices stay revoked.
                        for device in workspace['devices'].values():
                            if device['status'] == 'active':
                                self.provisioner.add_key(workspace, device)
                elif operation == 'device/revoke':
                    device = workspace['devices'][values['deviceId']]
                    self.provisioner.revoke_key(workspace, device)
                    device['status'] = 'revoked'
                elif operation == 'invite/revoke':
                    invite = candidate['invites'][values['inviteId']]
                    if invite['status'] == 'active':
                        invite['status'] = 'revoked'
                elif operation == 'invite/create':
                    if len(candidate['invites']) >= 1024:
                        raise ControlError('REGISTRY_FULL')
                    invite_id = 'invite-' + uuid.uuid4().hex
                    token = invite_id + '.' + secrets.token_urlsafe(32)
                    invite = {'id': invite_id, 'workspaceId': workspace_id, 'workspaceGeneration': workspace['generation'], 'label': values['label'],
                              'expiresAtEpoch': self.now() + values['ttlSeconds'], 'tokenHash': hashlib.sha256(token.encode('ascii')).hexdigest(), 'status': 'active'}
                    candidate['invites'][invite_id] = invite
                    invite_descriptor = dict(self._descriptor(workspace), schema='agent-workbench-invite', version=1, inviteId=invite_id, token=token,
                                             expiresAt=iso(invite['expiresAtEpoch']), enrollmentUrl=self.enrollment_url)
            candidate['revision'] += 1
            self._commit(candidate)
            self.publish_policy(self._policy(release=workspace_id))
            result = {'operationId': plan_id, 'state': 'applied', 'revision': self.state['revision'], 'workspace': self._public_workspace(workspace), 'effects': plan['effects']}
        except Exception as error:
            result = {'operationId': plan_id, 'state': 'uncertain' if external_started else 'failed', 'revision': self.state['revision'], 'effects': plan['effects'],
                      'error': error.code if isinstance(error, ControlError) else 'CONTROL_APPLY_UNCONFIRMED'}
        candidate = copy.deepcopy(self.state)
        if result['state'] in ('applied', 'failed'):
            candidate['policyFences'].pop(workspace_id, None)
        if result['state'] == 'applied':
            result['workspace']['controlState'] = 'ready'
        candidate['operations'][plan_id] = result
        self._commit(candidate)
        output = copy.deepcopy(result)
        if result['state'] == 'applied' and invite_descriptor:
            output['invite'] = invite_descriptor  # only this response contains its secret
        return output

    def _descriptor(self, workspace):
        return {'authorityId': self.authority_id, 'generation': self.generation, 'workspaceId': workspace['id'], 'workspaceGeneration': workspace['generation'],
                'workspaceName': workspace['name'], 'username': workspace['username'], 'root': workspace['root'], 'connection': copy.deepcopy(self.connection)}

    def enroll(self, request):
        if not isinstance(request, dict) or set(request) != {'token', 'publicKey', 'deviceLabel'}:
            raise ControlError('INVALID_REQUEST')
        token = request['token']
        if not isinstance(token, str) or not re.fullmatch(r'invite-[a-f0-9]{32}\.[A-Za-z0-9_-]{43}', token):
            raise ControlError('INVITE_UNAVAILABLE')
        canonical, fingerprint = public_key(request['publicKey'])
        label = public_text(request['deviceLabel'], 80)
        with self.lock:
            invite = self.state['invites'].get(token.split('.')[0])
            if not invite or not hmac.compare_digest(invite['tokenHash'], hashlib.sha256(token.encode('ascii')).hexdigest()):
                raise ControlError('INVITE_UNAVAILABLE')
            workspace = self._workspace(invite['workspaceId'])
            if workspace['status'] != 'active' or workspace['id'] in self.state['policyFences'] or workspace['generation'] != invite['workspaceGeneration']:
                raise ControlError('WORKSPACE_DISABLED')
            if invite['status'] == 'redeemed':
                device = workspace['devices'].get(invite.get('deviceId'))
                if not device or device['status'] != 'active' or device['publicKey'] != canonical:
                    raise ControlError('INVITE_UNAVAILABLE')
                return dict(self._descriptor(workspace), schema='agent-workbench-device', version=1, deviceId=device['id'], fingerprint=device['fingerprint'])
            if invite['status'] != 'active' or self.now() >= invite['expiresAtEpoch']:
                raise ControlError('INVITE_UNAVAILABLE')
            if len(workspace['devices']) >= 128 or any(row['publicKey'] == canonical for row in workspace['devices'].values()):
                raise ControlError('KEY_ALREADY_AUTHORIZED')
            device = {'id': 'device-' + uuid.uuid4().hex, 'label': label, 'fingerprint': fingerprint, 'publicKey': canonical, 'createdAt': iso(self.now()), 'status': 'revoked'}
            candidate = copy.deepcopy(self.state)
            target = candidate['workspaces'][workspace['id']]
            target['devices'][device['id']] = device
            candidate['invites'][invite['id']].update(status='redeemed', deviceId=device['id'])
            candidate['pendingEnrollments'][device['id']] = {'workspaceId': workspace['id'], 'device': copy.deepcopy(device)}
            self._commit(candidate)  # consume before publishing any SSH authorization
            try:
                self.provisioner.add_key(target, device)
                candidate = copy.deepcopy(self.state)
                target = candidate['workspaces'][workspace['id']]
                target['devices'][device['id']]['status'] = 'active'
                target['revision'] += 1
                target['updatedAt'] = iso(self.now())
                candidate['pendingEnrollments'].pop(device['id'])
                candidate['revision'] += 1
                self._commit(candidate)
            except Exception:
                # The durable pending record supports exact-key startup recovery.
                try:
                    self.provisioner.revoke_key(target, device)
                except Exception:
                    pass
                raise ControlError('ENROLLMENT_UNCONFIRMED') from None
            return dict(self._descriptor(target), schema='agent-workbench-device', version=1, deviceId=device['id'], fingerprint=fingerprint)
