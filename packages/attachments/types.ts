/** Immutable metadata; bytes and thumbnails are loaded only for explicit use. */
export interface Attachment {
  id: string; name: string; size: number; mime: string; sha256: string;
  path: string;
  storage?:'source'|'clipboard'|'managed';createdAt?:string;
  /** Host-registered generated image source; constrained to generated_images/image-<identity>.png. */
  generatedRoot?:string;
}
export interface AttachmentView extends Attachment { preview?: string }
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export interface AttachmentInput { name?: string; filePath?: string; bytes?: Uint8Array }
export interface AttachmentPayload { attachment: Attachment; data: Uint8Array }
