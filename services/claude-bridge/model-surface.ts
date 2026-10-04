import path from 'node:path';
import {stat,readFile} from 'node:fs/promises';
import type {ClaudeToolServer,ClaudeToolServerOptions} from './tools';
import {rulePaths} from './session-context';
import {LocalClaudeContext} from './local-context';
import {claudeToolPresenters,claudeResultJson,claudeResultText,type ClaudeToolPresenters,STALE_EDIT_WARNING} from './presentation';
import {localHookDecision,localHookInput,localHookMatches,localHookPlan,runLocalHook,type LocalHookEvent,type LocalHookPlan} from './local-hooks';

export interface ClaudeModelSurfaceOptions extends ClaudeToolServerOptions {sessionId:string;permission():string}
/** Tools Claude Code loads up front instead of deferring behind ToolSearch. */
export const CLAUDE_ALWAYS_LOAD_TOOLS:readonly string[]=['Read','Write','Edit','Glob','Grep','Bash','PowerShell','LocalContext','LoadLocalSkill','StartLocalCommand','LocalTaskOutput'];
const OFFICIAL_HOOK_TOOLS=new Set(['Read','Write','Edit','Glob','Grep','Bash','PowerShell','NotebookEdit','WebFetch','WebSearch']);
const errorResult=(text:string)=>({isError:true,content:[{type:'text',text}]});
function withAlwaysLoad(definition:Record<string,unknown>):Record<string,unknown>{
  if(!CLAUDE_ALWAYS_LOAD_TOOLS.includes(String(definition.name)))return definition;
  return {...definition,_meta:{...(definition._meta as object??{}),'anthropic/alwaysLoad':true}};
}
/** Git Bash paths (/d/x) and Windows paths name the same file. */
export function claudeFileKey(file:string,cwd:string,platform=process.platform):string{const resolved=claudeFilePath(file,cwd,platform);return platform==='win32'?resolved.toLowerCase():resolved;}
export function claudeFilePath(file:string,cwd:string,platform=process.platform):string{
  let value=String(file);
  if(platform==='win32'){const posix=/^\/([a-zA-Z])(?:\/(.*))?$/.exec(value);if(posix)value=posix[1]!.toUpperCase()+':\\'+(posix[2]??'').replaceAll('/','\\');}
  return platform==='win32'?path.win32.resolve(cwd,value):path.resolve(cwd,value);
}
type Seen={mtimeMs:number;size:number};
async function fileStamp(file:string):Promise<Seen|undefined>{try{const info=await stat(file);return info.isFile()?{mtimeMs:info.mtimeMs,size:info.size}:undefined;}catch{return undefined;}}
const filePath=(name:string,args:any)=>typeof args?.file_path==='string'?args.file_path:name==='NotebookEdit'&&typeof args?.notebook_path==='string'?args.notebook_path:undefined;

