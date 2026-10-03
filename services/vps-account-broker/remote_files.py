"""Administrator file operations with canonical reads and link-preserving mutations."""
import base64
import contextlib
import ctypes
import errno
import hashlib
import json
import os
from pathlib import PurePosixPath
import stat
import uuid

LIMIT = None


def require(value, code='REMOTE_FILE_INVALID'):
    if not value:
        raise RuntimeError(code)


def parts(value):
    require(isinstance(value, str) and value.startswith('/') and len(value) <= 4096 and not any(ord(c) < 32 for c in value))
    pieces = value.split('/')[1:]
    require(not any(v in ('.', '..') for v in pieces))
    result = tuple(v for v in pieces if v)
    return result


@contextlib.contextmanager
def parent(value):
    parts(value)
    path = parts(os.path.join(os.path.realpath(os.path.dirname(value)), os.path.basename(value)))
    descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path[:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor); descriptor = child
        yield descriptor, path[-1] if path else '.', '/'+'/'.join(path)
    finally:
        os.close(descriptor)


def revision(info):
    return hashlib.sha256(str((info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)).encode()).hexdigest()


def metadata(fd, name):
    return os.stat(name, dir_fd=fd, follow_symlinks=False)


def mount_id(fd):
    with open('/proc/self/fdinfo/'+str(fd), encoding='ascii') as stream:
        for line in stream:
            if line.startswith('mnt_id:'):
                return int(line.split(':', 1)[1].strip())
    raise RuntimeError('REMOTE_FILE_MOUNT')


def check(fd, name, expected):
    info = metadata(fd, name)
    require(isinstance(expected, str) and revision(info) == expected, 'REMOTE_FILE_CHANGED')
    require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode), 'REMOTE_FILE_SPECIAL')
    return info


def read_bytes(fd, name, limit):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode), 'REMOTE_FILE_SPECIAL')
        data = stream.read() if limit is None else stream.read(limit+1)
        if limit is not None:
            require(len(data) <= limit, 'REMOTE_FILE_TOO_LARGE')
        require(revision(info) == revision(os.fstat(stream.fileno())), 'REMOTE_FILE_CHANGED')
        return data, info


def browse(path):
    parts(path)
    path = os.path.realpath(path)
    with parent(path) as (fd, name, target):
        info = metadata(fd, name)
        result = dict(path=target, parent=str(PurePosixPath(target).parent), revision=revision(info), size=info.st_size, modified=info.st_mtime, mode=stat.filemode(info.st_mode))
        if stat.S_ISDIR(info.st_mode):
            folder = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                entries = []
                with os.scandir(folder) as iterator:
                    for entry in iterator:
                        entries.append(dict(name=entry.name, path=target.rstrip('/')+'/'+entry.name,
                                            directory=entry.is_dir(follow_symlinks=True), link=entry.is_symlink()))
                entries.sort(key=lambda r: (not r['directory'], r['name']))
                return dict(result, kind='directory', entries=entries, truncated=False)
            finally:
                os.close(folder)
        if not stat.S_ISREG(info.st_mode):
            return dict(result, kind='unsupported', link=stat.S_ISLNK(info.st_mode))
        data, actual = read_bytes(fd, name, None)
        try:
            require(b'\0' not in data)
            return dict(result, revision=revision(actual), kind='text', content=data.decode('utf-8'))
        except (UnicodeError, RuntimeError):
            return dict(result, kind='unsupported')


def no_replace(source_fd, source, target_fd, target):
    libc = ctypes.CDLL(None, use_errno=True)
    fn = libc.renameat2
    if fn(source_fd, source.encode(), target_fd, target.encode(), 1) != 0:
        raise OSError(ctypes.get_errno(), 'Atomic move failed')


def write(path, data, expected=None):
    require(len(parts(path)) > 0)
    path = os.path.realpath(path)
    with parent(path) as (fd, name, target):
        previous = check(fd, name, expected) if expected is not None else None
        require(previous is None or stat.S_ISREG(previous.st_mode), 'REMOTE_FILE_SPECIAL')
        temporary = '.awb-write-'+uuid.uuid4().hex
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(data); stream.flush()
                if previous:
                    os.fchmod(stream.fileno(), stat.S_IMODE(previous.st_mode))
                    os.fchown(stream.fileno(), previous.st_uid, previous.st_gid)
                os.fsync(stream.fileno())
            if previous:
                check(fd, name, expected)
                os.replace(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
            else:
                no_replace(fd, temporary, fd, name)
            os.fsync(fd)
            return dict(path=target, revision=revision(metadata(fd, name)), bytes=len(data))
        finally:
            try:
                os.unlink(temporary, dir_fd=fd)
            except FileNotFoundError:
                pass


def delete_tree(fd, name, limit):
    limit[0] += 1
    info = metadata(fd, name)
    if stat.S_ISDIR(info.st_mode):
        child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            require(mount_id(fd) == mount_id(child), 'REMOTE_FILE_MOUNT')
            for entry in os.listdir(child):
                delete_tree(child, entry, limit)
        finally:
            os.close(child)
        os.rmdir(name, dir_fd=fd)
    else:
        require(stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode), 'REMOTE_FILE_SPECIAL')
        if stat.S_ISREG(info.st_mode):
            handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            try:
                require(mount_id(fd) == mount_id(handle), 'REMOTE_FILE_MOUNT')
            finally:
                os.close(handle)
        os.unlink(name, dir_fd=fd)


