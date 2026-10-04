/** Model-facing text for official tool results, matching what native Claude Code shows the model. */
export interface ClaudeToolPresenter {id:`plugin:${string}`;present(name:string,args:any,result:unknown):unknown|undefined}
export class ClaudeToolPresenters {
  private sources=new Map<string,ClaudeToolPresenter>();
  register(source:ClaudeToolPresenter):()=>void{if(this.sources.has(source.id))throw Error('CLAUDE_TOOL_PRESENTER_DUPLICATE');const entry={...source};this.sources.set(entry.id,entry);return()=>{if(this.sources.get(entry.id)===entry)this.sources.delete(entry.id);};}
  /** Newest defined presenter wins; undefined delegates to the built-in presentation. */
  present(name:string,args:any,result:unknown):unknown{for(const source of [...this.sources.values()].reverse()){const value=source.present(name,args,result);if(value!==undefined)return value;}return presentClaudeToolResult(name,args,result);}
}
export const claudeToolPresenters=new ClaudeToolPresenters();

const text=(value:string,isError=false)=>({content:[{type:'text',text:value}],...(isError?{isError:true}:{})});
/** The JSON payload of a single-text official result, or undefined for any other shape. */
export function claudeResultJson(result:unknown):any{
  const value=result as any;if(!value||value.isError||!Array.isArray(value.content)||value.content.length!==1||value.content[0]?.type!=='text')return undefined;
  try{const parsed=JSON.parse(value.content[0].text);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:undefined;}catch{return undefined;}
}
export function claudeResultText(result:unknown):string{const value=result as any;return Array.isArray(value?.content)?value.content.filter((c:any)=>c?.type==='text').map((c:any)=>c.text).join('\n'):'';}
const shellKnown=new Set(['stdout','stderr','interrupted','isImage','noOutputExpected','returnCodeInterpretation']);
export function presentShellOutput(name:string,value:any):string|undefined{
  if(typeof value?.stdout!=='string'||value.isImage)return undefined;
  const parts=[value.stdout.replace(/\s+$/,''),typeof value.stderr==='string'?value.stderr.replace(/\s+$/,''):''].filter(Boolean);
  if(value.interrupted)parts.push('<error>Command was aborted before completion</error>');
  if(typeof value.returnCodeInterpretation==='string'&&value.returnCodeInterpretation)parts.push(value.returnCodeInterpretation);
  // Unrecognized native fields are kept as short lines instead of being dropped.
  for(const [key,field] of Object.entries(value))if(!shellKnown.has(key)&&field!==false&&field!==null&&field!==undefined&&field!=='')parts.push(key+': '+(typeof field==='string'?field:JSON.stringify(field)));
  return parts.length?parts.join('\n'):'('+name+' completed with no output)';
}
function presentRead(value:any):string|undefined{
  const file=value?.file;if(value?.type!=='text'||typeof file?.content!=='string'||typeof file.filePath!=='string')return undefined;
  if(!file.content)return '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>';
  const start=Number.isSafeInteger(file.startLine)&&file.startLine>0?file.startLine:1,lines=file.content.split(/\r?\n/);
  if(lines.length>1&&lines.at(-1)==='')lines.pop();
  let body=lines.map((line:string,i:number)=>(start+i)+'\t'+line).join('\n');
  const shown=Number.isSafeInteger(file.numLines)?file.numLines:lines.length,end=start+shown-1;
  if(Number.isSafeInteger(file.totalLines)&&(start>1||end<file.totalLines))body+='\n\n(Showing lines '+start+'-'+end+' of '+file.totalLines+'. Use offset and limit to read other parts.)';
  return body;
}
function presentGlob(value:any):string|undefined{
  if(!Array.isArray(value?.filenames)||value.mode!==undefined)return undefined;
  if(!value.filenames.length)return 'No files found';
  return value.filenames.join('\n')+(value.truncated?'\n(Results are truncated. Consider using a more specific path or pattern.)':'');
}
function presentGrep(value:any):string|undefined{
  const page=value?.appliedLimit!==undefined||value?.appliedOffset!==undefined?'\n\n[Showing results with pagination = limit: '+(value.appliedLimit??'none')+', offset: '+(value.appliedOffset??0)+']':'';
  if(value?.mode==='files_with_matches'&&Array.isArray(value.filenames))return value.filenames.length?'Found '+value.filenames.length+' file'+(value.filenames.length===1?'':'s')+'\n'+value.filenames.join('\n')+page:'No files found';
  if(value?.mode==='content'&&typeof (value.content??'')==='string')return (value.content||'No matches found')+page;
  if(value?.mode==='count'&&typeof (value.content??'')==='string')return value.content?value.content+'\n\nFound '+(value.numMatches??0)+' total occurrence'+(value.numMatches===1?'':'s')+' across '+(value.numFiles??0)+' file'+(value.numFiles===1?'':'s')+'.'+page:'No matches found';
  return undefined;
}
/** Native Edit/Write rejects a file changed since it was read; the official MCP server recovers silently. */
export const STALE_EDIT_WARNING='Warning: this file changed on disk after it was last read. Review the current file before relying on its other contents. The native tool result below determines whether this operation succeeded.';
function presentEdit(value:any):string|undefined{
  if(typeof value?.filePath!=='string'||typeof value.oldString!=='string')return undefined;
  return 'The file '+value.filePath+' has been updated successfully.'+(value.replaceAll?' All occurrences were replaced.':'')+(value.staleRecovered?'\n'+STALE_EDIT_WARNING:'');
}
function presentWrite(value:any):string|undefined{
  if(typeof value?.filePath!=='string'||!['create','update'].includes(value.type))return undefined;
  return (value.type==='create'?'File created successfully at: '+value.filePath:'The file '+value.filePath+' has been updated successfully.')+(value.staleRecovered?'\n'+STALE_EDIT_WARNING:'');
}
function presentTask(task:any):string{
  const lines=['Task '+task.id+' ('+task.shell+') is '+task.state+'. requestId: '+task.requestId];
  lines.push('Command: '+(task.description||String(task.command).split('\n')[0]));
  if(task.finishedAt)lines.push('Finished at '+task.finishedAt+'.');
  if(task.error)lines.push('Error: '+task.error);
  if(task.outputError)lines.push('Output error: '+task.outputError);
  if(task.logPath)lines.push('Full output log: '+task.logPath);
  if(task.progress){lines.push('Output so far ('+task.progress.bytes+' bytes'+(task.progress.truncated?', last '+task.progress.lines+' lines':'')+'):');lines.push(task.progress.tail||'(no output yet)');}
  if(task.result!==undefined){
    const json=claudeResultJson(task.result),shown=json?presentShellOutput(task.shell,json):undefined;
    lines.push('Output:');lines.push(shown??(claudeResultText(task.result)||'(no output)'));
  }
  if(task.output)lines.push('Stored result: '+JSON.stringify(task.output));
  return lines.join('\n');
}
function presentContext(value:any):string|undefined{
  if(!value||!Array.isArray(value.instructions))return undefined;
  const {contents,...rest}=value;
  return (typeof contents==='string'?contents+'\n\n':'')+'Catalog:\n'+JSON.stringify(rest);
}
function presentSkill(value:any):string|undefined{
  if(typeof value?.instructions!=='string'||!value.skill)return undefined;
  const {instructions,source,...rest}=value;
  const keep=rest.execution?.nativeRequirements?.length?{...rest,source}:rest;
  return instructions+'\n\n---\nSkill metadata:\n'+JSON.stringify(keep);
}

