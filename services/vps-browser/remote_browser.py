"""Root-managed standalone browser; the browser itself uses a sandboxed service UID."""
import base64
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import pwd
import select
from urllib.parse import urlsplit
import signal
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from browser_environment import ENV

SERVICE_USER = ENV['serviceUser']
HOME = Path(ENV['home'])
STATE = HOME / '.local/state/jp-remote-browser'
CHROME = Path(ENV['chrome'])
PROFILE = HOME / '.config/google-chrome'
WEB = Path(ENV['web'])
WEBSOCKIFY = Path(ENV['websockify'])
DISPLAY = ENV['display']
VNC_PORT, WEB_PORT = ENV['vncPort'], ENV['webPort']


def enter_browser_identity():
    user = pwd.getpwnam(SERVICE_USER)
    if user.pw_dir != str(HOME) or user.pw_uid <= 0:
        raise RuntimeError('The standalone browser identity is not configured correctly.')
    if os.geteuid() == 0:
        os.initgroups(SERVICE_USER, user.pw_gid)
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
    elif os.geteuid() != user.pw_uid:
        raise RuntimeError('Connect through the configured root administrator for browser management.')
    os.umask(0o077)
    os.environ.clear()
    os.environ.update(HOME=str(HOME), USER=SERVICE_USER, LOGNAME=SERVICE_USER,
                      PATH='/usr/local/bin:/usr/bin:/bin', LANG='C.UTF-8', LC_ALL='C.UTF-8')
    os.chdir(HOME)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, ensure_ascii=True, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def profile_path(directory):
    if not isinstance(directory, str) or not directory or directory in ('.', '..', 'System Profile', 'Guest Profile') or '/' in directory or '\\' in directory:
        raise ValueError('Invalid browser profile directory.')
    path = PROFILE / directory
    if path.is_symlink() or path.resolve().parent != PROFILE.resolve():
        raise ValueError('Profile path must remain directly inside the saved browser directory.')
    return path


def clean_label(label):
    if not isinstance(label, str):
        raise ValueError('Enter a profile label.')
    label = label.strip()
    if not label or any(ord(c) < 32 or ord(c) == 127 for c in label):
        raise ValueError('Profile label must be nonempty without control characters.')
    return label


def load_profiles():
    path = STATE / 'profiles.json'
    if path.exists():
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('version') != 1 or not isinstance(data.get('profiles'), list):
            raise ValueError('Saved profile list is invalid; refusing to replace it.')
    else:
        data = {'version': 1, 'profiles': [], 'ignored_directories': ['Default']}
        # A fresh installation starts empty. Existing directories are discovered
        # below without guessing account names or recreating missing profiles.
    profiles = data['profiles']
    seen_keys, seen_dirs = set(), set()
    for entry in profiles:
        profile_path(entry['directory'])
        clean_label(entry['label'])
        if not isinstance(entry['key'], str) or len(entry['key']) != 32 or any(c not in '0123456789abcdef' for c in entry['key']) or entry['key'] in seen_keys or entry['directory'] in seen_dirs:
            raise ValueError('Saved profile list contains duplicate identities.')
        seen_keys.add(entry['key'])
        seen_dirs.add(entry['directory'])
    # Discover Chrome users created outside this launcher without losing them.
    discovered = []
    if PROFILE.exists():
        discovered = sorted((p for p in PROFILE.iterdir() if p.is_dir() and not p.is_symlink() and (p / 'Preferences').is_file() and p.name not in ('System Profile', 'Guest Profile')), key=lambda p: (p.name != 'Default', p.name))
    changed = not path.exists()
    for p in discovered:
        if p.name in seen_dirs or p.name in data.get('ignored_directories', []):
            continue
        prefs = json.loads((p / 'Preferences').read_text(encoding='utf-8'))
        label = str(prefs.get('profile', {}).get('name') or p.name).strip() or p.name
        profiles.append({'key': uuid.uuid4().hex, 'label': clean_label(label), 'directory': p.name})
        seen_dirs.add(p.name)
        changed = True
    if changed:
        write_json(path, data)
    return data


def public_profiles(data=None):
    if data is None:
        data = load_profiles()
    return [dict(entry, number=i, display_name=f'Profile {i} ({entry["label"]})', available=(profile_path(entry['directory']) / 'Preferences').is_file())
            for i, entry in enumerate(data['profiles'], 1)]


def find_profile(key, data=None):
    for entry in public_profiles(data):
        if entry['key'] == key:
            return entry
    raise ValueError('That profile no longer exists. Refresh the profile list.')


