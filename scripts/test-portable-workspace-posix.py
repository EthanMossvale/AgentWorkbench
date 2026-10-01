"""Exercise real POSIX key files in disposable homes, without SSH or real accounts."""
import base64
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import types
import zlib

payload = json.load(sys.stdin)
assert os.geteuid() == 0, 'Run only in the local disposable POSIX fixture runner.'
key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4'
device_key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5'
checks = []
root = Path(tempfile.mkdtemp(prefix='.awb-ssh-fixture-', dir='/home'))
os.chown(root, 1000, 1000)
os.chmod(root, 0o700)


def run(source, request, drop=False):
    preamble = """import os,pwd,types,builtins,io
user=types.SimpleNamespace(pw_uid=1000,pw_gid=1000,pw_name='awb_fixture',pw_dir=HOME)
pwd.getpwnam=lambda name:user
pwd.getpwuid=lambda uid:user
os.initgroups=lambda *args:None
original_open=builtins.open
builtins.open=lambda name,*args,**kwargs:io.StringIO(HOSTKEY) if name=='/etc/ssh/ssh_host_ed25519_key.pub' else original_open(name,*args,**kwargs)
original_os_open=os.open
os.open=lambda name,*args,**kwargs:original_os_open(HOME+'/policy.json' if name=='/var/lib/agent-workbench-policy/workspaces.json' else name,*args,**kwargs)
""".replace('HOME', repr(str(root))).replace('HOSTKEY', repr(key))
    if drop:
        preamble += 'os.setgid(1000);os.setuid(1000)\n'
    return subprocess.run([sys.executable, '-B', '-c', preamble + source], input=json.dumps(request) + '\n', text=True, capture_output=True)


def prepare(invite, **binding):
    import time
    response = run(payload['prepare'], dict(username='awb_fixture', inviteId=invite, publicKey=key, expires=int(time.time())+3600, **binding))
    assert response.returncode == 0, (response.stdout, response.stderr)
    line = next(line for line in (root/'.ssh/authorized_keys').read_text().splitlines() if line.endswith(' aw-enroll:'+invite))
    assert len(line.encode()) < 8192
    compressed = re.search(r"b64decode\('([A-Za-z0-9+/=]+)'\)", line)[1]
    return zlib.decompress(base64.b64decode(compressed)).decode()


try:
    first = prepare('11111111-1111-1111-1111-111111111111')
    assert (root/'.ssh').stat().st_mode & 0o777 == 0o700
    assert (root/'.ssh/authorized_keys').stat().st_mode & 0o777 == 0o600
    checks.append('Fresh HOME receives private SSH directory and key file')
    original = b'# untouched existing key\r\n'+key.encode()+b' original-device\n'
    with (root/'.ssh/authorized_keys').open('ab') as stream:
        stream.write(original)
    result = run(first, dict(publicKey=device_key, deviceLabel='Veloria laptop'), True)
    assert result.returncode == 0, (result.stdout, result.stderr)
    assert (root/'.ssh/authorized_keys').read_bytes().endswith(original)
    assert run(first, dict(publicKey=key, deviceLabel='Replay'), True).returncode != 0
    checks.append('Atomic replacement grants one device and rejects replay')

    sys.path.insert(0, payload['serviceDirectory'])
    from provisioner import LinuxProvisioner
    adapter = LinuxProvisioner()
    adapter.user = lambda username: dict(username='awb_fixture', uid=1000, gid=1000, home=str(root))
    space = dict(id='space', generation='generation', username='awb_fixture', uid=1000, status='active')
    devices = adapter.portable_devices(space)
    assert len(devices) == 1 and devices[0]['label'] == 'Veloria laptop'
    adapter.revoke_key(space, devices[0])
    assert adapter.portable_devices(space) == []
    assert (root/'.ssh/authorized_keys').read_bytes() == original
    adapter.add_key(space, devices[0])
    adapter.add_key(space, devices[0])
    restored = adapter.portable_devices(space)
    assert len(restored) == 1 and restored[0] == devices[0]
    assert (root/'.ssh/authorized_keys').read_bytes().startswith(original)
    adapter.revoke_key(space, devices[0])
    assert (root/'.ssh/authorized_keys').read_bytes() == original
    checks.append('Pause and resume restore the exact portable device key once')
    checks.append('Admin discovers named SSH devices and revokes only the chosen key')

    pending = prepare('22222222-2222-2222-2222-222222222222')
    adapter.revoke_exports(space)
    assert run(pending, dict(publicKey=device_key, deviceLabel='Late import'), True).returncode != 0
    assert (root/'.ssh/authorized_keys').read_bytes() == original
    checks.append('Suspension invalidates outstanding exports and preserves unrelated authorization')

    policy = root/'policy.json'
    state = dict(authorityId='fixture', generation='generation', workspaces=[dict(workspaceId='original-space', username='awb_fixture', uid=1000, enabled=True)])
    policy.write_text(json.dumps(state))
    os.chmod(policy, 0o644)
    bound = prepare('44444444-4444-4444-4444-444444444444', authorityId='fixture', generation='generation', workspaceId='original-space')
    state['workspaces'][0]['workspaceId'] = 'new-space'
    policy.write_text(json.dumps(state))
    assert run(bound, dict(publicKey=device_key, deviceLabel='Old grant'), True).returncode != 0
    adapter.revoke_exports(space)
    assert (root/'.ssh/authorized_keys').read_bytes() == original
    checks.append('A recreated same-name workspace cannot consume the old workspace capability')

    keys = root/'.ssh/authorized_keys'
    keys.unlink()
    target = root/'untouched.txt'
    target.write_text('unchanged')
    keys.symlink_to(target)
    import time
    unsafe = run(payload['prepare'], dict(username='awb_fixture', inviteId='33333333-3333-3333-3333-333333333333', publicKey=key, expires=int(time.time())+3600))
    assert unsafe.returncode != 0 and target.read_text() == 'unchanged'
    checks.append('Symlink key targets fail closed without modifying their destination')
    print(json.dumps(dict(passed=True, checks=checks)))
finally:
    assert root.parent == Path('/home') and root.name.startswith('.awb-ssh-fixture-')
    shutil.rmtree(root)
