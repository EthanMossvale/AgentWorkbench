import type {NativeEventReceipt} from './types';
/** Copyable compatibility evidence, deliberately excluding frame and message bodies. */
export function nativeEventDiagnostic(r:Readonly<NativeEventReceipt>):string{
  return JSON.stringify({runtime:r.runtime,event:r.key,disposition:r.disposition,route:r.route,count:r.count,firstAt:r.firstAt,lastAt:r.lastAt,lastSequence:r.lastSequence,lastBytes:r.lastBytes,lastDigest:r.lastDigest},null,2);
}
