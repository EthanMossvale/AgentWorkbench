"""Account/window-isolated estimated attribution and source-specific quota loans.

Only numeric observations from the trusted desktop native bridge are accepted by
the root control entrypoint. No conversation files, credentials or price tables.
"""
import copy
import hashlib
import math
from security import ControlError, require_id

SCALE = 1000000  # integer micro percentage points; 100% is FULL
FULL = 100 * SCALE
WINDOWS = {'weekly': ('weeklyPercent', 10080)}


def number(value, maximum=1e15):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum


def split(amount, weights):
    total = sum(weights.values())
    if total <= 0:
        return {key: 0 for key in weights}
    result = {key: amount * weight // total for key, weight in weights.items()}
    order = sorted(weights, key=lambda key: (-(amount * weights[key] % total), key))
    for key in order[:amount - sum(result.values())]:
        result[key] += 1
    return result


class QuotaAccounting:
    def __init__(self, state, workspaces):
        self.state = state
        self.workspaces = workspaces
        for account in state.values():
            for window in account.get('windows', {}).values():
                if window.get('attributionVersion') == 2:
                    continue
                # Undo the exactly reconstructable proportional baseline haircut.
                # Preserve loans and later attributed consumption, never reset a ledger.
                base = window.get('grantBase', FULL)
                policy = window.get('cyclePolicy', {})
                for workspace, rule in policy.items():
                    share = round((rule.get('percent') or 0) * 100)
                    credit = FULL * share // 10000 - base * share // 10000
                    window['balances'][workspace] = window['balances'].get(workspace, 0) + credit
                window['grantBase'] = FULL
                window['attributionVersion'] = 2
                baseline = next((e for e in window.get('entries', []) if e['kind'] in ('baseline', 'refresh')), None)
                window.setdefault('baselineAt', baseline['at'] if baseline else 0)
                window.setdefault('baselineUsed', (FULL - base) / SCALE)

    def policy(self, account, window):
        field = WINDOWS[window][0]
        return {w['id']: dict(percent=w.get('accountQuotas', {}).get(account, {}).get(field),
                             allowOverage=w.get('accountQuotas', {}).get(account, {}).get('allowOverage', True),
                             active=w['status'] == 'active')
                for w in self.workspaces.values() if w['status'] != 'deleted' and account in w['allowedAccountIds']}

    @staticmethod
    def entry(window, kind, at, **values):
        window['entries'].append(dict(kind=kind, at=at, **values))
        window['entries'] = window['entries'][-100:]

    def grant(self, account, key, window, used, reset_at, at, initial=False):
        policy = self.policy(account, key)
        # Shares are entitlements, not a pro-rata slice of the account remainder.
        # Unknown account usage must not become another workspace's charge.
        remaining = FULL
        window.update(resetAt=reset_at, observedAt=at, usedPercent=used,
                      attributionVersion=2, baselineAt=at, baselineUsed=used, historyTokens={}, cyclePolicy=copy.deepcopy(policy), grantBase=remaining, reserveUsed={}, overdrafts={}, balances={w: remaining * round((p['percent'] or 0) * 100) // 10000 for w, p in policy.items()},
                      pending={}, sampleTokens=0, samplePercent=0, samples=0,
                      unassignedPercent=used, overrunPercent=0)
        window['reserve'] = remaining - sum(window['balances'].values())
        self.entry(window, 'baseline' if initial else 'refresh', at)
        if not initial:
            # Every debt retains its original creditor; never net debts across
            # accounts, windows, or a third party. Unpaid amounts carry forward.
            for debt in window['debts']:
                borrower, lender = debt['borrower'], debt['lender']
                if borrower not in policy or lender not in policy:
                    continue
                payment = min(debt['amount'], max(0, window['balances'].get(borrower, 0)))
                if payment:
                    window['balances'][borrower] -= payment
                    window['balances'][lender] = window['balances'].get(lender, 0) + payment
                    debt['amount'] -= payment
                    self.entry(window, 'repay', at, borrower=borrower, lender=lender, percent=payment / SCALE)
            window['debts'] = [debt for debt in window['debts'] if debt['amount'] > 0]

    def consume(self, account, key, window, workspace, amount, at):
        policy = self.policy(account, key)
        rule = policy.get(workspace)
        if rule:
            rule = dict(rule, percent=window.get('cyclePolicy', {}).get(workspace, rule)['percent'])
        if not rule or rule['percent'] is None:
            return self.unassigned(window, amount, at)
        recovered = self.recovered_percent(window)
        available = lambda member: max(0, window['balances'].get(member, 0) - round(recovered.get(member, 0) * SCALE))
        own = min(amount, available(workspace))
        window['balances'][workspace] = window['balances'].get(workspace, 0) - own
        left = amount - own
        if left and rule['allowOverage']:
            lenders = sorted((w for w, p in policy.items() if w != workspace and p['active']),
                             key=lambda w: (-available(w), w))
            for lender in lenders:
                borrowed = min(left, available(lender))
                if not borrowed:
                    continue
                window['balances'][lender] -= borrowed
                left -= borrowed
                debt = next((d for d in window['debts'] if d['borrower'] == workspace and d['lender'] == lender), None)
                if debt:
                    debt['amount'] += borrowed
                else:
                    window['debts'].append(dict(borrower=workspace, lender=lender, amount=borrowed))
                self.entry(window, 'borrow', at, borrower=workspace, lender=lender, percent=borrowed / SCALE)
                if not left:
                    break
        if left and rule['allowOverage']:
            reserve = min(left, max(0, window.get('reserve', 0)))
            window.setdefault('reserveUsed', {})[workspace] = window.get('reserveUsed', {}).get(workspace, 0) + reserve
            window['reserve'] = window.get('reserve', 0) - reserve
            left -= reserve
        if left:
            # Observed use cannot be undone, and must never be disguised as an
            # authorized loan when borrowing is off or no lender has inventory.
            self.unassigned(window, left, at)
            window.setdefault('overdrafts', {})[workspace] = window.get('overdrafts', {}).get(workspace, 0) + left
            window['overrunPercent'] += left / SCALE
            self.entry(window, 'overrun', at, workspaceId=workspace, percent=left / SCALE)
        self.entry(window, 'consume', at, workspaceId=workspace, percent=amount / SCALE)

    def unassigned(self, window, amount, at):
        window['unassignedPercent'] += amount / SCALE
        reserve = min(amount, max(0, window.get('reserve', 0)))
        window['reserve'] = window.get('reserve', 0) - reserve
        amount -= reserve
        self.entry(window, 'unassigned', at, percent=amount / SCALE)

    def observe(self, payload, at):
        if not isinstance(payload, dict) or not set(payload).issubset({'accountId', 'accountGeneration', 'workspaceId', 'scope', 'totalTokens', 'lastTokens', 'windows', 'phase', 'history'}):
            raise ControlError('INVALID_QUOTA_OBSERVATION')
        account, generation = require_id(payload.get('accountId')), require_id(payload.get('accountGeneration'))
        account_key = hashlib.sha256((account + '\0' + generation).encode()).hexdigest()
        if account_key not in self.state and len(self.state) >= 128:
            raise ControlError('REGISTRY_FULL')
        state = self.state.setdefault(account_key, dict(accountId=account, accountGeneration=generation, windows={}, cursors={}, active={}))
        state.setdefault('active', {})
        if 'history' in payload:
            self.recover(state, payload, at)
        token_delta = 0
        workspace = payload.get('workspaceId')
        if 'scope' in payload:
            scope = require_id(payload['scope'])
            member = self.workspaces.get(require_id(workspace))
            if not member or member['status'] != 'active' or account not in member['allowedAccountIds']:
                raise ControlError('QUOTA_ACCOUNT_NOT_ALLOWED')
            phase = payload.get('phase')
            if phase not in (None, 'begin', 'finish'):
                raise ControlError('INVALID_QUOTA_OBSERVATION')
            if phase == 'begin':
                state['active'][scope] = at
            elif phase == 'finish':
                state['active'].pop(scope, None)
            if 'totalTokens' in payload:
                total, last = payload.get('totalTokens'), payload.get('lastTokens')
                if type(total) is not int or type(last) is not int or not 0 <= last <= total <= 10**14:
                    raise ControlError('INVALID_QUOTA_OBSERVATION')
                previous = state['cursors'].get(scope)
                if previous and previous['workspaceId'] != workspace:
                    raise ControlError('INVALID_QUOTA_OBSERVATION')
                if not previous and len(state['cursors']) >= 4096:
                    raise ControlError('REGISTRY_FULL')
                token_delta = last if previous is None or 'total' not in previous else max(0, total - previous['total'])
                state['cursors'][scope] = dict(previous or {}, total=max(total, (previous or {}).get('total', 0)), workspaceId=workspace, observedTokens=(previous or {}).get('observedTokens', 0) + token_delta)
                for key, window in state['windows'].items():
                    if key not in WINDOWS:
                        continue
                    window['pending'][workspace] = window['pending'].get(workspace, 0) + token_delta
        expired = [scope for scope, started in state['active'].items() if at - started > 14400]
        for scope in expired:
            state['active'].pop(scope)
        if expired:
            for window in state['windows'].values():
                window['coverageGap'] = True
        observations = payload.get('windows', [])
        if not isinstance(observations, list) or len(observations) > 2:
            raise ControlError('INVALID_QUOTA_OBSERVATION')
        for observation in observations:
            if not isinstance(observation, dict) or set(observation) != {'window', 'usedPercent', 'resetsAt'}:
                raise ControlError('INVALID_QUOTA_OBSERVATION')
            key, used, reset_at = observation['window'], observation['usedPercent'], observation['resetsAt']
            if key not in ('weekly', 'fiveHour') or not number(used, 100) or not number(reset_at, 1e12) or reset_at <= at:
                raise ControlError('INVALID_QUOTA_OBSERVATION')
            # Accept legacy telemetry without accounting short-window allocations.
            if key not in WINDOWS:
                continue
            if key not in state['windows']:
                window = state['windows'][key] = dict(debts=[], entries=[])
                self.grant(account, key, window, used, reset_at, at, initial=True)
                continue
            window = state['windows'][key]
            # Reset timestamp changes alone can be provider jitter. Require an
            # elapsed prior deadline, or an actual quota decrease for a card.
            reset = (at >= window['resetAt'] and reset_at > window['resetAt']) or (used < window['usedPercent'] and reset_at > window['resetAt'] + 120)
            if reset:
                self.grant(account, key, window, used, reset_at, at)
                continue
            if used < window['usedPercent'] or abs(reset_at - window['resetAt']) > 120:
                window['pending'] = {}
                window['sampleTokens'] = window['samplePercent'] = window['samples'] = 0
                self.entry(window, 'uncertain-reset', at)
                # Keep debts and balances until a proven refresh; no fictitious repayment.
                window['observedAt'] = at
                continue
            delta = round((used - window['usedPercent']) * SCALE)
            if delta > 0 and state['active']:
                # Wait for every known active producer; assigning a shared
                # increase to whichever device finishes first would overcharge it.
                window['observedAt'] = at
                continue
            if delta > 0:
                weights = {w: count for w, count in window['pending'].items() if count > 0}
                if weights and not window.get('coverageGap'):
                    for member, amount in split(delta, weights).items():
                        self.consume(account, key, window, member, amount, at)
                    window['sampleTokens'] += sum(weights.values())
                    window['samplePercent'] += delta / SCALE
                    window['samples'] += 1
                else:
                    self.unassigned(window, delta, at)
                window['pending'] = {}
                window['coverageGap'] = False
            window.update(usedPercent=used, observedAt=at, resetAt=reset_at)
        return self.summary(account, generation)

    def reallocate(self):
        # Apply policy deltas without erasing consumption or lender identities.
        for state in self.state.values():
            for key, window in state['windows'].items():
                if key not in WINDOWS:
                    continue
                old = window.get('cyclePolicy', {})
                new = self.policy(state['accountId'], key)
                base = window.get('grantBase')
                if base is None:
                    baseline = next((e for e in reversed(window.get('entries', [])) if e['kind'] in ('baseline', 'refresh')), None)
                    base = FULL if baseline and baseline['kind'] == 'refresh' else max(0, FULL - round(window.get('unassignedPercent', 0) * SCALE))
                    window['grantBase'] = base
                for workspace in set(old) | set(new):
                    before = old.get(workspace, {}).get('percent') or 0
                    after = new.get(workspace, {}).get('percent') or 0
                    delta = base * round(after * 100) // 10000 - base * round(before * 100) // 10000
                    window['balances'][workspace] = window['balances'].get(workspace, 0) + delta
                    window['reserve'] = window.get('reserve', 0) - delta
                # Account exhaustion is checked separately, never redistributed.
                window['cyclePolicy'] = copy.deepcopy(new)

    def recover(self, state, payload, at):
        history = payload['history']
        workspace = require_id(payload.get('workspaceId'))
        member = self.workspaces.get(workspace)
        if not member or member['status'] != 'active' or state['accountId'] not in member['allowedAccountIds']:
            raise ControlError('QUOTA_ACCOUNT_NOT_ALLOWED')
        if not isinstance(history, list) or len(history) > 100:
            raise ControlError('INVALID_QUOTA_OBSERVATION')
        for row in history:
            if not isinstance(row, dict) or set(row) != {'scope', 'tokens', 'baselineTokens', 'resetsAt'} or any(type(row[k]) is not int or not 0 <= row[k] <= 10**14 for k in ('tokens', 'baselineTokens')) or row['baselineTokens'] > row['tokens'] or not number(row['resetsAt'], 1e12):
                raise ControlError('INVALID_QUOTA_OBSERVATION')
            scope = require_id(row['scope'])
            old = state['cursors'].get(scope)
            if old and old['workspaceId'] != workspace:
                raise ControlError('INVALID_QUOTA_OBSERVATION')
            if not old and len(state['cursors']) >= 4096:
                raise ControlError('REGISTRY_FULL')
            cursor = state['cursors'].setdefault(scope, dict(workspaceId=workspace, observedTokens=0))
            if row['tokens'] > cursor.get('historyHighWater', -1):
                observed = cursor.get('observedTokens', 0)
                cursor['recoveredTokens'] = max(row['tokens'], cursor.get('recoveredTokens', 0) + max(0, observed - cursor.get('recoveredObserved', observed)))
                cursor['recoveredObserved'] = observed
                cursor['historyHighWater'] = row['tokens']
            window = state['windows'].get('weekly')
            if window and abs(window['resetAt'] - row['resetsAt']) <= 120:
                window.setdefault('historyTokens', {})[scope] = dict(workspaceId=workspace, tokens=max(row['baselineTokens'], window.get('historyTokens', {}).get(scope, {}).get('tokens', 0)))
        # Old history does not enter live pending weights or manufacture a
        # token-to-percent conversion without time-aligned provider evidence.

    @staticmethod
    def recovered_percent(window):
        if window['samplePercent'] <= 0 or window['sampleTokens'] <= 0:
            return {}
        recovered = {}
        for row in window.get('historyTokens', {}).values():
            recovered[row['workspaceId']] = recovered.get(row['workspaceId'], 0) + row['tokens']
        total = window['sampleTokens'] * 100 / window['samplePercent']
        amount = min(round(window.get('baselineUsed', 0) * SCALE), round(sum(recovered.values()) / total * FULL))
        return {w: n / SCALE for w, n in split(amount, recovered).items()}

    def summary(self, account, generation):
        state = next((s for s in self.state.values() if s['accountId'] == account and s['accountGeneration'] == generation), None)
        result = dict(accountId=account, mode='estimated', windows=[], coverage='workbench-observed', workspaceNames={w['id']: w['name'] for w in self.workspaces.values() if w['status'] != 'deleted' and account in w['allowedAccountIds']}, allocations={w['id']: copy.deepcopy(w.get('accountQuotas', {}).get(account, {})) for w in self.workspaces.values() if w['status'] != 'deleted' and account in w['allowedAccountIds']}, tokenTotals={})
        if not state:
            result['historyVersion'] = 1
            return result
        result['historyVersion'] = 1
        for cursor in state.get('cursors', {}).values():
            member = cursor['workspaceId']
            observed = cursor.get('observedTokens', 0)
            total = max(observed, cursor.get('recoveredTokens', 0) + max(0, observed - cursor.get('recoveredObserved', observed)))
            result['tokenTotals'][member] = result['tokenTotals'].get(member, 0) + total
        for key, window in state['windows'].items():
            if key not in WINDOWS:
                continue
            total = window['sampleTokens'] * 100 / window['samplePercent'] if window['samplePercent'] > 0 and window['sampleTokens'] > 0 else None
            recovered = {}
            for row in window.get('historyTokens', {}).values():
                recovered[row['workspaceId']] = recovered.get(row['workspaceId'], 0) + row['tokens']
            recovered_percent = self.recovered_percent(window)
            result['windows'].append(dict(window=key, resetsAt=window['resetAt'], observedAt=window['observedAt'],
                baselineAt=window.get('baselineAt'), recoveredTokens=recovered, recoveredPercent=recovered_percent,
                usedPercent=window['usedPercent'], sampleTokens=window['sampleTokens'], samplePercent=window['samplePercent'],
                estimatedTotalTokens=total, samples=window['samples'], unassignedPercent=window['unassignedPercent'], overrunPercent=window['overrunPercent'],
                balances={w: amount / SCALE - recovered_percent.get(w, 0) for w, amount in window['balances'].items()},
                reserveUsed={w: amount / SCALE for w, amount in window.get('reserveUsed', {}).items()},
                overdrafts={w: amount / SCALE for w, amount in window.get('overdrafts', {}).items()},
                debts=[dict(borrower=d['borrower'], lender=d['lender'], percent=d['amount'] / SCALE) for d in window['debts']],
                entries=copy.deepcopy(window['entries'])))
        return result

    def check(self, account, generation, workspace, at):
        summary = self.summary(account, generation)
        member = self.workspaces.get(workspace)
        if not member or member['status'] != 'active' or account not in member['allowedAccountIds']:
            return dict(allowed=False, reason='WORKSPACE_UNAVAILABLE')
        for key in WINDOWS:
            policy = self.policy(account, key).get(workspace)
            window = next((w for w in summary['windows'] if w['window'] == key), None)
            if window and at < window['resetsAt'] and window['usedPercent'] >= 100:
                return dict(allowed=False, reason='QUOTA_ALLOCATION_EXHAUSTED')
            frozen = next((s['windows'].get(key, {}).get('cyclePolicy', {}).get(workspace) for s in self.state.values() if s['accountId'] == account and s['accountGeneration'] == generation), None)
            if not policy or (frozen or policy)['percent'] is None:
                continue
            if not window or at - window['observedAt'] > 300 or at >= window['resetsAt']:
                if not policy['allowOverage']:
                    return dict(allowed=False, reason='QUOTA_OBSERVATION_REQUIRED')
                continue
            available = max(0, window['balances'].get(workspace, 0))
            if policy['allowOverage']:
                available += next((max(0, s['windows'].get(key, {}).get('reserve', 0)) / SCALE for s in self.state.values() if s['accountId'] == account and s['accountGeneration'] == generation), 0)
                available += sum(max(0, amount) for w, amount in window['balances'].items() if w != workspace and self.policy(account, key).get(w, {}).get('active'))
            if available <= 0:
                return dict(allowed=False, reason='QUOTA_ALLOCATION_EXHAUSTED')
        return dict(allowed=True)
