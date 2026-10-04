import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeSessionTitles, nativeSessionTitles, type NativeTitleReadRequest } from '../packages/session-core/native-titles';
import { NativeProviderRunner } from '../apps/desktop/host/native-provider';
import { LocalModelAccounts } from '../apps/desktop/host/local-model-accounts';
import { StateStore } from '../apps/desktop/host/store';
import { ProcessSupervisor, decodeNativeFrame, type ProcessSpec } from '../services/remote-supervisor';
import { HostServiceRegistry } from '../packages/plugins-core/services';
import type { Session, AppState } from '../packages/contracts';

const nativeId='11111111-1111-4111-a111-111111111111';
const until=async(check:()=>boolean)=>{for(let n=0;n<200;n++){if(check())return;await delay(10);}assert.ok(check(),'Title fixture did not settle');};
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'awb-claude-title-')),cwd=path.join(root,'project'),configDir=path.join(root,'profile');await mkdir(cwd);await mkdir(configDir);
  const directory=path.join(configDir,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));await mkdir(directory,{recursive:true});
  const file=path.join(directory,nativeId+'.jsonl'),request:NativeTitleReadRequest={runtime:'claude',nativeSessionId:nativeId,cwd,configDir};
  const header={type:'user',sessionId:nativeId,cwd,isSidechain:false,message:{role:'user',content:'User input must never become a native title'}};
  const append=(entry:object)=>appendFile(file,JSON.stringify(entry)+'\n');
  await writeFile(file,JSON.stringify(header)+'\n');
  return {root,cwd,configDir,directory,file,request,header,append,reader:new NativeSessionTitles(),close:()=>rm(root,{recursive:true,force:true})};
}

test('explicit native generated/custom titles preserve language and never use prompt or compaction summary',async()=>{
  const f=await fixture();try{
    await f.append({type:'summary',sessionId:nativeId,summary:'Compacted conversation',firstPrompt:'Prompt',lastPrompt:'Recent prompt'});assert.equal(await f.reader.read(f.request),undefined);
    await f.append({type:'metadata',sessionId:nativeId,aiTitle:'Native generated title'});assert.equal((await f.reader.read(f.request))?.title,'Native generated title');
    await f.append({type:'custom-title',sessionId:nativeId,customTitle:'原生自定义标题'});await f.append({type:'metadata',sessionId:nativeId,aiTitle:'Later generated title'});assert.deepEqual(await f.reader.read(f.request),{nativeSessionId:nativeId,title:'原生自定义标题',source:'custom'});
    const before=await readFile(f.file);await f.reader.read(f.request);assert.deepEqual(await readFile(f.file),before);
  }finally{await f.close();}
});
test('native sidecar title is read from the exact UUID directory',async()=>{
  const f=await fixture();try{await mkdir(path.join(f.directory,nativeId));await writeFile(path.join(f.directory,nativeId,'custom-title.json'),JSON.stringify({customTitle:'Native sidecar title'}));assert.equal((await f.reader.read(f.request))?.title,'Native sidecar title');}finally{await f.close();}
});
test('account roots, UUIDs, cwd ownership, sidechains and symlinks fail closed',async()=>{
  const f=await fixture();try{
    await f.append({sessionId:nativeId,aiTitle:'Owned title'});assert.equal(await f.reader.read({...f.request,nativeSessionId:'../other'}),undefined);
    assert.equal(await f.reader.read({...f.request,configDir:path.join(f.root,'other-account')}),undefined);
    assert.equal(await f.reader.read({...f.request,projectDirectoryName:'../escape'}),undefined);
    await f.append({...f.header,cwd:path.join(f.root,'wrong-project')});assert.equal(await f.reader.read(f.request),undefined);
    await writeFile(f.file,JSON.stringify({...f.header,isSidechain:true})+'\n'+JSON.stringify({sessionId:nativeId,aiTitle:'Child title'})+'\n');assert.equal(await f.reader.read(f.request),undefined);
    const redirected=path.join(f.root,'redirected');await mkdir(redirected);await symlink(redirected,path.join(f.configDir,'projects','redirect'),'junction');assert.equal(await f.reader.read({...f.request,projectDirectoryName:'redirect'}),undefined);
  }finally{await f.close();}
});
test('bounded tail reads handle huge messages, malformed records and partial native writes',async()=>{
  const f=await fixture();try{
    await f.append({...f.header,message:{content:'large'.repeat(200000)}});
    await f.append({sessionId:'22222222-2222-4222-a222-222222222222',aiTitle:'Wrong session'});
    await f.append({type:'assistant',sessionId:nativeId,aiTitle:'Not metadata'});
    await f.append({sessionId:nativeId,aiTitle:'Native title after large input'});
    await appendFile(f.file,'{"sessionId":');assert.equal((await f.reader.read(f.request))?.title,'Native title after large input');
    await appendFile(f.file,'broken}\n');await f.append({sessionId:nativeId,aiTitle:'\u0000invalid'});assert.equal((await f.reader.read(f.request))?.title,'Native title after large input');
    const abort=new AbortController();abort.abort();assert.equal(await f.reader.read({...f.request,signal:abort.signal}),undefined);
    const header=JSON.stringify(f.header)+'\n',padding=' '.repeat(64*1024-Buffer.byteLength(header)-1)+'\n';
    await writeFile(f.file,header+padding+JSON.stringify({sessionId:nativeId,aiTitle:'Title exactly on the read boundary'})+'\n');
    assert.equal((await f.reader.read(f.request))?.title,'Title exactly on the read boundary');
  }finally{await f.close();}
});
test('explicit native project directory override works without directory enumeration',async()=>{
  const f=await fixture();try{const override=path.join(f.configDir,'projects','native-project');await mkdir(override);await writeFile(path.join(override,nativeId+'.jsonl'),JSON.stringify(f.header)+'\n'+JSON.stringify({sessionId:nativeId,aiTitle:'Override title'})+'\n');assert.equal((await f.reader.read({...f.request,projectDirectoryName:'native-project'}))?.title,'Override title');}finally{await f.close();}
});
test('a native title sidecar supersedes a historical custom title outside the tail window',async()=>{
  const f=await fixture();try{await f.append({sessionId:nativeId,customTitle:'Historical title'});await f.append({...f.header,message:{content:'padding'.repeat(100000)}});await mkdir(path.join(f.directory,nativeId));await writeFile(path.join(f.directory,nativeId,'custom-title.json'),JSON.stringify({customTitle:'Updated native sidecar title'}));assert.equal((await f.reader.read(f.request))?.title,'Updated native sidecar title');}finally{await f.close();}
});

