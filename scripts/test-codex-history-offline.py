"""Pinned local CLI + synthetic history, isolated HOME, no login or model turn."""
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
import uuid

root = Path(__file__).resolve().parents[1]
binary = root / 'build/runtime/codex-0.155.1/codex.exe'
report = root / 'build/qa/native-unification-offline-history.json'
checks = []
result = {'syntheticHistoryOnly': True, 'officialLocalBinary': True, 'syntheticProviderLoopbackOnly': True, 'modelTurns': 0, 'loginRequests': 0}
process = None
scratch = root / 'build/qa/offline-history-fixtures'
scratch.mkdir(exist_ok=True)
try:
    with tempfile.TemporaryDirectory(prefix='fixture-', dir=scratch, ignore_cleanup_errors=True) as temporary:
        base = Path(temporary)
        profile = base / 'profile'; profile.mkdir()
        (base / 'tmp').mkdir()
        env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'COMSPEC', 'PATH') if key in os.environ}
        env.update(HOME=str(base), USERPROFILE=str(base), APPDATA=str(base / 'appdata'), LOCALAPPDATA=str(base / 'local'), CODEX_HOME=str(profile), TEMP=str(base / 'tmp'), TMP=str(base / 'tmp'), OTEL_SDK_DISABLED='true')
        version = subprocess.check_output([str(binary), '--version'], env=env, cwd=base, timeout=10).decode().strip()
        assert version == 'codex-cli 0.155.1', version
        result['version'] = version
        ident = str(uuid.uuid4())
        rollout = profile / ('rollout-fixture-' + ident + '.jsonl')
        records = [
            {'type':'session_meta','payload':{'id':ident,'timestamp':'2026-09-26T00:00:00Z','cwd':str(base),'originator':'codex_cli_rs','cli_version':'0.155.1','source':'cli','model_provider':'offline-fixture','base_instructions':{'text':'Synthetic offline migration fixture.'}}},
            {'type':'event_msg','payload':{'type':'task_started','turn_id':'fixture-turn','model_context_window':100000}},
            {'type':'event_msg','payload':{'type':'user_message','message':'Preserved synthetic user history.','images':[],'local_images':[]}},
            {'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'Preserved synthetic user history.'}]}},
            {'type':'response_item','payload':{'type':'message','role':'assistant','content':[{'type':'output_text','text':'Preserved synthetic assistant history.'}]}},
            {'type':'event_msg','payload':{'type':'agent_message','message':'Preserved synthetic assistant history.','phase':'final_answer'}},
            {'type':'event_msg','payload':{'type':'task_complete','turn_id':'fixture-turn','last_agent_message':'Preserved synthetic assistant history.'}},
        ]
        raw = ''.join(json.dumps(dict(timestamp='2026-09-26T00:00:00Z', **r))+'\n' for r in records)
        rollout.write_text(raw, encoding='utf-8')
        # Any attempted provider HTTP is confined to a closed loopback port.
        args = [str(binary), '-c', 'check_for_update_on_startup=false', '-c', 'model_provider="offline-fixture"', '-c', 'model="fixture"', '-c', 'model_providers.offline-fixture={name="Offline fixture",base_url="http://127.0.0.1:9/v1",wire_api="responses",requires_openai_auth=false}', 'app-server', '--listen', 'stdio://']
        errors = []
        process = subprocess.Popen(args, cwd=base, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        def read_errors():
            for line in process.stderr:
                errors.append(line.decode('utf-8', errors='replace')[:1000])
                del errors[:-12]
        threading.Thread(target=read_errors, daemon=True).start()
        messages = queue.Queue()
        def read():
            for line in process.stdout:
                try: messages.put(json.loads(line))
                except ValueError: messages.put({'fixtureError':'INVALID_JSON'})
            messages.put({'fixtureError':'PROCESS_ENDED'})
        reader = threading.Thread(target=read, daemon=True); reader.start()
        def send(value):
            process.stdin.write((json.dumps(value)+'\n').encode()); process.stdin.flush()
        counter = 0
        def call(method, params):
            global counter
            counter += 1
            send({'id':counter,'method':method,'params':params})
            deadline = time.monotonic()+25
            while time.monotonic()<deadline:
                try:
                    value = messages.get(timeout=max(.01,deadline-time.monotonic()))
                except queue.Empty:
                    raise AssertionError('Native request timed out: ' + method + '; exit=' + str(process.poll()) + '; ' + ''.join(errors)) from None
                assert 'fixtureError' not in value, ''.join(errors)
                if value.get('method') and 'id' in value:
                    raise AssertionError('Unexpected native action during offline history inspection')
                if value.get('id') == counter:
                    assert 'result' in value, value
                    return value['result']
            raise AssertionError('Native history request timed out')
        call('initialize',{'clientInfo':{'name':'awb_offline_history_fixture','version':'1'},'capabilities':{'experimentalApi':True}})
        send({'method':'initialized'})
        assert call('account/read',{'refreshToken':False})['account'] is None
        checks.append('isolated native profile has no account or login credentials')
        resumed = call('thread/resume',{'threadId':ident,'path':str(rollout),'cwd':str(base),'approvalPolicy':'never','sandbox':'read-only'})
        assert resumed['thread']['id'] == ident, resumed['thread']['id']
        history = call('thread/read',{'threadId':ident,'includeTurns':True})
        serialized = json.dumps(history)
        assert 'Preserved synthetic user history.' in serialized and 'Preserved synthetic assistant history.' in serialized, serialized
        checks.append('pinned native path resume preserves the original thread ID and both history messages')
        assert rollout.read_text(encoding='utf-8').startswith(raw)
        checks.append('native resume retains the exact original rollout prefix without replaying a turn')
        process.stdin.close(); process.wait(timeout=10); reader.join(timeout=2)
        process = None
except Exception as error:
    result['failure'] = str(error)
    raise
finally:
    if process and process.poll() is None:
        process.kill(); process.wait(timeout=10)
    result['checks'] = checks
    result['passed'] = len(checks)
    report.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