def create_profile(label):
    label = clean_label(label)
    data = load_profiles()
    key = uuid.uuid4().hex
    directory = 'Managed-' + key
    PROFILE.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = profile_path(directory)
    path.mkdir(mode=0o700)  # Never reuse or copy another account's directory.
    write_json(path / 'Preferences', {'profile': {'name': label, 'using_default_name': False}})
    data['profiles'].append({'key': key, 'label': label, 'directory': directory})
    write_json(STATE / 'profiles.json', data)
    return {'selected_profile': find_profile(key, data), 'profiles': public_profiles(data)}


def rename_profile(key, label):
    label = clean_label(label)
    data = load_profiles()
    find_profile(key, data)
    for entry in data['profiles']:
        if entry['key'] == key:
            entry['label'] = label
    write_json(STATE / 'profiles.json', data)
    return {'profiles': public_profiles(data)}


def delete_profile(key, confirm_key):
    if not key or confirm_key != key:
        raise ValueError('Explicit confirmation of the selected profile is required.')
    data = load_profiles()
    selected = find_profile(key, data)
    path = profile_path(selected['directory'])
    browsers = owned('chrome')
    remaining = dict(data, profiles=[p for p in data['profiles'] if p['key'] != key])
    local_state = PROFILE / 'Local State'
    original_state = local_state.read_bytes() if local_state.exists() else None
    updated_state = None
    # A newly created, unopened workbench profile is not owned by the running
    # Chromium parent. Do not rewrite its shared Local State while it is live.
    if browsers:
        references = (json.loads(original_state).get('profile', {}) if original_state else {})
        known = {str(v) for v in references.get('info_cache', {})}
        known.update(str(v) for v in references.get('last_active_profiles', []))
        known.update(str(v) for v in references.get('profiles_order', []))
        known.add(str(references.get('last_used', '')))
        safe_processes = all(p.get('args') and any(a.startswith('--profile-directory=') for a in p['args']) and '--profile-directory=' + selected['directory'] not in p['args'] for p in browsers.values())
        preferences = path / 'Preferences'
        unused = path.is_dir() and set(p.name for p in path.iterdir()) == {'Preferences'} and not preferences.is_symlink()
        if not (selected['directory'] == 'Managed-' + key and selected['directory'] not in known and safe_processes and unused):
            raise RuntimeError('BROWSER_PROFILE_SHARED_BUSY')
        prefs = json.loads(preferences.read_text(encoding='utf-8'))
        if set(prefs) != {'profile'} or set(prefs['profile']) != {'name', 'using_default_name'} or prefs['profile']['using_default_name'] is not False:
            raise RuntimeError('BROWSER_PROFILE_SHARED_BUSY')
    if original_state is not None and not browsers:
        updated_state = json.loads(original_state)
        info = updated_state.setdefault('profile', {})
        info.get('info_cache', {}).pop(selected['directory'], None)
        for field in ('last_active_profiles', 'profiles_order'):
            if isinstance(info.get(field), list):
                info[field] = [x for x in info[field] if x != selected['directory']]
        if info.get('last_used') == selected['directory']:
            if remaining['profiles']:
                info['last_used'] = remaining['profiles'][0]['directory']
            else:
                info.pop('last_used', None)
    staged = STATE / ('delete-pending-' + key)
    if staged.exists() or staged.is_symlink():
        raise RuntimeError('A previous incomplete deletion needs review: ' + str(staged))
    moved = False
    try:
        if path.exists():
            os.replace(path, staged)
            moved = True
        if updated_state is not None:
            write_json(local_state, updated_state)
        write_json(STATE / 'profiles.json', remaining)
    except Exception:
        if moved:
            os.replace(staged, path)
        if original_state is not None and not browsers:
            write_json(local_state, json.loads(original_state))
        write_json(STATE / 'profiles.json', data)
        raise
    if moved:
        # The exact selected directory is now outside Chrome's discovery path.
        shutil.rmtree(staged)
    return {'deleted_profile': selected, 'profiles': public_profiles(remaining), 'chrome_closed': not bool(browsers)}


def processes():
    result = {}
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():
            continue
        try:
            if p.stat().st_uid != os.getuid():
                continue
            args = p.joinpath('cmdline').read_bytes().decode().rstrip('\0').split('\0')
            stat = p.joinpath('stat').read_text().rsplit(')', 1)[1].split()
            if stat[0] == 'Z' or not args[0]:
                continue
            env = p.joinpath('environ').read_bytes().decode().split('\0')
            result[int(p.name)] = dict(args=args, parent=int(stat[1]), born=stat[19],
                                       display=next((e[8:] for e in env if e.startswith('DISPLAY=')), None))
        except (OSError, UnicodeError, IndexError, ValueError):
            continue
    return result


