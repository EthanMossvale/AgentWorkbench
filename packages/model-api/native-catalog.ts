import { mkdtemp, writeFile, rm, stat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand, type RunCommand } from '../native-runtime/process';
import type { ApiModel } from './types';
import { nativeContextSettings } from './native-context';

// Public bundled metadata only. Revision changes invalidate the entry; errors never stick.
const bundledReads=new WeakMap<RunCommand,Map<string,Promise<unknown>>>();
async function bundledMetadata(executable:string,run:RunCommand,read:()=>Promise<unknown>){
  let key:string;
  try{const target=await realpath(executable),info=await stat(target);key=JSON.stringify([target,info.size,info.mtimeMs,info.ctimeMs,info.ino]);}catch{return read();}
  let cache=bundledReads.get(run);if(!cache){cache=new Map();bundledReads.set(run,cache);}
  const existing=cache.get(key);if(existing)return structuredClone(await existing);
  const pending=read();cache.set(key,pending);while(cache.size>4)cache.delete(cache.keys().next().value!);
  try{return structuredClone(await pending);}catch(error){if(cache.get(key)===pending)cache.delete(key);throw error;}
}

/** Preserve installed native prompts/tools; change only the selected provider model's metadata. */
export function codexModelCatalog(model: ApiModel, bundled: unknown): {models:Record<string, any>[]} {
  const models = (bundled as { models?: Record<string, any>[] })?.models, context = nativeContextSettings(model);
  if (!Array.isArray(models) || !models.length || !context) throw Error('NATIVE_MODEL_CATALOG_INVALID');
  const candidates = models.filter(m => m && typeof m.slug === 'string' && m.supported_in_api !== false);
  const exact = candidates.find(m => m.slug === model.model);
  const template = exact
    // Unknown provider models use the installed native function-tool template,
    // not a model-specific code-mode profile that may hide ordinary shell tools.
    ?? [...candidates].filter(m => m.visibility === 'list' && !m.tool_mode).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))[0];
  if (!template || !(typeof template.base_instructions === 'string' || typeof template.model_messages?.instructions_template === 'string')) throw Error('NATIVE_MODEL_CATALOG_INVALID');
  const selected = { ...structuredClone(template), slug: model.model, display_name: model.name,
    description: 'Model supplied by the selected provider.', context_window: model.contextWindow,
    max_context_window: model.contextWindow, auto_compact_token_limit: context.compactAt,
    // A custom model has not declared vendor-specific inference capabilities.
    ...(!exact ? { supports_search_tool: false, supports_experimental_context: false,
      use_responses_lite: false, supports_reasoning_effort_updates: false,
      include_apps_usage_instructions: false, supports_image_detail_original: false,
      supported_reasoning_levels: [], default_reasoning_level: null, guardian: null,
      node_repl_auto_review_required: false, auto_review_model_override: null } : {}),
    // Native model upgrades must not silently rename a provider-owned model.
    upgrade: null, availability_nux: null };
  return { models: [...models.filter(m => m.slug !== model.model), selected] };
}

/** Read bundled public metadata with a disposable home; never inspect native credentials or chats. */
export async function prepareCodexModelCatalog(executable: string, model: ApiModel, sourceEnv: NodeJS.ProcessEnv, run: RunCommand = runCommand) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'awb-model-catalog-'));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const env: NodeJS.ProcessEnv = { ...sourceEnv, HOME: directory, USERPROFILE: directory, CODEX_HOME: directory };
    for (const key of Object.keys(env)) if (/^(OPENAI_|ANTHROPIC_|CODEX_API_KEY|AWB_PROVIDER_TOKEN)/.test(key)) delete env[key];
    const bundled=await bundledMetadata(executable,run,async()=>{
      const value=JSON.parse(await run({ executable, args: ['-c', 'check_for_update_on_startup=false', 'debug', 'models', '--bundled'] }, { cwd: directory, env, timeout: 15000 }));
      codexModelCatalog(model,value);return value;
    });
    const catalog = codexModelCatalog(model, bundled), file = path.join(directory, 'models.json');
    await writeFile(file, JSON.stringify(catalog), { flag: 'wx', mode: 0o600 });
    return { file, dispose };
  } catch { await dispose(); throw Error('NATIVE_MODEL_CATALOG_UNAVAILABLE'); }
}
