/** Host-only native event inspection. Receipts never contain payload values. */
export type NativeEventRuntime = 'codex' | 'claude';
export type NativeEventDisposition = 'handled' | 'observed' | 'private' | 'unsupported' | 'unknown' | 'malformed';
export interface NativeEventCoverage {
  runtime: NativeEventRuntime;
  /** Stable discriminator path, such as notification/item/started or system/status. */
  key: string;
  disposition: NativeEventDisposition;
  route: string;
}
export interface NativeEventReceipt extends NativeEventCoverage {
  count: number;
  firstAt: string;
  lastAt: string;
  nativeChildId?: string;
  lastSequence?: number;
  lastBytes: number;
  lastDigest: string;
  adapterId?: string;
  adapterFailed?: boolean;
}
export interface NativeEventAudit {
  version: 1;
  frames: number;
  /** Includes nested discriminators, so observations can exceed frames. */
  observations: number;
  unknown: number;
  unsupported: number;
  malformed: number;
  omitted: number;
  receipts: NativeEventReceipt[];
}
export interface NativeEventPresentation { title: string; detail?: string }
export interface NativeEventPresenter {
  /** Local ID; the registry prefixes the approved plugin ID. */
  id: string;
  runtime: NativeEventRuntime;
  keys: string[];
  /** Synchronous host callback. Explicitly extract public fields; never stringify the frame. */
  present(input: { event: NativeEventCoverage; value: Readonly<Record<string, unknown>> }): NativeEventPresentation | undefined;
}
export interface PluginNativeEvents {
  diagnostic(receipt:Readonly<NativeEventReceipt>):string;
  catalog(runtime?: NativeEventRuntime): NativeEventCoverage[];
  inspect(runtime: NativeEventRuntime, value: Readonly<Record<string, unknown>>): NativeEventCoverage[];
  /** Last registered matching presenter wins. Release/disable restores the previous presenter. */
  register(presenter: NativeEventPresenter): () => void;
  /** Safe metadata only; no native frame or message body is published. */
  onReceipt(handler: (receipt: Readonly<NativeEventReceipt>) => void): () => void;
}
