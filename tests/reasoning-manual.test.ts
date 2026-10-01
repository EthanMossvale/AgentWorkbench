import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {validateConnection,mergeDirectory} from '../packages/model-api/config';
import {reasoningRejection} from '../packages/model-api/reasoning-errors';
import {availableReasoningEfforts,defaultVerifiedEffort,reasoningStatus} from '../packages/model-api/reasoning-info';
import {verifyConnectionReasoning} from '../packages/model-api/reasoning-probe';
import {nativeWireRequest} from '../packages/model-api/native-wire';
import {ModelConnections} from '../apps/desktop/host/model-connections';
import {ReasoningJobs} from '../apps/desktop/host/reasoning-jobs';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import type {ModelConnection} from '../packages/model-api/types';

const config=()=>validateConnection({name:'Fixture',baseUrl:'https://fixture.invalid/v1',protocol:'responses',models:[{id:'model',model:'model',name:'Model',enabled:true}]});
const enumError=()=>({error:{param:'reasoning.effort',type:'invalid_request_error',message:"Invalid value: '__workbench_invalid_effort__'. Supported values are: 'low', 'medium', 'high', and 'xhigh'."}});
async function until(check:()=>boolean){for(let i=0;i<100;i++){if(check())return;await wait(10);}throw Error('fixture timeout');}

test('OpenAI-style, Messages-style and nested validation errors expose only declared effort tokens',()=>{
  for(const data of [enumError(),{error:{message:"output_config.effort: Input should be 'low', 'medium', 'high' or 'xhigh'",type:'invalid_request_error'}},{detail:[{loc:['body','reasoning_effort'],msg:"Input should be 'low', 'medium', 'high' or 'xhigh'",type:'literal_error',input:'private-input',ctx:{expected:"'low', 'medium', 'high' or 'xhigh'"}}]},{error:{param:'reasoning_effort',message:'Invalid value',allowed_values:['xhigh','high','medium','low','private-value']}}]){
    assert.deepEqual(reasoningRejection(data),{rejected:true,declared:['low','medium','high','xhigh']});
  }
  assert.deepEqual(reasoningRejection({error:{param:'temperature',message:"Invalid effort input. Supported values are: 'low', 'high'"}}),{rejected:false,declared:[]});
  assert.deepEqual(reasoningRejection({error:{param:'reasoning_effort',message:'Unsupported effort high'}}),{rejected:true,declared:[]});
});

test('declared enums from a legitimate candidate rejection are usable without further requests',async()=>{
  let calls=0;const c=config();
  const result=await verifyConnectionReasoning(c,'fixture-secret',undefined,async(_url,init)=>{
    calls++;assert.equal(JSON.parse(String(init?.body)).reasoning.effort,'light');return Response.json(enumError(),{status:400});
  });
  const model=result.models[0]!;assert.equal(calls,1);assert.equal(model.reasoningProbe?.status,'declared');assert.deepEqual(model.reasoningProbe?.accepted,[]);
  assert.deepEqual(availableReasoningEfforts(model),['low','medium','high','xhigh']);assert.equal(defaultVerifiedEffort(model),'medium');assert.match(reasoningStatus(model),/上游已声明/);
  assert.doesNotMatch(JSON.stringify(result),/fixture-secret|invalid_request_error|Supported values/);
  await verifyConnectionReasoning(c,'fixture-secret',result,async()=>{throw Error('cached enum should not call upstream');});
  const strict={...c,models:[{...c.models[0]!,effortCandidates:['high']}]};let strictCalls=0;
  const verified=await verifyConnectionReasoning(strict,'',undefined,async()=>{strictCalls++;return Response.json({status:'completed',output:[]});});
  assert.equal(strictCalls,1);assert.equal(verified.models[0]?.reasoningProbe?.status,'verified');assert.deepEqual(verified.models[0]?.reasoningProbe?.accepted,['high']);
});

test('streaming success returned by a compatibility endpoint is recognized in all three protocols',async()=>{
  for(const protocol of ['responses','chat-completions','anthropic-messages'] as const){
    const c={...config(),protocol};let calls=0;
    const result=await verifyConnectionReasoning(c,'',undefined,async()=>{
      calls++;
      const event=protocol==='responses'?{type:'response.completed',response:{status:'completed',output:[]}}:protocol==='anthropic-messages'?{type:'message_delta',delta:{stop_reason:'end_turn'}}:{choices:[{delta:{},finish_reason:'stop'}]};
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
    });
    assert.equal(result.models[0]?.reasoningProbe?.status,'verified');assert.equal(result.models[0]?.efforts?.length,7);
  }
});

test('unknown diagnostics distinguish auth, rate limits, format and transport without retaining raw errors',async()=>{
  for(const [response,reason] of [[()=>Response.json({},{status:401}),'auth'],[()=>Response.json({},{status:429}),'rate-limit'],[()=>Response.json({},{status:503}),'server'],[()=>new Response('private-html'),'format'],[()=>{throw Error('private-transport');},'network']] as const){
    const result=await verifyConnectionReasoning(config(),'',undefined,async()=>response());const model=result.models[0]!;
    assert.equal(model.reasoningProbe?.reason,reason);assert.match(reasoningStatus(model),/可手动选择/);assert.doesNotMatch(JSON.stringify(result),/private-/);
  }
});

