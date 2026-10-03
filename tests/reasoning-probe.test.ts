import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {validateConnection,mergeDirectory} from '../packages/model-api/config';
import {reasoningEfforts,reasoningStatus} from '../packages/model-api/reasoning-info';
import {reasoningProbeRequest,verifyConnectionReasoning} from '../packages/model-api/reasoning-probe';
import type {ModelConnection} from '../packages/model-api/types';
import {ModelConnections} from '../apps/desktop/host/model-connections';
import {StateStore,SecretStore} from '../apps/desktop/host/store';
import {nativeWireRequest} from '../packages/model-api/native-wire';

const model={id:'mapped',name:'Fixture',model:'upstream-model',enabled:true};
const connection=()=>validateConnection({name:'Fixture API',baseUrl:'https://gateway.example/v1',protocol:'responses',models:[model]});
const good=(protocol='responses')=>protocol==='responses'?{status:'completed',output:[]}:protocol==='anthropic-messages'?{content:[],stop_reason:'end_turn'}:{choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]};
const reject=()=>new Response(JSON.stringify({error:{param:'reasoning.effort',message:'Invalid value. Unsupported reasoning effort.'}}),{status:400});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
function strict(accepted:readonly string[]=['light','medium','xhigh']){
  const calls:any[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    if(init?.method==='GET')return json({data:[{id:model.model,reasoning_efforts:['invented']} ]});
    const body=JSON.parse(String(init?.body)),effort=body.reasoning?.effort??body.reasoning_effort??body.output_config?.effort;calls.push({url:String(url),body,effort,init});
    return !effort||accepted.includes(effort)?json(good(String(url).endsWith('/messages')?'anthropic-messages':String(url).endsWith('/completions')?'chat-completions':'responses')):reject();
  };return {calls,fetcher};
}

test('exact seven candidates include light and low independently in fixed slider order',async()=>{
  assert.deepEqual(reasoningEfforts,['light','low','medium','high','xhigh','max','ultra']);
  const f=strict(),result=await verifyConnectionReasoning(connection(),'synthetic-key',undefined,f.fetcher),m=result.models[0]!;
  assert.deepEqual(f.calls.map(c=>c.effort),reasoningEfforts);
  assert.deepEqual(m.efforts,['light','medium','xhigh']);assert.deepEqual(m.reasoningProbe?.rejected,['low','high','max','ultra']);assert.equal(m.reasoningProbe?.status,'verified');
  assert.doesNotMatch(JSON.stringify(result),/synthetic-key|Reply with|Unsupported reasoning effort/);
  assert.ok(Date.parse(m.reasoningProbe!.checkedAt));assert.equal(m.reasoningProbe?.fingerprint.length,64);
});

test('each wire protocol uses its own effort field, bounded standalone prompt and no context',async()=>{
  for(const protocol of ['responses','chat-completions','anthropic-messages'] as const){
    const c={...connection(),protocol,models:[{...model,adaptiveThinking:protocol==='anthropic-messages'}]},f=strict(reasoningEfforts);
    const result=await verifyConnectionReasoning(c,'',undefined,f.fetcher);
    assert.deepEqual(result.models[0]!.efforts,reasoningEfforts);
    for(const call of f.calls){assert.equal(call.body.stream,false);assert.equal(call.init.redirect,'manual');assert.ok(call.init.signal);assert.equal(call.body.tools,undefined);assert.equal(call.body.previous_response_id,undefined);assert.equal(call.body.max_output_tokens??call.body.max_tokens,64);}
    const request:any=reasoningProbeRequest(c,c.models[0]!,'ultra');assert.equal(request.body.reasoning?.effort??request.body.reasoning_effort??request.body.output_config?.effort,'ultra');
    if(protocol==='anthropic-messages')assert.deepEqual(request.body.thinking,{type:'adaptive'});
  }
});

test('accepted wire tokens survive both native protocol adapters without aliasing',()=>{
  const m={...model,efforts:[...reasoningEfforts]};
  for(const effort of reasoningEfforts)for(const from of ['responses','anthropic-messages'] as const)for(const to of ['responses','chat-completions','anthropic-messages'] as const){
    const body=from==='responses'?{input:'OK',reasoning:{effort:'medium'}}:{messages:[{role:'user',content:'OK'}],output_config:{effort:'medium'}};
    const wire=nativeWireRequest(body,from,to,m,effort);assert.equal(wire.reasoning?.effort??wire.reasoning_effort??wire.output_config?.effort,effort);
  }
});

test('a permissive gateway proves request acceptance without requiring rejection of an invalid control',async()=>{
  let count=0;const result=await verifyConnectionReasoning(connection(),'',undefined,async()=>{count++;return json(good());});
  assert.equal(count,7);assert.equal(result.models[0]?.reasoningProbe?.status,'verified');assert.deepEqual(result.models[0]?.efforts,reasoningEfforts);assert.match(reasoningStatus(result.models[0]!),/请求已接受/);
});

