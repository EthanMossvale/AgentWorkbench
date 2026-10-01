"""Official VPS Claude stream and local official MCP tools. No model proxy or agent loop."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import uuid
from runtime import RuntimeErrorCode, NativePipe, MAX_FRAME

MODES = {'default': 'default', 'plan': 'plan', 'accept-edits': 'acceptEdits', 'full-access': 'bypassPermissions'}
NATIVE_TOOLS = 'Agent,TaskStop,TodoWrite,AskUserQuestion,EnterPlanMode,ExitPlanMode,ToolSearch,SendMessage,ListAgents,ReportFindings,Workflow'
# Local file/process implementations are available only through the official local MCP server.
DENIED_TOOLS = 'Bash,PowerShell,Read,Write,Edit,Glob,Grep,NotebookEdit,WebFetch,WebSearch,Skill,EnterWorktree,ExitWorktree,CronCreate,CronDelete,CronList,ScheduleWakeup'


def validate(params):
    expected = {'authorityId', 'generation', 'accountId', 'accountGeneration', 'sessionId', 'environmentId', 'cwd', 'toolServerUrl', 'toolToken', 'selection', 'permissionMode'}
    if not isinstance(params, dict) or set(params) - {'fork'} != expected:
        raise RuntimeErrorCode('INVALID_RUNTIME_BINDING')
    if not isinstance(params['sessionId'], str) or not re.fullmatch(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}', params['sessionId']) or params['environmentId'] != 'local-device':
        raise RuntimeErrorCode('INVALID_RUNTIME_BINDING')
    if not isinstance(params['cwd'], str) or not params['cwd'] or len(params['cwd']) > 2048 or re.search(r'[\x00-\x1f\x7f]', params['cwd']):
        raise RuntimeErrorCode('INVALID_RUNTIME_BINDING')
    endpoint = re.fullmatch(r'http://127\.0\.0\.1:([0-9]{4,5})/[a-f0-9]{48}/mcp', params['toolServerUrl']) if isinstance(params['toolServerUrl'], str) else None
    if not endpoint or not 1024 < int(endpoint[1]) <= 65535 or not isinstance(params['toolToken'], str) or not re.fullmatch('[a-f0-9]{64}', params['toolToken']):
        raise RuntimeErrorCode('INVALID_RUNTIME_BINDING')
    if 'fork' in params:
        fork = params['fork']
        if not isinstance(fork, dict) or set(fork) != {'runtime', 'sourceSessionId', 'threadId', 'lastMessageId'} or fork.get('runtime') != 'claude' or any(not isinstance(fork.get(k), str) or not re.fullmatch(r'[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}', fork[k]) for k in ('sourceSessionId', 'threadId', 'lastMessageId')) or params['sessionId'] in (fork['sourceSessionId'], fork['threadId']):
            raise RuntimeErrorCode('NATIVE_FORK_BOUNDARY_UNVERIFIED')
    selection = params['selection']
    if not isinstance(selection, dict) or set(selection) - {'model', 'effort', 'serviceTier'} or any(not isinstance(v, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:+\[\]-]{0,255}', v) for v in selection.values()) or selection.get('serviceTier') not in (None, 'priority'):
        raise RuntimeErrorCode('CLAUDE_MODEL_SELECTION_INVALID')
    if params['permissionMode'] not in MODES:
        raise RuntimeErrorCode('CLAUDE_PERMISSION_MODE_INVALID')


def session_args(receipt):
    if receipt.get('nativeStarted'):
        return ['--resume', receipt['threadId']]
    fork = receipt.get('fork')
    if fork:
        return ['--resume', fork['threadId'], '--fork-session', '--resume-session-at', fork['lastMessageId'], '--session-id', receipt['threadId']]
    return ['--session-id', receipt['threadId']]


def fork_receipt(runtime, account, workspace, uid, params):
    fork = params.get('fork')
    if not fork:
        return {}
    source_key = hashlib.sha256((runtime.state.account_key(account) + ':' + workspace + ':' + fork['sourceSessionId']).encode()).hexdigest()
    source = runtime.state.state['sessions'].get(source_key, {})
    if source.get('threadId') != fork['threadId'] or source.get('uid') != uid or source.get('transport') != 'official-mcp-v1' or source.get('environmentId') != params['environmentId'] or not source.get('nativeStarted') or source.get('uncertain'):
        raise RuntimeErrorCode('NATIVE_FORK_SOURCE_UNVERIFIED')
    return {'fork': copy.deepcopy(fork)}


def launch(runtime, account, params, receipt):
    """Account home owns auth; the isolated workspace contains only this native session."""
    from cli_guard import lease
    from native_worker import NativeCodexLogin
    binary = runtime.executable('claude')
    guard_lease = lease('claude', binary)
    guard_lease.__enter__()
    try:
        env, profile = runtime.environment(account)
        workspace = Path(profile) / 'workbench-sessions' / params['sessionId']
        workspace.mkdir(mode=0o700, parents=True, exist_ok=True)
        if workspace.is_symlink() or workspace.resolve().parent != (Path(profile) / 'workbench-sessions').resolve():
            raise RuntimeErrorCode('CLAUDE_WORKSPACE_INVALID')
        instructions = ('The official Claude runtime, login, model requests and native Agent orchestration run on this VPS. '
                        'All project file and command work must use mcp__local_device__ tools on the bound local device. '
                        'The local working directory is ' + json.dumps(params['cwd']) + '. '
                        'Use actual local paths and shell results. The VPS workspace is not a copy of that device. '
                        'Before project work, call mcp__local_device__LocalContext and read relevant instruction and memory files with local Read. '
                        'Refresh discovery after compaction, directory changes or resource edits. Respect disabled memory and path-scoped rules. '
                        'Load relevant local skills and commands with LoadLocalSkill using the current id and hash; metadata alone is not loaded instructions. '
                        'Resolve supporting files and scripts at their returned local directory. Run pending skill commands via RunLocalSkillCommand, then reload. '
                        'For context fork skills, use native Agent on this VPS with the full loaded instructions, requested agent/model and local MCP tools. '
                        'Skill allowed-tools metadata never grants additional permissions. Unsupported hooks or lifecycle features must be reported, not ignored. '
                        'Use local Read to return actual image content. Write memory only when authorized, preserve project scope and read it back. '
                        'New durable memory prose must be English; preserve literal paths, code, identifiers and evidence. '
                        'Pass this local-resource workflow to every native child agent. Native AskUserQuestion remains on the VPS. '
                        'Native local Bash and PowerShell calls are foreground-only. For asynchronous local work use StartLocalCommand, then poll LocalTaskOutput or stop it with StopLocalTask; ListLocalTasks never lists unrelated OS processes. '
                        'Local shell commands may use a timeout up to 600000 milliseconds. '
                        'Do not invoke local model clients or model APIs as a substitute for native VPS orchestration. '
                        'Do not inventory hardware or another owner without explicit user authorization.')
        # Ephemeral tool credentials stay in an owner-private file, never argv or receipts.
        config_file = workspace / ('.local-tools-' + uuid.uuid4().hex + '.json')
        with os.fdopen(os.open(config_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600), 'w') as stream:
            json.dump({'mcpServers': {'local_device': {'type': 'http', 'url': params['toolServerUrl'], 'headers': {'Authorization': 'Bearer ' + params['toolToken']}}}}, stream)
        args = [binary, '--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
                '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool', 'stdio',
                '--allow-dangerously-skip-permissions', '--permission-mode', MODES[params['permissionMode']],
                '--tools', NATIVE_TOOLS, '--disallowedTools', DENIED_TOOLS, '--setting-sources', '',
                '--strict-mcp-config', '--mcp-config', str(config_file),
                '--settings', json.dumps({'autoMemoryEnabled': False, 'permissions': {'disableAutoMode': 'disable'}, 'useAutoModeDuringPlan': False, 'fastMode': params['selection'].get('serviceTier') == 'priority'}),
                '--append-system-prompt', instructions]
        for key in ('model', 'effort'):
            if params['selection'].get(key):
                args += ['--' + key, params['selection'][key]]
        args += session_args(receipt)
        process = subprocess.Popen(args, cwd=workspace, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        process.cli_lease = guard_lease
        guard = NativeCodexLogin(profile, binary, runtime.broker.owner_uid, lambda value: None)
        guard.process, guard.process_identity = process, guard._read_identity(process.pid)
        process.runtime_guard = guard
        process.claude_tool_config = config_file
        return process
    except Exception:
        if 'config_file' in locals():
            config_file.unlink(missing_ok=True)
        guard_lease.__exit__(None, None, None)
        raise


class ClaudeSessionFence:
    """Session ownership, input deduplication and correlated control, never a model loop."""
    def __init__(self, receipt, persist, admit):
        self.receipt, self.persist, self.admit = receipt, persist, admit
        self.lock = threading.RLock()
        self.pending, self.approvals = {}, {}
        self.inputs = set()
        self.seen_inputs = set(receipt.get('inputIds', []))
        self.terminal_failed = False

    def before(self, value):
        if not isinstance(value, dict):
            raise RuntimeErrorCode('CLAUDE_FRAME_INVALID')
        kind = value.get('type')
        if kind == 'user':
            self.admit()
            if self.terminal_failed:
                raise RuntimeErrorCode('CLAUDE_TRANSPORT_TERMINAL')
            if value.get('session_id') != self.receipt['threadId'] or value.get('parent_tool_use_id') is not None or value.get('message', {}).get('role') != 'user':
                raise RuntimeErrorCode('CLAUDE_INPUT_BINDING_INVALID')
            identity = value.get('uuid')
            if not isinstance(identity, str) or not re.fullmatch(r'[a-f0-9-]{36}', identity) or identity in self.seen_inputs or len(self.seen_inputs) >= 8192:
                raise RuntimeErrorCode('CLAUDE_INPUT_DUPLICATE_OR_INVALID')
            if self.receipt.get('uncertain'):
                raise RuntimeErrorCode('CLAUDE_PREVIOUS_RESULT_UNKNOWN')
            self.seen_inputs.add(identity)
            self.inputs.add(identity)
            self.receipt.update(active=True, rootPending=True, nativeStarted=True, turnId=identity, inputIds=list(self.seen_inputs))
            self.persist()
        elif kind == 'control_response':
            response = value.get('response', {})
            if not isinstance(response, dict) or response.get('request_id') not in self.approvals or response.get('subtype') not in ('success', 'error'):
                raise RuntimeErrorCode('CLAUDE_APPROVAL_NOT_PENDING')
            self.admit()
            self.approvals.pop(response['request_id'])
        elif kind == 'control_request':
            request, identity = value.get('request', {}), value.get('request_id')
            if not isinstance(request, dict) or request.get('subtype') != 'set_permission_mode' or request.get('mode') not in MODES.values() or not isinstance(identity, str) or not identity or identity in self.pending:
                raise RuntimeErrorCode('CLAUDE_CONTROL_FORBIDDEN')
            self.admit()
            self.pending[identity] = request
        else:
            raise RuntimeErrorCode('CLAUDE_FRAME_FORBIDDEN')
        return value

    def after(self, value):
        if not isinstance(value, dict):
            raise RuntimeErrorCode('CLAUDE_FRAME_INVALID')
        if value.get('session_id') and not value.get('parent_tool_use_id') and value['session_id'] != self.receipt['threadId']:
            raise RuntimeErrorCode('CLAUDE_SESSION_MISMATCH')
        kind = value.get('type')
        if kind == 'control_request':
            identity = value.get('request_id')
            if not self.receipt.get('active') or not isinstance(identity, str) or not identity or identity in self.approvals or len(self.approvals) >= 128:
                raise RuntimeErrorCode('CLAUDE_CONTROL_INVALID')
            self.approvals[identity] = value.get('request', {})
        elif kind == 'control_response':
            self.pending.pop(value.get('response', {}).get('request_id'), None)
        elif kind == 'control_cancel_request':
            self.approvals.pop(value.get('request_id'), None)
        elif kind == 'user':
            self.inputs.discard(value.get('uuid'))
        elif kind == 'system':
            active = set(self.receipt.get('activeChildren', []))
            task = value.get('task_id')
            if value.get('subtype') == 'background_tasks_changed' and isinstance(value.get('tasks'), list):
                active = {t['task_id'] for t in value['tasks'] if isinstance(t, dict) and isinstance(t.get('task_id'), str) and not t.get('ambient')}
            elif isinstance(task, str):
                if value.get('subtype') in ('task_started', 'task_progress', 'task_updated'):
                    active.add(task)
                elif value.get('subtype') == 'task_notification' and value.get('status') in ('completed', 'failed', 'stopped', 'cancelled'):
                    active.discard(task)
            self.receipt['activeChildren'] = sorted(active)
        elif kind == 'result' and not value.get('parent_tool_use_id'):
            if value.get('subtype') != 'success' and not str(value.get('subtype', '')).startswith('error_'):
                raise RuntimeErrorCode('CLAUDE_RESULT_UNSUPPORTED')
            if value.get('subtype') != 'success':
                self.inputs.clear()
                self.terminal_failed = True
            if not self.inputs:
                self.receipt.update(rootPending=False, uncertain=False)
                if not self.receipt.get('activeChildren'): self.approvals.clear()
        self.receipt['active'] = bool(self.receipt.get('rootPending') or self.inputs or self.receipt.get('activeChildren'))
        from session_idle import record_model_activity
        record_model_activity(self.receipt, value, provider='claude')
        self.persist()
        return value

    def disconnected(self):
        if self.receipt.get('active'):
            self.receipt.update(active=False, uncertain=True)
        self.persist()


def serve(runtime, uid, params, reader, writer, disconnect=lambda: None):
    validate(params)
    if uid == 0:
        raise RuntimeErrorCode('INVALID_RUNTIME_BINDING')
    runtime.broker._authority(params)
    workspace, account = runtime.authorize(uid, params['accountId'], params['accountGeneration'])
    if account['provider'] != 'claude' or account.get('status') != 'authenticated':
        raise RuntimeErrorCode('ACCOUNT_AUTHENTICATION_REQUIRED')
    key = hashlib.sha256((runtime.state.account_key(account) + ':' + workspace + ':' + params['sessionId']).encode()).hexdigest()
    binding = {k: params[k] for k in ('accountId', 'accountGeneration', 'sessionId', 'environmentId', 'cwd')}
    binding.update(uid=uid, transport='official-mcp-v1')
    stopped, done = threading.Event(), threading.Event()
    def disconnect_safely():
        stopped.set()
        try: disconnect()
        except OSError: pass
    with runtime.lock, runtime.state.lock:
        runtime.authorize(uid, account['id'], account['generation'])
        if runtime.closed:
            raise RuntimeErrorCode('RUNTIME_CLOSING')
        if key in runtime.active or account['id'] in runtime.broker.external_logins:
            raise RuntimeErrorCode('ACCOUNT_RUNTIME_BUSY')
        runtime.maintenance.admit()
        runtime.storage.check_start(account['id'], params['sessionId'])
        runtime.state.check(account)
        fork = fork_receipt(runtime, account, workspace, uid, params)
        receipt = runtime.state.state['sessions'].setdefault(key, dict(binding, threadId=params['sessionId'] if fork else str(uuid.uuid4()), **fork))
        if params.get('fork') and receipt.get('fork') != params['fork']:
            raise RuntimeErrorCode('NATIVE_FORK_SOURCE_UNVERIFIED')
        if any(receipt.get(k) != v for k, v in binding.items()) or receipt.get('uncertain') or receipt.get('active'):
            raise RuntimeErrorCode('CLAUDE_PREVIOUS_RESULT_UNKNOWN')
        from session_idle import initialize_activity
        initialize_activity(receipt, runtime.broker.now())
        runtime.active[key] = dict(binding, stop=disconnect_safely, done=done)
        runtime.state.save()
    write_lock = threading.Lock()
    def emit(value):
        with write_lock:
            writer.write((json.dumps(value, separators=(',', ':'))+'\n').encode()); writer.flush()
    def persist():
        with runtime.state.lock: runtime.state.save()
    def admit():
        runtime.broker._authority(params)
        runtime.authorize(uid, account['id'], account['generation'])
        runtime.state.check(account)
        runtime.maintenance.admit()
    fence = ClaudeSessionFence(receipt, persist, admit)
    process = pipe = output_thread = None
    opened = False
    try:
        identity = runtime.probe(account)
        admit()
        if not identity.get('authenticated'):
            raise RuntimeErrorCode('ACCOUNT_AUTHENTICATION_REQUIRED')
        process = runtime.claude_factory(account, params, receipt) if hasattr(runtime, 'claude_factory') else launch(runtime, account, params, receipt)
        if stopped.is_set():
            raise RuntimeErrorCode('RUNTIME_CLOSING')
        pipe = NativePipe(process, stopped)
        request_id = uuid.uuid4().hex
        pipe.send({'type': 'control_request', 'request_id': request_id, 'request': {'subtype': 'initialize'}})
        deadline = time.monotonic()+25
        while True:
            if time.monotonic() >= deadline:
                raise RuntimeErrorCode('CLAUDE_INITIALIZE_TIMEOUT')
            value = pipe.receive(max(.01, deadline-time.monotonic()), stopped)
            response = value.get('response', {})
            if value.get('type') == 'control_response' and response.get('request_id') == request_id:
                if response.get('subtype') != 'success':
                    raise RuntimeErrorCode('CLAUDE_INITIALIZE_REJECTED')
                break
        # Native metadata only. No prompt is admitted until the local MCP endpoint
        # is connected. Status includes private config, so it must never be relayed.
        deadline = time.monotonic()+20
        connected = False
        while time.monotonic() < deadline and not stopped.is_set():
            status_id = uuid.uuid4().hex
            pipe.send({'type': 'control_request', 'request_id': status_id, 'request': {'subtype': 'mcp_status'}})
            while time.monotonic() < deadline:
                value = pipe.receive(max(.01, deadline-time.monotonic()), stopped)
                response = value.get('response', {})
                if value.get('type') == 'control_response' and response.get('request_id') == status_id:
                    servers = response.get('response', {}).get('mcpServers', [])
                    server = next((s for s in servers if isinstance(s, dict) and s.get('name') == 'local_device'), {}) if isinstance(servers, list) else {}
                    connected = response.get('subtype') == 'success' and server.get('status') == 'connected'
                    break
            if connected: break
            stopped.wait(.2)
        if not connected:
            raise RuntimeErrorCode('CLAUDE_LOCAL_MCP_NOT_CONNECTED')
        admit()
        emit({'ok': True, 'value': {'provider': 'claude', 'credentialOwner': 'native', 'transport': 'official-mcp-v1', 'workspaceId': workspace,
                                  'sessionReceipt': {k: receipt[k] for k in ('threadId', 'environmentId', 'cwd', 'fork') if k in receipt}}})
        opened = True
        runtime.maintenance.attach(key, fence, pipe, process, disconnect_safely, done, protocol='claude')
        def output():
            try:
                while not stopped.is_set():
                    try: value = pipe.receive(1, stopped)
                    except TimeoutError: continue
                    with fence.lock:
                        runtime.authorize(uid, account['id'], account['generation'])
                        accepted = fence.after(value)
                        from usage import observe_claude_usage
                        try:
                            observe_claude_usage(runtime, account, accepted)
                        except (OSError, ValueError, TypeError):
                            # Quota persistence must not terminate a native model turn.
                            runtime.claude_quota_errors = getattr(runtime, 'claude_quota_errors', set()) | {runtime.state.account_key(account)}
                        emit(accepted)
            except (EOFError, OSError): pass
            except Exception:
                try: emit({'type': 'workbench_transport_error', 'error': 'CLAUDE_STREAM_REQUIRES_REVIEW'})
                except OSError: pass
            finally:
                if not stopped.is_set(): disconnect_safely()
        output_thread = threading.Thread(target=output, daemon=True)
        output_thread.start()
        while not stopped.is_set():
            raw = reader.readline(MAX_FRAME+1)
            if not raw or len(raw) > MAX_FRAME: break
            value = json.loads(raw)
            if value == {'type': 'workbench_close'}: break
            with fence.lock:
                pipe.send(fence.before(value))
    except Exception as error:
        try: emit({'ok': False, 'error': str(error) if isinstance(error, RuntimeErrorCode) else 'CLAUDE_RUNTIME_UNAVAILABLE'} if not opened else {'type': 'workbench_transport_error', 'error': 'CLAUDE_STREAM_REQUIRES_REVIEW'})
        except OSError: pass
    finally:
        stopped.set()
        cleaned = False
        try:
            if process:
                runtime.stop(process)
                config_file = getattr(process, 'claude_tool_config', None)
                if config_file: config_file.unlink(missing_ok=True)
            cleaned = True
        finally:
            if output_thread: output_thread.join(2)
            with fence.lock:
                fence.disconnected()
                receipt['cleanupConfirmed'] = cleaned
                if cleaned and (receipt.get('uncertain') or receipt.get('rootPending') or receipt.get('activeChildren')):
                    receipt.update(active=False, rootPending=False, uncertain=False, interrupted=True, activeChildren=[])
                persist()
            if cleaned:
                runtime.maintenance.detach(key)
                with runtime.lock: runtime.active.pop(key, None)
                done.set()
            elif process:
                runtime.maintenance.attach(key, fence, pipe, process, disconnect_safely, done, protocol='claude')
                runtime.maintenance.quarantine(key)
            if opened:
                try: emit({'method': 'workbench/bridgeClosed', 'params': {'cleanupConfirmed': cleaned}})
                except OSError: pass
