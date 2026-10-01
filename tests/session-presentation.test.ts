import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionPresentation } from '../packages/session-core/presentation';
import type { Message, Session } from '../packages/contracts';

const policy = new SessionPresentation();
const session = (patch: Partial<Session> = {}): Session => ({id:'test',title:'Fallback',titleSource:'fallback',projectId:null,pinned:false,archived:false,group:'',status:'idle',createdAt:'2026-09-29T00:00:00Z',binding:{runtime:'codex',provider:'openai',accountRef:'synthetic',executionId:'local-device',egress:'demo',nativeSessionId:'root'},messages:[],...patch});
const user = (patch: Partial<Message> = {}): Message => ({id:'first',role:'user',original:'中文原稿',submitted:'English model input',timestamp:'2026-09-29T00:00:00Z',demo:false,...patch});

test('native titles require actual bound root metadata and preserve exact native language', () => {
  const s=session();
  for(const params of [{threadName:'Missing identity'},{threadId:'child',threadName:'Child'},{threadId:'root'},{threadId:'root',threadName:null}]) assert.equal(policy.codex(s,'root',{method:'thread/name/updated',params}),false);
  assert.equal(policy.codex(s,'root',{method:'thread/tokenUsage/updated',params:{threadId:'root',threadName:'Wrong event'}}),false);
  assert.equal(s.title,'Fallback');
  assert.equal(policy.codex(s,'root',{method:'thread/name/updated',params:{threadId:'root',threadName:'原生标题 Native title'}}),true);
  assert.equal(s.title,'原生标题 Native title');assert.equal(s.titleSource,'native');
  assert.equal(policy.fallback(s,'First prompt'),false);assert.equal(s.title,'原生标题 Native title');
  s.binding.nativeSessionId='rebound';assert.equal(policy.codex(s,'root',{method:'thread/name/updated',params:{threadId:'root',threadName:'Late title'}}),false);
});

test('manual, legacy, fork, agent-created and child titles are protected', () => {
  for(const patch of [{titleSource:'manual'},{titleSource:undefined},{branch:{}},{agentCreated:{}},{agentParent:{}}] as Partial<Session>[]) {
    const s=session(patch);assert.equal(policy.nativeTitle(s,'Automatic title'),false);assert.equal(s.title,'Fallback');
  }
  for(const title of ['', '  ', null, 42, 'x'.repeat(501), 'bad\nname']) assert.equal(policy.nativeTitle(session(),title),false);
  const s=session({titleSource:'manual'});assert.equal(policy.fallback(s,'prefix'),false);
  const fresh=session({titleSource:undefined});assert.equal(policy.fallback(fresh,'原有截取方式'),true);assert.equal(fresh.titleSource,'fallback');
});

test('preview prefers completed stored translation, then original draft, then submitted-only input', () => {
  const first=user({translation:'已存译文',translationStatus:'complete'}),s=session({messages:[{...user(),role:'assistant',original:'not first'},first,user({id:'later',original:'later input'})]});
  assert.deepEqual(policy.preview(s),{messageId:'first',source:'translation',excerpt:'已存译文',content:'已存译文',truncated:false});
  for(const status of ['pending','failed','off'] as const){first.translationStatus=status;assert.equal(policy.preview(s).content,'中文原稿');}
  first.translationStatus=undefined;assert.equal(policy.preview(s).content,'已存译文');
  first.translation=' ';assert.equal(policy.preview(s).content,'中文原稿');
  first.original='';assert.equal(policy.preview(s).source,'submitted');assert.equal(policy.preview(s).content,'English model input');
  first.submitted='';assert.equal(policy.preview(s).source,'empty');
  assert.equal(policy.preview(session()).source,'empty');
});

test('huge Unicode prompts produce bounded excerpts without changing history or splitting surrogate pairs', () => {
  const input='😀段落\n'.repeat(100000),s=session({messages:[user({original:input})]});
  const preview=policy.preview(s);
  assert.equal([...preview.content].length,1200);assert.equal([...preview.excerpt].length,181);assert.equal(preview.truncated,true);
  assert.equal(preview.content.endsWith('\ud83d'),false);assert.equal(s.messages[0]!.original,input);
  assert.equal(policy.preview(session({messages:[user({original:'a'.repeat(1200)})]})).truncated,false);
});