test('auth, quota, server, redirect, malformed and transport failures do not prove unsupported levels or retry',async()=>{
  const responses=[()=>json({error:{message:'Invalid effort'}},401),()=>json({},403),()=>json({},429),()=>json({},500),()=>json({},302),()=>new Response('not json'),()=>json({}),()=>json({error:'failure'}),()=>new Response('x'.repeat(65537)),()=>{throw Error('synthetic-key leak');}];
  for(const make of responses){let count=0;const result=await verifyConnectionReasoning(connection(),'',undefined,async()=>{count++;return make();});assert.equal(count,1);assert.equal(result.models[0]?.reasoningProbe?.status,'inconclusive');assert.deepEqual(result.models[0]?.reasoningProbe?.rejected,[]);assert.doesNotMatch(JSON.stringify(result),/synthetic-key/);}
});

test('a generic bad request is not evidence of parameter validation',async()=>{
  let count=0;const result=await verifyConnectionReasoning(connection(),'',undefined,async()=>{count++;return json({error:{message:'Invalid prompt'}},400);});
  assert.equal(count,1);assert.equal(result.models[0]?.reasoningProbe?.reason,'format');assert.equal(result.models[0]?.efforts,undefined);
});

test('auth and quota failures stop new probes across the connection',async()=>{
  for(const status of [401,403,429]){
    const c=connection();c.models=Array.from({length:30},(_,i)=>({...model,id:'m'+i}));let count=0;
    const result=await verifyConnectionReasoning(c,'',undefined,async()=>{count++;return json({},status);});assert.ok(count<=2);assert.ok(result.models.every(m=>m.reasoningProbe?.status==='inconclusive'));
  }
});

test('all explicitly rejected candidates produce unsupported and still allow service default',async()=>{
  const result=await verifyConnectionReasoning(connection(),'',undefined,strict([]).fetcher);
  assert.equal(result.models[0]?.reasoningProbe?.status,'unsupported');assert.equal(result.models[0]?.efforts,undefined);
});

test('explicit candidates retain diagnostics without preventing saving custom values',async()=>{
  const c=connection();c.models=[{...model,effortCandidates:['ultra','low']}];
  const f=strict(['ultra','low']),result=await verifyConnectionReasoning(c,'',undefined,f.fetcher);
  assert.deepEqual(result.models[0]?.efforts,['low','ultra']);assert.equal(f.calls.length,2);
  assert.deepEqual((await verifyConnectionReasoning(c,'',undefined,strict(['low']).fetcher)).models[0]?.reasoningProbe?.rejected,['ultra']);
  assert.deepEqual((await verifyConnectionReasoning(c,'',undefined,async()=>json(good()))).models[0]?.efforts,['low','ultra']);
  assert.equal((await verifyConnectionReasoning(c,'',undefined,async()=>json({},422))).models[0]?.reasoningProbe?.status,'inconclusive');
  for(const effort of ['minimal','none','extreme'])assert.deepEqual(validateConnection({...c,models:[{...model,effortCandidates:[effort]}]}).models[0]?.effortCandidates,[effort]);
  assert.equal(validateConnection({...c,models:[{...model,reasoningProbe:{status:'verified',accepted:['ultra']}}]}).models[0]?.reasoningProbe,undefined);
});

test('complete evidence is cached only for matching endpoint, protocol, key, upstream model and options',async()=>{
  const f=strict(reasoningEfforts),c=connection(),saved=await verifyConnectionReasoning(c,'key-a',undefined,f.fetcher);
  f.calls.length=0;await verifyConnectionReasoning({...c,name:'Renamed'},'key-a',saved,f.fetcher);assert.equal(f.calls.length,0);
  const variants=[{...c,baseUrl:'https://other.example/v1'},{...c,protocol:'chat-completions' as const},{...c,models:[{...model,model:'another'}]},{...c,models:[{...model,adaptiveThinking:true}]},{...c,models:[{...model,effortCandidates:['low']}]}];
  for(const variant of variants){f.calls.length=0;await verifyConnectionReasoning(variant,'key-a',saved,f.fetcher);assert.ok(f.calls.length>=1);}
  f.calls.length=0;await verifyConnectionReasoning(c,'key-b',saved,f.fetcher);assert.equal(f.calls.length,7);
});

test('partial scans retain proven levels but are rechecked on the next explicit save',async()=>{
  const c=connection(),f=strict();let count=0;
  const result=await verifyConnectionReasoning(c,'',undefined,async(...args)=>++count===3?json({},429):f.fetcher(...args));
  assert.deepEqual(result.models[0]?.efforts,['light']);assert.equal(result.models[0]?.reasoningProbe?.reason,'rate-limit');assert.match(reasoningStatus(result.models[0]!),/部分/);
  const next=strict();await verifyConnectionReasoning(c,'',result,next.fetcher);assert.equal(next.calls.length,7);
});

