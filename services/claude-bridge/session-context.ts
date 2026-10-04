import os from 'node:os';
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {digest,missing,samePath,textFile} from '../../packages/native-resources/files';
import type {LocalClaudeCatalog} from './local-context';

/** Native-equivalent instruction and memory context assembled from the local device. */
export interface ClaudeSessionContextFile {path:string;kind:string;importedBy?:string;lines?:number;truncated?:boolean}
export interface ClaudeSessionContext {text:string;hash:string;files:ClaudeSessionContextFile[];pathRules:{path:string;paths:string[]}[];warnings:string[]}

/** Native Claude Code follows imports up to five hops and loads the first 200 MEMORY.md lines. */
const IMPORT_DEPTH=5,MEMORY_LINES=200;
export const CLAUDE_SESSION_CONTEXT_MARKER='<!-- agent-workbench:local-context -->';
const describe:Record<string,string>={
  'user-instructions':"user's private global instructions for all projects",
  'managed-instructions':'managed policy instructions for this device',
  'project-instructions':'project instructions',
  'project-local-instructions':"user's private project instructions, not checked in",
  'project-agents-reference':'project AGENTS.md shared with Codex',
  'rule':'project rule'
};
function frontmatter(text:string){const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);return {front:match?.[1]??'',body:match?text.slice(match[0].length):text};}
/** `paths:` accepts a scalar, an inline list or a block list, as native rule files do. */
export function rulePaths(text:string):string[]{
  const {front}=frontmatter(text),line=/^paths:[^\S\n]*(.*)$/m.exec(front);if(!line)return [];
  const inline=line[1]!.trim();
  if(inline){const values=inline.startsWith('[')?inline.replace(/^\[|\]$/g,'').split(','):[inline];return values.map(v=>v.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean);}
  const block=front.slice(line.index+line[0].length).split('\n').slice(1);const values:string[]=[];
  for(const row of block){const item=/^\s+-\s+(.+)$/.exec(row);if(!item)break;values.push(item[1]!.trim().replace(/^['"]|['"]$/g,''));}
  return values;
}
/** `@path` imports outside fenced and inline code, resolved like native memory imports. */
export function importTargets(text:string,file:string,home:string):string[]{
  const targets:string[]=[];let fenced=false;
  for(const line of text.split(/\r?\n/)){
    if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;continue;}if(fenced)continue;
    for(const match of line.replace(/`[^`]*`/g,'').matchAll(/(?:^|\s)@((?:[^\s\\]|\\ )+)/g)){
      const raw=match[1]!.replaceAll('\\ ',' ');if(/^[A-Za-z0-9._%+-]+@/.test(raw)||raw.includes('://'))continue;
      targets.push(raw.startsWith('~/')||raw.startsWith('~\\')?path.join(home,raw.slice(2)):path.isAbsolute(raw)?raw:path.resolve(path.dirname(file),raw));
    }
  }
  return targets;
}
async function readable(file:string){try{return (await lstat(file)).isFile()?await textFile(file,Infinity):undefined;}catch(error){if(missing(error))return undefined;throw error;}}

export async function buildClaudeSessionContext(catalog:LocalClaudeCatalog,home=os.homedir()):Promise<ClaudeSessionContext>{
  const files:ClaudeSessionContextFile[]=[],pathRules:ClaudeSessionContext['pathRules']=[],warnings:string[]=[],sections:string[]=[];
  const seen:string[]=[];
  const add=async(file:string,kind:string,depth:number,importedBy?:string)=>{
    if(seen.some(s=>samePath(s,file)))return;seen.push(file);
    let text:string|undefined;try{text=await readable(file);}catch{warnings.push('Instruction file could not be read as UTF-8 text: '+file);return;}
    if(text===undefined){if(importedBy)warnings.push('Import not found: '+file+' (imported by '+importedBy+')');return;}
    if(kind==='rule'){const paths=rulePaths(text);if(paths.length){pathRules.push({path:file,paths});return;}}
    const label=importedBy?'imported by '+importedBy:describe[kind]??kind;
    files.push({path:file,kind,...(importedBy?{importedBy}:{})});
    sections.push('Contents of '+file+' ('+label+'):\n\n'+frontmatter(text).body.trim());
    if(depth>=IMPORT_DEPTH)return;
    for(const target of importTargets(text,file,home))await add(target,'import',depth+1,file);
  };
  for(const entry of catalog.instructions){
    const kind=entry.kind==='rule-read-paths-frontmatter-before-applying'?'rule':entry.kind==='project-instructions'&&/CLAUDE\.local\.md$/i.test(entry.path)?'project-local-instructions':entry.kind;
    await add(entry.path,kind,0);
  }
  if(pathRules.length)sections.push('Path-scoped rules. Read the rule before working on files that match its globs:\n'+pathRules.map(rule=>'- '+rule.path+': '+rule.paths.join(', ')).join('\n'));
  const memory=catalog.memory;
  if(memory.enabled&&memory.directory){
    const index=path.join(memory.directory,'MEMORY.md'),text=await readable(index).catch(()=>undefined);
    if(text!==undefined){
      const lines=text.split(/\r?\n/),truncated=lines.length>MEMORY_LINES;
      files.push({path:index,kind:'memory-index',lines:Math.min(lines.length,MEMORY_LINES),...(truncated?{truncated}:{})});
      sections.push('Contents of '+index+" (user's auto-memory index, persists across conversations; topic files are in "+memory.directory+'):\n\n'+lines.slice(0,MEMORY_LINES).join('\n').trim()+(truncated?'\n\n[Only the first '+MEMORY_LINES+' lines are loaded. Read the file for the rest.]':''));
    }else sections.push('Auto-memory is enabled for this project. Its directory is '+memory.directory+' and has no MEMORY.md index yet.');
  }else sections.push('Auto-memory is disabled for this project ('+memory.source+'). Do not read or write memory files unless the user asks.');
  const body=sections.join('\n\n');
  const text=CLAUDE_SESSION_CONTEXT_MARKER+'\n<system-reminder>\nAs you answer the user\'s questions, you can use the following context, loaded from the bound local device ('+catalog.cwd+'). These instructions OVERRIDE default behavior and you MUST follow them exactly as written.\n\n'+body+'\n\nThis context was attached automatically; call LocalContext only to refresh it or to discover skills.\n</system-reminder>';
  return {text,hash:digest(body),files,pathRules,warnings};
}
/** Which local context each workbench session last received, so a reconnect does not resend it unchanged. */
export class ClaudeContextLedger {
  private sent=new Map<string,string>();
  /** True when this session has not received this exact context since its last compaction. */
  needs(session:string,hash:string){return this.sent.get(session)!==hash;}
  record(session:string,hash:string){this.sent.set(session,hash);}
  reset(session:string){this.sent.delete(session);}
}
