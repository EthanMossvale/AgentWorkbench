import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NativeTranslationRunner } from '../packages/translation/native';
import { TranslationExecutionError } from '../packages/translation/types';
import { ProcessSupervisor, decodeNativeFrame, type ProcessSpec } from '../services/remote-supervisor';
import { initialState } from '../apps/desktop/host/store';
import { WorkbenchTranslationTargets } from '../apps/desktop/host/translation-targets';
import { LocalModelAccounts } from '../apps/desktop/host/local-model-accounts';

class FixtureProcess extends ProcessSupervisor {
 writes:any[]=[];stops=0;
 constructor(spec:ProcessSpec,private handle:(value:any,p:FixtureProcess)=>void){super(spec);}
 override async start(){this.state='running';}
 frame(value:any){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
 override async write(value:any){this.writes.push(value);this.handle(value,this);}
 override async stop(reason='fixture'){this.stops++;this.state='closed';this.emit('disconnect',{reason,code:0,signal:null});return{reason,code:0,signal:null};}
}
const request=(signal:AbortSignal)=>({instructions:'Translate only.',input:'Only this message',profile:{...initialState().translation,model:'fixture'},signal});
const usage={inputTokens:100,cachedInputTokens:60,cacheWriteInputTokens:0,outputTokens:20,reasoningOutputTokens:5,totalTokens:120};
function handshake(value:any,p:FixtureProcess){
 if(value.method==='initialize')p.frame({id:value.id,result:{}});
 if(value.method==='thread/start')p.frame({id:value.id,result:{thread:{id:'translation-thread'}}});
}

test('Codex translation owns one ephemeral thread, final completion and full usage, then removes only temporary cwd',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-native-translation-'));let process!:FixtureProcess;
 const runner=new NativeTranslationRunner(dir,spec=>process=new FixtureProcess(spec,(v,p)=>{handshake(v,p);if(v.method==='turn/start'){
  p.frame({id:v.id,result:{turn:{id:'turn'}}});p.frame({method:'item/completed',params:{threadId:'other-thread',item:{type:'agentMessage',text:'Foreign'}}});
  p.frame({method:'thread/tokenUsage/updated',params:{threadId:'translation-thread',tokenUsage:{total:usage}}});
  p.frame({method:'item/completed',params:{threadId:'translation-thread',item:{type:'agentMessage',text:'Translated'}}});
  p.frame({method:'turn/completed',params:{threadId:'translation-thread',turn:{id:'turn',status:'completed'}}});
 }}));
 try{
  const result=await runner.run({runtime:'codex',executable:'synthetic',env:{CODEX_HOME:'synthetic-account-profile'},model:'fixture',effort:'low'},request(new AbortController().signal));
  assert.equal(result.text,'Translated');assert.equal(result.counts.cacheReadTokens,60);assert.equal(result.reasoningTokens,5);assert.equal(runner.busy(),false);
  const start=process.writes.find(v=>v.method==='thread/start'),turn=process.writes.find(v=>v.method==='turn/start');assert.equal(start.params.ephemeral,true);assert.equal(start.params.baseInstructions,'Translate only.');assert.equal(turn.params.input[0].text,'Only this message');assert.equal(turn.params.effort,'low');assert.equal(process.writes.filter(v=>v.method==='turn/start').length,1);assert.equal(process.spec.env!.CODEX_HOME,'synthetic-account-profile');assert.equal(process.spec.lifetimeMs,undefined);
  assert.ok(process.spec.args.includes('features.shell_tool=false'));assert.ok(process.spec.args.includes('tools.update_plan.enabled=false'));assert.deepEqual(await readdir(path.join(dir,'translation-runs')),[]);
 }finally{await runner.dispose();await rm(dir,{recursive:true,force:true});}
});

test('native tool rejection stops process immediately and preserves observed counters',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-native-tool-'));let process!:FixtureProcess;
 const runner=new NativeTranslationRunner(dir,spec=>process=new FixtureProcess(spec,(v,p)=>{handshake(v,p);if(v.method==='turn/start'){
  p.frame({method:'thread/tokenUsage/updated',params:{threadId:'translation-thread',tokenUsage:{total:usage}}});
  p.frame({method:'item/started',params:{threadId:'translation-thread',item:{type:'commandExecution'}}});
 }}));
 try{await assert.rejects(runner.run({runtime:'codex',executable:'synthetic',env:{},model:'fixture'},request(new AbortController().signal)),error=>error instanceof TranslationExecutionError&&error.counts.inputTokens===100);assert.ok(process.stops);assert.equal(process.writes.filter(v=>v.method==='turn/start').length,1);}finally{await runner.dispose();await rm(dir,{recursive:true,force:true});}
});

