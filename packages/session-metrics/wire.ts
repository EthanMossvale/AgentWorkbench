import type { Protocol } from '../contracts';
import { parseTokenCounts, type TokenCounts } from './index';

/** Bounded, passive metadata tap. It never buffers a full conversation or alters the stream. */
export class UsageWireTap {
  private decoder = new TextDecoder();
  private buffer = ''; private usage: Record<string, unknown> = {}; private reportedModel?: string;
  private failed = false;
  completed = false;
  constructor(private protocol: Protocol, private sse: boolean) {}
  feed(chunk: Uint8Array) {
    if (this.failed) return;
    this.buffer += this.decoder.decode(chunk, { stream: true });
    if (this.sse) {
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end).trimEnd(); this.buffer = this.buffer.slice(end + 1);
        if (line.startsWith('data:')) this.read(line.slice(5).trim());
      }
    }
    if (this.buffer.length > 8_000_000) { this.failed = true; this.buffer = ''; }
  }
  private read(value: string) {
    if (!value) return;
    if (value === '[DONE]') { if (this.protocol === 'chat-completions') this.completed = true; return; }
    try {
      const event = JSON.parse(value), payload = event.type === 'message_start' ? event.message : event.type === 'response.completed' ? event.response : event;
      if (this.protocol === 'responses' && ['response.completed', 'response.failed', 'response.incomplete'].includes(event.type) || this.protocol === 'anthropic-messages' && event.type === 'message_stop') this.completed = true;
      if (event.type === 'error' && event.error) this.completed = true;
      if (payload?.usage && typeof payload.usage === 'object') this.usage = { ...this.usage, ...payload.usage };
      if (typeof payload?.model === 'string') this.reportedModel = payload.model;
    } catch { /* Telemetry must never change native delivery or trigger a retry. */ }
  }
  finish(): { counts: TokenCounts; model?: string } {
    this.buffer += this.decoder.decode();
    if (!this.failed) this.read(this.sse ? this.buffer.replace(/^data:\s*/, '').trim() : this.buffer);
    return { counts: parseTokenCounts(this.failed ? undefined : this.usage, this.protocol), model: this.reportedModel };
  }
}