def matches(kind, p):
    a = p['args']
    if not a:
        return False
    if kind == 'chrome':
        return a[0] == str(CHROME) and '--user-data-dir=' + str(PROFILE) in a and not any(x.startswith('--type=') for x in a)
    if kind == 'desktop':
        return a[0] == ENV['xvnc'] and DISPLAY in a and '-rfbport' in a and a[a.index('-rfbport') + 1:a.index('-rfbport') + 2] == [str(VNC_PORT)]
    return 'websockify' in a and str(WEB) in a and f'127.0.0.1:{WEB_PORT}' in a and f'127.0.0.1:{VNC_PORT}' in a


def owned(kind):
    return {pid: p for pid, p in processes().items() if matches(kind, p)}


def port_open(port):
    try:
        with socket.create_connection(('127.0.0.1', port), 1):
            return True
    except OSError:
        return False


def web_ready():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://127.0.0.1:{WEB_PORT}/vnc.html', timeout=2) as r:
            return r.status == 200
    except OSError:
        return False


def vnc_ready():
    try:
        with socket.create_connection(('127.0.0.1', VNC_PORT), 3) as connection:
            connection.settimeout(3)
            banner = b''
            while len(banner) < 12:
                received = connection.recv(12 - len(banner))
                if not received:
                    return False
                banner += received
            return banner.startswith(b'RFB 003.') and banner.endswith(b'\n')
    except OSError:
        return False


def reconnect():
    # Transport-only recovery: never invoke Chrome or restart its X display.
    browsers = owned('chrome')
    desktops = owned('desktop')
    if not browsers:
        raise RuntimeError('BROWSER_NOT_RUNNING')
    if not desktops or not vnc_ready():
        raise RuntimeError('BROWSER_DESKTOP_UNAVAILABLE')
    restarted = False
    if not owned('bridge') or not web_ready():
        sys.path.insert(0, str(WEBSOCKIFY))
        if not WEB.joinpath('vnc.html').is_file() or importlib.util.find_spec('websockify') is None:
            raise RuntimeError('Existing noVNC files are unavailable; browser left untouched.')
        terminate(owned('bridge'))
        if port_open(WEB_PORT):
            raise RuntimeError(f'Port {WEB_PORT} is still occupied. Browser left untouched.')
        env = dict(os.environ)
        env['PYTHONPATH'] = str(WEBSOCKIFY) + (os.pathsep + env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
        with STATE.joinpath('bridge.log').open('ab', buffering=0) as log:
            child = subprocess.Popen([sys.executable, '-m', 'websockify', '--web', str(WEB), f'127.0.0.1:{WEB_PORT}', f'127.0.0.1:{VNC_PORT}'], stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env, start_new_session=True)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if owned('bridge') and web_ready():
                break
            if child.poll() is not None:
                raise RuntimeError('noVNC bridge exited; inspect bridge.log. Browser left untouched.')
            time.sleep(.25)
        else:
            raise RuntimeError('noVNC bridge is not ready. Browser left untouched.')
        restarted = True
    if not all(same_process(pid, p) for pid, p in browsers.items()) or not all(same_process(pid, p) for pid, p in desktops.items()):
        raise RuntimeError('Original browser or desktop disappeared during reconnect; neither was relaunched.')
    return {'chrome': list(browsers), 'desktop': list(desktops),
            'bridge': list(owned('bridge')), 'browser_preserved': True,
            'bridge_restarted': restarted, 'vnc_ready': vnc_ready(), 'web_ready': web_ready()}


def status():
    return dict(chrome=list(owned('chrome')), desktop=list(owned('desktop')),
                bridge=list(owned('bridge')), vnc_listening=port_open(VNC_PORT),
                web_ready=web_ready(), display=DISPLAY, profile=str(PROFILE),
                profiles=public_profiles(), management='root', runtime_user=SERVICE_USER)


def same_process(pid, p):
    current = processes().get(pid)
    return current is not None and current['born'] == p['born']


def terminate(roots):
    all_p = processes()
    targets = {pid: p for pid, p in roots.items() if same_process(pid, p)}
    while True:
        children = {pid: p for pid, p in all_p.items() if p['parent'] in targets and pid not in targets}
        if not children:
            break
        targets.update(children)
    # Give the browser parent time to flush its profile before forcing leftovers.
    for pid, p in roots.items():
        if same_process(pid, p):
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and any(same_process(pid, p) for pid, p in targets.items()):
        time.sleep(.2)
    for pid, p in targets.items():
        if same_process(pid, p):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and any(same_process(pid, p) for pid, p in targets.items()):
        time.sleep(.1)
    remaining = [pid for pid, p in targets.items() if same_process(pid, p)]
    if remaining:
        raise RuntimeError('Processes did not exit: ' + str(remaining))


def current_profile_directory():
    path = PROFILE / 'Local State'
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding='utf-8')).get('profile', {}).get('last_used')


