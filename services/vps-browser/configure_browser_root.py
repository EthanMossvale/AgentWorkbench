"""Explicit root-only bootstrap for an independent, sandboxed remote browser.

Extract the signed official Chrome RPM without running package scripts or
changing system packages. Existing browser profiles are never overwritten.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import tempfile

INSTALL = Path('/opt/jp-remote-browser')
DATA = Path('/var/lib/jp-remote-browser')
HOME = DATA / 'home'
USERNAME = 'jp-browser'
RPM_URL = 'https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm'
KEY_URL = 'https://dl.google.com/linux/linux_signing_key.pub'


def run(args, **kwargs):
    return subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True,
                          text=True, check=True, timeout=kwargs.pop('timeout', 60), **kwargs)


def root_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError('Untrusted root-controlled directory: ' + str(path))


def configure(expected_version=None):
    if os.geteuid() != 0 or os.uname().machine != 'x86_64':
        raise RuntimeError('This bootstrap requires root on Linux x86_64.')
    for path in (Path('/opt'), Path('/var'), Path('/var/lib')):
        root_directory(path)
    for path in (Path('/usr/bin/Xvnc'), Path('/opt/codex-remote-login/noVNC-1.6.0/vnc.html'),
                 Path('/opt/codex-remote-login/websockify-0.13.0/websockify/__init__.py')):
        if not path.is_file():
            raise RuntimeError('Required existing desktop component is absent: ' + str(path))
    if os.path.lexists(INSTALL) or os.path.lexists(DATA):
        raise RuntimeError('Browser installation or data directory already exists; inspect and reuse it explicitly.')
    try:
        pwd.getpwnam(USERNAME)
    except KeyError:
        pass
    else:
        raise RuntimeError('Browser service identity already exists; refusing to change it.')
    # Download, signature, version and dependency failures leave no installation
    # or data directory that would prevent a new reviewed attempt.
    with tempfile.TemporaryDirectory(prefix='.awb-browser-stage-', dir=INSTALL.parent) as temporary:
        stage = Path(temporary)
        package, key, database = stage / 'chrome.rpm', stage / 'signing-key.pub', stage / 'rpmdb'
        for url, target in ((RPM_URL, package), (KEY_URL, key)):
            run(['/usr/bin/curl', '--fail', '--location', '--proto', '=https', '--tlsv1.2',
                 '--retry', '2', '--max-time', '300', '--output', str(target), url], timeout=320)
        database.mkdir(mode=0o700)
        run(['/usr/bin/rpm', '--dbpath', str(database), '--initdb'])
        run(['/usr/bin/rpmkeys', '--dbpath', str(database), '--import', str(key)])
        verified = run(['/usr/bin/rpmkeys', '--dbpath', str(database), '--checksig', str(package)])
        if 'digests signatures OK' not in verified.stdout:
            raise RuntimeError('Chrome package signature was not verified.')
        version = run(['/usr/bin/rpm', '-qp', '--qf', '%{NAME}|%{VERSION}|%{ARCH}', str(package)]).stdout
        name, number, arch = version.split('|')
        if name != 'google-chrome-stable' or arch != 'x86_64':
            raise RuntimeError('Unexpected package identity.')
        if expected_version is not None and number != expected_version:
            raise RuntimeError('PLAN_CHANGED')
        paths = run(['/usr/bin/rpm', '-qpl', str(package)]).stdout.splitlines()
        if any('..' in Path(path).parts or not path.startswith('/') for path in paths):
            raise RuntimeError('Unsafe package member path.')
        unpack = stage / 'unpack'
        unpack.mkdir()
        producer = subprocess.Popen(['/usr/bin/rpm2cpio', str(package)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        consumer = subprocess.run(['/usr/bin/cpio', '-idm', '--quiet', '--no-absolute-filenames', '--no-preserve-owner'],
                                  stdin=producer.stdout, cwd=unpack, capture_output=True, timeout=90)
        producer.stdout.close()
        if producer.wait(timeout=30) or consumer.returncode:
            raise RuntimeError('Chrome extraction failed.')
        source = unpack / 'opt/google/chrome'
        if not (source / 'chrome').is_file() or (source / 'chrome').is_symlink():
            raise RuntimeError('Extracted browser binary is absent or unsafe.')
        runtime = source
        root_directory(runtime)
        sandbox = runtime / 'chrome-sandbox'
        if not sandbox.is_file() or sandbox.is_symlink():
            raise RuntimeError('Chrome sandbox helper is absent or unsafe.')
        os.chown(sandbox, 0, 0)
        sandbox.chmod(0o4755)
        dependencies = run(['/usr/bin/ldd', str(runtime / 'chrome')])
        if 'not found' in dependencies.stdout:
            raise RuntimeError('Browser dependency missing; no system package was changed.')
        digest = hashlib.sha256(package.read_bytes()).hexdigest()
        INSTALL.mkdir(mode=0o755)
        try:
            os.rename(runtime, INSTALL / 'chrome')
        except Exception:
            INSTALL.rmdir()  # Only our newly created, still-empty directory.
            raise
        runtime = INSTALL / 'chrome'
    DATA.mkdir(mode=0o755)
    run(['/usr/sbin/useradd', '--system', '--user-group', '--no-create-home',
         '--home-dir', str(HOME), '--shell', '/usr/sbin/nologin', '--', USERNAME])
    user = pwd.getpwnam(USERNAME)
    if not 0 < user.pw_uid < 1000 or user.pw_dir != str(HOME):
        raise RuntimeError('Unexpected browser service identity.')
    HOME.mkdir(mode=0o700)
    os.chown(HOME, user.pw_uid, user.pw_gid)
    reported = run(['/usr/sbin/runuser', '-u', USERNAME, '--', str(runtime / 'chrome'), '--version']).stdout.strip()
    if number not in reported:
        raise RuntimeError('Extracted Chrome version did not match its package.')
    receipt = dict(version=1, chromeVersion=number, reportedVersion=reported, packageSha256=digest,
                   signatureVerified=True, runtime=str(runtime), home=str(HOME),
                   username=USERNAME, uid=user.pw_uid, systemPackagesChanged=False,
                   legacySshIdentitiesChanged=False, initialProfiles=0)
    receipt_file = DATA / 'installation.json'
    receipt_file.write_text(json.dumps(receipt, indent=2) + '\n')
    receipt_file.chmod(0o644)
    return receipt


if __name__ == '__main__':
    print(json.dumps(configure()))
