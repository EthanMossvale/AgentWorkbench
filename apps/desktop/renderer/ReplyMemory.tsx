import { useId } from 'react';
import type { Message } from '../../../packages/contracts';
import { Icon } from './ui';
export default function ReplyMemory({references}:{references:Message['memoryReferences']}){
  const id=useId();if(!references?.length)return null;
  return <span className="reply-memory" tabIndex={0} aria-label="记忆来源" aria-describedby={id} data-testid="reply-memory"><Icon name="document" size={15}/><span className="reply-memory-tooltip" id={id} role="tooltip"><strong>记忆来源</strong><ul>{references.map((item,index)=><li key={index}>{item.title}<small>{item.source==='native-read'?'本轮读取 · ':'原生引用 · '}{item.path}</small></li>)}</ul></span></span>;
}
