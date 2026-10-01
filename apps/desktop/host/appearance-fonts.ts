import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { normalizeFontCatalog, type FontCatalog } from '../../../packages/appearance';
import { claudeReferenceFont } from './claude-reference-font';

const execute = promisify(execFile);
/** Only installed font family metadata, no font binaries, profiles or network requests. */
export async function listInstalledFonts(): Promise<FontCatalog> {
  if (process.platform !== 'win32') return {status:'unavailable',families:[],reason:'unsupported-platform'};
  try {
    const command = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Drawing; $fonts = [System.Drawing.Text.InstalledFontCollection]::new(); try { ConvertTo-Json -Compress -InputObject @($fonts.Families | ForEach-Object { $_.Name }) } finally { $fonts.Dispose() }';
    const {stdout} = await execute(path.join(process.env.SystemRoot ?? 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:8000,maxBuffer:1024*1024,encoding:'utf8'});
    return {...normalizeFontCatalog(JSON.parse(stdout.replace(/^\uFEFF/,''))),claude:await claudeReferenceFont.status(true)};
  } catch { return {status:'unavailable',families:[],reason:'enumeration-failed'}; }
}
