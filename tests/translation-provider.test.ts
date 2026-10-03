import test from 'node:test';
import assert from 'node:assert/strict';
import type { Protocol, TranslationProfile } from '../packages/contracts/index';
import { endpoint, listModels, protocolCandidates, Translator, type Fetcher } from '../packages/translation/provider';
import { normalizeBaseUrl, reasoningOptions, validateReasoning, validateTranslationProfile } from '../packages/translation/config';

const base:TranslationProfile={id:'provider-test',name:'Synthetic gateway',baseUrl:'https://translate.example/custom/v1',protocol:'chat-completions',model:'actual-model-id',verifiedEfforts:[],consent:true,maxCharacters:10000,maxCalls:20,timeoutMs:10000};
function completed(protocol:Protocol,text='Translation'):Response {
  return Response.json(protocol==='responses'?{status:'completed',output:[{type:'message',status:'completed',content:[{type:'output_text',text}]}]}:protocol==='anthropic-messages'?{stop_reason:'end_turn',content:[{type:'text',text}]}:{choices:[{finish_reason:'stop',message:{content:text}}]});
}

test('API base and pasted resource URLs preserve custom prefixes without duplication',()=>{
  for(const resource of ['responses','chat/completions','messages','models']){
    assert.equal(normalizeBaseUrl(`https://gateway.example/team/anthropic/v1/${resource}/`),'https://gateway.example/team/anthropic/v1');
    assert.equal(endpoint(`https://gateway.example/team/anthropic/v1/${resource}/`,'models').href,'https://gateway.example/team/anthropic/v1/models');
  }
  assert.equal(endpoint('https://gateway.example','responses').href,'https://gateway.example/responses');
  assert.equal(endpoint(' https://api.openai.com/ ','responses').href,'https://api.openai.com/v1/responses');
  assert.equal(endpoint('https://api.anthropic.com/messages','models').href,'https://api.anthropic.com/v1/models');
  assert.equal(protocolCandidates('https://api.anthropic.com/v1/messages')[0]?.protocol,'anthropic-messages');
  assert.equal(protocolCandidates('https://not-api.anthropic.com/v1').length,3);
});

test('HTTP and user-selected network addresses reach endpoint construction',()=>{
  for(const host of ['localhost','127.0.0.1','[::1]'])assert.equal(endpoint(`http://${host}:8000/v1/chat/completions`,'models').href,`http://${host}:8000/v1/models`);
  for(const value of ['http://127.1/v1','http://2130706433/v1','http://0x7f000001/v1','http://127.0.0.2/v1','http://localhost.example/v1','http://localhost./v1','http://[::ffff:127.0.0.1]/v1','http://10.0.0.1/v1','https://169.254.169.254/v1','https://0.0.0.0/v1','https://[::]/v1'])assert.doesNotThrow(()=>normalizeBaseUrl(value));
  assert.equal(normalizeBaseUrl('https://127.0.0.1:8443/v1'),'https://127.0.0.1:8443/v1');
});

test('URL and header validation does not expose credential text',async()=>{
  const secret='SYNTHETIC-credential-12345';
  for(const value of [`https://user:${secret}@gateway.example/v1`,'file:///tmp/api','not a url']){
    assert.throws(()=>normalizeBaseUrl(value),error=>error instanceof Error&&!error.message.includes(secret));
  }
  assert.equal(endpoint('http://remote.example/custom/responses?api-version=2026-10#section','models').href,'http://remote.example/custom/models?api-version=2026-10');
  let calls=0;const translator=new Translator(async()=>{calls++;return completed(base.protocol);});
  for(const key of ['',`${secret}\ninvalid`,'key with space'])await assert.rejects(translator.translate('文本','input',base,key));
  assert.equal(calls,0);
  assert.equal(endpoint(base.baseUrl,'extensions/catalog').pathname,'/custom/v1/extensions/catalog');
});

