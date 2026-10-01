"""Linux-only simulated OAuth: fake CLI, fake browser, isolated temporary homes.

Never opens a real browser or an external authentication page. Only the fake
browser's loopback HTTP callback is allowed. No real token/cookie/profile read.
"""
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]

FAKE_CLI = r'''#!/usr/bin/python3
import http.server,json,os,sys,time,urllib.parse
from pathlib import Path
home=Path(os.environ['HOME']);mode=(home/'mode').read_text()
assert os.environ['CLAUDE_CONFIG_DIR']==str(home/'profiles/fixture-account')
assert os.environ['BROWSER']=='/bin/true' and sys.argv[1:]==['auth','login']
assert Path.cwd()==home/'profiles/fixture-account'
assert not any(key in os.environ for key in ('ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'))
(home/'cli-pid').write_text(str(os.getpid()))
def emit_url(url):
 if 'claude-com' in mode:url=url.replace('https://claude.ai/oauth/authorize','https://claude.com/cai/oauth/authorize')
 if mode=='unsupported-url':url=url.replace('https://claude.ai/oauth/authorize','https://claude.com/oauth/authorize')
 text=url
 if 'osc' in mode:
  end='\x1b\\' if mode.endswith('-st') else '\x07'
  text='\x1b]8;;'+url+end+'\x1b[94m'+url+'\x1b[39m\x1b]8;;'+end
 text="If the browser didn't open, visit: "+text+'\n'
 if 'split' in mode:
  at=text.index('state=')+len('state=fixture-')
  for chunk in (text[:at],text[at:at+4],text[at+4:]):
   sys.stdout.write(chunk);sys.stdout.flush();time.sleep(.1)
 else:
  sys.stdout.write(text);sys.stdout.flush()
if mode=='failure':sys.exit(1)
if mode=='false-success':sys.exit(0)
if mode in ('no-url','cancel-before-url'):time.sleep(20);sys.exit(4)
if mode.startswith('automatic'):
 class Callback(http.server.BaseHTTPRequestHandler):
  def do_GET(self):
   if self.path!='/callback?code=fixture-approval':self.send_error(400);return
   (home/'authenticated').write_text('fixture-only');self.send_response(200);self.end_headers();self.wfile.write(b'fixture')
  def log_message(self,*args):pass
 server=http.server.HTTPServer(('127.0.0.1',0),Callback)
 callback='http://127.0.0.1:'+str(server.server_address[1])+'/callback?code=fixture-approval'
 emit_url('https://claude.ai/oauth/authorize?state=fixture-only&redirect_uri='+urllib.parse.quote(callback,safe=''))
 server.handle_request()
 server.server_close()
else:
 url='https://claude.ai/oauth/authorize?state=fixture-only'
 if 'claude-com' in mode:url+='&redirect_uri='+urllib.parse.quote('https://platform.claude.com/oauth/code/callback',safe='')
 emit_url(url)
 print('Paste code here if prompted:',flush=True)
 value=sys.stdin.readline().strip()
 if value!='fixture-approval':sys.exit(3)
 (home/'authenticated').write_text('fixture-only')
'''
FAKE_BROWSER = r'''
import json,os,sys,time,urllib.parse,http.client
from pathlib import Path
sys.path.insert(0,sys.argv[2])
from remote_browser import authorization_url
home=Path(sys.argv[1]);print(json.dumps({'ready':True,'viewerReady':False}),flush=True)
try:
 for line in sys.stdin:
  r=json.loads(line)
  if r['action']=='open':
   url=urllib.parse.urlsplit(authorization_url(r['url']));q=urllib.parse.parse_qs(url.query)
   expected='claude.com' if 'claude-com' in (home/'mode').read_text() else 'claude.ai'
   assert url.hostname==expected and q['state']==['fixture-only']
   with (home/'opened-fixture').open('a') as receipt:receipt.write('fixture-open\n')
   if (home/'mode').read_text()=='browser-no-open-ack':continue
   time.sleep(.15)
   (home/'viewer-ready').write_text('fixture-only')
   if 'redirect_uri' in q and (home/'mode').read_text().startswith('automatic'):
    callback=urllib.parse.urlsplit(q['redirect_uri'][0]);assert callback.hostname=='127.0.0.1'
    conn=http.client.HTTPConnection('127.0.0.1',callback.port,timeout=3)
    conn.request('GET',callback.path+'?'+callback.query);assert conn.getresponse().status==200;conn.close()
   elif 'redirect_uri' in q:
    assert q['redirect_uri']==['https://platform.claude.com/oauth/code/callback']
   print(json.dumps({'opened':True}),flush=True)
  elif r['action']=='close':break
finally:
 (home/'browser-closed').write_text('fixture-only')
 print(json.dumps({'cleanup':'confirmed'}),flush=True)
'''
RUNNER = r'''
import sys,os,json,types,pwd
from pathlib import Path
root,home=map(Path,sys.argv[1:3]);sys.path.insert(0,str(root/'services/vps-account-broker'));sys.path.insert(0,str(root/'services/vps-browser'))
import browser_api as api
(home/'profiles/fixture-account').mkdir(parents=True)
api.LOGIN_TIMEOUT=2 if (home/'mode').read_text() in ('timeout','no-url') else 12
api.HEARTBEAT_TIMEOUT=12
api.AUTH_URL_TIMEOUT=.5 if (home/'mode').read_text() in ('no-url','unsupported-url') else 8
api.BROWSER_OPEN_TIMEOUT=.5 if (home/'mode').read_text()=='browser-no-open-ack' else 8
api.installed=lambda:{'installed':True}
config={'ownerUid':os.geteuid(),'authorityId':'fixture','generation':'g','root':str(home),'claudeExecutable':str(home/'fake-cli')}
api.setup.public_json=lambda p:config
api.trusted_path=lambda p,**kwargs:p
owner=pwd.getpwuid(os.geteuid());api.pwd=types.SimpleNamespace(getpwuid=lambda uid:types.SimpleNamespace(pw_dir=str(home),pw_uid=uid,pw_gid=owner.pw_gid,pw_name=owner.pw_name))
def native(config,method,params):
 with (home/'events').open('a') as f:f.write(method+'\n')
 if method=='runtime/status':return {'authenticated':(home/'authenticated').exists()}
 return {'reserved':True}
api.native=native
api.manager_args=lambda action,options:[sys.executable,'-u',str(home/'fake-browser.py'),str(home),str(root/'services/vps-browser')]
api.login({'accountId':'fixture-account','accountGeneration':'g','authorityId':'fixture','generation':'g','jobId':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','profileKey':'b'*32})
'''


