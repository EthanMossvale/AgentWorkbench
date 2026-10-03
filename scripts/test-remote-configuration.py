"""Linux filesystem lifecycle tests; all service commands are synthetic."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/vps-account-broker'))
import configuration as manager
import setup
import cli_guard

SOURCE = Path(__file__).resolve().parents[1] / 'services/vps-account-broker'
SOURCES = {n: (SOURCE / n).read_text() for n in setup.FILES + [manager.SERVICE]}
KNOWN = json.loads((SOURCE / 'configuration-known.json').read_text())
ASSERT_IDLE = manager.assert_idle


def release_for(sources=SOURCES, revision=1):
    return dict(schemaVersion=1, revision=revision, sha256=setup.digest({n: hashlib.sha256(v.replace('\r\n', '\n').encode()).hexdigest() for n, v in sources.items()}))


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='awb-config-', dir='/root')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.patches = []
        def replace(obj, name, value):
            p = patch.object(obj, name, value)
            self.patches.append(p)
            p.start()
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])
        for name, value in dict(ROOT='state', CODE='code', CONFIG='config/accounts.json', UNIT='units/' + manager.SERVICE, LOCK='lock', SOCKET='socket').items():
            replace(setup, name, str(self.base / value))
        replace(setup, 'POLICIES', [str(self.base / 'policy.json')])
        replace(manager, 'STATE', str(self.base / 'management'))
        replace(manager, 'RELEASE', release_for())
        replace(cli_guard, 'LOCK_ROOT', str(self.base / 'cli-locks'))
        self.identity = ('fixture', 'generation', setup.POLICIES[0])
        self.owner = None
        self.user = types.SimpleNamespace(pw_uid=65534, pw_gid=65534, pw_dir=setup.ROOT, pw_shell='/usr/sbin/nologin')
        self.running = False
        self.enabled = False
        self.fail_start = 0
        self.commands = []
        replace(setup, 'authority', lambda: self.identity)
        replace(setup, 'owner', lambda: self.owner)
        replace(setup, 'binary', lambda provider, detected: '/opt/agent-workbench/native/' + provider + '/program')
        original_dir = Path.is_dir
        replace(Path, 'is_dir', lambda p: True if str(p) == '/run/systemd/system' else original_dir(p))
        replace(manager, 'systemctl', self.systemctl)
        replace(setup, 'native_catalog', lambda: dict(authorityId=self.identity[0], generation=self.identity[1]) if self.running else None)
        self.idle_checks = []
        # The real apply acquires both real flock leases; only the broker/cgroup
        # observation is synthetic in a host without this service.
        replace(manager, 'assert_idle', lambda state: self.idle_checks.append(state))
        replace(setup.subprocess, 'run', self.execute)

    def execute(self, args, **options):
        self.commands.append(args)
        self.assertEqual(args[0], '/usr/sbin/useradd')
        self.owner = self.user
        return types.SimpleNamespace(returncode=0, stdout=b'', stderr=b'')

    def systemctl(self, *args, check=True):
        self.commands.append(args)
        if args[0] == 'show':
            installed = Path(setup.UNIT).exists()
            data = dict(LoadState='loaded' if installed else 'not-found', ActiveState='active' if self.running else 'inactive',
                        UnitFileState='enabled' if self.enabled else 'disabled', FragmentPath=setup.UNIT if installed else '',
                        MainPID='99' if self.running else '0', ControlGroup='/system.slice/' + manager.SERVICE if self.running else '', DropInPaths='', NeedDaemonReload='no')
            return types.SimpleNamespace(stdout=('\n'.join(k + '=' + v for k, v in data.items())).encode())
        if args[0] == 'stop':
            self.running = False
        if args[0] == 'disable':
            self.enabled = False
        if args[0] == 'enable':
            self.enabled = True
        if args[0] == 'start' or '--now' in args:
            if self.fail_start:
                self.fail_start -= 1
                raise OSError('Synthetic start failure')
            self.running = True
        return types.SimpleNamespace(stdout=b'')

    def apply(self, operation, sources=SOURCES, known=KNOWN):
        plan = manager.plan(sources, known, operation)
        return manager.apply(sources, known, operation, plan['token'])

    def test_install_uninstall_reinstall_preserves_user_files_and_owner(self):
        before = list(self.base.rglob('*'))
        row = manager.status(SOURCES, KNOWN)
        self.assertTrue(row['canInstall'])
        manager.plan(SOURCES, KNOWN, 'install')
        self.assertEqual(before, list(self.base.rglob('*')))
        self.assertTrue(all(c[0] == 'show' for c in self.commands))
        self.assertTrue(self.apply('install')['running'])
        profile = Path(setup.ROOT) / 'profiles' / 'synthetic-user-file'
        profile.write_bytes(b'unchanged synthetic profile')
        original_config = Path(setup.CONFIG).read_bytes()
        self.assertFalse(self.apply('uninstall')['installed'])
        self.assertEqual(profile.read_bytes(), b'unchanged synthetic profile')
        self.assertEqual(Path(setup.CONFIG).read_bytes(), original_config)
        self.assertTrue(self.apply('install')['running'])
        self.assertEqual(profile.read_bytes(), b'unchanged synthetic profile')
        self.assertEqual(len([c for c in self.commands if c[0] == '/usr/sbin/useradd']), 1)
        self.assertTrue(all('login' not in c and 'userdel' not in c for c in self.commands))

    def test_update_preserves_config_and_backs_up_programs(self):
        self.apply('install')
        config = Path(setup.CONFIG).read_bytes()
        changed = dict(SOURCES, **{'broker.py': SOURCES['broker.py'] + '\n# Updated synthetic build\n'})
        with patch.object(manager, 'RELEASE', release_for(changed, 2)):
            self.assertTrue(self.apply('update', changed)['running'])
        self.assertEqual(Path(setup.CODE, 'broker.py').read_text(), changed['broker.py'])
        self.assertEqual(Path(setup.CONFIG).read_bytes(), config)
        journal = json.loads(Path(manager.STATE, 'transaction.json').read_text())
        self.assertEqual(Path(journal['backup'], 'broker.py').read_text(), SOURCES['broker.py'])
        self.assertTrue(Path(journal['backup'], 'transaction.json').exists())

    def test_foreign_symlink_hardlink_and_override_block_without_mutation(self):
        self.apply('install')
        target = Path(setup.CODE, 'broker.py')
        original = target.read_bytes()
        target.write_text('foreign')
        self.assertEqual(manager.status(SOURCES, KNOWN)['error'], 'CONFIG_FOREIGN')
        self.assertEqual(target.read_text(), 'foreign')
        target.unlink()
        outside = self.base / 'foreign.txt'
        outside.write_bytes(original)
        target.symlink_to(outside)
        self.assertFalse(manager.status(SOURCES, KNOWN)['canUpdate'])
        target.unlink()
        os.link(outside, target)
        self.assertFalse(manager.status(SOURCES, KNOWN)['canUninstall'])
        target.unlink()
        target.write_bytes(original)
        Path(setup.UNIT + '.d').mkdir()
        self.assertFalse(manager.status(SOURCES, KNOWN)['canUpdate'])

    def test_changed_preview_and_consumed_operation_cannot_replay(self):
        plan = manager.plan(SOURCES, KNOWN, 'install')
        self.apply('install')
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_CHANGED'):
            manager.apply(SOURCES, KNOWN, 'install', plan['token'])
        plan = manager.plan(SOURCES, KNOWN, 'update')
        changed = dict(SOURCES, **{'runtime.py': SOURCES['runtime.py'] + '\n# fixture\n'})
        manager.RELEASE = release_for(changed, 2)
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_CHANGED'):
            manager.apply(changed, KNOWN, 'update', plan['token'])

    def test_start_failure_rolls_back_running_service(self):
        self.apply('install')
        original = {name: Path(setup.CODE, name).read_bytes() for name in setup.FILES}
        changed = dict(SOURCES, **{'runtime.py': SOURCES['runtime.py'] + '\n# fixture\n'})
        manager.RELEASE = release_for(changed, 2)
        self.fail_start = 1
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_ROLLED_BACK'):
            self.apply('update', changed)
        self.assertTrue(self.running)
        self.assertTrue(all(Path(setup.CODE, n).read_bytes() == v for n, v in original.items()))
        self.assertEqual(json.loads(Path(manager.STATE, 'transaction.json').read_text())['state'], 'rolled-back')

    def test_first_install_failure_preserves_partial_identity_without_enabled_unit(self):
        self.fail_start = 1
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_ROLLED_BACK'):
            self.apply('install')
        self.assertFalse(self.enabled)
        self.assertFalse(self.running)
        self.assertFalse(Path(setup.UNIT).exists())
        self.assertTrue(Path(setup.CONFIG).exists())
        self.assertTrue(self.apply('install')['running'])
        self.assertEqual(len([c for c in self.commands if c[0] == '/usr/sbin/useradd']), 1)

    def test_failed_rollback_retains_journal_and_requires_fresh_explicit_plan(self):
        self.apply('install')
        self.fail_start = 2
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_ROLLBACK_FAILED'):
            self.apply('update')
        self.assertEqual(manager.status(SOURCES, KNOWN)['error'], 'CONFIG_REVIEW_REQUIRED')
        self.assertTrue(self.apply('update')['running'])
        self.assertNotIn('error', manager.status(SOURCES, KNOWN))

    def test_two_cli_leases_and_setup_lock_are_held_for_mutation(self):
        self.apply('install')
        before = Path(setup.CODE, 'broker.py').read_bytes()
        with cli_guard.lease('claude', '/opt/agent-workbench/native/fixture'):
            with self.assertRaisesRegex(RuntimeError, 'CLI_BUSY'):
                self.apply('update')
        self.assertEqual(before, Path(setup.CODE, 'broker.py').read_bytes())
        fd = os.open(setup.LOCK, os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(setup.SetupError, 'CONFIG_BUSY'):
                self.apply('uninstall')
        finally:
            os.close(fd)

    def test_live_work_rejection_precedes_journal_and_service_stop(self):
        self.apply('install')
        previous = Path(manager.STATE, 'transaction.json').read_bytes()
        self.commands.clear()
        with patch.object(manager, 'assert_idle', side_effect=setup.SetupError('CONFIG_BUSY')):
            with self.assertRaisesRegex(setup.SetupError, 'CONFIG_BUSY'):
                self.apply('uninstall')
        self.assertEqual(previous, Path(manager.STATE, 'transaction.json').read_bytes())
        self.assertTrue(all(c[0] == 'show' for c in self.commands))

    def test_real_idle_guard_rejects_descendants_and_external_binary_races(self):
        self.apply('install')
        state = manager.inspect(SOURCES, KNOWN)
        group = self.base / 'cgroup.procs'
        group.write_text('99\n101\n')
        with patch.object(manager.cli_management, 'runtime_request', lambda p: None), patch.object(Path, 'rglob', lambda p, pattern: [group]):
            with self.assertRaisesRegex(setup.SetupError, 'CONFIG_BUSY'):
                ASSERT_IDLE(state)
            group.write_text('99\n')
            ASSERT_IDLE(state)
            state['config']['claudeExecutable'] = '/usr/local/bin/claude'
            with self.assertRaisesRegex(setup.SetupError, 'CONFIG_BUSY'):
                ASSERT_IDLE(state)

    def test_historical_source_migration_and_missing_claude_module(self):
        self.apply('install')
        Path(manager.STATE, 'receipt.json').unlink()
        Path(setup.CODE, 'claude_session.py').unlink()
        self.assertTrue(manager.status(SOURCES, KNOWN)['canUpdate'])
        self.apply('update')
        self.assertEqual(Path(setup.CODE, 'claude_session.py').read_text(), SOURCES['claude_session.py'])

    def test_damaged_journal_and_foreign_identity_are_preserved(self):
        self.apply('install')
        target = Path(manager.STATE, 'transaction.json')
        target.write_text('{')
        self.assertFalse(manager.status(SOURCES, KNOWN)['canUpdate'])
        self.assertEqual(target.read_text(), '{')
        target.unlink()
        config = json.loads(Path(setup.CONFIG).read_text())
        config['ownerUid'] = 10
        Path(setup.CONFIG).write_text(json.dumps(config))
        self.assertEqual(manager.status(SOURCES, KNOWN)['error'], 'CONFIG_IDENTITY')

    def test_all_remote_bundle_sources_and_manager_are_ascii(self):
        self.assertTrue(all(content.isascii() for content in SOURCES.values()))
        self.assertTrue((SOURCE / 'configuration.py').read_text().isascii())
        self.assertTrue((SOURCE / 'configuration-known.json').read_text().isascii())
        self.assertTrue((SOURCE / 'configuration-release.json').read_text().isascii())
        release = json.loads((SOURCE / 'configuration-release.json').read_text())
        self.assertGreaterEqual(release['revision'], 1)
        self.assertEqual(release, release_for(revision=release['revision']))

    def next_release(self, revision=2):
        sources = dict(SOURCES, **{'broker.py': SOURCES['broker.py'] + '\n# Synthetic release ' + str(revision) + '\n'})
        manager.RELEASE = release_for(sources, revision)
        return sources

    def test_policy_default_cas_restart_and_corrupt_file_preservation(self):
        row = manager.status(SOURCES, KNOWN)
        self.assertEqual(row['policy'], dict(schemaVersion=1, revision=0, autoUpdate=False))
        self.assertFalse(Path(manager.STATE).exists())
        saved = manager.configure(0, True)
        self.assertEqual(manager.status(SOURCES, KNOWN)['policy'], saved)
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_POLICY_CHANGED'):
            manager.configure(0, False)
        self.assertTrue(manager.policy()['autoUpdate'])
        self.assertFalse(manager.configure(1, False)['autoUpdate'])
        target = Path(manager.STATE, 'policy.json')
        for invalid in ['{', '', '{"schemaVersion":2}']:
            target.write_text(invalid)
            self.assertEqual(manager.status(SOURCES, KNOWN)['error'], 'CONFIG_POLICY_INVALID')
            self.assertEqual(target.read_text(), invalid)

    def test_auto_update_requires_opt_in_newer_bundle_and_keeps_policy_after_uninstall(self):
        self.apply('install')
        sources = self.next_release()
        self.assertIsNone(manager.auto_update(sources, KNOWN))
        manager.configure(0, True)
        updated = manager.auto_update(sources, KNOWN)
        self.assertEqual(updated['installedRevision'], 2)
        self.assertTrue(updated['policy']['autoUpdate'])
        self.assertNotIn('lastAttemptError', updated['policy'])
        self.assertIsNone(manager.auto_update(sources, KNOWN))
        self.apply('uninstall', sources)
        self.assertTrue(manager.policy()['autoUpdate'])
        self.assertIsNone(manager.auto_update(sources, KNOWN))
        self.assertFalse(Path(setup.UNIT).exists())

    def test_newer_installed_revision_blocks_older_client_and_equal_revision_cannot_auto_replace(self):
        self.apply('install')
        manager.configure(0, True)
        sources = self.next_release(1)
        self.assertIsNone(manager.auto_update(sources, KNOWN))
        sources = self.next_release(2)
        manager.auto_update(sources, KNOWN)
        manager.RELEASE = release_for()
        row = manager.status(SOURCES, KNOWN)
        self.assertEqual(row['error'], 'CONFIG_NEWER_INSTALLED')
        self.assertFalse(row['canUpdate'])
        self.assertIsNone(manager.auto_update(SOURCES, KNOWN))
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_CHANGED'):
            manager.plan(SOURCES, KNOWN, 'update')

    def test_busy_deferral_never_claims_an_attempt_or_stops_service(self):
        self.apply('install')
        manager.configure(0, True)
        sources = self.next_release()
        before = manager.policy()
        self.commands.clear()
        with patch.object(manager, 'assert_idle', side_effect=setup.SetupError('CONFIG_BUSY')):
            self.assertIsNone(manager.auto_update(sources, KNOWN))
        with cli_guard.lease('codex', '/opt/agent-workbench/native/fixture'):
            self.assertIsNone(manager.auto_update(sources, KNOWN))
        self.assertEqual(manager.policy(), before)
        self.assertTrue(all(c[0] == 'show' for c in self.commands))
        self.assertEqual(manager.auto_update(sources, KNOWN)['installedRevision'], 2)

    def test_failed_auto_attempt_is_durable_and_not_replayed_until_newer_release(self):
        self.apply('install')
        manager.configure(0, True)
        sources = self.next_release()
        self.fail_start = 1
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_ROLLED_BACK'):
            manager.auto_update(sources, KNOWN)
        self.assertEqual(manager.policy()['lastAttemptError'], 'CONFIG_ROLLED_BACK')
        self.commands.clear()
        self.assertIsNone(manager.auto_update(sources, KNOWN))
        self.assertTrue(all(c[0] == 'show' for c in self.commands))
        sources = self.next_release(3)
        self.assertEqual(manager.auto_update(sources, KNOWN)['installedRevision'], 3)
        self.assertNotIn('lastAttemptError', manager.policy())

    def test_interrupted_update_keeps_unknown_receipt_for_manual_recovery(self):
        self.apply('install')
        manager.configure(0, True)
        sources = self.next_release()
        def interrupt(*args, **kwargs):
            if args[0] == 'stop':
                raise SystemExit('Synthetic process termination')
            return self.systemctl(*args, **kwargs)
        with patch.object(manager, 'systemctl', interrupt):
            with self.assertRaises(SystemExit):
                manager.auto_update(sources, KNOWN)
        self.assertEqual(manager.policy()['lastAttemptError'], 'CONFIG_UNCONFIRMED')
        self.assertIsNone(manager.auto_update(sources, KNOWN))
        self.assertTrue(self.apply('update', sources)['running'])
        self.assertNotIn('lastAttemptError', manager.policy())

    def test_policy_change_invalidates_preview_and_payload_validates_release(self):
        preview = manager.plan(SOURCES, KNOWN, 'install')
        manager.configure(0, True)
        with self.assertRaisesRegex(setup.SetupError, 'CONFIG_CHANGED'):
            manager.apply(SOURCES, KNOWN, 'install', preview['token'])
        result = manager.dispatch(dict(method='configure', revision=1, autoUpdate=False), SOURCES, KNOWN, release_for())
        self.assertTrue(result['ok'])
        self.assertFalse(result['value']['policy']['autoUpdate'])
        invalid = dict(release_for(), sha256='0' * 64)
        self.assertEqual(manager.dispatch(dict(method='status'), SOURCES, KNOWN, invalid)['error'], 'CONFIG_RELEASE_INVALID')


if __name__ == '__main__':
    assert os.geteuid() == 0, 'Use isolated local WSL root, never a remote server.'
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Lifecycle))
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps(dict(tests=result.testsRun, failures=len(result.failures), errors=len(result.errors), syntheticService=True, remoteChanges=False), indent=2))
    sys.exit(0 if result.wasSuccessful() else 1)
