import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiContextPlanning} from '../packages/model-api/context-planning';
import {ApiConversationClient} from '../packages/model-api/provider';
import {validateConnection} from '../packages/model-api/config';
import {publicContextJson} from '../packages/attachments/input';
import type {Protocol} from '../packages/contracts';

const model={id:'fixture',model:'fixture',name:'Fixture',enabled:true,contextWindow:1000,maxOutputTokens:100};
test('summary paging processes over sixteen requests with complete ordered Unicode source',async()=>{
 const planning=new ApiContextPlanning(),source='alpha 中文🙂 omega\n'.repeat(5000),parts:string[]=[];
 const result=await planning.summarize(source,model,new AbortController().signal,async input=>{const part=JSON.parse(input).conversation;assert.ok(!part.includes('\uFFFD'));parts.push(part);return 'Short summary';});
 assert.ok(parts.length>16);assert.equal(parts.join(''),source);assert.equal(result,'Short summary');
});
test('a large generated summary retains unsummarized data without rejection or repeated requests',async()=>{
 const planning=new ApiContextPlanning(),source='ordered-source\n'.repeat(10000),parts:string[]=[];
 const result=await planning.summarize(source,model,new AbortController().signal,async input=>{parts.push(JSON.parse(input).conversation);return 'Summary '.repeat(2000);});
 assert.equal(parts.length,1);assert.ok(result.endsWith(source.slice(parts[0]!.length)));
});
test('provider usage calibrates scheduling and media bytes never masquerade as observed tokens',async()=>{
 const planning=new ApiContextPlanning();assert.ok(planning.estimate('hello '.repeat(10000),model)<20000);
 assert.ok(publicContextJson({url:'data:image/png;base64,'+'x'.repeat(100000)},true).length<100);
 const c=validateConnection({name:'Fixture',baseUrl:'https://api.example/v1',protocol:'chat-completions',models:[model]});
 const client=new ApiConversationClient({connection:c,model,system:'',history:[{role:'user',content:'tiny'}],tools:[]},'',async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'reply'}}],usage:{prompt_tokens:750,completion_tokens:10}})));
 await client.next(new AbortController().signal,()=>{});assert.equal(client.estimatedInputTokens(),760);client.appendUser({role:'user',content:'follow-up'});assert.ok(client.estimatedInputTokens()>760);
});
for(const protocol of ['chat-completions','responses','anthropic-messages'] as Protocol[])test(protocol+' sends the latest input even when a scheduling estimate exceeds the real window',async()=>{
 const requests:any[]=[],latest='LATEST_ORIGINAL_🙂'.repeat(500),c=validateConnection({name:'Fixture',baseUrl:'https://api.example/v1',protocol,models:[model]});
 const reply=protocol==='chat-completions'?{choices:[{finish_reason:'stop',message:{role:'assistant',content:'summary'}}]}:protocol==='responses'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'summary'}]}]}:{stop_reason:'end_turn',content:[{type:'text',text:'summary'}]};
 const client=new ApiConversationClient({connection:c,model,system:'',history:[{role:'user',content:latest}],tools:[]},'',async(_url,init)=>{requests.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify(reply));});
 await client.compact(new AbortController().signal,900);assert.ok(client.estimatedInputTokens()>900);await client.next(new AbortController().signal,()=>{});assert.ok(JSON.stringify(requests.at(-1)).includes(latest));
});
