"""Native Codex device authorization owned by the dedicated broker Unix account.

No credentials are parsed, copied, returned or injected into member profiles.
This module does not start model tasks or provide a runtime-token endpoint.
"""
import json
import os
import re
import select
import signal
import subprocess
import threading
import time

DEVICE_URL = 'https://auth.openai.com/codex/device'


def safe_text(value, maximum=256):
    return isinstance(value, str) and len(value) <= maximum and not re.search(r'[\x00-\x1f\x7f]|-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]|sk-[A-Za-z0-9_-]{12,}', value, re.I)


def public_account(value):
    if not isinstance(value, dict) or value.get('type') not in ('chatgpt', 'apiKey'):
        return None
    result = {'status': 'authenticated', 'authMethod': 'ChatGPT' if value['type'] == 'chatgpt' else 'api-key'}
    for source, target in (('email', 'email'), ('planType', 'plan')):
        if safe_text(value.get(source)):
            result[target] = value[source]
    return result


class NativeCodexLogin:
    """One native login + account/read, with a polling lease and isolated process groups."""
    def __init__(self, profile, binary, owner_uid, notify, *, now=time.monotonic, popen=subprocess.Popen, maximum_seconds=900, lease_seconds=30):
        self.profile = str(profile)
        self.binary = str(binary)
        self.owner_uid = owner_uid
        self.notify = notify
        self.now = now
        self.popen = popen
        self.deadline = now() + min(900, maximum_seconds)
        self.lease_seconds = min(60, lease_seconds)
        self.last_seen = now()
        self.cancelled = threading.Event()
        self.thread = None
        self.process = None
        self.process_identity = None
        self.cleanup_lock = threading.Lock()
        self.reason = None

    def start(self):
        self.thread = threading.Thread(target=self._run, name='account-device-login', daemon=True)
        self.thread.start()

    def renew(self):
        self.last_seen = self.now()

    def cancel(self, wait_seconds=3):
        self.cancelled.set()
        if self.thread and self.thread is not threading.current_thread():
            self.thread.join(wait_seconds)
        if self.thread and not self.thread.is_alive() and self.process is not None:
            cleaned = self._terminate()
            self.notify({'state': 'cancelled', 'cleanup': 'confirmed' if cleaned else 'unconfirmed'})

    def _stop_reason(self):
        if self.cancelled.is_set():
            self.reason = 'cancelled'
        elif self.now() >= self.deadline:
            self.reason = 'expired'
        elif self.now() - self.last_seen >= self.lease_seconds:
            self.reason = 'cancelled'
        return self.reason

    def _launch(self, arguments, rpc=False):
        if self._stop_reason():
            return False
        # The service identity, not the requester, owns every native credential profile.
        if not hasattr(os, 'geteuid') or os.geteuid() == 0 or os.geteuid() != self.owner_uid:
            raise PermissionError('credential-owner-required')
        if not hasattr(os, 'waitid') or not hasattr(os, 'WNOWAIT'):
            raise OSError('non-reaping-process-supervision-required')
        import pwd
        owner = pwd.getpwuid(self.owner_uid)
        environment = {'HOME': owner.pw_dir, 'USER': owner.pw_name, 'LOGNAME': owner.pw_name,
                       'CODEX_HOME': self.profile, 'PATH': '/usr/local/bin:/usr/bin:/bin',
                       'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'NO_COLOR': '1', 'TERM': 'dumb'}
        memory_flags = ['-c', 'features.memories=false', '-c', 'memories.generate_memories=false', '-c', 'memories.use_memories=false'] if 'app-server' in arguments else []
        self.process = self.popen([self.binary] + memory_flags + arguments, cwd=self.profile, env=environment,
                                 stdin=subprocess.PIPE if rpc else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL if rpc else subprocess.STDOUT,
                                 start_new_session=True)
        self.process_identity = self._read_identity(self.process.pid)
        if not self.process_identity or self.process_identity[1:3] != (self.process.pid, self.process.pid):
            raise OSError('native-process-identity-unconfirmed')
        return True

    @staticmethod
    def _read_identity(pid):
        try:
            with open('/proc/' + str(pid) + '/stat', 'r', encoding='utf-8') as source:
                value = source.read(4097)
            if len(value) > 4096 or ')' not in value:
                return None
            # comm may contain spaces and parentheses; fields after its final ')' are fixed.
            fields = value.rsplit(')', 1)[1].split()
            return (int(fields[19]), int(fields[2]), int(fields[3]))  # starttime, process group, session
        except (OSError, ValueError, IndexError):
            return None

    def _exit_code(self):
        # Keep our unreaped child as the process-group identity anchor until the
        # final signals are sent. Reaping in a poll loop would permit PID reuse.
        try:
            result = os.waitid(os.P_PID, self.process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        except ChildProcessError:
            return self.process.returncode
        if result is None:
            return None
        return result.si_status if result.si_code == os.CLD_EXITED else -result.si_status

    def _group_alive(self):
        try:
            os.killpg(self.process.pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    def _terminate(self):
        with self.cleanup_lock:
            if self.process is None:
                return True
            identity = self._read_identity(self.process.pid)
            if identity is not None and identity != self.process_identity:
                return False
            if identity is not None:
                for termination in (signal.SIGTERM, signal.SIGKILL):
                    # Fail closed on every retry; never signal a reused PID/group.
                    if self._read_identity(self.process.pid) != self.process_identity:
                        return False
                    try:
                        os.killpg(self.process.pid, termination)
                    except ProcessLookupError:
                        pass
                    except PermissionError:
                        return False
                    deadline = time.monotonic() + 1
                    while self._exit_code() is None and time.monotonic() < deadline:
                        time.sleep(.02)
                if self._exit_code() is None:
                    return False
            elif self._group_alive():
                # A missing leader cannot prove that surviving numeric group IDs
                # still belong to this job. Service cgroup cleanup must resolve it.
                return False
            try:
                self.process.wait(timeout=.1)
            except (subprocess.TimeoutExpired, ChildProcessError):
                return False
            deadline = time.monotonic() + .5
            while self._group_alive() and time.monotonic() < deadline:
                time.sleep(.02)
            if self._group_alive():
                return False
            for stream in (self.process.stdin, self.process.stdout):
                if stream:
                    stream.close()
            self.process = None
            self.process_identity = None
            return True

    def _collect(self, seconds, progress=None):
        output = bytearray()
        deadline = min(self.deadline, self.now() + seconds)
        while not self._stop_reason() and self.now() < deadline:
            ready, _, _ = select.select([self.process.stdout], [], [], .1)
            if ready:
                chunk = os.read(self.process.stdout.fileno(), 4096)
                if chunk:
                    output.extend(chunk)
                    if len(output) > 65536:
                        return None, ''
                    if progress:
                        progress(output.decode('utf-8', errors='replace'))
                elif self._exit_code() is not None:
                    return self._exit_code(), output.decode('utf-8', errors='replace')
            elif self._exit_code() is not None:
                return self._exit_code(), output.decode('utf-8', errors='replace')
        return None, ''

    def _rpc_write(self, value):
        self.process.stdin.write((json.dumps(value, separators=(',', ':')) + '\n').encode('utf-8'))
        self.process.stdin.flush()

    def _account(self):
        if not self._launch(['-c', 'cli_auth_credentials_store="file"', 'app-server', '--listen', 'stdio://'], True):
            return None
        self._rpc_write({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'agent_workbench_accounts', 'version': '0.1.0'}, 'capabilities': {'experimentalApi': True}}})
        buffer = bytearray()
        total = 0
        initialized = False
        deadline = min(self.deadline, self.now() + 15)
        while not self._stop_reason() and self.now() < deadline:
            ready, _, _ = select.select([self.process.stdout], [], [], .1)
            if not ready:
                if self._exit_code() is not None:
                    return None
                continue
            chunk = os.read(self.process.stdout.fileno(), 4096)
            if not chunk:
                return None
            total += len(chunk)
            if total > 131072:
                return None
            buffer.extend(chunk)
            while b'\n' in buffer:
                raw, _, remainder = buffer.partition(b'\n')
                buffer = bytearray(remainder)
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(message, dict):
                    continue
                if message.get('id') == 1 and not initialized:
                    if 'result' not in message:
                        return None
                    initialized = True
                    self._rpc_write({'method': 'initialized', 'params': {}})
                    self._rpc_write({'id': 2, 'method': 'account/read', 'params': {'refreshToken': False}})
                elif message.get('id') == 2 and initialized:
                    result = message.get('result')
                    return public_account(result.get('account')) if isinstance(result, dict) else None
        return None

    def _run(self):
        from cli_guard import lease
        held = lease('codex', self.binary)
        try:
            held.__enter__()
        except (OSError, RuntimeError):
            self.notify({'state': 'failed', 'error': 'CLI_BUSY', 'cleanup': 'confirmed'})
            return
        try:
            self._run_guarded()
        finally:
            held.__exit__(None, None, None)

    def _run_guarded(self):
        account = None
        failure = 'NATIVE_AUTH_FAILED'
        try:
            if not self._launch(['--version']):
                return
            code, version = self._collect(5)
            if not self._terminate():
                return
            if code != 0 or not re.fullmatch(r'codex-cli\s+\d+\.\d+\.\d+\s*', version):
                failure = 'UNSUPPORTED_NATIVE_VERSION'
                return
            offered = [False]

            def progress(raw):
                if offered[0] or self._stop_reason():
                    return
                clean = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw)
                match = re.search(r'(?:^|\n)[ \t]*([A-Z0-9]{4,6}-[A-Z0-9]{4,6})[ \t]*\r?\n', clean)
                if DEVICE_URL in clean and match:
                    offered[0] = True
                    self.notify({'state': 'awaiting-code', 'verificationUrl': DEVICE_URL, 'userCode': match.group(1)})

            if not self._launch(['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth']):
                return
            code, _ = self._collect(900, progress)
            if not self._terminate() or self._stop_reason() or code != 0:
                return
            self.notify({'state': 'verifying'})
            account = self._account()
        except (OSError, ValueError, KeyError, subprocess.SubprocessError):
            pass
        finally:
            cleaned = self._terminate()
            reason = self._stop_reason()
            if reason:
                self.notify({'state': reason, 'cleanup': 'confirmed' if cleaned else 'unconfirmed'})
            elif account and cleaned:
                self.notify({'state': 'authenticated', 'account': account, 'cleanup': 'confirmed'})
            else:
                self.notify({'state': 'failed', 'error': failure, 'cleanup': 'confirmed' if cleaned else 'unconfirmed'})
