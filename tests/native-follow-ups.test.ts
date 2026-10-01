import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider';
import {ProcessSupervisor,decodeNativeFrame} from '../services/remote-supervisor';
import {StateStore} from '../apps/desktop/host/store';
import type {DraftPreview,Session} from '../packages/contracts';

class StreamFixture extends ProcessSupervisor {
  writes:any[]=[];
  failWrite=false;
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async start(){this.state='running';}
  override async write(value:any){if(this.failWrite)throw Error('SYNTHETIC_WRITE_FAILURE');this.writes.push(value);}
  override async stop(reason='fixture'){this.state='closed';this.emit('disconnect',{code:0,signal:null,reason});return {code:0,signal:null,reason};}
}
const until=async(check:()=>boolean)=>{for(let i=0;i<400;i++){if(check())return;await delay(5);}assert.ok(check(),'native fixture did not settle');};
const preview=(id:string):DraftPreview=>({id,original:'Original '+id,translated:'Submitted '+id,sourceHash:id,revision:1,bypass:true,demo:false});
async function fixture(t:test.TestContext){
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-native-follow-up-')),store=new StateStore(root);await store.load();let process!:StreamFixture;
  const model={id:'model',model:'fixture-model',name:'Fixture',enabled:true},connection={id:'provider',name:'Fixture',baseUrl:'http://127.0.0.1:1/v1',protocol:'chat-completions',enabled:true,auth:'none',models:[model],timeoutMs:5000};
  await store.update(s=>s.sessions=[{id:'s',projectId:null,projectPath:root,title:'Fixture',status:'idle',createdAt:new Date().toISOString(),pinned:false,archived:false,group:'',messages:[],modelSelection:{model:model.model},binding:{runtime:'claude',provider:'fixture',accountRef:'fixture',modelConnectionId:'provider',modelMappingId:'model',executionId:'local',egress:'direct-api'}} as Session]);
  const runner=new NativeProviderRunner({connection:()=>connection,key:async()=>''} as any,{home:root,env:{},locate:async()=>({executable:'synthetic'}),isMaintaining:()=>false} as any,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),context:async()=>'',translate:()=>{},observe:async()=>{},peers:()=>({definitions:[],call:async()=>{}}) as any},async()=>{throw Error('No external inference');},undefined,spec=>(process=new StreamFixture(spec)));
  t.after(async()=>{await runner.dispose();await rm(root,{recursive:true,force:true});});await runner.submit('s',preview('initial'));await until(()=>!!process?.writes.length);process.frame({type:'system',subtype:'init',session_id:'root'});await until(()=>store.snapshot().sessions[0]!.binding.nativeSessionId==='root');
  return {runner,process,store,root,get:()=>store.snapshot().sessions[0]!,result:(failed=false)=>process.frame({type:'result',session_id:'root',subtype:failed?'error_during_execution':'success',is_error:failed})};
}

test('Claude result before input echo keeps its process alive until both explicit inputs are consumed',async t=>{
  const f=await fixture(t);await f.runner.steer('s',preview('a'),'initial');await f.runner.steer('s',preview('b'),'initial');f.result();await delay(30);assert.equal(f.runner.busy('s'),true);assert.equal(f.get().status,'running');
  f.process.frame({type:'user',session_id:'root',uuid:'a',message:{role:'user',content:'Submitted a'}});f.result();await delay(30);assert.equal(f.runner.busy('s'),true);
  f.process.frame({type:'user',session_id:'root',uuid:'b',message:{role:'user',content:'Submitted b'}});f.process.frame({type:'assistant',session_id:'root',uuid:'answer',message:{content:[{type:'text',text:'Synthetic answer'}]}});f.result();await until(()=>!f.runner.busy('s'));
  assert.deepEqual(f.get().messages.filter(m=>m.role==='user').map(m=>[m.id,m.delivery]),[['initial',undefined],['a','accepted'],['b','accepted']]);assert.equal(f.get().nativeTurnStatus,'completed');await assert.rejects(f.runner.steer('s',preview('late'),'initial'));assert.equal(f.process.writes.filter(v=>v.type==='user').length,3);
});

for(const failure of ['terminal','disconnect','write'] as const)test(`Claude ${failure} preserves the input with an uncertain receipt and never replays`,async t=>{
  const f=await fixture(t);if(failure==='write'){f.process.failWrite=true;await assert.rejects(f.runner.steer('s',preview('a'),'initial'),/WRITE_FAILURE/);f.process.failWrite=false;f.result(true);}else{await f.runner.steer('s',preview('a'),'initial');if(failure==='terminal')f.result(true);else f.process.emit('disconnect',{code:1,signal:null,reason:'fixture'});}
  await until(()=>!f.runner.busy('s'));const restored=(await new StateStore(f.root).load()).sessions[0]!;assert.equal(restored.messages.find(m=>m.id==='a')?.delivery,'uncertain');assert.equal(restored.messages.find(m=>m.id==='a')?.original,'Original a');assert.equal(f.process.writes.filter(v=>v.type==='user').length,failure==='write'?1:2);assert.notEqual(restored.nativeTurnStatus,'completed');
});
