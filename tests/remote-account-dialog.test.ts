import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StateStore,SecretStore,initialState} from '../apps/desktop/host/store';
import {WorkbenchController} from '../apps/desktop/host/controller';
import {NativeRuntimeControl} from '../packages/workspace-control/native-runtime';
import {PluginRegistry} from '../packages/plugins-core';
import {encodeZip} from '../packages/native-resources/archive';
import {recordSessionUsage,metricsSource} from '../packages/session-metrics';
import {captureModelUsage,modelUsageSummary} from '../packages/model-management/usage';
import type {AccountCatalog,Session,SshHost} from '../packages/contracts';

test('broker draft stays unpublished through restart, probe, cancellation and failure; only confirmed release publishes',()=>{
 const program=String.raw`
import sys,types,tempfile,copy
try: import fcntl
except ImportError: sys.modules['fcntl']=types.SimpleNamespace()
sys.path.insert(0,sys.argv[1])
from broker import AccountBroker,BrokerError
from runtime import NativeAccountRuntime,RuntimeErrorCode
with tempfile.TemporaryDirectory() as folder:
    cfg={'authorityId':'a','generation':'g','ownerUid':2000,'root':folder}
    broker=AccountBroker(cfg)
    def call(method,**kw):return broker.dispatch(0,{'protocol':1,'method':method,'params':dict(authorityId='a',generation='g',**kw)})
    def visible():return broker.registry.catalog('administrator')['accounts']
    row=call('runtime/claude-prepare',requestId='one')
    assert visible()==[] and row['pendingLogin'] is True
    broker=AccountBroker(cfg)
    assert visible()==[]
    assert call('runtime/claude-prepare',requestId='one')['generation']==row['generation']
    broker.runtime=NativeAccountRuntime(broker,cfg)
    binding={'accountId':row['id'],'accountGeneration':row['generation'],'jobId':'11111111-1111-4111-8111-111111111111'}
    call('runtime/login-reserve',**binding)
    try:call('runtime/claude-discard',accountId=row['id'],accountGeneration=row['generation'])
    except BrokerError as e:assert str(e)=='ACCOUNT_RUNTIME_BUSY'
    else:raise AssertionError('Active draft discarded')
    broker.runtime.observe_identity(row,{'status':'authenticated','email':'fixture@example.invalid'})
    assert visible()==[]
    call('runtime/login-release',**binding,publish=False)
    assert visible()==[] and row['id'] not in broker.registry.state['accounts']
    for name in ('failure','cancel'):
        row=call('runtime/claude-prepare',requestId=name)
        call('runtime/claude-discard',accountId=row['id'],accountGeneration=row['generation'])
        assert visible()==[]
    row=call('runtime/claude-prepare',requestId='success')
    binding.update(accountId=row['id'],accountGeneration=row['generation'])
    call('runtime/login-reserve',**binding)
    try:call('runtime/login-release',**binding,publish=True)
    except BrokerError as e:assert str(e)=='ACCOUNT_UNAVAILABLE'
    else:raise AssertionError('Unverified draft published')
    broker.runtime.observe_identity(row,{'status':'authenticated','email':'fixture@example.invalid'})
    call('runtime/login-release',**binding,publish=True)
    assert len(visible())==1 and visible()[0]['id']==row['id']
    try:call('runtime/claude-discard',accountId=row['id'],accountGeneration=row['generation'])
    except BrokerError as e:assert str(e)=='ACCOUNT_RUNTIME_BUSY'
    else:raise AssertionError('Published account discarded')
    assert len(AccountBroker(cfg).registry.catalog('administrator')['accounts'])==1
`;
 const r=spawnSync('python',['-B','-c',program,path.resolve('services/vps-account-broker')],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr||r.stdout);
});

test('SSH tokens persist once with the full account reference and cannot cross generations',()=>{
 const state=initialState(),ref='vps-account:a/g/claude/account/identity',now=new Date().toISOString();
 const session={id:'s',binding:{runtime:'claude',accountRuntime:'native-owner',accountRef:ref,hostId:'h'},messages:[]} as unknown as Session;state.sessions=[session];
 const sample={id:'receipt',model:'fixture',inputTokens:100,outputTokens:20,cacheReadTokens:50,cacheWriteTokens:0,totalTokens:120};
 for(let i=0;i<2;i++)recordSessionUsage(session,sample,{source:metricsSource(session),turnId:'t',at:now});
 captureModelUsage(state,state);state.sessions=[];
 assert.equal(modelUsageSummary(state,{kind:'account',id:ref},'7day').totalTokens,120);
 assert.equal(modelUsageSummary(state,{kind:'account',id:ref+'-new'},'7day').totalTokens,0);
 assert.equal(state.modelUsage?.length,1);
});

