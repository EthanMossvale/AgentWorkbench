import { createHash } from 'node:crypto';
import { mkdir, open, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_GENERATED_IMAGE_BYTES, type GeneratedImageInput, type GeneratedImageService } from '../../../packages/generated-images/types';
import type { Attachment } from '../../../packages/attachments/types';
import { AttachmentStore } from './attachments';

const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** A bounded local artifact sink. It never reads or fetches native savedPath. */
export class WorkspaceGeneratedImages implements GeneratedImageService {
  private pending = new Map<string, Promise<Attachment>>();
  // Legacy directory-policy arguments are accepted for source compatibility only.
  constructor(private attachments: AttachmentStore, _controlPaths: string[] = [], _allowManagedWorkspace?: (sessionId:string,root:string)=>Promise<boolean>) {}
  receive(input: GeneratedImageInput): Promise<Attachment> {
    const key = JSON.stringify([input.sessionId, input.threadId, input.turnId, input.itemId]);
    const previous = this.pending.get(key);
    // Do not coalesce different payloads under the same native identity.
    if (previous) return previous.then(() => this.save(input));
    const operation = this.save(input).finally(() => { if (this.pending.get(key) === operation) this.pending.delete(key); });
    this.pending.set(key, operation); return operation;
  }
  private async save(input: GeneratedImageInput): Promise<Attachment> {
    if ([input.sessionId, input.threadId, input.turnId, input.itemId].some(v => typeof v !== 'string' || !v || v.length > 512 || /[\x00-\x1f]/.test(v))) throw Error('GENERATED_IMAGE_IDENTITY_INVALID');
    const encoded = input.result;
    if (typeof encoded !== 'string' || !encoded || encoded.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4) throw Error('GENERATED_IMAGE_SIZE_LIMIT');
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw Error('GENERATED_IMAGE_ENCODING_INVALID');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw Error('GENERATED_IMAGE_ENCODING_INVALID');
    if (bytes.length > MAX_GENERATED_IMAGE_BYTES) throw Error('GENERATED_IMAGE_SIZE_LIMIT');
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.subarray(12,16).toString() !== 'IHDR') throw Error('GENERATED_IMAGE_FORMAT_INVALID');
    if (!path.isAbsolute(input.projectPath) || (process.platform === 'win32' && (input.projectPath.startsWith('\\\\') || input.projectPath.slice(2).includes(':')))) throw Error('GENERATED_IMAGE_WORKSPACE_INVALID');
    const root = await realpath(input.projectPath);
    const directory = path.join(root, 'generated_images');
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || !same(await realpath(directory), directory)) throw Error('GENERATED_IMAGE_DIRECTORY_CHANGED');
    const identity = hash(JSON.stringify([input.sessionId, input.threadId, input.turnId, input.itemId]));
    const destination = path.join(directory, `image-${identity.slice(0,32)}.png`), digest = hash(bytes);
    let file;
    try { file = await open(destination, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (file) { try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); } }
    if (!same(await realpath(input.projectPath), root) || !same(await realpath(directory), directory)) throw Error('GENERATED_IMAGE_DIRECTORY_CHANGED');
    // Existing files are never overwritten, including changed files on replay.
    return this.attachments.registerGenerated(destination, digest, bytes.length, identity);
  }
}
