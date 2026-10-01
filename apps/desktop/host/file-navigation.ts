import path from 'node:path';
import { opendir, stat } from 'node:fs/promises';
import type { Project, Session } from '../../../packages/contracts';
import { fileReference } from '../../../packages/navigation/file-links';
import type { FileNavigationApi, FileResolutionRequest, FileResolutionSource, FileResolutionErrorCode, FileResolutionResult } from '../../../packages/navigation/file-resolution';
import { resolveBrowsePath } from './file-browser';

const key = (value: string) => process.platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value;
const missing = (error: unknown) => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');
const ignored = new Set(['.git', '.hg', '.svn', 'node_modules', '__pycache__', '.cache']);
export class FileResolutionError extends Error {
  constructor(readonly code: FileResolutionErrorCode, message: string, readonly candidates: string[] = []) { super(`${code}: ${message}`); }
}
/** Inspect only already-loaded structured public paths; never parse commands or read chat databases. */
export function fileResolutionContext(session?: Session, project?: Project): Omit<FileResolutionRequest, 'requested'> {
  const cwd = session?.projectPath ?? '', roots = [cwd, ...(project?.paths ?? (project?.path ? [project.path] : []))], knownPaths: string[] = [];
  const add = (value: unknown, base = cwd) => {
    if (typeof value !== 'string') return;
    const ref = fileReference(value); if (!ref) return;
    if (path.isAbsolute(ref.path)) knownPaths.push(ref.path);
    else if (path.isAbsolute(base)) knownPaths.push(path.resolve(base, ref.path));
  };
  for (const record of session?.fileChangeRecords ?? []) for (const change of record.changes) if (change.kind !== 'delete') add(change.path);
  for (const activity of session?.activities ?? []) {
    if (activity.cwd && path.isAbsolute(activity.cwd)) roots.push(activity.cwd);
    for (const change of activity.fileChanges ?? []) if (activity.status === 'completed' && change.kind !== 'delete') add(change.path, activity.cwd ?? cwd);
    if (activity.input && !activity.inputTruncated) {
      try {
        const input = JSON.parse(activity.input);
        for (const field of ['file_path', 'notebook_path', 'path']) add(input?.[field], activity.cwd ?? cwd);
        for (const field of ['cwd', 'workdir']) if (typeof input?.[field] === 'string' && path.isAbsolute(input[field])) roots.push(input[field]);
      } catch { /* Shell text is not a path declaration. */ }
    }
  }
  return { cwd, roots: [...new Set(roots.filter(Boolean))], knownPaths: [...new Set(knownPaths)] };
}

