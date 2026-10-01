import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProcessSupervisor, decodeNativeFrame, type ProcessSpec } from '../services/remote-supervisor';
import { OfficialAccountTransport, officialAccountLaunch } from '../packages/model-management/native';
import type { LocalModelAccount } from '../packages/model-management/types';
import type { Session } from '../packages/contracts';

const id='11111111-1111-4111-a111-111111111111';
const account=(provider:'codex'|'claude'):LocalModelAccount=>({id,provider,name:'Synthetic',revision:'r',enabled:true,status:'signed-out',models:[]});
class FixtureProcess extends ProcessSupervisor {
  writes:any[]=[];stops:string[]=[];codes:string[]=[];
  constructor(spec:ProcessSpec,private reply:(value:any,p:FixtureProcess)=>void,private ready?:(p:FixtureProcess)=>void){super(spec);}
  override async start(){this.state='running';queueMicrotask(()=>this.ready?.(this));}
  override async write(value:unknown){this.writes.push(value);queueMicrotask(()=>this.reply(value,this));}
  override async writeLoginCode(value:string){this.codes.push(value);}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  exit(code:number){this.state='closed';this.emit('disconnect',{code,signal:null,reason:'fixture'});}
  override async stop(reason='fixture'){this.stops.push(reason);if(this.state!=='closed')this.exit(0);return{code:0,signal:null,reason};}
}
async function fixture(factory:(spec:ProcessSpec)=>FixtureProcess){const directory=await mkdtemp(path.join(os.tmpdir(),'awb-account-protocol-'));const cli={env:{PATH:process.env.PATH,OPENAI_API_KEY:'synthetic-blocked'},isMaintaining:()=>false,locate:async()=>({executable:'synthetic-native'})} as any;const transport=new OfficialAccountTransport(directory,cli,factory);return{transport,close:async()=>{await transport.dispose();await rm(directory,{recursive:true,force:true});}};}
test('managed Codex protocol reads account, native catalogue and quota without a model turn',async()=>{
  const processes:FixtureProcess[]=[];const f=await fixture(spec=>{const p=new FixtureProcess(spec,(v,p)=>{if(!v.id)return;const result=v.method==='account/read'?{account:{type:'chatgpt',email:'test@example.com',planType:'plus'}}:v.method==='model/list'?{data:[{id:'gpt-model',model:'gpt-model',displayName:'Native model',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]}:v.method==='account/rateLimits/read'?{rateLimits:{secondary:{usedPercent:40,windowDurationMins:10080,resetsAt:Date.now()/1000+3600}},rateLimitResetCredits:{availableCount:1,credits:[]}}:{};p.frame({id:v.id,result});});processes.push(p);return p;});
  try{const result=await f.transport.inspect(account('codex'));assert.equal(result.status,'authenticated');assert.equal(result.models[0]?.model,'gpt-model');assert.equal(result.usage?.pools[0]?.primary,undefined);assert.equal(result.usage?.availableResetCount,1);assert.deepEqual(processes[0]!.writes.filter(v=>v.id).map(v=>v.method),['initialize','account/read','model/list','account/rateLimits/read']);assert.equal(processes[0]!.spec.env?.OPENAI_API_KEY,undefined);assert.equal(processes[0]!.stops.length,1);}finally{await f.close();}
});
test('Codex device login waits for matching completion and cancellation owns only its process',async()=>{
  let process!:FixtureProcess;const statuses:string[]=[];const f=await fixture(spec=>process=new FixtureProcess(spec,(v,p)=>{if(v.id)p.frame({id:v.id,result:v.method==='account/login/start'?{loginId:'login',verificationUrl:'https://auth.openai.com/codex/device',userCode:'FAKE-CODE'}:{}});}));
  try{const handle=await f.transport.login(account('codex'),'device',j=>statuses.push(j.status));assert.equal(handle.job.userCode,'FAKE-CODE');assert.equal(process.writes.find(v=>v.method==='account/login/start').params.type,'chatgptDeviceCode');process.frame({method:'account/login/completed',params:{loginId:'different',success:true}});assert.equal(statuses.length,0);await handle.cancel();assert.equal(statuses.at(-1),'cancelled');assert.ok(process.writes.some(v=>v.method==='account/login/cancel'&&v.params.loginId==='login'));assert.ok(process.stops.includes('account-login-cancelled'));}finally{await f.close();}
});
test('Claude logged-out public status accepts exit 1 JSON without parsing any credential file',async()=>{
  const processes:FixtureProcess[]=[];const f=await fixture(spec=>{const p=new FixtureProcess(spec,()=>{},p=>{p.emit('stdout',JSON.stringify({loggedIn:false}));p.exit(1);});processes.push(p);return p;});try{assert.deepEqual(await f.transport.inspect(account('claude')),{status:'signed-out',models:[]});assert.equal(processes.length,1);assert.deepEqual(processes[0]!.spec.args,['auth','status']);}finally{await f.close();}
});
test('Codex login completion in the start response batch is retained and verified',async()=>{
  let process!:FixtureProcess;const statuses:string[]=[];
  const f=await fixture(spec=>process=new FixtureProcess(spec,(v,p)=>{if(!v.id)return;p.frame({id:v.id,result:v.method==='account/login/start'?{loginId:'early',authUrl:'https://auth.openai.com/authorize'}:{}});if(v.method==='account/login/start')p.frame({method:'account/login/completed',params:{loginId:'early',success:true}});}));
  try{const handle=await f.transport.login(account('codex'),'browser',j=>statuses.push(j.status));assert.equal(handle.job.status,'verifying');assert.deepEqual(statuses,['verifying']);assert.ok(process.stops.includes('account-login-completed'));}finally{await f.close();}
});
test('Claude public metadata and stream initialize models do not send an inference prompt',async()=>{
  const processes:FixtureProcess[]=[];const f=await fixture(spec=>{const p=new FixtureProcess(spec,(v,p)=>p.frame({type:'control_response',response:{subtype:'success',request_id:v.request_id,response:v.request.subtype==='get_usage'?{rate_limits_available:true,rate_limits:{five_hour:{utilization:12.5,resets_at:'2026-10-02T01:00:00Z'},seven_day:{utilization:40,resets_at:null}},behaviors:{private:'never returned'}}:{models:[{value:'sonnet',displayName:'Sonnet',supportedEffortLevels:['low','high']}]}}}),p=>{if(spec.args[0]==='auth'){p.emit('stdout',JSON.stringify({loggedIn:true,email:'test@example.com',subscriptionType:'max'}));p.exit(0);}});processes.push(p);return p;});
  try{const result=await f.transport.inspect(account('claude'));assert.equal(result.status,'authenticated');assert.equal(result.models[0]?.model,'sonnet');assert.deepEqual(processes[1]!.writes.map(v=>v.request.subtype),['initialize','get_usage']);assert.equal(result.usage?.pools[0]?.primary?.usedPercent,12.5);assert.equal(result.usage?.pools[0]?.secondary?.usedPercent,40);assert.equal(result.usage?.cardsSupported,false);assert.equal(processes[1]!.writes[1].request.skip_behaviors,true);assert.ok(!JSON.stringify(result).includes('private'));assert.ok(processes.every(p=>p.stops.length===1));}finally{await f.close();}
});
test('Claude official fork retains verified message boundary in the same native profile',()=>{
  const s={id:'22222222-2222-4222-a222-222222222222',binding:{runtime:'claude'},modelSelection:{model:'sonnet'},branch:{native:{runtime:'claude',threadId:id,lastMessageId:'33333333-3333-4333-a333-333333333333'}}} as Session;
  const launch=officialAccountLaunch(s,{CLAUDE_CONFIG_DIR:'isolated'});assert.ok(launch.args.includes('--fork-session'));assert.equal(launch.args[launch.args.indexOf('--resume-session-at')+1],s.branch?.native?.lastMessageId);assert.equal(launch.env.ANTHROPIC_BASE_URL,undefined);
});
for(const method of ['browser','sso','console'] as const)test('Claude '+method+' uses its own native auth flow and only accepts prompted codes',async()=>{
  let process!:FixtureProcess;const f=await fixture(spec=>process=new FixtureProcess(spec,()=>{}));
  try{const handle=await f.transport.login(account('claude'),method,()=>{});assert.deepEqual(process.spec.args,['auth','login',...(method==='sso'?['--sso']:method==='console'?['--console']:[])]);assert.notEqual(process.spec.env?.ANTHROPIC_CONFIG_DIR,undefined);assert.equal(handle.job.userCode,undefined);await assert.rejects(handle.submitCode!('synthetic-code'),/NOT_REQUESTED/);process.emit('stdout','https://claude.ai/oauth/authorize?state=synthetic\nPaste code here if prompted: ');assert.equal(handle.job.codeRequested,true);await assert.rejects(handle.submitCode!('code\ncommand'),/INVALID/);await handle.submitCode!('synthetic-code#state');assert.deepEqual(process.codes,['synthetic-code#state']);await assert.rejects(handle.submitCode!('second'),/NOT_REQUESTED/);process.exit(0);assert.equal(handle.job.status,'verifying');assert.equal(handle.job.codeRequested,undefined);}finally{await f.close();}
});
test('native login code writes one raw input line, without JSON quoting',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'awb-login-input-')),script=path.join(root,'input.cjs');await writeFile(script,"process.stdin.once('data',b=>{process.stdout.write(b);process.exit(0);});");
  const process=new ProcessSupervisor({executable:globalThis.process.execPath,args:[script],outputMode:'opaque',lifetimeMs:5000});let output='';process.on('stdout',b=>{output+=b.toString();});
  try{await process.start();await process.writeLoginCode('synthetic-code#state');await process.waitForExit();assert.equal(output,'synthetic-code#state\n');}finally{await process.stop();await rm(root,{recursive:true,force:true});}
});

