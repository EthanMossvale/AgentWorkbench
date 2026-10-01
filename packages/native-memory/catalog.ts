import type { NativeMemoryEntry } from './manage';
import type { Provider } from './sources';

export type EvidenceState = 'unchanged' | 'changed' | 'unavailable' | 'unknown';
export interface MemoryProvenance {
  archiveId: string; origin: Provider; acknowledgedAt: string; currentState: EvidenceState;
}
export interface CatalogMemoryEntry extends NativeMemoryEntry { provenance: MemoryProvenance[] }
export interface MemoryArchiveEntry {
  id: string; origin: Provider; recipient: Provider; name: string; relative: string; scope: string;
  revision: number; operation: 'upsert' | 'withdraw'; createdAt: string; acknowledgedAt?: string;
  disposition?: string; status: 'pending' | 'receiving' | 'verification_failed' | 'received' | 'superseded';
  currentState?: EvidenceState; sourceMemoryId?: string; destinationMemoryIds: string[];
}
export interface MemoryArchiveDocument extends MemoryArchiveEntry { content: string; contentRevision: number }
export interface NativeMemoryCatalog {
  native: CatalogMemoryEntry[]; archives: MemoryArchiveEntry[]; nativeUnavailable: boolean;
}
