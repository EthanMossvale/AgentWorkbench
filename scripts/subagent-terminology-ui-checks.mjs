import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';

const { encodeZip } = await tsImport('../packages/native-resources/archive.ts', import.meta.url);

// Only imported into the isolated child-reader acceptance app.
export async function checkSubagentTerminology({page,call,output,openChild,wait,record}) {
  const reader=page.getByTestId('child-reader');
  const close=()=>reader.getByRole('button',{name:'关闭子会话面板',exact:true}).click();
  const labels=reader.locator('[data-subagent-label]');
  assert.equal(await reader.getAttribute('aria-label'),'Subagent 会话');
  assert.equal(await reader.locator('.child-reader-header>small').textContent(),'Subagent · Codex');
  assert.deepEqual(await labels.allTextContents(),['Subagent','Subagent']);
  assert.equal(await reader.getByTestId('child-model-settings').getAttribute('aria-label'),'Subagent 模型参数');
  assert.match(await reader.getByTestId('child-model').getAttribute('title'),/此 Subagent 的参数/);
  await close();await openChild('核对文档措辞');
  assert.equal(await reader.locator('.child-reader-header>small').textContent(),'Subagent · Claude Code');
  await close();await openChild('Subagent');
  assert.equal(await reader.getByRole('heading',{name:'Subagent 会话',exact:true}).count(),1);
  await close();await openChild('检查输入边界');
  record('Subagent terminology covers both runtimes, message roles, accessible labels, parameter hints and unnamed history');

  const before=(await call('state/get')).sessions;
  const manifest={schemaVersion:1,apiVersion:1,id:'qa.subagent-labels',name:'Subagent labels fixture',description:'Synthetic acceptance only',version:'1.0.0',capabilities:['host'],renderer:'renderer.mjs'};
  const source=`export async function activate(api) {
    window.__subagentQA={mounted:0,cleaned:0,aborted:0,lateCleaned:0,sessionCount:(await api.call('state/get')).sessions.length};
    api.observeSurfaces('subagent-label','replace',({root,signal})=>{
      const q=window.__subagentQA;q.mounted++;root.dataset.qaSubagent='label';root.textContent='Review agent';
      signal.addEventListener('abort',()=>q.aborted++,{once:true});return()=>q.cleaned++;
    });
    api.observeSurfaces('subagent-reader','before',({root})=>{root.dataset.qaSubagent='reader';root.textContent='Extension reader';});
    api.observeSurfaces('subagent-model-settings','after',async({root})=>{
      root.dataset.qaSubagent='settings';await new Promise(resolve=>window.__finishSubagentMount=resolve);
      return()=>window.__subagentQA.lateCleaned++;
    });
  }`;
  const zip=path.join(output,'subagent-labels.zip');
  await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'renderer.mjs',data:Buffer.from(source)}]));
  await call('extensions/import',{filePath:zip});
  const plugin=(await call('extensions/list')).find(item=>item.manifest.id===manifest.id);
  const toggle=enabled=>call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled,...(enabled?{approveHost:true}:{})});
  await assert.rejects(call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled:true}),/approval/i);
  assert.equal(await page.locator('[data-qa-subagent]').count(),0);
  await toggle(true);
  await wait(async()=>await page.locator('[data-qa-subagent="label"]').count()===2);
  assert.equal(await labels.evaluateAll(nodes=>nodes.every(node=>node.hidden)),true);
  assert.equal(await page.locator('[data-qa-subagent="reader"]').isVisible(),true);
  assert.equal(await page.locator('[data-qa-subagent="settings"]').count(),1);
  assert.equal(await page.evaluate(()=>window.__subagentQA.sessionCount),before.length);
  // Resolve the current async mount before navigating; a later one will finish after disable.
  await page.evaluate(()=>window.__finishSubagentMount());
  await close();
  await wait(async()=>await page.locator('[data-qa-subagent]').count()===0);
  await openChild('另一来源的校对');
  await wait(async()=>await page.locator('[data-qa-subagent="label"]').count()===2);
  assert.equal(await reader.getByTestId('child-message').first().locator('header').textContent(),'主 Agent');
  await toggle(false);
  await wait(async()=>await page.locator('[data-qa-subagent]').count()===0);
  assert.equal(await labels.evaluateAll(nodes=>nodes.every(node=>!node.hidden)),true);
  await page.evaluate(()=>window.__finishSubagentMount());
  await wait(async()=>await page.evaluate(()=>window.__subagentQA.lateCleaned===2));
  const counters=await page.evaluate(()=>window.__subagentQA);
  assert.equal(counters.mounted,4);assert.equal(counters.cleaned,4);assert.equal(counters.aborted,4);
  await toggle(true);await wait(async()=>await page.locator('[data-qa-subagent="label"]').count()===2);
  await page.evaluate(()=>window.__finishSubagentMount());
  await toggle(false);
  await wait(async()=>await page.locator('[data-qa-subagent]').count()===0);
  assert.equal(await labels.evaluateAll(nodes=>nodes.every(node=>!node.hidden)),true);
  assert.deepEqual((await call('state/get')).sessions,before);
  await close();await openChild('检查输入边界');
  record('approved synthetic plugin mounts every label and later reader, restores on disable/re-enable, cleans late results and preserves history');
}
