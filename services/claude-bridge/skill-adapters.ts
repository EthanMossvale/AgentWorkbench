import type {LocalClaudeSkill,LocalClaudeSkillPlan,LocalClaudeSkillRequest} from './local-context';

export interface ClaudeSkillAdapterInput {skill:LocalClaudeSkill;request:LocalClaudeSkillRequest;markdown:string;cwd:string;effort?:string}
export interface ClaudeSkillAdapter {id:`plugin:${string}`;load(input:ClaudeSkillAdapterInput,core:()=>Promise<LocalClaudeSkillPlan>):Promise<LocalClaudeSkillPlan>|undefined}
/** Native lifecycle adapters can extend the verified source without replacing discovery. */
export class ClaudeSkillAdapters {
 private adapters=new Map<string,ClaudeSkillAdapter>();
 register(adapter:ClaudeSkillAdapter):()=>void {if(this.adapters.has(adapter.id))throw Error('LOCAL_SKILL_ADAPTER_DUPLICATE');const entry={...adapter};this.adapters.set(entry.id,entry);return ()=>{if(this.adapters.get(entry.id)===entry)this.adapters.delete(entry.id);};}
 load(input:ClaudeSkillAdapterInput,core:()=>Promise<LocalClaudeSkillPlan>):Promise<LocalClaudeSkillPlan>{for(const adapter of [...this.adapters.values()].reverse()){const value=adapter.load(input,core);if(value!==undefined)return value;}return core();}
}
export const claudeSkillAdapters=new ClaudeSkillAdapters();
