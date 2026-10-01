export type SyntaxKind = 'plain'|'keyword'|'string'|'number'|'comment'|'function'|'type'|'punctuation';
export interface SyntaxToken { text:string; kind:SyntaxKind }
export type SyntaxHighlighter = (text:string)=>readonly SyntaxToken[];
export interface SyntaxPluginApi { highlight(text:string,language:string):readonly SyntaxToken[]; register(language:string,highlight:SyntaxHighlighter):()=>void; subscribe(listener:()=>void):()=>void }
const aliases:Record<string,string>={js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',sh:'shell',bash:'shell',zsh:'shell',jsonc:'json'};
const supported=new Set(['javascript','typescript','python','json','shell']);
const words=new Set('as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function if implements import in instanceof interface is let module namespace new null of pass private protected public raise readonly return static super switch this throw true try type typeof undefined var void while with yield def elif except lambda None True False and or not self print echo then fi done esac local'.split(' '));
const kinds=new Set<SyntaxKind>(['plain','keyword','string','number','comment','function','type','punctuation']);
const plain=(text:string):SyntaxToken[]=>[{text,kind:'plain'}];
export const normalizeLanguage=(value:string)=>{const key=value.trim().split(/\s/)[0]!.toLowerCase();return aliases[key]??key;};
/** A bounded, source-preserving lexical highlighter; unknown languages remain plain text. */
export function highlightCode(text:string,language:string):readonly SyntaxToken[]{
  if(typeof text!=='string'||typeof language!=='string')throw Error('APPEARANCE_SYNTAX_INVALID');
  const mode=normalizeLanguage(language);if(!supported.has(mode)||text.length>131072)return plain(text);
  const comments=['python','shell'].includes(mode)?String.raw`(?:\#[^\r\n]*)`:String.raw`(?:\/\*[\s\S]*?(?:\*\/|$))|(?:\/\/[^\r\n]*)`;
  const common="(?:\"\"\"[\\s\\S]*?(?:\"\"\"|$)|'''[\\s\\S]*?(?:'''|$))|(?:\"(?:\\\\[\\s\\S]|[^\"\\\\])*(?:\"|$)|'(?:\\\\[\\s\\S]|[^'\\\\])*(?:'|$)|`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|$))|(?:\\b(?:0[xX][\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)|(?:[$A-Za-z_][$\\w]*)|(?:\\s+)|[\\s\\S]";
  const expression=new RegExp(comments+'|'+common,'gy');
  const result:SyntaxToken[]=[];let match:RegExpExecArray|null;
  while((match=expression.exec(text))){
    let token=match[0],kind:SyntaxKind='plain';const rest=text.slice(expression.lastIndex,expression.lastIndex+80);
    if((token.startsWith('//')||token.startsWith('/*'))&&!['python','shell'].includes(mode)||token.startsWith('#')&&['python','shell'].includes(mode))kind='comment';
    else if(/^["'`]/.test(token))kind=mode==='json'&&/^\s*:/.test(rest)?'type':'string';
    else if(/^\d/.test(token))kind='number';
    else if(words.has(token))kind='keyword';
    else if(/^[$A-Za-z_]\w*$/.test(token)&&/^\s*\(/.test(rest))kind='function';
    else if(mode==='typescript'&&/^(?:string|number|boolean|unknown|never|any|Record|Promise|Array|Set|Map)$/.test(token))kind='type';
    else if(/^[{}()[\],.:;=+*/<>!?&|%-]$/.test(token))kind='punctuation';
    const previous=result.at(-1);if(previous?.kind===kind)previous.text+=token;else result.push({text:token,kind});
    if(result.length>20000)return plain(text);
  }
  return result;
}
export class CodeSyntaxRegistry {
  private entries:{language:string;highlight:SyntaxHighlighter}[]=[];
  private revision=0;private listeners=new Set<()=>void>();
  getSnapshot=()=>this.revision;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private publish(){this.revision++;for(const listener of [...this.listeners])listener();}
  highlight=(text:string,language:string):readonly SyntaxToken[]=>{
    if(typeof text!=='string'||typeof language!=='string')throw Error('APPEARANCE_SYNTAX_INVALID');
    if(text.length>131072)return plain(text);const entry=this.entries.findLast(e=>e.language===normalizeLanguage(language));
    if(entry)try{const tokens=entry.highlight(text);if(Array.isArray(tokens)&&tokens.length<=20000&&tokens.every(t=>t&&kinds.has(t.kind)&&typeof t.text==='string'&&t.text.length<=text.length)&&tokens.map(t=>t.text).join('')===text)return tokens;}catch{/* A faulty extension must not alter displayed source. */}
    return highlightCode(text,language);
  };
  register(language:string,highlight:SyntaxHighlighter){
    if(!/^[a-z][a-z\d+-]{0,31}$/.test(language)||typeof highlight!=='function')throw Error('APPEARANCE_SYNTAX_INVALID');
    const entry={language:normalizeLanguage(language),highlight};this.entries.push(entry);this.publish();let live=true;
    return()=>{if(!live)return;live=false;this.entries=this.entries.filter(e=>e!==entry);this.publish();};
  }
}
export const codeSyntax=new CodeSyntaxRegistry();
