import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initialState, StateStore, SecretStore} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {modelUsageSummary, estimateUsd} from '../packages/model-management/usage';
import {referencePrice} from '../packages/model-management/prices';
import type {ModelPrice, ModelUsageEntry, ModelUsageSummary, UsageScope} from '../packages/model-management/types';
import {parseTokenCounts, type TokenCounts} from '../packages/session-metrics';
import {UsageWireTap} from '../packages/session-metrics/wire';
import {nativeWireEvents, nativeWireStream} from '../packages/model-api/native-wire';
import {openNativeGateway} from '../packages/model-api/native-gateway';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {recordTranslationUsage} from '../packages/translation/usage';

const scope:UsageScope={kind:'api',id:'cost-fixture'},model='gpt-6-astra';
const counts:TokenCounts={inputTokens:1000,outputTokens:200,cacheReadTokens:800,cacheWriteTokens:0,totalTokens:1200};
const unknown:TokenCounts={inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,totalTokens:null};
const now=Date.now(),at=new Date(now).toISOString();
const row=(id:string,values:Partial<ModelUsageEntry>={}):ModelUsageEntry=>({key:id,id,scope,model,runtime:'codex',source:'fixture',turnId:'turn',steps:1,recordedAt:at,updatedAt:at,...counts,...values});
function summary(rows:ModelUsageEntry[],price?:ModelPrice,target=scope){
  const state=initialState();state.modelUsage=rows.map(r=>({...r,scope:target}));
  if(target.kind==='translation')for(const r of rows)state.translationUsage=recordTranslationUsage(state.translationUsage,{...r,sourceId:r.source,at:r.updatedAt,operation:'translation',direction:'input',status:'complete',elapsedMs:100,reasoningTokens:null});
  if(price)state.modelPrices=[{scope:target,model,price,revision:'r',updatedAt:at}];
  return modelUsageSummary(state,target,'7day',now);
}

for(const kind of ['api','account','translation'] as const)test(`${kind} prices known usage despite an unreported cache-write counter`,()=>{
  const value=summary([row('partial',{cacheWriteTokens:null})],undefined,{kind,id:kind==='translation'?'translation':'fixture'});
  assert.equal(value.estimatedUsd,null);assert.equal(value.groups[0]!.estimatedUsd,null);
  assert.equal(value.lowerBoundUsd,.0128);assert.equal(value.groups[0]!.lowerBoundUsd,.0128);
  assert.equal(value.groups[0]!.cacheWriteTokens,null);assert.ok(value.incomplete.includes('cacheWriteTokens'));
  assert.equal(value.groups[0]!.priceSource,'reference');
});

test('mixed receipts retain complete requests and priced parts without crossing cache partitions',()=>{
  const value=summary([row('complete'),row('missing-write',{cacheWriteTokens:null}),row('output-only',{...unknown,outputTokens:100}),row('no-receipt',unknown),row('no-price',{model:'unknown-priced-model'})]);
  assert.equal(value.estimatedUsd,null);assert.ok(Math.abs(value.lowerBoundUsd!-.0306)<1e-12);
  assert.ok(Math.abs(value.groups.find(g=>g.model===model)!.lowerBoundUsd!-.0306)<1e-12);
  assert.equal(value.groups.find(g=>g.model==='unknown-priced-model')!.lowerBoundUsd,null);
  assert.equal(value.pricedUsd,0,'Legacy complete-group subtotal retains its meaning');
});

test('missing cheaper cache categories use the minimum feasible rate, not the full input rate',()=>{
  const price={input:10,output:50,cacheRead:1,cacheWrite:2};
  assert.equal(summary([row('no-read',{cacheReadTokens:null})],price).lowerBoundUsd,.011);
  assert.equal(summary([row('no-write',{cacheWriteTokens:null})],price).lowerBoundUsd,.0112);
  assert.equal(summary([row('neither',{cacheReadTokens:null,cacheWriteTokens:null})],price).lowerBoundUsd,.011);
  // Every admissible complete allocation must cost at least the displayed bound.
  const bound=summary([row('neither',{cacheReadTokens:null,cacheWriteTokens:null})],price).lowerBoundUsd!;
  for(let read=0;read<=1000;read+=100)for(let write=0;write<=1000-read;write+=100)
    assert.ok(estimateUsd({...counts,cacheReadTokens:read,cacheWriteTokens:write},price)!>=bound);
});

