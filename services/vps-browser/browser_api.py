"""Ephemeral root SSH control of user-owned browser profiles and native login."""
import base64
import ctypes
import fcntl
import json
import os
from pathlib import Path
import pty
import pwd
import re
import select
import signal
import signal
import socket
import stat
import struct
import subprocess
import sys
import termios
import time
import uuid
import cli_guard
import setup
from broker import trusted_path
from native_worker import NativeCodexLogin
from browser_environment import ENV

SOURCES = {}
ACTIVE_STARTED = False
LOGIN_TIMEOUT = 900
AUTH_URL_TIMEOUT = 60
BROWSER_OPEN_TIMEOUT = 70
HEARTBEAT_TIMEOUT = 45
HOME = Path(ENV['home'])


def require(value, code):
    if not value:
        raise RuntimeError(code)


def emit(value):
    if ENV['webPort'] != 6091:
        value = dict(value, webPort=ENV['webPort'])
    print(json.dumps(value, separators=(',', ':')), flush=True)


def installed():
    paths = [ENV['chrome'], ENV['xvnc'], str(Path(ENV['web']) / 'vnc.html'), str(Path(ENV['websockify']) / 'websockify/__init__.py')]
    missing = [p for p in paths if not Path(p).is_file()]
    try:
        user = pwd.getpwnam(ENV['serviceUser'])
        require(user.pw_dir == str(HOME) and user.pw_uid > 0, 'BROWSER_IDENTITY_INVALID')
    except KeyError:
        missing.append(ENV['serviceUser'])
    return {'installed': not missing, 'missing': missing}


def manager_args(action, options):
    prefix = "import sys,types,json; m=types.ModuleType('browser_environment');sys.modules['browser_environment']=m;m.ENV=json.loads(" + repr(json.dumps(ENV)) + ");"
    code = prefix + "import base64;exec(compile(base64.b64decode('" + base64.b64encode(SOURCES['remote_browser.py'].encode()).decode() + "'),'remote_browser.py','exec'))"
    return [sys.executable, '-u', '-B', '-c', code, action, base64.b64encode(json.dumps(options).encode()).decode()]


def manage(request):
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    action = request.get('action')
    require(action in ('list', 'create', 'rename', 'delete'), 'INVALID_REQUEST')
    status = installed()
    if not status['installed']:
        require(action == 'list', 'BROWSER_NOT_INSTALLED')
        return dict(status, profiles=[])
    require(action != 'delete' or request.get('confirm') is True, 'CONFIRM_REQUIRED')
    result = subprocess.run(manager_args('profiles' if action == 'list' else action, {'key': request.get('key'), 'label': request.get('label'), 'confirm_key': request.get('key') if action == 'delete' else None}), capture_output=True, timeout=45)
    value = json.loads(result.stdout)
    require(result.returncode == 0 and value.get('ok') is True, value['error'] if value.get('error') in ('BROWSER_BUSY', 'BROWSER_PROFILE_SHARED_BUSY') else 'BROWSER_OPERATION_FAILED')
    return dict(status, profiles=[{k: r[k] for k in ('key', 'label', 'available')} for r in value['profiles']])


def control(request):
    """Explicit browser management; SSH EOF must not own the browser lifetime."""
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    action = request.get('action')
    require(action in ('launch', 'reconnect', 'stop'), 'INVALID_REQUEST')
    require(action != 'stop' or request.get('confirm') is True, 'CONFIRM_REQUIRED')
    if action == 'launch':
        require(isinstance(request.get('profileKey'), str) and re.fullmatch(r'[a-f0-9]{32}', request['profileKey']), 'INVALID_REQUEST')
    if action != 'stop':
        require(installed()['installed'], 'BROWSER_NOT_INSTALLED')
    # Stop remains available if a browser component was removed after launch.
    result = subprocess.run(manager_args('start' if action == 'launch' else action,
                                        {'key': request['profileKey']} if action == 'launch' else {}),
                            capture_output=True, timeout=100)
    value = json.loads(result.stdout)
    known = ('BROWSER_BUSY', 'BROWSER_ALREADY_RUNNING', 'BROWSER_NOT_RUNNING', 'BROWSER_DESKTOP_UNAVAILABLE')
    failure = value.get('error') if value.get('error') in known else (
        'BROWSER_STOP_UNCONFIRMED' if action == 'stop' else 'BROWSER_RECONNECT_FAILED' if action == 'reconnect' else 'BROWSER_START_FAILED')
    require(result.returncode == 0 and value.get('ok') is True, failure)
    require(all(isinstance(value.get(k), list) for k in ('chrome', 'desktop', 'bridge')), 'BROWSER_RESPONSE_INVALID')
    running = bool(value['chrome'])
    if action == 'stop':
        require(not any(value[k] for k in ('chrome', 'desktop', 'bridge')), 'BROWSER_STOP_UNCONFIRMED')
    else:
        require(running and value['desktop'] and value['bridge'] and value.get('web_ready') is True, 'BROWSER_START_FAILED')
        if action == 'reconnect':
            require(value.get('browser_preserved') is True and value.get('vnc_ready') is True, 'BROWSER_RECONNECT_FAILED')
        else:
            require(value.get('selected_profile', {}).get('key') == request['profileKey'], 'BROWSER_RESPONSE_INVALID')
    return dict(running=running, profilesPreserved=True, **({'profileKey': request['profileKey']} if action == 'launch' else {}))


