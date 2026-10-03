// Offline audit-tool verification; never launches the workbench or a user browser profile.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {extractTypescript} from './audit-defensive-designs.mjs';

const fixture=extractTypescript('fixture.tsx',`function f(a:boolean,b:boolean){
 if(a || b) throw Error('REFUSED');
 try { return a ?? b; } catch(e) { return false; }
}
const control=<button disabled={busy}>Run</button>;`);
assert.equal(fixture.diagnostics.length,0);
assert.equal(fixture.records.filter(r=>r.kind==='condition-part').length,2);
assert(fixture.records.some(r=>r.kind==='ui-constraint'&&r.condition==='{busy}'));
assert(fixture.records.some(r=>r.kind==='catch'));
assert(fixture.records.find(r=>r.kind==='throw').enclosingConditions.includes('THEN: a || b'));
const python=spawnSync('python',['-X','utf8','-c',`
import importlib.util
s=importlib.util.spec_from_file_location('audit','scripts/audit-defensive-designs.py')
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
rows=m.extract_python('fixture.py','def f(a,b):\\n if a or b:\\n  raise ValueError("REFUSED")\\n try:\\n  return a\\n except Exception:\\n  return None\\n')
assert sum(r['kind']=='condition-part' for r in rows)==2
assert any(r['kind']=='catch' for r in rows)
assert any(r['kind']=='throw' and r['enclosingConditions'] for r in rows)
`],{encoding:'utf8'});
assert.equal(python.status,0,python.stderr);

const directory=path.resolve(process.argv[2]??'build/qa/defensive-audit-expanded');
const ledger=JSON.parse(readFileSync(path.join(directory,'ledger.json'),'utf8'));
assert.equal(ledger.summary.parseErrors.length,0);
assert.equal(ledger.summary.changedSinceScan.length,0);
assert.deepEqual(ledger.summary.unresolvedReviews,[]);
const reviews=JSON.parse(readFileSync('scripts/defensive-design-reviews.json','utf8'));
const linked=new Set(ledger.records.flatMap(r=>r.prior));
for(const review of reviews)assert(linked.has(review.id),`Unlinked review: ${review.id}`);
const ids=new Set(ledger.records.map(r=>r.id));
assert.equal(ids.size,ledger.records.length);
for(const r of ledger.records.filter(r=>r.kind==='condition-part'))assert(ids.has(r.parent),`Missing parent: ${r.id}`);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(directory,'review.html')).href,{timeout:60000});
 await page.locator('.card').first().waitFor();
 assert.equal(await page.locator('.card').count(),30);
 assert.match(await page.locator('#page').innerText(),new RegExp(ledger.summary.productLayers.action.toLocaleString('en-US')));
 await page.locator('#next').click();
 assert.match(await page.locator('#page').innerText(),/第 2\//);
 await page.locator('#scope').selectOption('all');
 await page.locator('#layer').selectOption('manual');
 await page.locator('#query').fill('D104');
 await page.locator('#search').click();
 assert((await page.locator('.card').count())>0,'Installer annotation must be accessible');
 const atom=ledger.records.find(r=>r.scope==='product'&&r.kind==='condition-part'&&r.parent);
 await page.locator('#layer').selectOption('all');
 await page.locator('#query').fill(atom.id);
 await page.locator('#search').click();
 assert.equal(await page.locator('.card').count(),1);
 await page.getByRole('button',{name:'查看父条件 '+atom.parent,exact:true}).click();
 assert.equal(await page.locator('#query').inputValue(),atom.parent);
 assert.equal(await page.locator('.card').count(),1);
 await page.locator('.card select').selectOption('保留');
 await page.locator('.card textarea').fill('isolated approval fixture');
 await page.locator('#query').click();
 const downloadPromise=page.waitForEvent('download');
 await page.locator('#export').click();
 const download=await downloadPromise;
 const exported=JSON.parse(readFileSync(await download.path(),'utf8'));
 assert.equal(exported.decisions[atom.parent].decision,'保留');
 assert.equal(exported.decisions[atom.parent].note,'isolated approval fixture');
 await page.reload();
 await page.locator('#scope').selectOption('all');
 await page.locator('#layer').selectOption('all');
 await page.locator('#query').fill(atom.parent);
 await page.locator('#search').click();
 assert.equal(await page.locator('.card select').inputValue(),'保留');
 exported.decisions[atom.parent].decision='改为可配置';
 await page.locator('#importFile').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
 await page.waitForFunction(()=>document.querySelector('#storage').textContent.includes('已导入 1 项'));
 assert.equal(await page.locator('.card select').inputValue(),'改为可配置');
 await page.locator('#query').fill('no-such-audit-id-fixture');
 await page.locator('#search').click();
 assert.equal(await page.locator('.card').count(),0);
 assert(await page.locator('#next').isDisabled());
 await page.locator('#query').fill('D101');
 await page.locator('#search').click();
 assert.equal(await page.locator('.card').count(),1,'D ID searches must not match unrelated F IDs');
 assert.match(await page.locator('.card').innerText(),/字体发现异常永久缓存为不可用/);
 await page.screenshot({path:path.join(directory,'review-verification.png')});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',records:ledger.records.length,checks:['TS/Python conditions','ID uniqueness','all condition parents','pagination','installer annotation','parent navigation','approval persistence','decision export/import','empty state','no browser errors']}));
}finally{await browser.close();}
