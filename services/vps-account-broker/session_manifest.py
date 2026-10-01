"""Select native session dependency groups without reading credential files."""
import json
import os
from pathlib import Path
import re
import stat


def select_paths(root, owner, provider, receipts, sessions):
    from session_storage import CATEGORIES, require, regular, parent_handle
    paths = []
    for category in CATEGORIES[provider]:
        base = root / category
        if not os.path.lexists(base):
            continue
        require(stat.S_ISDIR(base.lstat().st_mode) and base.lstat().st_uid == owner, 'STORAGE_UNSAFE_FILE')
        for folder, directories, files in os.walk(base, followlinks=False):
            for name in directories:
                info = (Path(folder)/name).lstat()
                require(stat.S_ISDIR(info.st_mode) and info.st_uid == owner and not info.st_mode & 0o022, 'STORAGE_UNSAFE_FILE')
            for name in files:
                relative = (Path(folder)/name).relative_to(root).as_posix()
                regular(root, {'path':relative}, owner, provider)
                paths.append(relative)
                require(len(paths) <= 50000, 'STORAGE_ARCHIVE_TOO_LARGE')
    seeds = {}
    for receipt in receipts:
        ids = [receipt.get('threadId'), *receipt.get('childThreadIds', [])]
        seeds[receipt['sessionId']] = {v for v in ids if isinstance(v, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', v)}
    selected = set().union(*(seeds.get(s, set()) for s in sessions))
    if not selected:
        return []
    result = {}
    if provider == 'codex':
        records, lookup = {}, {}
        for relative in paths:
            if relative.split('/')[0] not in ('sessions', 'archived_sessions') or not relative.endswith('.jsonl'):
                continue
            with parent_handle(root, {'path':relative}, owner, provider) as (parent, name):
                with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent), 'rb') as stream:
                    info = os.fstat(stream.fileno())
                    require(stat.S_ISREG(info.st_mode) and info.st_uid == owner and info.st_nlink == 1, 'STORAGE_UNSAFE_FILE')
                    first = stream.readline(1024*1024+1)
            require(len(first) <= 1024*1024, 'STORAGE_INVALID_NATIVE_METADATA')
            try:
                value = json.loads(first); meta = value['payload']; ident = meta['id']
                require(value['type'] == 'session_meta' and isinstance(ident, str), 'STORAGE_INVALID_NATIVE_METADATA')
            except (ValueError, KeyError, TypeError):
                raise RuntimeError('STORAGE_INVALID_NATIVE_METADATA') from None
            source = meta.get('source', {})
            agent = source.get('subagent', source.get('subAgent', {})) if isinstance(source, dict) else {}
            parent = meta.get('parent_thread_id')
            if isinstance(agent, dict) and isinstance(agent.get('thread_spawn'), dict):
                parent = agent['thread_spawn'].get('parent_thread_id', parent)
            base = meta.get('history_base')
            base_id = base.get('thread_id') if isinstance(base, dict) else None
            records[relative] = dict(id=ident, parent=parent, base=base_id)
            filename_id = re.search(r'([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.jsonl$', relative)
            for key in {ident, filename_id.group(1) if filename_id else ident}:
                require(key not in lookup or lookup[key] == relative, 'STORAGE_AMBIGUOUS_NATIVE_HISTORY')
                lookup[key] = relative
        def owned(ids):
            ids = set(ids)
            changed = True
            while changed:
                added = {r['id'] for r in records.values() if r['parent'] in ids}-ids
                changed = bool(added); ids.update(added)
            return {p for p,r in records.items() if r['id'] in ids}, ids
        def closure(initial):
            found = set(initial); pending = list(initial)
            while pending:
                dependency = records[pending.pop()]['base']
                if dependency:
                    require(dependency in lookup, 'STORAGE_DEPENDENCY_MISSING')
                    path = lookup[dependency]
                    if path not in found:
                        found.add(path); pending.append(path)
            return found
        own, selected = owned(selected)
        dependencies = closure(own)
        protected = set()
        all_owned = set()
        for receipt in receipts:
            group, _ = owned(seeds[receipt['sessionId']]); all_owned.update(group)
            if receipt['sessionId'] not in sessions and not receipt.get('storageArchive'):
                protected.update(closure(group))
        for relative in dependencies:
            result[relative] = relative in all_owned and relative not in protected
        for relative in paths:
            pieces = relative.split('/')
            if pieces[0] == 'generated_images' and len(pieces)>2 and pieces[1] in selected:
                result[relative] = True
    else:
        # Native Claude roots and their subagent/tool-result directories use the
        # native session ID. Shared or unrecognized paths are never reclaimed.
        for relative in paths:
            pieces = relative.split('/')
            if pieces[0] == 'projects':
                belongs = len(pieces)>=3 and (pieces[2].removesuffix('.jsonl') in selected or pieces[2] in selected)
            else:
                belongs = len(pieces)>=2 and (pieces[1] in selected or any(pieces[1].startswith(ident+'-agent-') and pieces[1].endswith('.json') for ident in selected))
            if belongs:
                result[relative] = True
    return [dict(path=p, delete=result[p]) for p in sorted(result)]