def native(config, method, params):
    setup.trusted(setup.CONFIG)
    with socket.socket(socket.AF_UNIX) as channel:
        channel.settimeout(35)
        channel.connect(setup.SOCKET)
        require(struct.unpack('3i', channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] == config['ownerUid'], 'ACCOUNT_SERVICE_INVALID')
        request = {'protocol': 1, 'method': method, 'params': dict(authorityId=config['authorityId'], generation=config['generation'], **params)}
        channel.sendall((json.dumps(request) + '\n').encode())
        value = json.loads(channel.makefile('rb').readline(65537))
        require(value.get('ok') is True, value.get('error') if re.fullmatch(r'[A-Z_]+', str(value.get('error'))) else 'ACCOUNT_SERVICE_INVALID')
        return value['value']


def code_input(value):
    require(isinstance(value, str) and 1 <= len(value) <= 2048 and re.fullmatch(r'[A-Za-z0-9_.#~+=/-]+', value) and not value.startswith(('sk-', 'Bearer', 'eyJ')), 'INVALID_AUTH_CODE')
    return value


def bind_parent_lifetime(parent_pid):
    # Set only after setuid: Linux clears this setting on credential changes.
    # A hard orchestrator crash must not leave the native login leader waiting.
    require(ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL, 0, 0, 0) == 0, 'LOGIN_SUPERVISION_UNAVAILABLE')
    if os.getppid() != parent_pid:
        os._exit(125)


