import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownTokens, markdownBlocks, markdownCode, markdownLink, markdownText } from '../packages/message-markdown';

test('Windows native links preserve separators before dotfiles and Markdown punctuation',()=>{
 const target=String.raw`C:\Users\Example\.agent-workbench\workspaces\fixture\_result\pelican-bicycle.html`;
 for(const source of [`[file](${target})`,`[file](<${target}>)`,`[file][result]\n\n[result]: ${target}`,`![preview](${target})`]){
  const paragraph:any=markdownTokens(source)[0],token=paragraph.tokens[0];
  assert.equal(token.href,target);assert.deepEqual(markdownLink(token.href,token.text)?.reference,{path:target});
  assert.equal(markdownBlocks(source).join(''),source);
 }
 const spaces=String.raw`C:\My Project\.cache\report (final).html`;
 assert.equal((markdownTokens(`[result](<${spaces}>)`)[0] as any).tokens[0].href,spaces);
 assert.equal((markdownTokens('[web](https://example.invalid/a\\_b)')[0] as any).tokens[0].href,'https://example.invalid/a_b');
 assert.equal(markdownTokens('```md\n[file]('+target+')\n```')[0]!.type,'code');
});

test('Markdown destinations preserve a percent-encoded literal percent and line ranges',()=>{
 assert.deepEqual(markdownLink('README.md#installation','guide')?.reference,{path:'README.md'});
 assert.deepEqual(markdownLink('file:///D:/README.md#installation','guide')?.reference,{path:'D:/README.md'});
 assert.deepEqual(markdownLink('notes%23installation.md','guide')?.reference,{path:'notes#installation.md'});
 for(const href of ['D:/literal%2520name.md#L9-L12','file:///D:/literal%2520name.md#L9-L12'])assert.deepEqual(markdownLink(href,'file')?.reference,{path:'D:/literal%20name.md',line:9});
 assert.deepEqual(markdownLink('notes%20(v2)%20%5B中文%5D%20100%25.md','file')?.reference,{path:'notes (v2) [中文] 100%.md'});
});

test('both native runtimes use ordinary Markdown tokens for lists, strong text and inline code', () => {
  const source = '- **Test choice**: choose `Option A`.\n- **Next step**: keep `fixture.txt`.';
  for (const _runtime of ['claude', 'codex']) {
    const tokens = markdownTokens(source); assert.equal(tokens[0]?.type, 'list');
    const list: any = tokens[0]; assert.equal(list.items.length, 2); assert.equal(list.items[0].tokens[0].tokens[0].type, 'strong');
    assert.ok(list.items[0].tokens[0].tokens.some((t: any) => t.type === 'codespan')); assert.deepEqual(markdownBlocks(source), [source]);
  }
});
test('headings, quotes, tasks, nested lists, tables and reference links remain semantic blocks', () => {
  const source = '# Heading\n\n> A quote\n\n1. Parent\n   - Nested\n\n- [x] Done\n- [ ] Later\n\n| Name | Count |\n| --- | ---: |\n| One | 2 |';
  const blocks = markdownBlocks(source); assert.equal(blocks.join(''), source); assert.ok(blocks.some(b => b.includes('Parent') && b.includes('Nested')));
  assert.ok(markdownTokens(source).some(t => t.type === 'table'));
  const refs = '[Manual][docs]\n\n[docs]: https://example.invalid/docs'; assert.deepEqual(markdownBlocks(refs), [refs]); assert.equal((markdownTokens(refs)[0] as any).tokens[0].type, 'link');
});
test('code copy excludes fence and label and retains indentation, Markdown literals and blank lines', () => {
  for (const fence of ['```', '~~~']) {
    const source = `${fence}text\n  literal **bold** and \`code\`\n\n  <tag>&amp;</tag>\n${fence}`;
    assert.equal(markdownCode(markdownTokens(source)[0]!), '  literal **bold** and `code`\n\n  <tag>&amp;</tag>');
  }
  assert.equal(markdownCode(markdownTokens('```js\nconst x = 1;')[0]!), 'const x = 1;');
  assert.equal(markdownCode(markdownTokens('    indented code\n')[0]!), 'indented code\n');
});
test('code fences containing shorter fences and line endings stay intact in bilingual blocks', () => {
  const source = 'Intro\n\n````markdown\n```text\n**literal**\n```\n````\n\nEnd';
  assert.equal(markdownBlocks(source).join(''), source); assert.ok(markdownBlocks(source).some(b => b.includes('```text') && b.includes('**literal**')));
  const code = markdownTokens('```text\r\nhello\r\n```')[0]!; assert.equal(markdownCode(code), 'hello');
});
test('links retain local and shared file references while executable URLs are inert', () => {
  assert.deepEqual(markdownLink('docs/guide.md:12', 'Guide')?.reference, { path: 'docs/guide.md', line: 12 });
  assert.equal(markdownLink('https://example.invalid/docs', 'Docs')?.url, 'https://example.invalid/docs');
  for (const value of ['javascript:alert(1)', 'data:text/html,<script>', 'https://user:pass@example.invalid']) assert.equal(markdownLink(value, 'Unsafe'), undefined);
  assert.equal(markdownLink('file://remote/share/file.txt','Shared')?.reference?.path,'//remote/share/file.txt');assert.equal(markdownLink('//remote/file.txt','Shared')?.reference?.path,'//remote/file.txt');
  assert.equal(markdownTokens('<script>alert(1)</script>')[0]?.type, 'html');
  assert.equal(markdownText('&lt;safe&gt; &#x1F600;'), '<safe> 😀');
});

