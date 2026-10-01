import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { browseFile } from './file-browser';
import { visualizationDocument, type VisualizationPageOptions } from '../../../packages/visualizations/document';
import type { VisualizationDocument } from '../../../packages/visualizations';
const scheme='awb-preview:';
const types:Record<string,string>={'.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ico':'image/x-icon'};
const policy="default-src 'none'; script-src awb-preview: 'unsafe-inline'; style-src awb-preview: 'unsafe-inline'; img-src awb-preview: data: blob:; font-src awb-preview: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
/** User-opened artifact previews. Each opaque token can read only bounded sibling web assets. */
export class HtmlPreviewService {
  private pages=new Map<string,{root:string;html:string;bytes:number;inline?:boolean}>();
  async readVisualization(cwd:string,requested:string):Promise<VisualizationDocument>{
    if(typeof requested!=='string'||requested.length>4096||! /\.html?$/i.test(requested))throw Error('VISUALIZATION_PATH_INVALID');
    const view=await browseFile(cwd,requested);
    if(view.kind!=='text'||! /\.html?$/i.test(view.path))throw Error('VISUALIZATION_FILE_UNAVAILABLE');
    return {path:view.path,html:view.content!,digest:createHash('sha256').update(view.content!).digest('hex')};
  }
  createVisualization(options:VisualizationPageOptions){
    if([...this.pages.values()].filter(page=>page.inline).length>=128)throw Error('VISUALIZATION_PAGE_LIMIT');
    const html=visualizationDocument(options),token=randomUUID();this.pages.set(token,{root:'',html,bytes:0,inline:true});
    return {url:`${scheme}//${token}/index.html`};
  }
  releaseVisualization(url:string){if(!this.owns(url))return;const token=new URL(url).hostname;if(this.pages.get(token)?.inline)this.pages.delete(token);}
  async create(cwd:string,requested:string){
    const view=await browseFile(cwd,requested);
    if(view.kind!=='text'||! /\.html?$/i.test(view.path))throw Error('请选择 1 MB 以内的 UTF-8 HTML 文件。');
    const token=randomUUID();this.pages.set(token,{root:view.parent,html:view.content!,bytes:0});
    const ordinary=[...this.pages].filter(([,page])=>!page.inline);while(ordinary.length>24)this.pages.delete(ordinary.shift()![0]);
    return {url:`${scheme}//${token}/index.html`,path:view.path};
  }
  owns(url:string){try{const value=new URL(url);return value.protocol===scheme&&this.pages.has(value.hostname)&&value.pathname==='/index.html';}catch{return false;}}
  async response(request:Request):Promise<Response>{
    try{
      const url=new URL(request.url),page=this.pages.get(url.hostname);
      if(request.method!=='GET'||url.protocol!==scheme||!page||url.search)return new Response(null,{status:404});
      const headers={'Content-Security-Policy':page.inline?"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'":policy,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
      if(url.pathname==='/index.html')return new Response(page.html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
      if(page.inline)return new Response(null,{status:403});
      const requested=decodeURIComponent(url.pathname).replace(/^\//,'');
      if(requested.includes('\\')||requested.includes('\0')||requested.split('/').includes('..'))return new Response(null,{status:403});
      const type=types[path.extname(requested).toLowerCase()];if(!type)return new Response(null,{status:403});
      const file=await realpath(path.join(page.root,requested)),relative=path.relative(page.root,file);
      if(relative.startsWith('..')||path.isAbsolute(relative))return new Response(null,{status:403});
      const info=await stat(file);if(!info.isFile()||info.size>5*1024*1024||page.bytes+info.size>20*1024*1024)return new Response(null,{status:413});
      page.bytes+=info.size;const data=await readFile(file);if(data.length>5*1024*1024)return new Response(null,{status:413});
      return new Response(new Uint8Array(data),{headers:{...headers,'Content-Type':type}});
    }catch{return new Response(null,{status:404});}
  }
}