def login(request):
    global ACTIVE_STARTED
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    require(installed()['installed'], 'BROWSER_NOT_INSTALLED')
    config = setup.public_json(setup.CONFIG)
    require(request.get('authorityId') == config['authorityId'] and request.get('generation') == config['generation'], 'STALE_AUTHORITY')
    account_id, generation, job_id = request.get('accountId'), request.get('accountGeneration'), request.get('jobId')
    require(isinstance(account_id, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', account_id) and isinstance(job_id, str) and re.fullmatch(r'[a-f0-9-]{36}', job_id), 'INVALID_REQUEST')
    owner = pwd.getpwuid(config['ownerUid'])
    binary = trusted_path(config.get('claudeExecutable'), owners={0}, final_uid=0, kind='executable', allow_symlinks=True)
    profile = trusted_path(str(Path(config['root']) / 'profiles' / account_id), owners={0, owner.pw_uid}, final_uid=owner.pw_uid, kind='directory', private=True)
    binding = dict(accountId=account_id, accountGeneration=generation, jobId=job_id)
    native(config, 'runtime/login-reserve', binding)
    browser = guard = None
    master = None
    browser_clean = cli_clean = True
    state, failure = 'failed', None
    lease = cli_guard.lease('claude', binary)
    leased = False
    try:
        lease.__enter__()
        leased = True
        status = native(config, 'runtime/status', {'accountId': account_id})
        require(not status.get('authenticated'), 'ACCOUNT_ALREADY_AUTHENTICATED')
        ACTIVE_STARTED = True
        browser = subprocess.Popen(manager_args('session', {'key': request.get('profileKey')}), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        browser_clean = False
        require(select.select([browser.stdout], [], [], 70)[0], 'BROWSER_START_TIMEOUT')
        ready = json.loads(browser.stdout.readline(65537))
        browser_clean = ready.get('cleanup') == 'confirmed' or ready.get('error') == 'BROWSER_BUSY'
        require(ready.get('ready') is True, 'BROWSER_BUSY' if ready.get('error') == 'BROWSER_BUSY' else 'BROWSER_START_FAILED')
        viewer_ready = False
        emit({'state': 'preparing', 'viewerReady': viewer_ready, 'codeRequested': False, 'cleanup': 'pending'})
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 4096, 0, 0))
        attrs = termios.tcgetattr(slave)
        attrs[3] &= ~termios.ECHO
        termios.tcsetattr(slave, termios.TCSANOW, attrs)
        env = dict(HOME=owner.pw_dir, USER=owner.pw_name, LOGNAME=owner.pw_name, PATH='/usr/local/bin:/usr/bin:/bin', LANG='C.UTF-8', TERM='xterm', NO_COLOR='1', BROWSER='/bin/true', CLAUDE_CONFIG_DIR=profile, DISABLE_AUTOUPDATER='1', CLAUDE_CODE_DISABLE_AUTO_MEMORY='1')
        parent_pid = os.getpid()
        def identity():
            os.setsid()
            os.initgroups(owner.pw_name, owner.pw_gid)
            os.setgid(owner.pw_gid)
            os.setuid(owner.pw_uid)
            os.umask(0o077)
            bind_parent_lifetime(parent_pid)
        guard = NativeCodexLogin(profile, binary, owner.pw_uid, lambda value: None)
        try:
            guard.process = subprocess.Popen([binary, 'auth', 'login'], env=env, cwd=profile, stdin=slave, stdout=slave, stderr=slave, preexec_fn=identity)
            guard.process_identity = guard._read_identity(guard.process.pid)
        finally:
            os.close(slave)
        cli_clean = False
        reader = os.fdopen(os.dup(0), 'rb', buffering=0)
        buffer, opened, prompt = '', set(), False
        saw_url, open_deadline = False, None
        auth_url_deadline = time.monotonic() + AUTH_URL_TIMEOUT
        deadline, heartbeat, next_ping = time.monotonic() + LOGIN_TIMEOUT, time.monotonic() + HEARTBEAT_TIMEOUT, 0
        state = 'preparing'
        emit({'state': state, 'viewerReady': viewer_ready, 'codeRequested': False, 'cleanup': 'pending'})
        while time.monotonic() < deadline:
            require(time.monotonic() < heartbeat, 'LOGIN_DISCONNECTED')
            if not opened:
                require(time.monotonic() < auth_url_deadline,
                        'NATIVE_AUTH_URL_UNRECOGNIZED' if saw_url else 'NATIVE_AUTH_URL_TIMEOUT')
            elif not viewer_ready:
                require(time.monotonic() < open_deadline, 'BROWSER_START_TIMEOUT')
            if time.monotonic() > next_ping:
                browser.stdin.write(b'{"action":"heartbeat"}\n'); browser.stdin.flush()
                next_ping = time.monotonic() + 10
            inputs = select.select([master, reader, browser.stdout], [], [], .25)[0]
            if browser.stdout in inputs:
                line = browser.stdout.readline(65537)
                require(bool(line), 'BROWSER_CLOSED')
                update = json.loads(line)
                if update.get('cleanup') == 'confirmed':
                    browser_clean = True
                require(update.get('opened') is True, 'BROWSER_CLOSED')
                viewer_ready = True
                state = 'awaiting-browser'
                emit({'state': state, 'viewerReady': viewer_ready, 'codeRequested': prompt, 'cleanup': 'pending'})
            if reader in inputs:
                line = reader.readline(8193)
                require(bool(line) and len(line) <= 8192, 'LOGIN_DISCONNECTED')
                message = json.loads(line)
                if message.get('action') == 'cancel':
                    state = 'cancelled'
                    break
                if message.get('action') == 'heartbeat':
                    heartbeat = time.monotonic() + HEARTBEAT_TIMEOUT
                elif message.get('action') == 'code':
                    require(prompt, 'AUTH_CODE_NOT_REQUESTED')
                    os.write(master, (code_input(message.get('code')) + '\n').encode())
                    prompt = False
                    buffer = ''
                    emit({'state': state, 'viewerReady': viewer_ready, 'codeRequested': False, 'cleanup': 'pending'})
                else:
                    require(message.get('action') == 'heartbeat', 'INVALID_REQUEST')
            if master in inputs:
                try:
                    raw = os.read(master, 16384)
                except OSError:
                    raw = b''
                buffer = (buffer + raw.decode('utf-8', errors='replace'))[-32768:]
                clean = re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', buffer)
                # Native TTY output uses OSC 8 hyperlinks, terminated by BEL or
                # ST. Never include terminal controls or open an unfinished URL
                # merely because the current PTY read ended mid-query.
                for url in re.findall(r'https://[^\s\x00-\x20\x7f<>]+(?=[\s\x00-\x20\x7f<>])', clean):
                    saw_url = True
                    if url in opened or not re.match(r'https://(?:(?:claude\.ai|console\.anthropic\.com|platform\.claude\.com)(?::443)?/oauth/authorize/?|claude\.com(?::443)?/cai/oauth/authorize/?)\?', url):
                        continue
                    browser.stdin.write((json.dumps({'action': 'open', 'url': url}) + '\n').encode()); browser.stdin.flush()
                    if not opened:
                        open_deadline = time.monotonic() + BROWSER_OPEN_TIMEOUT
                    opened.add(url)
                if re.search(r'paste\s+(?:the\s+)?code|paste code here', clean, re.I) and not prompt:
                    prompt = True
                    emit({'state': state, 'viewerReady': viewer_ready, 'codeRequested': True, 'cleanup': 'pending'})
            if guard._exit_code() is not None:
                require(guard._exit_code() == 0, 'NATIVE_AUTH_FAILED')
                status = native(config, 'runtime/status', {'accountId': account_id})
                require(status.get('authenticated') is True, 'NATIVE_AUTH_UNCONFIRMED')
                state = 'authenticated'
                break
        else:
            state = 'expired'
    except Exception as error:
        failure = str(error) if re.fullmatch(r'[A-Z_]+', str(error)) else 'LOGIN_UNCONFIRMED'
        state = 'failed'
    finally:
        if guard:
            try:
                cli_clean = guard._terminate()
            except Exception:
                cli_clean = False
        if master is not None:
            os.close(master)
        if browser:
            try:
                browser.stdin.close()
                browser.stdin = None
                tail, _ = browser.communicate(timeout=50)
                browser.wait(timeout=5)
                browser_clean = browser_clean or any(json.loads(line).get('cleanup') == 'confirmed' for line in tail.splitlines() if line.strip())
            except Exception:
                browser_clean = False
        if leased:
            lease.__exit__(None, None, None)
        if cli_clean and browser_clean:
            try:
                native(config, 'runtime/login-release', dict(binding, publish=state == 'authenticated') if request.get('draft') is True else binding)
            except Exception:
                failure = 'ACCOUNT_RELEASE_UNCONFIRMED'
                cli_clean = False
        ACTIVE_STARTED = not (cli_clean and browser_clean)
        emit({'state': state, 'viewerReady': False, 'codeRequested': False, 'cleanup': 'confirmed' if cli_clean and browser_clean else 'unconfirmed', **({'error': failure} if failure else {})})


def dispatch(request):
    try:
        if request.get('action') == 'environment':
            require(os.geteuid() == 0, 'ADMIN_REQUIRED')
            emit({'ok': True, 'value': ENV})
            return
        if request.get('action') in ('setup-plan', 'setup-apply'):
            import browser_setup
            value = browser_setup.inspect() if request['action'] == 'setup-plan' else browser_setup.apply(request.get('planId'), SOURCES)
            if request['action'] == 'setup-apply':
                require(installed()['installed'], 'BROWSER_SETUP_UNCONFIRMED')
            emit({'ok': True, 'value': value})
            return
        if request.get('action') == 'login':
            return login(request)
        if request.get('action') in ('launch', 'reconnect', 'stop'):
            emit({'ok': True, 'value': control(request)})
            return
        emit({'ok': True, 'value': manage(request)})
    except Exception as error:
        code = str(error)
        emit({'ok': False, 'error': code if re.fullmatch(r'[A-Z_]+', code) else 'BROWSER_OPERATION_FAILED', 'cleanup': 'unconfirmed' if ACTIVE_STARTED else 'confirmed'})
