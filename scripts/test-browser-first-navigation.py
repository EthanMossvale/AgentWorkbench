"""Linux synthetic manager input: no browser, login, profile or network access."""
import contextlib
import io
import json
from pathlib import Path
import types
import unittest
import sys
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'services/vps-browser/remote_browser.py'
sys.path.insert(0, str(SOURCE.parent))
URL = 'https://claude.ai/oauth/authorize?state=fixture-only'


class FirstNavigation(unittest.TestCase):
    def setUp(self):
        self.m = types.ModuleType('navigation_fixture')
        exec(compile(SOURCE.read_text(encoding='utf-8'), str(SOURCE), 'exec'), self.m.__dict__)
        self.processes = {'chrome': {}, 'desktop': {20: {'born': 'preexisting'}}, 'bridge': {30: {'born': 'preexisting'}}}
        self.m.owned = lambda kind: dict(self.processes[kind])
        self.m.find_profile = lambda key: {'key': key, 'directory': 'Fixture', 'available': True}
        self.started, self.closed, self.reopened = [], [], []
        def start(key, initial_url=None):
            self.started.append((key, initial_url))
            self.processes['chrome'][10] = {'born': 'created'}
        self.m.start = start
        self.m.terminate = lambda roots: self.closed.extend(roots)
        self.m.subprocess = types.SimpleNamespace(run=lambda args, **kwargs: (self.reopened.append(args) or types.SimpleNamespace(returncode=0)), DEVNULL=-3)

    def session(self, messages):
        frames = io.StringIO()
        data = ''.join(json.dumps(message) + '\n' for message in messages).encode()
        with patch.object(self.m.os, 'dup', return_value=999), patch.object(self.m.os, 'fdopen', return_value=io.BytesIO(data)), patch.object(self.m.select, 'select', side_effect=lambda readers, *args: (readers, [], [])), contextlib.redirect_stdout(frames):
            self.m.session('fixture-key')
        return [json.loads(line) for line in frames.getvalue().splitlines()]

    def test_eof_before_authorization_does_not_start_a_blank_browser(self):
        frames = self.session([])
        self.assertEqual(self.started, [])
        self.assertEqual(self.closed, [])
        self.assertEqual(frames[0], {'ready': True, 'profileKey': 'fixture-key', 'viewerReady': False})
        self.assertEqual(frames[-1], {'cleanup': 'confirmed'})

    def test_first_authorization_is_the_first_browser_page(self):
        frames = self.session([{'action': 'heartbeat'}, {'action': 'open', 'url': URL}])
        self.assertEqual(self.started, [('fixture-key', URL)])
        self.assertEqual(self.reopened, [])
        self.assertEqual(self.closed, [10])
        self.assertEqual(frames[1], {'opened': True})

    def test_duplicate_authorization_does_not_create_another_tab(self):
        self.session([{'action': 'open', 'url': URL}, {'action': 'open', 'url': URL}])
        self.assertEqual(self.started, [('fixture-key', URL)])
        self.assertEqual(self.reopened, [])

    def test_changed_native_authorization_opens_once_in_existing_profile(self):
        next_url = URL + '&scope=fixture'
        self.session([{'action': 'open', 'url': URL}, {'action': 'open', 'url': next_url}])
        self.assertEqual(self.started, [('fixture-key', URL)])
        self.assertEqual(len(self.reopened), 1)
        self.assertEqual(self.reopened[0][-1], next_url)
        self.assertIn('--profile-directory=Fixture', self.reopened[0])

    def test_invalid_authorization_never_starts_browser(self):
        with self.assertRaisesRegex(ValueError, 'INVALID_AUTH_URL'):
            self.session([{'action': 'open', 'url': 'https://fixture.invalid/oauth/authorize'}])
        self.assertEqual(self.started, [])
        self.assertEqual(self.closed, [])

    def test_manual_launch_uses_native_new_tab_and_login_url_is_validated(self):
        self.assertEqual(self.m.chrome_arguments('Fixture')[-1], 'chrome://newtab/')
        self.assertEqual(self.m.chrome_arguments('Fixture', URL)[-1], URL)
        with self.assertRaisesRegex(ValueError, 'INVALID_AUTH_URL'):
            self.m.chrome_arguments('Fixture', 'file:///fixture')

    def test_current_subscription_host_and_path_are_an_exact_pair(self):
        current = 'https://claude.com/cai/oauth/authorize?state=fixture-only'
        self.assertEqual(self.m.chrome_arguments('Fixture', current)[-1], current)
        for url in ('https://claude.com/oauth/authorize?state=fixture',
                    'https://claude.ai/cai/oauth/authorize?state=fixture',
                    'https://claude.com.evil.invalid/cai/oauth/authorize?state=fixture',
                    'https://claude.com@evil.invalid/cai/oauth/authorize?state=fixture',
                    'https://claude.com:444/cai/oauth/authorize?state=fixture',
                    'https://claude.com/cai/oauth/authorize?state=fixture\x07',
                    'https://claude.com/cai/oauth/authorize?state=fixture\x7f'):
            with self.assertRaises(ValueError):
                self.m.authorization_url(url)

    def test_legacy_authorization_endpoints_remain_supported(self):
        for host in ('claude.ai', 'console.anthropic.com', 'platform.claude.com'):
            for suffix in ('/oauth/authorize?state=fixture', ':443/oauth/authorize/?state=fixture'):
                url = 'https://' + host + suffix
                self.assertEqual(self.m.authorization_url(url), url)


if __name__ == '__main__':
    unittest.main(verbosity=2)
