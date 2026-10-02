import { OrderedMutations } from '../../../packages/session-core/ordered-mutations';
import type { EventEmitter } from 'node:events';
import { isMetricsFrame, observeNativeMetrics } from '../../../packages/session-metrics/native';
import type { AppState, NativeEvent, Session } from '../../../packages/contracts';
import type { NativeFrame } from '../../../services/remote-supervisor';
import type { NativeChildEvent } from '../../../packages/collaboration-core/events';
import { NativeActivityTracker, mergeActivity, mergeChild, markObservationInterrupted } from '../../../packages/collaboration-core/activity';
import { recordFileChanges } from '../../../packages/collaboration-core/file-changes';
import { NativeChildConversationTracker, recordChildMessage } from '../../../packages/collaboration-core/child-conversation';
import { mergeChildSettings, nativeChildFrameSettings, providerChildSettings } from '../../../packages/collaboration-core/child-settings';
import { receiveGeneratedImage, type GeneratedImageObservation } from './generated-image-observation';
import { NativeEventMonitor, NativeEventRegistry, receiptKey, refreshNativeEventHistory, type NativeEventNotice } from '../../../packages/native-events';
import type { RuntimeActivity } from '../../../packages/collaboration-core/activity';
import { nativeEventSemantics } from '../../../packages/native-events/semantics';

