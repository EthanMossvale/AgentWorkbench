"""Linux temporary-file checks. Installers, packages, services and auth are fakes."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'services/vps-account-broker'), str(ROOT / 'services/vps-browser')]
import native_install as native
import cli_guard
import cli_management as cli
import setup
import browser_setup
import remote_browser
import configure_browser_root as browser_install
from broker import AccountBroker, BrokerError
from runtime import NativeAccountRuntime


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='awb-cli-fixture-', dir='/root')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.patches = contextlib.ExitStack()
        self.addCleanup(self.patches.close)
        for module, key, value in [(native, 'INSTALL_ROOT', str(self.base / 'native')), (cli_guard, 'INSTALL_ROOT', str(self.base / 'native')), (cli_guard, 'LOCK_ROOT', str(self.base / 'locks')), (setup, 'CONFIG', str(self.base / 'config.json')), (setup, 'LOCK', str(self.base / 'setup.lock')), (setup, 'SOCKET', str(self.base / 'absent.sock'))]:
            self.patches.enter_context(patch.object(module, key, value))
        self.binary = b'#!/bin/sh\nprintf "9.8.7 (fixture CLI)\\n"\n'
        # The fixture installer only writes its disposable HOME. No real installer runs.
        self.installer = b'''#!/bin/bash
set -eu
mkdir -p "$HOME/.local/share/claude/versions" "$HOME/.local/bin"
printf '#!/bin/sh\\nprintf "9.8.7 (fixture CLI)\\\\n"\\n' > "$HOME/.local/share/claude/versions/9.8.7"
chmod 755 "$HOME/.local/share/claude/versions/9.8.7"
ln -s "$HOME/.local/share/claude/versions/9.8.7" "$HOME/.local/bin/claude"
'''
        self.item = dict(provider='claude', version='9.8.7', url='https://downloads.claude.ai/fixture', sha256=hashlib.sha256(self.binary).hexdigest(), size=len(self.binary), member='', target=str(self.base / 'native/claude-9.8.7-linux-x64/claude'), installerUrl='https://claude.ai/install.sh', installerSha256=hashlib.sha256(self.installer).hexdigest())
        self.patches.enter_context(patch.object(native, 'artifact', lambda provider: dict(self.item, provider=provider)))
        self.patches.enter_context(patch.object(native, 'release_bytes', lambda url, *args: self.installer))
        self.patches.enter_context(patch.object(native, 'candidate_paths', lambda provider: [self.item['target']] if provider == 'claude' else []))

    def install(self):
        return native.install(self.item, setup.trusted, setup.ensure_directory, setup.write_new)

    def test_official_installer_staging_and_verified_program_only_removal(self):
        preserved = self.base / 'native-account-memory'
        preserved.write_text('fixture data remains')
        target = self.install()
        rows = cli.managed('claude')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['path'], target)
        config = dict(claudeExecutable=target)
        Path(setup.CONFIG).write_text(json.dumps(config))
        plan = cli.plan('claude', 'uninstall')
        self.assertEqual(plan['targets'], [target])
        result = cli.apply('claude', 'uninstall', plan['planId'])
        self.assertFalse(result['installed'])
        self.assertEqual(preserved.read_text(), 'fixture data remains')
        self.assertEqual(json.loads(Path(setup.CONFIG).read_text())['claudeExecutable'], '')
        self.assertFalse(Path(target).parent.exists())

    def test_tampered_helper_refuses_uninstall(self):
        self.install()
        helper = Path(self.item['target']).parent / 'program/claude'
        helper.write_text('changed fixture')
        with self.assertRaisesRegex(native.InstallError, 'CLI_INSTALL_CONFLICT'):
            cli.plan('claude', 'uninstall')
        self.assertTrue(helper.exists())

    def test_same_version_update_reuses_verified_installation(self):
        self.install()
        Path(setup.CONFIG).write_text(json.dumps({'claudeExecutable': self.item['target']}))
        plan = cli.plan('claude', 'update')
        with patch.object(native, 'install', side_effect=AssertionError('Do not reinstall')):
            value = cli.apply('claude', 'update', plan['planId'])
        self.assertEqual(value['version'], '9.8.7')

    def test_locks_block_in_use_runtime_and_allow_other_provider(self):
        with cli_guard.lease('codex', exclusive=True):
            with cli_guard.lease('claude', exclusive=True):
                pass
            with self.assertRaisesRegex(RuntimeError, 'CLI_BUSY'):
                with cli_guard.lease('codex', str(self.base / 'native/codex')):
                    self.fail('Maintenance must exclude native process')
        with cli_guard.lease('codex', str(self.base / 'native/codex')):
            with self.assertRaisesRegex(RuntimeError, 'CLI_BUSY'):
                with cli_guard.lease('codex', exclusive=True):
                    self.fail('Native process must exclude maintenance')

    def test_installer_identity_drift_is_rejected_before_execution(self):
        with patch.object(native, 'release_bytes', return_value=b'#!/bin/sh\nexit 0'):
            with self.assertRaisesRegex(native.InstallError, 'PLAN_CHANGED'):
                self.install()
        self.assertFalse(Path(self.item['target']).exists())

    def test_release_diagnostics_survive_list_and_plan_dispatch_without_writes(self):
        issue = dict(stage='installer', source='claude.ai', httpStatus=403)
        failure = native.InstallError('CLI_RELEASE_HTTP', release_issue=issue)
        before = list(self.base.rglob('*'))
        with patch.object(native, 'artifact', side_effect=failure):
            value = cli.view('claude')
            self.assertEqual(value['error'], 'CLI_RELEASE_HTTP')
            self.assertEqual(value['releaseIssue'], issue)
            result = cli.dispatch(dict(method='cli/plan', provider='claude', operation='install'))
            self.assertEqual(result, dict(ok=False, error='CLI_RELEASE_HTTP', releaseIssue=issue))
        self.assertEqual(list(self.base.rglob('*')), before)

    def test_dependency_preview_rejects_upgrades_and_preserves_complete_new_install_plan(self):
        for verb in ('Upgrading', 'Removing', 'Downgrading', 'Reinstalling', 'Replacing', 'Obsoleting'):
            with self.assertRaisesRegex(RuntimeError, 'BROWSER_PACKAGE_CHANGES_UNSAFE'):
                browser_setup.transaction('Dependencies resolved.\n' + verb + ':\nfixture\nTransaction Summary\nOperation aborted.')
        output = 'Dependencies resolved.\nInstalling:\nfixture x86_64 1 repo 1k\nTransaction Summary\nInstall 1 Package\nOperation aborted.'
        self.assertIn('Install 1 Package', browser_setup.transaction(output))
        self.assertIn('--cacheonly', browser_setup.dnf_args(True))

    def test_browser_download_failure_leaves_no_partial_install_or_data(self):
        install, data = self.base / 'browser', self.base / 'browser-data'
        with patch.object(browser_install, 'INSTALL', install), patch.object(browser_install, 'DATA', data), patch.object(browser_install, 'HOME', data / 'home'), patch.object(browser_install, 'root_directory'), patch.object(browser_install.pwd, 'getpwnam', side_effect=KeyError()), patch.object(Path, 'is_file', return_value=True), patch.object(browser_install, 'run', side_effect=RuntimeError('fixture download failure')):
            with self.assertRaisesRegex(RuntimeError, 'fixture download failure'):
                browser_install.configure('9.8.7.6')
        self.assertFalse(install.exists())
        self.assertFalse(data.exists())
        self.assertEqual(list(self.base.glob('.awb-browser-stage-*')), [])

    def test_browser_setup_rejects_unprotected_lock_before_any_plan_or_package(self):
        Path(setup.LOCK).touch(mode=0o600)
        Path(setup.LOCK).chmod(0o666)
        with patch.object(browser_setup, 'inspect', side_effect=AssertionError('No plan or package execution')):
            with self.assertRaisesRegex(RuntimeError, 'BROWSER_LOCK_INVALID'):
                browser_setup.apply('fixture', {})

    def test_auth_urls_and_codes_are_narrowly_validated(self):
        self.assertEqual(remote_browser.authorization_url('https://claude.ai/oauth/authorize?state=fixture'), 'https://claude.ai/oauth/authorize?state=fixture')
        for url in ('http://claude.ai/oauth/authorize', 'https://evil.invalid/oauth/authorize', 'https://claude.ai@evil.invalid/oauth/authorize', 'https://claude.ai/settings', 'https://claude.ai:444/oauth/authorize'):
            with self.assertRaises(ValueError):
                remote_browser.authorization_url(url)

    def test_account_remove_revokes_public_selection_and_preserves_profile(self):
        root = self.base / 'accounts'
        broker = AccountBroker(dict(authorityId='fixture', generation='g', ownerUid=65534, root=str(root), members=[]))
        account = broker.registry.add('fixture-account', {'status': 'authenticated'}, provider='claude')
        broker.registry.select('fixture-workspace', account['id'], 0)
        profile = broker.registry.profiles / account['id']
        profile.mkdir(); (profile / 'memory.txt').write_text('fixture preserved')
        runtime = broker.native_runtime()
        params = dict(authorityId='fixture', generation='g', accountId=account['id'], accountGeneration=account['generation'], expectedRevision=broker.registry.state['revision'], confirm=True)
        def call():
            return broker.dispatch(0, {'protocol': 1, 'method': 'runtime/remove', 'params': params})
        with patch.object(runtime, 'environment', return_value=({}, str(profile))), patch.object(runtime, 'executable', return_value='/fixture/claude'), patch('account_admin.subprocess.run', return_value=types.SimpleNamespace(returncode=0)) as command:
            value = call()
        self.assertEqual(value['removed'], account['id'])
        self.assertEqual(command.call_args.args[0], ['/fixture/claude', 'auth', 'logout'])
        self.assertEqual(broker.registry.catalog('fixture-workspace')['accounts'], [])
        self.assertNotIn('selectedClaudeAccountId', broker.registry.catalog('fixture-workspace'))
        self.assertEqual((profile / 'memory.txt').read_text(), 'fixture preserved')

    def test_create_rejection_after_remove_is_definitive_and_fresh_identity_preserves_old_profile(self):
        broker = AccountBroker(dict(authorityId='fixture', generation='g', ownerUid=65534, root=str(self.base / 'accounts'), members=[]))
        common = dict(authorityId='fixture', generation='g')
        original = dict(common, requestId='11111111-1111-4111-8111-111111111111', expectedRevision=broker.registry.state['revision'])
        def create(params):
            return broker.dispatch(0, dict(protocol=1, method='runtime/claude-create', params=params))
        account = create(original)
        profile = broker.registry.profiles / account['id']
        (profile / 'memory.txt').write_text('fixture preserved')
        revision = broker.registry.state['revision']
        self.assertEqual(create(original), account)
        self.assertEqual(broker.registry.state['revision'], revision)
        runtime = broker.native_runtime()
        remove = dict(common, accountId=account['id'], accountGeneration=account['generation'], expectedRevision=revision, confirm=True)
        with patch.object(runtime, 'environment', return_value=({}, str(profile))), patch.object(runtime, 'executable', return_value='/fixture/claude'), patch('account_admin.subprocess.run', return_value=types.SimpleNamespace(returncode=0)):
            broker.dispatch(0, dict(protocol=1, method='runtime/remove', params=remove))
        before = json.dumps(broker.registry.state, sort_keys=True)
        profiles = sorted(p.name for p in broker.registry.profiles.iterdir())
        with self.assertRaisesRegex(BrokerError, '^STALE_SELECTION$'):
            create(original)
        self.assertEqual(json.dumps(broker.registry.state, sort_keys=True), before)
        self.assertEqual(sorted(p.name for p in broker.registry.profiles.iterdir()), profiles)
        fresh = create(dict(common, requestId='22222222-2222-4222-8222-222222222222', expectedRevision=broker.registry.state['revision']))
        self.assertNotEqual(fresh['id'], account['id'])
        self.assertNotIn(account['id'], broker.registry.state['accounts'])
        self.assertEqual(list(broker.registry.state['accounts']), [fresh['id']])
        self.assertEqual((profile / 'memory.txt').read_text(), 'fixture preserved')


if __name__ == '__main__':
    assert os.geteuid() == 0, 'Run only in isolated local Linux fixtures.'
    unittest.main(verbosity=2)