test('native Markdown Windows file links keep clickable references after tokenization',()=>{
 const source='The code still matches: [slot_component_ui.py](</D:/Example Project/tools/slot_component_ui.py:128>) and [slot_texture_export.py](</D:/Example%20Project/tools/slot_texture_export.py:631>).';
 const paragraph:any=markdownTokens(source)[0], links=paragraph.tokens.filter((token:any)=>token.type==='link');
 assert.equal(links.length,2);
 assert.deepEqual(links.map((token:any)=>markdownLink(markdownText(token.href),markdownText(token.text))),[
  {text:'slot_component_ui.py',reference:{path:'D:/Example Project/tools/slot_component_ui.py',line:128}},
  {text:'slot_texture_export.py',reference:{path:'D:/Example Project/tools/slot_texture_export.py',line:631}},
 ]);
 assert.equal(markdownBlocks(source).join(''),source);
});

test('CJK emphasis closes next to full-width punctuation while English keeps CommonMark flanking',()=>{
 const inline=(source:string)=>(markdownTokens(source)[0] as any).tokens as any[];
 const strong=(source:string)=>inline(source).filter(token=>token.type==='strong').map(token=>token.text);
 assert.deepEqual(strong('**在悬停或键盘焦点时开始加载。**当指针移到日志上时开始读取。'),['在悬停或键盘焦点时开始加载。']);
 assert.deepEqual(strong('**验证：**图像日志测试通过。'),['验证：']);
 assert.deepEqual(strong('先看**“已查看”**日志，再看**结论**。'),['“已查看”','结论']);
 const list:any=markdownTokens('- **保留缩略图。**重新打开立即显示。\n- **占位符。**每张图一个方块。')[0];
 assert.deepEqual(list.items.map((item:any)=>item.tokens[0].tokens[0].type),['strong','strong']);
 assert.equal(inline('说明*重点。*后文')[1].type,'em');
 assert.deepEqual(strong('**Why:** the log'),['Why:']);
 assert.deepEqual(strong('**foo.**bar'),[]);
 assert.deepEqual(strong('**代码`a**b`内。**之后'),['代码`a**b`内。']);
 assert.deepEqual(strong(String.raw`\**转义。**之后`),[]);
 assert.equal(markdownBlocks('**验证：**通过。').join(''),'**验证：**通过。');
});
