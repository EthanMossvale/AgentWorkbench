"""Root-created maintenance locks shared by managed native processes."""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import stat

LOCK_ROOT = '/var/lib/agent-workbench-cli-locks'
INSTALL_ROOT = '/opt/agent-workbench/native'


@contextmanager
def lease(provider, binary=None, exclusive=False):
    if provider not in ('codex', 'claude', 'configuration'):
        raise RuntimeError('INVALID_REQUEST')
    directory = Path(LOCK_ROOT)
    if exclusive:
        if os.geteuid() != 0:
            raise RuntimeError('ADMIN_REQUIRED')
        directory.mkdir(mode=0o755, exist_ok=True)
    elif not binary or not str(binary).startswith(INSTALL_ROOT + '/'):
        yield
        return
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise RuntimeError('CLI_LOCK_INVALID')
    descriptor = os.open(str(directory / (provider + '.lock')), (os.O_CREAT | os.O_RDWR if exclusive else os.O_RDONLY) | os.O_NOFOLLOW, 0o644)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o022:
            raise RuntimeError('CLI_LOCK_INVALID')
        try:
            fcntl.flock(descriptor, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) | (0 if provider == 'configuration' else fcntl.LOCK_NB))
        except BlockingIOError:
            raise RuntimeError('CLI_BUSY') from None
        yield
    finally:
        os.close(descriptor)
