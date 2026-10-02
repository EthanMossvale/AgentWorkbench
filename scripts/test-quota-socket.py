"""Isolated Linux UID/socket acceptance. No VPS, provider, OS-user mutation or keys."""
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time

assert os.geteuid() == 0, 'Run this fixture as root in an isolated local Linux runtime.'
source = Path(__file__).resolve().parents[1] / 'services' / 'vps-workspace-control'
report_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
checks = []
process = None
with tempfile.TemporaryDirectory(prefix='awb-quota-fixture-', dir='/run') as temporary:
    base = Path(temporary)
    base.chmod(0o755)
    control_root, runtime, public = (base / name for name in ('control', 'runtime', 'public'))
    for folder, mode in ((control_root, 0o700), (runtime, 0o700), (public, 0o755)):
        folder.mkdir(mode=mode)
    for file in source.glob('*.py'):
        target = runtime / file.name
        shutil.copyfile(file, target)
        target.chmod(0o600)
    sys.path.insert(0, str(runtime))
    from control import WorkspaceControl, atomic_json
    key = 'ssh-ed25519 ' + base64.b64encode(struct.pack('>I', 11) + b'ssh-ed25519' + struct.pack('>I', 32) + b'x' * 32).decode()
    config = dict(authorityId='fixture', generation='g', root=str(control_root), connection=dict(hostname='fixture.invalid', port=22, hostPublicKeys=[key]), enrollmentUrl='')
    control = WorkspaceControl(config, object(), publish_policy=lambda value: None)
    for name, uid, percent in (('alpha', 65534, 33), ('beta', 65533, 34), ('gamma', 65532, 33)):
        control.state['workspaces'][name] = dict(id=name, uid=uid, username=name, name=name, status='active', allowedAccountIds=['one'], accountQuotas={'one':dict(weeklyPercent=percent, fiveHourPercent=None, allowOverage=True)})
    control._commit(control.state)
    atomic_json(control_root / 'quota-service.json', config)
    (control_root / 'control.lock').touch(mode=0o600)
    (control_root / 'quota-runtime-v2').mkdir(mode=0o700)
    (control_root / 'quota-runtime-v2' / 'quota_native.py').write_text('raise RuntimeError("Fixture provider must be intercepted")\n')
    (control_root / 'quota-runtime-v2' / 'quota_native.py').chmod(0o600)
    clock = time.time()
    provider = control_root / 'provider-fixture.json'
    atomic_json(provider, dict(ok=True, windows=[dict(window='weekly', usedPercent=0, resetsAt=clock + 604800)]))
    endpoint = str(public / 'quota-v2.sock')
    launcher = '''import sys,types,json
sys.path.insert(0,sys.argv[1])
import quota_service
quota_service.ROOT=sys.argv[2];quota_service.SOCKET=sys.argv[3]
def provider(*args,**kwargs):
    with open(sys.argv[4]) as source: value=json.load(source)
    return types.SimpleNamespace(returncode=0,stdout=json.dumps(value))
quota_service.subprocess.run=provider
quota_service.main()
'''
    process = subprocess.Popen([sys.executable, '-B', '-c', launcher, str(runtime), str(control_root), endpoint, str(provider)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            if Path(endpoint).exists():
                break
            if process.poll() is not None:
                raise RuntimeError(process.communicate()[1].decode())
            time.sleep(.03)
        client = '''import socket,json,sys
with socket.socket(socket.AF_UNIX) as channel:
 channel.connect(sys.argv[1]);channel.sendall((sys.argv[2]+'\\n').encode());print(channel.makefile('r').readline())
'''
        def call(method, params, uid=65534):
            result = subprocess.run([sys.executable, '-B', '-c', client, endpoint, json.dumps(dict(method=method, params=params))], capture_output=True, text=True, timeout=10, user=uid, group=65534)
            assert result.returncode == 0, result.stderr
            return json.loads(result.stdout)
        context = call('quota/context', {'accountId':'one'})
        assert context['ok'] and context['value']['workspaceId'] == 'alpha'
        assert call('workspace/delete', {})['error'] == 'UNAUTHORIZED'
        checks.append('real kernel peer UID binds the member and rejects management operations')
        assert call('quota/observe', {'payload':{'accountId':'one','accountGeneration':'ag','scope':'s','workspaceId':'beta','totalTokens':1,'lastTokens':1}})['error'] == 'UNAUTHORIZED'
        checks.append('a member cannot report token usage as another workspace')
        params = dict(accountId='one', accountGeneration='ag')
        assert call('quota/observe', {'payload':{**params,'windows':[dict(window='weekly',usedPercent=99,resetsAt=clock+9999999)]},'refresh':True})['ok']
        view = call('quota/read', params)['value']['windows'][0]
        assert view['usedPercent'] == 0, 'Client-supplied percentages must not become authority.'
        checks.append('official quota observations replace client-supplied percentages and reset clocks')
        atomic_json(provider, dict(ok=True, windows=[dict(window='weekly', usedPercent=40, resetsAt=clock+604800)]))
        payload = dict(**params, workspaceId='alpha', scope='s', totalTokens=4000, lastTokens=4000, phase='finish')
        assert call('quota/observe', {'payload':payload,'refresh':True})['ok']
        view = call('quota/read', params, uid=65533)['value']['windows'][0]
        assert view['debts'] == [dict(borrower='alpha', lender='beta', percent=7)]
        assert call('quota/observe', {'payload':payload,'refresh':True})['ok']
        assert call('quota/read', params)['value']['windows'][0]['debts'] == view['debts']
        checks.append('two independent member UIDs share one deduplicated loan ledger')
        root_params = dict(params, authorityId='fixture', generation='g')
        admin_view = call('quota/read', root_params, uid=0)['value']
        import ssh_entry
        ssh_entry.ROOT = str(control_root)
        ssh_entry.POLICY_ROOT = str(public)
        ssh_entry.SOCKET = str(public / 'absent-formal-control.sock')
        host_key = control_root / 'host.pub'
        host_key.write_text(key)
        original_trust = ssh_entry.trusted_root_path
        ssh_entry.trusted_root_path = lambda value, **options: str(host_key) if value == '/etc/ssh/ssh_host_ed25519_key.pub' else original_trust(value, **options)
        forwarded = ssh_entry.dispatch(dict(protocol=1, method='quota/read', params=root_params), dict(hostname='fixture.invalid', port=22))
        assert forwarded['ok'] and forwarded['value'] == admin_view
        member_view = call('quota/read', params, uid=65533)['value']
        assert admin_view['windows'] == member_view['windows']
        assert admin_view['allocations'] == member_view['allocations']
        assert set(member_view['allocations']) == {'alpha', 'beta', 'gamma'}
        assert member_view['tokenTotals']['alpha'] == 4000
        checks.append('administrator and member share all workspace rows and balances through one endpoint')

        atomic_json(provider, dict(ok=True, windows=[dict(window='weekly', usedPercent=0, resetsAt=clock+1209600)]))
        assert call('quota/observe', {'payload':params,'refresh':True})['ok']
        view = call('quota/read', params)['value']['windows'][0]
        assert view['debts'] == [] and view['balances'] == dict(alpha=26,beta=41,gamma=33)
        checks.append('a provider-verified refresh repays exactly the original lender')

        assert call('quota/observe', {'payload':dict(**params, scope='retry', phase='begin')})['ok']
        atomic_json(provider, dict(ok=False))
        receipt = dict(**params, scope='retry', phase='finish', totalTokens=100, lastTokens=100)
        assert call('quota/observe', {'payload':receipt, 'refresh':True})['error'] == 'QUOTA_UNAVAILABLE'
        failed = call('quota/read', params)['value']
        assert failed['tokenTotals']['alpha'] == 4100
        with open(control_root / 'state.json') as stream:
            saved = json.load(stream)
        assert all(not account['active'] for account in saved['quotaLedger'].values())
        atomic_json(provider, dict(ok=True, windows=[dict(window='weekly', usedPercent=.5, resetsAt=clock+1209600)]))
        assert call('quota/observe', {'payload':receipt, 'refresh':True})['ok']
        recovered = call('quota/read', params)['value']
        assert recovered['tokenTotals']['alpha'] == 4100
        assert recovered['windows'][0]['estimatedTotalTokens'] == 20000
        checks.append('provider failure retains numeric finish, closes producer and calibrates on retry without duplicate usage')
    finally:
        process.terminate()
        process.wait(timeout=5)
result = dict(pass_=True, syntheticProvider=True, realLinuxSocket=True, vpsMutations=0, modelTurns=0, checks=checks)
if report_path:
    report_path.write_text(json.dumps(result, indent=2))
print(json.dumps(result))
