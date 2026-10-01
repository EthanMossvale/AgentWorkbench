"""Run with Linux Python; every write/deletion uses temporary fixture directories."""
import json
import contextlib
import io
from unittest.mock import patch
from pathlib import Path
import tempfile
import types
import unittest

if 'MANAGER_SOURCE' not in globals():
    MANAGER_SOURCE = Path(__file__).resolve().parents[1].joinpath('services/vps-browser/remote_browser.py').read_text(encoding='utf-8')


class ProfileManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='jp-browser-unit-')
        self.addCleanup(self.temp.cleanup)
        self.m = types.ModuleType('browser_under_test')
        exec(compile(MANAGER_SOURCE, 'remote_browser.py', 'exec'), self.m.__dict__)
        self.m.PROFILE = Path(self.temp.name) / 'profiles'
        self.m.STATE = Path(self.temp.name) / 'state'
        self.m.STATE.mkdir()
        self.closed = []
        self.m.owned = lambda kind: {}
        self.m.terminate = lambda roots: self.closed.append(roots)
        for directory, name in [('Default', 'Old'), ('Profile 1', 'Ada'), ('Profile 2', 'Altken')]:
            self.m.write_json(self.m.PROFILE / directory / 'Preferences', {'profile': {'name': name}})
            (self.m.PROFILE / directory / 'Cookies').write_bytes(('private-data-' + name).encode())
        self.m.write_json(self.m.PROFILE / 'Local State', {'profile': {'info_cache': {'Default': {}, 'Profile 1': {}, 'Profile 2': {}}, 'last_used': 'Profile 1', 'last_active_profiles': ['Default', 'Profile 1', 'Profile 2'], 'profiles_order': ['Default', 'Profile 1', 'Profile 2']}, 'unrelated_setting': 42})

    def test_existing_profiles_are_discovered_without_inventing_account_names(self):
        rows = self.m.public_profiles()
        self.assertEqual([(r['number'], r['label'], r['directory']) for r in rows], [(1, 'Ada', 'Profile 1'), (2, 'Altken', 'Profile 2')])
        self.assertTrue((self.m.PROFILE / 'Default' / 'Cookies').exists())
        self.assertEqual(rows, self.m.public_profiles())

    def test_launch_does_not_restore_or_force_duplicate_windows(self):
        args = self.m.chrome_arguments('Profile 2')
        self.assertIn('--profile-directory=Profile 2', args)
        self.assertNotIn('--restore-last-session', args)
        self.assertNotIn('--new-window', args)
        self.assertNotIn('--no-sandbox', args)
        self.assertIn('--disk-cache-size=67108864', args)
        self.assertEqual(args[-1], 'chrome://newtab/')
        self.assertEqual(self.m.current_profile_directory(), 'Profile 1')

    def test_empty_install_can_create_first_profile_and_stop_without_old_accounts(self):
        self.m.PROFILE = Path(self.temp.name) / 'fresh-profiles'
        self.m.STATE = Path(self.temp.name) / 'fresh-state'
        self.assertEqual(self.m.public_profiles(), [])
        row = self.m.create_profile('My first profile')['selected_profile']
        self.assertEqual(row['number'], 1)
        self.assertEqual(row['label'], 'My first profile')
        self.assertEqual([p.name for p in self.m.profile_path(row['directory']).iterdir()], ['Preferences'])
        self.m.delete_profile(row['key'], row['key'])
        self.m.port_open = lambda port: False
        self.m.web_ready = lambda: False
        self.assertEqual(self.m.stop()['profiles'], [])
        self.assertEqual(self.m.create_profile('New first')['selected_profile']['number'], 1)

    def test_missing_saved_profile_is_reported_and_never_silently_recreated(self):
        row = self.m.public_profiles()[0]
        self.m.shutil.rmtree(self.m.profile_path(row['directory']))
        self.assertFalse(self.m.public_profiles()[0]['available'])
        self.assertFalse(self.m.profile_path(row['directory']).exists())

    def test_reconnect_preserves_healthy_browser_and_desktop(self):
        identities = {'chrome': {10: {'born': '1'}}, 'desktop': {20: {'born': '2'}}, 'bridge': {30: {'born': '3'}}}
        self.m.owned = lambda kind: identities[kind]
        self.m.vnc_ready = lambda: True
        self.m.web_ready = lambda: True
        self.m.same_process = lambda pid, record: True
        def forbidden(*args, **kwargs):
            raise AssertionError('Healthy reconnect must not start, stop, or access account data')
        self.m.terminate = forbidden
        self.m.subprocess = types.SimpleNamespace(Popen=forbidden, run=forbidden)
        self.m.public_profiles = forbidden
        result = self.m.reconnect()
        self.assertTrue(result['browser_preserved'])
        self.assertFalse(result['bridge_restarted'])
        self.assertEqual(result['chrome'], [10])
        self.assertEqual(result['desktop'], [20])

    def test_launch_rejects_existing_browser_for_same_or_different_profile(self):
        identities = {'chrome': {10: {'born': '1', 'display': ':31'}}, 'desktop': {}, 'bridge': {}}
        self.m.owned = lambda kind: identities[kind]
        def forbidden(*args, **kwargs):
            raise AssertionError('Another browser must not start, switch, or close')
        self.m.subprocess = types.SimpleNamespace(Popen=forbidden, run=forbidden)
        self.m.terminate = forbidden
        for profile in self.m.public_profiles():
            with self.assertRaisesRegex(RuntimeError, 'BROWSER_ALREADY_RUNNING'):
                self.m.start(profile['key'])

    def test_stop_preserves_profile_bytes_and_only_terminates_identified_processes(self):
        before = {str(p.relative_to(self.m.PROFILE)): p.read_bytes() for p in self.m.PROFILE.rglob('*') if p.is_file()}
        identities = {kind: {pid: {'born': str(pid)}} for kind, pid in [('chrome', 10), ('desktop', 20), ('bridge', 30)]}
        self.m.owned = lambda kind: identities[kind]
        calls = []
        def terminate(roots):
            calls.extend(roots)
            for kind in identities:
                identities[kind] = {pid: record for pid, record in identities[kind].items() if pid not in roots}
        self.m.terminate = terminate
        self.m.port_open = lambda port: False
        self.m.web_ready = lambda: False
        self.assertEqual(self.m.stop()['chrome'], [])
        self.assertEqual(calls, [10, 30, 20])
        after = {str(p.relative_to(self.m.PROFILE)): p.read_bytes() for p in self.m.PROFILE.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_reconnect_does_not_start_a_closed_browser(self):
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_NOT_RUNNING'):
            self.m.reconnect()
        self.assertEqual(self.closed, [])

    def test_reconnect_does_not_restart_a_missing_desktop(self):
        self.m.owned = lambda kind: {10: {'born': '1'}} if kind == 'chrome' else {}
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_DESKTOP_UNAVAILABLE'):
            self.m.reconnect()
        self.assertEqual(self.closed, [])

    def test_new_profile_is_empty_and_label_is_not_a_path(self):
        row = self.m.create_profile('\u5de5\u4f5c / $(name)')['selected_profile']
        path = self.m.profile_path(row['directory'])
        self.assertEqual(row['number'], 3)
        self.assertEqual([p.name for p in path.iterdir()], ['Preferences'])
        self.assertEqual(json.loads((path / 'Preferences').read_text())['profile']['name'], '\u5de5\u4f5c / $(name)')
        self.assertEqual((self.m.PROFILE / 'Profile 2' / 'Cookies').read_bytes(), b'private-data-Altken')

    def test_delete_renumbers_without_moving_other_profiles(self):
        first = self.m.public_profiles()
        new = self.m.create_profile('Third')['selected_profile']
        keep_path = self.m.profile_path(new['directory'])
        (keep_path / 'Cookies').write_bytes(b'third-account-data')
        result = self.m.delete_profile(first[1]['key'], first[1]['key'])
        self.assertEqual([(p['number'], p['label']) for p in result['profiles']], [(1, 'Ada'), (2, 'Third')])
        self.assertEqual(result['profiles'][1]['directory'], new['directory'])
        self.assertEqual(result['profiles'][1]['key'], new['key'])
        self.assertEqual((keep_path / 'Cookies').read_bytes(), b'third-account-data')
        self.assertFalse((self.m.PROFILE / 'Profile 2').exists())
        self.assertTrue((self.m.PROFILE / 'Default' / 'Cookies').exists())
        self.assertEqual(self.m.create_profile('Fourth')['selected_profile']['number'], 3)
        state = json.loads((self.m.PROFILE / 'Local State').read_text())
        self.assertEqual(state['unrelated_setting'], 42)
        self.assertNotIn('Profile 2', state['profile']['info_cache'])
        self.assertNotIn('Profile 2', state['profile']['last_active_profiles'])
        self.assertEqual(state['profile']['last_used'], 'Profile 1')
        self.assertFalse(list(self.m.STATE.glob('delete-pending-*')))

    def test_delete_requires_exact_identity_confirmation(self):
        row = self.m.public_profiles()[0]
        with self.assertRaises(ValueError):
            self.m.delete_profile(row['key'], 'different-key')
        self.assertEqual(self.closed, [])
        self.assertTrue(self.m.profile_path(row['directory']).exists())

    def test_rename_keeps_identity_and_storage(self):
        old = self.m.public_profiles()[0]
        self.m.rename_profile(old['key'], '\u6885\u5c14')
        new = self.m.public_profiles()[0]
        self.assertEqual((new['key'], new['directory']), (old['key'], old['directory']))
        self.assertEqual(new['label'], '\u6885\u5c14')

    def test_path_escape_symlink_and_invalid_labels_are_rejected(self):
        for name in ('..', '../other', '/tmp/other', 'System Profile', 'Guest Profile'):
            with self.assertRaises(ValueError):
                self.m.profile_path(name)
        outside = Path(self.temp.name) / 'outside'
        outside.mkdir()
        (self.m.PROFILE / 'link').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.m.profile_path('link')
        for label in ('', 'x' * 41, 'a\nb'):
            with self.assertRaises(ValueError):
                self.m.create_profile(label)

    def test_failed_metadata_write_restores_selected_profile(self):
        rows = self.m.public_profiles()
        old_state = json.loads((self.m.PROFILE / 'Local State').read_text())
        original_write = self.m.write_json
        failed = []
        def fail_once(path, value):
            if path == self.m.STATE / 'profiles.json' and not failed:
                failed.append(True)
                raise OSError('simulated metadata write failure')
            original_write(path, value)
        self.m.write_json = fail_once
        with self.assertRaises(OSError):
            self.m.delete_profile(rows[1]['key'], rows[1]['key'])
        self.assertEqual((self.m.PROFILE / 'Profile 2' / 'Cookies').read_bytes(), b'private-data-Altken')
        self.assertEqual(json.loads((self.m.PROFILE / 'Local State').read_text()), old_state)
        self.assertEqual(self.m.public_profiles(), rows)


    def test_active_browser_blocks_profile_deletion_without_touching_data(self):
        row = self.m.public_profiles()[0]
        self.m.owned = lambda kind: {10: {'born': 'fixture'}} if kind == 'chrome' else {}
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_PROFILE_SHARED_BUSY'):
            self.m.delete_profile(row['key'], row['key'])
        self.assertTrue(self.m.profile_path(row['directory']).exists())
        self.assertEqual(self.closed, [])

    def test_unopened_second_profile_can_be_deleted_while_first_is_running(self):
        row = self.m.create_profile('Unused second')['selected_profile']
        original = (self.m.PROFILE / 'Local State').read_bytes()
        self.m.owned = lambda kind: {10: {'args': [str(self.m.CHROME), '--profile-directory=Profile 1']}} if kind == 'chrome' else {}
        result = self.m.delete_profile(row['key'], row['key'])
        self.assertFalse(result['chrome_closed'])
        self.assertFalse(self.m.profile_path(row['directory']).exists())
        self.assertEqual((self.m.PROFILE / 'Local State').read_bytes(), original)
        self.assertEqual((self.m.PROFILE / 'Profile 1' / 'Cookies').read_bytes(), b'private-data-Ada')
        self.assertEqual(self.closed, [])

    def test_running_target_or_previously_used_managed_profile_is_protected(self):
        row = self.m.create_profile('Target')['selected_profile']
        self.m.owned = lambda kind: {10: {'args': ['chrome', '--profile-directory=' + row['directory']]}} if kind == 'chrome' else {}
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_PROFILE_SHARED_BUSY'):
            self.m.delete_profile(row['key'], row['key'])
        self.m.owned = lambda kind: {10: {'args': ['chrome', '--profile-directory=Profile 1']}} if kind == 'chrome' else {}
        (self.m.profile_path(row['directory']) / 'Cookies').write_bytes(b'preserve')
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_PROFILE_SHARED_BUSY'):
            self.m.delete_profile(row['key'], row['key'])
        self.assertEqual(self.closed, [])


class BrowserSupervisionTests(unittest.TestCase):
    def setUp(self):
        self.m = types.ModuleType('supervisor_under_test')
        exec(compile(MANAGER_SOURCE, 'remote_browser.py', 'exec'), self.m.__dict__)
        self.identities = {'chrome': {}, 'desktop': {20: {'born': '2'}}, 'bridge': {30: {'born': '3'}}}
        self.m.owned = lambda kind: dict(self.identities[kind])
        self.m.find_profile = lambda key: {'key': key, 'directory': 'Fixture', 'available': True}
        self.closed = []
        self.m.terminate = lambda roots: self.closed.extend(roots)

    def open_session(self):
        data = b'{"action":"open","url":"https://claude.ai/oauth/authorize?state=fixture"}\n'
        with patch.object(self.m.os, 'dup', return_value=999), patch.object(self.m.os, 'fdopen', return_value=io.BytesIO(data)), patch.object(self.m.select, 'select', side_effect=lambda readers, *args: (readers, [], [])):
            self.m.session('fixture')

    def test_existing_browser_is_never_taken_over(self):
        self.identities['chrome'][10] = {'born': '1'}
        self.m.start = lambda key: self.fail('Must not start or inspect real profiles')
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_BUSY'):
            self.m.session('fixture')
        self.assertEqual(self.closed, [])

    def test_eof_preserves_preexisting_display_and_bridge(self):
        self.m.start = lambda *args: self.fail('EOF before authorization must not start a browser')
        frames = io.StringIO()
        with patch.object(self.m.os, 'dup', return_value=999), patch.object(self.m.os, 'fdopen', return_value=io.BytesIO(b'')), patch.object(self.m.select, 'select', side_effect=lambda readers, *args: (readers, [], [])), contextlib.redirect_stdout(frames):
            self.m.session('fixture')
        self.assertEqual(self.closed, [])
        self.assertEqual(json.loads(frames.getvalue().splitlines()[-1]), {'cleanup': 'confirmed'})

    def test_partial_startup_failure_cleans_only_new_processes(self):
        def start(key, initial_url=None):
            self.identities['chrome'][10] = {'born': '1'}
            raise RuntimeError('fixture startup failure')
        self.m.start = start
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(RuntimeError, 'fixture startup failure'):
            self.open_session()
        self.assertEqual(self.closed, [10])

    def test_cleanup_failure_is_not_reported_as_confirmed(self):
        def start(key, initial_url=None):
            self.identities['chrome'][10] = {'born': '1'}
            raise RuntimeError('fixture failure')
        self.m.start = start
        self.m.terminate = lambda roots: (_ for _ in ()).throw(RuntimeError('fixture denied'))
        frames = io.StringIO()
        with contextlib.redirect_stdout(frames), self.assertRaises(RuntimeError):
            self.open_session()
        self.assertEqual(json.loads(frames.getvalue().splitlines()[-1])['cleanup'], 'unconfirmed')

    def test_reused_pid_is_never_signalled(self):
        actual = types.ModuleType('termination_under_test')
        exec(compile(MANAGER_SOURCE, 'remote_browser.py', 'exec'), actual.__dict__)
        actual.processes = lambda: {10: {'born': 'different', 'parent': 1}}
        with patch.object(actual.os, 'kill', side_effect=AssertionError('Reused PID must not be signalled')):
            actual.terminate({10: {'born': 'original', 'parent': 1}})


if __name__ == '__main__':
    unittest.main(verbosity=2)
