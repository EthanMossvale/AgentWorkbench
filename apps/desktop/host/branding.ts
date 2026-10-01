import {nativeImage} from 'electron';
import {defaultBranding} from '../../../packages/branding/default';
import type {BrandingSnapshot} from '../../../packages/branding/types';

export function brandingImage(brand:BrandingSnapshot=defaultBranding,tray=false){
  const image=nativeImage.createFromDataURL(tray?(brand.tray?.['16']??brand.app):brand.app);
  if(image.isEmpty())throw Error('BRANDING_IMAGE_UNAVAILABLE');
  if(!tray)return image;
  const result=image.resize({width:16,height:16,quality:'best'});
  for(const [size,url]of Object.entries(brand.tray??{}))if(Number(size)>16){
    result.addRepresentation({scaleFactor:Number(size)/16,buffer:Buffer.from(url.slice(22),'base64')});
  }
  return result;
}
