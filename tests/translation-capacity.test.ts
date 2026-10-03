import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StateStore,SecretStore,initialState} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {Translator,listModels} from '../packages/translation/provider';
import {TranslationModule} from '../packages/translation/module';
import {TranslationQueue} from '../packages/translation/queue';
import {translationDeadline} from '../packages/translation/deadline';
import {translationProfile} from '../apps/desktop/host/validation';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
const profile={...initialState().translation,consent:true,model:'fixture',protocol:'responses' as const,maxCharacters:0,maxCalls:0,timeoutMs:0};
const response=(text:string)=>Response.json({status:'completed',output_text:text});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('translation reads more than 2 MB and preserves more than 512 associated segments',async()=>{
 const text='文'.repeat(800000),t=new Translator(async()=>response(text));assert.equal((await t.translate('Source','output',profile,'fixture')).text,text);
 const fields=Object.fromEntries(Array.from({length:600},(_,i)=>['field'+i,'Paragraph '+i]));const segments=new Translator(async(_url,init)=>response(JSON.parse(String(init!.body)).input));assert.deepEqual(JSON.parse((await segments.translate(JSON.stringify(fields),'output',profile,'fixture',undefined,'segments')).text),fields);
});
test('catalog follows more than ten pages and returns all models',async()=>{let page=0;const values=await listModels({...profile,protocol:'anthropic-messages'},'fixture',async()=>{page++;return Response.json({data:Array.from({length:200},(_,i)=>({id:'model-'+page+'-'+i})),has_more:page<12,last_id:'model-'+page+'-199'});});assert.equal(page,12);assert.equal(values.length,2400);});
test('over 64 pending requests remain queued; input priority, cancellation and deduplication remain',async()=>{
 const queue=new TranslationQueue(1);let release!:()=>void;const first=queue.enqueue('busy','progress',()=>new Promise<void>(yes=>release=yes));await tick();const order:number[]=[],abort=new AbortController();const work=Array.from({length:80},(_,i)=>queue.enqueue('p'+i,i===79?'input':'progress',async()=>{order.push(i);return i;},i===20?abort.signal:undefined));const cancelled=assert.rejects(work[20]!);abort.abort();assert.equal(queue.enqueue('p79','input',async()=>-1),work[79]);release();await first;await Promise.all(work.filter((_,i)=>i!==20));await cancelled;assert.equal(order.length,79);assert.equal(order[0],79);assert.ok(!order.includes(20));
});
test('saved limits accept large explicit budgets and long deadlines do not wrap into immediate timeout',async()=>{
 const saved=translationProfile({...profile,baseUrl:'http://models.example/v1?key='+ 'a'.repeat(2100),maxCharacters:20000000,maxCalls:2000000,timeoutMs:3000000000,maxOutputTokens:200000});assert.equal(saved.timeoutMs,3000000000);assert.equal(saved.maxOutputTokens,200000);
 const deadline=translationDeadline(saved.timeoutMs);try{await new Promise(r=>setTimeout(r,15));assert.equal(deadline.signal.aborted,false);}finally{deadline.dispose();}
 const abort=new AbortController(),scope=translationDeadline(saved.timeoutMs,abort.signal);abort.abort();assert.equal(scope.signal.aborted,true);scope.dispose();
});
test('approved scheduling registration and replacement reach real production translation and restore on disable',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-translation-capacity-')),store=new StateStore(dir);await store.load();let active=0,maximum=0;let release!:()=>void,barrier:Promise<void>,admitted!:()=>void,target=0;
 const controller=new WorkbenchController(store,new SecretStore(dir,{encrypt:v=>Buffer.from(v),decrypt:v=>v.toString()}),{translationFetcher:async()=>{active++;maximum=Math.max(maximum,active);if(active===target)admitted();await barrier;active--;return response('Result');},pickDirectory:async()=>null,copy:()=>{},openPath:async()=>{},nativeCapabilities:()=>[]},()=>{});
 const plugins=new PluginRegistry(path.join(dir,'plugins'));await plugins.initialize();const services=controller.developmentServices();for(const [id,service]of Object.entries(services))if(service)plugins.services.register(id,service,{version:1});const module=services.translation as TranslationModule;
 const id='qa.translation-schedule',manifest={schemaVersion:1,apiVersion:1,id,name:'Schedule fixture',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs'},code=`export function activate(api){const queue=api.services.get('translation.scheduling');api.onDispose(queue.register({id:'plugin:'+api.id+'/concurrency',concurrency:4}));let calls=0;api.services.intercept('translation.scheduling','enqueue',(next,...args)=>{calls++;return next(...args);});api.registerCommand('count',()=>calls);}`;
 try{
 await controller.call('translation/settings',{profile,key:'synthetic'});const file=path.join(dir,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(code)}]));await plugins.importZip(file);const hash=(await plugins.list())[0]!.hash;await plugins.setEnabled(id,hash,true,true);
 for(const enabled of [true,false,true]){await plugins.setEnabled(id,hash,enabled);active=0;maximum=0;target=enabled?4:2;const started=new Promise<void>(yes=>admitted=yes);barrier=new Promise(yes=>release=yes);const jobs=Array.from({length:80},(_,i)=>module.translate('Source','input',String(i),'input'));await started;assert.equal(maximum,enabled?4:2);release();await Promise.all(jobs);if(enabled)assert.equal(await plugins.command(id,'count',{}),80);}
 }finally{release?.();await plugins.dispose();await controller.dispose();await rm(dir,{recursive:true,force:true});}
});
