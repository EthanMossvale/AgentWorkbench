/** Stable, content-free receipt diagnostics for background tools and task metadata. */
export const receiptMessages = {
  MEMORY_RECEIPT_MISSING: 'No receipt file exists. Write the issued JSON receipt after saving and rereading native files.',
  MEMORY_RECEIPT_INVALID: 'Receipt does not match the bound delivery and runtime.',
  MEMORY_RECEIPT_ENTRY_MISSING: 'This archive is missing from the receipt. Include it only after native storage is verified.',
  MEMORY_RECEIPT_ENTRY_INVALID: 'Receipt has an unknown or mismatched revision or scope.',
  MEMORY_RECEIPT_STORAGE_INVALID: 'Receipt lacks bounded native storage evidence or a valid disposition.',
  MEMORY_RECEIPT_FILE_INVALID: 'Receipt destination is not a loaded native memory file.',
  MEMORY_RECEIPT_HASH_MISMATCH: 'Receipt does not match native content saved on disk.',
  MEMORY_RECEIPT_ALREADY_PRESENT_MISMATCH: 'Existing evidence does not contain the archived knowledge; semantic deduplication needs a native reference.',
  MEMORY_RECEIPT_CONTENT_PROVENANCE: 'Native memory lacks imported content and provenance.',
  MEMORY_RECEIPT_INDEX_INVALID: 'Receipt index is not a native memory index.',
  MEMORY_RECEIPT_INDEX_UNREACHABLE: 'Memory is not reachable from its native index within startup limits.',
  MEMORY_RECEIPT_INDEX_PROVENANCE: 'Native index reference lacks handoff provenance.',
  MEMORY_RECEIPT_NATIVE_CHANGED: 'Native memory changed during receipt verification.',
  MEMORY_RECEIPT_SOURCE_CHANGED: 'The issued source revision is no longer current. Leave it pending for the next explicit task.',
  MEMORY_RECEIPT_VERIFICATION_FAILED: 'Native receipt evidence could not be verified. Preserve native files and leave the archive pending.',
} as const;

export type MemoryReceiptCode = keyof typeof receiptMessages;
export interface MemoryReceiptEntryResult {
  archiveId: string;
  state: 'verified' | 'pending' | 'superseded';
  code?: MemoryReceiptCode;
  message?: string;
}
export interface MemoryReceiptVerification {
  deliveryId: string;
  complete: boolean;
  verified: number;
  total: number;
  entries: MemoryReceiptEntryResult[];
}
export function receiptCode(error: unknown): MemoryReceiptCode {
  const message = error instanceof Error ? error.message : String(error);
  const code = (Object.keys(receiptMessages) as MemoryReceiptCode[]).find(code => receiptMessages[code] === message);
  if (code) return code;
  if (/markers|provenance/.test(message)) return 'MEMORY_RECEIPT_CONTENT_PROVENANCE';
  if (/SHA-256|native files/.test(message)) return 'MEMORY_RECEIPT_FILE_INVALID';
  return 'MEMORY_RECEIPT_VERIFICATION_FAILED';
}
