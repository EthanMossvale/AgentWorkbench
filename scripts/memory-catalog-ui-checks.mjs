import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { NativeMemoryService } from '../packages/native-memory/index.ts';
import { digest } from '../packages/native-resources/files.ts';
import { openWorkbenchSettings } from './ui-control-helpers.mjs';

// Run only while the isolated Electron host is closed; no second writer or model process.
export async function seedMemoryHistory({data,home,put}) {
  const service=new NativeMemoryService(data,{home,codexHome:path.join(home,'.codex'),claudeHome:path.join(home,'.claude'),intervalMs:60000});
  await service.initialize();
  try {
    const source=path.join(home,'.codex','memories','catalog-source.md');await put(source,'# Receipt history fixture\nPreserve the original source evidence.');
    const status=await service.status();await service.configure({enabled:true,...(status.needsInitialImport?{initialSources:'both'}:{})});
    const session=service.session('claude','catalog-ui-fixture'),text=await session.prepare('Synthetic explicit fixture task; no model process is launched.','one');
    const manifest=JSON.parse(text.slice(text.lastIndexOf('\n{')+1,text.lastIndexOf('\n</agent-workbench-memory-handoff>'))),entry=manifest.entries.find(e=>e.originalPath===source);
    assert.ok(entry);
    const index=path.join(home,'.claude','projects','qa-project','memory','MEMORY.md'),topic=path.join(path.dirname(index),'received-history.md');
    const marked=body=>entry.startMarker+'\n'+body+'\n'+entry.endMarker;
    await put(topic,'---\nname: received-history\ndescription: Historical fixture\ntype: reference\n---\n'+marked('Preserve this scoped source evidence in native memory.'));
    await put(index,(await readFile(index,'utf8').catch(()=>''))+'\n'+marked('[Received history](received-history.md)'));
    const proof=async file=>({path:file,sha256:digest(await readFile(file,'utf8'))});
    await put(manifest.receiptFile,JSON.stringify({deliveryId:manifest.deliveryId,token:manifest.token,recipientRuntime:'claude',entries:[{archiveId:entry.archiveId,revision:entry.revision,scope:entry.scope,disposition:'stored',files:[await proof(topic)],index:await proof(index)}]}));
    await session.finish();assert.equal((await service.catalog()).archives.find(e=>e.id===entry.archiveId).status,'received');
    return {id:entry.archiveId,topic};
  } finally {await service.dispose();}
}

export async function checkMemoryCatalogUi({app,page,call,output,put,record,fixture}) {
  await call('theme/set',{theme:'dark'});await openWorkbenchSettings(page,'memory');await page.getByRole('button',{name:'查看与管理记忆',exact:true}).click();
  const modal=page.getByRole('dialog'),list=page.getByTestId('native-memory-list');
  await page.getByTestId('memory-tab-codex').waitFor();await list.getByRole('button').filter({hasText:'Receipt history fixture'}).waitFor();assert.equal(await modal.getByRole('tab').count(),3);assert.doesNotMatch(await list.innerText(),/received-history.md/);
  await page.getByTestId('memory-tab-codex').press('ArrowRight');assert.equal(await page.getByTestId('memory-tab-claude').getAttribute('aria-selected'),'true');
  const received=list.getByRole('button').filter({hasText:'received-history.md'});await received.waitFor();assert.match(await received.innerText(),/来源 Codex.*已核验接收/);
  await page.screenshot({path:path.join(output,'memory-claude-provenance-dark.png')});await received.click();assert.equal(await page.getByTestId('native-memory-content').getAttribute('readonly'),'');
  await page.getByRole('button',{name:'返回列表',exact:true}).click();await page.getByTestId('memory-tab-workbench').click();
  const row=page.locator(`[data-archive-id="${fixture.id}"]`);await row.waitFor();assert.match(await row.innerText(),/已接收/);await page.screenshot({path:path.join(output,'memory-workbench-history-dark.png')});await row.click();
  assert.equal(await page.getByTestId('memory-archive-content').getAttribute('readonly'),'');assert.match(await page.getByTestId('memory-archive-content').inputValue(),/Preserve the original source evidence/);assert.equal(await modal.getByRole('button',{name:'删除记忆',exact:true}).count(),0);assert.equal(await modal.getByRole('button',{name:'编辑记忆',exact:true}).count(),0);
  await page.screenshot({path:path.join(output,'memory-received-archive-dark.png')});
  await put(fixture.topic,'Agent rewrote the native body and removed its source markers.');await page.getByRole('button',{name:'重新读取记忆',exact:true}).click();
  await page.getByTestId('memory-archive-status').getByText('接收后有变动',{exact:true}).waitFor();assert.match(await page.getByTestId('memory-archive-status').innerText(),/已接收/);
  await page.getByRole('button',{name:'返回列表',exact:true}).click();await page.getByTestId('memory-tab-claude').click();assert.match(await received.innerText(),/来源 Codex.*已核验接收.*有变动/);
  await page.getByTestId('memory-tab-workbench').click();await row.click();await rm(fixture.topic);await page.getByRole('button',{name:'重新读取记忆',exact:true}).click();
  await page.getByTestId('memory-archive-status').getByText('接收文件当前不可用',{exact:true}).waitFor();assert.match(await page.getByTestId('memory-archive-status').innerText(),/已接收/);
  await call('theme/set',{theme:'light'});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));await page.waitForFunction(()=>innerWidth===860);
  await page.screenshot({path:path.join(output,'memory-archive-light-narrow.png')});assert.equal(await modal.evaluate(e=>e.scrollWidth>e.clientWidth||e.getBoundingClientRect().bottom>innerHeight),false);
  await page.getByRole('button',{name:'返回列表',exact:true}).click();await page.screenshot({path:path.join(output,'memory-tabs-light-narrow.png')});assert.match(await row.innerText(),/已接收/);
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  record('memory tabs separate native ownership and workbench history; verified source survives native body/marker removal and missing files');
  record('read-only historical evidence and source links fit dark and 860x640 light dialogs');
}
