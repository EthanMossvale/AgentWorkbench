import {apiEndpoints} from './endpoints';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { ApiModel, ModelConnection } from './types';
import { apiHeaders, collectStream, parseTurn } from './provider';
import { nativeWireStream, nativeWireResponse } from './native-wire';
import { nativeRequestCodec, type NativeRequestCodec } from './native-request';
import { nativeCompletionCodec, nativeCompletionReceipt, type NativeCompletionCodec, type NativeCompletionBoundary, type NativeCompletionReceipt } from './native-completion';
import { UsageWireTap } from '../session-metrics/wire';
import { parseTokenCounts, type TokenCounts } from '../session-metrics';
import { nativeProviderDiagnostic, nativeForwardingDiagnostic, diagnosticMessage, type NativeProviderDiagnostic } from './native-diagnostics';

export interface NativeMcpSessionLimits {maxSessions:number;idleMs:number}
export interface NativeMcpSessionPolicy {limits():NativeMcpSessionLimits}
/** Shared production policy; approved plugins may replace this narrow service. */
export const nativeMcpSessionPolicy:NativeMcpSessionPolicy={limits:()=>({maxSessions:32,idleMs:5*60*1000})};

export interface NativeGatewayOptions {
  /** Official accounts may expose peer tools without proxying model traffic. */
  mcpOnly?: boolean; authorizeMcp?(): void;
  runtime: 'codex' | 'claude'; model: ApiModel; effort?: string;
  credentials(): Promise<{ connection: ModelConnection; key: string }>;
  fetcher?: typeof fetch; mcp?: () => { handle(request: unknown): Promise<unknown>; dispose(): void };
  mcpSessionPolicy?:NativeMcpSessionPolicy;
  failure?(error: unknown): void;
  diagnostic?(value: NativeProviderDiagnostic): void;
  /** Cross-protocol completion codec; approved plugins can replace this narrow boundary. */
  completion?: NativeCompletionCodec;
  /** Request codec override; the shared production default is runtime.native-request. */
  request?: NativeRequestCodec;
  completionReceipt?(value: NativeCompletionReceipt): void;
  usage?(value: { counts: TokenCounts; model: string; elapsedMs: number }): void | Promise<void>;
}
async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) { chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Session-scoped loopback gateway: no tools, prompts, credential files or agent loop. */
export async function openNativeGateway(options: NativeGatewayOptions) {
  const token = randomBytes(32).toString('hex'), path = '/' + randomBytes(24).toString('hex');
  const active = new Set<AbortController>();
  const mcpSessions = new Map<string,{session:ReturnType<NonNullable<NativeGatewayOptions['mcp']>>;lastUsed:number;active:number}>();
  const sessionLimits=()=>{const value=(options.mcpSessionPolicy??nativeMcpSessionPolicy).limits();if(!Number.isSafeInteger(value.maxSessions)||value.maxSessions<1||!Number.isSafeInteger(value.idleMs)||value.idleMs<1)throw Error('MCP_SESSION_POLICY_INVALID');return value;};
  if(options.mcp)sessionLimits();
  const pendingUsage = new Set<Promise<void>>();
  const reportFailure = (error: unknown) => { try { options.failure?.(error); } catch { /* A diagnostic hook cannot break transport cleanup. */ } };
  const disposeMcp=(id:string)=>{const entry=mcpSessions.get(id);mcpSessions.delete(id);try{entry?.session.dispose();}catch(error){reportFailure(error);}};
  const sweepMcp=()=>{const {idleMs}=sessionLimits();for(const [id,entry] of mcpSessions)if(!entry.active&&Date.now()-entry.lastUsed>=idleMs)disposeMcp(id);};
  const sessionTimer=options.mcp?setInterval(()=>{try{sweepMcp();}catch(error){reportFailure(error);}},1000):undefined;sessionTimer?.unref();
  const recordUsage = (value: Parameters<NonNullable<NativeGatewayOptions['usage']>>[0]) => {
    let task: Promise<void>;
    try { task = Promise.resolve(options.usage?.(value)); } catch (error) { reportFailure(error); return; }
    const pending = task.catch(reportFailure).finally(() => pendingUsage.delete(pending));
    pendingUsage.add(pending);
  };
  const flushUsage = async () => { while (pendingUsage.size) await Promise.all([...pendingUsage]); };
  const write = async (response: ServerResponse, data: string | Uint8Array, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (response.destroyed) throw Error('NATIVE_STREAM_CLOSED');
    if (!response.write(data)) await once(response, 'drain', { signal });
  };
  const server = createServer(async (request, response) => {
    const authenticated = request.headers.authorization === `Bearer ${token}` || request.headers['x-api-key'] === token;
    if (!authenticated || !request.url?.startsWith(path + '/') || request.headers.origin) { response.writeHead(403).end(); return; }
    const abort = new AbortController(); active.add(abort);
    let eventStream = false, upstreamSignal: AbortSignal | undefined, boundary: NativeCompletionBoundary | undefined;
    const reportDiagnostic = (value: NativeProviderDiagnostic) => { try { options.diagnostic?.(value); } catch (error) { reportFailure(error); } };
    response.on('close', () => { if (!response.writableEnded) abort.abort(); });
    response.on('error', error => abort.abort(error));
    try {
      const route = request.url.slice(path.length).split('?')[0];
      if (route === '/mcp' && options.mcp) {
        // An SSH-forwarded HTTP pool can reuse a socket while the peer's idle close
        // is still in flight. Complete each MCP exchange on its own connection;
        // the logical MCP session is retained by Mcp-Session-Id, never by TCP.
        response.setHeader('Connection','close');
        if (options.mcpOnly) options.authorizeMcp?.(); else await options.credentials();
        const sessionId = request.headers['mcp-session-id'];
        sweepMcp();
        if (request.method === 'DELETE' && typeof sessionId === 'string') { disposeMcp(sessionId); response.writeHead(204).end(); return; }
        if (request.method !== 'POST') { response.writeHead(405).end(); return; }
        const body = await readBody(request);
        let id=typeof sessionId==='string'?sessionId:undefined,entry=id?mcpSessions.get(id):undefined,created=false;
        if (body.method === 'initialize' && sessionId === undefined) {
          if(mcpSessions.size>=sessionLimits().maxSessions){response.writeHead(429,{'Content-Type':'application/json'}).end(JSON.stringify({error:'MCP_SESSION_LIMIT'}));return;}
          id=randomBytes(24).toString('hex');entry={session:options.mcp(),lastUsed:Date.now(),active:0};mcpSessions.set(id,entry);created=true;
        }
        if (!entry||!id) { response.writeHead(404).end(); return; }
        entry.active++;let result:unknown;
        // A dropped HTTP response is not proof of cancellation. Never replay the invocation.
        try{result=await entry.session.handle(body);if(created){if((result as any)?.error)disposeMcp(id);else response.setHeader('Mcp-Session-Id',id);}}
        catch(error){if(created)disposeMcp(id);throw error;}
        finally{entry.active--;entry.lastUsed=Date.now();}
        if (result === undefined) response.writeHead(202).end(); else { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); }
        return;
      }
      if (options.mcpOnly) { response.writeHead(404).end(); return; }
      const { connection, key } = await options.credentials();
      const native = options.runtime === 'codex' ? 'responses' : 'anthropic-messages';
      const endpoint = native === 'responses' ? '/v1/responses' : '/v1/messages';
      const auxiliary = native === 'responses' && route === '/v1/responses/compact' || native === 'anthropic-messages' && route === '/v1/messages/count_tokens';
      if (request.method !== 'POST' || route !== endpoint && !auxiliary) { response.writeHead(404).end(); return; }
      const body = await readBody(request);
      if (auxiliary && connection.protocol !== native) { response.writeHead(501).end(JSON.stringify({ error: { type: 'not_implemented_error', message: 'The upstream protocol does not expose this native operation.' } })); return; }
      let mapped = auxiliary ? { ...body, model: options.model.model } : (options.request ?? nativeRequestCodec).map(body, native, connection.protocol, options.model, options.effort);
      if (!auxiliary && native !== connection.protocol) {
        boundary = (options.completion ?? nativeCompletionCodec).prepare(mapped, connection.protocol);
        if (boundary) mapped = boundary.request;
      }
      const upstreamRoute = auxiliary ? route.slice('/v1/'.length) : connection.protocol === 'responses' ? 'responses' : connection.protocol === 'anthropic-messages' ? 'messages' : 'chat/completions';
      const headers = apiHeaders(connection, key);
      const usageStarted = performance.now();
      if (native === connection.protocol && typeof request.headers['anthropic-beta'] === 'string') headers['anthropic-beta'] = request.headers['anthropic-beta'];
      const signal = upstreamSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(connection.timeoutMs)]);
      const result = await (options.fetcher ?? fetch)(apiEndpoints.resolve({baseUrl:connection.baseUrl,resource:upstreamRoute,defaultVersion:false}), { method: 'POST', headers, body: JSON.stringify(mapped), signal, redirect: 'error' });
      if (!result.ok) { const diagnostic=await nativeProviderDiagnostic(result,[key,token]);reportDiagnostic(diagnostic);response.writeHead(result.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { type: 'upstream_error', message: diagnosticMessage(diagnostic) } })); return; }
      if (native === connection.protocol) {
        eventStream = !!result.headers.get('content-type')?.includes('text/event-stream');
        const meter = new UsageWireTap(connection.protocol, !!result.headers.get('content-type')?.includes('text/event-stream'));
        response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' });
        if (eventStream) response.flushHeaders();
        const reader = result.body?.getReader();
        if (reader) {
          const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
          signal.addEventListener('abort', cancel, { once: true });
          try {
            signal.throwIfAborted();
            for (;;) { const { value, done } = await reader.read(); signal.throwIfAborted(); if (done) break; meter.feed(value); await write(response, value, signal); if (meter.completed) break; }
          } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        if (eventStream && !meter.completed) throw Error('NATIVE_STREAM_INCOMPLETE');
        // Delivery never waits for state persistence or plugin telemetry hooks.
        response.end();
        if (!abort.signal.aborted && (!auxiliary || native === 'responses')) {
          const usage = meter.finish();
          recordUsage({ ...usage, model: options.model.model, elapsedMs: Math.max(1, performance.now() - usageStarted) });
        }
        return;
      }
      const streaming = !!result.headers.get('content-type')?.includes('text/event-stream'), downstreamStreaming=body.stream===true;
      const wire = nativeWireStream(native, body);
      const send = async (events: Record<string, any>[]) => {
        if (downstreamStreaming&&events.length) await write(response, events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), signal);
      };
      if (streaming&&downstreamStreaming) {
        eventStream = true;
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        await send(wire.start());
      }
      const raw = streaming ? await collectStream(result, connection.protocol, undefined, { signal, onDelta: async delta => { for (const part of boundary?.push(delta) ?? [delta]) await send(wire.push(part)); } }) : await result.json();
      const parsed = parseTurn(raw, connection.protocol), counts = parseTokenCounts(raw.usage, connection.protocol);
      let turn: typeof parsed | undefined;
      try { turn = boundary?.finish(parsed) ?? parsed; }
      finally { try { options.completionReceipt?.(nativeCompletionReceipt(parsed, connection.protocol, turn)); } catch (error) { reportFailure(error); } }
      const events = wire.finish(turn, counts);
      const elapsedMs = Math.max(1, performance.now() - usageStarted);
      if(downstreamStreaming){
        if (!response.headersSent) { eventStream = true; response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); }
        await send(events);response.end();
      }else{
        response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
        response.end(JSON.stringify(nativeWireResponse(turn,native,body,counts)));
      }
      recordUsage({ counts, model: options.model.model, elapsedMs });
    } catch (error) {
      if (abort.signal.aborted || response.destroyed) return;
      reportFailure(error);
      const diagnostic = nativeForwardingDiagnostic(error, upstreamSignal); reportDiagnostic(diagnostic);
      if (!response.headersSent) response.writeHead(diagnostic.status, { 'Content-Type': 'application/json' });
      const failure = { type: 'error', error: { type: 'native_provider_error', message: diagnosticMessage(diagnostic) + ' The gateway did not replay this request.' } };
      response.end(eventStream ? `event: error\ndata: ${JSON.stringify(failure)}\n\n` : JSON.stringify(failure));
    } finally { try { boundary?.dispose?.(); } catch (error) { reportFailure(error); } active.delete(abort); }
  });
  server.requestTimeout = 0;
  try{await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });}
  catch(error){clearInterval(sessionTimer);throw error;}
  const address = server.address(); if (!address || typeof address === 'string') throw Error('NATIVE_GATEWAY_BIND_FAILED');
  const baseUrl = `http://127.0.0.1:${address.port}${path}`;
  return { baseUrl, token, flushUsage, async close() { clearInterval(sessionTimer);for (const abort of active) abort.abort(); for (const id of mcpSessions.keys()) disposeMcp(id); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await flushUsage(); } };
}
