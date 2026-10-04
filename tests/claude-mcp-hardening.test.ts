import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ProcessSupervisor,decodeNativeFrame} from '../services/remote-supervisor';
import {openOfficialClaudeTools,ClaudeToolMcpSession,LOCAL_CLAUDE_TOOLS,type ClaudeToolServer,type ClaudeToolServerOptions} from '../services/claude-bridge/tools';
import {openIsolatedClaudeTools} from '../services/claude-bridge/isolation';
import {LocalClaudeResultStore,withClaudeResultStore} from '../services/claude-bridge/result-store';
import {LocalClaudeTasks} from '../services/claude-bridge/local-tasks';
import {ClaudeToolError} from '../services/claude-bridge/policy';
import {normalizeClaudeToolResult} from '../services/claude-bridge/results';
import {openNativeGateway} from '../packages/model-api/native-gateway';

const defs=LOCAL_CLAUDE_TOOLS.map(name=>({name,inputSchema:{type:'object'}}));
const options=(directory:string):ClaudeToolServerOptions=>({executable:'fixture',directory,cwd:directory,env:{},signal:new AbortController().signal});
class NativeFixture extends ProcessSupervisor{
  answer:(v:any)=>void=()=>{};resets=0;stops=0;
  async start(){this.state='running';}
  async write(v:any){this.answer(v);}
  frame(v:any){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(v)+'\n')));}
  resetOutputBudget(){this.resets++;super.resetOutputBudget();}
  async stop(){this.stops++;this.state='closed';const result={code:0,signal:null,reason:'fixture'};this.emit('disconnect',result);return result;}
}

test('catalog pagination, refresh and correlated progress keep native ownership and cursor integrity',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-catalog-'));let native!:NativeFixture,pages=0,loop=false;const progress:any[]=[];
  try{
    const tools=await openOfficialClaudeTools({...options(directory),progress:v=>progress.push(v)},spec=>{
      native=new NativeFixture(spec);native.answer=v=>{
        if(v.method==='initialize')native.frame({id:v.id,result:{protocolVersion:'2025-03-26'}});
        if(v.method==='tools/list'){pages++;native.frame({id:v.id,result:v.params.cursor?{tools:[...defs.slice(3),{name:'Agent'}],...(loop?{nextCursor:'next'}:{})}:{tools:defs.slice(0,3),nextCursor:'next'}});}
        if(v.method==='tools/call'){native.frame({method:'notifications/progress',params:{progressToken:'unowned',progress:9}});native.frame({method:'notifications/progress',params:{progressToken:v.params._meta.progressToken,progress:1,total:2}});native.frame({id:v.id,result:{content:[{type:'text',text:'ok'}]}});}
      };return native;
    });
    assert.equal(pages,2);assert.ok(!tools.definitions.some(d=>d.name==='Agent'));await tools.call('Read',{});assert.equal(progress.length,1);assert.equal(progress[0].progress,1);
    native.frame({method:'notifications/tools/list_changed'});await tools.listTools!();assert.equal(pages,4);
    loop=true;native.frame({method:'notifications/tools/list_changed'});await assert.rejects(tools.listTools!(),/CATALOG_INVALID/);
    await tools.close();assert.equal(native.stops,1);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('MCP failures preserve safe diagnostic codes without disclosing exception text',async()=>{
  let failure:Error=new ClaudeToolError({code:'CLAUDE_LOCAL_TOOL_TIMEOUT',tool:'Read',callId:'receipt',stage:'execute',outcome:'unknown',elapsedMs:123});
  const tools:ClaudeToolServer={definitions:defs,call:async()=>{throw failure;},close:async()=>{}};
  const session=new ClaudeToolMcpSession(tools,()=> 'default',()=>{});
  await session.handle({jsonrpc:'2.0',id:1,method:'initialize'});await session.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const call=()=>session.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'Read'}}) as Promise<any>;
  assert.equal((await call()).result.structuredContent.diagnostic.elapsedMs,123);
  failure=Error('secret-exception-body');const result=await call();assert.equal(result.result.structuredContent.error,'CLAUDE_LOCAL_TOOL_UNCONFIRMED');assert.ok(!JSON.stringify(result).includes('secret-exception-body'));session.dispose();
});

test('late catalog refresh cannot execute a cancelled call or reuse its in-flight request ID',async()=>{
 let release!:()=>void,calls=0;const gate=new Promise<void>(r=>release=r);
 const tools:ClaudeToolServer={definitions:defs,listTools:async()=>{await gate;return defs;},call:async()=>{calls++;return {};},close:async()=>{}};
 const session=new ClaudeToolMcpSession(tools,()=> 'default',()=>{});await session.handle({jsonrpc:'2.0',id:1,method:'initialize'});await session.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const request={jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'Write'}},pending=session.handle(request);
 assert.ok((await session.handle(request) as any).error);await session.handle({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:2}});release();assert.equal((await pending as any).result.structuredContent.error,'CLAUDE_LOCAL_TOOL_CANCELLED');assert.equal(calls,0);session.dispose();
});

