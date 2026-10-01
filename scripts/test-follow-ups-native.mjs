import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {LocalCliService} from '../packages/native-runtime/cli.ts';
import {NativeProviderRunner} from '../apps/desktop/host/native-provider.ts';

// Actual installed native processes; all inference is synthetic and stays in this process.
const output=path.resolve(process.env.AWB_FOLLOW_UP_QA??'build/qa/follow-ups/native'),home=path.join(output,'home-'+Date.now());await mkdir(path.join(home,'.codex'),{recursive:true});await mkdir(path.join(home,'.claude'),{recursive:true});
assert.ok(process.env.AWB_QA_CODEX&&process.env.AWB_QA_CLAUDE,'Explicit QA executables required.');
const cli=new LocalCliService(output,{home,isolated:true,executables:{claude:process.env.AWB_QA_CLAUDE,codex:process.env.AWB_QA_CODEX}});await cli.initialize();
const model={id:'fixture',model:'fixture-model',name:'Fixture',enabled:true},connection={id:'fixture',name:'Fixture',protocol:'chat-completions',baseUrl:'http://127.0.0.1:12345/v1',enabled:true,auth:'key',hasKey:true,models:[model],timeoutMs:45000,maxOutputTokens:2048};
const state={hosts:[],sessions:[],modelConnections:[connection]},requests=[],events=[],checks=[];let release,hold=true,mode='response',toolStarted=false,releaseTool,toolRequested=false;
const answer=content=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content}}],usage:{prompt_tokens:80,completion_tokens:8}}),{headers:{'content-type':'application/json'}});
const fetcher=async(url,init)=>{const body=JSON.parse(init.body);requests.push(body);if(hold){hold=false;await new Promise(r=>release=r);}if(mode==='tool'&&!toolRequested){toolRequested=true;const name=body.tools.find(t=>t.function.name.includes('follow_up_probe'))?.function.name;assert.ok(name);return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:'Waiting at a native tool boundary.',tool_calls:[{id:'follow-tool',type:'function',function:{name,arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}});}return answer('Synthetic response '+requests.length);};
const hooks={failure:e=>console.error('NATIVE FAILURE',e),snapshot:()=>structuredClone(state),update:async fn=>fn(state),context:async()=>'',translate:()=>{},observe:async(id,source)=>{source.on('raw',frame=>events.push(frame.value));source.on('event',event=>events.push(event.raw?.value??{}));},peers:id=>({sourceSessionId:id,definitions:[{name:'follow_up_probe',description:'A synthetic tool boundary probe.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],call:async()=>{toolStarted=true;await new Promise(r=>releaseTool=r);return {done:true};}})};
const runner=new NativeProviderRunner({connection:()=>connection,key:async()=> 'synthetic'},cli,hooks,fetcher);
const wait=async check=>{const until=Date.now()+60000;while(Date.now()<until){if(check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out waiting for native follow-up');};
const preview=text=>({id:randomUUID(),original:text,translated:text,sourceHash:'fixture',revision:1,bypass:true,demo:false});
let passed=false;
try{
  for(const runtime of ['codex','claude']){
    hold=true;release=undefined;const offset=requests.length;
    const s={id:randomUUID(),projectId:null,projectPath:home,title:'Follow-up fixture',pinned:false,archived:false,group:'',createdAt:new Date().toISOString(),status:'idle',permissionMode:'full-access',binding:{runtime,provider:connection.id,accountRef:'model-api:'+connection.id,executionId:'local-device',egress:'direct-api',modelConnectionId:connection.id,modelMappingId:model.id},modelSelection:{model:model.model},messages:[]};state.sessions.push(s);
    const initial=preview('Start synthetic '+runtime+' request');await runner.submit(s.id,initial);await wait(()=>{if(s.status==='idle'&&s.nativeError)throw Error(s.nativeError);return !!release&&!!s.nativeTurnId;});
    const first=preview('STEERING_ALPHA_'+runtime),second=preview('STEERING_BETA_'+runtime);
    await runner.steer(s.id,first,s.nativeTurnId);await runner.steer(s.id,second,s.nativeTurnId);assert.equal(s.messages.filter(m=>m.role==='user').length,3);assert.ok(s.messages.find(m=>m.id===first.id));release();
    await wait(()=>!runner.busy(s.id));assert.equal(s.status,'idle',s.nativeError);assert.equal(s.nativeTurnStatus,'completed',s.nativeError);assert.equal(s.messages.find(m=>m.id===first.id).delivery,'accepted');assert.equal(s.messages.find(m=>m.id===second.id).delivery,'accepted');
    const bodies=requests.slice(offset);assert.ok(bodies.some(body=>JSON.stringify(body).includes(first.original)));assert.ok(bodies.some(body=>JSON.stringify(body).includes(second.original)));assert.equal(s.messages.filter(m=>m.id===first.id).length,1);assert.equal(s.messages.filter(m=>m.id===second.id).length,1);assert.ok(s.messages.some(m=>m.nativeTurnEnd));
    checks.push(runtime+': two inputs during an outstanding response reach the native model request and remain visible once');console.log('PASS '+checks.at(-1));
    await assert.rejects(runner.steer(s.id,preview('Too late'),s.nativeTurnId));checks.push(runtime+': ended-turn steering does not become a new task');
  }
  mode='tool';hold=false;const s=state.sessions.find(s=>s.binding.runtime==='claude'),offset=requests.length,eventOffset=events.length;
  await runner.submit(s.id,preview('Use the synthetic tool probe.'));await wait(()=>toolStarted);const guide=preview('STEERING_DURING_NATIVE_TOOL');await runner.steer(s.id,guide,s.nativeTurnId);await new Promise(r=>setTimeout(r,500));releaseTool();await wait(()=>!runner.busy(s.id));assert.equal(s.status,'idle',s.nativeError);assert.equal(s.messages.find(m=>m.id===guide.id).delivery,'accepted');assert.ok(requests.slice(offset).some(body=>JSON.stringify(body).includes(guide.original)));const results=events.slice(eventOffset).filter(e=>e.type==='result');assert.ok(JSON.stringify(requests[offset+1]).includes(guide.original),'The first inference after the tool includes the input');assert.equal(results.length,1,'Claude consumes the mid-tool input within the same native turn');checks.push('claude: input during a native MCP tool reaches the same turn without interruption');console.log('PASS '+checks.at(-1));
  passed=true;
}finally{release?.();await runner.dispose();await writeFile(path.join(output,'report.json'),JSON.stringify({passed,checks,versions:(await cli.list()).map(c=>({runtime:c.runtime,version:c.version})),requestCount:requests.length,events:events.filter(e=>['user','result'].includes(e.type)||e.method==='turn/completed'),sessions:state.sessions.map(s=>({runtime:s.binding.runtime,status:s.status,turnStatus:s.nativeTurnStatus,messages:s.messages})),scope:'Actual CLI, isolated home, synthetic loopback provider. No paid model, user profile, remote service or active desktop.'},null,2));await cli.dispose();}
