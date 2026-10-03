import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalClaudeTasks,withClaudeLocalTasks} from '../services/claude-bridge/local-tasks';
import {ClaudeToolMcpSession} from '../services/claude-bridge/tools';
import type {ClaudeToolServer,ClaudeToolServerOptions} from '../services/claude-bridge/tools';

const options=(signal=new AbortController().signal):ClaudeToolServerOptions=>({executable:'fixture',directory:'C:\\fixture',cwd:'C:\\fixture',env:{},signal});
const fakeOpen=async(_options:ClaudeToolServerOptions):Promise<ClaudeToolServer>=>({
 definitions:[{name:'Bash',inputSchema:{type:'object'}},{name:'PowerShell',inputSchema:{type:'object'}}],
 call:async(name,args,signal)=>{await delay(name==='PowerShell'?15:25,undefined,{signal});return {content:[{type:'text',text:JSON.stringify({stdout:String((args as any).command),exitCode:0})}]};},
 close:async()=>{}
});

test('local asynchronous command receipts use official foreground tools and never replay',async()=>{
 const controller=new AbortController(),tasks=new LocalClaudeTasks(options(controller.signal),fakeOpen);
 const first=await tasks.start({requestId:'one',command:'Write-Output one',shell:'PowerShell'});assert.equal(first.state,'running');
 const duplicate=await tasks.start({requestId:'one',command:'Write-Output one',shell:'PowerShell'});assert.equal(duplicate.id,first.id);
 const output=await tasks.output(first.id,1000);assert.equal(output.state,'completed');assert.equal(JSON.parse((output.result as any).content[0].text).stdout,'Write-Output one');assert.equal(output.collected,true);
 await assert.rejects(tasks.start({requestId:'one',command:'different',shell:'PowerShell'}),/LOCAL_TASK_REQUEST_CHANGED/);
 await tasks.close();
});

test('local asynchronous command stop returns a terminal owned receipt',async()=>{
 const tasks=new LocalClaudeTasks(options(),async opts=>({definitions:[{name:'Bash',inputSchema:{type:'object'}}],call:async(_name,_args,signal)=>{await delay(1000,undefined,{signal});return {content:[{type:'text',text:'late'}]};},close:async()=>{}}));
 const task=await tasks.start({requestId:'stop',command:'sleep'});const stopped=await tasks.stop(task.id);assert.ok(['cancelled','uncertain'].includes(stopped.state));assert.equal(stopped.collected,true);await tasks.close();
});

test('local asynchronous MCP tools expose only owned receipts',async()=>{
 const tasks=new LocalClaudeTasks(options(),fakeOpen),base:ClaudeToolServer={definitions:[{name:'Read',inputSchema:{type:'object'}}],call:async()=>({content:[{type:'text',text:'read'}]}),close:async()=>{}};
  const tools=withClaudeLocalTasks(base,tasks);assert.ok(tools.definitions.some(tool=>tool.name==='StartLocalCommand'));const mcp=new ClaudeToolMcpSession(tools,()=> 'plan',()=>{});await mcp.handle({jsonrpc:'2.0',id:1,method:'initialize'});await mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});const denied:any=await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'StartLocalCommand',arguments:{requestId:'denied',command:'echo denied'}}});assert.equal(denied.result.isError,true);const started:any=await tools.call('StartLocalCommand',{requestId:'list',command:'echo list'});const value=JSON.parse(started.content[0].text);assert.equal(value.requestId,'list');assert.deepEqual(started.structuredContent,value);const list:any=await tools.call('ListLocalTasks',{});assert.deepEqual(list.structuredContent,{tasks:JSON.parse(list.content[0].text)});assert.equal(Array.isArray(list.structuredContent),false);mcp.dispose();await tools.close();
});

test('more than 128 asynchronous receipts queue, preserve exact inputs and deduplicate without rerunning',async()=>{
 let release!:()=>void,active=0,maxActive=0;
 const gate=new Promise<void>(resolve=>release=resolve),calls:any[]=[];
 const tasks=new LocalClaudeTasks({...options(),policy:{commandConcurrency:1}},async()=>({definitions:[{name:'Bash'}],call:async(_name,args)=>{active++;maxActive=Math.max(active,maxActive);calls.push(args);await gate;active--;return {content:[{type:'text',text:'done'}]};},close:async()=>{}}));
 try{
  const receipts=[];for(let i=0;i<140;i++)receipts.push(await tasks.start({requestId:'request '+i,command:'x'.repeat(40000),description:'d'.repeat(2000),...(i===1?{timeout:900000}:{})}));
  assert.equal(receipts[0]!.state,'running');assert.equal(receipts[139]!.state,'queued');assert.equal(calls.length,1);
  const duplicate=await tasks.start({requestId:'request 139',command:'x'.repeat(40000),description:'d'.repeat(2000)});assert.equal(duplicate.id,receipts[139]!.id);
  assert.equal((await tasks.stop(receipts[2]!.id)).state,'cancelled');assert.equal(calls.length,1);
  const waiting=tasks.output(receipts[139]!.id,2147484000);await delay(5);assert.equal(calls.length,1);release();assert.equal((await waiting).state,'completed');
  assert.equal(calls.length,139);assert.equal(maxActive,1);assert.equal(calls[0].timeout,undefined);assert.equal(calls[1].timeout,900000);assert.equal(tasks.list().length,140);
 }finally{release();await tasks.close();}
});

test('close during asynchronous startup waits for the late process and never dispatches the command',async()=>{
 let opened!:()=>void,release!:()=>void,calls=0,closes=0;
 const entered=new Promise<void>(r=>opened=r),gate=new Promise<void>(r=>release=r);
 const tasks=new LocalClaudeTasks(options(),async()=>{opened();await gate;return {definitions:[{name:'Bash'}],call:async()=>{calls++;return {};},close:async()=>{closes++;}};});
 const starting=tasks.start({requestId:'late',command:'never'});await entered;const closing=tasks.close();release();const receipt=await starting;await closing;
 assert.equal(receipt.state,'cancelled');assert.equal(calls,0);assert.equal(closes,1);
});
