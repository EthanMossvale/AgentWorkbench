import {inflateSync} from 'node:zlib';
import {defaultBranding} from './default';
import type {BrandingApi,BrandingDefinition,BrandingSnapshot} from './types';
export type {BrandingApi,BrandingDefinition,BrandingSnapshot,BrandingHandle} from './types';

const crc32=(bytes:Buffer)=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
export function validateBrandingPng(value:string,expectedSize?:number) {
  const fail=()=>{throw Error('BRANDING_IMAGE_INVALID');};
  if(typeof value!=='string'||value.length>1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return fail();
  const png=Buffer.from(value.slice(22),'base64');
  if(png.length<45||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return fail();
  let width=0,height=0,ended=false,offset=8;const compressed:Buffer[]=[];
  while(offset+12<=png.length){
    const length=png.readUInt32BE(offset),end=offset+length+12;if(end>png.length)return fail();
    const type=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,end-4);
    if(!/^[A-Za-z]{4}$/.test(type)||/^[A-Z]/.test(type)&&!['IHDR','IDAT','IEND'].includes(type))return fail();
    if(crc32(png.subarray(offset+4,end-4))!==png.readUInt32BE(end-4))return fail();
    if(offset===8){
      if(type!=='IHDR'||length!==13)return fail();width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      if(width!==height||width<16||width>512||expectedSize!==undefined&&width!==expectedSize||data[8]!==8||data[9]!==6||data[10]!==0||data[11]!==0||data[12]!==0)return fail();
    }else if(type==='IHDR')return fail();
    if(type==='IDAT')compressed.push(data);
    if(type==='IEND'){if(length!==0||end!==png.length)return fail();ended=true;break;}
    offset=end;
  }
  if(!ended||!compressed.length)return fail();
  let pixels:Buffer;try{pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:(width*4+1)*height});}catch{return fail();}
  if(pixels.length!==(width*4+1)*height)return fail();
  for(let row=0;row<height;row++)if(pixels[row*(width*4+1)]!>4)return fail();
  return width;
}

/** One production host owner; consumers subscribe before plugin activation. */
export class BrandingRegistry {
  private entries=new Map<string,BrandingDefinition>();
  private listeners=new Set<(snapshot:BrandingSnapshot)=>void>();
  private revision=0;
  get():BrandingSnapshot {return {...structuredClone([...this.entries.values()].at(-1)??defaultBranding),revision:this.revision};}
  list():BrandingDefinition[]{return [defaultBranding,...this.entries.values()].map(({id,label,app,tray})=>structuredClone({id,label,app,tray}));}
  subscribe(listener:(snapshot:BrandingSnapshot)=>void){if(typeof listener!=='function')throw Error('BRANDING_LISTENER_INVALID');this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  private changed(){this.revision++;for(const listener of [...this.listeners])try{listener(this.get());}catch{/* Isolate observers; other consumers still receive the current identity. */}}
  register(owner:string,definition:BrandingDefinition){
    if(!/^[a-z][a-z0-9.-]{1,79}$/.test(owner)||!definition||!/^[a-z][a-z0-9.-]{0,79}$/.test(definition.id)||typeof definition.label!=='string'||!definition.label.trim()||definition.label.length>120)throw Error('BRANDING_DEFINITION_INVALID');
    const id=`plugin:${owner}/${definition.id}`;if(this.entries.has(id))throw Error('BRANDING_DUPLICATE_ID');
    validateBrandingPng(definition.app);
    if(definition.tray!==undefined){
      if(!definition.tray||typeof definition.tray!=='object'||Array.isArray(definition.tray)||Object.keys(definition.tray).length>12)throw Error('BRANDING_IMAGE_INVALID');
      for(const [size,image]of Object.entries(definition.tray)){if(!/^[1-9]\d{1,2}$/.test(size))throw Error('BRANDING_IMAGE_INVALID');validateBrandingPng(image,Number(size));}
    }
    const value=structuredClone({...definition,id});this.entries.set(id,value);this.changed();let live=true;
    return {id,dispose:()=>{if(!live)return;live=false;if(this.entries.get(id)===value){this.entries.delete(id);this.changed();}}};
  }
  scope(owner:string,assertActive:()=>void,own:(cleanup:()=>void)=>()=>void):BrandingApi{
    return Object.freeze({
      get:()=>{assertActive();return this.get();},list:()=>{assertActive();return this.list();},
      register:(definition:BrandingDefinition)=>{assertActive();const handle=this.register(owner,definition);const dispose=own(handle.dispose);try{assertActive();}catch(error){dispose();throw error;}return {id:handle.id,dispose};},
      subscribe:(listener:(snapshot:BrandingSnapshot)=>void)=>{assertActive();if(typeof listener!=='function')throw Error('BRANDING_LISTENER_INVALID');return own(this.subscribe(snapshot=>{assertActive();listener(snapshot);}));},
    });
  }
}
