import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Regenerate reviewed source assets in a hidden, disposable Electron process.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'packages/branding'),svg=await readFile(path.join(directory,'connected-w.svg'),'utf8');
const temp=await mkdtemp(path.join(tmpdir(),'awb-branding-assets-'));
await writeFile(path.join(temp,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temp,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true}});w.loadURL('data:text/html,<body></body>');});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app=await electron.launch({executablePath:electronPath,args:[path.join(temp,'main.cjs')],cwd:temp,env,timeout:30000});
  const page=await app.firstWindow();
  const images=await page.evaluate(async source=>{
    const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source);await image.decode();
    const result={};
    for(const size of [16,20,24,32,48,64,128,256]){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
      const context=canvas.getContext('2d');context.drawImage(image,0,0,size,size);result[size]=canvas.toDataURL('image/png');
    }
    return result;
  },svg);
  await writeFile(path.join(directory,'generated.json'),JSON.stringify({sourceSha256:createHash('sha256').update(svg).digest('hex'),images},null,2)+'\n');
  const sizes=[16,24,32,48,64,128,256],pngs=sizes.map(size=>Buffer.from(images[size].split(',')[1],'base64'));
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
  sizes.forEach((size,index)=>{const start=6+index*16;header[start]=header[start+1]=size===256?0:size;header.writeUInt16LE(1,start+4);header.writeUInt16LE(32,start+6);header.writeUInt32LE(pngs[index].length,start+8);header.writeUInt32LE(offset,start+12);offset+=pngs[index].length;});
  await writeFile(path.join(directory,'connected-w.ico'),Buffer.concat([header,...pngs]));
  console.log('Generated connected-W PNG representations and Windows ICO from the approved SVG.');
} finally { if(app)await app.close();await rm(temp,{recursive:true,force:true}); }