test('native output budgets reset between completed exchanges but enforce single-frame and truncated-stream limits',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-output-window-'));
  const script=path.join(directory,'native.cjs');
  await writeFile(script,`require('readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(!q.id)return;let result=q.method==='initialize'?{protocolVersion:'2024-11-05'}:q.method==='tools/list'?{tools:${JSON.stringify(defs)}}:{content:[{type:'text',text:'x'.repeat(q.params.arguments?.size??1000)}]};if(q.params.arguments?.truncated){process.stdout.write('{');process.exit();}else process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});`);
  const open=()=>openOfficialClaudeTools({...options(directory),policy:{frameBytes:2048,resultBytes:1500,inlineBytes:500,outputWindowBytes:4096}},spec=>new ProcessSupervisor({...spec,executable:process.execPath,args:[script]}));
  try{
    const tools=await open();for(let i=0;i<20;i++)assert.equal((await tools.call('Read',{}) as any).content[0].text.length,1000);
    await assert.rejects(tools.call('Read',{size:3000}),/CLAUDE_LOCAL_WIRE_LIMIT/);await tools.close();
    const truncated=await open();await assert.rejects(truncated.call('Read',{truncated:true}),/CLAUDE_LOCAL_TRUNCATED_FRAME/);await truncated.close();
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('command cancellation does not stop parallel reads or a second command; file edits retain native read state',async()=>{
  let opens=0,closes=0;const controllers:AbortController[]=[];
  const tools=await openIsolatedClaudeTools(options(os.tmpdir()),async o=>{
    const n=opens++;let read=false;
    return {definitions:defs,call:async(name,_args,signal)=>{
      if(name==='Read'){read=true;return {read:n};}if(name==='Edit'){assert.ok(read);return {edited:n};}
      const c=new AbortController();controllers.push(c);signal?.addEventListener('abort',()=>c.abort(),{once:true});o.signal.addEventListener('abort',()=>c.abort(),{once:true});await delay(50,undefined,{signal:c.signal});return {command:n};
    },close:async()=>{closes++;}};
  });
  try{
    const abort=new AbortController(),first=tools.call('Bash',{},abort.signal),second=tools.call('PowerShell',{});first.catch(()=>{});
    await delay(5);assert.equal(controllers.length,2);assert.deepEqual(await tools.call('Read',{}),{read:0});abort.abort();await assert.rejects(first);
    assert.deepEqual(await tools.call('Edit',{}),{edited:0});assert.deepEqual(await second,{command:2});
  }finally{await tools.close();}assert.equal(opens,3);assert.equal(closes,3);
});

test('large results are exact paged UTF-8 JSON, owned by one store, and cleaned without replay',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-results-')),opts={...options(directory),policy:{inlineBytes:128}},store=await LocalClaudeResultStore.open(opts),other=await LocalClaudeResultStore.open(opts);
  let calls=0;const value={content:[{type:'text',text:'中😀'.repeat(1000)}]};
  const tools=withClaudeResultStore({definitions:defs,call:async()=>{calls++;return value;},close:async()=>{}},store);
  try{
    const result:any=await tools.call('Read',{}),ref=result.structuredContent.output;let text='',offset=0;
    for(;;){const page:any=await tools.call('ReadLocalToolResult',{id:ref.id,offset,maxBytes:127});const data=page.structuredContent;text+=data.text;offset=data.nextOffset;if(data.eof)break;}
    assert.deepEqual(JSON.parse(text),value);assert.equal(calls,1);assert.equal(Buffer.byteLength(text),ref.bytes);
    await assert.rejects(other.read(ref.id),/UNAVAILABLE/);await assert.rejects(store.read('../file'),/UNAVAILABLE/);await assert.rejects(store.read(ref.id,-1),/RANGE_INVALID/);
  }finally{await tools.close();await other.close();assert.deepEqual(await readdir(directory),[]);await rm(directory,{recursive:true,force:true});}
});

test('ordinary result storage failure reports a returned native outcome without replay',async()=>{
 let calls=0;
 const store={inlineBytes:10,maxResultBytes:10000,put:async()=>{throw Error('LOCAL_RESULT_STORAGE_LIMIT');},read:async()=>{throw Error('unused');},close:async()=>{}};
 const tools=withClaudeResultStore({definitions:defs,call:async()=>{calls++;return {content:[{type:'text',text:'returned native result'}]};},close:async()=>{}},store);
 const session=new ClaudeToolMcpSession(tools,()=> 'default',()=>{});await session.handle({jsonrpc:'2.0',id:1,method:'initialize'});await session.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const response:any=await session.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'Write'}});assert.equal(response.result.structuredContent.diagnostic.outcome,'returned');assert.match(response.result.content[0].text,/native tool returned/);assert.equal(calls,1);session.dispose();await tools.close();
});

