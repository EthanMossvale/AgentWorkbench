import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {acknowledgePluginRepairDraft,buildPluginRepairPrompt,readPluginRepairDraft,readRecoveryLanguage,recoveryDiagnostic,repairLanguage,savePluginRepairDraft,writeRecoveryLanguage} from '../packages/plugins-core/repair-draft';
import type {RecoverySnapshot} from '../packages/plugins-core/recovery';

const snapshot:RecoverySnapshot={schemaVersion:1,hostVersion:'2.0.0',previousHostVersion:'1.0.0',safeMode:true,boot:'ready',pending:[],incidents:[{id:'test.old',name:'PRIVATE_DISPLAY_NAME',key:'fixture',version:'1.2.0',hash:'a'.repeat(64),code:'SERVICE_MEMBER_UNAVAILABLE',phase:'compatibility',certainty:'confirmed',at:'2026-09-29T00:00:00.000Z',hostVersion:'2.0.0',repairable:false,issues:[{code:'SERVICE_MEMBER_UNAVAILABLE',service:'core.fixture',member:'oldMethod',repairable:false}]}]};
async function temporary(t:test.TestContext){const directory=await mkdtemp(path.join(os.tmpdir(),'awb-repair-draft-'));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return directory;}
test('repair prompts use Chinese for Chinese UI and English for every other language',()=>{
  for(const language of ['zh','zh-CN','zh-TW','ZH_hans']){assert.equal(repairLanguage(language),'zh');assert.match(buildPluginRepairPrompt(snapshot,language),/请检查并修复/);}
  for(const language of ['en','ja','fr','de','ar','',null,undefined]){assert.equal(repairLanguage(language),'en');assert.match(buildPluginRepairPrompt(snapshot,language),/^Inspect and repair/);}
  const prompt=buildPluginRepairPrompt(snapshot,'zh-CN');assert.match(prompt,/test\.old/);assert.match(prompt,/oldMethod/);assert.match(prompt,/SERVICE_MEMBER_UNAVAILABLE/);assert.match(prompt,/是否发送由用户选择/);assert.doesNotMatch(prompt,/PRIVATE_DISPLAY_NAME/);
});
test('diagnostic export bounds metadata and omits package labels and unknown fields',()=>{
  const result=recoveryDiagnostic({...snapshot,...{password:'DO_NOT_COPY'},incidents:Array(100).fill(snapshot.incidents[0])});
  assert.equal(result.incidents.length,50);assert.equal(result.diagnosticScope.olderRecordsMayBeOmitted,true);assert.equal(result.diagnosticScope.unobservedPlugins,'not_checked');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DISPLAY_NAME|DO_NOT_COPY/);
});
test('one bounded draft includes every retained plugin and marks omitted issue details',async t=>{
  const issue={code:'SERVICE_MEMBER_UNAVAILABLE' as const,service:'s'.repeat(120),member:'m'.repeat(120),expected:Number.MAX_SAFE_INTEGER,actual:Number.MAX_SAFE_INTEGER,repairable:false};
  const value:RecoverySnapshot={...snapshot,hostVersion:'1'.repeat(40),previousHostVersion:'2'.repeat(40),pending:Array.from({length:128},(_,i)=>({id:'test.pending-'+i,hash:'a'.repeat(64),version:'1'.repeat(40),phase:'host'})),incidents:Array.from({length:50},(_,i)=>({...snapshot.incidents[0]!,id:'test.batch-'+i+'x'.repeat(65),code:'E'.repeat(80),hostVersion:'1'.repeat(40),previousHostVersion:'2'.repeat(40),version:'3'.repeat(40),issues:Array(20).fill(issue)}))};
  const diagnostic=recoveryDiagnostic(value);assert.equal(diagnostic.incidents.length,50);assert.equal(diagnostic.pending.length,32);assert.equal(diagnostic.incidents[0]!.issues!.length,2);assert.equal(diagnostic.incidents[0]!.additionalIssueCount,18);
  const directory=await temporary(t);
  for(const language of ['zh-CN','ja-JP']){const prompt=buildPluginRepairPrompt(value,language);assert.ok(Buffer.byteLength(prompt)<96*1024);for(const incident of value.incidents)assert.ok(prompt.includes(incident.id));await savePluginRepairDraft(directory,prompt,language);assert.equal((await readPluginRepairDraft(directory))?.text,prompt);}
  assert.match(buildPluginRepairPrompt(value,'zh'),/不要只修第一个/);assert.match(buildPluginRepairPrompt(value,'en'),/one batch/);assert.match(buildPluginRepairPrompt(value,'en'),/not checked/);
});
test('UI language persists separately and defaults to the current Chinese interface',async t=>{
  const directory=await temporary(t);assert.equal(await readRecoveryLanguage(directory),'zh');await writeRecoveryLanguage(directory,'ja-JP');assert.equal(await readRecoveryLanguage(directory),'en');await writeRecoveryLanguage(directory,'zh-Hans');assert.equal(await readRecoveryLanguage(directory),'zh');await assert.rejects(writeRecoveryLanguage(directory,''),/PLUGIN_UI_LANGUAGE_INVALID/);
});
test('pending repair draft survives restart until matching insertion acknowledgement',async t=>{
  const directory=await temporary(t),draft=await savePluginRepairDraft(directory,buildPluginRepairPrompt(snapshot,'zh'),'zh');
  assert.deepEqual(await readPluginRepairDraft(directory),draft);await assert.rejects(acknowledgePluginRepairDraft(directory,'stale'),/PLUGIN_REPAIR_DRAFT_CHANGED/);assert.deepEqual(await readPluginRepairDraft(directory),draft);
  await acknowledgePluginRepairDraft(directory,draft.id);assert.equal(await readPluginRepairDraft(directory),null);
  const next=await savePluginRepairDraft(directory,'Next user-requested repair','en');await assert.rejects(acknowledgePluginRepairDraft(directory,draft.id),/PLUGIN_REPAIR_DRAFT_CHANGED/);assert.deepEqual(await readPluginRepairDraft(directory),next);
});
test('corrupt and oversized repair drafts fail without being interpreted as a task',async t=>{
  const directory=await temporary(t);assert.equal(await readPluginRepairDraft(directory),null);await writeFile(path.join(directory,'plugin-repair-draft.json'),'{broken');await assert.rejects(readPluginRepairDraft(directory),/PLUGIN_REPAIR_DRAFT_INVALID/);
  await assert.rejects(savePluginRepairDraft(directory,'a'.repeat(100*1024),'zh'),/PLUGIN_REPAIR_DRAFT_TOO_LARGE/);
});
