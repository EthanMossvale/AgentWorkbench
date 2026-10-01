export type PluginJson = null | boolean | number | string | PluginJson[] | { [key: string]: PluginJson };
export interface PluginDataSnapshot { revision: string | null; values: Record<string, PluginJson> }
/** Non-secret local data, separate from the approved executable package. */
export interface PluginStorage {
  read(): Promise<PluginDataSnapshot>;
  write(expectedRevision: string | null, values: Record<string, PluginJson>): Promise<PluginDataSnapshot>;
}
