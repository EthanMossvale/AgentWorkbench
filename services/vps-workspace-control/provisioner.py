"""Explicit Linux system adapter. No shell or runtime installation.

Unit tests inject a fixture; Linux acceptance uses explicitly disposable users.
"""
import os
from pathlib import PurePosixPath
import secrets
import stat
import subprocess
import base64
import datetime
import re
import fcntl

from security import ControlError, USERNAME, absolute_directory, public_key, trusted_root_path
import destruction


def edit_authorized_keys(content, line, canonical, *, add):
    """Preserve unrelated lines byte-for-byte, including comments and key options."""
    lines = content.splitlines(keepends=True)
    if add:
        if sum(canonical.encode('ascii') in item for item in lines) == 1 and any(item.rstrip(b'\r\n') == line for item in lines):
            return content
        if any(canonical.encode('ascii') in item for item in lines):
            raise ControlError('KEY_ALREADY_AUTHORIZED')
        return content + (b'' if not content or content.endswith(b'\n') else b'\n') + line + b'\n'
    return b''.join(item for item in lines if item.rstrip(b'\r\n') != line)


def portable_key_records(content, modified_at):
    """Read only workbench key markers; never infer device names from other keys."""
    result = []
    for raw in content.splitlines():
        try:
            line = raw.decode('ascii')
            match = re.fullmatch(r'(ssh-ed25519 [A-Za-z0-9+/=]+) aw-device:([a-f0-9-]{36})(?::([A-Za-z0-9_-]+):([0-9]{1,12}))?', line)
            if not match:
                continue
            canonical, fingerprint = public_key(match[1])
            label = base64.urlsafe_b64decode(match[3] + '=' * (-len(match[3]) % 4)).decode('utf-8') if match[3] else 'Device ' + match[2][:8]
            if not label.strip() or len(label) > 100 or re.search(r'[\x00-\x1f\x7f]', label):
                continue
            created = datetime.datetime.fromtimestamp(int(match[4]) if match[4] else modified_at, datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
            result.append(dict(id='ssh-' + match[2], label=label, fingerprint=fingerprint, publicKey=canonical, createdAt=created, status='active', authorizationLine=line))
        except (ValueError, UnicodeError, OverflowError, ControlError):
            continue
    if len({row['id'] for row in result}) != len(result):
        raise ControlError('UNSAFE_AUTHORIZED_KEYS')
    return result


class LinuxProvisioner:
    def __init__(self, *, minimum_uid=1000, home_parent='/home'):
        self.minimum_uid = minimum_uid
        self.home_parent = absolute_directory(home_parent)

    @staticmethod
    def _root():
        if not hasattr(os, 'geteuid') or os.geteuid() != 0:
            raise ControlError('ROOT_REQUIRED')

    def user(self, username):
        if not isinstance(username, str) or not USERNAME.fullmatch(username):
            raise ControlError('INVALID_REQUEST')
        import pwd
        try:
            row = pwd.getpwnam(username)
        except KeyError:
            return None
        if row.pw_uid < self.minimum_uid:
            raise ControlError('SYSTEM_IDENTITY_FORBIDDEN')
        return {'uid': row.pw_uid, 'gid': row.pw_gid, 'username': row.pw_name, 'home': row.pw_dir}

    def observe(self, username, root):
        destruction.require_workspace_identity(username)
        user = self.user(username)
        root = absolute_directory(root)
        descriptor = None
        try:
            descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
            for part in PurePosixPath(root).parts[1:]:
                following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = following
            item = os.fstat(descriptor)
        except FileNotFoundError:
            item = None
        except OSError:
            raise ControlError('UNSAFE_WORKSPACE_PATH') from None
        finally:
            if descriptor is not None:
                os.close(descriptor)
        if item and user and item.st_uid != user['uid']:
            raise ControlError('WORKSPACE_OWNER_MISMATCH')
        return {'user': user, 'root': root, 'directory': None if item is None else {'uid': item.st_uid, 'device': item.st_dev, 'inode': item.st_ino, 'mode': stat.S_IMODE(item.st_mode)}}

    def create(self, username, root):
        self._root()
        destruction.require_workspace_identity(username)
        if self.user(username) is not None:
            raise ControlError('ADOPT_REQUIRED')
        home = self.home_parent + '/' + username
        if root not in (home, home + '/workspaces') or os.path.lexists(home) or os.path.lexists(root):
            raise ControlError('UNSAFE_WORKSPACE_PATH')
        trusted_root_path(self.home_parent, directory=True)
        binary = trusted_root_path('/usr/sbin/useradd', executable=True, allow_symlinks=True)
        shell = trusted_root_path('/bin/bash', executable=True, allow_symlinks=True)
        result = subprocess.run([binary, '--create-home', '--home-dir', home, '--shell', shell, '--user-group', '--', username], shell=False,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
                                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
        if result.returncode != 0:
            raise ControlError('PROVISIONING_UNCONFIRMED')
        observed = self.observe(username, home)
        if not observed['user'] or not observed['directory'] or observed['user']['home'] != home:
            raise ControlError('PROVISIONING_UNCONFIRMED')
        if root != home:
            user = observed['user']
            descriptor = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                item = os.fstat(descriptor)
                if not stat.S_ISDIR(item.st_mode) or item.st_uid != user['uid'] or item.st_mode & 0o022:
                    raise ControlError('UNSAFE_WORKSPACE_PATH')
                os.mkdir('workspaces', 0o700, dir_fd=descriptor)
                child = os.open('workspaces', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
                try:
                    os.fchown(child, user['uid'], user['gid'])
                    os.fchmod(child, 0o700)
                finally:
                    os.close(child)
            finally:
                os.close(descriptor)
            observed = self.observe(username, root)
            if not observed['directory'] or observed['directory']['uid'] != user['uid']:
                raise ControlError('PROVISIONING_UNCONFIRMED')
        return observed['user']

    def adopt(self, username, uid, root):
        destruction.require_workspace_identity(username)
        observed = self.observe(username, root)
        if not observed['user'] or not observed['directory'] or observed['user']['uid'] != uid:
            raise ControlError('DISCOVERY_CHANGED')
        return observed['user']

    def deletion_plan(self, workspace):
        return destruction.inspect(self, workspace)

    def ssh_only_members(self):
        result = []
        for row in destruction.reserved_members():
            user = self.user(row.get('username'))
            if user and user['uid'] == row.get('uid') and user['home'] == row.get('home'):
                result.append(dict(username=user['username'], uid=user['uid'], home=user['home']))
        return result

    def destroy(self, workspace, expected, operation_id):
        return destruction.destroy(self, workspace, expected, operation_id)

    def _ssh_directory(self, workspace, *, create):
        self._root()
        user = self.user(workspace['username'])
        if not user or user['uid'] != workspace['uid']:
            raise ControlError('DISCOVERY_CHANGED')
        home = absolute_directory(user['home'])
        descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            for part in PurePosixPath(home).parts[1:]:
                following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = following
                item = os.fstat(descriptor)
                if item.st_uid not in (0, user['uid']) or item.st_mode & 0o022:
                    raise ControlError('UNSAFE_WORKSPACE_PATH')
            if create:
                try:
                    os.mkdir('.ssh', 0o700, dir_fd=descriptor)
                    os.chown('.ssh', user['uid'], user['gid'], dir_fd=descriptor, follow_symlinks=False)
                except FileExistsError:
                    pass
            ssh = os.open('.ssh', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptor)
            item = os.fstat(ssh)
            if item.st_uid not in (0, user['uid']) or item.st_mode & 0o077:
                os.close(ssh)
                raise ControlError('UNSAFE_WORKSPACE_PATH')
            return ssh, user
        finally:
            os.close(descriptor)

    @staticmethod
    def key_line(workspace, device):
        canonical, _ = public_key(device['publicKey'])
        if device['id'].startswith('ssh-'):
            line = device.get('authorizationLine', '')
            records = portable_key_records(line.encode('ascii'), 0)
            if len(records) != 1 or records[0]['id'] != device['id'] or records[0]['publicKey'] != canonical:
                raise ControlError('DEVICE_UNAVAILABLE')
            return line.encode('ascii')
        return (canonical + ' awb-control:' + workspace['id'] + ':' + workspace['generation'] + ':' + device['id']).encode('ascii')

    def portable_devices(self, workspace):
        if workspace['status'] == 'deleted':
            return []
        try:
            directory, user = self._ssh_directory(workspace, create=False)
        except FileNotFoundError:
            return []
        try:
            try:
                fd = os.open('authorized_keys', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            except FileNotFoundError:
                return []
            with os.fdopen(fd, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid not in (0, user['uid']) or info.st_mode & 0o022 or info.st_size > 1048576:
                    raise ControlError('UNSAFE_AUTHORIZED_KEYS')
                return portable_key_records(stream.read(1048577), info.st_mtime)
        finally:
            os.close(directory)

    def _edit_key(self, workspace, device, *, add, cancel_exports=False):
        try:
            directory, user = self._ssh_directory(workspace, create=add)
        except FileNotFoundError:
            if not add:
                return
            raise
        temporary = '.awb-' + secrets.token_hex(16)
        descriptor = None
        lock = None
        try:
            try:
                lock = os.open('.aw-enroll.lock', os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=directory)
                os.fchown(lock, user['uid'], user['gid'])
            except FileExistsError:
                lock = os.open('.aw-enroll.lock', os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            info = os.fstat(lock)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != user['uid'] or info.st_nlink != 1 or info.st_mode & 0o077:
                raise ControlError('UNSAFE_AUTHORIZED_KEYS')
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                descriptor = os.open('authorized_keys', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
                original = os.fstat(descriptor)
                if not stat.S_ISREG(original.st_mode) or original.st_nlink != 1 or original.st_uid not in (0, user['uid']) or original.st_mode & 0o022 or original.st_size > 1048576:
                    raise ControlError('UNSAFE_AUTHORIZED_KEYS')
                with os.fdopen(descriptor, 'rb') as source:
                    descriptor = None
                    content = source.read(1048577)
            except FileNotFoundError:
                original = None
                content = b''
            if len(content) > 1048576:
                raise ControlError('UNSAFE_AUTHORIZED_KEYS')
            if cancel_exports:
                replacement = b''.join(line for line in content.splitlines(keepends=True) if not re.search(rb' aw-enroll:[a-f0-9-]{36}$', line.rstrip(b'\r\n')))
            else:
                line = self.key_line(workspace, device)
                replacement = edit_authorized_keys(content, line, device['publicKey'], add=add)
            if replacement == content:
                return
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
            with os.fdopen(descriptor, 'wb') as target:
                descriptor = None
                target.write(replacement)
                target.flush()
                os.fsync(target.fileno())
                os.fchown(target.fileno(), original.st_uid if original else user['uid'], original.st_gid if original else user['gid'])
                os.fchmod(target.fileno(), stat.S_IMODE(original.st_mode) if original else 0o600)
                saved = os.fstat(target.fileno())
            # Detect concurrent replacements before atomically publishing. The UID
            # can edit its own SSH keys independently; this is not shell isolation.
            current = os.stat('authorized_keys', dir_fd=directory, follow_symlinks=False) if original else None
            staged = os.stat(temporary, dir_fd=directory, follow_symlinks=False)
            if original and (current.st_ino, current.st_dev, current.st_mtime_ns, current.st_size) != (original.st_ino, original.st_dev, original.st_mtime_ns, original.st_size):
                raise ControlError('DISCOVERY_CHANGED')
            if (staged.st_ino, staged.st_dev) != (saved.st_ino, saved.st_dev):
                raise ControlError('DISCOVERY_CHANGED')
            if original is None:
                # Do not overwrite a keys file another process created meanwhile.
                os.link(temporary, 'authorized_keys', src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
                os.unlink(temporary, dir_fd=directory)
            else:
                os.replace(temporary, 'authorized_keys', src_dir_fd=directory, dst_dir_fd=directory)
            os.fsync(directory)
        finally:
            if lock is not None:
                os.close(lock)
            if descriptor is not None:
                os.close(descriptor)
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass
            os.close(directory)

    def add_key(self, workspace, device):
        self._edit_key(workspace, device, add=True)

    def revoke_key(self, workspace, device):
        self._edit_key(workspace, device, add=False)

    def revoke_exports(self, workspace):
        self._edit_key(workspace, {}, add=False, cancel_exports=True)
