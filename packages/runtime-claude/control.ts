import { randomUUID } from 'node:crypto';
import type { PermissionMode } from '../contracts';
import { claudePermissionMode } from './index';
import type { NativeFrame, NativeProcessTransport } from '../../services/remote-supervisor';

/** Correlated native control replies; a write alone never confirms a mode change. */
export class ClaudeControlClient {
  private pending = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();
  private closed = false;
  constructor(private transport: NativeProcessTransport, private timeoutMs = 15000) {
    transport.on('frame', this.receive);
    transport.on('disconnect', this.disconnect);
    transport.on('fault', this.disconnect);
  }
  private receive = (frame: NativeFrame) => {
    const value = frame.value;
    if (value.type !== 'control_response') return;
    const response = value.response as {subtype?:string;request_id?:string;response?:Record<string,unknown>;error?:unknown} | undefined;
    const pending = response?.request_id ? this.pending.get(response.request_id) : undefined;
    if (!pending || !response) return;
    if (response.subtype === 'success') pending.resolve(response.response ?? {});
    else pending.reject(Error('CLAUDE_CONTROL_REJECTED: ' + String(response.error ?? 'Native control rejected.')));
  };
  private disconnect = () => this.dispose();
  async permissions(mode: PermissionMode) {
    if (this.closed) throw Error('CLAUDE_CONTROL_CLOSED');
    if (this.pending.size) throw Error('CLAUDE_CONTROL_BUSY');
    const nativeMode = claudePermissionMode(mode), id = randomUUID();
    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const finish = (error?: Error, value?: Record<string, unknown>) => {
        clearTimeout(timer); this.pending.delete(id);
        error ? reject(error) : resolve(value!);
      };
      const timer = setTimeout(() => finish(Error('CLAUDE_CONTROL_UNCONFIRMED')), this.timeoutMs);
      this.pending.set(id, { resolve: value => finish(undefined, value), reject: error => finish(error) });
      void this.transport.write({ type: 'control_request', request_id: id, request: { subtype: 'set_permission_mode', mode: nativeMode } }).catch(error => finish(error));
    });
    if (response.mode !== nativeMode) throw Error('CLAUDE_PERMISSION_MODE_UNCONFIRMED');
  }
  dispose() {
    this.closed = true;
    this.transport.off('frame', this.receive); this.transport.off('disconnect', this.disconnect); this.transport.off('fault', this.disconnect);
    for (const entry of this.pending.values()) entry.reject(Error('CLAUDE_CONTROL_CLOSED'));
  }
}

export function claudeReportedPermission(value: unknown): PermissionMode | undefined {
  switch (value) {
    case 'default': return 'default';
    case 'plan': return 'plan';
    case 'acceptEdits': return 'accept-edits';
    case 'bypassPermissions': return 'full-access';
    default: return undefined;
  }
}
