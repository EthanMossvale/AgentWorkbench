"""Previewed lightweight browser bootstrap for RPM-based Linux x86_64."""
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import tarfile
import tempfile
import time
from urllib.request import urlopen
import setup
import native_install
import cli_guard
from browser_environment import ENV, DEFAULTS

ARCHIVES = [
    ('noVNC-1.6.0', 'https://codeload.github.com/novnc/noVNC/tar.gz/refs/tags/v1.6.0', '5066103959ef4e9b10f37e5a148627360dd8414e4cf8a7db92bdbd022e728aaa', 'MPL-2.0 and included component licenses'),
    ('websockify-0.13.0', 'https://codeload.github.com/novnc/websockify/tar.gz/refs/tags/v0.13.0', 'b6413e364efd04f3c92ec8c17747e3c4adc20157c2ef1c5d019a26d944a46df8', 'LGPL-3.0'),
]
PACKAGES = ['tigervnc-server-minimal', 'libX11', 'libXcomposite', 'libXdamage', 'libXext', 'libXfixes', 'libXrandr', 'libdrm', 'mesa-libgbm', 'alsa-lib', 'atk', 'at-spi2-atk', 'cups-libs', 'pango', 'gtk3', 'nss', 'rpm', 'cpio', 'curl']
EXCLUDED = 'openssh*,openssl*,glibc*,systemd*,kernel*,sudo*,pam*,shadow-utils*,dnf*,rpm*,python3*,libdnf*'
ROOT = Path('/opt/codex-remote-login')


def require(value, code):
    if not value:
        raise RuntimeError(code)


def run(args, timeout=120):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/root'})
    require(len(result.stdout) + len(result.stderr) <= 524288, 'BROWSER_SETUP_OUTPUT_LIMIT')
    return result.returncode, (result.stdout + result.stderr).decode('utf-8', errors='replace')


def dnf_args(confirmed=False, cached=True):
    return ['/usr/bin/dnf', *(['--cacheonly'] if cached else []), '--assumeyes' if confirmed else '--assumeno', '--setopt=install_weak_deps=False', '--setopt=obsoletes=False', '--exclude=' + EXCLUDED, 'install', *PACKAGES]


def transaction(output):
    require(not re.search(r'(?im)^\s*(?:Upgrading|Downgrading|Removing|Reinstalling|Replacing|Obsoleting|Error:)', output), 'BROWSER_PACKAGE_CHANGES_UNSAFE')
    if 'Nothing to do.' in output and 'Complete!' in output:
        return 'Nothing to do.'
    start, end = output.find('Dependencies resolved.'), output.find('Transaction Summary')
    require(start >= 0 and end > start and 'Installing' in output and 'Operation aborted.' in output, 'BROWSER_DEPENDENCIES_UNAVAILABLE')
    return output[start:output.index('Operation aborted.')].strip()


def inspect(cached=False):
    require(os.geteuid() == 0, 'ADMIN_REQUIRED')
    import pwd
    paths = [ENV['chrome'], ENV['xvnc'], str(Path(ENV['web']) / 'vnc.html'), str(Path(ENV['websockify']) / 'websockify/__init__.py')]
    try:
        user = pwd.getpwnam(ENV['serviceUser'])
        ready = user.pw_uid > 0 and user.pw_dir == ENV['home'] and all(Path(p).is_file() for p in paths)
    except KeyError:
        ready = False
    if ready:
        return dict(planId=setup.digest(ENV), chromeVersion=None, installChrome=False, archives=[], packageTransaction='Reuse installed browser environment.')
    require(ENV == DEFAULTS, 'BROWSER_PLATFORM_UNSUPPORTED')
    require(platform.machine() == 'x86_64' and Path('/usr/bin/dnf').is_file(), 'BROWSER_PLATFORM_UNSUPPORTED')
    # Cache-only planning never refreshes repositories or upgrades the system.
    _, output = run(dnf_args(cached=cached))
    changes = transaction(output)
    installed_code, inventory = run(['/usr/bin/rpm', '-qa', '--qf', '%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n'])
    require(installed_code == 0, 'BROWSER_DEPENDENCIES_UNAVAILABLE')
    chrome_missing = not Path('/opt/jp-remote-browser/chrome/chrome').is_file()
    if chrome_missing:
        require(not os.path.lexists('/opt/jp-remote-browser') and not os.path.lexists('/var/lib/jp-remote-browser'), 'BROWSER_INSTALL_CONFLICT')
    archives = []
    for name, url, checksum, license_name in ARCHIVES:
        target = ROOT / name
        setup.trusted(target, missing=True)
        if not target.exists():
            archives.append(dict(name=name, url=url, sha256=checksum, license=license_name))
    version = None
    if chrome_missing:
        metadata = native_install.release_json('https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions?pageSize=1')
        version = metadata.get('versions', [{}])[0].get('version')
        require(isinstance(version, str) and re.fullmatch(r'\d+\.\d+\.\d+\.\d+', version), 'BROWSER_RELEASE_UNAVAILABLE')
    value = dict(chromeVersion=version, installChrome=chrome_missing, archives=archives, packageTransaction=output,
                 preserved=['existing-browser-profiles', 'ssh-configuration', 'native-cli-accounts'])
    value['planId'] = setup.digest([changes, sorted(inventory.splitlines()), version, archives])
    return value


def archive(item):
    payload = native_install.release_bytes(item['url'], 16777216)
    require(hashlib.sha256(payload).hexdigest() == item['sha256'], 'BROWSER_CHECKSUM_MISMATCH')
    setup.ensure_directory(str(ROOT))
    with tempfile.TemporaryDirectory(prefix='.browser-stage-', dir=ROOT) as stage:
        with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as source:
            entries = source.getmembers()
            require(len(entries) < 8192 and sum(m.size for m in entries) < 67108864, 'BROWSER_ARCHIVE_INVALID')
            for member in entries:
                parts = Path(member.name).parts
                require(parts and parts[0] == item['name'] and not Path(member.name).is_absolute() and '..' not in parts and (member.isfile() or member.isdir()), 'BROWSER_ARCHIVE_INVALID')
                destination = Path(stage).joinpath(*parts)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True, mode=0o755)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with source.extractfile(member) as data, destination.open('xb') as target:
                        target.write(data.read())
                    destination.chmod(0o644)
        target = ROOT / item['name']
        require(not os.path.lexists(target), 'BROWSER_INSTALL_CONFLICT')
        os.rename(Path(stage) / item['name'], target)


def apply(expected, sources):
    # Share the existing setup lock; never overlap CLI/service bootstrap.
    import fcntl
    setup.trusted('/run')
    descriptor = os.open(setup.LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077, 'BROWSER_LOCK_INVALID')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        reviewed = inspect(cached=True)
        require(reviewed['planId'] == expected, 'PLAN_CHANGED')
        if reviewed['packageTransaction'] == 'Reuse installed browser environment.':
            return {'configured': True}
        if transaction(reviewed['packageTransaction']) != 'Nothing to do.':
            code, output = run(dnf_args(True), 600)
            require(code == 0, 'BROWSER_DEPENDENCIES_UNCONFIRMED')
        for item in reviewed['archives']:
            archive(item)
        if reviewed['installChrome']:
            module = {'__name__': 'browser_configure'}
            exec(compile(sources['configure_browser_root.py'], 'configure_browser_root.py', 'exec'), module)
            module['configure'](reviewed['chromeVersion'])
        return {'configured': True}
    finally:
        os.close(descriptor)
