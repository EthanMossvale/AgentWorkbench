import { constants } from 'node:fs';
import { open, realpath, stat, readdir } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class FileBoundaryError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'FileBoundaryError'; }
}
export interface FileContext { grantId: string; ownerId: string; deviceId: string; generation: string; sessionId: string; workspaceId: string; operationId: string; os: NodeJS.Platform }
export interface FileGrant { id: string; ownerId: string; deviceId: string; generation: string; expiresAt: string; operations: ('read' | 'write')[] }
export interface FileSnapshot { realPath: string; content: string; version: string; bytes: number }
export interface FileReadOptions { offset?: number; limit?: number; encoding?: 'utf8' | 'base64'; version?: string; signal?: AbortSignal }
export interface FileReadPage extends FileSnapshot { encoding:'utf8'|'base64'; offset:number; totalCharacters?:number; nextOffset?:number; truncated:boolean }
export interface WritePreview { id: string; bindingHash: string; realPath: string; expectedVersion: string; nextVersion: string; bytes: number; expiresAt: string }
export type OwnerVerifier = (resolvedPath: string, file: Stats) => Promise<boolean>;
export interface OwnerFileOptions {
  ownerId: string; deviceId: string; generation: string;
  /** Legacy argument, ignored. File access is authorized by owner/device grants and OS ownership. */
  controlPaths: string[];
  /** On Windows a trusted ACL/owner adapter is mandatory. A renderer username is not proof. */
  verifyOwner?: OwnerVerifier;
  expectedUid?: number; maxBytes?: number; now?: () => number;
}
interface PendingWrite { context: FileContext; preview: WritePreview; content: Buffer; encoding: 'utf8'|'base64'; approved: boolean }
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function deny(code: string, message: string): never { throw new FileBoundaryError(code, message); }
const canonical = (value: string) => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);

