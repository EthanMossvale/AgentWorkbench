export interface ArchiveReadOptions {password?:string;volumes?:string[];signal?:AbortSignal}
export interface ArchivePasswordRequest {kind:'archive-password';filePath:string;incorrect:boolean}
export interface ArchiveUnlock {filePath:string;password:string}
export const isArchivePasswordRequest=(value:unknown):value is ArchivePasswordRequest=>!!value&&typeof value==='object'&&(value as ArchivePasswordRequest).kind==='archive-password';
