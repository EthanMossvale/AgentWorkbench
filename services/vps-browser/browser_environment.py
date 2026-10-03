"""Browser paths and desktop settings, shared by discovery and execution."""
import json
import os
from pathlib import Path
import stat

CONFIG = Path('/etc/agent-workbench/browser.json')
DEFAULTS = dict(serviceUser='jp-browser', home='/var/lib/jp-remote-browser/home',
                chrome='/opt/jp-remote-browser/chrome/chrome',
                web='/opt/codex-remote-login/noVNC-1.6.0',
                websockify='/opt/codex-remote-login/websockify-0.13.0',
                xvnc='/usr/bin/Xvnc', display=':31', vncPort=5931, webPort=6091)


def load(override=None):
    value = dict(DEFAULTS)
    if CONFIG.exists():
        info = CONFIG.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('BROWSER_IDENTITY_INVALID')
        value.update(json.loads(CONFIG.read_text(encoding='utf-8')))
    if override is not None:
        value.update(override)
    for key in ('home', 'chrome', 'web', 'websockify', 'xvnc'):
        if not isinstance(value[key], str) or not Path(value[key]).is_absolute():
            raise ValueError('Invalid browser path: ' + key)
    if not isinstance(value['serviceUser'], str) or not value['serviceUser'] or not isinstance(value['display'], str):
        raise ValueError('Invalid browser identity or display.')
    for key in ('vncPort', 'webPort'):
        if type(value[key]) is not int or not 1 <= value[key] <= 65535:
            raise ValueError('Invalid browser port: ' + key)
    return value


ENV = load()
