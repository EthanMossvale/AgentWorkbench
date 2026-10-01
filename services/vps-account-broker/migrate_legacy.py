#!/usr/bin/env python3
"""Operator-run migration, never invoked automatically by the desktop.

Run enroll, complete official login, publish workspace grants, stop the retired
writers, then import. Source histories are retained. Credentials are never read.
"""
import argparse
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import struct

from migration import histories, directory, require


def request(method, params):
    endpoint = Path('/run/agent-workbench-accounts/broker.sock')
    parent = endpoint.parent.lstat()
    entry = endpoint.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid != 0 and not parent.st_mode & 0o022)
    require(stat.S_ISSOCK(entry.st_mode) and entry.st_uid == parent.st_uid)
    with socket.socket(socket.AF_UNIX) as channel:
        channel.settimeout(120)
        channel.connect(str(endpoint))
        require(struct.unpack('3i', channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] == parent.st_uid)
        channel.sendall((json.dumps({'protocol': 1, 'method': method, 'params': params}) + '\n').encode())
        result = json.loads(channel.makefile('rb').readline(1048577))
        require(result.get('ok') is True, result.get('error', 'MIGRATION_UNAVAILABLE'))
        return result['value']


def quiescent(profile):
    # The old bridge launches with this exact cwd. No process environments,
    # private configuration, authentication files or command output are read.
    for entry in Path('/proc').iterdir():
        if entry.name.isdigit():
            try:
                cwd = Path(os.readlink(entry / 'cwd'))
                require(cwd != profile and profile not in cwd.parents, 'MIGRATION_SOURCE_RUNNING')
            except (FileNotFoundError, ProcessLookupError):
                pass


def stage_history(manifest, stage):
    member = pwd.getpwnam(manifest['username'])
    profile = Path(member.pw_dir) / '.agent-workbench' / 'native-codex' / manifest['sessionId']
    # Validate every user-controlled ancestor before reading allowlisted files.
    for ancestor in (Path(member.pw_dir), profile.parent.parent, profile.parent, profile):
        info = ancestor.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == member.pw_uid and not info.st_mode & 0o022, 'MIGRATION_UNSAFE_SOURCE')
    quiescent(profile)
    files = histories(profile, member.pw_uid)
    target = Path(stage['stagingPath'])
    owner = stage['ownerUid']
    directory(target, owner)
    for entry in files.values():
        relative, raw = entry['relative'], entry['raw']
        destination = target / relative
        current = target
        for part in relative.parts[:-1]:
            current = current / part
            if not current.exists():
                current.mkdir(mode=0o700)
                os.chown(current, owner, -1)
            directory(current, owner)
        if destination.exists() or destination.is_symlink():
            from migration import regular, MAX_HISTORY_FILE
            require(regular(destination, owner, MAX_HISTORY_FILE) == raw, 'MIGRATION_SOURCE_CHANGED')
        else:
            import uuid
            temporary = target / ('.stage-' + uuid.uuid4().hex)
            with open(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
                output.write(raw); output.flush(); os.fsync(output.fileno())
                os.fchown(output.fileno(), owner, -1)
            os.replace(temporary, destination)
    quiescent(profile)
    again = histories(profile, member.pw_uid)
    require(files == again, 'MIGRATION_SOURCE_CHANGED')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['enroll', 'import'])
    parser.add_argument('--manifest', required=True, help='Public session migration manifest copied from the desktop')
    parser.add_argument('--email', help='Original account email confirmed by the operator')
    parser.add_argument('--confirm-same-account', action='store_true')
    parser.add_argument('--legacy-writers-stopped', action='store_true')
    parser.add_argument('--root-rollout', help='Exact relative active rollout path from native metadata; required after thread revert creates multiple versions')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    require(args.confirm_same_account, 'MIGRATION_ACCOUNT_CONFIRMATION_REQUIRED')
    with open(args.manifest, 'r', encoding='utf-8') as stream:
        manifest = json.loads(stream.read(16385))
    if args.action == 'enroll':
        enrolled = request('migration/enroll', {'accountRef': manifest['accountRef'], 'email': args.email, 'sameAccountConfirmed': True})
        from migration import reference
        authority, generation, _, account_id, _ = reference(enrolled['accountRef'])
        login = request('runtime/login-command', {'authorityId': authority, 'generation': generation, 'accountId': account_id})
        print(json.dumps({'account': enrolled, 'loginCommand': login['command'], 'next': 'Complete official login and grant this account to the existing workspace before import.'}))
    else:
        require(args.legacy_writers_stopped, 'MIGRATION_STOP_LEGACY_WRITERS_REQUIRED')
        stage = request('migration/stage', {'manifest': manifest})
        if manifest['threadId']:
            stage_history(manifest, stage)
        commit = {'migrationId': stage['migrationId'], 'sameAccountConfirmed': True, 'sourceStopped': True}
        if args.root_rollout is not None:
            commit['rootRollout'] = args.root_rollout
        receipt = request('migration/commit', commit)
        print(json.dumps(receipt))


if __name__ == '__main__':
    main()
