import type {Session} from '../contracts';
export interface ApiBudgetPause {turnId:string;calls:number;limit:number;at:string}
export interface ApiBudgetPolicy {id:`plugin:${string}`;limit(session:Session):number|undefined}
export class ApiTurnBudgets {
 private policies=new Map<string,ApiBudgetPolicy>();
 register(policy:ApiBudgetPolicy):()=>void{if(!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(policy.id)||typeof policy.limit!=='function')throw Error('API_BUDGET_POLICY_INVALID');if(this.policies.has(policy.id))throw Error('API_BUDGET_POLICY_DUPLICATE');const entry={...policy};this.policies.set(entry.id,entry);return()=>{if(this.policies.get(entry.id)===entry)this.policies.delete(entry.id);};}
 limit(session:Session):number{for(const policy of [...this.policies.values()].reverse()){const value=policy.limit(session);if(value!==undefined)return this.validate(value);}return this.validate(session.apiCallBudget??0);}
 validate(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<0)throw Error('API_CALL_BUDGET_INVALID');return Number(value);}
}
