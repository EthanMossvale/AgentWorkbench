// HISTORICAL pre-U70 UI fixture: expects the retired budget/discovery layout.
// Current administration acceptance: node scripts/test-administration-ui.mjs.
// This script is retained as historical coverage, not current passing evidence.
import { openWorkbenchSettings, navigateWorkbench } from './ui-control-helpers.mjs';
import { revealControl } from './ui-control-helpers.mjs';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Renderer-only management contract acceptance. No SSH, images, private keys or real mutations.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'build/qa'),dataDir=path.join(output,`studio-management-${Date.now()}`);
await mkdir(dataDir,{recursive:true});
const env={...process.env,AGENT_WORKBENCH_TEST_DATA:dataDir};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],errors=[];let app,failure;
const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});console.log('PASS '+name);}catch(error){checks.push({name,passed:false,error:error.message});throw error;}};
try{
 app=await electron.launch({executablePath:electronPath,args:[root],cwd:root,env,timeout:30000});
 const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.workbench);
 const state=await page.evaluate(()=>window.workbench.call('state/get'));
 const host=(id,role,username)=>({id,name:id,hostname:'fixture.invalid',port:2222,username,role,identityFile:`C:\\fixture\\${id}`,knownHostsFile:'C:\\fixture\\known_hosts',ownerId:'local-owner',workspaceGeneration:'g'});
 state.hosts=[host('admin','admin','root'),host('alpha','workspace','alpha'),host('beta','workspace','beta')];state.accountCatalogs={};
 await app.evaluate(({ipcMain,BrowserWindow},state)=>{
  const date=new Date().toISOString();
  const workspace={id:'space-alpha',generation:'wg',revision:1,name:'Alpha studio',uid:1000,username:'alpha',root:'/home/alpha/workspaces',environment:{runtimes:['codex','claude'],defaultDirectory:'/home/alpha/workspaces',env:{}},allowedAccountIds:['account-one'],budget:{period:'month',unit:'usd',limit:100,enforcement:'unavailable'},nativeQuota:'unknown',status:'active',devices:[{id:'device-one',label:'Desktop',fingerprint:'SHA256:fixture',publicKey:'fixture-public-key',createdAt:date,status:'active'},{id:'device-two',label:'Laptop',fingerprint:'SHA256:fixture2',publicKey:'fixture-public-key2',createdAt:date,status:'active'}],invites:[],createdAt:date,updatedAt:date};
  const h=globalThis.__studioManagement={state,requests:[],unexpected:[],available:false,revision:1,workspaces:[workspace],plans:{},nextId:1,uncertain:false,save:false,expires:60000,holdPlan:false,pendingPlan:null};
  const snapshot=()=>({availability:h.available?'ready':'unavailable',reason:h.available?undefined:'Synthetic service not deployed',authorityId:'authority',generation:'g',revision:h.revision,workspaces:structuredClone(h.workspaces),connection:{hostname:'fixture.invalid',port:2222,hostPublicKeys:[]},enrollmentUrl:'https://fixture.invalid/enroll'});
  ipcMain.removeHandler('workbench:call');ipcMain.handle('workbench:call',async(_event,method,p={})=>{
   h.requests.push({method,payload:p});const ok=value=>({ok:true,value});
   if(method==='state/get')return ok(h.state);if(method==='navigation/get')return ok({sessionId:null});if(method==='codex-auth/current')return ok(null);
   if(method==='studio/list')return ok(snapshot());
   if(method==='accounts/list')return ok({authorityId:'authority',generation:'g',revision:1,workspaceId:'admin',selectionRevision:0,availability:'ready',accounts:[{id:'account-one',generation:'a1',provider:'codex',status:'authenticated',email:'one@example.invalid',observedAt:date},{id:'account-two',generation:'a2',provider:'codex',status:'authenticated',email:'two@example.invalid',observedAt:date}]});
   if(method==='studio/plan'){
    if(p.expectedRevision!==h.revision)return {ok:false,error:'Synthetic revision conflict'};
    const plan={planId:`plan-${h.nextId++}`,planHash:'a'.repeat(64),operation:p.operation,workspaceId:p.workspaceId??`space-new-${h.nextId}`,expectedRevision:p.expectedRevision,expiresAt:new Date(Date.now()+h.expires).toISOString(),effects:[p.operation==='workspace/delete'?'Remove managed access; preserve user and files.':`Apply ${p.operation} to ${p.workspaceId??p.values?.username}.`]};
    h.plans[plan.planId]={plan,input:structuredClone(p)};
    if(h.holdPlan){h.holdPlan=false;return new Promise(resolve=>{h.pendingPlan=()=>resolve(ok(plan));});}return ok(plan);
   }
   if(method==='studio/apply'){
    const stored=h.plans[p.planId];if(!p.confirm||!stored||stored.used||stored.plan.planHash!==p.planHash)return {ok:false,error:'Invalid or repeated confirmation'};stored.used=true;
    const {operation,workspaceId}=stored.plan,values=stored.input.values??{};
    if(h.uncertain){h.uncertain=false;return ok({operationId:p.planId,state:'uncertain',revision:h.revision,effects:['Receipt remains unconfirmed.']});}
    let w=h.workspaces.find(w=>w.id===workspaceId);
    if(operation==='workspace/create'){w={...structuredClone(workspace),...values,id:workspaceId,username:values.username,devices:[],invites:[]};h.workspaces.push(w);}
    if(operation==='workspace/update')Object.assign(w,values);
    if(operation==='device/revoke')w.devices.find(d=>d.id===values.deviceId).status='revoked';
    if(operation==='workspace/suspend')w.status=values.suspended===false?'active':'suspended';
    if(operation==='workspace/delete')w.status='deleted';
    h.revision++;
    return ok({operationId:p.planId,state:'applied',revision:h.revision,workspace:w,effects:stored.plan.effects,...(operation==='invite/create'?{inviteExportId:'opaque-export-id'}:{})});
   }
   if(method==='studio/operation')return ok({operationId:p.operationId,state:'applied',revision:h.revision,effects:['Observed completed state without reapplying.']});
   if(method==='studio/invite-export')return ok(h.save?{saved:true,path:'C:\\fixture\\workspace.awworkspace'}:{saved:false});
   h.unexpected.push(method);return {ok:false,error:'Unexpected synthetic IPC '+method};
  });
 },state);
 await page.reload();await navigateWorkbench(page,'connections');
 const count=method=>app.evaluate((_e,m)=>globalThis.__studioManagement.requests.filter(r=>r.method===m).length,method);
 const configure=patch=>app.evaluate((_e,p)=>Object.assign(globalThis.__studioManagement,p),patch);
 const click=async id=>{await revealControl(page,id);await page.getByTestId(id).click();};
 const waitAvailable=()=>page.locator('[data-testid="studio-snapshot"][data-availability="ready"]').waitFor();
 const apply=async()=>{await click('studio-apply');await page.locator('[data-testid="studio-result"][data-state="applied"]').waitFor();await page.getByTestId('studio-refresh').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[data-testid="studio-refresh"]').disabled);};
 await check('admin is the parent of members and management does not load or mutate automatically',async()=>{
  assert.equal(await page.getByTestId('host-children-admin').getByTestId('host-alpha').count(),1);assert.equal(await page.getByTestId('host-children-admin').getByTestId('host-beta').count(),1);
  assert.equal(await count('studio/list'),0);assert.equal(await count('studio/apply'),0);
  assert.equal(await page.getByTestId('workspace-activate').count(),0);
  await click('new-session');await page.getByTestId('composer-runtime').selectOption('codex');assert.equal(await page.getByTestId('composer-host').count(),0);assert.match(await page.getByTestId('composer-workspace-label').innerText(),/SSH/);
  await navigateWorkbench(page,'connections');
 });
 await check('unavailable management keeps mutation controls unavailable without fake success',async()=>{await click('studio-refresh');await page.locator('[data-testid="studio-snapshot"][data-availability="unavailable"]').waitFor();assert.equal(await page.getByTestId('studio-create').count(),0);assert.equal(await count('studio/apply'),0);});
 await check('ready spaces display advisory budgets separately from unknown provider quota',async()=>{await configure({available:true});await click('studio-refresh');await waitAvailable();const text=await page.getByTestId('studio-workspace-detail').innerText();assert.match(text,/\$100 \/ 月/);assert.match(text,/未接计量或执行/);assert.match(text,/未知/);assert.equal(await page.getByTestId('studio-adopt').isDisabled(),true);});
 await check('editing account and budget values requires one exact preview and explicit confirmation',async()=>{
  await click('studio-edit');await revealControl(page,'studio-allowed-accounts');await page.getByTestId('studio-allowed-accounts').fill('account-two');await page.getByTestId('studio-budget').fill('250');await click('studio-plan-request');await page.getByTestId('studio-plan').waitFor();assert.equal(await count('studio/apply'),0);
  await page.getByTestId('studio-apply').evaluate(button=>{button.click();button.click();});await page.locator('[data-testid="studio-result"][data-state="applied"]').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-testid="studio-refresh"]').disabled);
  assert.equal(await count('studio/apply'),1);assert.match(await page.getByTestId('studio-workspace-detail').innerText(),/\$250 \/ 月/);assert.match(await page.getByTestId('studio-workspace-detail').innerText(),/account-two/);
 });
 await check('returning to edit invalidates an old plan and expired plans cannot apply',async()=>{
  await click('studio-edit');await configure({expires:300});await click('studio-plan-request');await page.getByTestId('studio-plan').waitFor();await page.waitForFunction(()=>document.querySelector('[data-testid="studio-apply"]').disabled);assert.equal(await count('studio/apply'),1);
  await click('studio-plan-back');await page.getByTestId('studio-budget').fill('300');assert.equal(await page.getByTestId('studio-apply').count(),0);await page.getByRole('button',{name:'取消',exact:true}).click();await configure({expires:60000});
 });
 await check('creation accepts a server-generated workspace id and applies only the confirmed member',async()=>{
  await click('studio-create');await page.getByTestId('studio-name').fill('New studio');await page.getByTestId('studio-username').fill('new_member');assert.equal(await page.getByTestId('studio-root').inputValue(),'/home/new_member/workspaces');await click('studio-plan-request');await page.getByTestId('studio-plan').waitFor();await apply();assert.equal(await page.getByRole('button',{name:/New studio.*new_member/}).count(),1);
 });
 await check('invite export passes only an opaque id and a cancelled save can be retried',async()=>{
  await click('studio-workspace-space-alpha');await click('studio-invite-create');await page.getByTestId('studio-invite-label').fill('New laptop');await click('studio-plan-request');await page.getByTestId('studio-plan').waitFor();await apply();await page.getByTestId('studio-invite-export').waitFor();assert.equal(await count('studio/invite-export'),1);await configure({save:true});await click('studio-invite-export');await page.getByTestId('studio-invite-saved').waitFor();assert.equal(await count('studio/invite-export'),2);
  const exported=await app.evaluate(()=>globalThis.__studioManagement.requests.filter(r=>r.method==='studio/invite-export'));for(const request of exported)assert.deepEqual(request.payload,{id:'admin',inviteExportId:'opaque-export-id'});
 });
 await check('revoking one device leaves its sibling active',async()=>{await click('studio-revoke-device-device-one');await page.getByTestId('studio-plan').waitFor();await apply();assert.equal(await page.getByTestId('studio-revoke-device-device-one').isDisabled(),true);assert.equal(await page.getByTestId('studio-revoke-device-device-two').isEnabled(),true);});
 await check('an uncertain result is queried without any automatic apply retry',async()=>{
  await configure({uncertain:true});await click('studio-suspend');await page.getByTestId('studio-plan').waitFor();await click('studio-apply');await page.locator('[data-testid="studio-result"][data-state="uncertain"]').waitFor();const before=await count('studio/apply');await click('studio-operation-check');await page.locator('[data-testid="studio-result"][data-state="applied"]').waitFor();assert.equal(await count('studio/apply'),before);assert.equal(await count('studio/operation'),1);
 });
 await check('late plans are discarded when changing to a member and the member has no admin panel',async()=>{
  await click('studio-edit');await configure({holdPlan:true});await click('studio-plan-request');await app.evaluate(()=>{if(!globalThis.__studioManagement.pendingPlan)throw new Error('Missing pending plan');});
  // Programmatic DOM click models changing the connection while a request is in flight.
  await page.getByTestId('host-beta').evaluate(button=>button.click());await page.locator('[data-testid="host-beta"][aria-pressed="true"]').waitFor();await page.getByTestId('studio-panel').waitFor({state:'hidden'});await app.evaluate(()=>{globalThis.__studioManagement.pendingPlan();globalThis.__studioManagement.pendingPlan=null;});assert.equal(await page.getByTestId('studio-panel').count(),0);assert.equal(await page.getByTestId('studio-plan').count(),0);
 });
 await check('management fits the minimum window and has no renderer or unexpected IPC errors',async()=>{
  await click('host-admin');await click('studio-refresh');await waitAvailable();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(860,640));
  const bounds=await page.getByTestId('studio-panel').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:innerWidth}));assert.ok(bounds.scroll<=bounds.width+1&&bounds.right<=bounds.viewport,JSON.stringify(bounds));assert.deepEqual(errors,[]);assert.deepEqual(await app.evaluate(()=>globalThis.__studioManagement.unexpected),[]);
 });
}catch(error){failure={message:error.message,stack:error.stack};throw error;}finally{if(app)await app.close();await writeFile(path.join(output,'studio-management-ui-report.json'),JSON.stringify({observedAt:new Date().toISOString(),screenshots:false,syntheticOnly:true,checks,errors,...(failure?{failure}:{})},null,2));}
console.log(`Studio management UI: ${checks.length}/${checks.length} passed; screenshots=false; syntheticOnly=true`);
