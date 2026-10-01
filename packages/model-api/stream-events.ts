/** Public, incremental wire data. Private reasoning/signatures never enter this contract. */
export type ModelStreamDelta =
  | { type: 'text'; delta: string }
  | { type: 'tool'; index: number; id: string; name: string; argumentsDelta: string };

export interface StreamReadOptions {
  signal?: AbortSignal;
  onDelta?(delta: ModelStreamDelta): void | Promise<void>;
}
