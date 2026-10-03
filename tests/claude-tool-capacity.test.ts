import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as turn,setTimeout as delay} from 'node:timers/promises';
import {ProcessSupervisor,decodeNativeFrame} from '../services/remote-supervisor';
import {ClaudeBridgeService} from '../services/claude-bridge';
import {openOfficialClaudeTools,ClaudeToolMcpSession,type ClaudeToolServerOptions} from '../services/claude-bridge/tools';
import {claudeToolPolicies} from '../services/claude-bridge/policy';
import {LocalClaudeResultStore,withClaudeResultStore} from '../services/claude-bridge/result-store';
import {normalizeClaudeToolResult} from '../services/claude-bridge/results';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';

const options=(directory:string):ClaudeToolServerOptions=>({executable:'synthetic',directory,cwd:directory,env:{},signal:new AbortController().signal});

test('native tool catalog and frame exceed former page, count and byte ceilings',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-tool-capacity-')),script=path.join(dir,'native.cjs');
 await writeFile(script,`require('readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(!q.id)return;const page=Number(q.params.cursor??0);const result=q.method==='initialize'?{protocolVersion:'2024-11-05'}:q.method==='tools/list'?{tools:Array.from({length:17},(_,i)=>({name:'Tool'+(page*17+i)})),...(page<33?{nextCursor:String(page+1)}:{})}:{content:[{type:'text',text:'x'.repeat(17*1024*1024)}]};process.stdout.write(JSON.stringify({id:q.id,result})+'\\n');});`);
 const tools=await openOfficialClaudeTools(options(dir),spec=>new ProcessSupervisor({...spec,executable:process.execPath,args:[script]}));
 try{assert.equal(tools.definitions.length,578);assert.equal((await tools.call('Tool577',{}) as any).content[0].text.length,17*1024*1024);}
 finally{await tools.close();await rm(dir,{recursive:true,force:true});}
});

test('large normalized text and image are delivered and full result pages have no fixed ceiling',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-tool-results-')),store=await LocalClaudeResultStore.open(options(dir));
 const value={content:[{type:'text',text:'中'.repeat(3*1024*1024)}]};let calls=0;
 const tools=withClaudeResultStore({definitions:[{name:'Read'}],call:async()=>{calls++;return normalizeClaudeToolResult('Read',value);},close:async()=>{}},store);
 try{
  const ref=(await tools.call('Read',{}) as any).structuredContent.output;
  const page=await store.read(ref.id,0,ref.bytes);assert.equal(page.eof,true);assert.deepEqual(JSON.parse(page.text),value);assert.equal(calls,1);
  const data=Buffer.alloc(6*1024*1024);Buffer.from('89504e470d0a1a0a','hex').copy(data);
  const image:any=normalizeClaudeToolResult('Read',{content:[{type:'text',text:JSON.stringify({type:'image',file:{type:'image/png',base64:data.toString('base64')}})}]});assert.equal(image.content[0].type,'image');assert.equal(Buffer.from(image.content[0].data,'base64').length,data.length);
  const limited=await LocalClaudeResultStore.open({...options(dir),policy:{storedBytes:8}});try{await assert.rejects(limited.put(value),/STORAGE_LIMIT/);}finally{await limited.close();}
 }finally{await tools.close();await rm(dir,{recursive:true,force:true});}
});

test('over 64 concurrent MCP requests retain distinct IDs and duplicate protection',async()=>{
 let release!:()=>void,count=0;const gate=new Promise<void>(r=>release=r);
 const session=new ClaudeToolMcpSession({definitions:[{name:'Read'}],call:async()=>{count++;await gate;return {};},close:async()=>{}},()=> 'default',()=>{});
 await session.handle({jsonrpc:'2.0',id:'init',method:'initialize'});await session.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const request=(id:number)=>session.handle({jsonrpc:'2.0',id,method:'tools/call',params:{name:'Read'}});
 const pending=Array.from({length:80},(_,i)=>request(i));await turn();assert.equal(count,80);assert.ok((await request(0) as any).error);release();assert.ok((await Promise.all(pending)).every((r:any)=>r.result));session.dispose();
});

