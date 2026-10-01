import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { NativeSkillsService } from '../packages/native-skills';
import { NativeSkillControls } from '../packages/native-skills/controls';
import { NativeResources } from '../apps/desktop/host/native-resources';

const markdown = (name: string) => `---\nname: ${name}\ndescription: A test skill.\n---\nTest instructions.\n`;
const put = async (file: string, text: string) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };
const json = (file: string, value: unknown) => put(file, JSON.stringify(value));
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'awb-skill-control-')); t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const home = path.join(root, 'home'), data = path.join(root, 'data'), codexHome = path.join(home, '.codex'), claudeHome = path.join(home, '.claude');
  const service = new NativeSkillsService(data, { home, codexHome, claudeHome }); await service.initialize();
  return { root, home, data, codexHome, claudeHome, service };
}
test('Claude toggle writes native command identity, preserves unrelated settings, and reflects external edits', async t => {
  const f = await fixture(t), file = path.join(f.claudeHome, 'skills', 'directory-command', 'SKILL.md'), settings = path.join(f.claudeHome, 'settings.json');
  await put(file, markdown('Display name')); await json(settings, { language: 'japanese', permissions: { deny: ['Bash(rm:*)'] }, skillOverrides: { other: 'name-only' } });
  const before = await readFile(file, 'utf8'), item = (await f.service.scan()).skills[0]!;
  await f.service.setEnabled(item.id, false);
  const saved = JSON.parse(await readFile(settings, 'utf8')); assert.equal(saved.skillOverrides['directory-command'], 'off'); assert.equal(saved.skillOverrides.other, 'name-only'); assert.equal(saved.language, 'japanese'); assert.deepEqual(saved.permissions, { deny: ['Bash(rm:*)'] }); assert.equal(await readFile(file, 'utf8'), before);
  saved.skillOverrides['directory-command'] = 'on'; await json(settings, saved); assert.equal((await f.service.scan()).skills[0]!.enabled, true);
});
test('old workbench-only disable records never masquerade as native disabled state', async t => {
  const f = await fixture(t); await put(path.join(f.claudeHome, 'skills', 'fixture', 'SKILL.md'), markdown('fixture'));
  const item = (await f.service.scan()).skills[0]!; await json(path.join(f.data, 'native-skills.json'), { version: 1, enabled: { [item.id]: false } });
  const service = new NativeSkillsService(f.data, f); await service.initialize(); const scan = await service.scan(); assert.equal(scan.skills[0]!.enabled, true); assert.match(scan.skills[0]!.warning!, /未写入原生配置/);
  await service.setEnabled(item.id, false); assert.equal((await service.scan()).skills[0]!.enabled, false); await service.setEnabled(item.id, true); assert.equal((await service.scan()).skills[0]!.warning, undefined);
});
test('Claude official registry honors active version, declared subset, publisher and native plugin group toggle', async t => {
  const f = await fixture(t), plugins = path.join(f.claudeHome, 'plugins'), marketplace = path.join(plugins, 'marketplaces', 'anthropic-agent-skills'), installation = path.join(plugins, 'cache', 'anthropic-agent-skills', 'document-skills', '1.0.0');
  await json(path.join(plugins, 'known_marketplaces.json'), { 'anthropic-agent-skills': { source: { source: 'github', repo: 'anthropics/skills' }, installLocation: marketplace } });
  await json(path.join(marketplace, '.claude-plugin', 'marketplace.json'), { plugins: [{ name: 'document-skills', source: './', strict: false, skills: ['./skills/pdf', './skills/docx'] }] });
  await json(path.join(plugins, 'installed_plugins.json'), { version: 2, plugins: { 'document-skills@anthropic-agent-skills': [{ scope: 'user', installPath: installation, version: '1.0.0' }] } });
  for (const name of ['pdf', 'docx', 'not-in-package']) await put(path.join(installation, 'skills', name, 'SKILL.md'), markdown(name));
  await put(path.join(plugins, 'cache', 'anthropic-agent-skills', 'document-skills', '9.0.0', 'skills', 'stale', 'SKILL.md'), markdown('stale'));
  const scan = await f.service.scan(); assert.deepEqual(scan.skills.map(s => s.name).sort(), ['docx', 'pdf']); assert.ok(scan.skills.every(s => s.origins[0]!.kind === 'official' && s.control?.kind === 'plugin'));
  await f.service.setEnabled(scan.skills[0]!.id, false); assert.ok((await f.service.scan()).skills.every(s => !s.enabled));
  const settings = JSON.parse(await readFile(path.join(f.claudeHome, 'settings.json'), 'utf8')); assert.equal(settings.enabledPlugins['document-skills@anthropic-agent-skills'], false); assert.equal(settings.skillOverrides, undefined);
  await f.service.setEnabled(scan.skills[1]!.id, true); assert.ok((await f.service.scan()).skills.every(s => s.enabled));
});
test('project overrides and malformed native configuration cannot present a functional switch', async t => {
  const f = await fixture(t), project = path.join(f.root, 'project'); await put(path.join(f.claudeHome, 'skills', 'fixture', 'SKILL.md'), markdown('fixture'));
  await json(path.join(project, '.claude', 'settings.local.json'), { skillOverrides: { fixture: 'on' } });
  const service = new NativeSkillsService(f.data, { ...f, projects: () => [project] }); await service.initialize(); let item = (await service.scan()).skills[0]!; assert.equal(item.control?.canToggle, false); await assert.rejects(service.setEnabled(item.id, false), /unavailable|overridden/);
  await put(path.join(f.claudeHome, 'settings.json'), '{ malformed'); item = (await service.scan()).skills[0]!; assert.equal(item.control?.kind, 'unavailable'); assert.equal(item.available, false);
});
test('linked settings are not rewritten and source-linked skills remain readable', async t => {
  const f = await fixture(t), external = path.join(f.root, 'external'), source = path.join(external, 'linked-name'); await put(path.join(source, 'SKILL.md'), markdown('different-display-name'));
  await mkdir(path.join(f.claudeHome, 'skills'), { recursive: true }); await symlink(source, path.join(f.claudeHome, 'skills', 'native-alias'), 'junction');
  const item = (await f.service.scan()).skills[0]!; await f.service.setEnabled(item.id, false); assert.equal(JSON.parse(await readFile(path.join(f.claudeHome, 'settings.json'), 'utf8')).skillOverrides['native-alias'], 'off');
  await rm(path.join(f.claudeHome, 'settings.json')); await put(path.join(external, 'settings.json'), '{}'); await symlink(path.join(external, 'settings.json'), path.join(f.claudeHome, 'settings.json'), 'file');
  await assert.rejects(f.service.setEnabled(item.id, false), /Linked/); assert.equal(await readFile(path.join(external, 'settings.json'), 'utf8'), '{}');
});
test('bundled global override stays blocked while a disabled Codex parent requires explicit confirmation', async t => {
  const f = await fixture(t); await json(path.join(f.claudeHome, 'settings.json'), { disableBundledSkills: true });
  await put(path.join(f.codexHome, 'config.toml'), '[plugins."fixture@openai-bundled"]\nenabled = false\n');
  const controls = new NativeSkillControls({ ...f, projects: [], codexExecutable: 'unused' }); await controls.load();
  const base = { id: 'test', name: 'debug', description: '', displayName: '', shortDescription: '', path: '', directory: '', hash: '', enabled: true, available: false, conflicts: [] };
  const builtin = { ...base, builtin: true, origins: [{ provider: 'claude' as const, kind: 'official' as const, root: '' }], control: undefined as any }; controls.decorate(builtin); assert.equal(builtin.enabled, false); assert.equal(builtin.control.canToggle, false);
  const plugin = { ...base, origins: [{ provider: 'codex' as const, kind: 'official' as const, root: '', pluginId: 'fixture@openai-bundled' }], control: undefined as any }; controls.decorate(plugin); assert.equal(plugin.enabled, false); assert.equal(plugin.control.canToggle, true); assert.equal(plugin.control.enableParent, true); await assert.rejects(controls.write(plugin, true), /explicit confirmation/);
});

test('official Skill export is rejected before opening a save dialog', async t => {
  const f = await fixture(t); await put(path.join(f.codexHome, 'skills/.system/official-fixture/SKILL.md'), markdown('official-fixture'));
  let dialogs = 0; const host = new NativeResources(f.data, { openZip: async () => null, saveZip: async () => { dialogs++; return path.join(f.root, 'no.zip'); } }, () => [], () => {}, f.home); await host.initialize(); t.after(() => host.dispose());
  const item = (await host.skills.scan()).skills[0]!; await assert.rejects(host.call('native-skills/export', { id: item.id, hash: item.hash }), /Only personal/); assert.equal(dialogs, 0);
  await assert.rejects(host.skills.exportZip(item.id, item.hash, path.join(f.root, 'no.zip')), /Only personal/); await assert.rejects(readFile(path.join(f.root, 'no.zip')));
});
