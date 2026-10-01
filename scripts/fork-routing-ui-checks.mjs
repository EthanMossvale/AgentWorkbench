import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {encodeZip} from '../packages/native-resources/archive.ts';

// Uses the isolated production Electron host from test-session-fork-ui.mjs.
export async function checkForkRouting({app,page,call,select,snapshot,record,output,source,plain,unborn}) {
  const wait=async check=>{for(let n=0;n<200;n++){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Fork routing did not settle');};
  const count=async id=>(await call('state/get')).sessions.filter(s=>s.branch?.sourceSessionId===id).length;
  const picker=page.getByTestId('fork-location-picker'),trigger=page.getByTestId('session-fork-submenu');
  const close=async()=>{await page.keyboard.press('Escape');};
  const watch=()=>page.evaluate(()=>{
    window.__forkWatch?.observer.disconnect();const q=window.__forkWatch={pickers:0,menus:0};
    q.observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof Element){
      if(node.matches('[data-testid="fork-location-picker"]')||node.querySelector('[data-testid="fork-location-picker"]'))q.pickers++;
      if(node.matches('[data-testid="session-fork-menu"]')||node.querySelector('[data-testid="session-fork-menu"]'))q.menus++;
    }});q.observer.observe(document.body,{childList:true,subtree:true});
  });
  const noChoices=async()=>assert.deepEqual(await page.evaluate(()=>({pickers:window.__forkWatch.pickers,menus:window.__forkWatch.menus})),{pickers:0,menus:0});
  const branched=async(id,before)=>{await wait(async()=>(await count(id))===before+1);await page.getByTestId('branch-origin').waitFor();};
  await select('plain-folder');await watch();let before=await count('plain-folder');
  await page.getByTestId('fork-message-a1').evaluate(button=>{button.click();button.click();button.click();});
  await branched('plain-folder',before);await noChoices();
  const child=(await call('state/get')).sessions.find(s=>s.branch?.sourceSessionId==='plain-folder');
  assert.equal(child.projectPath,plain);assert.deepEqual(child.messages.map(m=>m.id),['u1','a1']);assert.equal(child.branch.location,'workspace');assert.equal(child.worktree,undefined);await assert.rejects(access(path.join(plain,'.git')));
  await snapshot('plain-direct-dark-narrow');record('plain project reply forks directly once without even mounting a location picker or creating Git metadata');

  await select('plain-folder');await watch();before=await count('plain-folder');
  await page.getByTestId('sidebar-session-plain-folder').click({button:'right'});await wait(()=>trigger.isEnabled());await trigger.hover();
  assert.equal(await trigger.getAttribute('aria-haspopup'),null);await snapshot('plain-menu-dark-narrow');await trigger.click();await branched('plain-folder',before);await noChoices();
  record('plain project sidebar is a single-click branch action without an empty submenu');
  await select('plain-folder');await watch();before=await count('plain-folder');
  await page.getByTestId('sidebar-session-plain-folder').locator('.session-select').focus();await page.keyboard.press('Shift+F10');await wait(()=>trigger.isEnabled());await trigger.focus();await page.keyboard.press('Enter');await branched('plain-folder',before);await noChoices();
  record('plain project sidebar supports direct keyboard creation');
  await select('no-folder');await watch();before=await count('no-folder');await page.getByTestId('fork-message-a1').click();await branched('no-folder',before);await noChoices();
  record('a conversation without a bound folder also skips the location picker');

  await select('unborn-repo');await page.getByTestId('fork-message-a1').click();await picker.waitFor();await page.waitForFunction(()=>document.querySelector('[data-testid="fork-worktree"]')?.textContent?.includes('尚无提交'));
  assert.equal(await page.getByTestId('fork-worktree').isDisabled(),true);assert.equal(await page.getByTestId('fork-here').isEnabled(),true);
  assert.equal((await call('session/fork-options',{sessionId:'unborn-repo'})).worktree.repositoryRoot,unborn);await snapshot('unborn-git-picker-dark-narrow');await close();
  record('a recognized Git repository with no commits retains the chooser and its specific unavailable reason');

  const toggle=(plugin,enabled)=>call('extensions/toggle',{id:plugin.manifest.id,hash:plugin.hash,enabled,...(enabled?{approveHost:true}:{})});
  const importPlugin=async(id,renderer,main)=>{
    const manifest={schemaVersion:1,apiVersion:1,id,name:id,description:'Synthetic fork routing acceptance',version:'1.0.0',capabilities:['host'],renderer:'renderer.mjs',...(main?{main:'main.mjs'}:{})};
    const file=path.join(output,id+'.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'renderer.mjs',data:Buffer.from(renderer)},...(main?[{name:'main.mjs',data:Buffer.from(main)}]:[])]));
    await call('extensions/import',{filePath:file});return(await call('extensions/list')).find(p=>p.manifest.id===id);
  };
  const main=`export function activate(api){
    const q=globalThis.__forkPolicy={mode:'core',delay:0,inspections:0,forks:[]};
    api.services.intercept('actions.worktrees','inspect',async(next,directory)=>{q.inspections++;if(q.delay)await new Promise(r=>setTimeout(r,q.delay));if(q.mode==='workspace')return {available:false,reason:'Synthetic single-location policy'};if(q.mode==='error')throw Error('Synthetic inspection failure');return next(directory);});
    api.useHost(async(request,next)=>{if(request.method==='session/fork')q.forks.push(request.payload);if(request.method==='session/fork-options'&&q.mode==='blocked')return {workspace:{available:false,reason:'Synthetic blocked source'},worktree:{available:false}};return next();});
  }`;
  const policy=await importPlugin('qa.fork-policy','export function activate(){}',main);
  await assert.rejects(call('extensions/toggle',{id:policy.manifest.id,hash:policy.hash,enabled:true}),/approval/i);await toggle(policy,true);
  await app.evaluate(()=>globalThis.__forkPolicy.mode='workspace');await select(source);await watch();before=await count(source);await page.getByTestId('fork-message-a1').click();await branched(source,before);await noChoices();
  assert.equal(await app.evaluate(()=>globalThis.__forkPolicy.forks.at(-1).location),'workspace');record('an approved host plugin can replace inspection policy and the real renderer consumes it');

  for(const mode of ['blocked','error']){
    await app.evaluate((_,mode)=>globalThis.__forkPolicy.mode=mode,mode);await select('plain-folder');await watch();before=await count('plain-folder');await page.getByTestId('fork-message-a1').click();
    await page.locator('.error-banner').filter({hasText:mode==='blocked'?'Synthetic blocked source':'Synthetic inspection failure'}).waitFor();assert.equal(await count('plain-folder'),before);await noChoices();
  }
  record('unavailable sources and inspection failures never auto-create a conversation');
  await app.evaluate(()=>Object.assign(globalThis.__forkPolicy,{mode:'workspace',delay:500}));await select('plain-folder');await watch();before=await count('plain-folder');
  const inspections=await app.evaluate(()=>globalThis.__forkPolicy.inspections);await page.getByTestId('fork-message-a1').click();await wait(async()=>await app.evaluate(()=>globalThis.__forkPolicy.inspections)>inspections);await select('no-folder');await page.waitForTimeout(650);
  assert.equal(await count('plain-folder'),before);await noChoices();record('late inspection results are discarded after changing conversations');
  await app.evaluate(()=>globalThis.__forkPolicy.delay=0);await toggle(policy,false);await select(source);await page.getByTestId('fork-message-a1').click();await picker.waitFor();await close();
  await toggle(policy,true);await app.evaluate(()=>globalThis.__forkPolicy.mode='workspace');await select(source);await watch();before=await count(source);await page.getByTestId('fork-message-a1').click();await branched(source,before);await noChoices();await toggle(policy,false);
  record('disable and re-enable restore and reapply host policy without reverting existing forks');

  const renderer=id=>`export function activate(api){
    const q=(window.__forkViews??={})['${id}']={mounts:0,cleaned:0,aborted:0,lateCleaned:0,late:[],calls:[]};
    api.observeSurfaces('session-fork-action','replace',({root,target,signal})=>{q.mounts++;const button=document.createElement('button');button.dataset.qaFork='${id}';button.textContent='扩展创建分支';button.addEventListener('click',async()=>{const payload={sessionId:target.dataset.sessionId,messageId:target.dataset.messageId||undefined};const options=await api.call('session/fork-options',payload);if(options.workspace.available)q.calls.push(await api.call('session/fork',{...payload,location:'workspace'}));},{signal});root.append(button);signal.addEventListener('abort',()=>q.aborted++,{once:true});return()=>q.cleaned++;});
    api.observeSurfaces('session-fork-picker','after',async({root,signal})=>{root.dataset.qaPicker='${id}';root.textContent='扩展分支选项';await new Promise(resolve=>q.late.push(resolve));return()=>q.lateCleaned++;});
  }`;
  await select(source);await page.getByTestId('fork-message-a1').click();await picker.waitFor();
  const first=await importPlugin('qa.fork-view-one',renderer('one'));await toggle(first,true);await page.locator('[data-qa-picker="one"]').waitFor();
  assert.equal(await page.getByTestId('fork-message-a1').isVisible(),false);await close();await select('plain-folder');await page.locator('[data-qa-fork="one"]').first().waitFor();before=await count('plain-folder');await page.locator('[data-qa-fork="one"]').first().click();await wait(async()=>(await count('plain-folder'))===before+1);
  await page.getByTestId('sidebar-session-plain-folder').click({button:'right'});await wait(async()=>await page.locator('[data-qa-fork="one"]').count()===3);await close();
  const second=await importPlugin('qa.fork-view-two',renderer('two'));await toggle(second,true);await page.locator('[data-qa-fork="two"]').first().waitFor();assert.equal(await page.locator('[data-qa-fork="one"]').first().isVisible(),false);
  await toggle(first,false);await wait(async()=>await page.locator('[data-qa-fork="one"]').count()===0);assert.equal(await page.locator('[data-qa-fork="two"]').first().isVisible(),true);
  await page.evaluate(()=>window.__forkViews.one.late.splice(0).forEach(resolve=>resolve()));await wait(()=>page.evaluate(()=>window.__forkViews.one.lateCleaned>0));
  assert.equal(await page.evaluate(()=>window.__forkViews.one.cleaned===window.__forkViews.one.mounts&&window.__forkViews.one.aborted===window.__forkViews.one.mounts),true);
  await toggle(second,false);await page.getByTestId('fork-message-a1').waitFor({state:'visible'});
  await toggle(first,true);await page.locator('[data-qa-fork="one"]').first().waitFor();await toggle(first,false);await page.getByTestId('fork-message-a1').waitFor({state:'visible'});
  const failed=await importPlugin('qa.fork-failed',`export function activate(api){api.observeSurfaces('session-fork-action','replace',({root})=>{root.textContent='must be removed';});throw Error('Synthetic activation failure');}`);
  await toggle(failed,true);await wait(async()=>!(await call('extensions/list')).find(p=>p.manifest.id===failed.manifest.id).enabled);await page.getByTestId('fork-message-a1').waitFor({state:'visible'});assert.equal(await page.getByText('must be removed',{exact:true}).count(),0);await toggle(failed,false);
  record('approved view plugins reach existing and later action/picker instances, call fork, coexist and restore after disable, late completion and activation failure');
  await page.evaluate(()=>window.__forkWatch.observer.disconnect());
}