for(const mode of ['unsupported','malformed','disconnect'] as const)test('Claude quota '+mode+' preserves login/models and reports unavailable without prompting',async()=>{
 const processes:FixtureProcess[]=[];
 const f=await fixture(spec=>{const p=new FixtureProcess(spec,(v,p)=>{
   if(v.request.subtype==='get_usage'&&mode==='disconnect')return p.exit(1);
   const quota=v.request.subtype==='get_usage';
   p.frame({type:'control_response',response:{request_id:v.request_id,subtype:quota&&mode==='unsupported'?'error':'success',response:quota?{rate_limits_available:true,rate_limits:{five_hour:{utilization:150,resets_at:'invalid'}}}:{models:[{value:'sonnet',displayName:'Sonnet'}]}}});
 },p=>{if(spec.args[0]==='auth'){p.emit('stdout',JSON.stringify({loggedIn:true}));p.exit(0);}});processes.push(p);return p;});
 try{const result=await f.transport.inspect(account('claude'));assert.equal(result.status,'authenticated');assert.equal(result.models.length,1);assert.equal(result.usage?.availability,'unavailable');assert.equal(result.usage?.pools.length,0);assert.deepEqual(processes[1]!.writes.map(v=>v.request.subtype),['initialize','get_usage']);assert.ok(processes.every(p=>p.stops.length===1));}finally{await f.close();}
});
