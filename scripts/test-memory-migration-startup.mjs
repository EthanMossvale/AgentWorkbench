import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build} from 'esbuild';
import {mkdtemp,mkdir,writeFile,readFile,rename,rmdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {NativeMemoryService} from '../packages/native-memory/index.ts';
import {digest} from '../packages/native-resources/files.ts';
import {openWorkbenchSettings} from './ui-control-helpers.mjs';

const appRoot=path.resolve(process.env.AGENT_WORKBENCH_TEST_APP??process.cwd());
const output=path.resolve(process.env.AWB_MEMORY_MIGRATION_QA??'build/qa/memory-migration-startup');
await mkdir(output,{recursive:true});
const fixture=await mkdtemp(path.join(output,'synthetic-')),home=path.join(fixture,'home'),legacy=path.join(fixture,'legacy-profile'),data=path.join(home,'.agentworkbench'),nativeHome=path.join(data,'native-home'),temp=path.join(fixture,'temp');
await mkdir(temp);await mkdir(nativeHome,{recursive:true});
const put=async(file,text)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};
const manifest=task=>JSON.parse(task.slice(task.lastIndexOf('\n{')+1,task.lastIndexOf('\n</agent-workbench-memory-handoff>')));
const source=path.join(nativeHome,'.codex','memories','MEMORY.md'),target=path.join(nativeHome,'.claude','projects','fixture','memory');
const service=new NativeMemoryService(legacy,{home:nativeHome,codexHome:path.join(nativeHome,'.codex'),claudeHome:path.join(nativeHome,'.claude'),intervalMs:60000});
try{
  await service.initialize();await put(source,'# Fixture knowledge\nKeep the original scope.');await service.configure({enabled:true,initialSources:'codex'});
  const session=service.session('claude','fixture-received'),batch=manifest(await session.prepare('Explicit fixture task','fixture-received-submission')),entry=batch.entries[0];
  const marked=text=>`${entry.startMarker}\n${text}\n${entry.endMarker}`,topic=path.join(target,'topic.md'),index=path.join(target,'MEMORY.md');
  await put(topic,marked(`[${entry.scope}] Keep the original scope.`));await put(index,marked(`[${entry.scope}](topic.md)`));
  const proof=async file=>({path:file,sha256:digest(await readFile(file,'utf8'))});
  await put(batch.receiptFile,JSON.stringify({deliveryId:batch.deliveryId,token:batch.token,recipientRuntime:'claude',entries:[{archiveId:entry.archiveId,revision:entry.revision,scope:entry.scope,disposition:'stored',files:[await proof(topic)],index:await proof(index)}]}));
  await session.finish();assert.equal((await service.status()).acknowledgedCount,1);
  await put(source,'# Fixture knowledge\nKeep the original scope.\nA later pending revision.');await service.sync();await service.session('claude','fixture-pending').prepare('Another explicit fixture task','fixture-pending-submission');
}finally{await service.dispose();}
const before=JSON.parse(await readFile(path.join(legacy,'memory-exchange','ledger.json'),'utf8'));assert.equal(before.deliveries.length,2);
// Carry the synthetic native home through the move while keeping its recorded paths stable.
await rename(nativeHome,path.join(legacy,'native-home'));await rmdir(data);
await build({entryPoints:['packages/app-data/index.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(fixture,'migration.cjs')});
await writeFile(path.join(fixture,'main.cjs'),`const {app,dialog}=require('electron');const {initializeAppData}=require('./migration.cjs');app.setPath('home',${JSON.stringify(home)});app.setPath('temp',${JSON.stringify(temp)});app.setPath('userData',${JSON.stringify(legacy)});dialog.showErrorBox=(title,message)=>console.log('STARTUP_FAILURE '+JSON.stringify({title,message}));try{const location=initializeAppData(app);if(!location)throw Error('Synthetic singleton was not acquired.');app.releaseSingleInstanceLock();process.env.AGENT_WORKBENCH_TEST_DATA=location.directory;process.env.AGENT_WORKBENCH_TEST_HIDDEN='1';require(${JSON.stringify(path.join(appRoot,'dist','host','main.cjs'))});}catch(error){console.log('STARTUP_FAILURE '+JSON.stringify({message:error.message}));app.quit();}`);
const env={...process.env,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:path.join(fixture,'missing-codex.exe'),AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:path.join(fixture,'missing-claude.exe')};
delete env.ELECTRON_RUN_AS_NODE;delete env.AGENT_WORKBENCH_TEST_DATA;
const checks=[],errors=[];let app,page,passed=false;
const pass=name=>{checks.push(name);console.log('PASS '+name);};
try{
  for(let attempt=0;attempt<2;attempt++){
    app=await electron.launch({executablePath:electronPath,args:[path.join(fixture,'main.cjs')],cwd:appRoot,env,timeout:45000});
    app.process().stdout.on('data',data=>{if(String(data).includes('STARTUP_FAILURE'))errors.push(String(data));});
    page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByTestId('composer-input').waitFor({timeout:45000});
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    const status=await page.evaluate(()=>window.workbench.call('native-memory/get',{}));
    assert.equal(status.acknowledgedCount,1);assert.equal(status.pendingClaude,1);assert.equal(status.activeClaude,0);assert.equal(status.handoffError,undefined);
    const current=JSON.parse(await readFile(path.join(data,'memory-exchange','ledger.json'),'utf8'));
    assert.deepEqual(current.events,before.events);assert.deepEqual(current.deliveries,before.deliveries.map(d=>({...d,receipt:path.join(data,'memory-exchange','receipts',`${d.id}.json`)})));
    assert.equal((await page.evaluate(()=>window.workbench.call('state/get',{}))).sessions.length,0);
    pass(attempt?'full desktop restarts with received and pending memory history intact':'full desktop boots after real Electron migration with received and pending deliveries');
    await openWorkbenchSettings(page,'memory');await page.getByTestId('settings-layout').waitFor();
    const catalog=await page.evaluate(()=>window.workbench.call('native-memory/catalog',{}));assert.equal(catalog.archives.filter(a=>a.status==='received').length,1);assert.equal(catalog.archives.filter(a=>a.status==='pending').length,1);
    if(!attempt)await page.screenshot({path:path.join(output,'migrated-memory-settings.png')});
    await app.close();app=undefined;
  }
  assert.deepEqual(errors,[]);pass('memory settings read migrated history without renderer errors or new model tasks');passed=true;
}finally{
  if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors},null,2));
}
