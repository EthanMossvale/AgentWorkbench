import { build } from 'esbuild';
import {checkConfigurationRelease} from './remote-configuration-bundle.mjs';
import { mkdir, copyFile, cp } from 'node:fs/promises';
await checkConfigurationRelease(process.cwd());
await build({ entryPoints: ['apps/desktop/host/main.ts'], outfile: 'dist/host/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron','electron-updater'] });
await build({ entryPoints: ['apps/desktop/host/preload.ts'], outfile: 'dist/host/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron','electron-updater'] });
await mkdir('dist/renderer/licenses', { recursive: true });
await cp('services/vps-workspace-control', 'dist/host/workspace-control', { recursive: true, filter: source => !source.includes('__pycache__') });
await cp('services/vps-account-broker', 'dist/host/account-runtime', { recursive: true, filter: source => !source.includes('__pycache__') });
await copyFile('node_modules/monaco-editor/LICENSE', 'dist/renderer/licenses/monaco-editor.txt');
await copyFile('node_modules/smol-toml/LICENSE', 'dist/renderer/licenses/smol-toml.txt');
await copyFile('node_modules/marked/LICENSE', 'dist/renderer/licenses/marked.txt');
await copyFile('node_modules/katex/LICENSE', 'dist/renderer/licenses/katex.txt');
await copyFile('node_modules/entities/LICENSE', 'dist/renderer/licenses/entities.txt');
await copyFile('node_modules/@zip.js/zip.js/LICENSE', 'dist/renderer/licenses/zip-js.txt');

await cp('services/vps-browser', 'dist/host/remote-browser', {recursive:true,filter:source=>!source.includes('__pycache__')});
