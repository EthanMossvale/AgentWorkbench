import type { Attachment } from '../attachments/types';

/** Native completion identity, never a model-selected destination or remote path. */
export interface GeneratedImageInput {
  sessionId: string; threadId: string; turnId: string; itemId: string;
  projectPath: string; result: string;
}
export interface GeneratedImageReceipt {
  threadId: string; turnId: string; itemId: string; sha256: string; size: number;
}
export interface GeneratedImageDelivery {
  status: 'receiving' | 'saved' | 'failed';
  attachment?: Attachment;
  remoteCopy?: 'pending' | 'removed' | 'retained' | 'not-applicable';
  error?: string;
}
export interface GeneratedImageService {
  receive(input: GeneratedImageInput): Promise<Attachment>;
}
// Existing attachment preview/export contract bounds each image to 20 MiB.
export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
// Native tools allow up to 32 MiB; transport must also carry an oversized result
// so the UI can report a delivery error without silently losing the native turn.
export const CODEX_IMAGE_FRAME_BYTES = 48 * 1024 * 1024;
