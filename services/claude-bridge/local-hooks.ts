import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import type {ClaudeSettingsLayer} from './local-context';

/** Native settings `hooks` entries the local tool bridge executes around local tool calls. */
export const LOCAL_HOOK_EVENTS=['PreToolUse','PostToolUse','PostToolUseFailure'] as const;
export type LocalHookEvent=typeof LOCAL_HOOK_EVENTS[number];
export interface LocalHookCommand {event:LocalHookEvent;matcher:string;command:string;timeoutMs:number;source:string}
export interface LocalHookPlan {hooks:LocalHookCommand[];unsupported:string[];disabled:boolean}
export interface LocalHookRun {command:string;code:number|null;stdout:string;stderr:string;timedOut:boolean}
export interface LocalHookInput {sessionId:string;cwd:string;permissionMode:string;toolName:string;toolInput:unknown;toolUseId?:string;toolResponse?:unknown;error?:string}
export interface LocalHookDecision {block?:string;updatedInput?:Record<string,unknown>;context:string[]}

/** Collects command hooks in settings order. Other events and hook types are reported, not run. */
export function localHookPlan(layers:readonly ClaudeSettingsLayer[]):LocalHookPlan{
  const hooks:LocalHookCommand[]=[],unsupported=new Set<string>();let disabled=false;
  for(const layer of layers){
    if(layer.value?.disableAllHooks===true)disabled=true;
    const config=layer.value?.hooks;if(!config||typeof config!=='object')continue;
    for(const [event,groups] of Object.entries(config)){
      if(!Array.isArray(groups))continue;
      if(!(LOCAL_HOOK_EVENTS as readonly string[]).includes(event)){unsupported.add(event+' ('+layer.file+')');continue;}
      for(const group of groups as any[])for(const hook of Array.isArray(group?.hooks)?group.hooks:[]){
        if(hook?.type!=='command'||typeof hook.command!=='string'||!hook.command.trim()){unsupported.add(event+' '+String(hook?.type??'unknown')+' hook ('+layer.file+')');continue;}
        if(hook.async===true){unsupported.add(event+' async hook ('+layer.file+')');continue;}
        const seconds=Number(hook.timeout);
        hooks.push({event:event as LocalHookEvent,matcher:typeof group.matcher==='string'?group.matcher:'',command:hook.command,timeoutMs:Number.isFinite(seconds)&&seconds>0?seconds*1000:60000,source:layer.file});
      }
    }
  }
  return {hooks:disabled?[]:hooks,unsupported:[...unsupported],disabled};
}
/** Native matcher semantics: empty or `*` matches all, plain names and `|` lists match exactly, anything else is a regex. */
export function localHookMatches(matcher:string,tool:string):boolean{
  if(!matcher||matcher==='*')return true;
  if(/^[A-Za-z0-9_|]+$/.test(matcher))return matcher.split('|').includes(tool);
  try{return new RegExp('^(?:'+matcher+')$').test(tool);}catch{return false;}
}
export function localHookShell(env:NodeJS.ProcessEnv):{file:string;args:(command:string)=>string[]}{
  if(process.platform!=='win32')return {file:'/bin/sh',args:command=>['-c',command]};
  const candidates=[env.CLAUDE_CODE_GIT_BASH_PATH,path.join(env.ProgramFiles||'C:\\Program Files','Git','bin','bash.exe'),path.join(env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Git','bin','bash.exe'),env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs','Git','bin','bash.exe')];
  const bash=candidates.find(file=>file&&existsSync(file));
  return bash?{file:bash,args:command=>['-c',command]}:{file:env.ComSpec||'cmd.exe',args:command=>['/d','/s','/c',command]};
}
export function runLocalHook(hook:LocalHookCommand,input:object,cwd:string,env:NodeJS.ProcessEnv,signal?:AbortSignal):Promise<LocalHookRun>{
  const shell=localHookShell(env);
  return new Promise(resolve=>{
    let stdout='',stderr='',timedOut=false,done=false;
    const child=spawn(shell.file,shell.args(hook.command),{cwd,detached:process.platform!=='win32',env:{...env,CLAUDE_PROJECT_DIR:cwd},stdio:['pipe','pipe','pipe'],windowsHide:true});
    const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);resolve({command:hook.command,code,stdout,stderr,timedOut});};
    let stopping=false;
    const stop=()=>{
      if(stopping||done||!child.pid)return;stopping=true;
      if(process.platform==='win32'){
        const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        killer.on('error',()=>{try{child.kill();}catch{}});
      }else{try{process.kill(-child.pid,'SIGKILL');}catch{/* Owned group already exited. */}}
    };
    const timer=setTimeout(()=>{timedOut=true;stop();},hook.timeoutMs);
    signal?.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',error=>{stderr+=error.message;finish(null);});child.on('close',code=>finish(code));
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
    if(signal?.aborted)stop();
  });
}
function parsed(stdout:string):any{const text=stdout.trim();if(!text.startsWith('{'))return undefined;try{return JSON.parse(text);}catch{return undefined;}}
/** Interprets hook results the way native Claude Code does for PreToolUse and PostToolUse. */
export function localHookDecision(event:LocalHookEvent,runs:readonly LocalHookRun[]):LocalHookDecision{
  const decision:LocalHookDecision={context:[]};const blocks:string[]=[];
  for(const run of runs){
    const label='['+run.command+']';
    if(run.timedOut)continue;
    if(run.code===2){blocks.push(label+': '+(run.stderr.trim()||'No stderr output'));continue;}
    if(run.code!==0)continue;
    const output=parsed(run.stdout);if(!output)continue;
    const specific=output.hookSpecificOutput??{};
    if(output.continue===false)blocks.push(label+': '+(output.stopReason||'Hook requested stop'));
    if(event==='PreToolUse'){
      const choice=specific.permissionDecision??(output.decision==='block'?'deny':output.decision==='approve'?'allow':undefined),reason=specific.permissionDecisionReason??output.reason;
      if(choice==='deny')blocks.push(label+': '+(reason||'Denied by hook'));
      else if(choice==='ask')blocks.push(label+': User confirmation required'+(reason?' ('+reason+')':'')+'. Ask the user before retrying this call.');
      if(specific.updatedInput&&typeof specific.updatedInput==='object'&&!Array.isArray(specific.updatedInput))decision.updatedInput={...decision.updatedInput,...specific.updatedInput};
    }else if(output.decision==='block')blocks.push(label+': '+(output.reason||'Blocked by hook'));
    if(typeof specific.additionalContext==='string'&&specific.additionalContext)decision.context.push(specific.additionalContext);
  }
  if(blocks.length)decision.block=blocks.join('\n');
  return decision;
}
export function localHookInput(event:LocalHookEvent,input:LocalHookInput){
  return {session_id:input.sessionId,transcript_path:'',cwd:input.cwd,permission_mode:input.permissionMode,hook_event_name:event,tool_name:input.toolName,tool_input:input.toolInput,...(input.toolUseId?{tool_use_id:input.toolUseId}:{}),...(event==='PostToolUse'?{tool_response:input.toolResponse}:{}),...(event==='PostToolUseFailure'?{error:input.error}:{})};
}
