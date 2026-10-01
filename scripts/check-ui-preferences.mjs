import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {coreUiPreferences,UiPreferenceRegistry} from '../packages/ui-preferences/index.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),registry=new UiPreferenceRegistry(),errors=[];
let controls=0,hooks=0;
for(const name of await readdir(path.join(root,'apps/desktop/renderer'))){
  if(!/\.tsx?$/.test(name))continue;const source=await readFile(path.join(root,'apps/desktop/renderer',name),'utf8'),tree=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const fail=(node,text)=>errors.push(`${name}:${tree.getLineAndCharacterOfPosition(node.pos).line+1}: ${text}`);
  const visit=node=>{
    if(ts.isCallExpression(node)&&node.expression.getText(tree)==='useUiPreference'){
      const key=node.arguments[0];if(key&&ts.isStringLiteral(key)){try{registry.definition(key.text);}catch{fail(node,'unregistered core preference '+key.text);}hooks++;}
      else fail(node,'preference ID must be explicit and reviewed');
    }
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
      const tag=node.tagName.getText(tree);
      if(['RememberedDetails','RememberedTextarea'].includes(tag)){
        controls++;const id=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='memoryId');if(!id?.initializer||!ts.isStringLiteral(id.initializer)||!id.initializer.text)fail(node,'persistent UI node needs a stable memoryId');
      }
      if(tag==='details'&&name!=='UiMemory.tsx')fail(node,'new disclosure needs persistence or a documented transient exception');
      if(tag==='textarea'&&name!=='UiMemory.tsx'&&!(name==='Workspace.tsx'&&node.getText(tree).includes('composer-input')))fail(node,'new resizable editor needs persistence or a documented derived-geometry exception');
    }
    ts.forEachChild(node,visit);
  };visit(tree);
}
for(const definition of coreUiPreferences)try{registry.validate(definition.id,definition.defaultValue);}catch{errors.push('Invalid product default: '+definition.id);}
const rules=await readFile(path.join(root,'AGENTS.md'),'utf8');if(!rules.includes('UI state persistence (same-level delivery gate)'))errors.push('Missing project UI persistence gate');
const docs=await readFile(path.join(root,'docs/37-ui-state-persistence.md'),'utf8');if(!docs.includes('developer')||!docs.includes('transient'))errors.push('Missing release/default or transient review');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`PASS UI preference inventory: ${coreUiPreferences.length} typed keys, ${hooks} preference hooks, ${controls} named disclosure/editor nodes. Review new custom controls and existing persistent owners under AGENTS.md.`);