test('reasoning options describe protocol candidates and preserve default omission',()=>{
  assert.ok(reasoningOptions('responses').includes('minimal'));
  assert.ok(reasoningOptions('responses').includes('max'));
  assert.ok(reasoningOptions('anthropic-messages').includes('xhigh'));
  assert.ok(!reasoningOptions('anthropic-messages').includes('minimal'));
  assert.equal(validateReasoning(base),undefined);
  assert.equal(validateReasoning({...base,reasoning:{mode:'default'}}),undefined);
});

test('reasoning configuration needs model-specific confirmation and valid protocol fields',()=>{
  for(const patch of [
    {reasoning:{mode:'effort',effort:'high'}},
    {model:'',reasoning:{mode:'effort',effort:'high',confirmed:true}},
    {reasoning:{mode:'effort',effort:'unverified-custom-value',confirmed:true}},
    {protocol:'anthropic-messages',reasoning:{mode:'effort',effort:'high',confirmed:true}},
    {reasoning:{mode:'adaptive',effort:'high',confirmed:true}},
    {reasoning:{mode:'budget',budgetTokens:2048,confirmed:true}},
    {protocol:'anthropic-messages',reasoning:{mode:'budget',budgetTokens:1000,confirmed:true}},
    {protocol:'anthropic-messages',maxOutputTokens:4096,reasoning:{mode:'budget',budgetTokens:4096,confirmed:true}},
    {protocol:'anthropic-messages',reasoning:{mode:'adaptive',effort:'minimal',confirmed:true}},
    {protocol:'anthropic-messages',reasoning:{mode:'adaptive',budgetTokens:2048,confirmed:true}},
    {reasoning:{mode:'default'},effort:'high',verifiedEfforts:['high']},
    {effort:'high'},
  ])assert.throws(()=>validateReasoning({...base,...patch} as TranslationProfile));
  assert.deepEqual(validateReasoning({...base,effort:'high',verifiedEfforts:['high']}),{mode:'effort',effort:'high',confirmed:true});
});

for(const protocol of ['chat-completions','responses','anthropic-messages'] as const)test(`default ${protocol} sends no reasoning parameters`,async()=>{
  const translator=new Translator(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    for(const name of ['reasoning','reasoning_effort','thinking','output_config'])assert.equal(body[name],undefined);
    assert.equal(body.max_output_tokens??body.max_completion_tokens??body.max_tokens,8192);
    return completed(protocol);
  });
  const result=await translator.translate('测试','input',{...base,protocol},'fixture-key');
  assert.equal(result.requestedEffort,null);assert.equal(result.effectiveEffort,null);
});

for(const protocol of ['chat-completions','responses'] as const)test(`confirmed ${protocol} reasoning maps only to its protocol field`,async()=>{
  const translator=new Translator(async(url,init)=>{
    assert.equal(String(url),`${base.baseUrl}/${protocol==='responses'?'responses':'chat/completions'}`);
    const body=JSON.parse(String(init?.body));
    assert.equal(protocol==='responses'?body.reasoning.effort:body.reasoning_effort,'high');
    assert.equal(body.max_output_tokens??body.max_completion_tokens,12288);
    assert.equal(protocol==='responses'?body.reasoning_effort:body.reasoning,undefined);
    return completed(protocol);
  });
  const result=await translator.translate('测试','input',{...base,protocol,maxOutputTokens:12288,reasoning:{mode:'effort',effort:'high',confirmed:true}},'fixture-key');
  assert.equal(result.requestedEffort,'high');assert.equal(result.effectiveEffort,null);
});

