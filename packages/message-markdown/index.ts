import { Marked, Tokenizer, type Token, type TokensList } from 'marked';
import { decodeHTMLStrict } from 'entities';
import { fileLinkDestination, webReference, type LinkedText } from '../navigation/file-links';
import { mathExtensions, markdownMath, maskMathEmphasis } from './math';
import { visualizationExtension } from '../visualizations';
export { markdownMath, type MarkdownMathToken, type MarkdownMathResult } from './math';

const parser = new Marked({ gfm: true, breaks: false, extensions: [...mathExtensions, visualizationExtension], tokenizer: {
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
