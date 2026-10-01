import type {RemoteCliPolicy,RemoteCliProvider} from './cli';

export const RETENTION_MIN_HOURS=1,RETENTION_MAX_HOURS=8760;
export interface RetentionSession {
 sessionId:string;accountId:string;accountGeneration:string;threadId:string|null;title?:string;
 lastModelActivity:number|null;idleSeconds:number|null;dueAt:number|null;eligible:boolean;
 clockReason:'activity_unknown'|'clock_ahead'|'expired'|'recent_model_activity';
 active:boolean;interrupted:boolean;uncertain:boolean;
 remoteState:'present'|'marked'|'reclaimed'|'restore_pending';operation:'archiving'|'restoring'|null;
 archiveId?:string;localArchive?:'partial'|'verified'|'reclaimed'|'restored';localBytes?:number;
}
export interface RetentionInspection {
 provider:RemoteCliProvider;policy:RemoteCliPolicy;available:boolean;observedAt:number;receivedAt:number;
 sessions:RetentionSession[];total:number;nextCursor:string|null;loginBusy:boolean;
 running:boolean;lastCheck?:{checkedAt:string;reclaimedBytes:number;deferred?:boolean;transferredBytes?:number;error?:string};
 issue?:string;
}
export type RetentionLogKind='checked'|'archiving'|'reclaimed'|'deferred'|'error'|'cancelled'|'restoring'|'restored'|'policy';
export interface RetentionLogEntry {
 id:string;at:number;lastAt:number;provider:RemoteCliProvider;kind:RetentionLogKind;message:string;
 sessionIds:string[];accountId?:string;archiveId?:string;code?:string;bytes?:number;repeat:number;
}
export interface RetentionLogPage {
 entries:RetentionLogEntry[];nextBefore:string|null;issue?:string;location:string;
 maxEntries:number;retentionDays:number;
}
export function retentionPolicy(value:unknown):RemoteCliPolicy {
 const p=value as RemoteCliPolicy;
 if(!p||!Number.isSafeInteger(p.revision)||p.revision<0||typeof p.autoUpdate!=='boolean'||typeof p.reclaimIdle!=='boolean'||!Number.isInteger(p.idleHours)||p.idleHours<RETENTION_MIN_HOURS||p.idleHours>RETENTION_MAX_HOURS)throw Error('远端 CLI 策略回执无效。');
 return {revision:p.revision,autoUpdate:p.autoUpdate,reclaimIdle:p.reclaimIdle,idleHours:p.idleHours,...(p.lastUpdateAttempt!==undefined?{lastUpdateAttempt:p.lastUpdateAttempt}:{}),...(p.lastUpdateError?{lastUpdateError:p.lastUpdateError}:{})};
}
export function retentionCountdown(row:RetentionSession,policy:RemoteCliPolicy,now:number):{label:string;reason:string} {
 if(row.operation==='restoring')return {label:'正在恢复',reason:'正在将本机原生归档还原到远端。'};
 if(row.operation==='archiving')return {label:'正在归档',reason:'完整副本校验通过后，才会删除远端副本。'};
 if(row.remoteState==='reclaimed')return {label:'已清理',reason:row.localArchive?'本机保留原生归档，继续会话时按需恢复。':'远端已回收；此设备尚未找到对应归档，请使用保存归档的设备恢复。'};
 if(!row.threadId)return {label:'暂无原生记录',reason:'尚未取得原生线程编号，不进入文件清理。'};
 if(row.dueAt===null)return {label:'时间待核实',reason:row.clockReason==='clock_ahead'?'最后活动时间晚于服务器时间，暂不据此删除。':'缺少可信模型活动时间，暂不据此删除。'};
 if(!policy.reclaimIdle)return {label:'未开启',reason:'自动清理已关闭；仍可查看实际闲置时间。'};
 const seconds=Math.max(0,Math.ceil(row.dueAt-now));
 if(!seconds)return {label:'待清理',reason:row.active?'已到设定时限，等待结束残留进程并归档。':'已到设定时限，等待工作台下一轮归档检查；不是删除完成时间。'};
 const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
 return {label:`${hours?hours+'时 ':''}${minutes}分 ${String(rest).padStart(2,'0')}秒`,reason:'按服务器最后模型／工具活动时间计算，查看界面不会续期。'};
}
