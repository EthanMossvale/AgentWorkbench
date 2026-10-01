import {useEffect,useState} from 'react';
import {defaultBranding} from '../../../packages/branding/default';
import type {BrandingSnapshot} from '../../../packages/branding/types';
import './BrandMark.css';

export function Mark({small=false}:{small?:boolean}) {
  const [brand,setBrand]=useState<BrandingSnapshot>(defaultBranding);
  useEffect(()=>{
    const bridge=window.workbench;if(!bridge)return;let live=true,revision=-1;
    const apply=(value:BrandingSnapshot)=>{if(live&&value&&Number.isSafeInteger(value.revision)&&value.revision>=revision&&typeof value.app==='string'){revision=value.revision;setBrand(value);}};
    const release=bridge.onPluginEvent?.(event=>{if(event.type==='plugin'&&event.id==='workbench.branding'&&event.topic==='changed')apply(event.payload as BrandingSnapshot);})??(()=>{});
    void bridge.call<BrandingSnapshot>('branding/get').then(apply).catch(()=>{});
    return()=>{live=false;release();};
  },[]);
  return <div className={`brand-mark${small?' small':''}`} data-workbench-brand-mark={brand.id} role="img" aria-label={brand.label}><img src={brand.app} alt="" aria-hidden="true" draggable={false}/></div>;
}
