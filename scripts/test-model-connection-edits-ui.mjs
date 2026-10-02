import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as buildHost } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { mkdir, writeFile, cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openWorkbenchSettings } from './ui-control-helpers.mjs';

const root=process.cwd(), output=path.resolve(process.env.AWB_CONNECTION_EDITS_QA??'build/qa/provider-repair-20261003/desktop');
const appRoot=path.join(output,'app'), data=path.join(output,'data-'+Date.now());
await mkdir(output,{recursive:true});
const checks=[], errors=[], requests=[];let app,page;
const server=createServer((req,res)=>{
 requests.push({url:req.url,method:req.method,key:req.headers.authorization??req.headers['x-api-key']});
 res.setHeader('content-type','application/json');
 if(req.method!=='GET'||!req.url.split('?')[0].endsWith('/models')){res.writeHead(422).end('{}');return;}
 res.end(JSON.stringify({data:[{id:'fixture-model'}]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-workspace-control',path.join(appRoot,'host/workspace-control'),{recursive:true});
await cp('services/vps-account-broker',path.join(appRoot,'host/account-runtime'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-connection-edit-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const record=name=>{checks.push(name);console.log('PASS '+name);};
const openSettings=async()=>{
 // Startup restores window geometry asynchronously, which can dismiss the menu.
 for(let attempt=0;attempt<3;attempt++){try{await openWorkbenchSettings(page,'models');return;}catch(error){if(attempt===2)throw error;}}
};
const launch=async()=>{
 app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>!!window.workbench);
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,900));
};
try{
 await launch();await openSettings();
 assert.deepEqual(await call('model-api/list'),[]);
 await page.getByTestId('model-api-add').click();
 await page.getByLabel('连接名称',{exact:true}).fill('合成连接');
 await page.getByLabel('API 地址',{exact:true}).fill(base);
 await page.getByLabel('API 密钥',{exact:true}).fill('synthetic-ui-only-key');
 await page.getByTestId('model-api-add-mapping').click();
 await page.getByLabel(/^上游模型 /).fill('fixture-model');
 await page.getByLabel(/^模型名称 /).fill('手填模型');
 await page.getByLabel(/^上下文上限 /).fill('1048576');
 await page.getByRole('button',{name:/^手动选择档位 /}).click();
 await page.getByRole('group',{name:/^手动思考档位 /}).getByRole('checkbox',{name:'xhigh',exact:true}).check();
 await page.getByRole('combobox',{name:/^默认思考档位 /}).selectOption('xhigh');
 await page.getByTestId('model-api-save').click();await page.getByRole('dialog').waitFor({state:'detached'});
 let saved=(await call('model-api/list'))[0];const id=saved.id,mapping=saved.models[0].id;
 assert.equal(saved.baseUrl,base);assert.equal(requests.at(-1).url,'/models');
 const verify=async()=>{
  const c=(await call('model-api/list'))[0];assert.equal(c.id,id);assert.equal(c.hasKey,true);
  assert.equal(c.models[0].id,mapping);assert.equal(c.models[0].name,'手填模型');
  assert.equal(c.models[0].contextWindow,1048576);assert.equal(c.models[0].defaultEffort,'xhigh');
  assert.deepEqual(c.models[0].manualEfforts,['medium','xhigh']);
  assert.doesNotMatch(JSON.stringify(await call('state/get')),/synthetic-ui-only-key/);return c;
 };
 await verify();record('fresh profile saves explicit URL, manual levels and encrypted key through real UI and host');
 for(const protocol of ['responses','anthropic-messages','chat-completions']){
  await page.getByTestId('model-api-'+id).getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('接口协议',{exact:true}).selectOption(protocol);
  await page.getByLabel('API 地址',{exact:true}).fill(base+'/custom');
  await page.getByRole('button',{name:'编辑映射 '+mapping}).click();
  assert.equal(await page.getByLabel('上下文上限 '+mapping,{exact:true}).inputValue(),'1048576');
  assert.equal(await page.getByLabel('默认思考档位 '+mapping,{exact:true}).inputValue(),'xhigh');
  assert.equal(await page.getByLabel('API 密钥',{exact:true}).inputValue(),'');
  await page.getByTestId('model-api-discover').click();await page.getByTestId('model-api-discover').filter({hasText:'刷新模型'}).waitFor();
  await page.getByTestId('model-api-save').click();await page.getByRole('dialog').waitFor({state:'detached'});
  saved=await verify();assert.equal(saved.protocol,protocol);assert.equal(saved.baseUrl,base+'/custom');
  assert.equal(requests.at(-1).url.split('?')[0],'/custom/models');
  assert.equal(requests.at(-1).key,protocol==='anthropic-messages'?'synthetic-ui-only-key':'Bearer synthetic-ui-only-key');
 }
 record('three protocol switches and URL edits preserve manual settings and reuse the key for actual directory requests');
 await app.close();app=undefined;await launch();saved=await verify();assert.equal(saved.baseUrl,base+'/custom');
 await call('model-api/refresh',{id:saved.id,revision:saved.revision});await verify();
 record('complete process exit and restart restore settings and decrypt the rebound key');
 await openSettings();await page.getByTestId('model-api-'+id).getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByRole('button',{name:'编辑映射 '+mapping}).click();
 for(const theme of ['light','dark']){await call('theme/set',{theme});await page.screenshot({path:path.join(output,'retained-'+theme+'.png')});}
 await page.getByRole('button',{name:'清除',exact:true}).click();
 await page.getByTestId('model-api-save').click();await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal((await call('model-api/list'))[0].hasKey,false);assert.equal(requests.at(-1).key,undefined);
 assert.ok(requests.every(r=>r.method==='GET'));assert.deepEqual(errors,[]);
 record('explicit key clearing works; all requests are catalog GETs and renderer errors are zero');
 await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors,requests:requests.map(({url,method,key})=>({url,method,authenticated:!!key})),realModelCalls:0},null,2));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,checks,errors,error:String(error)},null,2));throw error;}
finally{await app?.close();await new Promise(resolve=>server.close(resolve));}