def chrome_arguments(profile_directory, initial_url=None):
    # Keep cookies, but avoid restoring every old window on this 2 GB VPS.
    # A manual launch should match Chrome's new-tab button. Login supplies its
    # validated authorization URL before the browser's first window is created.
    first_page = authorization_url(initial_url) if initial_url is not None else 'chrome://newtab/'
    return [str(CHROME), '--user-data-dir=' + str(PROFILE),
            '--profile-directory=' + profile_directory, '--no-first-run',
            '--no-default-browser-check', '--disable-dev-shm-usage',
            '--disable-background-mode', '--disk-cache-size=67108864',
            '--media-cache-size=33554432',
            '--password-store=basic', '--window-size=1440,900',
            '--window-position=0,0', first_page]


def start(profile_key, initial_url=None):
    selected = find_profile(profile_key)
    profile_directory = selected['directory']
    # Checked under manager.lock: never open another profile or window.
    if owned('chrome'):
        raise RuntimeError('BROWSER_ALREADY_RUNNING')
    if not CHROME.is_file() or not WEB.joinpath('vnc.html').is_file():
        raise RuntimeError('Existing Chrome or noVNC installation is missing; nothing was installed.')
    if not (profile_path(profile_directory) / 'Preferences').is_file():
        raise RuntimeError('The saved browser profile is missing; refusing to create an empty replacement.')
    sys.path.insert(0, str(WEBSOCKIFY))
    if importlib.util.find_spec('websockify') is None:
        raise RuntimeError('Existing python3 websockify module is missing.')
    created = {}
    try:
        specs = [
            ('desktop', [ENV['xvnc'], DISPLAY, '-geometry', '1440x900', '-depth', '24', '-localhost', 'yes', '-SecurityTypes', 'None', '-rfbport', str(VNC_PORT)], VNC_PORT),
            ('bridge', [sys.executable, '-m', 'websockify', '--web', str(WEB), f'127.0.0.1:{WEB_PORT}', f'127.0.0.1:{VNC_PORT}'], WEB_PORT),
            ('chrome', chrome_arguments(profile_directory, initial_url), None),
        ]
        for kind, args, port in specs:
            if owned(kind):
                if kind == 'chrome':
                    raise RuntimeError('BROWSER_ALREADY_RUNNING')
                continue
            if port and port_open(port):
                raise RuntimeError(f'Port {port} belongs to another process; refusing to take it over.')
            env = dict(os.environ, DISPLAY=DISPLAY)
            if kind == 'bridge':
                env['PYTHONPATH'] = str(WEBSOCKIFY) + (os.pathsep + env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
            with STATE.joinpath(kind + '.log').open('ab', buffering=0) as log:
                child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env, start_new_session=True)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                running = owned(kind)
                if child.pid in running:
                    created[child.pid] = running[child.pid]
                ready = bool(running) and (port is None or (web_ready() if kind == 'bridge' else port_open(port)))
                if ready:
                    break
                if child.poll() is not None:
                    raise RuntimeError(f'{kind} exited; inspect {STATE / (kind + ".log")}')
                time.sleep(.25)
            else:
                raise RuntimeError(f'{kind} did not become ready; inspect {STATE / (kind + ".log")}')
        result = status()
        if not all((result['chrome'], result['desktop'], result['bridge'], result['vnc_listening'], result['web_ready'])):
            raise RuntimeError('Remote browser did not pass readiness checks.')
        result['selected_profile'] = selected
        return result
    except Exception:
        if created:
            terminate(created)
        raise


def stop():
    for kind in ('chrome', 'bridge', 'desktop'):
        terminate(owned(kind))
    result = status()
    if any(result[k] for k in ('chrome', 'bridge', 'desktop')):
        raise RuntimeError('Some managed processes are still running.')
    return result


