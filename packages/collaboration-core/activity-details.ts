/** Public tool fields only. Do not serialize the native envelope or reasoning. */
export interface ActivityDetails {
  title?: string; input?: string; output?: string; cwd?: string;
  exitCode?: number; durationMs?: number; inputTruncated?: boolean; outputTruncated?: boolean;
  imagePaths?: string[];
}
const LIMIT = 64 * 1024;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const publicText = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
function contentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return;
  return value.flatMap(value => { const block = record(value); return ['text', 'inputText'].includes(String(block.type)) && typeof block.text === 'string' ? [block.text] : []; }).join('\n') || undefined;
}
const json = (value: unknown) => value === undefined || value === null ? undefined : JSON.stringify(value, null, 2);
export function boundedDetails(input?: string, output?: string): ActivityDetails {
  return { ...(input !== undefined ? { input: input.slice(0, LIMIT), inputTruncated: input.length > LIMIT } : {}),
    ...(output !== undefined ? { output: output.slice(0, LIMIT), outputTruncated: output.length > LIMIT } : {}) };
}
export function appendActivityOutput(previous: ActivityDetails, delta: string): ActivityDetails {
  return { ...previous, ...boundedDetails(undefined, (previous.output ?? '') + delta), outputTruncated: previous.outputTruncated || (previous.output?.length ?? 0) + delta.length > LIMIT };
}
export function codexActivityDetails(item: Record<string, unknown>): ActivityDetails {
  let input: string | undefined, output: string | undefined, title: string | undefined;
  if (item.type === 'commandExecution') { input = publicText(item.command); title = input; output = publicText(item.aggregatedOutput); }
  else if (item.type === 'fileChange' && Array.isArray(item.changes)) {
    const changes = item.changes.map(record);
    title = changes.map(change => publicText(change.path)).filter(Boolean).join(', ');
    input = changes.map(change => [publicText(change.path), publicText(change.diff)].filter(v => v !== undefined).join('\n')).join('\n\n');
  } else if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    title = [publicText(item.server) ?? publicText(item.namespace), publicText(item.tool)].filter(Boolean).join(' / ');
    input = typeof item.arguments === 'string' ? item.arguments : json(item.arguments);
    const result = record(item.result);
    output = contentText(item.contentItems) ?? contentText(result.content) ?? json(result.structuredContent);
    const error = publicText(record(item.error).message); if (error) output = [output, error].filter(Boolean).join('\n');
  } else if (item.type === 'collabAgentToolCall') {
    title = publicText(item.tool); input = publicText(item.prompt); output = json(item.agentsStates);
  } else if (item.type === 'webSearch') {
    title = publicText(item.query) ?? publicText(record(item.action).query) ?? 'Web search'; input = json(item.action);
  } else if (item.type === 'imageView') { title = publicText(item.path); input = title; }
  else if(item.type==='imageGeneration'){title=publicText(item.savedPath);input=publicText(item.revisedPrompt);output=publicText(record(item.failure).message);}
  else if(item.type==='enteredReviewMode'||item.type==='exitedReviewMode'){input=publicText(item.review);}
  else if(item.type==='hookPrompt'&&Array.isArray(item.fragments)){input=item.fragments.map(fragment=>publicText(record(fragment).text)).filter(Boolean).join('\n');}
  else if(item.type==='functionCallOutput'){title=publicText(item.name);output=contentText(item.output);}
  else if (item.type === 'subAgentActivity') { title = publicText(item.agentPath); }
  return { ...boundedDetails(input, output), ...(item.type==='imageView'&&typeof item.path==='string'&&item.path.length<=4096?{imagePaths:[item.path]}:{}), ...(title ? { title: title.replace(/\s+/g, ' ').slice(0, 300) } : {}),
    ...(typeof item.cwd === 'string' ? { cwd: item.cwd.slice(0, 4096) } : {}),
    ...(typeof item.exitCode === 'number' ? { exitCode: item.exitCode } : {}),
    ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}) };
}
export function claudeToolDetails(name: string, input: unknown): ActivityDetails {
  const args = record(input);
  const title = publicText(args.description) ?? publicText(args.command) ?? publicText(args.file_path) ?? publicText(args.path) ?? name;
  return { ...boundedDetails(json(input)), title: title.replace(/\s+/g, ' ').slice(0, 300) };
}
export const claudeResultText = contentText;
