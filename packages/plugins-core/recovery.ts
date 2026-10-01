import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, missing, noLinks, SerialQueue, textFile } from '../native-resources/files';
import { validMember, type CompatibilityIssue } from './compatibility';

export type RecoveryPhase = 'scan' | 'compatibility' | 'host' | 'renderer' | 'cleanup' | 'startup';
export interface PluginIdentity { id: string; name?: string; hash?: string; version?: string }
export interface PluginIncident extends PluginIdentity {
  key: string; code: string; phase: RecoveryPhase; certainty: 'confirmed' | 'suspected' | 'unknown';
  at: string; hostVersion: string; previousHostVersion?: string; repairable: boolean;
  issues?: CompatibilityIssue[];
}
export interface RecoverySnapshot {
  schemaVersion: 1; hostVersion: string; previousHostVersion?: string; safeMode: boolean;
  boot: 'starting' | 'ready' | 'closed'; pending: (PluginIdentity & {phase: RecoveryPhase})[];
  incidents: PluginIncident[]; storageError?: string;
}
const safeId = (id: unknown) => typeof id==='string' && /^[a-z][a-z0-9.-]{1,79}$/.test(id);
const phases:RecoveryPhase[]=['scan','compatibility','host','renderer','cleanup','startup'];
const diagnosticIssues=(issues:unknown):CompatibilityIssue[]|undefined=>Array.isArray(issues)?issues.slice(0,20).filter(i=>i&&['HOST_VERSION_UNSUPPORTED','SERVICE_UNAVAILABLE','SERVICE_CONTRACT_UNSUPPORTED','SERVICE_MEMBER_UNAVAILABLE'].includes(i.code)).map(i=>({code:i.code,repairable:!!i.repairable,...(typeof i.service==='string'&&/^[a-z][a-z0-9./-]{0,119}$/.test(i.service)?{service:i.service}:{}),...(validMember(i.member)?{member:i.member}:{}),...(Number.isSafeInteger(i.expected)&&i.expected>0?{expected:i.expected}:{}),...(Number.isSafeInteger(i.actual)&&i.actual>0?{actual:i.actual}:{})})):undefined;
/** Diagnostic records deliberately exclude errors, stacks, paths, inputs and credentials. */
export function identity(input: PluginIdentity): PluginIdentity {
  return {id:safeId(input.id)?input.id:'workbench.unknown',...(typeof input.name==='string'?{name:input.name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,120)}:{}),...(typeof input.hash==='string'&&/^[a-f0-9]{64}$/.test(input.hash)?{hash:input.hash}:{}),...(typeof input.version==='string'&&/^[\w.+-]{1,40}$/.test(input.version)?{version:input.version}:{})};
}
export async function readSafeMode(directory: string): Promise<boolean> {
  const file=path.join(directory,'plugin-safe-mode.json');
  try {await noLinks(file);const v=JSON.parse(await textFile(file,1024));if(v?.schemaVersion!==1||typeof v.enabled!=='boolean')throw Error('PLUGIN_SAFE_MODE_INVALID');return v.enabled;}
  catch(error){if(missing(error))return false;return true;}
}
export async function writeSafeMode(directory: string, enabled: boolean) {
  await atomicWrite(path.join(directory,'plugin-safe-mode.json'),JSON.stringify({schemaVersion:1,enabled}));
  if(await readSafeMode(directory)!==enabled)throw Error('PLUGIN_SAFE_MODE_WRITE_UNCONFIRMED');
}
export class PluginRecoveryStore {
  private state:RecoverySnapshot;
  private queue=new SerialQueue();
  private listeners=new Set<(snapshot: RecoverySnapshot) => void>();
  private initialized=false;
  private activities=new Map<symbol,PluginIdentity & {phase:RecoveryPhase}>();
  readonly file:string;
  constructor(readonly directory:string, readonly hostVersion:string) {
    this.file=path.join(directory,'plugin-recovery.json');
    this.state={schemaVersion:1,hostVersion,safeMode:false,boot:'closed',pending:[],incidents:[]};
  }
  snapshot():RecoverySnapshot { return structuredClone({...this.state,pending:[...this.state.pending,...this.activities.values()]}); }
  hasPendingActivation(){return this.state.pending.length>0;}
  private notify(){for(const listener of this.listeners)listener(this.snapshot());}
  activity(plugin:PluginIdentity,phase:RecoveryPhase){const token=Symbol();this.activities.set(token,{...identity(plugin),phase});this.notify();return()=>{this.activities.delete(token);this.notify();};}
  subscribe(listener:(snapshot:RecoverySnapshot)=>void){this.listeners.add(listener);listener(this.snapshot());return()=>{this.listeners.delete(listener);};}
  private async save(){
    if(this.state.storageError==='PLUGIN_RECOVERY_STATE_INVALID'){this.notify();return;}
    try{await atomicWrite(this.file,JSON.stringify(this.state));}catch{this.state.storageError='PLUGIN_RECOVERY_STORAGE_UNAVAILABLE';this.state.safeMode=true;}
    this.notify();
  }
  async initialize(){
    if(this.initialized)return;this.initialized=true;
    this.state.safeMode=await readSafeMode(this.directory);
    try{
      await noLinks(this.file);const saved=JSON.parse(await textFile(this.file,1024*1024)) as RecoverySnapshot;
      if(saved.schemaVersion!==1||!Array.isArray(saved.incidents)||saved.incidents.length>50||!Array.isArray(saved.pending)||saved.pending.length>128||!['starting','ready','closed'].includes(saved.boot))throw Error('Invalid recovery state');
      this.state.previousHostVersion=typeof saved.hostVersion==='string'?saved.hostVersion.slice(0,40):undefined;
      this.state.incidents=saved.incidents.filter(i=>i&&safeId(i.id)&&phases.includes(i.phase)&&/^[A-Z][A-Z0-9_]{1,79}$/.test(i.code)).map(i=>({...identity(i),key:String(i.key).slice(0,64),code:i.code,phase:i.phase,certainty:['confirmed','suspected','unknown'].includes(i.certainty)?i.certainty:'unknown',at:String(i.at).slice(0,40),hostVersion:String(i.hostVersion).slice(0,40),repairable:false,issues:diagnosticIssues(i.issues)}));
      if(saved.boot!=='closed'&&saved.pending.length){
        this.state.safeMode=true;
        for(const pending of saved.pending.slice(0,20))this.add(pending,'PLUGIN_STARTUP_INTERRUPTED',phases.includes(pending.phase)?pending.phase:'startup','suspected');
        await writeSafeMode(this.directory,true).catch(()=>{this.state.storageError='PLUGIN_RECOVERY_STORAGE_UNAVAILABLE';});
      }
    }catch(error){if(!missing(error)){this.state.safeMode=true;this.state.storageError='PLUGIN_RECOVERY_STATE_INVALID';this.add({id:'workbench.recovery'},'PLUGIN_RECOVERY_STATE_INVALID','startup','unknown');}}
  }
  private add(plugin:PluginIdentity,code:string,phase:RecoveryPhase,certainty:PluginIncident['certainty'],repairable=false,issues?:CompatibilityIssue[]){
    const item=identity(plugin);
    this.state.incidents=this.state.incidents.filter(i=>!(i.id===item.id&&i.hash===item.hash&&i.code===code));
    this.state.incidents.push({...item,key:randomUUID(),code,phase,certainty,at:new Date().toISOString(),hostVersion:this.hostVersion,previousHostVersion:this.state.previousHostVersion,repairable,issues:diagnosticIssues(issues)});
    this.state.incidents=this.state.incidents.slice(-50);
  }
  beginBoot(){return this.queue.run(async()=>{this.state.boot='starting';this.state.pending=[];await this.save();});}
  safeMode(enabled:boolean){return this.queue.run(async()=>{await writeSafeMode(this.directory,enabled);this.state.safeMode=enabled;await this.save();});}
  begin(plugin:PluginIdentity,phase:RecoveryPhase){return this.queue.run(async()=>{this.state.pending=this.state.pending.filter(p=>p.id!==plugin.id||p.phase!==phase);this.state.pending.push({...identity(plugin),phase});await this.save();if(this.state.storageError)throw Error(this.state.storageError);});}
  finish(id:string,phase:RecoveryPhase){return this.queue.run(async()=>{this.state.pending=this.state.pending.filter(p=>p.id!==id||p.phase!==phase);await this.save();});}
  incident(plugin:PluginIdentity,code:string,phase:RecoveryPhase,certainty:PluginIncident['certainty']='confirmed',repairable=false,issues?:CompatibilityIssue[]){return this.queue.run(async()=>{this.add(plugin,code,phase,certainty,repairable,issues);await this.save();});}
  clear(id:string){return this.queue.run(async()=>{this.state.incidents=this.state.incidents.filter(i=>i.id!==id);await this.save();});}
  clearCompatibility(id:string,hash:string){return this.queue.run(async()=>{const previous=this.state.incidents.length;this.state.incidents=this.state.incidents.filter(i=>i.id!==id||i.hash!==hash||i.phase!=='compatibility');if(this.state.incidents.length!==previous)await this.save();});}
  ready(){return this.queue.run(async()=>{this.state.boot='ready';await this.save();});}
  closed(){return this.queue.run(async()=>{this.state.boot='closed';this.state.pending=[];await this.save();});}
}
export async function bounded<T>(operation:Promise<T>, milliseconds:number, code:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),milliseconds);})]);}
  finally{if(timer)clearTimeout(timer);}
}
