import {claudeSkillAdapters} from './skill-adapters';
import os from 'node:os';
import path from 'node:path';
import {lstat,readdir,realpath} from 'node:fs/promises';
import {digest,missing,optionalText,readJson,samePath,textFile} from '../../packages/native-resources/files';
import {claudePluginRoots} from '../../packages/native-skills/claude-plugins';
import {skillMetadata} from '../../packages/native-skills';
import type {ClaudeToolServer,ClaudeToolServerOptions} from './tools';
import {sanitizeWorkbenchMcpPayload} from './model-safety';

export interface LocalClaudeSkill {
  id:string;name:string;description:string;path:string;directory:string;hash:string;
  kind:'skill'|'command';modelInvocable:boolean;userInvocable:boolean;shellExecution:boolean;pluginRoot?:string;
}
export interface LocalClaudeCatalog {
  cwd:string;instructions:{path:string;kind:string}[];
  memory:{enabled:boolean;directory?:string;source:string;files:string[]};
  skills:LocalClaudeSkill[];warnings:string[];
}
export interface LocalClaudeSkillRequest {id:string;hash:string;arguments?:string;directory?:string}
export interface LocalClaudeSkillPlan {
  skill:LocalClaudeSkill;instructions:string;source?:string;
  execution:{location:'vps';context:string;agent?:string;model?:string;allowedTools?:string;nativeRequirements?:string[]};
  commands:{index:number;command:string;shell:'bash'|'powershell';completed:boolean}[];warnings:string[];
}
/** Session-scoped resource discovery. This is not a replacement auto-memory engine. */
export interface ClaudeLocalContext {
  discover(directory?:string):Promise<LocalClaudeCatalog>;
  loadSkill(request:LocalClaudeSkillRequest,userInvoked?:boolean):Promise<LocalClaudeSkillPlan>;
  runSkillCommand(request:LocalClaudeSkillRequest&{index:number;command:string},tools:ClaudeToolServer,signal?:AbortSignal):Promise<unknown>;
  close():Promise<void>;
}
const scalar=(front:string,key:string)=>{
  const match=new RegExp('^'+key+':\\s*([^\\n]*)','m').exec(front);if(!match)return undefined;
  const raw=match[1]!.trim().replace(/\s+#.*$/,'');
  if(raw.startsWith('"')){try{return String(JSON.parse(raw));}catch{throw Error('LOCAL_SKILL_METADATA_INVALID');}}
  return raw.startsWith("'")&&raw.endsWith("'")?raw.slice(1,-1).replaceAll("''","'"):raw;
};
function parts(markdown:string){const text=markdown.replace(/^\uFEFF/,'').replaceAll('\r\n','\n'),front=/^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);return {front:front?.[1]??'',body:front?text.slice(front[0].length):text};}
async function directories(cwd:string,home:string){const values:string[]=[];let at=path.resolve(cwd);for(;;){values.unshift(at);const parent=path.dirname(at);if(parent===at||samePath(at,home))break;at=parent;}return values;}
async function walk(root:string,accept:(file:string)=>boolean,skillTree=false){const files:string[]=[],seen=new Set<string>();const visit=async(dir:string)=>{
  let entries;try{const resolved=await realpath(dir),canonical=process.platform==='win32'?resolved.toLowerCase():resolved;if(seen.has(canonical))return;seen.add(canonical);entries=await readdir(dir,{withFileTypes:true});}catch(e){if(missing(e))return;throw e;}
  // Once a skill is found, its nested files belong to that skill's resources.
  if(skillTree&&entries.some(entry=>entry.name==='SKILL.md'&&entry.isFile())){files.push(path.join(dir,'SKILL.md'));return;}
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    const target=path.join(dir,entry.name);let directory=entry.isDirectory();if(entry.isSymbolicLink()){try{directory=(await lstat(await realpath(target))).isDirectory();}catch(e){if(missing(e))continue;throw e;}}
    if(directory&&(skillTree||!entry.name.startsWith('.')&&!['node_modules','backups','scripts','references','assets','synced'].includes(entry.name)))await visit(target);else if(entry.isFile()&&accept(target)){files.push(target);}}
};await visit(root);return files.sort();}
const toolText=(value:unknown)=>{const safe=sanitizeWorkbenchMcpPayload(value),text=JSON.stringify(safe);return {content:[{type:'text',text}],structuredContent:JSON.parse(text)};};

