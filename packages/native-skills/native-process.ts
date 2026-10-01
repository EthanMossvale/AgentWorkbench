import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { codexConfiguration } from '../native-runtime/process';
import { samePath } from '../native-resources/files';

/** Metadata/configuration only. This transport never submits a model turn. */
async function exchange(executable: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, requests: Record<string, unknown>[], claude = false): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '', bytes = 0, index = 0, settled = false;
    const results: unknown[] = [];
    const timer = setTimeout(() => finish(Error('Native skill configuration timed out; refresh before retrying.')), 15000);
    function finish(error?: Error) {
      if (settled) return; settled = true; clearTimeout(timer); child.stdin.destroy();
      const done = () => error ? reject(error) : resolve(results);
      if (child.exitCode !== null || !child.pid) done(); else { child.once('close', done); child.kill(); }
    }
    const send = () => child.stdin.write(JSON.stringify(requests[index]) + '\n');
    child.on('error', () => finish(Error('Native skill runtime could not be started.')));
    child.on('exit', () => { if (!settled) finish(Error('Native skill runtime ended before confirmation.')); });
    child.stdin.on('error', () => finish(Error('Native skill configuration channel closed.')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(data); if (bytes > 8 * 1024 * 1024) return finish(Error('Native skill metadata exceeds limits.'));
      buffer += data;
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
        let value: any; try { value = JSON.parse(line); } catch { return finish(Error('Invalid native skill metadata.')); }
        if (claude ? value.type !== 'control_response' || value.response?.request_id !== 'skills-metadata' : value.id !== requests[index]?.id) continue;
        if (value.error || value.response?.subtype === 'error') return finish(Error('Native runtime rejected the skill configuration.'));
        results.push(claude ? value.response.response : value.result);
        if (++index === requests.length) return finish();
        send();
      }
    });
    send();
  });
}

export async function findExecutable(candidates: string[]) {
  for (const candidate of candidates) try { await access(candidate); return candidate; } catch { /* Try the next native installation. */ }
  return undefined;
}

export async function writeCodexSkill(executable: string, home: string, codexHome: string, file: string, enabled: boolean, name?: string, enablePlugin?: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT'].includes(key.toUpperCase())) env[key] = value;
  Object.assign(env, { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), OTEL_SDK_DISABLED: 'true' });
  await codexConfiguration(executable, env, codexHome, async rpc => {
    if (enablePlugin) {
      const config = await rpc('config/read', { includeLayers: true }), configFile = path.join(codexHome, 'config.toml');
      const user = config.layers?.find((layer: any) => layer.name?.type === 'user' && samePath(layer.name.file, configFile));
      if (!user?.version) throw Error('Native Codex user configuration is unavailable.');
      const plugins = user.config?.plugins ?? {};
      const result = await rpc('config/batchWrite', { filePath: configFile, expectedVersion: user.version, edits: [{ keyPath: 'plugins', value: { ...plugins, [enablePlugin]: { ...plugins[enablePlugin], enabled: true } }, mergeStrategy: 'replace' }] });
      if (result.status !== 'ok') throw Error('Native Codex plugin setting is overridden.');
    }
    const result = await rpc('skills/config/write', { ...(name ? { name } : { path: file }), enabled });
    if (result?.effectiveEnabled !== enabled) throw Error('Native Codex did not confirm the requested skill state.');
  });
}

export interface BundledSkill { name: string; description: string }
export interface ClaudeMetadata { version?: string; skills: BundledSkill[]; error?: string }
const cache = new Map<string, Promise<ClaudeMetadata>>();
export async function claudeBundledSkills(executable: string): Promise<ClaudeMetadata> {
  const info = await stat(executable), key = `${executable}:${info.size}:${info.mtimeMs}`;
  let value = cache.get(key); if (!value) { cache.clear(); value = discoverClaude(executable); cache.set(key, value); }
  const result = await value; if (result.error) cache.delete(key); return result;
}

/** A clean profile excludes user skills, hooks, logins and plugins. The native
 * disableBundledSkills difference separates prompt skills from fixed commands.
 * Accept only validated native response shapes and a successful capability difference. */
async function discoverClaude(executable: string): Promise<ClaudeMetadata> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'awb-skill-metadata-'));
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT'].includes(key.toUpperCase())) env[key] = value;
    Object.assign(env, { HOME: directory, USERPROFILE: directory, CLAUDE_CONFIG_DIR: path.join(directory, '.claude'), APPDATA: path.join(directory, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(directory, 'AppData', 'Local'), TEMP: directory, TMP: directory, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
    const version = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, ['--version'], { env, cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); let text = '';
      const timer = setTimeout(() => { child.kill(); reject(Error('Claude version probe timed out.')); }, 5000);
      child.on('error', reject); child.stdout.on('data', chunk => { text += chunk.toString(); if (text.length > 1000) child.kill(); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(text.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? '') : reject(Error('Claude version probe failed.')); });
    });
    if (!version) throw Error('Claude native version is unavailable.');
    const read = async (disabled: boolean) => {
      const [metadata] = await exchange(executable, ['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--no-session-persistence', '--settings', JSON.stringify({ disableBundledSkills: disabled, ...(disabled ? { skillOverrides: { doctor: 'off' } } : {}) })], env, directory, [{ type: 'control_request', request_id: 'skills-metadata', request: { subtype: 'initialize' } }], true);
      if (!Array.isArray(metadata?.commands) || metadata.commands.some((item: any) => !item || typeof item.name !== 'string' || typeof item.description !== 'string' || typeof item.builtin !== 'boolean')) throw Error('Claude native command metadata is unavailable.');
      return metadata.commands as { name: string; description: string; builtin: boolean }[];
    };
    const all = await read(false), remaining = new Set((await read(true)).map(item => item.name));
    const skills = all.filter(item => item.builtin === true && !remaining.has(item.name) && typeof item.name === 'string' && typeof item.description === 'string').map(({ name, description }) => ({ name, description }));
    if (!skills.length) throw Error('Claude bundled skill discovery returned no verified skills.');
    return { version, skills };
  } catch (error) { return { skills: [], error: (error as Error).message }; }
  finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
