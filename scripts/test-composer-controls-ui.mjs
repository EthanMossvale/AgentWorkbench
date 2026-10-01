import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Real renderer components, synthetic state and deferred host calls only.
// The window stays hidden; no production profile, CLI or provider is used.
const root = process.cwd();
const output = path.resolve(process.env.AWB_COMPOSER_CONTROLS_QA ?? 'build/qa/composer-controls-20260928/ui');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'fixture.tsx'), `
import React,{useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import Workspace from '${root.replaceAll('\\', '/')}/apps/desktop/renderer/Workspace';
import PluginSettings from '${root.replaceAll('\\', '/')}/apps/desktop/renderer/PluginSettings';
import {translationEnabled} from '${root.replaceAll('\\', '/')}/packages/translation/settings';
import NativeChildConversation from '${root.replaceAll('\\', '/')}/apps/desktop/renderer/NativeChildConversation';
import {uiPreferences} from '${root.replaceAll('\\', '/')}/apps/desktop/renderer/ui-preferences';
import {UiPreferenceRegistry,preferenceKey} from '${root.replaceAll('\\', '/')}/packages/ui-preferences';
import '${root.replaceAll('\\', '/')}/apps/desktop/renderer/styles.css';
import '${root.replaceAll('\\', '/')}/apps/desktop/renderer/LightTheme.css';
import '${root.replaceAll('\\', '/')}/apps/desktop/renderer/WorkspaceChrome.css';
const root=createRoot(document.getElementById('root'));let sequence=0;
const preferenceRegistry=new UiPreferenceRegistry(),preferences={schemaVersion:1,revision:0,entries:{}};
window.workbench={onExtensions:()=>()=>{},call:async(method,payload={})=>{
 if(method==='ui-preferences/get')return structuredClone(preferences);
 if(method==='ui-preferences/update'){const key=preferenceKey(payload.id,payload.scope);if((preferences.entries[key]?.revision??0)!==payload.revision)throw Error('UI_PREFERENCE_CONFLICT');if(!payload.reset)preferenceRegistry.validate(payload.id,payload.value);preferences.entries[key]={revision:++preferences.revision,...(payload.reset?{}:{value:payload.value})};return structuredClone(preferences);}
 return window.__qaCall(method,payload);
}};
await uiPreferences.initialize(window.workbench);
function Fixture({options}){
 const model={id:'mapped',model:'fixture-model',name:options.longName?'这是一个用于验证截断与思考档位布局的很长模型名称':'示例模型',enabled:true,efforts:options.noEffort?[]:['low','medium','high'],defaultEffort:'medium',reasoningProbe:{status:'declared',declared:options.noEffort?[]:['low','medium','high'],accepted:[],rejected:[]}};
 const [state,setState]=useState({version:1,theme:'light',projects:[],hosts:[],profiles:[],plugins:{translation:{enabled:options.translation??false}},translationQuickToggle:{show:options.showQuick??true,paused:options.paused??false},translateInput:true,translateProgress:false,translateFinal:true,translateIntermediate:true,autoSubmitTranslated:false,translationLayout:'inline',translation:{id:'fixture',name:'Synthetic',baseUrl:'https://translation.example.test/v1',protocol:'responses',model:'fixture',verifiedEfforts:[],consent:false,hasKey:false,maxCharacters:16000,maxCalls:100,timeoutMs:30000},modelConnections:[{id:'fixture',name:'合成连接',revision:'one',enabled:true,baseUrl:'https://provider.example.test/v1',protocol:'responses',hasKey:false,auth:'none',models:[model]}],sessions:[{id:'fixture-session',title:'会话控件验收',projectId:null,pinned:false,archived:false,group:'',createdAt:'2026-09-28T00:00:00Z',status:options.status??'idle',nativeTurnId:options.noTurn?undefined:'fixture-turn',permissionMode:'default',modelTargetId:'api/fixture/mapped',modelSelection:{model:'fixture-model',...(options.noEffort?{}:{effort:'medium'})},binding:{nativeSessionId:'fixture-native',runtime:options.runtime??'codex',modelConnectionId:'fixture',modelMappingId:'mapped',provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'fixture'},forkAttachments:options.attachments??[],forkSkills:options.skills??[],messages:[{id:'user-message',role:'user',original:'请检查这段合成示例。',submitted:'Please check this synthetic example.',timestamp:'2026-09-28T00:00:00Z'}]}]});
 const current=useRef(state);current.current=state;window.qaState=state;
 const [view,setView]=useState('workspace'),[draft,setDraft]=useState({projectId:null,projectPath:'',runtime:'codex',permissionMode:'default'});
 const patch=value=>flushSync(()=>setState(previous=>({...previous,...value})));
 const sessionPatch=value=>flushSync(()=>setState(previous=>({...previous,sessions:[{...previous.sessions[0],...value}]})));
 window.qaPatch=value=>flushSync(()=>patch(value));window.qaSession=value=>flushSync(()=>sessionPatch(value));window.qaView=value=>flushSync(()=>setView(value));
 const refresh=async()=>current.current;
 window.__qaCall=async(method,payload={})=>{
  window.qaCalls.push({method,payload});
  if(method==='local-cli/list')return [{runtime:'codex',installed:true},{runtime:'claude',installed:true}];
  if(method==='runtime/catalog'||method==='model-targets/list'||method==='extensions/list'||method==='attachments/views')return [];
  if(method==='composer/catalog')return {scope:payload.scope,commands:[],skills:[]};
  if(method==='translation/quick-toggle'){if(window.failToggle){window.failToggle=false;throw Error('Synthetic toggle failure');}if(window.holdToggle)await new Promise(resolve=>window.finishToggle=resolve);patch({translationQuickToggle:{...current.current.translationQuickToggle,...payload}});return current.current;}
  if(method==='plugins/set-enabled'){if(window.failToggle){window.failToggle=false;throw Error('Synthetic toggle failure');}if(window.holdToggle)await new Promise(resolve=>window.finishToggle=resolve);patch({plugins:{translation:{enabled:payload.enabled}}});return current.current;}
  if(method==='translation/auto-submit'){patch({autoSubmitTranslated:payload.enabled});return current.current;}
  if(method==='session/model'){sessionPatch({modelSelection:payload.selection});return current.current.sessions[0];}
  if(method==='draft/prepare'){if(window.holdPrepare)await new Promise(resolve=>window.finishPrepare=resolve);const disabled=!translationEnabled(current.current);return {id:'preview',original:payload.text,translated:disabled?payload.text:'Synthetic translation',sourceHash:'synthetic-hash',bypass:disabled,moduleDisabled:disabled,attachments:[],skills:[]};}
  if(method==='draft/submit'){if(window.holdSubmit)await new Promise(resolve=>window.finishSubmit=resolve);sessionPatch({status:'running'});return {accepted:true};}
  if(method==='session/stop'){if(window.holdStop)await new Promise(resolve=>window.finishStop=resolve);sessionPatch({status:'idle'});return {stopped:true};}
  if(method==='draft/cancel')return {cancelled:true};
  if(method==='clipboard/write'){if(window.failCopy){window.failCopy=false;throw Error('Synthetic clipboard failure');}return null;}
  throw Error('Unexpected fixture call: '+method);
 };
 const report=error=>window.qaReported.push(String(error));
 const copy=value=>window.__qaCall('clipboard/write',{text:value}).then(()=>window.qaNotifications.push('已复制')).catch(report);
 return <main className="qa-root"><div className="qa-workspace" hidden={view!=='workspace'}><Workspace state={state} session={state.sessions[0]} active={view==='workspace'} draft={draft} onDraftChange={setDraft} onSwitchDraft={setDraft} onCreateProject={()=>{}} ensureSession={async()=>current.current.sessions[0]} onFork={async(sessionId,messageId)=>{window.qaCalls.push({method:'fixture/fork',payload:{sessionId,messageId}});}} forkingId="" onOpenSource={()=>{}} report={report} notify={message=>window.qaNotifications.push(message)} refresh={refresh}/></div>{view==='settings'&&<PluginSettings state={state} refresh={refresh} report={report} notify={()=>{}}/>}{view==='child'&&<NativeChildConversation session={state.sessions[0]} childId="fixture-child" sessions={state.sessions} enabled={true} onClose={()=>setView('workspace')} onNavigate={()=>{}} copy={copy} actions={{sessionId:state.sessions[0].id,openFile:()=>{},report,notify:message=>window.qaNotifications.push(message)}}/>}</main>;
}
window.qaShow=(options={})=>{window.qaCalls=[];window.qaReported=[];window.qaNotifications=[];window.failCopy=false;window.holdPrepare=false;window.holdSubmit=false;window.holdStop=false;window.holdToggle=false;flushSync(()=>root.render(<Fixture key={++sequence} options={options}/>));};window.qaReady=true;
`);
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><style>.qa-root,.qa-workspace{height:100vh;min-width:0}.qa-workspace:not([hidden]){display:flex}.qa-workspace>.workspace{flex:1}.qa-root>.native-resources{padding:24px}.qa-root>.child-conversation-dock{width:min(580px,100%);height:100vh}</style></head><body><div id="root"></div><script type="module" src="fixture.tsx"></script></body></html>');
await build({configFile:path.join(root,'vite.config.ts'),root:output,build:{outDir:path.join(output,'dist'),emptyOutDir:true},logLevel:'warn',plugins:[{name:'synthetic-host',enforce:'pre',resolveId(source){if(source==='./App')return '\0fixture-api';},load(id){if(id==='\0fixture-api')return 'export const api=(method,payload)=>window.__qaCall(method,payload);';}}]});
await writeFile(path.join(output, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output,'isolated-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1024,height:780,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output,'dist/index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const checks = [], errors = [];
const record = name => { checks.push(name); console.log('PASS ' + name); };
let app, passed = false;
try {
  app = await electron.launch({ executablePath: electronPath, args: [path.join(output, 'main.cjs')], cwd: root, env });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.qaReady);
  assert.equal(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const show = async (options = {}) => { await page.evaluate(options => window.qaShow(options), options); await page.getByTestId('composer-input').waitFor(); };
  const input = page.getByTestId('composer-input'), toggle = page.getByTestId('translation-quick-toggle');
  const calls = method => page.evaluate(method => window.qaCalls.filter(call => call.method === method), method);
  const singleAction = async id => { await page.getByTestId(id).waitFor(); assert.equal(await page.locator('.composer-actions>.send-button').count(), 1); assert.equal((await page.getByTestId(id).innerText()).trim(), ''); assert.equal(await page.getByTestId(id).locator('svg').count(), 1); if(id==='session-stop'||id==='draft-stop'){const shape=await page.getByTestId(id).evaluate(button=>{const b=button.getBoundingClientRect(),r=button.querySelector('rect').getBoundingClientRect();return {width:r.width,height:r.height,dx:r.x+r.width/2-b.x-b.width/2,dy:r.y+r.height/2-b.y-b.height/2};});assert.equal(shape.width,12);assert.equal(shape.height,12);assert.equal(await page.getByTestId(id).evaluate(button=>getComputedStyle(button).borderRadius),'50%');assert.ok(Math.abs(shape.dx)<.1&&Math.abs(shape.dy)<.1,JSON.stringify(shape));} };

  await show();
  const edit = page.getByTestId('edit-message-user-message');
  assert.equal((await edit.innerText()).trim(), ''); assert.equal(await edit.getAttribute('aria-label'), '编辑并重发'); assert.equal(await edit.getAttribute('title'), '编辑并重发');
  await input.fill('尚未发送的草稿'); await edit.click(); assert.equal(await input.inputValue(), '请检查这段合成示例。');
  await page.waitForFunction(() => document.querySelector('[data-testid="composer-input"]') === document.activeElement);
  await page.getByTestId('cancel-edit-message').click(); assert.equal(await input.inputValue(), '尚未发送的草稿'); assert.equal((await calls('draft/submit')).length, 0);
  record('icon-only edit restores the message, focuses the composer and preserves the prior unsent draft');

  const copy = page.getByTestId('copy-message-user-message');
  const translatedCopy = page.getByTestId('copy-translation-user-message');
  assert.equal((await copy.innerText()).trim(), ''); assert.equal(await copy.getAttribute('aria-label'), '复制消息'); assert.equal(await copy.getAttribute('title'), '复制消息文本'); assert.equal(await copy.locator('svg').count(), 1);
  const regions = async (article, source, translated) => {
    const note = article.getByTestId('inline-translation'), sourceBox = await source.boundingBox(), noteBox = await note.boundingBox(), translatedBox = await translated.boundingBox();
    assert.ok(sourceBox.y + sourceBox.height <= noteBox.y + 1); assert.ok(translatedBox.y >= noteBox.y + noteBox.height - 1);
    assert.ok(Math.abs(sourceBox.x + sourceBox.width/2 - translatedBox.x - translatedBox.width/2) < .1, 'copy icons share the same horizontal center');
    assert.equal(await article.locator('[data-message-copy-region="source"]').count(), 1); assert.equal(await article.locator('[data-message-copy-region="translation"]').count(), 1);
    assert.equal((await translated.innerText()).trim(), ''); assert.equal(await translated.locator('svg').count(), 1);
  };
  await regions(page.getByTestId('user-source-user-message'), copy, translatedCopy);
  const copyBox = await translatedCopy.boundingBox(), editBox = await edit.boundingBox();
  assert.ok(copyBox.x + copyBox.width <= editBox.x); assert.equal(copyBox.y, editBox.y);
  assert.equal(editBox.x - copyBox.x - copyBox.width, 4);
  const history = await page.evaluate(() => window.qaState.sessions[0].messages);
  await copy.focus(); await copy.press('Enter');
  assert.deepEqual(await calls('clipboard/write'), [{method:'clipboard/write',payload:{text:'Please check this synthetic example.'}}]);
  assert.deepEqual(await page.evaluate(() => window.qaNotifications), ['已复制']);
  assert.equal(await input.inputValue(), '尚未发送的草稿'); assert.deepEqual(await page.evaluate(() => window.qaState.sessions[0].messages), history);
  assert.equal((await calls('draft/prepare')).length, 0); assert.equal((await calls('draft/submit')).length, 0);
  await translatedCopy.focus(); await translatedCopy.press('Enter');
  assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:'请检查这段合成示例。'}); assert.equal(await translatedCopy.getAttribute('aria-label'), '复制原稿');
  assert.equal(await input.inputValue(), '尚未发送的草稿'); assert.deepEqual(await page.evaluate(() => window.qaState.sessions[0].messages), history);
  assert.equal((await calls('draft/submit')).length, 0);
  record('bilingual user messages place one copy per region; the local draft copy stays left of edit and both work by keyboard');

  await page.evaluate(() => window.qaSession({agentParent:{sessionId:'fixture-parent',operationId:'fixture',taskHash:'fixture',authorizationQuote:'Synthetic child request'},messages:window.qaState.sessions[0].messages.map(message=>({...message,translation:'子任务译文。'}))}));
  await regions(page.getByTestId('user-source-user-message'), copy, translatedCopy);
  assert.equal(await translatedCopy.getAttribute('aria-label'), '复制译文'); await translatedCopy.click();
  assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:'子任务译文。'});
  await page.evaluate(history => window.qaSession({agentParent:undefined,messages:history}), history);
  await regions(page.getByTestId('user-source-user-message'), copy, translatedCopy);
  record('copy columns stay aligned with four-pixel action gaps as child-task translation controls appear and disappear');

  const original = '  **合成原文**\n\n第二行 `code`  \n';
  await page.evaluate(original => window.qaSession({messages:[{...window.qaState.sessions[0].messages[0],original,submitted:undefined}]}), original);
  assert.equal(await translatedCopy.count(), 0); assert.equal(await page.getByTestId('user-source-user-message').locator('[data-message-copy-region]').count(), 1);
  assert.equal((await copy.boundingBox()).y, (await edit.boundingBox()).y);
  await copy.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:original});
  const skill = {id:'fixture-skill',name:'fixture-skill',runtime:'codex',hash:'fixture'};
  await page.evaluate(({original,skill}) => window.qaSession({messages:[{...window.qaState.sessions[0].messages[0],submitted:'$fixture-skill '+original,skills:[skill]}]}), {original,skill});
  await copy.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:original});
  await page.evaluate(() => window.qaSession({messages:[{...window.qaState.sessions[0].messages[0],submitted:'$fixture-skill'}]}));
  await copy.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:''});
  assert.equal(await input.inputValue(), '尚未发送的草稿'); assert.equal((await calls('draft/submit')).length, 0);
  record('copy falls back to original text, preserves Markdown and whitespace, and excludes separate skill prefixes');

  await show(); await input.fill('复制失败时保留草稿'); await page.evaluate(() => { window.failCopy = true; }); await copy.click();
  await page.waitForFunction(() => window.qaReported.some(value => value.includes('Synthetic clipboard failure')));
  assert.deepEqual(await page.evaluate(() => window.qaNotifications), []); assert.equal((await calls('clipboard/write')).length, 1);
  assert.equal(await input.inputValue(), '复制失败时保留草稿'); assert.deepEqual(await page.evaluate(() => window.qaState.sessions[0].messages), history);
  assert.equal((await calls('draft/submit')).length, 0);
  await copy.click(); assert.equal((await calls('clipboard/write')).length, 2); assert.deepEqual(await page.evaluate(() => window.qaNotifications), ['已复制']);
  await page.evaluate(() => { window.failCopy = true; }); await translatedCopy.click();
  await page.waitForFunction(() => window.qaReported.length === 2); assert.equal((await calls('clipboard/write')).length, 3);
  assert.deepEqual(await page.evaluate(() => window.qaNotifications), ['已复制']); assert.equal(await input.inputValue(), '复制失败时保留草稿');
  assert.deepEqual(await page.evaluate(() => window.qaState.sessions[0].messages), history);
  record('both copy regions report errors without success, mutation or automatic retry; an explicit retry remains available');

  const assistant = {id:'assistant-message',role:'assistant',original:'Model **source**.\n\nSecond line.',translation:'模型 **译文**。\n\n第二行。  ',translationStatus:'complete',nativeTurnId:'finished-turn',nativeTurnEnd:true,memoryReferences:[{title:'Project UI and collaboration conventions',path:'MEMORY.md',source:'native-citation'}],timestamp:'2026-09-28T00:00:01Z'};
  await show(); await input.fill('保留模型回复旁的草稿');
  await page.evaluate(assistant => window.qaSession({messages:[...window.qaState.sessions[0].messages,assistant]}), assistant);
  const replyCopy = page.getByTestId('copy-reply-assistant-message'), replyTranslation = page.getByTestId('copy-translation-assistant-message');
  const reply = page.locator('.native-message').filter({has:replyCopy});
  await regions(reply, replyCopy, replyTranslation);
  await replyCopy.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:assistant.original});
  await replyTranslation.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:assistant.translation});
  assert.equal(await replyTranslation.getAttribute('aria-label'), '复制译文'); assert.equal(await input.inputValue(), '保留模型回复旁的草稿');
  record('model output copies exact original or translation Markdown from its own region');

  const memory = reply.getByTestId('reply-memory'); await memory.focus();
  const memoryTooltip = memory.getByRole('tooltip'); assert.equal(await memoryTooltip.isVisible(), true);
  assert.ok((await memoryTooltip.innerText()).includes('记忆来源')); assert.ok((await memoryTooltip.innerText()).includes('原生引用 · MEMORY.md'));
  const tooltipBox = await memoryTooltip.boundingBox(), memoryBox = await memory.boundingBox(), memoryClip = {x:Math.max(0,tooltipBox.x-8),y:Math.max(0,tooltipBox.y-8),width:tooltipBox.width+16,height:memoryBox.y+memoryBox.height-tooltipBox.y+16};
  await page.screenshot({path:path.join(output,'memory-indicator.png'),clip:memoryClip});
  await input.focus(); record('existing memory source indicator remains beside the reply actions and exposes its tooltip on keyboard focus');

  for (const status of ['pending','failed']) {
    await page.evaluate(({assistant,status}) => window.qaSession({status:'idle',messages:[{...assistant,original:assistant.original+'\nLatest streamed text.',translationStatus:status,translationError:status==='failed'?'Synthetic translation failure':undefined}]}), {assistant,status});
    await replyCopy.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:assistant.original+'\nLatest streamed text.'});
    await replyTranslation.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:assistant.translation});
    await page.evaluate(status => window.qaSession({messages:window.qaState.sessions[0].messages.map(message=>({...message,translation:undefined,translationStatus:status}))}), status);
    assert.equal(await replyTranslation.count(), 0); assert.equal(await reply.locator('[data-message-copy-region]').count(), 1); assert.equal(await replyCopy.isEnabled(), true);
  }
  await page.evaluate(assistant => window.qaSession({status:'idle',messages:[{...assistant,translation:'新译文 **已更新**。'}]}), assistant);
  await replyTranslation.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:'新译文 **已更新**。'});
  assert.equal(await input.inputValue(), '保留模型回复旁的草稿'); assert.equal((await calls('draft/submit')).length, 0); assert.equal((await calls('session/stop')).length, 0);
  await page.evaluate(() => window.qaPatch({translationLayout:'panel'})); assert.equal(await replyTranslation.count(), 0); assert.equal(await replyCopy.count(), 1);
  await page.evaluate(() => window.qaPatch({translationLayout:'inline'})); await regions(reply, replyCopy, replyTranslation);
  record('completed-turn retranslation copies the displayed versions; empty pending or failed translations add no copy button and panel mode adds no duplicate');

  await show({translation:true,status:'running'});
  const second={...assistant,id:'second-reply',nativeTurnId:'second-turn',timestamp:'2026-09-28T00:00:03Z'};
  const runningMessages=[{id:'old-user',role:'user',original:'First question.',nativeTurnId:'finished-turn',timestamp:'2026-09-28T00:00:00Z'},{...assistant,id:'old-process',phase:'commentary',nativeTurnEnd:false,timestamp:'2026-09-28T00:00:00.500Z'},assistant,{id:'second-user',role:'user',original:'Second question.',nativeTurnId:'second-turn',timestamp:'2026-09-28T00:00:02Z'},second,{id:'current-user',role:'user',original:'Continue.',nativeTurnId:'live-turn',timestamp:'2026-09-28T00:00:04Z'},{...assistant,id:'live-comment',nativeTurnId:'live-turn',phase:'commentary',nativeTurnEnd:false,timestamp:'2026-09-28T00:00:05Z'},{id:'steer',role:'user',original:'Also check this.',nativeTurnId:'live-turn',timestamp:'2026-09-28T00:00:06Z'},{...assistant,id:'live-final',nativeTurnId:'live-turn',phase:'final',timestamp:'2026-09-28T00:00:07Z'}];
  await page.evaluate(messages=>window.qaSession({messages,nativeTurnId:'live-turn'}),runningMessages);
  await page.locator('.turn-process summary').first().click();
  for(const id of ['old-process','live-comment','live-final']){
    const message=page.locator('.native-message[data-reply-id="'+id+'"]');
    assert.equal(await message.locator('button').count(),1);assert.equal(await message.locator('.translate-message-button').count(),1);
    assert.equal(await message.locator('[data-message-copy-region]').count(),0);
  }
  for(const id of ['assistant-message','second-reply']){
    assert.equal(await page.getByTestId('copy-reply-'+id).count(),1);assert.equal(await page.getByTestId('copy-translation-'+id).count(),1);
    assert.equal(await page.getByTestId('fork-message-'+id).isEnabled(),true);
  }
  await page.getByTestId('fork-message-assistant-message').click();
  assert.deepEqual((await calls('fixture/fork')).at(-1).payload,{sessionId:'fixture-session',messageId:'assistant-message'});
  assert.equal((await calls('session/stop')).length,0);
  await page.evaluate(()=>window.qaSession({status:'idle'}));
  assert.equal(await page.getByTestId('copy-reply-live-final').count(),1);assert.equal(await page.getByTestId('fork-message-live-final').isEnabled(),true);
  assert.equal(await page.getByTestId('copy-reply-live-comment').count(),0);
  record('only completed turn endings have bilingual copy and fork actions; process and live messages keep one translate button, and historical forks do not stop the run');

  for (const runtime of ['codex','claude']) {
    await show();
    const child = {runtime,nativeChildId:'fixture-child',title:'子会话复制验收',task:'Review the synthetic text.',taskTranslation:{translation:'检查合成文本。'},operation:'progress',status:'running',updatedAt:'2026-09-28T00:00:01Z',messages:[{id:'child-user',role:'user',text:'A separate **request**.',translation:'单独的 **请求**。',at:'2026-09-28T00:00:01Z',updatedAt:'2026-09-28T00:00:01Z',complete:true},{id:'child-reply',role:'assistant',text:'Child **source**.',translation:'子会话 **译文**。',at:'2026-09-28T00:00:02Z',updatedAt:'2026-09-28T00:00:02Z',complete:false}]};
    await page.evaluate(child => { window.qaSession({nativeChildren:[child]}); window.qaView('child'); }, child);
    const reader = page.getByTestId('child-reader');
    await regions(reader.getByTestId('child-assignment'), reader.getByTestId('copy-child-task'), reader.getByTestId('copy-child-task-translation'));
    await reader.getByTestId('copy-child-task').click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:child.task});
    await reader.getByTestId('copy-child-task-translation').click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:child.taskTranslation.translation});
    for (const message of child.messages.filter(message=>message.role==='user')) {
      const source = reader.getByTestId('copy-child-message-'+message.id), translated = reader.getByTestId('copy-child-translation-'+message.id);
      await regions(reader.locator('[data-message-id="'+message.id+'"]'), source, translated);
      await source.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:message.text});
      await translated.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:message.translation});
    }
    assert.equal(await reader.getByTestId('copy-child-message-child-reply').count(),0);
    assert.equal(await reader.locator('[data-message-id="child-reply"] button').count(),1);
    child.operation='completed';child.status='completed';child.messages.at(-1).complete=true;
    await page.evaluate(child=>window.qaSession({nativeChildren:[child]}),child);
    const source=reader.getByTestId('copy-child-message-child-reply'),translated=reader.getByTestId('copy-child-translation-child-reply');
    await regions(reader.locator('[data-message-id="child-reply"]'),source,translated);
    await source.click();assert.deepEqual((await calls('clipboard/write')).at(-1).payload,{text:child.messages.at(-1).text});
    await translated.click();assert.deepEqual((await calls('clipboard/write')).at(-1).payload,{text:child.messages.at(-1).translation});
    assert.deepEqual(await page.evaluate(() => window.qaState.sessions[0].nativeChildren), [child]); assert.equal((await calls('draft/submit')).length, 0); assert.equal((await calls('child-message/translate')).length, 0);
    await page.screenshot({path:path.join(output,'child-copy-'+runtime+'.png'),fullPage:true});
  }
  record('Codex and Claude child replies show only translation while running, then copy both regions after completion');
  await show();

  assert.equal(await page.getByTestId('model-selector').textContent(), '示例模型 · 中');
  assert.equal(await page.getByTestId('model-selector').locator('svg').count(), 0);
  await page.getByTestId('model-selector').click(); await page.getByRole('dialog', { name: '模型与思考设置' }).waitFor();
  await page.getByTestId('native-effort').press('End'); await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('model-selector').textContent(), '示例模型 · 高');
  record('model and effort use a middle dot, with no dropdown arrow, while model settings remain operable');

  await show({ status: 'running' }); await singleAction('session-stop');
  await input.fill('新的补充'); await singleAction('insert-draft'); assert.equal(await page.getByTestId('session-stop').count(), 0);
  assert.equal(await copy.isEnabled(), true); assert.equal(await edit.isDisabled(), true); await copy.click();
  assert.deepEqual(await calls('clipboard/write'), [{method:'clipboard/write',payload:{text:'Please check this synthetic example.'}}]);
  assert.equal(await input.inputValue(), '新的补充'); assert.deepEqual(await page.evaluate(() => window.qaState.sessions[0].messages), history);
  assert.equal((await calls('draft/prepare')).length, 0); assert.equal((await calls('draft/submit')).length, 0); assert.equal((await calls('session/stop')).length, 0);
  await translatedCopy.click(); assert.deepEqual((await calls('clipboard/write')).at(-1).payload, {text:'请检查这段合成示例。'}); assert.equal(await input.inputValue(), '新的补充');
  record('both copy regions remain available during a running turn without submitting, stopping or disturbing the new draft');
  await input.fill(' \n '); await singleAction('session-stop');
  await input.fill('新的补充'); await page.evaluate(() => { window.holdSubmit = true; }); await page.getByTestId('insert-draft').click();
  await page.waitForFunction(() => !!window.finishSubmit); await singleAction('session-stop');
  assert.equal((await calls('draft/prepare')).length, 1); assert.equal((await calls('draft/submit')).length, 1); assert.equal((await calls('session/stop')).length, 0);
  await page.evaluate(() => window.finishSubmit()); await page.waitForFunction(() => document.querySelector('[data-testid="composer-input"]').value === ''); await singleAction('session-stop');
  await page.evaluate(() => { window.holdStop = true; }); await page.getByTestId('session-stop').click();
  assert.equal(await page.getByTestId('session-stop').isDisabled(), true); assert.equal(await page.getByTestId('session-stop').getAttribute('aria-busy'), 'true');
  await input.fill('停止中的新草稿'); await input.press('Enter'); await singleAction('session-stop'); assert.equal((await calls('draft/prepare')).length,1); await page.evaluate(() => window.finishStop()); await singleAction('prepare-draft'); assert.equal((await calls('session/stop')).length, 1);
  record('one primary icon switches stop/send for a running turn, submits once and stops without duplicate calls');

  await show({status:'running',noTurn:true});await input.fill('等待原生回合');await singleAction('insert-draft');assert.equal(await page.getByTestId('insert-draft').isDisabled(),true);
  await show({status:'running',runtime:'claude'});await input.fill('保留草稿');await singleAction('insert-draft');assert.equal(await page.getByTestId('insert-draft').isEnabled(),true);await input.press('Enter');await page.waitForFunction(()=>window.qaCalls.some(c=>c.method==='draft/prepare'));assert.equal((await calls('draft/prepare')).length,1);await input.fill('');await singleAction('session-stop');
  record('missing turn identity stays blocked while the local Claude transport accepts running follow-ups');

  for (const options of [{attachments:[{id:'attachment',name:'fixture.txt',mime:'text/plain',size:5,sha256:'fixture'}]},{skills:[{id:'fixture-skill',name:'fixture-skill',runtime:'codex',hash:'fixture'}]}]) {
    await show({status:'running',...options});await singleAction('insert-draft');assert.equal(await page.getByTestId('insert-draft').isEnabled(),true);
  }
  record('attachment-only and skill-only drafts select the send icon');

  await show({translation:true});await input.fill('翻译中的草稿');await page.evaluate(()=>{window.holdPrepare=true;});await page.getByTestId('prepare-draft').click();await singleAction('draft-stop');assert.equal(await page.getByTestId('draft-stop').getAttribute('aria-label'),'停止翻译');await page.getByTestId('draft-stop').click();assert.equal(await input.inputValue(),'翻译中的草稿');await page.evaluate(()=>window.finishPrepare());await singleAction('prepare-draft');assert.equal((await calls('draft/submit')).length,0);
  record('translation preparation uses a stop icon and cancellation retains the unsent draft');

  await show({translation:true,paused:true});await input.fill('临时切换时保留草稿');
  const before=await toggle.boundingBox();await toggle.check();await page.getByTestId('auto-submit-toggle').waitFor();
  assert.equal(await toggle.isChecked(),true);assert.equal(await toggle.locator('..').innerText(),'关闭翻译');
  const after=await toggle.boundingBox(),direct=await page.getByTestId('auto-submit-toggle').boundingBox();
  assert.equal(before.x,after.x);assert.equal(before.y,after.y);assert.ok(direct.x>after.x+after.width+10);
  assert.equal(await page.evaluate(()=>window.qaState.plugins.translation.enabled),true);assert.equal((await calls('plugins/set-enabled')).length,0);
  await page.getByTestId('auto-submit-toggle').check();
  const enabledComposer=await page.locator('.composer').boundingBox();
  await page.evaluate(()=>window.qaView('settings'));assert.equal(await page.getByLabel('启用双语工作流',{exact:true}).isChecked(),true);
  await page.getByLabel('启用双语工作流',{exact:true}).uncheck();await page.evaluate(()=>window.qaView('workspace'));
  assert.equal(await toggle.count(),0);assert.equal(await page.locator('.composer-translation-controls').count(),0);
  const disabledComposer=await page.locator('.composer').boundingBox();assert.ok(disabledComposer.y>enabledComposer.y&&disabledComposer.y-enabledComposer.y<=12);
  assert.equal(await input.inputValue(),'临时切换时保留草稿');
  await page.evaluate(()=>window.qaView('settings'));await page.getByLabel('启用双语工作流',{exact:true}).check();await page.evaluate(()=>window.qaView('workspace'));
  assert.equal(await toggle.isChecked(),true);assert.equal(await page.getByTestId('auto-submit-toggle').isChecked(),true);await toggle.uncheck();
  await page.evaluate(()=>window.qaView('settings'));assert.equal(await page.getByLabel('启用双语工作流',{exact:true}).isChecked(),true);
  assert.equal(await page.getByLabel('显示临时翻译开关',{exact:true}).count(),0);await page.getByTestId('translation-plugin-expand').click();
  await page.getByLabel('显示临时翻译开关',{exact:true}).uncheck();await page.evaluate(()=>window.qaView('workspace'));
  assert.equal(await toggle.count(),0);assert.equal(await page.getByTestId('auto-submit-toggle').isChecked(),true);
  assert.equal(await page.evaluate(()=>window.qaState.translationQuickToggle.paused),true);
  await page.evaluate(()=>window.qaView('settings'));assert.equal(await page.getByTestId('translation-plugin-expand').getAttribute('aria-expanded'),'true');await page.getByLabel('显示临时翻译开关',{exact:true}).check();
  await page.screenshot({path:path.join(output,'translation-settings.png'),fullPage:true});
  await page.evaluate(()=>window.qaView('workspace'));assert.equal(await toggle.isChecked(),false);assert.equal(await page.getByTestId('auto-submit-toggle').count(),0);
  record('quick translation is independent; master and details gate visibility, hidden pause is inactive, and disabled module lowers the composer slightly');

  await page.evaluate(()=>{window.failToggle=true;});await toggle.click();await page.waitForFunction(()=>window.qaReported.some(value=>value.includes('Synthetic toggle failure')));assert.equal(await toggle.isChecked(),false);assert.equal(await input.inputValue(),'临时切换时保留草稿');
  await page.evaluate(()=>{window.holdToggle=true;});await toggle.click();await page.waitForFunction(()=>!!window.finishToggle);assert.equal(await toggle.isDisabled(),true);await page.evaluate(()=>window.finishToggle());await page.waitForFunction(()=>{const toggle=document.querySelector('[data-testid="translation-quick-toggle"]');return toggle.checked&&!toggle.disabled;});assert.equal(await toggle.isEnabled(),true);
  record('toggle errors preserve actual state and drafts; pending toggles cannot dispatch again');

  for(const [theme,width] of [['light',1024],['dark',1024],['dark',680],['light',540]]){
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,780),width);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await show({translation:true,longName:true,status:'running'});
    await page.evaluate(assistant => window.qaSession({messages:[...window.qaState.sessions[0].messages,assistant,{id:'live-user',role:'user',original:'Check the next part.',timestamp:'2026-09-28T00:00:02Z'},{id:'live-process',role:'assistant',original:'Reviewing the next part…',translation:'正在检查下一部分…',phase:'commentary',nativeTurnEnd:false,timestamp:'2026-09-28T00:00:03Z'}]}), assistant);
    await regions(page.getByTestId('user-source-user-message'), copy, translatedCopy); await regions(reply, replyCopy, replyTranslation);
    const geometry=await page.locator('.composer-actions').evaluate(element=>{const action=element.querySelector('.send-button').getBoundingClientRect(),name=element.querySelector('.model-name').getBoundingClientRect(),effort=element.querySelector('.model-effort').getBoundingClientRect();return {fits:element.getBoundingClientRect().right<=innerWidth&&action.right<=innerWidth&&effort.right<=action.left,nameWidth:name.width,effortWidth:effort.width,overflows:document.documentElement.scrollWidth>innerWidth};});
    await page.screenshot({path:path.join(output,theme+'-'+width+'-stop.png'),fullPage:true}); if(!geometry.fits||geometry.overflows)console.log(JSON.stringify({theme,width,geometry,overflow:await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1;}).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))) }));assert.equal(geometry.fits,true);assert.equal(geometry.overflows,false);assert.ok(geometry.nameWidth>0&&geometry.effortWidth>0);
    await page.screenshot({path:path.join(output,theme+'-'+width+'-stop.png'),fullPage:true});await input.fill('运行中的补充内容');await singleAction('insert-draft');await page.screenshot({path:path.join(output,theme+'-'+width+'-send.png'),fullPage:true});
    await page.evaluate(()=>window.qaPatch({plugins:{translation:{enabled:false}}}));
    assert.equal(await toggle.count(),0);assert.equal(await page.locator('.composer-translation-controls').count(),0);
    const spacing=await page.locator('.composer-area').evaluate(area=>({padding:Number.parseFloat(getComputedStyle(area).paddingBottom),gap:innerHeight-area.querySelector('.composer').getBoundingClientRect().bottom}));
    assert.ok(spacing.padding>=12&&spacing.gap>=12);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,theme+'-'+width+'-module-off.png'),fullPage:true});
  }
  await show({noEffort:true});assert.equal(await page.getByTestId('model-selector').textContent(),'示例模型');
  record('light/dark and narrow layouts retain visible effort and icon controls; unknown effort adds no stray separator');
  assert.deepEqual(errors,[]);passed=true;record('zero renderer errors in hidden isolated Electron');
} finally {
  if(app)await app.close();
  await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,errors,scope:'Actual renderer components with synthetic host responses; no native model, production profile or remote execution.'},null,2));
}
