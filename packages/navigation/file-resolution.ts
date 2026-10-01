/** Local, user-invoked navigation. Candidates never authorize execution or network access. */
export interface FileResolutionRequest {
  cwd: string;
  requested?: string;
  roots?: readonly string[];
  knownPaths?: readonly string[];
}
export interface FileResolutionSource {
  id: `plugin:${string}`;
  candidates(request: Readonly<FileResolutionRequest>, signal: AbortSignal): readonly string[] | Promise<readonly string[]>;
}
export interface FileNavigationApi {
  resolve(request: FileResolutionRequest): Promise<string>;
  locate(request: FileResolutionRequest): Promise<FileResolutionResult>;
  registerSource(source: FileResolutionSource): () => void;
}
export type FileResolutionResult = { status: 'resolved'; path: string; line?: number } | {
  status: 'ambiguous' | 'incomplete'; requested: string; candidates: string[]; message: string;
};
export type FileResolutionErrorCode = 'FILE_NOT_FOUND' | 'FILE_PATH_AMBIGUOUS' | 'FILE_SEARCH_INCOMPLETE' | 'FILE_SOURCE_FAILED';
