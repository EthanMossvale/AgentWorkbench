import type { Session } from '../contracts';
import type { RuntimeActivity } from './activity';

export interface NativeFileChange {
  path: string; previousPath?: string; kind: 'add'|'modify'|'delete'|'rename';
  additions: number|null; deletions: number|null; diff?: string; truncated?: boolean;
}
export interface FileChangeRecord { activityId: string; userMessageId?: string; turnId?: string; at: string; changes: NativeFileChange[]; truncated?: boolean }
export interface TurnFileChanges { id: string; userMessageId?: string; files: (NativeFileChange & { edits: number; patches: {activityId:string;diff?:string;truncated?:boolean}[] })[]; truncated: boolean }
/** Steering messages in one native turn share one review without changing saved records. */
export function mergeTurnFileChanges(groups: TurnFileChanges[], id: string): TurnFileChanges | undefined {
  if (!groups.length) return;
  const merged: TurnFileChanges = {id,userMessageId:groups[0]?.userMessageId,files:[],truncated:groups.some(group=>group.truncated)};
  for (const group of groups) for (const original of group.files) {
    const file = structuredClone(original), previous = merged.files.find(item=>key(item.path)===key(file.previousPath??file.path));
    if (!previous) { merged.files.push(file); continue; }
    previous.path=file.path; previous.previousPath??=file.previousPath; previous.edits+=file.edits;
    previous.additions=previous.additions===null||file.additions===null?null:previous.additions+file.additions;
    previous.deletions=previous.deletions===null||file.deletions===null?null:previous.deletions+file.deletions;
    previous.patches.push(...file.patches); previous.truncated ||= file.truncated;
  }
  return merged;
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const safePath=(value:unknown):string|undefined=>typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\x00-\x1f]/.test(value)?value:undefined;