test('cancellation during native initialization stops admission without sending a turn or retrying',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-native-cancel-')),abort=new AbortController();let process!:FixtureProcess;
 const runner=new NativeTranslationRunner(dir,spec=>process=new FixtureProcess(spec,(v)=>{if(v.method==='initialize')abort.abort();}));
 try{await assert.rejects(runner.run({runtime:'codex',executable:'synthetic',env:{},model:'fixture'},request(abort.signal)),/CANCELLED/);assert.equal(process.writes.some(v=>v.method==='turn/start'),false);assert.ok(process.stops);assert.equal(runner.busy(),false);}finally{await runner.dispose();await rm(dir,{recursive:true,force:true});}
});

test('Claude native translation disables tools, hooks, persistence and preserves failed usage',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-claude-translation-'));let process!:FixtureProcess;
 const runner=new NativeTranslationRunner(dir,spec=>process=new FixtureProcess(spec,(_v,p)=>{p.frame({type:'assistant',message:{content:[{type:'text',text:'Partial'}],usage:{input_tokens:10,cache_read_input_tokens:60,cache_creation_input_tokens:30,output_tokens:20}}});p.frame({type:'result',subtype:'error_during_execution',is_error:true});}));
 try{const result=await runner.run({runtime:'claude',executable:'synthetic',env:{CLAUDE_CONFIG_DIR:'synthetic-profile'},model:'fixture'},request(new AbortController().signal));assert.equal(result.text,'Partial');assert.equal(result.incomplete,true);assert.equal(result.counts.inputTokens,100);assert.equal(result.counts.cacheWriteTokens,30);assert.equal(process.spec.args[process.spec.args.indexOf('--tools')+1],'');assert.ok(process.spec.args.includes('--no-session-persistence'));assert.ok(process.spec.args.includes('--strict-mcp-config'));assert.equal(process.writes.filter(v=>v.type==='user').length,1);}finally{await runner.dispose();await rm(dir,{recursive:true,force:true});}
});

test('official model resolves the account native environment without reading keys or creating main sessions',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-account-translation-')),state=initialState(),id='11111111-1111-4111-a111-111111111111';
 state.localModelAccounts=[{id,revision:'r',name:'Synthetic account',provider:'codex',enabled:true,status:'authenticated',models:[{id:'model',model:'model',name:'Model',isDefault:true,efforts:['low'],serviceTiers:[]}]}];
 const cli={env:{OPENAI_API_KEY:'must-be-removed',CODEX_HOME:'not-this-profile'},isMaintaining:()=>false,locate:async()=>({executable:'synthetic-codex'})} as any;
 const accounts=new LocalModelAccounts(dir,cli,{snapshot:()=>state,update:async f=>{f(state);},busy:()=>false,open:async()=>{}});
 let launch:any;const native={run:async(value:any,input:any)=>{launch=value;assert.equal(input.input,'Only this message');return{text:'Translated',counts:{inputTokens:1,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:0,totalTokens:3}};}} as NativeTranslationRunner;
 const targets=new WorkbenchTranslationTargets(()=>state,{key:async()=>{throw Error('No API keys');}} as any,accounts,native,cli);
 try{const catalog=await targets.list();assert.equal(catalog.length,1);const backend=await targets.resolve(catalog[0]!.id,request(new AbortController().signal).profile,'low');await backend.execute!(request(new AbortController().signal));assert.equal(launch.env.OPENAI_API_KEY,undefined);assert.equal(launch.env.CODEX_HOME,path.join(dir,'native-accounts',id,'codex'));assert.equal(launch.effort,'low');assert.equal(state.sessions.length,0);assert.equal(targets.busy(),false);state.localModelAccounts[0]!.enabled=false;await assert.rejects(backend.execute!(request(new AbortController().signal)),/LOCAL_ACCOUNT_UNAVAILABLE/);}finally{await accounts.dispose();await rm(dir,{recursive:true,force:true});}
});

for(const outcome of ['failed','disconnect','cancel'] as const)test('Codex partial deltas on '+outcome,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-partial-')),abort=new AbortController();
 const runner=new NativeTranslationRunner(dir,spec=>new FixtureProcess(spec,(v,p)=>{handshake(v,p);if(v.method==='turn/start'){
 p.frame({id:v.id,result:{}});p.frame({method:'item/agentMessage/delta',params:{threadId:'translation-thread',delta:'Partial'}});
 if(outcome==='cancel')abort.abort();else if(outcome==='disconnect')p.emit('disconnect',{code:1});else p.frame({method:'turn/completed',params:{threadId:'translation-thread',turn:{status:'failed'}}});
 }}));try{const result=runner.run({runtime:'codex',executable:'synthetic',env:{},model:'fixture'},request(abort.signal));if(outcome==='cancel')await assert.rejects(result,/CANCELLED/);else{const value=await result;assert.equal(value.text,'Partial');assert.equal(value.incomplete,true);}}finally{await runner.dispose();await rm(dir,{recursive:true,force:true});}
});
