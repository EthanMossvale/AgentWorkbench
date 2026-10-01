import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), output = path.resolve(process.env.AWB_MATH_UI_QA ?? 'build/qa/math-symbols/ui');
await mkdir(output, { recursive: true });
const base = root.replaceAll('\\', '/');
await writeFile(path.join(output, 'fixture.tsx'), `
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import MessageText from '${base}/apps/desktop/renderer/MessageText';
import NativeChildConversation from '${base}/apps/desktop/renderer/NativeChildConversation';
import {markdownBlocks} from '${base}/packages/message-markdown';
import {startPluginRenderers} from '${base}/apps/desktop/renderer/plugin-renderer';
import '${base}/apps/desktop/renderer/styles.css';
import '${base}/apps/desktop/renderer/ReadingPane.css';
import 'katex/dist/katex.min.css';
const root=createRoot(document.getElementById('root'));window.qaCalls=[];window.qaEntries=[];
window.__qaCall=async(method,payload)=>{window.qaCalls.push({method,payload});return method==='extensions/renderers'?window.qaEntries:null;};
const bridge={call:window.__qaCall,onExtensions:fn=>{window.qaRefresh=fn;return()=>{}},onState:()=>()=>{},onNavigate:()=>()=>{},onCommand:()=>()=>{}};
window.qaStopPlugins=startPluginRenderers(bridge,document.getElementById('root'));
const actions={openFile:()=>{},report:error=>{throw error},notify:()=>{}};
window.qaShow=(text,child=false)=>{window.qaCalls=[];const session={id:'synthetic',title:'公式回归',status:'idle',binding:{runtime:'codex'},messages:[],nativeChildren:[{nativeChildId:'child',runtime:'codex',title:'公式检查',status:'completed',messages:[{id:'m',role:'assistant',text,at:'2026-09-28T00:00:00Z',complete:true}]}]};flushSync(()=>root.render(<main className="qa-root"><section className="qa-content"><article className="native-message" data-testid="original">{markdownBlocks(text).map((block,i)=><MessageText key={i} text={block} {...actions}/>)}</article><section data-testid="translation" className="message-translation-note"><MessageText text={text} {...actions}/></section>{child&&<NativeChildConversation session={session} sessions={[session]} childId="child" enabled={false} onClose={()=>{}} onNavigate={()=>{}} copy={text=>window.__qaCall('clipboard/write',{text})} actions={actions}/>}</section></main>))};
window.qaReady=true;
`);
await build({ entryPoints: [path.join(output, 'fixture.tsx')], outfile: path.join(output, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, plugins: [{ name: 'isolated-bridge', setup(build) {
  build.onResolve({ filter: /^\.\/App$/ }, () => ({ path: 'fixture-api', namespace: 'qa' }));
  build.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: 'export const api=(method,payload)=>window.__qaCall(method,payload);', loader: 'js' }));
} }] });
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self' blob:;style-src 'self' 'unsafe-inline';font-src 'self' data:;img-src 'self' data:;connect-src 'none';object-src 'none';base-uri 'none'"><link rel="stylesheet" href="fixture.css"><style>.qa-root{height:100vh;overflow:auto;background:var(--bg);padding:26px}.qa-content{max-width:760px;margin:auto}.qa-content .native-message{padding:0}.qa-content .message-translation-note{margin-top:30px}.qa-content .child-conversation-dock{position:relative;width:100%;max-width:none;height:520px;margin-top:24px}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
await writeFile(path.join(output, 'main.cjs'), `const{app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(path.join(output, 'isolated-data'))});app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:true}));const w=new BrowserWindow({show:false,width:1100,height:920,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(output, 'index.html'))});});app.on('window-all-closed',()=>app.quit());`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app; const checks = [], errors = [], requests = [];
const record = value => { checks.push(value); console.log('PASS ' + value); };
try {
  app = await electron.launch({ executablePath: electronPath, args: [path.join(output, 'main.cjs')], env, cwd: root });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.waitForFunction(() => window.qaReady); assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const show = (text, child = false) => page.evaluate(({ text, child }) => window.qaShow(text, child), { text, child });
  const original = page.getByTestId('original');
  await show(String.raw`所以，即使中途调整选取的形状，20 个仍可能失败。答案是 \(\boxed{21}\) 个。`, true);
  assert.equal(await original.locator('.katex .fbox').count(), 1); assert.equal(await page.getByTestId('translation').locator('.katex .fbox').count(), 1);
  assert.equal(await page.getByTestId('child-message').locator('.katex .fbox').count(), 1);
  await page.getByTestId('child-message').getByRole('button', { name: '复制消息', exact: true }).click();
  assert.match(await page.evaluate(() => window.qaCalls.find(call => call.method === 'clipboard/write').payload.text), /\\\(\\boxed\{21\}\\\)/);
  record('reported boxed answer renders in original, translation and actual child reader; copying retains source');

  const sample = String.raw`## 数学公式与符号

答案是 **\(\boxed{21}\)** 个。行内分式 $\frac{a_1+b_2}{\sqrt{x^2+y^2}}$，希腊字母 $\alpha+\beta=\gamma$。

\[
\sum_{i=1}^{n}i=\frac{n(n+1)}{2},\qquad\int_0^\infty e^{-x}\,dx=1
\]

$$\begin{bmatrix}1&2\\3&4\end{bmatrix}\quad f(x)=\begin{cases}x^2&x\ge0\\-x&x<0\end{cases}$$

- 关系与集合：$\forall x\in\mathbb{R},\quad x^2\ge0$。
- 字符实体：&alpha; &Omega; &le; &times; &rarr; &infin; &copy;。
- 普通符号与金额：✓ ✗ ★ → ≤ ≥ ± × ÷ ∞ 😀；$20 和 $30。

| 项目 | 公式 |
| --- | --- |
| 组合数 | $\binom{n}{k}$ |
| 向量 | $\vec{x}+\hat{y}$ |

> 带公式的引用：*before $a*b$ after*。
`;
  await show(sample); await page.evaluate(() => document.fonts.ready);
  assert.equal(await original.locator('[data-math-status="rendered"]').count(), 9);
  assert.equal(await original.locator('[data-math-status="invalid"], [data-math-status="pending"]').count(), 0);
  assert.match(await original.innerText(), /α Ω ≤ × → ∞ ©/); assert.match(await original.innerText(), /\$20 和 \$30/);
  const fonts = await page.evaluate(() => [...document.fonts].filter(font => font.family.startsWith('KaTeX') && font.status === 'loaded').map(font => font.family));
  assert.ok(fonts.includes('KaTeX_Main'), fonts.join(',')); assert.ok(fonts.includes('KaTeX_Math'), fonts.join(','));
  assert.equal(await original.locator('.markdown-math').evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth).length), 0, 'ordinary formulas must not acquire tiny scrollbars');
  record('symbol families, nested Markdown, local KaTeX fonts and MathML render together');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: path.join(output, `symbols-${theme}.png`), fullPage: true });
    const box = await original.locator('.fbox').first().evaluate(el => ({ height: el.getBoundingClientRect().height, border: getComputedStyle(el).borderTopWidth, color: getComputedStyle(el).color }));
    assert.ok(box.height > 10 && parseFloat(box.border) > 0); assert.notEqual(box.color, 'rgba(0, 0, 0, 0)');
  }
  record('boxed answer has a visible border in light and dark themes');

  await page.setViewportSize({ width: 420, height: 800 });
  await show(String.raw`\[` + 'x_1+'.repeat(90) + String.raw`x_n\]`);
  const layout = await original.locator('.markdown-math-display').evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(layout.scroll > layout.width); assert.ok(layout.page <= layout.viewport + 1);
  await page.screenshot({ path: path.join(output, 'long-formula-narrow.png') });
  await show('Inline $' + 'x'.repeat(350) + '$ end.');
  const inlineLayout = await original.locator('.markdown-math').evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth, page: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(inlineLayout.scroll > inlineLayout.width); assert.ok(inlineLayout.page <= inlineLayout.viewport + 1);
  await show(sample); await page.screenshot({ path: path.join(output, 'symbols-narrow.png'), fullPage: true });
  record('long formulas scroll inside narrow messages without widening the document');

  await show('代码示例：`\\(\\boxed{21}\\)`\n\n```tex\n  \\[\\frac{1}{2}\\] &alpha;\n\n  $x_i$\n```\n\n价格 $20 和 $30。');
  assert.equal(await original.locator('.katex').count(), 0); await original.getByTestId('copy-code').click();
  assert.equal(await page.evaluate(() => window.qaCalls.find(call => call.method === 'clipboard/write').payload.text), '  \\[\\frac{1}{2}\\] &alpha;\n\n  $x_i$');
  record('code samples, whitespace, entities and currency retain exact literal content');

  for (const partial of [String.raw`\(\boxed{`, String.raw`\(\boxed{21}`, String.raw`\(\boxed{21}` + '\\']) {
    await show(partial); assert.equal(await original.innerText(), partial); assert.equal(await original.locator('[data-math-status="pending"]').count(), 1);
  }
  await show(String.raw`\(\boxed{21}\)`); assert.equal(await original.locator('.katex').count(), 1);
  await show(String.raw`\(\unknowncommand{21}\)`); assert.equal(await original.locator('[data-math-status="invalid"]').count(), 1); assert.match(await original.getAttribute('data-testid'), /original/);
  record('streaming preserves incomplete source and errors do not break later formulas');

  await show(String.raw`\(\href{javascript:alert(1)}{x}\) \(\includegraphics{https://example.invalid/pixel}\) \(\htmlStyle{position:fixed}{x}\) &lt;script&gt;window.qaExecuted=true&lt;/script&gt;`);
  assert.equal(await original.locator('a,img,script,iframe').count(), 0); assert.equal(await page.evaluate(() => window.qaExecuted), undefined); assert.deepEqual(requests, []);
  record('untrusted TeX and encoded HTML execute nothing and cause no network requests');

  await show(String.raw`\(\boxed{21}\)`);
  await page.evaluate(() => {
    window.qaEntries = [{ id: 'fixture.math', hash: 'fixture', source: `export function activate(api){window.qaMathApi=api.markdown;window.qaPluginDecoded=api.markdown.text('&alpha;');return api.observeSurfaces('[data-math-status="rendered"]','replace',({root,target})=>{const token=api.markdown.tokens(target.dataset.mathSource)[0].tokens?.find(t=>t.type==='math')??api.markdown.tokens(target.dataset.mathSource)[0];const rendered=api.markdown.math(token);if(rendered.status!=='rendered')throw Error('Expected rendered math');root.dataset.mathOverride='yes';root.innerHTML=rendered.html;});}` }];
    window.qaRefresh();
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-math-override]').length === 2); assert.equal(await page.evaluate(() => window.qaPluginDecoded), 'α');
  await show(String.raw`\(\boxed{21}\) and $x^2$`);
  await page.waitForFunction(() => document.querySelectorAll('[data-math-override]').length === 4);
  await page.evaluate(() => { window.qaEntries = []; window.qaRefresh(); });
  await page.waitForFunction(() => !document.querySelector('[data-math-override]'));
  assert.equal(await original.locator('[data-math-status="rendered"]:visible').count(), 2);
  record('public plugin API can parse/render and replace all dynamic math instances; disable restores core');

  assert.deepEqual(errors, []); await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors, fonts, layout, scope: 'Hidden Electron; production components and isolated bridge, no real model, user data or active client.' }, null, 2));
} finally { await app?.close(); }
