import {defaultClaudeMcpPolicy} from './policy';
/** Decode only the installed official Read envelope; ordinary text is never interpreted as an image. */
export function normalizeClaudeToolResult(name:string,result:unknown):unknown {
  const value=result as any;
  if(name!=='Read'||value?.isError||!Array.isArray(value?.content))return result;
  let failure:string|undefined,hasImage=false;
  const content=value.content.flatMap((block:any)=>{
    if(block?.type==='image')hasImage=true;
    if(block?.type!=='text'||typeof block.text!=='string')return [block];
    if(Buffer.byteLength(block.text,'utf8')>defaultClaudeMcpPolicy.resultBytes){failure='CLAUDE_LOCAL_READ_RESULT_TOO_LARGE';return [];}
    let parsed:any;try{parsed=JSON.parse(block.text);}catch{return [block];}
    if(parsed?.type!=='image')return [block];
    const {base64:data,type:mimeType}=parsed.file??{};
    const reject=()=>{failure='CLAUDE_LOCAL_IMAGE_RESULT_INVALID';return [];};
    if(typeof data!=='string'||!['image/png','image/jpeg','image/gif','image/webp'].includes(mimeType)||data.length>7*1024*1024||!data.length||data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))return reject();
    const bytes=Buffer.from(data,'base64');if(bytes.toString('base64')!==data)return reject();
    const signature=mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mimeType==='image/gif'?/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii')):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!signature)return reject();
    hasImage=true;
    const dimensions=Object.fromEntries(['width','height','originalWidth','originalHeight','resizedWidth','resizedHeight'].flatMap(key=>Number.isFinite(parsed.file.dimensions?.[key])&&parsed.file.dimensions[key]>=0?[[key,parsed.file.dimensions[key]]]:[]));
    const metadata={type:'image_metadata',...(Object.keys(dimensions).length?{dimensions}:{}),...(Number.isFinite(parsed.file.originalSize)&&parsed.file.originalSize>=0?{originalSize:parsed.file.originalSize}:{})};
    return [{type:'image',data,mimeType},...(Object.keys(metadata).length>1?[{type:'text',text:JSON.stringify(metadata)}]:[])];
  });
  if(failure)return {isError:true,content:[{type:'text',text:failure+': The local Read result could not be delivered safely. Use a smaller read range or a supported image.'}]};
  // Image bytes belong only in image blocks, never in a duplicate JSON envelope.
  const {structuredContent,...withoutStructured}=value;
  return {...(hasImage?withoutStructured:value),content};
}
