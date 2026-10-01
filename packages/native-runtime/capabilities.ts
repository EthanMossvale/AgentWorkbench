import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { codexConfiguration, runCommand } from './process';

const cache = new Map<string, Promise<boolean>>();
/** Probe the installed parser in a disposable profile. No model turn or real user
 * configuration is involved. A rejected unknown field is the negative control. */
export async function codexToolMemoryCapability(executable: string): Promise<boolean> {
  const info = await stat(executable), key = `${await realpath(executable)}:${info.size}:${info.mtimeMs}`;
  let result = cache.get(key);
  if (!result) { result = probe(executable); cache.set(key, result); }
  const supported = await result;
  if (!supported) cache.delete(key); // A failed probe can be retried after a native update or transient process failure.
  return supported;
}
async function probe(executable: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'awb-config-capability-'));
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) if (['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT'].includes(name.toUpperCase())) env[name] = value;
    const home = path.join(directory, '.codex'); await mkdir(home);
    Object.assign(env, { HOME: directory, USERPROFILE: directory, CODEX_HOME: home, APPDATA: path.join(directory, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(directory, 'AppData', 'Local'), OTEL_SDK_DISABLED: 'true' });
    const help = await runCommand({ executable, args: ['app-server', '--help'] }, { env, cwd: directory, timeout: 10000 });
    if (!help.includes('--strict-config')) {
      // Legacy protocol was separately verified before strict parser probing existed.
      const version = await runCommand({ executable, args: ['--version'] }, { env, cwd: directory, timeout: 10000 });
      return /\b0\.155\.1(?:\s|$)/.test(version);
    }
    const accepted = async (content: string) => {
      await writeFile(path.join(home, 'config.toml'), content);
      try { await codexConfiguration(executable, env, directory, rpc => rpc('config/read', { includeLayers: false }), true); return true; }
      catch { return false; }
    };
    if (!await accepted('[memories]\ndisable_on_external_context = true\n')) return false;
    return !await accepted('[memories]\nawb_intentionally_unknown_field = true\n');
  } catch { return false; }
  finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
