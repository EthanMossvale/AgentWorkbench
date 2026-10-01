import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import type {AccountCatalog,SshHost} from '../contracts';
import {runSsh,type SshRunner,validateSshHost} from '../ssh-transport';
import {workspaceHostIdentity} from '../workspace-control';
import {USAGE_REMOTE} from './remote';
import type {AccountUsage,QuotaPool,QuotaWindow,ResetPlan,ResetReceipt,ResetCard} from './types';
export type * from './types';
const row=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const safe=(v:unknown,max=100):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]|Bearer\s|token\s*[:=]|-----BEGIN/i.test(v);
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const errors:Record<string,string>={CLAUDE_QUOTA_QUERY_UNSUPPORTED:'此 Claude CLI 不支持原生额度查询，请更新远端 Claude Code 后重试。',CLAUDE_QUOTA_RESPONSE_INVALID:'Claude 返回的额度格式无法识别，请更新工作台或 CLI。',CLAUDE_QUOTA_QUERY_FAILED:'Claude 原生额度查询失败，请稍后刷新。',ACCOUNT_MIGRATION_REQUIRED:'旧账号需要先完成原生账号接入，额度读取不会使用旧凭据中转。',UNSUPPORTED:'此远端 Codex 版本尚未提供该接口。',ACCOUNT_NOT_SELECTED:'此账号尚未被任何已登记工作空间选中。请先在获授权空间选择该账号。',ACCOUNT_CHANGED:'账号或使用权已变化，请刷新后重试。'};
const window=(v:unknown):QuotaWindow|undefined=>{
 if(!row(v)||!nonnegative(v.usedPercent)||v.usedPercent>100)return;
 return {usedPercent:v.usedPercent,...(nonnegative(v.windowDurationMins)?{windowMinutes:v.windowDurationMins}:{}),...(nonnegative(v.resetsAt)?{resetsAt:v.resetsAt}:{})};
};
export function parseAccountUsage(value:unknown,accountId:string):AccountUsage{
 if(!row(value)||!row(value.pools))throw Error('无效额度回执。');
 const pools:QuotaPool[]=Object.entries(value.pools).slice(0,32).flatMap(([id,v])=>{
  if(!safe(id)||!row(v))return [];
  const primary=window(v.primary),secondary=window(v.secondary);
  if(!primary&&!secondary&&!row(v.credits))return [];
  return [{id,name:safe(v.limitName)?v.limitName:id,primary,secondary,...(safe(v.planType)?{plan:v.planType}:{}),...(row(v.credits)&&typeof v.credits.unlimited==='boolean'?{credits:{unlimited:v.credits.unlimited,...(typeof v.credits.balance==='string'&&/^\d+(?:\.\d+)?$/.test(v.credits.balance)?{balance:v.credits.balance}:{})}}:{})}];
 });
 const credits=value.resetCredits,supported=row(credits)&&Number.isSafeInteger(credits.availableCount)&&credits.availableCount>=0;
 const details=supported&&Array.isArray(credits.credits),cards:ResetCard[]=[];
 if(details){
  for(const item of credits.credits.slice(0,128)){
   if(!row(item)||!safe(item.id,256)||!safe(item.resetType,100)||cards.some(c=>c.creditId===item.id))continue;
   cards.push({key:item.id,creditId:item.id,type:item.resetType,count:1,available:item.status==='available'&&credits.availableCount>0&&(!nonnegative(item.expiresAt)||item.expiresAt*1000>Date.now()),...(safe(item.title,160)?{title:item.title}:{}),...(nonnegative(item.expiresAt)?{expiresAt:item.expiresAt}:{})});
  }
 }
 const remaining=supported?Math.max(0,credits.availableCount-cards.filter(c=>c.available).length):0;
 if(remaining>0)cards.push({key:'next-available',type:'codexRateLimits',count:remaining,available:true,title:details?'其余可用重置卡':'可用额度重置卡'});
 return {accountId,observedAt:nonnegative(value.observedAt)?new Date(value.observedAt*1000).toISOString():new Date().toISOString(),availability:pools.length?'ready':'unsupported',pools,cards,cardsSupported:!!supported,...(supported?{availableResetCount:credits.availableCount,resetDetailsKnown:details}:{}),...(!pools.length?{reason:'原生接口未返回可显示的额度窗口。'}:{})};
}
interface SavedPlan {plan:ResetPlan;hostIdentity:string;accountGeneration:string;authorityId:string;generation:string;source?:AccountCatalog['source'];submitted:boolean;receipt?:ResetReceipt;}
export class AccountUsageService{
 private cache=new Map<string,AccountUsage>();private failed=new Set<string>();private damaged=new Set<string>();private revisions=new Map<string,string>();private reads=new Map<string,Promise<AccountUsage>>();private plans=new Map<string,SavedPlan>();private busy=new Set<string>();private pending=new Set<Promise<unknown>>();private stopped=false;
 constructor(private directory:string,private runner:SshRunner=runSsh){}
 private async unresolved(identity:string,accountId:string):Promise<SavedPlan|undefined>{
  const directory=path.join(this.directory,'reset-receipts');let files:string[];
  try{files=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  for(const file of files.filter(name=>/^[-a-f0-9]{36}\.json$/.test(name))){
   const saved=JSON.parse(await readFile(path.join(directory,file),'utf8')) as SavedPlan;
   if(saved.hostIdentity===identity&&saved.plan.accountId===accountId&&saved.submitted&&(!saved.receipt||saved.receipt.state==='uncertain'))return saved;
  }
 }
 private recovery(saved:SavedPlan):ResetReceipt{return saved.receipt??{id:saved.plan.id,accountId:saved.plan.accountId,cardType:saved.plan.cardType,state:'uncertain',message:'上次兑换尚未确认。请使用原请求核对回执。'};}
 private target(host:SshHost,catalog:AccountCatalog,id:string){validateSshHost(host);if(catalog.source!=='native-owner')throw Error(errors.ACCOUNT_MIGRATION_REQUIRED);const account=catalog.accounts.find(a=>a.id===id);if(this.stopped||catalog.availability!=='ready'||!account||!safe(id))throw Error('请刷新可验证的官方账号目录。');return {accountId:id,accountGeneration:account.generation,authorityId:catalog.authorityId,generation:catalog.generation,source:catalog.source??'existing-codex'};}
 private async request(host:SshHost,cfg:Record<string,unknown>){
  const source=`import json,base64\ncfg=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(cfg)).toString('base64')}'))\n${USAGE_REMOTE}`;
  const job=this.runner(host,'exec python3 -',{stdin:source,timeoutMs:85_000,maxOutputBytes:128*1024});this.pending.add(job);
  try{const r=await job;if(r.exitCode!==0)throw Error('UNAVAILABLE');const response=JSON.parse(r.stdout);if(!row(response)||response.ok!==true)throw Error(safe(response?.error)?response.error:'UNAVAILABLE');return response.value;}
  catch(error){throw Error(error instanceof Error&&(/^[A-Z_]+$/.test(error.message))?error.message:'UNAVAILABLE');}finally{this.pending.delete(job);}
 }
 private receiptKey(host:SshHost,catalog:AccountCatalog,id:string){const target=this.target(host,catalog,id);return createHash('sha256').update(JSON.stringify([workspaceHostIdentity(host),target,catalog.accounts.find(a=>a.id===id)?.provider])).digest('hex');}
 private receiptFile(key:string){return path.join(this.directory,'quota-receipts',key+'.json');}
 private async saved(host:SshHost,catalog:AccountCatalog,id:string){
  const key=this.receiptKey(host,catalog,id),cached=this.cache.get(key);if(cached)return cached;
  try{const raw=await readFile(this.receiptFile(key),'utf8');if(raw.length>128*1024)throw Error('Invalid saved quota');const value=JSON.parse(raw);if(value?.version!==1||value.key!==key||typeof value.revision!=='string')throw Error('Invalid saved quota');
   const parsed=parseAccountUsage(value.value,id);if(parsed.availability!=='ready')return;this.cache.set(key,parsed);this.revisions.set(key,value.revision);return parsed;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;this.damaged.add(key);return;}
 }
 private async saveReceipt(key:string,revision:string,value:AccountUsage){
  const file=this.receiptFile(key),projected={observedAt:Date.parse(value.observedAt)/1000,pools:Object.fromEntries(value.pools.map(p=>[p.id,{limitName:p.name,planType:p.plan,primary:p.primary&&{usedPercent:p.primary.usedPercent,windowDurationMins:p.primary.windowMinutes,resetsAt:p.primary.resetsAt},secondary:p.secondary&&{usedPercent:p.secondary.usedPercent,windowDurationMins:p.secondary.windowMinutes,resetsAt:p.secondary.resetsAt},credits:p.credits}])),resetCredits:value.cardsSupported?{availableCount:value.availableResetCount??0,credits:value.resetDetailsKnown?value.cards.filter(c=>c.creditId).map(c=>({id:c.creditId,resetType:c.type,status:c.available?'available':'unavailable',title:c.title,expiresAt:c.expiresAt})):undefined}:undefined};
  await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({version:1,key,revision,value:projected}),{mode:0o600});if(this.damaged.has(key)){await rename(file,file+'.invalid.'+randomUUID());this.damaged.delete(key);}await rename(temp,file);
 }
 async read(host:SshHost,catalog:AccountCatalog,id:string,options:{refresh?:boolean;cacheOnly?:boolean;revision?:string}={}):Promise<AccountUsage>{
  const target=this.target(host,catalog,id),key=this.receiptKey(host,catalog,id),previous=await this.saved(host,catalog,id),revision=options.revision??'';
  const pending=host.role==='admin'&&catalog.accounts.find(a=>a.id===id)?.provider==='codex'?await this.unresolved(workspaceHostIdentity(host),id):undefined;
  const decorate=(value:AccountUsage)=>({...value,...(pending?{pendingReset:this.recovery(pending)}:{})});
  if(options.cacheOnly)return decorate(previous??{accountId:id,observedAt:new Date().toISOString(),availability:'unavailable',pools:[],cards:[],cardsSupported:false,reason:this.damaged.has(key)?'上次额度记录无法读取，原文件已保留。':'暂无已保存额度记录。'});
  if(options.refresh===false&&previous&&(!revision||this.revisions.get(key)===revision)&&!previous.pools.some(p=>[p.primary,p.secondary].some(w=>w?.resetsAt&&w.resetsAt*1000<=Date.now())))return decorate(previous);
  const active=this.reads.get(key);if(active)return decorate(await active);
  const read:Promise<AccountUsage>=(async()=>{try{const result=parseAccountUsage(await this.request(host,{...target,action:'read'}),id);if(result.availability!=='ready'&&previous){this.failed.add(key);return {...previous,reason:'暂未取得新额度，保留上次记录。'};}if(result.availability==='ready'){this.failed.delete(key);this.cache.set(key,result);this.revisions.set(key,revision);try{await this.saveReceipt(key,revision,result);}catch{return {...result,reason:'额度已更新，但本机保存失败。'};}}return result;}
   catch(error){const code=error instanceof Error?error.message:'';this.failed.add(key);if(previous)return {...previous,reason:'更新失败，保留上次额度。'+(errors[code]??'请稍后手动刷新。')};return {accountId:id,observedAt:new Date().toISOString(),availability:(code==='UNSUPPORTED'?'unsupported':'unavailable') as 'unsupported'|'unavailable',pools:[],cards:[],cardsSupported:false,reason:errors[code]??'暂时无法读取原生额度，请稍后重试。'};}})();
  this.reads.set(key,read);try{return decorate(await read);}finally{if(this.reads.get(key)===read)this.reads.delete(key);}
 }
 async prepare(host:SshHost,catalog:AccountCatalog,id:string,key:string):Promise<ResetPlan>{
  if(host.role!=='admin')throw Error('仅管理员可以确认重置卡兑换。');
  if(catalog.accounts.find(a=>a.id===id)?.provider!=='codex')throw Error('此账号不支持重置卡。');
  const target=this.target(host,catalog,id),identity=workspaceHostIdentity(host),usage=this.cache.get(this.receiptKey(host,catalog,id)),card=usage?.cards.find(c=>c.key===key);
  if(await this.unresolved(identity,id))throw Error('此账号有尚未确认的兑换，请刷新后使用原请求确认回执。');
  if(this.failed.has(this.receiptKey(host,catalog,id))||!usage||Date.now()-Date.parse(usage.observedAt)>120000||!card?.available||card.count<1||(card.expiresAt&&card.expiresAt*1000<=Date.now()))throw Error('请先刷新额度，并选择当前可用的重置卡。');
  const saved:SavedPlan={plan:{id:randomUUID(),accountId:id,cardType:card.type,creditId:card.creditId,title:card.title,remaining:usage.availableResetCount??card.count,expiresAt:new Date(Date.now()+120000).toISOString()},hostIdentity:identity,...target,submitted:false};
  await this.persist(saved);this.plans.set(saved.plan.id,saved);return saved.plan;
 }
 private async persist(saved:SavedPlan){await mkdir(path.join(this.directory,'reset-receipts'),{recursive:true});const target=path.join(this.directory,'reset-receipts',saved.plan.id+'.json'),temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(saved),{mode:0o600});await rename(temp,target);}
 async redeem(host:SshHost,catalog:AccountCatalog,planId:string):Promise<ResetReceipt>{
  if(host.role!=='admin'||!/^[-a-f0-9]{36}$/.test(planId))throw Error('重置卡确认无效。');
  let saved=this.plans.get(planId);
  if(!saved){try{saved=JSON.parse(await readFile(path.join(this.directory,'reset-receipts',planId+'.json'),'utf8')) as SavedPlan;}catch{throw Error('重置卡确认已失效。');}}
  const target=this.target(host,catalog,saved!.plan.accountId);
  const migratedReset=saved!.submitted&&(saved!.source??'existing-codex')==='existing-codex'&&target.source==='native-owner';
  if(saved!.hostIdentity!==workspaceHostIdentity(host)||saved!.accountGeneration!==target.accountGeneration||!migratedReset&&(saved!.authorityId!==target.authorityId||saved!.generation!==target.generation||(saved!.source??'existing-codex')!==target.source))throw Error('账号或连接已变化，禁止重放此兑换。');
  const legacyAccountRef=migratedReset?'vps-account:'+ [saved!.authorityId,saved!.generation,'codex',saved!.plan.accountId,saved!.accountGeneration].map(encodeURIComponent).join('/'):undefined;
  if(saved!.receipt&&saved!.receipt.state!=='uncertain')return saved!.receipt;
  if(!saved!.submitted&&Date.parse(saved!.plan.expiresAt)<=Date.now())throw Error('确认已过期，请重新读取额度。');
  const key=saved!.hostIdentity+':'+target.accountId;if(this.busy.has(key))throw Error('此账号已有兑换等待回执。');
  this.busy.add(key);
  try{
   const unresolved=await this.unresolved(saved!.hostIdentity,target.accountId);if(unresolved&&unresolved.plan.id!==planId)throw Error('请先确认此账号上一笔兑换。');
   saved!.submitted=true;await this.persist(saved!);
   let receipt:ResetReceipt;
   try{
    const result=await this.request(host,{...target,action:'redeem',requestId:planId,creditId:saved!.plan.creditId,...(legacyAccountRef?{legacyAccountRef}:{})});
    if(!row(result)||!['reset','alreadyRedeemed','nothingToReset','noCredit'].includes(result.outcome))throw Error('INVALID_RESPONSE');
    const success=['reset','alreadyRedeemed'].includes(result.outcome);
    receipt={id:planId,accountId:target.accountId,cardType:saved!.plan.cardType,state:success?'redeemed':'denied',message:result.outcome==='reset'?'原生服务已确认兑换。':result.outcome==='alreadyRedeemed'?'这次兑换此前已完成，未重复消费。':result.outcome==='nothingToReset'?'当前没有可重置的额度窗口，未消费卡片。':'账号没有可用重置卡。'};
   }
   catch(error){const code=error instanceof Error?error.message:'';const denied=!!errors[code];receipt={id:planId,accountId:target.accountId,cardType:saved!.plan.cardType,state:denied?'denied':'uncertain',message:errors[code]??'尚未确认兑换结果。重试会使用同一请求标识，不会新建兑换。'};}
   saved!.receipt=receipt;await this.persist(saved!);this.plans.set(planId,saved!);const receiptKey=this.receiptKey(host,catalog,target.accountId);this.failed.add(receiptKey);if(receipt.state==='redeemed'){this.cache.delete(receiptKey);this.revisions.delete(receiptKey);await unlink(this.receiptFile(receiptKey)).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}return receipt;
  }finally{this.busy.delete(key);}
 }
 async dispose(){this.stopped=true;await Promise.allSettled([...this.pending,...this.reads.values()]);}
}
