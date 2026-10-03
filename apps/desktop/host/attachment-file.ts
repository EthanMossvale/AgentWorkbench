import {open,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export function attachmentMime(data:Buffer):string {
  if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg';
  if(/^GIF8[79]a/.test(data.subarray(0,6).toString()))return 'image/gif';
  if(data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(data.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  if(!data.includes(0)){try{new TextDecoder('utf-8',{fatal:true}).decode(data);return 'text/plain';}catch{}}
  return 'application/octet-stream';
}
/** Hash every source byte while retaining only data needed by the chosen consumer. */
export async function readAttachmentFile(file:string,retain:boolean|((mime:string)=>boolean)=false){
  const canonical=await realpath(file),handle=await open(canonical,'r');
  try{
    const before=await handle.stat();if(!before.isFile())throw Error('请添加普通文件，不能直接添加文件夹。');
    const hash=createHash('sha256'),buffer=Buffer.alloc(64*1024),chunks:Buffer[]=[];let length=0,type='text/plain',keep=typeof retain==='boolean'?retain:false,text=true;
    const decoder=new TextDecoder('utf-8',{fatal:true});
    while(length<before.size){
      const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,before.size-length),length);if(!bytesRead)throw Error('附件正在变化，请重新添加。');
      const chunk=buffer.subarray(0,bytesRead);
      if(length===0){type=attachmentMime(chunk);if(typeof retain==='function')keep=retain(type);}
      if(text){try{if(chunk.includes(0))text=false;else decoder.decode(chunk,{stream:true});}catch{text=false;}}
      hash.update(chunk);if(keep)chunks.push(Buffer.from(chunk));length+=bytesRead;
    }
    if(text){try{decoder.decode();}catch{text=false;}}
    if(!type.startsWith('image/')&&type!=='application/pdf')type=text?'text/plain':'application/octet-stream';
    const after=await handle.stat(),current=await stat(canonical);
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.ino!==before.ino||current.dev!==before.dev||await realpath(file)!==canonical)throw Error('附件正在变化，请重新添加。');
    return {size:length,sha256:hash.digest('hex'),mime:type,data:keep?Buffer.concat(chunks):undefined};
  }finally{await handle.close();}
}
