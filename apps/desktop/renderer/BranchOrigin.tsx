import type { Session } from '../../../packages/contracts';
import { Icon } from './ui';
import './ForkDialog.css';
export default function BranchOrigin({session,source,onOpen}:{session:Session;source?:Session;onOpen:(id:string,messageId?:string)=>void}) {
  const branch=session.branch;if(!branch)return null;
  return <div className="branch-continuation" data-testid="branch-origin"><Icon name="branch" size={13}/><button className="text-button" disabled={!source} title={source?`返回 ${source.title}`:`来源：${branch.sourceTitle}（已删除）`} onClick={()=>onOpen(branch.sourceSessionId,branch.sourceMessageId)}>从聊天中继续</button>{!source&&<small>源聊天已删除</small>}</div>;
}