function runnerFixture(f:Awaited<ReturnType<typeof fixture>>){
  const session={id:'workbench',projectId:null,projectPath:f.cwd,title:'Original fallback',titleSource:'fallback',pinned:false,archived:false,group:'',status:'idle',messages:[],createdAt:'2026-09-30T00:00:00Z',binding:{runtime:'claude',provider:'anthropic',nativeSessionId:nativeId,accountRef:'fixture',executionId:'local-device',egress:'direct-api'}} as Session;
  const state={sessions:[session]} as AppState;
  const cli={home:f.root,env:{CLAUDE_CONFIG_DIR:f.configDir}} as any;
  const runner=new NativeProviderRunner({} as any,cli,{snapshot:()=>structuredClone(state),update:async fn=>fn(state),peers:()=>({}) as any,observe:async()=>{},context:async()=>'',translate:()=>{}});
  return {runner,session,state};
}
test('runner applies actual metadata, persists manual protection and skips remote or unbound sessions',async()=>{
  const f=await fixture(),{runner,session}=runnerFixture(f);try{
    await f.append({sessionId:nativeId,aiTitle:'Native title'});assert.deepEqual(await runner.refreshTitle(session.id),{status:'updated'});assert.equal(session.title,'Native title');
    assert.deepEqual(await runner.refreshTitle(session.id),{status:'unchanged'});session.titleSource='manual';session.title='Manual';assert.deepEqual(await runner.refreshTitle(session.id),{status:'protected'});assert.equal(session.title,'Manual');
    session.title='Native title';session.titleSource='fallback';assert.deepEqual(await runner.refreshTitle(session.id),{status:'updated'});assert.equal(session.titleSource,'native');
    session.titleSource='fallback';session.binding.hostId='remote';assert.deepEqual(await runner.refreshTitle(session.id),{status:'unavailable'});delete session.binding.hostId;delete session.binding.nativeSessionId;assert.deepEqual(await runner.refreshTitle(session.id),{status:'unavailable'});
  }finally{await runner.dispose();await f.close();}
});
test('late reads cannot replace manual titles, changed bindings or unloaded plugin implementations',async()=>{
  const f=await fixture(),{runner,session}=runnerFixture(f),services=new HostServiceRegistry();services.register('sessions.native-titles',nativeSessionTitles);
  let resolve!:(value:any)=>void;
  try{
    for(const scenario of ['manual','binding','disable'] as const){
      session.title='Original';session.titleSource='fallback';session.binding.nativeSessionId=nativeId;
      const release=services.override('sessions.native-titles',{read:()=>new Promise(r=>resolve=r)});
      const pending=runner.refreshTitle(session.id);assert.equal(runner.refreshTitle(session.id),pending);
      if(scenario==='manual')session.titleSource='manual';if(scenario==='binding')session.binding.nativeSessionId='22222222-2222-4222-a222-222222222222';if(scenario==='disable')release();
      resolve({nativeSessionId:nativeId,title:'Late',source:'generated'});await pending;assert.equal(session.title,'Original');release();
    }
  }finally{await runner.dispose();await f.close();}
});
test('a refresh after the reader is overridden starts a new read instead of joining the stale one',async()=>{
  const f=await fixture(),{runner,session}=runnerFixture(f),services=new HostServiceRegistry();services.register('sessions.native-titles',nativeSessionTitles);
  let resolve!:(value:any)=>void;
  const first=services.override('sessions.native-titles',{read:()=>new Promise(r=>resolve=r)});
  try{
    session.title='Original';session.titleSource='fallback';session.binding.nativeSessionId=nativeId;
    const stale=runner.refreshTitle(session.id);
    const second=services.override('sessions.native-titles',{read:async()=>({nativeSessionId:nativeId,title:'Second reader',source:'custom'})});
    assert.deepEqual(await runner.refreshTitle(session.id),{status:'updated'});assert.equal(session.title,'Second reader');
    resolve({nativeSessionId:nativeId,title:'Late',source:'generated'});assert.deepEqual(await stale,{status:'unavailable'});assert.equal(session.title,'Second reader');second();
  }finally{first();await runner.dispose();await f.close();}
});
test('slow or failed title readers never strand a task; shutdown aborts and rejects late results',async()=>{
  const f=await fixture(),{runner,session}=runnerFixture(f),services=new HostServiceRegistry();services.register('sessions.native-titles',nativeSessionTitles);
  let release=services.override('sessions.native-titles',{read:()=>new Promise(()=>{})});
  try{
    assert.deepEqual(await runner.refreshTitle(session.id),{status:'unavailable'});release();release=services.override('sessions.native-titles',{read:async()=>{throw Error('Synthetic IO failure');}});assert.deepEqual(await runner.refreshTitle(session.id),{status:'unavailable'});release();release=services.override('sessions.native-titles',{read:()=>new Promise(()=>{})});const pending=runner.refreshTitle(session.id);await runner.dispose();assert.deepEqual(await pending,{status:'unavailable'});
  }finally{release();await f.close();}
});

