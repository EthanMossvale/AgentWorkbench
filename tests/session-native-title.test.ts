import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { StateStore } from '../apps/desktop/host/store';
import { LocalModelAccounts } from '../apps/desktop/host/local-model-accounts';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider';
import { NativeCodexRunner } from '../apps/desktop/host/native-codex';
import { ProcessSupervisor, decodeNativeFrame, type ProcessSpec } from '../services/remote-supervisor';
import type { Session, AppState, DraftPreview } from '../packages/contracts';

const until=async(check:()=>boolean)=>{for(let n=0;n<150;n++){if(check())return;await delay(10);}assert.ok(check(),'Native fixture did not settle');};
class TitleTransport extends ProcessSupervisor {
  writes:any[]=[];
  constructor(spec:ProcessSpec,readonly initialName?:string){super(spec);}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async start(){this.state='running';}
  override async write(value:any){
    this.writes.push(value);
    if(value.id)this.frame({id:value.id,result:value.method==='thread/start'?{thread:{id:'root',name:this.initialName}}:value.method==='turn/start'?{turn:{id:'turn'}}:{}});
  }
  override async stop(reason='fixture'){if(this.state!=='closed'){this.state='closed';this.emit('disconnect',{code:0,signal:null,reason});}return {code:0,signal:null,reason};}
}

for(const initialName of [undefined,'Native initial name'])test(`local Codex consumes ${initialName?'initial metadata':'notifications'} without a naming request`,async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'awb-title-')),store=new StateStore(directory);await store.load();
  const accountId='11111111-1111-4111-a111-111111111111';
  await store.update(s=>{s.localModelAccounts=[{id:accountId,revision:'fixture',provider:'codex',name:'Synthetic',enabled:true,status:'authenticated',models:[{id:'native',model:'native',name:'Native',isDefault:true,efforts:[],serviceTiers:[]}]}];});
  const cli={home:directory,env:{PATH:process.env.PATH},locate:async()=>({executable:'synthetic'}),isMaintaining:()=>false} as any;
  const accounts=new LocalModelAccounts(directory,cli,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),busy:()=>false,open:async()=>{}}),target=accounts.targets()[0]!;
  const session:Session={id:'22222222-2222-4222-a222-222222222222',projectId:null,title:'New',titleSource:'fallback',pinned:false,archived:false,group:'',status:'idle',messages:[],createdAt:'2026-09-29T00:00:00Z',binding:target.binding,modelSelection:target.selection,permissionMode:'default'};
  await store.update(s=>{s.sessions=[session];});let transport!:TitleTransport;
  const runner=new NativeProviderRunner({} as any,cli,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),peers:()=>({definitions:[],call:async()=>({})}) as any,observe:async()=>{},context:async()=>'',translate:()=>{}},async()=>{throw Error('No network expected');},accounts,spec=>transport=new TitleTransport(spec,initialName));
  const get=()=>store.snapshot().sessions[0]!;
  try{
    await runner.submit(session.id,{id:'draft',original:'中文输入 fallback',translated:'English model task',revision:1,sourceHash:'fixture',bypass:true,demo:false});
    await until(()=>transport?.writes.some(v=>v.method==='turn/start'));
    assert.equal(get().title,initialName??'中文输入 fallback');
    const notify=(threadId:string|undefined,threadName:string)=>transport.frame({method:'thread/name/updated',params:{threadId,threadName}});
    notify('child','Wrong child');notify(undefined,'Missing root');await delay(30);assert.equal(get().title,initialName??'中文输入 fallback');
    notify('root','Actual Native Title');await until(()=>get().title==='Actual Native Title');
    await store.update(s=>{s.sessions[0]!.title='手动标题';s.sessions[0]!.titleSource='manual';});
    notify('root','Late Native Title');await delay(30);assert.equal(get().title,'手动标题');
    const turn=transport.writes.find(v=>v.method==='turn/start');assert.equal(turn.params.input[0].text,'English model task');
    assert.equal(transport.writes.filter(v=>v.method==='turn/start').length,1);assert.equal(transport.writes.some(v=>/name|title/.test(v.method??'')),false);
    transport.frame({method:'turn/completed',params:{threadId:'root',turn:{id:'turn',status:'completed'}}});await until(()=>!runner.busy(session.id));
    const reloaded=new StateStore(directory);await reloaded.load();assert.equal(reloaded.snapshot().sessions[0]?.title,'手动标题');assert.equal(reloaded.snapshot().sessions[0]?.titleSource,'manual');
  }finally{await runner.dispose();await accounts.dispose();await rm(directory,{recursive:true,force:true});}
});

test('SSH runner routes only live root title events and preserves initial native name',async()=>{
  const session={id:'ssh',projectId:null,projectPath:tmpdir(),title:'New',titleSource:'fallback',pinned:false,archived:false,group:'',status:'idle',messages:[],createdAt:'2026-09-29T00:00:00Z',binding:{runtime:'codex',provider:'openai',accountRef:'synthetic',hostId:'host',executionId:'local-device',egress:'vps'}} as Session;
  const state={sessions:[session],hosts:[{id:'host'}]} as AppState;
  const rpc=Object.assign(new EventEmitter(),{isBoundThread:(id:string)=>id==='root'});
  const handle={threadId:'root',threadName:'Native SSH name',connection:{rpc},adapter:{startTurn:async()=>({turn:{id:'turn'}})}};
  const service={supports:()=>true,connect:async()=>handle,close:async()=>{rpc.emit('disconnect');},dispose:async()=>{rpc.emit('disconnect');}} as any;
  const runner=new NativeCodexRunner(service,{snapshot:()=>state,update:async fn=>fn(state),context:async()=>({}),peers:()=>({}),observe:async()=>{},translate:()=>{}});
  const notify=(threadId:string|undefined,threadName:string)=>rpc.emit('raw',{value:{method:'thread/name/updated',params:{threadId,threadName}},receivedAt:'2026-09-29T00:00:00Z',sequence:1});
  try{
    await runner.submit('ssh',{id:'draft',original:'Fallback task',translated:'Task'} as DraftPreview);assert.equal(session.title,'Native SSH name');
    notify('child','Wrong');notify(undefined,'Missing');await delay(20);assert.equal(session.title,'Native SSH name');
    notify('root','Updated SSH name');await until(()=>session.title==='Updated SSH name');
    session.title='Manual';session.titleSource='manual';notify('root','Late');await delay(20);assert.equal(session.title,'Manual');
    rpc.emit('raw',{value:{method:'turn/completed',params:{threadId:'root',turn:{id:'turn',status:'completed'}}}});await until(()=>session.status==='idle');
    await runner.close('ssh');notify('root','After close');await delay(20);assert.equal(session.title,'Manual');
  }finally{await runner.dispose();}
});
