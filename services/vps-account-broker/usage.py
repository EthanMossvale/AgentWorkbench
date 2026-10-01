"""Public native quota projection. Never expose a raw account RPC response."""
def project_usage(limits):
    def window(value):
        return {k: value.get(k) for k in ('usedPercent', 'windowDurationMins', 'resetsAt')} if isinstance(value, dict) else None
    def pool(value):
        value = value if isinstance(value, dict) else {}
        credit = value.get('credits')
        return {'limitId': value.get('limitId'), 'limitName': value.get('limitName'), 'planType': value.get('planType'),
                'primary': window(value.get('primary')), 'secondary': window(value.get('secondary')),
                'credits': {k: credit.get(k) for k in ('unlimited', 'balance')} if isinstance(credit, dict) else None}
    pools = limits.get('rateLimitsByLimitId')
    if not isinstance(pools, dict):
        pools = {'codex': limits.get('rateLimits', {})}
    credits = limits.get('rateLimitResetCredits')
    details = credits.get('credits') if isinstance(credits, dict) else None
    return {'pools': {k: pool(v) for k, v in list(pools.items())[:32]},
            'resetCredits': {'availableCount': credits.get('availableCount'),
                             'credits': [{k: row.get(k) for k in ('id', 'resetType', 'status', 'grantedAt', 'expiresAt', 'title')} for row in details[:128] if isinstance(row, dict)] if isinstance(details, list) else None} if isinstance(credits, dict) else None}


def _claude_path(runtime, account):
    import hashlib
    identity = '/'.join((runtime.broker.authority_id, runtime.broker.generation, account['id'], account['generation']))
    return runtime.broker.registry.root / ('claude-usage-' + hashlib.sha256(identity.encode()).hexdigest() + '.json')


def _number(value):
    import math
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def read_claude_usage(runtime, account):
    import json
    path = _claude_path(runtime, account)
    if not path.exists():
        return {'pools': {}}
    if path.is_symlink() or path.stat().st_size > 4096:
        raise ValueError('CLAUDE_QUOTA_RECEIPT_INVALID')
    with path.open(encoding='utf-8') as source:
        value = json.load(source)
    if not isinstance(value, dict) or not _number(value.get('observedAt')):
        raise ValueError('CLAUDE_QUOTA_RECEIPT_INVALID')
    pool = value.get('pools', {}).get('claude', {})
    windows = {}
    for key, duration in (('primary', 300), ('secondary', 10080)):
        w = pool.get(key)
        if isinstance(w, dict) and _number(w.get('usedPercent')) and w['usedPercent'] <= 100 and w.get('windowDurationMins') == duration:
            windows[key] = {'usedPercent': w['usedPercent'], 'windowDurationMins': duration}
            if _number(w.get('resetsAt')):
                windows[key]['resetsAt'] = w['resetsAt']
    return {'observedAt': value['observedAt'], 'pools': {'claude': dict(windows, limitName='Claude')} if windows else {}}


def observe_claude_usage(runtime, account, value):
    # Called only on the authenticated native stdout channel. Never store raw frames.
    if not isinstance(value, dict):
        return
    updates = {}
    limits = value.get('rate_limits', {})
    for name, key, duration in (('five_hour', 'primary', 300), ('seven_day', 'secondary', 10080)):
        row = limits.get(name, {}) if isinstance(limits, dict) else {}
        if isinstance(row, dict) and _number(row.get('used_percentage')) and row['used_percentage'] <= 100:
            updates[key] = {'usedPercent': row['used_percentage'], 'windowDurationMins': duration}
            if _number(row.get('resets_at')):
                updates[key]['resetsAt'] = row['resets_at']
    info = value.get('rate_limit_info', value.get('rateLimitInfo', {}))
    if value.get('type') == 'rate_limit_event' and isinstance(info, dict) and info.get('rateLimitType') in ('five_hour', 'seven_day') and _number(info.get('utilization')) and info['utilization'] <= 1:
        key, duration = ('primary', 300) if info['rateLimitType'] == 'five_hour' else ('secondary', 10080)
        updates[key] = {'usedPercent': info['utilization'] * 100, 'windowDurationMins': duration}
        if _number(info.get('resetsAt')):
            updates[key]['resetsAt'] = info['resetsAt']
    if not updates:
        return
    from runtime import atomic
    with runtime.state.lock:
        previous = read_claude_usage(runtime, account).get('pools', {}).get('claude', {})
        windows = {key: row for key, row in previous.items() if key in ('primary', 'secondary') and (not row.get('resetsAt') or row['resetsAt'] > runtime.broker.now())}
        windows.update(updates)
        atomic(_claude_path(runtime, account), {'observedAt': runtime.broker.now(), 'pools': {'claude': dict(windows, limitName='Claude')}})

        getattr(runtime, 'claude_quota_errors', set()).discard(runtime.state.account_key(account))


def project_claude_usage(value, observed_at):
    """Allowlist the native get_usage reply; never retain session or behavior data."""
    from datetime import datetime
    from runtime import RuntimeErrorCode
    if not isinstance(value, dict) or type(value.get('rate_limits_available')) is not bool:
        raise RuntimeErrorCode('CLAUDE_QUOTA_RESPONSE_INVALID')
    limits = value.get('rate_limits')
    if value['rate_limits_available'] and not isinstance(limits, dict):
        raise RuntimeErrorCode('CLAUDE_QUOTA_QUERY_FAILED')
    windows = {}
    for name, key, duration in (('five_hour', 'primary', 300), ('seven_day', 'secondary', 10080)):
        row = limits.get(name) if isinstance(limits, dict) else None
        if not isinstance(row, dict) or row.get('utilization') is None:
            continue
        percent = row['utilization']
        if not _number(percent) or percent > 100:
            raise RuntimeErrorCode('CLAUDE_QUOTA_RESPONSE_INVALID')
        window = {'usedPercent': percent, 'windowDurationMins': duration}
        reset = row.get('resets_at')
        if reset is not None:
            try:
                if not isinstance(reset, str) or len(reset) > 64:
                    raise ValueError()
                parsed = datetime.fromisoformat(reset.replace('Z', '+00:00'))
                if parsed.tzinfo is None or parsed.timestamp() < 0:
                    raise ValueError()
                window['resetsAt'] = parsed.timestamp()
            except (ValueError, TypeError, OverflowError):
                raise RuntimeErrorCode('CLAUDE_QUOTA_RESPONSE_INVALID') from None
        windows[key] = window
    return {'observedAt': observed_at, 'pools': {'claude': dict(windows, limitName='Claude')} if windows else {}}
