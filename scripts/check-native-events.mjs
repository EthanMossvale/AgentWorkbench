import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

/** Compare factual discriminator inventories, not copied vendor implementation. */
export async function checkNativeEvents(root, args=[]) {
  const fixture=JSON.parse(await readFile(path.join(root,'tests/fixtures/native-event-catalog.json'),'utf8'));
  const source=ts.createSourceFile('catalog.ts',await readFile(path.join(root,'packages/native-events/catalog.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  const keys=new Set();
  for(const statement of source.statements)if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(source)==='group'){
    const [runtime,prefix,,,names]=statement.expression.arguments;
    if(!ts.isStringLiteral(runtime)||!ts.isStringLiteral(prefix)||!ts.isArrayLiteralExpression(names))throw Error('NATIVE_EVENT_CATALOG_INVALID');
    for(const name of names.elements){if(!ts.isStringLiteral(name))throw Error('NATIVE_EVENT_CATALOG_INVALID');const key=runtime.text+':'+prefix.text+name.text;if(keys.has(key))throw Error('NATIVE_EVENT_CATALOG_DUPLICATE: '+key);keys.add(key);}
  }
  for(const [runtime,groups]of Object.entries({codex:{notifications:'notification/',requests:'request/',items:'item/'},claude:{messages:'message/',systems:'system/'}}))for(const [group,prefix]of Object.entries(groups))for(const name of fixture[runtime][group])if(!keys.has(runtime+':'+prefix+name))throw Error('NATIVE_EVENT_COVERAGE_MISSING: '+runtime+':'+prefix+name);
  const schemaFlag=args.indexOf('--codex-schema');
  if(schemaFlag>=0){
    const folder=path.resolve(args[schemaFlag+1]),schema=JSON.parse(await readFile(path.join(folder,'codex_app_server_protocol.v2.schemas.json'),'utf8')).definitions,requests=JSON.parse(await readFile(path.join(folder,'ServerRequest.json'),'utf8'));
    const actual={notifications:schema.ServerNotification.oneOf.map(v=>v.properties.method.enum[0]),requests:requests.oneOf.map(v=>v.properties.method.enum[0]),items:schema.ThreadItem.oneOf.map(v=>v.properties.type.enum[0])};
    for(const [name,list]of Object.entries(actual))if(JSON.stringify(list.sort())!==JSON.stringify(fixture.codex[name]))throw Error('NATIVE_EVENT_BASELINE_REVIEW_REQUIRED: codex '+name);
  }
  const claudeFlag=args.indexOf('--claude-types');
  if(claudeFlag>=0){
    const s=ts.createSourceFile('sdk.d.ts',await readFile(path.resolve(args[claudeFlag+1]),'utf8'),ts.ScriptTarget.Latest,true),types=new Map(s.statements.filter(ts.isTypeAliasDeclaration).map(n=>[n.name.text,n.type]));
    function variants(n){if(!n)return [];if(ts.isTypeReferenceNode(n))return variants(types.get(n.typeName.getText(s)));if(ts.isUnionTypeNode(n))return n.types.flatMap(variants);if(ts.isTypeLiteralNode(n)){const result={};for(const p of n.members)if(ts.isPropertySignature(p)&&['type','subtype'].includes(p.name.getText(s))&&ts.isLiteralTypeNode(p.type)&&ts.isStringLiteral(p.type.literal))result[p.name.getText(s)]=p.type.literal.text;return [result];}return [];}
    const values=variants(types.get('SDKMessage')),actual={messages:[...new Set(values.map(v=>v.type).filter(Boolean))].sort(),systems:[...new Set(values.filter(v=>v.type==='system').map(v=>v.subtype))].sort()};
    for(const [name,list]of Object.entries(actual))if(JSON.stringify(list)!==JSON.stringify((fixture.claudePublished??fixture.claude)[name]))throw Error('NATIVE_EVENT_BASELINE_REVIEW_REQUIRED: claude '+name);
  }
  const nativeFlag=args.indexOf('--claude-inventory');
  if(nativeFlag>=0){
    const rows=JSON.parse(await readFile(path.resolve(args[nativeFlag+1]),'utf8'));
    const actual={messages:[...new Set(['user','result',...rows.flatMap(row=>row.types)])].sort(),systems:[...new Set(rows.flatMap(row=>row.subtypes))].sort()};
    for(const [name,list]of Object.entries(actual))if(JSON.stringify(list)!==JSON.stringify(fixture.claude[name]))throw Error('NATIVE_EVENT_BASELINE_REVIEW_REQUIRED: claude native '+name);
  }
  console.log(`PASS native event catalog: ${fixture.codex.notifications.length} Codex notifications, ${fixture.codex.requests.length} requests, ${fixture.codex.items.length} items; ${fixture.claude.messages.length} Claude envelopes, ${fixture.claude.systems.length} system subtypes. Dispositions are not a claim of full capability support.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await checkNativeEvents(path.resolve(fileURLToPath(new URL('..',import.meta.url))),process.argv.slice(2));
