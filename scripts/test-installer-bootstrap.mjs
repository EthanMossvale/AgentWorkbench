import {execFileSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
if(process.platform!=='win32')throw Error('Native bootstrap acceptance requires Windows.');
const output=path.resolve('build/qa/bootstrap-transfer');await mkdir(output,{recursive:true});
const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),probe=path.join(output,'probe.exe');
execFileSync(compiler,['/nologo','/target:exe','/main:BootstrapProbe','/codepage:65001','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:System.Net.Http.dll','/out:'+probe,path.resolve('scripts/installer/Bootstrap.cs'),path.resolve('tests/fixtures/bootstrap-transfer.cs')],{windowsHide:true,stdio:'pipe',encoding:'utf8'});
console.log(execFileSync(probe,[],{windowsHide:true,encoding:'utf8',timeout:30000}).trim());
