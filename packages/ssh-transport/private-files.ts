import {execFileSync} from 'node:child_process';
import {chmodSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {buildSshEnvironment} from './index';

/** Application-owned paths only. Never reads key bytes or changes an external identity. */
export function restrictPrivatePath(target:string,kind:'file'|'directory'){
 if(!path.isAbsolute(target))throw Error('SSH_PRIVATE_PATH_INVALID');
 const info=lstatSync(target);
 if(info.isSymbolicLink()||kind==='file'&&(!info.isFile()||info.nlink!==1)||kind==='directory'&&!info.isDirectory())throw Error('SSH_PRIVATE_PATH_INVALID');
 for(let parent=path.dirname(target);;parent=path.dirname(parent)){
  const stat=lstatSync(parent);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('SSH_PRIVATE_PATH_INVALID');
  if(parent===path.dirname(parent))break;
 }
 if(process.platform!=='win32'){chmodSync(target,kind==='file'?0o600:0o700);return;}
 const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
trap{[Console]::Error.WriteLine('AWB_ACL_ERROR '+$_.FullyQualifiedErrorId+': '+$_.Exception.Message);exit 1}
$target=$env:AWB_PRIVATE_PATH
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$item=Get-Item -LiteralPath $target -Force
if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'SSH_PRIVATE_PATH_INVALID'}
if($env:AWB_PRIVATE_KIND -eq 'directory'){
 $acl=New-Object Security.AccessControl.DirectorySecurity
 $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
}else{
 $acl=New-Object Security.AccessControl.FileSecurity
 $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
}
# Writing the owner needs WRITE_OWNER, which ssh-keygen's key ACL withholds from a non-elevated user.
# Only rewrite it when another principal owns the item; the owner may always replace the DACL.
if((Get-Acl -LiteralPath $target).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){$acl.SetOwner($sid)}
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule($rule)
$item.SetAccessControl($acl)
$saved=Get-Acl -LiteralPath $target
if(!$saved.AreAccessRulesProtected -or $saved.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'SSH_PRIVATE_ACL_UNCONFIRMED'}
$rules=$saved.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
if($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow'){throw 'SSH_PRIVATE_ACL_UNCONFIRMED'}
`;
 const env:NodeJS.ProcessEnv={...buildSshEnvironment(),AWB_PRIVATE_PATH:target,AWB_PRIVATE_KIND:kind};
 // Windows PowerShell must resolve its own modules, rather than a parent pwsh installation.
 for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
 // Cold PowerShell starts under antivirus scanning can exceed a few seconds on slower devices.
 try{execFileSync(path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:60000,stdio:'pipe',env});}
 catch(error){throw Error(`SSH_PRIVATE_PERMISSIONS_FAILED (${kind}): ${privateAclFailure(error)}`);}
}

/** Keeps the local failure reason visible; the script never prints key bytes. */
export function privateAclFailure(error:unknown){
 const e=error as NodeJS.ErrnoException&{signal?:string|null;status?:number|null;stderr?:Buffer|string};
 if(e?.code==='ETIMEDOUT'||e?.signal==='SIGTERM')return 'PowerShell did not finish within 60s (possibly held by security software).';
 if(e?.code&&e.code!=='ETIMEDOUT'&&typeof e.status!=='number')return `PowerShell could not start (${e.code}); security software or policy may block powershell.exe.`;
 const text=String(e?.stderr??'').replace(/\r/g,'');
 const line=text.split('\n').find(item=>item.startsWith('AWB_ACL_ERROR '))?.slice(14)??text.split('\n').map(item=>item.trim()).find(Boolean);
 return (line||`PowerShell exited with code ${e?.status??'unknown'}.`).slice(0,400);
}
