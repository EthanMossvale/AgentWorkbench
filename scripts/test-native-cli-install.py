"""Local Linux installer acceptance. Optional official downloads run --version only.

All installations live in a temporary directory; no service/user/login is created.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
from unittest.mock import patch

assert os.geteuid() == 0, 'Local Linux root is required for ownership checks.'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/vps-account-broker'))
import native_install as native
import setup

checks = []
official = '--official' in sys.argv
report = Path(sys.argv[1])


def denied(code, action):
    try:
        action()
    except (native.InstallError, setup.SetupError) as error:
        assert str(error) == code, (str(error), code)
    else:
        raise AssertionError('Expected ' + code)


with tempfile.TemporaryDirectory(prefix='awb-native-cli-', dir='/opt') as temporary:
    base = Path(temporary)
    os.chmod(base, 0o755)
    native.INSTALL_ROOT = str(base / 'native')
    marker = base / 'version-probes'
    executable = ('#!/bin/sh\nprintf x >> ' + str(marker) + '\nprintf "codex-cli 0.155.1\\n"\n').encode()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
        entry = tarfile.TarInfo('codex-x86_64-unknown-linux-musl')
        entry.size = len(executable)
        archive.addfile(entry, io.BytesIO(executable))
    payload = buffer.getvalue()
    item = dict(provider='codex', version='0.155.1', url='https://github.com/openai/codex/releases/download/fixture/archive.tar.gz',
                size=len(payload), sha256=hashlib.sha256(payload).hexdigest(), member='codex-x86_64-unknown-linux-musl', target=str(base / 'native/codex-fixture/codex'))

    class Opener:
        data = payload
        def open(self, *args, **kwargs):
            return io.BytesIO(self.data)
    opener = Opener()
    with patch.object(native, 'artifact', lambda _: dict(item)), patch.object(native, 'build_opener', lambda *args: opener):
        before = list(base.rglob('*'))
        native.target_snapshot(item, setup.trusted)
        assert list(base.rglob('*')) == before and not marker.exists()
        checks.append('installation preview is offline and does not create directories or execute a CLI')
        opener.data = payload[:-1] + bytes([payload[-1] ^ 1])
        denied('CLI_CHECKSUM_MISMATCH', lambda: native.install(item, setup.trusted, setup.ensure_directory, setup.write_new))
        assert not Path(item['target']).exists() and not marker.exists()
        checks.append('checksum mismatch cannot publish or execute downloaded code')
        opener.data = payload
        target = native.install(item, setup.trusted, setup.ensure_directory, setup.write_new)
        assert Path(target).read_bytes() == executable and Path(target).stat().st_mode & 0o777 == 0o755
        assert Path(target).stat().st_uid == 0 and Path(target).stat().st_nlink == 1
        assert json.loads(Path(target).with_name('source.json').read_text())['sha256'] == item['sha256']
        checks.append('verified exact archive member installs with shared root-owned permissions and a receipt')
        before = Path(target).stat().st_ino
        native.install(item, setup.trusted, setup.ensure_directory, setup.write_new)
        assert Path(target).stat().st_ino == before
        checks.append('identical installation retries preserve the existing binary')
        Path(target).write_bytes(b'foreign original')
        denied('CLI_INSTALL_CONFLICT', lambda: native.install(item, setup.trusted, setup.ensure_directory, setup.write_new))
        assert Path(target).read_bytes() == b'foreign original'
        checks.append('different existing installation is never overwritten')
        count = marker.read_bytes()
        denied('CLI_INSTALL_CONFLICT', lambda: native.install(dict(item, url='https://other.invalid/payload'), setup.trusted, setup.ensure_directory, setup.write_new))
        assert marker.read_bytes() == count
        checks.append('caller cannot substitute a download URL or other reviewed artifact fields')
        Path(target).unlink()
        Path(target).symlink_to(marker)
        denied('UNSAFE_DEPLOYMENT', lambda: native.target_snapshot(item, setup.trusted))
        assert marker.read_bytes() == count
        checks.append('symlink targets are rejected without following them for installation')

    shared = base / 'shared-codex'
    shared.write_bytes(executable)
    shared.chmod(0o755)
    with patch.object(native, 'candidate_paths', lambda _: [str(shared)]):
        found, rows = native.discover('codex')
        assert found == str(shared) and rows[0]['status'] == 'ready'
        checks.append('existing protected shared CLI is reused without installation')
        shared.chmod(0o775)
        denied('CLI_UNTRUSTED_CODEX', lambda: native.discover('codex'))
        shared.chmod(0o755)
        os.chown(shared, 65534, 65534)
        denied('CLI_UNTRUSTED_CODEX', lambda: native.discover('codex'))
        os.chown(shared, 0, 0)
        checks.append('writable or member-owned shared executable is never trusted')
        count = marker.read_bytes()
        base.chmod(0o700)
        denied('CLI_NOT_SHARED_CODEX', lambda: native.discover('codex'))
        assert marker.read_bytes() == count
        base.chmod(0o755)
        checks.append('root-private installation is reported distinctly without executing it')
        shared.write_text('#!/bin/sh\nprintf "codex-cli 0.100.0\\n"\n')
        denied('CLI_VERSION_CODEX', lambda: native.discover('codex'))
        checks.append('installed unsupported version is distinguished from missing installation')
    with patch.object(native.platform, 'machine', lambda: 'riscv64'):
        denied('CLI_PLATFORM_UNSUPPORTED', lambda: native.artifact('codex'))
        checks.append('unsupported architectures do not guess an executable')

    versions = {}
    if official:
        native.INSTALL_ROOT = str(base / 'official')
        for provider in ('codex', 'claude'):
            item = native.artifact(provider)
            target = native.install(item, setup.trusted, setup.ensure_directory, setup.write_new)
            versions[provider] = native.version_of(target, provider)
            assert versions[provider] == native.VERSIONS[provider]
            checks.append('official ' + provider + ' pinned artifact passes checksum archive and isolated version execution')

report.parent.mkdir(parents=True, exist_ok=True)
report.write_text(json.dumps(dict(localLinux=True, officialDownloads=official, serviceChanges=False, modelCalls=0, loginCalls=0,
                                  versions=versions, checks=checks, passed=len(checks)), indent=2))
print(json.dumps(dict(passed=len(checks), report=str(report))))
