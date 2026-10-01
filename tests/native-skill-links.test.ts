import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, realpath, readlink, lstat, unlink, rm } from 'node:fs/promises';
import { NativeSkillsService, type NativeSkill } from '../packages/native-skills';
import { NativeSkillLinks, type SkillLinkAction, type SkillRuntime } from '../packages/native-skills/links';
import { NativeResources } from '../apps/desktop/host/native-resources';
import { codexConfiguration } from '../packages/native-runtime/process';

const put = async (file: string, content: string) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
const link = async (source: string, target: string) => { await mkdir(path.dirname(target), { recursive: true }); const { symlink } = await import('node:fs/promises'); await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir'); };
const markdown = (name: string) => `---\nname: ${name}\ndescription: Isolated skill sharing fixture.\n---\nRead references/check.txt.\n`;
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'awb-links-')), data = path.join(home, 'workbench'), codex = path.join(home, '.codex', 'skills'), claude = path.join(home, '.claude', 'skills');
  const service = () => new NativeSkillsService(data, { home, codexHome: path.join(home, '.codex'), claudeHome: path.join(home, '.claude'), executable: async () => undefined, projects: () => [path.join(home, 'project')] });
  const skills = service(); await skills.initialize();
  // The temporary fixture is the only cleanup scope; unlink junctions explicitly before recursive cleanup.
  t.after(async () => { const walk = async (directory: string) => { const { readdir } = await import('node:fs/promises'); for (const item of await readdir(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isSymbolicLink()) await unlink(file); else if (item.isDirectory()) await walk(file); } }; await walk(home); await rm(home, { recursive: true, force: true }); });
  const seed = async (name = 'shared', entryName = name) => { const source = path.join(home, 'cc-switch-fixture', name); await put(path.join(source, 'SKILL.md'), markdown(name)); await put(path.join(source, 'references', 'check.txt'), 'SUPPORTING_RESOURCE'); await link(source, path.join(codex, entryName)); return source; };
  const one = async (name = 'shared') => { const skill = (await skills.scan()).skills.find(s => s.name === name); assert.ok(skill); return skill; };
  const plan = async (runtime: SkillRuntime, action: SkillLinkAction, values?: NativeSkill[]) => skills.planLinks({ runtime, action, skills: (values ?? [await one()]).map(({ id, hash }) => ({ id, hash })) });
  return { home, data, codex, claude, skills, service, seed, one, plan };
}

test('link a CC Switch-style source directly, deduplicate, persist ownership, and remove only the workbench link', async t => {
  const f = await fixture(t), source = await f.seed();
  let skill = await f.one(); assert.equal(skill.connections?.codex.ownership, 'external'); assert.equal(skill.connections?.claude.status, 'missing');
  const prepared = await f.plan('claude', 'connect'); assert.equal(prepared.counts.create, 1);
  assert.equal((await f.skills.applyLinks(prepared.id)).items[0]?.status, 'created');
  const entry = path.join(f.claude, 'shared');
  assert.equal(await realpath(entry), await realpath(source)); assert.ok((await readlink(entry)).toLowerCase().includes('cc-switch-fixture')); assert.ok(!(await readlink(entry)).includes('.codex'));
  assert.equal(await readFile(path.join(entry, 'references', 'check.txt'), 'utf8'), 'SUPPORTING_RESOURCE');
  skill = await f.one(); assert.equal((await f.skills.scan()).skills.length, 1); assert.equal(skill.origins.length, 2); assert.equal(skill.connections?.claude.ownership, 'workbench');
  const restarted = f.service(); await restarted.initialize(); const restored = (await restarted.scan()).skills[0]!; assert.equal(restored.connections?.claude.canDisconnect, true);
  const remove = await restarted.planLinks({ runtime: 'claude', action: 'disconnect', skills: [{ id: restored.id, hash: restored.hash }] }); assert.equal((await restarted.applyLinks(remove.id)).items[0]?.status, 'removed');
  await assert.rejects(lstat(entry), { code: 'ENOENT' }); assert.equal(await realpath(path.join(f.codex, 'shared')), await realpath(source)); assert.equal(await readFile(path.join(source, 'SKILL.md'), 'utf8'), markdown('shared'));
});

test('reuses an existing external link without adopting or deleting it', async t => {
  const f = await fixture(t), source = await f.seed(); await link(source, path.join(f.claude, 'shared'));
  const reuse = await f.plan('claude', 'connect'); assert.equal(reuse.counts.reuse, 1); assert.equal((await f.skills.applyLinks(reuse.id)).items[0]?.status, 'reused');
  const remove = await f.plan('claude', 'disconnect'); assert.equal(remove.counts.remove, 0); assert.equal(remove.items[0]?.reason, 'external'); await f.skills.applyLinks(remove.id);
  assert.ok((await lstat(path.join(f.claude, 'shared'))).isSymbolicLink());
});

