import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const hostSources=['apps/desktop/host/controller.ts','apps/desktop/host/native-resources.ts','apps/desktop/host/model-connections.ts','apps/desktop/host/main.ts'];
export function extractMethods(source) {
  const tree=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true),methods=new Set();
  const named=node=>ts.isIdentifier(node)&&node.text==='method'||ts.isPropertyAccessExpression(node)&&node.name.text==='method';
  const add=node=>{if(ts.isStringLiteralLike(node)&&/^[a-z][a-z0-9.-]*\/[a-z0-9./-]+$/.test(node.text))methods.add(node.text);};
  const visit=node=>{
    if(ts.isSwitchStatement(node)&&named(node.expression))for(const clause of node.caseBlock.clauses)if(ts.isCaseClause(clause))add(clause.expression);
    if(ts.isBinaryExpression(node)&&[ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)){
      if(named(node.left))add(node.right);if(named(node.right))add(node.left);
    }
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='includes'&&ts.isArrayLiteralExpression(node.expression.expression)&&node.arguments.some(named))for(const value of node.expression.expression.elements)add(value);
    ts.forEachChild(node,visit);
  };visit(tree);return [...methods].sort();
}
export function privacyIssues(text) {
  const checks=[
    ['absolute-windows-path',/\b[A-Z]:[\\/]/gi],
    ['private-home-path',/\/(?:home|Users)\/(?!<|\$|user(?:\/|\b)|example(?:\/|\b)|\/)[^\s`"<>/]+/g],
    ['private-conversation-id',/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi],
    ['private-attachment-name',/codex-clipboard-[\w-]+/gi],
    ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['credential',/\b(?:sk-(?:ant-[a-z]+[0-9]*-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g],
    ['email',/\b[A-Z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ['private-provenance-field',/"sourceThread"\s*:/g],
  ];
  const issues=[];
  for(const [kind,regex] of checks)for(const match of text.matchAll(regex))issues.push({kind,line:text.slice(0,match.index).split('\n').length});
  for(const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)){
    const ip=match[0];if(!ip.split('.').every(part=>+part<=255)||/^(?:127\.|0\.0\.0\.0$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip))continue;
    issues.push({kind:'non-example-ip',line:text.slice(0,match.index).split('\n').length});
  }
  return issues;
}
async function walk(directory){const found=[];for(const item of await readdir(directory,{withFileTypes:true})){const target=path.join(directory,item.name);if(item.isDirectory())found.push(...await walk(target));else found.push(target);}return found;}
export async function checkPublicDocs(root) {
  const all=await walk(path.join(root,'docs')),files=[path.join(root,'AGENTS.md'),path.join(root,'README.md'),...all.filter(file=>/\.(md|json)$/.test(file))];
  const failures=[],contents=new Map();
  for(const file of files){const content=await readFile(file,'utf8');contents.set(file,content);for(const issue of privacyIssues(content))failures.push(`${path.relative(root,file)}:${issue.line}: ${issue.kind}`);if(file.endsWith('.json'))try{JSON.parse(content);}catch{failures.push(`${path.relative(root,file)}: invalid JSON`);}}
  const navigation=contents.get(path.join(root,'docs/README.md'))??'';
  for(const file of all){const relative=path.relative(path.join(root,'docs'),file).replaceAll('\\','/');if(relative!=='README.md'&&!navigation.includes(`](${relative})`))failures.push(`docs/${relative}: missing navigation entry`);}
  for(const [file,content] of contents)if(file.endsWith('.md'))for(const match of content.matchAll(/\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){
    const href=match[1];if(/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('#'))continue;
    let target;try{target=path.resolve(path.dirname(file),decodeURIComponent(href.split('#')[0]));}catch{failures.push(`${path.relative(root,file)}: invalid link encoding`);continue;}
    if(!target.startsWith(root+path.sep)&&target!==root){failures.push(`${path.relative(root,file)}: link leaves repository`);continue;}
    try{await stat(target);}catch{failures.push(`${path.relative(root,file)}: missing link ${href}`);}
  }
  const methods=new Set();for(const file of hostSources)for(const method of extractMethods(await readFile(path.join(root,file),'utf8')))methods.add(method);
  const api=contents.get(path.join(root,'docs/36-workbench-plugin-api.md'))??'';
  const catalog=api.split('<!-- host-methods:start -->')[1]?.split('<!-- host-methods:end -->')[0]??'';
  const listed=new Set([...catalog.matchAll(/`([a-z][a-z0-9.-]*\/[a-z0-9./-]+)`/g)].map(match=>match[1]));
  for(const method of methods)if(!listed.has(method))failures.push(`plugin API catalog missing: ${method}`);
  for(const method of listed)if(!methods.has(method))failures.push(`plugin API catalog stale: ${method}`);
  return {files:files.length,methods:methods.size,failures};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await checkPublicDocs(path.resolve(process.cwd()));
  for(const failure of result.failures)console.error(failure);
  console.log(`${result.failures.length?'FAIL':'PASS'} public docs: ${result.files} text files, ${result.methods} host methods, ${result.failures.length} findings`);
  if(result.failures.length)process.exitCode=1;
}
