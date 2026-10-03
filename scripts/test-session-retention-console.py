"""Synthetic metadata and policy checks; no native homes or credentials."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'services/vps-account-broker'))
import cli_guard
import cli_policies
import resources
import session_storage as storage
from runtime_maintenance import RuntimeMaintenance


class Console(unittest.TestCase):
    def setUp(self):
        self.now = 200000.0
        self.rows = {
            'interrupted': dict(sessionId='interrupted', accountId='a', accountGeneration='ag', threadId='native-a', lastModelActivity=self.now-7200, interrupted=True, prompt='PRIVATE FIXTURE'),
            'recent': dict(sessionId='recent', accountId='a', accountGeneration='ag', threadId='native-b', lastModelActivity=self.now-60),
            'unknown': dict(sessionId='unknown', accountId='a', accountGeneration='ag', threadId=None),
            'other': dict(sessionId='other', accountId='b', accountGeneration='bg', threadId='native-c', lastModelActivity=self.now-90000),
        }
        self.saved = 0
        self.stopped = []
        def save():
            self.saved += 1
        registry = types.SimpleNamespace(lock=threading.RLock(), state={'accounts': {'a':dict(id='a', generation='ag', provider='codex'), 'b':dict(id='b', generation='bg', provider='claude')}})
        broker = types.SimpleNamespace(registry=registry, now=lambda:self.now, authority_id='authority', generation='generation', jobs={}, external_logins={})
        self.runtime = types.SimpleNamespace(broker=broker, lock=threading.RLock(), state=types.SimpleNamespace(lock=threading.RLock(), state={'sessions':self.rows}, save=save), active={}, maintenance=types.SimpleNamespace(reclaim_expired=lambda ids, idle_seconds=86400:self.stopped.append((ids, idle_seconds))))
        self.service = storage.StorageLeases(self.runtime)

    def test_inspection_is_read_only_even_when_expired_active_or_login_busy(self):
        self.runtime.active['owned'] = dict(sessionId='interrupted')
        self.runtime.broker.jobs['login'] = {'value':dict(state='verifying', cleanup='pending')}
        before = copy.deepcopy(self.rows)
        value = self.service.dispatch('storage/sessions', dict(provider='codex', idleSeconds=3600))
        self.assertEqual(value['total'], 3)
        self.assertTrue(value['loginBusy'])
        self.assertTrue(value['sessions'][0]['eligible'])
        self.assertTrue(value['sessions'][0]['active'])
        self.assertEqual(value['sessions'][0]['dueAt'], self.now-3600)
        self.assertNotIn('PRIVATE FIXTURE', json.dumps(value))
        self.assertEqual(self.rows, before)
        self.assertEqual((self.saved, self.stopped), (0, []))

    def test_custom_interval_controls_actual_candidates_and_process_cleanup(self):
        self.assertEqual(self.service.dispatch('storage/candidates', dict(provider='codex'))['candidates'], [])
        value = self.service.dispatch('storage/candidates', dict(provider='codex', idleSeconds=3600))
        self.assertEqual([r['sessions'] for r in value['candidates']], [['interrupted']])
        self.assertEqual(self.stopped[-1], (['interrupted'], 3600))
        claude = self.service.dispatch('storage/candidates', dict(provider='claude', idleSeconds=48*3600))
        self.assertEqual(claude['candidates'], [])

    def test_list_pages_do_not_hide_sessions_above_one_thousand(self):
        for index in range(1005):
            key = 'page-'+str(index).zfill(4)
            self.rows[key] = dict(self.rows['recent'], sessionId=key)
        seen = set()
        after = ''
        while True:
            value = self.service.dispatch('storage/sessions', dict(provider='codex', after=after, limit=100))
            for row in value['sessions']:
                self.assertNotIn(row['sessionId'], seen)
                seen.add(row['sessionId'])
            if not value['nextCursor']:
                break
            after = value['nextCursor']
        self.assertEqual(len(seen), 1008)
        self.assertEqual(self.saved, 0)

    def test_unknown_clock_is_not_initialized_and_clock_skew_is_visible(self):
        self.rows['recent']['lastModelActivity'] = self.now+300
        rows = {r['sessionId']:r for r in self.service.dispatch('storage/sessions', dict(provider='codex'))['sessions']}
        self.assertIsNone(rows['unknown']['dueAt'])
        self.assertEqual(rows['recent']['clockReason'], 'clock_ahead')
        self.assertIsNone(rows['recent']['dueAt'])
        self.assertNotIn('lastModelActivity', self.rows['unknown'])

    def test_longer_policy_rechecks_before_authorizing_deletion(self):
        binding = dict(provider='codex', accountId='a', accountGeneration='ag', archiveId='a'*32, sessions=['interrupted'], idleSeconds=3600)
        self.service.dispatch('storage/begin', binding)
        with self.assertRaisesRegex(RuntimeError, 'STORAGE_NOT_DUE'):
            self.service.dispatch('storage/mark', dict(binding, idleSeconds=86400, manifestHash='b'*64))
        self.assertNotIn('storageArchive', self.rows['interrupted'])

    def test_metadata_arguments_are_bounded(self):
        self.service.dispatch('storage/sessions', dict(provider='codex', limit=100, idleSeconds=8761*3600))
        for invalid in [dict(limit=0), dict(limit=101), dict(limit=True), dict(after='x'*257), dict(idleSeconds=True), dict(idleSeconds=1)]:
            with self.assertRaises(RuntimeError):
                self.service.dispatch('storage/sessions', dict(provider='codex', **invalid))

    def test_root_inspection_passes_policy_without_scanning_native_files(self):
        calls = []
        def broker(method, params):
            calls.append((method, params))
            return dict(available=False)
        with patch.object(cli_policies, 'read', return_value=dict(revision=0, autoUpdate=False, reclaimIdle=False, idleHours=48)), patch.object(resources, 'broker_call', side_effect=broker), patch.object(storage, 'root_for', side_effect=AssertionError('Must not read native homes')):
            result = storage.dispatch(dict(method='retention/inspect', provider='codex', limit=50))
        self.assertTrue(result['ok'])
        self.assertFalse(result['value']['available'])
        self.assertEqual(result['value']['policy']['idleHours'], 48)
        self.assertEqual(calls[0][0], 'storage/sessions')
        self.assertEqual(calls[0][1]['idleSeconds'], 48*3600)

    def test_custom_hours_fail_closed_against_an_old_running_daemon(self):
        calls = []
        def old(method, params):
            calls.append(method)
            return dict(available=True, candidates=[])
        with patch.object(cli_policies, 'read', return_value=dict(revision=1, autoUpdate=False, reclaimIdle=True, idleHours=48)), patch.object(resources, 'broker_call', side_effect=old):
            result = storage.dispatch(dict(method='retention/candidates', provider='codex'))
        self.assertEqual(result, dict(ok=False, error='STORAGE_POLICY_UNSUPPORTED'))
        self.assertEqual(calls, ['storage/sessions'])

    def test_custom_hours_are_verified_and_forwarded_to_the_current_daemon(self):
        calls = []
        def current(method, params):
            calls.append((method, params))
            return dict(available=True, **self.service.dispatch(method, params))
        with patch.object(cli_policies, 'read', return_value=dict(revision=1, autoUpdate=False, reclaimIdle=True, idleHours=1)), patch.object(resources, 'broker_call', side_effect=current):
            result = storage.dispatch(dict(method='retention/candidates', provider='codex'))
        self.assertTrue(result['ok'])
        self.assertEqual(result['value']['candidates'][0]['sessions'], ['interrupted'])
        self.assertEqual([p['idleSeconds'] for _, p in calls], [3600, 3600])


class Policy(unittest.TestCase):
    def test_policy_defaults_independence_cas_and_hour_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(cli_policies, 'ROOT', Path(folder)/'policies'), patch.object(cli_guard, 'LOCK_ROOT', str(Path(folder)/'locks')):
                self.assertEqual(cli_policies.read('codex')['idleHours'], 24)
                first = cli_policies.configure('codex', 0, dict(idleHours=1, reclaimIdle=True))
                self.assertEqual(first['idleHours'], 1)
                self.assertEqual(cli_policies.read('claude')['idleHours'], 24)
                with self.assertRaisesRegex(RuntimeError, 'CLI_POLICY_CHANGED'):
                    cli_policies.configure('codex', 0, dict(idleHours=48))
                for value in [0, True, 1.5, '12', float('inf')]:
                    with self.assertRaisesRegex(RuntimeError, 'CLI_POLICY_INVALID'):
                        cli_policies.configure('codex', 1, dict(idleHours=value))
                self.assertEqual(cli_policies.read('codex'), first)
                self.assertEqual(cli_policies.configure('codex', 1, dict(idleHours=8761))['idleHours'], 8761)


if __name__ == '__main__':
    unittest.main(verbosity=2)