export function diffLineCounts(diff:string|undefined):{additions:number|null;deletions:number|null} {
  if(diff===undefined||/^(?:Binary files |GIT binary patch)/m.test(diff))return {additions:null,deletions:null};
  let additions=0,deletions=0,inHunk=false,hasPatch=diff==='';
  const hasHunks=/^@@/m.test(diff);
  for(const line of diff.split(/\r?\n/)){
    if(line.startsWith('@@')){inHunk=true;hasPatch=true;continue;}
    if(line.startsWith('diff --git ')){inHunk=false;continue;}
    if(hasHunks&&!inHunk)continue;
    if(!inHunk&&(/^(?:--- |\+\+\+ |\*\*\* )/.test(line)))continue;
    if(line.startsWith('+')){additions++;hasPatch=true;}else if(line.startsWith('-')){deletions++;hasPatch=true;}
  }
  return hasPatch?{additions,deletions}:{additions:null,deletions:null};
}
/** Bounds the public diff independently of the generic activity text; counts use the complete native patch. */
export function codexFileChanges(item:Record<string,unknown>):NativeFileChange[]|undefined {
  if(item.type!=='fileChange'||!Array.isArray(item.changes))return;
  let remaining=64*1024;
  return item.changes.slice(0,256).flatMap(value=>{
    const change=record(value),source=safePath(change.path);if(!source)return [];
    const nativeKind=record(change.kind),kind=typeof change.kind==='string'?change.kind:nativeKind.type;
    const moved=safePath(nativeKind.move_path??nativeKind.movePath??change.move_path??change.movePath);
    const raw=typeof change.diff==='string'?change.diff:undefined;
    // Fixed native protocol: add/delete carries whole content; update carries a unified patch.
    const whole=(kind==='add'||kind==='delete')&&raw!==undefined;
    const lines=whole?(raw===''?[]:raw!.replace(/\n$/,'').split('\n')):[];
    const diff=whole?lines.map(line=>(kind==='add'?'+':'-')+line).join('\n'):raw;
    const counts=whole?{additions:kind==='add'?lines.length:0,deletions:kind==='delete'?lines.length:0}:diffLineCounts(diff);
    const saved=diff?.slice(0,remaining);remaining-=saved?.length??0;
    return [{path:moved??source,...(moved?{previousPath:source}:{}),kind:moved?'rename':kind==='add'?'add':kind==='delete'?'delete':'modify',...counts,...(saved!==undefined?{diff:saved,truncated:saved.length!==diff!.length}:{})} as NativeFileChange];
  });
}
export function claudeFileChanges(name:string,input:unknown):NativeFileChange[]|undefined {
  if(!['Edit','Write','MultiEdit','NotebookEdit'].includes(name))return;
  const args=record(input),file=safePath(args.file_path??args.notebook_path);if(!file)return;
  // Requests identify the file, but are only counted after a successful native result.
  return [{path:file,kind:'modify',additions:null,deletions:null}];
}
export function claudeCompletedChanges(changes:NativeFileChange[]|undefined,result:unknown):NativeFileChange[]|undefined {
  if(!changes)return;
  const native=record(result),patch=native.structuredPatch;
  if(!Array.isArray(patch))return changes;
  const diff=patch.flatMap(value=>{
    const hunk=record(value);if(!Array.isArray(hunk.lines))return [];
    const hasPositions=[hunk.oldStart,hunk.oldLines,hunk.newStart,hunk.newLines].every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0);
    const header=hasPositions?`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`:'@@';
    return [header,...hunk.lines.filter((line):line is string=>typeof line==='string')];
  }).join('\n');
  if(!diff)return changes;
  return changes.map(change=>({...change,...diffLineCounts(diff),diff:diff.slice(0,64*1024),truncated:diff.length>64*1024}));
}
export function recordFileChanges(session:Session,activity:RuntimeActivity):void {
  if(!activity.fileChanges?.length)return;
  const records=session.fileChangeRecords??=[];
  const index=records.findIndex(item=>item.activityId===activity.id);
  if(activity.status!=='completed'){if(index>=0&&activity.status!=='running')records.splice(index,1);return;}
  const user=session.messages.filter(message=>message.role==='user'&&message.timestamp<=activity.startedAt).at(-1);
  const base=activity.cwd??session.projectPath;
  const changes=activity.fileChanges.map(change=>({...change,path:absoluteChangePath(change.path,base),...(change.previousPath?{previousPath:absoluteChangePath(change.previousPath,base)}:{})}));
  const next:FileChangeRecord={activityId:activity.id,userMessageId:records[index]?.userMessageId??user?.id,turnId:activity.turnId,at:activity.startedAt,changes,truncated:activity.fileChangesTruncated};
  if(index>=0)records[index]=next;else records.push(next);
  session.fileChangeRecords=records;
}
function absoluteChangePath(value:string,cwd?:string):string {
  if(/^(?:[a-z]:[\\/]|\/)/i.test(value)||!cwd||!/^(?:[a-z]:[\\/]|\/)/i.test(cwd))return value;
  const joined=cwd.replaceAll('\\','/')+'/'+value.replaceAll('\\','/'),parts:string[]=[];
  for(const part of joined.split('/')){if(part==='.')continue;if(part==='..'&&parts.length>1)parts.pop();else if(part!=='..')parts.push(part);}
  return parts.join('/');
}
const key=(value:string)=>/^[a-z]:/i.test(value)?value.replaceAll('\\','/').toLowerCase():value;
export function turnFileChanges(session:Session):TurnFileChanges[] {
  const snapshot={...session,fileChangeRecords:[...(session.fileChangeRecords??[])]};
  for(const activity of session.activities??[])if(!snapshot.fileChangeRecords.some(item=>item.activityId===activity.id))recordFileChanges(snapshot,activity);
  const groups=new Map<string,TurnFileChanges>();
  for(const record of snapshot.fileChangeRecords){
    const id=record.userMessageId??record.turnId??record.activityId;
    let group=groups.get(id);if(!group){group={id,userMessageId:record.userMessageId,files:[],truncated:false};groups.set(id,group);}
    group.truncated ||= !!record.truncated;
    for(const change of record.changes){
      const previous=group.files.find(file=>key(file.path)===key(change.previousPath??change.path));
      if(previous){
        previous.path=change.path;previous.previousPath??=change.previousPath;previous.edits++;
        previous.additions=previous.additions===null||change.additions===null?null:previous.additions+change.additions;
        previous.deletions=previous.deletions===null||change.deletions===null?null:previous.deletions+change.deletions;
        previous.truncated ||= change.truncated;previous.patches.push({activityId:record.activityId,diff:change.diff,truncated:change.truncated});
      }else group.files.push({...change,edits:1,patches:[{activityId:record.activityId,diff:change.diff,truncated:change.truncated}]});
    }
  }
  return [...groups.values()];
}
