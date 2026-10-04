import {readFile,writeFile,mkdir,mkdtemp,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

if(process.platform!=='win32')throw Error('Windows NSIS path acceptance requires Windows.');
const root=process.cwd(),cache=process.env.ELECTRON_BUILDER_CACHE??path.join(process.env.LOCALAPPDATA,'electron-builder/Cache');
const find=async(prefix,leaf)=>{
 for(const name of await readdir(cache)){if(!name.startsWith(prefix))continue;const base=path.join(cache,name);
  for(const dir of [base,...(await readdir(base,{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>path.join(base,x.name))]){try{await access(path.join(dir,leaf));return dir;}catch{}}
 }throw Error('Run the Windows package build to provision NSIS tools first.');
};
const nsis=process.env.AWB_NSIS_ROOT??await find('nsis-3.','Bin/makensis.exe');
const resources=await find('nsis-resources-','plugins/x86-unicode/StdUtils.dll');
const base=path.join(root,'build/qa/installer-paths');await mkdir(base,{recursive:true});const output=await mkdtemp(path.join(base,'run-'));
const quote=value=>'"'+value.replaceAll('$','$$').replaceAll('"','$\"')+'"';
const registry=String.raw`Software\AgentWorkbench-Installer-QA-`+randomUUID();
const dollar='$';
const source=String.raw`Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile ${quote(path.join(output,'probe.exe'))}
!addincludedir ${quote(path.join(root,'node_modules/app-builder-lib/templates/nsis/include'))}
!addincludedir ${quote(path.join(root,'node_modules/app-builder-lib/templates/nsis'))}
!addplugindir /x86-unicode ${quote(path.join(resources,'plugins/x86-unicode'))}
!include LogicLib.nsh
!include StdUtils.nsh
!define APP_GUID "fixture"
!define APP_FILENAME "AgentWorkbench"
!define INSTALL_REGISTRY_KEY ${quote(registry)}
!define UNINSTALL_REGISTRY_KEY ${quote(registry+'-uninstall')}
!define APP_EXECUTABLE_FILENAME "fixture.exe"
!define UNINSTALL_FILENAME "Uninstall fixture.exe"
!define PROJECT_DIR ${quote(root)}
!include ${quote(path.join(root,'node_modules/app-builder-lib/templates/nsis/multiUser.nsh'))}
!include ${quote(path.join(root,'scripts/installer/paths.nsh'))}
!insertmacro customHeader
Function .onInit
 SetRegView 64
 DeleteRegKey HKCU "${dollar}{INSTALL_REGISTRY_KEY}"
 ReadEnvStr $R4 AWB_TEST_INSTALL_CASE
 StrCpy $installMode "CurrentUser"
 StrCpy $INSTDIR "$LOCALAPPDATA\Programs\AgentWorkbench"
 ${dollar}{If} $R4 == "existing"
 ${dollar}{OrIf} $R4 == "existing-explicit"
   WriteRegStr HKCU "${dollar}{INSTALL_REGISTRY_KEY}" InstallLocation "$EXEDIR\existing program"
   StrCpy $INSTDIR "$EXEDIR\existing program"
 ${dollar}{EndIf}
 !insertmacro GetDParameter $R0
 ${dollar}{If} $R0 != ""
   StrCpy $INSTDIR $R0
 ${dollar}{EndIf}
 !insertmacro customInit
 FileOpen $R2 "$EXEDIR\$R4.txt" w
 FileWrite $R2 $INSTDIR
 FileClose $R2
 DeleteRegKey HKCU "${dollar}{INSTALL_REGISTRY_KEY}"
 SetErrorLevel 0
 Quit
FunctionEnd
Section
SectionEnd
`;
await writeFile(path.join(output,'probe.nsi'),source);
execFileSync(path.join(nsis,'Bin/makensis.exe'),['/V2',path.join(output,'probe.nsi')],{env:{...process.env,NSISDIR:nsis},windowsHide:true,stdio:'pipe'});
const explicit=path.join(output,'explicit program');
for(const scenario of ['fresh','existing','explicit','existing-explicit']){
 execFileSync(path.join(output,'probe.exe'),['/S',...(scenario.includes('explicit')?['/D='+explicit]:[])],{env:{...process.env,AWB_TEST_INSTALL_CASE:scenario},windowsHide:true,windowsVerbatimArguments:true,timeout:15000});
 const actual=await readFile(path.join(output,scenario+'.txt'),'utf8');
 const expected=scenario.includes('explicit')?explicit:scenario==='existing'?path.join(output,'existing program'):path.join(process.env.LOCALAPPDATA,'AgentWorkbenchApp');
 assert.equal(actual,expected,scenario);console.log('PASS NSIS '+scenario);
}
console.log('Native NSIS macro acceptance passed; no application/profile was installed or removed.');
