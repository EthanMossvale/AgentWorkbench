// Generate Electron's install metadata after verifying its extracted version.
// Normal installs are delegated to the official Electron installer unchanged.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
const root=path.resolve('node_modules/electron');
const {version}=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
const executable=process.platform==='win32'?'electron.exe':process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron';
const versionFile=path.join(root,'dist/version');
if(existsSync(versionFile)&&readFileSync(versionFile,'utf8').trim().replace(/^v/,'')===version&&existsSync(path.join(root,'dist',executable))){
  writeFileSync(path.join(root,'path.txt'),executable);console.log(`Electron ${version}: extracted runtime ready.`);
} else {
  const result=spawnSync(process.execPath,[path.join(root,'install.js')],{stdio:'inherit',timeout:150000});
  if(result.status===0)process.exitCode=0;
  else if(process.platform!=='win32')process.exitCode=result.status??1;
  else {
    // Official URL + npm-shipped checksum. This changes no proxy, TLS or system configuration.
    const artifact=`electron-v${version}-win32-${process.arch}.zip`;
    const checksums=JSON.parse(readFileSync(path.join(root,'checksums.json'),'utf8'));
    if(!checksums[artifact])throw new Error('No official checksum for this architecture.');
    const downloads=path.resolve('build/downloads');mkdirSync(downloads,{recursive:true});const archive=path.join(downloads,artifact);
    const verified=()=>existsSync(archive)&&createHash('sha256').update(readFileSync(archive)).digest('hex')===checksums[artifact];
    if(!verified()){
      console.log('Retrying the official Electron release with curl and checksum verification...');
      const download=spawnSync(path.join(process.env.SystemRoot??'C:\\Windows','System32/curl.exe'),['--fail','--location','--retry','2','--retry-delay','2','--connect-timeout','20','--max-time','180','--silent','--show-error','--output',archive,`https://github.com/electron/electron/releases/download/v${version}/${artifact}`],{stdio:'inherit',windowsHide:true});
      if(download.status!==0)throw new Error('Official runtime download failed; no system settings were changed.');
    }
    if(!verified())throw new Error('Electron archive checksum mismatch.');
    const require=createRequire(import.meta.url);await require('@electron-internal/extract-zip').extract(archive,{dir:path.join(root,'dist')});
    if(readFileSync(versionFile,'utf8').trim().replace(/^v/,'')!==version)throw new Error('Extracted runtime version mismatch.');
    writeFileSync(path.join(root,'path.txt'),executable);console.log(`Electron ${version}: verified official runtime ready.`);
  }
}