test('protects same-name directories, other targets, broken links, and link loops', async t => {
  const f = await fixture(t); await f.seed(); const entry = path.join(f.claude, 'shared'); await put(path.join(entry, 'SKILL.md'), markdown('different'));
  assert.equal((await f.one()).connections?.claude.status, 'conflict'); const blocked = await f.plan('claude', 'connect'); assert.equal(blocked.counts.create, 0); assert.equal(await readFile(path.join(entry, 'SKILL.md'), 'utf8'), markdown('different'));
  await rm(entry, { recursive: true }); await link(path.join(f.home, 'missing'), entry); assert.equal((await f.one()).connections?.claude.status, 'broken'); assert.equal((await f.plan('claude', 'connect')).counts.create, 0);
  await unlink(entry); await link(entry, entry); assert.equal((await f.one()).connections?.claude.status, 'broken');
});

test('does not delete a link replaced externally even when the final source is identical', async t => {
  const f = await fixture(t), source = await f.seed(); await f.skills.applyLinks((await f.plan('claude', 'connect')).id); const entry = path.join(f.claude, 'shared');
  const stale = await f.plan('claude', 'disconnect'); await unlink(entry); await new Promise(resolve => setTimeout(resolve, 15)); await link(source, entry);
  await assert.rejects(f.skills.applyLinks(stale.id), /SKILL_LINK_PLAN_STALE/); assert.equal((await f.one()).connections?.claude.ownership, 'external'); assert.ok((await lstat(entry)).isSymbolicLink());
});

test('source edits and destination edits invalidate the whole plan before writes', async t => {
  const f = await fixture(t), source = await f.seed(); await f.seed('second');
  const plan = await f.plan('claude', 'connect', (await f.skills.scan()).skills); await put(path.join(source, 'SKILL.md'), markdown('shared') + 'Changed.'); await assert.rejects(f.skills.applyLinks(plan.id), /SKILL_LINK_PLAN_STALE/);
  await assert.rejects(lstat(path.join(f.claude, 'second')), { code: 'ENOENT' });
  const next = await f.plan('claude', 'connect'); await put(path.join(f.claude, 'shared', 'user.txt'), 'DO_NOT_REPLACE'); await assert.rejects(f.skills.applyLinks(next.id), /SKILL_LINK_PLAN_STALE/);
  assert.equal(await readFile(path.join(f.claude, 'shared', 'user.txt'), 'utf8'), 'DO_NOT_REPLACE');
});

test('linked native roots work and retargeting a root invalidates pending plans', async t => {
  const f = await fixture(t); await f.seed(); const rootA = path.join(f.home, 'root-a'), rootB = path.join(f.home, 'root-b'); await mkdir(rootA); await mkdir(rootB); await link(rootA, f.claude);
  const stale = await f.plan('claude', 'connect'); await unlink(f.claude); await link(rootB, f.claude); await assert.rejects(f.skills.applyLinks(stale.id), /SKILL_LINK_PLAN_STALE/);
  assert.equal((await f.skills.applyLinks((await f.plan('claude', 'connect')).id)).items[0]?.status, 'created'); assert.ok((await lstat(path.join(rootB, 'shared'))).isSymbolicLink());
});

test('batch selection is explicit, preserves external links and reports skipped scopes', async t => {
  const f = await fixture(t); await f.seed(); await f.seed('second'); await put(path.join(f.home, 'project', '.claude', 'skills', 'project-only', 'SKILL.md'), markdown('project-only')); await put(path.join(f.codex, '.system', 'official', 'SKILL.md'), markdown('official'));
  const all = (await f.skills.scan()).skills, selected = all.filter(s => s.name !== 'second'), plan = await f.plan('claude', 'connect', selected);
  assert.equal(plan.counts.create, 1); assert.equal(plan.counts.skip, 2); await f.skills.applyLinks(plan.id); await assert.rejects(lstat(path.join(f.claude, 'second')), { code: 'ENOENT' });
  assert.equal((await f.one('project-only')).connections?.codex.canConnect, false); assert.equal((await f.one('official')).connections?.claude.canConnect, false);
});

test('batch creation handles initially absent roots and avoids duplicate native names', async t => {
  const f = await fixture(t); await f.seed(); await f.seed('second'); await f.seed('third'); const second = await f.one('second'); await put(second.path, markdown('shared'));
  const prepared = await f.plan('claude', 'connect', (await f.skills.scan()).skills); assert.equal(prepared.counts.create, 2); assert.equal(prepared.counts.skip, 1);
  const result = await f.skills.applyLinks(prepared.id); assert.equal(result.items.filter(i => i.status === 'created').length, 2); assert.equal(result.items.filter(i => i.status === 'failed').length, 0);
});

