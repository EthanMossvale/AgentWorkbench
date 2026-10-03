export interface FileBrowseCursor { offset: number; version: string; line?: number }
export interface FileBrowseOptions { cursor?: FileBrowseCursor; pageSize?: number }
export interface FileView {
  path: string; parent: string; kind: 'directory' | 'text' | 'unsupported';
  entries?: { name: string; path: string; directory: boolean }[];
  content?: string; truncated?: boolean; line?: number; size?: number;
  startLine?: number; next?: FileBrowseCursor;
}
export interface FileBrowseReader {
  id: `plugin:${string}`;
  browse(cwd: string, requested: string | undefined, options: Readonly<FileBrowseOptions>): Promise<FileView | undefined>;
}
export interface FileBrowserApi {
  browse(cwd: string, requested?: string, options?: FileBrowseOptions): Promise<FileView>;
  registerReader(reader: FileBrowseReader): () => void;
}