/** Server-owned service. Never expose issueGrant/confirmWrite/revokeGeneration to model tool dispatch. */
export class OwnerFileService {
  private readonly grants = new Map<string, FileGrant>();
  private readonly pending = new Map<string, PendingWrite>();
  private readonly completed = new Map<string, FileSnapshot>();
  private readonly writeLocks = new Set<string>();
  private readonly revoked = new Set<string>();
  private readonly now: () => number;
  private readonly maxBytes: number;
  private constructor(private readonly options: OwnerFileOptions) {
    this.now = options.now ?? Date.now; this.maxBytes = options.maxBytes ?? Infinity;
  }
  static async create(options: OwnerFileOptions): Promise<OwnerFileService> {
    if (!options.ownerId || !options.deviceId || !options.generation || (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1))) deny('INVALID_POLICY', 'An owner/device/generation and a valid optional file policy are required.');
    if (process.platform === 'win32' && !options.verifyOwner) deny('OWNER_VERIFICATION_UNAVAILABLE', 'Windows owner/ACL verification needs a trusted native adapter; username and Node uid are insufficient.');
    if (!options.verifyOwner && (!Number.isInteger(options.expectedUid) || options.expectedUid! < 0)) deny('OWNER_VERIFICATION_UNAVAILABLE', 'A verified OS owner identity is required.');
    return new OwnerFileService(options);
  }
  /** Called only by the trusted device authorization layer, never by renderer-provided roles. */
  issueGrant(input: Omit<FileGrant, 'id' | 'ownerId' | 'deviceId' | 'generation'>): FileGrant {
    if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= this.now() || !input.operations.length || input.operations.some(op => op !== 'read' && op !== 'write')) deny('INVALID_GRANT', 'Invalid file grant.');
    const grant: FileGrant = { id: randomUUID(), ownerId: this.options.ownerId, deviceId: this.options.deviceId, generation: this.options.generation, expiresAt: input.expiresAt, operations: [...input.operations] };
    this.grants.set(grant.id, grant); return structuredClone(grant);
  }
  revokeGeneration(generation: string): void { this.revoked.add(generation); }
  private authorize(context: FileContext, operation: 'read' | 'write'): void {
    const grant = this.grants.get(context.grantId);
    if (!grant || context.ownerId !== this.options.ownerId || context.deviceId !== this.options.deviceId || context.generation !== this.options.generation || grant.ownerId !== context.ownerId || grant.deviceId !== context.deviceId || grant.generation !== context.generation || this.revoked.has(context.generation) || Date.parse(grant.expiresAt) <= this.now() || !grant.operations.includes(operation)) deny('ACCESS_DENIED', 'The owner/device grant is missing, expired, revoked or mismatched.');
    if (context.os !== process.platform) deny('OS_MISMATCH', 'The requested OS does not match this device.');
    if (![context.operationId, context.sessionId, context.workspaceId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256)) deny('INVALID_CONTEXT', 'Operation, session and workspace bindings are required.');
  }
  private checkPath(value: string): void {
    if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) deny('INVALID_PATH', 'An absolute native path is required.');
    if (process.platform === 'win32' && (/^\\\\[.?]\\/.test(value) || /:/g.test(value.slice(2)))) deny('UNSUPPORTED_PATH', 'Device namespaces and alternate data streams are not ordinary files.');
  }
  private async resolveFile(filePath: string): Promise<{ target: string; metadata: Stats }> {
    this.checkPath(filePath);
    const target = await realpath(filePath); this.checkPath(target);
    const metadata = await stat(target);
    if (!metadata.isFile()) deny('UNSUPPORTED_FILE', 'A regular file is required.');
    const owned = this.options.verifyOwner ? await this.options.verifyOwner(target, metadata) : metadata.uid === this.options.expectedUid;
    if (!owned) deny('OTHER_OWNER', 'The real file is not verified as belonging to this owner.');
    if (metadata.size > this.maxBytes) deny('FILE_TOO_LARGE', 'The file exceeds the configured bound.');
    return { target, metadata };
  }
  private async readResolved(filePath: string, options:FileReadOptions = {}): Promise<FileReadPage> {
    const offset=options.offset??0,limit=options.limit??Infinity,encoding=options.encoding??'utf8';
    if(!Number.isSafeInteger(offset)||offset<0||(limit!==Infinity&&(!Number.isSafeInteger(limit)||limit<1)))deny('INVALID_READ_RANGE','Use a nonnegative offset and positive page length.');
    if(encoding!=='utf8'&&encoding!=='base64')deny('UNSUPPORTED_ENCODING','Use utf8 text or base64 bytes.');
    const { target, metadata } = await this.resolveFile(filePath);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.ino !== metadata.ino || before.dev !== metadata.dev) deny('PATH_CHANGED', 'The file target changed during authorization.');
      const buffer=Buffer.alloc(64*1024),digest=createHash('sha256'),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
      const chunks:Buffer[]=[],text:string[]=[];let length=0,characters=0;
      const collect=(value:string)=>{const start=Math.max(0,offset-characters),end=Math.min(value.length,offset+limit-characters);if(end>start)text.push(value.slice(start,end));characters+=value.length;};
      while(true){
        options.signal?.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,buffer.length,length);if(!bytesRead)break;
        const chunk=buffer.subarray(0,bytesRead);digest.update(chunk);
        if(encoding==='base64'){const start=Math.max(0,offset-length),end=Math.min(bytesRead,offset+limit-length);if(end>start)chunks.push(Buffer.from(chunk.subarray(start,end)));}
        else try{collect(decoder.decode(chunk,{stream:true}));}catch{deny('UNSUPPORTED_ENCODING','This file is not UTF-8. Read it with encoding base64 to preserve its bytes.');}
        length+=bytesRead;if(length>this.maxBytes)deny('FILE_TOO_LARGE','The file exceeds the configured bound.');
      }
      if(encoding==='utf8')try{collect(decoder.decode());}catch{deny('UNSUPPORTED_ENCODING','This file is not UTF-8. Read it with encoding base64 to preserve its bytes.');}
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || canonical(await realpath(filePath)) !== canonical(target)) deny('PATH_CHANGED', 'The file changed while it was being read.');
      const version=digest.digest('hex');if(options.version&&version!==options.version)deny('VERSION_CONFLICT','The source changed between pages; refresh before continuing.');
      const total=encoding==='utf8'?characters:length,next=Math.min(total,offset+limit);
      return {realPath:target,content:encoding==='utf8'?text.join(''):Buffer.concat(chunks).toString('base64'),version,bytes:length,encoding,offset,...(encoding==='utf8'?{totalCharacters:characters}:{}),...(next<total?{nextOffset:next}:{}),truncated:offset>0||next<total};
    } finally { await handle.close(); }
  }
  async read(context: FileContext, filePath: string): Promise<FileSnapshot> { this.authorize(context, 'read'); return this.readResolved(filePath); }
  async readRange(context:FileContext,filePath:string,options:FileReadOptions={}):Promise<FileReadPage>{this.authorize(context,'read');return this.readResolved(filePath,options);}
  async list(context:FileContext,directory:string,options:{offset?:number;limit?:number}={}){
    this.authorize(context,'read');this.checkPath(directory);const target=await realpath(directory);this.checkPath(target);const metadata=await stat(target);
    if(!metadata.isDirectory())deny('NOT_DIRECTORY','A directory is required.');
    if(!(this.options.verifyOwner?await this.options.verifyOwner(target,metadata):metadata.uid===this.options.expectedUid))deny('OTHER_OWNER','The directory is not verified as belonging to this owner.');
    const offset=options.offset??0,limit=options.limit??1000;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)deny('INVALID_READ_RANGE','Use a nonnegative offset and positive page length.');
    const entries=await readdir(target,{withFileTypes:true}),end=offset+limit;return {path:target,entries:entries.slice(offset,end).map(item=>({name:item.name,directory:item.isDirectory(),file:item.isFile(),link:item.isSymbolicLink()})),offset,total:entries.length,...(end<entries.length?{nextOffset:end}:{}),truncated:offset>0||end<entries.length};
  }
  async prepareWrite(context: FileContext, filePath: string, expectedVersion: string, content: string, encoding:'utf8'|'base64'='utf8'): Promise<WritePreview> {
    this.authorize(context, 'write');
    if(typeof content!=='string'||!['utf8','base64'].includes(encoding))deny('UNSUPPORTED_ENCODING','Use utf8 text or base64 bytes.');
    const bytes=Buffer.from(content,encoding);if(encoding==='base64'&&bytes.toString('base64')!==content)deny('INVALID_ENCODING','Provide canonical base64 bytes.');
    if(bytes.length>this.maxBytes)deny('FILE_TOO_LARGE','The proposed bytes exceed the configured write bound.');
    const existing = await this.readResolved(filePath,{encoding:'base64',limit:1});
    if (existing.version !== expectedVersion) deny('VERSION_CONFLICT', 'The file changed; refresh and review a new write preview.');
    const id = randomUUID(); const expiresAt = new Date(this.now() + 5 * 60_000).toISOString();
    const nextVersion = hash(bytes);
    const bindingHash = hash(JSON.stringify({ context, id, realPath: existing.realPath, expectedVersion, nextVersion, expiresAt }));
    const preview = { id, bindingHash, realPath: existing.realPath, expectedVersion, nextVersion, bytes: bytes.length, expiresAt };
    this.pending.set(id, { context: structuredClone(context), preview, content:bytes, encoding, approved: false }); return { ...preview };
  }
  /** Trusted interactive approval endpoint only; the model receives no authority to call this. */
  confirmWrite(approvalId: string, bindingHash: string): void {
    const pending = this.pending.get(approvalId);
    if (!pending || pending.preview.bindingHash !== bindingHash || Date.parse(pending.preview.expiresAt) <= this.now()) deny('INVALID_APPROVAL', 'Approval is absent, expired or bound to different parameters.');
    this.authorize(pending.context, 'write'); pending.approved = true;
  }
  async write(context: FileContext, approvalId: string, bindingHash: string): Promise<FileSnapshot> {
    this.authorize(context, 'write');
    const pending = this.pending.get(approvalId);
    if (!pending || !pending.approved || pending.preview.bindingHash !== bindingHash || JSON.stringify(context) !== JSON.stringify(pending.context) || Date.parse(pending.preview.expiresAt) <= this.now()) deny('INVALID_APPROVAL', 'Write requires an exact, current interactive approval.');
    const completed = this.completed.get(approvalId); if (completed) return { ...completed };
    const targetKey = canonical(pending.preview.realPath);
    if (this.writeLocks.has(targetKey)) deny('WRITE_BUSY', 'Another broker operation is writing this file.');
    this.writeLocks.add(targetKey);
    try {
      const existing = await this.readResolved(pending.preview.realPath,{encoding:'base64',limit:1});
      if (existing.version !== pending.preview.expectedVersion) deny('VERSION_CONFLICT', 'The approved baseline changed before writing.');
      const { target, metadata } = await this.resolveFile(existing.realPath);
      const handle = await open(target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
      try {
        const actual = await handle.stat();
        if (actual.nlink > 1) deny('UNSUPPORTED_FILE', 'This file shares its contents with other paths. Save a separate copy before editing.');
        if (actual.ino !== metadata.ino || actual.dev !== metadata.dev || actual.size > this.maxBytes) deny('PATH_CHANGED', 'The write target changed during authorization.');
        const original=Buffer.alloc(64*1024),baseline=createHash('sha256');let originalLength=0;
        while(true){const {bytesRead}=await handle.read(original,0,original.length,originalLength);if(!bytesRead)break;baseline.update(original.subarray(0,bytesRead));originalLength+=bytesRead;}
        if(baseline.digest('hex')!==pending.preview.expectedVersion)deny('VERSION_CONFLICT','The file changed while preparing the approved write.');
        this.authorize(context, 'write');
        const buffer = pending.content; let written = 0;
        while (written < buffer.length) { const result = await handle.write(buffer, written, buffer.length - written, written); if (!result.bytesWritten) throw new Error('File write made no progress.'); written += result.bytesWritten; }
        await handle.truncate(buffer.length); await handle.sync();
      } finally { await handle.close(); }
      const result = await this.readResolved(target,{encoding:pending.encoding});
      if (result.version !== pending.preview.nextVersion) deny('RESULT_UNCERTAIN', 'The file changed after the approved write; do not automatically replay.');
      this.completed.set(approvalId, result); return { ...result };
    } finally { this.writeLocks.delete(targetKey); }
  }
  limitations(): string[] { return ['Workspace paths organize work; they are not owner file fences.', 'OS permissions remain effective; broad directory enumeration is not implemented.', 'Windows requires a trusted ownership/ACL adapter and is unavailable without one.', 'This text service is not a filesystem sandbox for arbitrary shell code.', 'External processes do not participate in the broker write lock; uncertain writes must not be blindly replayed.']; }
}