test('completed large async commands retain execution outcome and surface output-delivery failure separately',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'awb-async-output-')),opts={...options(directory),policy:{inlineBytes:128}},store=await LocalClaudeResultStore.open(opts);
  let calls=0;const tasks=new LocalClaudeTasks(opts,async()=>({definitions:defs,call:async()=>{calls++;return {content:[{type:'text',text:JSON.stringify({exitCode:0,stdout:'x'.repeat(2000)})}]};},close:async()=>{}}),store);
  try{
    const task=await tasks.start({requestId:'one',command:'fixture'}),done=await tasks.output(task.id,1000);assert.equal(done.state,'completed');assert.ok(done.output);assert.ok((await store.read(done.output!.id)).text.includes('xxx'));
    await tasks.start({requestId:'one',command:'fixture'});assert.equal(calls,1);
    await store.close();const later=await tasks.start({requestId:'two',command:'fixture'}),failed=await tasks.output(later.id,1000);assert.equal(failed.state,'completed');assert.equal(failed.outputError,'LOCAL_RESULT_STORE_CLOSED');
  }finally{await tasks.close();await store.close();await rm(directory,{recursive:true,force:true});}
});

test('Read text size uses UTF-8 bytes and ordinary structured results stay intact',()=>{
  const result:any=normalizeClaudeToolResult('Read',{content:[{type:'text',text:'中'.repeat(3*1024*1024)}]});assert.equal(result.content[0].text.length,3*1024*1024);
  const normal={content:[{type:'text',text:'ordinary'}],structuredContent:{text:'ordinary'}};assert.deepEqual(normalizeClaudeToolResult('Read',normal),normal);
});

test('HTTP MCP sessions cap, expire idle entries, retain active calls and dispose failed initialization',async()=>{
  let created=0,disposed=0,finish:(()=>void)|undefined,fail=false;
  const gateway=await openNativeGateway({runtime:'claude',model:{id:'fixture',name:'Fixture',model:'fixture',enabled:true},mcpOnly:true,credentials:async()=>{throw Error('No model');},mcpSessionPolicy:{limits:()=>({maxSessions:1,idleMs:30})},mcp:()=>{created++;return {handle:async(q:any)=>{if(fail)throw Error('fixture');if(q.method==='slow')await new Promise<void>(r=>finish=r);return {jsonrpc:'2.0',id:q.id,result:{}};},dispose:()=>{disposed++;}};}});
  const post=(method:string,id?:string)=>fetch(gateway.baseUrl+'/mcp',{method:'POST',headers:{authorization:'Bearer '+gateway.token,...(id?{'mcp-session-id':id}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method})});
  try{
    const first=await post('initialize'),id=first.headers.get('mcp-session-id')!;assert.equal(first.headers.get('connection'),'close');await first.text();assert.equal((await post('initialize')).status,429);
    const pending=post('slow',id);while(!finish)await delay(1);await delay(40);assert.equal((await post('initialize')).status,429);finish();await (await pending).text();await delay(40);
    assert.equal((await post('ping',id)).status,404);assert.equal(disposed,1);
    fail=true;await (await post('initialize')).text();assert.equal(disposed,2);fail=false;assert.equal((await post('initialize')).status,200);assert.equal(created,3);
  }finally{await gateway.close();}assert.equal(disposed,3);
});

test('HTTP MCP tool calls send event-stream headers before a slow result so client header timeouts cannot cut them',async()=>{
  let finish:(()=>void)|undefined,calls=0;
  const gateway=await openNativeGateway({runtime:'claude',model:{id:'fixture',name:'Fixture',model:'fixture',enabled:true},mcpOnly:true,credentials:async()=>{throw Error('No model');},mcp:()=>({handle:async(q:any)=>{if(q.method==='tools/call'){calls++;if(q.params?.name==='slow')await new Promise<void>(r=>finish=r);if(q.params?.name==='broken')throw Error('fixture');}return {jsonrpc:'2.0',id:q.id,result:{ok:q.params?.name??q.method}};},dispose:()=>{}})});
  const post=(body:object,id?:string,accept='application/json, text/event-stream')=>fetch(gateway.baseUrl+'/mcp',{method:'POST',headers:{authorization:'Bearer '+gateway.token,accept,...(id?{'mcp-session-id':id}:{})},body:JSON.stringify({jsonrpc:'2.0',...body})});
  try{
    const init=await post({id:1,method:'initialize'}),id=init.headers.get('mcp-session-id')!;assert.equal(init.headers.get('content-type'),'application/json');await init.text();
    const slow=await post({id:2,method:'tools/call',params:{name:'slow'}},id);
    assert.equal(slow.headers.get('content-type'),'text/event-stream');assert.ok(finish,'headers arrived while the tool is still running');
    finish!();assert.deepEqual(JSON.parse((await slow.text()).match(/^data: (.*)$/m)![1]!),{jsonrpc:'2.0',id:2,result:{ok:'slow'}});
    const broken=JSON.parse((await (await post({id:3,method:'tools/call',params:{name:'broken'}},id)).text()).match(/^data: (.*)$/m)![1]!);
    assert.equal(broken.id,3);assert.equal(broken.error.code,-32603);assert.doesNotMatch(broken.error.message,/fixture/);
    const json=await post({id:4,method:'tools/call',params:{name:'plain'}},id,'application/json');assert.equal(json.headers.get('content-type'),'application/json');assert.deepEqual(await json.json(),{jsonrpc:'2.0',id:4,result:{ok:'plain'}});
    assert.equal(calls,3);
  }finally{await gateway.close();}
});
