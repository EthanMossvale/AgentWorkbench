import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as wait} from 'node:timers/promises';
import {ModelConnections} from '../apps/desktop/host/model-connections';
import {ReasoningJobs} from '../apps/desktop/host/reasoning-jobs';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {mergeDirectory,parseModelDirectory,validateConnection} from '../packages/model-api/config';
import {applyReasoning,availableReasoningEfforts,defaultVerifiedEffort,reasoningStatus,type ReasoningProbe} from '../packages/model-api/reasoning-info';
import {verifyConnectionReasoning} from '../packages/model-api/reasoning-probe';
import {reasoningRejection} from '../packages/model-api/reasoning-errors';
import {nativeWireRequest} from '../packages/model-api/native-wire';
import type {ModelConnection} from '../packages/model-api/types';

const levels=['low','medium','high','xhigh','max'];
const mapping={id:'mapped',model:'upstream',name:'Five levels',enabled:true};
const config=()=>validateConnection({name:'Fixture',baseUrl:'https://fixture.invalid/v1',protocol:'responses',models:[mapping]});
const evidence=(patch:Partial<ReasoningProbe>={}):ReasoningProbe=>({status:'inconclusive',reason:'ignored',accepted:[],rejected:[],checkedAt:'2026-09-28T00:00:00Z',fingerprint:'old-fixture',...patch});
async function fixture(fetcher:typeof fetch){
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-passive-')),store=new StateStore(directory);await store.load();
  const secrets=new SecretStore(path.join(directory,'secrets'),{encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});
  const host=new ModelConnections({snapshot:()=>store.snapshot(),update:change=>store.update(change),busy:()=>false},secrets,fetcher);
  return {directory,store,host,close:async()=>{host.dispose();await rm(directory,{recursive:true,force:true});}};
}

test('directory and saved evidence expose the same five choices without requiring generation',()=>{
  const declared={...mapping,efforts:levels,defaultEffort:'high',metadataSource:'upstream' as const};
  assert.deepEqual(availableReasoningEfforts(declared),levels);assert.equal(defaultVerifiedEffort(declared),'high');
  const verified={...mapping,reasoningProbe:evidence({status:'verified',reason:undefined,accepted:levels})};
  assert.deepEqual(availableReasoningEfforts(verified),levels);assert.equal(defaultVerifiedEffort(verified),'medium');
  for(const to of ['responses','chat-completions','anthropic-messages'] as const){
    const wire=nativeWireRequest({input:'synthetic'},'responses',to,verified,'xhigh');
    assert.equal(wire.reasoning?.effort??wire.reasoning_effort??wire.output_config?.effort,'xhigh');
  }
  assert.match(reasoningStatus(verified),/请求已接受/);assert.doesNotMatch(reasoningStatus(declared),/验证/);
});

test('inconclusive legacy probes cannot mask newly read directory levels or erase existing metadata',()=>{
  const c=config();c.models[0]!.reasoningProbe=evidence();
  const next=mergeDirectory(c,[{...mapping,efforts:levels,defaultEffort:'high',metadataSource:'upstream'}]);
  assert.deepEqual(availableReasoningEfforts(next.models[0]!),levels);
  assert.equal(defaultVerifiedEffort(next.models[0]!),'high');
  assert.deepEqual(next.models[0]!.reasoningProbe,c.models[0]!.reasoningProbe);
  const unknown=applyReasoning(next.models[0]!,{efforts:undefined,defaultEffort:undefined,reasoningProbe:evidence({reason:'format',httpStatus:422})});
  assert.deepEqual(availableReasoningEfforts(unknown),levels);assert.equal(unknown.defaultEffort,'high');
  assert.doesNotMatch(reasoningStatus(c.models[0]!),/连接失败|使用服务默认/);
});

