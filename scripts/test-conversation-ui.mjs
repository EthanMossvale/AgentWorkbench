import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), output = path.resolve(process.env.AWB_CONVERSATION_UI_QA ?? 'build/qa/approval-ui/ui');
await mkdir(output, { recursive: true });
const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import NativeApprovals from '${root.replaceAll('\\','/')}/apps/desktop/renderer/NativeApprovals';
import NativeInteractions,{NativeInteractionHistory} from '${root.replaceAll('\\','/')}/apps/desktop/renderer/NativeInteractions';
import MessageText from '${root.replaceAll('\\','/')}/apps/desktop/renderer/MessageText';
import ModelControls from '${root.replaceAll('\\','/')}/apps/desktop/renderer/ModelControls';
import {approvalFields}from'${root.replaceAll('\\','/')}/packages/native-approvals';
import{validateAnswers}from'${root.replaceAll('\\','/')}/packages/native-interactions';
import'${root.replaceAll('\\','/')}/apps/desktop/renderer/styles.css';
import'${root.replaceAll('\\','/')}/apps/desktop/renderer/ReadingPane.css';
const root=createRoot(document.getElementById('root'));let sequence=0;window.qaCalls=[];
function Fixture({mode,data}){
 const [session,setSession]=useState(()=>({id:'synthetic-session',title:'Fixture',binding:{runtime:data.runtime??'codex',nativeSessionId:'thread',modelConnectionId:'fixture',modelMappingId:'fixture'},messages:[],nativeApprovals:mode==='approval'?[{id:7,kind:'command',turnId:'turn',...approvalFields(data.runtime??'codex',data.request,'command','receipt-'+sequence)}]:[],nativeInteractions:mode==='questions'?[data.item]:[],nativeContextUsage:data.usage}));
 const state={plugins:{translation:{enabled:!!data.translated}},translateInput:true,translation:{},autoSubmitTranslated:false,modelConnections:[{id:'fixture',revision:'one',models:[{id:'fixture',model:'fixture',name:'示例模型',enabled:true,contextWindow:data.contextWindow}]}]};
 let prepared;
 window.__qaCall=async(method,payload)=>{window.qaCalls.push({method,payload});
  if(method==='interaction/prepare'){validateAnswers(data.item.questions,payload.answers);prepared={id:'preview',sourceHash:'fixture',review:!!data.review,answers:data.item.questions.map(q=>({questionId:q.id,original:payload.answers[q.id],submitted:data.review?payload.answers[q.id].map(a=>'Translated '+a):payload.answers[q.id]}))};return prepared;}
  if(method==='interaction/submit'){setSession(s=>({...s,nativeInteractions:s.nativeInteractions.map(i=>({...i,status:'answered',answerRecord:prepared?.answers}))}));return null;}
  if(method==='session/approval'){await new Promise(r=>setTimeout(r,80));setSession(s=>({...s,nativeApprovals:[]}));return null;}
  if(method==='interaction/cancel'||method==='clipboard/write')return null;
  return [];
 };
 const actions={sessionId:session.id,openFile:reference=>window.qaCalls.push({method:'fixture/open',payload:reference}),report:error=>window.qaCalls.push({method:'fixture/error',payload:String(error)}),notify:()=>{}};
 return <main className="qa-root"><div className="qa-content"><p className="qa-label">{data.runtime==='claude'?'Claude Code':'Codex'} · 会话交互</p>
 {mode==='approval'&&<NativeApprovals session={session}/>}
 {mode==='questions'&&<><NativeInteractions session={session} state={state}/>{session.nativeInteractions.filter(i=>i.status!=='pending').map(i=><NativeInteractionHistory key={i.receipt} item={i} session={session} state={state}/>)}</>}
 {mode==='markdown'&&<div className="original-messages"><article className="native-message"><MessageText text={data.text} {...actions}/></article><section className="message-translation-note"><MessageText text={data.translation??data.text} {...actions}/></section></div>}
 {mode==='context'&&<ModelControls state={state} runtime={data.runtime??'codex'} active={false} session={session} bindingLocked={false} disabled={false} onTarget={()=>{}} onChange={()=>{}}/>}
 </div></main>;
}
window.qaShow=(mode,data)=>{window.qaCalls=[];flushSync(()=>root.render(<Fixture key={++sequence} mode={mode} data={data}/>))};
window.qaReady=true;
`;
await writeFile(path.join(output, 'fixture.tsx'), entry);
await build({ entryPoints: [path.join(output, 'fixture.tsx')], outfile: path.join(output, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'isolated-bridge', setup(build) { build.onResolve({ filter: /^\.\/App$/ }, () => ({ path: 'fixture-api', namespace: 'qa' })); build.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: 'export const api=(method,payload)=>window.__qaCall(method,payload);', loader: 'js' })); } }] });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>.qa-root{height:100vh;overflow:auto;background:var(--bg);padding:40px 28px}.qa-content{max-width:780px;margin:auto}.qa-label{font:11px system-ui;color:var(--muted);margin:0 0 18px}.qa-content>.native-interactions .native-interaction{width:100%;margin:0}.qa-content .original-messages{padding:0}.qa-content .native-message{padding:0}.qa-content .model-controls{margin-top:240px;justify-content:flex-end}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(path.join(output, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output, 'isolated-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1100,height:860,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output, 'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app; const checks = [], errors = [], geometry = [];
const record = value => { checks.push(value); console.log('PASS ' + value); };
try {
  app = await electron.launch({ executablePath: electronPath, args: [path.join(output, 'main.cjs')], env, cwd: root });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => window.qaReady);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const show = async (mode, data) => { await page.evaluate(({ mode, data }) => window.qaShow(mode, data), { mode, data }); await page.locator('.qa-root').waitFor(); };
  const calls = () => page.evaluate(() => window.qaCalls);
  const command = 'powershell.exe -Command "New-Item -Path \'permission-test.txt\' -ItemType File"';
  const request = { command, cwd: 'C:\\workspace\\project', reason: 'Create a small test file to verify the requested permission.', availableDecisions: ['accept', 'acceptForSession', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['New-Item', '-ItemType', 'File'] } }, 'decline', 'cancel'] };
  await show('approval', { runtime: 'codex', request }); await page.getByTestId('approval-command').waitFor();
  assert.equal(await page.getByTestId('approval-command').innerText(), command); assert.equal(await page.locator('.approval-raw').getAttribute('open'), null);
  assert.equal(await page.getByRole('radio', { name: '允许本次', exact: true }).isChecked(), true);
  await page.getByRole('radio', { name: '今后允许此类命令' }).check(); assert.match(await page.getByTestId('approval-rule').innerText(), /New-Item/);
  await page.screenshot({ path: path.join(output, 'approval-light.png') }); await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await page.screenshot({ path: path.join(output, 'approval-dark.png') });
  await page.getByRole('button', { name: '允许并保存规则' }).dblclick(); await page.getByTestId('native-approval').waitFor({ state: 'hidden' });
  const responses = (await calls()).filter(c => c.method === 'session/approval'); assert.equal(responses.length, 1); assert.equal(responses[0].payload.optionId, 'execpolicy-2'); assert.ok(responses[0].payload.receipt); record('structured approval UI shows exact command and rule, submits a receipt once');
  await show('approval', { runtime: 'claude', request: { tool_name: 'Bash', input: { command: 'npm test', description: 'Run the selected test suite.' }, permission_suggestions: [{ type: 'addRules', destination: 'localSettings', behavior: 'allow', rules: [{ toolName: 'Bash', ruleContent: 'npm test *' }] }] } });
  await page.getByRole('radio', { name: '今后允许此类操作' }).check(); assert.match(await page.getByTestId('approval-rule').innerText(), /项目本地设置[\s\S]*Bash\(npm test \*\)/); record('Claude approval identifies the native rule and destination');
  await show('approval', { request: { ...request, availableDecisions: ['accept', 'cancel'] } }); await page.getByTestId('native-approval').waitFor(); assert.equal(await page.getByRole('radio').count(), 0); record('restricted native requests never invent remembered decisions');
  const item = { id: 'question', receipt: 'question-receipt', threadId: 'thread', turnId: 'turn', kind: 'questions', status: 'pending', method: 'fixture', blocking: true, title: '', receivedAt: '2026-09-28T00:00:00Z', questions: [{ id: 'first', question: 'Which style should I use?', header: 'Style', multiple: false, other: true, secret: false, options: [{ label: 'Brief', description: 'A short answer.' }, { label: 'Detailed', description: 'Add examples.' }] }, { id: 'second', question: 'Which sections should I include?', header: 'Sections', multiple: true, other: true, secret: false, options: [{ label: 'Intro', description: 'Opening context.' }, { label: 'Summary', description: 'Closing summary.' }] }], questionTranslation: { status: 'complete', values: { 'q0.question': '采用什么风格？', 'q1.question': '包含哪些章节？', 'q0.option0.label': '简短', 'q1.option0.label': '引言' } } };
  await show('questions', { runtime: 'claude', item, translated: true }); await page.getByTestId('question-position').waitFor();
  assert.equal(await page.locator('.native-question:visible').count(), 1); assert.match(await page.getByTestId('question-position').innerText(), /1 \/ 2/);
  await page.getByRole('radio', { name: /其他回答/ }).check(); await page.getByRole('textbox', { name: item.questions[0].question }).fill('Keep it concise.');
  await page.getByTestId('question-next').click(); assert.match(await page.locator('.native-question:visible').innerText(), /包含哪些章节/); assert.equal((await calls()).length, 0);
  await page.getByRole('checkbox', { name: /Intro/ }).check(); await page.getByRole('checkbox', { name: /Summary/ }).check();
  await page.getByRole('button', { name: '上一题', exact: true }).click(); assert.equal(await page.getByRole('textbox').inputValue(), 'Keep it concise.');
  await page.getByTestId('question-next').click(); assert.equal(await page.getByRole('checkbox', { name: /Intro/ }).isChecked(), true);
  await page.screenshot({ path: path.join(output, 'questions-dark.png') }); await page.getByTestId('interaction-submit').click(); await page.getByTestId('native-interaction-history').waitFor();
  assert.equal(await page.locator('.native-interactions .native-interaction-history').count(), 0);
  const prepared = (await calls()).find(c => c.method === 'interaction/prepare'); assert.deepEqual(prepared.payload.answers, { first: ['Keep it concise.'], second: ['Intro', 'Summary'] }); record('question pagination preserves custom and multiple answers, translations and original IDs');
  await show('questions', { runtime: 'codex', item }); await page.getByTestId('question-next').click(); assert.equal(await page.getByTestId('interaction-submit').isEnabled(), false); await page.getByRole('button', { name: '上一题', exact: true }).click(); assert.equal(await page.getByRole('radio').filter({ has: page.locator(':checked') }).count(), 0); record('unanswered pages cannot silently submit an empty result');
  const markdown = '# A clear reply\n\n- **Test choice**: select `Option A`.\n- *Next step*: keep [the file](docs/guide.md:12).\n\n> A quoted explanation.\n\n| Item | Count |\n| --- | ---: |\n| One | 2 |\n\n```text\n  copy **exactly**\n\n  <tag>&amp;</tag>\n```\n\n[Unsafe](javascript:alert(1))\n\n<script>window.modelExecuted=true</script>';
  for (const runtime of ['claude', 'codex']) {
    await show('markdown', { runtime, text: markdown, translation: '## 中文译文\n\n- **选择**：使用 `选项 A`。\n\n```text\n可以直接复制的纯文本\n```' }); await page.getByTestId('markdown-code-block').first().waitFor();
    assert.equal(await page.locator('.native-message strong').first().innerText(), 'Test choice'); assert.equal(await page.locator('.native-message li').count(), 2); assert.equal(await page.locator('.native-message table').count(), 1); assert.equal(await page.locator('.native-message blockquote').count(), 1);
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0); assert.equal(await page.evaluate(() => window.modelExecuted), undefined);
    await page.getByTestId('copy-code').first().click(); assert.equal((await calls()).find(c => c.method === 'clipboard/write').payload.text, '  copy **exactly**\n\n  <tag>&amp;</tag>');
    assert.equal(await page.getByRole('link', { name: 'the file' }).count(), 1); record(runtime + ': Markdown original and translation render, code copies only exact contents, HTML stays inert');
  }
  await page.screenshot({ path: path.join(output, 'markdown-dark.png') }); await page.evaluate(() => document.documentElement.dataset.theme = 'light'); await page.screenshot({ path: path.join(output, 'markdown-light.png') });
  await show('context', { contextWindow: 1000000, usage: { used: 129051, total: 150000, capacity: 258400, updatedAt: 'fixture' } }); await page.getByTestId('context-ring').hover(); await page.getByRole('tooltip').waitFor(); assert.match(await page.getByRole('tooltip').innerText(), /13%[\s\S]*1,000,000/); record('model context tooltip uses 1M while separately describing the runtime budget');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 640)); await show('questions', { item, translated: true }); await page.getByTestId('question-pager').waitFor();
  const bounds = await page.locator('.native-interaction').evaluate(node => { const r = node.getBoundingClientRect(), footer = node.querySelector('footer').getBoundingClientRect(); return { right: r.right, width: r.width, footerBottom: footer.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight }; });
  assert.ok(bounds.right <= bounds.viewportWidth && bounds.footerBottom <= bounds.viewportHeight); geometry.push(bounds); await page.screenshot({ path: path.join(output, 'questions-narrow.png') }); record('narrow hidden Electron page keeps one question and navigation in view');
  assert.deepEqual(errors, []);
} finally { await app?.close(); await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, geometry, scope: 'Hidden Electron, real renderer components and synthetic host bridge. No user client or real clipboard changed.' }, null, 2)); }