class SimulatedLogin(unittest.TestCase):
    def test_hard_orchestrator_death_stops_login_leader_without_retry(self):
        with tempfile.TemporaryDirectory(prefix='awb-simulated-crash-') as folder:
            home = Path(folder)
            (home / 'mode').write_text('manual')
            (home / 'fake-cli').write_text(FAKE_CLI)
            (home / 'fake-cli').chmod(0o755)
            (home / 'fake-browser.py').write_text(FAKE_BROWSER)
            process = subprocess.Popen([sys.executable, '-u', '-c', RUNNER, str(ROOT), str(home)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={'PATH': '/usr/bin:/bin', 'HOME': str(home), 'PYTHONDONTWRITEBYTECODE': '1'})
            try:
                deadline = time.monotonic() + 8
                while not (home / 'cli-pid').exists() and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue((home / 'cli-pid').exists())
                pid = int((home / 'cli-pid').read_text())
                process.kill(); process.wait(timeout=3)
                deadline = time.monotonic() + 5
                def alive():
                    try:
                        return Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[0] != 'Z'
                    except FileNotFoundError:
                        return False
                while (alive() or not (home / 'browser-closed').exists()) and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertFalse(alive())
                self.assertTrue((home / 'browser-closed').exists())
                self.assertFalse((home / 'authenticated').exists())
                # No receipt can be inferred after a hard crash: reservation stays blocked.
                self.assertNotIn('runtime/login-release', (home / 'events').read_text())
            finally:
                if process.poll() is None:
                    process.kill(); process.wait(timeout=3)
                for stream in (process.stdin, process.stdout, process.stderr):
                    stream.close()

    def run_case(self, mode, action=None):
        with tempfile.TemporaryDirectory(prefix='awb-simulated-auth-') as folder:
            home = Path(folder)
            (home / 'mode').write_text(mode)
            (home / 'fake-cli').write_text(FAKE_CLI)
            (home / 'fake-cli').chmod(0o755)
            (home / 'fake-browser.py').write_text(FAKE_BROWSER)
            process = subprocess.Popen([sys.executable, '-u', '-c', RUNNER, str(ROOT), str(home)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={'PATH': '/usr/bin:/bin', 'HOME': str(home), 'PYTHONDONTWRITEBYTECODE': '1'})
            frames, sent = [], False
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                if select.select([process.stdout], [], [], .25)[0]:
                    raw = process.stdout.readline()
                    if not raw:
                        break
                    frame = json.loads(raw)
                    frames.append(frame)
                    if frame.get('viewerReady'):
                        self.assertTrue((home / 'viewer-ready').exists(), 'Viewer must not be advertised before the authorization page is started')
                    if frame.get('state') == 'preparing':
                        self.assertFalse(frame.get('viewerReady'))
                    if action and not sent and (frame.get('state') == 'awaiting-browser' or mode == 'cancel-before-url' and frame.get('state') == 'preparing') and (action != 'code' or frame.get('codeRequested')):
                        if action == 'disconnect':
                            process.stdin.close(); process.stdin = None
                        else:
                            process.stdin.write((json.dumps({'action': action, **({'code': 'fixture-approval'} if action == 'code' else {})}) + '\n').encode()); process.stdin.flush()
                        sent = True
            if process.poll() is None:
                process.kill()
            error = process.stderr.read().decode()
            process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
            self.assertTrue(frames, error)
            self.assertEqual(process.returncode, 0, error)
            self.assertEqual(frames[-1]['cleanup'], 'confirmed', frames)
            self.assertTrue((home / 'browser-closed').exists())
            self.assertIn('runtime/login-release', (home / 'events').read_text())
            self.assertFalse(any('oauth/authorize' in json.dumps(frame) for frame in frames))
            if (home / 'opened-fixture').exists():
                self.assertEqual((home / 'opened-fixture').read_text().splitlines(), ['fixture-open'])
            return frames[-1], (home / 'authenticated').exists(), (home / 'opened-fixture').exists()

    def test_automatic_loopback_callback(self):
        last, auth, opened = self.run_case('automatic')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_manual_code_fallback(self):
        last, auth, opened = self.run_case('manual', 'code')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_current_subscription_url_with_terminal_hyperlink(self):
        last, auth, opened = self.run_case('automatic-claude-com-osc-bel')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_current_subscription_split_hyperlink_manual_fallback(self):
        last, auth, opened = self.run_case('manual-claude-com-osc-split', 'code')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_unknown_authorization_path_fails_instead_of_waiting_for_code(self):
        last, auth, opened = self.run_case('unsupported-url')
        self.assertEqual(last['state'], 'failed')
        self.assertEqual(last['error'], 'NATIVE_AUTH_URL_UNRECOGNIZED')
        self.assertFalse(auth or opened)

    def test_browser_without_open_ack_has_bounded_preparation(self):
        last, auth, opened = self.run_case('browser-no-open-ack')
        self.assertEqual(last['state'], 'failed')
        self.assertEqual(last['error'], 'BROWSER_START_TIMEOUT')
        self.assertTrue(opened)
        self.assertFalse(auth)

    def test_native_osc8_hyperlink_bel(self):
        last, auth, opened = self.run_case('automatic-osc-bel')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_native_osc8_hyperlink_st(self):
        last, auth, opened = self.run_case('automatic-osc-st')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_split_plain_url_waits_for_completion(self):
        last, auth, opened = self.run_case('automatic-split')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_split_hyperlink_waits_for_terminator(self):
        last, auth, opened = self.run_case('automatic-osc-split')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_native_hyperlink_manual_code_fallback(self):
        last, auth, opened = self.run_case('manual-osc-bel', 'code')
        self.assertEqual(last['state'], 'authenticated')
        self.assertTrue(auth and opened)

    def test_cancel(self):
        last, auth, _ = self.run_case('manual', 'cancel')
        self.assertEqual(last['state'], 'cancelled')
        self.assertFalse(auth)

    def test_disconnect(self):
        last, auth, _ = self.run_case('manual', 'disconnect')
        self.assertEqual(last['state'], 'failed')
        self.assertFalse(auth)

    def test_timeout(self):
        last, auth, _ = self.run_case('timeout')
        self.assertEqual(last['state'], 'expired')
        self.assertFalse(auth)

    def test_native_failure(self):
        last, auth, _ = self.run_case('failure')
        self.assertEqual(last['state'], 'failed')
        self.assertFalse(auth)

    def test_no_native_url_never_advertises_a_blank_viewer(self):
        last, auth, opened = self.run_case('no-url')
        self.assertEqual(last['state'], 'failed')
        self.assertEqual(last['error'], 'NATIVE_AUTH_URL_TIMEOUT')
        self.assertFalse(auth or opened)

    def test_cancel_before_native_url_preserves_cleanup_without_opening_browser(self):
        last, auth, opened = self.run_case('cancel-before-url', 'cancel')
        self.assertEqual(last['state'], 'cancelled')
        self.assertFalse(auth or opened)

    def test_exit_zero_requires_native_authenticated_receipt(self):
        last, auth, _ = self.run_case('false-success')
        self.assertEqual(last['state'], 'failed')
        self.assertEqual(last['error'], 'NATIVE_AUTH_UNCONFIRMED')
        self.assertFalse(auth)


if __name__ == '__main__':
    unittest.main(verbosity=2)
