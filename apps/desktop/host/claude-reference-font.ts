import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {redactDiagnostic} from '../../../packages/diagnostics';

const execute=promisify(execFile),MAX_FONT_BYTES=5*1024*1024;
export interface ClaudeFontStatus { available:boolean; italicAvailable:boolean; source:'installed-claude'; family:'Anthropic Serif'; reason?:string; }
const unavailable=():ClaudeFontStatus=>({available:false,italicAvailable:false,source:'installed-claude',family:'Anthropic Serif'});
/** Read-only local resource reference. Never copies, installs, exports or downloads font files. */
export class ClaudeReferenceFont {
  private cached?:Promise<{root:string;normal:string;italic?:string}|undefined>;
  constructor(private locate:()=>Promise<string|undefined>=locateInstalledClaudeAssets){}
  private async discover(){
    if(this.cached)return this.cached;
    const attempt=(async()=>{
      const location=await this.locate();if(!location)return;
      const root=await realpath(location),directory=path.join(root,'assets','v1');
      const files=(await readdir(directory)).filter(file=>file.endsWith('.css')).sort();let readBytes=0;let invalid:Error|undefined;
      for(const file of files.slice(0,1000)){
        const filename=await realpath(path.join(directory,file));if(!inside(root,filename))continue;
        const info=await stat(filename);if(info.size>4*1024*1024)continue;readBytes+=info.size;if(readBytes>20*1024*1024)break;
        const css=await readFile(filename,'utf8'),faces:Partial<Record<'normal'|'italic',string>>={};
        for(const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)){
          const body=match[1]!;if(!/(?:^|;)\s*font-family\s*:\s*["']?anthropic-serif["']?\s*(?:;|$)/i.test(body))continue;
          const url=body.match(/src\s*:\s*url\(\s*["']?(\/assets\/v1\/[a-z\d_-]+\.woff2)["']?\s*\)/i)?.[1];if(!url)continue;
          const font=await realpath(path.join(root,url.slice(1)));if(!inside(root,font))continue;
          const fontInfo=await stat(font);if(!fontInfo.isFile()||fontInfo.size<48){invalid=Error('APPEARANCE_REFERENCE_FORMAT_INVALID');continue;}if(fontInfo.size>MAX_FONT_BYTES){invalid=Error('APPEARANCE_REFERENCE_TOO_LARGE');continue;}
          if((await readFile(font)).subarray(0,4).toString()!=='wOF2'){invalid=Error('APPEARANCE_REFERENCE_FORMAT_INVALID');continue;}
          const style=/(?:^|;)\s*font-style\s*:\s*italic\s*(?:;|$)/i.test(body)?'italic':'normal';faces[style]=font;
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
    const info=await stat(actual);if(!info.isFile()||info.size<48)throw Error('APPEARANCE_REFERENCE_FORMAT_INVALID');if(info.size>MAX_FONT_BYTES)throw Error('APPEARANCE_REFERENCE_TOO_LARGE');
    const bytes=await readFile(actual);if(bytes.length>MAX_FONT_BYTES)throw Error('APPEARANCE_REFERENCE_TOO_LARGE');if(bytes.subarray(0,4).toString()!=='wOF2')throw Error('APPEARANCE_REFERENCE_FORMAT_INVALID');
    return bytes;
    }catch(error){this.cached=undefined;throw error;}
  }
}
function inside(root:string,file:string){const relative=path.relative(root,file);return !!relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
async function locateInstalledClaudeAssets():Promise<string|undefined>{
  if(process.platform!=='win32')return;
  const command='[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $app = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1; if ($app) { $app.InstallLocation }';
  const {stdout}=await execute(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:8000,maxBuffer:64*1024,encoding:'utf8'});
  const location=stdout.replace(/^\uFEFF/,'').trim();if(!path.isAbsolute(location)||/[\r\n]/.test(location))return;
  return path.join(location,'app','resources','ion-dist');
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