test('disabled native state stays independent from link presence and no catalog is injected', async t => {
  const f = await fixture(t); await f.seed(); await f.skills.applyLinks((await f.plan('claude', 'connect')).id); await put(path.join(f.home, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { shared: 'off' } }));
  const skill = await f.one(); assert.equal(skill.connections?.claude.status, 'connected'); assert.equal(skill.runtimeAvailability?.claude, false);
  const snapshot = await f.skills.createDiscoverySnapshot({ sessionId: 'fixture', nativeRuntime: 'claude' }); assert.equal(snapshot.items.length, 0);
});

test('validates request bounds and hashes; plans expire and cannot be replayed', async t => {
  const f = await fixture(t); await f.seed(); const skill = await f.one(), ref = { id: skill.id, hash: skill.hash };
  for (const request of [{ runtime: 'other', action: 'connect', skills: [ref] }, { runtime: 'claude', action: 'wrong', skills: [ref] }, { runtime: 'claude', action: 'connect', skills: [] }, { runtime: 'claude', action: 'connect', skills: [ref, ref] }]) await assert.rejects(f.skills.planLinks(request as never), /SKILL_LINK_REQUEST_INVALID/);
  await assert.rejects(f.skills.planLinks({ runtime: 'claude', action: 'connect', skills: [{ ...ref, hash: 'a'.repeat(64) }] }), /SKILL_LINK_SOURCE_CHANGED/);
  const plan = await f.plan('claude', 'connect'); await f.skills.applyLinks(plan.id); await assert.rejects(f.skills.applyLinks(plan.id), /SKILL_LINK_PLAN_EXPIRED/);
  let now = 1; const manager = new NativeSkillLinks(f.data, () => ({ codex: path.join(f.home, '.agents', 'skills'), claude: f.claude }), () => now), current = (await f.skills.scan()).skills;
  const expired = await manager.plan({ runtime: 'claude', action: 'disconnect', skills: [ref] }, current); now += 120_001; await assert.rejects(manager.apply(expired.id, current), /SKILL_LINK_PLAN_EXPIRED/);
});

test('linked root discovery retains the logical native path and same-source aliases', async t => {
  const f = await fixture(t), source = await f.seed(); await link(source, path.join(f.codex, 'alias')); const skill = await f.one(); assert.equal(skill.origins.filter(o => o.provider === 'codex').length, 2); assert.equal(skill.connections?.codex.externalCount, 2);
});

