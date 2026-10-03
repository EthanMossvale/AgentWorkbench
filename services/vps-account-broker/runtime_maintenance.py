"""Reclaim only registered native runtime handles, using their existing guards."""
import threading
import time
import uuid
import os
from pathlib import Path


class RuntimeMaintenance:
    interval = 30
    timeout = 120

    def __init__(self, runtime, clock=time.monotonic):
        self.runtime, self.clock = runtime, clock
        self.handles = {}
        self.lock = threading.RLock()
        self.stopped = threading.Event()
        self.worker = None
        self.low_samples = 0
        self.last_reclaim = 0
        self.last_result = None

    def attach(self, key, fence, pipe, process, stop, done, protocol='codex'):
        with self.lock:
            self.handles[key] = dict(fence=fence, pipe=pipe, process=process, stop=stop, done=done,
                                     nextProbe=self.clock()+self.interval, probe=None, closing=False, protocol=protocol)

    def observe(self, key, value):
        with self.lock:
            entry = self.handles.get(key)
            if entry and entry['probe'] and value.get('id') == entry['probe'][0]:
                # Either a response or an RPC error proves the native loop is alive.
                entry.update(probe=None, nextProbe=self.clock()+self.interval)
                return True
        return False

    def detach(self, key):
        with self.lock:
            self.handles.pop(key, None)

    def quarantine(self, key):
        with self.lock:
            entry = self.handles.get(key)
            if entry:
                entry.update(closing=True, cleanupNeeded=True)

    @staticmethod
    def empty_service_group():
        """Prove a legacy receipt has no surviving process after service restart.

        Only inspect this dedicated service's cgroup. Never scan or terminate
        browser groups, unrelated services, or processes selected by name.
        """
        try:
            group = next(line.split(':', 2)[2] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
            if group != '/system.slice/agent-workbench-accounts.service':
                return False
            pids = {int(v) for v in (Path('/sys/fs/cgroup') / group.lstrip('/') / 'cgroup.procs').read_text().split()}
            return pids == {os.getpid()}
        except (OSError, ValueError, StopIteration):
            return False

    def settle_orphans(self):
        with self.runtime.lock, self.runtime.state.lock:
            if self.runtime.active or not self.empty_service_group():
                return
            changed = False
            for receipt in self.runtime.state.state['sessions'].values():
                if any(receipt.get(k) for k in ('active', 'uncertain', 'rootPending', 'forkUncertain', 'forkAwaitingInput', 'activeChildren')):
                    receipt.update(active=False, uncertain=False, rootPending=False, forkUncertain=False, forkAwaitingInput=False,
                                   activeChildren=[], interrupted=True, cleanupConfirmed=True, closeReason='service_restart')
                    changed = True
            if changed:
                self.runtime.state.save()

    @staticmethod
    def idle(entry):
        fence, receipt = entry['fence'], entry['fence'].receipt
        return not (entry['closing'] or fence.pending or fence.approvals or any(receipt.get(k) for k in
                    ('active', 'uncertain', 'rootPending', 'forkUncertain', 'activeChildren')))

    def reclaim(self, provider=None, idle_seconds=0):
        closed, protected, pending = [], 0, []
        with self.lock:
            entries = list(self.handles.items())
        for key, entry in entries:
            with entry['fence'].lock:
                receipt = entry['fence'].receipt
                account = self.runtime.broker.registry.state['accounts'].get(receipt.get('accountId'), {})
                if provider and account.get('provider') != provider or idle_seconds and time.time()-receipt.get('lastActivity', time.time()) < idle_seconds:
                    continue
                if not self.idle(entry):
                    protected += 1
                    continue
                entry['closing'] = True
                entry['fence'].receipt['closeReason'] = 'idle_memory_reclaim'
                entry['stop']()
                pending.append(entry)
        # Never hold runtime/fence locks while waiting for the stream's cleanup.
        deadline = self.clock()+15
        for entry in pending:
            if entry['done'].wait(max(0, deadline-self.clock())) and entry['fence'].receipt.get('cleanupConfirmed'):
                closed.append(entry['fence'].receipt['sessionId'])
        result = dict(closed=closed, protected=protected, pending=len(pending)-len(closed))
        self.last_result = dict(result, observedAt=time.time())
        return result

    def snapshot(self):
        with self.lock:
            entries = list(self.handles.values())
        rows = []
        for entry in entries:
            with entry['fence'].lock:
                rows.append(dict(sessionId=entry['fence'].receipt['sessionId'], idle=self.idle(entry),
                                 closing=entry['closing'], health='probing' if entry['probe'] else 'responsive'))
        with self.runtime.state.lock:
            interrupted = [{k:r[k] for k in ('sessionId', 'threadId', 'turnId') if k in r} for r in self.runtime.state.state['sessions'].values()
                           if r.get('cleanupConfirmed') and r.get('interrupted') and r.get('sessionId')]
        return dict(sessions=rows, interrupted=interrupted, lastReclaim=self.last_result,
                    probeSeconds=self.interval, unresponsiveSeconds=self.timeout)

    def reclaim_expired(self, session_ids, idle_seconds=86400):
        from session_idle import idle_status
        with self.lock:
            entries = list(self.handles.values())
        pending = []
        for entry in entries:
            with entry['fence'].lock:
                receipt = entry['fence'].receipt
                if receipt['sessionId'] not in session_ids or entry['closing'] or not idle_status(receipt, idle_seconds=idle_seconds)['eligible']:
                    continue
                entry['closing'] = True
                receipt['closeReason'] = 'idle_session_expired'
                entry['stop']()
                pending.append(entry)
        deadline = self.clock()+15
        for entry in pending:
            entry['done'].wait(max(0, deadline-self.clock()))

    def tick(self):
        self.settle_orphans()
        with self.lock:
            entries = list(self.handles.items())
        for key, entry in entries:
            if entry.get('cleanupNeeded'):
                try:
                    self.runtime.stop(entry['process'])
                    with entry['fence'].lock:
                        entry['fence'].receipt.update(active=False, uncertain=False, rootPending=False, forkUncertain=False, activeChildren=[], interrupted=True, cleanupConfirmed=True)
                        entry['fence'].persist()
                    with self.runtime.lock:
                        self.runtime.active.pop(key, None)
                    entry['done'].set()
                    self.detach(key)
                except Exception:
                    pass
                continue
            if entry['closing']:
                continue
            with entry['fence'].lock:
                if entry['fence'].receipt.get('uncertain') or entry['fence'].receipt.get('forkUncertain'):
                    entry['closing'] = True
                    entry['fence'].receipt['closeReason'] = 'native_result_unconfirmed'
                    entry['stop']()
                    continue
            # Claude has no documented config/read health RPC. Its owned stream,
            # disconnect and explicit cancellation provide lifecycle evidence.
            if entry.get('protocol') == 'claude':
                continue
            now = self.clock()
            with self.lock:
                probe = entry['probe']
                expired = probe and now-probe[1] >= self.timeout
                if not probe and now >= entry['nextProbe']:
                    probe = ('health-'+uuid.uuid4().hex, now)
                    entry['probe'] = probe
                    send = True
                else:
                    send = False
            if expired:
                with entry['fence'].lock:
                    entry['closing'] = True
                    entry['fence'].receipt['closeReason'] = 'native_unresponsive'
                    entry['stop']()
            elif send:
                try:
                    entry['pipe'].send(dict(id=probe[0], method='config/read', params={'includeLayers': False}))
                except Exception:
                    with entry['fence'].lock:
                        entry['closing'] = True
                        entry['fence'].receipt['closeReason'] = 'native_disconnected'
                        entry['stop']()
        import resources
        if resources.policy()['autoMemory'] and resources.pressure(resources.metrics()):
            self.low_samples += 1
            if self.low_samples >= 3 and self.clock()-self.last_reclaim >= 120:
                self.last_reclaim = self.clock()
                self.reclaim()
        else:
            self.low_samples = 0

    def admit(self):
        # Resource pressure remains visible in metrics; admission is user-owned.
        pass

    def start(self):
        if self.worker:
            return
        def run():
            while not self.stopped.wait(15):
                try:
                    self.tick()
                except Exception:
                    # An unavailable sample is not permission to kill processes.
                    self.low_samples = 0
        self.worker = threading.Thread(target=run, daemon=True, name='runtime-maintenance')
        self.worker.start()

    def close(self):
        self.stopped.set()
