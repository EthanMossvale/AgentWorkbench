"""Real local Linux filesystem setup checks; OS commands use explicit fakes.

No real accounts, services, CLI login, model calls or remote hosts are modified.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import types
from unittest.mock import patch

assert os.geteuid() == 0, 'Use local isolated Linux root for file ownership checks.'
source = Path(__file__).resolve().parents[1] / 'services/vps-account-broker'
sys.path.insert(0, str(source))
import setup

checks = []
sources = {name: (source / name).read_text() for name in setup.FILES + ['agent-workbench-accounts.service']}
assert all(value.isascii() for value in sources.values())
report = Path(sys.argv[1])

with tempfile.TemporaryDirectory(prefix='awb-account-setup-', dir='/root') as temporary:
    base = Path(temporary)
    setup.ROOT = str(base / 'state')
    setup.CODE = str(base / 'code')
    setup.CONFIG = str(base / 'config' / 'accounts.json')
    setup.UNIT = str(base / 'units' / 'agent-workbench-accounts.service')
    setup.LOCK = str(base / 'lock')
    setup.cli_guard.LOCK_ROOT = str(base / 'cli-locks')
    setup.POLICIES = [str(base / 'policy' / 'workspaces.json')]
    original_is_dir = Path.is_dir
    commands = []
    state = {'owner': None, 'ready': False}
    identity = ('fixture-authority', 'fixture-generation', setup.POLICIES[0])
    user = types.SimpleNamespace(pw_name=setup.OWNER, pw_uid=65534, pw_gid=65534, pw_dir=setup.ROOT, pw_shell='/usr/sbin/nologin')

    def execute(args, **options):
        commands.append(args)
        if args[0] == '/usr/sbin/useradd':
            state['owner'] = user
        elif args[:3] == ['/usr/bin/systemctl', 'enable', '--now']:
            state['ready'] = True
        return types.SimpleNamespace(returncode=0, stdout=b'', stderr=b'')

    with patch.object(setup, 'authority', lambda: identity), patch.object(setup, 'owner', lambda: state['owner']), \
         patch.object(setup, 'binary', lambda name, _detected: '/usr/bin/' + name), \
         patch.object(setup, 'native_catalog', lambda: dict(authorityId=identity[0], generation=identity[1]) if state['ready'] else None), \
         patch.object(Path, 'is_dir', lambda path: True if str(path) == '/run/systemd/system' else original_is_dir(path)), \
         patch.object(setup.subprocess, 'run', execute):
        before = list(base.rglob('*'))
        first = setup.inspect(sources)
        assert first['status'] == 'installable' and first['createOwner'] is True, first
        assert list(base.rglob('*')) == before and commands == []
        checks.append('preflight reads only and returns a concrete installation plan')

        changed = dict(sources, **{'runtime.py': sources['runtime.py'] + '\n# changed fixture\n'})
        denied = setup.dispatch({'method': 'apply', 'planId': first['planId']}, changed)
        assert denied == {'ok': False, 'error': 'PLAN_CHANGED'} and commands == [], denied
        checks.append('changed bundle rejects the reviewed plan before creating an owner')

        foreign = base / 'unrelated.txt'
        foreign.write_text('preserve original workspace files')
        result = setup.dispatch({'method': 'apply', 'planId': first['planId']}, sources)
        assert result['ok'] and result['value']['status'] == 'ready', result
        assert foreign.read_text() == 'preserve original workspace files'
        assert len([c for c in commands if c[0] == '/usr/sbin/useradd']) == 1
        config = json.loads(Path(setup.CONFIG).read_text())
        assert config['ownerUid'] == 65534 and config['workspacePolicyFile'] == identity[2]
        assert config['socketAccess'] == 'peer-policy'
        for folder in [Path(setup.ROOT), Path(setup.ROOT) / 'profiles']:
            assert folder.stat().st_uid == 65534 and folder.stat().st_mode & 0o777 == 0o700
        assert all(Path(setup.CODE, name).read_text() == sources[name] for name in setup.FILES)
        assert not any('login' in c or 'userdel' in c for c in commands)
        checks.append('apply installs only the reviewed service and private owner directories')

        count = len(commands)
        assert setup.inspect(sources)['status'] == 'ready' and len(commands) == count
        checks.append('a ready service is reused without another owner login or registry')

        state['ready'] = False
        second = setup.inspect(sources)
        assert second['status'] == 'installable' and second['createOwner'] is False, second
        assert setup.dispatch({'method': 'apply', 'planId': second['planId']}, sources)['ok']
        assert len([c for c in commands if c[0] == '/usr/sbin/useradd']) == 1
        checks.append('an interrupted identical deployment resumes without changing account files')

        state['ready'] = False
        target = Path(setup.CODE) / 'runtime.py'
        target.write_text('foreign deployment')
        denied = setup.inspect(sources)
        assert denied['status'] == 'blocked' and 'EXISTING_DEPLOYMENT_CHANGED' in denied['blockers'], denied
        assert target.read_text() == 'foreign deployment'
        target.write_text(sources['runtime.py'])
        checks.append('different existing service files are never overwritten')

        target.unlink()
        target.symlink_to(foreign)
        denied = setup.inspect(sources)
        assert denied['status'] == 'blocked' and 'UNSAFE_DEPLOYMENT' in denied['blockers'], denied
        target.unlink()
        target.write_text(sources['runtime.py'])
        checks.append('symlinks are rejected before service installation')

        Path(setup.UNIT + '.d').mkdir()
        assert setup.inspect(sources)['blockers'] == ['EXISTING_DEPLOYMENT_CHANGED']
        Path(setup.UNIT + '.d').rmdir()
        checks.append('foreign systemd overrides cannot silently replace the reviewed service')

        with patch.object(setup, 'native_catalog', side_effect=OSError('fixture unavailable')):
            count = len(commands)
            assert setup.inspect(sources)['blockers'] == ['EXISTING_SERVICE_UNAVAILABLE']
            assert len(commands) == count
        checks.append('an unavailable existing service cannot trigger a second account owner')

        # A Claude-only installation is valid; Codex absence is not a global lock.
        Path(setup.CONFIG).unlink()
        def claude_only(provider, _detected):
            if provider == 'codex':
                raise setup.SetupError('CLI_MISSING_CODEX')
            return '/usr/bin/claude'
        with patch.object(setup, 'binary', claude_only), patch.object(setup.native_install, 'artifact', lambda provider: dict(provider=provider, version='9.8.7', target=str(base / 'native' / provider), url='https://fixture.invalid/never-fetched', sha256='a' * 64, size=1)):
            value = setup.inspect(sources)
            assert value['status'] == 'installable' and value['binaries']['claude'] == '/usr/bin/claude' and len(value['downloads']) == 1 and value['downloads'][0]['provider'] == 'codex', value
            assert value['warnings'] == ['CLI_MISSING_CODEX']
        checks.append('missing Codex adds a pinned installation plan while reusing the existing Claude binary')

report.parent.mkdir(parents=True, exist_ok=True)
report.write_text(json.dumps({'localFilesystem': True, 'syntheticOsCommands': True, 'remoteChanges': False, 'checks': checks, 'passed': len(checks)}, indent=2))
print(json.dumps({'passed': len(checks), 'report': str(report)}))