test('an I/O failure reports a partial batch, stops further writes, and retains completed links', async t => {
  const f = await fixture(t); await f.seed('alpha'); await f.seed('beta'); await f.seed('gamma');
  const prepared = await f.plan('claude', 'connect', (await f.skills.scan()).skills);
  const fs = (await import('node:fs')).default, { syncBuiltinESMExports } = await import('node:module'), original = fs.promises.symlink;
  let calls = 0;
  const mock = t.mock.method(fs.promises, 'symlink', async (...args: Parameters<typeof original>) => { if (++calls === 2) throw Object.assign(Error('Synthetic access failure'), { code: 'EACCES' }); return original(...args); });
  syncBuiltinESMExports();
  try {
    const result = await f.skills.applyLinks(prepared.id);
    assert.deepEqual(result.items.map(i => i.status), ['created', 'failed', 'skipped']); assert.equal(calls, 2); assert.equal((await f.one('alpha')).connections?.claude.ownership, 'workbench'); await assert.rejects(lstat(path.join(f.claude, 'gamma')), { code: 'ENOENT' });
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

test('reverse sharing uses the Codex personal directory without changing the Claude source', async t => {
  const f = await fixture(t); await put(path.join(f.claude, 'reverse', 'SKILL.md'), markdown('reverse'));
  const before = await readFile(path.join(f.claude, 'reverse', 'SKILL.md'), 'utf8');
  const prepared = await f.plan('codex', 'connect', [await f.one('reverse')]); assert.equal((await f.skills.applyLinks(prepared.id)).items[0]?.status, 'created');
  assert.equal(await realpath(path.join(f.home, '.agents', 'skills', 'reverse')), await realpath(path.join(f.claude, 'reverse'))); assert.equal(await readFile(path.join(f.claude, 'reverse', 'SKILL.md'), 'utf8'), before);
});

test('host exposes validated plan/apply routes without accepting arbitrary filesystem paths', async t => {
  const f = await fixture(t); await f.seed();
  const host = new NativeResources(f.data, { openZip: async () => null, saveZip: async () => null }, () => [], () => {}, f.home);
  await host.initialize(); assert.equal(host.handles('native-skills/links/plan'), true);
  await assert.rejects(host.call('native-skills/links/plan', { runtime: 'other', action: 'connect', skills: [] }), /LOCAL_RUNTIME_REQUIRED/);
  const skill = await f.one(), plan = await host.call('native-skills/links/plan', { runtime: 'claude', action: 'connect', skills: [{ id: skill.id, hash: skill.hash }], directory: 'ignored-arbitrary-path' }) as { id: string };
  const result = await host.call('native-skills/links/apply', { planId: plan.id }) as { items: { status: string }[]; scan: { skills: NativeSkill[] } };
  assert.equal(result.items[0]?.status, 'created'); assert.equal(result.scan.skills[0]?.connections?.claude.status, 'connected');
});

test('project discovery lights its own logo but cannot promote the skill to a global directory', async t => {
  const f = await fixture(t); await put(path.join(f.home, 'project', '.claude', 'skills', 'project-only', 'SKILL.md'), markdown('project-only'));
  const skill = await f.one('project-only'); assert.equal(skill.connections?.claude.status, 'connected'); assert.equal(skill.connections?.claude.reason, 'scope'); assert.equal(skill.connections?.codex.canConnect, false); assert.equal(skill.connections?.claude.canDisconnect, false);
});

test('native roots that alias the same parent do not duplicate ownership or remove an external alias', async t => {
  const f = await fixture(t); await put(path.join(f.claude, 'reverse', 'SKILL.md'), markdown('reverse')); await mkdir(f.codex, { recursive: true }); await link(f.codex, path.join(f.home, '.agents', 'skills'));
  await f.skills.applyLinks((await f.plan('codex', 'connect', [await f.one('reverse')])).id);
  const skill = await f.one('reverse'); assert.equal(skill.connections?.codex.managedCount, 1); assert.equal(skill.connections?.codex.externalCount, 0);
  const remove = await f.plan('codex', 'disconnect', [skill]); assert.equal(remove.counts.remove, 1); assert.equal((await f.skills.applyLinks(remove.id)).items[0]?.status, 'removed'); assert.ok((await lstat(path.join(f.home, '.agents', 'skills'))).isSymbolicLink()); assert.ok((await lstat(path.join(f.claude, 'reverse'))).isDirectory());
});

test('installed Codex natively discovers a new linked personal skill without a supplied skill path', { timeout: 45000 }, async t => {
  const executable = process.env.AGENT_WORKBENCH_TEST_CODEX_EXECUTABLE;
  if (!executable) { t.skip('An explicit Codex executable is required for the isolated native scan.'); return; }
  const f = await fixture(t); await put(path.join(f.claude, 'reverse-discovery', 'SKILL.md'), markdown('reverse-discovery')); await mkdir(path.join(f.home, '.codex'), { recursive: true });
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT'].includes(key.toUpperCase())) env[key] = value;
  Object.assign(env, { HOME: f.home, USERPROFILE: f.home, CODEX_HOME: path.join(f.home, '.codex'), APPDATA: path.join(f.home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(f.home, 'AppData', 'Local'), TEMP: f.home, TMP: f.home, OTEL_SDK_DISABLED: 'true' });
  const nativeSkills = () => codexConfiguration(executable, env, f.home, async rpc => { const response = await rpc('skills/list', { cwds: [f.home], forceReload: true }); return response.data.flatMap((item: { skills: { name: string; path: string }[] }) => item.skills); });
  assert.equal((await nativeSkills()).some((s: { name: string }) => s.name === 'reverse-discovery'), false);
  await f.skills.applyLinks((await f.plan('codex', 'connect', [await f.one('reverse-discovery')])).id);
  const found = (await nativeSkills()).find((s: { name: string }) => s.name === 'reverse-discovery'); assert.ok(found); assert.equal(await realpath(found.path), await realpath(path.join(f.claude, 'reverse-discovery', 'SKILL.md')));
});

test('does not disconnect a physical entry newly shared by both runtime roots', async t => {
  const f = await fixture(t); await f.seed(); await f.skills.applyLinks((await f.plan('claude', 'connect')).id); await link(f.claude, path.join(f.home, '.agents', 'skills'));
  const skill = await f.one(); assert.equal(skill.connections?.claude.reason, 'shared-entry'); assert.equal(skill.connections?.claude.canDisconnect, false);
  const prepared = await f.plan('claude', 'disconnect'); assert.equal(prepared.counts.remove, 0); assert.equal(prepared.items[0]?.reason, 'shared-entry'); await f.skills.applyLinks(prepared.id); assert.ok((await lstat(path.join(f.claude, 'shared'))).isSymbolicLink());
});