def copy_tree(source_fd, name, target_fd, dest, budget):
    info = metadata(source_fd, name)
    budget[0] += 1

    if stat.S_ISDIR(info.st_mode):
        os.mkdir(dest, mode=0o700, dir_fd=target_fd)
        source = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=source_fd)
        target = os.open(dest, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=target_fd)
        try:
            require(mount_id(source_fd) == mount_id(source), 'REMOTE_FILE_MOUNT')
            for item in os.listdir(source):
                copy_tree(source, item, target, item, budget)
            require(revision(os.fstat(source)) == revision(info), 'REMOTE_FILE_CHANGED')
            os.fchmod(target, stat.S_IMODE(info.st_mode)); os.fchown(target, info.st_uid, info.st_gid)
        finally:
            os.close(source); os.close(target)
    elif stat.S_ISREG(info.st_mode):
        budget[1] += info.st_size

        source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source_fd)
        target = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=target_fd)
        with os.fdopen(source, 'rb') as src, os.fdopen(target, 'wb') as dst:
            require(mount_id(source_fd) == mount_id(src.fileno()), 'REMOTE_FILE_MOUNT')
            require(revision(os.fstat(src.fileno())) == revision(info), 'REMOTE_FILE_CHANGED')
            copied = 0
            while True:
                data = src.read(1024*1024)
                if not data:
                    break
                copied += len(data)
                require(copied <= info.st_size, 'REMOTE_FILE_CHANGED')
                dst.write(data)
            require(copied == info.st_size and revision(os.fstat(src.fileno())) == revision(info), 'REMOTE_FILE_CHANGED')
            dst.flush(); os.fchmod(dst.fileno(), stat.S_IMODE(info.st_mode)); os.fchown(dst.fileno(), info.st_uid, info.st_gid); os.fsync(dst.fileno())
    elif stat.S_ISLNK(info.st_mode):
        os.symlink(os.readlink(name, dir_fd=source_fd), dest, dir_fd=target_fd)
        require(revision(metadata(source_fd, name)) == revision(info), 'REMOTE_FILE_CHANGED')
    else:
        raise RuntimeError('REMOTE_FILE_LINK')


def dispatch(request):
    try:
        require(os.geteuid() == 0, 'ADMIN_REQUIRED')
        method, path = request.get('method'), request.get('path')
        if method == 'remote-files/browse':
            value = browse(path)
        elif method in ('remote-files/write', 'remote-files/upload'):
            data = request.get('content', '').encode('utf-8') if method.endswith('write') else base64.b64decode(request.get('data', ''), validate=True)
            value = write(path, data, request.get('revision'))
        elif method == 'remote-files/download':
            parts(path)
            path = os.path.realpath(path)
            with parent(path) as (fd, name, target):
                check(fd, name, request.get('revision'))
                data, info = read_bytes(fd, name, LIMIT)
                require(revision(info) == request['revision'], 'REMOTE_FILE_CHANGED')
                value = dict(data=base64.b64encode(data).decode(), sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
        else:
            require(len(parts(path)) > 0)
            with parent(path) as (fd, name, target):
                if method == 'remote-files/mkdir':
                    os.mkdir(name, mode=0o755, dir_fd=fd)
                elif method == 'remote-files/remove':
                    require(request.get('confirm') is True)
                    check(fd, name, request.get('revision'))
                    delete_tree(fd, name, [0])
                elif method in ('remote-files/move', 'remote-files/copy'):
                    info = check(fd, name, request.get('revision'))
                    require(len(parts(request.get('destination'))) > 0)
                    if method.endswith('copy'):
                        destination = os.path.realpath(request['destination'])
                        require(not (destination.rstrip('/')+'/').startswith(os.path.realpath(target).rstrip('/')+'/'), 'REMOTE_FILE_INVALID')
                        with parent(request['destination']) as (other, dest, _):
                            temporary = '.awb-copy-'+uuid.uuid4().hex
                            try:
                                copy_tree(fd, name, other, temporary, [0, 0])
                                check(fd, name, request['revision'])
                                no_replace(other, temporary, other, dest)
                            finally:
                                try:
                                    delete_tree(other, temporary, [0])
                                except FileNotFoundError:
                                    pass
                    else:
                        with parent(request['destination']) as (other, dest, _):
                            no_replace(fd, name, other, dest)
                else:
                    raise RuntimeError('REMOTE_FILE_INVALID')
                os.fsync(fd)
                value = dict(path=target, completed=True)
        return dict(ok=True, value=value)
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else {errno.EACCES:'REMOTE_FILE_PERMISSION', errno.EEXIST:'REMOTE_FILE_EXISTS', errno.ENOENT:'REMOTE_FILE_MISSING', errno.ELOOP:'REMOTE_FILE_LINK', errno.EXDEV:'REMOTE_FILE_MOUNT', errno.ENOTDIR:'REMOTE_FILE_LINK'}.get(getattr(error, 'errno', None), 'REMOTE_FILE_OPERATION_UNCONFIRMED')
        return dict(ok=False, error=code)
