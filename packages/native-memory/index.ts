import path from 'node:path';
import os from 'node:os';
import { rm } from 'node:fs/promises';
import { atomicWrite, digest, noLinks, optionalText, readJson, SerialQueue } from '../native-resources/files';
import { createFrameworkSnapshot } from '../memory-core';
import { dedupKey, readNativeSources, splitBlock, type NativeHomes, type Provider } from './sources';
import { changeMemory, listMemories, readMemory } from './manage';
import { MemoryExchange, type InitialSources } from './exchange';
import type { MemoryHandoffSession } from './protocol';
import { MemoryBackgroundTasks, type MemoryTaskBinding } from './background';
import { storeConsolidatedReference, type MemoryConsolidationWriter } from './consolidation';
export type { NativeMemoryEntry, NativeMemoryDocument } from './manage';
export type { NativeMemoryCatalog, CatalogMemoryEntry, MemoryArchiveEntry, MemoryArchiveDocument, EvidenceState } from './catalog';

export interface NativeMemoryConfig {
  version: 3; enabled: boolean; files: Record<string,string>; pending: Record<string,string>;
  lastCapture?: string; lastError?: string; sourceCount?: number; uniqueCount?: number;
}
export interface NativeMemoryStatus {
  backgroundRunning?:boolean;
  backgroundAdmission?: import('./background').MemoryBackgroundAdmission;
  backgroundAdmissions?:Partial<Record<Provider,import('./background').MemoryBackgroundAdmission>>;
  backgroundTasks?: import('./background').MemoryBackgroundTask[];
  activeCodex?: number; activeClaude?: number;
  enabled: boolean; running: boolean; lastSync?: string; lastCapture?: string; lastError?: string; sourceCount: number; uniqueCount: number;
  needsInitialImport: boolean; initialSources?: InitialSources; pendingCodex: number; pendingClaude: number; acknowledgedCount: number; handoffError?: string; paused?: boolean;
}
export class NativeMemoryService {
  private config!: NativeMemoryConfig;
  private queue=new SerialQueue(); private timer?:ReturnType<typeof setInterval>;
  private revision=0; private scanning=false; private stopped=false;
  private readonly file:string;
  readonly exchange:MemoryExchange;
  readonly background:MemoryBackgroundTasks;
  readonly referenceWriter:MemoryConsolidationWriter={store:storeConsolidatedReference};
  constructor(readonly directory:string,private readonly environment:{home?:string;codexHome?:string;claudeHome?:string;intervalMs?:number;projects?:()=>string[];machineIdentity?:string;canSync?:()=>Promise<boolean>;canReceive?:(runtime:Provider,project?:string)=>Promise<boolean>}={}){
    this.file=path.join(directory,'native-memory.json');this.exchange=new MemoryExchange(path.join(directory,'memory-exchange'),()=>this.homes,environment.machineIdentity,this.referenceWriter);
    this.background=new MemoryBackgroundTasks(directory,{
      allowed:target=>this.canProcessBackground(target),
      pending:runtime=>this.queue.run(async()=>{await this.capture();return this.exchange.pendingIds(runtime);}),
      prepare:(target,sessionId,submissionId,entries)=>this.queue.run(async()=>{
        if(!await this.canProcessBackground(target))return;
        const runtime=target.binding.runtime as 'codex'|'claude';
        const prompt=await this.exchange.prepare(runtime,sessionId,submissionId,'Process only this device-local native memory handoff batch.',target.permissionMode,target.projectPath,entries);
        const batch=this.exchange.activeBatch(runtime,sessionId);return batch?{prompt,...batch}:undefined;
      }),
      finish:(runtime,sessionId,deliveryId)=>this.queue.run(async()=>{await this.exchange.finish(runtime,sessionId);return this.exchange.verifiedCount(deliveryId);}),
      read:(target,sessionId,query)=>this.readHandoff(target.binding.runtime as 'codex'|'claude',sessionId,query,target.projectPath),
      verify:(target,sessionId)=>this.verifyHandoff(target.binding.runtime as 'codex'|'claude',sessionId,target.projectPath),
      issues:deliveryId=>this.exchange.receiptIssues(deliveryId),
      prepareConsolidation:(target,sessionId,submissionId,entries)=>this.queue.run(async()=>{
        if(!await this.canProcessBackground(target))return;
        return this.exchange.prepareConsolidation(sessionId,submissionId,entries,[target.binding.runtime as Provider]);
      }),
      readConsolidation:(target,sessionId,query)=>this.queue.run(async()=>{if(!await this.canProcessBackground(target))throw Error('MEMORY_HANDOFF_INACTIVE');this.assertRecipient(target,sessionId);return this.exchange.readConsolidation(sessionId,query);}),
      storeConsolidation:(target,sessionId,input,signal)=>this.queue.run(async()=>{
        const check=async()=>{signal.throwIfAborted();this.assertRecipient(target,sessionId);if(['read-only','plan'].includes(target.permissionMode??'default')||!await this.canProcessBackground(target))throw Error('MEMORY_HANDOFF_INACTIVE');};
        await check();return this.exchange.storeConsolidation(sessionId,input,check);
      }),
      verifyConsolidation:(target,sessionId)=>this.queue.run(async()=>{if(!await this.canProcessBackground(target))throw Error('MEMORY_HANDOFF_INACTIVE');this.assertRecipient(target,sessionId);return this.exchange.verifyConsolidation(sessionId);}),
      finishConsolidation:sessionId=>this.queue.run(()=>this.exchange.finishConsolidation(sessionId)),
    });
  }
  private assertRecipient(target:MemoryTaskBinding,sessionId:string){const runtimes=this.exchange.consolidationRuntimes(sessionId);if(runtimes.length!==1||runtimes[0]!==target.binding.runtime)throw Error('MEMORY_BACKGROUND_RECIPIENT_MISMATCH');}
  private async canProcessBackground(target:MemoryTaskBinding){return !this.stopped&&this.config?.enabled===true&&(!this.environment.canSync||await this.environment.canSync())&&(!this.environment.canReceive||await this.environment.canReceive(target.binding.runtime as 'codex'|'claude',target.projectPath));}
  private get homes():NativeHomes {
    const home=this.environment.home??os.homedir();
    return {home,codex:this.environment.codexHome??process.env.CODEX_HOME??path.join(home,'.codex'),claude:this.environment.claudeHome??process.env.CLAUDE_CONFIG_DIR??path.join(home,'.claude'),projects:this.environment.projects?.()??[]};
  }
  async initialize(){
    const stored=await readJson<Record<string,any>>(this.file,{version:3,enabled:false,files:{},pending:{}});
    if(![1,2,3].includes(stored.version)||!stored.files||!stored.pending)throw Error('Native memory preferences are invalid.');
    this.config={version:3,enabled:stored.version===1?stored.armed===true&&stored.continuous===true:stored.enabled,files:stored.files,pending:stored.pending,lastCapture:stored.lastCapture,sourceCount:stored.sourceCount,uniqueCount:stored.uniqueCount};
    if(typeof this.config.enabled!=='boolean'||[...Object.values(this.config.files),...Object.values(this.config.pending)].some(v=>typeof v!=='string'||!/^[a-f\d]{64}$/.test(v)))throw Error('Native memory preferences are invalid.');
    await this.exchange.initialize();
    await this.background.initialize();
    if(this.config.enabled)await this.sync().catch(()=>{});
    this.timer=setInterval(()=>{if(!this.stopped&&this.config.enabled&&!this.scanning)void this.sync().catch(()=>{});},this.environment.intervalMs??5000);this.timer.unref();
  }
  private save(){return atomicWrite(this.file,JSON.stringify(this.config,null,2));}
  async configure(patch:{enabled:boolean;initialSources?:InitialSources}){
    await this.queue.run(async()=>{
      if(Object.keys(patch).some(k=>!['enabled','initialSources'].includes(k))||typeof patch.enabled!=='boolean'||(patch.initialSources!==undefined&&(!patch.enabled||!['codex','claude','both'].includes(patch.initialSources))))throw Error('Memory locations and directions are automatic; initial sources can be selected once.');
      if(patch.initialSources&&!this.exchange.status().needsInitialImport)throw Error('Initial memory sources have already been selected.');
      this.config.enabled=patch.enabled;this.revision++;await this.save();
      if(patch.enabled)await this.capture(patch.initialSources);
    });
    if(!patch.enabled)await this.background.cancelAll();
    return this.status();
  }
  async status():Promise<NativeMemoryStatus>{
    const state=this.exchange.status();
    return {enabled:this.config.enabled,running:this.scanning,backgroundRunning:this.background.busy(),backgroundTasks:this.background.list(),backgroundAdmission:this.background.admission(),backgroundAdmissions:this.background.admissions(),paused:this.environment.canSync ? !await this.environment.canSync() : false,lastSync:state.lastHandoff,lastCapture:this.config.lastCapture,lastError:this.config.lastError,sourceCount:this.config.sourceCount??0,uniqueCount:this.config.uniqueCount??0,...state};
  }
  async list(){return this.queue.run(()=>listMemories(this.homes));}
  private async catalogSnapshot(){
    try {const {sources,warnings}=await readNativeSources(this.homes);return this.exchange.catalog(sources,!!warnings.length);}
    catch {return this.exchange.catalog([],true);}
  }
  async catalog(){return this.queue.run(()=>this.catalogSnapshot());}
  async readArchive(id:string){return this.queue.run(async()=>this.exchange.readArchive(id,await this.catalogSnapshot()));}
  async read(id:string){return this.queue.run(()=>readMemory(this.homes,id));}
  async change(id:string,revision:string,content:string|null){
    await this.queue.run(async()=>{await changeMemory(this.homes,id,revision,content);this.revision++;});
    if(this.config.enabled)await this.sync().catch(()=>{});return this.status();
  }
  private ownedLegacy(file:string,block:boolean){
    const h=this.homes;
    const relative=(root:string)=>{const r=path.relative(root,file);return !!r&&!r.startsWith('..')&&!path.isAbsolute(r);};
    if(block)return (relative(h.codex)&&['AGENTS.md','AGENTS.override.md'].includes(path.basename(file))&&path.dirname(file)===h.codex)||relative(h.claude);
    return relative(path.join(h.codex,'memories','workbench-sync'))||relative(path.join(h.claude,'workbench-sync'))||(relative(path.join(h.claude,'projects'))&&file.split(path.sep).includes('workbench-sync'))||(path.dirname(file)===path.join(h.codex,'memories','extensions','ad_hoc','notes')&&/^workbench-sync-[a-f\d]+\.md$/.test(path.basename(file)));
  }
  /** Retire only hash-verified prior projections; native originals and edited copies are never deleted. */
  private async retireLegacy(){
    const c=this.config,items:{key:string;file:string;before?:string;after?:string}[]=[];
    for(const receipt of new Set([...Object.keys(c.files),...Object.keys(c.pending)])){
      const block=receipt.endsWith('#block'),file=block?receipt.slice(0,-6):receipt;
      if(!this.ownedLegacy(file,block))throw Error('Legacy memory ownership cannot be verified; source files were preserved.');
      await noLinks(file);const before=await optionalText(file),text=block?splitBlock(before??'').block:before;
      if(text&&digest(text)!==c.files[receipt]&&digest(text)!==c.pending[receipt])throw Error('Synchronization conflict: an edited legacy projection was preserved.');
      items.push({key:receipt,file,before,after:block?splitBlock(before??'').remainder:undefined});
    }
    for(const item of items){
      await noLinks(item.file);if(await optionalText(item.file)!==item.before)throw Error('Legacy memory changed during cleanup; the newer content was preserved.');
      if(item.before!==undefined){if(item.after===undefined)await rm(item.file,{force:true});else await atomicWrite(item.file,item.after);}
      delete c.files[item.key];delete c.pending[item.key];await this.save();
    }
  }
  private async capture(initialSources?:InitialSources){
    if(this.stopped||!this.config.enabled)return {archived:0};
    if(this.environment.canSync&&!await this.environment.canSync())return {archived:0};
    this.scanning=true;
    try{
      await this.retireLegacy();
      const {sources,warnings}=await readNativeSources(this.homes);if(warnings.length)throw Error('Native settings could not be read; memory capture is paused.');
      const again=await readNativeSources(this.homes),signature=(items:typeof sources)=>digest(JSON.stringify(items.map(s=>[s.provider,s.file,s.hash])));
      if(again.warnings.length||signature(sources)!==signature(again.sources))throw Error('Native memory changed during capture; retry without overwriting.');
      let archived=0;
      if(initialSources){await this.exchange.seed(sources,initialSources);archived=sources.filter(s=>initialSources==='both'||s.provider===initialSources).length;}
      else archived=await this.exchange.scan(sources);
      this.config.sourceCount=sources.length;this.config.uniqueCount=new Set(sources.map(dedupKey)).size;
      if(archived)this.config.lastCapture=new Date().toISOString();
      this.config.lastError=undefined;await this.save();return {archived};
    }catch(error){this.config.lastError=(error as Error).message;await this.save();throw error;}
    finally{this.scanning=false;}
  }
  async sync(){return this.queue.run(()=>this.capture());}
  session(runtime:Provider,sessionId:string,projectPath?:string,permission?:()=>string|undefined):MemoryHandoffSession {
    if(!['codex','claude'].includes(runtime)||!sessionId)throw Error('Memory handoff requires a bound native runtime session.');
    return {runtime,sessionId,prepare:(task,submissionId,mode)=>this.queue.run(async()=>{
      if(this.stopped||!this.config.enabled)return task;
      if(this.environment.canSync&&!await this.environment.canSync()){this.exchange.release(runtime,sessionId);return task;}
      if(this.environment.canReceive&&!await this.environment.canReceive(runtime,projectPath)){this.exchange.release(runtime,sessionId);return task;}
      try{return await this.exchange.prepare(runtime,sessionId,submissionId,task,mode??permission?.(),projectPath);}
      catch(error){this.config.lastError=(error as Error).message;await this.save();return task;}
    }),finish:()=>this.queue.run(async()=>{
      if(this.stopped)return;
      try{if(this.config.enabled)await this.exchange.finish(runtime,sessionId);else this.exchange.release(runtime,sessionId);}
      catch(error){this.config.lastError=(error as Error).message;await this.save();}
    })};
  }
  async readHandoff(runtime:Provider,sessionId:string,value:Record<string,unknown>,projectPath?:string){
    return this.queue.run(async()=>{
      if(this.stopped||!this.config.enabled||(this.environment.canSync&&!await this.environment.canSync())||(this.environment.canReceive&&!await this.environment.canReceive(runtime,projectPath)))throw Error('MEMORY_HANDOFF_INACTIVE');
      return this.exchange.readActive(runtime,sessionId,value);
    });
  }
  async verifyHandoff(runtime:Provider,sessionId:string,projectPath?:string){
    return this.queue.run(async()=>{
      if(this.stopped||!this.config.enabled||(this.environment.canSync&&!await this.environment.canSync())||(this.environment.canReceive&&!await this.environment.canReceive(runtime,projectPath)))throw Error('MEMORY_HANDOFF_INACTIVE');
      return this.exchange.verifyActive(runtime,sessionId);
    });
  }
  /** Native memory is no longer injected as a frozen, permanent shared snapshot. */
  async createSnapshot(input:{sessionId:string;projectPath?:string}){
    const revision=this.revision;
    return createFrameworkSnapshot([],{sessionId:input.sessionId,revision,memoryEnabled:false,source:'native-provider-files'},()=>this.revision===revision);
  }
  async dispose(){this.stopped=true;if(this.timer)clearInterval(this.timer);await this.background.dispose();await this.queue.idle();}
}