test('approved plugin draft override and interceptor reach real controller/browser, with disable and reenable recovery',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'awb-draft-plugin-')),store=new StateStore(directory);await store.load();
 const host:SshHost={id:'h',name:'Fixture',hostname:'fixture.invalid',port:22,username:'root',role:'admin',identityFile:'unused',knownHostsFile:'unused',ownerId:'fixture',workspaceGeneration:'g'};
 const catalog:AccountCatalog={source:'native-owner',availability:'ready',authorityId:'a',generation:'g',revision:0,workspaceId:'administrator',selectionRevision:0,accounts:[]};
 await store.update(s=>{s.hosts=[host];s.accountCatalogs={h:catalog};});let starts=0,prepares=0;
 const service=new NativeRuntimeControl(directory,async(_h,_c,o)=>{const r=JSON.parse(o!.stdin!);let value:unknown;
 if(r.method==='runtime/claude-prepare'){prepares++;value={id:'draft-'+r.params.requestId,generation:'identity',provider:'claude',pendingLogin:true,observedAt:new Date().toISOString()};}
 else{assert.equal(r.method,'runtime/claude-discard');value={discarded:true};}
 return {exitCode:0,signal:null,stderr:'',stdout:JSON.stringify({ok:true,value})};});
 const controller=new WorkbenchController(store,new SecretStore(directory,{encrypt:()=>{throw Error('No secrets');},decrypt:()=>''}),{pickDirectory:async()=>null,openPath:async()=>{},copy:()=>{},nativeCapabilities:()=>[],nativeAccounts:service,remoteBrowser:{busy:()=>false,start:async(_h:SshHost,c:AccountCatalog,id:string,_profile:string,draft?:boolean)=>{starts++;assert.equal(draft,true);assert.equal(c.accounts[0]?.id,id);return {jobId:'job',accountId:id,state:'preparing',viewerReady:false,codeRequested:false,cleanup:'pending'};},dispose:async()=>{}} as any},()=>{});
 const plugins=new PluginRegistry(path.join(directory,'plugins'));await plugins.initialize();for(const [id,s] of Object.entries(controller.developmentServices()))if(s)plugins.services.register(id,s,{version:1});plugins.connectHost(r=>controller.call(r.method,r.payload));
 const manifest={schemaVersion:1,apiVersion:1,id:'test.remote-draft',name:'Draft fixture',version:'1.0.0',description:'Synthetic lifecycle',capabilities:['host'],main:'main.mjs'};
 const source="export function activate(api){let hits=0;api.onDispose(api.services.intercept('actions.native-accounts','prepareClaude',(next,...args)=>{hits++;return next(...args);}));api.registerCommand('hits',()=>hits);api.registerCommand('prepare',p=>api.call('native-accounts/prepare-claude',p));api.onDispose(api.services.override('actions.native-accounts',{loginCommand:async()=>({command:'synthetic'})}));}";
 const zip=path.join(directory,'plugin.zip');await writeFile(zip,encodeZip([{name:'workbench.plugin.json',data:Buffer.from(JSON.stringify(manifest))},{name:'main.mjs',data:Buffer.from(source)}]));await plugins.importZip(zip);const record=(await plugins.list())[0]!;
 try{
 await assert.rejects(plugins.setEnabled(manifest.id,record.hash,true),/approval/);await plugins.setEnabled(manifest.id,record.hash,true,true);
 const account=await plugins.command(manifest.id,'prepare',{id:'h'}) as any;assert.equal(await plugins.command(manifest.id,'hits',{}),1);assert.equal(store.snapshot().accountCatalogs!.h!.accounts.length,0);
 await controller.call('remote-browser/start',{id:'h',accountId:account.id,profileKey:'a'.repeat(32)});assert.equal(starts,1);
 await controller.call('native-accounts/discard-claude',{id:'h',accountId:account.id});assert.equal(service.draft(host,catalog,account.id),undefined);
 await plugins.setEnabled(manifest.id,record.hash,false);await assert.rejects(plugins.command(manifest.id,'prepare',{id:'h'}),/not found/);
 await controller.call('native-accounts/prepare-claude',{id:'h'});assert.equal(prepares,2);
 await plugins.setEnabled(manifest.id,record.hash,true);await plugins.command(manifest.id,'prepare',{id:'h'});assert.equal(await plugins.command(manifest.id,'hits',{}),1);
 }finally{await plugins.dispose();await controller.dispose();await rm(directory,{recursive:true,force:true});}
});
