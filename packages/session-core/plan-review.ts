import type { Session, Message, NativeApproval } from '../contracts';
import { approvalPresentation } from '../native-approvals';
import { markdownBlocks, markdownTokens } from '../message-markdown';
import type { MessageTranslation } from '../translation/display';

export interface PlanReference { kind:'approval'|'message'; receipt:string }
export interface PlanBlock { source:string;translatable:boolean }
export interface PlanBlockTranslation extends MessageTranslation { translationStatus:NonNullable<MessageTranslation['translationStatus']> }
/** Keep Markdown containers intact; their prose remains eligible for translation. */
export function planBlocks(text:string):PlanBlock[] {
  return markdownBlocks(text).map(source=>({source,translatable:markdownTokens(source).some(token=>!['code','space','hr'].includes(token.type))}));
}
export type PlanTranslation = Pick<Message,'translation'|'translationStatus'|'translationError'|'translationSource'|'planTranslationBlocks'>;
export interface PlanDocument extends PlanTranslation {
  reference:PlanReference; runtime:'claude'|'codex'; text:string; blocks:PlanBlock[]; canRespond:boolean;
}
export function planTarget(session:Session, reference:PlanReference):NativeApproval|Message|undefined {
  return reference.kind==='approval'
    ? session.nativeApprovals?.find(a=>a.kind==='plan'&&a.receipt===reference.receipt)
    : session.messages.find(m=>m.planReview?.receipt===reference.receipt);
}
export function pendingCodexPlan(session:Session):Message|undefined {
  if(session.archived||session.binding.runtime!=='codex'||session.status!=='idle'||session.nativeTurnStatus!=='completed')return;
  const lastUser=session.messages.findLastIndex(m=>m.role==='user');
  return session.messages.slice(lastUser+1).findLast(m=>m.planReview?.status==='pending'&&m.nativeTurnId===session.nativeTurnId);
}
export function planDocument(session:Session, reference:PlanReference):PlanDocument|undefined {
  const target=planTarget(session,reference);if(!target)return;
  if(reference.kind==='approval') {
    const approval=target as NativeApproval,text=approvalPresentation(approval).plan;if(!text)return;
    return {reference,runtime:'claude',text,blocks:planBlocks(text),canRespond:session.binding.runtime==='claude'&&session.status==='running',...approval.planTranslation};
  }
  const message=target as Message;
  return {reference,runtime:'codex',text:message.original,blocks:planBlocks(message.original),canRespond:pendingCodexPlan(session)===message,
    translation:message.translation,translationStatus:message.translationStatus,translationError:message.translationError,translationSource:message.translationSource,planTranslationBlocks:message.planTranslationBlocks};
}
export function parsePlanReference(value:unknown):PlanReference {
  const v=value as Partial<PlanReference>|null;
  if(!v||!['approval','message'].includes(v.kind??'')||typeof v.receipt!=='string'||!v.receipt||v.receipt.length>256)throw Error('PLAN_REFERENCE_INVALID');
  return {kind:v.kind!,receipt:v.receipt};
}
