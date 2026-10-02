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
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $target -AclObject $acl
$saved=Get-Acl -LiteralPath $target
if(!$saved.AreAccessRulesProtected -or $saved.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'SSH_PRIVATE_ACL_UNCONFIRMED'}
$rules=$saved.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
if($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow'){throw 'SSH_PRIVATE_ACL_UNCONFIRMED'}
`;
 try{execFileSync(path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000,stdio:'pipe',env:{...buildSshEnvironment(),AWB_PRIVATE_PATH:target,AWB_PRIVATE_KIND:kind}});}
 catch{throw Error('SSH_PRIVATE_PERMISSIONS_FAILED');}
}
