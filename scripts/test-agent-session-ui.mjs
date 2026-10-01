import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build as buildHost } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { mkdir,writeFile,cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

// Actual native executables, an isolated hidden desktop, and synthetic inference only.
const root=process.cwd(),output=path.resolve(process.env.AWB_AGENT_SESSION_QA??'build/qa/agent-session-ui'),appRoot=path.join(output,'app'),data=path.join(output,'data-'+Date.now()),projectPath=path.join(data,'project');
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Supply both installed QA CLI executables.');
await mkdir(projectPath,{recursive:true});await mkdir(path.join(data,'native-home','.codex'),{recursive:true});await mkdir(path.join(data,'native-home','.claude'),{recursive:true});
const checks=[],errors=[],calls=[],stages=new Map();let app,page,createdProject;
const authorization='Can you open a new session in the MOD project and send something random? This is a test.';
const explicitAuthorization='Open a new session in the MOD project using Alternate fixture with high reasoning effort and send a test task.';
const finished=text=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:100,completion_tokens:10}});
const tool=(id,name,args)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
const server=createServer(async(req,res)=>{
  try{
    let raw='';for await(const part of req)raw+=part;res.setHeader('content-type','application/json');
    if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[]}));return;}
    const body=JSON.parse(raw),messages=body.messages??[],user=messages.findLast(m=>m.role==='user'),last=messages.filter(m=>m.role!=='system').at(-1),userText=JSON.stringify(user);
    if(!body.tools?.length){res.end(JSON.stringify(finished('Auxiliary response.')));return;}
    if(userText.includes('INDEPENDENT_TASK_')){const tag=userText.match(/INDEPENDENT_TASK_([a-z-]+)/)[1],explicit=tag.endsWith('-explicit');assert.equal(body.model,explicit?'alternate-model':'fixture-model');assert.equal(body.reasoning_effort,explicit?'high':'low');res.end(JSON.stringify(finished('INDEPENDENT_COMPLETE_'+tag)));return;}
    const tag=userText.match(/ROOT_([a-z-]+)/)?.[1]??'claude-default',runtime=tag.split('-')[0],explicit=tag.endsWith('-explicit'),stage=stages.get(tag)??0;
    const invoke=(suffix,args)=>{const definition=body.tools.find(t=>t.function.name===suffix||t.function.name.endsWith('__'+suffix));assert.ok(definition,'Native discovery: '+suffix);calls.push({runtime,scenario:tag,name:suffix});stages.set(tag,stage+1);res.end(JSON.stringify(tool('session-'+tag+'-'+stage,definition.function.name,args)));};
    if(stage===0){invoke('workbench_list_projects',{query:'MOD'});return;}
    assert.equal(last.role,'tool');
    if(stage===1&&explicit){assert.match(last.content,/MOD/);invoke('workbench_list_model_targets',{});return;}
    if(stage===(explicit?2:1)){const target=explicit?JSON.parse(last.content).targets.find(t=>t.name==='Alternate fixture'&&t.id.endsWith('/'+runtime)):undefined;if(explicit)assert.ok(target);else assert.match(last.content,/MOD/);invoke('workbench_create_session',{projectId:createdProject.id,title:'Created '+tag+' chat',task:'INDEPENDENT_TASK_'+tag,operationId:'create-'+tag,authorizationQuote:explicit?explicitAuthorization:authorization,...(explicit?{targetId:target.id,effort:'high'}:{})});return;}
    if(stage===(explicit?3:2)){const result=JSON.parse(last.content);assert.equal(result.state,'started',last.content);assert.ok(result.sessionId);invoke('workbench_read_session',{sessionId:result.sessionId});return;}
    assert.match(last.content,/Created/);res.end(JSON.stringify(finished('ROOT_COMPLETE_'+tag)));
  }catch(error){errors.push(String(error));res.end(JSON.stringify(finished('FIXTURE_FAILED')));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const at='2026-09-28T00:00:00Z';
const child=(id,title,runtime,settings)=>({nativeChildId:id,title,runtime,settings,task:'Review the fixture.',operation:'completed',status:'completed',updatedAt:at,startedAt:at,messages:[{id:'reply-'+id,role:'assistant',text:'Fixture complete.',complete:true,at,updatedAt:at}]});
const children=[child('native','原生参数','codex',{model:{value:'codex-child-fixture',source:'native'},effort:{value:'high',source:'native'},fast:{value:true,source:'native'}}),child('requested','请求参数','claude',{model:{value:'long-requested-model-name-with-a-separate-native-identity',source:'requested'},effort:{value:'medium',source:'requested'},fast:{value:false,source:'requested'}}),child('mapped','API 映射','claude',{model:{value:'upstream-fixture',source:'provider'},effort:{value:'max',source:'provider'}}),child('unknown','历史未知','codex',{})];
await writeFile(path.join(data,'state.json'),JSON.stringify({version:1,theme:'light',lastSelectedRuntime:'demo',projects:[],hosts:[],profiles:[],plugins:{translation:{enabled:false}},translation:{id:'translation-default',name:'Unused',baseUrl:'https://example.invalid',protocol:'responses',model:'',verifiedEfforts:[],consent:false,hasKey:false,maxCharacters:16000,maxCalls:100,timeoutMs:30000},sessions:[{id:'fixture',title:'子 Agent 参数验收',projectId:null,projectPath,status:'idle',pinned:false,archived:false,group:'',createdAt:at,binding:{runtime:'demo',provider:'demo',accountRef:'demo',executionId:'local-device',egress:'demo'},messages:[{id:'parent-message',role:'assistant',original:'Synthetic child metadata.',timestamp:at,demo:false}],modelSelection:{model:'different-parent',effort:'low',serviceTier:'priority'},nativeChildren:children}]}));
await buildRenderer({configFile:path.join(root,'vite.config.ts'),build:{outDir:path.join(appRoot,'renderer'),emptyOutDir:true},logLevel:'warn'});
for(const entry of ['main','preload'])await buildHost({entryPoints:[`apps/desktop/host/${entry}.ts`],outfile:path.join(appRoot,`host/${entry}.cjs`),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await cp('services/vps-workspace-control',path.join(appRoot,'host/workspace-control'),{recursive:true});await cp('services/vps-account-broker',path.join(appRoot,'host/account-runtime'),{recursive:true});
await writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'awb-agent-session-qa',version:'1.0.0',main:'host/main.cjs'}));
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:data,AGENT_WORKBENCH_TEST_HIDDEN:'1',AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE:process.env.AWB_QA_CODEX,AGENT_WORKBENCH_TEST_CLAUDE_EXECUTABLE:process.env.AWB_QA_CLAUDE};delete env.ELECTRON_RUN_AS_NODE;
const call=(method,payload={})=>page.evaluate(({method,payload})=>window.workbench.call(method,payload),{method,payload});
const record=name=>{checks.push(name);console.log('PASS '+name);};
const wait=async(fn,label)=>{const until=Date.now()+60000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw Error('Timed out: '+label);};
const launch=async()=>{app=await electron.launch({executablePath:electronPath,args:[appRoot],cwd:root,env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,860));};
const select=async id=>{await page.getByTestId('sidebar-session-'+id).locator('.session-select').click();await page.getByTestId('composer-input').waitFor();};
try{
  await launch();await select('fixture');
  for(const [id,model,effort,fast] of [['native','codex-child-fixture','思考 高','Fast 开启'],['requested','请求 · long-requested-model-name-with-a-separate-native-identity','思考 中（请求）','Fast 关闭（请求）'],['mapped','API · upstream-fixture','思考 最高','Fast 未知'],['unknown','模型未知','思考 未知','Fast 未知']]){
    await page.getByTestId('original-pane').getByRole('button',{name:'查看子会话：'+children.find(c=>c.nativeChildId===id).title,exact:true}).click();
    const reader=page.getByTestId('child-reader'),settings=reader.getByTestId('child-model-settings');
    assert.equal(await settings.getByTestId('child-model').innerText(),model);assert.equal(await settings.getByTestId('child-effort').innerText(),effort);assert.equal(await settings.getByTestId('child-fast').innerText(),fast);assert.equal(await settings.locator('button,input,select').count(),0);
    await call('theme/set',{theme:id==='requested'?'dark':'light'});await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),id==='requested'?[860,640]:[1280,860]);
    const geometry=await settings.evaluate(node=>{const r=node.getBoundingClientRect(),h=node.closest('header').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,headerRight:h.right,headerTop:h.top,overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(geometry.right<=geometry.headerRight&&geometry.top>=geometry.headerTop&&!geometry.overflow);
    await page.screenshot({path:path.join(output,'settings-'+id+'.png')});await reader.getByRole('button',{name:'关闭子会话面板',exact:true}).click();record(id+': header parameters and provenance, no parent fallback or edit controls');
  }
  createdProject=await call('project/create',{name:'MOD',path:projectPath});
  const connection=await call('model-api/save',{connection:{name:'Synthetic native source',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'chat-completions',models:[{id:'fixture',model:'fixture-model',name:'Fixture',enabled:true,contextWindow:128000,manualEfforts:['low','high'],defaultEffort:'low'},{id:'alternate',model:'alternate-model',name:'Alternate fixture',enabled:true,contextWindow:128000,manualEfforts:['medium','high'],defaultEffort:'medium'}]},key:'synthetic-only'});
  for(const runtime of ['codex','claude'])for(const mode of ['default','explicit']){
    const tag=runtime+'-'+mode;
    const target=(await call('model-targets/list')).find(t=>t.runtime===runtime&&t.binding.modelConnectionId===connection.id&&t.binding.modelMappingId==='fixture');assert.ok(target?.ready);
    const chat=await call('session/create',{modelTargetId:target.id,projectPath,permissionMode:'full-access'});await select(chat.id);
    const preview=await call('draft/prepare',{sessionId:chat.id,text:(mode==='explicit'?explicitAuthorization:authorization)+' ROOT_'+tag});await call('draft/submit',{sessionId:chat.id,id:preview.id,sourceHash:preview.sourceHash});
    await wait(async()=>{const s=(await call('state/get')).sessions;return s.find(x=>x.id===chat.id)?.messages.some(m=>m.original==='ROOT_COMPLETE_'+tag)&&s.find(x=>x.title==='Created '+tag+' chat')?.messages.some(m=>m.original==='INDEPENDENT_COMPLETE_'+tag)&&s.every(x=>x.status==='idle');},tag+' independent chat completion');
    const state=await call('state/get'),created=state.sessions.filter(s=>s.title==='Created '+tag+' chat');assert.equal(created.length,1);assert.equal(created[0].projectId,createdProject.id);assert.equal(created[0].binding.runtime,runtime);assert.equal(created[0].agentParent,undefined);assert.equal(state.chatCreations.find(op=>op.sourceSessionId===chat.id).state,'started');assert.deepEqual(created[0].modelSelection,mode==='explicit'?{model:'alternate-model',effort:'high'}:{model:'fixture-model',effort:'low'});
    await select(created[0].id);await page.getByTestId('original-pane').getByText('INDEPENDENT_COMPLETE_'+tag,{exact:true}).waitFor();await page.screenshot({path:path.join(output,'created-'+tag+'.png')});record(tag+': installed CLI creates one independent sidebar chat and reads it; upstream request and stored model/effort match '+mode+' selection');
  }
  const before=(await call('state/get')).sessions.length;await app.close();app=undefined;await launch();assert.equal((await call('state/get')).sessions.length,before);assert.equal((await call('state/get')).chatCreations.length,4);record('restart preserves four independent chats and operation receipts without new model runs');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors,calls,scope:'Hidden isolated Electron, actual installed native CLIs, synthetic loopback inference and metadata fixtures. No private profiles, commercial model or SSH proof.'},null,2));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,checks,errors,calls,error:String(error)},null,2));throw error;}
finally{if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
