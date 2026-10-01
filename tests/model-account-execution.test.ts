import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StateStore} from '../apps/desktop/host/store';
import {LocalModelAccounts} from '../apps/desktop/host/local-model-accounts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider';
import {NativeMemoryTaskExecutor} from '../apps/desktop/host/memory-background';
import {attachNativeObservation} from '../apps/desktop/host/native-observation';
import {ProcessSupervisor,decodeNativeFrame,type ProcessSpec} from '../services/remote-supervisor';
import type {Session} from '../packages/contracts';
import type {ModelUsageEntry} from '../packages/model-management/types';

const id='11111111-1111-4111-a111-111111111111';
class NativeFixture extends ProcessSupervisor {
  writes:any[]=[];
  constructor(spec:ProcessSpec,private runtime:'codex'|'claude'){super(spec);}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async start(){this.state='running';}
  override async write(v:any){
    this.writes.push(v);
    if(this.runtime==='codex'&&v.id){
      this.frame({id:v.id,result:v.method==='thread/start'?{thread:{id:'native'}}:v.method==='turn/start'?{turn:{id:'turn'}}:{}});
      if(v.method==='turn/start')setTimeout(()=>{this.frame({method:'turn/started',params:{threadId:'native',turn:{id:'turn'}}});this.frame({method:'thread/tokenUsage/updated',params:{threadId:'native',turnId:'turn',tokenUsage:{total:{inputTokens:100,outputTokens:10,cachedInputTokens:20,totalTokens:110},last:{inputTokens:100,outputTokens:10,cachedInputTokens:20,totalTokens:110}}}});this.frame({method:'turn/completed',params:{threadId:'native',turn:{id:'turn',status:'completed'}}});},5);
    }else if(this.runtime==='claude'&&v.type==='user')setTimeout(()=>{this.frame({type:'system',subtype:'init',session_id:'native',permissionMode:'default'});this.frame({type:'assistant',session_id:'native',message:{id:'message',model:'native-model',content:[{type:'text',text:'Synthetic reply'}],usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:10}}});this.frame({type:'result',subtype:'success',session_id:'native',uuid:'result',is_error:false,num_turns:1,modelUsage:{'native-model':{contextWindow:1000000}},usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:10}});},5);
  }
  override async stop(reason='fixture'){if(this.state!=='closed'){this.state='closed';this.emit('disconnect',{code:0,signal:null,reason});}return{code:0,signal:null,reason};}
}
for(const runtime of ['codex','claude'] as const)for(const background of [false,true])test(`${runtime} official ${background?'background':'foreground'} completes through the runner and records only numeric usage`,async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-account-execution-')),store=new StateStore(root);await store.load();
  await store.update(s=>{s.localModelAccounts=[{id,revision:'r',provider:runtime,name:'Synthetic',enabled:true,status:'authenticated',models:[{id:'native-model',model:'native-model',name:'Native model',isDefault:true,efforts:[],serviceTiers:[]}]}];});
  const cli={home:root,env:{PATH:process.env.PATH,OPENAI_API_KEY:'blocked',ANTHROPIC_AUTH_TOKEN:'blocked'},locate:async()=>({executable:'synthetic-native'}),isMaintaining:()=>false} as any;
  const accounts=new LocalModelAccounts(root,cli,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),busy:()=>false,open:async()=>{}});
  const target=accounts.targets()[0]!,session:Session={id:'22222222-2222-4222-a222-222222222222',binding:target.binding,modelSelection:target.selection,permissionMode:'default',projectId:null,title:'Synthetic',pinned:false,archived:false,group:'',status:'idle',messages:[],createdAt:new Date().toISOString()};
  const processes:NativeFixture[]=[],factory=(spec:ProcessSpec)=>{const p=new NativeFixture(spec,runtime);processes.push(p);return p;},connections={} as any;
  let runner:NativeProviderRunner|undefined,observation:ReturnType<typeof attachNativeObservation>|undefined;
  try{
    let entries:ModelUsageEntry[]=[];
    const fetcher:typeof fetch=async()=>{throw Error('Official model requests must not enter the API gateway');};
    if(background){
      const executor=new NativeMemoryTaskExecutor(connections,cli,fetcher,accounts,{processFactory:factory,usage:async rows=>{entries.push(...rows);}});
      const result=await executor.run({sessionId:session.id,target:{binding:{...session.binding,nativeSessionId:'foreground-thread'},modelSelection:session.modelSelection,permissionMode:'default'},prompt:'Synthetic maintenance',signal:new AbortController().signal,read:async()=>({}),verify:async()=>{throw Error('Not used');}});
      assert.equal(result.state,'completed');assert.deepEqual(store.snapshot().sessions,[]);assert.equal(JSON.stringify(entries).includes('Synthetic maintenance'),false);
    }else{
      await store.update(s=>{s.sessions=[session];});runner=new NativeProviderRunner(connections,cli,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),peers:()=>({definitions:[],call:async()=>({})}) as any,observe:async(id,source)=>{observation=attachNativeObservation(id,source,()=>store.snapshot(),fn=>store.update(fn));},context:async()=>'',translate:()=>{}},fetcher,accounts,factory);
      await runner.submit(session.id,{id:'prompt',original:'Synthetic task',translated:'Synthetic task',revision:1,sourceHash:'fixture',bypass:true,demo:false});
      for(let i=0;i<300&&runner.busy(session.id);i++)await new Promise(r=>setTimeout(r,10));assert.equal(runner.busy(session.id),false);await observation?.flush();assert.equal(store.snapshot().sessions[0]?.nativeTurnStatus,'completed');entries=store.snapshot().modelUsage??[];if(runtime==='claude'){assert.equal(store.snapshot().sessions[0]?.nativeContextUsage?.capacity,1000000);assert.equal(store.snapshot().sessions[0]?.nativeContextUsage?.used,140);}
    }
    const unique=new Map(entries.map(e=>[e.key,e]));assert.equal(unique.size,1);const usage=[...unique.values()][0]!;assert.equal(usage.scope.kind,'account');assert.equal(usage.scope.id,id);assert.equal(usage.totalTokens,runtime==='codex'?110:140);
    assert.equal(processes.length,1);assert.equal(processes[0]!.spec.env?.OPENAI_API_KEY,undefined);assert.equal(processes[0]!.spec.env?.ANTHROPIC_AUTH_TOKEN,undefined);assert.ok(processes[0]!.spec.env?.ANTHROPIC_CONFIG_DIR?.startsWith(root));assert.ok(!processes[0]!.writes.some(v=>v.method==='thread/resume'));
  }finally{await runner?.dispose();await observation?.dispose();await accounts.dispose();await rm(root,{recursive:true,force:true});}
});