def authorization_url(value):
    if not isinstance(value, str) or len(value) > 8192 or any(ord(c) < 33 or ord(c) == 127 for c in value):
        raise ValueError('INVALID_AUTH_URL')
    url = urlsplit(value)
    allowed_path = ('/cai/oauth/authorize', '/cai/oauth/authorize/') if url.hostname == 'claude.com' else ('/oauth/authorize', '/oauth/authorize/')
    if url.scheme != 'https' or url.hostname not in ('claude.ai', 'console.anthropic.com', 'platform.claude.com', 'claude.com') or url.username or url.password or url.port not in (None, 443) or url.path not in allowed_path:
        raise ValueError('INVALID_AUTH_URL')
    return value


def session(profile_key):
    """Own one temporary login display; EOF/deadline closes only created processes."""
    before = {kind: owned(kind) for kind in ('chrome', 'bridge', 'desktop')}
    if before['chrome']:
        raise RuntimeError('BROWSER_BUSY')
    created = {}
    def emit(value):
        print(json.dumps(value, separators=(',', ':')), flush=True)
    try:
        selected = find_profile(profile_key)
        if not selected['available']:
            raise RuntimeError('The saved browser profile is missing; refusing to create an empty replacement.')
        # This acknowledges the reserved manager, not a visible browser. Wait
        # for the native URL so there is no permanent blank startup tab.
        emit({'ready': True, 'profileKey': profile_key, 'viewerReady': False})
        started, opened = False, set()
        reader = os.fdopen(os.dup(0), 'rb', buffering=0)
        deadline, lease = time.monotonic() + 900, time.monotonic() + 45
        while time.monotonic() < min(deadline, lease):
            if not select.select([reader], [], [], .5)[0]:
                continue
            line = reader.readline(16385)
            if not line or len(line) > 16384:
                break
            request = json.loads(line)
            action = request.get('action')
            if action == 'close':
                break
            if action == 'heartbeat':
                lease = time.monotonic() + 45
            elif action == 'open':
                url = authorization_url(request.get('url'))
                if not started:
                    start(profile_key, url)
                    created = {kind: {pid: p for pid, p in owned(kind).items() if pid not in before[kind]} for kind in before}
                    started = True
                elif url not in opened:
                    if not owned('chrome'):
                        raise RuntimeError('BROWSER_CLOSED')
                    args = chrome_arguments(selected['directory'], url)
                    result = subprocess.run(args, env=dict(os.environ, DISPLAY=DISPLAY), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                    if result.returncode:
                        raise RuntimeError('BROWSER_OPEN_FAILED')
                opened.add(url)
                # Startup can consume most of a lease while heartbeats queue.
                lease = time.monotonic() + 45
                emit({'opened': True})
            else:
                raise ValueError('INVALID_REQUEST')
    finally:
        # Include partially started processes when readiness failed.
        for kind in before:
            created.setdefault(kind, {}).update({pid: p for pid, p in owned(kind).items() if pid not in before[kind]})
        confirmed = True
        for kind in ('chrome', 'bridge', 'desktop'):
            try:
                terminate(created.get(kind, {}))
            except Exception:
                confirmed = False
        emit({'cleanup': 'confirmed' if confirmed else 'unconfirmed'})


if __name__ == '__main__':
    try:
        action = sys.argv[1]
        if action not in ('start', 'stop', 'status', 'profiles', 'create', 'rename', 'delete', 'reconnect', 'session'):
            raise ValueError('Unknown browser-manager action')
        options = json.loads(base64.b64decode(sys.argv[2]).decode('utf-8')) if len(sys.argv) > 2 else {}
        enter_browser_identity()
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        with STATE.joinpath('manager.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('BROWSER_BUSY') from None
            if action == 'session':
                session(options.get('key'))
                sys.exit(0)
            elif action == 'start':
                result = start(options.get('key'))
            elif action == 'reconnect':
                result = reconnect()
            elif action == 'stop':
                result = stop()
            elif action == 'status':
                result = status()
            elif action == 'profiles':
                result = {'profiles': public_profiles()}
            elif action == 'create':
                result = create_profile(options.get('label'))
            elif action == 'rename':
                result = rename_profile(options.get('key'), options.get('label'))
            else:
                result = delete_profile(options.get('key'), options.get('confirm_key'))
        print(json.dumps(dict(ok=True, action=action, **result)))
    except Exception as exc:
        print(json.dumps(dict(ok=False, error=str(exc))))
        sys.exit(1)
