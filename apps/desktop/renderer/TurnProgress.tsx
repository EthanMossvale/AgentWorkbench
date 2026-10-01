import { useEffect, useState } from 'react';
import type { ReadingTurn } from '../../../packages/collaboration-core/reading-turns';
import { formatTurnDuration, turnElapsedMs } from '../../../packages/session-core/turn-timing';
import { activityLabel } from './RuntimeTimeline';
import './TurnProgress.css';

export default function TurnProgress({ turn }: { turn: ReadingTurn }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!turn.active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [turn.active, turn.timing?.id]);
  const elapsed = turn.timing ? turnElapsedMs(turn.timing, now) : null;
  const status = turn.active ? '已处理' : turn.timing?.status === 'uncertain' ? '用时未确认' : '用时';
  const live = [...turn.process, ...turn.answers].filter(entry => entry.type === 'activity' && entry.activity.status === 'running').at(-1);
  const output = [...turn.process, ...turn.answers].some(entry => entry.type === 'message' && entry.message.role === 'assistant');
  const sinceEvent=turn.lastNativeEventAt?Math.max(0,Math.floor((now-Date.parse(turn.lastNativeEventAt))/1000)):undefined;
  const quietSince=turn.lastVisibleEventAt??turn.timing?.startedAt;
  const quietMinutes=quietSince?Math.floor((now-Date.parse(quietSince))/60000):0;
  const progress = live?.type === 'activity' ? activityLabel(live.activity) : output ? '正在处理' : '等待 CLI 输出';
  return <span className={'turn-progress' + (turn.active ? ' is-active' : '')} data-turn-progress data-turn-id={turn.id} data-turn-status={turn.timing?.status} title={turn.timing?.status === 'stopped' ? '本回合已停止' : turn.timing?.status === 'failed' ? '本回合未完成' : undefined} data-testid="turn-progress">
    {turn.active && <span className="turn-progress-spinner" aria-hidden="true"/>}
    <span>{turn.active && elapsed === null ? '正在处理' : status}{elapsed !== null && <span className="turn-progress-duration"> {formatTurnDuration(elapsed)}</span>}</span>
    {turn.active && <span className="turn-progress-stage">{quietMinutes>=5&&live?.type==='activity'&&live.activity.category==='reasoning'?`持续思考，${quietMinutes} 分钟无正文或工具进展`:progress}{sinceEvent!==undefined&&<small data-testid="native-activity-age"> · {sinceEvent<5?'刚收到运行数据':`${sinceEvent} 秒前收到运行数据`}</small>}</span>}
  </span>;
}
