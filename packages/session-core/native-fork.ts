import type { NativeForkSource, Session } from '../contracts';

export function claudeForkTransport(session: Session): boolean {
  const b=session.binding;
  return b.hostId ? b.egress==='vps'&&b.accountRuntime==='native-owner'&&b.executionId==='local-device'
    : !!(b.egress==='direct-api'&&b.modelConnectionId||b.egress==='runtime-managed'&&b.localAccountId&&!b.modelConnectionId);
}

/** Resolve only an exact recorded native turn; never replay public messages as a native fork. */
export function recordedNativeFork(session: Session, messageId?: string): NativeForkSource | undefined {
  if(!['codex','claude'].includes(session.binding.runtime))throw Error('NATIVE_FORK_UNSUPPORTED');
  if(!session.messages.length)return session.branch?.native?structuredClone(session.branch.native):undefined;
  const target=messageId?session.messages.find(message=>message.id===messageId):session.messages.at(-1);
  const threadId=session.binding.nativeSessionId??session.branch?.native?.threadId;
  const sourceSessionId=session.binding.nativeSessionId?(session.binding.executionSessionId??session.id):session.branch?.native?.sourceSessionId;
  if(session.binding.runtime==='claude'){
    if(!claudeForkTransport(session))throw Error('NATIVE_FORK_UNSUPPORTED');
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(!target||target.role!=='assistant'||target.nativeTurnEnd!==true||!uuid.test(target.nativeItemId??'')||!uuid.test(threadId??'')||!sourceSessionId||target.modelSource&&target.modelSource.runtime!=='claude'||session.modelTargetId&&target.modelSource?.targetId&&target.modelSource.targetId!==session.modelTargetId)throw Error('NATIVE_FORK_BOUNDARY_UNVERIFIED');
    return {sourceSessionId,threadId:threadId!,runtime:'claude',lastMessageId:target.nativeItemId};
  }
  if(!target?.nativeTurnId||!threadId||!sourceSessionId||target.role==='assistant'&&target.nativeTurnEnd!==true)throw Error('NATIVE_FORK_BOUNDARY_UNVERIFIED');
  return {sourceSessionId,threadId,...(messageId&&target.role==='user'?{beforeTurnId:target.nativeTurnId}:{lastTurnId:target.nativeTurnId})};
}
