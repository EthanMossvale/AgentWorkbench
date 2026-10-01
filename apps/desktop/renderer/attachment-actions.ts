import type {Attachment} from '../../../packages/attachments/types';

export type AttachmentActionSurface = 'history' | 'draft' | 'viewer' | 'activity';
export type CoreAttachmentAction = 'view' | 'open' | 'add-to-draft' | 'copy-image' | 'copy-path' | 'reveal' | 'save-as' | 'remove' | 'fit' | 'actual-size' | 'close';
export interface AttachmentActionContext {
  attachment: Readonly<Attachment>;
  surface: AttachmentActionSurface;
  /** Present for replacements; invokes the original core action once requested. */
  invokeDefault?: () => void | Promise<unknown>;
}
export interface AttachmentActionDefinition {
  id: string;
  label: string;
  surfaces?: readonly AttachmentActionSurface[];
  kind?: 'image' | 'file';
  replaces?: CoreAttachmentAction;
  run(context: AttachmentActionContext): void | Promise<unknown>;
}
export interface AttachmentActionHandle { id: string; dispose(): void }
export interface AttachmentMenuAction {
  id: string; label: string; icon?: string; shortcut?: string; disabled?: boolean;
  divider?: boolean; run: () => void | Promise<unknown>;
}

const coreIds = new Set<CoreAttachmentAction>(['view','open','add-to-draft','copy-image','copy-path','reveal','save-as','remove','fit','actual-size','close']);
interface Registration {id:string; owner:string; definition:AttachmentActionDefinition; active:boolean}
/** Production menu registry, shared by history, draft and viewer menus. */
export function createAttachmentActions() {
  const entries:Registration[]=[],listeners=new Set<()=>void>();let revision=0;
  const emit=()=>{revision++;for(const listener of listeners)listener();};
  return {
    subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    getSnapshot:()=>revision,
    register:(owner:string,definition:AttachmentActionDefinition):AttachmentActionHandle=>{
      if(!owner||!definition||!/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)||typeof definition.label!=='string'||!definition.label.trim()||definition.label.length>80||typeof definition.run!=='function'||(definition.kind!==undefined&&!['image','file'].includes(definition.kind))||(definition.replaces!==undefined&&!coreIds.has(definition.replaces))||(definition.surfaces!==undefined&&(!Array.isArray(definition.surfaces)||!definition.surfaces.length||definition.surfaces.some(value=>!['history','draft','viewer','activity'].includes(value)))))throw Error('ATTACHMENT_ACTION_INVALID');
      const id=`plugin:${owner}/${definition.id}`;
      if(entries.some(entry=>entry.id===id))throw Error('ATTACHMENT_ACTION_DUPLICATE');
      if(entries.filter(entry=>entry.owner===owner).length>=32)throw Error('ATTACHMENT_ACTION_LIMIT');
      const entry:Registration={id,owner,active:true,definition:{...definition,surfaces:definition.surfaces?[...definition.surfaces]:undefined}};
      const dispose=()=>{if(!entry.active)return;entry.active=false;entries.splice(entries.indexOf(entry),1);emit();};
      entries.push(entry);try{emit();}catch(error){dispose();throw error;}
      return {id,dispose};
    },
    resolve:(attachment:Attachment,surface:AttachmentActionSurface,base:AttachmentMenuAction[],busy=false):AttachmentMenuAction[]=>{
      const original=new Map(base.map(action=>[action.id,action])),result=[...base];
      for(const entry of entries){
        const {definition}=entry;
        if(definition.surfaces&&!definition.surfaces.includes(surface))continue;
        if(definition.kind&&(attachment.mime.startsWith('image/')?'image':'file')!==definition.kind)continue;
        const replaced=definition.replaces?original.get(definition.replaces):undefined;
        if(definition.replaces&&!replaced)continue;
        const action:AttachmentMenuAction={...replaced,id:definition.replaces??entry.id,label:definition.label,disabled:busy||replaced?.disabled,divider:replaced?.divider??true,run:()=>{
          if(!entry.active)throw Error('ATTACHMENT_ACTION_UNAVAILABLE');
          return definition.run(Object.freeze({attachment:Object.freeze({...attachment}),surface,...(replaced?{invokeDefault:()=>{if(!entry.active)throw Error('ATTACHMENT_ACTION_UNAVAILABLE');return replaced.run();}}:{})}));
        }};
        if(definition.replaces)result[result.findIndex(value=>value.id===definition.replaces)]=action;else result.push(action);
      }
      return result;
    },
  };
}
export const attachmentActions=createAttachmentActions();
