import {useUiPreference} from './ui-preferences';
import { codeAppearance } from './appearance';
import { monacoTheme } from './monaco-theme';
import 'monaco-editor/nls/lang/zh-cn';
import 'monaco-codicons';
import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api';
// Register lazy contribution services before the first standalone editor is created.
import 'monaco-editor/editor/contrib/codelens/browser/codeLensCache';
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsController';
import 'monaco-editor/editor/common/services/treeViewsDndService';
import 'monaco-editor/editor/contrib/suggest/browser/suggestMemory';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/folding/register';
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/clipboard/register';
import 'monaco-editor/features/gotoLine/register';
import 'monaco-editor/features/contextmenu/register';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/html/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/powershell/register';
import 'monaco-editor/languages/definitions/shell/register';
import { jsonDefaults } from 'monaco-editor/languages/features/json/register';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import 'monaco-editor/languages/definitions/yaml/register';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/rust/register';
import 'monaco-editor/languages/definitions/ini/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { Icon } from './ui';

globalThis.MonacoEnvironment = { getWorker: (_moduleId,label) => label === 'json' ? new JsonWorker() : new EditorWorker() };
jsonDefaults.setDiagnosticsOptions({validate:false,enableSchemaRequest:false});
const languageFor = (path:string) => {
  const filename = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
  return monaco.languages.getLanguages().find(language => language.filenames?.includes(filename) || language.extensions?.some(extension => filename.endsWith(extension)))?.id ?? 'plaintext';
};

export type PreviewViews = Map<string,monaco.editor.ICodeEditorViewState>;

export default function CodePreview({ path, content, line, startLine=1, savedViews }: { path:string; content:string; line?:number; startLine?:number; savedViews:PreviewViews }) {
  const root = useRef<HTMLDivElement>(null), editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [wrap,setWrap]=useUiPreference<boolean>('reader.wrap'),[position,setPosition]=useState({lineNumber:line??1,column:1});
  const language = languageFor(path);
  useEffect(() => {
    const model=monaco.editor.createModel(content,language,monaco.Uri.parse(`inmemory://preview/${encodeURIComponent(path)}`));
    const instance=monaco.editor.create(root.current!, { model, readOnly:true, domReadOnly:true, automaticLayout:true, minimap:{enabled:false}, ...codeAppearance(), lineNumbers:n=>String(n+startLine-1), lineNumbersMinChars:3, glyphMargin:false, folding:true, showFoldingControls:'always', scrollBeyondLastLine:false, renderLineHighlight:'line', wordWrap:wrap?'on':'off', padding:{top:12,bottom:12}, overviewRulerLanes:0, hideCursorInOverviewRuler:true, contextmenu:true, links:false, stickyScroll:{enabled:false}, bracketPairColorization:{enabled:true}, unicodeHighlight:{ambiguousCharacters:false,nonBasicASCII:false}, accessibilitySupport:'auto', ariaLabel:`代码预览：${path.split(/[\\/]/).at(-1)}`, scrollbar:{verticalScrollbarSize:9,horizontalScrollbarSize:9}, find:{addExtraSpaceOnTop:false} });
    editor.current=instance;
    let fontKey='';
    const applyFonts=()=>{const options=codeAppearance(),key=JSON.stringify(options);if(key===fontKey)return;fontKey=key;instance.updateOptions(options);monaco.editor.remeasureFonts();};
    let themeKey='';
    const applyTheme=()=>{const theme=monacoTheme(document),key=JSON.stringify(theme);if(themeKey===key)return;themeKey=key;monaco.editor.defineTheme('workbench-appearance',theme);monaco.editor.setTheme('workbench-appearance');};
    const applyStyle=()=>{applyFonts();applyTheme();};
    window.addEventListener('workbench-appearance',applyStyle);
    const fontObserver=new MutationObserver(records=>{if(records.some(record=>record.target===document.documentElement||(record.target instanceof Element?record.target:record.target.parentElement)?.closest('style[data-plugin]')||[...record.addedNodes,...record.removedNodes].some(node=>node instanceof Element&&node.matches('style[data-plugin]'))))applyStyle();});
    fontObserver.observe(document.head,{childList:true,subtree:true,characterData:true});fontObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style']});
    applyTheme();const observer=new MutationObserver(applyTheme);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    const listener=instance.onDidChangeCursorPosition(event=>setPosition(event.position));
    const saved=savedViews.get(path);if(saved)instance.restoreViewState(saved);
    if(line) { const target=Math.max(1,Math.min(line-startLine+1,model.getLineCount())); instance.setPosition({lineNumber:target,column:1});instance.revealLineInCenter(target); }
    setPosition(instance.getPosition() ?? {lineNumber:1,column:1});
    return()=>{const saved=instance.saveViewState();if(saved)savedViews.set(path,saved);listener.dispose();observer.disconnect();fontObserver.disconnect();window.removeEventListener('workbench-appearance',applyStyle);instance.dispose();model.dispose();editor.current=null;};
  },[path,content,startLine]);
  useEffect(()=>{if(line&&editor.current){const target=Math.max(1,Math.min(line-startLine+1,editor.current.getModel()!.getLineCount()));editor.current.setPosition({lineNumber:target,column:1});editor.current.revealLineInCenter(target);}},[line,startLine]);
  useEffect(()=>{editor.current?.updateOptions({wordWrap:wrap?'on':'off'});},[wrap]);
  return <div className="code-preview" data-testid="code-preview" data-language={language} data-line={position.lineNumber+startLine-1}>
    <div className="code-preview-toolbar"><span>{monaco.languages.getLanguages().find(item=>item.id===language)?.aliases?.[0]??language}</span><div><button className="text-button" onClick={()=>{editor.current?.focus();void editor.current?.getAction('actions.find')?.run();}} aria-label="搜索代码"><Icon name="search" size={14}/></button><button className="text-button" aria-pressed={wrap} onClick={()=>setWrap(!wrap)}>自动换行</button></div></div>
    <div className="code-editor" ref={root} />
    <footer className="code-status"><span>只读</span><span>第 {position.lineNumber+startLine-1} 行，第 {position.column} 列</span><span>UTF-8</span></footer>
  </div>;
}
