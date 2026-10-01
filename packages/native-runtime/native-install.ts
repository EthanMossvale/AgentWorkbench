import path from 'node:path';
import { lstat, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { noLinks, samePath } from '../native-resources/files';

const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function codexWindowsInstall(home: string, env: NodeJS.ProcessEnv) {
  const config = env.CODEX_HOME || path.join(home, '.codex');
  const bin = env.CODEX_INSTALL_DIR || path.join(env.LOCALAPPDATA || path.join(home, 'AppData/Local'), 'Programs/OpenAI/Codex/bin');
  return { bin, executable: path.join(bin, 'codex.exe'), root: path.join(config, 'packages/standalone') };
}

/** Validate the official standalone layout, including its two intentional junctions.
 * Never remove the native home, another package family, or an arbitrary PATH binary. */
export async function codexWindowsRemoval(home: string, env: NodeJS.ProcessEnv, executable: string, deep = false) {
  const { bin, root } = codexWindowsInstall(home, env), current = path.join(root, 'current'), releases = path.join(root, 'releases');
  if (!samePath(executable, path.join(bin, 'codex.exe'))) throw Error('CLI_UNINSTALL_UNSUPPORTED');
  await noLinks(root); await noLinks(path.dirname(bin)); await noLinks(releases);
  if (!(await lstat(bin)).isSymbolicLink() || !(await lstat(current)).isSymbolicLink()) throw Error('CLI_UNINSTALL_UNSUPPORTED');
  const release = await realpath(current), name = path.relative(releases, release);
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?-(?:x86_64|aarch64)-pc-windows-msvc$/.test(name)) throw Error('CLI_UNINSTALL_UNSUPPORTED');
  const selectedBin = await realpath(bin);
  if (!samePath(selectedBin, release) && !samePath(selectedBin, path.join(release, 'bin'))) throw Error('CLI_UNINSTALL_UNSUPPORTED');
  if (!samePath(await realpath(executable), path.join(selectedBin, 'codex.exe'))) throw Error('CLI_UNINSTALL_UNSUPPORTED');
  if (deep) {
    const inspect = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (samePath(file, current)) continue;
        if (entry.isSymbolicLink()) throw Error('CLI_UNINSTALL_UNSUPPORTED');
        if (entry.isDirectory()) await inspect(file);
      }
    };
    await inspect(root);
  }
  // Directory.Delete without recursion unlinks only the validated junctions.
  // An exclusive native install lock prevents our removal from racing its installer.
  const binTarget = await readlink(bin), currentTarget = await readlink(current), info = await stat(executable);
  const prefix = '\\\\?\\', normal = (value: string) => (value.startsWith(prefix) ? value.slice(prefix.length) : value).replace(/\\$/, '');
  // Recheck after acquiring the lock: an external updater may have completed
  // between the host's revision check and PowerShell starting.
  const guard = `$binLink=Get-Item -LiteralPath ${quote(bin)} -Force; $currentLink=Get-Item -LiteralPath ${quote(current)} -Force; $binary=Get-Item -LiteralPath ${quote(executable)} -Force; if ($binLink.LinkType -ne 'Junction' -or $currentLink.LinkType -ne 'Junction' -or (@($binLink.Target)[0]).Replace(${quote(prefix)},'').TrimEnd('\\') -ine ${quote(normal(binTarget))} -or (@($currentLink.Target)[0]).Replace(${quote(prefix)},'').TrimEnd('\\') -ine ${quote(normal(currentTarget))} -or $binary.Length -ne ${info.size} -or ([DateTimeOffset]$binary.LastWriteTimeUtc).ToUnixTimeMilliseconds() -ne ${Math.floor(info.mtimeMs)}) { throw 'CLI_INSTALL_STATE_CHANGED' }; `;
  return `$ErrorActionPreference='Stop'; $lock=[IO.File]::Open(${quote(path.join(root, 'install.lock'))},'OpenOrCreate','ReadWrite','None'); try { ${guard}[IO.Directory]::Delete(${quote(bin)}); [IO.Directory]::Delete(${quote(current)}); Remove-Item -LiteralPath ${quote(releases)} -Recurse -Force; if (Test-Path -LiteralPath ${quote(path.join(root, 'auto-update-version'))}) { Remove-Item -LiteralPath ${quote(path.join(root, 'auto-update-version'))} -Force } } finally { $lock.Dispose() }`;
}
