/** Independent native profile; only explicit login starts create native authentication state. */
export const REMOTE_CODEX_AUTH_PYTHON = String.raw`
import os, sys, json, pwd, re, time, signal, select, subprocess, stat, hashlib, fcntl

JOB, MODE, USERNAME, LIMIT_MS = sys.argv[1:5]
DEADLINE = time.monotonic() + min(900, max(.001, int(LIMIT_MS) / 1000))
LAST_HEARTBEAT = time.monotonic()
STOP = None
WORKER = None
CONTROL = bytearray()
OFFICIAL_URL = 'https://auth.openai.com/codex/device'
PROFILE = None
PROFILE_LOCK = None
JOB_FD = None

def emit(kind, **fields):
    print(json.dumps(dict(protocol=1, jobId=JOB, type=kind, **fields), separators=(',', ':')), flush=True)

def stopped(signum, frame):
    global STOP
    STOP = 'cancelled'
signal.signal(signal.SIGHUP, stopped)
signal.signal(signal.SIGTERM, stopped)
signal.signal(signal.SIGINT, stopped)

def process_start(pid):
    try:
        if os.stat('/proc/' + str(pid)).st_uid != os.geteuid(): return None
        with open('/proc/' + str(pid) + '/stat', 'r') as source: fields = source.read(4096).rsplit(')', 1)[1].split()
        return fields[19] if fields[0] != 'Z' else None
    except (OSError, IndexError, ValueError): return None

def same_process(pid, stamp):
    return isinstance(pid, int) and pid > 1 and isinstance(stamp, str) and stamp.isdigit() and process_start(pid) == stamp

def group_alive(pid):
    try: os.killpg(pid, 0); return True
    except ProcessLookupError: return False

def original_group_pending(pid, stamp):
    if not isinstance(pid, int) or pid <= 1 or not isinstance(stamp, str) or not stamp.isdigit(): return False
    current = process_start(pid)
    # A reused leader PID is a different session, and must never be signalled.
    if current is not None and current != stamp: return False
    return group_alive(pid)

def read_job():
    os.lseek(JOB_FD, 0, os.SEEK_SET); raw = os.read(JOB_FD, 4097)
    if len(raw) > 4096: raise ValueError()
    current = json.loads(raw) if raw else {}
    if not isinstance(current, dict) or (current.get('jobId') is not None and current.get('jobId') != JOB): raise ValueError()
    return current

def save_job(current):
    current['jobId'] = JOB
    encoded = json.dumps(current, separators=(',', ':')).encode('ascii')
    os.lseek(JOB_FD, 0, os.SEEK_SET); os.write(JOB_FD, encoded); os.ftruncate(JOB_FD, len(encoded)); os.fsync(JOB_FD)

def lock_job():
    while True:
        try: fcntl.flock(JOB_FD, fcntl.LOCK_EX | fcntl.LOCK_NB); return
        except BlockingIOError:
            if time.monotonic() >= DEADLINE: raise TimeoutError()
            time.sleep(.02)

def job_state(updates=None):
    lock_job()
    try:
        current = read_job()
        if updates: current.update(updates); save_job(current)
        return current
    finally: fcntl.flock(JOB_FD, fcntl.LOCK_UN)

def prepare_job_record(uid):
    global JOB_FD
    name = '/tmp/agent-workbench-codex-job-' + str(uid) + '-' + JOB + '.json'
    JOB_FD = os.open(name, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    info = os.fstat(JOB_FD)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != uid: raise ValueError()

def cleanup_previous():
    # The cancellation tombstone also blocks an old SSH request that arrives late.
    current = job_state({'cancelRequested': True})
    if current.get('cleanupConfirmed') is True: emit('cleanup', cleanup='confirmed'); return
    supervisor = current.get('supervisorPid'); stamp = current.get('supervisorStart')
    if same_process(supervisor, stamp):
        with open('/proc/' + str(supervisor) + '/cmdline', 'rb') as source: command = source.read(131072)
        if JOB.encode() not in command: emit('cleanup', cleanup='unconfirmed'); return
        os.kill(supervisor, signal.SIGTERM)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        current = job_state()
        if current.get('cleanupConfirmed') is True: emit('cleanup', cleanup='confirmed'); return
        if not same_process(supervisor, stamp): break
        time.sleep(.05)
    current = job_state()
    worker = current.get('workerPid'); worker_stamp = current.get('workerStart')
    if same_process(worker, worker_stamp):
        try: os.killpg(worker, signal.SIGKILL)
        except ProcessLookupError: pass
    if same_process(supervisor, stamp):
        try: os.kill(supervisor, signal.SIGKILL)
        except ProcessLookupError: pass
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline and (original_group_pending(worker, worker_stamp) or same_process(supervisor, stamp)): time.sleep(.05)
    confirmed = not original_group_pending(worker, worker_stamp) and not same_process(supervisor, stamp)
    if confirmed: job_state({'cleanupConfirmed': True})
    emit('cleanup', cleanup='confirmed' if confirmed else 'unconfirmed')

def controls():
    global STOP, LAST_HEARTBEAT, CONTROL
    if STOP: return STOP
    if JOB_FD is not None and job_state().get('cancelRequested'): STOP = 'cancelled'; return STOP
    ready, _, _ = select.select([sys.stdin], [], [], 0)
    if ready:
        chunk = os.read(sys.stdin.fileno(), 1024)
        if not chunk: STOP = 'cancelled'; return STOP
        CONTROL.extend(chunk)
        if len(CONTROL) > 4096: STOP = 'cancelled'; return STOP
        while b'\n' in CONTROL:
            raw, _, rest = CONTROL.partition(b'\n'); CONTROL = bytearray(rest)
            if raw == b'heartbeat': LAST_HEARTBEAT = time.monotonic()
            elif raw == b'cancel': STOP = 'cancelled'; return STOP
    if time.monotonic() >= DEADLINE: STOP = 'expired'
    elif time.monotonic() - LAST_HEARTBEAT > 10: STOP = 'cancelled'
    return STOP

def terminate_worker():
    global WORKER, STOP
    if WORKER is None: return True
    # Every native invocation owns a new session, so cleanup includes its descendants.
    try: os.killpg(WORKER.pid, signal.SIGTERM)
    except ProcessLookupError: pass
    try: WORKER.wait(timeout=1)
    except subprocess.TimeoutExpired: pass
    try: os.killpg(WORKER.pid, signal.SIGKILL)
    except ProcessLookupError: pass
    try: WORKER.wait(timeout=1)
    except subprocess.TimeoutExpired: pass
    if WORKER.poll() is None:
        STOP = 'cancelled'
        return False
    deadline = time.monotonic() + .5
    while group_alive(WORKER.pid) and time.monotonic() < deadline: time.sleep(.02)
    if group_alive(WORKER.pid):
        STOP = 'cancelled'
        return False
    if WORKER.stdout: WORKER.stdout.close()
    if WORKER.stdin: WORKER.stdin.close()
    WORKER = None
    return True

def safe_text(value, maximum=256):
    return isinstance(value, str) and len(value) <= maximum and not re.search(r'[\x00-\x1f\x7f]|-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]|sk-[A-Za-z0-9_-]{12,}', value, re.I)

def launch(args, env, cwd, stdin=False):
    global WORKER, STOP
    if controls(): return False
    lock_job()
    try:
        state = read_job()
        if state.get('cancelRequested') or STOP: STOP = 'cancelled'; return False
        WORKER = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.PIPE if stdin else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT if not stdin else subprocess.DEVNULL, start_new_session=True)
        state.update({'workerPid': WORKER.pid, 'workerStart': process_start(WORKER.pid)}); save_job(state)
    finally: fcntl.flock(JOB_FD, fcntl.LOCK_UN)
    return True

def collect(timeout, handler=None):
    result = bytearray(); deadline = min(DEADLINE, time.monotonic() + timeout)
    while True:
        if controls(): return None, ''
        if time.monotonic() > deadline: return None, ''
        ready, _, _ = select.select([WORKER.stdout], [], [], .1)
        if ready:
            chunk = os.read(WORKER.stdout.fileno(), 4096)
            if chunk:
                result.extend(chunk)
                if len(result) > 65536: return None, ''
                if handler: handler(result.decode('utf-8', errors='replace'))
            elif WORKER.poll() is not None: return WORKER.returncode, result.decode('utf-8', errors='replace')
        elif WORKER.poll() is not None: return WORKER.returncode, result.decode('utf-8', errors='replace')

def rpc_write(value):
    WORKER.stdin.write((json.dumps(value, separators=(',', ':')) + '\n').encode('utf-8')); WORKER.stdin.flush()

def read_account(binary, env, home):
    if not launch([binary, '-c', 'cli_auth_credentials_store="file"', 'app-server', '--listen', 'stdio://'], env, home, True): return None
    rpc_write({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'agent_workbench_auth', 'version': '0.1.0'}, 'capabilities': {'experimentalApi': True}}})
    pending = bytearray(); total = 0; phase = 'initialize'; deadline = min(DEADLINE, time.monotonic() + 15)
    while time.monotonic() < deadline and not controls():
        ready, _, _ = select.select([WORKER.stdout], [], [], .1)
        if not ready:
            if WORKER.poll() is not None: break
            continue
        chunk = os.read(WORKER.stdout.fileno(), 4096)
        if not chunk: break
        total += len(chunk)
        if total > 131072: break
        pending.extend(chunk)
        while b'\n' in pending:
            raw, _, rest = pending.partition(b'\n'); pending = bytearray(rest)
            try: message = json.loads(raw)
            except ValueError: continue
            if not isinstance(message, dict): continue
            if message.get('id') == 1 and phase == 'initialize':
                if 'result' not in message: return None
                rpc_write({'method': 'initialized', 'params': {}})
                rpc_write({'id': 2, 'method': 'account/read', 'params': {'refreshToken': False}})
                phase = 'account'
            elif message.get('id') == 2 and phase == 'account':
                result = message.get('result')
                if not isinstance(result, dict) or 'account' not in result: return None
                account = result['account']
                if account is None: return {'status': 'unauthenticated'}
                if not isinstance(account, dict): return None
                kind = account.get('type')
                if kind not in ('chatgpt', 'apiKey'): return None
                safe = {'status': 'authenticated', 'authMethod': 'ChatGPT' if kind == 'chatgpt' else 'api-key'}
                for source, target in (('email', 'email'), ('planType', 'plan')):
                    if safe_text(account.get(source)): safe[target] = account[source]
                return safe
    return None

def main():
    global PROFILE, PROFILE_LOCK
    account = pwd.getpwuid(os.geteuid())
    if account.pw_uid == 0 or account.pw_name != USERNAME: emit('error', error='workspace-identity-required'); return
    if MODE == 'cleanup':
        prepare_job_record(account.pw_uid); cleanup_previous(); return
    home = account.pw_dir
    if not os.path.isabs(home) or not os.path.isdir(home): emit('error', error='profile-unavailable'); return
    parent = os.path.join(home, '.agent-workbench'); PROFILE = os.path.join(parent, 'codex')
    for path in (parent, PROFILE):
        if os.path.lexists(path):
            info = os.lstat(path)
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != account.pw_uid or info.st_mode & 0o077:
                emit('error', error='unsafe-profile'); return
    emit('ready', profilePath=PROFILE)
    if MODE == 'scan' and not os.path.isdir(PROFILE):
        emit('account', account={'status': 'unauthenticated', 'reason': 'profile-absent'}); return
    prepare_job_record(account.pw_uid)
    if job_state().get('cancelRequested'):
        emit('cancelled'); return
    job_state({'supervisorPid': os.getpid(), 'supervisorStart': process_start(os.getpid())})
    # A user-owned temporary lock also serializes aliases and other desktop instances.
    # It contains no credentials and does not create the native profile directory.
    lock_name = '/tmp/agent-workbench-codex-auth-' + str(account.pw_uid) + '-' + hashlib.sha256(PROFILE.encode()).hexdigest()[:24] + '.lock'
    PROFILE_LOCK = os.open(lock_name, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    lock_info = os.fstat(PROFILE_LOCK)
    if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != account.pw_uid:
        emit('error', error='unsafe-profile'); return
    try: fcntl.flock(PROFILE_LOCK, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: emit('error', error='profile-busy'); return
    if MODE == 'login':
        for path in (parent, PROFILE):
            try: os.mkdir(path, 0o700)
            except FileExistsError: pass
            info = os.lstat(path)
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != account.pw_uid or info.st_mode & 0o077:
                emit('error', error='unsafe-profile'); return
    binary = next((os.path.join(directory, 'codex') for directory in (os.path.join(home, '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin') if os.path.isfile(os.path.join(directory, 'codex')) and os.access(os.path.join(directory, 'codex'), os.X_OK)), None)
    if not binary: emit('error', error='codex-unavailable'); return
    env = {'HOME': home, 'USER': USERNAME, 'LOGNAME': USERNAME, 'PATH': os.path.join(home, '.local/bin') + ':/usr/local/bin:/usr/bin:/bin', 'CODEX_HOME': PROFILE, 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'NO_COLOR': '1', 'TERM': 'dumb'}
    os.umask(0o077)
    if not launch([binary, '--version'], env, home): return
    code, output = collect(5); terminate_worker()
    if controls(): return
    if code != 0 or not re.fullmatch(r'codex-cli\s+0\.155\.1\s*', output): emit('error', error='unsupported-codex-version'); return
    if MODE == 'login':
        offered = [False]
        def progress(raw):
            if offered[0]: return
            clean = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw)
            match = re.search(r'(?:^|\n)[ \t]*([A-Z0-9]{4,6}-[A-Z0-9]{4,6})[ \t]*\r?\n', clean)
            if OFFICIAL_URL in clean and match:
                offered[0] = True
                emit('awaiting-code', verificationUrl=OFFICIAL_URL, userCode=match.group(1))
        if not launch([binary, '-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth'], env, home): return
        code, _ = collect(900, progress); terminate_worker()
        if controls(): return
        if code != 0: emit('error', error='device-login-failed'); return
        emit('verifying')
    result = read_account(binary, env, home)
    terminate_worker()
    if controls(): return
    if result is None: emit('error', error='account-read-failed'); return
    if MODE == 'login' and result.get('status') != 'authenticated': emit('error', error='account-not-authenticated'); return
    emit('account', account=result)

try:
    if MODE not in ('login', 'scan', 'cleanup') or not re.fullmatch(r'[a-f0-9-]{36}', JOB): raise ValueError()
    main()
except (OSError, ValueError, KeyError, subprocess.SubprocessError):
    if not STOP: emit('error', error='remote-auth-unavailable')
finally:
    cleaned = terminate_worker()
    if PROFILE_LOCK is not None: os.close(PROFILE_LOCK)
    if JOB_FD is not None:
        if MODE != 'cleanup': job_state({'cleanupConfirmed': cleaned})
        os.close(JOB_FD)
    if STOP: emit(STOP)
    emit('finished', cleanup='confirmed' if cleaned else 'unconfirmed')
`;

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function buildRemoteCodexAuthCommand(jobId: string, mode: 'login' | 'scan' | 'cleanup', username: string, timeoutMs: number): string {
  if (!/^[a-f0-9-]{36}$/.test(jobId) || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(username) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 900_000) throw new Error('Invalid remote authentication request.');
  const loader = `import base64;exec(compile(base64.b64decode('${Buffer.from(REMOTE_CODEX_AUTH_PYTHON).toString('base64')}'),'<agent-workbench-auth>','exec'))`;
  return `exec python3 -u -c ${quote(loader)} ${quote(jobId)} ${mode} ${quote(username)} ${timeoutMs}`;
}
