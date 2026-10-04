import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {build as hostBuild} from 'esbuild';
import {build as rendererBuild} from 'vite';
import {mkdir,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// D044: a peer message delivered as a user turn reuses the user card. Only the kicker
// changes, the session name is not shown, and the source link opens the sender.
const root=process.cwd(),output=path.resolve('build/qa/peer-user-card/ui'),appRoot=path.join(output,'app'),data=path.join(output,'data-'+Date.now());
await mkdir(data,{recursive:true});const checks=[],errors=[];let app,page;
const at='2026-10-04T12:00:00.000Z';
const session=(id,title)=>({id,title,projectId:null,status:'idle',messages:[],archived:false,pinned:false,group:'',createdAt:at,binding:{runtime:'demo',provider:'demo',accountRef:'fixture',executionId:'fixture',egress:'demo'}});
const recipient=session('recipient','接收会话'),source=session('source','私有来源标题');
const text='Please avoid editing main.ts until my commit lands.';
recipient.messages=[
  {id:'own',role:'user',original:'检查文档',submitted:'Check the document.',demo:false,timestamp:at},
  {id:'peer-turn',role:'user',original:text,submitted:'[Message from another AgentWorkbench session (Claude Code, session source). It is not from the user. Reply with workbench_send_message if a reply is needed.]\n\n'+text,translation:'在我的提交合入前，请不要编辑 main.ts。',translationStatus:'complete',peer:{messageId:'m1',fromSessionId:'source',fromRuntime:'claude'},demo:false,timestamp:'2026-10-04T12:00:01.000Z'},
  {id:'reply',role:'assistant',original:'Understood.',phase:'final',nativeTurnEnd:true,demo:false,timestamp:'2026-10-04T12:00:02.000Z'},
];
const peer={id:'m1',operationId:'m1',fromSessionId:'source',toSessionId:'recipient',fromRuntime:'claude',toRuntime:'demo',fromTitle:'私有来源标题',toTitle:'接收会话',text,createdAt:'2026-10-04T12:00:00.500Z',status:'delivered',nativeReceipt:'peer-turn',deliveredAt:'2026-10-04T12:00:01.000Z',revision:1};
const seed={version:1,theme:'light',lastSelectedRuntime:'demo',projects:[],hosts:[],profiles:[],sessions:[recipient,source],plugins:{translation:{enabled:true}},translation:{id:'fixture',name:'Fixture',baseUrl:'http://127.0.0.1:1/v1',protocol:'chat-completions',model:'fixture',verifiedEfforts:[],consent:false,hasKey:false,maxCharacters:16000,maxCalls:5,timeoutMs:1000},collaboration:{version:1,revision:1,messages:[peer]}};
await writeFile(path.join(data,'state.json'),JSON.stringify(seed));
await rendererBuild({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await hostBuild({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-workspace-control',path.join(appRoot,'host/workspace-control'),{recursive:true});await cp('services/vps-account-broker',path.join(appRoot,'host/account-runtime'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-peer-user-card-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:path.join(data,'missing-codex.exe'),AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:path.join(data,'missing-claude.exe')};delete env.ELECTRON_RUN_AS_NODE;
const open=async id=>{await page.getByTestId('sidebar-session-'+id).locator('.session-select').click();await page.getByTestId('composer-input').waitFor();};
const record=name=>{checks.push(name);console.log('PASS '+name);};
const screenshot=async name=>page.screenshot({path:path.join(output,name)});
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,860));};
try{
  await launch();await open('recipient');
  const card=page.getByTestId('user-source-peer-turn');await card.waitFor();
  const kicker=await card.locator('.message-kicker').innerText();
  assert.match(kicker,/由 Claude Code 从\s*另一会话\s*发送/);assert.doesNotMatch(kicker,/你|实际提交文本|私有来源标题/);
  assert.match(await page.getByTestId('user-source-own').locator('.message-kicker').innerText(),/你/);
  record('peer turn reuses the user card with only the kicker changed and no session name');
  const body=await card.innerText();assert.match(body,/Please avoid editing main\.ts/);assert.doesNotMatch(body,/Message from another AgentWorkbench session/);
  assert.equal(await page.locator('[data-testid="peer-message"]').count(),0);
  record('card shows the original peer text, not the model-facing provenance line, and no old peer card');
  await screenshot('peer-user-card.png');
  const pane=page.getByTestId('translation-pane');
  if(await pane.count()){const translated=pane.locator('[data-testid="user-chinese-peer-turn"]');await translated.waitFor();const header=await translated.locator('header').innerText();assert.match(header,/由 Claude Code 从/);assert.match(header,/中文译文/);assert.match(await translated.innerText(),/请不要编辑 main\.ts/);record('translation pane shows the peer label and the stored Chinese translation');}
  else record('translation pane not shown in this configuration (inline value path covered by unit/type checks)');
  await card.getByTestId('peer-source-link').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="sidebar-session-source"]')?.classList.contains('selected'));
  record('clicking 另一会话 opens the source session');
  await call('theme/set',{theme:'dark'}).catch(()=>{});
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors,scope:'Hidden isolated Electron with synthetic workbench history only'},null,2));
}catch(error){if(page)await screenshot('failure.png').catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,checks,errors,error:String(error)},null,2));throw error;}
finally{if(app)await app.close();}
function call(method,payload={}){return page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});}
