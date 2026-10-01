"""Workbench-owned Unix-socket quota authority; no network port or credentials."""
import copy
import fcntl
import json
import os
from pathlib import Path
import socket
import socketserver
import stat
import struct
import sys
import subprocess
from control import WorkspaceControl, PolicyPublisher
from provisioner import LinuxProvisioner
from security import ControlError, require_id, trusted_root_path

ROOT = '/var/lib/agent-workbench-ssh-control'
SOCKET = '/var/lib/agent-workbench-policy/quota.sock'


def member_request(control, uid, request):
    if not isinstance(request, dict) or set(request) != {'method', 'params'} or not isinstance(request['params'], dict):
        raise ControlError('INVALID_REQUEST')
    method, params = request['method'], request['params']
    if method not in ('quota/context', 'quota/observe', 'quota/read', 'quota/check'):
        raise ControlError('UNAUTHORIZED')
    workspace = next((w for w in control.state['workspaces'].values() if w['uid'] == uid and w['status'] != 'deleted'), None)
    if not workspace and method == 'quota/context':
        return {'managed': False}
    if not workspace or workspace['status'] != 'active' or workspace['id'] in control.state['policyFences']:
        raise ControlError('WORKSPACE_UNAVAILABLE')
    source = params.get('payload') if method == 'quota/observe' else params
    if not isinstance(source, dict):
        raise ControlError('INVALID_REQUEST')
    account = require_id(source.get('accountId'))
    if account not in workspace['allowedAccountIds']:
        raise ControlError('QUOTA_ACCOUNT_NOT_ALLOWED')
    if method == 'quota/context':
        if set(params) != {'accountId'}:
            raise ControlError('INVALID_REQUEST')
        return dict(managed=True, workspaceId=workspace['id'], accountId=account,
                    allocation=workspace.get('accountQuotas', {}).get(account),
                    authorityId=control.authority_id, generation=control.generation)
    params = copy.deepcopy(params)
    if method == 'quota/observe':
        if set(params) != {'payload'}:
            raise ControlError('INVALID_REQUEST')
        if params['payload'].get('workspaceId', workspace['id']) != workspace['id']:
            raise ControlError('UNAUTHORIZED')
        if 'scope' in params['payload']:
            params['payload']['workspaceId'] = workspace['id']
            # Member-created scope IDs cannot collide with another member.
            import hashlib
            params['payload']['scope'] = hashlib.sha256((workspace['id'] + ':' + require_id(params['payload']['scope'])).encode()).hexdigest()
    if method == 'quota/check':
        if params.get('workspaceId', workspace['id']) != workspace['id']:
            raise ControlError('UNAUTHORIZED')
        params['workspaceId'] = workspace['id']
    params.update(authorityId=control.authority_id, generation=control.generation)
    result = control.dispatch(0, {'protocol': 1, 'method': method, 'params': params})
    if method in ('quota/read', 'quota/observe'):
        result['currentWorkspaceId'] = workspace['id']
    return result


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(90)
        try:
            uid = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
            raw = self.rfile.readline(65537)
            if len(raw) > 65536:
                raise ControlError('INVALID_REQUEST')
            request = json.loads(raw)
            descriptor = os.open(ROOT + '/control.lock', os.O_RDWR | os.O_NOFOLLOW)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX)
                trusted_root_path(ROOT + '/state.json', private=True)
                trusted_root_path(ROOT + '/quota-service.json', private=True)
                with open(ROOT + '/quota-service.json') as source:
                    config = json.load(source)
                control = WorkspaceControl(config, LinuxProvisioner(), publish_policy=PolicyPublisher('/var/lib/agent-workbench-policy/workspaces.json'))
                if request.get('method') == 'quota/observe':
                    params = request.get('params', {})
                    payload = params.get('payload', {})
                    if not isinstance(payload, dict):
                        raise ControlError('INVALID_REQUEST')
                    member_request(control, uid, {'method': 'quota/context', 'params': {'accountId': payload.get('accountId')}})
                    # Client quota percentages/reset timestamps are not authority.
                    runtime_source = params.pop('accountRuntime', 'native-owner')
                    if runtime_source != 'native-owner':
                        raise ControlError('INVALID_REQUEST')
                    if params.pop('refresh', False):
                        script = trusted_root_path(ROOT + '/quota-runtime/quota_native.py', private=True)
                        result = subprocess.run([sys.executable, '-B', script], input=json.dumps({'uid': uid, 'accountId': require_id(payload.get('accountId')), 'accountGeneration': require_id(payload.get('accountGeneration')), 'source': runtime_source}), text=True, capture_output=True, timeout=80, env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'})
                        if result.returncode != 0 or len(result.stdout) > 65536:
                            raise ControlError('QUOTA_UNAVAILABLE')
                        observed = json.loads(result.stdout)
                        if observed.get('ok') is not True:
                            raise ControlError('QUOTA_UNAVAILABLE')
                        payload['windows'] = observed['windows']
                    else:
                        payload.pop('windows', None)
                result = member_request(control, uid, request)
            finally:
                os.close(descriptor)
            response = {'ok': True, 'value': result}
        except ControlError as error:
            response = {'ok': False, 'error': error.code}
        except Exception:
            response = {'ok': False, 'error': 'QUOTA_UNAVAILABLE'}
        self.wfile.write((json.dumps(response, separators=(',', ':')) + '\n').encode())


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root-owned quota authority required.')
    trusted_root_path(ROOT, directory=True, private=True)
    trusted_root_path(str(Path(SOCKET).parent), directory=True)
    # Hold an independent lifetime lock; upgrades never kill an active task.
    lock = os.open(ROOT + '/quota-service.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    if os.path.lexists(SOCKET):
        info = os.lstat(SOCKET)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0:
            raise RuntimeError('Unsafe quota socket.')
        os.unlink(SOCKET)
    server = socketserver.UnixStreamServer(SOCKET, Handler)
    os.chmod(SOCKET, 0o666)  # Every request is bound to the kernel peer UID above.
    try:
        server.serve_forever()
    finally:
        server.server_close()
        os.close(lock)


if __name__ == '__main__':
    main()
