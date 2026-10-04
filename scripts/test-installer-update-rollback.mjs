import {build,Platform} from 'electron-builder';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const root=process.cwd(), out=path.join(root,'build/qa/update-failure-'+Date.now());await mkdir(out,{recursive:true});
const app=path.join(out,'app');await mkdir(path.join(app,'resources'),{recursive:true});
const guid=randomUUID(), name='AWBUpdateQA-'+guid.slice(0,8);
await writeFile(path.join(out,'App.cs'),'class App { static void Main() {} }');
execFileSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:winexe','/out:'+path.join(app,name+'.exe'),path.join(out,'App.cs')]);
await writeFile(path.join(app,'resources/app.asar'),'synthetic');
const install=path.join(out,'installed program'),report={guid,name,out,checks:[],packages:[]};await writeFile(path.join(out,'report.json'),JSON.stringify(report));
const old=await readFile('tests/fixtures/installer-paths-before-rollback.nsh','utf8');
for(const [version,fixed,failure] of [['0.0.1',false,''],['0.0.2',false,'missing'],['0.0.3',true,'missing'],['0.0.4',true,'quit'],['0.0.5',true,'abort'],['0.0.6',true,''],['0.0.7',true,'kill']]){
 if(version!=='0.0.1')execFileSync(report.packages[0],['/S','/D='+install],{windowsHide:true,windowsVerbatimArguments:true,timeout:60000});
 await writeFile(path.join(app,'version.txt'),version);await writeFile(path.join(app,'resources/app.asar'),'synthetic '+version);
 const include=path.join(out,version+'.nsh');let content=fixed?await readFile('scripts/installer/paths.nsh','utf8'):old;
 if(failure)content+='\n!macro customFiles_x64\n Delete "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"\n'+(failure==='quit'?' SetErrorLevel 2\n Quit\n':failure==='abort'?' Abort\n':failure==='kill'?" System::Call 'kernel32::TerminateProcess(p -1, i 9)'\n":'')+'!macroend\n';
 await writeFile(include,content);
 const files=await build({targets:Platform.WINDOWS.createTarget('nsis'),prepackaged:app,config:{extends:null,appId:'qa.'+guid,productName:name,electronVersion:'44.4.5',directories:{output:path.join(out,version)},extraMetadata:{name,version},win:{signAndEditExecutable:false},nsis:{guid,include,oneClick:false,allowToChangeInstallationDirectory:true,perMachine:false,allowElevation:false,createDesktopShortcut:false,createStartMenuShortcut:false,deleteAppDataOnUninstall:false,runAfterFinish:false},artifactName:'setup-${version}.exe',publish:null}});
 const exe=files.find(f=>f.endsWith('.exe'));report.packages.push(exe);let code=0;
 try{execFileSync(exe,['/S','--updated','/D='+install],{windowsHide:true,windowsVerbatimArguments:true,timeout:60000});}catch(e){code=e.status;}
 if(fixed)await delay(2500);
 const exists=await access(path.join(install,name+'.exe')).then(()=>true,()=>false),installed=await readFile(path.join(install,'version.txt'),'utf8').catch(()=>null);
 if(failure&&!fixed){assert.equal(exists,false);report.checks.push('baseline: missing executable after old version removed');}
 else if(failure){assert.equal(exists,true);assert.equal(installed,'0.0.1');assert.notEqual(code,0);report.checks.push('rollback '+failure);}
 else{assert.equal(exists,true);assert.equal(installed,version);assert.equal(code,0);report.checks.push('success '+version);}
 if(fixed){const expected=failure?'0.0.1':version;assert.equal(await readFile(path.join(install,'resources/app.asar'),'utf8'),'synthetic '+expected);const registry=execFileSync('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+guid,'/v','DisplayVersion'],{encoding:'utf8'});assert.ok(registry.includes(expected),registry);}
 console.log(JSON.stringify({version,code,exists,installed}));await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
execFileSync(path.join(install,'Uninstall '+name+'.exe'),['/S'],{windowsHide:true,timeout:60000});
console.log(JSON.stringify(report));
