import path from 'node:path';
import { atomicWrite, digest, noLinks, optionalText, samePath } from '../native-resources/files';
import { handoffEnd, handoffStart, splitImports } from './protocol';
import { codexInstructions, type NativeHomes, type Provider } from './sources';

/** Semantic decisions belong to the selected model; byte-level bookkeeping does not. */
export interface MemoryConsolidationEntry {
  archiveId: string;
  title: string;
  content: string;
  topic?:string;
}
export interface MemoryConsolidationInput { entries: MemoryConsolidationEntry[] }
export interface MemoryConsolidationArchive { id:string; origin:Provider; scope:string; revision:number; operation:'upsert'|'withdraw' }
export interface MemoryConsolidationEvidence {
  archiveId:string; revision:number; scope:string; disposition:'stored';
  files:{path:string;sha256:string}[]; index:{path:string;sha256:string}; indexSourceId:string;
}
/** Replaceable writer; returned evidence is independently verified by the exchange. */
export interface MemoryConsolidationWriter {
  store(homes:NativeHomes,archive:MemoryConsolidationArchive,entry:MemoryConsolidationEntry,assertActive:()=>Promise<void>):Promise<MemoryConsolidationEvidence>;
}

export function consolidationInput(value:unknown):MemoryConsolidationInput {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('MEMORY_CONSOLIDATION_ARGUMENT_INVALID');
  const input=value as MemoryConsolidationInput;
  if(Object.keys(input).some(k=>k!=='entries')||!Array.isArray(input.entries)||!input.entries.length||input.entries.length>24)throw Error('MEMORY_CONSOLIDATION_ARGUMENT_INVALID');
  const seen=new Set<string>();
  for(const e of input.entries){
    if(!e||typeof e!=='object'||Object.keys(e).some(k=>!['archiveId','title','content','topic'].includes(k))||!/^([a-f\d]{64})$/.test(e.archiveId)||seen.has(e.archiveId)||typeof e.title!=='string'||!e.title.trim()||e.title.length>160||/[\r\n\0<>]/.test(e.title)||typeof e.content!=='string'||!e.content.trim()||Buffer.byteLength(e.content)>48000||/\0|<!--\s*agent-workbench/i.test(e.content)||e.topic!==undefined&&(typeof e.topic!=='string'||!/^[-a-z0-9]{1,80}$/.test(e.topic)))throw Error('MEMORY_CONSOLIDATION_ARGUMENT_INVALID');
    seen.add(e.archiveId);
  }
  return input;
}

export async function consolidationDestination(homes:NativeHomes,runtime:Provider,scope:string,topic='general'){
  const index=runtime==='codex'?await codexInstructions(homes.codex):path.join(homes.claude,'CLAUDE.md');
  const root=path.join(homes[runtime],runtime==='codex'?'memories':'memory','received');
  return {index,directoryIndex:path.join(root,'INDEX.md'),file:path.join(root,digest(scope+'\0'+topic).slice(0,32)+'.md')};
}

/** Append only attributed references. Generated native memory indexes remain runtime-owned. */
export async function storeConsolidatedReference(homes:NativeHomes,archive:MemoryConsolidationArchive,entry:MemoryConsolidationEntry,assertActive:()=>Promise<void>):Promise<MemoryConsolidationEvidence>{
  const runtime=archive.origin==='codex'?'claude':'codex';
  const {file,index,directoryIndex}=await consolidationDestination(homes,runtime,archive.scope,entry.topic);
  await assertActive();await noLinks(file);await noLinks(index);await noLinks(directoryIndex);
  const before=await optionalText(file),indexBefore=await optionalText(index),directoryBefore=await optionalText(directoryIndex);
  const parts=splitImports(before??''),indexParts=splitImports(indexBefore??''),directoryParts=splitImports(directoryBefore??'');
  const start=handoffStart(archive.id),end=handoffEnd(archive.id);
  const text=`${start}\n## ${entry.title.trim()}\nSource runtime: ${archive.origin}. Source scope: ${archive.scope}. Revision: ${archive.revision}. Operation: ${archive.operation}.\n\n${entry.content.trim()}\n${end}`;
  const old=parts.spans.find(p=>p.id===archive.id);
  const next=old?(before??'').replace((before??'').slice((before??'').indexOf(start),(before??'').indexOf(end)+end.length),()=>text):(before??'')+((before??'').endsWith('\n')||!before?'':'\n')+text+'\n';
  const relative=path.relative(path.dirname(index),directoryIndex).split(path.sep).join('/');
  const pointer=`[Imported memory references](${encodeURI(relative)}). This is a topic index, not a new instruction set. Read only topics relevant to their original scope; preserve their source attribution and uncertainty.`;
  // The startup entry point stays small; the ordinary topic index is read only on demand.
  const existing=indexParts.spans.find(p=>p.content.includes(`](${encodeURI(relative)})`));
  const indexSourceId=existing?.id??archive.id;
  const indexNext=existing?indexBefore!:(indexBefore??'')+((indexBefore??'').endsWith('\n')||!indexBefore?'':'\n')+`${handoffStart(archive.id)}\n${pointer}\n${handoffEnd(archive.id)}\n`;
  const topicLink=`[${entry.topic??'general'}](${path.basename(file)}). Source scope: ${archive.scope}.`;
  const directoryNext=directoryParts.spans.some(p=>p.content.includes(`](${path.basename(file)})`))?directoryBefore!:(directoryBefore??'')+((directoryBefore??'').endsWith('\n')||!directoryBefore?'':'\n')+`${start}\n${topicLink}\n${end}\n`;
  if(Buffer.byteLength(next)>2*1024*1024||Buffer.byteLength(directoryNext)>2*1024*1024||Buffer.byteLength(indexNext)>30000)throw Error('MEMORY_CONSOLIDATION_INDEX_BUDGET');
  const check=async()=>{
    await assertActive();await noLinks(file);await noLinks(index);await noLinks(directoryIndex);
    if(!samePath((await consolidationDestination(homes,runtime,archive.scope)).index,index)||await optionalText(index)!==indexBefore)throw Error('MEMORY_CONSOLIDATION_NATIVE_CHANGED');
  };
  await check();
  if(await optionalText(directoryIndex)!==directoryBefore)throw Error('MEMORY_CONSOLIDATION_NATIVE_CHANGED');
  if(next!==before)await atomicWrite(file,next,async()=>{await check();if(await optionalText(file)!==before)throw Error('MEMORY_CONSOLIDATION_NATIVE_CHANGED');});
  if(directoryNext!==directoryBefore)await atomicWrite(directoryIndex,directoryNext,async()=>{await check();if(await optionalText(directoryIndex)!==directoryBefore||await optionalText(file)!==next)throw Error('MEMORY_CONSOLIDATION_NATIVE_CHANGED');});
  if(indexNext!==indexBefore)await atomicWrite(index,indexNext,async()=>{await check();if(await optionalText(file)!==next)throw Error('MEMORY_CONSOLIDATION_NATIVE_CHANGED');});
  await assertActive();await noLinks(file);await noLinks(index);
  if(await optionalText(file)!==next||await optionalText(index)!==indexNext||await optionalText(directoryIndex)!==directoryNext)throw Error('MEMORY_CONSOLIDATION_NATIVE_CHANGED');
  return {archiveId:archive.id,revision:archive.revision,scope:archive.scope,disposition:'stored',files:[{path:file,sha256:digest(next)},{path:directoryIndex,sha256:digest(directoryNext)}],index:{path:index,sha256:digest(indexNext)},indexSourceId};
}
