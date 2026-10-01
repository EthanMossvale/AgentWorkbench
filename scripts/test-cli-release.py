"""Read-only release discovery regression tests; no installers or logins run."""
import hashlib
import io
import json
from pathlib import Path
import socket
import ssl
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/vps-account-broker'))
import native_install as native


class Response(io.BytesIO):
    def __init__(self, data=b'', size=128):
        super().__init__(data)
        self.headers = {'Content-Length': str(size)}


class Releases(unittest.TestCase):
    def setUp(self):
        native.RELEASES.clear()
        self.addCleanup(native.RELEASES.clear)
        self.requests = []
        self.installer = b'#!/bin/sh\nexit 0\n'
        self.codex_url = 'https://releases.openai.com/codex/releases/9.8.7/codex-x86_64-unknown-linux-musl.tar.gz'
        self.replies = {
            'https://releases.openai.com/codex/channels/latest': json.dumps(dict(tag_name='rust-v9.8.7', assets=[dict(name='codex-x86_64-unknown-linux-musl.tar.gz', browser_download_url=self.codex_url, digest='sha256:' + 'a' * 64)])).encode(),
            'https://downloads.claude.ai/claude-code-releases/latest': b'9.8.7\n',
            'https://downloads.claude.ai/claude-code-releases/9.8.7/manifest.json': json.dumps(dict(version='9.8.7', platforms={'linux-x64': dict(binary='claude', checksum='b' * 64, size=128)})).encode(),
            'https://chatgpt.com/codex/install.sh': self.installer,
            'https://claude.ai/install.sh': self.installer,
            self.codex_url: b'',
        }
        self.opener = patch.object(native, 'build_opener', return_value=self)
        self.opener.start(); self.addCleanup(self.opener.stop)
        self.machine = patch.object(native.platform, 'machine', return_value='x86_64')
        self.machine.start(); self.addCleanup(self.machine.stop)
        self.libc = patch.object(native.platform, 'libc_ver', return_value=('glibc', '2.39'))
        self.libc.start(); self.addCleanup(self.libc.stop)

    def open(self, request, **kwargs):
        # Reproduce the observed CDN rejection of the former default identity.
        if not isinstance(request, Request) or not request.get_header('User-agent', '').startswith('AgentWorkbench/'):
            raise HTTPError('https://fixture.invalid', 403, 'Forbidden', {}, None)
        self.requests.append((request.full_url, request.method))
        value = self.replies[request.full_url]
        if isinstance(value, Exception):
            raise value
        return Response(value)

    def test_both_official_flows_and_head_identify_workbench(self):
        for provider in ('codex', 'claude'):
            item = native.artifact(provider)
            self.assertEqual(item['version'], '9.8.7')
            self.assertEqual(item['installerSha256'], hashlib.sha256(self.installer).hexdigest())
            self.assertEqual(item['size'], 128)
        self.assertIn((self.codex_url, 'HEAD'), self.requests)
        self.assertEqual(len(self.requests), 6)

    def test_http_failure_retains_safe_stage_and_status_without_body(self):
        url = 'https://claude.ai/install.sh'
        self.replies[url] = HTTPError(url, 403, 'PRIVATE_BODY_MUST_NOT_ESCAPE', {}, None)
        with self.assertRaises(native.InstallError) as caught:
            native.artifact('claude')
        self.assertEqual(str(caught.exception), 'CLI_RELEASE_HTTP')
        self.assertEqual(caught.exception.release_issue, dict(stage='installer', source='claude.ai', httpStatus=403))
        self.assertNotIn('claude', native.RELEASES)

    def test_transport_errors_remain_distinct_and_do_not_retry(self):
        url = 'https://releases.openai.com/codex/channels/latest'
        for error, code in [(URLError(TimeoutError()), 'CLI_RELEASE_TIMEOUT'), (TimeoutError(), 'CLI_RELEASE_TIMEOUT'), (URLError(ssl.SSLCertVerificationError()), 'CLI_RELEASE_TLS'), (URLError(socket.gaierror()), 'CLI_RELEASE_NETWORK')]:
            with self.subTest(code=code):
                self.requests.clear(); self.replies[url] = error
                with self.assertRaises(native.InstallError) as caught:
                    native.artifact('codex')
                self.assertEqual(str(caught.exception), code)
                self.assertEqual(len(self.requests), 1)

    def test_invalid_release_is_not_reported_as_network(self):
        url = 'https://releases.openai.com/codex/channels/latest'
        for value in [b'<html>Unavailable</html>', b'[]', b'{"tag_name":"rust-v9.8.7","assets":null}', b'{"tag_name":"rust-v9.8.7","assets":[null]}']:
            with self.subTest(value=value):
                self.replies[url] = value
                with self.assertRaisesRegex(native.InstallError, 'CLI_RELEASE_INVALID') as caught:
                    native.artifact('codex')
                self.assertEqual(caught.exception.release_issue['stage'], 'release')

    def test_missing_checksum_and_wrong_manifest_shape_block_install(self):
        url = 'https://downloads.claude.ai/claude-code-releases/9.8.7/manifest.json'
        for platforms in [None, [], {'linux-x64': None}, {'linux-x64': {'binary': 'claude', 'size': 128}}]:
            with self.subTest(platforms=platforms):
                self.replies[url] = json.dumps(dict(version='9.8.7', platforms=platforms)).encode()
                with self.assertRaisesRegex(native.InstallError, 'CLI_RELEASE_INVALID') as caught:
                    native.artifact('claude')
                self.assertEqual(caught.exception.release_issue['stage'], 'manifest')

    def test_non_ascii_version_and_oversized_metadata_are_invalid(self):
        url = 'https://downloads.claude.ai/claude-code-releases/latest'
        for value in [b'\xff', b'9' * 129]:
            self.replies[url] = value
            with self.assertRaisesRegex(native.InstallError, 'CLI_RELEASE_INVALID'):
                native.artifact('claude')

    def test_head_rejection_identifies_asset_stage(self):
        self.replies[self.codex_url] = HTTPError(self.codex_url, 429, 'limited', {}, None)
        with self.assertRaisesRegex(native.InstallError, 'CLI_RELEASE_HTTP') as caught:
            native.artifact('codex')
        self.assertEqual(caught.exception.release_issue['stage'], 'asset')
        self.assertEqual(caught.exception.release_issue['httpStatus'], 429)

    def test_redirect_keeps_identity_and_blocks_plain_http(self):
        request = native.release_request('https://claude.ai/install.sh')
        handler = native.SecureRedirect()
        redirect = handler.redirect_request(request, None, 302, 'Found', {}, 'https://downloads.claude.ai/claude-code-releases/bootstrap.sh')
        self.assertEqual(redirect.get_header('User-agent'), native.RELEASE_USER_AGENT)
        with self.assertRaisesRegex(native.InstallError, 'CLI_DOWNLOAD_FAILED'):
            handler.redirect_request(request, None, 302, 'Found', {}, 'http://fixture.invalid/script')


if __name__ == '__main__':
    unittest.main(verbosity=2)
