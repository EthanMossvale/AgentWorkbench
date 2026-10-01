import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Hidden, isolated real Workspace UI. Every host call and model response is synthetic.
const root = process.cwd(), output = path.resolve(process.env.AWB_QUESTION_INBOX_QA ?? 'build/qa/async-questions/ui');
await mkdir(output, { recursive: true });
const source = root.replaceAll('\\', '/');
await writeFile(path.join(output, 'fixture.tsx'), `
import React,{useState,useRef} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import Workspace from '${source}/apps/desktop/renderer/Workspace';
import{prepareAsyncQuestion,questionContext}from'${source}/packages/native-interactions/inbox';
import{translationEnabled}from'${source}/packages/translation/settings';
import '${source}/apps/desktop/renderer/styles.css';import '${source}/apps/desktop/renderer/LightTheme.css';import '${source}/apps/desktop/renderer/WorkspaceChrome.css';
const root=createRoot(document.getElementById('root'));let serial=0;
window.workbench={onExtensions:()=>()=>{}};
const question=id=>({id,header:'',question:'Which source '+id+'?',multiple:false,other:true,secret:false,options:[{label:'Native',description:'Native client'},{label:'Other app',description:''}]});
function Fixture({options}){
 const [state,setState]=useState({version:1,theme:'light',projects:[],hosts:[],profiles:[],plugins:{translation:{enabled:!!options.translation}},translationQuickToggle:{show:true,paused:false},translateInput:true,translateFinal:false,translateProgress:false,autoSubmitTranslated:!!options.auto,translationLayout:'inline',translation:{id:'fixture',name:'Synthetic',baseUrl:'https://translator.example/v1',protocol:'responses',model:'fixture',verifiedEfforts:[],consent:true,hasKey:false,maxCharacters:10000,maxCalls:100,timeoutMs:30000},modelConnections:[],sessions:[{id:'fixture-session',title:'Question inbox fixture',projectId:null,pinned:false,archived:false,group:'',createdAt:'2026-09-29T00:00:00Z',status:options.status??'idle',nativeTurnId:'fixture-turn',permissionMode:'default',binding:{nativeSessionId:'native-fixture',runtime:options.runtime??'codex',provider:'fixture',accountRef:'fixture',executionId:'local-device',egress:'fixture'},messages:[{id:'question-message',role:'assistant',original:'A synthetic optional follow-up.',timestamp:'2026-09-29T00:00:00Z',nativeTurnId:'fixture-turn',questions:options.native?undefined:Array.from({length:options.count??1},(_,i)=>question('q'+i))}],nativeInteractions:options.native?[{id:'native-question',receipt:'fixture-receipt',threadId:'native-fixture',turnId:'fixture-turn',kind:'questions',status:'pending',blocking:true,receivedAt:'fixture',title:'',questions:[question('q0')]}]:[]} ]});
 const current=useRef(state);current.current=state;window.qaState=state;
 const [draft,setDraft]=useState({projectId:null,projectPath:'',runtime:'codex',permissionMode:'default'}),[active,setActive]=useState(true);
 const patch=fn=>flushSync(()=>setState(previous=>{const next=structuredClone(previous);fn(next);return next;}));
 window.qaPatch=value=>patch(s=>Object.assign(s,value));window.qaSession=value=>patch(s=>Object.assign(s.sessions[0],value));window.qaActive=value=>flushSync(()=>setActive(value));
 const previews=useRef(new Map()),consumed=useRef(new Set());let number=0;
 const refresh=async()=>current.current;
 window.__qaCall=async(method,payload={})=>{
  window.qaCalls.push({method,payload});
  if(method==='local-cli/list')return[{runtime:'codex',installed:true},{runtime:'claude',installed:true}];
  if(['runtime/catalog','runtime/models','model-targets/list','attachments/views'].includes(method))return[];
  if(method==='composer/catalog')return{scope:payload.scope,commands:[],skills:[]};
  if(method==='translation/auto-submit'){patch(s=>s.autoSubmitTranslated=payload.enabled);return current.current;}
  if(method==='translation/quick-toggle'){patch(s=>Object.assign(s.translationQuickToggle,payload));return current.current;}
  if(method==='interaction/presentation'){
   patch(s=>{const session=s.sessions[0];if(payload.messageId){const m=session.messages.find(m=>m.id===payload.messageId);m.questionPresentation={state:payload.action==='show'?'open':payload.action==='defer'?'deferred':'dismissed',context:questionContext(session)};}else{const item=session.nativeInteractions.find(i=>i.receipt===payload.receipt);if(payload.action==='dismiss')item.status='declined';else item.deferred=payload.action==='defer';}});return current.current;
  }
  if(method==='draft/prepare'){
   const session=current.current.sessions[0],original=prepareAsyncQuestion(session,payload.questionReply).original,disabled=!translationEnabled(current.current);
   if(window.holdPrepare)await new Promise(resolve=>window.releasePrepare=resolve);
   if(window.failPrepare)throw Error('Synthetic translation failed');
   const value={id:crypto.randomUUID(),sourceHash:'synthetic',original,translated:disabled?original:original.replaceAll('中文回答','Translated answer'),bypass:disabled,moduleDisabled:disabled};previews.current.set(value.id,{...value,messageId:payload.questionReply.messageId});return value;
  }
  if(method==='draft/submit'){
   if(consumed.current.has(payload.id))throw Error('Duplicate reply');consumed.current.add(payload.id);
   if(window.holdSubmit)await new Promise(resolve=>window.releaseSubmit=resolve);
   const value=previews.current.get(payload.id);patch(s=>{const session=s.sessions[0];session.messages.find(m=>m.id===value.messageId).questionPresentation={state:'answered',context:questionContext(session)};session.messages.push({id:value.id,role:'user',original:value.original,submitted:value.translated,timestamp:'fixture'});});return{started:true};
  }
  if(method==='draft/cancel'||method==='interaction/cancel')return null;
  if(method==='session/interaction'){patch(s=>s.sessions[0].nativeInteractions[0].status='declined');return null;}
  if(method==='interaction/prepare')return{id:'native-preview',sourceHash:'synthetic',review:false,answers:Object.entries(payload.answers).map(([questionId,original])=>({questionId,original,submitted:original}))};
  if(method==='interaction/submit'){patch(s=>s.sessions[0].nativeInteractions[0].status='answered');return null;}
  throw Error('Unexpected fixture call: '+method);
 };
 return <main className="qa-root"><Workspace state={state} session={state.sessions[0]} active={active} draft={draft} onDraftChange={setDraft} onSwitchDraft={setDraft} onCreateProject={()=>{}} ensureSession={async()=>current.current.sessions[0]} onFork={async()=>{}} forkingId="" onOpenSource={()=>{}} report={e=>window.qaReported.push(String(e))} notify={()=>{}} refresh={refresh}/></main>;
}
window.qaShow=(options={})=>{window.qaCalls=[];window.qaReported=[];window.holdPrepare=false;window.holdSubmit=false;window.failPrepare=false;flushSync(()=>root.render(<Fixture key={++serial} options={options}/>));};window.qaReady=true;
`);
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><style>.qa-root{height:100vh;display:flex}.qa-root>.workspace{flex:1;min-width:0}</style></head><body><div id="root"></div><script type="module" src="fixture.tsx"></script></body></html>');
await build({ configFile: path.join(root, 'vite.config.ts'), root: output, build: { outDir: path.join(output, 'dist'), emptyOutDir: true }, logLevel: 'warn', plugins: [{ name: 'synthetic-host', enforce: 'pre', resolveId(source) { if (source === './App') return '\0fixture-api'; }, load(id) { if (id === '\0fixture-api') return 'export const api=(method,payload)=>window.__qaCall(method,payload);'; } }] });
await writeFile(path.join(output, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output, 'data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1024,height:780,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output, 'dist/index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app, passed = false; const checks = [], errors = [];
const record = message => { checks.push(message); console.log('PASS ' + message); };
try {
  app = await electron.launch({ executablePath: electronPath, args: [path.join(output, 'main.cjs')], cwd: root, env });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => window.qaReady);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const card = page.getByTestId('native-async-question'), input = card.getByRole('textbox'), composer = page.getByTestId('composer-input');
  const calls = method => page.evaluate(method => window.qaCalls.filter(call => call.method === method), method);
  const open = async () => { await page.getByTestId('question-inbox').locator('summary').click(); await page.getByTestId('question-inbox').getByRole('button', { name: '回答', exact: true }).click(); };
  const show = async (options = {}, reopen = true) => { await page.evaluate(options => window.qaShow(options), options); await composer.waitFor(); if (reopen) await open(); };
  const answer = async (text = '中文回答') => { await card.getByRole('radio', { name: '其他回答' }).check(); await input.fill(text); };
  await show({}, false); assert.equal(await card.isVisible(), false); await composer.fill('主编辑框草稿'); await page.screenshot({ path: path.join(output, 'completed-inbox-light.png') }); await open(); await answer(); await input.press('Enter');
  await page.waitForFunction(() => window.qaCalls.some(c => c.method === 'draft/submit'));
  assert.equal(await composer.inputValue(), '主编辑框草稿'); assert.equal((await calls('draft/submit')).length, 1); assert.equal(await page.getByTestId('answer-preview').count(), 0);
  const prepared = (await calls('draft/prepare'))[0].payload; assert.deepEqual(prepared.questionReply.answers, { q0: ['中文回答'] }); assert.equal(prepared.text, undefined); assert.equal(prepared.attachmentIds, undefined);
  record('finished turns collapse to inbox; raw answer submits once directly and leaves composer untouched');

  await show(); await answer('保留回答草稿'); await card.getByRole('button', { name: '稍后回应' }).click(); assert.equal(await card.isVisible(), false); await open(); assert.equal(await input.inputValue(), '保留回答草稿'); await card.getByRole('button', { name: '忽略问题' }).click(); assert.equal(await card.count(), 0); assert.equal((await calls('draft/submit')).length, 0); assert.equal(await page.getByTestId('question-inbox').count(), 0);
  record('defer restores answer text and ignore removes optional questions without starting a task');

  await show({ translation: true }); await composer.fill('独立主草稿'); await answer(); await input.press('Enter'); await page.getByTestId('answer-preview').waitFor(); assert.equal((await calls('draft/submit')).length, 0); assert.match(await page.getByTestId('answer-translated').innerText(), /Translated answer/); await page.screenshot({ path: path.join(output, 'answer-preview-light.png') });
  await page.getByRole('button', { name: '返回修改' }).click(); await page.waitForFunction(() => document.activeElement?.classList.contains('native-free-answer')); await input.fill('中文回答修改'); await input.press('Enter'); await page.getByTestId('answer-preview').waitFor(); assert.match(await page.getByTestId('answer-original').innerText(), /修改/); await page.keyboard.press('Enter'); await page.waitForFunction(() => window.qaCalls.some(c => c.method === 'draft/submit')); assert.equal((await calls('draft/submit')).length, 1); assert.equal(await composer.inputValue(), '独立主草稿');
  record('translation preview confirms separately, editing returns to question and invalidates old preview');

  await show({ translation: true, auto: true }); await answer(); await page.evaluate(() => window.holdSubmit = true); await input.press('Enter'); await page.waitForFunction(() => window.qaCalls.some(c => c.method === 'draft/submit')); assert.equal((await calls('draft/submit'))[0].payload.automatic, true); assert.equal(await page.getByTestId('answer-preview').count(), 0); await input.dispatchEvent('keydown', { key: 'Enter', repeat: true }); assert.equal((await calls('draft/submit')).length, 1); await page.evaluate(() => window.releaseSubmit());
  record('auto-send translates then submits without preview and rejects duplicate keyboard submission');

  await show({ translation: true, auto: true }); await answer(); await page.evaluate(() => window.holdPrepare = true); await input.press('Enter'); await page.waitForFunction(() => !!window.releasePrepare); await page.getByTestId('translation-quick-toggle').uncheck(); await page.evaluate(() => window.releasePrepare()); await page.waitForFunction(() => window.qaCalls.some(c => c.method === 'draft/cancel' && c.payload.id)); assert.equal((await calls('draft/submit')).length, 0); assert.equal(await input.inputValue(), '中文回答');
  record('turning translation off during preparation cancels stale results without sending originals');

  await show({ translation: true }); await answer(); await page.evaluate(() => window.failPrepare = true); await input.press('Enter'); await card.getByRole('alert').waitFor(); assert.equal((await calls('draft/submit')).length, 0); assert.equal(await input.inputValue(), '中文回答');
  record('translation failure stays in question and preserves its answer');

  await show({ status: 'running', translation: true, auto: true }, false); await answer(); await page.evaluate(() => window.holdPrepare = true); await input.press('Enter'); await page.waitForFunction(() => !!window.releasePrepare); await page.evaluate(() => window.qaSession({ status: 'idle' })); assert.equal(await card.isVisible(), false); await page.evaluate(() => window.releasePrepare()); await page.waitForFunction(() => window.qaCalls.some(c => c.method === 'draft/cancel' && c.payload.id)); assert.equal((await calls('draft/submit')).length, 0); await open(); assert.equal(await input.inputValue(), '中文回答');
  record('turn completion folds the question, cancels in-flight preparation and retains its answer');

  await show({ count: 2 }); await answer(); await input.press('Shift+Enter'); assert.equal(await input.inputValue(), '中文回答\n');
  for (const event of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', repeat: true }, { key: 'Enter', ctrlKey: true }]) await input.dispatchEvent('keydown', event);
  assert.equal(await card.getByTestId('question-position').innerText(), '第 1 / 2 题'); await input.press('Enter'); assert.equal(await card.getByTestId('question-position').innerText(), '第 2 / 2 题'); await card.getByRole('radio', { name: 'Native', exact: false }).check(); await card.getByRole('radio', { name: 'Native', exact: false }).press('Enter'); await page.waitForFunction(() => window.qaCalls.some(c => c.method === 'draft/submit')); assert.equal((await calls('draft/prepare')).length, 1);
  record('multi-question keyboard preserves IME, Shift Enter, validation and one final submission');

  for (const runtime of ['codex', 'claude']) {
    await show({ native: true, runtime, status: 'running' }, false); const native = page.getByTestId('native-interaction'); await native.getByRole('button', { name: '稍后回应' }).click(); assert.equal(await native.isVisible(), false); await page.getByTestId('question-inbox').locator('summary').click(); assert.match(await page.getByTestId('question-inbox').innerText(), /运行时仍在等待/); await page.getByTestId('question-inbox').getByRole('button', { name: '忽略问题' }).click(); assert.equal(await page.getByTestId('question-inbox').count(), 0); assert.equal((await calls('draft/submit')).length, 0);
  }
  record('both native runtimes keep deferred requests pending and expose an explicit ignore action');

  await show({ status: 'running' }, false); await answer('可稍后继续填写的回答'); await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await page.setViewportSize({ width: 760, height: 660 }); await card.locator('footer').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'question-dark-narrow.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await card.getByRole('button', { name: '稍后回应' }).click(); await page.getByTestId('question-inbox').locator('summary').click(); await page.screenshot({ path: path.join(output, 'inbox-dark-narrow.png') });
  record('light and dark narrow layouts fit the viewport');
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.qaReported), []); record('zero renderer errors'); passed = true;
} finally { await app?.close(); await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed, checks, errors, scope: 'Isolated hidden Electron Workspace with synthetic host API; no real model, user profile, foreground window or remote system.' }, null, 2)); }
