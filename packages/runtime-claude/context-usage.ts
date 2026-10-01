import { parseTokenCounts, tokenCount } from '../session-metrics';

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

/** Public stream receipts are per message; result.usage is a cumulative turn total. */
export class ClaudeContextUsageTracker {
  private messageId?: string;
  private usage?: Record<string, unknown>;
  private receivedDelta = false;

  observe(value: Record<string, any>): number | undefined {
    if (value.parent_tool_use_id) return;
    if (value.type === 'conversation_reset' || value.type === 'system' && value.subtype === 'compact_boundary') {
      this.messageId = undefined; this.usage = undefined; this.receivedDelta = false;
      return value.type === 'system' ? tokenCount(value.compact_metadata?.post_tokens) ?? undefined : undefined;
    }
    if (value.type === 'stream_event') {
      const event = record(value.event);
      if (event.type === 'message_start') {
        const message = record(event.message);
        this.messageId = typeof message.id === 'string' ? message.id : undefined;
        this.usage = { ...record(message.usage) }; this.receivedDelta = false;
        // A start snapshot is incomplete and must not replace the previous context.
        return;
      }
      if (event.type !== 'message_delta' || !this.usage) return;
      this.usage = { ...this.usage, ...record(event.usage) }; this.receivedDelta = true;
      return parseTokenCounts(this.usage, 'anthropic-messages').totalTokens ?? undefined;
    }
    if (value.type === 'assistant') {
      const message = record(value.message), used = parseTokenCounts(message.usage, 'anthropic-messages').totalTokens;
      // Claude can emit a block-complete assistant before the final usage delta.
      if (this.usage && (used === 0 || this.receivedDelta && message.id === this.messageId)) return;
      return used ?? undefined;
    }
  }
}

/** Match the root model receipt, never sum capacities or borrow a child model. */
export function claudeContextCapacity(value: Record<string, any>, model?: string): number | undefined {
  if (value.parent_tool_use_id || value.type !== 'result') return;
  const rows = record(value.modelUsage), keys = Object.keys(rows);
  const row = record(model && Object.hasOwn(rows, model) ? rows[model] : keys.length === 1 ? rows[keys[0]!] : undefined);
  const capacity = row.contextWindow;
  return Number.isSafeInteger(capacity) && capacity > 0 && capacity <= 100000000 ? capacity : undefined;
}