export async function withClaudeModelSurface(tools:ClaudeToolServer,options:ClaudeModelSurfaceOptions,presenters:Pick<ClaudeToolPresenters,'present'>=claudeToolPresenters):Promise<ClaudeToolServer>{
  const context=new LocalClaudeContext(options);
  let plan:LocalHookPlan;
  try{plan=localHookPlan(await context.settingsLayers());}
  catch(error){plan={hooks:[],unsupported:['Native settings could not be read for hooks: '+(error instanceof Error?error.message:'unknown')],disabled:false};}
  const seen=new Map<string,Seen>();
  const hookTarget=(name:string,args:any):{tool:string;input:any}=>name==='StartLocalCommand'?{tool:args?.shell==='PowerShell'?'PowerShell':'Bash',input:{command:args?.command,...(args?.description?{description:args.description}:{}),...(args?.timeout!==undefined?{timeout:args.timeout}:{}),run_in_background:true}}:{tool:OFFICIAL_HOOK_TOOLS.has(name)?name:'mcp__local_device__'+name,input:args};
  const runHooks=async(event:LocalHookEvent,tool:string,input:object,signal?:AbortSignal)=>{
    const matching=plan.hooks.filter(hook=>hook.event===event&&localHookMatches(hook.matcher,tool));
    const unique=[...new Map(matching.map(hook=>[hook.command,hook])).values()];
    if(!unique.length)return undefined;
    return localHookDecision(event,await Promise.all(unique.map(hook=>runLocalHook(hook,input,options.cwd,options.env,signal))));
  };
  const call=async(name:string,rawArgs:unknown,signal?:AbortSignal):Promise<unknown>=>{
    let args:any={...(rawArgs as object)};const notes:string[]=[];
    for(const key of ['file_path','notebook_path','path'])if(typeof args[key]==='string')args[key]=claudeFilePath(args[key],options.cwd);
    const target=filePath(name,args);
    if(target&&['Edit','Write','NotebookEdit'].includes(name)){
      const before=seen.get(claudeFileKey(target,options.cwd)),now=await fileStamp(claudeFilePath(target,options.cwd));
      if(before&&now&&(before.mtimeMs!==now.mtimeMs||before.size!==now.size))notes.push(STALE_EDIT_WARNING);
    }
    const hook=hookTarget(name,args),base={sessionId:options.sessionId,cwd:options.cwd,permissionMode:options.permission(),toolName:hook.tool};
    const pre=await runHooks('PreToolUse',hook.tool,localHookInput('PreToolUse',{...base,toolInput:hook.input}),signal);
    if(pre?.block)return errorResult(hook.tool+' operation blocked by hook:\n'+pre.block);
    if(pre?.updatedInput){
      args=name==='StartLocalCommand'?{...args,...Object.fromEntries(Object.entries(pre.updatedInput).filter(([key])=>['command','description','timeout'].includes(key)))}:{...args,...pre.updatedInput};
    }
    if(pre?.context.length)notes.push(...pre.context.map(text=>'PreToolUse hook context: '+text));
    const result:any=await tools.call(name,args,signal);
    if(!result?.isError&&target&&['Read','Edit','Write','NotebookEdit'].includes(name)){const stamp=await fileStamp(claudeFilePath(target,options.cwd));if(stamp)seen.set(claudeFileKey(target,options.cwd),stamp);}
    const event:LocalHookEvent=result?.isError?'PostToolUseFailure':'PostToolUse';
    const post=await runHooks(event,hook.tool,localHookInput(event,{...base,toolInput:hookTarget(name,args).input,toolResponse:claudeResultJson(result)??claudeResultText(result),error:result?.isError?claudeResultText(result):undefined}),signal);
    if(post?.block)notes.push(event+' hook feedback:\n'+post.block);
    if(post?.context.length)notes.push(...post.context.map(text=>event+' hook context: '+text));
    if(name==='LocalContext'&&(plan.hooks.length||plan.unsupported.length||plan.disabled))notes.push('Local hooks: '+(plan.disabled?'disabled by disableAllHooks.':plan.hooks.length+' command hook(s) run around local tool calls ('+[...new Set(plan.hooks.map(h=>h.event))].join(', ')+').')+(plan.unsupported.length?' Configured but not executed by the local bridge: '+plan.unsupported.join('; ')+'.':''));
    if(target){
      const catalog=await context.discover(path.dirname(claudeFilePath(target,options.cwd)));
      for(const rule of catalog.instructions.filter(entry=>entry.kind==='rule-read-paths-frontmatter-before-applying')){
        const body=await readFile(rule.path,'utf8'),globs=rulePaths(body);
        const normalized=rule.path.replaceAll('\\','/'),at=normalized.lastIndexOf('/.claude/rules/');
        if(at<0||!globs.length)continue;
        const relative=path.relative(normalized.slice(0,at),claudeFilePath(target,options.cwd)).replaceAll('\\','/');
        if(globs.some(glob=>path.matchesGlob(relative,glob)))notes.push('Applicable local rule ('+rule.path+'):\n'+body);
      }
    }
    const shown:any=presenters.present(name,args,result);
    if(!notes.length)return shown;
    return {...shown,content:[...(Array.isArray(shown?.content)?shown.content:[]),{type:'text',text:notes.join('\n\n')}]};
  };
  return {
    get definitions(){return tools.definitions.map(withAlwaysLoad);},
    listTools:async()=>(await tools.listTools?.()??tools.definitions).map(withAlwaysLoad),
    call,
    ...(tools.listPrompts?{listPrompts:()=>tools.listPrompts!()}:{}),
    ...(tools.getPrompt?{getPrompt:(name:string,args?:Record<string,string>)=>tools.getPrompt!(name,args)}:{}),
    close:async()=>{await Promise.all([context.close(),tools.close()]);}
  };
}