test('Anthropic adaptive effort and fixed thinking budget have separate wire contracts',async()=>{
  const bodies:Record<string,any>[]=[];
  const translator=new Translator(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return completed('anthropic-messages');});
  await translator.translate('测试','input',{...base,protocol:'anthropic-messages',reasoning:{mode:'adaptive',effort:'medium',confirmed:true}},'fixture-key');
  const budget=await translator.translate('测试','input',{...base,protocol:'anthropic-messages',maxOutputTokens:8192,reasoning:{mode:'budget',budgetTokens:2048,confirmed:true}},'fixture-key');
  await translator.translate('测试','input',{...base,protocol:'anthropic-messages',reasoning:{mode:'adaptive',confirmed:true}},'fixture-key');
  assert.deepEqual(bodies[0]?.thinking,{type:'adaptive'});assert.deepEqual(bodies[0]?.output_config,{effort:'medium'});
  assert.deepEqual(bodies[1]?.thinking,{type:'enabled',budget_tokens:2048});assert.equal(bodies[1]?.output_config,undefined);
  assert.equal(bodies[2]?.output_config,undefined);assert.equal(budget.requestedEffort,'budget:2048');assert.equal(budget.effectiveEffort,null);
});

test('invalid configuration fails before fetch and valid model-less setup can be saved',async()=>{
  assert.equal(validateTranslationProfile({...base,model:''}).model,'');
  let calls=0;const translator=new Translator(async()=>{calls++;return completed(base.protocol);});
  for(const patch of [{model:' bad '},{model:'a\nb'},{maxOutputTokens:255},{maxOutputTokens:128001},{timeoutMs:Infinity},{maxCalls:NaN},{protocol:'invalid'},{maxCharacters:1.5}])await assert.rejects(translator.translate('测试','input',{...base,...patch} as TranslationProfile,'fixture'));
  assert.equal(calls,0);
});

test('Anthropic model catalog follows only returned cursors with supplied fetcher',async()=>{
  const urls:string[]=[];
  const models=await listModels({...base,model:'',protocol:'anthropic-messages',baseUrl:`${base.baseUrl}/messages`},'fixture-key',async(url,init)=>{
    urls.push(String(url));assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal((init?.headers as Record<string,string>)['x-api-key'],'fixture-key');
    return Response.json(urls.length===1?{data:[{id:'first'},{id:''},{id:' white '},{id:'a'.repeat(256)},{id:24},{name:'fabricated'},{id:'first'},{id:'next/with:punctuation'}],has_more:true,last_id:'next/with:punctuation'}:{data:[{id:'last'},{id:'first'}],has_more:false,last_id:'last'});
  });
  assert.deepEqual(models,['first','next/with:punctuation','last']);assert.equal(urls.length,2);
  assert.equal(new URL(urls[1]!).searchParams.get('after_id'),'next/with:punctuation');
  assert.ok(urls.every(url=>new URL(url).pathname==='/custom/v1/models'));
});

test('catalog caps actual model IDs and rejects malformed or repeated pagination',async()=>{
  const many=await listModels(base,'fixture',async()=>Response.json({data:Array.from({length:2100},(_,i)=>({id:`model-${i}`}))}));assert.equal(many.length,2000);
  let pages=0;await assert.rejects(listModels({...base,protocol:'anthropic-messages'},'fixture',async()=>{pages++;return Response.json({data:[{id:'same'}],has_more:true,last_id:'same'});}),/游标/);assert.equal(pages,2);
  await assert.rejects(listModels({...base,protocol:'anthropic-messages'},'fixture',async()=>Response.json({data:[],has_more:true,last_id:'not-returned'})),/游标/);
  await assert.rejects(listModels(base,'fixture',async()=>Response.json({models:[{id:'not-a-standard-envelope'}]})),/目录格式/);
});

test('explicit catalog discovery needs no text consent and cannot authorize translation',async()=>{
  let sent=0;
  const fetcher:Fetcher=async(url,init)=>{
    sent++;assert.equal(String(url),'https://translate.example/custom/v1/models');
    assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);
    return Response.json({data:[{id:'catalog-model'}]});
  };
  const profile={...base,consent:false};
  assert.deepEqual(await listModels(profile,'fixture',fetcher),['catalog-model']);
  await assert.rejects(new Translator(fetcher).translate('私有正文','input',profile,'fixture'),/外发/);
  assert.equal(sent,1);assert.equal(profile.consent,false);
});

