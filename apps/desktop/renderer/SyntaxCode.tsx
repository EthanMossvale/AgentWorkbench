import { Fragment, useMemo, useSyncExternalStore } from 'react';
import { codeSyntax } from '../../../packages/appearance/syntax';
import './SyntaxCode.css';
export default function SyntaxCode({text,language}:{text:string;language:string}) {
  const revision=useSyncExternalStore(codeSyntax.subscribe,codeSyntax.getSnapshot);
  const tokens=useMemo(()=>codeSyntax.highlight(text,language),[text,language,revision]);
  return <code className="syntax-code" data-language={language}>{tokens.map((token,i)=>token.kind==='plain'?<Fragment key={i}>{token.text}</Fragment>:<span key={i} className={`syntax-${token.kind}`}>{token.text}</span>)}</code>;
}
