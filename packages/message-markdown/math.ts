import katex from 'katex';
import type { TokenizerExtension } from 'marked';

export interface MarkdownMathToken {
  type: 'math';
  raw: string;
  text: string;
  displayMode: boolean;
  complete: boolean;
}
export type MarkdownMathResult =
  | { status: 'rendered'; html: string }
  | { status: 'pending' | 'invalid' | 'limit'; raw: string; error: string };

const environment = /\\begin\{(equation\*?|align\*?|alignat\*?|gather\*?)\}/;
const opening = /\\[([]|\${1,2}|\\begin\{(?:equation\*?|align\*?|alignat\*?|gather\*?)\}/g;
const escaped = (source: string, index: number) => {
  let count = 0;
  while (index > 0 && source[--index] === '\\') count++;
  return count % 2 === 1;
};

/** Delimiters are recognized before Markdown can consume TeX escapes/emphasis. */
function mathAt(source: string, block: boolean): MarkdownMathToken | undefined {
  const indent = block ? /^( {0,3})/.exec(source)![0] : '';
  const value = source.slice(indent.length), env = environment.exec(value);
  const begin = env?.index === 0 ? env[0] : value.startsWith('\\(') ? '\\(' : value.startsWith('\\[') ? '\\[' : value.startsWith('$$') ? '$$' : value.startsWith('$') ? '$' : '';
  if (!begin) return;
  const displayMode = begin !== '$' && begin !== '\\(';
  if (block && !displayMode) return;
  const end = env?.index === 0 ? `\\end{${env[1]}}` : begin === '\\(' ? '\\)' : begin === '\\[' ? '\\]' : begin;
  // Dollar math cannot start with whitespace or span paragraphs; $20 and $30 stay prices.
  if (begin === '$' && (!value[1] || /\s|\$/.test(value[1]))) return;
  const finish = (at: number): MarkdownMathToken | undefined => {
    const length = at + end.length;
    if (block && !/^[ \t]*(?:\n|$)/.test(value.slice(length))) return;
    const suffix = block ? /^[ \t]*(?:\n|$)/.exec(value.slice(length))![0] : '';
    return { type: 'math', raw: indent + value.slice(0, length) + suffix, text: env?.index === 0 ? value.slice(0, length) : value.slice(begin.length, at), displayMode, complete: true };
  };
  let depth = 0, comment = false, unbalancedEnd = -1;
  for (let i = begin.length; i < value.length; i++) {
    const char = value[i];
    if (char === '\n') { comment = false; if (begin === '$') return; }
    if (comment) continue;
    if (char === '%' && !escaped(value, i)) { comment = true; continue; }
    if (escaped(value, i)) continue;
    if (char === '{') depth++;
    if (char === '}') depth = Math.max(0, depth - 1);
    if (!value.startsWith(end, i)) continue;
    if (begin === '$' && (/\s/.test(value[i - 1]!) || /[\d$]/.test(value[i + 1] ?? ''))) return;
    if (depth) { if (unbalancedEnd < 0) unbalancedEnd = i; continue; }
    return finish(i);
  }
  // Closed but malformed TeX is an error, not a permanently streaming formula.
  if (unbalancedEnd >= 0) return finish(unbalancedEnd);
  // Preserve partial streamed TeX verbatim, including its opening backslash.
  if (begin === '$') return;
  return { type: 'math', raw: source, text: value.slice(begin.length), displayMode, complete: false };
}

function start(source: string, block: boolean): number | undefined {
  opening.lastIndex = 0;
  for (let match; (match = opening.exec(source));) {
    if (escaped(source, match.index)) continue;
    if (block && match.index > 0 && !/(?:^|\n) {0,3}$/.test(source.slice(0, match.index))) continue;
    if (mathAt(source.slice(match.index), block)) return match.index;
  }
}

export const mathExtensions: TokenizerExtension[] = [
  { name: 'math', level: 'block', start: source => start(source, true), tokenizer: source => mathAt(source, true) },
  { name: 'math', level: 'inline', start: source => start(source, false), tokenizer: source => mathAt(source, false) },
];

/** Marked's emphasis scanner must not match punctuation inside a future math token. */
export function maskMathEmphasis(source: string, maskedSource: string): string {
  const candidates = new RegExp(opening.source, 'g'), offset = maskedSource.length - source.length;
  let result = maskedSource;
  for (let match; (match = candidates.exec(source));) {
    if (escaped(source, match.index)) continue;
    const token = mathAt(source.slice(match.index), false);
    if (!token?.complete) continue;
    const at = offset + match.index;
    result = result.slice(0, at) + 'a'.repeat(token.raw.length) + result.slice(at + token.raw.length);
    candidates.lastIndex = match.index + token.raw.length;
  }
  return result;
}

/** Pure, bounded rendering; never share macro state across formulas or messages. */
export function markdownMath(token: Pick<MarkdownMathToken, 'raw' | 'text' | 'displayMode' | 'complete'>): MarkdownMathResult {
  if (!token.complete) return { status: 'pending', raw: token.raw, error: 'MATH_INCOMPLETE' };
  if (token.text.length > 16_384) return { status: 'limit', raw: token.raw, error: 'MATH_INPUT_LIMIT' };
  try {
    let untrusted = false;
    const html = katex.renderToString(token.text, {
      displayMode: token.displayMode, output: 'htmlAndMathml', throwOnError: true,
      strict: 'ignore', trust: () => { untrusted = true; return false; }, maxExpand: 1000, maxSize: 20, macros: {},
    });
    if (untrusted) return { status: 'invalid', raw: token.raw, error: 'MATH_UNTRUSTED_COMMAND' };
    return { status: 'rendered', html };
  } catch {
    return { status: 'invalid', raw: token.raw, error: 'MATH_INVALID_OR_UNSUPPORTED' };
  }
}
