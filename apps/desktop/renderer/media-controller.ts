import type {Attachment} from '../../../packages/attachments/types';
import {api} from './App';
import type {AttachmentDraftResult} from './attachment-draft';
import type {AttachmentActionDefinition,AttachmentActionHandle} from './attachment-actions';
import type {TextPastePolicy,TextPastePolicyHandle,TextPasteDecision} from '../../../packages/attachments/paste';
/** Stable named mounts, resolved by api.surfaces and observeSurfaces. */
export type MediaSurfaceName = 'image-viewer' | 'image-viewer-actions' | 'image-viewer-zoom' | 'attachment-list' | 'attachment-menu' | 'runtime-image-log';
export interface ComposerSizing {maxHeight:number;viewportFraction:number}
const sizing:ComposerSizing[]=[];
export function measureComposer(content:number,viewport:number,chrome:number){const policy=sizing.at(-1)??{maxHeight:360,viewportFraction:.55};return Math.ceil(Math.max(62,Math.min(content,policy.maxHeight,viewport*policy.viewportFraction-Math.max(80,chrome))));}
export function setComposerSizing(policy:ComposerSizing){if(!Number.isFinite(policy.maxHeight)||policy.maxHeight<62||policy.maxHeight>600||!Number.isFinite(policy.viewportFraction)||policy.viewportFraction<.2||policy.viewportFraction>.7)throw Error('COMPOSER_SIZING_INVALID');const value={...policy};sizing.push(value);window.dispatchEvent(new Event('resize'));return()=>{const index=sizing.indexOf(value);if(index>=0){sizing.splice(index,1);window.dispatchEvent(new Event('resize'));}};}
let current:{images:Attachment[];initialId:string}|null=null,revision=0;const listeners=new Set<()=>void>();const emit=()=>{for(const listener of listeners)listener();};
export const imageViewerController={
 get:()=>current,
 subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
 show:(images:Attachment[],initialId:string)=>{if(!images.length||!images.some(i=>i.id===initialId))throw Error('IMAGE_VIEWER_SELECTION_INVALID');revision++;current={images,initialId};emit();},
 open:async(ids:string[],initialId=ids[0])=>{const generation=++revision;const images=(await api<Attachment[]>('attachments/views',{ids})).filter(i=>i.mime.startsWith('image/'));if(generation!==revision)return;if(!initialId||!images.some(i=>i.id===initialId))throw Error('IMAGE_VIEWER_SELECTION_INVALID');current={images,initialId};emit();return current;},
 close:()=>{revision++;current=null;emit();},
};
export interface MediaPluginApi {openImages(ids:string[],initialId?:string):Promise<void>;closeImages():void;addToDraft(ids:string[]):Promise<AttachmentDraftResult>;registerAttachmentAction(definition:AttachmentActionDefinition):AttachmentActionHandle;setComposerSizing(policy:ComposerSizing):()=>void;decideTextPaste(text:string):TextPasteDecision;registerTextPastePolicy(definition:TextPastePolicy):TextPastePolicyHandle}
