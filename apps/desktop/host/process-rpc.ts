/**
 * Minimal request/response/event protocol between the Electron main (UI) process
 * and the workbench core process. Messages are structured-clone data only.
 */
export type RpcMessage =
  | { t: 'req'; id: number; m: string; a: unknown[] }
  | { t: 'res'; id: number; ok: true; v: unknown }
  | { t: 'res'; id: number; ok: false; e: string; code?: string }
  | { t: 'evt'; n: string; p: unknown };
export type RpcHandler = (...args: never[]) => unknown;
/** Window port id and the number of messages the core had posted on it when a call finished. */
export interface CallFence { port: number; seq: number }

export interface RpcPeer {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  emit(event: string, payload?: unknown): void;
  handle(method: string, handler: RpcHandler): void;
  on(event: string, listener: (payload: unknown) => void): () => void;
  receive(message: unknown): void;
  /** Rejects every pending call, e.g. when the other process exits. */
  close(reason: string): void;
}

const isMessage = (value: unknown): value is RpcMessage => !!value && typeof value === 'object' && ['req', 'res', 'evt'].includes((value as { t?: string }).t ?? '');

export function createRpcPeer(send: (message: RpcMessage) => void): RpcPeer {
  let next = 0, closed: string | undefined;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const handlers = new Map<string, RpcHandler>(), listeners = new Map<string, Set<(payload: unknown) => void>>();
  const respond = async (id: number, method: string, args: unknown[]) => {
    try {
      const handler = handlers.get(method);
      if (!handler) throw Error('RPC_METHOD_UNAVAILABLE: ' + method);
      const value = await (handler as (...values: unknown[]) => unknown)(...args);
      send({ t: 'res', id, ok: true, v: value });
    } catch (error) {
      const failure = error as Error & { code?: string };
      // A result that cannot be cloned is reported instead of leaving the caller waiting.
      try { send({ t: 'res', id, ok: false, e: failure?.message ?? String(error), ...(typeof failure?.code === 'string' ? { code: failure.code } : {}) }); }
      catch { send({ t: 'res', id, ok: false, e: 'RPC_RESULT_UNSERIALIZABLE' }); }
    }
  };
  return {
    call(method, ...args) {
      if (closed) return Promise.reject(Error(closed));
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        try { send({ t: 'req', id, m: method, a: args }); } catch (error) { pending.delete(id); reject(error as Error); }
      });
    },
    emit(event, payload) { if (!closed) send({ t: 'evt', n: event, p: payload }); },
    handle(method, handler) { handlers.set(method, handler); },
    on(event, listener) {
      let set = listeners.get(event); if (!set) listeners.set(event, set = new Set());
      set.add(listener); return () => { set!.delete(listener); };
    },
    receive(message) {
      if (!isMessage(message)) return;
      if (message.t === 'req') { void respond(message.id, message.m, Array.isArray(message.a) ? message.a : []); return; }
      if (message.t === 'evt') { for (const listener of [...(listeners.get(message.n) ?? [])]) { try { listener(message.p); } catch { /* A listener failure must not stop delivery. */ } } return; }
      const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id);
      if (message.ok) entry.resolve(message.v);
      else { const error = Error(message.e) as Error & { code?: string }; if (message.code) error.code = message.code; entry.reject(error); }
    },
    close(reason) { closed = reason; for (const entry of pending.values()) entry.reject(Error(reason)); pending.clear(); },
  };
}
