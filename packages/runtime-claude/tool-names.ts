/** Presentation only. Preserve the original MCP name in the native frame and toolName. */
export function claudeToolSemanticName(name:string){
  const prefix='mcp__local_device__',native=name.startsWith(prefix)?name.slice(prefix.length):name;
  if(['mcp__local_device__RunLocalSkillCommand','mcp__local_device__StartLocalCommand','mcp__local_device__StopLocalTask'].includes(name))return 'Bash';
  if(['mcp__local_device__LocalTaskOutput','mcp__local_device__ListLocalTasks'].includes(name))return 'TaskOutput';
  return name.startsWith(prefix)&&!['Read','Write','Edit','Glob','Grep','Bash','PowerShell','NotebookEdit','TaskOutput','TaskStop'].includes(native)?name:native;
}
