import type {AccountUsage} from '../../../packages/account-usage/types';
import AccountQuotaWindows from './AccountQuotaWindows';
/** Shared official account quota presentation for local and SSH cards. */
export default function AccountQuotaSummary({accountId,usage,busy,onRefresh,summary}:{accountId:string;usage?:AccountUsage;busy:boolean;onRefresh():void;summary:string}){
 return <><div className="model-account-detail-toolbar"><span>{summary}</span><button className="text-button" data-testid="usage-refresh" disabled={busy} onClick={onRefresh}>{busy?'读取中…':'刷新状态'}</button></div><AccountQuotaWindows usage={usage} accountId={accountId}/>{usage?.pools.length?<p className="model-usage-note">额度更新于 {new Date(usage.observedAt).toLocaleString('zh-CN')}{usage.reason?' · '+usage.reason:''}</p>:<p className="model-usage-note">{usage?.reason??'等待官方额度回执；未读取的窗口不计作零额度。'}</p>}</>;
}
