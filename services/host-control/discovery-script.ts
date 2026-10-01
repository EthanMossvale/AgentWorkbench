/** Executed only after the user requests SSH discovery. No profile sourcing, recursive scan or remote writes. */
export const DISCOVERY_PYTHON = String.raw`
import os, sys, json, pwd, stat, re, base64, hashlib, socket, subprocess, time, select

LIMIT = 262144
START = time.monotonic()
EUID = os.geteuid()
WARNINGS = []
USERNAME = re.compile(r'^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$')
CODEX_FIELDS = ('model', 'model_provider', 'model_reasoning_effort', 'approval_policy', 'sandbox_mode', 'cli_auth_credentials_store', 'features.deferred_executor', 'memories.generate_memories', 'memories.use_memories')
CLAUDE_FIELDS = ('model', 'effortLevel', 'permissions.defaultMode')

def text(value, maximum=256):
    if not isinstance(value, str) or len(value) > maximum or re.search(r'[\x00-\x1f\x7f]', value): return None
    if re.search(r'-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]|sk-[A-Za-z0-9_-]{12,}', value, re.I): return None
    return value

def read_metadata(path, owner=None, scope=None):
    # Only named metadata files, never authentication files, databases or user sessions.
    if scope and os.path.commonpath((os.path.realpath(path), os.path.realpath(scope))) != os.path.realpath(scope): raise ValueError('outside scope')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > LIMIT or (owner is not None and info.st_uid not in (0, owner)): raise ValueError('unsafe metadata')
        with os.fdopen(fd, 'r', encoding='utf-8') as stream:
            fd = -1
            content = stream.read(LIMIT + 1)
            if len(content) > LIMIT: raise ValueError('metadata limit')
            return content
    finally:
        if fd >= 0: os.close(fd)

def metadata_json(path, owner=None, scope=None):
    return json.loads(read_metadata(path, owner, scope))

def empty_runtime():
    return {'installed': 'unknown', 'config': {'status': 'unknown', 'values': {}}, 'account': {'status': 'unknown'}, 'warnings': []}

def toml_statements(raw):
    # Split complete statements without interpreting their values. Arrays, inline tables,
    # comments and multiline strings must never expose embedded lines as root settings.
    buffer = []; quote = None; depth = 0; index = 0
    while index < len(raw):
        character = raw[index]
        if quote:
            if raw.startswith(quote, index):
                buffer.append(quote); index += len(quote); quote = None; continue
            if quote.startswith('"') and character == '\\' and index + 1 < len(raw):
                buffer.append(raw[index:index+2]); index += 2; continue
            buffer.append(character); index += 1; continue
        if character == '#':
            while index < len(raw) and raw[index] not in '\r\n': index += 1
            continue
        if character in ('"', "'"):
            quote = character * 3 if raw.startswith(character * 3, index) else character
            buffer.append(quote); index += len(quote); continue
        if character in '[{': depth += 1
        elif character in ']}': depth -= 1
        if depth < 0: return
        if character in '\r\n' and depth == 0:
            statement = ''.join(buffer).strip(); buffer = []
            if statement: yield statement
        else: buffer.append(character)
        index += 1
    if quote is None and depth == 0:
        statement = ''.join(buffer).strip()
        if statement: yield statement

def safe_config(home, runtime, uid):
    relative = '.codex/config.toml' if runtime == 'codex' else '.claude/settings.json'
    path = os.path.join(home, relative)
    result = {'status': 'unknown', 'source': path, 'values': {}}
    try: raw = read_metadata(path, uid, home)
    except FileNotFoundError:
        result['status'] = 'absent'; return result
    except (OSError, ValueError): return result
    allowed = CODEX_FIELDS if runtime == 'codex' else CLAUDE_FIELDS
    candidates = {}
    if runtime == 'codex':
        # Parse only permitted scalar lines. No imports, includes, interpolation or external commands.
        section = ''
        for line in toml_statements(raw):
            if line.lstrip().startswith('['):
                # Unsupported/quoted/array tables are opaque, never the previous scope.
                section = None
                if re.fullmatch(r'\s*\[(features|memories)\]\s*', line): section = line.strip()[1:-1]
                continue
            if section is None: continue
            match = re.fullmatch(r'\s*([A-Za-z0-9_]+)\s*=\s*(true|false|[0-9]+|"[^"\r\n]*"|\x27[^\x27\r\n]*\x27)\s*(?:#.*)?', line)
            if not match: continue
            key = (section + '.' if section else '') + match.group(1)
            if key not in allowed: continue
            value = match.group(2)
            if value in ('true', 'false'): candidates[key] = value == 'true'
            elif value[0] in ('"', "'"): candidates[key] = value[1:-1]
            else: candidates[key] = int(value)
    else:
        try:
            value = json.loads(raw)
            if isinstance(value, dict):
                for key in allowed:
                    current = value
                    for part in key.split('.'):
                        if not isinstance(current, dict): current = None; break
                        current = current.get(part)
                    candidates[key] = current
        except ValueError: return result
    for key, value in candidates.items():
        if isinstance(value, bool) or (isinstance(value, int) and abs(value) <= 1000000): result['values'][key] = value
        elif text(value) is not None: result['values'][key] = value
    result['status'] = 'known'
    return result

def public_keys(account):
    path = os.path.join(account.pw_dir, '.ssh', 'authorized_keys')
    result = {'authorizedKeys': [], 'authorizationStatus': 'unknown', 'privateKeyStatus': 'not-inspected'}
    try: raw = read_metadata(path, account.pw_uid, account.pw_dir)
    except FileNotFoundError:
        result['authorizationStatus'] = 'absent'; return result
    except (OSError, ValueError): return result
    result['authorizationStatus'] = 'absent'
    for line in raw.splitlines()[:256]:
        # Quoted authorization options are skipped; only the public key blob is fingerprinted.
        match = re.search(r'(?:^|\s)(ssh-(?:ed25519|rsa|dss)|ecdsa-sha2-[A-Za-z0-9@._-]+|sk-[A-Za-z0-9@._-]+)\s+([A-Za-z0-9+/=]+)(?:\s+(.*))?$', line)
        if not match or line.lstrip().startswith('#'): continue
        try:
            blob = base64.b64decode(match.group(2), validate=True)
            size = int.from_bytes(blob[:4], 'big')
            if len(blob) < 8 or size > 128 or blob[4:4+size].decode('ascii') != match.group(1): continue
        except (ValueError, UnicodeError): continue
        key = {'fingerprint': 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('='), 'algorithm': match.group(1), 'source': path}
        comment = text(match.group(3) or '')
        if comment: key['comment'] = comment
        result['authorizedKeys'].append(key)
    if result['authorizedKeys']: result['authorizationStatus'] = 'present'
    return result

def run_readonly(args, home, timeout=3):
    # This function is called only in a child already switched to the workspace UID.
    env = {'HOME': home, 'USER': pwd.getpwuid(os.geteuid()).pw_name, 'LOGNAME': pwd.getpwuid(os.geteuid()).pw_name, 'PATH': os.path.join(home, '.local/bin') + ':/usr/local/bin:/usr/bin:/bin', 'LC_ALL': 'C', 'LANG': 'C', 'DISABLE_AUTOUPDATER': '1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}
    process = subprocess.Popen(args, cwd=home, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output = bytearray(); deadline = time.monotonic() + timeout
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0: raise TimeoutError()
            ready, _, _ = select.select([process.stdout], [], [], remaining)
            if not ready: raise TimeoutError()
            chunk = os.read(process.stdout.fileno(), 4096)
            if not chunk: break
            output.extend(chunk)
            if len(output) > 16384: raise ValueError('output limit')
        code = process.wait(timeout=max(.01, deadline-time.monotonic()))
        return code, output.decode('utf-8', errors='replace')
    except (OSError, ValueError, TimeoutError, subprocess.TimeoutExpired):
        return None, ''
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stdout.close()

def runtime_path(home, name):
    for directory in (os.path.join(home, '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin'):
        candidate = os.path.join(directory, name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK): return candidate
    return None

def broker_catalog():
    # The legacy broker's list method only returns its account metadata snapshot.
    # Never request tokens, refreshes, limits, login, selection or usage updates.
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(2)
        connection.connect('/run/codex-device-auth/broker.sock')
        connection.sendall(b'{"method":"list"}\n')
        response = bytearray()
        while b'\n' not in response and len(response) <= LIMIT:
            chunk = connection.recv(4096)
            if not chunk: break
            response.extend(chunk)
        if len(response) > LIMIT: return None
        envelope = json.loads(response.decode('utf-8'))
        catalog = envelope.get('result') if isinstance(envelope, dict) else None
        if not isinstance(catalog, dict) or not isinstance(catalog.get('accounts'), list): return None
        selected = text(catalog.get('selected'))
        entries = []
        for row in catalog['accounts'][:128]:
            if not isinstance(row, dict) or not text(row.get('id')): continue
            entry = {'id': row['id'], 'selected': row['id'] == selected}
            for key in ('email', 'name', 'plan'):
                if text(row.get(key)) is not None: entry[key] = row[key]
            entries.append(entry)
        result = {'status': 'configured' if any(row['selected'] for row in entries) else 'unknown', 'source': 'codex-device-broker:list', 'catalog': entries}
        if selected: result['selectedId'] = selected
        chosen = next((row for row in entries if row['selected']), None)
        if chosen: result['details'] = {key: chosen[key] for key in ('email', 'name', 'plan') if key in chosen}
        return result

def native_runtime(account, runtime, legacy):
    home = account.pw_dir; result = empty_runtime()
    result['config'] = safe_config(home, runtime, account.pw_uid)
    executable = runtime_path(home, runtime)
    result['installed'] = 'yes' if executable else 'no'
    if executable:
        result['path'] = executable
        code, output = run_readonly([executable, '--version'], home, 2)
        version = output.strip()
        if code == 0 and text(version, 128): result['version'] = version
        else: result['warnings'].append('CLI version could not be verified.')
    if runtime == 'codex' and legacy:
        result['account'] = {'status': 'unknown', 'source': 'codex-device-broker:list'}
        try:
            catalog = broker_catalog()
            if catalog: result['account'] = catalog
            else: result['warnings'].append('Legacy account catalog did not return supported metadata; account binding is unknown.')
        except FileNotFoundError: result['warnings'].append('Legacy account catalog socket is missing; account binding is unknown.')
        except PermissionError: result['warnings'].append('Workspace identity cannot access the legacy account catalog; account binding is unknown.')
        except TimeoutError: result['warnings'].append('Legacy account catalog timed out; account binding is unknown.')
        except ValueError: result['warnings'].append('Legacy account catalog returned invalid metadata; account binding is unknown.')
        except OSError: result['warnings'].append('Legacy account catalog is unavailable; account binding is unknown.')
        # A broker binding is configured metadata, not proof a token is currently valid.
    if not executable: return result
    if runtime == 'codex':
        code, output = run_readonly([executable, 'login', 'status'], home)
        status = {'status': 'unknown', 'source': 'codex login status'}
        if code == 0 and re.search(r'Logged in using (ChatGPT|an API key)', output, re.I):
            status = {'status': 'authenticated', 'source': 'codex login status', 'details': {'authMethod': 'ChatGPT' if 'chatgpt' in output.lower() else 'api-key'}}
        elif re.search(r'Not logged in', output, re.I): status = {'status': 'unauthenticated', 'source': 'codex login status'}
        if legacy: result['nativeAccount'] = status
        else: result['account'] = status
        if status['status'] == 'unknown': result['warnings'].append('Native Codex login status was unavailable or unsupported.')
    else:
        code, output = run_readonly([executable, 'auth', 'status', '--json'], home)
        try: status = json.loads(output)
        except ValueError: status = None
        if isinstance(status, dict) and isinstance(status.get('loggedIn'), bool):
            result['account'] = {'status': 'authenticated' if status['loggedIn'] else 'unauthenticated', 'source': 'claude auth status --json', 'details': {}}
            for source, target in (('email', 'email'), ('authMethod', 'authMethod'), ('subscriptionType', 'plan'), ('orgName', 'organization')):
                if text(status.get(source)) is not None: result['account']['details'][target] = status[source]
        else: result['warnings'].append('Native Claude account status was unavailable or unsupported.')
    return result

def account_runtimes(account, legacy):
    # Fork before dropping privileges; never execute a user-owned CLI as administrator.
    reader, writer = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(reader)
        try:
            os.setsid()
            if EUID == 0:
                os.initgroups(account.pw_name, account.pw_gid); os.setgid(account.pw_gid); os.setuid(account.pw_uid)
            os.environ.clear()
            result = {runtime: native_runtime(account, runtime, legacy) for runtime in ('codex', 'claude')}
            data = json.dumps(result, separators=(',', ':')).encode('utf-8')
            while data:
                written = os.write(writer, data); data = data[written:]
        except Exception: pass
        finally:
            os.close(writer); os._exit(0)
    os.close(writer); output = bytearray(); deadline = min(START + 40, time.monotonic() + 16)
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0: break
            ready, _, _ = select.select([reader], [], [], remaining)
            if not ready: break
            chunk = os.read(reader, 4096)
            if not chunk: break
            output.extend(chunk)
            if len(output) > LIMIT: break
        if len(output) <= LIMIT: return json.loads(output.decode('utf-8'))
    except (OSError, ValueError): pass
    finally:
        os.close(reader)
        try: os.killpg(child, 9)
        except ProcessLookupError: pass
        os.waitpid(child, 0)
    result = {runtime: empty_runtime() for runtime in ('codex', 'claude')}
    for item in result.values(): item['warnings'].append('Workspace runtime probe was unavailable or exceeded its time budget.')
    return result

all_accounts = pwd.getpwall() if EUID == 0 else [pwd.getpwuid(EUID)]
accounts = [row for row in all_accounts if USERNAME.fullmatch(row.pw_name) and (row.pw_uid == EUID or row.pw_uid == 0 or 1000 <= row.pw_uid < 65534)][:256]
by_name = {row.pw_name: row for row in accounts}
output = {'protocol': 2, 'effectiveUid': EUID, 'accounts': [{'username': row.pw_name, 'uid': row.pw_uid, 'home': row.pw_dir, 'shell': row.pw_shell} for row in accounts], 'registry': 'absent-or-inaccessible', 'publicKeyFingerprints': [], 'workspaces': [], 'warnings': WARNINGS}
try:
    mine = pwd.getpwuid(EUID)
    output['publicKeyFingerprints'] = [key['fingerprint'] for key in public_keys(mine)['authorizedKeys']]
except KeyError: pass

candidates = {}
legacy_registry = '/etc/codex-devices/allowed-users.json'
try:
    allowed = metadata_json(legacy_registry, 0)
    if isinstance(allowed, list):
        output['registry'] = 'recognized'
        for name in allowed[:128]:
            if not isinstance(name, str) or name not in by_name: continue
            account = by_name[name]
            if EUID != 0 and account.pw_uid != EUID: continue
            marker = os.path.join(account.pw_dir, '.codex-device', 'device.json')
            try: device = metadata_json(marker, account.pw_uid, account.pw_dir)
            except (OSError, ValueError): device = {}
            device_id = text(device.get('deviceId')) if isinstance(device, dict) else None
            warnings = []
            if device_id != name: warnings.append('Device marker is missing or conflicts with the allowed-user registry.')
            candidates[name] = {'id': name, 'name': name, 'username': name, 'uid': account.pw_uid, 'home': account.pw_dir, 'root': os.path.join(account.pw_dir, 'workspaces'), 'classification': 'known-device-workspace', 'sources': [legacy_registry] + ([marker] if device_id else []), 'confidence': 'high' if device_id == name else 'conflict', 'warnings': warnings}
except (OSError, ValueError): pass

registry = '/var/lib/agent-workbench/registry.json'
try:
    data = metadata_json(registry, 0)
    output['registry'] = 'present-unread' if output['registry'] != 'recognized' else 'recognized'
    rows = data.get('workspaces') if isinstance(data, dict) else None
    if isinstance(rows, list):
        output['registry'] = 'recognized'
        for row in rows[:128]:
            if not isinstance(row, dict): continue
            name = row.get('username'); account = by_name.get(name) if isinstance(name, str) else None
            if not account or (EUID != 0 and account.pw_uid != EUID): continue
            workspace_id = text(row.get('id'))
            root = text(row.get('root'), 4096)
            if not workspace_id or not root or not root.startswith('/'): continue
            entry = {'id': workspace_id, 'name': text(row.get('name')) or workspace_id, 'username': name, 'uid': account.pw_uid, 'home': account.pw_dir, 'root': root, 'classification': 'registered-workspace', 'sources': [registry], 'confidence': 'high', 'warnings': []}
            if name in candidates:
                candidates[name]['warnings'].append('Multiple workspace registries mention this user; mappings require review.')
                candidates[name]['confidence'] = 'conflict'; candidates[name]['sources'].append(registry)
            else: candidates[name] = entry
except (OSError, ValueError): pass

ssh_only_path = '/var/lib/agent-workbench-policy/ssh-only-members.json'
try:
    info = os.lstat(ssh_only_path)
    if info.st_uid != 0 or info.st_mode & 0o022 or not stat.S_ISREG(info.st_mode): raise ValueError('unsafe SSH-only registry')
    ssh_only = metadata_json(ssh_only_path, 0)
    if not isinstance(ssh_only, dict) or ssh_only.get('version') != 1 or not isinstance(ssh_only.get('members'), list): raise ValueError('invalid SSH-only registry')
    for row in ssh_only['members']:
        if not isinstance(row, dict): continue
        account = by_name.get(row.get('username'))
        if account and row.get('uid') == account.pw_uid and row.get('home') == account.pw_dir:
            candidates.pop(account.pw_name, None)
except FileNotFoundError: pass
except (OSError, ValueError):
    candidates = {}
    WARNINGS.append('SSH-only identity protection could not be verified; workspace discovery was withheld.')

for entry in list(candidates.values())[:32]:
    account = by_name[entry['username']]
    entry['ssh'] = public_keys(account)
    if time.monotonic() - START < 38: entry['runtimes'] = account_runtimes(account, entry['classification'] == 'known-device-workspace')
    else:
        entry['runtimes'] = {runtime: empty_runtime() for runtime in ('codex', 'claude')}
        entry['warnings'].append('Runtime inspection skipped because the discovery time budget was exhausted.')
    output['workspaces'].append(entry)
if len(candidates) > 32: WARNINGS.append('Only the first 32 recognized workspace users were inspected.')
print(json.dumps(output, ensure_ascii=True, separators=(',', ':')))
`;

// The fallback retains useful account evidence when Python is not installed. It never infers a workspace.
export const DISCOVERY_COMMAND = `LC_ALL=C; export LC_ALL
if command -v python3 >/dev/null 2>&1; then
python3 - <<'AGENT_WORKBENCH_READONLY_DISCOVERY'
${DISCOVERY_PYTHON}
AGENT_WORKBENCH_READONLY_DISCOVERY
else
uid=$(id -u) || exit 1
printf 'identity\\t%s\\n' "$uid"
if [ "$uid" = 0 ]; then
getent passwd | awk -F: '($3 >= 1000 && $3 < 65534) || $3 == 0 {printf "account\\t%s\\t%s\\t%s\\t%s\\n", $1, $3, $6, $7}' | head -n 256
else
getent passwd "$uid" | awk -F: '{printf "account\\t%s\\t%s\\t%s\\t%s\\n", $1, $3, $6, $7}'
fi
printf 'registry\\tabsent-or-inaccessible\\n'
fi`;
