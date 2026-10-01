"""Linux fault injection against real retention dispatch and synthetic files only."""
import base64
import contextlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/vps-account-broker'))
import cli_policies
import resources
import session_storage as storage


class Recovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='awb-retention-fault-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'sessions').mkdir(mode=0o700)
        self.rows = {'old': dict(sessionId='old', threadId='old-native', accountId='account', accountGeneration='ag', lastModelActivity=time.time()-90000)}
        registry = types.SimpleNamespace(lock=threading.RLock(), state={'accounts': {'account': dict(id='account', generation='ag', provider='codex')}})
        broker = types.SimpleNamespace(registry=registry, now=time.time, external_logins={}, jobs={}, authority_id='authority', generation='generation')
        self.persisted = []
        state = types.SimpleNamespace(lock=threading.RLock(), state={'sessions': self.rows}, save=lambda: self.persisted.append(json.loads(json.dumps(self.rows))))
        self.runtime = types.SimpleNamespace(broker=broker, state=state, lock=threading.RLock(), active={}, maintenance=types.SimpleNamespace(reclaim_expired=lambda ids, idle_seconds=86400: None))
        self.leases = storage.StorageLeases(self.runtime)
        self.binding = dict(provider='codex', accountId='account', accountGeneration='ag', archiveId='a'*32, sessions=['old'])
        self.enabled = True
        self.patches = contextlib.ExitStack()
        self.addCleanup(self.patches.close)
        self.patches.enter_context(patch.object(storage, 'root_for', return_value=(self.root, os.getuid())))
        self.patches.enter_context(patch.object(resources, 'broker_call', side_effect=lambda method, values: dict(self.leases.dispatch(method, values), available=True)))
        self.patches.enter_context(patch.object(resources, 'disk_headroom', return_value=True))
        self.patches.enter_context(patch.object(cli_policies, 'read', side_effect=lambda provider: dict(reclaimIdle=self.enabled)))
        self.native('old-native')
        self.native('child-native', 'old-native')
        self.native('other-native')
        self.rows['other'] = dict(sessionId='other', threadId='other-native', accountId='account', accountGeneration='ag', lastModelActivity=time.time())
        self.files = self.ok('retention/begin')['files']
        self.assertEqual(len(self.files), 2)
        self.original = {e['path']: (self.root/e['path']).read_bytes() for e in self.files}

    def native(self, ident, parent=None):
        payload = dict(id=ident)
        if parent:
            payload['parent_thread_id'] = parent
        (self.root/'sessions'/f'{ident}.jsonl').write_text(json.dumps(dict(type='session_meta', payload=payload))+'\n', encoding='utf8')

    def call(self, method, **kwargs):
        return storage.dispatch(dict(method=method, **self.binding, **kwargs))

    def ok(self, method, **kwargs):
        result = self.call(method, **kwargs)
        self.assertTrue(result['ok'], result)
        return result['value']

    def restart(self):
        self.leases = storage.StorageLeases(self.runtime)
        self.ok('retention/begin', resume=True, files=self.files)

    def assert_sources_removed(self):
        self.assertTrue(all(not (self.root/e['path']).exists() for e in self.files))
        self.assertTrue((self.root/'sessions/other-native.jsonl').exists())

    def test_partial_unlink_restarts_with_same_durable_identity(self):
        unlink = os.unlink
        removed = []
        def interrupt(target, *args, **kwargs):
            if len(removed) == 1:
                raise OSError('Synthetic disconnect during second unlink')
            unlink(target, *args, **kwargs)
            removed.append(str(target))
        with patch.object(os, 'unlink', interrupt):
            self.assertFalse(self.call('retention/commit', files=self.files)['ok'])
        self.assertEqual(len(removed), 1)
        self.assertEqual(self.persisted[-1]['old']['storageArchive'], self.binding['archiveId'])
        with self.assertRaisesRegex(RuntimeError, 'RESTORE_REQUIRED|BUSY'):
            self.leases.check_start('account', 'old')
        self.leases.check_start('account', 'other')
        self.restart()
        self.ok('retention/commit', files=self.files)
        self.assert_sources_removed()

    def test_lost_success_receipt_and_service_restart_are_idempotent(self):
        first = self.ok('retention/commit', files=self.files)
        self.assert_sources_removed()
        self.restart()
        retry = self.ok('retention/commit', files=self.files)
        self.assertEqual(retry, first)
        self.assert_sources_removed()

    def test_disabling_policy_before_commit_never_deletes_sources(self):
        self.enabled = False
        result = self.call('retention/commit', files=self.files)
        self.assertEqual(result.get('error'), 'STORAGE_DISABLED')
        self.assertEqual({p: (self.root/p).read_bytes() for p in self.original}, self.original)
        self.assertNotIn('storageArchive', self.rows['old'])

    def test_native_write_after_manifest_blocks_mark_and_all_deletions(self):
        target = self.root/self.files[-1]['path']
        with target.open('ab') as stream:
            stream.write(b'new native work\n')
        result = self.call('retention/commit', files=self.files)
        self.assertEqual(result.get('error'), 'STORAGE_CHANGED')
        self.assertTrue(all((self.root/p).exists() for p in self.original))
        self.assertNotIn('storageArchive', self.rows['old'])

    def test_native_restore_recovers_from_partial_upload_and_process_restart(self):
        self.ok('retention/commit', files=self.files)
        self.ok('retention/release')
        self.ok('retention/begin', restore=True, files=self.files)
        entry = self.files[0]
        raw = self.original[entry['path']]
        self.ok('retention/write', entry=entry, offset=0, data=base64.b64encode(raw[:10]).decode())
        self.leases = storage.StorageLeases(self.runtime)
        self.ok('retention/begin', restore=True, files=self.files)
        for entry in self.files:
            raw = self.original[entry['path']]
            # Retry the same acknowledged prefix, then finish the rest.
            for offset, chunk in ((0, raw[:10]), (10, raw[10:])):
                self.ok('retention/write', entry=entry, offset=offset, data=base64.b64encode(chunk).decode())
        self.ok('retention/restored', files=self.files)
        self.assertEqual({p: (self.root/p).read_bytes() for p in self.original}, self.original)
        self.leases.check_start('account', 'old')
        self.assertFalse(list(self.root.rglob('*.awb-*')))

    def test_abandoned_restore_chunks_reclaim_without_touching_other_archives(self):
        self.ok('retention/commit', files=self.files)
        self.ok('retention/release')
        self.ok('retention/begin', restore=True, files=self.files)
        entry = self.files[0]
        raw = self.original[entry['path']]
        self.ok('retention/write', entry=entry, offset=0, data=base64.b64encode(raw[:10]).decode())
        foreign = self.root/(entry['path']+'.awb-'+'b'*32)
        foreign.write_bytes(b'other archive')
        self.leases = storage.StorageLeases(self.runtime)
        candidates = self.leases.dispatch('storage/candidates', dict(provider='codex'))['candidates']
        self.assertTrue(candidates[0]['restorePending'])
        self.restart()
        self.ok('retention/commit', files=self.files)
        self.assertEqual(list(self.root.rglob('*.awb-*')), [foreign])
        self.assertNotIn('storageRestorePending', self.rows['old'])

    def test_reclaimed_receipts_leave_the_queue_and_large_backlogs_are_paged(self):
        self.ok('retention/commit', files=self.files)
        self.assertEqual(self.leases.dispatch('storage/candidates', dict(provider='codex'))['candidates'], [])
        for index in range(1005):
            ident = 'pending-'+str(index)
            self.rows[ident] = dict(sessionId=ident, threadId=ident, accountId='account', accountGeneration='ag', lastModelActivity=time.time()-90000)
        first = self.leases.dispatch('storage/candidates', dict(provider='codex'))['candidates']
        second = self.leases.dispatch('storage/candidates', dict(provider='codex'))['candidates']
        self.assertEqual(len(first), 1000)
        self.assertEqual(len(second), 1000)
        self.assertEqual(len({row['sessions'][0] for row in first+second}), 1005)


if __name__ == '__main__':
    unittest.main(verbosity=2)
