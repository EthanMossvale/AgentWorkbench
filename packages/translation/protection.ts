import { createHash, randomBytes } from 'node:crypto';
import type { Token } from 'marked';
import { markdownTokens } from '../message-markdown';
export const PROTECTION_VERSION = 2 as const;
export const hashText = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export interface ProtectedText { text: string; nonce: string; spans: { token: string; original: string }[]; sourceHash: string }
export function assertNoSecrets(text: string): void {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-|sk-ant-)[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["']?[^\s"']{8,}/i.test(text)) {
    throw new Error('检测到可能的凭据；请移除后再翻译。内容尚未发送。');
  }
}
/** Locate rendered code, including code nested under list/quote indentation. */
function markdownCodeRanges(text:string) {
  const ranges:{start:number;end:number}[]=[],escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const visit=(tokens:Token[])=>{for(const token of tokens){
    if(token.type==='code'){
      const raw=token.raw.replace(/\n+$/,''),opening=raw.match(/^[ \t]*(`{3,}|~{3,})[^\n]*\n/);
      if(token.codeBlockStyle!=='indented'&&(!opening||!new RegExp('\\n[ \\t]*'+opening[1]![0]+'{'+opening[1]!.length+',}[ \\t]*$').test(raw)))throw new Error('代码围栏不完整；请闭合或明确引用后再翻译。');
      const lines=raw.split('\n').map((line,index)=>'[ \\t]*(?:>[ \\t]*)*'+(index===0?'(?:(?:[-+*]|\\d+[.)])[ \\t]+)?':'')+escape(line));
      const matches=[...text.matchAll(new RegExp('(^|\\n)'+lines.join('\\r?\\n')+'(?=\\r?\\n|$)','g'))];
      if(!matches.length)throw new Error('代码片段无法完整保护；内容尚未发送。');
      for(const match of matches)ranges.push({start:match.index,end:match.index+match[0].length});
    }else if(token.type==='list')for(const item of token.items)visit(item.tokens);
    else if('tokens' in token&&Array.isArray(token.tokens))visit(token.tokens);
  }};
  visit(markdownTokens(text));return ranges;
}
// Conservative lexical protection, not a claim to understand arbitrary source languages.
export function protect(text: string): ProtectedText {
  assertNoSecrets(text);
  const nonce = randomBytes(8).toString('hex');
  const spans: ProtectedText['spans'] = [];
  const ranges: { start: number; end: number }[] = [];
  const add = (start: number, end: number) => { if (!ranges.some(r => start < r.end && end > r.start)) ranges.push({ start, end }); };
  const trimmed = text.trim();
  if (/^[\[{]/.test(trimmed)) { try { JSON.parse(trimmed); add(0, text.length); } catch { /* ordinary prose */ } }
  const codeRanges=markdownCodeRanges(text);for(const range of codeRanges)add(range.start,range.end);
  for (const match of text.matchAll(/\uE200visualize\uE202[^\r\n]*?\uE201/g)) add(match.index,match.index+match[0].length);
  // Quotes are prose unless they delimit an explicit path. Apostrophes inside
  // words must never pair up and hide the sentences between contractions.
  const quotedPaths = /"[^"\r\n]*"|(?<![\p{L}\p{N}_])'[^'\r\n]*'(?![\p{L}\p{N}_])|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』/gu;
  const pathPrefix = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|~[\\/])/;
  const patterns = [
    /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[^\n]*(?=\n|$)/g,
    /`+[^`\n]*`+/g,
    /(?:^|\n)(?:diff --git |--- a\/|\+\+\+ b\/)[\s\S]*/g,
    /(?:^|\n)(?:\$ |PS [^\n>]*> |(?:git|npm|pnpm|yarn|node|python3?|pip3?|curl|ssh|powershell|pwsh|bash|sh|cmd|cmake|cargo|go|dotnet)\s)[^\r\n]+/g,
    /(?:^|\n)\s*(?:\{[\s\S]*?\}|\[[\s\S]*?\])(?=\s*(?:\n|$))/g,
    quotedPaths,
    /(?:https?:\/\/|[a-z][a-z0-9+.-]*:\/\/)[^\s<>"'“”‘’「」『』`，。；！？）]+/gi,
    /(?:[A-Za-z]:[\\/]|\\\\)[^\s<>"'“”‘’「」『』，。；！？`]+/g,
    /(?<![\w:])\/(?:[\w.\-\p{L}\p{N}]+\/)*[\w.\-\p{L}\p{N}]+/gu,
    /\$\{?[A-Z_][A-Z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%|\b[A-Za-z_][\w.-]*\.(?:ts|tsx|js|mjs|json|py|md|txt|ini|png|dds|blend|yaml|yml)\b/g,
    /\b[a-f0-9]{40,64}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    if (pattern === quotedPaths && !pathPrefix.test(match[0].slice(1, -1))) continue;
    add(match.index, match.index + match[0].length);
  }
  const completeFences=[...codeRanges,...[...text.matchAll(patterns[0]!)].map(match=>({start:match.index,end:match.index+match[0].length}))];
  for(const match of text.matchAll(/(?:^|\n)[ \t]*(?:`{3,}|~{3,})/g)) {
    if(!completeFences.some(r=>match.index>=r.start&&match.index<r.end))throw new Error('代码围栏不完整；请闭合或明确引用后再翻译。');
  }
  ranges.sort((a,b) => a.start-b.start);
  let result = '', offset = 0;
  for (const r of ranges) {
    const token = `⟦AW_${nonce}_${spans.length}⟧`;
    spans.push({token, original:text.slice(r.start,r.end)});
    result += text.slice(offset,r.start) + token; offset = r.end;
  }
  result += text.slice(offset);
  return { text: result, nonce, spans, sourceHash: hashText(text) };
}
export function restore(translated: string, protectedText: ProtectedText): string {
  if (!translated.trim()) throw new Error('翻译服务返回空文本。');
  for (const span of protectedText.spans) {
    if (translated.split(span.token).length !== 2) throw new Error('受保护片段丢失或重复；已阻止提交。');
  }
  const known = new Set(protectedText.spans.map(s=>s.token));
  const tokens = translated.match(/⟦AW_[^⟧]*⟧/g) ?? [];
  if (tokens.some(t=>!known.has(t))) throw new Error('翻译中出现未知保护标记。');
  let result=translated;
  for (const span of protectedText.spans) result=result.replace(span.token,()=>span.original);
  return result;
}
