import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeActivityTracker } from '../packages/collaboration-core/activity';
import { codexFileChanges, diffLineCounts, recordFileChanges, turnFileChanges } from '../packages/collaboration-core/file-changes';
import { conversationTimeline } from '../packages/collaboration-core/timeline';
import { decodeNativeFrame } from '../services/remote-supervisor';
import type { Session } from '../packages/contracts';
const frame=(value:unknown,at='2026-09-26T01:00:02.000Z')=>decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n'),at);
const session=()=>({id:'fixture',messages:[{id:'user-one',role:'user',timestamp:'2026-09-26T01:00:00.000Z'},{id:'answer',role:'assistant',timestamp:'2026-09-26T01:00:03.000Z'}],activities:[]} as unknown as Session);
const event=(id:string,status='completed',diff='--- a/file.ts\n+++ b/file.ts\n@@ -1 +1,2 @@\n-old\n+new\n+++content',method='item/completed')=>({method,params:{turnId:'turn-one',item:{id,type:'fileChange',status,changes:[{path:'file.ts',kind:{type:'update'},diff}]}}});
test('native diff statistics distinguish patch headers, literal plus lines, binary and missing patches',()=>{
  assert.deepEqual(diffLineCounts('--- a\n+++ b\n@@ -1 +1,2 @@\n-old\n+new\n+++content'),{additions:2,deletions:1});
  assert.deepEqual(diffLineCounts('Binary files a and b differ'),{additions:null,deletions:null});assert.deepEqual(diffLineCounts(undefined),{additions:null,deletions:null});
  assert.deepEqual(diffLineCounts('-old\n+new'),{additions:1,deletions:1});
  const changes=codexFileChanges({type:'fileChange',changes:[{path:'old.ts',kind:{type:'update',move_path:'new.ts'},diff:'@@\n-old\n+new'},{path:'binary.bin',kind:{type:'add'}}]})!;
  assert.equal(changes[0]!.path,'new.ts');assert.equal(changes[0]!.previousPath,'old.ts');assert.equal(changes[1]!.additions,null);
  const whole=codexFileChanges({type:'fileChange',changes:[{path:'added.md',kind:{type:'add'},diff:'Heading\n+literal\n'},{path:'deleted.md',kind:{type:'delete'},diff:'Previous\nwording'},{path:'empty.md',kind:{type:'add'},diff:''}]})!;
  assert.equal(whole[0]!.additions,2);assert.equal(whole[0]!.deletions,0);assert.equal(whole[0]!.diff,'+Heading\n++literal');
  assert.equal(whole[1]!.deletions,2);assert.equal(whole[1]!.diff,'-Previous\n-wording');assert.equal(whole[2]!.additions,0);
});
test('file cards exclude pending, failed and declined edits, deduplicate native replays and survive activity pruning',()=>{
  const state=session(),tracker=new NativeActivityTracker('codex');
  for(const activity of tracker.observe(frame(event('edit','inProgress',undefined,'item/started'))))recordFileChanges(state,activity);
  assert.deepEqual(turnFileChanges(state),[]);
  for(const activity of tracker.observe(frame(event('edit'))))recordFileChanges(state,activity);
  for(const activity of tracker.observe(frame(event('edit'))))recordFileChanges(state,activity);
  for(const id of ['failed','declined'])for(const activity of tracker.observe(frame(event(id,id))))recordFileChanges(state,activity);
  assert.equal(state.fileChangeRecords!.length,1);assert.equal(turnFileChanges(state)[0]!.files.length,1);assert.equal(turnFileChanges(state)[0]!.files[0]!.additions,2);
  state.activities=[];assert.equal(turnFileChanges(JSON.parse(JSON.stringify(state)))[0]!.files[0]!.deletions,1);
  assert.deepEqual(conversationTimeline(state).map(item=>item.type),['message','message','changes']);
});
test('successive turns have separate cards and repeated file edits retain each review patch',()=>{
  const state=session(),tracker=new NativeActivityTracker('codex');
  tracker.observe(frame(event('one'))).forEach(activity=>recordFileChanges(state,activity));
  tracker.observe(frame(event('two'))).forEach(activity=>recordFileChanges(state,activity));
  state.messages.push({id:'user-two',role:'user',original:'next',demo:false,timestamp:'2026-09-26T01:01:00.000Z'});
  tracker.observe(frame(event('three'),'2026-09-26T01:01:02.000Z')).forEach(activity=>recordFileChanges(state,activity));
  const groups=turnFileChanges(state);assert.equal(groups.length,2);assert.equal(groups[0]!.files[0]!.edits,2);assert.equal(groups[0]!.files[0]!.additions,4);assert.equal(groups[1]!.files[0]!.edits,1);
  assert.deepEqual(conversationTimeline(state).map(item=>item.type),['message','message','changes','message','changes']);
});
test('Claude only confirms native successful edits and leaves absent counts unknown',()=>{
  const state=session(),tracker=new NativeActivityTracker('claude');
  const start=(id:string)=>({type:'assistant',message:{content:[{type:'tool_use',id,name:'Write',input:{file_path:'story.md',content:'new'}}]}});
  tracker.observe(frame(start('write'))).forEach(activity=>recordFileChanges(state,activity));assert.equal(turnFileChanges(state).length,0);
  tracker.observe(frame({type:'user',message:{content:[{type:'tool_result',tool_use_id:'write',content:'Saved'}]}})).forEach(activity=>recordFileChanges(state,activity));
  assert.equal(turnFileChanges(state)[0]!.files[0]!.additions,null);
  tracker.observe(frame(start('failed')));tracker.observe(frame({type:'user',message:{content:[{type:'tool_result',tool_use_id:'failed',is_error:true,content:'Permission denied'}]}})).forEach(activity=>recordFileChanges(state,activity));assert.equal(state.fileChangeRecords!.length,1);
  tracker.observe(frame(start('structured')));tracker.observe(frame({type:'user',tool_use_result:{structuredPatch:[{lines:['-old','+new','+next']}]},message:{content:[{type:'tool_result',tool_use_id:'structured',content:'Saved'}]}})).forEach(activity=>recordFileChanges(state,activity));
  assert.equal(state.fileChangeRecords![1]!.changes[0]!.additions,2);
});
test('large patch statistics remain accurate and retained review text explicitly reports truncation',()=>{
  const tracker=new NativeActivityTracker('codex'),diff='@@\n'+('+line\n'.repeat(20000));
  const activity=tracker.observe(frame(event('large','completed',diff)))[0]!;
  assert.equal(activity.fileChanges![0]!.additions,20000);assert.equal(activity.fileChanges![0]!.truncated,true);assert.ok(activity.fileChanges![0]!.diff!.length<=65536);
  const item=codexFileChanges({type:'fileChange',changes:[{path:'malicious\u0000.txt',diff:'x'}]});assert.deepEqual(item,[]);
});
test('relative, absolute and renamed paths keep one file identity within the bound turn',()=>{
  const state=session();state.projectPath='D:\\Manuscript';const tracker=new NativeActivityTracker('codex');
  tracker.observe(frame(event('relative'))).forEach(activity=>recordFileChanges(state,activity));
  const absolute=event('absolute');absolute.params.item.changes[0]!.path='d:/Manuscript/file.ts';tracker.observe(frame(absolute)).forEach(activity=>recordFileChanges(state,activity));
  assert.equal(turnFileChanges(state)[0]!.files.length,1);assert.equal(turnFileChanges(state)[0]!.files[0]!.edits,2);
});
