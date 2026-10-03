import {nativeImage} from 'electron';
import {attachmentMime} from './attachment-file';
import type {GeneratedImageFormat} from '../../../packages/generated-images/types';

type RendererDecoder=(script:string)=>Promise<{width:number;height:number;png?:string}>;
async function decodeInBrowser(data:Buffer,execute:RendererDecoder,png=false){
  // Decode pixels in Chromium when nativeImage does not implement a format. No navigation or script from the image.
  const source=`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(data.toString('base64'))}),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes]));try{const result={width:image.width,height:image.height};if(${png}){const canvas=new OffscreenCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);const bytes=new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));result.png=btoa(text);}return result;}finally{image.close();}})()`;
  try{return await execute(source);}catch{throw Error('GENERATED_IMAGE_FORMAT_INVALID');}
}
/** Decode actual pixels using the desktop libraries, preserving source encoding. */
export async function decodeGeneratedImage(bytes:Uint8Array,execute?:RendererDecoder):Promise<GeneratedImageFormat>{
  const data=Buffer.from(bytes),mime=attachmentMime(data),extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[mime];
  if(!extension)throw Error('GENERATED_IMAGE_FORMAT_UNSUPPORTED');
  const image=nativeImage.createFromBuffer(data);
  if(image.isEmpty()&&!execute)throw Error('GENERATED_IMAGE_FORMAT_INVALID');
  const size=image.isEmpty()?await decodeInBrowser(data,execute!):image.getSize();
  return {mime,extension,width:size.width,height:size.height};
}
export async function imagePng(bytes:Uint8Array,execute:RendererDecoder):Promise<Uint8Array>{
  const data=Buffer.from(bytes),image=nativeImage.createFromBuffer(data);
  if(!image.isEmpty())return image.toPNG();
  const decoded=await decodeInBrowser(data,execute,true);return Buffer.from(decoded.png!,'base64');
}