/** Attach only from the trusted native bootstrap. There is deliberately no IPC equivalent. */
export function attachNativeObservation(sessionId: string, source: Pick<EventEmitter, 'on' | 'off'>, snapshot: () => AppState, update: (mutator: (state: AppState) => void) => Promise<unknown>, images?: GeneratedImageObservation, eventRegistry = new NativeEventRegistry()) {
  const identity = (state: AppState) => {
    const session = state.sessions.find(item => item.id === sessionId);
    if (!session || session.binding.runtime === 'demo') throw new Error('Native observation requires a native session.');
    const host = state.hosts.find(item => item.id === session.binding.hostId);
    const localProvider = !session.binding.hostId && (session.binding.egress === 'direct-api' && session.binding.modelConnectionId && session.binding.modelMappingId || session.binding.egress === 'runtime-managed' && session.binding.localAccountId && !session.binding.modelConnectionId);
    if (!host && !localProvider) throw new Error('Native observation requires the bound host or local provider.');
    const { nativeSessionId: _thread, ...providerBinding } = session.binding;
    // Native thread allocation is a result of bootstrap, not a change of account.
    // Display-name refreshes likewise do not change the SSH authority.
    const { name: _name, ...authority } = host ?? {};
    return { session, key: JSON.stringify([providerBinding, authority]) };
  };
  const initial = identity(snapshot()), tracker = new NativeActivityTracker(initial.session.binding.runtime as 'claude' | 'codex');
  const monitor = new NativeEventMonitor(initial.session.binding.runtime as 'claude'|'codex', eventRegistry, initial.session.nativeEventAudit);
  const pendingNotices = new Map<string,NativeEventNotice>();
  let auditTimer:ReturnType<typeof setTimeout>|undefined;
  const conversations=new NativeChildConversationTracker();
  const provider=initial.session.binding.egress==='direct-api'?snapshot().modelConnections?.find(c=>c.id===initial.session.binding.modelConnectionId)?.models.find(m=>m.id===initial.session.binding.modelMappingId):undefined;
  const selectedEffort=initial.session.modelSelection?.effort;
  const mappedSettings=provider?providerChildSettings(provider.model,{model:provider.model,effort:selectedEffort&&provider.efforts?.includes(selectedEffort)?selectedEffort:undefined}):undefined;
  let closed = false, failure: unknown;
  let nativeSessionId = initial.session.binding.nativeSessionId;
  const queue = new OrderedMutations<Session>(mutator => update(state => {
    const current = identity(state), thread = current.session.binding.nativeSessionId;
    if (current.key !== initial.key || nativeSessionId && thread !== nativeSessionId) throw new Error('Native observation identity changed.');
    nativeSessionId ??= thread;
    mutator(current.session);
  }),nativeEventSemantics.batchWindowMs());
  const failed = (error: unknown) => { failure = error; closed = true; if(auditTimer)clearTimeout(auditTimer); unbind(); };
  const enqueue = (mutator: (session: Session) => void) => {
    if (closed) return;
    void queue.push(mutator).catch(failed);
  };
  const flushAudit=()=>{
    if(auditTimer){clearTimeout(auditTimer);auditTimer=undefined;}
    const audit=monitor.snapshot(),notices=[...pendingNotices.values()];pendingNotices.clear();
    enqueue(session=>{
      session.nativeEventAudit=audit;session.activities??=[];
      for(const protocol of notices){const r=protocol.receipt,id='native-event:'+receiptKey(r),old=session.activities.find(a=>a.id===id);
        const activity:RuntimeActivity={id,runtime:r.runtime,kind:'tool',category:'notice',status:r.disposition==='observed'?'completed':'uncertain',startedAt:old?.startedAt??r.firstAt,updatedAt:r.lastAt,nativeOrder:r.lastSequence,...(r.nativeChildId?{nativeChildId:r.nativeChildId}:{}),protocol};
        mergeActivity(session.activities,activity);
      }
    });
  };
  const audit=(frame:NativeFrame,childId?:string)=>{
    if(closed)return;
    for(const notice of monitor.observe(frame,childId))pendingNotices.set(receiptKey(notice.receipt),notice);
    if(!auditTimer){const windowMs=nativeEventSemantics.auditWindowMs();auditTimer=setTimeout(flushAudit,Number.isFinite(windowMs)?Math.max(100,Math.min(1000,windowMs)):1000);}
  };
  const releaseRegistry=eventRegistry.subscribe(()=>{for(const notice of monitor.releaseMissingPresenters())pendingNotices.set(receiptKey(notice.receipt),notice);if(pendingNotices.size&&!closed)flushAudit();});
  for(const notice of monitor.releaseMissingPresenters())pendingNotices.set(receiptKey(notice.receipt),notice);
  const observe = (frame: NativeFrame, childId?: string) => {
    if(childId){const settings=mergeChildSettings(nativeChildFrameSettings(initial.session.binding.runtime as 'claude'|'codex',frame),mappedSettings);if(Object.keys(settings).length)enqueue(session=>{session.nativeChildren??=[];const existing=session.nativeChildren.find(c=>c.nativeChildId===childId||c.toolCallId&&childId==='parent-tool-use:'+c.toolCallId);if(existing)existing.settings=mergeChildSettings(existing.settings,settings);});}
    const activities = tracker.observe(frame, childId);
    if (activities.length) enqueue(session => { session.activities ??= []; for (const activity of activities) { mergeActivity(session.activities, activity); const merged=session.activities.find(item=>item.id===activity.id);if(merged)recordFileChanges(session,merged); } });
    if (!closed && images && frame.value.method === 'item/completed') for (const activity of activities.filter(a => a.category === 'image-generation' && a.status === 'completed')) {
      void queue.barrier(() => receiveGeneratedImage(frame, activity.id, initial.session, snapshot, update, images)).catch(failed);
    }
    if(childId){const runtime=initial.session.binding.runtime as 'claude'|'codex',message=conversations.observe(runtime,childId,frame);if(message)enqueue(session=>{session.nativeChildren??=[];let child=session.nativeChildren.find(child=>child.nativeChildId===childId||child.toolCallId&&childId==='parent-tool-use:'+child.toolCallId);if(!child){child={runtime,nativeChildId:childId,operation:'progress',status:'message',startedAt:frame.receivedAt,updatedAt:frame.receivedAt};session.nativeChildren.push(child);}recordChildMessage(child,message,frame);});}
  };
  const onEvent = (event: NativeEvent) => {
    if (event.sessionId !== sessionId || !event.raw) return;
    const frame = event.raw as NativeFrame;
    const p=frame.value.params as {threadId?:string;thread?:{id?:string};item?:{type?:string}}|undefined;
    // Explicit child channels own their frames. Unrelated native identities never
    // become parent activity, even when their event type is new.
    const threadId=p?.threadId??(frame.value.method==='thread/started'?p?.thread?.id:undefined);
    // Only thread-bearing envelopes need an ownership read. Token deltas without
    // an identity must not clone the entire application merely to inspect it.
    const nativeId=initial.session.binding.runtime==='codex'&&threadId?snapshot().sessions.find(s=>s.id===sessionId)?.binding.nativeSessionId:undefined;
    if(initial.session.binding.runtime==='codex'&&nativeId&&threadId&&threadId!==nativeId){
      // The image sink records an explicit ownership rejection before any file write.
      // Preserve that visible failure without admitting unrelated frames to the audit.
      if(images&&event.public&&frame.value.method==='item/completed'&&p?.item?.type==='imageGeneration')observe(frame);
      return;
    }
    if(initial.session.binding.runtime==='claude'&&frame.value.parent_tool_use_id)return;
    audit(frame);
    if(initial.session.binding.runtime==='claude'&&nativeEventSemantics.accepts(frame))enqueue(session=>nativeEventSemantics.apply(session,frame));
    if (!(initial.session.binding.modelConnectionId && initial.session.binding.egress === 'direct-api') && isMetricsFrame(initial.session.binding.runtime, frame)) enqueue(session => observeNativeMetrics(session, frame));
    if (!event.public) return;
    observe(event.raw as NativeFrame);
  };
  const onChildFrame = (value: { frame: NativeFrame; nativeChildId?: string; nativeThreadId?: string }) => { const id = value.nativeChildId ?? value.nativeThreadId; if (id) {audit(value.frame,id);observe(value.frame, id);} };
  const onRaw=(frame:NativeFrame)=>{if(initial.session.binding.runtime==='codex'&&frame.value.method===undefined)audit(frame);};
  const onChild = (event: NativeChildEvent) => { if (event.runtime !== initial.session.binding.runtime) return; enqueue(session => { session.nativeChildren ??= []; const previous=session.nativeChildren.find(child=>child.toolCallId&&child.toolCallId===event.toolCallId&&child.nativeChildId.startsWith('parent-tool-use:'));if(previous&&previous.nativeChildId!==event.nativeChildId)for(const activity of session.activities??[])if(activity.nativeChildId===previous.nativeChildId)activity.nativeChildId=event.nativeChildId;mergeChild(session.nativeChildren, {...event,settings:mergeChildSettings(event.settings,mappedSettings)}, new Date().toISOString()); }); };
  const onDisconnect = () => { flushAudit();enqueue(markObservationInterrupted); closed = true; unbind(); };
  const unbind = () => { source.off('raw',onRaw);source.off('event', onEvent); source.off('childEvent', onChildFrame); source.off('childAgent', onChild); source.off('disconnect', onDisconnect);releaseRegistry(); };
  source.on('raw',onRaw);source.on('event', onEvent); source.on('childEvent', onChildFrame); source.on('childAgent', onChild); source.on('disconnect', onDisconnect);
  enqueue(session => { session.nativeObservation = 'observing';delete session.nativeBackground;refreshNativeEventHistory(session); });
  return {
    async flush() { if(!closed)flushAudit();await queue.flush(); if (failure) throw failure; },
    async dispose() { if (!closed) onDisconnect(); await queue.flush(); if (failure) throw failure; },
  };
}