test('explicit recheck and expired cache detect changed upstream capabilities',async()=>{
  const c=connection(),saved=await verifyConnectionReasoning(c,'',undefined,strict(['low']).fetcher),f=strict(['light','ultra']);
  assert.deepEqual((await verifyConnectionReasoning(c,'',saved,f.fetcher,true)).models[0]?.efforts,['light','ultra']);assert.equal(f.calls.length,7);
  saved.models[0]!.reasoningProbe!.checkedAt='2000-01-01T00:00:00Z';f.calls.length=0;
  await verifyConnectionReasoning(c,'',saved,f.fetcher);assert.equal(f.calls.length,7);
});

test('directory refresh preserves host evidence but invalidates it when thinking mode changes',async()=>{
  const saved=await verifyConnectionReasoning(connection(),'',undefined,strict().fetcher);
  const refreshed=mergeDirectory(saved,[{...model,efforts:['invented'],metadataSource:'upstream'}]);
  assert.deepEqual(refreshed.models[0]?.efforts,['light','medium','xhigh']);assert.deepEqual(refreshed.models[0]?.reasoningProbe,saved.models[0]?.reasoningProbe);
  assert.equal(mergeDirectory(saved,[{...model,adaptiveThinking:true}]).models[0]?.reasoningProbe,undefined);
});

test('batch has a global request budget and at most two active probes; disabled models are skipped',async()=>{
  const c=connection();c.models=Array.from({length:40},(_,i)=>({...model,id:'m'+i,model:'m'+i}));c.models.push({...model,id:'disabled',enabled:false});
  const f=strict(reasoningEfforts);let active=0,peak=0;const result=await verifyConnectionReasoning(c,'',undefined,async(...args)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));try{return await f.fetcher(...args);}finally{active--;}});
  assert.ok(f.calls.length<=96);assert.equal(peak,2);assert.ok(result.models.some(m=>m.reasoningProbe?.reason==='budget'));assert.equal(result.models.at(-1)?.reasoningProbe,undefined);
});

test('host save keeps rejected detection diagnostics, custom choices and credentials across restart',async()=>{
  let posts=0;const requests:any[]=[];
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=body?JSON.parse(body):{};requests.push({url:req.url,body:data});res.setHeader('content-type','application/json');
    if(req.method==='GET'){res.end(JSON.stringify({data:[{id:model.model}]}));return;}posts++;
    if(!data.reasoning?.effort||['light','xhigh'].includes(data.reasoning.effort)){res.end(JSON.stringify(good()));return;}
    res.statusCode=400;res.end(JSON.stringify({error:{param:'reasoning.effort',message:'Unsupported effort. synthetic-private-server-message'}}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const dir=await mkdtemp(path.join(os.tmpdir(),'awb-reasoning-')),store=new StateStore(dir);await store.load();
  const secrets=new SecretStore(path.join(dir,'secrets'),{encrypt:s=>Buffer.from(s).reverse(),decrypt:b=>Buffer.from(b).reverse().toString()});
  const host=new ModelConnections({snapshot:()=>store.snapshot(),update:f=>store.update(f),busy:()=>false},secrets);
  try{
    const config={...connection(),baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`};
    let saved=await host.call('model-api/save',{connection:config,key:'synthetic-key-a',verifyReasoning:true,allowInference:true}) as ModelConnection;assert.equal(posts,7);assert.deepEqual(saved.models[0]?.efforts,['light','xhigh']);
    saved=await host.call('model-api/save',{id:saved.id,revision:saved.revision,connection:{...saved,models:[{...model,effortCandidates:['ultra']}]},key:'synthetic-key-b',verifyReasoning:true,allowInference:true}) as ModelConnection;
    assert.deepEqual(saved.models[0]?.reasoningProbe?.rejected,['ultra']);assert.equal(await host.key(saved),'synthetic-key-b');
    const before=posts;saved=await host.call('model-api/save',{id:saved.id,revision:saved.revision,connection:{...saved,models:[{...model,manualEfforts:['vendor-depth'],defaultEffort:'vendor-depth'}]}}) as ModelConnection;
    assert.equal(posts,before);assert.deepEqual(saved.models[0]?.manualEfforts,['vendor-depth']);
    const reopened=new StateStore(dir);await reopened.load();assert.deepEqual(reopened.snapshot().modelConnections?.[0]?.models[0]?.manualEfforts,['vendor-depth']);
    assert.doesNotMatch(JSON.stringify(reopened.snapshot()),/synthetic-key-|synthetic-private-server-message/);
    assert.ok(requests.every(r=>!JSON.stringify(r.body).includes('chat history')));
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
