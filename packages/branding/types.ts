export interface BrandingDefinition {
  /** Local registration name; the host prefixes plugin:<owner>/. */
  id: string;
  label: string;
  /** Square, 8-bit RGBA PNG data URL, 16..512 px, at most 1 MiB encoded. */
  app: string;
  /** Optional pixel-size representations. Missing sizes use the app image. */
  tray?: Record<string,string>;
}
export interface BrandingSnapshot extends BrandingDefinition { revision: number }
export interface BrandingHandle { id: string; dispose(): void }
export interface BrandingApi {
  get(): BrandingSnapshot;
  list(): BrandingDefinition[];
  /** Last active registration supplies the production app, tray and UI marks. */
  register(definition: BrandingDefinition): BrandingHandle;
  subscribe(listener: (snapshot: BrandingSnapshot) => void): () => void;
}
