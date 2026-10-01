"""Linux entrypoint. Root-only Unix management and loopback-only enrollment HTTP."""
import argparse
import fcntl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import socket
import socketserver
import stat
import struct
import threading

from control import PolicyPublisher, WorkspaceControl
from provisioner import LinuxProvisioner
from security import ControlError, trusted_root_path

SOCKET = '/run/agent-workbench-control/control.sock'
MAX_REQUEST = 65536


def enrollment_handler(control):
    slots = threading.BoundedSemaphore(16)

    class EnrollmentHandler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        server_version = 'WorkspaceEnrollment'
        sys_version = ''

        def log_message(self, format, *args):
            pass  # never log invite tokens, request bodies or raw exceptions

        def _response(self, status, value):
            content = json.dumps(value, separators=(',', ':')).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            try:
                self.wfile.write(content)
            except OSError:
                pass
            self.close_connection = True

        def do_POST(self):
            if not slots.acquire(blocking=False):
                self._response(503, {'error': 'ENROLLMENT_BUSY'})
                return
            try:
                self.connection.settimeout(10)
                length = self.headers.get('Content-Length', '')
                if self.path != '/v1/enroll' or self.headers.get('Transfer-Encoding') or not length.isdigit() or not 1 <= int(length) <= 8192 or self.headers.get('Content-Type', '').split(';')[0].strip().lower() != 'application/json':
                    raise ControlError('INVALID_REQUEST')
                raw = self.rfile.read(int(length))
                if len(raw) != int(length):
                    raise ControlError('INVALID_REQUEST')
                result = control.enroll(json.loads(raw))
                self._response(200, result)
            except ControlError as error:
                self._response(403, {'error': error.code})
            except (OSError, ValueError, TypeError):
                self._response(400, {'error': 'INVALID_REQUEST'})
            except Exception:
                self._response(503, {'error': 'ENROLLMENT_UNAVAILABLE'})
            finally:
                slots.release()

        def do_GET(self):
            self._response(405, {'error': 'METHOD_NOT_ALLOWED'})

    return EnrollmentHandler


def main():
    parser = argparse.ArgumentParser(description='Independent root-only workspace control service')
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    if not hasattr(socket, 'SO_PEERCRED') or not hasattr(os, 'geteuid') or os.geteuid() != 0:
        raise ControlError('ROOT_REQUIRED')
    config_path = trusted_root_path(os.path.abspath(args.config))
    trusted_root_path(os.path.abspath(__file__))
    if os.stat(config_path).st_size > 32768:
        raise ControlError('UNSAFE_DEPLOYMENT')
    with open(config_path, 'r', encoding='utf-8') as source:
        config = json.load(source)
    config['root'] = trusted_root_path(config.get('root'), directory=True, private=True)
    state_file = Path(config['root']) / 'state.json'
    if state_file.exists() or state_file.is_symlink():
        trusted_root_path(str(state_file), private=True)
    policy_file = config.get('workspacePolicyFile')
    if not isinstance(policy_file, str) or not policy_file.startswith('/') or Path(policy_file).parent == Path(config['root']):
        raise ControlError('UNSAFE_DEPLOYMENT')
    trusted_root_path(str(Path(policy_file).parent), directory=True)
    if os.path.lexists(policy_file):
        trusted_root_path(policy_file)
    port = config.get('enrollmentPort', 8788)
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ControlError('INVALID_REQUEST')
    directory = Path(trusted_root_path(str(Path(SOCKET).parent), directory=True, private=True))
    os.umask(0o077)
    descriptor = os.open(directory / 'server.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    item = os.fstat(descriptor)
    if not stat.S_ISREG(item.st_mode) or item.st_uid != 0 or item.st_nlink != 1 or item.st_mode & 0o077:
        os.close(descriptor)
        raise ControlError('UNSAFE_DEPLOYMENT')
    lock = os.fdopen(descriptor, 'a+')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if os.path.lexists(SOCKET):
        item = os.lstat(SOCKET)
        if not stat.S_ISSOCK(item.st_mode) or item.st_uid != 0:
            raise ControlError('UNSAFE_DEPLOYMENT')
        os.unlink(SOCKET)
    control = WorkspaceControl(config, LinuxProvisioner(), publish_policy=PolicyPublisher(policy_file))
    control.reconcile()
    slots = threading.BoundedSemaphore(16)

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            if not slots.acquire(blocking=False):
                return
            try:
                self.connection.settimeout(25)
                _, uid, _ = struct.unpack('3i', self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                if uid != 0:
                    raise ControlError('ROOT_REQUIRED')
                raw = self.rfile.readline(MAX_REQUEST + 1)
                if len(raw) > MAX_REQUEST:
                    raise ControlError('INVALID_REQUEST')
                value = control.dispatch(uid, json.loads(raw))
                response = {'ok': True, 'value': value}
            except ControlError as error:
                response = {'ok': False, 'error': error.code}
            except Exception:
                response = {'ok': False, 'error': 'CONTROL_UNAVAILABLE'}
            try:
                self.wfile.write((json.dumps(response, separators=(',', ':')) + '\n').encode('utf-8'))
            except OSError:
                pass
            finally:
                slots.release()

    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True

    server = Server(SOCKET, Handler)
    os.chmod(SOCKET, 0o600)
    http = ThreadingHTTPServer(('127.0.0.1', port), enrollment_handler(control))
    http.daemon_threads = True
    http_thread = threading.Thread(target=http.serve_forever, daemon=True)
    http_thread.start()

    def stop(signum, frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=.2)
    finally:
        http.shutdown()
        http.server_close()
        server.server_close()
        os.unlink(SOCKET)
        lock.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Workspace control service could not start safely.') from None
