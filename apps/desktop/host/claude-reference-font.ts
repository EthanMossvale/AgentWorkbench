import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {redactDiagnostic} from '../../../packages/diagnostics';

const execute=promisify(execFile);
export interface ClaudeFontLocator { id: `plugin:${string}`; locate():Promise<string|string[]|undefined> }
export interface ClaudeFontStatus { available:boolean; italicAvailable:boolean; source:'installed-claude'; family:'Anthropic Serif'; reason?:string; }
const unavailable=():ClaudeFontStatus=>({available:false,italicAvailable:false,source:'installed-claude',family:'Anthropic Serif'});
/** Read-only local resource reference. Never copies, installs, exports or downloads font files. */
export class ClaudeReferenceFont {
  private cached?:Promise<{root:string;normal:string;italic?:string}|undefined>;
  private locators=new Map<string,ClaudeFontLocator>();
  constructor(private locate:()=>Promise<string|string[]|undefined>=locateInstalledClaudeAssets){}
  registerLocator(locator:ClaudeFontLocator):()=>void {
    if(!locator.id.startsWith('plugin:')||typeof locator.locate!=='function'||this.locators.has(locator.id))throw Error('APPEARANCE_REFERENCE_LOCATOR_INVALID');
    this.locators.set(locator.id,locator);this.cached=undefined;return()=>{if(this.locators.get(locator.id)===locator){this.locators.delete(locator.id);this.cached=undefined;}};
  }
  private async discover(){
    if(this.cached)return this.cached;
    const attempt=(async()=>{
      const locations:string[]=[];
      for(const locator of [...this.locators.values()].reverse()){const value=await locator.locate();if(this.locators.get(locator.id)===locator&&value)locations.push(...(Array.isArray(value)?value:[value]));}
      const defaults=await this.locate();if(defaults)locations.push(...(Array.isArray(defaults)?defaults:[defaults]));
      let invalid:Error|undefined;
      for(const location of locations){
      let root:string;try{root=await realpath(location);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
      const files:string[]=[],seen=new Set<string>();
      const walk=async(directory:string):Promise<void>=>{const resolved=await realpath(directory);if(seen.has(resolved))return;seen.add(resolved);for(const item of await readdir(resolved,{withFileTypes:true})){const file=path.join(resolved,item.name);if(item.isDirectory())await walk(file);else if(item.isFile()&&/\.css$/i.test(item.name))files.push(file);}};
      await walk(root);const faces:Partial<Record<'normal'|'italic',string>>={};
      for(const filename of files.sort()){
        const css=await readFile(filename,'utf8');
        for(const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)){
          const body=match[1]!;if(!/(?:^|;)\s*font-family\s*:\s*["']?anthropic[- ]serif["']?\s*(?:;|$)/i.test(body))continue;
          const url=body.match(/url\(\s*["']?([^\s"')]+)["']?\s*\)/i)?.[1];if(!url||/^[a-z]+:/i.test(url))continue;
          const relative=decodeURIComponent(url.split(/[?#]/)[0]!);
          const font=await realpath(relative.startsWith('/')?path.join(root,relative.slice(1)):path.resolve(path.dirname(filename),relative));if(!inside(root,font))continue;
          const fontInfo=await stat(font);if(!fontInfo.isFile()||fontInfo.size<48){invalid=Error('APPEARANCE_REFERENCE_FORMAT_INVALID');continue;}
          if((await readFile(font)).subarray(0,4).toString()!=='wOF2'){invalid=Error('APPEARANCE_REFERENCE_FORMAT_INVALID');continue;}
          const style=/(?:^|;)\s*font-style\s*:\s*italic\s*(?:;|$)/i.test(body)?'italic':'normal';faces[style]=font;
        }
      }
      if(faces.normal)return {root,normal:faces.normal,italic:faces.italic};
      }
      if(invalid)throw invalid;
    })();
    this.cached=attempt;
    try{const faces=await attempt;if(!faces&&this.cached===attempt)this.cached=undefined;return faces;}
    catch(error){if(this.cached===attempt)this.cached=undefined;throw error;}
  }
  async status(refresh=false):Promise<ClaudeFontStatus>{
    if(refresh)this.cached=undefined;
    try{const faces=await this.discover();return faces?{available:true,italicAvailable:!!faces.italic,source:'installed-claude',family:'Anthropic Serif'}:unavailable();}
    catch(error){return {...unavailable(),reason:redactDiagnostic(error instanceof Error?error.message:String(error))};}
  }
  async read(style:'normal'|'italic'):Promise<Uint8Array>{
    try{
    if(style!=='normal'&&style!=='italic')throw Error('APPEARANCE_REFERENCE_STYLE_INVALID');
    const faces=await this.discover(),file=faces?.[style];if(!faces||!file)throw Error('APPEARANCE_REFERENCE_UNAVAILABLE');
    const actual=await realpath(file);if(!inside(faces.root,actual))throw Error('APPEARANCE_REFERENCE_PATH_CHANGED');
    const info=await stat(actual);if(!info.isFile()||info.size<48)throw Error('APPEARANCE_REFERENCE_FORMAT_INVALID');
    const bytes=await readFile(actual);if(bytes.subarray(0,4).toString()!=='wOF2')throw Error('APPEARANCE_REFERENCE_FORMAT_INVALID');
    return bytes;
    }catch(error){this.cached=undefined;throw error;}
  }
}
function inside(root:string,file:string){const relative=path.relative(root,file);return !!relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
async function locateInstalledClaudeAssets():Promise<string[]>{
  const candidates=process.platform==='darwin'?['/Applications/Claude.app/Contents/Resources/ion-dist',path.join(os.homedir(),'Applications/Claude.app/Contents/Resources/ion-dist')]:process.platform==='linux'?['/opt/Claude/resources/ion-dist','/opt/claude/resources/ion-dist',path.join(os.homedir(),'.local/share/Claude/resources/ion-dist')]:[path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData/Local'),'AnthropicClaude'),path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData/Local'),'Programs','Claude')];
  if(process.platform!=='win32')return candidates;
  try{
  const command='[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $app = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1; if ($app) { $app.InstallLocation }';
  const {stdout}=await execute(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,maxBuffer:Infinity,encoding:'utf8'});
  const location=stdout.replace(/^\uFEFF/,'').trim();if(path.isAbsolute(location)&&!/[\r\n]/.test(location))candidates.unshift(path.join(location,'app','resources','ion-dist'));
  }catch{/* Non-Appx installations are discovered independently. */}
  return candidates;
}
export const claudeReferenceFont=new ClaudeReferenceFont();
/** The protocol has two fixed resources and accepts no file paths or remote origins. */
export async function referenceFontResponse(url:string,service=claudeReferenceFont):Promise<Response>{
  try{
    const parsed=new URL(url);if(parsed.protocol!=='awb-font:'||parsed.hostname!=='claude'||parsed.port||parsed.search||parsed.hash||parsed.username||parsed.password||!['/serif','/serif-italic'].includes(parsed.pathname))return new Response(null,{status:404});
    const bytes=await service.read(parsed.pathname==='/serif'?'normal':'italic');
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'font/woff2','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
  }catch(error){
    const code=(error as NodeJS.ErrnoException).code,message=error instanceof Error?error.message:String(error);
    const status=code==='ENOENT'||message==='APPEARANCE_REFERENCE_UNAVAILABLE'?404:code==='EACCES'||code==='EPERM'||message==='APPEARANCE_REFERENCE_PATH_CHANGED'?403:message==='APPEARANCE_REFERENCE_FORMAT_INVALID'?422:message==='APPEARANCE_REFERENCE_TOO_LARGE'?413:error instanceof TypeError?400:500;
    return new Response(redactDiagnostic(message),{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  }
}
