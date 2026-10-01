import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Real isolated Chrome, synthetic loopback page; never the user's profile.
// Input is the JSON chrome_arguments() output produced by Linux Python.
const executable=process.env.AWB_QA_CHROME,output=process.env.AWB_QA_OUTPUT,input=process.env.AWB_QA_CHROME_ARGS;
if(!executable||!output||!input)throw Error('Explicit browser, output and production argument fixture are required.');
await access(executable);await mkdir(output,{recursive:true});
const production=JSON.parse(await readFile(input,'utf8'));
const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Authorization fixture</title><h1>First page ready</h1><p>Loopback fixture. No account or authorization.</p>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/authorization-fixture';
const records=[];
async function run(name,initial,second=false){
 const directory=await mkdtemp(path.join(output,name+'-'));
 const args=production.slice(1,-1).map(arg=>arg.startsWith('--user-data-dir=')?'--user-data-dir='+directory:arg.startsWith('--profile-directory=')?'--profile-directory=Fixture':arg);
 args.push('--headless=new','--remote-debugging-port=0','--disable-background-networking','--disable-component-update','--disable-sync','--no-proxy-server','--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost, EXCLUDE 127.0.0.1',initial);
 const child=spawn(executable,args,{windowsHide:true,stdio:'ignore'});let browser;
 try{
  let port;
  for(let n=0;n<200;n++){
   try{port=Number((await readFile(path.join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
   if(child.exitCode!==null)throw Error('Isolated browser exited before ready: '+child.exitCode);
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.ok(port,'DevTools endpoint in the disposable profile');
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);const context=browser.contexts()[0];
  for(let n=0;n<100&&!context.pages().length;n++)await new Promise(resolve=>setTimeout(resolve,30));
  const first=context.pages()[0];assert.ok(first);await first.waitForLoadState('domcontentloaded');
  const before=context.pages().map(page=>page.url());
  if(second){
   // A native new page works while the explicitly blank first tab stays blank.
   // This does not claim Linux singleton command-line delivery or VNC focus.
   const next=await context.newPage();await next.goto(url);assert.equal(await next.locator('h1').innerText(),'First page ready');
   assert.equal(first.url(),'about:blank');assert.ok(context.pages().some(page=>page.url()===url));
  }else if(initial===url){assert.equal(context.pages().length,1);assert.equal(first.url(),url);assert.equal(await first.locator('h1').innerText(),'First page ready');}
  else {assert.equal(context.pages().length,1);assert.ok(first.url().startsWith('chrome://newtab')||first.url().startsWith('chrome://new-tab-page'));assert.notEqual(first.url(),'about:blank');}
  await first.screenshot({path:path.join(output,name+'.png')});
  records.push({name,initial,before,after:context.pages().map(page=>page.url()),version:browser.version()});console.log('PASS '+name);
 }finally{
  if(browser){const session=await browser.newBrowserCDPSession().catch(()=>null);if(session)await session.send('Browser.close').catch(()=>{});await browser.close().catch(()=>{});}
  if(child.exitCode===null){await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill();}
 }
}
try{
 await run('old-first-tab-and-manual-new-tab','about:blank',true);
 assert.equal(production.at(-1),'chrome://newtab/');await run('manual-first-page',production.at(-1));
 await run('login-first-page',url);
}finally{
 await new Promise(resolve=>server.close(resolve));
 await writeFile(path.join(output,'report.json'),JSON.stringify({records,boundary:'Actual Chrome in headless disposable profiles; production launch flags with platform and loopback fixture adaptations. No remote desktop or real login acceptance.'},null,2));
}
