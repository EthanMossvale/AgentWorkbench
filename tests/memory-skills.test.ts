import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SharedMemoryStore, combineSharedContextSnapshots, isFrameworkSnapshot, isKnownFrameworkSnapshot, sharedHash } from '../packages/memory-core/index';
import { SharedSkillsStore, parseSkillMarkdown } from '../packages/skills-core/index';

const fixture = () => mkdtemp(path.join(os.tmpdir(), 'aw-shared-context-'));
const skillText = '---\nname: fixture-skill\ndescription: Explain the exact selected fixture.\n---\n# Scope\nRead only the explicitly selected fixture. Do not expand authorization.\n';

test('shared memory defaults off and creates only its framework directory layout', async () => {
  const root = await fixture(); try {
    const store = new SharedMemoryStore(root); const status = await store.status(); assert.equal(status.enabled, false); assert.equal(status.autoCapture, false);
    assert.deepEqual((await readdir(path.join(root, 'shared', 'memories'))).sort(), ['MEMORY.md', 'catalog.json', 'memory_summary.md', 'notes'].sort());
    const note = await store.saveNote({ title: '中文交付', content: '最终说明使用中文。', summary: '偏好中文说明', tags: ['language'], sessionId: 'source-session' });
    assert.equal((await store.createSnapshot({ sessionId: 'claude-session', noteIds: [note.id] })).items.length, 0);
    assert.equal((await readFile(path.join(root, 'shared', 'memories', 'notes', `${note.id}.md`), 'utf8')), note.content);
    assert.match(await readFile(path.join(root, 'shared', 'memories', 'MEMORY.md'), 'utf8'), /偏好中文说明/);
    assert.deepEqual(await readdir(root), ['shared']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('memory snapshots have stable source hashes across providers and remain immutable', async () => {
  const root = await fixture(); try {
    const store = new SharedMemoryStore(root); await store.setEnabled(true); const note = await store.saveNote({ title: 'Shared scope', content: 'Keep original task language and owner boundaries unchanged.' });
    const claude = await store.createSnapshot({ sessionId: 'claude-1', noteIds: [note.id] }); const codex = await store.createSnapshot({ sessionId: 'codex-1', noteIds: [note.id] });
    assert.equal(claude.sourceHash, codex.sourceHash); assert.notEqual(claude.id, codex.id); assert.equal(claude.items[0]?.sourceHash, sharedHash(note.content));
    assert.ok(isFrameworkSnapshot(claude)); assert.equal(isFrameworkSnapshot(structuredClone(claude)), false); assert.ok(Object.isFrozen(claude)); assert.ok(Object.isFrozen(claude.items)); assert.ok(Object.isFrozen(claude.items[0]));
    await store.setEnabled(false); assert.equal(isFrameworkSnapshot(claude), false); assert.equal(isKnownFrameworkSnapshot(claude), true); assert.equal(isKnownFrameworkSnapshot(structuredClone(claude)), false); assert.equal((await store.createSnapshot({ sessionId: 'next' })).enabled, false);
    await store.setEnabled(true); assert.equal(isFrameworkSnapshot(claude), false, 're-enabling must not revive an old preview');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('memory supports explicit edits/removals, selective summaries and version conflicts', async () => {
  const root = await fixture(); try {
    const store = new SharedMemoryStore(root); await store.setEnabled(true); const a = await store.saveNote({ title: 'Rendering', content: 'A detailed rendering note.', summary: 'render only', tags: ['render'] }); const b = await store.saveNote({ title: 'Language', content: 'Prefer Chinese explanations.', summary: 'language only' });
    const summary = await store.createSnapshot({ sessionId: 'summary' }); assert.equal(summary.items.length, 2); assert.ok(summary.items.some(item => item.content.includes('render only'))); assert.ok(!summary.items.some(item => item.content.includes('A detailed rendering note.')));
    const selected = await store.createSnapshot({ sessionId: 'query', query: 'render' }); assert.deepEqual(selected.items.map(item => item.id), [a.id]); assert.equal(selected.items[0]?.content, a.content);
    await assert.rejects(store.saveNote({ id: a.id, title: a.title, content: 'changed', expectedHash: 'old' }), /current note hash/);
    const edited = await store.saveNote({ id: a.id, title: a.title, content: 'changed', expectedHash: a.hash }); assert.notEqual(edited.hash, a.hash);
    await assert.rejects(store.removeNote(a.id, a.hash), /current note hash/); await store.removeNote(a.id, edited.hash); assert.deepEqual((await store.list()).map(note => note.id), [b.id]);
    await assert.rejects(store.removeNote('../escape', b.hash), /identifier/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('parallel first-use memory operations serialize without losing explicit notes', async () => {
  const root = await fixture(); try { const store = new SharedMemoryStore(root); await Promise.all([store.saveNote({ title: 'a', content: 'first' }), store.saveNote({ title: 'b', content: 'second' }), store.setEnabled(true)]); assert.equal((await store.list()).length, 2); assert.equal((await store.status()).enabled, true); } finally { await rm(root, { recursive: true, force: true }); }
});
test('memory rejects credential material and cannot follow managed-directory junctions', async () => {
  const root = await fixture(); const outside = await fixture(); try {
    const store = new SharedMemoryStore(root); await assert.rejects(store.saveNote({ title: 'secret', content: '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----' }), /credentials/);
    await mkdir(path.join(root, 'shared')); await symlink(outside, path.join(root, 'shared', 'memories'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(store.initialize(), /symbolic links or junctions/); assert.deepEqual(await readdir(outside), []);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('SKILL.md parsing supports plain/quoted/block descriptions but never YAML code', () => {
  assert.equal(parseSkillMarkdown(skillText).name, 'fixture-skill');
  assert.equal(parseSkillMarkdown('---\nname: "quoted"\ndescription: >\n  A folded\n  description.\nmetadata:\n  ignored: true\n---\nInstructions').description, 'A folded description.');
  for (const text of ['missing frontmatter', '---\nname: ../../escape\ndescription: unsafe\n---\nbody', '---\nname: x\nname: y\ndescription: duplicate\n---\nbody', '---\nname: !!js/function\ndescription: code\n---\nbody', '---\nname: x\ndescription: fine\n---\n']) assert.throws(() => parseSkillMarkdown(text));
});
test('skill import copies only the selected instruction file, preserves bytes and rejects collisions', async () => {
  const root = await fixture(); const source = await fixture(); try {
    const selected = path.join(source, 'SKILL.md'); await writeFile(selected, skillText); await writeFile(path.join(source, 'private-adjacent.txt'), 'not imported'); await mkdir(path.join(source, 'scripts')); await writeFile(path.join(source, 'scripts', 'helper.js'), 'not executed');
    const store = new SharedSkillsStore(root); const skill = await store.importFile(selected); assert.equal(skill.compatibility, 'instructions-only'); assert.equal(skill.hash, sharedHash(skillText));
    assert.deepEqual(await readdir(path.join(root, 'shared', 'skills', skill.id)), ['SKILL.md']); assert.equal((await store.read(skill.id)).body, parseSkillMarkdown(skillText).body);
    await assert.rejects(store.importFile(selected), /never overwrites/); assert.equal((await store.list()).length, 1); assert.equal(await readFile(selected, 'utf8'), skillText);
    await assert.rejects(store.remove(skill.id, 'wrong'), /current imported file hash/); await store.remove(skill.id, skill.hash); assert.equal((await store.list()).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); await rm(source, { recursive: true, force: true }); }
});
test('skill import rejects symlink traversal, oversized files and non-explicit references', async () => {
  const root = await fixture(); const source = await fixture(); try {
    const store = new SharedSkillsStore(root); await writeFile(path.join(source, 'SKILL.md'), skillText); const link = path.join(root, 'chosen-link'); await symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(store.importFile(path.join(link, 'SKILL.md')), /symbolic links or junctions/); await assert.rejects(store.importFile('SKILL.md'), /absolute/);
    await writeFile(path.join(source, 'SKILL.md'), 'x'.repeat(128 * 1024 + 1)); await assert.rejects(store.importFile(path.join(source, 'SKILL.md')), /bounded/);
    await assert.rejects(store.read('../../outside'), /identifier/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(source, { recursive: true, force: true }); }
});
test('combined memory and skills retain identical provenance and revoke on memory disable', async () => {
  const root = await fixture(); const source = await fixture(); try {
    const memory = new SharedMemoryStore(root); const skills = new SharedSkillsStore(root); await memory.setEnabled(true); const note = await memory.saveNote({ title: 'shared', content: 'User-approved note, not a permission grant.' }); await writeFile(path.join(source, 'SKILL.md'), skillText); const skill = await skills.importFile(path.join(source, 'SKILL.md'));
    const a = await memory.createSnapshot({ sessionId: 'session', noteIds: [note.id] }); const b = await skills.createSnapshot({ sessionId: 'session', skillIds: [skill.id] }); const combined = combineSharedContextSnapshots(a, b);
    assert.deepEqual(combined.items.map(item => item.kind), ['memory', 'skill']); assert.equal(combined.items[1]?.content, skillText); assert.ok(isFrameworkSnapshot(combined));
    await assert.rejects(skills.createSnapshot({ sessionId: 'session', skillIds: [skill.id, skill.id] }), /unique/);
    assert.throws(() => combineSharedContextSnapshots(a, { ...b }), /framework snapshots/);
    await memory.setEnabled(false); assert.equal(isFrameworkSnapshot(combined), false);
    const skillsOnly = combineSharedContextSnapshots(await memory.createSnapshot({ sessionId: 'session' }), b); assert.deepEqual(skillsOnly.items.map(item => item.kind), ['skill']); assert.equal(skillsOnly.provenance.memoryEnabled, false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(source, { recursive: true, force: true }); }
});
test('out-of-band skill edits fail integrity checks instead of silently injecting new instructions', async () => {
  const root = await fixture(); const source = await fixture(); try { await writeFile(path.join(source, 'SKILL.md'), skillText); const store = new SharedSkillsStore(root); const skill = await store.importFile(path.join(source, 'SKILL.md')); await writeFile(path.join(root, 'shared', 'skills', skill.id, 'SKILL.md'), skillText + 'changed'); await assert.rejects(store.read(skill.id), /changed outside/); await assert.rejects(store.createSnapshot({ sessionId: 's', skillIds: [skill.id] }), /changed outside/); } finally { await rm(root, { recursive: true, force: true }); await rm(source, { recursive: true, force: true }); }
});
test('global discovery reads metadata only and leaves full Markdown to the version-checked reader',async()=>{const root=await fixture();const source=await fixture();try{
 await writeFile(path.join(source,'SKILL.md'),skillText);const skills=new SharedSkillsStore(root);const skill=await skills.importFile(path.join(source,'SKILL.md'));
 const a=await skills.createDiscoverySnapshot({sessionId:'claude'});const b=await skills.createDiscoverySnapshot({sessionId:'codex'});assert.equal(a.sourceHash,b.sourceHash);assert.equal(a.items[0]?.kind,'skill-catalog');assert.ok(!a.items[0]?.content.includes('# Scope'));assert.equal((await skills.readMarkdown(skill.id,skill.hash)).markdown,skillText);
 await writeFile(path.join(root,'shared/skills',skill.id,'SKILL.md'),'changed externally');assert.equal((await skills.listMetadata())[0]?.name,'fixture-skill');assert.equal((await skills.createDiscoverySnapshot({sessionId:'new'})).sourceHash,a.sourceHash);await assert.rejects(skills.readMarkdown(skill.id,skill.hash),/integrity/);
}finally{await rm(root,{recursive:true,force:true});await rm(source,{recursive:true,force:true});}});
test('BOM and CRLF skill input is preserved exactly and removal revokes pending context', async () => {
  const root = await fixture(); const source = await fixture(); try {
    const original = '\uFEFF' + skillText.replaceAll('\n', '\r\n'); await writeFile(path.join(source, 'SKILL.md'), original);
    const store = new SharedSkillsStore(root); const skill = await store.importFile(path.join(source, 'SKILL.md')); const snapshot = await store.createSnapshot({ sessionId: 's', skillIds: [skill.id] });
    assert.equal(skill.hash, sharedHash(original)); assert.equal(snapshot.items[0]?.content, original); assert.equal(await readFile(path.join(root, 'shared', 'skills', skill.id, 'SKILL.md'), 'utf8'), original);
    await store.remove(skill.id, skill.hash); assert.equal(isFrameworkSnapshot(snapshot), false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(source, { recursive: true, force: true }); }
});
