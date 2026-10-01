"""Current official CLI artifacts for explicit, side-by-side shared installation.

Official native installers run only after confirmation in an empty staging home.
No existing user home, login profile, npm installation, or package manager is modified.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import ssl
import stat
import subprocess
import tarfile
import tempfile
import time
from urllib.parse import urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPRedirectHandler, Request

INSTALL_ROOT = '/opt/agent-workbench/native'
RELEASES = {}
RELEASE_USER_AGENT = 'AgentWorkbench/0.1 (native CLI management)'


class InstallError(Exception):
    def __init__(self, code, detected=None, release_issue=None):
        super().__init__(code)
        self.detected = detected or []
        self.release_issue = release_issue


def require(ok, code='CLI_INSTALL_CONFLICT'):
    if not ok:
        raise InstallError(code)


def release_request(url, method='GET'):
    # Identify our client consistently, including HEAD and redirected requests.
    # Official installer CDNs can reject the default Python-urllib identity.
    return Request(url, method=method, headers={'User-Agent': RELEASE_USER_AGENT})


def release_failure(error, url, stage):
    issue = dict(stage=stage, source=urlsplit(url).hostname)
    reason = error.reason if isinstance(error, URLError) else error
    if isinstance(error, HTTPError):
        code = 'CLI_RELEASE_HTTP'
        issue['httpStatus'] = error.code
    elif isinstance(reason, (TimeoutError, socket.timeout)):
        code = 'CLI_RELEASE_TIMEOUT'
    elif isinstance(reason, ssl.SSLError):
        code = 'CLI_RELEASE_TLS'
    else:
        code = 'CLI_RELEASE_NETWORK'
    return InstallError(code, release_issue=issue)


def require_release(ok, url, stage):
    if not ok:
        raise InstallError('CLI_RELEASE_INVALID', release_issue=dict(stage=stage, source=urlsplit(url).hostname))


def release_bytes(url, maximum=2097152, stage='release'):
    try:
        with build_opener(SecureRedirect()).open(release_request(url), timeout=20) as response:
            value = response.read(maximum + 1)
        require_release(len(value) <= maximum, url, stage)
        return value
    except OSError as error:
        raise release_failure(error, url, stage) from None


def release_json(url, stage='manifest'):
    try:
        value = json.loads(release_bytes(url, stage=stage))
    except (ValueError, TypeError):
        require_release(False, url, stage)
    require_release(isinstance(value, dict), url, stage)
    return value


def artifact(provider):
    require(provider in ('codex', 'claude'), 'INVALID_REQUEST')
    machine = platform.machine()
    require(machine in ('x86_64', 'aarch64'), 'CLI_PLATFORM_UNSUPPORTED')
    if provider in RELEASES:
        return dict(RELEASES[provider])
    if provider == 'codex':
        source = 'https://releases.openai.com/codex/channels/latest'
        metadata = release_json(source, 'release')
        version = str(metadata.get('tag_name', '')).removeprefix('rust-v')
        variant = machine
        member = 'codex-' + machine + '-unknown-linux-musl'
        require_release(re.fullmatch(r'\d+\.\d+\.\d+', version), source, 'release')
        url = 'https://releases.openai.com/codex/releases/' + version + '/' + member + '.tar.gz'
        require_release(isinstance(metadata.get('assets'), list), source, 'release')
        asset = next((a for a in metadata['assets'] if isinstance(a, dict) and a.get('name') == member + '.tar.gz' and a.get('browser_download_url') == url), {})
        checksum = str(asset.get('digest', '')).removeprefix('sha256:')
        require_release(re.fullmatch(r'[a-f0-9]{64}', checksum), source, 'release')
        try:
            with build_opener(SecureRedirect()).open(release_request(url, 'HEAD'), timeout=20) as response:
                size = int(response.headers.get('Content-Length', '0'))
        except OSError as error:
            raise release_failure(error, url, 'asset') from None
        except ValueError:
            require_release(False, url, 'asset')
        require_release(0 < size <= 500000000, url, 'asset')
    else:
        source = 'https://downloads.claude.ai/claude-code-releases/latest'
        try:
            version = release_bytes(source, 128).decode('ascii').strip()
        except UnicodeError:
            require_release(False, source, 'release')
        require_release(re.fullmatch(r'\d+\.\d+\.\d+', version), source, 'release')
        libc = platform.libc_ver()[0]
        musl = bool(list(Path('/lib').glob('ld-musl-*.so.1')))
        require(libc == 'glibc' or musl, 'CLI_PLATFORM_UNSUPPORTED')
        variant = 'linux-' + ('x64' if machine == 'x86_64' else 'arm64') + ('-musl' if musl else '')
        member = ''
        source = 'https://downloads.claude.ai/claude-code-releases/' + version + '/manifest.json'
        metadata = release_json(source)
        require_release(metadata.get('version') == version and isinstance(metadata.get('platforms'), dict), source, 'manifest')
        asset = metadata.get('platforms', {}).get(variant, {})
        require_release(isinstance(asset, dict) and asset.get('binary') == 'claude', source, 'manifest')
        url = 'https://downloads.claude.ai/claude-code-releases/' + version + '/' + variant + '/claude'
        checksum, size = asset.get('checksum'), asset.get('size')
    require_release(isinstance(checksum, str) and re.fullmatch(r'[a-f0-9]{64}', checksum) and type(size) is int and 0 < size <= 500000000, source, 'release' if provider == 'codex' else 'manifest')
    item = dict(provider=provider, version=version, url=url, sha256=checksum, size=size, member=member,
                target=INSTALL_ROOT + '/' + provider + '-' + version + '-' + variant + '/' + provider)
    installer_url = 'https://chatgpt.com/codex/install.sh' if provider == 'codex' else 'https://claude.ai/install.sh'
    installer = release_bytes(installer_url, stage='installer')
    require_release(installer.startswith(b'#!/'), installer_url, 'installer')
    item.update(installerUrl=installer_url, installerSha256=hashlib.sha256(installer).hexdigest())
    RELEASES[provider] = item
    return dict(item)


def clean_environment():
    # Version probes must not inspect root's login/configuration or mutate it.
    return {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/dev/null',
            'CODEX_HOME': '/dev/null', 'CLAUDE_CONFIG_DIR': '/dev/null', 'DISABLE_AUTOUPDATER': '1'}


def version_of(path, provider):
    result = subprocess.run([path, '--version'], capture_output=True, timeout=10, env=clean_environment(), check=False)
    require(result.returncode == 0 and len(result.stdout) < 4096, 'CLI_VERSION_' + provider.upper())
    match = re.search(rb'(?<![\d.])(\d+\.\d+\.\d+)(?![\d.])', result.stdout)
    return match[1].decode() if match else None


def candidate_paths(provider):
    paths = [str(Path(directory) / provider) for directory in ('/usr/local/bin', '/usr/bin', '/bin')]
    paths = [str(p) for p in sorted(Path(INSTALL_ROOT).glob(provider + '-*/' + provider), reverse=True)] + paths
    # Only known executable locations; never scan private authentication files.
    paths += ['/root/.local/bin/' + provider, '/root/.npm-global/bin/' + provider,
              '/root/.bun/bin/' + provider, '/opt/node/bin/' + provider, '/opt/' + provider + '/bin/' + provider]
    if provider == 'claude':
        paths.append('/opt/claude-code/bin/claude')
    nvm = Path('/root/.nvm/versions/node')
    if nvm.is_dir():
        paths += [str(p / 'bin' / provider) for p in sorted(nvm.iterdir())[:16] if re.fullmatch(r'v\d+\.\d+\.\d+', p.name)]
    return list(dict.fromkeys(paths))


def discover(provider):
    from broker import trusted_path
    detected = []
    for path in candidate_paths(provider):
        if not os.path.lexists(path):
            continue
        row = dict(provider=provider, path=path, status='untrusted')
        detected.append(row)
        try:
            resolved = trusted_path(path, owners={0}, final_uid=0, kind='executable', allow_symlinks=True)
            row['path'] = resolved
            if not all(p.stat().st_mode & 0o001 for p in Path(resolved).parents) or Path(resolved).stat().st_mode & 0o005 != 0o005:
                row['status'] = 'private'
                continue
            row['status'] = 'unverified'
            row['version'] = version_of(resolved, provider)
            row['status'] = 'ready' if row['version'] and re.fullmatch(r'\d+\.\d+\.\d+', row['version']) else 'version-mismatch'
            if row['status'] == 'ready':
                return resolved, detected
        except (OSError, RuntimeError, InstallError, subprocess.SubprocessError):
            row['status'] = 'unverified' if row['status'] != 'untrusted' else 'untrusted'
    code = 'CLI_MISSING_' if not detected else 'CLI_UNTRUSTED_' if any(r['status'] == 'untrusted' for r in detected) else 'CLI_NOT_SHARED_' if any(r['status'] == 'private' for r in detected) else 'CLI_VERSION_'
    raise InstallError(code + provider.upper(), detected)


def file_digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else _stream_digest(stream)


def _stream_digest(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1048576), b''):
        digest.update(chunk)
    return digest.hexdigest()


def target_snapshot(item, trusted):
    target = trusted(item['target'], missing=True)
    parent = target.parent
    if parent.exists():
        require(set(p.name for p in parent.iterdir()).issubset({target.name, 'source.json', 'program'}))
    snapshot = []
    for path in (target, parent / 'source.json'):
        trusted(path, missing=True)
        if path.exists():
            info = path.stat()
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= (500000000 if path == target else 1048576))
            snapshot.append([str(path), file_digest(path)])
        else:
            snapshot.append([str(path), None])
    return snapshot


class SecureRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        require(urlsplit(url).scheme == 'https', 'CLI_DOWNLOAD_FAILED')
        return super().redirect_request(request, response, code, message, headers, url)


def download(item, destination):
    require(urlsplit(item['url']).scheme == 'https', 'CLI_DOWNLOAD_FAILED')
    digest, size, deadline = hashlib.sha256(), 0, time.monotonic() + 420
    try:
        with build_opener(SecureRedirect()).open(release_request(item['url']), timeout=30) as response, open(destination, 'xb') as target:
            while True:
                require(time.monotonic() < deadline, 'CLI_DOWNLOAD_FAILED')
                chunk = response.read(1048576)
                if not chunk:
                    break
                size += len(chunk)
                require(size <= item['size'], 'CLI_CHECKSUM_MISMATCH')
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
    except (OSError, ValueError):
        raise InstallError('CLI_DOWNLOAD_FAILED') from None
    require(size == item['size'] and digest.hexdigest() == item['sha256'], 'CLI_CHECKSUM_MISMATCH')


def program_manifest(root):
    root = Path(root)
    entries = []
    for path in sorted(root.rglob('*')):
        info = path.lstat()
        require(info.st_uid == 0 and (stat.S_ISLNK(info.st_mode) or not info.st_mode & 0o022))
        relative = str(path.relative_to(root))
        if stat.S_ISLNK(info.st_mode):
            link = os.readlink(path)
            require(not os.path.isabs(link) and path.resolve().is_relative_to(root.resolve()))
            entries.append([relative, 'link', link])
        elif stat.S_ISREG(info.st_mode):
            require(info.st_nlink == 1)
            entries.append([relative, 'file', stat.S_IMODE(info.st_mode), file_digest(path)])
        else:
            require(stat.S_ISDIR(info.st_mode))
            entries.append([relative, 'directory'])
    require(len(entries) < 8192)
    return entries


def install(item, trusted, ensure_directory, write_new):
    require(item == artifact(item['provider']), 'CLI_INSTALL_CONFLICT')
    target = Path(item['target'])
    ensure_directory(str(target.parent.parent))
    trusted(target.parent, missing=True)
    require(not target.parent.exists() or not any(target.parent.iterdir()), 'CLI_ALREADY_INSTALLED')
    installer = release_bytes(item['installerUrl'], 2097152, 'installer')
    require(hashlib.sha256(installer).hexdigest() == item['installerSha256'], 'PLAN_CHANGED')
    with tempfile.TemporaryDirectory(prefix='.native-stage-', dir=target.parent.parent) as temporary:
        stage = Path(temporary)
        home = stage / 'home'
        home.mkdir(mode=0o700)
        script = stage / 'official-install.sh'
        script.write_bytes(installer)
        env = dict(PATH='/usr/local/bin:/usr/bin:/bin', LANG='C.UTF-8', HOME=str(home),
                   CODEX_HOME=str(home / '.codex'), CODEX_INSTALL_DIR=str(home / '.local/bin'),
                   CODEX_INSTALLER_USE_RELEASES_OPENAI_COM='1', CODEX_NON_INTERACTIVE='1',
                   CLAUDE_CONFIG_DIR=str(home / '.claude'), DISABLE_AUTOUPDATER='1',
                   DISABLE_TELEMETRY='1', NO_COLOR='1')
        args = ['/bin/bash', str(script)] + (['--release', item['version']] if item['provider'] == 'codex' else [item['version']])
        # Installer output may be large. It stays in this temporary home, never in model context.
        with (stage / 'installer-output').open('wb') as output:
            child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=output, stderr=output, env=env, cwd=home, start_new_session=True)
            try:
                code = child.wait(timeout=600)
            except subprocess.TimeoutExpired:
                import signal
                os.killpg(child.pid, signal.SIGTERM)
                time.sleep(.5)
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
                raise InstallError('CLI_INSTALLER_TIMEOUT') from None
        require(code == 0, 'CLI_INSTALLER_FAILED')
        visible = home / '.local/bin' / item['provider']
        require(visible.exists() and visible.resolve().is_relative_to(home.resolve()), 'CLI_INSTALL_CONFLICT')
        executable = visible.resolve()
        require(version_of(str(executable), item['provider']) == item['version'], 'CLI_VERSION_' + item['provider'].upper())
        finished = stage / 'finished'
        finished.mkdir(mode=0o755)
        program = finished / 'program'
        if item['provider'] == 'codex':
            releases = home / '.codex/packages/standalone/releases'
            require(executable.is_relative_to(releases.resolve()), 'CLI_INSTALL_CONFLICT')
            release_name = executable.relative_to(releases).parts[0]
            source = releases / release_name
            relative = str(executable.relative_to(source))
            shutil.copytree(source, program, symlinks=True)
        else:
            program.mkdir(mode=0o755)
            relative = 'claude'
            shutil.copy2(executable, program / relative)
            require(file_digest(program / relative) == item['sha256'], 'CLI_CHECKSUM_MISMATCH')
        program.chmod(0o755)
        manifest = program_manifest(program)
        import shlex
        launcher = finished / item['provider']
        launcher.write_text('#!/bin/sh\nexec ' + shlex.quote(str(target.parent / 'program' / relative)) + ' "$@"\n', encoding='utf-8')
        launcher.chmod(0o755)
        receipt = dict(provider=item['provider'], version=item['version'], method='official-native-installer',
                       installerUrl=item['installerUrl'], installerSha256=item['installerSha256'],
                       binarySha256=file_digest(launcher), programManifest=manifest)
        (finished / 'source.json').write_text(json.dumps(receipt, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
        (finished / 'source.json').chmod(0o644)
        if target.parent.exists():
            require(not any(target.parent.iterdir()))
            target.parent.rmdir()
        os.rename(finished, target.parent)
    require(version_of(str(target), item['provider']) == item['version'], 'CLI_VERSION_' + item['provider'].upper())
    return str(target)
