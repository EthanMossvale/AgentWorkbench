"""Linux fixtures only: no real browser, SSH account, or user profile access."""
import json
import contextlib
from pathlib import Path
import sys
import types
import unittest
import subprocess
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'services/vps-account-broker'), str(ROOT / 'services/vps-browser')]
import browser_api as api
real_subprocess_run = subprocess.run


class BrowserEnvironmentTests(unittest.TestCase):
    def test_custom_environment_reaches_real_manager_subprocess(self):
        source = "from browser_environment import ENV\nimport json,sys\nprint(json.dumps([ENV,sys.argv[1]]))"
        custom = dict(api.ENV, display=':45', webPort=7045, chrome='/opt/custom/chrome')
        with patch.object(api, 'ENV', custom), patch.object(api, 'SOURCES', {'remote_browser.py': source}):
            result = real_subprocess_run(api.manager_args('profiles', {}), capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout), [custom, 'profiles'])

class BrowserControlTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.key = 'a' * 32
        self.value = dict(ok=True, chrome=[10], desktop=[20], bridge=[30], web_ready=True,
                          vnc_ready=True, browser_preserved=True, selected_profile={'key': self.key})
        contexts = contextlib.ExitStack()
        self.addCleanup(contexts.close)
        self.enter = contexts.enter_context
        self.enter(patch.object(api.os, 'geteuid', return_value=0))
        self.enter(patch.object(api, 'installed', return_value={'installed': True}))
        self.enter(patch.object(api, 'manager_args', side_effect=lambda action, options: [action, options]))
        self.enter(patch.object(api.subprocess, 'run', side_effect=self.run_manager))

    def run_manager(self, args, **kwargs):
        self.calls.append(args)
        return types.SimpleNamespace(returncode=0 if self.value['ok'] else 1, stdout=json.dumps(self.value).encode())

    def test_launch_returns_only_public_receipt_and_exact_profile(self):
        self.value['cookie'] = 'synthetic-private-marker'
        self.assertEqual(api.control({'action': 'launch', 'profileKey': self.key}),
                         {'running': True, 'profilesPreserved': True, 'profileKey': self.key})
        self.assertEqual(self.calls, [['start', {'key': self.key}]])

    def test_invalid_profile_non_root_and_unconfirmed_stop_never_dispatch(self):
        for request in ({'action': 'launch', 'profileKey': '../escape'}, {'action': 'stop'}):
            with self.assertRaises(RuntimeError):
                api.control(request)
        with patch.object(api.os, 'geteuid', return_value=1001), self.assertRaisesRegex(RuntimeError, 'ADMIN_REQUIRED'):
            api.control({'action': 'reconnect'})
        self.assertEqual(self.calls, [])

    def test_reconnect_cannot_be_substituted_by_a_new_browser(self):
        self.assertTrue(api.control({'action': 'reconnect'})['running'])
        self.assertEqual(self.calls, [['reconnect', {}]])
        self.value['browser_preserved'] = False
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_RECONNECT_FAILED'):
            api.control({'action': 'reconnect'})

    def test_second_browser_is_reported_without_retry_or_profile_change(self):
        self.value = {'ok': False, 'error': 'BROWSER_ALREADY_RUNNING'}
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_ALREADY_RUNNING'):
            api.control({'action': 'launch', 'profileKey': self.key})
        self.assertEqual(len(self.calls), 1)

    def test_stop_requires_no_remaining_browser_display_or_bridge(self):
        with self.assertRaisesRegex(RuntimeError, 'BROWSER_STOP_UNCONFIRMED'):
            api.control({'action': 'stop', 'confirm': True})
        self.value.update(chrome=[], desktop=[], bridge=[])
        with patch.object(api, 'installed', side_effect=AssertionError('Stop must work without installation probes')):
            self.assertEqual(api.control({'action': 'stop', 'confirm': True}), {'running': False, 'profilesPreserved': True})
        self.assertTrue(all(call == ['stop', {}] for call in self.calls))


if __name__ == '__main__':
    unittest.main()
