"""Small validation helpers for the independent root-only control service."""
import base64
from decimal import Decimal
from collections import deque
import hashlib
import json
import math
import os
from pathlib import PurePosixPath
import re
import stat
import struct

ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
USERNAME = re.compile(r'^[a-z_][a-z0-9_-]{0,31}$')
ENV_KEYS = {'LANG', 'LC_ALL', 'TZ', 'TERM', 'COLORTERM'}


class ControlError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ControlError('INVALID_REQUEST')
    return value


def public_text(value, maximum=256):
    if not isinstance(value, str) or not value or len(value) > maximum or re.search(r'[\x00-\x1f\x7f]|-----BEGIN|Bearer\s|(?:access_token|refresh_token|api_key)\s*[:=]', value, re.I):
        raise ControlError('INVALID_REQUEST')
    return value


def absolute_directory(value):
    if not isinstance(value, str) or not value.startswith('/') or '\x00' in value or len(value) > 1024 or '..' in PurePosixPath(value).parts:
        raise ControlError('INVALID_REQUEST')
    return str(PurePosixPath(value))


def normalized_environment(value):
    if not isinstance(value, dict) or set(value) != {'runtimes', 'defaultDirectory', 'env'}:
        raise ControlError('INVALID_REQUEST')
    runtimes = value['runtimes']
    if not isinstance(runtimes, list) or len(runtimes) > 2 or any(item not in ('codex', 'claude') for item in runtimes) or len(set(runtimes)) != len(runtimes):
        raise ControlError('INVALID_REQUEST')
    environment = value['env']
    if not isinstance(environment, dict) or not set(environment).issubset(ENV_KEYS):
        raise ControlError('INVALID_REQUEST')
    return {'runtimes': sorted(runtimes), 'defaultDirectory': absolute_directory(value['defaultDirectory']), 'env': {key: public_text(item, 128) for key, item in environment.items()}}


def normalized_budget(value):
    if not isinstance(value, dict) or set(value) != {'period', 'limit', 'unit', 'enforcement'} or value['period'] != 'month' or value['unit'] != 'usd' or value['enforcement'] != 'unavailable':
        raise ControlError('INVALID_REQUEST')
    limit = value['limit']
    if limit is not None and (type(limit) not in (int, float) or not math.isfinite(limit) or limit < 0 or limit > 1000000000):
        raise ControlError('INVALID_REQUEST')
    return dict(value)


def normalized_account_quotas(value):
    if not isinstance(value, dict) or len(value) > 128:
        raise ControlError('INVALID_QUOTA_ALLOCATION')
    result = {}
    for account_id, allocation in value.items():
        require_id(account_id)
        if not isinstance(allocation, dict) or not {'weeklyPercent', 'fiveHourPercent'}.issubset(allocation) or not set(allocation).issubset({'weeklyPercent', 'fiveHourPercent', 'allowOverage'}):
            raise ControlError('INVALID_QUOTA_ALLOCATION')
        if type(allocation.get('allowOverage', True)) is not bool:
            raise ControlError('INVALID_QUOTA_ALLOCATION')
        for amount in (allocation['weeklyPercent'], allocation['fiveHourPercent']):
            if amount is not None and (type(amount) not in (int, float) or not math.isfinite(amount) or not 0 <= amount <= 100 or Decimal(str(amount)) * 100 != (Decimal(str(amount)) * 100).to_integral_value()):
                raise ControlError('INVALID_QUOTA_ALLOCATION')
        result[account_id] = dict(allocation, allowOverage=allocation.get('allowOverage', True))
    return result


def account_ids(value):
    if not isinstance(value, list) or len(value) > 128:
        raise ControlError('INVALID_REQUEST')
    result = [require_id(item) for item in value]
    if len(set(result)) != len(result):
        raise ControlError('INVALID_REQUEST')
    return sorted(result)


def public_key(value, *, device=True):
    if not isinstance(value, str) or len(value) > 8192 or '\n' in value or '\r' in value:
        raise ControlError('INVALID_PUBLIC_KEY')
    parts = value.strip().split()
    allowed = ('ssh-ed25519',) if device else ('ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521')
    if len(parts) < 2 or parts[0] not in allowed:
        raise ControlError('INVALID_PUBLIC_KEY')
    try:
        blob = base64.b64decode(parts[1], validate=True)
        length = struct.unpack('>I', blob[:4])[0]
        if blob[4:4 + length].decode('ascii') != parts[0]:
            raise ValueError()
        if device and (len(blob) != 51 or blob[15:19] != struct.pack('>I', 32)):
            raise ValueError()
    except (ValueError, UnicodeError, struct.error):
        raise ControlError('INVALID_PUBLIC_KEY') from None
    if len(blob) > 8192:
        raise ControlError('INVALID_PUBLIC_KEY')
    return parts[0] + ' ' + base64.b64encode(blob).decode('ascii'), 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode('ascii').rstrip('=')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')).hexdigest()


def trusted_root_path(value, *, directory=False, executable=False, allow_symlinks=False, private=False):
    """Only root-owned, non-writable-by-others paths may host control authority."""
    if not isinstance(value, str) or not value.startswith('/') or '\x00' in value:
        raise ControlError('UNSAFE_DEPLOYMENT')
    pending = deque(PurePosixPath(value).parts[1:])
    resolved = []
    links = 0
    root = os.lstat('/')
    if root.st_uid != 0 or root.st_mode & 0o022 or not stat.S_ISDIR(root.st_mode):
        raise ControlError('UNSAFE_DEPLOYMENT')
    while pending:
        part = pending.popleft()
        if part == '..':
            if resolved:
                resolved.pop()
            continue
        current = '/' + '/'.join(resolved + [part])
        item = os.lstat(current)
        if stat.S_ISLNK(item.st_mode):
            if not allow_symlinks or item.st_uid != 0 or links >= 32:
                raise ControlError('UNSAFE_DEPLOYMENT')
            links += 1
            target = PurePosixPath(os.readlink(current))
            if target.is_absolute():
                resolved = []
            pending.extendleft(reversed(target.parts[1:] if target.is_absolute() else target.parts))
            continue
        if item.st_uid != 0 or item.st_mode & 0o022 or (pending and not stat.S_ISDIR(item.st_mode)):
            raise ControlError('UNSAFE_DEPLOYMENT')
        resolved.append(part)
    result = '/' + '/'.join(resolved)
    item = os.lstat(result)
    if directory and not stat.S_ISDIR(item.st_mode) or not directory and not stat.S_ISREG(item.st_mode) or private and item.st_mode & 0o077 or executable and not item.st_mode & 0o111:
        raise ControlError('UNSAFE_DEPLOYMENT')
    return result
