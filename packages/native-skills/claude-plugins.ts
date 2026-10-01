import path from 'node:path';
import { readJson, optionalText } from '../native-resources/files';
import type { SkillOrigin } from './index';

/** Installed registry is authoritative; stale cached versions are not installs. */
export async function claudePluginRoots(home: string, projects: string[]): Promise<SkillOrigin[]> {
  const registry = await readJson<any>(path.join(home, 'plugins', 'installed_plugins.json'), { version: 2, plugins: {} });
  const known = await readJson<any>(path.join(home, 'plugins', 'known_marketplaces.json'), {});
  if (registry.version !== 2 || !registry.plugins || typeof registry.plugins !== 'object') throw Error('Unsupported Claude installed plugin registry.');
  const roots: SkillOrigin[] = [];
  for (const [id, installations] of Object.entries(registry.plugins)) {
    if (!Array.isArray(installations)) continue;
    const at = id.lastIndexOf('@'); if (at <= 0) continue;
    const plugin = id.slice(0, at), marketplace = id.slice(at + 1), registration = known[marketplace];
    const repo = registration?.source?.repo;
    const marketplaceRoot = registration?.installLocation || path.join(home, 'plugins', 'marketplaces', marketplace);
    const catalog = await readJson<any>(path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json'), {});
    const entry = Array.isArray(catalog.plugins) ? catalog.plugins.find((p: any) => p.name === plugin) : undefined;
    const official = repo === 'anthropics/skills' || (repo === 'anthropics/claude-plugins-official' && typeof entry?.source === 'string' && entry.source.startsWith('./plugins/'));
    for (const install of installations) {
      if (typeof install.installPath !== 'string' || !path.isAbsolute(install.installPath)) continue;
      if (install.scope !== 'user' && (typeof install.projectPath !== 'string' || !projects.includes(install.projectPath))) continue;
      const manifest = await readJson<any>(path.join(install.installPath, '.claude-plugin', 'plugin.json'), {});
      const namespace = typeof manifest.name === 'string' ? manifest.name : plugin;
      const base: Omit<SkillOrigin, 'root'> = { provider: 'claude', kind: official ? 'official' : install.scope === 'user' ? 'personal' : 'project', pluginId: id, namespace, defaultEnabled: (entry?.defaultEnabled ?? manifest.defaultEnabled) !== false, settingsFile: install.scope === 'user' ? path.join(home, 'settings.json') : path.join(install.projectPath, '.claude', install.scope === 'local' ? 'settings.local.json' : 'settings.json') };
      const paths = (value: unknown) => typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
      const subset = (entry?.source === './' || entry?.source === '.') && paths(entry.skills).length > 0;
      const selected = subset ? paths(entry.skills) : ['skills', ...paths(manifest.skills), ...paths(entry?.skills)];
      if (!subset && !manifest.skills && await optionalText(path.join(install.installPath, 'SKILL.md'))) selected.push('.');
      for (const relative of selected) {
        const root = path.resolve(install.installPath, relative), rel = path.relative(install.installPath, root);
        if (path.isAbsolute(relative) || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Claude plugin skill path escapes its installation.');
        roots.push({ ...base, root });
      }
    }
  }
  return roots;
}
