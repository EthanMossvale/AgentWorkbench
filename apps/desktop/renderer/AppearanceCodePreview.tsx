import {useUiPreference} from './ui-preferences';
import { useState } from 'react';
import SyntaxCode from './SyntaxCode';
export const appearanceCodeSamples={typescript:'// 独立代码字体 · 0O 1Il\ninterface Palette { name: string; accent: string }\nconst theme: Palette = { name: "Sea Salt", accent: "#1b6977" };\nasync function preview(size: number = 14) {\n  return await render(theme, size);\n}',python:'# 让语法颜色与阅读节奏一起工作\ndef preview(name: str, size: int = 14):\n    colors = ["paper", "sea", "garden"]\n    return {"theme": name, "size": size, "ready": True}\n\nprint(preview("Sea Salt"))',json:'{\n  "theme": "Sea Salt",\n  "fontSize": 14,\n  "lineNumbers": true,\n  "accents": ["#1b6977", "#83c6d1"],\n  "fallback": null\n}'};
export default function AppearanceCodePreview(){
  const [language,setLanguage]=useUiPreference<keyof typeof appearanceCodeSamples>('settings.code-language');
  return <div className="appearance-code-sample" data-testid="appearance-code-sample"><div className="appearance-code-heading"><span>代码预览</span><div role="group" aria-label="预览语言">{(['typescript','python','json'] as const).map(id=><button type="button" key={id} aria-pressed={language===id} onClick={()=>setLanguage(id)}>{id==='typescript'?'TypeScript':id==='python'?'Python':'JSON'}</button>)}</div></div><pre className="appearance-preview-code"><SyntaxCode text={appearanceCodeSamples[language]} language={language}/></pre><small>使用上方独立设置的代码字体与字号</small></div>;
}
