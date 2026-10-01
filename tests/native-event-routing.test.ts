import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider';
import { attachNativeObservation } from '../apps/desktop/host/native-observation';
import { ProcessSupervisor, decodeNativeFrame, type ProcessSpec } from '../services/remote-supervisor';
import type { AppState, Session } from '../packages/contracts';

class WireFixture extends ProcessSupervisor {
  writes:any[]=[];
  constructor(spec:ProcessSpec,private runtime:'codex'|'claude',private scenario:'normal'|'future-result'|'foreign'){super(spec);}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async start(){this.state='running';}
  override async write(v:any){
    this.writes.push(v);
    if(this.runtime==='codex'&&v.method&&v.id){
      this.frame({id:v.id,result:v.method==='thread/start'?{thread:{id:'root'}}:v.method==='turn/start'?{turn:{id:'turn'}}:{}});
      if(v.method==='turn/start')setTimeout(()=>{
        this.frame({method:'turn/started',params:{threadId:'root',turn:{id:'turn',status:'inProgress'}}});
        this.frame({method:'future/notice',params:{threadId:'root',token:'SECRET'}});
        this.frame({id:'future-request',method:'future/action',params:{threadId:'root',turnId:'turn',token:'SECRET'}});
        this.frame({id:'unbound-request',method:'attestation/generate',params:{challenge:'SECRET'}});
        this.frame({method:'thread/started',params:{thread:{id:'child',parentThreadId:'root'}}});
        this.frame({method:'future/child',params:{threadId:'child',private:'SECRET'}});
        this.frame({method:'turn/completed',params:{threadId:'child',turn:{id:'child-turn',status:'completed'}}});
        this.frame({method:'turn/completed',params:{threadId:'root',turn:{id:'turn',status:this.scenario==='future-result'?'futureStatus':'completed'}}});
      },5);
    }else if(this.runtime==='claude'&&v.type==='user')setTimeout(()=>{
      this.frame({type:'system',subtype:'init',session_id:'root',permissionMode:'default'});
      this.frame({type:'system',subtype:'future_notice',session_id:'root',token:'SECRET'});
      this.frame({type:'control_request',request_id:'future-request',session_id:'root',request:{subtype:'future_action',token:'SECRET'}});
      if(this.scenario==='foreign'){this.frame({type:'assistant',session_id:'foreign',message:{content:[{type:'text',text:'FOREIGN_TEXT'}]}});return;}
      this.frame({type:'assistant',session_id:'root',message:{content:[null,{type:'text',text:'Fixture reply'},{type:'future_content',data:'SECRET'}]}});
      this.frame({type:'result',session_id:'root',subtype:this.scenario==='future-result'?'future_success':'success',is_error:false,uuid:'result'});
    },5);
  }
  override async stop(reason='fixture'){if(this.state!=='closed'){this.state='closed';this.emit('disconnect',{code:0,signal:null,reason});}return{code:0,signal:null,reason};}
}
for(const [runtime,scenario]of [['codex','normal'],['codex','future-result'],['claude','normal'],['claude','future-result'],['claude','foreign']] as const)test(`production ${runtime} route: ${scenario}`,async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-event-routing-')),at=new Date().toISOString();
  const model={id:'model',model:'fixture-model',name:'Fixture',enabled:true},connection={id:'provider',revision:'r',name:'Fixture',baseUrl:'http://127.0.0.1:1/v1',protocol:'chat-completions',enabled:true,auth:'none',models:[model],tools:true,timeoutMs:5000};
  const session={id:'session',projectId:null,projectPath:root,title:'Fixture',status:'idle',createdAt:at,pinned:false,archived:false,group:'',messages:[],modelSelection:{model:model.model},binding:{runtime,provider:'fixture',accountRef:'fixture',modelConnectionId:'provider',modelMappingId:'model',executionId:'local',egress:'direct-api'}} as Session;
  const state={sessions:[session],hosts:[],modelConnections:[connection]} as unknown as AppState;
  let process:WireFixture|undefined,observation:ReturnType<typeof attachNativeObservation>|undefined;
  const failures:string[]=[];
  const runner=new NativeProviderRunner({connection:()=>connection,key:async()=>''} as any,{home:root,env:{PATH:process?.spec.env?.PATH},locate:async()=>({executable:'synthetic'}),isMaintaining:()=>false} as any,{
    snapshot:()=>structuredClone(state),update:async change=>change(state),context:async()=>'',translate:()=>{},failure:error=>failures.push(String(error)),peers:()=>({definitions:[],call:async()=>{throw Error('No native tools in this fixture');}}) as any,
    observe:async(id,source)=>{observation=attachNativeObservation(id,source,()=>state,async change=>change(state));},
  },async()=>{throw Error('Unexpected upstream call');},undefined,spec=>(process=new WireFixture(spec,runtime,scenario)));
  try{
    await runner.submit('session',{id:'prompt',original:'Fixture',translated:'Fixture',revision:1,sourceHash:'fixture',bypass:true,demo:false});
    for(let n=0;n<300&&runner.busy('session');n++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(runner.busy('session'),false);await observation?.flush();
    assert.ok(session.nativeEventAudit!.unknown>=2);assert.doesNotMatch(JSON.stringify(session),/SECRET|FOREIGN_TEXT/);
    const replies=process!.writes.filter(v=>runtime==='codex'?v.id==='future-request':v.type==='control_response'&&v.response.request_id==='future-request');
    assert.equal(replies.length,1);assert.equal(runtime==='codex'?replies[0].error.code:replies[0].response.subtype,runtime==='codex'?-32601:'error');
    assert.equal(process!.writes.filter(v=>runtime==='codex'?v.method==='turn/start':v.type==='user').length,1);
    if(runtime==='codex'){assert.equal(process!.writes.find(v=>v.id==='unbound-request')?.error.code,-32602);assert.ok(session.nativeEventAudit?.receipts.some(r=>r.key==='notification/future/child'&&r.nativeChildId==='child'));}
    if(scenario==='normal'){assert.equal(session.nativeTurnStatus,'completed');assert.deepEqual(failures,[]);}
    else {assert.equal(session.status,'uncertain');assert.notEqual(session.nativeTurnStatus,'completed');assert.match(failures.join('\n'),scenario==='foreign'?/NATIVE_THREAD_MISMATCH/:runtime==='codex'?/NATIVE_TURN_RESULT_UNKNOWN/:/CLAUDE_RESULT_UNSUPPORTED/);}
  }finally{await runner.dispose();await observation?.dispose();await rm(root,{recursive:true,force:true});}
});
