import ts from 'typescript';
import {checkNativeEvents} from './check-native-events.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractMethods,hostSources} from './check-public-docs.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await checkNativeEvents(root);
const files=['packages/visualizations/index.ts','packages/visualizations/instructions.ts','packages/visualizations/document.ts','packages/session-core/follow-ups.ts','packages/ui-preferences/index.ts','packages/ui-preferences/window.ts','packages/native-memory/background.ts','packages/native-memory/consolidation.ts','packages/native-memory/default-target.ts','packages/native-memory/index.ts','packages/session-core/native-titles.ts','packages/native-events/semantics.ts','packages/collaboration-core/activity-groups.ts','packages/session-core/presentation.ts','services/codex-bridge/index.ts','packages/native-events/types.ts','packages/native-events/index.ts','packages/model-management/access-registry.ts','packages/model-management/credentials.ts','apps/desktop/host/account-names.ts','apps/desktop/renderer/AccountCard.tsx','apps/desktop/renderer/file-review-controller.ts','packages/collaboration-core/file-changes.ts','packages/collaboration-core/diff-view.ts','packages/model-management/account-export-types.ts','apps/desktop/host/account-export.ts','packages/shortcuts/index.ts','apps/desktop/renderer/shortcuts.ts','packages/session-core/turn-timing.ts','packages/session-metrics/index.ts','packages/collaboration-core/reading-turns.ts','packages/appearance/index.ts','packages/appearance/themes.ts','packages/appearance/syntax.ts','packages/appearance/fonts.ts','packages/session-core/sidebar-sessions.ts','packages/model-management/types.ts','packages/native-memory/receipts.ts','packages/remote-account-catalog/cli.ts','packages/remote-account-catalog/retention-types.ts','packages/plugins-core/index.ts','packages/plugins-core/services.ts','packages/plugins-core/storage-types.ts','packages/plugins-core/compatibility.ts','packages/plugins-core/compatibility-repair.ts','packages/plugins-core/recovery.ts','packages/plugins-core/repair-draft.ts','packages/runtime-extensions/types.ts','packages/attachments/activity-images.ts','packages/collaboration-core/activity.ts','packages/collaboration-core/activity-details.ts','apps/desktop/renderer/media-controller.ts','apps/desktop/renderer/attachment-draft.ts','apps/desktop/renderer/attachment-actions.ts','apps/desktop/renderer/plugin-renderer.ts','apps/desktop/renderer/plugin-settings.ts','apps/desktop/renderer/plugin-surfaces.ts'];
const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
files.push('packages/translation/types.ts','packages/translation/native.ts');
files.push('packages/navigation/file-links.ts','packages/navigation/file-resolution.ts');
files.push('packages/model-api/native-diagnostics.ts','packages/model-api/native-gateway.ts','packages/model-api/native-completion.ts','packages/model-api/native-request.ts');
files.push('packages/branding/types.ts','packages/remote-account-catalog/configuration.ts');
files.push('packages/model-api/types.ts','packages/workspace-control/native-runtime.ts','packages/session-core/draft-recovery.ts');
files.push('services/claude-bridge/index.ts','services/claude-bridge/tools.ts','services/remote-supervisor/index.ts');
files.push('services/claude-bridge/local-context.ts');
files.push('packages/model-api/runtime-target.ts');
files.push('packages/session-core/recovery.ts','packages/translation/layouts.ts');
files.push('packages/model-api/context-state.ts');
files.push('apps/desktop/host/workspace-management.ts');
files.push('services/claude-bridge/policy.ts','services/claude-bridge/result-store.ts','services/claude-bridge/local-tasks.ts');
files.push('packages/attachments/paste.ts');
files.push('packages/context-annotations/index.ts','apps/desktop/renderer/annotation-controller.ts');
files.push('apps/desktop/host/memory-background.ts');
files.push('packages/desktop-updates/index.ts','packages/app-data/service.ts','packages/native-runtime/cli.ts');
const sdk={};
for(const file of files){const source=ts.createSourceFile(file,await readFile(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);sdk[file]=source.statements.filter(node=>(ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node))&&node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword)).map(node=>printer.printNode(ts.EmitHint.Unspecified,node,source)).sort();}
const bridge=ts.createSourceFile('contracts.ts',await readFile(path.join(root,'packages/contracts/index.ts'),'utf8'),ts.ScriptTarget.Latest,true);sdk['packages/contracts/index.ts']=bridge.statements.filter(node=>(ts.isInterfaceDeclaration(node)&&['WorkbenchApi','SharedAccount','SharedAccountAlias','TranslationProfile','TranslationResult','NativeContextUsage'].includes(node.name.text))||(ts.isTypeAliasDeclaration(node)&&node.name.text==='DesktopCommand')).map(node=>printer.printNode(ts.EmitHint.Unspecified,node,bridge));
const methods=new Set();for(const file of hostSources)for(const method of extractMethods(await readFile(path.join(root,file),'utf8')))methods.add(method);
// Surface names and selectors are public values, not interface declarations.
const surfaces=ts.createSourceFile('surfaces.ts',await readFile(path.join(root,'apps/desktop/renderer/plugin-surfaces.ts'),'utf8'),ts.ScriptTarget.Latest,true);
const surfaceNode=surfaces.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).find(node=>node.name.getText(surfaces)==='workbenchSurfaces');
if(!surfaceNode?.initializer)throw Error('PLUGIN_SURFACE_CONTRACT_MISSING');
const settings=ts.createSourceFile('settings.ts',await readFile(path.join(root,'apps/desktop/renderer/plugin-settings.ts'),'utf8'),ts.ScriptTarget.Latest,true);
const settingsNode=settings.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).find(node=>node.name.getText(settings)==='coreSettingsTabs');
if(!settingsNode?.initializer)throw Error('PLUGIN_SETTINGS_CONTRACT_MISSING');
const actual={schemaVersion:2,sdk,namedSurfaces:printer.printNode(ts.EmitHint.Unspecified,surfaceNode.initializer,surfaces),coreSettingsTabs:printer.printNode(ts.EmitHint.Unspecified,settingsNode.initializer,settings),hostMethods:[...methods].sort()};const baseline=path.join(root,'tests/fixtures/plugin-contracts-v1.json');
if(process.argv.includes('--write')){await writeFile(baseline,JSON.stringify(actual,null,2)+'\n');console.log('Plugin contract baseline written. Review compatibility, migration tests and API documentation before committing.');}
else{const expected=JSON.parse(await readFile(baseline,'utf8'));if(JSON.stringify(actual)!==JSON.stringify(expected)){console.error('PLUGIN_CONTRACT_REVIEW_REQUIRED: Public SDK declarations or host method names changed. Add compatibility coverage and update docs/36 before deliberately refreshing the baseline.');process.exitCode=1;}else console.log(`PASS plugin contract baseline: ${Object.values(sdk).reduce((n,items)=>n+items.length,0)} declarations, ${methods.size} host methods. Internal service semantics and arbitrary DOM selectors still require dedicated tests.`);}
