import type {Attachment} from './types';
import {MAX_INLINE_TEXT_BYTES} from './input';
export type AttachmentChannel = 'full' | 'native' | 'api' | 'preview' | 'verify' | `plugin:${string}`;
export interface AttachmentPayloadPolicy { id:`plugin:${string}`; includeData(attachment:Readonly<Attachment>):boolean }
export interface AttachmentPayloadOptions { channel?:AttachmentChannel }
export interface AttachmentPayloadPolicyApi {
  register(policy:AttachmentPayloadPolicy):()=>void;
  includeData(attachment:Attachment,channel?:AttachmentChannel):boolean;
}
/** Byte inclusion follows the actual consumer, independently of source integrity checks. */
export class AttachmentPayloadPolicies implements AttachmentPayloadPolicyApi {
  private policies=new Map<string,AttachmentPayloadPolicy>();
  register(policy:AttachmentPayloadPolicy):()=>void{
    if(!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(policy.id)||typeof policy.includeData!=='function')throw Error('ATTACHMENT_POLICY_INVALID');
    if(this.policies.has(policy.id))throw Error('ATTACHMENT_POLICY_DUPLICATE');
    const entry={...policy};this.policies.set(entry.id,entry);return()=>{if(this.policies.get(entry.id)===entry)this.policies.delete(entry.id);};
  }
  includeData(item:Attachment,channel:AttachmentChannel='full'):boolean{
    const policy=this.policies.get(channel);if(policy)return policy.includeData(item);
    if(channel==='full')return true;
    if(channel==='verify')return false;
    if(channel==='preview')return item.mime.startsWith('image/');
    if(channel==='native'||channel==='api')return item.mime.startsWith('image/')||(channel==='api'&&item.mime==='application/pdf')||(item.mime==='text/plain'&&item.size<=MAX_INLINE_TEXT_BYTES);
    throw Error('ATTACHMENT_POLICY_UNAVAILABLE');
  }
}
