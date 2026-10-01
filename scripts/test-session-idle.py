"""Pure synthetic clocks and native events; no real profiles or runtime calls."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('session_idle', Path(__file__).resolve().parents[1] / 'services/vps-account-broker/session_idle.py')
idle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(idle)


class IdleClocks(unittest.TestCase):
    def test_exact_boundary_and_interrupted_or_stale_running(self):
        for state in ({}, {'interrupted': True}, {'uncertain': True}, {'active': True},
                      {'approvals': ['pending']}, {'activeChildren': ['child']}, {'rootPending': True}):
            receipt = dict(state, lastModelActivity=100)
            self.assertFalse(idle.idle_status(receipt, 86499)['eligible'])
            self.assertTrue(idle.idle_status(receipt, 86500)['eligible'])

    def test_initialize_once_never_sliding_on_reconnect(self):
        receipt = {}
        self.assertTrue(idle.initialize_activity(receipt, 100))
        self.assertFalse(idle.initialize_activity(receipt, 10000))
        self.assertEqual(receipt['lastModelActivity'], 100)
        self.assertTrue(idle.idle_status(receipt, 86500)['eligible'])

    def test_legacy_once_and_invalid_or_future_baseline(self):
        receipt = {'lastActivity': 50}
        idle.initialize_activity(receipt, 100)
        receipt['lastActivity'] = 100000
        idle.initialize_activity(receipt, 100001)
        self.assertEqual(receipt['lastModelActivity'], 50)
        for invalid in (True, '50', -1, float('inf'), float('nan'), 200):
            receipt = {'lastActivity': invalid}
            idle.initialize_activity(receipt, 100)
            self.assertEqual(receipt['lastModelActivity'], 100)

    def test_unknown_and_clock_rollback_do_not_delete_immediately(self):
        self.assertEqual(idle.idle_status({}, 100)['reason'], 'activity_unknown')
        receipt = {'lastModelActivity': 200}
        self.assertEqual(idle.idle_status(receipt, 100)['reason'], 'clock_ahead')
        idle.initialize_activity(receipt, 100)
        self.assertEqual(receipt['lastModelActivity'], 100)

    def test_health_ui_account_usage_and_empty_frames_do_not_renew(self):
        receipt = {'lastModelActivity': 100}
        for message in ({'id': 'health', 'result': {'config': {}}}, {'id': 'health', 'error': {}},
                        {'method': 'config/read', 'params': {}}, {'method': 'thread/read', 'params': {}},
                        {'method': 'thread/status/changed', 'params': {'status': 'active'}},
                        {'method': 'thread/tokenUsage/updated', 'params': {'tokens': 42}},
                        {'method': 'account/rateLimits/updated', 'params': {}},
                        {'method': 'thread/name/updated', 'params': {}},
                        {'method': 'item/agentMessage/delta', 'params': {'delta': ''}},
                        {'method': 'turn/heartbeat', 'params': {}}, {'method': 'error', 'params': {}}, {}, None):
            self.assertFalse(idle.record_model_activity(receipt, message, 80000))
        self.assertTrue(idle.idle_status(receipt, 86500)['eligible'])

    def test_codex_model_tool_and_child_work_advance(self):
        events = [
            {'method': 'turn/started', 'params': {'turn': {'id': 'turn'}}},
            {'method': 'turn/completed', 'params': {'turn': {'id': 'turn', 'status': 'interrupted'}}},
            {'method': 'item/agentMessage/delta', 'params': {'threadId': 'child', 'delta': 'x'}},
            {'method': 'item/reasoning/textDelta', 'params': {'delta': 'thinking'}},
            {'method': 'item/commandExecution/outputDelta', 'params': {'delta': 'progress'}},
            {'method': 'item/tool/requestUserInput', 'params': {'questions': []}},
            {'method': 'item/completed', 'params': {'item': {'type': 'imageGeneration', 'id': 'image'}}},
            {'method': 'item/mcpToolCall/progress', 'params': {'message': 'progress'}},
        ]
        for message in events:
            receipt = {'lastModelActivity': 100}
            self.assertTrue(idle.record_model_activity(receipt, message, 80000))
            self.assertFalse(idle.idle_status(receipt, 86500)['eligible'])

    def test_unknown_providers_and_malformed_events_do_not_renew(self):
        receipt = {'lastModelActivity': 100}
        for message in ({'method': 'item/completed', 'params': []},
                        {'method': 'turn/completed', 'params': {}},
                        {'method': 'item/started', 'params': {'item': {'id': 'x', 'type': 'unknown'}}}):
            self.assertFalse(idle.record_model_activity(receipt, message, 200))
        self.assertFalse(idle.record_model_activity(receipt, {'type': 'result', 'subtype': 'success'}, 200, 'other'))
        self.assertEqual(receipt['lastModelActivity'], 100)

    def test_claude_tokens_thinking_tool_results_and_children(self):
        events = [
            {'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'x'}]}},
            {'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'thinking': 'x'}}},
            {'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'partial_json': '{'}}},
            {'type': 'stream_event', 'event': {'type': 'message_start'}},
            {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'call'}]}},
            {'type': 'tool_progress', 'tool_use_id': 'call'},
            {'type': 'system', 'subtype': 'task_progress'},
            {'type': 'result', 'subtype': 'error_during_execution'},
        ]
        for message in events:
            receipt = {'lastModelActivity': 100}
            self.assertTrue(idle.record_model_activity(receipt, message, 80000, 'claude'))
            self.assertFalse(idle.idle_status(receipt, 86500)['eligible'])

    def test_claude_init_status_rate_limits_and_ping_do_not_renew(self):
        receipt = {'lastModelActivity': 100}
        for message in ({'type': 'system', 'subtype': 'init'}, {'type': 'system', 'subtype': 'status'},
                        {'type': 'rate_limit_event'}, {'type': 'keep_alive'},
                        {'type': 'stream_event', 'event': {'type': 'ping'}},
                        {'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'text': ''}}},
                        {'type': 'user', 'message': {'content': [{'type': 'text', 'text': 'new prompt'}]}}):
            self.assertFalse(idle.record_model_activity(receipt, message, 80000, 'claude'))
        self.assertTrue(idle.idle_status(receipt, 86500)['eligible'])

    def test_clock_does_not_rewind_and_arguments_are_bounded(self):
        receipt = {'lastModelActivity': 100}
        event = {'method': 'item/agentMessage/delta', 'params': {'delta': 'x'}}
        self.assertFalse(idle.record_model_activity(receipt, event, 99))
        for value in (True, -1, '100', float('inf'), float('nan')):
            with self.assertRaisesRegex(ValueError, 'SESSION_IDLE_CLOCK_INVALID'):
                idle.idle_status(receipt, value)
        for value in (0, True, -1, '100', float('inf')):
            with self.assertRaisesRegex(ValueError, 'SESSION_IDLE_INTERVAL_INVALID'):
                idle.idle_status(receipt, 100, value)


if __name__ == '__main__':
    unittest.main(verbosity=2)
