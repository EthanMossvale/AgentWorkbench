"""Isolated Linux acceptance; no real accounts, credentials, browser or VPS."""
import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/vps-account-broker'))
import cli_guard
import cli_policies
import cli_management
import resources
import remote_files as files
import session_storage as storage
from runtime import NativeAccountRuntime, CodexSessionFence
from runtime_maintenance import RuntimeMaintenance


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='awb-resources-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patches = contextlib.ExitStack(); self.addCleanup(self.patches.close)
        for module, key, value in [(cli_guard, 'LOCK_ROOT', str(self.root/'locks')), (resources, 'ROOT', self.root/'policies'), (cli_policies, 'ROOT', self.root/'policies')]:
            self.patches.enter_context(patch.object(module, key, value))

    def test_policy_cas_and_independent_missing_cli_settings(self):
        for provider in ('codex', 'claude'):
            self.assertFalse(cli_policies.read(provider)['autoUpdate'])
        cli_policies.configure('codex', 0, dict(autoUpdate=True, reclaimIdle=True))
        self.assertFalse(cli_policies.read('claude')['reclaimIdle'])
        with self.assertRaisesRegex(RuntimeError, 'CHANGED'):
            cli_policies.configure('codex', 0, dict(reclaimIdle=False))
        self.assertTrue(cli_policies.read('codex')['reclaimIdle'])
        self.assertTrue(cli_policies.claim_update('codex', 100000))
        self.assertFalse(cli_policies.claim_update('codex', 100010))
        resources.configure(0, True)
        self.assertTrue(resources.policy()['autoMemory'])
        resources.configure(1, False)
        self.assertFalse(resources.policy()['autoMemory'])
        self.assertTrue(cli_policies.read('codex')['reclaimIdle'])

    def test_missing_cli_never_installs_on_auto_update(self):
        cli_policies.configure('codex', 0, dict(autoUpdate=True))
        with patch.object(resources, 'broker_call', return_value={}), patch.object(cli_management, 'view', return_value=dict(installed=False, managed=False, busy=False)), patch.object(cli_management, 'apply') as apply:
            self.assertEqual(cli_management.dispatch(dict(method='cli/auto-update', provider='codex'))['value']['status'], 'skipped')
            apply.assert_not_called()

    def test_real_metrics_report_available_memory_and_filesystem_space(self):
        value = resources.metrics(str(self.root))
        self.assertGreater(value['memory']['total'], 0)
        self.assertEqual(value['memory']['used']+value['memory']['available'], value['memory']['total'])
        self.assertGreater(value['storage']['total'], value['storage']['available'])

    def call(self, operation, **kwargs):
        return files.dispatch(dict(method='remote-files/'+operation, **kwargs))

    def test_file_create_edit_copy_move_download_and_remove(self):
        folder = str(self.root/'folder')
        self.assertTrue(self.call('mkdir', path=folder)['ok'])
        target = folder+'/example.txt'
        self.assertTrue(self.call('write', path=target, content='hello')['ok'])
        view = self.call('browse', path=target)['value']
        self.assertEqual(view['content'], 'hello')
        self.assertTrue(self.call('write', path=target, revision=view['revision'], content='updated')['ok'])
        self.assertEqual(self.call('write', path=target, revision=view['revision'], content='stale')['error'], 'REMOTE_FILE_CHANGED')
        view = self.call('browse', path=folder)['value']
        self.assertTrue(self.call('copy', path=folder, revision=view['revision'], destination=str(self.root/'copy'))['ok'])
        self.assertEqual((self.root/'copy/example.txt').read_text(), 'updated')
        view = self.call('browse', path=target)['value']
        reply = self.call('download', path=target, revision=view['revision'])['value']
        self.assertEqual(base64.b64decode(reply['data']), b'updated')
        self.assertTrue(self.call('move', path=target, revision=view['revision'], destination=folder+'/renamed.txt')['ok'])
        view = self.call('browse', path=folder)['value']
        self.assertFalse(self.call('remove', path=folder, revision=view['revision'])['ok'])
        self.assertTrue(self.call('remove', path=folder, revision=view['revision'], confirm=True)['ok'])
        self.assertFalse(Path(folder).exists())

    def test_remote_paths_do_not_follow_links_overwrite_or_traverse(self):
        outside = self.root/'outside'; outside.mkdir(); (outside/'keep').write_text('safe')
        link = self.root/'link'; link.symlink_to(outside, target_is_directory=True)
        self.assertFalse(self.call('write', path=str(link/'keep'), content='wrong')['ok'])
        self.assertFalse(self.call('browse', path=str(self.root/'../etc'))['ok'])
        self.assertEqual(files.parts('/proc/fixture'), ('proc', 'fixture'))
        view=self.call('browse', path=str(outside))['value']
        self.assertFalse(self.call('copy', path=str(outside), revision=view['revision'], destination=str(outside)+'//inside')['ok'])
        self.assertFalse(self.call('write', path=str(outside/'keep'), content='wrong')['ok'])
        self.assertEqual((outside/'keep').read_text(), 'safe')
        view = self.call('browse', path=str(link))['value']
        self.assertEqual(view['path'], str(outside))
        read = self.call('browse', path=str(link/'keep'))['value']
        self.assertEqual(read['content'], 'safe')
        self.assertTrue(self.call('write', path=str(link/'keep'), revision=read['revision'], content='edited')['ok'])
        self.assertEqual((outside/'keep').read_text(), 'edited')
        (outside/'keep').write_text('safe')
        self.assertTrue(self.call('remove', path=str(link), revision=files.revision(link.lstat()), confirm=True)['ok'])
        self.assertEqual((outside/'keep').read_text(), 'safe')

    def manager(self):
        state = types.SimpleNamespace(lock=threading.RLock(), state={'sessions':{}})
        broker = types.SimpleNamespace(registry=types.SimpleNamespace(state={'accounts':{'fixture':{'provider':'codex'}}}))
        runtime = types.SimpleNamespace(state=state, broker=broker, active={}, lock=threading.RLock(), stop=NativeAccountRuntime.stop)
        clock = [1000]
        manager = RuntimeMaintenance(runtime, lambda:clock[0])
        self.patches.enter_context(patch.object(resources, 'policy', return_value={'autoMemory':False}))
        return manager, clock

    def attach(self, manager, key, **receipt):
        fence = CodexSessionFence({},dict(sessionId=key, accountId='fixture', **receipt),lambda:None,lambda:None)
        done = threading.Event(); calls=[]
        def stop():
            calls.append('stop'); fence.receipt['cleanupConfirmed']=True; done.set()
        pipe=types.SimpleNamespace(send=lambda value:calls.append(value))
        manager.attach(key,fence,pipe,None,stop,done)
        return fence,calls

    def test_manual_reclaim_protects_active_children_approvals_and_pending(self):
        manager,_ = self.manager()
        idle,idle_calls=self.attach(manager,'idle')
        active,a=self.attach(manager,'active',active=True)
        child,c=self.attach(manager,'child',activeChildren=['child'])
        approval,q=self.attach(manager,'approval');approval.approvals.add(1)
        pending,p=self.attach(manager,'pending');pending.pending[1]='turn/start'
        result=manager.reclaim()
        self.assertEqual(result['closed'],['idle']);self.assertEqual(result['protected'],4)
        self.assertEqual(a+c+q+p,[])

    def test_hung_native_is_interrupted_after_bounded_probe_without_output_timeout(self):
        manager,clock = self.manager()
        fence,calls=self.attach(manager,'active',active=True)
        clock[0]+=31;manager.tick();self.assertEqual(calls[0]['method'],'config/read')
        clock[0]+=119;manager.tick();self.assertNotIn('stop',calls)
        # Slow output is not a failure if the native control loop responds.
        manager.observe('active',dict(id=calls[0]['id'], result={'config':{}}))
        clock[0]+=31;manager.tick();self.assertNotIn('stop',calls)
        clock[0]+=120;manager.tick();self.assertIn('stop',calls)
        self.assertEqual(fence.receipt['closeReason'],'native_unresponsive')

    def test_uncertain_result_closes_owned_runtime_without_indefinite_health_wait(self):
        manager,_=self.manager()
        fence,calls=self.attach(manager,'uncertain',uncertain=True)
        manager.tick()
        self.assertEqual(calls,['stop'])
        self.assertEqual(fence.receipt['closeReason'],'native_result_unconfirmed')

    def test_auto_memory_waits_for_sustained_pressure_and_respects_active_work(self):
        manager,clock=self.manager();idle,calls=self.attach(manager,'idle');active,protected=self.attach(manager,'active',active=True)
        with patch.object(resources,'policy',return_value={'autoMemory':True}),patch.object(resources,'pressure',return_value=True),patch.object(resources,'metrics',return_value={}):
            for _ in range(2):manager.tick()
            self.assertEqual(calls,[])
            manager.tick();self.assertEqual(calls,['stop']);self.assertEqual(protected,[])
            manager.admit()

    def test_restart_uncertainty_needs_empty_dedicated_service_group_then_releases(self):
        manager,_=self.manager()
        manager.runtime.state.save=lambda:None
        receipt=dict(sessionId='old',threadId='native',turnId='old-turn',uncertain=True,activeChildren=['child'])
        manager.runtime.state.state['sessions']['old']=receipt
        with patch.object(manager,'empty_service_group',return_value=False):
            manager.settle_orphans();self.assertTrue(receipt['uncertain'])
        with patch.object(manager,'empty_service_group',return_value=True):
            manager.settle_orphans()
        self.assertFalse(receipt['uncertain']);self.assertTrue(receipt['cleanupConfirmed']);self.assertTrue(receipt['interrupted'])
        self.assertEqual(manager.snapshot()['interrupted'],[dict(sessionId='old',threadId='native',turnId='old-turn')])

    def test_real_owned_process_reclamation_preserves_external_process_group(self):
        owned=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,start_new_session=True)
        external=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True)
        try:
            NativeAccountRuntime.stop(owned)
            self.assertIsNotNone(owned.poll());self.assertIsNone(external.poll())
        finally:
            external.terminate();external.wait(timeout=3)
            if owned.poll() is None:owned.kill();owned.wait()

    def test_storage_switches_guard_exact_native_bytes_for_both_providers(self):
        for provider in ('codex','claude'):
            profile=self.root/provider;profile.mkdir(mode=0o700)
            folder=profile/('sessions/2026/01' if provider=='codex' else 'projects/fixture/session/subagents');folder.mkdir(parents=True,mode=0o700)
            target=folder/'native.jsonl';raw=b'{"type":"session_meta","payload":{"id":"session"},"native":"unmodified","unicode":"\\u4f60"}\n';target.write_bytes(raw);os.utime(target,(time.time()-90000,)*2)
            (profile/'auth.json').write_text('fixture credential must remain excluded')
            rows=[dict(sessionId='managed',threadId='session')]
            entries=storage.manifest(profile,os.getuid(),provider,rows,['managed'])
            self.assertEqual(len(entries),1);entry=entries[0];self.assertEqual(entry['sha256'],hashlib.sha256(raw).hexdigest())
            binding=dict(provider=provider,accountId='fixture',accountGeneration='generation',archiveId='a'*32)
            with patch.object(storage,'root_for',return_value=(profile,os.getuid())),patch.object(resources,'broker_call',return_value={'available':True,'receipts':rows,'sessions':['managed']}),patch.object(cli_policies,'read',return_value={'reclaimIdle':True}):
                value=storage.dispatch(dict(method='retention/read',**binding,entry=entry,offset=0))
                self.assertEqual(base64.b64decode(value['value']['data']),raw)
                result=storage.dispatch(dict(method='retention/commit',**binding,files=entries));self.assertTrue(result['ok'],result)
                self.assertFalse(target.exists());self.assertTrue((profile/'auth.json').exists())
                result=storage.dispatch(dict(method='retention/write',**binding,entry=entry,offset=0,data=base64.b64encode(raw).decode()));self.assertTrue(result['ok'],result)
                self.assertEqual(target.read_bytes(),raw)
                target.write_bytes(b'concurrent modification')
                self.assertFalse(storage.dispatch(dict(method='retention/write',**binding,entry=entry,offset=0,data=base64.b64encode(raw).decode()))['ok'])

    def test_file_mtime_does_not_renew_a_proven_native_session_and_links_are_rejected(self):
        root=self.root/'profile';(root/'sessions').mkdir(parents=True,mode=0o700)
        target=root/'sessions/test.jsonl';target.write_text('{"type":"session_meta","payload":{"id":"session"}}\n')
        rows=[dict(sessionId='managed',threadId='session')]
        self.assertEqual(len(storage.manifest(root,os.getuid(),'codex',rows,['managed'])),1)
        target.unlink();target.symlink_to(self.root/'outside')
        with self.assertRaisesRegex(RuntimeError,'UNSAFE'):storage.manifest(root,os.getuid(),'codex',rows,['managed'])

    def test_expired_session_is_independent_of_active_same_account_and_status_flags(self):
        now=time.time();rows={'old':dict(sessionId='old',threadId='old-thread',accountId='account',accountGeneration='ag',lastModelActivity=now-90000,active=True,uncertain=True),
                              'recent':dict(sessionId='recent',threadId='recent-thread',accountId='account',accountGeneration='ag',lastModelActivity=now-1,active=True)}
        broker=types.SimpleNamespace(now=lambda:now,external_logins={},jobs={},authority_id='authority',generation='g',registry=types.SimpleNamespace(lock=threading.RLock(),state={'accounts':{'account':dict(id='account',generation='ag',provider='codex')}}))
        closed=[]
        runtime=types.SimpleNamespace(broker=broker,lock=threading.RLock(),state=types.SimpleNamespace(lock=threading.RLock(),state={'sessions':rows},save=lambda:None),active={'recent':dict(sessionId='recent',accountId='account')},maintenance=types.SimpleNamespace(reclaim_expired=lambda ids, idle_seconds=86400:closed.extend(ids)))
        leases=storage.StorageLeases(runtime)
        candidates=leases.dispatch('storage/candidates',dict(provider='codex'))['candidates']
        self.assertEqual([r['sessions'] for r in candidates],[['old']]);self.assertEqual(closed,['old'])
        binding=dict(provider='codex',accountId='account',accountGeneration='ag',archiveId='a'*32,sessions=['old'])
        leases.dispatch('storage/begin',binding)
        leases.check_start('account','recent')
        with self.assertRaisesRegex(RuntimeError,'STORAGE_BUSY'):leases.check_start('account','old')
        leases.dispatch('storage/mark',dict(binding,manifestHash='b'*64))
        with self.assertRaisesRegex(RuntimeError,'STORAGE_ARCHIVE_CHANGED'):
            leases.dispatch('storage/mark',dict(binding,manifestHash='c'*64))
        leases.dispatch('storage/release',binding)
        with self.assertRaisesRegex(RuntimeError,'STORAGE_RESTORE_REQUIRED'):leases.check_start('account','old')
        self.assertNotIn('storageArchive',rows['recent'])

    def test_native_fork_dependency_is_archived_but_retained_while_other_session_needs_it(self):
        root=self.root/'profile';(root/'sessions').mkdir(parents=True,mode=0o700)
        def native(name,base=None,parent=None):
            value={'type':'session_meta','payload':{'id':name}}
            if base:value['payload']['history_base']={'thread_id':base,'end_ordinal_exclusive':1,'end_byte_offset':100}
            if parent:value['payload']['parent_thread_id']=parent
            (root/'sessions'/('rollout-'+name+'.jsonl')).write_text(json.dumps(value)+'\n')
        native('base');native('branch','base');native('child',parent='base');native('unrelated')
        rows=[dict(sessionId='first',threadId='base'),dict(sessionId='second',threadId='branch'),dict(sessionId='third',threadId='unrelated')]
        first=storage.manifest(root,os.getuid(),'codex',rows,['first'])
        self.assertEqual({e['path']:e['delete'] for e in first},{'sessions/rollout-base.jsonl':False,'sessions/rollout-child.jsonl':True})
        rows[0]['storageArchive']='a'*32
        second=storage.manifest(root,os.getuid(),'codex',rows,['second'])
        self.assertEqual({e['path']:e['delete'] for e in second},{'sessions/rollout-base.jsonl':True,'sessions/rollout-branch.jsonl':True})
        self.assertTrue((root/'sessions/rollout-unrelated.jsonl').exists())

    def test_24_hour_expiry_can_stop_stale_approval_but_not_recent_activity(self):
        manager,clock=self.manager();now=time.time()
        old,calls=self.attach(manager,'old',active=True,lastModelActivity=now-90000);old.approvals.add(1)
        recent,keep=self.attach(manager,'recent',active=True,lastModelActivity=now-1)
        manager.reclaim_expired(['old','recent'])
        self.assertEqual(calls,['stop']);self.assertEqual(keep,[])
        self.assertEqual(old.receipt['closeReason'],'idle_session_expired')

    def test_custom_one_hour_expiry_reaches_the_actual_runtime_stop_guard(self):
        manager,_ = self.manager(); now=time.time()
        old,calls=self.attach(manager,'old',active=True,lastModelActivity=now-7200)
        manager.reclaim_expired(['old'])
        self.assertEqual(calls,[])
        manager.reclaim_expired(['old'],3600)
        self.assertEqual(calls,['stop'])
        self.assertEqual(old.receipt['closeReason'],'idle_session_expired')

    def test_disk_capacity_checks_actual_bytes_without_an_extra_reserve(self):
        gib=1024**3
        with patch.object(resources.os,'statvfs',return_value=types.SimpleNamespace(f_blocks=20*gib,f_bavail=3*gib,f_frsize=1)):
            self.assertTrue(resources.disk_headroom('/',gib))
            self.assertTrue(resources.disk_headroom('/',3*gib))
            self.assertFalse(resources.disk_headroom('/',3*gib+1))


if __name__=='__main__':
    assert os.geteuid()==0, 'Use the isolated Linux fixture runner.'
    unittest.main(verbosity=2)
