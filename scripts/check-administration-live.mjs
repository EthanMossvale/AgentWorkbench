// Explicit read-only acceptance against a supplied public SSH descriptor.
// Never applies a workspace plan, redeems credits, starts a model, or changes selections.
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {navigateWorkbench} from './ui-control-helpers.mjs';
const host=JSON.parse(await readFile(process.argv[2],'utf8'));
const directory=await mkdtemp(path.join(os.tmpdir(),'awb-admin-live-readonly-')),output=path.resolve('build/qa/administration-live');await mkdir(output,{recursive:true});
let app;const report={observedAt:new Date().toISOString(),modelTurns:0,workspaceMutations:0,cardRedemptions:0};
try{
 app=await electron.launch({executablePath:electronPath,args:[process.cwd()],cwd:process.cwd(),env:{...process.env,AGENT_WORKBENCH_TEST_DATA:directory,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.workbench);
 const saved=await page.evaluate(host=>window.workbench.call('host/save',{host}),host);
 const snapshot=await page.evaluate(id=>window.workbench.call('studio/list',{id}),saved.id);assert.equal(snapshot.availability,'ready');report.management={availability:snapshot.availability,transport:snapshot.transport,managedCount:snapshot.workspaces.length};
 const catalog=await page.evaluate(id=>window.workbench.call('accounts/list',{id}),saved.id);assert.equal(catalog.availability,'ready');report.accountCount=catalog.accounts.length;
 await navigateWorkbench(page,'connections');await page.getByTestId('studio-refresh').click();await page.waitForFunction(()=>document.querySelector('[data-testid="studio-refresh"]')?.textContent==='刷新列表',{},{timeout:60000});
 report.discoveredCount=await page.locator('[data-testid^="studio-adopt-"]').count();await page.screenshot({path:path.join(output,'real-workspaces-readonly.png')});
 await page.getByTestId('connection-tab-accounts').click();await page.getByTestId('usage-refresh').click();await page.waitForFunction(()=>document.querySelector('[data-testid="usage-refresh"]')?.textContent==='刷新额度',{},{timeout:90000});
 const text=await page.getByTestId('account-usage').innerText();assert.ok(!text.includes('暂时无法读取'));report.quotaVisible=true;report.cardRows=await page.locator('.reset-card-row').count();
 await page.getByTestId('account-usage').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'real-quota-cards-readonly.png')});
 report.pass=true;
}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