test('approved policy schedules production commands, cancels queued work and restores new connections',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'awb-tool-policy-')),plugins=new PluginRegistry(path.join(dir,'plugins'));await plugins.initialize();
 plugins.services.register('runtime.claude-tool-policies',claudeToolPolicies,{version:1});
 const starts:string[]=[],ends:(()=>void)[]=[];
 class Fixture extends ProcessSupervisor {
  override async start(){this.state='running';}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async write(q:any){if(q.id===undefined)return;if(q.method==='tools/call'){starts.push(q.params.arguments.command);await new Promise<void>(r=>ends.push(r));}this.frame({id:q.id,result:q.method==='initialize'?{protocolVersion:'2024-11-05'}:q.method==='tools/list'?{tools:[{name:'Bash'},{name:'Read'}]}:{content:[{type:'text',text:'done'}]}});}
  override async stop(reason='fixture'){this.state='closed';const value={reason,code:0,signal:null};this.emit('disconnect',value);return value;}
 }
 const service=new ClaudeBridgeService(dir,spec=>new Fixture(spec));
 const id='qa.tool-policy',manifest={schemaVersion:1,apiVersion:1,id,name:'Tool scheduling',version:'1.0.0',description:'Synthetic only',capabilities:['host'],main:'main.mjs'};
 const code=`export function activate(api){const p=api.services.get('runtime.claude-tool-policies');api.onDispose(p.register({id:'plugin:'+api.id+'/policy',resolve:()=>({commandConcurrency:1,inlineBytes:12})}));api.services.intercept('runtime.claude-tool-policies','resolve',(next,input)=>({...next(input),inlineBytes:16}));}`;
 const file=path.join(dir,'fixture.zip');await writeFile(file,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(code)}]));await plugins.importZip(file);const hash=(await plugins.list())[0]!.hash;
 let tools:Awaited<ReturnType<typeof service.openTools>>|undefined;
 try{
  await plugins.setEnabled(id,hash,true,true);assert.equal(service.toolPolicy(options(dir)).inlineBytes,16);tools=await service.openTools(options(dir));
  const abort=new AbortController(),a=tools.call('Bash',{command:'first'}),b=tools.call('Bash',{command:'cancelled'},abort.signal),c=tools.call('Bash',{command:'third'});const cancelled=assert.rejects(b,/CANCELLED/);
  while(!starts.length)await delay(5);assert.deepEqual(starts,['first']);abort.abort();await cancelled;
  await plugins.setEnabled(id,hash,false);assert.equal(service.toolPolicy(options(dir)).commandConcurrency,4);assert.equal(service.toolPolicy(options(dir)).inlineBytes,1024*1024);
  ends.shift()!();await a;while(starts.length<2)await delay(5);assert.deepEqual(starts,['first','third']);ends.shift()!();await c;
  await plugins.setEnabled(id,hash,true);assert.equal(service.toolPolicy(options(dir)).commandConcurrency,1);
  assert.equal(service.toolPolicy({...options(dir),policy:{commandConcurrency:2}}).commandConcurrency,2);
  const asyncTools=await service.openTools(options(dir));
  try{
   const first=(await asyncTools.call('StartLocalCommand',{requestId:'async first',command:'async first'}) as any).structuredContent;
   const queued=(await asyncTools.call('StartLocalCommand',{requestId:'async second',command:'async second'}) as any).structuredContent;
   // Small inline policy pages the receipt, so read its complete JSON when needed.
   const receipt=async(value:any)=>value.output?JSON.parse((await asyncTools.call('ReadLocalToolResult',{id:value.output.id}) as any).structuredContent.text).structuredContent:value;
   const a=await receipt(first),b=await receipt(queued);assert.equal(a.state,'running');assert.equal(b.state,'queued');
   await asyncTools.call('StopLocalTask',{taskId:b.id});ends.shift()!();await asyncTools.call('LocalTaskOutput',{taskId:a.id,waitMs:40000});
   assert.deepEqual(starts,['first','third','async first']);
  }finally{await asyncTools.close();}

 }finally{for(const end of ends)end();await tools?.close();await plugins.dispose();await rm(dir,{recursive:true,force:true});}
});