test('missing totals still price reported cache and output, while no evidence or price stays unknown',()=>{
  assert.equal(summary([row('subsets',{...unknown,cacheReadTokens:800,cacheWriteTokens:20,outputTokens:200})]).lowerBoundUsd,.01105);
  assert.equal(summary([row('unknown',unknown)]).lowerBoundUsd,null);
  assert.equal(summary([row('no-price',{model:'vendor-alias'})]).lowerBoundUsd,null);
  assert.equal(summary([]).estimatedUsd,0);
  const free=summary([row('partial',{cacheWriteTokens:null})],{input:0,output:0});
  assert.equal(free.estimatedUsd,0);assert.equal(free.lowerBoundUsd,0);
  const complete=summary([row('complete')]);assert.equal(complete.estimatedUsd,.0128);assert.equal(complete.lowerBoundUsd,.0128);
  assert.equal(summary([row('partial',{cacheReadTokens:null,cacheWriteTokens:null})],{input:10,output:50}).estimatedUsd,.02);
});

test('a configured unused model cannot turn wholly unpriced usage into an apparent zero estimate',()=>{
  const state=initialState();state.modelUsage=[row('unpriced',{model:'vendor-alias'})];
  state.localModelAccounts=[{id:'account',revision:'r',name:'Fixture',provider:'codex',enabled:true,status:'unknown',models:[{id:model,model,name:model,isDefault:true,efforts:[],serviceTiers:[]}]}];
  state.modelUsage[0]!.scope={kind:'account',id:'account'};
  const value=modelUsageSummary(state,{kind:'account',id:'account'},'7day',now);
  assert.equal(value.estimatedUsd,null);assert.equal(value.lowerBoundUsd,null);
  assert.equal(value.groups.find(g=>g.model===model)!.estimatedUsd,0);
});

for(const protocol of ['responses','chat-completions'] as const)test(`${protocol} parses actual cache-write details without synthesizing absent counters`,()=>{
  const details=protocol==='responses'?'input_tokens_details':'prompt_tokens_details';
  const raw={input_tokens:1000,output_tokens:200,[details]:{cached_tokens:800,cache_write_tokens:20}};
  assert.deepEqual(parseTokenCounts(raw,protocol),{...counts,cacheWriteTokens:20});
  assert.equal(parseTokenCounts({...raw,[details]:{cached_tokens:800,cache_write_tokens:0}},protocol).cacheWriteTokens,0);
  assert.equal(parseTokenCounts({...raw,[details]:{cached_tokens:800}},protocol).cacheWriteTokens,null);
  assert.equal(parseTokenCounts({...raw,[details]:{cached_tokens:800,cache_write_tokens:-1}},protocol).cacheWriteTokens,null);
  assert.equal(parseTokenCounts({...raw,[details]:{cached_tokens:800,cache_write_tokens:500}},protocol).cacheWriteTokens,null);
  const tap=new UsageWireTap(protocol,true),event=protocol==='responses'?{type:'response.completed',response:{usage:raw}}:{usage:raw};
  tap.feed(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));
  assert.equal(tap.finish().counts.cacheWriteTokens,20);
});

test('both Responses conversion paths retain cache writes, including write-only and explicit zero receipts',()=>{
  const turn={text:'ok',calls:[],usage:{inputTokens:1000,outputTokens:200},raw:{}};
  for(const cacheWriteTokens of [0,20,null])for(const cacheReadTokens of [800,null]){
    const sample={...counts,cacheReadTokens,cacheWriteTokens};
    for(const events of [nativeWireEvents(turn,'responses',{},sample),nativeWireStream('responses',{}).finish(turn,sample)]){
      const wire=events.find(e=>e.type==='response.completed')!.response.usage;
      assert.deepEqual(parseTokenCounts(wire,'responses'),sample);
    }
  }
});

test('actual gateway returns cache-write usage and meters it once before conversion',async()=>{
  let calls=0;const receipts:any[]=[];
  const gateway=await openNativeGateway({runtime:'codex',model:{id:'m',model,enabled:true,name:model},credentials:async()=>({key:'',connection:{protocol:'chat-completions',auth:'none',baseUrl:'https://fixture.invalid',timeoutMs:2000} as any}),usage:r=>{receipts.push(r);},fetcher:async()=>{
    calls++;return new Response(JSON.stringify({id:'r',choices:[{finish_reason:'stop',message:{role:'assistant',content:'ok'}}],usage:{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:800,cache_write_tokens:20}}}),{headers:{'content-type':'application/json'}});
  }});
  try{
    const response=await fetch(gateway.baseUrl+'/v1/responses',{method:'POST',headers:{authorization:'Bearer '+gateway.token,'content-type':'application/json'},body:JSON.stringify({model,input:[],stream:true})});
    assert.equal(response.status,200);const tap=new UsageWireTap('responses',true);tap.feed(new Uint8Array(await response.arrayBuffer()));
    assert.deepEqual(tap.finish().counts,{...counts,cacheWriteTokens:20});assert.equal(calls,1);assert.equal(receipts.length,1);assert.equal(receipts[0].counts.cacheWriteTokens,20);
  }finally{await gateway.close();}
});

