/** File evidence, not model identity, is used to confirm a runtime handoff. */
export type MemoryRuntime = 'codex' | 'claude';
export interface MemoryHandoffSession {
  readonly sessionId: string;
  readonly runtime: MemoryRuntime;
  prepare(task: string, submissionId: string, permissionMode?: string): Promise<string>;
  finish(): Promise<void>;
}

const START = /<!-- agent-workbench-handoff:([a-f\d]{64}):start -->/g;
export const handoffStart = (id: string) => `<!-- agent-workbench-handoff:${id}:start -->`;
export const handoffEnd = (id: string) => `<!-- agent-workbench-handoff:${id}:end -->`;

/** Strip only explicit imported spans; unrelated native additions remain exportable. */
export function splitImports(text: string): { content: string; ids: string[]; spans: {id:string;content:string}[] } {
  const ids: string[] = [];
  const spans: {id:string;content:string}[] = [];
  let content = '', cursor = 0;
  for (const match of text.matchAll(START)) {
    const start = match.index!, id = match[1]!;
    if (start < cursor) throw Error('Nested native memory handoff markers.');
    const end = text.indexOf(handoffEnd(id), start + match[0].length);
    if (end < 0 || ids.includes(id)) throw Error('Invalid native memory handoff markers.');
    const body = text.slice(start + match[0].length, end);
    if (body.includes('<!-- agent-workbench-handoff:')) throw Error('Nested native memory handoff markers.');
    content += text.slice(cursor, start);
    cursor = end + handoffEnd(id).length;
    ids.push(id);
    spans.push({id,content:body});
  }
  content += text.slice(cursor);
  if (content.includes('<!-- agent-workbench-handoff:')) throw Error('Invalid native memory handoff markers.');
  return { content, ids, spans };
}
