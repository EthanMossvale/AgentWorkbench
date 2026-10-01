import { Marked, Tokenizer, type Token, type TokensList } from 'marked';
import { decodeHTMLStrict } from 'entities';
import { fileLinkDestination, webReference, type LinkedText } from '../navigation/file-links';
import { mathExtensions, markdownMath, maskMathEmphasis } from './math';
import { visualizationExtension } from '../visualizations';
export { markdownMath, type MarkdownMathToken, type MarkdownMathResult } from './math';

// CommonMark treats \\. and \\_ as escapes. In a native drive path they are
// directory separators, so recover the destination before those escapes vanish.
function nativeDestination(source: string): string | undefined {
  const value=source.trimStart(),angled=value.startsWith('<'),rest=angled?value.slice(1):value;
  if(!/^\/?[a-z]:\\/i.test(rest))return;
  let end=0,depth=0;
  for(;end<rest.length;end++){
    const char=rest[end];
    if(angled){if(char==='>')break;}
    else {if(/\s/.test(char!))break;if(char==='(')depth++;if(char===')'){if(!depth)break;depth--;}}
  }
  return rest.slice(0,end);
}
function linkDestination(raw:string):string|undefined {
  let depth=0;
  for(let i=raw.startsWith('!')?1:0;i<raw.length;i++){
    if(raw[i]==='\\'){i++;continue;}
    if(raw[i]==='[')depth++;
    if(raw[i]===']'&&--depth===0&&raw[i+1]==='(')return nativeDestination(raw.slice(i+2));
  }
}
const parser = new Marked({ gfm: true, breaks: false, extensions: [...mathExtensions, visualizationExtension], tokenizer: {
  link(source) {
    const token=Tokenizer.prototype.link.call(this,source);
    if(token){const href=linkDestination(token.raw);if(href)token.href=href;}
    return token;
  },
  def(source) {
    const token=Tokenizer.prototype.def.call(this,source);
    if(token){const href=nativeDestination(token.raw.slice(token.raw.indexOf(']:')+2));if(href)token.href=href;}
    return token;
  },
  emStrong(source, maskedSource, previous) {
    if (!/^[_*]/.test(source)) return false;
    return Tokenizer.prototype.emStrong.call(this, source, maskMathEmphasis(source, maskedSource), previous);
  },
} });

/** Parse display content only; raw messages remain the source for whole-message copy. */
export function markdownTokens(source: string): TokensList { return parser.lexer(source); }
/** Keep lists, tables, quotes and fences intact when pairing bilingual reading blocks. */
export function markdownBlocks(source: string): string[] {
  const tokens = markdownTokens(source);
  if (Object.keys(tokens.links).length || tokens.map(t => t.raw).join('') !== source.replace(/\r\n?/g, '\n')) return [source];
  const blocks: string[] = [];
  for (const token of tokens) {
    if (token.type === 'space' && blocks.length) blocks[blocks.length - 1] += token.raw;
    else blocks.push(token.raw);
  }
  return blocks.length ? blocks : [source];
}
export function markdownLink(href: string, label: string): LinkedText | undefined {
  const url = webReference(href);
  if (url) return { text: label, url };
  const reference = fileLinkDestination(href);
  return reference ? { text: label, reference } : undefined;
}
export function markdownText(value: string): string {
  return decodeHTMLStrict(value);
}
/** Code token text contains no fence or language label; whitespace inside is retained. */
export function markdownCode(token: Token): string { return token.type === 'code' ? token.text : ''; }

/** Available to approved renderer plugins without host calls or a private import. */
export const markdownApi = Object.freeze({ tokens: markdownTokens, blocks: markdownBlocks, code: markdownCode, link: markdownLink, text: markdownText, math: markdownMath });
