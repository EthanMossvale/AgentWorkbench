import type { LocalModelAccount } from './types';

export type AccountExportFormatId = 'official' | 'sub2api' | 'cpa' | `${string}:${string}`;
export interface AccountExportRequest { id: string; revision: string; formatId?: AccountExportFormatId }
export interface AccountExportFormat { id: AccountExportFormatId; label: string; description: string; generation: number }
/** Credentials are delivered only to explicitly approved full-trust format implementations. */
export interface AccountExportContext { account: LocalModelAccount; credentials: Record<string, unknown>; now: string; signal: AbortSignal }
export interface AccountExportDocument { fileName: string; value: Record<string, unknown> }
export interface AccountExportDefinition extends Omit<AccountExportFormat, 'generation'> {
  serialize(context: AccountExportContext): AccountExportDocument | Promise<AccountExportDocument>;
}
export interface AccountExportPreview { formatId: AccountExportFormatId; fileName: string; content: string; redacted: boolean }
export interface AccountExportResult { status: 'copied' | 'saved' | 'cancelled' }
export interface AccountExportService {
  formats(): AccountExportFormat[];
  registerFormat(definition: AccountExportDefinition): () => void;
  overrideFormat(id: AccountExportFormatId, definition: Omit<AccountExportDefinition, 'id'>): () => void;
  subscribe(listener: () => void): () => void;
  preview(request: AccountExportRequest & { reveal?: boolean }): Promise<AccountExportPreview>;
  copy(request: AccountExportRequest): Promise<AccountExportResult>;
  save(request: AccountExportRequest): Promise<AccountExportResult>;
}