/** Shared by preview, info, reveal, open, copy and save. No persisted path guesses. */
export class FileNavigationService implements FileNavigationApi {
  private sources = new Map<string, { source: FileResolutionSource; abort: AbortController }>();
  constructor(private readonly limits = { entries: 20_000, directories: 2_000, milliseconds: 2_000 }) {}
  registerSource(source: FileResolutionSource): () => void {
    if (!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(source.id) || typeof source.candidates !== 'function') throw Error('FILE_SOURCE_INVALID');
    if (this.sources.has(source.id)) throw Error('FILE_SOURCE_DUPLICATE');
    const entry = { source, abort: new AbortController() }; this.sources.set(source.id, entry);
    return () => { if (this.sources.get(source.id) === entry) { this.sources.delete(source.id); entry.abort.abort(); } };
  }
  async locate(request: FileResolutionRequest): Promise<FileResolutionResult> {
    try { return { status: 'resolved', path: await this.resolve(request), ...(fileReference(request.requested ?? '')?.line ? { line: fileReference(request.requested!)!.line } : {}) }; }
    catch (error) {
      if (error instanceof FileResolutionError && ['FILE_PATH_AMBIGUOUS', 'FILE_SEARCH_INCOMPLETE'].includes(error.code)) return { status: error.code === 'FILE_PATH_AMBIGUOUS' ? 'ambiguous' : 'incomplete', requested: request.requested ?? '', candidates: error.candidates, message: error.message.replace(/^[A-Z_]+: /,'') };
      throw error;
    }
  }
  async resolve(request: FileResolutionRequest): Promise<string> {
    const ref = fileReference(request.requested ?? request.cwd);
    if (!ref) throw Error('无法识别此文件路径。');
    const value = ref.path;
    try { return await resolveBrowsePath(request.cwd, request.requested); }
    catch (error) { if (!missing(error)) throw error; }
    const notFound = () => new FileResolutionError('FILE_NOT_FOUND', `找不到文件或目录：${value}。工作目录：${request.cwd || '未选择'}。请提供完整路径。`);
    // An explicit absolute or dot-relative path must never silently redirect to another file.
    if (path.isAbsolute(value) || /^(?:[a-z]:|\.{1,2}[\\/]|~[\\/])/i.test(value)) throw notFound();
    const suffix = key(path.normalize(value));
    const matches = (candidate: string) => key(path.normalize(candidate)).endsWith('/' + suffix.replaceAll('\\', '/'));
    const canonicalCandidates = async (candidates: readonly string[], restrictSuffix = true): Promise<string[]> => {
      const found = new Map<string, string>();
      for (const candidate of candidates) {
        if (!path.isAbsolute(candidate) || (restrictSuffix && !matches(candidate))) continue;
        try { const resolved = await resolveBrowsePath('', candidate); found.set(key(resolved), resolved); }
        catch (error) { if (!missing(error)) throw error; }
      }
      return [...found.values()];
    };
    const unique = async (candidates: readonly string[], restrictSuffix = true) => {
      const found = await canonicalCandidates(candidates, restrictSuffix);
      if (found.length > 1) throw new FileResolutionError('FILE_PATH_AMBIGUOUS', `找到多个匹配项，请选择文件或使用完整路径。`, found);
      return found[0];
    };
    const known = await unique(request.knownPaths ?? []); if (known) return known;
    const roots = [...new Set([request.cwd, ...(request.roots ?? [])].filter(root => path.isAbsolute(root)))];
    const atRoot = await unique(roots.map(root => path.resolve(root, value))); if (atRoot) return atRoot;
    const contributed: string[] = [];
    for (const entry of [...this.sources.values()]) {
      const { source, abort } = entry;
      if (abort.signal.aborted || this.sources.get(source.id) !== entry) continue;
      const invocation = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort = () => {};
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => source.candidates(structuredClone(request), invocation.signal)),
          new Promise<readonly string[]>((resolve, reject) => {
            onAbort = () => { invocation.abort(); resolve([]); }; abort.signal.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => { invocation.abort(); reject(Error('timeout')); }, 2_000);
          }),
        ]);
        if (abort.signal.aborted || this.sources.get(source.id) !== entry) continue;
        if (!Array.isArray(result) || result.length > 256 || result.some(item => typeof item !== 'string')) throw Error('invalid candidates');
        contributed.push(...result);
      } catch {
        if (!abort.signal.aborted) throw new FileResolutionError('FILE_SOURCE_FAILED', `文件路径扩展 ${source.id} 未能完成定位，请使用完整路径或停用该扩展。`);
      } finally { clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort); invocation.abort(); }
    }
    const extra = await unique(contributed, false); if (extra) return extra;
    const queue: string[] = [], visited = new Set<string>(), found: string[] = [];
    let entries = 0, directories = 0, incomplete = false;
    const deadline = Date.now() + this.limits.milliseconds;
    for (const root of roots) {
      try {
        const canonical = await resolveBrowsePath('', root);
        // Never discover across an entire drive or filesystem from a short link.
        if (canonical === path.parse(canonical).root) { incomplete = true; continue; }
        if ((await stat(canonical)).isDirectory()) queue.push(canonical);
      } catch (error) { if (!missing(error)) incomplete = true; }
    }
    while (queue.length) {
      if (++directories > this.limits.directories || Date.now() >= deadline) { incomplete = true; break; }
      const directory = queue.shift()!; if (visited.has(key(directory))) continue; visited.add(key(directory));
      try {
        const handle = await opendir(directory);
        for await (const entry of handle) {
          if (++entries > this.limits.entries || Date.now() >= deadline) { incomplete = true; break; }
          const candidate = path.join(directory, entry.name);
          if (matches(candidate) && (entry.isFile() || entry.isDirectory())) found.push(candidate);
          // Do not follow symlinks/junctions, including links to network shares.
          if (entry.isDirectory() && !entry.isSymbolicLink() && !ignored.has(entry.name)) queue.push(candidate);
        }
      } catch { incomplete = true; }
      if (entries > this.limits.entries) break;
    }
    if (incomplete) throw new FileResolutionError('FILE_SEARCH_INCOMPLETE', `查找范围未完整检查，请从已找到的文件中选择，或输入更具体的路径。`, await canonicalCandidates(found));
    const discovered = await unique(found); if (discovered) return discovered;
    throw notFound();
  }
}