test('fetch and stream failures are sanitized and never retried',async()=>{
  const secret='SYNTHETIC-KEY-REFLECTED-BY-FETCH';let attempts=0;
  const translator=new Translator(async()=>{attempts++;throw new Error(`fetch failed at URL with ${secret}`);});
  await assert.rejects(translator.translate('文本','input',base,secret),error=>error instanceof Error&&!error.message.includes(secret)&&error.message.includes('网络'));
  assert.equal(attempts,1);
  const streamTranslator=new Translator(async()=>new Response(new ReadableStream({start(controller){controller.error(new Error(secret));}})));
  await assert.rejects(streamTranslator.translate('文本','input',base,secret),error=>error instanceof Error&&!error.message.includes(secret)&&error.message.includes('读取'));
});

test('readable non-final and tool-bearing responses preserve partial text without executing tools',async()=>{
 const fixtures:[Protocol,unknown][]=[
 ['responses',{output_text:'Partial'}],
 ['responses',{status:'completed',output_text:'Partial',output:[{type:'function_call',name:'tool'}]}],
 ['anthropic-messages',{stop_reason:'tool_use',content:[{type:'tool_use',name:'tool'},{type:'text',text:'Partial'}]}],
 ['chat-completions',{choices:[{finish_reason:'length',message:{content:'Partial',function_call:{name:'tool'}}}]}]];
 for(const [protocol,data] of fixtures){let calls=0;const translator=new Translator(async()=>{calls++;return Response.json(data);});const result=await translator.translate('文本','input',{...base,protocol},'fixture');assert.equal(result.text,'Partial');assert.equal(result.incomplete,true);assert.equal(calls,1);}
});
test('empty, malformed and refusal-only responses still have no translation',async()=>{
 const fixtures:[Protocol,unknown][]=[
 ['responses',{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}],
 ['responses',{status:'completed',output:'malformed'}],['responses',{status:'completed',output_text:'  '}],
 ['anthropic-messages',{stop_reason:'end_turn',content:[{type:'thinking',thinking:'Private'}]}],
 ['chat-completions',{choices:[{finish_reason:'stop',message:{content:''}}]}],['chat-completions',null]];
 for(const [protocol,data] of fixtures){const translator=new Translator(async()=>Response.json(data));await assert.rejects(translator.translate('文本','input',{...base,protocol},'fixture'));}
});

test('thinking content stays separate and is never returned as translated text',async()=>{
  const translator=new Translator(async()=>Response.json({stop_reason:'end_turn',content:[{type:'thinking',thinking:'Not a translation'},{type:'redacted_thinking',data:'opaque'},{type:'text',text:'Translation'}]}));
  const result=await translator.translate('文本','input',{...base,protocol:'anthropic-messages'},'fixture');assert.equal(result.text,'Translation');
});

test('cancelled admissions send nothing and a late completed result is discarded',async()=>{
  const controller=new AbortController();controller.abort(new Error('SENSITIVE-ABORT-REASON'));let calls=0;
  const fetcher:Fetcher=async()=>{calls++;return completed(base.protocol);};
  const translator=new Translator(fetcher);
  await assert.rejects(translator.translate('文本','input',base,'fixture',controller.signal),error=>error instanceof Error&&error.message==='翻译请求已取消。');
  await assert.rejects(listModels(base,'fixture',fetcher,controller.signal));assert.equal(calls,0);assert.equal(translator.usage(base.id).calls,0);
  const late=new AbortController();const lateTranslator=new Translator(async()=>{late.abort();return completed(base.protocol);});
  await assert.rejects(lateTranslator.translate('文本','input',base,'fixture',late.signal),/取消/);
});
