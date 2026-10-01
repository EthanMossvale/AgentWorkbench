import type { Protocol } from '../contracts';
import type { ApiModel } from './types';
import { nativeWireRequest } from './native-wire';

/** Request conversion only; owns no network, persistence, retries or native tool execution. */
export interface NativeRequestCodec {
  map(body: Record<string, any>, from: 'responses' | 'anthropic-messages', to: Protocol, model: ApiModel, effort?: string): Record<string, any>;
}

/** Shared production instance exposed as runtime.native-request to approved host plugins. */
export const nativeRequestCodec: NativeRequestCodec = { map: nativeWireRequest };
