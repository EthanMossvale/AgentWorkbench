import path from 'node:path';
import { access, copyFile, realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { browseFile, resolveBrowsePath } from './file-browser';
import { fileReference } from '../../../packages/navigation/file-links';

export type FileOpenTarget = 'default' | 'vscode' | 'visual-studio' | 'explorer' | 'terminal' | 'git-bash' | 'wsl';
export interface FileOpenOption { id: FileOpenTarget; label: string; available: boolean }
export interface FileActionInfo { path: string; directory: boolean; options: FileOpenOption[] }
interface Dependencies {
  openPath: (target: string) => Promise<void>; reveal: (target: string) => void;
  copy: (text: string) => void; pickSave: (source: string) => Promise<string | null>;
  launch?: (exe: string, args: string[], cwd: string) => Promise<void>;
  exists?: (file: string) => Promise<boolean>; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform;
}
/** User-invoked desktop actions only. Executable IDs are resolved here, never supplied by the renderer. */
export class FileActionService {
  constructor(private readonly dependencies: Dependencies) {}
  private async executables(): Promise<Partial<Record<FileOpenTarget, string>>> {
    const env = this.dependencies.env ?? process.env, platform = this.dependencies.platform ?? process.platform;
    const exists = this.dependencies.exists ?? (async (file: string) => { try { await access(file); return true; } catch { return false; } });
    const candidates: Partial<Record<FileOpenTarget, string[]>> = {};
    if (platform === 'win32') {
      const programDirs = [env.ProgramFiles, env['ProgramFiles(x86)']].filter((item): item is string => !!item);
      candidates.vscode = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe'), ...programDirs.map(dir => path.join(dir, 'Microsoft VS Code/Code.exe'))].filter((item): item is string => !!item);
      candidates['visual-studio'] = programDirs.flatMap(dir => ['2026', '2022', '2019'].flatMap(year => ['Community', 'Professional', 'Enterprise'].map(edition => path.join(dir, 'Microsoft Visual Studio', year, edition, 'Common7/IDE/devenv.exe'))));
      candidates.terminal = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft/WindowsApps/wt.exe'), env.SystemRoot && path.join(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')].filter((item): item is string => !!item);
      candidates['git-bash'] = [...programDirs.map(dir => path.join(dir, 'Git/git-bash.exe')), ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Programs/Git/git-bash.exe')] : [])];
      candidates.wsl = env.SystemRoot ? [path.join(env.SystemRoot, 'System32/wsl.exe')] : [];
    }
    const found: Partial<Record<FileOpenTarget, string>> = {};
    await Promise.all(Object.entries(candidates).map(async ([key, files]) => { for (const file of files) if (await exists(file)) { found[key as FileOpenTarget] = file; break; } }));
    return found;
  }
  async info(cwd: string, requested: string): Promise<FileActionInfo> {
    const target = await resolveBrowsePath(cwd, requested), metadata = await stat(target), executables = await this.executables();
    if (!metadata.isFile() && !metadata.isDirectory()) throw Error('此路径不是普通文件或目录。');
    const labels: [FileOpenTarget, string][] = [['vscode', 'VS Code'], ['visual-studio', 'Visual Studio'], ['default', '默认应用'], ['explorer', '文件资源管理器'], ['terminal', '终端'], ['git-bash', 'Git Bash'], ['wsl', 'WSL']];
    return { path: target, directory: metadata.isDirectory(), options: labels.map(([id, label]) => ({ id, label, available: id === 'default' || id === 'explorer' || !!executables[id] })) };
  }
  async open(cwd: string, requested: string, targetId: string): Promise<void> {
    if (!['default', 'vscode', 'visual-studio', 'explorer', 'terminal', 'git-bash', 'wsl'].includes(targetId)) throw Error('不支持此打开方式。');
    const target = await resolveBrowsePath(cwd, requested), metadata = await stat(target);
    if (!metadata.isFile() && !metadata.isDirectory()) throw Error('此路径不是普通文件或目录。');
    if (targetId === 'default') return this.dependencies.openPath(target);
    if (targetId === 'explorer') { if (metadata.isDirectory()) await this.dependencies.openPath(target); else this.dependencies.reveal(target); return; }
    const exe = (await this.executables())[targetId as FileOpenTarget];
    if (!exe) throw Error('未找到此应用，请先安装或选择其他打开方式。');
    const directory = metadata.isDirectory() ? target : path.dirname(target), line = fileReference(requested)?.line;
    const args = targetId === 'vscode' ? (!metadata.isDirectory() && line ? ['--goto', `${target}:${line}`] : [target])
      : targetId === 'visual-studio' ? [target]
      : targetId === 'git-bash' ? [`--cd=${directory}`]
      : targetId === 'wsl' ? ['--cd', directory]
      : path.basename(exe).toLowerCase() === 'wt.exe' ? ['-d', directory] : ['-NoLogo', '-NoExit'];
    await (this.dependencies.launch ?? launchApplication)(exe, args, directory);
  }
  async copyContent(cwd: string, requested: string): Promise<void> {
    const target = await resolveBrowsePath(cwd, requested);
    let view = await browseFile('', target);const chunks:string[]=[];
    for(;;){
      if(view.kind!=='text')throw Error('仅支持复制 UTF-8 文本文件。');
      chunks.push(view.content!);if(!view.next)break;
      view=await browseFile('',target,{cursor:view.next});
    }
    this.dependencies.copy(chunks.join(''));
  }
  async saveAs(cwd: string, requested: string): Promise<boolean> {
    const source = await resolveBrowsePath(cwd, requested), before = await stat(source);
    if (!before.isFile()) throw Error('请选择文件，不能将文件夹另存为。');
    const destination = await this.dependencies.pickSave(source);
    if (!destination) return false;
    if (!path.isAbsolute(destination)) throw Error('保存位置必须是绝对路径。');
    const existing = await stat(destination).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing && (existing.dev === before.dev && existing.ino === before.ino || await realpath(destination) === source)) throw Error('请选择其他保存位置，原文件将保持不变。');
    await copyFile(source, destination);
    return true;
  }
}
function launchApplication(exe: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, shell: false, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
