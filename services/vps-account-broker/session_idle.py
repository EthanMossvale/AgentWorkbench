"""Model-activity clocks shared by native history retention and runtime expiry.

Call only after the native ownership fence accepted an event. This module does
not stop processes or delete files; callers must freeze writers and verify the
local archive before retiring a remote working copy.
"""
import math
import time

IDLE_SECONDS = 24 * 60 * 60

CODEX_ITEMS = frozenset((
    'agentMessage', 'reasoning', 'commandExecution', 'fileChange', 'mcpToolCall',
    'dynamicToolCall', 'collabAgentToolCall', 'webSearch', 'imageView',
    'imageGeneration', 'contextCompaction', 'plan', 'hookPrompt', 'sleep',
    'enteredReviewMode', 'exitedReviewMode', 'subAgentActivity',
))
CODEX_DELTAS = frozenset((
    'item/agentMessage/delta', 'item/reasoning/textDelta',
    'item/reasoning/summaryTextDelta', 'item/plan/delta',
    'item/commandExecution/outputDelta', 'item/fileChange/outputDelta',
))
CODEX_PROGRESS = frozenset((
    'item/reasoning/summaryPartAdded', 'item/mcpToolCall/progress',
    'item/fileChange/patchUpdated', 'item/commandExecution/terminalInteraction',
    'item/tool/call', 'item/tool/requestUserInput',
    'item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
    'item/permissions/requestApproval', 'turn/plan/updated', 'turn/diff/updated',
    'thread/compacted',
))


def _timestamp(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _now(value):
    value = time.time() if value is None else value
    if not _timestamp(value):
        raise ValueError('SESSION_IDLE_CLOCK_INVALID')
    return value


def initialize_activity(receipt, now=None):
    """Set a missing clock once; legacy timestamps are migration evidence only.

    An absent or future legacy timestamp starts a new observation window rather
    than allowing immediate deletion or permanently protecting a stale session.
    Existing valid clocks are never refreshed by initialization/read/reconnect.
    """
    if not isinstance(receipt, dict):
        raise ValueError('SESSION_IDLE_RECEIPT_INVALID')
    now = _now(now)
    current = receipt.get('lastModelActivity')
    if _timestamp(current) and current <= now:
        return False
    legacy = receipt.get('lastActivity')
    receipt['lastModelActivity'] = legacy if _timestamp(legacy) and legacy <= now else now
    return True


def _codex_activity(message):
    method, params = message.get('method'), message.get('params')
    if not isinstance(method, str) or not isinstance(params, dict):
        return False
    if method in ('turn/started', 'turn/completed'):
        return isinstance(params.get('turn'), dict) and isinstance(params['turn'].get('id'), str) and bool(params['turn']['id'])
    if method in ('item/started', 'item/completed'):
        item = params.get('item')
        return isinstance(item, dict) and isinstance(item.get('type'), str) and item['type'] in CODEX_ITEMS and isinstance(item.get('id'), str) and bool(item['id'])
    if method in CODEX_DELTAS:
        return isinstance(params.get('delta'), str) and bool(params['delta'])
    return method in CODEX_PROGRESS


def _claude_activity(message):
    kind = message.get('type')
    if kind == 'stream_event':
        event = message.get('event')
        if not isinstance(event, dict):
            return False
        if event.get('type') == 'content_block_delta':
            delta = event.get('delta')
            return isinstance(delta, dict) and any(isinstance(delta.get(key), str) and delta[key]
                                                  for key in ('text', 'thinking', 'partial_json', 'signature'))
        return event.get('type') in ('message_start', 'message_stop', 'content_block_start', 'content_block_stop')
    if kind == 'assistant':
        data = message.get('message')
        return isinstance(data, dict) and isinstance(data.get('content'), list) and bool(data['content'])
    if kind == 'user':
        data = message.get('message')
        # Tool results are native progress; merely submitting a user prompt is not.
        return isinstance(data, dict) and isinstance(data.get('content'), list) and any(
            isinstance(part, dict) and part.get('type') == 'tool_result' for part in data['content'])
    if kind == 'result':
        return isinstance(message.get('subtype'), str) and bool(message['subtype'])
    if kind in ('tool_progress', 'tool_use_summary'):
        return bool(message.get('tool_use_id') or message.get('preceding_tool_use_ids'))
    if kind == 'system':
        return message.get('subtype') in ('compact_boundary', 'task_started', 'task_progress', 'task_notification')
    return False


def record_model_activity(receipt, message, now=None, provider='codex'):
    """Advance only for trusted model/tool work, never health/UI/RPC responses."""
    if not isinstance(receipt, dict):
        raise ValueError('SESSION_IDLE_RECEIPT_INVALID')
    if not isinstance(message, dict) or provider not in ('codex', 'claude'):
        return False
    if not (_codex_activity(message) if provider == 'codex' else _claude_activity(message)):
        return False
    now = _now(now)
    previous = receipt.get('lastModelActivity')
    if _timestamp(previous) and previous >= now:
        return False
    receipt['lastModelActivity'] = now
    return True


def idle_status(receipt, now=None, idle_seconds=IDLE_SECONDS):
    """Report elapsed model silence regardless of UI status or interruption.

    Eligible means due for the guarded retention workflow, not permission to
    unlink a file. Active/uncertain/approval flags cannot renew the idle clock.
    """
    if not isinstance(receipt, dict):
        raise ValueError('SESSION_IDLE_RECEIPT_INVALID')
    now = _now(now)
    if not _timestamp(idle_seconds) or idle_seconds < 1:
        raise ValueError('SESSION_IDLE_INTERVAL_INVALID')
    last = receipt.get('lastModelActivity')
    if not _timestamp(last):
        return dict(eligible=False, lastModelActivity=None, idleSeconds=None, reason='activity_unknown')
    if last > now:
        return dict(eligible=False, lastModelActivity=last, idleSeconds=0, reason='clock_ahead')
    elapsed = now-last
    eligible = elapsed >= idle_seconds
    return dict(eligible=eligible, lastModelActivity=last, idleSeconds=elapsed,
                reason='expired' if eligible else 'recent_model_activity')
