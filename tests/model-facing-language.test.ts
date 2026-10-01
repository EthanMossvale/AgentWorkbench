import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SharedMemoryStore } from '../packages/memory-core';
import { SharedSkillsStore } from '../packages/skills-core';
import { composeSharedContextInput } from '../packages/session-core/shared-context';
import { appendUserSupplement } from '../packages/session-core/user-draft';
import { OwnerFileService, FileBoundaryError } from '../services/owner-file-service';
import { projectEnvironment, unknownProfile, ENVIRONMENT_PROBE_COMMAND } from '../services/environment-profile';
import { buildClaudeArgs, CLAUDE_RESEARCH_BASELINE, normalizeClaudeEvent } from '../packages/runtime-claude';
import { buildDeferredAppServerArgs, CODEX_DEFERRED_BASELINE, environmentRegistration } from '../packages/runtime-codex';
import { decodeNativeFrame } from '../services/remote-supervisor';
import { Translator } from '../packages/translation/provider';
import { initialState } from '../apps/desktop/host/store';

const englishGenerated = (value: unknown) => assert.doesNotMatch(JSON.stringify(value), /\p{Script=Han}/u);
test('framework supplement label is English while user draft and supplement remain literal', () => {
  const draft = '请检查文件。\r\nDo not edit.', supplement = '补充中文需求和 `D:\\中文\\file.ts`';
  const result = appendUserSupplement(draft, supplement);
  assert.equal(result, draft + '\n\nAdditional requirements:\n' + supplement);
  englishGenerated(result.slice(draft.length, -supplement.length));
});

test('shared memory and skill envelopes use English and preserve authored content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aw-language-'));
  try {
    const store = new SharedMemoryStore(root); await store.setEnabled(true);
    const content = '用户自己的中文记忆，禁止悄悄翻译。\r\nKeep this literal.';
    const note = await store.saveNote({ title: '用户标题', content });
    const snapshot = await store.createSnapshot({ sessionId: 'fixture', noteIds: [note.id] });
    const userTask = '用户请求也不能被框架文案覆盖。';
    const prepared = composeSharedContextInput(userTask, snapshot);
    assert.equal(prepared.userTask, userTask); assert.equal(snapshot.items[0]!.content, content);
    const suffix = prepared.input.slice(userTask.length); const jsonStart = suffix.indexOf('{'), jsonEnd = suffix.lastIndexOf('}') + 1;
    englishGenerated(suffix.slice(0, jsonStart) + suffix.slice(jsonEnd));
    const reference = JSON.parse(suffix.slice(jsonStart, jsonEnd)); assert.equal(reference.items[0].content, content); assert.equal(reference.items[0].title, note.title);
    reference.items = reference.items.map(({ title, content, ...item }: { title: string; content: string }) => item); englishGenerated(reference);
    const skillPath = path.join(root, 'SKILL.md'); await writeFile(skillPath, '---\nname: audit\ndescription: Review the selected source.\n---\nKeep user-authored instructions intact.\n');
    const skills = new SharedSkillsStore(root); await skills.importFile(skillPath); const catalog = await skills.createDiscoverySnapshot({ sessionId: 'fixture' }); englishGenerated(catalog);
  } finally { await rm(root, { recursive: true }); }
});

test('AGENTS.md reads preserve BOM, Chinese text and CRLF; generated boundary denial is English', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aw-language-file-'));
  try {
    const file = path.join(root, 'AGENTS.md'), content = '\ufeff# 用户规则\r\n不要重写我的内容。\r\n'; await writeFile(file, content, 'utf8');
    const service = await OwnerFileService.create({ ownerId: 'owner', deviceId: 'device', generation: 'one', controlPaths: [], verifyOwner: async () => true });
    const grant = service.issueGrant({ expiresAt: new Date(Date.now() + 60000).toISOString(), operations: ['read'] });
    const context = { grantId: grant.id, ownerId: 'owner', deviceId: 'device', generation: 'one', sessionId: 'session', workspaceId: 'workspace', operationId: 'read', os: process.platform };
    const snapshot = await service.read(context, file); assert.equal(snapshot.content, content); assert.equal(await readFile(file, 'utf8'), content);
    await assert.rejects(service.read({ ...context, grantId: 'missing' }, file), error => { assert.ok(error instanceof FileBoundaryError); englishGenerated({ code: error.code, message: error.message }); return true; });
  } finally { await rm(root, { recursive: true }); }
});

test('native protocol envelopes and environment metadata are English, opaque native frames are unchanged', () => {
  englishGenerated(buildClaudeArgs({ version: CLAUDE_RESEARCH_BASELINE })); englishGenerated(buildDeferredAppServerArgs(CODEX_DEFERRED_BASELINE));
  englishGenerated(environmentRegistration('fixture', 'ws://127.0.0.1:12345/' + 'a'.repeat(64))); englishGenerated(ENVIRONMENT_PROBE_COMMAND);
  const profile = unknownProfile({ id: 'host', name: '用户中文显示名', hostname: 'fixture.example', port: 22, username: 'member', role: 'workspace', identityFile: path.join(os.tmpdir(), 'key'), knownHostsFile: path.join(os.tmpdir(), 'known_hosts'), ownerId: 'owner', workspaceGeneration: 'one' });
  englishGenerated(projectEnvironment(profile, { hostId: profile.hostId, ownerId: profile.ownerId }));
  const bytes = Buffer.from('{"type":"result","result":"原生返回的中文不篡改","signature":"opaque+/==中文"}\r\n'); const frame = decodeNativeFrame(bytes);
  assert.deepEqual(Buffer.from(frame.rawBase64, 'base64'), bytes); assert.equal(normalizeClaudeEvent(frame, 'session', 1).text, '原生返回的中文不篡改');
});

test('translation processor instructions are English while its source remains user-authored data', async () => {
  const translator = new Translator(async (_url, request) => {
    const body = JSON.parse(String(request?.body)); englishGenerated(body.instructions); assert.equal(body.input, '用户的中文输入');
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'The user input.' }] }] });
  });
  const profile = { ...initialState().translation, consent: true, model: 'fixture-model' }; const result = await translator.translate('用户的中文输入', 'input', profile, 'fixture-key'); assert.equal(result.text, 'The user input.');
});
