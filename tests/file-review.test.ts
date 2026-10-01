import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, splitDiffLines } from '../packages/collaboration-core/diff-view';
import { claudeCompletedChanges, mergeTurnFileChanges, type TurnFileChanges } from '../packages/collaboration-core/file-changes';
import { createFileReviewController } from '../apps/desktop/renderer/file-review-controller';
import { conversationTimeline } from '../packages/collaboration-core/timeline';
import { readingTurns } from '../packages/collaboration-core/reading-turns';
import type { Session } from '../packages/contracts';

const group = (id='turn'): TurnFileChanges => ({id,userMessageId:id,truncated:false,files:[{path:'src/a.ts',kind:'modify',additions:2,deletions:1,edits:1,patches:[{activityId:id,diff:'@@ -4,2 +4,3 @@\n-old\n+new\n+next\n same'}]}]});
test('unified line numbers follow hunk offsets and file headers never become added lines',()=>{
  const lines=diffLines('--- a.ts\n+++ a.ts\n@@ -40,2 +50,3 @@\n-old\n+new\n+next\n same\n@@ -99 +100 @@\n-last\n+final\n\\ No newline at end of file\n');
  assert.deepEqual(lines.slice(0,3).map(l=>l.kind),['meta','meta','meta']);
  assert.deepEqual(lines.slice(3,7).map(l=>[l.oldLine,l.newLine]),[[40,undefined],[undefined,50],[undefined,51],[41,52]]);
  assert.equal(lines[8]!.oldLine,99);assert.equal(lines[9]!.newLine,100);assert.equal(lines[10]!.kind,'meta');
});
test('unknown native offsets, binary patches and empty patches are honest',()=>{
  assert.deepEqual(diffLines('@@\n-a\n+b').map(l=>[l.oldLine,l.newLine]),[[undefined,undefined],[undefined,undefined],[undefined,undefined]]);
  assert.equal(diffLines('Binary files a and b differ')[0]!.kind,'meta');assert.deepEqual(diffLines(''),[]);
  assert.equal(diffLines('@@ -1 +1 @@\n--- content')[1]!.text,'-- content');
});
test('split blocks align unequal additions and deletions, and retain context',()=>{
  const rows=splitDiffLines(diffLines(group().files[0]!.patches[0]!.diff!));
  assert.equal(rows[0]!.meta?.kind,'meta');assert.equal(rows[1]!.left?.text,'old');assert.equal(rows[1]!.right?.text,'new');
  assert.equal(rows[2]!.left,undefined);assert.equal(rows[2]!.right?.text,'next');assert.equal(rows[3]!.left?.text,'same');
});
test('Claude preserves reported structured hunk positions and leaves missing positions unknown',()=>{
  const files=group().files,result=claudeCompletedChanges(files,{structuredPatch:[{oldStart:4,oldLines:1,newStart:5,newLines:1,lines:['-old','+new']}]})!;
  assert.equal(diffLines(result[0]!.diff!)[1]!.oldLine,4);assert.equal(diffLines(result[0]!.diff!)[2]!.newLine,5);
  assert.equal(claudeCompletedChanges(files,{structuredPatch:[{lines:['+new']}]})![0]!.diff,'@@\n+new');
});
test('one native turn merges steering edits and renames without mutating records',()=>{
  const first=group('u1'),second=group('u2');second.files[0]!.previousPath='src/a.ts';second.files[0]!.path='src/b.ts';second.truncated=true;
  const before=JSON.stringify([first,second]),merged=mergeTurnFileChanges([first,second],'u1')!;
  assert.equal(merged.files.length,1);assert.equal(merged.files[0]!.path,'src/b.ts');assert.equal(merged.files[0]!.additions,4);assert.equal(merged.files[0]!.edits,2);assert.equal(merged.truncated,true);
  assert.equal(JSON.stringify([first,second]),before);assert.equal(mergeTurnFileChanges([],'x'),undefined);
  second.files[0]!.additions=null;assert.equal(mergeTurnFileChanges([first,second],'u1')!.files[0]!.additions,null);
});
test('review public actions target mounted session/turn sources and release safely',()=>{
  const api=createFileReviewController(),opened:string[]=[],closed:string[]=[];let events=0;
  const stop=api.subscribe(()=>events++),snapshot={sessionId:'one',turnId:'turn',changes:group(),running:true};
  const source=api.bind({snapshot,open:path=>opened.push(path),close:()=>closed.push('one')});
  const other=api.bind({snapshot:{...snapshot,sessionId:'two'},open:path=>opened.push('two:'+path),close:()=>closed.push('two')});
  api.list('one')[0]!.changes.files[0]!.path='tampered';assert.equal(api.list('one')[0]!.changes.files[0]!.path,'src/a.ts');
  api.open(snapshot);assert.deepEqual(opened,['src/a.ts']);assert.deepEqual(closed,['two']);
  assert.throws(()=>api.open(snapshot,'missing'),/FILE_REVIEW_FILE_UNAVAILABLE/);
  source.update({...snapshot,running:false});assert.equal(api.list('one')[0]!.running,false);api.close(snapshot);
  source.dispose();source.dispose();assert.throws(()=>api.open(snapshot),/FILE_REVIEW_UNAVAILABLE/);other.dispose();stop();assert.ok(events>=5);
});
test('registered views use stable owner IDs and restore builtins on cleanup',()=>{
  const api=createFileReviewController(),definition={id:'summary',label:'Summary',render:()=>{}};
  const first=api.registerView('test.a',definition,()=>{}),second=api.registerView('test.b',definition,()=>{});
  assert.equal(first.id,'plugin:test.a:summary');assert.equal(api.listViews().length,4);
  assert.throws(()=>api.registerView('test.a',definition,()=>{}),/FILE_REVIEW_DUPLICATE_VIEW/);
  assert.throws(()=>api.registerView('test.a',{...definition,id:'../bad'},()=>{}),/FILE_REVIEW_INVALID_VIEW/);
  first.dispose();assert.ok(api.listViews().some(v=>v.id===second.id));second.dispose();assert.deepEqual(api.listViews().map(v=>v.id),['unified','split']);
});
test('legacy native-turn-only and unbound records never leak into the newest turn capsule',()=>{
  const session={id:'session',status:'running',messages:[{id:'old-user',role:'user',nativeTurnId:'old-native',original:'Old',timestamp:'2026-01-01T00:00:00Z'},{id:'new-user',role:'user',nativeTurnId:'new-native',original:'New',timestamp:'2026-01-01T01:00:00Z'}],fileChangeRecords:[{activityId:'old-edit',turnId:'old-native',at:'2026-01-01T00:00:01Z',changes:group().files},{activityId:'legacy-unbound',at:'2025-12-31T00:00:00Z',changes:group().files}]} as unknown as Session;
  const turns=readingTurns(conversationTimeline(session),session),active=turns.find(turn=>turn.active)!;
  assert.equal(active.id,'new-user');assert.equal(active.answers.filter(entry=>entry.type==='changes').length,0);
  assert.equal(turns.find(turn=>turn.id==='old-user')!.answers.filter(entry=>entry.type==='changes').length,1);
  assert.equal(turns.flatMap(turn=>turn.answers).filter(entry=>entry.type==='changes').length,2);
});
