import type { Message, Session } from '../contracts';

/** Display metadata only. A citation is not proof of translation or memory ingestion. */
export function memoryCitations(text:string,nativeCitation?:unknown):NonNullable<Message['memoryReferences']>{
  const result:NonNullable<Message['memoryReferences']>=[];
  const add=(path:string,note:string)=>{
    const title=note||path;
    if(result.length<50&&!result.some(item=>item.path===path&&item.title===title))result.push({path,title,source:'native-citation'});
  };
  // App-server removes citation markup from agentMessage.text and sends this
  // separate field. Keep legacy text parsing for old runtimes and saved replies.
  if(nativeCitation&&typeof nativeCitation==='object'&&'entries' in nativeCitation&&Array.isArray(nativeCitation.entries)){
    for(const entry of nativeCitation.entries){
      if(!entry||typeof entry!=='object'||typeof entry.path!=='string'||!entry.path.trim()||typeof entry.note!=='string'
        ||!Number.isSafeInteger(entry.lineStart)||!Number.isSafeInteger(entry.lineEnd)||entry.lineStart<0||entry.lineEnd<entry.lineStart)continue;
      add(entry.path,entry.note);
    }
  }
  for(const block of text.matchAll(/<oai-mem-citation>([\s\S]*?)<\/oai-mem-citation>/g)){
    const entries=/<citation_entries>([\s\S]*?)<\/citation_entries>/.exec(block[1]!)?.[1]??'';
    for(const line of entries.split(/\r?\n/)){
      const match=/^\s*(.+?):(\d+)(?:-\d+)?\|note=\[([^\r\n]*)\]\s*$/.exec(line);
      if(match)add(match[1]!,match[3]!);
    }
  }
  return result;
}
export function visibleReply(text:string){return text.replace(/\s*<oai-mem-citation>[\s\S]*?(?:<\/oai-mem-citation>|$)/g,'').trimEnd();}

export function replyMemoryReferences(session:Session,message:Message):NonNullable<Message['memoryReferences']>{
  const explicit=message.memoryReferences?.length?message.memoryReferences:memoryCitations(message.original);if(explicit.length)return explicit;
  if((message.modelSource?.runtime??session.binding.runtime)!=='claude')return [];
  const index=session.messages.findIndex(m=>m.id===message.id),start=session.messages.slice(0,index).findLast(m=>m.role==='user')?.timestamp;
  if(!start)return [];
  const references:NonNullable<Message['memoryReferences']>=[];
  for(const activity of session.activities??[]){
    if(activity.runtime!=='claude'||activity.toolName!=='Read'||activity.status!=='completed'||activity.nativeChildId||activity.updatedAt<start||activity.updatedAt>message.timestamp||!activity.output)continue;
    try{const file=JSON.parse(activity.input??'{}').file_path;if(typeof file!=='string'||!/[\\/]\.claude[\\/]projects[\\/][^\\/]+[\\/]memory[\\/].+\.md$/i.test(file))continue;
      const title=/^#\s+(.+)$/m.exec(activity.output)?.[1]??file.split(/[\\/]/).at(-1)!;
      if(!references.some(item=>item.path===file))references.push({path:file,title,source:'native-read'});
    }catch{/* Only actual structured successful native reads qualify. */}
  }
  return references;
}