test('approved pricing plugin reaches the production summary, composes, and releases without erasing saved rates',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-cost-plugin-')),store=new StateStore(directory);await store.load();
  const accountScope:UsageScope={kind:'account',id:'11111111-1111-4111-a111-111111111111'};
  await store.update(s=>{s.modelUsage=[row('partial',{scope:accountScope,cacheWriteTokens:null})];s.localModelAccounts=[{id:accountScope.id,name:'Fixture',revision:'r',provider:'codex',enabled:true,status:'unknown',models:[]}];});
  const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();
  const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No credentials');},decrypt:()=>{throw Error('No credentials');}}),{pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},state=>plugins.publish({type:'state',payload:state}));
  plugins.services.register('models.accounts',controller.developmentServices()['models.accounts']!,{version:1});plugins.connectHost(r=>controller.call(r.method,r.payload));
  const get=()=>controller.call('models/usage',{scope:accountScope,period:'7day'}) as Promise<ModelUsageSummary>;
  async function install(id:string,main:string){const zip=path.join(directory,id+'.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify({schemaVersion:1,apiVersion:1,id,name:id,version:'1.0.0',description:'Isolated cost fixture',capabilities:['host'],main:'main.mjs'}))},{name:'main.mjs',data:Buffer.from(main)}]));await plugins.importZip(zip);return (await plugins.list()).find(p=>p.manifest.id===id)!;}
  try{
    const source=`export function activate(api){
      api.registerCommand('usage',p=>api.call('models/usage',p));
      api.registerCommand('price',p=>api.call('models/pricing/save',p));
      api.services.intercept('models.accounts','call',async(next,method,p)=>{
        const result=await next(method,p);
        return method==='models/usage'?{...result,lowerBoundUsd:result.lowerBoundUsd*2}:result;
      });
    }`;
    const plugin=await install('test.cost',source);
    await assert.rejects(plugins.setEnabled(plugin.manifest.id,plugin.hash,true),/Explicit approval/);
    await plugins.setEnabled(plugin.manifest.id,plugin.hash,true,true);
    assert.equal((await get()).lowerBoundUsd,.0256);assert.equal((await get()).estimatedUsd,null);
    assert.equal((await plugins.command('test.cost','usage',{scope:accountScope,period:'7day'}) as ModelUsageSummary).lowerBoundUsd,.0256);
    const observer=await install('test.cost-observer',`export function activate(api){api.services.intercept('models.accounts','call',(next,...args)=>next(...args));}`);
    await plugins.setEnabled(observer.manifest.id,observer.hash,true,true);assert.equal((await get()).lowerBoundUsd,.0256);
    const broken=await install('test.cost-broken',source.replace("api.registerCommand('usage',p=>api.call('models/usage',p));","api.registerCommand('usage',p=>api.call('models/usage',p));api.onDispose(()=>{});").replace(/\n    }$/,`throw Error('Synthetic activation failure');\n    }`));
    await plugins.setEnabled(broken.manifest.id,broken.hash,true,true);assert.equal((await plugins.list()).find(p=>p.manifest.id===broken.manifest.id)!.enabled,false);assert.equal((await get()).lowerBoundUsd,.0256);
    const saved=await plugins.command('test.cost','price',{scope:accountScope,model,price:{input:20,output:50,cacheRead:1,cacheWrite:25}}) as any;
    await assert.rejects(plugins.command('test.cost','price',{scope:accountScope,model,price:referencePrice(model)}),/MODEL_PRICE_CHANGED/);
    assert.equal((await get()).lowerBoundUsd,.0296);
    await plugins.setEnabled(plugin.manifest.id,plugin.hash,false);assert.equal((await get()).lowerBoundUsd,.0148);
    assert.equal(store.snapshot().modelPrices![0]!.revision,saved.revision);
    await plugins.setEnabled(plugin.manifest.id,plugin.hash,true);assert.equal((await get()).lowerBoundUsd,.0296);
    await rm(plugin.directory,{recursive:true,force:true});await plugins.refresh();assert.equal((await get()).lowerBoundUsd,.0148);
    const restored=new StateStore(directory);await restored.load();assert.equal(modelUsageSummary(restored.snapshot(),accountScope,'7day').lowerBoundUsd,.0148);
  }finally{await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
