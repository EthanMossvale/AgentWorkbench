import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Token, Tokens } from 'marked';
import { markdownTokens, markdownLink, markdownText, markdownCode, markdownMath, type MarkdownMathToken } from '../../../packages/message-markdown';
import { fileReference, webReference, linkedText, type LinkedText } from '../../../packages/navigation/file-links';
import { Icon } from './ui';
import './MarkdownContent.css';
import SyntaxCode from './SyntaxCode';
import InlineVisualization from './InlineVisualization';
import type { VisualizationToken } from '../../../packages/visualizations';

export interface MarkdownContentProps {
  text: string;
  sessionId?: string;
  renderLink: (item: LinkedText, key: string, children?: ReactNode) => ReactNode;
  onCopy: (text: string) => Promise<unknown>;
  onCopyError?: (error: unknown) => void;
}
function MathContent({ token }: { token: MarkdownMathToken }) {
  const result = useMemo(() => markdownMath(token), [token.raw, token.text, token.displayMode, token.complete]);
  const className = `markdown-math${token.displayMode ? ' markdown-math-display' : ''}`;
  if (result.status === 'rendered') return <span className={className} data-math-status="rendered" data-math-source={token.raw} dangerouslySetInnerHTML={{ __html: result.html }}/>;
  const title = result.status === 'pending' ? '公式尚未完整，暂时显示原文' : result.status === 'limit' ? '公式过长，保留原文' : '公式语法无效或暂不支持，保留原文';
  return <span className={`${className} markdown-math-fallback`} data-math-status={result.status} title={title}>{result.raw}</span>;
}
function CodeBlock({ token, onCopy, onCopyError }: { token: Tokens.Code } & Pick<MarkdownContentProps, 'onCopy' | 'onCopyError'>) {
  const [copied, setCopied] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); }, [copied]);
  useEffect(() => setCopied(false), [token.text]);
  return <div className="markdown-code-block" data-testid="markdown-code-block"><header><span>{token.lang?.split(/\s+/)[0] || '纯文本'}</span><button type="button" data-testid="copy-code" aria-label="复制代码块内容" disabled={busy} onClick={async event => {
    event.stopPropagation(); if (busy) return; setBusy(true);
    try { await onCopy(markdownCode(token)); setCopied(true); } catch (error) { onCopyError?.(error); } finally { setBusy(false); }
  }}><Icon name={copied ? 'check' : 'copy'} size={13}/><span>{copied ? '已复制' : '复制'}</span></button></header><pre><SyntaxCode text={markdownCode(token)} language={token.lang??''}/></pre></div>;
}
export default function MarkdownContent({ text, sessionId, renderLink, onCopy, onCopyError }: MarkdownContentProps) {
  const plain = (text: string, key: string) => linkedText(markdownText(text)).map((item, index) => item.url || item.reference ? renderLink(item, `${key}-${index}`) : <Fragment key={`${key}-${index}`}>{item.text}</Fragment>);
  const render = (tokens: Token[], parent = 'md'): ReactNode[] => tokens.map((token, index) => {
    const key = `${parent}-${index}`, inline = (items?: Token[]) => render(items ?? [], key);
    switch (token.type) {
      case 'space': return null;
      case 'visualization': return <InlineVisualization key={key} reference={(token as VisualizationToken).reference} sessionId={sessionId}/>;
      case 'math': return <MathContent key={key} token={token as MarkdownMathToken}/>;
      case 'paragraph': return <p key={key}>{inline(token.tokens)}</p>;
      case 'text': return <Fragment key={key}>{token.tokens ? inline(token.tokens) : plain(token.text, key)}</Fragment>;
      case 'escape': return <Fragment key={key}>{markdownText(token.text)}</Fragment>;
      case 'strong': return <strong key={key}>{inline(token.tokens)}</strong>;
      case 'em': return <em key={key}>{inline(token.tokens)}</em>;
      case 'del': return <del key={key}>{inline(token.tokens)}</del>;
      case 'br': return <br key={key}/>;
      case 'hr': return <hr key={key}/>;
      case 'heading': { const Tag = `h${token.depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; return <Tag key={key}>{inline(token.tokens)}</Tag>; }
      case 'blockquote': return <blockquote key={key}>{inline(token.tokens)}</blockquote>;
      case 'codespan': { const value = token.text, url = webReference(value), reference = url ? undefined : fileReference(value), link = url ? { text: value, url } : reference ? { text: value, reference } : undefined; return <code className="markdown-inline-code" key={key}>{link ? renderLink(link, key) : value}</code>; }
      case 'code': return <CodeBlock key={key} token={token as Tokens.Code} onCopy={onCopy} onCopyError={onCopyError}/>;
      case 'link': { const link = markdownLink(markdownText(token.href), markdownText(token.text)); return <Fragment key={key}>{link ? renderLink(link, key, inline(token.tokens)) : inline(token.tokens)}</Fragment>; }
      // Remote image URLs stay explicit links; model output never fetches tracking images automatically.
      case 'image': { const label = markdownText(token.text || '图片'), link = markdownLink(token.href, label); return <span className="markdown-image-reference" key={key}>图片：{link ? renderLink(link, key) : label}</span>; }
      case 'list': {
        const list = token as Tokens.List, Tag = list.ordered ? 'ol' : 'ul';
        return <Tag key={key} start={list.ordered && list.start !== '' ? list.start : undefined}>{list.items.map((item, i) => <li key={i} className={item.task ? 'markdown-task' : undefined}>{item.task && <input type="checkbox" checked={!!item.checked} readOnly disabled aria-label={item.checked ? '已完成' : '未完成'}/>} {render(item.tokens, `${key}-${i}`)}</li>)}</Tag>;
      }
      case 'table': { const table = token as Tokens.Table; return <div className="markdown-table-wrap" key={key} tabIndex={0} role="region" aria-label="表格"><table><thead><tr>{table.header.map((cell, i) => <th key={i} style={{ textAlign: table.align[i] ?? undefined }}>{render(cell.tokens, `${key}-h${i}`)}</th>)}</tr></thead><tbody>{table.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} style={{ textAlign: table.align[c] ?? undefined }}>{render(cell.tokens, `${key}-${r}-${c}`)}</td>)}</tr>)}</tbody></table></div>; }
      // No HTML interpretation, event attributes, SVG, scripts, or executable model markup.
      case 'html': return <span className="markdown-literal" key={key}>{token.raw}</span>;
      default: return <span key={key}>{token.raw}</span>;
    }
  });
  return <div className="message-text message-markdown" data-message-markdown>{render(markdownTokens(text))}</div>;
}