export function presentClaudeToolResult(name:string,args:any,result:unknown):unknown{
  const value=result as any;if(!value||!Array.isArray(value.content))return result;
  if(name==='StartLocalCommand'||name==='LocalTaskOutput'||name==='StopLocalTask'){const task=claudeResultJson(result);return task?.id?text(presentTask(task)):result;}
  if(name==='ListLocalTasks'){const tasks=(()=>{try{return JSON.parse(claudeResultText(result));}catch{return undefined;}})();return Array.isArray(tasks)?text(tasks.length?tasks.map(t=>'- '+t.id+' ['+t.state+(t.collected?'':', not collected')+'] '+t.shell+': '+(t.description||String(t.command).split('\n')[0])).join('\n'):'No local tasks.'):result;}
  const json=claudeResultJson(result);if(!json)return result;
  let shown:string|undefined;
  if(name==='Bash'||name==='PowerShell')shown=presentShellOutput(name,json);
  else if(name==='Read')shown=presentRead(json);
  else if(name==='Glob')shown=presentGlob(json);
  else if(name==='Grep')shown=presentGrep(json);
  else if(name==='Edit')shown=presentEdit(json);
  else if(name==='Write')shown=presentWrite(json);
  else if(name==='LocalContext')shown=presentContext(json);
  else if(name==='LoadLocalSkill')shown=presentSkill(json);
  return shown===undefined?result:text(shown);
}
