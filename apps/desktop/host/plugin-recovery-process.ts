import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const execute=promisify(execFile);
export interface OwnedProcess {pid:number;parent:number;started:string}
const windowsShell=()=>path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const validPid=(id:number)=>Number.isSafeInteger(id)&&id>1;
/** Enumerate only the workbench descendant tree; the guardian subtree is excluded. */
export async function ownedProcessTree(parentPid:number,guardianPid:number):Promise<OwnedProcess[]>{
  if(!validPid(parentPid)||!validPid(guardianPid)||parentPid===guardianPid)throw Error('PLUGIN_PROCESS_ID_INVALID');
  if(process.platform==='win32'){
    const script=`$ErrorActionPreference='Stop'; $queue=[Collections.Generic.Queue[int]]::new(); $queue.Enqueue(${parentPid}); $seen=[Collections.Generic.HashSet[int]]::new(); $result=[Collections.Generic.List[object]]::new(); while($queue.Count){$current=$queue.Dequeue(); if($current -eq ${guardianPid} -or !$seen.Add($current)){continue}; $item=Get-CimInstance Win32_Process -Filter "ProcessId=$current"; if($item){$native=Get-Process -Id $current -ErrorAction SilentlyContinue; if($native){try{$started=$native.StartTime.ToUniversalTime().Ticks.ToString();$result.Add(@{pid=$current;parent=[int]$item.ParentProcessId;started=$started})}catch{if(!$native.HasExited){throw}}}}; foreach($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$current")){$queue.Enqueue([int]$child.ProcessId)}}; ConvertTo-Json -InputObject @($result.ToArray()) -Compress`;
    const {stdout}=await execute(windowsShell(),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:30000,maxBuffer:256*1024});
    const values=JSON.parse(stdout);if(!Array.isArray(values)||values.some(p=>!validPid(p.pid)||!/^\d+$/.test(p.started)))throw Error('PLUGIN_PROCESS_TREE_INVALID');return values;
  }
  const {stdout}=await execute('ps',['-axo','pid=,ppid=,lstart='],{timeout:5000,maxBuffer:2*1024*1024});
  const all=stdout.trim().split('\n').flatMap(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);return m?[{pid:Number(m[1]),parent:Number(m[2]),started:m[3]!}]:[];});
  const values:OwnedProcess[]=[];const visit=(pid:number)=>{if(pid===guardianPid||values.some(p=>p.pid===pid))return;const item=all.find(p=>p.pid===pid);if(item)values.push(item);for(const child of all.filter(p=>p.parent===pid))visit(child.pid);};visit(parentPid);return values;
}
/** Recheck process creation identity, then kill only this app's captured processes. */
export async function stopOwnedWorkbench(parentPid:number,guardianPid:number,parentStarted:string){
  const values=await ownedProcessTree(parentPid,guardianPid),parent=values.find(p=>p.pid===parentPid);
  if(parent&&parent.started!==parentStarted)throw Error('PLUGIN_PARENT_IDENTITY_CHANGED');
  if(process.platform==='win32'){
    // Numeric IDs and numeric start ticks are validated above; there are no user strings.
    const script=values.map(p=>`$p=Get-Process -Id ${p.pid} -ErrorAction SilentlyContinue; if($p){try{if(!$p.HasExited){if($p.StartTime.ToUniversalTime().Ticks.ToString() -ne '${p.started}'){throw 'PLUGIN_PROCESS_IDENTITY_CHANGED'}; $p.Kill(); [void]$p.WaitForExit(2000)}}catch{if(!$p.HasExited){throw}}}`).join('; ');
    // Get-Process -ErrorAction SilentlyContinue leaves $? false for an already
    // exited child; an explicit successful exit must follow the verified loop.
    if(script)await execute(windowsShell(),['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; ${script}; exit 0`],{windowsHide:true,timeout:30000,maxBuffer:1024});
  }else{
    for(const entry of values){const {stdout}=await execute('ps',['-p',String(entry.pid),'-o','lstart='],{timeout:3000}).catch(()=>({stdout:''}));if(!stdout.trim())continue;if(stdout.trim()!==entry.started)throw Error('PLUGIN_PROCESS_IDENTITY_CHANGED');process.kill(entry.pid,'SIGKILL');}
  }
}