test('public discovery, save, refresh and restart preserve per-model levels with GET only',async()=>{
  const calls:string[]=[];
  const listing={data:[{id:'upstream',reasoning_efforts:levels,default_reasoning_effort:'high'},{id:'unknown'},{id:'other',reasoning_efforts:['low','high']}]};
  const f=await fixture(async(url,init)=>{assert.equal(String(url),'https://fixture.invalid/v1/models');assert.equal(init?.method,'GET');calls.push(init.method);return Response.json(listing);});
  try{
    const directory=await f.host.call('model-api/discover',{connection:config()}) as ModelConnection['models'];
    assert.deepEqual(directory[0]?.efforts,levels);assert.equal(directory[1]?.efforts,undefined);
    let saved=await f.host.call('model-api/save',{connection:{...config(),models:directory.map(m=>({...m,enabled:true}))}}) as ModelConnection;
    assert.deepEqual(availableReasoningEfforts(saved.models[0]!),levels);assert.deepEqual(availableReasoningEfforts(saved.models[1]!),[]);assert.deepEqual(availableReasoningEfforts(saved.models[2]!),['low','high']);
    saved=await f.host.call('model-api/save',{id:saved.id,revision:saved.revision,connection:{...saved,models:saved.models.map((m,i)=>i?m:{...m,manualEfforts:['medium','ultra'],defaultEffort:'ultra'})}}) as ModelConnection;
    saved=await f.host.call('model-api/refresh',{id:saved.id,revision:saved.revision}) as ModelConnection;
    assert.deepEqual(availableReasoningEfforts(saved.models[0]!),['medium','ultra']);assert.equal(defaultVerifiedEffort(saved.models[0]!),'ultra');
    const wire=nativeWireRequest({input:'synthetic'},'responses','chat-completions',saved.models[0]!,'ultra');assert.equal(wire.reasoning_effort,'ultra');
    saved=await f.host.call('model-api/save',{id:saved.id,revision:saved.revision,connection:{...saved,models:saved.models.map((m,i)=>i?m:{...m,manualEfforts:undefined,efforts:undefined,defaultEffort:undefined})}}) as ModelConnection;
    const restarted=new StateStore(f.directory);await restarted.load();const restored=restarted.snapshot().modelConnections![0]!;
    assert.deepEqual(availableReasoningEfforts(restored.models[0]!),levels);assert.equal(restored.models[0]!.reasoningProbe,undefined);
    assert.equal(restored.revision,saved.revision);assert.equal(calls.length,5);
  }finally{await f.close();}
});

test('start and legacy verification save flags require separate explicit inference consent before network or persistence',async()=>{
  let requests=0;const f=await fixture(async()=>{requests++;throw Error('Must not send');});
  try{
    for(const [method,options] of [['model-api/reasoning/start',{}],['model-api/save',{verifyReasoning:true}],['model-api/save',{backgroundReasoning:true}]] as const){
      await assert.rejects(f.host.call(method,{connection:config(),...options}),/REASONING_INFERENCE_REQUIRES_EXPLICIT_CONSENT/);
    }
    assert.equal(requests,0);assert.equal(f.store.snapshot().modelConnections?.length??0,0);
  }finally{await f.close();}
});

test('cancellation stops even an attached job and does not publish after the delayed response',async()=>{
  let release!:()=>void,calls=0,published=false;const blocked=new Promise<void>(r=>release=r);
  const jobs=new ReasoningJobs(async()=>{calls++;await blocked;return Response.json({status:'completed',output:[]});});
  try{
    const c=config(),job=jobs.start(c,'');assert.equal(jobs.attach(job.id,c,'',async()=>{published=true;}),true);
    assert.equal(jobs.cancel(job.id).state,'cancelled');release();await wait(30);
    assert.equal(calls,1);assert.equal(published,false);assert.equal(jobs.status(job.id).state,'cancelled');
  }finally{release();jobs.dispose();}
});

test('same endpoint may accept all legitimate efforts for one model and only two for another',async()=>{
  const c=config();c.models.push({...mapping,id:'other',model:'other'});const requests:string[]=[];
  const next=await verifyConnectionReasoning(c,'',undefined,async(_url,init)=>{
    const body=JSON.parse(String(init?.body));requests.push(body.reasoning.effort);
    return body.model==='upstream'||['low','high'].includes(body.reasoning.effort)?Response.json({status:'completed',output:[]}):Response.json({error:{param:'reasoning.effort',message:'Unsupported effort'}},{status:400});
  });
  assert.equal(next.models[0]?.efforts?.length,7);assert.deepEqual(next.models[1]?.efforts,['low','high']);
  assert.ok(requests.every(e=>!e.includes('invalid')));assert.ok(next.models.every(m=>m.reasoningProbe?.status==='verified'));
});

test('generic 422 body locations allow effort-specific declarations without borrowing another parameter enum',()=>{
  assert.deepEqual(reasoningRejection({detail:[{loc:['body'],msg:"reasoning_effort must be 'low', 'high'",type:'literal_error'}]}),{rejected:true,declared:['low','high']});
  assert.deepEqual(reasoningRejection({error:{param:'temperature',message:"Invalid effort input. Supported values are 'low', 'high'"}}),{rejected:false,declared:[]});
  assert.deepEqual(reasoningRejection({detail:[{loc:['body'],msg:'Malformed request'}]}),{rejected:false,declared:[]});
});

test('multiple directory effort schemas feed one choice resolver and missing declarations stay unknown',()=>{
  for(const metadata of [{reasoning_efforts:levels},{supported_reasoning_efforts:levels},{capabilities:{effort:{supported_efforts:levels}}}]){
    assert.deepEqual(availableReasoningEfforts(parseModelDirectory({data:[{id:'fixture',...metadata}]})[0]!),levels);
  }
  assert.deepEqual(availableReasoningEfforts(parseModelDirectory({data:[{id:'fixture-high-reasoning'}]})[0]!),[]);
});