test('one unavailable model does not prevent another model from returning a declared enum',async()=>{
  const c=config();c.models.push({...c.models[0]!,id:'other',model:'other'});
  const result=await verifyConnectionReasoning(c,'',undefined,async(_url,init)=>JSON.parse(String(init?.body)).model==='model'?Response.json({},{status:503}):Response.json(enumError(),{status:400}));
  assert.equal(result.models[0]?.reasoningProbe?.reason,'server');assert.equal(result.models[1]?.reasoningProbe?.status,'declared');
});

test('manual choices remain distinct from verification and survive metadata, unknown probes and both native wire adapters',async()=>{
  const c=validateConnection({...config(),models:[{...config().models[0],manualEfforts:['ultra','medium'],defaultEffort:'ultra'}]});
  const result=await verifyConnectionReasoning(c,'',undefined,async()=>Response.json({},{status:429}));const model=result.models[0]!;
  assert.deepEqual(model.efforts,['medium','ultra']);assert.equal(defaultVerifiedEffort(model),'ultra');assert.match(reasoningStatus(model),/手动选择，尚未验证/);
  const refreshed=mergeDirectory(result,[{...model,manualEfforts:undefined,efforts:['low'],defaultEffort:'low',metadataSource:'upstream'}]);
  assert.deepEqual(refreshed.models[0]?.efforts,['medium','ultra']);assert.equal(refreshed.models[0]?.defaultEffort,'ultra');
  for(const from of ['responses','anthropic-messages'] as const)for(const to of ['responses','chat-completions','anthropic-messages'] as const){
    const body=from==='responses'?{input:'OK',reasoning:{effort:'low'}}:{messages:[{role:'user',content:'OK'}],output_config:{effort:'low'}};
    const wire=nativeWireRequest(body,from,to,model,'ultra');assert.equal(wire.reasoning?.effort??wire.reasoning_effort??wire.output_config?.effort,'ultra');
  }
  assert.throws(()=>validateConnection({...c,models:[{...model,manualEfforts:['invented']}]}),/档位|MANUAL_EFFORTS/);
  assert.throws(()=>validateConnection({...c,models:[{...model,effortCandidates:['medium']}]}),/MODES_CONFLICT/);
});

test('a completed inconclusive job is not reused on the next explicitly requested detection',async()=>{
  let calls=0;const jobs=new ReasoningJobs(async()=>{calls++;return Response.json({},{status:503});});
  try{const c=config(),first=jobs.start(c,'');await until(()=>jobs.status(first.id).state==='complete');let applied=false;assert.equal(jobs.attach(first.id,c,'',async()=>{applied=true;}),true);await until(()=>applied);assert.equal(calls,1);const second=jobs.start(c,'');await until(()=>jobs.status(second.id).state==='complete');assert.notEqual(first.id,second.id);assert.equal(calls,2);}finally{jobs.dispose();}
});

test('manual save, background result, restart, busy protection and restoration use the public host contract',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-manual-')),store=new StateStore(directory);await store.load();
  const secrets=new SecretStore(path.join(directory,'secrets'),{encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});let busy=false;
  const host=new ModelConnections({snapshot:()=>store.snapshot(),update:change=>store.update(change),busy:()=>busy},secrets,async()=>Response.json(enumError(),{status:400}));
  try{
    const c={...config(),models:[{...config().models[0],manualEfforts:['medium','ultra'],defaultEffort:'ultra'}]};
    const saved=await host.call('model-api/save',{connection:c,backgroundReasoning:true,allowInference:true}) as ModelConnection;
    await until(()=>!!host.connection(saved.id).models[0]?.reasoningProbe);
    let current=host.connection(saved.id);assert.deepEqual(current.models[0]?.efforts,['medium','ultra']);assert.equal(current.models[0]?.defaultEffort,'ultra');assert.equal(current.models[0]?.reasoningProbe?.status,'declared');
    const reopened=new StateStore(directory);await reopened.load();assert.deepEqual(reopened.snapshot().modelConnections?.[0]?.models[0]?.manualEfforts,['medium','ultra']);
    busy=true;await assert.rejects(host.call('model-api/save',{id:current.id,revision:current.revision,connection:{...current,models:[{...current.models[0],manualEfforts:['medium'],defaultEffort:'medium'}]},backgroundReasoning:true,allowInference:true}),/正在使用/);busy=false;
    current=await host.call('model-api/save',{id:current.id,revision:current.revision,connection:{...current,models:[{...current.models[0],manualEfforts:undefined,defaultEffort:undefined}]},backgroundReasoning:true,allowInference:true}) as ModelConnection;
    assert.equal(current.models[0]?.manualEfforts,undefined);assert.deepEqual(current.models[0]?.efforts,['low','medium','high','xhigh']);assert.equal(defaultVerifiedEffort(current.models[0]!),'medium');
  }finally{host.dispose();await rm(directory,{recursive:true,force:true});}
});