class ClaudeTitleTransport extends ProcessSupervisor {
  writes:any[]=[];
  constructor(spec:ProcessSpec){super(spec);}
  frame(value:unknown){this.emit('frame',decodeNativeFrame(Buffer.from(JSON.stringify(value)+'\n')));}
  override async start(){this.state='running';this.frame({type:'system',subtype:'init',session_id:nativeId,permissionMode:'default'});}
  override async write(value:any){this.writes.push(value);}
  override async stop(reason='fixture'){if(this.state!=='closed'){this.state='closed';this.emit('disconnect',{code:0,signal:null,reason});}return {code:0,signal:null,reason};}
}
test('actual native runner reads official-account title at init and completion with one unchanged user turn',async()=>{
  const f=await fixture(),store=new StateStore(f.root);await store.load();const accountId='33333333-3333-4333-a333-333333333333';
  await store.update(s=>{s.localModelAccounts=[{id:accountId,revision:'fixture',provider:'claude',name:'Fixture',enabled:true,status:'authenticated',models:[{id:'native',model:'native',name:'Native',isDefault:true,efforts:[],serviceTiers:[]}]}];});
  const cli={home:f.root,env:{PATH:process.env.PATH},locate:async()=>({executable:'synthetic'}),isMaintaining:()=>false} as any;
  const accounts=new LocalModelAccounts(f.root,cli,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),busy:()=>false,open:async()=>{}}),target=accounts.targets()[0]!;
  const session={...runnerFixture(f).session,id:'44444444-4444-4444-a444-444444444444',binding:target.binding,modelSelection:target.selection,permissionMode:'default'} as Session;await store.update(s=>{s.sessions=[session];});
  const accountFolder=path.join(f.root,'native-accounts',accountId,'claude','projects',f.cwd.replace(/[^a-zA-Z0-9]/g,'-'));await mkdir(accountFolder,{recursive:true});const file=path.join(accountFolder,nativeId+'.jsonl');await writeFile(file,JSON.stringify(f.header)+'\n'+JSON.stringify({sessionId:nativeId,aiTitle:'Initial native title'})+'\n');
  let transport!:ClaudeTitleTransport;
  const runner=new NativeProviderRunner({} as any,cli,{snapshot:()=>store.snapshot(),update:fn=>store.update(fn),peers:()=>({definitions:[],call:async()=>({})}) as any,observe:async()=>{},context:async()=>'',translate:()=>{}},async()=>{throw Error('No network allowed');},accounts,spec=>transport=new ClaudeTitleTransport(spec));
  const get=()=>store.snapshot().sessions[0]!;
  try{
    await runner.submit(session.id,{id:'draft',original:'原始输入',translated:'Original submitted task',revision:1,sourceHash:'fixture',bypass:true,demo:false});await until(()=>get().title==='Initial native title');
    await appendFile(file,JSON.stringify({sessionId:nativeId,aiTitle:'Completed native title'})+'\n');transport.frame({type:'result',subtype:'success',session_id:nativeId,result:'Synthetic reply',is_error:false});await until(()=>!runner.busy(session.id));assert.equal(get().title,'Completed native title');
    assert.equal(transport.writes.filter(v=>v.type==='user').length,1);assert.equal(transport.writes.find(v=>v.type==='user').message.content,'Original submitted task');assert.equal(transport.writes.some(v=>/name|title/.test(JSON.stringify(v))),false);
    const reloaded=new StateStore(f.root);await reloaded.load();assert.equal(reloaded.snapshot().sessions[0]?.title,'Completed native title');
  }finally{await runner.dispose();await accounts.dispose();await f.close();}
});
