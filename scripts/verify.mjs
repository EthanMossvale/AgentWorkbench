import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync,existsSync } from 'node:fs';
import path from 'node:path';
const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
if(!existsSync(npmCli))throw new Error('Run verification with the Node installation that provides npm.');
mkdirSync('build/verification',{recursive:true});
const checks=[];
for(const [name,args] of [['docs',['run','check:docs']],['plugins',['run','check:plugins']],['ui-preferences',['run','check:ui-preferences']],['tests',['test']],['build',['run','build']],['desktop',['run','test:desktop']],['dependency-audit',['audit','--json']]]){
  const started=Date.now();const result=spawnSync(process.execPath,[npmCli,...args],{cwd:process.cwd(),encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,timeout:180000});
  const output=(result.stdout??'')+(result.stderr??'');
  const passed=result.status===0;checks.push({name,passed,exitCode:result.status,elapsedMs:Date.now()-started});
  writeFileSync(path.join('build/verification',name+'.txt'),output);
  console.log(`${passed?'PASS':'FAIL'} ${name} (${Date.now()-started} ms)`);
  if(!passed){console.error(output);break;}
}
const result={timestamp:new Date().toISOString(),node:process.version,checks,scope:'Local code, synthetic protocols and desktop QA only; no real translation/model/SSH requests.'};
writeFileSync('build/verification/summary.json',JSON.stringify(result,null,2));
if(checks.length!==7||checks.some(c=>!c.passed))process.exitCode=1;
