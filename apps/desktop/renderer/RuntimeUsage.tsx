import type {RuntimeActivity} from '../../../packages/collaboration-core/activity';
import {usagePresentation} from '../../../packages/collaboration-core/usage-presentation';

export default function RuntimeUsage({item,sessionId}:{item:RuntimeActivity;sessionId?:string}) {
  const fields = item.runtime === 'claude' ? usagePresentation(item.output) : [];
  return <div data-workbench-runtime-usage data-activity-id={item.id} data-session-id={sessionId} data-runtime={item.runtime}>
    {fields.length ? <dl className="runtime-usage-values">{fields.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
      : <pre data-testid="activity-output">{item.output || '尚无可读统计'}</pre>}
  </div>;
}
