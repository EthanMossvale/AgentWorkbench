import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function missingDependencies(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(name => {
    try {
      const installed = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
      return installed.version !== lock.packages?.[`node_modules/${name}`]?.version;
    } catch { return true; }
  });
}

export function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  if (process.platform === 'win32') {
    const found = spawnSync('where.exe', ['npm.cmd'], { encoding: 'utf8', windowsHide: true });
    if (found.status === 0) for (const item of found.stdout.trim().split(/\r?\n/)) {
      candidates.push(path.join(path.dirname(item), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    }
  }
  const result = candidates.find(item => item && path.basename(item) === 'npm-cli.js' && existsSync(item));
  if (!result) throw new Error('Cannot locate npm. Install the Node.js 24 distribution that includes npm.');
  return realpathSync(result);
}

export function electronEnvironment(environment) {
  const result = { ...environment };
  delete result.ELECTRON_RUN_AS_NODE;
  return result;
}

export function startDevelopment({ root = projectRoot, args = process.argv.slice(2), run = spawnSync } = {}) {
  if (args.some(arg => !['--check', '--help'].includes(arg))) throw new Error('Supported options: --check, --help');
  if (args.includes('--help')) {
    console.log('Start-Dev.cmd          Check dependencies, rebuild current source, and launch Electron.');
    console.log('Start-Dev.cmd --check  Perform the same preparation without opening a window.');
    return 0;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  const npmCli = resolveNpmCli();
  const npm = (...command) => {
    const result = run(process.execPath, [npmCli, ...command], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${command.join(' ')} failed (${result.status ?? result.signal ?? 'unknown'}).`);
  };

  console.log(`\nAgentWorkbench development startup\n${root}\n`);
  console.log('[1/4] Checking locked development dependencies...');
  const missing = missingDependencies(root);
  if (missing.length) {
    console.log(`Installing project dependencies from package-lock.json: ${missing.join(', ')}`);
    npm('ci', '--include=dev', '--no-audit', '--no-fund');
    if (missingDependencies(root).length) throw new Error('Dependency installation did not complete.');
  }
  console.log('[2/4] Preparing the Electron runtime...');
  npm('run', 'setup:electron');
  console.log('[3/4] Building the current source (never starts an outdated build on failure)...');
  npm('run', 'build');
  const binary = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32'
    ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
  if (!existsSync(binary)) throw new Error('The Electron executable is missing after setup.');
  if (args.includes('--check')) { console.log('[4/4] Ready. Check-only mode; no application was launched.'); return 0; }
  console.log('[4/4] Opening AgentWorkbench. Closing the window keeps it in the tray; choose Exit from its tray menu to finish.\n');
  // Hide helper consoles above, not the interactive app: SW_HIDE suppresses its first window.show().
  const launched = run(binary, [root], { cwd: root, stdio: 'inherit', windowsHide: false, env: electronEnvironment(process.env) });
  if (launched.error) throw launched.error;
  return launched.status ?? 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = startDevelopment(); }
  catch (error) { console.error(`\n[ERROR] ${error instanceof Error ? error.message : 'Startup failed.'}`); process.exitCode = 1; }
}
