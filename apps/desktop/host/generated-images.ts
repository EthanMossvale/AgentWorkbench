import { createHash } from 'node:crypto';
import { mkdir, open, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedImageInput, GeneratedImageService, GeneratedImageFormat, GeneratedImageDecoder, NativeImageDecoder } from '../../../packages/generated-images/types';
import type { Attachment } from '../../../packages/attachments/types';
import { AttachmentStore } from './attachments';

const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Local artifact sink. It never reads or fetches native savedPath. */
export class WorkspaceGeneratedImages implements GeneratedImageService {
  private pending = new Map<string, Promise<Attachment>>();
  private decoders=new Map<string,GeneratedImageDecoder>();
  // Legacy directory-policy arguments are accepted for source compatibility only.
  constructor(private attachments: AttachmentStore, _controlPaths: string[] = [], _allowManagedWorkspace?: (sessionId:string,root:string)=>Promise<boolean>,private nativeDecoder?:NativeImageDecoder) {}
  registerDecoder(decoder:GeneratedImageDecoder):()=>void{
    if(!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(decoder.id)||typeof decoder.decode!=='function')throw Error('GENERATED_IMAGE_DECODER_INVALID');
    if(this.decoders.has(decoder.id))throw Error('GENERATED_IMAGE_DECODER_DUPLICATE');
    const entry={...decoder};this.decoders.set(entry.id,entry);return()=>{if(this.decoders.get(entry.id)===entry)this.decoders.delete(entry.id);};
  }
  async decode(bytes:Uint8Array):Promise<GeneratedImageFormat>{
    for(const decoder of [...this.decoders.values()].reverse()){
      try{const result=await decoder.decode(bytes);if(result&&this.decoders.get(decoder.id)===decoder)return result;}
      catch(error){if(this.decoders.get(decoder.id)===decoder)throw error;}
    }
    if(!this.nativeDecoder)throw Error('GENERATED_IMAGE_DECODER_UNAVAILABLE');
    return this.nativeDecoder(bytes);
  }
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
    if (typeof encoded !== 'string' || !encoded) throw Error('GENERATED_IMAGE_ENCODING_INVALID');
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw Error('GENERATED_IMAGE_ENCODING_INVALID');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw Error('GENERATED_IMAGE_ENCODING_INVALID');
    const format=await this.decode(bytes);
    if(!/^image\/[a-z\d.+-]+$/i.test(format.mime)||!/^[a-z\d]+$/i.test(format.extension)||!Number.isSafeInteger(format.width)||!Number.isSafeInteger(format.height)||format.width<1||format.height<1)throw Error('GENERATED_IMAGE_FORMAT_INVALID');
    if (!path.isAbsolute(input.projectPath) || (process.platform === 'win32' && (/^(?:\\\\|\/\/)[.?][\\/]/.test(input.projectPath) || input.projectPath.slice(2).includes(':')))) throw Error('GENERATED_IMAGE_WORKSPACE_INVALID');
    const root = await realpath(input.projectPath);
    const directory = path.join(root, 'generated_images');
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || !same(await realpath(directory), directory)) throw Error('GENERATED_IMAGE_DIRECTORY_CHANGED');
    const identity = hash(JSON.stringify([input.sessionId, input.threadId, input.turnId, input.itemId]));
    const destination = path.join(directory, `image-${identity.slice(0,32)}.${format.extension}`), digest = hash(bytes);
    const existing=await this.attachments.generatedRecord(identity);
    if(existing&&(existing.sha256!==digest||existing.path!==destination||existing.mime!==format.mime))throw Error('GENERATED_IMAGE_RECORD_CHANGED');
    let file;
    try { file = await open(destination, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (file) { try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); } }
    if (!same(await realpath(input.projectPath), root) || !same(await realpath(directory), directory)) throw Error('GENERATED_IMAGE_DIRECTORY_CHANGED');
    // Existing files are never overwritten, including changed files on replay.
    return this.attachments.registerGenerated(destination, digest, bytes.length, identity, format);
  }
}
