import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {apiEndpoints} from '../packages/model-api/endpoints';
import {validateConnection} from '../packages/model-api/config';
import {ApiConversationClient,discoverModels} from '../packages/model-api/provider';
import {Translator,listModels} from '../packages/translation/provider';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {openNativeGateway} from '../packages/model-api/native-gateway';
import type {Protocol,TranslationProfile} from '../packages/contracts';

const model={id:'fixture',name:'Fixture',model:'fixture',enabled:true};
const reply=(protocol:Protocol,text='Translation')=>protocol==='chat-completions'?{choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]}:protocol==='responses'?{status:'completed',output:[{type:'message',status:'completed',content:[{type:'output_text',text}]}]}:{stop_reason:'end_turn',content:[{type:'text',text}]};
test('approved endpoint resolvers route translation and direct API requests with query intact and restore on disable',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'api-endpoints-')),plugins=new PluginRegistry(directory);await plugins.initialize();plugins.services.register('models.endpoints',apiEndpoints,{version:1});
 const id='test.endpoints',manifest={schemaVersion:1,apiVersion:1,id,name:'Endpoint fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs'};
 const code=`export function activate(api){api.onDispose(api.services.get('models.endpoints').register({id:'plugin:'+api.id+'/routes',resolve:request=>{const url=new URL(request.baseUrl);url.pathname='/registered/'+request.resource;url.hash='';return url.href;}}));}`;
 try{
  const file=path.join(directory,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(code)}]));await plugins.importZip(file);const hash=(await plugins.list())[0]!.hash;await plugins.setEnabled(id,hash,true,true);
  for(const enabled of [true,false,true])for(const protocol of ['chat-completions','responses','anthropic-messages'] as Protocol[]){
   await plugins.setEnabled(id,hash,enabled);const urls:URL[]=[],baseUrl='http://model-gateway.example/custom?api-version=2026&mode=one%2Ftwo#saved-note';
   const connection=validateConnection({name:'Fixture',baseUrl,protocol,models:[model]}),profile:TranslationProfile={id:'translation',name:'Translation',baseUrl,protocol,model:'fixture',verifiedEfforts:[],consent:true,maxCharacters:0,maxCalls:0,timeoutMs:10000};
   const fetcher:typeof fetch=async(url,init)=>{urls.push(new URL(String(url)));return Response.json(init?.method==='GET'?{data:[{id:'fixture'}]}:reply(protocol));};
   await discoverModels(connection,'',fetcher);await listModels(profile,'synthetic',fetcher);await new Translator(fetcher).translate('文本','input',profile,'synthetic');await new ApiConversationClient({connection,model,system:'',history:[{role:'user',content:'Test'}],tools:[]},'',fetcher).next(new AbortController().signal,()=>{});
   assert.equal(urls.length,4);for(const url of urls){assert.equal(url.protocol,'http:');assert.equal(url.searchParams.get('api-version'),'2026');assert.equal(url.searchParams.get('mode'),'one/two');assert.equal(url.hash,'');assert.ok(url.pathname.startsWith(enabled?'/registered/':'/custom/'));}
  }
 }finally{await plugins.dispose();await rm(directory,{recursive:true,force:true});}
});
for(const runtime of ['codex','claude'] as const)test(runtime+' native gateway appends resource before query and omits fragment',async()=>{
 const connection=validateConnection({name:'Fixture',baseUrl:'http://lan-model.example/prefix?version=fixture#note',protocol:'chat-completions',models:[model]});let forwarded='';
 const gateway=await openNativeGateway({runtime,model,credentials:async()=>({connection,key:''}),fetcher:async(url)=>{forwarded=String(url);return Response.json(reply('chat-completions'));}});
 try{const body=runtime==='codex'?{input:'Test'}:{messages:[{role:'user',content:'Test'}]};const response=await fetch(gateway.baseUrl+(runtime==='codex'?'/v1/responses':'/v1/messages'),{method:'POST',headers:{authorization:'Bearer '+gateway.token},body:JSON.stringify(body)});assert.equal(response.status,200);await response.text();assert.equal(forwarded,'http://lan-model.example/prefix/chat/completions?version=fixture');}finally{await gateway.close();}
});
