import {RememberedDetails} from './UiMemory';
import {Fragment,useSyncExternalStore,type ReactNode} from 'react';
import {activityGrouping,type ActivityGroupingEntry} from '../../../packages/collaboration-core/activity-groups';
import {Icon} from './ui';
import './ActivityGroups.css';

export default function ActivityGroups<T extends ActivityGroupingEntry>({entries,render}:{entries:readonly T[];render:(item:T)=>ReactNode}){
  useSyncExternalStore(activityGrouping.subscribe,activityGrouping.getRevision,activityGrouping.getRevision);
  return activityGrouping.group(entries).map(group=>{
    if(!group.diagnostic&&!group.label)return <Fragment key={group.id}>{render(group.items[0]!)}</Fragment>;
    const activities=group.items.flatMap(item=>item.activity?[item.activity]:[]);
    const running=activities.filter(item=>item.status==='running'),current=running.at(-1)??activities[0];
    const statuses=([['failed','失败'],['cancelled','已取消'],['uncertain','结果未确认']] as const).flatMap(([status,label])=>{const count=activities.filter(item=>item.status===status).length;return count?[`${count} 项${label}`]:[];});
    const state=[running.length?`${running.length} 项进行中`:`${group.items.length} 项`,...statuses].join(' · ');
    const hint=statuses.length>1?`${group.attention} 项需查看`:statuses[0]??(running.length?`${running.length} 项进行中`:`${group.items.length} 项`);
    const icon=group.diagnostic?'layers':current?.category==='read'?'document':current?.category==='search'?'search':current?.kind==='command'?'terminal':current?.kind==='file-edit'?'compose':'settings';
    return <RememberedDetails memoryId="ActivityGroups.details.1" scope={group.id} key={group.id} className={'activity-group'+(group.diagnostic?' activity-diagnostics':'')} data-workbench-activity-group data-testid="activity-group" data-group-id={group.id} data-group-kind={group.diagnostic?'diagnostic':'tools'} data-group-status={running.length?'running':group.attention?'attention':'settled'} body={()=><div className="activity-group-body">{group.items.map(item=><Fragment key={item.id}>{render(item)}</Fragment>)}</div>}>
      <summary aria-label={`${group.label} · ${state}`} title={group.label}>
        <span className={'activity-group-icon'+(running.length?' activity-pulse':'')}><Icon name={icon} size={13}/></span>
        <span className="activity-group-caption">{group.label}</span><small title={state} className={group.attention?'activity-group-attention':undefined}>{hint}</small><span className="activity-group-chevron"><Icon name="chevron" size={12}/></span>
      </summary>
    </RememberedDetails>;
  });
}