export class LocalClaudeContext implements ClaudeLocalContext {
  private closed=false;
  private commandOutputs=new Map<string,string>();
  private commandRuns=new Set<string>();
  private userInvocations=new Set<string>();
  constructor(private options:ClaudeToolServerOptions){}
  private alive(){if(this.closed)throw Error('LOCAL_CONTEXT_CLOSED');this.options.signal.throwIfAborted();}
  private get home(){return this.options.env.USERPROFILE||this.options.env.HOME||os.homedir();}
  private get claudeHome(){return this.options.env.CLAUDE_CONFIG_DIR||path.join(this.home,'.claude');}
  async discover(directory=this.options.cwd):Promise<LocalClaudeCatalog>{
    this.alive();if(!path.isAbsolute(directory))throw Error('LOCAL_CONTEXT_ABSOLUTE_PATH_REQUIRED');
    const dirs=await directories(directory,this.home),warnings:string[]=[],instructions:LocalClaudeCatalog['instructions']=[];
    const settings:{file:string;value:any;source:string}[]=[];
    const addSettings=async(file:string,source:string)=>{const value=await readJson<any>(file,{});if(!value||typeof value!=='object'||Array.isArray(value))throw Error('LOCAL_CONTEXT_SETTINGS_INVALID');settings.push({file,value,source});};
    await addSettings(path.join(this.claudeHome,'settings.json'),'user');
    for(const dir of dirs)for(const name of ['settings.json','settings.local.json'])await addSettings(path.join(dir,'.claude',name),'project');
    const managed=process.platform==='win32'?path.join(this.options.env.ProgramFiles||'C:\\Program Files','ClaudeCode'):process.platform==='darwin'?'/Library/Application Support/ClaudeCode':'/etc/claude-code';
    // Fixture homes remain isolated from real machine policy.
    if(samePath(this.home,os.homedir()))await addSettings(path.join(managed,'managed-settings.json'),'managed');
    const addInstruction=async(file:string,kind:string)=>{try{if((await lstat(file)).isFile()&&!instructions.some(i=>samePath(i.path,file)))instructions.push({path:file,kind});}catch(e){if(!missing(e))throw e;}};
    await addInstruction(path.join(this.claudeHome,'CLAUDE.md'),'user-instructions');
    if(samePath(this.home,os.homedir()))await addInstruction(path.join(managed,'CLAUDE.md'),'managed-instructions');
    for(const dir of dirs)for(const name of ['CLAUDE.md','.claude/CLAUDE.md','CLAUDE.local.md','AGENTS.md'])await addInstruction(path.join(dir,name),name==='AGENTS.md'?'project-agents-reference':'project-instructions');
    for(const root of [path.join(this.claudeHome,'rules'),...dirs.map(dir=>path.join(dir,'.claude','rules'))])for(const file of await walk(root,f=>f.endsWith('.md')))await addInstruction(file,'rule-read-paths-frontmatter-before-applying');
    let enabled=true,source='default',directorySource='default',memoryDirectory:string|undefined,blockOutside=false,disabled:unknown=this.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
    for(const layer of settings){const v=layer.value;if(v.autoMemoryEnabled!==undefined){if(typeof v.autoMemoryEnabled!=='boolean')throw Error('LOCAL_CONTEXT_SETTINGS_INVALID');enabled=v.autoMemoryEnabled;source=layer.source;}
      if(v.autoMemoryDirectory!==undefined){if(typeof v.autoMemoryDirectory!=='string')throw Error('LOCAL_CONTEXT_SETTINGS_INVALID');const target:string=v.autoMemoryDirectory.startsWith('~/')?path.join(this.home,v.autoMemoryDirectory.slice(2)):v.autoMemoryDirectory;if(!path.isAbsolute(target))throw Error('LOCAL_CONTEXT_MEMORY_PATH_INVALID');memoryDirectory=target;directorySource=layer.source;}
      if(v.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY!==undefined)disabled=v.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
      if(v.permissions?.blockReadsOutsideWorkingDirectories!==undefined)blockOutside=v.permissions.blockReadsOutsideWorkingDirectories===true;
    }
    if(['1','true'].includes(String(disabled).toLowerCase())){enabled=false;source='environment';}
    if(memoryDirectory&&directorySource==='project'&&blockOutside){memoryDirectory=undefined;enabled=false;warnings.push('Project auto-memory directory is blocked by native settings.');}
    if(!memoryDirectory){
      let project=path.resolve(this.options.cwd);
      for(const dir of [...await directories(this.options.cwd,this.home)].reverse()){
        const git=path.join(dir,'.git');try{const stat=await lstat(git);project=dir;
          if(stat.isFile()){const link=await textFile(git,4096),gitdir=/^gitdir:\s*(.+)\s*$/m.exec(link)?.[1];if(!gitdir)throw Error('LOCAL_CONTEXT_GIT_PATH_INVALID');const actual=path.resolve(dir,gitdir),common=await optionalText(path.join(actual,'commondir'),4096);if(common)project=path.dirname(path.resolve(actual,common.trim()));}
          break;
        }catch(e){if(!missing(e))throw e;project=path.resolve(this.options.cwd);}
      }
      const explicit=this.options.env.CLAUDE_CONFIG_DIR?this.options.env.CLAUDE_CODE_PROJECT_DIR_NAME:undefined;
      if(explicit&&(!/^[A-Za-z0-9_.-]{1,200}$/.test(explicit)||explicit==='.'||explicit==='..'))throw Error('LOCAL_CONTEXT_PROJECT_NAME_INVALID');
      const key=explicit||project.replace(/[^a-zA-Z0-9]/g,'-');
      if(key.length>200){warnings.push('Long native project keys require an explicit autoMemoryDirectory; no directory was guessed.');}
      else memoryDirectory=path.join(this.claudeHome,'projects',key,'memory');
    }
    const memory={enabled,directory:memoryDirectory,source,files:enabled&&memoryDirectory?await walk(memoryDirectory,f=>f.endsWith('.md')):[]};
    const skills:LocalClaudeSkill[]=[],names=new Set<string>();
    const skillDirs:string[]=[];for(const dir of [...dirs].reverse()){skillDirs.push(dir);try{await lstat(path.join(dir,'.git'));break;}catch(e){if(!missing(e))throw e;}}
    const roots=[...skillDirs.map(dir=>({root:path.join(dir,'.claude','skills'),kind:'skill' as const})),{root:path.join(this.claudeHome,'skills'),kind:'skill' as const},...skillDirs.map(dir=>({root:path.join(dir,'.claude','commands'),kind:'command' as const})),{root:path.join(this.claudeHome,'commands'),kind:'command' as const}];
    if(samePath(this.home,os.homedir()))roots.unshift({root:path.join(managed,'.claude','skills'),kind:'skill'});
    const plugins=await claudePluginRoots(this.claudeHome,dirs);
    const entries:[string,'skill'|'command',string?,string?][]=[];
    for(const root of roots)for(const file of await walk(root.root,f=>root.kind==='skill'?path.basename(f)==='SKILL.md':f.endsWith('.md'),root.kind==='skill'))entries.push([file,root.kind,root.kind==='command'?path.relative(root.root,file).slice(0,-3).split(path.sep).join(':'):undefined]);
    for(const plugin of plugins){let on=plugin.defaultEnabled!==false;for(const layer of settings){const state=layer.value.enabledPlugins?.[plugin.pluginId!];if(state!==undefined)on=state===true;}if(!on)continue;
      let pluginRoot:string|undefined;for(const at of [...await directories(plugin.root,this.home)].reverse()){try{if((await lstat(path.join(at,'.claude-plugin','plugin.json'))).isFile()){pluginRoot=await realpath(at);break;}}catch(e){if(!missing(e))throw e;}}
      for(const file of await walk(plugin.root,f=>path.basename(f)==='SKILL.md',true))entries.push([file,'skill',plugin.namespace+':',pluginRoot]);
    }
    for(const [file,kind,commandName,pluginRoot] of entries){
      const markdown=await textFile(file,Infinity),{front,body}=parts(markdown),metadata=kind==='skill'?skillMetadata(markdown,path.basename(path.dirname(file))):undefined;
      const nativeName=metadata?.name||path.basename(path.dirname(file)),name=kind==='command'?commandName!:commandName?(nativeName.startsWith(commandName)?nativeName:commandName+nativeName):nativeName;
      let visibility:string|undefined,shellExecution=true,denied=false;
      for(const layer of settings){const state=layer.value.skillOverrides?.[name];if(!commandName?.endsWith(':')&&state!==undefined)visibility=state;if(layer.value.disableSkillShellExecution!==undefined)shellExecution=layer.value.disableSkillShellExecution!==true;
        for(const rule of layer.value.permissions?.deny??[]){if(typeof rule!=='string')continue;const target=/^Skill\((?:skill:)?(.+)\)$/.exec(rule)?.[1];if(rule==='Skill'||target&&new RegExp('^'+target.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*')+'$').test(name))denied=true;}
      }
      if(visibility==='off'||denied||names.has(name)||!body.trim()||!commandName?.endsWith(':')&&/^anthropic-skills(?::|$)/i.test(name))continue;names.add(name);
      const modelInvocable=visibility==='user-invocable-only'?false:visibility?true:scalar(front,'disable-model-invocation')!=='true';
      const userInvocable=visibility?true:scalar(front,'user-invocable')!=='false';
      skills.push({id:digest(file).slice(0,24),name,description:visibility==='name-only'?'':metadata?.description||scalar(front,'description')||body.slice(0,400),path:file,directory:path.dirname(file),hash:digest(markdown),kind,modelInvocable,userInvocable,shellExecution,...(pluginRoot?{pluginRoot}:{})});
    }
    this.alive();return {cwd:directory,instructions,memory,skills,warnings};
  }
  private key(request:LocalClaudeSkillRequest,index:number){return digest(JSON.stringify([request.id,request.hash,request.arguments??'',request.directory??this.options.cwd,index]));}
  async loadSkill(request:LocalClaudeSkillRequest,userInvoked=false):Promise<LocalClaudeSkillPlan>{
    this.alive();if(typeof request?.id!=='string'||typeof request.hash!=='string'||request.arguments!==undefined&&typeof request.arguments!=='string')throw Error('LOCAL_SKILL_REQUEST_INVALID');
    const skill=(await this.discover(request.directory)).skills.find(s=>s.id===request.id);if(!skill||skill.hash!==request.hash)throw Error('LOCAL_SKILL_CHANGED_OR_UNAVAILABLE');
    const invocation=this.key(request,-1);
    if(userInvoked?!skill.userInvocable:!skill.modelInvocable&&!this.userInvocations.has(invocation))throw Error('LOCAL_SKILL_INVOCATION_DISABLED');
    if(userInvoked)this.userInvocations.add(invocation);
    const markdown=await textFile(skill.path,Infinity);if(digest(markdown)!==request.hash)throw Error('LOCAL_SKILL_CHANGED');
    const plan=await claudeSkillAdapters.load({skill,request,markdown,cwd:this.options.cwd,effort:this.options.env.CLAUDE_EFFORT},()=>this.compileSkill(skill,request,markdown));
    this.alive();return plan;
  }
  private async compileSkill(skill:LocalClaudeSkill,request:LocalClaudeSkillRequest,markdown:string):Promise<LocalClaudeSkillPlan>{
    const {front,body}=parts(markdown),warnings:string[]=[];
    const nativeRequirements:string[]=[];
    for(const key of ['hooks','disable-bypass-permissions-mode','isolation','effort','max-turns'])if(new RegExp('^'+key+':','m').test(front))nativeRequirements.push(key);
    if(scalar(front,'background')==='true')nativeRequirements.push('background');
    const args=request.arguments??'',argv=args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(v=>v.replace(/^(["'])(.*)\1$/,'$2'))??[];
    let names:string[]=[];const declared=scalar(front,'arguments');
    if(declared&&/^\[[A-Za-z0-9_, '\"-]*\]$/.test(declared))names=declared.slice(1,-1).split(',').map(s=>s.trim().replace(/^['\"]|['\"]$/g,'')).filter(Boolean);
    else if(/^arguments:[^\S\n]*$/m.test(front)){const block=/^arguments:[^\S\n]*\n((?:[ \t]+.*(?:\n|$))*)/m.exec(front)?.[1]??'';names=[...block.matchAll(/^\s+-\s+['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*$/gm)].map(m=>m[1]!);if(!names.length&&block.trim())nativeRequirements.push('arguments');}
    else if(declared)nativeRequirements.push('arguments');
    if(names.some(name=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))){nativeRequirements.push('arguments');names=[];}
    let received=false;
    const argumentPattern=new RegExp('(\\\\*)\\$(ARGUMENTS(?:\\[([0-9]+)\\]|\\b)|[0-9]+'+(names.length?'|(?:'+names.join('|')+')\\b':'')+')','g');
    let instructions=body.replace(argumentPattern,(all,slashes:string,token:string,_index:string)=>{
      if(slashes.length===1)return all.slice(1);
      if(token==='ARGUMENTS'){received=true;return slashes+args;}
      const position=/^ARGUMENTS\[(\d+)\]$/.exec(token)?.[1]??(/^\d+$/.test(token)?token:undefined);
      if(position!==undefined){const value=argv[Number(position)];if(value===undefined)return all;received=true;return slashes+value;}
      received=true;return slashes+(argv[names.indexOf(token)]??'');
    });
    if(args&&!received)instructions+='\n\nARGUMENTS: '+args;
    instructions=instructions.replace(/\$\{CLAUDE_SKILL_DIR\}/g,()=>skill.directory).replace(/\$\{CLAUDE_PROJECT_DIR\}/g,()=>this.options.cwd);
    if(skill.pluginRoot)instructions=instructions.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g,()=>skill.pluginRoot!);
    const effort=this.options.env.CLAUDE_EFFORT;
    if(effort!==undefined)instructions=instructions.replace(/\$\{CLAUDE_EFFORT\}/g,()=>effort);
    for(const match of instructions.matchAll(/\$\{CLAUDE_[A-Z_]+\}/g))nativeRequirements.push(match[0]);
    const declaredShell=scalar(front,'shell')||'bash',shell=declaredShell==='pwsh'?'powershell':declaredShell;
    if(!['bash','powershell'].includes(shell))nativeRequirements.push('shell:'+shell);
    const commands:LocalClaudeSkillPlan['commands']=[];
    instructions=instructions.replace(/^```![^\S\n]*\n([\s\S]*?)^```[^\S\n]*$|(?<!\S)!`([^`\r\n]+)`/gm,(_all,fenced:string,inline:string)=>{if(!['bash','powershell'].includes(shell))return _all;if(!skill.shellExecution)return '[shell command execution disabled by policy]';const command=fenced??inline,index=commands.length,key=this.key(request,index),output=this.commandOutputs.get(key);commands.push({index,command,shell:shell as 'bash'|'powershell',completed:output!==undefined});return output??`[Pending local command ${index}: run RunLocalSkillCommand with the exact command, then reload this skill.]`;});
    if(/^```!/m.test(instructions))nativeRequirements.push('dynamic-syntax');
    const context=scalar(front,'context')||'inline';if(!['inline','fork'].includes(context))nativeRequirements.push('context:'+context);
    const model=scalar(front,'model'),agent=scalar(front,'agent'),allowedTools=scalar(front,'allowed-tools');
    if(model&&model!=='inherit'&&context!=='fork')nativeRequirements.push('inline-model');
    if(allowedTools)warnings.push('allowed-tools is reference metadata, not a permission grant. Native VPS and local permission gates still apply.');
    if(context==='fork')warnings.push('Execute with the VPS native Agent tool, forwarding these instructions and local MCP tools. Never start a local model client.');
    if(nativeRequirements.length)warnings.push('This source requires native lifecycle or syntax support: '+[...new Set(nativeRequirements)].join(', ')+'. The full original source is returned. These declarations have not executed; do not silently omit them or claim this is a completed skill invocation.');
    this.alive();return {skill,instructions,source:markdown,execution:{location:'vps',context,agent,model,allowedTools,...(nativeRequirements.length?{nativeRequirements:[...new Set(nativeRequirements)]}:{})},commands,warnings};
  }
  async runSkillCommand(request:LocalClaudeSkillRequest&{index:number;command:string},tools:ClaudeToolServer,signal?:AbortSignal){
    const plan=await this.loadSkill(request),command=plan.commands.find(c=>c.index===request.index);
    if(!command||request.command!==command.command)throw Error('LOCAL_SKILL_COMMAND_MISMATCH');
    const key=this.key(request,request.index);if(this.commandRuns.has(key))throw Error('LOCAL_SKILL_COMMAND_ALREADY_ATTEMPTED');
    this.commandRuns.add(key);
    // The explicit tool call goes through the same VPS approval and local mutation gate.
    const result:any=await tools.call(command.shell==='powershell'?'PowerShell':'Bash',{command:command.command,description:'Run the requested local skill command'},signal);
    this.alive();if(result?.isError)return result;
    const output=Array.isArray(result?.content)?result.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n'):'';
    let native:any;try{native=JSON.parse(output);}catch{/* Official versions may return plain text. */}
    if(native?.interrupted||native?.exitCode&&native.exitCode!==0||native?.exit_code&&native.exit_code!==0)return {...result,isError:true};
    this.commandOutputs.set(key,output);return result;
  }
  async close(){this.closed=true;this.commandOutputs.clear();this.commandRuns.clear();this.userInvocations.clear();}
}

export function withClaudeLocalContext(tools:ClaudeToolServer,context:ClaudeLocalContext):ClaudeToolServer {
  const skillProperties={id:{type:'string'},hash:{type:'string'},arguments:{type:'string'},directory:{type:'string',description:'The LocalContext discovery directory, when discovering nested project skills.'}};
  const definitions=[...tools.definitions,
    {name:'LocalContext',description:'Discover actual Claude instruction files, scoped native memory paths, installed skills and legacy commands. Read relevant files with Read. Respect disabled memory, rule paths and project scope. Discovery runs no scripts and no models. Refresh after file/config changes.',inputSchema:{type:'object',properties:{directory:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:true}},
    {name:'LoadLocalSkill',description:'Load full project skill instructions by catalog id and hash. Supporting files remain at their actual project paths. Inline commands require separate RunLocalSkillCommand approval; reload after completion. Fork/model metadata runs only through the native VPS Agent. This is a workbench resource loader, not native Skill.',inputSchema:{type:'object',properties:skillProperties,required:['id','hash'],additionalProperties:false},annotations:{readOnlyHint:true}},
    {name:'RunLocalSkillCommand',description:'Execute the exact dynamic command shown by LoadLocalSkill using the official Bash or PowerShell tool selected by the skill. This may modify files. No automatic retries; failures or unknown results remain unconfirmed. No model sampling is performed by this adapter.',inputSchema:{type:'object',properties:{...skillProperties,index:{type:'integer',minimum:0},command:{type:'string'}},required:['id','hash','index','command'],additionalProperties:false},annotations:{readOnlyHint:false}}
  ];
  const extraDefinitions=definitions.slice(tools.definitions.length);
  const loadPrompt=async(name:string,args:Record<string,string>={})=>{const catalog=await context.discover(),skill=catalog.skills.find(s=>'skill_'+s.id===name);if(!skill)throw Error('LOCAL_SKILL_UNAVAILABLE');const plan=sanitizeWorkbenchMcpPayload(await context.loadSkill({id:skill.id,hash:skill.hash,arguments:args.arguments},true));return {description:skill.description,messages:[{role:'user',content:{type:'text',text:JSON.stringify(plan)}}]};};
  let closing:Promise<void>|undefined;
  return {get definitions(){return [...tools.definitions,...extraDefinitions];},listTools:async()=>[...await tools.listTools?.()??tools.definitions,...extraDefinitions],
    call:async(name,args:any,signal)=>{signal?.throwIfAborted();if(name==='LocalContext'){const catalog=await context.discover(args?.directory);return toolText({...catalog,skills:catalog.skills.filter(s=>s.modelInvocable)});}if(name==='LoadLocalSkill')return toolText(await context.loadSkill(args));if(name==='RunLocalSkillCommand')return context.runSkillCommand(args,tools,signal);return tools.call(name,args,signal);},
    listPrompts:async()=>({prompts:(await context.discover()).skills.filter(s=>s.userInvocable).map(s=>({name:'skill_'+s.id,title:s.name,description:s.description,arguments:[{name:'arguments',description:'Arguments passed to the local skill',required:false}]}))}),
    getPrompt:loadPrompt,
    close:()=>closing??=(async()=>{const results=await Promise.allSettled([context.close(),tools.close()]);if(results.some(r=>r.status==='rejected'))throw Error('CLAUDE_LOCAL_CONTEXT_CLEANUP_UNCONFIRMED');})()
  };
}
